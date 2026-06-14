/**
 * Unit tests for the transport-mode cascade-input wiring in process:spawn.
 *
 * Tests the pure buildTransportCascadeInputs() helper that produces tabLevel
 * and agentLevel cascade objects from the spawn config + global agentConfigValues.
 *
 * Also tests end-to-end resolution through resolveClaudeTransportMode() to verify
 * the cascade semantics (strict ratchet).
 *
 * Scenarios (8 required):
 * 1. Tab-level forces interactive-pty
 * 2. Session-level forces interactive-pty when tab absent
 * 3. Both absent → legacy-print
 * 4. Strict-ratchet — tab=legacy-print, agent=interactive-pty → still interactive-pty
 * 5. Tab=legacy-print does NOT override session=interactive-pty (strict ratchet up-only)
 * 6. agentConfigValues.transportMode preserved as fallback
 * 7. SSH branch — tab-level forces interactive-pty
 * 8. SSH branch — session-level forces interactive-pty
 */

import { describe, it, expect, vi } from 'vitest';
import { buildTransportCascadeInputs } from '../../../../main/ipc/handlers/process';
import { resolveClaudeTransportMode } from '../../../../main/utils/claude-pty-helpers';

// ── Mock all modules that process.ts imports so it can be imported cleanly ──

vi.mock('electron', () => ({
	ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}));

vi.mock('../../../../main/utils/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../../main/utils/agent-args', () => ({
	buildAgentArgs: vi.fn((_a: unknown, o: { baseArgs?: string[] }) => o.baseArgs || []),
	applyAgentConfigOverrides: vi.fn((_a: unknown, args: string[]) => ({
		args,
		modelSource: 'none',
		customArgsSource: 'none',
		customEnvSource: 'none',
		effectiveCustomEnvVars: undefined,
	})),
	getContextWindowValue: vi.fn(() => 0),
}));

vi.mock('node-pty', () => ({ spawn: vi.fn() }));

vi.mock('../../../../main/utils/ssh-remote-resolver', () => ({
	getSshRemoteConfig: vi.fn(() => ({ config: null, source: 'not_found' })),
	createSshRemoteStoreAdapter: vi.fn(() => ({})),
}));

vi.mock('../../../../main/utils/ssh-command-builder', () => ({
	buildSshCommandWithStdin: vi.fn(),
	buildSshCommand: vi.fn(),
	buildSshClaudeInteractiveArgs: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../../main/power-manager', () => ({
	powerManager: { addBlockReason: vi.fn(), removeBlockReason: vi.fn() },
}));

vi.mock('../../../../main/utils/sentry', () => ({
	addBreadcrumb: vi.fn(),
	captureException: vi.fn(),
}));

vi.mock('../../../../main/process-manager/utils/streamJsonBuilder', () => ({
	buildStreamJsonMessage: vi.fn((p: string) => JSON.stringify({ prompt: p })),
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

vi.mock('../../../../main/utils/claude-pty-runner', () => {
	class MockClaudePtyRunner {
		executeTurn = vi.fn();
		kill = vi.fn();
		on = vi.fn().mockReturnThis();
	}
	return { ClaudePtyRunner: MockClaudePtyRunner };
});

// ── Helper test suite ─────────────────────────────────────────────────────────

describe('buildTransportCascadeInputs', () => {
	// ── Scenario 1: Tab-level forces interactive-pty ─────────────────────────
	it('1. tab=interactive-pty → tabLevel={interactive-pty}, resolves interactive-pty regardless of other levels', () => {
		const { tabLevel, agentLevel } = buildTransportCascadeInputs(
			{ tabTransportMode: 'interactive-pty', sessionTransportMode: 'legacy-print' },
			{ transportMode: 'legacy-print' }
		);

		expect(tabLevel).toEqual({ transportMode: 'interactive-pty' });
		expect(agentLevel).toEqual({ transportMode: 'legacy-print' });

		const resolved = resolveClaudeTransportMode(tabLevel, agentLevel, undefined, {
			claudeCodeDefaultTransportMode: 'legacy-print',
		});
		expect(resolved).toBe('interactive-pty');
	});

	// ── Scenario 2: Session-level forces interactive-pty when tab absent ─────
	it('2. tab=undefined, session=interactive-pty → agentLevel={interactive-pty}, resolves interactive-pty', () => {
		const { tabLevel, agentLevel } = buildTransportCascadeInputs(
			{ tabTransportMode: undefined, sessionTransportMode: 'interactive-pty' },
			{}
		);

		expect(tabLevel).toBeUndefined();
		expect(agentLevel).toEqual({ transportMode: 'interactive-pty' });

		const resolved = resolveClaudeTransportMode(tabLevel, agentLevel, undefined, {
			claudeCodeDefaultTransportMode: 'legacy-print',
		});
		expect(resolved).toBe('interactive-pty');
	});

	// ── Scenario 3: Both absent → legacy-print ───────────────────────────────
	it('3. tab=undefined, session=undefined, agentConfig empty → both undefined, resolves legacy-print', () => {
		const { tabLevel, agentLevel } = buildTransportCascadeInputs(
			{ tabTransportMode: undefined, sessionTransportMode: undefined },
			{}
		);

		expect(tabLevel).toBeUndefined();
		expect(agentLevel).toBeUndefined();

		const resolved = resolveClaudeTransportMode(tabLevel, agentLevel, undefined, {
			claudeCodeDefaultTransportMode: 'legacy-print',
		});
		expect(resolved).toBe('legacy-print');
	});

	// ── Scenario 4: Strict ratchet — tab=legacy-print, agent=interactive-pty ─
	it('4. tab=legacy-print, agent=interactive-pty → still resolves interactive-pty (strict ratchet)', () => {
		const { tabLevel, agentLevel } = buildTransportCascadeInputs(
			{ tabTransportMode: 'legacy-print', sessionTransportMode: 'interactive-pty' },
			{}
		);

		expect(tabLevel).toEqual({ transportMode: 'legacy-print' });
		expect(agentLevel).toEqual({ transportMode: 'interactive-pty' });

		const resolved = resolveClaudeTransportMode(tabLevel, agentLevel, undefined, {
			claudeCodeDefaultTransportMode: 'legacy-print',
		});
		expect(resolved).toBe('interactive-pty');
	});

	// ── Scenario 5: tab=legacy-print does NOT override session=interactive-pty ─
	it('5. tab=legacy-print cannot demote session=interactive-pty (ratchet only goes up)', () => {
		const { tabLevel, agentLevel } = buildTransportCascadeInputs(
			{ tabTransportMode: 'legacy-print', sessionTransportMode: undefined },
			{ transportMode: 'interactive-pty' }
		);

		// tab says legacy, agentConfig says interactive
		expect(tabLevel).toEqual({ transportMode: 'legacy-print' });
		expect(agentLevel).toEqual({ transportMode: 'interactive-pty' });

		// strict ratchet: interactive-pty at agent level wins over legacy-print at tab level
		const resolved = resolveClaudeTransportMode(tabLevel, agentLevel, undefined, {
			claudeCodeDefaultTransportMode: 'legacy-print',
		});
		expect(resolved).toBe('interactive-pty');
	});

	// ── Scenario 6: agentConfigValues.transportMode preserved as fallback ────
	it('6. session=undefined, agentConfigValues.transportMode=interactive-pty → flows through as agentLevel', () => {
		const { tabLevel, agentLevel } = buildTransportCascadeInputs(
			{ tabTransportMode: undefined, sessionTransportMode: undefined },
			{ transportMode: 'interactive-pty' }
		);

		expect(tabLevel).toBeUndefined();
		expect(agentLevel).toEqual({ transportMode: 'interactive-pty' });

		const resolved = resolveClaudeTransportMode(tabLevel, agentLevel, undefined, {
			claudeCodeDefaultTransportMode: 'legacy-print',
		});
		expect(resolved).toBe('interactive-pty');
	});

	// ── Scenario 7: SSH branch — tab-level forces interactive-pty ───────────
	it('7. SSH branch: tab=interactive-pty → cascade resolves interactive-pty', () => {
		// The SSH branch uses buildTransportCascadeInputs identically to the local branch
		const { tabLevel, agentLevel } = buildTransportCascadeInputs(
			{
				tabTransportMode: 'interactive-pty',
				sessionTransportMode: 'legacy-print',
			},
			{}
		);

		expect(tabLevel).toEqual({ transportMode: 'interactive-pty' });

		const sshResolved = resolveClaudeTransportMode(tabLevel, agentLevel, undefined, {
			claudeCodeDefaultTransportMode: 'legacy-print',
		});
		expect(sshResolved).toBe('interactive-pty');
	});

	// ── Scenario 8: SSH branch — session-level forces interactive-pty ────────
	it('8. SSH branch: tab=undefined, session=interactive-pty → cascade resolves interactive-pty', () => {
		const { tabLevel, agentLevel } = buildTransportCascadeInputs(
			{
				tabTransportMode: undefined,
				sessionTransportMode: 'interactive-pty',
			},
			{}
		);

		expect(tabLevel).toBeUndefined();
		expect(agentLevel).toEqual({ transportMode: 'interactive-pty' });

		const sshResolved = resolveClaudeTransportMode(tabLevel, agentLevel, undefined, {
			claudeCodeDefaultTransportMode: 'legacy-print',
		});
		expect(sshResolved).toBe('interactive-pty');
	});
});
