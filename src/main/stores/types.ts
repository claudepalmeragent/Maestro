/**
 * Store type definitions
 *
 * Centralized type definitions for all electron-store instances.
 * These types are used across the main process for type-safe store access.
 */

import type {
	SshRemoteConfig,
	Group,
	ProjectFolder,
	ClaudeModelId,
	ClaudeBillingMode,
} from '../../shared/types';

// ============================================================================
// Stored Session Type (minimal interface for main process storage)
// ============================================================================

/**
 * Minimal session interface for main process storage.
 * The full Session type is defined in renderer/types/index.ts and has 60+ fields.
 * This interface captures the required fields that the main process needs to understand,
 * while allowing additional properties via index signature for forward compatibility.
 *
 * Note: We use `any` for the index signature instead of `unknown` to maintain
 * backward compatibility with existing code that accesses dynamic session properties.
 */
export interface StoredSession {
	id: string;
	groupId?: string;
	name: string;
	toolType: string;
	cwd: string;
	projectRoot: string;
	[key: string]: any; // Allow additional renderer-specific fields
}

// ============================================================================
// Bootstrap Store (local-only, determines sync path)
// ============================================================================

export interface BootstrapSettings {
	customSyncPath?: string;
	iCloudSyncEnabled?: boolean; // Legacy - kept for backwards compatibility during migration
}

// ============================================================================
// Settings Store
// ============================================================================

export interface MaestroSettings {
	activeThemeId: string;
	llmProvider: string;
	modelSlug: string;
	apiKey: string;
	shortcuts: Record<string, any>;
	fontSize: number;
	fontFamily: string;
	customFonts: string[];
	logLevel: 'debug' | 'info' | 'warn' | 'error';
	defaultShell: string;
	// Web interface authentication
	webAuthEnabled: boolean;
	webAuthToken: string | null;
	// Web interface custom port
	webInterfaceUseCustomPort: boolean;
	webInterfaceCustomPort: number;
	// SSH remote execution
	sshRemotes: SshRemoteConfig[];
	defaultSshRemoteId: string | null;
	// Unique installation identifier (generated once on first run)
	installationId: string | null;
	// Synopsis generation toggle for interactive sessions
	synopsisEnabled?: boolean;
	/** Timeout in milliseconds for fetching stats from SSH remotes (default: 30000) */
	sshStatsTimeoutMs?: number;
	/** Auto-refresh interval for Global Stats in milliseconds (default: 900000 = 15 minutes) */
	globalStatsRefreshIntervalMs?: number;
}

// ============================================================================
// Sessions Store
// ============================================================================

export interface SessionsData {
	sessions: StoredSession[];
}

// ============================================================================
// Groups Store
// ============================================================================

export interface GroupsData {
	groups: Group[];
}

// ============================================================================
// Project Folders Store
// ============================================================================

export interface ProjectFoldersData {
	folders: ProjectFolder[];
}

// ============================================================================
// Agent Configs Store
// ============================================================================

/**
 * Agent-level pricing configuration.
 * Stored per-agent in AgentConfigsData.configs[agentId].pricingConfig
 */
export interface AgentPricingConfig {
	/** User-selected billing mode, or 'auto' for auto-detection */
	billingMode: 'auto' | ClaudeBillingMode;

	/** User-selected model for pricing, or 'auto' for auto-detection */
	pricingModel: 'auto' | ClaudeModelId;

	/** Last detected model from agent output */
	detectedModel?: ClaudeModelId;

	/** Last detected billing mode from credentials */
	detectedBillingMode?: ClaudeBillingMode;

	/** Timestamp of last detection */
	detectedAt?: number;
}

/**
 * Project folder-level pricing configuration.
 * Default billing mode for all agents within a project folder.
 */
export interface ProjectFolderPricingConfig {
	/** Default billing mode for all agents in this folder */
	billingMode: ClaudeBillingMode;
}

export interface AgentConfigsData {
	configs: Record<string, Record<string, any>>; // agentId -> config key-value pairs
}

// ============================================================================
// Window State Store (local-only, per-device)
// ============================================================================

export interface WindowState {
	x?: number;
	y?: number;
	width: number;
	height: number;
	isMaximized: boolean;
	isFullScreen: boolean;
}

// ============================================================================
// Claude Session Origins Store
// ============================================================================

export type ClaudeSessionOrigin = 'user' | 'auto';

export interface ClaudeSessionOriginInfo {
	origin: ClaudeSessionOrigin;
	sessionName?: string; // User-defined session name from Maestro
	starred?: boolean; // Whether the session is starred
	contextUsage?: number; // Last known context window usage percentage (0-100)
}

export interface ClaudeSessionOriginsData {
	// Map of projectPath -> { agentSessionId -> origin info }
	origins: Record<string, Record<string, ClaudeSessionOrigin | ClaudeSessionOriginInfo>>;
}

// ============================================================================
// Agent Session Origins Store (generic, for non-Claude agents)
// ============================================================================

export interface AgentSessionOriginsData {
	// Structure: { [agentId]: { [projectPath]: { [sessionId]: { origin, sessionName, starred } } } }
	origins: Record<
		string,
		Record<
			string,
			Record<string, { origin?: 'user' | 'auto'; sessionName?: string; starred?: boolean }>
		>
	>;
}
