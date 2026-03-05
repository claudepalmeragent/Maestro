import '@testing-library/jest-dom';
import { vi } from 'vitest';
import React from 'react';

// Mock LayerStackContext globally — many components use useLayerStack() which throws
// without a LayerStackProvider. This mock provides safe defaults for all tests.
vi.mock('../renderer/contexts/LayerStackContext', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../renderer/contexts/LayerStackContext')>();
	return {
		...actual,
		useLayerStack: vi.fn(() => ({
			registerLayer: vi.fn().mockReturnValue('layer-mock-id'),
			unregisterLayer: vi.fn(),
			updateLayerHandler: vi.fn(),
			getTopLayer: vi.fn().mockReturnValue(undefined),
			closeTopLayer: vi.fn().mockResolvedValue(false),
			hasOpenLayers: vi.fn().mockReturnValue(false),
			hasOpenModal: vi.fn().mockReturnValue(false),
			layerCount: 0,
		})),
	};
});

// Mock ToastContext globally — components using useToast() throw without a ToastProvider.
vi.mock('../renderer/contexts/ToastContext', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../renderer/contexts/ToastContext')>();
	return {
		...actual,
		useToast: vi.fn(() => ({
			toasts: [],
			addToast: vi.fn(),
			removeToast: vi.fn(),
			clearToasts: vi.fn(),
			defaultDuration: 20,
			setDefaultDuration: vi.fn(),
			setAudioFeedback: vi.fn(),
			setOsNotifications: vi.fn(),
		})),
	};
});

// Mock ModalContext globally — many components use useModalContext() which throws
// without a ModalProvider. This mock provides safe defaults for all tests.
vi.mock('../renderer/contexts/ModalContext', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../renderer/contexts/ModalContext')>();
	return {
		...actual,
		useModalContext: vi.fn(() => ({
			settingsModalOpen: false,
			setSettingsModalOpen: vi.fn(),
			settingsTab: 'general',
			setSettingsTab: vi.fn(),
			openSettings: vi.fn(),
			closeSettings: vi.fn(),
			newInstanceModalOpen: false,
			setNewInstanceModalOpen: vi.fn(),
			duplicatingSessionId: null,
			setDuplicatingSessionId: vi.fn(),
			editAgentModalOpen: false,
			setEditAgentModalOpen: vi.fn(),
			editAgentSession: null,
			setEditAgentSession: vi.fn(),
			shortcutsHelpOpen: false,
			setShortcutsHelpOpen: vi.fn(),
			setShortcutsSearchQuery: vi.fn(),
			quickActionOpen: false,
			setQuickActionOpen: vi.fn(),
			quickActionInitialMode: 'main',
			setQuickActionInitialMode: vi.fn(),
			lightboxImage: null,
			setLightboxImage: vi.fn(),
			lightboxImages: [],
			setLightboxImages: vi.fn(),
			setLightboxSource: vi.fn(),
			lightboxIsGroupChatRef: { current: false },
			lightboxAllowDeleteRef: { current: false },
			aboutModalOpen: false,
			setAboutModalOpen: vi.fn(),
			updateCheckModalOpen: false,
			setUpdateCheckModalOpen: vi.fn(),
			leaderboardRegistrationOpen: false,
			setLeaderboardRegistrationOpen: vi.fn(),
			standingOvationData: null,
			setStandingOvationData: vi.fn(),
			firstRunCelebrationData: null,
			setFirstRunCelebrationData: vi.fn(),
			logViewerOpen: false,
			setLogViewerOpen: vi.fn(),
			processMonitorOpen: false,
			setProcessMonitorOpen: vi.fn(),
			usageDashboardOpen: false,
			setUsageDashboardOpen: vi.fn(),
			usageDashboardInitialTab: undefined,
			setUsageDashboardInitialTab: vi.fn(),
			usageDashboardModalOpen: false,
			setUsageDashboardModalOpen: vi.fn(),
			pendingKeyboardMasteryLevel: null,
			setPendingKeyboardMasteryLevel: vi.fn(),
			playgroundOpen: false,
			setPlaygroundOpen: vi.fn(),
			debugWizardModalOpen: false,
			setDebugWizardModalOpen: vi.fn(),
			debugPackageModalOpen: false,
			setDebugPackageModalOpen: vi.fn(),
			confirmModalOpen: false,
			setConfirmModalOpen: vi.fn(),
			confirmModalMessage: '',
			setConfirmModalMessage: vi.fn(),
			confirmModalOnConfirm: null,
			setConfirmModalOnConfirm: vi.fn(),
			showConfirmation: vi.fn(),
			closeConfirmation: vi.fn(),
			quitConfirmModalOpen: false,
			setQuitConfirmModalOpen: vi.fn(),
			renameInstanceModalOpen: false,
			setRenameInstanceModalOpen: vi.fn(),
			renameInstanceValue: '',
			setRenameInstanceValue: vi.fn(),
			renameInstanceSessionId: null,
			setRenameInstanceSessionId: vi.fn(),
			renameTabModalOpen: false,
			setRenameTabModalOpen: vi.fn(),
			renameTabId: null,
			setRenameTabId: vi.fn(),
			renameTabInitialName: '',
			setRenameTabInitialName: vi.fn(),
			renameGroupModalOpen: false,
			setRenameGroupModalOpen: vi.fn(),
			renameGroupId: null,
			setRenameGroupId: vi.fn(),
			renameGroupValue: '',
			setRenameGroupValue: vi.fn(),
			renameGroupEmoji: '',
			setRenameGroupEmoji: vi.fn(),
			agentSessionsOpen: false,
			setAgentSessionsOpen: vi.fn(),
			activeAgentSessionId: null,
			setActiveAgentSessionId: vi.fn(),
			queueBrowserOpen: false,
			setQueueBrowserOpen: vi.fn(),
			batchRunnerModalOpen: false,
			setBatchRunnerModalOpen: vi.fn(),
			autoRunSetupModalOpen: false,
			setAutoRunSetupModalOpen: vi.fn(),
			marketplaceModalOpen: false,
			setMarketplaceModalOpen: vi.fn(),
			wizardResumeModalOpen: false,
			setWizardResumeModalOpen: vi.fn(),
			wizardResumeState: null,
			setWizardResumeState: vi.fn(),
			agentErrorModalSessionId: null,
			setAgentErrorModalSessionId: vi.fn(),
			worktreeConfigModalOpen: false,
			setWorktreeConfigModalOpen: vi.fn(),
			createWorktreeModalOpen: false,
			setCreateWorktreeModalOpen: vi.fn(),
			createWorktreeSession: null,
			setCreateWorktreeSession: vi.fn(),
			createPRModalOpen: false,
			setCreatePRModalOpen: vi.fn(),
			createPRSession: null,
			setCreatePRSession: vi.fn(),
			deleteWorktreeModalOpen: false,
			setDeleteWorktreeModalOpen: vi.fn(),
			deleteWorktreeSession: null,
			setDeleteWorktreeSession: vi.fn(),
			tabSwitcherOpen: false,
			setTabSwitcherOpen: vi.fn(),
			fuzzyFileSearchOpen: false,
			setFuzzyFileSearchOpen: vi.fn(),
			promptComposerOpen: false,
			setPromptComposerOpen: vi.fn(),
			agentPromptComposerOpen: false,
			setAgentPromptComposerOpen: vi.fn(),
			mergeSessionModalOpen: false,
			setMergeSessionModalOpen: vi.fn(),
			sendToAgentModalOpen: false,
			setSendToAgentModalOpen: vi.fn(),
			showNewGroupChatModal: false,
			setShowNewGroupChatModal: vi.fn(),
			createGroupChatForFolderId: undefined,
			setCreateGroupChatForFolderId: vi.fn(),
			showDeleteGroupChatModal: null,
			setShowDeleteGroupChatModal: vi.fn(),
			showRenameGroupChatModal: null,
			setShowRenameGroupChatModal: vi.fn(),
			showEditGroupChatModal: null,
			setShowEditGroupChatModal: vi.fn(),
			showGroupChatInfo: false,
			setShowGroupChatInfo: vi.fn(),
			gitDiffPreview: null,
			setGitDiffPreview: vi.fn(),
			gitLogOpen: false,
			setGitLogOpen: vi.fn(),
			tourOpen: false,
			setTourOpen: vi.fn(),
			tourFromWizard: false,
			setTourFromWizard: vi.fn(),
		})),
	};
});

// Create a mock icon component factory
const createMockIcon = (name: string) => {
	const MockIcon = function ({
		className,
		style,
	}: {
		className?: string;
		style?: React.CSSProperties;
	}) {
		return React.createElement('svg', {
			'data-testid': `${name
				.replace(/([A-Z])/g, '-$1')
				.toLowerCase()
				.replace(/^-/, '')}-icon`,
			className,
			style,
		});
	};
	MockIcon.displayName = name;
	return MockIcon;
};

// Global mock for lucide-react using Proxy to auto-generate mock icons
// This ensures any icon import works without explicitly listing every icon
vi.mock('lucide-react', () => {
	const iconCache = new Map<string, ReturnType<typeof createMockIcon>>();

	return new Proxy(
		{},
		{
			get(_target, prop: string) {
				// Ignore internal properties
				if (
					prop === '__esModule' ||
					prop === 'default' ||
					prop === 'then' ||
					typeof prop === 'symbol'
				) {
					return undefined;
				}

				// Return cached icon or create new one
				if (!iconCache.has(prop)) {
					iconCache.set(prop, createMockIcon(prop));
				}
				return iconCache.get(prop);
			},
			has(_target, prop: string) {
				if (
					prop === '__esModule' ||
					prop === 'default' ||
					prop === 'then' ||
					typeof prop === 'symbol'
				) {
					return false;
				}
				return true;
			},
			getOwnPropertyDescriptor(_target, prop: string) {
				if (
					prop === '__esModule' ||
					prop === 'default' ||
					prop === 'then' ||
					typeof prop === 'symbol'
				) {
					return undefined;
				}
				return {
					configurable: true,
					enumerable: true,
					writable: false,
					value: this.get?.(_target, prop),
				};
			},
		}
	);
});

// Mock window.matchMedia for components that use media queries
Object.defineProperty(window, 'matchMedia', {
	writable: true,
	value: vi.fn().mockImplementation((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn(),
	})),
});

// Mock ResizeObserver using a proper class-like constructor
// Simulates a 1000px width by default which ensures all responsive UI elements are visible
class MockResizeObserver {
	callback: ResizeObserverCallback;
	constructor(callback: ResizeObserverCallback) {
		this.callback = callback;
	}
	observe = vi.fn((target: Element) => {
		// Immediately call callback with a reasonable width to simulate layout
		// This ensures responsive breakpoints work correctly in tests
		const entry: ResizeObserverEntry = {
			target,
			contentRect: {
				width: 1000,
				height: 500,
				top: 0,
				left: 0,
				bottom: 500,
				right: 1000,
				x: 0,
				y: 0,
				toJSON: () => ({}),
			},
			borderBoxSize: [{ blockSize: 500, inlineSize: 1000 }],
			contentBoxSize: [{ blockSize: 500, inlineSize: 1000 }],
			devicePixelContentBoxSize: [{ blockSize: 500, inlineSize: 1000 }],
		};
		// Use setTimeout to simulate async behavior like the real ResizeObserver
		setTimeout(() => this.callback([entry], this as unknown as ResizeObserver), 0);
	});
	unobserve = vi.fn();
	disconnect = vi.fn();
}
global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

// Mock offsetWidth to return reasonable values for responsive breakpoint tests
// This ensures components that check element dimensions work correctly in jsdom
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
	configurable: true,
	get() {
		return 1000; // Default to wide enough for all responsive features to show
	},
});

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
	observe: vi.fn(),
	unobserve: vi.fn(),
	disconnect: vi.fn(),
}));

// Mock Element.prototype.scrollTo - needed for components that use scrollTo
Element.prototype.scrollTo = vi.fn();

// Mock Element.prototype.scrollIntoView - needed for components that scroll elements into view
Element.prototype.scrollIntoView = vi.fn();

// Mock window.maestro API (Electron IPC bridge)
const mockMaestro = {
	settings: {
		get: vi.fn().mockResolvedValue(undefined),
		set: vi.fn().mockResolvedValue(undefined),
		getAll: vi.fn().mockResolvedValue({}),
	},
	sessions: {
		get: vi.fn().mockResolvedValue([]),
		save: vi.fn().mockResolvedValue(undefined),
		setAll: vi.fn().mockResolvedValue(undefined),
	},
	groups: {
		get: vi.fn().mockResolvedValue([]),
		getAll: vi.fn().mockResolvedValue([]),
		save: vi.fn().mockResolvedValue(undefined),
		setAll: vi.fn().mockResolvedValue(undefined),
	},
	process: {
		spawn: vi.fn().mockResolvedValue({ pid: 12345 }),
		write: vi.fn().mockResolvedValue(undefined),
		kill: vi.fn().mockResolvedValue(undefined),
		resize: vi.fn().mockResolvedValue(undefined),
		onOutput: vi.fn().mockReturnValue(() => {}),
		onExit: vi.fn().mockReturnValue(() => {}),
	},
	git: {
		status: vi.fn().mockResolvedValue({ files: [], branch: 'main', stdout: '' }),
		diff: vi.fn().mockResolvedValue(''),
		isRepo: vi.fn().mockResolvedValue(true),
		numstat: vi.fn().mockResolvedValue([]),
		getStatus: vi.fn().mockResolvedValue({ branch: 'main', status: [] }),
		worktreeSetup: vi.fn().mockResolvedValue({ success: true }),
		worktreeCheckout: vi.fn().mockResolvedValue({ success: true }),
		getDefaultBranch: vi.fn().mockResolvedValue({ success: true, branch: 'main' }),
		createPR: vi.fn().mockResolvedValue({ success: true, prUrl: 'https://github.com/test/pr/1' }),
		branches: vi.fn().mockResolvedValue({ branches: ['main', 'develop'] }),
		checkGhCli: vi.fn().mockResolvedValue({ installed: true, authenticated: true }),
		worktreeInfo: vi.fn().mockResolvedValue({ success: true, exists: false, isWorktree: false }),
		getRepoRoot: vi.fn().mockResolvedValue({ success: true, root: '/path/to/project' }),
		log: vi.fn().mockResolvedValue({ entries: [], error: undefined }),
		commitCount: vi.fn().mockResolvedValue({ count: 0, error: null }),
		show: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
		getRemoteUrl: vi.fn().mockResolvedValue(null),
		info: vi.fn().mockResolvedValue({
			branch: 'main',
			remote: '',
			behind: 0,
			ahead: 0,
			uncommittedChanges: 0,
		}),
	},
	fs: {
		readDir: vi.fn().mockResolvedValue([]),
		readFile: vi.fn().mockResolvedValue(''),
		stat: vi.fn().mockResolvedValue({
			size: 1024,
			createdAt: '2024-01-01T00:00:00.000Z',
			modifiedAt: '2024-01-15T12:30:00.000Z',
		}),
		directorySize: vi.fn().mockResolvedValue({
			totalSize: 1024000,
			fileCount: 50,
			folderCount: 10,
		}),
		homeDir: vi.fn().mockResolvedValue('/home/testuser'),
	},
	agents: {
		detect: vi.fn().mockResolvedValue([]),
		get: vi.fn().mockResolvedValue(null),
		config: vi.fn().mockResolvedValue({}),
		getConfig: vi.fn().mockResolvedValue({}),
		setConfig: vi.fn().mockResolvedValue(undefined),
		getAllCustomPaths: vi.fn().mockResolvedValue({}),
		getCustomPath: vi.fn().mockResolvedValue(null),
		setCustomPath: vi.fn().mockResolvedValue(undefined),
		getAllCustomArgs: vi.fn().mockResolvedValue({}),
		getCustomArgs: vi.fn().mockResolvedValue(null),
		setCustomArgs: vi.fn().mockResolvedValue(undefined),
		getAllCustomEnvVars: vi.fn().mockResolvedValue({}),
		getCustomEnvVars: vi.fn().mockResolvedValue(null),
		setCustomEnvVars: vi.fn().mockResolvedValue(undefined),
		refresh: vi.fn().mockResolvedValue({ agents: [], debugInfo: null }),
		// Model discovery for agents that support model selection
		getModels: vi.fn().mockResolvedValue([]),
		// Capabilities for gating UI features based on agent type
		getCapabilities: vi.fn().mockResolvedValue({
			supportsResume: true,
			supportsReadOnlyMode: true,
			supportsJsonOutput: true,
			supportsSessionId: true,
			supportsImageInput: true,
			supportsImageInputOnResume: true,
			supportsSlashCommands: true,
			supportsSessionStorage: true,
			supportsCostTracking: true,
			supportsUsageStats: true,
			supportsBatchMode: true,
			requiresPromptToStart: false,
			supportsStreaming: true,
			supportsResultMessages: true,
			supportsModelSelection: false,
			supportsStreamJsonInput: true,
			supportsContextMerge: false,
			supportsContextExport: false,
		}),
		getHostSettings: vi.fn().mockResolvedValue({ model: null, effortLevel: null }),
		setHostSettings: vi.fn().mockResolvedValue(undefined),
		getVersion: vi.fn().mockResolvedValue('1.0.0'),
		update: vi.fn().mockResolvedValue({ success: true }),
		discoverSlashCommands: vi.fn().mockResolvedValue([]),
		detectAuth: vi.fn().mockResolvedValue({ authenticated: false }),
		invalidateAuthCache: vi.fn().mockResolvedValue(undefined),
		getPricingConfig: vi.fn().mockResolvedValue(null),
		setPricingConfig: vi.fn().mockResolvedValue(undefined),
		updateDetectedModel: vi.fn().mockResolvedValue(undefined),
	},
	fonts: {
		detect: vi.fn().mockResolvedValue([]),
	},
	claude: {
		listSessions: vi.fn().mockResolvedValue([]),
		listSessionsPaginated: vi.fn().mockResolvedValue({
			sessions: [],
			hasMore: false,
			totalCount: 0,
			nextCursor: null,
		}),
		readSession: vi.fn().mockResolvedValue(null),
		readSessionMessages: vi.fn().mockResolvedValue({
			messages: [],
			total: 0,
			hasMore: false,
		}),
		searchSessions: vi.fn().mockResolvedValue([]),
		getGlobalStats: vi.fn().mockResolvedValue(null),
		getProjectStats: vi.fn().mockResolvedValue(undefined),
		onGlobalStatsUpdate: vi.fn().mockReturnValue(() => {}),
		onProjectStatsUpdate: vi.fn().mockReturnValue(() => {}),
		getAllNamedSessions: vi.fn().mockResolvedValue([]),
		getSessionOrigins: vi.fn().mockResolvedValue({}),
		getAllOriginsBySessionId: vi.fn().mockResolvedValue({}),
		updateSessionName: vi.fn().mockResolvedValue(undefined),
		updateSessionStarred: vi.fn().mockResolvedValue(undefined),
		registerSessionOrigin: vi.fn().mockResolvedValue(undefined),
	},
	// Generic agent sessions API (preferred over claude.*)
	agentSessions: {
		list: vi.fn().mockResolvedValue([]),
		listPaginated: vi.fn().mockResolvedValue({
			sessions: [],
			hasMore: false,
			totalCount: 0,
			nextCursor: null,
		}),
		read: vi.fn().mockResolvedValue({
			messages: [],
			total: 0,
			hasMore: false,
		}),
		search: vi.fn().mockResolvedValue([]),
		searchSessions: vi.fn().mockResolvedValue([]),
		getPath: vi.fn().mockResolvedValue(null),
		deleteMessagePair: vi.fn().mockResolvedValue({ success: true }),
		hasStorage: vi.fn().mockResolvedValue(true),
		getAvailableStorages: vi.fn().mockResolvedValue(['claude-code']),
		// Global stats methods for AboutModal
		getGlobalStats: vi.fn().mockResolvedValue(null),
		getProjectStats: vi.fn().mockResolvedValue(undefined),
		onGlobalStatsUpdate: vi.fn().mockReturnValue(() => {}),
		onProjectStatsUpdate: vi.fn().mockReturnValue(() => {}),
		// Session management methods (for TabSwitcherModal and RenameSessionModal)
		getAllNamedSessions: vi.fn().mockResolvedValue([]),
		getSessionOrigins: vi.fn().mockResolvedValue({}),
		getOrigins: vi.fn().mockResolvedValue({}),
		setSessionName: vi.fn().mockResolvedValue(undefined),
		updateSessionName: vi.fn().mockResolvedValue(undefined),
		updateSessionStarred: vi.fn().mockResolvedValue(undefined),
		registerSessionOrigin: vi.fn().mockResolvedValue(undefined),
		// Subagent APIs
		listSubagents: vi.fn().mockResolvedValue([]),
		getSubagentMessages: vi.fn().mockResolvedValue({
			messages: [],
			total: 0,
			hasMore: false,
		}),
	},
	autorun: {
		readDoc: vi.fn().mockResolvedValue({ success: true, content: '' }),
		writeDoc: vi.fn().mockResolvedValue({ success: true }),
		watchFolder: vi.fn().mockReturnValue(() => {}),
		unwatchFolder: vi.fn(),
		readFolder: vi.fn().mockResolvedValue({ success: true, files: [] }),
		listDocs: vi.fn().mockResolvedValue({ success: true, files: [] }),
	},
	playbooks: {
		list: vi.fn().mockResolvedValue({ success: true, playbooks: [] }),
		create: vi.fn().mockResolvedValue({ success: true, playbook: {} }),
		update: vi.fn().mockResolvedValue({ success: true, playbook: {} }),
		delete: vi.fn().mockResolvedValue({ success: true }),
		export: vi.fn().mockResolvedValue({ success: true }),
		import: vi.fn().mockResolvedValue({ success: true, playbook: {} }),
	},
	marketplace: {
		getManifest: vi.fn().mockResolvedValue({
			success: true,
			manifest: { lastUpdated: '2025-01-01', playbooks: [] },
			fromCache: false,
		}),
		refreshManifest: vi.fn().mockResolvedValue({
			success: true,
			manifest: { lastUpdated: '2025-01-01', playbooks: [] },
			fromCache: false,
		}),
		getDocument: vi.fn().mockResolvedValue({ success: true, content: '' }),
		getReadme: vi.fn().mockResolvedValue({ success: true, content: null }),
		importPlaybook: vi.fn().mockResolvedValue({ success: true, playbook: {}, importedDocs: [] }),
		onManifestChanged: vi.fn().mockReturnValue(() => {}),
	},
	web: {
		broadcastAutoRunState: vi.fn(),
		broadcastSessionState: vi.fn(),
		start: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		getStatus: vi.fn().mockResolvedValue({ running: false }),
	},
	logger: {
		log: vi.fn(),
		error: vi.fn(),
		toast: vi.fn(),
		autorun: vi.fn(),
		getLogLevel: vi.fn().mockResolvedValue('info'),
		setLogLevel: vi.fn().mockResolvedValue(undefined),
		getMaxLogBuffer: vi.fn().mockResolvedValue(5000),
		setMaxLogBuffer: vi.fn().mockResolvedValue(undefined),
	},
	notification: {
		speak: vi.fn().mockResolvedValue({ success: true, ttsId: 1 }),
		stopSpeak: vi.fn().mockResolvedValue({ success: true }),
		onTtsCompleted: vi.fn().mockReturnValue(() => {}),
		show: vi.fn().mockResolvedValue(undefined),
	},
	dialog: {
		selectFolder: vi.fn().mockResolvedValue(null),
		saveFile: vi.fn().mockResolvedValue(null),
	},
	shells: {
		detect: vi.fn().mockResolvedValue([]),
	},
	shell: {
		openExternal: vi.fn().mockResolvedValue(undefined),
	},
	sync: {
		getDefaultPath: vi.fn().mockResolvedValue('/default/path'),
		getSettings: vi.fn().mockResolvedValue({ customSyncPath: undefined }),
		getCurrentStoragePath: vi.fn().mockResolvedValue('/current/path'),
		setCustomPath: vi.fn().mockResolvedValue(undefined),
		migrateStorage: vi.fn().mockResolvedValue({ success: true, migratedCount: 0 }),
		resetToDefault: vi.fn().mockResolvedValue({ success: true }),
	},
	stats: {
		recordQuery: vi.fn().mockResolvedValue({ success: true }),
		getAggregation: vi.fn().mockResolvedValue({
			totalQueries: 0,
			totalDuration: 0,
			avgDuration: 0,
			byAgent: {},
			bySource: { user: 0, auto: 0 },
			byDay: [],
		}),
		getStats: vi.fn().mockResolvedValue([]),
		startAutoRun: vi.fn().mockResolvedValue('auto-run-id'),
		endAutoRun: vi.fn().mockResolvedValue(true),
		recordAutoTask: vi.fn().mockResolvedValue('task-id'),
		getAutoRunSessions: vi.fn().mockResolvedValue([]),
		getAutoRunTasks: vi.fn().mockResolvedValue([]),
		exportCsv: vi.fn().mockResolvedValue(''),
		onStatsUpdate: vi.fn().mockReturnValue(() => {}),
		getDatabaseSize: vi.fn().mockResolvedValue(1024 * 1024), // 1MB mock
		clearOldData: vi.fn().mockResolvedValue({
			success: true,
			deletedQueryEvents: 0,
			deletedAutoRunSessions: 0,
			deletedAutoRunTasks: 0,
		}),
		// Session lifecycle tracking
		recordSessionCreated: vi.fn().mockResolvedValue('lifecycle-id'),
		recordSessionClosed: vi.fn().mockResolvedValue(true),
		getSessionLifecycle: vi.fn().mockResolvedValue([]),
	},
	sshRemote: {
		getConfigs: vi.fn().mockResolvedValue({ success: true, configs: [] }),
		getDefaultId: vi.fn().mockResolvedValue({ success: true, id: null }),
		setConfigs: vi.fn().mockResolvedValue({ success: true }),
		setDefaultId: vi.fn().mockResolvedValue({ success: true }),
		testConnection: vi.fn().mockResolvedValue({ success: true }),
		getSshConfigHosts: vi.fn().mockResolvedValue({
			success: true,
			hosts: [],
			configPath: '~/.ssh/config',
		}),
	},
	leaderboard: {
		submit: vi.fn().mockResolvedValue({ success: true, rank: 1 }),
		pollAuthStatus: vi.fn().mockResolvedValue({ status: 'confirmed', authToken: 'test-token' }),
		resendConfirmation: vi.fn().mockResolvedValue({ success: true }),
		sync: vi.fn().mockResolvedValue({ success: true }),
		getInstallationId: vi.fn().mockResolvedValue('test-installation-id'),
	},
	updates: {
		check: vi.fn().mockResolvedValue({ updateAvailable: false }),
		download: vi.fn().mockResolvedValue({ success: true }),
		install: vi.fn(),
		onStatus: vi.fn().mockReturnValue(() => {}),
		setAllowPrerelease: vi.fn().mockResolvedValue(undefined),
		checkNewModels: vi.fn().mockResolvedValue({ newModels: [], skipped: false }),
		getModelOptions: vi.fn().mockResolvedValue([]),
		addDetectedModel: vi.fn().mockResolvedValue(null),
	},
	honeycomb: {
		query: vi.fn().mockResolvedValue(null),
		isConfigured: vi.fn().mockResolvedValue(false),
		getRateLimitState: vi.fn().mockResolvedValue(null),
		getBackoffState: vi.fn().mockResolvedValue({ inBackoff: false, remainingMs: 0 }),
		clearCache: vi.fn().mockResolvedValue({ success: true }),
		getUsage: vi.fn().mockResolvedValue(null),
		refreshUsage: vi.fn().mockResolvedValue(null),
		isUsageServiceRunning: vi.fn().mockResolvedValue(false),
		onUsageUpdate: vi.fn().mockReturnValue(() => {}),
		getFlushStatus: vi.fn().mockResolvedValue(null),
	},
};

Object.defineProperty(window, 'maestro', {
	writable: true,
	value: mockMaestro,
});
