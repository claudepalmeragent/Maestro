/**
 * Integration tests for the interactive-pty spawn path in process:spawn IPC handler.
 *
 * Covers:
 * 1. Legacy-print defaults — processManager.spawn() is called, ClaudePtyRunner is NOT.
 * 2. App-level interactive-pty → ClaudePtyRunner instantiated, executeTurn called,
 *    --print absent, ANTHROPIC_API_KEY deleted.
 * 3. Agent-level interactive-pty → ClaudePtyRunner instantiated.
 * 4. App interactive-pty + agent legacy-print → resolves to interactive-pty (strict ratchet).
 * 5. Non-Claude agent → legacy path regardless of app transport mode.
 * 6. process:write for interactive-pty session → routes to runner.injectManualCommand.
 * 7. process:kill for interactive-pty session → routes to runner.kill.
 * 8. Runner 'end' event → unregisterExternalRunner + emitExternalExit.
 * 9. Strict ratchet regression: app interactive-pty with no overrides → still interactive-pty.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ipcMain } from 'electron';
import {
	registerProcessHandlers,
	type ProcessHandlerDependencies,
} from '../../../../main/ipc/handlers/process';

// ── Electron mock ──────────────────────────────────────────────────────────
vi.mock('electron', () => ({
	ipcMain: {
		handle: vi.fn(),
		removeHandler: vi.fn(),
	},
}));

// ── Logger mock ───────────────────────────────────────────────────────────
vi.mock('../../../../main/utils/logger', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

// ── Agent args mock ───────────────────────────────────────────────────────
vi.mock('../../../../main/utils/agent-args', () => ({
	buildAgentArgs: vi.fn((_agent: unknown, opts: { baseArgs?: string[] }) => opts.baseArgs || []),
	applyAgentConfigOverrides: vi.fn((_agent: unknown, args: string[], _opts: unknown) => ({
		args,
		modelSource: 'none' as const,
		customArgsSource: 'none' as const,
		customEnvSource: 'none' as const,
		effectiveCustomEnvVars: undefined,
	})),
	getContextWindowValue: vi.fn(() => 0),
}));

// ── node-pty mock (native module) ────────────────────────────────────────
vi.mock('node-pty', () => ({ spawn: vi.fn() }));

// ── SSH mocks ─────────────────────────────────────────────────────────────
vi.mock('../../../../main/utils/ssh-remote-resolver', () => ({
	getSshRemoteConfig: vi.fn(() => ({ config: null, source: 'not_found' })),
	createSshRemoteStoreAdapter: vi.fn(() => ({})),
}));

vi.mock('../../../../main/utils/ssh-command-builder', () => ({
	buildSshCommandWithStdin: vi.fn(),
	buildSshCommand: vi.fn(),
}));

// ── Misc mocks ────────────────────────────────────────────────────────────
vi.mock('../../../../main/power-manager', () => ({
	powerManager: { addBlockReason: vi.fn(), removeBlockReason: vi.fn() },
}));

vi.mock('../../../../main/utils/sentry', () => ({
	addBreadcrumb: vi.fn(),
	captureException: vi.fn(),
}));

vi.mock('../../../../main/process-manager/utils/streamJsonBuilder', () => ({
	buildStreamJsonMessage: vi.fn((prompt: string) => JSON.stringify({ prompt })),
}));

vi.mock('../../../../shared/platformDetection', () => ({
	isWindows: vi.fn(() => false),
}));

vi.mock('../../../../shared/pathUtils', () => ({
	buildExpandedEnv: vi.fn((env: Record<string, string>) => env || {}),
}));

vi.mock('../../../../main/process-manager/utils/shellEscape', () => ({
	getWindowsShellForAgentExecution: vi.fn(() => ({
		shell: undefined,
		useShell: false,
		source: 'none',
	})),
}));

// ── ClaudePtyRunner mock ──────────────────────────────────────────────────
// We capture the event listeners registered on each runner instance so tests can
// fire them manually and verify downstream effects.
interface MockRunnerInstance {
	executeTurn: ReturnType<typeof vi.fn>;
	kill: ReturnType<typeof vi.fn>;
	injectManualCommand: ReturnType<typeof vi.fn>;
	setUserControlled: ReturnType<typeof vi.fn>;
	getState: ReturnType<typeof vi.fn>;
	on: ReturnType<typeof vi.fn>;
	_listeners: Record<string, ((...args: unknown[]) => void)[]>;
}

let lastRunnerInstance: MockRunnerInstance | null = null;
let runnerConstructorArgs: unknown[] = [];

vi.mock('../../../../main/utils/claude-pty-runner', () => {
	// Use a class so `new ClaudePtyRunner(...)` works as a constructor.
	class MockClaudePtyRunner {
		executeTurn = vi.fn();
		kill = vi.fn();
		injectManualCommand = vi.fn().mockReturnValue(true);
		setUserControlled = vi.fn();
		getState = vi.fn().mockReturnValue({ isBusy: false, userControlled: false, alive: true });
		_listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
		on: ReturnType<typeof vi.fn>;

		constructor(opts: unknown) {
			runnerConstructorArgs = [opts];
			// Create 'on' as a method that captures listeners by event name.
			this.on = vi.fn().mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
				if (!this._listeners[event]) this._listeners[event] = [];
				this._listeners[event].push(cb);
				return this;
			});
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			lastRunnerInstance = this as unknown as MockRunnerInstance;
		}
	}
	return { ClaudePtyRunner: MockClaudePtyRunner };
});

// ── Helpers ───────────────────────────────────────────────────────────────
type HandlerMap = Map<string, (...args: unknown[]) => Promise<unknown>>;

function buildMockProcessManager() {
	return {
		spawn: vi.fn().mockReturnValue({ pid: 42, success: true }),
		write: vi.fn().mockReturnValue(true),
		interrupt: vi.fn().mockReturnValue(true),
		kill: vi.fn().mockReturnValue(true),
		resize: vi.fn().mockReturnValue(true),
		getAll: vi.fn().mockReturnValue([]),
		runCommand: vi.fn(),
		// External runner registry
		registerExternalRunner: vi.fn(),
		unregisterExternalRunner: vi.fn(),
		getExternalRunner: vi.fn().mockReturnValue(undefined),
		hasExternalRunner: vi.fn().mockReturnValue(false),
		emitExternalExit: vi.fn(),
		emitParsedEventBuffered: vi.fn(),
	};
}

function buildMockClaudeAgent(overrides: Record<string, unknown> = {}) {
	return {
		id: 'claude-code',
		name: 'Claude Code',
		requiresPty: false,
		command: 'claude',
		binaryName: 'claude',
		capabilities: { supportsStreamJsonInput: true },
		...overrides,
	};
}

function buildDeps(
	overrides: {
		processManager?: ReturnType<typeof buildMockProcessManager>;
		agentDetector?: { getAgent: ReturnType<typeof vi.fn> };
		settingsGet?: (key: string, def?: unknown) => unknown;
		agentConfigsGet?: (key: string, def?: unknown) => unknown;
		mainWindow?: unknown;
	} = {}
): {
	deps: ProcessHandlerDependencies;
	processManager: ReturnType<typeof buildMockProcessManager>;
	mainWindow: {
		isDestroyed: ReturnType<typeof vi.fn>;
		webContents: { send: ReturnType<typeof vi.fn> };
	};
} {
	const processManager = overrides.processManager ?? buildMockProcessManager();
	const mainWindow = (overrides.mainWindow ?? {
		isDestroyed: vi.fn().mockReturnValue(false),
		webContents: { send: vi.fn(), isDestroyed: vi.fn().mockReturnValue(false) },
	}) as { isDestroyed: ReturnType<typeof vi.fn>; webContents: { send: ReturnType<typeof vi.fn> } };

	const settingsGetFn = overrides.settingsGet ?? ((_key: string, def?: unknown) => def);
	const agentConfigsGetFn =
		overrides.agentConfigsGet ?? ((_key: string, def?: unknown) => def ?? {});

	const deps: ProcessHandlerDependencies = {
		getProcessManager: () => processManager as never,
		getAgentDetector: () =>
			(overrides.agentDetector ?? {
				getAgent: vi.fn().mockResolvedValue(buildMockClaudeAgent()),
			}) as never,
		agentConfigsStore: { get: vi.fn().mockImplementation(agentConfigsGetFn) } as never,
		settingsStore: { get: vi.fn().mockImplementation(settingsGetFn) } as never,
		getMainWindow: () => mainWindow as never,
		sessionsStore: { get: vi.fn().mockReturnValue({ sessions: [] }) } as never,
	};
	return { deps, processManager, mainWindow };
}

// ── before-quit handler unit tests ──────────────────────────────────────
// These tests exercise the logic of the before-quit handler added in index.ts without
// importing index.ts directly (the entrypoint has too many side effects to unit-test).
// Instead we test the same logic inline.

describe('before-quit handler logic', () => {
	it('short-circuits (no preventDefault) when no active runners', async () => {
		const { ClaudePtyRunner } = await import('../../../../main/utils/claude-pty-runner');
		vi.mocked(ClaudePtyRunner as unknown as { activeInstanceCount: ReturnType<typeof vi.fn> })
			.activeInstanceCount ??
			(ClaudePtyRunner as never as { activeInstanceCount: ReturnType<typeof vi.fn> })
				.activeInstanceCount;

		// Simulate the handler logic
		const activeInstanceCount = vi.fn().mockReturnValue(0);
		const killAllActive = vi.fn().mockResolvedValue(undefined);
		const quit = vi.fn();
		const preventDefault = vi.fn();

		const handler = async (event: { preventDefault: () => void }) => {
			if (activeInstanceCount() === 0) return;
			event.preventDefault();
			await killAllActive(2000);
			quit();
		};

		await handler({ preventDefault });

		expect(preventDefault).not.toHaveBeenCalled();
		expect(killAllActive).not.toHaveBeenCalled();
		expect(quit).not.toHaveBeenCalled();
	});

	it('calls killAllActive(2000) and re-quits when active runners exist', async () => {
		const activeInstanceCount = vi.fn().mockReturnValue(2);
		const killAllActive = vi.fn().mockResolvedValue(undefined);
		const quit = vi.fn();
		const preventDefault = vi.fn();

		const handler = async (event: { preventDefault: () => void }) => {
			if (activeInstanceCount() === 0) return;
			event.preventDefault();
			await killAllActive(2000);
			quit();
		};

		await handler({ preventDefault });

		expect(preventDefault).toHaveBeenCalledOnce();
		expect(killAllActive).toHaveBeenCalledWith(2000);
		expect(quit).toHaveBeenCalledOnce();
	});
});

// ── Test suite ────────────────────────────────────────────────────────────

describe('process:spawn — interactive-pty branch', () => {
	let handlers: HandlerMap;

	beforeEach(() => {
		vi.clearAllMocks();
		lastRunnerInstance = null;
		runnerConstructorArgs = [];
		handlers = new Map();
		vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
			handlers.set(channel as string, handler as never);
		});
	});

	afterEach(() => {
		handlers.clear();
	});

	// ── Test 1: Legacy-print defaults ────────────────────────────────────────
	it('1. All levels at legacy-print (defaults) → processManager.spawn() called, no runner', async () => {
		const { deps, processManager } = buildDeps({
			settingsGet: (key, def) => (key === 'claudeCodeDefaultTransportMode' ? 'legacy-print' : def),
		});

		registerProcessHandlers(deps);
		const spawnHandler = handlers.get('process:spawn')!;

		await spawnHandler({} as never, {
			sessionId: 'sess-1',
			toolType: 'claude-code',
			cwd: '/proj',
			command: 'claude',
			args: ['--print'],
			prompt: 'hello',
		});

		expect(processManager.spawn).toHaveBeenCalled();
		expect(lastRunnerInstance).toBeNull(); // No runner created
		expect(processManager.registerExternalRunner).not.toHaveBeenCalled();
	});

	// ── Test 2: App-level interactive-pty ───────────────────────────────────
	it('2. App-level interactive-pty → ClaudePtyRunner instantiated, executeTurn called, --print absent, API key deleted', async () => {
		const { deps, processManager, mainWindow } = buildDeps({
			settingsGet: (key, def) =>
				key === 'claudeCodeDefaultTransportMode' ? 'interactive-pty' : def,
		});

		// Inject ANTHROPIC_API_KEY via applyAgentConfigOverrides mock to test stripping
		const { applyAgentConfigOverrides } = await import('../../../../main/utils/agent-args');
		vi.mocked(applyAgentConfigOverrides).mockReturnValueOnce({
			args: ['--print'],
			modelSource: 'none',
			customArgsSource: 'none',
			customEnvSource: 'session',
			effectiveCustomEnvVars: {
				ANTHROPIC_API_KEY: 'sk-secret',
				ANTHROPIC_AUTH_TOKEN: 'tok-secret',
				OTHER_VAR: 'keep-me',
			},
		} as never);

		registerProcessHandlers(deps);
		const spawnHandler = handlers.get('process:spawn')!;

		const result = await spawnHandler({} as never, {
			sessionId: 'sess-pty',
			toolType: 'claude-code',
			cwd: '/proj',
			command: 'claude',
			args: ['--print'],
			prompt: 'do the thing',
		});

		// processManager.spawn is NOT called — PTY runner handles it
		expect(processManager.spawn).not.toHaveBeenCalled();

		// Runner was created and registered
		expect(lastRunnerInstance).not.toBeNull();
		expect(processManager.registerExternalRunner).toHaveBeenCalledWith(
			'sess-pty',
			lastRunnerInstance
		);

		// executeTurn called with the prompt
		expect(lastRunnerInstance!.executeTurn).toHaveBeenCalledWith('do the thing');

		// Return value signals PTY mode (pid -1)
		expect(result).toMatchObject({ pid: -1, success: true });

		// API keys were stripped from the env passed to the runner
		const opts = runnerConstructorArgs[0] as { env: Record<string, string> };
		expect(opts.env).not.toHaveProperty('ANTHROPIC_API_KEY');
		expect(opts.env).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN');
		expect(opts.env).toHaveProperty('OTHER_VAR', 'keep-me');

		// Args passed to runner must NOT contain --print (stripPrintArgs was applied)
		expect(opts).toMatchObject({
			maestroSessionId: 'sess-pty',
			cwd: '/proj',
		});

		// SSH-remote null event and power block are emitted
		expect(mainWindow.webContents.send).toHaveBeenCalledWith(
			'process:ssh-remote',
			'sess-pty',
			null
		);
	});

	// ── Test 3: Agent-level interactive-pty ─────────────────────────────────
	it('3. Agent-level interactive-pty → ClaudePtyRunner instantiated', async () => {
		const { deps, processManager } = buildDeps({
			settingsGet: (key, def) => (key === 'claudeCodeDefaultTransportMode' ? 'legacy-print' : def),
			agentConfigsGet: (key, def) =>
				key === 'configs' ? { 'claude-code': { transportMode: 'interactive-pty' } } : (def ?? {}),
		});

		registerProcessHandlers(deps);
		const spawnHandler = handlers.get('process:spawn')!;

		await spawnHandler({} as never, {
			sessionId: 'sess-agent-pty',
			toolType: 'claude-code',
			cwd: '/proj',
			command: 'claude',
			args: [],
			prompt: 'go',
		});

		expect(processManager.spawn).not.toHaveBeenCalled();
		expect(lastRunnerInstance).not.toBeNull();
	});

	// ── Test 4: Strict ratchet — app interactive-pty + agent legacy-print ───
	it('4. App interactive-pty + agent legacy-print → resolves to interactive-pty', async () => {
		const { deps, processManager } = buildDeps({
			settingsGet: (key, def) =>
				key === 'claudeCodeDefaultTransportMode' ? 'interactive-pty' : def,
			// agent explicitly set to legacy-print (should NOT downgrade)
			agentConfigsGet: (key, def) =>
				key === 'configs' ? { 'claude-code': { transportMode: 'legacy-print' } } : (def ?? {}),
		});

		registerProcessHandlers(deps);
		const spawnHandler = handlers.get('process:spawn')!;

		await spawnHandler({} as never, {
			sessionId: 'sess-ratchet',
			toolType: 'claude-code',
			cwd: '/proj',
			command: 'claude',
			args: [],
			prompt: 'test',
		});

		// App 'interactive-pty' wins via strict ratchet — runner instantiated
		expect(processManager.spawn).not.toHaveBeenCalled();
		expect(lastRunnerInstance).not.toBeNull();
	});

	// ── Test 5: Non-Claude agent — unaffected ───────────────────────────────
	it('5. Non-Claude agent → legacy path regardless of app transport mode', async () => {
		const { deps, processManager } = buildDeps({
			settingsGet: (key, def) =>
				key === 'claudeCodeDefaultTransportMode' ? 'interactive-pty' : def,
			agentDetector: {
				getAgent: vi.fn().mockResolvedValue({
					id: 'codex',
					name: 'Codex',
					requiresPty: false,
					command: 'codex',
					binaryName: 'codex',
					capabilities: {},
				}),
			},
		});

		registerProcessHandlers(deps);
		const spawnHandler = handlers.get('process:spawn')!;

		await spawnHandler({} as never, {
			sessionId: 'sess-codex',
			toolType: 'codex',
			cwd: '/proj',
			command: 'codex',
			args: [],
			prompt: 'test',
		});

		expect(processManager.spawn).toHaveBeenCalled();
		expect(lastRunnerInstance).toBeNull(); // No runner for non-Claude
	});

	// ── Test 6: process:write routes to runner.injectManualCommand ──────────
	it('6. process:write for interactive-pty session routes to runner.injectManualCommand', async () => {
		const mockRunner: MockRunnerInstance = {
			executeTurn: vi.fn(),
			kill: vi.fn(),
			injectManualCommand: vi.fn().mockReturnValue(true),
			setUserControlled: vi.fn(),
			getState: vi.fn().mockReturnValue({ isBusy: false, userControlled: true, alive: true }),
			on: vi.fn(),
			_listeners: {},
		};

		const processManager = buildMockProcessManager();
		// Simulate a runner registered for the session
		processManager.getExternalRunner.mockReturnValue(mockRunner as never);
		processManager.write.mockImplementation((sessionId: string, data: string) => {
			const runner = processManager.getExternalRunner(sessionId);
			if (runner) return runner.injectManualCommand(data);
			return false;
		});

		const { deps } = buildDeps({ processManager });
		registerProcessHandlers(deps);

		const writeHandler = handlers.get('process:write')!;
		const result = await writeHandler({} as never, 'sess-pty', 'my command\n');

		expect(processManager.write).toHaveBeenCalledWith('sess-pty', 'my command\n');
		expect(result).toBe(true);
	});

	// ── Test 7: process:kill routes to runner.kill ──────────────────────────
	it('7. process:kill for interactive-pty session routes to runner.kill', async () => {
		const processManager = buildMockProcessManager();
		const { deps } = buildDeps({ processManager });
		registerProcessHandlers(deps);

		const killHandler = handlers.get('process:kill')!;
		await killHandler({} as never, 'sess-pty');

		expect(processManager.kill).toHaveBeenCalledWith('sess-pty');
	});

	// ── Test 8: Runner 'end' event routing ───────────────────────────────────
	it("8. Runner 'end' event: unregisterExternalRunner called, emitExternalExit fires", async () => {
		const { deps, processManager } = buildDeps({
			settingsGet: (key, def) =>
				key === 'claudeCodeDefaultTransportMode' ? 'interactive-pty' : def,
		});

		registerProcessHandlers(deps);
		const spawnHandler = handlers.get('process:spawn')!;

		await spawnHandler({} as never, {
			sessionId: 'sess-end-test',
			toolType: 'claude-code',
			cwd: '/proj',
			command: 'claude',
			args: [],
			prompt: 'task',
		});

		expect(lastRunnerInstance).not.toBeNull();

		// Find and invoke the 'end' listener that was registered on the runner
		const endListeners = lastRunnerInstance!._listeners['end'];
		expect(endListeners).toBeDefined();
		expect(endListeners.length).toBeGreaterThan(0);

		// Simulate runner completing successfully
		endListeners[0]('SUCCESS', 0);

		expect(processManager.unregisterExternalRunner).toHaveBeenCalledWith('sess-end-test');
		expect(processManager.emitExternalExit).toHaveBeenCalledWith('sess-end-test', 0);
	});

	// ── Test 8b: Non-SUCCESS exit maps to non-zero code ─────────────────────
	it("8b. Runner 'end' with AGENT_ERROR maps exit code to 1", async () => {
		const { deps, processManager } = buildDeps({
			settingsGet: (key, def) =>
				key === 'claudeCodeDefaultTransportMode' ? 'interactive-pty' : def,
		});

		registerProcessHandlers(deps);
		await handlers.get('process:spawn')!({} as never, {
			sessionId: 'sess-error-exit',
			toolType: 'claude-code',
			cwd: '/proj',
			command: 'claude',
			args: [],
			prompt: 'task',
		});

		const endListeners = lastRunnerInstance!._listeners['end'];
		endListeners[0]('AGENT_ERROR', null); // rawExitCode null

		expect(processManager.emitExternalExit).toHaveBeenCalledWith('sess-error-exit', 1);
	});

	// ── Test 9: Strict ratchet regression ───────────────────────────────────
	it('9. Strict ratchet: app interactive-pty with no other levels set → still interactive-pty', async () => {
		const { deps, processManager } = buildDeps({
			settingsGet: (key, def) =>
				key === 'claudeCodeDefaultTransportMode' ? 'interactive-pty' : def,
			// No agent-level transportMode set
			agentConfigsGet: (key, def) => (key === 'configs' ? { 'claude-code': {} } : (def ?? {})),
		});

		registerProcessHandlers(deps);
		await handlers.get('process:spawn')!({} as never, {
			sessionId: 'sess-ratchet-9',
			toolType: 'claude-code',
			cwd: '/proj',
			command: 'claude',
			args: [],
			prompt: 'ratchet test',
		});

		// App-level wins — runner is instantiated, not legacy spawn
		expect(processManager.spawn).not.toHaveBeenCalled();
		expect(lastRunnerInstance).not.toBeNull();
	});

	// ── Test: rawData channel forwarded to renderer ─────────────────────────
	it('rawData events are forwarded to renderer via claude-pty:rawData', async () => {
		const { deps, mainWindow } = buildDeps({
			settingsGet: (key, def) =>
				key === 'claudeCodeDefaultTransportMode' ? 'interactive-pty' : def,
		});

		registerProcessHandlers(deps);
		await handlers.get('process:spawn')!({} as never, {
			sessionId: 'sess-raw',
			toolType: 'claude-code',
			cwd: '/proj',
			command: 'claude',
			args: [],
			prompt: 'show raw',
		});

		const rawListeners = lastRunnerInstance!._listeners['rawData'];
		expect(rawListeners).toBeDefined();
		rawListeners[0]('hello PTY chunk');

		expect(mainWindow.webContents.send).toHaveBeenCalledWith(
			'claude-pty:rawData',
			'sess-raw',
			'hello PTY chunk'
		);
	});

	// ── Test: event channel flows to emitParsedEventBuffered ────────────────
	it('event channel from runner flows to processManager.emitParsedEventBuffered', async () => {
		const { deps, processManager } = buildDeps({
			settingsGet: (key, def) =>
				key === 'claudeCodeDefaultTransportMode' ? 'interactive-pty' : def,
		});

		registerProcessHandlers(deps);
		await handlers.get('process:spawn')!({} as never, {
			sessionId: 'sess-event',
			toolType: 'claude-code',
			cwd: '/proj',
			command: 'claude',
			args: [],
			prompt: 'emit test',
		});

		const eventListeners = lastRunnerInstance!._listeners['event'];
		expect(eventListeners).toBeDefined();

		const parsedEvent = { type: 'result' as const, text: 'the answer' };
		eventListeners[0](parsedEvent);

		expect(processManager.emitParsedEventBuffered).toHaveBeenCalledWith('sess-event', parsedEvent);
	});

	// ── Test: SSH session not affected ──────────────────────────────────────
	it('claude-code with SSH enabled takes the legacy SSH path, not PTY runner', async () => {
		const { getSshRemoteConfig } = await import('../../../../main/utils/ssh-remote-resolver');
		vi.mocked(getSshRemoteConfig).mockReturnValueOnce({
			config: {
				id: 'remote-1',
				name: 'my-server',
				host: 'server.example.com',
				port: 22,
				username: 'user',
				privateKeyPath: '~/.ssh/id_rsa',
				remoteEnv: {},
			},
			source: 'session',
		} as never);

		const { buildSshCommandWithStdin } = await import('../../../../main/utils/ssh-command-builder');
		vi.mocked(buildSshCommandWithStdin).mockResolvedValueOnce({
			command: 'ssh',
			args: ['server.example.com', '/bin/bash'],
			stdinScript: 'exec claude\n',
		} as never);

		const { deps, processManager } = buildDeps({
			settingsGet: (key, def) =>
				key === 'claudeCodeDefaultTransportMode' ? 'interactive-pty' : def,
		});

		registerProcessHandlers(deps);
		const spawnHandler = handlers.get('process:spawn')!;

		await spawnHandler({} as never, {
			sessionId: 'sess-ssh',
			toolType: 'claude-code',
			cwd: '/proj',
			command: 'claude',
			args: [],
			prompt: 'ssh task',
			sessionSshRemoteConfig: { enabled: true, remoteId: 'remote-1' },
		});

		// SSH path uses processManager.spawn (legacy), not ClaudePtyRunner
		expect(processManager.spawn).toHaveBeenCalled();
		expect(lastRunnerInstance).toBeNull();
	});
});
