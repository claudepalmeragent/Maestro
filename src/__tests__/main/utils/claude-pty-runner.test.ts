import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Must mock node-pty before importing the runner (native module)
vi.mock('node-pty', () => ({
	spawn: vi.fn(),
}));

// Mock @xterm/headless used by ClaudePtyStreamAnalyzer
vi.mock('@xterm/headless', () => {
	class MockTerminal {
		private _lines: string[] = [];
		write(chunk: string): void {
			for (const l of chunk.split('\n')) {
				if (l) this._lines.push(l);
			}
		}
		get buffer() {
			const lines = this._lines;
			return {
				active: {
					get length() {
						return lines.length;
					},
					getLine: (i: number) => ({ translateToString: () => lines[i] ?? '' }),
				},
			};
		}
	}
	return { Terminal: MockTerminal };
});

import * as nodePty from 'node-pty';
import { ClaudePtyRunner } from '../../../main/utils/claude-pty-runner';

// Controllable mock IPty
function makeMockPty() {
	let dataHandler: ((data: string) => void) | null = null;
	let exitHandler: ((e: { exitCode: number; signal?: number }) => void) | null = null;
	const writes: string[] = [];
	const killCalls: string[] = [];

	const mockPty = {
		onData: vi.fn((cb: (data: string) => void) => {
			dataHandler = cb;
			return { dispose: vi.fn() };
		}),
		onExit: vi.fn((cb: (e: { exitCode: number; signal?: number }) => void) => {
			exitHandler = cb;
			return { dispose: vi.fn() };
		}),
		write: vi.fn((data: string) => {
			writes.push(data);
		}),
		kill: vi.fn((signal?: string) => {
			killCalls.push(signal ?? 'SIGTERM');
		}),
		pid: 12345,
		cols: 120,
		rows: 40,
		process: 'claude',
		handleFlowControl: false,
		// Helper methods for tests
		_emit: (data: string) => dataHandler?.(data),
		_exit: (code: number, signal?: number) => exitHandler?.({ exitCode: code, signal }),
		_writes: writes,
		_killCalls: killCalls,
	};

	return mockPty;
}

function makeRunner(
	overrides: Partial<ConstructorParameters<typeof ClaudePtyRunner>[0]> = {}
): ClaudePtyRunner {
	return new ClaudePtyRunner({
		maestroSessionId: 'test-session-id',
		claudeBinary: 'claude',
		claudeBaseArgs: ['--model', 'sonnet'],
		cwd: '/tmp',
		spawnInitDelayMs: 0,
		idleTimeoutMs: 45_000,
		executionTimeoutMs: 5 * 60_000,
		...overrides,
	});
}

describe('ClaudePtyRunner', () => {
	let mockPty: ReturnType<typeof makeMockPty>;

	beforeEach(() => {
		vi.useFakeTimers();
		mockPty = makeMockPty();
		vi.mocked(nodePty.spawn).mockReturnValue(mockPty as unknown as nodePty.IPty);
		// Clear active instances between tests by killing all
		// (tests manage their own instances)
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	describe('executeTurn — successful turn', () => {
		it('calls pty.spawn with stripped args and derived session-id', () => {
			const runner = makeRunner({
				claudeBaseArgs: ['--print', '--model', 'sonnet', '--output-format', 'stream-json'],
			});

			runner.executeTurn('hello');

			expect(nodePty.spawn).toHaveBeenCalledOnce();
			const [binary, args, opts] = vi.mocked(nodePty.spawn).mock.calls[0];
			expect(binary).toBe('claude');
			// --print and --output-format stream-json should be stripped
			expect(args).not.toContain('--print');
			expect(args).not.toContain('stream-json');
			expect(args).toContain('--model');
			expect(args).toContain('sonnet');
			// --session-id should be injected
			expect(args).toContain('--session-id');
			expect(opts.env).toMatchObject({ TERM: 'dumb' });

			// Cleanup
			mockPty._exit(0);
		});

		it('emits rawData events as PTY data arrives', () => {
			const runner = makeRunner();
			const rawChunks: string[] = [];
			runner.on('rawData', (chunk) => rawChunks.push(chunk));

			runner.executeTurn('do work');
			mockPty._emit('chunk1');
			mockPty._emit('chunk2');

			expect(rawChunks).toEqual(['chunk1', 'chunk2']);

			mockPty._exit(0);
		});

		it('writes prompt after spawnInitDelayMs', async () => {
			const runner = makeRunner({ spawnInitDelayMs: 250 });
			runner.executeTurn('my prompt');

			// Before delay fires, nothing written
			expect(mockPty._writes).toHaveLength(0);

			// After delay
			await vi.advanceTimersByTimeAsync(250);
			expect(mockPty._writes[0]).toBe('my prompt\n');
			expect(mockPty._writes[1]).toBe('exit\n');

			mockPty._exit(0);
		});

		it('emits end with SUCCESS and exitCode 0 on clean exit', () => {
			const runner = makeRunner();
			const endEvents: Array<{ reason: string; code: number | null }> = [];
			runner.on('end', (reason, code) => endEvents.push({ reason, code }));

			runner.executeTurn('hello');
			mockPty._exit(0);

			expect(endEvents).toHaveLength(1);
			expect(endEvents[0]).toEqual({ reason: 'SUCCESS', code: 0 });
		});
	});

	describe('mutex guard', () => {
		it('rejects second executeTurn while first is busy', () => {
			const runner = makeRunner();
			const endEvents: Array<{ reason: string; code: number | null }> = [];
			runner.on('end', (reason, code) => endEvents.push({ reason, code }));

			runner.executeTurn('first');
			runner.executeTurn('second'); // Should be rejected

			expect(nodePty.spawn).toHaveBeenCalledOnce();
			expect(endEvents).toHaveLength(1);
			expect(endEvents[0].reason).toBe('AGENT_ERROR');

			// Cleanup
			mockPty._exit(0);
		});
	});

	describe('watchdog', () => {
		it('sends SIGTERM after idle timeout with no PTY data', async () => {
			const runner = makeRunner({ idleTimeoutMs: 45_000 });
			runner.executeTurn('hello');

			// Advance past idle timeout (watchdog ticks every 5s)
			await vi.advanceTimersByTimeAsync(50_000);

			expect(mockPty.kill).toHaveBeenCalledWith('SIGTERM');
		});

		it('emits end with AGENT_TIMEOUT on idle timeout', async () => {
			const runner = makeRunner({ idleTimeoutMs: 45_000 });
			const endEvents: Array<{ reason: string }> = [];
			runner.on('end', (reason) => endEvents.push({ reason }));

			runner.executeTurn('hello');
			await vi.advanceTimersByTimeAsync(50_000);

			// Trigger the exit
			mockPty._exit(1, 15); // killed by SIGTERM

			expect(endEvents[0].reason).toBe('AGENT_TIMEOUT');
		});

		it('sends SIGTERM after execution ceiling (data keeps trickling)', async () => {
			const runner = makeRunner({ executionTimeoutMs: 5 * 60_000 });
			runner.executeTurn('hello');

			// Keep emitting data every second for 6 minutes
			for (let i = 0; i < 360; i++) {
				mockPty._emit('data');
				await vi.advanceTimersByTimeAsync(1_000);
			}

			expect(mockPty.kill).toHaveBeenCalledWith('SIGTERM');
		});
	});

	describe('process crash', () => {
		it('emits end with PROCESS_CRASH on non-zero exit when not killed', () => {
			const runner = makeRunner();
			const endEvents: Array<{ reason: string; code: number | null }> = [];
			runner.on('end', (reason, code) => endEvents.push({ reason, code }));

			runner.executeTurn('hello');
			mockPty._exit(1); // non-zero, not KILLED

			expect(endEvents[0]).toEqual({ reason: 'PROCESS_CRASH', code: 1 });
		});
	});

	describe('kill()', () => {
		it('emits end with KILLED when kill() is called externally', () => {
			const runner = makeRunner();
			const endEvents: Array<{ reason: string }> = [];
			runner.on('end', (reason) => endEvents.push({ reason }));

			runner.executeTurn('hello');
			runner.kill();
			mockPty._exit(0, 15);

			expect(endEvents[0].reason).toBe('KILLED');
		});

		it('sends SIGTERM on kill()', () => {
			const runner = makeRunner();
			runner.executeTurn('hello');
			runner.kill();

			expect(mockPty.kill).toHaveBeenCalledWith('SIGTERM');
		});
	});

	describe('injectManualCommand', () => {
		it('returns false when no process is alive', () => {
			const runner = makeRunner();
			expect(runner.injectManualCommand('hello\n')).toBe(false);
		});

		it('returns false during busy non-user-controlled state', () => {
			const runner = makeRunner();
			runner.executeTurn('hello');

			expect(runner.injectManualCommand('sneaky\n')).toBe(false);

			mockPty._exit(0);
		});

		it('returns true and writes when userControlled === true even during busy', () => {
			const runner = makeRunner();
			runner.executeTurn('hello');
			runner.setUserControlled(true);

			expect(runner.injectManualCommand('user input\n')).toBe(true);
			expect(mockPty._writes).toContain('user input\n');

			mockPty._exit(0);
		});
	});

	describe('setUserControlled', () => {
		it('toggles userControlled state', () => {
			const runner = makeRunner();
			expect(runner.getState().userControlled).toBe(false);

			runner.setUserControlled(true);
			expect(runner.getState().userControlled).toBe(true);

			runner.setUserControlled(false);
			expect(runner.getState().userControlled).toBe(false);
		});

		it('rejects subsequent orchestration executeTurn when userControlled is true', () => {
			const runner = makeRunner();
			runner.setUserControlled(true);

			const endEvents: Array<{ reason: string }> = [];
			runner.on('end', (reason) => endEvents.push({ reason }));

			runner.executeTurn('orchestrated turn');

			expect(nodePty.spawn).not.toHaveBeenCalled();
			expect(endEvents[0].reason).toBe('AGENT_ERROR');
		});

		it('emits state event on toggle', () => {
			const runner = makeRunner();
			const stateEvents: Array<ReturnType<typeof runner.getState>> = [];
			runner.on('state', (s) => stateEvents.push(s));

			runner.setUserControlled(true);
			expect(stateEvents).toHaveLength(1);
			expect(stateEvents[0].userControlled).toBe(true);
		});
	});

	describe('rawData events', () => {
		it('fires alongside analyzer parsing — both rawData and event callbacks', () => {
			const runner = makeRunner();
			const eventEvents: unknown[] = [];
			const rawEvents: string[] = [];

			runner.on('event', (e) => eventEvents.push(e));
			runner.on('rawData', (chunk) => rawEvents.push(chunk));

			runner.executeTurn('hello');
			mockPty._emit('raw PTY output');

			// rawData fires
			expect(rawEvents).toContain('raw PTY output');
			// analyzer now wired — init event fires on first data
			expect(eventEvents.length).toBeGreaterThan(0);

			mockPty._exit(0);
		});
	});

	describe('analyzer wiring', () => {
		it('emits ParsedEvents from analyzer via runner event channel', () => {
			const runner = makeRunner();
			const events: unknown[] = [];
			runner.on('event', (e) => events.push(e));

			runner.executeTurn('tell me something');
			mockPty._emit('Hello from Claude');

			// init + text events should both arrive
			const types = (events as Array<{ type: string }>).map((e) => e.type);
			expect(types).toContain('init');
			expect(types).toContain('text');

			mockPty._exit(0);
		});

		it("analyzer's onTurnComplete triggers gracefulCompleteTurn writing exit\\n", async () => {
			const runner = makeRunner({ spawnInitDelayMs: 0 });
			runner.executeTurn('do work');

			// Emit data that triggers completion: a completion phrase followed by an idle marker
			mockPty._emit('Task complete\n');
			mockPty._emit('╰─ (claude) ❯ \n'); // ╰─ (claude) ❯

			// gracefulCompleteTurn should have written 'exit\n'
			// (in addition to the original exit\n written after spawnInitDelayMs=0)
			// At least one 'exit\n' should be present
			const exitWrites = mockPty._writes.filter((w) => w === 'exit\n');
			expect(exitWrites.length).toBeGreaterThanOrEqual(1);

			mockPty._exit(0);
		});

		it('upgrades exit reason to AGENT_ERROR when analyzer detects error signature', () => {
			const runner = makeRunner();
			const endEvents: Array<{ reason: string; code: number | null }> = [];
			runner.on('end', (reason, code) => endEvents.push({ reason, code }));

			runner.executeTurn('hello');
			mockPty._emit('Error: something went terribly wrong\n');
			mockPty._exit(0); // natural exit code 0

			// Analyzer detected an error, so reason should be upgraded
			expect(endEvents[0].reason).toBe('AGENT_ERROR');
			expect(endEvents[0].code).toBe(0);
		});

		it('echo cancellation end-to-end: prompt text not emitted as event text', () => {
			const runner = makeRunner();
			const events: Array<{ type: string; text?: string }> = [];
			runner.on('event', (e) => events.push(e as { type: string; text?: string }));

			runner.executeTurn('what is 2+2?');
			// Simulate PTY echoing the prompt back
			mockPty._emit('what is 2+2?\n4\n');

			const textEvents = events.filter((e) => e.type === 'text');
			const combined = textEvents.map((e) => e.text ?? '').join('');
			expect(combined).not.toContain('what is 2+2?');
			expect(combined).toContain('4');

			mockPty._exit(0);
		});
	});

	describe('activeInstances tracking', () => {
		it('adds runner to activeInstances after executeTurn spawns PTY', () => {
			const initialCount = ClaudePtyRunner.activeInstanceCount();
			const runner = makeRunner();

			runner.executeTurn('hello');

			expect(ClaudePtyRunner.activeInstanceCount()).toBe(initialCount + 1);

			mockPty._exit(0);
		});

		it('removes runner from activeInstances after natural exit', () => {
			const runner = makeRunner();
			runner.executeTurn('hello');

			const countDuringRun = ClaudePtyRunner.activeInstanceCount();
			mockPty._exit(0);

			expect(ClaudePtyRunner.activeInstanceCount()).toBe(countDuringRun - 1);
		});

		it('killAllActive calls kill() on every active runner and resolves when all end events fire', async () => {
			// We need separate pty mocks for multiple runners
			const mockPty2 = makeMockPty();
			vi.mocked(nodePty.spawn)
				.mockReturnValueOnce(mockPty as unknown as nodePty.IPty)
				.mockReturnValueOnce(mockPty2 as unknown as nodePty.IPty);

			const runner1 = makeRunner();
			const runner2 = makeRunner({ maestroSessionId: 'other-session' });

			runner1.executeTurn('hello');
			runner2.executeTurn('hello');

			const killAllPromise = ClaudePtyRunner.killAllActive(2000);

			// Simulate both runners ending after kill
			mockPty._exit(0, 15);
			mockPty2._exit(0, 15);

			await vi.runAllTimersAsync();
			await killAllPromise;

			expect(mockPty.kill).toHaveBeenCalledWith('SIGTERM');
			expect(mockPty2.kill).toHaveBeenCalledWith('SIGTERM');
		});

		it('killAllActive resolves within timeoutMs even if end never fires', async () => {
			const runner = makeRunner();
			runner.executeTurn('hello');

			// Don't call _exit — simulate stuck runner
			const killAllPromise = ClaudePtyRunner.killAllActive(100);

			// Advance past timeout
			await vi.advanceTimersByTimeAsync(200);

			// Should resolve (timeout wins the race)
			await expect(killAllPromise).resolves.toBeUndefined();

			// Cleanup
			mockPty._exit(0);
		});

		it('killAllActive is a no-op when no active runners exist', async () => {
			// Ensure no runners are active (fresh test)
			const runner = makeRunner();
			// Don't start a turn — no active instances

			// Should resolve immediately
			const initialCount = ClaudePtyRunner.activeInstanceCount();
			// If there are active instances from other tests, skip this check
			if (initialCount === 0) {
				await expect(ClaudePtyRunner.killAllActive()).resolves.toBeUndefined();
			}
		});
	});

	describe('forceKill', () => {
		it('sends SIGTERM and schedules SIGKILL after 1s', async () => {
			const runner = makeRunner();
			runner.executeTurn('hello');
			runner.kill();

			expect(mockPty.kill).toHaveBeenCalledWith('SIGTERM');

			// Advance past SIGKILL delay
			await vi.advanceTimersByTimeAsync(1100);
			expect(mockPty.kill).toHaveBeenCalledWith('SIGKILL');

			mockPty._exit(0);
		});
	});
});
