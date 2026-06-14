import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { readSessionMessagesRemote } from './remote-fs';
import type { SshRemoteConfig } from '../../shared/types';

/**
 * Encode a cwd path to claude's per-project JSONL directory naming convention.
 * Replaces `/` AND `.` with `-`. Examples:
 *   '/app' → '-app'
 *   '/app/maestro-planner' → '-app-maestro-planner'
 *   '/home/maestro/.claude' → '-home-maestro--claude'
 */
export function encodeCwdForClaudeJsonl(cwd: string): string {
	return cwd.replace(/[\/.]/g, '-');
}

/** Path to ~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl on the host claude runs on. */
export function getSessionJsonlPath(cwd: string, sessionUuid: string, homeDir?: string): string {
	const claudeConfigDir =
		process.env.CLAUDE_CONFIG_DIR ?? path.join(homeDir ?? os.homedir(), '.claude');
	return path.join(
		claudeConfigDir,
		'projects',
		encodeCwdForClaudeJsonl(cwd),
		`${sessionUuid}.jsonl`
	);
}

export interface AssistantContentBlock {
	type: 'thinking' | 'text' | 'tool_use' | 'tool_result' | string;
	text?: string;
	thinking?: string;
	name?: string;
	input?: unknown;
	id?: string;
	[k: string]: unknown;
}

export interface LatestAssistantTurn {
	text: string;
	contentBlocks: AssistantContentBlock[];
	timestamp: string | undefined;
	stopReason: string | undefined;
}

/** ~100 KB local tail window when no SSH config is present. */
const LOCAL_TAIL_BYTES = 100_000;
/** ~50-line SSH tail window via remote-fs pagination. Covers ~10 typical turns. */
const REMOTE_TAIL_LINES = 50;

/**
 * Read the latest assistant turn from claude's session JSONL.
 *
 * Returns null if:
 * - File doesn't exist (caller may retry)
 * - No assistant entry satisfies notBeforeTs + stop_reason guards (caller may retry)
 * - Other I/O error
 *
 * Dispatches:
 * - SSH session → readSessionMessagesRemote() (uses established ControlMaster)
 * - Local session → fs.open + fs.read with negative offset for tail
 *
 * @param cwd - The cwd claude is running in (used to derive the JSONL path)
 * @param sessionUuid - Claude session UUID (matches --session-id / --resume)
 * @param opts.sshRemote - SSH config if claude is running remote; undefined for local
 * @param opts.notBeforeTs - Unix ms; reject assistant entries with older timestamps
 * @param opts.maxRetries - Default 5
 * @param opts.retryDelayMs - Default 200
 */
export async function readLatestAssistantTurn(
	cwd: string,
	sessionUuid: string,
	opts: {
		sshRemote?: SshRemoteConfig;
		homeDirRemote?: string; // remote $HOME if known (avoids extra SSH round-trip)
		notBeforeTs?: number;
		maxRetries?: number;
		retryDelayMs?: number;
	} = {}
): Promise<LatestAssistantTurn | null> {
	const filePath = getSessionJsonlPath(cwd, sessionUuid, opts.homeDirRemote);
	const maxRetries = opts.maxRetries ?? 5;
	const retryDelayMs = opts.retryDelayMs ?? 200;
	const notBeforeTs = opts.notBeforeTs;

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		const lines = opts.sshRemote
			? await readTailRemote(filePath, opts.sshRemote)
			: await readTailLocal(filePath);

		if (lines === null) {
			// File not found yet — retry
			await new Promise((r) => setTimeout(r, retryDelayMs));
			continue;
		}

		// Walk backward to find the most-recent acceptable assistant entry
		let needRetry = false;
		for (let i = lines.length - 1; i >= 0; i--) {
			let entry: {
				type?: string;
				timestamp?: string;
				message?: { content?: AssistantContentBlock[]; stop_reason?: string | null };
			};
			try {
				entry = JSON.parse(lines[i]);
				// swallow-ok(jsonl-partial-write): last JSONL line may be truncated mid-write; skip and continue walking backward
			} catch {
				continue;
			}
			if (entry.type !== 'assistant') continue;

			// Flush-race guard: only accept entries newer than turnStart with stop_reason set
			if (notBeforeTs !== undefined && entry.timestamp) {
				const ts = Date.parse(entry.timestamp);
				if (isFinite(ts) && ts < notBeforeTs) continue;
			}
			const stopReason = entry.message?.stop_reason ?? null;
			if (stopReason === null || stopReason === undefined) {
				// Entry exists but turn not yet flushed — retry
				needRetry = true;
				break;
			}

			const blocks = entry.message?.content ?? [];
			const text = blocks
				.filter((b) => b.type === 'text' && typeof b.text === 'string')
				.map((b) => b.text as string)
				.join('');
			return {
				text,
				contentBlocks: blocks,
				timestamp: entry.timestamp,
				stopReason,
			};
		}

		if (!needRetry && lines.length === 0) {
			// No lines at all — retry
		}

		// Persistent miss this attempt — wait and retry
		await new Promise((r) => setTimeout(r, retryDelayMs));
	}
	return null;
}

/** Read the tail of a local file as an array of trimmed non-empty lines. Null on ENOENT. */
async function readTailLocal(filePath: string): Promise<string[] | null> {
	try {
		const stat = await fs.promises.stat(filePath);
		const size = stat.size;
		const readBytes = Math.min(size, LOCAL_TAIL_BYTES);
		const offset = size - readBytes;
		const handle = await fs.promises.open(filePath, 'r');
		try {
			const buffer = Buffer.alloc(readBytes);
			await handle.read(buffer, 0, readBytes, offset);
			const tail = buffer.toString('utf-8');
			// If we didn't start at offset 0, the first "line" may be truncated; drop it.
			const lines = tail.split('\n').filter((l) => l.trim().length > 0);
			if (offset > 0 && lines.length > 0) lines.shift();
			return lines;
		} finally {
			await handle.close();
		}
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw err;
	}
}

/** Read the tail of a remote file via remote-fs pagination. Null on missing file. */
async function readTailRemote(
	filePath: string,
	sshRemote: SshRemoteConfig
): Promise<string[] | null> {
	const result = await readSessionMessagesRemote(filePath, 0, REMOTE_TAIL_LINES, sshRemote);
	if (!result.success || !result.data) {
		return null;
	}
	return result.data.lines.filter((l) => l.trim().length > 0);
}
