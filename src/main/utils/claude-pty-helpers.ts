import * as crypto from 'crypto';
import type { TransportMode } from '../../shared/types';
export { describeCascadeSource } from '../../shared/transport-mode';
export type { CascadeSource } from '../../shared/transport-mode';

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
