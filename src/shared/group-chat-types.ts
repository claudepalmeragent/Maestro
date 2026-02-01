/**
 * @file group-chat-types.ts
 * @description Shared type definitions and utilities for Group Chat feature.
 * Used by both main process and renderer.
 */

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Normalize a name for use in @mentions.
 * Replaces spaces with hyphens so names can be referenced without quotes.
 *
 * @param name - Original name (may contain spaces)
 * @returns Normalized name with hyphens instead of spaces
 */
export function normalizeMentionName(name: string): string {
	return name.replace(/\s+/g, '-');
}

/**
 * Extract the base name from a session name that may have a parenthetical description.
 * e.g., "agent-dev-1 (local micro-VM)" -> "agent-dev-1"
 *
 * @param name - Session name that may include description in parentheses
 * @returns The base name without the parenthetical description
 */
export function extractBaseName(name: string): string {
	// Match everything before optional whitespace and opening parenthesis
	const match = name.match(/^([^(]+?)(?:\s*\(.*\))?$/);
	return match ? match[1].trim() : name;
}

/**
 * Check if a name matches a mention target (handles normalized names).
 *
 * Handles these cases:
 * - Exact match: "agent-dev-1" matches "agent-dev-1"
 * - Normalized match: "My-Session" matches "My Session"
 * - Base name match: "agent-dev-1" matches "agent-dev-1 (local micro-VM)"
 *
 * @param mentionedName - The name from the @mention (may be hyphenated)
 * @param actualName - The actual session/participant name (may have spaces or parenthetical description)
 * @returns True if they match
 */
export function mentionMatches(mentionedName: string, actualName: string): boolean {
	const mentionLower = mentionedName.toLowerCase();
	const actualLower = actualName.toLowerCase();
	const normalizedActual = normalizeMentionName(actualName).toLowerCase();
	const baseName = extractBaseName(actualName).toLowerCase();
	const normalizedBaseName = normalizeMentionName(extractBaseName(actualName)).toLowerCase();

	return (
		mentionLower === actualLower ||
		mentionLower === normalizedActual ||
		mentionLower === baseName ||
		mentionLower === normalizedBaseName
	);
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Group chat participant
 */
export interface GroupChatParticipant {
	name: string;
	agentId: string;
	/** Internal process session ID (used for routing) */
	sessionId: string;
	/** Agent's session ID (e.g., Claude Code's session GUID for continuity) */
	agentSessionId?: string;
	addedAt: number;
	lastActivity?: number;
	lastSummary?: string;
	contextUsage?: number;
	// Color for this participant (assigned on join)
	color?: string;
	// Stats tracking
	tokenCount?: number;
	messageCount?: number;
	processingTimeMs?: number;
	/** Total cost in USD (optional, depends on provider) */
	totalCost?: number;
	/** SSH remote name (displayed as pill when running on SSH remote) */
	sshRemoteName?: string;
}

/**
 * SSH remote configuration for agents.
 * Re-exported here to avoid circular dependencies.
 */
export interface AgentSshRemoteConfig {
	/** Use SSH remote for this agent */
	enabled: boolean;
	/** Remote config ID to use (references SshRemoteConfig.id) */
	remoteId: string | null;
	/** Override working directory for this agent */
	workingDirOverride?: string;
}

/**
 * Custom configuration for an agent (moderator)
 */
export interface ModeratorConfig {
	/** Custom path to the agent binary */
	customPath?: string;
	/** Custom CLI arguments */
	customArgs?: string;
	/** Custom environment variables */
	customEnvVars?: Record<string, string>;
	/** SSH remote configuration for running moderator on remote host */
	sshRemoteConfig?: AgentSshRemoteConfig;
}

/**
 * Group chat metadata
 */
export interface GroupChat {
	id: string;
	name: string;
	createdAt: number;
	updatedAt?: number;
	moderatorAgentId: string;
	/** Internal session ID prefix used for routing (e.g., 'group-chat-{id}-moderator') */
	moderatorSessionId: string;
	/** Claude Code agent session UUID (set after first message is processed) */
	moderatorAgentSessionId?: string;
	/** Custom configuration for the moderator agent */
	moderatorConfig?: ModeratorConfig;
	participants: GroupChatParticipant[];
	logPath: string;
	imagesDir: string;
	draftMessage?: string;
	/**
	 * Project Folder this group chat belongs to (1:1 relationship).
	 * undefined = appears in "Unassigned" section.
	 */
	projectFolderId?: string;
}

/**
 * Group chat message entry from the chat log
 */
export interface GroupChatMessage {
	timestamp: string;
	from: string;
	content: string;
	readOnly?: boolean;
}

/**
 * Group chat state for UI display
 */
export type GroupChatState = 'idle' | 'moderator-thinking' | 'agent-working';

/**
 * Type of history entry in a group chat
 */
export type GroupChatHistoryEntryType = 'delegation' | 'response' | 'synthesis' | 'error';

/**
 * History entry for group chat activity tracking.
 * Stored in JSONL format in the group chat directory.
 */
export interface GroupChatHistoryEntry {
	/** Unique identifier for the entry */
	id: string;
	/** Timestamp when this entry was created */
	timestamp: number;
	/** One-sentence summary of what was accomplished */
	summary: string;
	/** Name of the participant who did the work (or 'Moderator' for synthesis) */
	participantName: string;
	/** Color assigned to this participant (for visualization) */
	participantColor: string;
	/** Type of activity */
	type: GroupChatHistoryEntryType;
	/** Time taken to complete the task (ms) */
	elapsedTimeMs?: number;
	/** Token count for this activity */
	tokenCount?: number;
	/** Cost in USD for this activity */
	cost?: number;
	/** Full response text (optional, for detail view) */
	fullResponse?: string;
}
