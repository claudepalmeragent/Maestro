import { EventEmitter } from 'events';
import * as pty from 'node-pty';
import type { ParsedEvent } from '../parsers/agent-output-parser';
import {
	stripPrintArgs,
	deriveStableClaudeSessionId,
	cleanTerminalChunk,
	type RunnerExitReason,
} from './claude-pty-helpers';
import { ClaudePtyStreamAnalyzer } from './claude-pty-stream-analyzer';

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
	/** Default 45_000 ms. Idle = no PTY data. */
	idleTimeoutMs?: number;
	/** Default 5 * 60_000 ms. Total execution time. */
	executionTimeoutMs?: number;
	/** Default 250 ms. Time after spawn before writing the prompt. */
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
	private readonly opts: Required<ClaudePtyRunnerOptions>;

	private static activeInstances = new Set<ClaudePtyRunner>();

	constructor(options: ClaudePtyRunnerOptions) {
		super();
		this.opts = {
			idleTimeoutMs: 45_000,
			executionTimeoutMs: 5 * 60_000,
			spawnInitDelayMs: 250,
			claudeSessionIdOverride:
				options.claudeSessionIdOverride ?? deriveStableClaudeSessionId(options.maestroSessionId),
			env: {},
			...options,
		};
	}

	/** Run a single turn: spawn, write prompt, watch for exit, emit. */
	executeTurn(prompt: string): void {
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
		this.startTime = Date.now();
		this.lastActivityTime = Date.now();

		const args = stripPrintArgs(this.opts.claudeBaseArgs);

		// Inject --session-id if not already present and not using --resume
		const hasSessionId = args.includes('--session-id');
		const hasResume = args.includes('--resume');
		if (!hasSessionId && !hasResume) {
			args.push('--session-id', this.opts.claudeSessionIdOverride);
		}

		this.analyzer = new ClaudePtyStreamAnalyzer(
			this.opts.maestroSessionId,
			this.opts.claudeSessionIdOverride,
			{
				onEvent: (e) => this.emit('event', e),
				onTurnComplete: () => this.gracefulCompleteTurn(),
			}
		);
		this.analyzer.expectEcho(prompt + '\n');

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

		// Write prompt after init delay
		setTimeout(() => {
			if (this.process && !this.userControlled) {
				this.process.write(prompt + '\n');
				this.process.write('exit\n');
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
		if (this.process) {
			const proc = this.process;
			proc.kill('SIGTERM');
			setTimeout(() => {
				try {
					proc.kill('SIGKILL');
				} catch {
					/* already dead */
				}
			}, 1000);
		}
		// onExit will trigger handleProcessEnd
	}

	private gracefulCompleteTurn(): void {
		if (this.gracefulCompleteTimer) return; // already running

		// Write exit\n to let Claude finish cleanly (may already be queued)
		if (this.process) {
			try {
				this.process.write('exit\n');
			} catch {
				/* process may already be closing */
			}
		}

		// Give the process 5s to exit naturally; if not, force kill
		this.gracefulCompleteTimer = setTimeout(() => {
			this.gracefulCompleteTimer = null;
			if (this.process) {
				this.forceKill('PROCESS_CRASH');
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

		if (this.currentExitReason === 'SUCCESS' && exitCode !== 0) {
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
		this.analyzer = null;
	}
}
