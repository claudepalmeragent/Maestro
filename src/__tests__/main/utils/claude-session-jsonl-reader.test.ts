import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Mock remote-fs before importing module under test (vitest hoists vi.mock calls)
vi.mock('../../../main/utils/remote-fs', () => ({
	readSessionMessagesRemote: vi.fn(),
}));

import {
	encodeCwdForClaudeJsonl,
	getSessionJsonlPath,
	readLatestAssistantTurn,
} from '../../../main/utils/claude-session-jsonl-reader';
import { readSessionMessagesRemote } from '../../../main/utils/remote-fs';
import type { SshRemoteConfig } from '../../../shared/types';

const MOCK_HOME = '/mock-home';
const MOCK_CWD = '/app';
const MOCK_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const STUB_SSH_REMOTE: SshRemoteConfig = {
	id: 'test-ssh',
	name: 'Test SSH',
	host: 'remote.example.com',
	port: 22,
	username: 'maestro',
	privateKeyPath: '~/.ssh/id_ed25519',
	enabled: true,
};

// ~100 KB threshold constant (mirrors the implementation)
const LOCAL_TAIL_BYTES = 100_000;

function assistantLine(opts: {
	text?: string;
	stopReason?: string | null;
	timestamp?: string;
	content?: object[];
}) {
	const content =
		opts.content !== undefined
			? opts.content
			: opts.text !== undefined
				? [{ type: 'text', text: opts.text }]
				: [];
	return JSON.stringify({
		type: 'assistant',
		timestamp: opts.timestamp ?? new Date(Date.now() + 1000).toISOString(),
		message: {
			content,
			stop_reason: opts.stopReason !== undefined ? opts.stopReason : 'end_turn',
		},
	});
}

function userLine(text: string) {
	return JSON.stringify({
		type: 'user',
		timestamp: new Date().toISOString(),
		message: { content: text },
	});
}

/** Spy on fs.promises.stat + fs.promises.open to serve synthetic file content. */
function setupLocalFs(fileContent: string) {
	const contentBuf = Buffer.from(fileContent, 'utf-8');
	const size = contentBuf.length;

	vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size } as fs.Stats);

	const mockHandle = {
		read: vi
			.fn()
			.mockImplementation(
				async (buffer: Buffer, bufOffset: number, length: number, position: number) => {
					const src = contentBuf.subarray(position, position + length);
					src.copy(buffer, bufOffset);
					return { bytesRead: src.length, buffer };
				}
			),
		close: vi.fn().mockResolvedValue(undefined),
	};

	vi.spyOn(fs.promises, 'open').mockResolvedValue(mockHandle as unknown as fs.promises.FileHandle);

	return { mockHandle, size };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. encodeCwdForClaudeJsonl edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('encodeCwdForClaudeJsonl', () => {
	it.each([
		// [input, expected]   — encoding replaces / AND . with -
		['/app', '-app'],
		['/app/maestro-planner', '-app-maestro-planner'],
		['/home/maestro/.claude', '-home-maestro--claude'], // dot → dash, hence double-dash
		['/', '-'],
	])('encodes %s → %s', (cwd: string, expected: string) => {
		expect(encodeCwdForClaudeJsonl(cwd)).toBe(expected);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. getSessionJsonlPath
// ─────────────────────────────────────────────────────────────────────────────

describe('getSessionJsonlPath', () => {
	let savedClaudeConfigDir: string | undefined;

	beforeEach(() => {
		savedClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
		delete process.env.CLAUDE_CONFIG_DIR;
	});

	afterEach(() => {
		if (savedClaudeConfigDir === undefined) {
			delete process.env.CLAUDE_CONFIG_DIR;
		} else {
			process.env.CLAUDE_CONFIG_DIR = savedClaudeConfigDir;
		}
		vi.restoreAllMocks();
	});

	it('composes correct local path using os.homedir()', () => {
		// Use actual homedir value — ESM exports can't be spied on directly
		const home = os.homedir();
		const result = getSessionJsonlPath('/app', MOCK_UUID);
		expect(result).toBe(path.join(home, '.claude', 'projects', '-app', `${MOCK_UUID}.jsonl`));
	});

	it('honors CLAUDE_CONFIG_DIR env var over os.homedir()', () => {
		process.env.CLAUDE_CONFIG_DIR = '/custom/claude-dir';
		const result = getSessionJsonlPath('/app', MOCK_UUID);
		expect(result).toBe(path.join('/custom/claude-dir', 'projects', '-app', `${MOCK_UUID}.jsonl`));
	});

	it('honors explicit homeDir override parameter', () => {
		// Passing homeDir bypasses os.homedir() without needing to spy on it
		const result = getSessionJsonlPath('/app', MOCK_UUID, '/explicit-home');
		expect(result).toBe(
			path.join('/explicit-home', '.claude', 'projects', '-app', `${MOCK_UUID}.jsonl`)
		);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Local read tests
// ─────────────────────────────────────────────────────────────────────────────

describe('readLatestAssistantTurn — local', () => {
	let savedClaudeConfigDir: string | undefined;

	beforeEach(() => {
		savedClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
		delete process.env.CLAUDE_CONFIG_DIR;
	});

	afterEach(() => {
		if (savedClaudeConfigDir === undefined) {
			delete process.env.CLAUDE_CONFIG_DIR;
		} else {
			process.env.CLAUDE_CONFIG_DIR = savedClaudeConfigDir;
		}
		vi.restoreAllMocks();
	});

	// Scenario 3 — happy path
	it('happy path: returns text content from a local JSONL', async () => {
		const futureTs = new Date(Date.now() + 500).toISOString();
		const content = [
			userLine('hello'),
			assistantLine({ text: 'Hello world!', stopReason: 'end_turn', timestamp: futureTs }),
		].join('\n');

		setupLocalFs(content);

		const result = await readLatestAssistantTurn(MOCK_CWD, MOCK_UUID, {
			homeDirRemote: MOCK_HOME,
			maxRetries: 1,
			retryDelayMs: 0,
		});

		expect(result).not.toBeNull();
		expect(result!.text).toBe('Hello world!');
		expect(result!.stopReason).toBe('end_turn');
		expect(result!.timestamp).toBe(futureTs);
	});

	// Scenario 4 — first-line truncation drop
	it('drops truncated first line when file is larger than tail window', async () => {
		const futureTs = new Date(Date.now() + 500).toISOString();
		const validLine = assistantLine({
			text: 'Valid response',
			stopReason: 'end_turn',
			timestamp: futureTs,
		});
		// Simulate the tail portion starting with a mid-line fragment
		const tailContent = 'TRUNCATED_FIRST_LINE\n' + validLine;
		const tailBuf = Buffer.from(tailContent, 'utf-8');

		// Report size > LOCAL_TAIL_BYTES so offset = size - LOCAL_TAIL_BYTES > 0
		// triggering the "drop first line" branch
		vi.spyOn(fs.promises, 'stat').mockResolvedValue({
			size: LOCAL_TAIL_BYTES + 5000,
		} as fs.Stats);

		const mockHandle = {
			read: vi
				.fn()
				.mockImplementation(async (buffer: Buffer, bufOffset: number, length: number) => {
					// Fill buffer with \n so split/filter discards empty lines, then overwrite
					// the start with our actual tail content (simulates reading file tail).
					buffer.fill('\n'.charCodeAt(0));
					const src = tailBuf.subarray(0, Math.min(length, tailBuf.length));
					src.copy(buffer, bufOffset);
					return { bytesRead: length, buffer };
				}),
			close: vi.fn().mockResolvedValue(undefined),
		};

		vi.spyOn(fs.promises, 'open').mockResolvedValue(
			mockHandle as unknown as fs.promises.FileHandle
		);

		const result = await readLatestAssistantTurn(MOCK_CWD, MOCK_UUID, {
			homeDirRemote: MOCK_HOME,
			maxRetries: 1,
			retryDelayMs: 0,
		});

		// TRUNCATED_FIRST_LINE is dropped; valid assistant line is found
		expect(result).not.toBeNull();
		expect(result!.text).toBe('Valid response');
	});

	// Scenario 5 — ENOENT retry
	it('ENOENT on first attempt: retries and succeeds on second', async () => {
		const futureTs = new Date(Date.now() + 500).toISOString();
		const validLine = assistantLine({
			text: 'Retried response',
			stopReason: 'end_turn',
			timestamp: futureTs,
		});
		const contentBuf = Buffer.from(validLine, 'utf-8');

		const enoentError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });

		vi.spyOn(fs.promises, 'stat')
			.mockRejectedValueOnce(enoentError)
			.mockResolvedValue({ size: contentBuf.length } as fs.Stats);

		const mockHandle = {
			read: vi
				.fn()
				.mockImplementation(
					async (buffer: Buffer, bufOffset: number, length: number, position: number) => {
						const src = contentBuf.subarray(position, position + length);
						src.copy(buffer, bufOffset);
						return { bytesRead: src.length, buffer };
					}
				),
			close: vi.fn().mockResolvedValue(undefined),
		};
		vi.spyOn(fs.promises, 'open').mockResolvedValue(
			mockHandle as unknown as fs.promises.FileHandle
		);

		const result = await readLatestAssistantTurn(MOCK_CWD, MOCK_UUID, {
			homeDirRemote: MOCK_HOME,
			maxRetries: 3,
			retryDelayMs: 0,
		});

		expect(result).not.toBeNull();
		expect(result!.text).toBe('Retried response');
		// stat called twice: first ENOENT, second success
		expect(vi.mocked(fs.promises.stat)).toHaveBeenCalledTimes(2);
	});

	// Scenario 6 — backward walk returns LATER entry
	it('backward walk: returns the later of two assistant entries', async () => {
		const ts1 = new Date(Date.now() + 100).toISOString();
		const ts2 = new Date(Date.now() + 200).toISOString();
		const content = [
			userLine('first'),
			assistantLine({ text: 'First response', stopReason: 'end_turn', timestamp: ts1 }),
			userLine('second'),
			assistantLine({ text: 'Second response', stopReason: 'end_turn', timestamp: ts2 }),
		].join('\n');

		setupLocalFs(content);

		const result = await readLatestAssistantTurn(MOCK_CWD, MOCK_UUID, {
			homeDirRemote: MOCK_HOME,
			maxRetries: 1,
			retryDelayMs: 0,
		});

		expect(result).not.toBeNull();
		// Must be the LAST (most recent) assistant entry, not the first
		expect(result!.text).toBe('Second response');
		expect(result!.timestamp).toBe(ts2);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// SSH read tests
// ─────────────────────────────────────────────────────────────────────────────

describe('readLatestAssistantTurn — SSH', () => {
	beforeEach(() => {
		vi.mocked(readSessionMessagesRemote).mockReset();
	});

	// Scenario 7 — SSH happy path
	it('SSH happy path: returns text via readSessionMessagesRemote', async () => {
		const futureTs = new Date(Date.now() + 500).toISOString();
		const lines = [
			userLine('ping'),
			assistantLine({ text: 'SSH response', stopReason: 'end_turn', timestamp: futureTs }),
		];

		vi.mocked(readSessionMessagesRemote).mockResolvedValue({
			success: true,
			data: { lines, totalLines: lines.length, hasMore: false },
		});

		const result = await readLatestAssistantTurn(MOCK_CWD, MOCK_UUID, {
			sshRemote: STUB_SSH_REMOTE,
			maxRetries: 1,
			retryDelayMs: 0,
		});

		expect(result).not.toBeNull();
		expect(result!.text).toBe('SSH response');
		expect(readSessionMessagesRemote).toHaveBeenCalledOnce();
		// Verify correct argument order: (filePath, 0, 50, sshRemote)
		const [, offset, limit, ssh] = vi.mocked(readSessionMessagesRemote).mock.calls[0];
		expect(offset).toBe(0);
		expect(limit).toBe(50);
		expect(ssh).toBe(STUB_SSH_REMOTE);
	});

	// Scenario 8 — SSH failure
	it('SSH failure: success:false → null after exhausting retries', async () => {
		vi.mocked(readSessionMessagesRemote).mockResolvedValue({
			success: false,
			error: 'File not found on remote',
		});

		const result = await readLatestAssistantTurn(MOCK_CWD, MOCK_UUID, {
			sshRemote: STUB_SSH_REMOTE,
			maxRetries: 2,
			retryDelayMs: 0,
		});

		expect(result).toBeNull();
		// Called maxRetries times
		expect(readSessionMessagesRemote).toHaveBeenCalledTimes(2);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Flush-race guard + content filters
// ─────────────────────────────────────────────────────────────────────────────

describe('flush-race guard + content filters', () => {
	let savedClaudeConfigDir: string | undefined;

	beforeEach(() => {
		savedClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
		delete process.env.CLAUDE_CONFIG_DIR;
	});

	afterEach(() => {
		if (savedClaudeConfigDir === undefined) {
			delete process.env.CLAUDE_CONFIG_DIR;
		} else {
			process.env.CLAUDE_CONFIG_DIR = savedClaudeConfigDir;
		}
		vi.restoreAllMocks();
	});

	// Scenario 9 — null stop_reason rejected
	it('null stop_reason: returns null after retries (flush-race guard)', async () => {
		const futureTs = new Date(Date.now() + 500).toISOString();
		const content = assistantLine({ text: 'Incomplete', stopReason: null, timestamp: futureTs });

		setupLocalFs(content);

		const result = await readLatestAssistantTurn(MOCK_CWD, MOCK_UUID, {
			homeDirRemote: MOCK_HOME,
			maxRetries: 2,
			retryDelayMs: 0,
		});

		expect(result).toBeNull();
		// stat called maxRetries times (one per attempt)
		expect(vi.mocked(fs.promises.stat)).toHaveBeenCalledTimes(2);
	});

	// Scenario 10 — notBeforeTs filter
	it('notBeforeTs filter: rejects entry older than turnStart → null', async () => {
		// Entry is 10 seconds in the past
		const staleTs = new Date(Date.now() - 10_000).toISOString();
		const content = assistantLine({
			text: 'Old response',
			stopReason: 'end_turn',
			timestamp: staleTs,
		});

		setupLocalFs(content);

		const result = await readLatestAssistantTurn(MOCK_CWD, MOCK_UUID, {
			homeDirRemote: MOCK_HOME,
			notBeforeTs: Date.now() - 5_000, // stale entry is older than this
			maxRetries: 1,
			retryDelayMs: 0,
		});

		expect(result).toBeNull();
	});

	// Scenario 11 — partial-write tail skip
	it('partial-write tail: skips truncated last line, finds prior complete entry', async () => {
		const futureTs = new Date(Date.now() + 500).toISOString();
		const validLine = assistantLine({ text: 'Valid', stopReason: 'end_turn', timestamp: futureTs });
		const truncated = '{"type":"assis'; // incomplete JSON — simulates mid-append read
		const content = [validLine, truncated].join('\n');

		setupLocalFs(content);

		const result = await readLatestAssistantTurn(MOCK_CWD, MOCK_UUID, {
			homeDirRemote: MOCK_HOME,
			maxRetries: 1,
			retryDelayMs: 0,
		});

		expect(result).not.toBeNull();
		expect(result!.text).toBe('Valid');
	});

	// Scenario 12 — tool-use mixed content blocks
	it('tool-use mixed blocks: returns concatenated text only, preserves all blocks', async () => {
		const futureTs = new Date(Date.now() + 500).toISOString();
		const contentBlocks = [
			{ type: 'tool_use', id: 'tu1', name: 'bash', input: { command: 'ls /tmp' } },
			{ type: 'text', text: 'hi' },
			{ type: 'text', text: '!' },
		];
		const content = assistantLine({
			content: contentBlocks,
			stopReason: 'tool_use',
			timestamp: futureTs,
		});

		setupLocalFs(content);

		const result = await readLatestAssistantTurn(MOCK_CWD, MOCK_UUID, {
			homeDirRemote: MOCK_HOME,
			maxRetries: 1,
			retryDelayMs: 0,
		});

		expect(result).not.toBeNull();
		// Only text blocks are concatenated
		expect(result!.text).toBe('hi!');
		// All 3 blocks are preserved in contentBlocks
		expect(result!.contentBlocks).toHaveLength(3);
		expect(result!.stopReason).toBe('tool_use');
	});
});
