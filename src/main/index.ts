import { app, BrowserWindow, Menu, nativeTheme, powerMonitor } from 'electron';
import { isMacOS } from '../shared/platformDetection';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
// Sentry is imported dynamically below to avoid module-load-time access to electron.app
// which causes "Cannot read properties of undefined (reading 'getAppPath')" errors
import { ProcessManager } from './process-manager';
import { WebServer } from './web-server';
import { AgentDetector } from './agents';
import { logger } from './utils/logger';
import { tunnelManager } from './tunnel-manager';
import { powerManager } from './power-manager';
import { getHistoryManager } from './history-manager';
import {
	initializeStores,
	getEarlySettings,
	getSettingsStore,
	getSessionsStore,
	getGroupsStore,
	getAgentConfigsStore,
	getWindowStateStore,
	getClaudeSessionOriginsStore,
	getAgentSessionOriginsStore,
	getSshRemoteById,
} from './stores';
import {
	registerGitHandlers,
	registerAutorunHandlers,
	registerPlaybooksHandlers,
	registerHistoryHandlers,
	registerAgentsHandlers,
	registerProcessHandlers,
	registerPersistenceHandlers,
	registerSystemHandlers,
	registerClaudeHandlers,
	registerAgentSessionsHandlers,
	registerGroupChatHandlers,
	registerDebugHandlers,
	registerSpeckitHandlers,
	registerOpenSpecHandlers,
	registerContextHandlers,
	registerMarketplaceHandlers,
	registerStatsHandlers,
	registerAuditHandlers,
	registerReconstructionHandlers,
	registerDocumentGraphHandlers,
	registerSshRemoteHandlers,
	registerFilesystemHandlers,
	registerAttachmentsHandlers,
	registerWebHandlers,
	registerLeaderboardHandlers,
	registerNotificationsHandlers,
	registerProjectFoldersHandlers,
	registerPromptLibraryHandlers,
	registerKnowledgeGraphHandlers,
	registerFeedbackHandlers,
	registerGpuMonitorHandlers,
	registerHoneycombHandlers,
	registerSymphonyHandlers,
	registerTabNamingHandlers,
	registerAgentErrorHandlers,
	registerDirectorNotesHandlers,
	registerWakatimeHandlers,
	setupLoggerEventForwarding,
	cleanupAllGroomingSessions,
	getActiveGroomingSessionCount,
} from './ipc/handlers';
import {
	getHoneycombQueryClient,
	closeHoneycombQueryClient,
} from './services/honeycomb-query-client';
import {
	getHoneycombUsageService,
	closeHoneycombUsageService,
} from './services/honeycomb-usage-service';
import {
	getHoneycombArchiveService,
	closeHoneycombArchiveService,
} from './services/honeycomb-archive-service';
import { closeHoneycombArchiveDB } from './services/honeycomb-archive-db';
import { getLocalTokenLedger, closeLocalTokenLedger } from './services/local-token-ledger';
import { scheduleAudits, clearScheduledTimers } from './services/audit-scheduler';
import { initializeStatsDB, closeStatsDB, getStatsDB } from './stats';
import { groupChatEmitters } from './ipc/handlers/groupChat';
import {
	routeModeratorResponse,
	routeAgentResponse,
	setGetSessionsCallback,
	setGetCustomEnvVarsCallback,
	setGetAgentConfigCallback,
	setSshStore,
	setGetCustomShellPathCallback,
	markParticipantResponded,
	spawnModeratorSynthesis,
	getGroupChatReadOnlyState,
	respawnParticipantWithRecovery,
} from './group-chat/group-chat-router';
import { createSshRemoteStoreAdapter } from './utils/ssh-remote-resolver';
import { updateParticipant, loadGroupChat, updateGroupChat } from './group-chat/group-chat-storage';
import { needsSessionRecovery, initiateSessionRecovery } from './group-chat/session-recovery';
import { initializeSessionStorages } from './storage';
import { initializeOutputParsers } from './parsers';
import { calculateContextTokens } from './parsers/usage-aggregator';
import {
	DEMO_MODE,
	DEMO_DATA_PATH,
	REGEX_MODERATOR_SESSION,
	REGEX_MODERATOR_SESSION_TIMESTAMP,
	REGEX_AI_SUFFIX,
	REGEX_AI_TAB_ID,
	REGEX_BATCH_SESSION,
	REGEX_SYNOPSIS_SESSION,
	debugLog,
} from './constants';
// initAutoUpdater is now used by window-manager.ts (Phase 4 refactoring)
import { checkWslEnvironment } from './utils/wslDetector';
// Extracted modules (Phase 1 refactoring)
import { parseParticipantSessionId } from './group-chat/session-parser';
import { extractTextFromStreamJson } from './group-chat/output-parser';
import {
	appendToGroupChatBuffer,
	getGroupChatBufferedOutput,
	clearGroupChatBuffer,
} from './group-chat/output-buffer';
// Phase 2 refactoring - dependency injection
import { createSafeSend, isWebContentsAvailable } from './utils/safe-send';
import { createWebServerFactory } from './web-server/web-server-factory';
import { cleanupStaleSshSockets } from './utils/ssh-socket-cleanup';
import { sshHealthMonitor } from './services/ssh-health-monitor';
import type { SshRemoteConfig } from '../shared/types';
// Phase 4 refactoring - app lifecycle
import {
	setupGlobalErrorHandlers,
	createCliWatcher,
	createWindowManager,
	createQuitHandler,
} from './app-lifecycle';
// Phase 3 refactoring - process listeners
import { setupProcessListeners as setupProcessListenersModule } from './process-listeners';
import { setupWakaTimeListener } from './process-listeners/wakatime-listener';
import { WakaTimeManager } from './wakatime-manager';

// ============================================================================
// Data Directory Configuration (MUST happen before any Store initialization)
// ============================================================================
// Store type definitions are imported from ./stores/types.ts
const isDevelopment = process.env.NODE_ENV === 'development';

// Capture the production data path before any modification
// Used for stores that should be shared between dev and prod (e.g., agent configs)
const productionDataPath = app.getPath('userData');

// Demo mode: use a separate data directory for fresh demos
if (DEMO_MODE) {
	app.setPath('userData', DEMO_DATA_PATH);
	console.log(`[DEMO MODE] Using data directory: ${DEMO_DATA_PATH}`);
}

// Development mode: use a separate data directory to allow running alongside production
// This prevents database lock conflicts (e.g., Service Worker storage)
// Set USE_PROD_DATA=1 to use the production data directory instead (requires closing production app)
if (isDevelopment && !DEMO_MODE && !process.env.USE_PROD_DATA) {
	const devDataPath = path.join(app.getPath('userData'), '..', 'maestro-dev');
	app.setPath('userData', devDataPath);
	console.log(`[DEV MODE] Using data directory: ${devDataPath}`);
} else if (isDevelopment && process.env.USE_PROD_DATA) {
	console.log(`[DEV MODE] Using production data directory: ${app.getPath('userData')}`);
}

// ============================================================================
// Store Initialization (after userData path is configured)
// ============================================================================
// All stores are initialized via initializeStores() from ./stores module

const { syncPath, bootstrapStore } = initializeStores({ productionDataPath });

// Get early settings before Sentry init (for crash reporting and GPU acceleration)
const { crashReportingEnabled, disableGpuAcceleration, useNativeTitleBar, autoHideMenuBar } =
	getEarlySettings(syncPath);

// Disable GPU hardware acceleration if user has opted out or in WSL environment
// Must be called before app.ready event
// In WSL, GPU acceleration is auto-disabled due to EGL/GPU process crash issues
if (disableGpuAcceleration) {
	app.disableHardwareAcceleration();
	console.log('[STARTUP] GPU hardware acceleration disabled');
}

// Generate installation ID on first run (one-time generation)
// This creates a unique identifier per Maestro installation for telemetry differentiation
const store = getSettingsStore();
let installationId = store.get('installationId');
if (!installationId) {
	installationId = crypto.randomUUID();
	store.set('installationId', installationId);
	logger.info('Generated new installation ID', 'Startup', { installationId });
}

// Initialize WakaTime heartbeat manager
const wakatimeManager = new WakaTimeManager(store);

// Auto-install WakaTime CLI on startup if enabled
if (store.get('wakatimeEnabled', false)) {
	wakatimeManager.ensureCliInstalled();
}

// Auto-install WakaTime CLI when user enables the feature
store.onDidChange('wakatimeEnabled', (newValue) => {
	if (newValue === true) {
		wakatimeManager.ensureCliInstalled();
	}
});

// Initialize Sentry for crash reporting (dynamic import to avoid module-load-time errors)
// Only enable in production - skip during development to avoid noise from hot-reload artifacts
// The dynamic import is necessary because @sentry/electron accesses electron.app at module load time
// which fails if the module is imported before app.whenReady() in some Node/Electron version combinations
if (crashReportingEnabled && !isDevelopment) {
	import('@sentry/electron/main')
		.then(({ init, setTag, IPCMode }) => {
			init({
				dsn: 'https://2303c5f787f910863d83ed5d27ce8ed2@o4510554134740992.ingest.us.sentry.io/4510554135789568',
				// Set release version for better debugging
				release: app.getVersion(),
				// Use Classic IPC mode to avoid "sentry-ipc:// URL scheme not supported" errors
				// See: https://github.com/getsentry/sentry-electron/issues/661
				ipcMode: IPCMode.Classic,
				// Only send errors, not performance data
				tracesSampleRate: 0,
				// Filter out sensitive data
				beforeSend(event) {
					// Remove any potential sensitive data from the event
					if (event.user) {
						delete event.user.ip_address;
						delete event.user.email;
					}
					return event;
				},
			});
			// Add installation ID to Sentry for error correlation across installations
			setTag('installationId', installationId);

			// Start memory monitoring for crash diagnostics (MAESTRO-5A/4Y)
			// Records breadcrumbs with memory state every minute, warns above 500MB heap
			import('./utils/sentry').then(({ startMemoryMonitoring }) => {
				startMemoryMonitoring(500, 60000);
			});
		})
		.catch((err) => {
			logger.warn('Failed to initialize Sentry', 'Startup', { error: String(err) });
		});
}

// Create local references to stores for use throughout this module
// These are convenience variables - the actual stores are managed by ./stores module
const sessionsStore = getSessionsStore();
const groupsStore = getGroupsStore();
const agentConfigsStore = getAgentConfigsStore();
const windowStateStore = getWindowStateStore();
const claudeSessionOriginsStore = getClaudeSessionOriginsStore();
const agentSessionOriginsStore = getAgentSessionOriginsStore();

// Note: History storage is now handled by HistoryManager which uses per-session files
// in the history/ directory. The legacy maestro-history.json file is migrated automatically.
// See src/main/history-manager.ts for details.

let mainWindow: BrowserWindow | null = null;
let processManager: ProcessManager | null = null;
let webServer: WebServer | null = null;
let agentDetector: AgentDetector | null = null;

// Create safeSend with dependency injection (Phase 2 refactoring)
const safeSend = createSafeSend(() => mainWindow);

// Create CLI activity watcher with dependency injection (Phase 4 refactoring)
const cliWatcher = createCliWatcher({
	getMainWindow: () => mainWindow,
	getUserDataPath: () => app.getPath('userData'),
});

const devServerPort = process.env.VITE_PORT ? parseInt(process.env.VITE_PORT, 10) : 5173;
const devServerUrl = `http://localhost:${devServerPort}`;

// Create window manager with dependency injection (Phase 4 refactoring)
const windowManager = createWindowManager({
	windowStateStore,
	isDevelopment,
	preloadPath: path.join(__dirname, 'preload.js'),
	rendererPath: path.join(__dirname, '../renderer/index.html'),
	devServerUrl: devServerUrl,
	useNativeTitleBar,
	autoHideMenuBar,
});

// Create web server factory with dependency injection (Phase 2 refactoring)
const createWebServer = createWebServerFactory({
	settingsStore: store,
	sessionsStore,
	groupsStore,
	getMainWindow: () => mainWindow,
	getProcessManager: () => processManager,
});

// createWindow is now handled by windowManager (Phase 4 refactoring)
// The window manager creates and configures the BrowserWindow with:
// - Window state persistence (position, size, maximized/fullscreen)
// - DevTools installation in development
// - Auto-updater initialization in production
function createWindow() {
	mainWindow = windowManager.createWindow();
	// Handle closed event to clear the reference
	mainWindow.on('closed', () => {
		mainWindow = null;
	});
}

// Set up global error handlers for uncaught exceptions (Phase 4 refactoring)
setupGlobalErrorHandlers();

app.whenReady().then(async () => {
	// Load logger settings first
	const logLevel = store.get('logLevel', 'info');
	logger.setLogLevel(logLevel);
	const maxLogBuffer = store.get('maxLogBuffer', 1000);
	logger.setMaxLogBuffer(maxLogBuffer);

	logger.info('Maestro application starting', 'Startup', {
		version: app.getVersion(),
		platform: process.platform,
		logLevel,
	});

	// Check for WSL + Windows mount issues early
	checkWslEnvironment(process.cwd());

	// Clean up stale SSH sockets from previous sessions
	cleanupStaleSshSockets();

	// Establish dedicated SSH ControlMaster connections for all configured remotes
	// This ensures master connections exist BEFORE any concurrent operations fire,
	// eliminating the "ControlSocket already exists" race condition
	try {
		const sshRemotes: SshRemoteConfig[] = store.get('sshRemotes', []);
		const enabledRemotes = sshRemotes.filter((r) => r.enabled !== false);

		if (enabledRemotes.length > 0) {
			logger.info(`Establishing SSH masters for ${enabledRemotes.length} remote(s)`, 'Startup');

			for (const remote of enabledRemotes) {
				// Register with health monitor (so it tracks and maintains the connection)
				sshHealthMonitor.addRemote({
					remoteId: remote.id,
					host: remote.host,
					port: remote.port,
					username: remote.username,
					privateKeyPath: remote.privateKeyPath,
					useSshConfig: remote.useSshConfig,
				});

				// Establish dedicated master connection (async, non-blocking)
				sshHealthMonitor
					.establishMaster({
						remoteId: remote.id,
						host: remote.host,
						port: remote.port,
						username: remote.username,
						privateKeyPath: remote.privateKeyPath,
						useSshConfig: remote.useSshConfig,
					})
					.catch((err) => {
						logger.debug(
							`Startup master establishment failed for ${remote.host}: ${err}`,
							'Startup'
						);
					});
			}
		}
	} catch (err) {
		// Non-critical — health monitor will establish masters on first health check
		logger.warn(`Failed to establish SSH masters at startup: ${err}`, 'Startup');
	}

	// Start SSH health monitor (after socket cleanup and initial master establishment)
	sshHealthMonitor.start();

	// Initialize core services
	logger.info('Initializing core services', 'Startup');
	processManager = new ProcessManager();
	// Note: webServer is created on-demand when user enables web interface (see setupWebServerCallbacks)
	agentDetector = new AgentDetector();

	// Load custom agent paths from settings
	const allAgentConfigs = agentConfigsStore.get('configs', {});
	const customPaths: Record<string, string> = {};
	for (const [agentId, config] of Object.entries(allAgentConfigs)) {
		if (config && typeof config === 'object' && 'customPath' in config && config.customPath) {
			customPaths[agentId] = config.customPath as string;
		}
	}
	if (Object.keys(customPaths).length > 0) {
		agentDetector.setCustomPaths(customPaths);
		logger.info(`Loaded custom agent paths: ${JSON.stringify(customPaths)}`, 'Startup');
	}

	logger.info('Core services initialized', 'Startup');

	// Initialize Honeycomb query client
	const honeycombClient = getHoneycombQueryClient();
	if (honeycombClient.isConfigured()) {
		logger.info('Honeycomb query client initialized', 'Startup');
	} else {
		logger.info(
			'Honeycomb query client initialized (not configured — set HONEYCOMB_API_KEY or configure in Settings)',
			'Startup'
		);
	}

	// Start Honeycomb usage polling service
	const honeycombUsageService = getHoneycombUsageService();
	honeycombUsageService.start();

	// Run Honeycomb archival on startup (runs before usage polling begins)
	const honeycombArchiveService = getHoneycombArchiveService();
	honeycombArchiveService
		.runArchival()
		.catch((err) => logger.error(`Startup archival failed: ${err.message}`, 'Startup'));

	// Initialize LocalTokenLedger for OTEL flush gap mitigation
	// Token recording is wired via usage-listener.ts (processManager 'usage' events)
	// Reconciliation will be wired when HoneycombUsageService (Doc 30) is implemented
	const ledger = getLocalTokenLedger();
	logger.info(
		`LocalTokenLedger initialized (tracking ${ledger.getSessionCount()} sessions)`,
		'Startup'
	);

	// Initialize history manager (handles migration from legacy format if needed)
	logger.info('Initializing history manager', 'Startup');
	const historyManager = getHistoryManager();
	try {
		await historyManager.initialize();
		logger.info('History manager initialized', 'Startup');
		// Start watching history directory for external changes (from CLI, etc.)
		historyManager.startWatching((sessionId) => {
			logger.debug(
				`History file changed for session ${sessionId}, notifying renderer`,
				'HistoryWatcher'
			);
			if (isWebContentsAvailable(mainWindow)) {
				mainWindow.webContents.send('history:externalChange', sessionId);
			}
		});
	} catch (error) {
		// Migration failed - log error but continue with app startup
		// History will be unavailable but the app will still function
		logger.error(`Failed to initialize history manager: ${error}`, 'Startup');
		logger.warn('Continuing without history - history features will be unavailable', 'Startup');
	}

	// Initialize stats database for usage tracking
	logger.info('Initializing stats database', 'Startup');
	try {
		initializeStatsDB();
		logger.info('Stats database initialized', 'Startup');

		// Start audit scheduler (requires stats DB to be initialized)
		scheduleAudits().catch((error) => {
			logger.warn(`Failed to start audit scheduler: ${error}`, 'Startup');
		});
	} catch (error) {
		// Stats initialization failed - log error but continue with app startup
		// Stats will be unavailable but the app will still function
		logger.error(`Failed to initialize stats database: ${error}`, 'Startup');
		logger.warn('Continuing without stats - usage tracking will be unavailable', 'Startup');
	}

	// Set up IPC handlers
	logger.debug('Setting up IPC handlers', 'Startup');
	setupIpcHandlers();

	// Set up process event listeners
	logger.debug('Setting up process event listeners', 'Startup');
	setupProcessListeners();

	// Set custom application menu to prevent macOS from injecting native
	// "Show Previous Tab" (Cmd+Shift+{) and "Show Next Tab" (Cmd+Shift+})
	// menu items into the default Window menu. Without this, those keyboard
	// events are intercepted at the NSMenu level and never reach the renderer.
	if (isMacOS()) {
		const template: Electron.MenuItemConstructorOptions[] = [
			{ role: 'appMenu' },
			{ role: 'editMenu' },
			{
				label: 'View',
				submenu: [{ role: 'toggleDevTools' }],
			},
			{
				label: 'Window',
				submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }],
			},
		];
		Menu.setApplicationMenu(Menu.buildFromTemplate(template));
	} else {
		// On Windows/Linux, set a minimal menu with DevTools toggle so Ctrl+Shift+I works.
		// The menu bar itself stays hidden via autoHideMenuBar in window options,
		// but the accelerator is still active.
		const template: Electron.MenuItemConstructorOptions[] = [
			{
				label: 'View',
				submenu: [{ role: 'toggleDevTools' }],
			},
		];
		Menu.setApplicationMenu(Menu.buildFromTemplate(template));
	}

	// Create main window
	logger.info('Creating main window', 'Startup');
	createWindow();

	// Note: History file watching is handled by HistoryManager.startWatching() above
	// which uses the new per-session file format in the history/ directory

	// Listen for native theme changes and forward to renderer
	// This provides native Electron integration alongside the CSS media query approach
	nativeTheme.on('updated', () => {
		if (mainWindow && !mainWindow.isDestroyed()) {
			mainWindow.webContents.send('system-theme-changed', nativeTheme.shouldUseDarkColors);
		}
	});

	// Start CLI activity watcher (Phase 4 refactoring)
	cliWatcher.start();

	// Note: Web server is not auto-started - it starts when user enables web interface
	// via live:startServer IPC call from the renderer

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});

	// Listen for system resume (after sleep/suspend) and notify renderer
	// This allows the renderer to refresh settings that may have been reset
	powerMonitor.on('resume', () => {
		logger.info('System resumed from sleep/suspend', 'PowerMonitor');
		if (isWebContentsAvailable(mainWindow)) {
			mainWindow.webContents.send('app:systemResume');
		}
	});
});

app.on('window-all-closed', () => {
	if (!isMacOS()) {
		app.quit();
	}
});

// Create and setup quit handler with dependency injection (Phase 4 refactoring)
const quitHandler = createQuitHandler({
	getMainWindow: () => mainWindow,
	getProcessManager: () => processManager,
	getWebServer: () => webServer,
	getHistoryManager,
	tunnelManager,
	getActiveGroomingSessionCount,
	cleanupAllGroomingSessions,
	closeStatsDB,
	stopCliWatcher: () => cliWatcher.stop(),
	stopAuditScheduler: () => clearScheduledTimers(),
	closeHoneycombQueryClient,
	closeHoneycombUsageService,
	closeHoneycombArchiveService,
	closeHoneycombArchiveDB,
	closeLocalTokenLedger,
});
quitHandler.setup();

// startCliActivityWatcher is now handled by cliWatcher (Phase 4 refactoring)

function setupIpcHandlers() {
	// Settings, sessions, and groups persistence - extracted to src/main/ipc/handlers/persistence.ts

	// Web/Live handlers - extracted to src/main/ipc/handlers/web.ts
	registerWebHandlers({
		getWebServer: () => webServer,
		setWebServer: (server) => {
			webServer = server;
		},
		createWebServer,
	});

	// Git operations - extracted to src/main/ipc/handlers/git.ts
	registerGitHandlers({
		settingsStore: store,
	});

	// Auto Run operations - extracted to src/main/ipc/handlers/autorun.ts
	registerAutorunHandlers({
		mainWindow,
		getMainWindow: () => mainWindow,
		app,
		settingsStore: store,
	});

	// Playbook operations - extracted to src/main/ipc/handlers/playbooks.ts
	registerPlaybooksHandlers({
		mainWindow,
		getMainWindow: () => mainWindow,
		app,
	});

	// History operations - extracted to src/main/ipc/handlers/history.ts
	// Uses HistoryManager singleton for per-session storage
	registerHistoryHandlers();

	// Director's Notes - unified history + synopsis generation
	registerDirectorNotesHandlers({
		getProcessManager: () => processManager,
		getAgentDetector: () => agentDetector,
		agentConfigsStore,
	});

	// Agent management operations - extracted to src/main/ipc/handlers/agents.ts
	registerAgentsHandlers({
		getAgentDetector: () => agentDetector,
		agentConfigsStore,
		settingsStore: store,
	});

	// Process management operations - extracted to src/main/ipc/handlers/process.ts
	registerProcessHandlers({
		getProcessManager: () => processManager,
		getAgentDetector: () => agentDetector,
		agentConfigsStore,
		settingsStore: store,
		getMainWindow: () => mainWindow,
		sessionsStore,
	});

	// Persistence operations - extracted to src/main/ipc/handlers/persistence.ts
	registerPersistenceHandlers({
		settingsStore: store,
		sessionsStore,
		groupsStore,
		getWebServer: () => webServer,
	});

	// System operations - extracted to src/main/ipc/handlers/system.ts
	registerSystemHandlers({
		getMainWindow: () => mainWindow,
		app,
		settingsStore: store,
		tunnelManager,
		getWebServer: () => webServer,
		bootstrapStore, // For iCloud/sync settings
	});

	// Claude Code sessions - extracted to src/main/ipc/handlers/claude.ts
	registerClaudeHandlers({
		claudeSessionOriginsStore,
		getMainWindow: () => mainWindow,
	});

	// Initialize output parsers for all agents (Codex, OpenCode, Claude Code)
	// This must be called before any agent output is processed
	initializeOutputParsers();

	// Initialize session storages and register generic agent sessions handlers
	// This provides the new window.maestro.agentSessions.* API
	// Pass the shared claudeSessionOriginsStore so session names/stars are consistent
	initializeSessionStorages({ claudeSessionOriginsStore });
	registerAgentSessionsHandlers({
		getMainWindow: () => mainWindow,
		agentSessionOriginsStore,
		settingsStore: store,
	});

	// Helper to get agent config values (custom args/env vars, model, etc.)
	const getAgentConfigForAgent = (agentId: string): Record<string, any> => {
		const allConfigs = agentConfigsStore.get('configs', {});
		return allConfigs[agentId] || {};
	};

	// Helper to get custom env vars for an agent
	const getCustomEnvVarsForAgent = (agentId: string): Record<string, string> | undefined => {
		return getAgentConfigForAgent(agentId).customEnvVars as Record<string, string> | undefined;
	};

	// Register Group Chat handlers
	registerGroupChatHandlers({
		getMainWindow: () => mainWindow,
		getProcessManager: () => processManager,
		getAgentDetector: () => agentDetector,
		getCustomEnvVars: getCustomEnvVarsForAgent,
		getAgentConfig: getAgentConfigForAgent,
	});

	// Register Debug Package handlers
	registerDebugHandlers({
		getMainWindow: () => mainWindow,
		getAgentDetector: () => agentDetector,
		getProcessManager: () => processManager,
		getWebServer: () => webServer,
		settingsStore: store,
		sessionsStore,
		groupsStore,
		bootstrapStore,
	});

	// Register Spec Kit handlers (no dependencies needed)
	registerSpeckitHandlers();

	// Register OpenSpec handlers (no dependencies needed)
	registerOpenSpecHandlers();

	// Register Context Merge handlers for session context transfer and grooming
	registerContextHandlers({
		getMainWindow: () => mainWindow,
		getProcessManager: () => processManager,
		getAgentDetector: () => agentDetector,
		agentConfigsStore,
	});

	// Register Marketplace handlers for fetching and importing playbooks
	registerMarketplaceHandlers({
		app,
		settingsStore: store,
	});

	// Register Stats handlers for usage tracking
	registerStatsHandlers({
		getMainWindow: () => mainWindow,
		settingsStore: store,
	});

	// Register Audit handlers for Anthropic cost comparison
	registerAuditHandlers({
		getMainWindow: () => mainWindow,
	});

	// Register Reconstruction handlers for historical data reconstruction
	registerReconstructionHandlers({
		getMainWindow: () => mainWindow,
	});

	// Register Document Graph handlers for file watching
	registerDocumentGraphHandlers({
		getMainWindow: () => mainWindow,
		app,
	});

	// Register SSH Remote handlers for managing SSH configurations
	registerSshRemoteHandlers({
		settingsStore: store,
	});

	// Set up callback for group chat router to lookup sessions for auto-add @mentions
	setGetSessionsCallback(() => {
		const sessions = sessionsStore.get('sessions', []);
		return sessions.map((s: any) => {
			// Resolve SSH remote name and ID if session has SSH config
			// Check multiple possible locations since sshRemoteId is only set after AI agent spawns
			// but sessionSshRemoteConfig is set at session creation time
			let sshRemoteName: string | undefined;
			let sshRemoteId: string | undefined;

			// Try sessionSshRemoteConfig first (set at session creation)
			if (s.sessionSshRemoteConfig?.enabled && s.sessionSshRemoteConfig.remoteId) {
				sshRemoteId = s.sessionSshRemoteConfig.remoteId as string;
			}
			// Fall back to sshRemoteId (set after AI agent spawns)
			else if (s.sshRemoteId) {
				sshRemoteId = s.sshRemoteId;
			}
			// Fall back to sshRemote.id (alternative storage location)
			else if (s.sshRemote?.id) {
				sshRemoteId = s.sshRemote.id;
			}

			// Resolve the display name from the SSH remote config
			if (sshRemoteId) {
				const sshConfig = getSshRemoteById(sshRemoteId);
				sshRemoteName = sshConfig?.name;
			}

			return {
				id: s.id,
				name: s.name,
				toolType: s.toolType,
				cwd: s.cwd || s.fullPath || os.homedir(),
				customArgs: s.customArgs,
				customEnvVars: s.customEnvVars,
				customModel: s.customModel,
				sshRemoteName,
				sshRemoteId,
				// Pass full SSH config for remote execution support
				sshRemoteConfig: s.sessionSshRemoteConfig,
			};
		});
	});

	// Set up callback for group chat router to lookup custom env vars for agents
	setGetCustomEnvVarsCallback(getCustomEnvVarsForAgent);
	setGetAgentConfigCallback(getAgentConfigForAgent);

	// Set up SSH store for group chat SSH remote execution support
	setSshStore(createSshRemoteStoreAdapter(store));

	// Set up callback for group chat to get custom shell path (for Windows PowerShell preference)
	// This is used by both group-chat-router.ts and group-chat-agent.ts via the shared config module
	const getCustomShellPathFn = () => store.get('customShellPath', '') as string | undefined;
	setGetCustomShellPathCallback(getCustomShellPathFn);

	// Setup logger event forwarding to renderer
	setupLoggerEventForwarding(() => mainWindow);

	// Register filesystem handlers (extracted to handlers/filesystem.ts)
	registerFilesystemHandlers();

	// System operations (dialog, fonts, shells, tunnel, devtools, updates, logger)
	// extracted to src/main/ipc/handlers/system.ts

	// Claude Code sessions - extracted to src/main/ipc/handlers/claude.ts

	// Agent Error Handling API - extracted to src/main/ipc/handlers/agent-error.ts
	registerAgentErrorHandlers();

	// Register notification handlers (extracted to handlers/notifications.ts)
	registerNotificationsHandlers();

	// Register attachments handlers (extracted to handlers/attachments.ts)
	registerAttachmentsHandlers({ app });

	// Register leaderboard handlers (extracted to handlers/leaderboard.ts)
	registerLeaderboardHandlers({
		app,
		settingsStore: store,
	});

	// Register project folders handlers (extracted to handlers/projectFolders.ts)
	registerProjectFoldersHandlers();

	// Register prompt library handlers (extracted to handlers/prompt-library.ts)
	registerPromptLibraryHandlers();

	// Register knowledge graph handlers (no dependencies - uses userData path directly)
	registerKnowledgeGraphHandlers();

	// Register feedback handlers (no dependencies - uses userData path directly)
	registerFeedbackHandlers();

	// Register GPU monitor handlers (no dependencies - uses local system probing)
	registerGpuMonitorHandlers();

	// Register Honeycomb query handlers (no dependencies - uses singleton client)
	registerHoneycombHandlers();

	// Register Symphony handlers for token donation / open source contributions
	registerSymphonyHandlers({
		app,
		getMainWindow: () => mainWindow,
		sessionsStore,
	});

	// Register tab naming handlers for automatic tab naming
	registerTabNamingHandlers({
		getProcessManager: () => processManager,
		getAgentDetector: () => agentDetector,
		agentConfigsStore,
		settingsStore: store,
	});

	// Register WakaTime handlers (CLI check, API key validation)
	registerWakatimeHandlers(wakatimeManager);
}

// Handle process output streaming (set up after initialization)
// Phase 3 refactoring - delegates to extracted process-listeners module
function setupProcessListeners() {
	if (processManager) {
		setupProcessListenersModule(processManager, {
			getProcessManager: () => processManager,
			getWebServer: () => webServer,
			getAgentDetector: () => agentDetector,
			safeSend,
			powerManager,
			groupChatEmitters,
			groupChatRouter: {
				routeModeratorResponse,
				routeAgentResponse,
				markParticipantResponded,
				spawnModeratorSynthesis,
				getGroupChatReadOnlyState,
				respawnParticipantWithRecovery,
			},
			groupChatStorage: {
				loadGroupChat,
				updateGroupChat,
				updateParticipant,
			},
			sessionRecovery: {
				needsSessionRecovery,
				initiateSessionRecovery,
			},
			outputBuffer: {
				appendToGroupChatBuffer,
				getGroupChatBufferedOutput,
				clearGroupChatBuffer,
			},
			outputParser: {
				extractTextFromStreamJson,
				parseParticipantSessionId,
			},
			usageAggregator: {
				calculateContextTokens,
			},
			getStatsDB,
			debugLog,
			patterns: {
				REGEX_MODERATOR_SESSION,
				REGEX_MODERATOR_SESSION_TIMESTAMP,
				REGEX_AI_SUFFIX,
				REGEX_AI_TAB_ID,
				REGEX_BATCH_SESSION,
				REGEX_SYNOPSIS_SESSION,
			},
			logger,
		});

		// WakaTime heartbeat listener (query-complete → heartbeat, exit → cleanup)
		setupWakaTimeListener(processManager, wakatimeManager, store);
	}
}
