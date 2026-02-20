/**
 * Store Default Values
 *
 * Centralized default values for all stores.
 * Separated for easy modification and testing.
 */

import path from 'path';

import type {
	MaestroSettings,
	SessionsData,
	GroupsData,
	ProjectFoldersData,
	AgentConfigsData,
	WindowState,
	ClaudeSessionOriginsData,
	AgentSessionOriginsData,
} from './types';

// ============================================================================
// Utility Functions for Defaults
// ============================================================================

/**
 * Get the default shell based on the current platform.
 */
export function getDefaultShell(): string {
	// Windows: $SHELL doesn't exist; default to PowerShell
	if (process.platform === 'win32') {
		return 'powershell';
	}
	// Unix: Respect user's configured login shell from $SHELL
	const shellPath = process.env.SHELL;
	if (shellPath) {
		const shellName = path.basename(shellPath);
		// Valid Unix shell IDs from shellDetector.ts
		if (['bash', 'zsh', 'fish', 'sh', 'tcsh'].includes(shellName)) {
			return shellName;
		}
	}
	// Fallback to bash (more portable than zsh on older Unix systems)
	return 'bash';
}

// ============================================================================
// Store Defaults
// ============================================================================

export const SETTINGS_DEFAULTS: MaestroSettings = {
	activeThemeId: 'dracula',
	llmProvider: 'openrouter',
	modelSlug: 'anthropic/claude-3.5-sonnet',
	apiKey: '',
	shortcuts: {},
	fontSize: 14,
	fontFamily: 'Roboto Mono, Menlo, "Courier New", monospace',
	customFonts: [],
	logLevel: 'info',
	defaultShell: getDefaultShell(),
	webAuthEnabled: false,
	webAuthToken: null,
	webInterfaceUseCustomPort: false,
	webInterfaceCustomPort: 8080,
	sshRemotes: [],
	defaultSshRemoteId: null,
	installationId: null,
	synopsisEnabled: true,
	sshStatsTimeoutMs: 30000,
	globalStatsRefreshIntervalMs: 900000, // 15 minutes default
	// Honeycomb integration
	honeycombApiKey: '',
	honeycombDatasetSlug: 'claude-code',
	honeycombEnvironmentSlug: 'claudepalmeragent',
	honeycombEnabled: true,
	honeycombPollIntervalMs: 300000, // 5 minutes
	honeycombPauseOnMinimize: true,
	honeycombDataSource: 'mcp',
	honeycombMcpApiKey: '',
	honeycombMcpRegion: 'us',
	// Honeycomb usage warning settings
	honeycombWarningSettings: {
		honeycombWarningsEnabled: true,
		fiveHourWarningYellowUsd: 40,
		fiveHourWarningRedUsd: 60,
		fiveHourWarningYellowPct: 60,
		fiveHourWarningRedPct: 85,
		weeklyWarningYellowUsd: 400,
		weeklyWarningRedUsd: 500,
		weeklyWarningYellowPct: 70,
		weeklyWarningRedPct: 90,
		monthlySessionsWarning: 40,
		honeycombPollIntervalMs: 300000,
		warningMode: 'both' as const,
		safetyBufferPct: 20,
		capacityCheckAutoRun: true,
		capacityCheckInteractive: true,
		archiveEnabled: true,
	},
};

export const SESSIONS_DEFAULTS: SessionsData = {
	sessions: [],
};

export const GROUPS_DEFAULTS: GroupsData = {
	groups: [],
};

export const PROJECT_FOLDERS_DEFAULTS: ProjectFoldersData = {
	folders: [],
};

export const AGENT_CONFIGS_DEFAULTS: AgentConfigsData = {
	configs: {},
};

export const WINDOW_STATE_DEFAULTS: WindowState = {
	width: 1400,
	height: 900,
	isMaximized: false,
	isFullScreen: false,
};

export const CLAUDE_SESSION_ORIGINS_DEFAULTS: ClaudeSessionOriginsData = {
	origins: {},
};

export const AGENT_SESSION_ORIGINS_DEFAULTS: AgentSessionOriginsData = {
	origins: {},
};
