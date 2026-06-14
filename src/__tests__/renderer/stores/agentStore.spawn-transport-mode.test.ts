/**
 * Smoke tests for transport mode fields in agentStore spawn payloads.
 *
 * Verifies that window.maestro.process.spawn() is called with the correct
 * sessionTransportMode and tabTransportMode fields from the session and active tab.
 *
 * Scenarios (4 required):
 * 1. Session with transportMode='interactive-pty', tab without → spawn has sessionTransportMode set
 * 2. Session without, tab with transportMode='interactive-pty' → spawn has tabTransportMode set
 * 3. Both undefined → spawn contains both fields as undefined
 * 4. Both set → spawn contains both fields with their respective values
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAgentStore } from '../../../renderer/stores/agentStore';
import type { ProcessQueuedItemDeps } from '../../../renderer/stores/agentStore';
import { useSessionStore } from '../../../renderer/stores/sessionStore';
import type { Session, AITab } from '../../../renderer/types';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockSpawn = vi.fn().mockResolvedValue({ pid: 123, success: true });

(window as unknown as Record<string, unknown>).maestro = {
	process: { spawn: mockSpawn },
	agents: {
		get: vi.fn().mockResolvedValue({
			id: 'claude-code',
			name: 'Claude Code',
			command: 'claude',
			args: [],
			capabilities: {},
		}),
		detect: vi.fn().mockResolvedValue([]),
	},
	agentError: { clearError: vi.fn().mockResolvedValue(undefined) },
};

vi.mock('../../../renderer/services/git', () => ({
	gitService: { getStatus: vi.fn().mockResolvedValue({ branch: 'main', files: [] }) },
}));

vi.mock('../../../prompts', () => ({
	maestroSystemPrompt: '',
	autorunSynopsisPrompt: '',
	imageOnlyDefaultPrompt: 'Describe this image',
}));

vi.mock('../../../renderer/utils/templateVariables', () => ({
	substituteTemplateVariables: vi.fn((t: string) => t),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTab(overrides: Partial<AITab> = {}): AITab {
	return {
		id: 'tab-1',
		agentSessionId: 'agent-sess-1',
		name: null,
		starred: false,
		logs: [],
		inputValue: '',
		stagedImages: [],
		createdAt: Date.now(),
		state: 'idle' as const,
		...overrides,
	};
}

function makeSession(overrides: Partial<Session> = {}): Session {
	const tab = makeTab(overrides.aiTabs?.[0]);
	return {
		id: 'sess-1',
		name: 'Test',
		toolType: 'claude-code',
		state: 'idle' as const,
		cwd: '/proj',
		fullPath: '/proj',
		projectRoot: '/proj',
		aiLogs: [],
		shellLogs: [],
		workLog: [],
		contextUsage: 0,
		inputMode: 'ai' as const,
		aiPid: 0,
		terminalPid: 0,
		port: 0,
		isLive: false,
		changedFiles: [],
		isGitRepo: false,
		fileTree: [],
		fileExplorerExpanded: [],
		fileExplorerScrollPos: 0,
		executionQueue: [],
		activeTimeMs: 0,
		closedTabHistory: [],
		filePreviewTabs: [],
		activeFileTabId: null,
		unifiedTabOrder: [{ type: 'ai' as const, id: tab.id }],
		unifiedClosedTabHistory: [],
		...overrides,
		aiTabs: overrides.aiTabs ?? [tab],
		activeTabId: overrides.activeTabId ?? tab.id,
	} as Session;
}

const mockDeps: ProcessQueuedItemDeps = {
	customAICommands: [],
	speckitCommands: [],
	openspecCommands: [],
	conductorProfile: null,
};

function resetStores() {
	useAgentStore.setState({ availableAgents: [], agentsDetected: false });
	useSessionStore.setState({
		sessions: [],
		groups: [],
		activeSessionId: '',
		sessionsLoaded: false,
		initialLoadComplete: false,
		removedWorktreePaths: new Set(),
		cyclePosition: -1,
	});
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('agentStore spawn — transport mode fields', () => {
	beforeEach(() => {
		resetStores();
		vi.clearAllMocks();
		mockSpawn.mockResolvedValue({ pid: 123, success: true });
	});

	// ── Scenario 1 ───────────────────────────────────────────────────────────
	it('1. session.transportMode=interactive-pty, tab without → spawn payload has sessionTransportMode set, tabTransportMode undefined', async () => {
		const tab = makeTab({ transportMode: undefined });
		const session = makeSession({
			transportMode: 'interactive-pty',
			aiTabs: [tab],
			activeTabId: tab.id,
		});
		useSessionStore.getState().setSessions([session]);

		await useAgentStore
			.getState()
			.processQueuedItem(session.id, { type: 'message', text: 'hello', tabId: tab.id }, mockDeps);

		expect(mockSpawn).toHaveBeenCalledOnce();
		const payload = mockSpawn.mock.calls[0][0];
		expect(payload.sessionTransportMode).toBe('interactive-pty');
		expect(payload.tabTransportMode).toBeUndefined();
	});

	// ── Scenario 2 ───────────────────────────────────────────────────────────
	it('2. session without, tab.transportMode=interactive-pty → spawn payload has tabTransportMode set, sessionTransportMode undefined', async () => {
		const tab = makeTab({ transportMode: 'interactive-pty' });
		const session = makeSession({
			transportMode: undefined,
			aiTabs: [tab],
			activeTabId: tab.id,
		});
		useSessionStore.getState().setSessions([session]);

		await useAgentStore
			.getState()
			.processQueuedItem(session.id, { type: 'message', text: 'hello', tabId: tab.id }, mockDeps);

		expect(mockSpawn).toHaveBeenCalledOnce();
		const payload = mockSpawn.mock.calls[0][0];
		expect(payload.sessionTransportMode).toBeUndefined();
		expect(payload.tabTransportMode).toBe('interactive-pty');
	});

	// ── Scenario 3 ───────────────────────────────────────────────────────────
	it('3. both undefined → spawn payload contains both fields as undefined (not omitted)', async () => {
		const tab = makeTab({ transportMode: undefined });
		const session = makeSession({
			transportMode: undefined,
			aiTabs: [tab],
			activeTabId: tab.id,
		});
		useSessionStore.getState().setSessions([session]);

		await useAgentStore
			.getState()
			.processQueuedItem(session.id, { type: 'message', text: 'hello', tabId: tab.id }, mockDeps);

		expect(mockSpawn).toHaveBeenCalledOnce();
		const payload = mockSpawn.mock.calls[0][0];
		// Fields must be explicitly present (even if undefined) so cascade treats them as "unset"
		expect(Object.prototype.hasOwnProperty.call(payload, 'sessionTransportMode')).toBe(true);
		expect(Object.prototype.hasOwnProperty.call(payload, 'tabTransportMode')).toBe(true);
		expect(payload.sessionTransportMode).toBeUndefined();
		expect(payload.tabTransportMode).toBeUndefined();
	});

	// ── Scenario 4 ───────────────────────────────────────────────────────────
	it('4. both set → spawn payload contains both fields with their respective values', async () => {
		const tab = makeTab({ transportMode: 'interactive-pty' });
		const session = makeSession({
			transportMode: 'interactive-pty',
			aiTabs: [tab],
			activeTabId: tab.id,
		});
		useSessionStore.getState().setSessions([session]);

		await useAgentStore
			.getState()
			.processQueuedItem(session.id, { type: 'message', text: 'hello', tabId: tab.id }, mockDeps);

		expect(mockSpawn).toHaveBeenCalledOnce();
		const payload = mockSpawn.mock.calls[0][0];
		expect(payload.sessionTransportMode).toBe('interactive-pty');
		expect(payload.tabTransportMode).toBe('interactive-pty');
	});
});
