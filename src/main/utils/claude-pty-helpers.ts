import * as crypto from 'crypto';
import * as path from 'path';
import { promisify } from 'util';
import type { TransportMode } from '../../shared/types';
export { describeCascadeSource } from '../../shared/transport-mode';
export type { CascadeSource } from '../../shared/transport-mode';

// Lazy-initialized so that test environments which mock child_process with an
// async factory (vitest async vi.mock) don't receive undefined at module-load time.
let _execFileAsync: ReturnType<typeof promisify> | null = null;
function getExecFileAsync(): ReturnType<typeof promisify> {
	if (!_execFileAsync) {
		const { execFile } = require('child_process') as typeof import('child_process');
		_execFileAsync = promisify(execFile);
	}
	return _execFileAsync;
}

/** Module-level cache: binary path (or 'ssh:<host>') → detected version string. */
const _versionCache = new Map<string, string>();

/** PATH dirs used when running 'claude --version' on a remote SSH host. */
const SSH_VERSION_PATH =
	'$HOME/.local/bin:$HOME/.opencode/bin:$HOME/bin:/usr/local/bin:/opt/homebrew/bin:$HOME/.cargo/bin';

function _parseVersionToken(output: string): string {
	const token = (output.trim().split(/\s+/)[0] ?? '').trim();
	return /^\d[\d.]+/.test(token) ? token : 'unknown';
}

/**
 * Detect the `claude` version for the given binary/SSH config.
 *
 * Local: runs `<claudeBinary> --version` (execFile, 2s timeout).
 * SSH:   runs the equivalent via `ssh` using the connection args already baked into
 *        `baseArgs` (which is `sshInteractiveArgs` without the wrapped bash command).
 *
 * Results are cached per binary path (`<absolutePath>`) or SSH host (`ssh:<host>`).
 * Returns `'unknown'` on any parse failure or timeout; callers then fall back to the
 * `*` default registry entry (see `resolveMarkers`).
 */
export async function detectClaudeVersion(
	claudeBinary: string,
	baseArgs?: string[]
): Promise<string> {
	const binaryBasename = path.basename(claudeBinary).replace(/\.exe$/i, '');

	// ── SSH case ──────────────────────────────────────────────────────────────────
	// Detected when the spawned binary is 'ssh' (or a path ending in '/ssh').
	// baseArgs = ['-tt', '-o', <opt>, ..., 'user@host', '/bin/bash -c <wrapped-cmd>']
	// We strip the last arg (the wrapped bash command) and the '-tt' TTY flag, then
	// append a simple /bin/bash -c "...claude --version..." as the remote command.
	if (binaryBasename === 'ssh' && baseArgs && baseArgs.length >= 2) {
		// Connection args: everything before the wrapped bash command (last arg).
		let connArgs = baseArgs.slice(0, -1);
		// Drop -tt: forces TTY allocation which breaks non-interactive commands.
		connArgs = connArgs.filter((a) => a !== '-tt');
		const host = connArgs[connArgs.length - 1] ?? 'unknown-host';
		const cacheKey = `ssh:${host}`;

		if (_versionCache.has(cacheKey)) return _versionCache.get(cacheKey)!;

		try {
			const remoteCmd = `/bin/bash --norc --noprofile -c "export PATH=${SSH_VERSION_PATH}:$PATH; claude --version 2>&1 | head -1"`;
			const { stdout } = await getExecFileAsync()(claudeBinary, [...connArgs, remoteCmd], {
				timeout: 5000,
				encoding: 'utf-8',
			});
			const version = _parseVersionToken(stdout);
			_versionCache.set(cacheKey, version);
			// swallow-ok: SSH version probe is best-effort; 'unknown' triggers trough-only path
			return version;
		} catch {
			_versionCache.set(cacheKey, 'unknown');
			return 'unknown';
		}
	}

	// ── Local binary ─────────────────────────────────────────────────────────────
	if (_versionCache.has(claudeBinary)) return _versionCache.get(claudeBinary)!;

	try {
		const { stdout } = await getExecFileAsync()(claudeBinary, ['--version'], {
			timeout: 2000,
			encoding: 'utf-8',
		});
		const version = _parseVersionToken(stdout);
		_versionCache.set(claudeBinary, version);
		// swallow-ok: local version probe is best-effort; 'unknown' triggers trough-only path
		return version;
	} catch {
		_versionCache.set(claudeBinary, 'unknown');
		return 'unknown';
	}
}

/**
 * Synchronous cache read. Returns the cached version string, or null on a miss.
 * Used by callers that want to avoid an async await when the version is already known.
 */
export function getCachedClaudeVersion(claudeBinary: string, baseArgs?: string[]): string | null {
	const binaryBasename = path.basename(claudeBinary).replace(/\.exe$/i, '');
	if (binaryBasename === 'ssh' && baseArgs && baseArgs.length >= 2) {
		const connArgs = baseArgs.slice(0, -1).filter((a) => a !== '-tt');
		const host = connArgs[connArgs.length - 1] ?? 'unknown-host';
		return _versionCache.get(`ssh:${host}`) ?? null;
	}
	return _versionCache.get(claudeBinary) ?? null;
}

/**
 * Pre-populate the version cache for a given binary path.
 * Intended for use in unit tests only — allows executeTurn() to bypass the
 * async detectClaudeVersion call and keep tests fully synchronous.
 */
export function _seedVersionCacheForTest(binary: string, version: string): void {
	_versionCache.set(binary, version);
}

/** Args removed from the Claude command line for interactive-pty mode. */
export const PRINT_ARGS_TO_STRIP = ['--print', '-p', '--verbose', '--output-format', 'stream-json'];

/** Remove --print/-p and stream-json output flags from a Claude args array. */
export function stripPrintArgs(args: string[]): string[] {
	const result: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === '--print' || a === '-p' || a === '--verbose') continue;
		if (a === '--output-format' && args[i + 1] === 'stream-json') {
			i++;
			continue;
		}
		result.push(a);
	}
	return result;
}

/** Derive a stable, deterministic Claude --session-id (UUID-shape) from a Maestro session/tab ID. */
export function deriveStableClaudeSessionId(maestroSessionId: string): string {
	const hash = crypto.createHash('sha256').update(maestroSessionId).digest('hex');
	return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

/** Strip ANSI escape sequences and normalize line endings. Used by the analyzer in 01c; the raw-data channel emits PRE-clean bytes. */
export function cleanTerminalChunk(raw: string): string {
	return (
		raw
			.replace(/\r\n/g, '\n')
			.replace(/\r/g, '\n')
			// CSI sequences: ESC [ params final
			.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
			// OSC sequences: ESC ] ... (BEL or ST)
			.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
			// DCS / SOS / PM / APC: ESC [P X ^ _] ... ST
			.replace(/\x1b[PX^_].*?\x1b\\/g, '')
			// Single-char Fe escapes: ESC followed by one byte 0x40-0x5F
			.replace(/\x1b[@-_]/g, '')
			// Strip any remaining bare ESC
			.replace(/\x1b/g, '')
	);
}

/** Error signatures that map to a non-zero exit reason. Used by 01c. */
export const ERROR_SIGNATURES: ReadonlyArray<RegExp> = [
	/^\s*Error:\s/m,
	/Permission denied/i,
	/Failed to execute/i,
	/Authentication failed/i,
	/Rate limit/i,
];

/** Idle-prompt markers Claude shows when it has finished a turn. Used by 01c. */
export const IDLE_PROMPT_MARKERS: ReadonlyArray<RegExp> = [/╰─/, /(\(claude\)|❯|\$)\s*$/m];

/** Completion phrases Claude tends to emit at end-of-turn. Used by 01c. */
export const COMPLETION_PHRASES: ReadonlyArray<string> = [
	'Done!',
	'Task complete',
	'I have finished',
	'Task completed',
];

export type RunnerExitReason =
	| 'SUCCESS'
	| 'AGENT_ERROR'
	| 'AGENT_TIMEOUT'
	| 'PROCESS_CRASH'
	| 'KILLED';

/**
 * Resolve transport mode for the standalone CLI / Auto Run spawner.
 * Order:
 *   1. MAESTRO_CLAUDE_TRANSPORT_MODE env var if set to a valid value (highest priority in CLI context).
 *   2. globalDefault (from app settings electron-store, passed by caller).
 *   3. 'legacy-print' fallback.
 * Per-Project / per-Agent / per-Tab levels do not apply in CLI context.
 */
export function resolveCliClaudeTransportMode(
	globalDefault: TransportMode = 'legacy-print'
): TransportMode {
	const envValue = process.env.MAESTRO_CLAUDE_TRANSPORT_MODE;
	if (envValue === 'interactive-pty' || envValue === 'legacy-print') return envValue;
	return globalDefault;
}

/**
 * Resolves the effective transport mode using the strict-ratchet cascade:
 * tab → agent → project → app. Any level set to 'interactive-pty' wins for
 * everything below it. undefined at any level is treated as 'legacy-print'.
 */
export function resolveClaudeTransportMode(
	tab: { transportMode?: TransportMode } | undefined,
	agent: { transportMode?: TransportMode } | undefined,
	project: { transportMode?: TransportMode } | undefined,
	app: { claudeCodeDefaultTransportMode: TransportMode }
): TransportMode {
	if (tab?.transportMode === 'interactive-pty') return 'interactive-pty';
	if (agent?.transportMode === 'interactive-pty') return 'interactive-pty';
	if (project?.transportMode === 'interactive-pty') return 'interactive-pty';
	if (app.claudeCodeDefaultTransportMode === 'interactive-pty') return 'interactive-pty';
	return 'legacy-print';
}
