/**
 * Integration tests — ClaudePtyRunner dual-mode dispatch (ARD 8, 12 cases).
 *
 * Local Electron path (1–6): exercises process:spawn IPC handler and the
 * resolveClaudeTransportMode cascade helper.
 * SSH path (7–9): exercises the SSH branch of process:spawn.
 * CLI path (10–12): exercises spawnClaudeAgent in agent-spawner.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { ipcMain } from 'electron';

// ── Electron mock ────────────────────────────────────────────────────────────
vi.mock('electron', () => ({
	ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}));

vi.mock('../../main/utils/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../main/utils/agent-args', () => ({
	buildAgentArgs: vi.fn((_a: unknown, opts: { baseArgs?: string[] }) => opts.baseArgs || []),
	applyAgentConfigOverrides: vi.fn((_a: unknown, args: string[], _o: unknown) => ({
		args,
		modelSource: 'none' as const,
		customArgsSource: 'none' as const,
		customEnvSource: 'none' as const,
		effectiveCustomEnvVars: undefined,
	})),
	getContextWindowValue: vi.fn(() => 0),
}));

vi.mock('node-pty', () => ({ spawn: vi.fn() }));

vi.mock('../../main/utils/ssh-remote-resolver', () => ({
	getSshRemoteConfig: vi.fn(() => ({ config: null, source: 'not_found' })),
	createSshRemoteStoreAdapter: vi.fn(() => ({})),
}));

vi.mock('../../main/utils/ssh-command-builder', () => ({
	buildSshCommandWithStdin: vi.fn().mockReturnValue({
		command: 'ssh',
		args: ['-o', 'ControlMaster=auto', 'user@ssh-server', '/bin/bash'],
		stdinScript: '#!/bin/bash\nexec claude --print',
	}),
	buildSshCommand: vi.fn().mockReturnValue({ command: 'ssh', args: ['user@ssh-server', 'claude'] }),
	buildSshClaudeInteractiveArgs: vi
		.fn()
		.mockResolvedValue([
			'-tt',
			'-o',
			'RequestTTY=force',
			'user@ssh-server',
			'exec claude --verbose',
		]),
}));

vi.mock('../../main/power-manager', () => ({
	powerManager: { addBlockReason: vi.fn(), removeBlockReason: vi.fn() },
}));

vi.mock('../../main/utils/sentry', () => ({
	addBreadcrumb: vi.fn(),
	captureException: vi.fn(),
}));

vi.mock('../../main/process-manager/utils/streamJsonBuilder', () => ({
	buildStreamJsonMessage: vi.fn((p: string) => JSON.stringify({ prompt: p })),
}));

vi.mock('../../shared/platformDetection', () => ({ isWindows: vi.fn(() => false) }));

vi.mock('../../shared/pathUtils', () => ({
	buildExpandedEnv: vi.fn((env?: Record<string, string>) => env ?? {}),
	buildExpandedPath: vi.fn(() => '/usr/bin'),
}));

vi.mock('../../main/process-manager/utils/shellEscape', () => ({
	getWindowsShellForAgentExecution: vi.fn(() => ({
		shell: undefined,
		useShell: false,
		source: 'none',
	})),
}));

// ── ClaudePtyRunner mock ─────────────────────────────────────────────────────
interface MockRunner {
	executeTurn: ReturnType<typeof vi.fn>;
	kill: ReturnType<typeof vi.fn>;
	injectManualCommand: ReturnType<typeof vi.fn>;
	setUserControlled: ReturnType<typeof vi.fn>;
	getState: ReturnType<typeof vi.fn>;
	on: ReturnType<typeof vi.fn>;
	_listeners: Record<string, ((...args: unknown[]) => void)[]>;
	_opts: unknown;
}

let lastRunner: MockRunner | null = null;
let runnerOpts: unknown = null;

// ClaudePtyRunner mock — using vi.fn() so mockImplementationOnce works for the throw case.
function makeMockRunnerInstance(opts: unknown): MockRunner {
	const _listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
	const instance: MockRunner = {
		executeTurn: vi.fn(),
		kill: vi.fn(),
		injectManualCommand: vi.fn().mockReturnValue(true),
		setUserControlled: vi.fn(),
		getState: vi.fn().mockReturnValue({ isBusy: false, userControlled: false, alive: true }),
		_listeners,
		_opts: opts,
		on: vi.fn().mockImplementation((ev: string, cb: (...a: unknown[]) => void) => {
			if (!_listeners[ev]) _listeners[ev] = [];
			_listeners[ev].push(cb);
			return instance;
		}),
	};
	runnerOpts = opts;
	lastRunner = instance;
	return instance;
}

vi.mock('../../main/utils/claude-pty-runner', () => {
	const ctor = vi.fn().mockImplementation(makeMockRunnerInstance);
	return { ClaudePtyRunner: ctor };
});

// ── CLI spawner mocks ────────────────────────────────────────────────────────
const mockSpawn = vi.fn();
const mockStdin = { end: vi.fn() };
const mockStdout = new EventEmitter();
const mockStderr = new EventEmitter();
const mockChild = Object.assign(new EventEmitter(), {
	stdin: mockStdin,
	stdout: mockStdout,
	stderr: mockStderr,
});

vi.mock('child_process', async (importOriginal) => {
	const actual = await importOriginal<typeof import('child_process')>();
	const overridden = { ...actual, spawn: (...args: unknown[]) => mockSpawn(...args) };
	return { ...overridden, default: overridden };
});

vi.mock('../../cli/services/storage', () => ({ getAgentCustomPath: vi.fn() }));

vi.mock('../../cli/services/settings-reader', () => ({
	readClaudeCodeDefaultTransportModeFromSettings: vi.fn().mockReturnValue(undefined),
}));

vi.mock('fs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('fs')>();
	return {
		...actual,
		readFileSync: vi.fn(),
		writeFileSync: vi.fn(),
		promises: { stat: vi.fn(), access: vi.fn() },
		constants: { X_OK: 1 },
	};
});

vi.mock('os', () => ({
	homedir: vi.fn(() => '/home/test'),
	default: { homedir: vi.fn(() => '/home/test') },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────
type HandlerMap = Map<string, (...args: unknown[]) => Promise<unknown>>;

function buildPM() {
	return {
		spawn: vi.fn().mockReturnValue({ pid: 42, success: true }),
		write: vi.fn().mockReturnValue(true),
		interrupt: vi.fn().mockReturnValue(true),
		kill: vi.fn().mockReturnValue(true),
		resize: vi.fn().mockReturnValue(true),
		getAll: vi.fn().mockReturnValue([]),
		runCommand: vi.fn(),
		registerExternalRunner: vi.fn(),
		unregisterExternalRunner: vi.fn(),
		getExternalRunner: vi.fn().mockReturnValue(undefined),
		hasExternalRunner: vi.fn().mockReturnValue(false),
		emitExternalExit: vi.fn(),
		emitParsedEventBuffered: vi.fn(),
	};
}

function buildDeps(
	settingsGet?: (k: string, d?: unknown) => unknown,
	agentCfgGet?: (k: string, d?: unknown) => unknown
) {
	const pm = buildPM();
	const mainWindow = {
		isDestroyed: vi.fn().mockReturnValue(false),
		webContents: { send: vi.fn(), isDestroyed: vi.fn().mockReturnValue(false) },
	};
	const { deps } = (() => {
		const d = {
			getProcessManager: () => pm as never,
			getAgentDetector: () =>
				({
					getAgent: vi
						.fn()
						.mockResolvedValue({
							id: 'claude-code',
							name: 'Claude',
							requiresPty: false,
							command: 'claude',
							binaryName: 'claude',
							capabilities: { supportsStreamJsonInput: true },
						}),
				}) as never,
			agentConfigsStore: {
				get: vi.fn().mockImplementation(agentCfgGet ?? ((_k: string, def?: unknown) => def ?? {})),
			} as never,
			settingsStore: {
				get: vi.fn().mockImplementation(settingsGet ?? ((_k: string, def?: unknown) => def)),
			} as never,
			getMainWindow: () => mainWindow as never,
			sessionsStore: { get: vi.fn().mockReturnValue({ sessions: [] }) } as never,
		};
		return { deps: d };
	})();
	return { deps, pm, mainWindow };
}

async function registerAndGetSpawnHandler(deps: ReturnType<typeof buildDeps>['deps']) {
	const { registerProcessHandlers } = await import('../../main/ipc/handlers/process');
	const handlers: HandlerMap = new Map();
	vi.mocked(ipcMain.handle).mockImplementation((ch, fn) => {
		handlers.set(ch as string, fn as never);
	});
	registerProcessHandlers(deps);
	return handlers.get('process:spawn')!;
}

const BASE_SPAWN_PAYLOAD = {
	sessionId: 'sess-1',
	toolType: 'claude-code' as const,
	cwd: '/proj',
	command: 'claude',
	args: [
		'--print',
		'--verbose',
		'--output-format',
		'stream-json',
		'--dangerously-skip-permissions',
	],
	prompt: 'hello',
};

// ════════════════════════════════════════════════════════════════════════════
// LOCAL ELECTRON PATH
// ════════════════════════════════════════════════════════════════════════════

describe('Local Electron path', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		lastRunner = null;
		runnerOpts = null;
	});

	// ── Case 1: All 4 levels at legacy-print ───────────────────────────────
	it('1. All 4 levels at legacy-print → processManager.spawn called, args include --print, no runner', async () => {
		const { deps, pm } = buildDeps((k, d) =>
			k === 'claudeCodeDefaultTransportMode' ? 'legacy-print' : d
		);
		const spawnHandler = await registerAndGetSpawnHandler(deps);

		await spawnHandler({} as never, { ...BASE_SPAWN_PAYLOAD });

		expect(pm.spawn).toHaveBeenCalled();
		const spawnArg = pm.spawn.mock.calls[0][0] as { args: string[] };
		expect(spawnArg.args).toContain('--print');
		expect(lastRunner).toBeNull();
		expect(pm.registerExternalRunner).not.toHaveBeenCalled();
	});

	// ── Case 2: Global default interactive-pty ────────────────────────────
	it('2. Global default interactive-pty → ClaudePtyRunner instantiated, executeTurn called, API key stripped', async () => {
		const { applyAgentConfigOverrides } = await import('../../main/utils/agent-args');
		vi.mocked(applyAgentConfigOverrides).mockReturnValueOnce({
			args: ['--print'],
			modelSource: 'none',
			customArgsSource: 'none',
			customEnvSource: 'session',
			effectiveCustomEnvVars: { ANTHROPIC_API_KEY: 'sk-secret', OTHER: 'keep' },
		} as never);

		const { deps, pm } = buildDeps((k, d) =>
			k === 'claudeCodeDefaultTransportMode' ? 'interactive-pty' : d
		);
		const spawnHandler = await registerAndGetSpawnHandler(deps);

		const result = await spawnHandler({} as never, {
			...BASE_SPAWN_PAYLOAD,
			sessionId: 'sess-pty',
		});

		expect(result).toEqual({ pid: -1, success: true });
		expect(pm.spawn).not.toHaveBeenCalled();
		expect(lastRunner).not.toBeNull();
		expect(lastRunner!.executeTurn).toHaveBeenCalledWith('hello');
		const opts = runnerOpts as { env: Record<string, string>; claudeBaseArgs: string[] };
		expect(opts.env).not.toHaveProperty('ANTHROPIC_API_KEY');
		expect(opts.env).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN');
		expect(opts.claudeBaseArgs).not.toContain('--print');
	});

	// ── Case 3: Strict ratchet — project interactive-pty + tab legacy-print ─
	it('3. Strict ratchet: project interactive-pty + tab legacy-print → resolves to interactive-pty', async () => {
		const { resolveClaudeTransportMode } = await import('../../main/utils/claude-pty-helpers');

		const result = resolveClaudeTransportMode(
			{ transportMode: 'legacy-print' }, // tab tries to demote
			undefined,
			{ transportMode: 'interactive-pty' }, // project forces up
			{ claudeCodeDefaultTransportMode: 'legacy-print' }
		);

		expect(result).toBe('interactive-pty');
	});

	// ── Case 4: Strict ratchet — app interactive-pty + agent legacy-print ──
	it('4. Strict ratchet: app interactive-pty + agent legacy-print → resolves to interactive-pty', async () => {
		const { deps, pm } = buildDeps(
			(k, d) => (k === 'claudeCodeDefaultTransportMode' ? 'interactive-pty' : d),
			(k, d) => (k === 'claude-code' ? { transportMode: 'legacy-print' } : (d ?? {}))
		);
		const spawnHandler = await registerAndGetSpawnHandler(deps);

		await spawnHandler({} as never, { ...BASE_SPAWN_PAYLOAD });

		expect(pm.spawn).not.toHaveBeenCalled();
		expect(lastRunner).not.toBeNull(); // interactive-pty wins
	});

	// ── Case 5: Mixed billing ─────────────────────────────────────────────
	it('5. Mixed billing: project A interactive-pty (env stripped), project B legacy-print (API key preserved)', async () => {
		const { applyAgentConfigOverrides } = await import('../../main/utils/agent-args');

		// Project A: interactive-pty, has API key that should be stripped
		const { deps: depsA, pm: pmA } = buildDeps((k, d) =>
			k === 'claudeCodeDefaultTransportMode' ? 'interactive-pty' : d
		);
		vi.mocked(applyAgentConfigOverrides).mockReturnValueOnce({
			args: ['--print'],
			modelSource: 'none',
			customArgsSource: 'none',
			customEnvSource: 'session',
			effectiveCustomEnvVars: { ANTHROPIC_API_KEY: 'sk-project-a' },
		} as never);

		const spawnA = await registerAndGetSpawnHandler(depsA);
		await spawnA({} as never, { ...BASE_SPAWN_PAYLOAD, sessionId: 'sess-a' });
		expect(pmA.spawn).not.toHaveBeenCalled(); // interactive-pty path
		const optsA = runnerOpts as { env: Record<string, string> };
		expect(optsA.env).not.toHaveProperty('ANTHROPIC_API_KEY'); // stripped

		vi.clearAllMocks();
		lastRunner = null;

		// Project B: legacy-print, has API key that should NOT be stripped
		const { deps: depsB, pm: pmB } = buildDeps((k, d) =>
			k === 'claudeCodeDefaultTransportMode' ? 'legacy-print' : d
		);
		vi.mocked(applyAgentConfigOverrides).mockReturnValueOnce({
			args: ['--print'],
			modelSource: 'none',
			customArgsSource: 'none',
			customEnvSource: 'session',
			effectiveCustomEnvVars: { ANTHROPIC_API_KEY: 'sk-project-b' },
		} as never);

		const spawnB = await registerAndGetSpawnHandler(depsB);
		await spawnB({} as never, { ...BASE_SPAWN_PAYLOAD, sessionId: 'sess-b' });
		expect(pmB.spawn).toHaveBeenCalled(); // legacy path
		expect(lastRunner).toBeNull(); // no runner for legacy
	});

	// ── Case 6: Non-Claude agent (Codex) ─────────────────────────────────
	it('6. Non-Claude agent (Codex) → processManager.spawn always called, no runner', async () => {
		const { deps, pm } = buildDeps((k, d) =>
			k === 'claudeCodeDefaultTransportMode' ? 'interactive-pty' : d
		);

		// Override agent detector to return codex
		const detector = {
			getAgent: vi.fn().mockResolvedValue({
				id: 'codex',
				name: 'Codex',
				requiresPty: false,
				command: 'codex',
				binaryName: 'codex',
				capabilities: { supportsStreamJsonInput: false },
			}),
		};
		(deps as { getAgentDetector: unknown }).getAgentDetector = () => detector as never;

		const spawnHandler = await registerAndGetSpawnHandler(deps);

		await spawnHandler({} as never, {
			...BASE_SPAWN_PAYLOAD,
			toolType: 'codex' as never,
			command: 'codex',
		});

		expect(pm.spawn).toHaveBeenCalled();
		expect(lastRunner).toBeNull();
	});
});

// ════════════════════════════════════════════════════════════════════════════
// SSH PATH
// ════════════════════════════════════════════════════════════════════════════

describe('SSH path', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		lastRunner = null;
	});

	// ── Case 7: SSH legacy-print ──────────────────────────────────────────
	it('7. SSH legacy-print → processManager.spawn with SSH args, no runner', async () => {
		const { getSshRemoteConfig } = await import('../../main/utils/ssh-remote-resolver');
		vi.mocked(getSshRemoteConfig).mockReturnValueOnce({
			config: {
				id: 'srv',
				name: 'srv',
				host: 'ssh-server',
				port: 22,
				username: 'user',
				privateKeyPath: '',
				enabled: true,
			},
			source: 'session',
		} as never);

		const { deps, pm } = buildDeps((k, d) =>
			k === 'claudeCodeDefaultTransportMode' ? 'legacy-print' : d
		);
		const spawnHandler = await registerAndGetSpawnHandler(deps);

		await spawnHandler({} as never, {
			...BASE_SPAWN_PAYLOAD,
			sessionSshRemoteConfig: { enabled: true, remoteId: 'srv' },
		});

		expect(pm.spawn).toHaveBeenCalled();
		expect(lastRunner).toBeNull();
	});

	// ── Case 8: SSH interactive-pty ───────────────────────────────────────
	it('8. SSH interactive-pty → ClaudePtyRunner with claudeBinary=ssh, -tt in args, no --print', async () => {
		const { getSshRemoteConfig } = await import('../../main/utils/ssh-remote-resolver');
		vi.mocked(getSshRemoteConfig).mockReturnValueOnce({
			config: {
				id: 'srv',
				name: 'srv',
				host: 'ssh-server',
				port: 22,
				username: 'user',
				privateKeyPath: '',
				enabled: true,
			},
			source: 'session',
		} as never);

		const { deps, pm } = buildDeps((k, d) =>
			k === 'claudeCodeDefaultTransportMode' ? 'interactive-pty' : d
		);
		const spawnHandler = await registerAndGetSpawnHandler(deps);

		const result = await spawnHandler({} as never, {
			...BASE_SPAWN_PAYLOAD,
			sessionSshRemoteConfig: { enabled: true, remoteId: 'srv' },
		});

		expect(result).toEqual({ pid: -1, success: true });
		expect(pm.spawn).not.toHaveBeenCalled();
		expect(lastRunner).not.toBeNull();
		const opts = runnerOpts as { claudeBinary: string; claudeBaseArgs: string[] };
		expect(opts.claudeBinary).toBe('ssh');
		expect(opts.claudeBaseArgs).toContain('-tt');
		expect(opts.claudeBaseArgs).not.toContain('--print');
	});

	// ── Case 9: SSH transport undefined → global default ─────────────────
	it('9. SSH transport undefined → falls back to global default (legacy-print)', async () => {
		const { getSshRemoteConfig } = await import('../../main/utils/ssh-remote-resolver');
		vi.mocked(getSshRemoteConfig).mockReturnValueOnce({
			config: {
				id: 'srv',
				name: 'srv',
				host: 'ssh-server',
				port: 22,
				username: 'user',
				privateKeyPath: '',
				enabled: true,
			},
			source: 'session',
		} as never);

		// No agent-level transportMode override; global default is legacy-print
		const { deps, pm } = buildDeps((k, d) =>
			k === 'claudeCodeDefaultTransportMode' ? 'legacy-print' : d
		);
		const spawnHandler = await registerAndGetSpawnHandler(deps);

		await spawnHandler({} as never, {
			...BASE_SPAWN_PAYLOAD,
			sessionSshRemoteConfig: { enabled: true, remoteId: 'srv' },
		});

		expect(pm.spawn).toHaveBeenCalled();
		expect(lastRunner).toBeNull();
	});
});

// ════════════════════════════════════════════════════════════════════════════
// CLI PATH
// ════════════════════════════════════════════════════════════════════════════

// Top-level imports for CLI path tests (module-level mocks are already applied above)
import { spawnClaudeAgent } from '../../cli/services/agent-spawner';
import { ClaudePtyRunner } from '../../main/utils/claude-pty-runner';

describe('CLI path', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		lastRunner = null;
		mockStdout.removeAllListeners();
		mockStderr.removeAllListeners();
		mockChild.removeAllListeners();
		mockSpawn.mockReturnValue(mockChild);
	});

	function emitLegacySuccess() {
		setTimeout(() => {
			mockStdout.emit(
				'data',
				Buffer.from('{"type":"result","result":"ok","session_id":"sid-1"}\n')
			);
			mockChild.emit('close', 0);
		}, 0);
	}

	// ── Case 10: CLI legacy-print ────────────────────────────────────────
	it('10. CLI legacy-print → child_process.spawn called, --print in args', async () => {
		delete process.env.MAESTRO_CLAUDE_TRANSPORT_MODE;
		emitLegacySuccess();

		const result = await spawnClaudeAgent('/proj', 'hello');

		expect(mockSpawn).toHaveBeenCalled();
		const args = mockSpawn.mock.calls[0][1] as string[];
		expect(args).toContain('--print');
		expect(result.success).toBe(true);
		expect(lastRunner).toBeNull();
	});

	// ── Case 11: CLI interactive-pty ─────────────────────────────────────
	it('11. CLI interactive-pty (env var) → ClaudePtyRunner instantiated, executeTurn called', async () => {
		process.env.MAESTRO_CLAUDE_TRANSPORT_MODE = 'interactive-pty';

		const resultPromise = spawnClaudeAgent('/proj', 'hello', undefined, 'maestro-session-1');

		// Simulate runner emitting a successful result
		await new Promise((r) => setTimeout(r, 0));
		expect(lastRunner).not.toBeNull();
		lastRunner!._listeners['event']?.[0]?.({ type: 'result', text: 'done' });
		lastRunner!._listeners['end']?.[0]?.('SUCCESS', 0);

		const result = await resultPromise;
		expect(result.success).toBe(true);
		expect(result.response).toBe('done');
		expect(mockSpawn).not.toHaveBeenCalled();

		delete process.env.MAESTRO_CLAUDE_TRANSPORT_MODE;
	});

	// ── Case 12: CLI runner failure → rollback hint in error ─────────────
	it('12. CLI runner failure (constructor throws) → AgentResult.error contains legacy-print rollback hint', async () => {
		process.env.MAESTRO_CLAUDE_TRANSPORT_MODE = 'interactive-pty';

		vi.mocked(ClaudePtyRunner).mockImplementationOnce(() => {
			throw new Error('node-pty unavailable');
		});

		const result = await spawnClaudeAgent('/proj', 'hello');

		expect(result.success).toBe(false);
		expect(result.error).toContain('legacy-print');

		delete process.env.MAESTRO_CLAUDE_TRANSPORT_MODE;
	});
});
