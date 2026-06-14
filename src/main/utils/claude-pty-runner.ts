import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as pty from 'node-pty';
import type { ParsedEvent } from '../parsers/agent-output-parser';
import type { SshRemoteConfig } from '../../shared/types';
import {
	stripPrintArgs,
	deriveStableClaudeSessionId,
	cleanTerminalChunk,
	detectClaudeVersion,
	getCachedClaudeVersion,
	type RunnerExitReason,
} from './claude-pty-helpers';
import { resolveMarkers, type VersionMarkers } from './claude-pty-markers';
import { ClaudePtyStreamAnalyzer } from './claude-pty-stream-analyzer';

/** True when all marker arrays are empty — the fast-path has nothing to check. */
function isMarkersEmpty(m: VersionMarkers): boolean {
	return (
		m.helpLineMarkers.length === 0 &&
		m.completionStatsMarkers.length === 0 &&
		m.idlePromptMarkers.length === 0 &&
		m.spinnerGlyphs.size === 0 &&
		m.completionPhrases.length === 0
	);
}

export interface ClaudePtyRunnerOptions {
	/** Maestro tab/session ID — used to derive --session-id. */
	maestroSessionId: string;
	/** Resolved binary path. For local: 'claude' or absolute path. For SSH: 'ssh' (with sshArgs in claudeBaseArgs). */
	claudeBinary: string;
	/** Args list. Runner will defensively stripPrintArgs(); caller may supply already-stripped. */
	claudeBaseArgs: string[];
	cwd: string;
	env?: Record<string, string>;
	/** Optional explicit Claude --session-id override (for resume case). Default: derived from maestroSessionId. */
	claudeSessionIdOverride?: string;
	/** SSH config when claude runs on a remote host. Forwarded to the analyzer for JSONL reads. */
	sshRemote?: SshRemoteConfig;
	/** Remote $HOME hint passed to the JSONL reader to avoid an extra SSH round-trip. */
	homeDirRemote?: string;
	/** Default 45_000 ms. Idle = no PTY data. */
	idleTimeoutMs?: number;
	/** Default 5 * 60_000 ms. Total execution time. */
	executionTimeoutMs?: number;
	/**
	 * Default 3_000 ms. Time after spawn before writing the prompt.
	 * Must be long enough for Claude's startup phase (banner + auto-update check)
	 * to complete and the REPL readline handler to be fully wired to the API.
	 * In this environment the auto-update check takes ~2s; 3s gives safe margin.
	 */
	spawnInitDelayMs?: number;
}

export interface ClaudePtyRunnerEvents {
	/**
	 * Cleaned/parsed event matching the legacy claude-output-parser's ParsedEvent shape.
	 * Wired by 01c (the analyzer). 01a does NOT emit any 'event' callbacks — analyzer is not built yet.
	 */
	event: (parsedEvent: ParsedEvent) => void;
	/**
	 * Raw uncleaned PTY bytes. Wired by 01a so the Live Interactive Mode view (01b) can
	 * subscribe and render via xterm.js. Always emitted when the PTY is alive.
	 */
	rawData: (chunk: string) => void;
	/** Exit reason + raw exit code. */
	end: (exitReason: RunnerExitReason, rawExitCode: number | null) => void;
	/** Emitted when user-controlled mode changes. */
	state: (state: { isBusy: boolean; userControlled: boolean; alive: boolean }) => void;
}

export class ClaudePtyRunner extends EventEmitter {
	private process: pty.IPty | null = null;
	private isBusy = false;
	private userControlled = false;
	private lastActivityTime = 0;
	private startTime = 0;
	private watchdogTimer: NodeJS.Timeout | null = null;
	private currentExitReason: RunnerExitReason = 'SUCCESS';
	private analyzer: ClaudePtyStreamAnalyzer | null = null;
	private gracefulCompleteTimer: NodeJS.Timeout | null = null;
	/** True when we sent SIGTERM intentionally after turn completion — non-zero exit is expected, not a crash. */
	private intentionalKillAfterSuccess = false;
	private readonly opts: Required<ClaudePtyRunnerOptions>;

	// Debug-capture state (Task 1.5): buffered raw PTY bytes for AGENT_TIMEOUT dumps.
	private static readonly RAW_BUFFER_CAP = 1024 * 1024; // 1 MB
	private rawBuffer: Buffer[] = [];
	private rawBufferSize = 0;
	private currentPrompt = '';
	private currentClaudeVersion = 'unknown';
	private currentRegistryVersion = '*';

	private static activeInstances = new Set<ClaudePtyRunner>();

	constructor(options: ClaudePtyRunnerOptions) {
		super();
		this.opts = {
			idleTimeoutMs: 45_000,
			executionTimeoutMs: 5 * 60_000,
			spawnInitDelayMs: 3_000,
			claudeSessionIdOverride:
				options.claudeSessionIdOverride ?? deriveStableClaudeSessionId(options.maestroSessionId),
			env: {},
			...options,
		} as Required<ClaudePtyRunnerOptions>;
	}

	/** Run a single turn: spawn, write prompt, watch for exit, emit. */
	async executeTurn(prompt: string): Promise<void> {
		if (this.userControlled) {
			this.emit('end', 'AGENT_ERROR' as RunnerExitReason, null);
			return;
		}

		if (this.isBusy) {
			this.emit('end', 'AGENT_ERROR' as RunnerExitReason, null);
			return;
		}

		this.isBusy = true;
		this.currentExitReason = 'SUCCESS';
		this.intentionalKillAfterSuccess = false;
		this.startTime = Date.now();
		this.lastActivityTime = Date.now();
		this.currentPrompt = prompt;
		this.rawBuffer = [];
		this.rawBufferSize = 0;

		const args = stripPrintArgs(this.opts.claudeBaseArgs);

		// Inject --session-id if not already present and not using --resume
		const hasSessionId = args.includes('--session-id');
		const hasResume = args.includes('--resume');
		if (!hasSessionId && !hasResume) {
			args.push('--session-id', this.opts.claudeSessionIdOverride);
		}

		// Detect claude version (cached per binary/host) and resolve the marker set.
		// Synchronous cache-hit path avoids an async suspension so PTY spawn and
		// downstream watchdog setup remain synchronous on repeat calls (important for
		// test determinism with fake timers). On first call, falls through to async.
		const cachedVersion = getCachedClaudeVersion(this.opts.claudeBinary, this.opts.claudeBaseArgs);
		const claudeVersion =
			cachedVersion !== null
				? cachedVersion
				: await detectClaudeVersion(this.opts.claudeBinary, this.opts.claudeBaseArgs);
		const markers = resolveMarkers(claudeVersion);
		this.currentClaudeVersion = claudeVersion;
		this.currentRegistryVersion = markers.version;

		// Pass markers only when the fast-path has real patterns to check.
		// If version detection failed ('unknown') or the catch-all '*' entry has no
		// markers of any kind, pass undefined so the analyzer skips fast-path checks
		// entirely and relies solely on the trough detector for turn-completion.
		const markersForAnalyzer: VersionMarkers | undefined =
			claudeVersion === 'unknown'
				? undefined
				: markers.version === '*' && isMarkersEmpty(markers)
					? undefined
					: markers;

		this.analyzer = new ClaudePtyStreamAnalyzer(
			this.opts.maestroSessionId,
			this.opts.claudeSessionIdOverride,
			{
				onEvent: (e) => this.emit('event', e),
				onTurnComplete: () => this.gracefulCompleteTurn(),
			},
			markersForAnalyzer,
			this.opts.cwd,
			this.opts.sshRemote,
			this.opts.homeDirRemote
		);
		// Claude's TUI input handler runs in raw mode: Enter sends \r, not \n.
		// expectEcho must match what the PTY echoes back when we write prompt + '\r'.
		this.analyzer.expectEcho(prompt + '\r');

		this.process = pty.spawn(this.opts.claudeBinary, args, {
			name: 'xterm-256color',
			cols: 120,
			rows: 40,
			cwd: this.opts.cwd,
			env: { ...process.env, TERM: 'dumb', ...this.opts.env } as Record<string, string>,
		});

		ClaudePtyRunner.activeInstances.add(this);

		this.process.onData((data) => {
			this.lastActivityTime = Date.now();
			this.emit('rawData', data);
			// Buffer raw bytes for AGENT_TIMEOUT debug capture (capped at 1 MB)
			if (this.rawBufferSize < ClaudePtyRunner.RAW_BUFFER_CAP) {
				const chunk = Buffer.from(data, 'binary');
				const canAdd = Math.min(chunk.length, ClaudePtyRunner.RAW_BUFFER_CAP - this.rawBufferSize);
				this.rawBuffer.push(canAdd < chunk.length ? chunk.subarray(0, canAdd) : chunk);
				this.rawBufferSize += canAdd;
			}
			this.analyzer?.ingest(cleanTerminalChunk(data));
		});

		this.process.onExit(({ exitCode, signal }) => this.handleProcessEnd(exitCode, signal));

		// Watchdog: 5s tick
		this.watchdogTimer = setInterval(() => {
			const now = Date.now();
			if (
				now - this.lastActivityTime > this.opts.idleTimeoutMs ||
				now - this.startTime > this.opts.executionTimeoutMs
			) {
				this.forceKill('AGENT_TIMEOUT');
			}
		}, 5_000);

		// Write prompt after init delay (covers Claude's banner + auto-update check),
		// then unlock the analyzer's completion-signal detector. beginTurn() must be
		// called AFTER the write so that startup PTY output does not trigger a premature
		// turn-complete before the response even starts.
		//
		// NOTE: exit\n is NOT written here. gracefulCompleteTurn() sends it after
		// turn-completion detection fires. Sending exit\n immediately after the prompt
		// would interrupt Claude's response generation before it completes.
		setTimeout(() => {
			if (this.process && !this.userControlled) {
				// Claude's TUI uses raw terminal input: carriage return (\r) submits a line.
				// Sending \n alone is ignored by the TUI's readline handler.
				this.process.write(prompt + '\r');
				this.analyzer?.beginTurn();
			}
		}, this.opts.spawnInitDelayMs);
	}

	/** Manual command write (rejected if mutex says busy AND not in user-controlled mode). */
	injectManualCommand(commandString: string): boolean {
		if (!this.process) return false;
		if (this.isBusy && !this.userControlled) return false;
		this.lastActivityTime = Date.now();
		this.process.write(commandString);
		return true;
	}

	/** Toggle user-controlled mode: when true, orchestration writes are rejected and only injectManualCommand from user UI is accepted. */
	setUserControlled(enabled: boolean): void {
		if (enabled && this.isBusy) {
			// Racy: orchestration mid-turn. Emit warning but allow.
			console.warn(
				'[ClaudePtyRunner] setUserControlled(true) called during an active turn — this will interrupt orchestration'
			);
		}
		this.userControlled = enabled;
		this.emit('state', this.getState());
	}

	/** Force kill (SIGTERM → SIGKILL after 1s) and emit 'end' with 'KILLED'. */
	kill(): void {
		this.currentExitReason = 'KILLED';
		this.forceKill('KILLED');
	}

	/** Inspect the runner's current state. Used by the UI to render Take Control vs Resume Orchestration buttons. */
	getState(): { isBusy: boolean; userControlled: boolean; alive: boolean } {
		return {
			isBusy: this.isBusy,
			userControlled: this.userControlled,
			alive: this.process !== null,
		};
	}

	/** Cheap size accessor for the Electron `before-quit` short-circuit (ARD-03). */
	static activeInstanceCount(): number {
		return ClaudePtyRunner.activeInstances.size;
	}

	/**
	 * Kill every currently-active runner. Used by Maestro's Electron `before-quit`
	 * hook to flush PTY buffers and let claude write its final session-log entries
	 * before the app exits. Returns a Promise that resolves once all `'end'` events
	 * have fired (or the safety timeout elapses).
	 */
	static async killAllActive(timeoutMs = 2000): Promise<void> {
		const instances = Array.from(ClaudePtyRunner.activeInstances);
		if (instances.length === 0) return;

		const endPromises = instances.map(
			(runner) =>
				new Promise<void>((resolve) => {
					const onEnd = () => {
						runner.off('end', onEnd);
						resolve();
					};
					runner.once('end', onEnd);
					runner.kill();
				})
		);

		// Race against a hard timeout so app shutdown can't hang on a stuck runner.
		await Promise.race([
			Promise.all(endPromises),
			new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
		]);
	}

	private forceKill(reason: RunnerExitReason): void {
		this.currentExitReason = reason;
		if (reason === 'AGENT_TIMEOUT' && process.env.MAESTRO_CLAUDE_PTY_DEBUG === '1') {
			this.writeDebugCapture();
		}
		if (this.process) {
			const proc = this.process;
			proc.kill('SIGTERM');
			setTimeout(() => {
				try {
					proc.kill('SIGKILL');
					// swallow-ok: best-effort SIGKILL; throws if process already dead, which is the desired terminal state
				} catch {
					/* already dead */
				}
			}, 1000);
		}
		// onExit will trigger handleProcessEnd
	}

	private writeDebugCapture(): void {
		try {
			const debugDir = path.join(os.homedir(), '.claude', 'maestro-debug');
			fs.mkdirSync(debugDir, { recursive: true });
			const timestamp = Date.now();
			const rawPath = path.join(debugDir, `agent-timeout-${timestamp}.raw`);
			const metaPath = path.join(debugDir, `agent-timeout-${timestamp}.meta.json`);
			fs.writeFileSync(rawPath, Buffer.concat(this.rawBuffer));
			const meta = {
				claudeVersion: this.currentClaudeVersion,
				registryVersion: this.currentRegistryVersion,
				prompt: this.currentPrompt,
				idleTimeoutMs: this.opts.idleTimeoutMs,
				totalDurationMs: Date.now() - this.startTime,
				lastNChunks: this.rawBuffer.length,
			};
			fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
			// swallow-ok: debug capture is best-effort; failure is logged and non-fatal
		} catch (err) {
			console.error('[ClaudePtyRunner] failed to write debug capture:', err);
		}
	}

	private gracefulCompleteTurn(): void {
		if (this.gracefulCompleteTimer) return; // already running

		// Write exit\r to let Claude finish cleanly (raw-mode TUI needs \r not \n)
		if (this.process) {
			try {
				this.process.write('exit\r');
				// swallow-ok: best-effort write to PTY that may already be closing; onExit handles teardown either way
			} catch {
				/* process may already be closing */
			}
		}

		// Give the process 5s to exit naturally; if not, SIGTERM it.
		// Mark intentionalKillAfterSuccess so handleProcessEnd won't treat the
		// resulting non-zero exit code (143/SIGTERM) as a PROCESS_CRASH.
		this.gracefulCompleteTimer = setTimeout(() => {
			this.gracefulCompleteTimer = null;
			if (this.process) {
				this.intentionalKillAfterSuccess = true;
				this.forceKill('SUCCESS');
			}
		}, 5_000);
	}

	private handleProcessEnd(exitCode: number | undefined, _signal: number | undefined): void {
		if (this.watchdogTimer) {
			clearInterval(this.watchdogTimer);
			this.watchdogTimer = null;
		}

		if (this.gracefulCompleteTimer) {
			clearTimeout(this.gracefulCompleteTimer);
			this.gracefulCompleteTimer = null;
		}

		// Only treat non-zero exit as a crash when we did NOT intentionally SIGTERM the
		// process after a successful turn completion. Interactive PTY sessions don't
		// self-exit; we SIGTERM them in the graceful timer, producing exit code 143.
		if (
			this.currentExitReason === 'SUCCESS' &&
			exitCode !== 0 &&
			!this.intentionalKillAfterSuccess
		) {
			this.currentExitReason = 'PROCESS_CRASH';
		}

		// Upgrade exit reason if the analyzer detected a stronger signal
		if (this.analyzer) {
			const analyzerReason = this.analyzer.getExitReason();
			if (analyzerReason !== 'SUCCESS' && this.currentExitReason === 'SUCCESS') {
				this.currentExitReason = analyzerReason;
			}
		}

		this.emit('end', this.currentExitReason, exitCode ?? null);

		ClaudePtyRunner.activeInstances.delete(this);

		this.isBusy = false;
		this.userControlled = false;
		this.process = null;
		// dispose() before nulling: cancels any pending idle-debounce timer so it
		// can't fire post-end and trigger a phantom onTurnComplete.
		this.analyzer?.dispose();
		this.analyzer = null;
	}
}
