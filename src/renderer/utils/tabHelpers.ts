// Tab helper functions for AI multi-tab support
// These helpers manage AITab state within Maestro sessions

import {
	Session,
	AITab,
	ClosedTab,
	ClosedTabEntry,
	FilePreviewTab,
	UnifiedTab,
	UnifiedTabRef,
	LogEntry,
	UsageStats,
	ToolType,
	ThinkingMode,
} from '../types';
import { generateId } from './ids';
import { getAutoRunFolderPath } from './existingDocsDetector';

/**
 * Build the unified tab list from a session's tab data.
 * Follows unifiedTabOrder, then appends any orphaned tabs as a safety net
 * (e.g., from migration or state corruption).
 *
 * Single source of truth — used by useTabHandlers and tabStore selectors.
 */
export function buildUnifiedTabs(session: Session): UnifiedTab[] {
	if (!session) return [];
	const { aiTabs, filePreviewTabs, unifiedTabOrder } = session;

	const aiTabMap = new Map((aiTabs || []).map((tab) => [tab.id, tab]));
	const fileTabMap = new Map((filePreviewTabs || []).map((tab) => [tab.id, tab]));

	const result: UnifiedTab[] = [];

	// Follow unified order for tabs that have entries
	for (const ref of unifiedTabOrder || []) {
		if (ref.type === 'ai') {
			const tab = aiTabMap.get(ref.id);
			if (tab) {
				result.push({ type: 'ai', id: ref.id, data: tab });
				aiTabMap.delete(ref.id);
			}
		} else {
			const tab = fileTabMap.get(ref.id);
			if (tab) {
				result.push({ type: 'file', id: ref.id, data: tab });
				fileTabMap.delete(ref.id);
			}
		}
	}

	// Append any orphaned tabs not in unified order (data integrity fallback)
	for (const [id, tab] of aiTabMap) {
		result.push({ type: 'ai', id, data: tab });
	}
	for (const [id, tab] of fileTabMap) {
		result.push({ type: 'file', id, data: tab });
	}

	return result;
}

/**
 * Ensure a tab ID is present in unifiedTabOrder.
 * Returns the order unchanged if already present, or with the tab appended.
 */
export function ensureInUnifiedTabOrder(
	unifiedTabOrder: UnifiedTabRef[],
	type: 'ai' | 'file',
	id: string
): UnifiedTabRef[] {
	const exists = unifiedTabOrder.some((ref) => ref.type === type && ref.id === id);
	if (exists) return unifiedTabOrder;
	return [...unifiedTabOrder, { type, id }];
}

/**
 * Get a repaired unifiedTabOrder that includes any orphaned tabs.
 * Follows the existing unifiedTabOrder, then appends tabs that exist in
 * aiTabs/filePreviewTabs but are missing from the order.
 *
 * This keeps navigation in sync with rendering (which uses buildUnifiedTabs).
 * Returns the original array unchanged if no orphans are found (no allocation).
 */
export function getRepairedUnifiedTabOrder(session: Session): UnifiedTabRef[] {
	const order = session.unifiedTabOrder || [];
	const aiTabs = session.aiTabs || [];
	const fileTabs = session.filePreviewTabs || [];

	// Build sets of IDs already in the order
	const aiIdsInOrder = new Set<string>();
	const fileIdsInOrder = new Set<string>();
	for (const ref of order) {
		if (ref.type === 'ai') aiIdsInOrder.add(ref.id);
		else fileIdsInOrder.add(ref.id);
	}

	// Collect orphaned tabs
	const orphanedRefs: UnifiedTabRef[] = [];
	for (const tab of aiTabs) {
		if (!aiIdsInOrder.has(tab.id)) {
			orphanedRefs.push({ type: 'ai', id: tab.id });
		}
	}
	for (const tab of fileTabs) {
		if (!fileIdsInOrder.has(tab.id)) {
			orphanedRefs.push({ type: 'file', id: tab.id });
		}
	}

	// Return original if no orphans (avoids allocation)
	if (orphanedRefs.length === 0) return order;
	return [...order, ...orphanedRefs];
}

/**
 * Get the initial name to show in the rename modal.
 * Returns empty string if no custom name is set (name is null),
 * or the custom name if user has set one.
 *
 * @param tab - The AI tab being renamed
 * @returns The name to pre-fill in the rename input (empty for auto-generated names)
 */
export function getInitialRenameValue(tab: AITab): string {
	return tab.name || '';
}

/**
 * Attempt to extract a tab name from the user's message using fast client-side
 * pattern matching. This avoids spawning an expensive ephemeral agent for messages
 * that clearly reference a GitHub PR, issue, or similar identifiable resource.
 *
 * @param message - The user's input message
 * @returns A short tab name if a pattern matched, or null to fall back to agent naming
 */
export function extractQuickTabName(message: string): string | null {
	// GitHub PR URL: https://github.com/org/repo/pull/123
	const ghPrUrl = message.match(/github\.com\/[^/]+\/([^/]+)\/pull\/(\d+)/);
	if (ghPrUrl) {
		return `PR #${ghPrUrl[2]}`;
	}

	// GitHub issue URL: https://github.com/org/repo/issues/123
	const ghIssueUrl = message.match(/github\.com\/[^/]+\/([^/]+)\/issues\/(\d+)/);
	if (ghIssueUrl) {
		return `Issue #${ghIssueUrl[2]}`;
	}

	// GitHub discussion URL: https://github.com/org/repo/discussions/123
	const ghDiscussionUrl = message.match(/github\.com\/[^/]+\/([^/]+)\/discussions\/(\d+)/);
	if (ghDiscussionUrl) {
		return `Discussion #${ghDiscussionUrl[2]}`;
	}

	// Jira-style ticket: PROJ-1234
	const jiraTicket = message.match(/\b([A-Z][A-Z0-9]+-\d+)\b/);
	if (jiraTicket) {
		return jiraTicket[1];
	}

	// Inline "PR #123" or "pull request #123" (not in a URL)
	const prRef = message.match(/\b(?:PR|pull request)\s*#(\d+)\b/i);
	if (prRef) {
		return `PR #${prRef[1]}`;
	}

	// Inline "issue #123"
	const issueRef = message.match(/\bissue\s*#(\d+)\b/i);
	if (issueRef) {
		return `Issue #${issueRef[1]}`;
	}

	return null;
}

// Maximum number of closed tabs to keep in history
const MAX_CLOSED_TAB_HISTORY = 25;

/**
 * Check if a tab is locked (prevents closure)
 */
export function isTabLocked(tab: AITab | undefined | null): boolean {
	return tab?.locked === true;
}

/**
 * Check if a tab has draft content (unsent input or staged images).
 * Used for determining if a tab should be shown in "unread only" filter mode.
 *
 * @param tab - The AI tab to check
 * @returns True if the tab has unsent text input or staged images
 */
export function hasDraft(tab: AITab): boolean {
	return (
		(tab.inputValue && tab.inputValue.trim() !== '') ||
		(tab.stagedImages && tab.stagedImages.length > 0)
	);
}

/**
 * Check if a tab has an active (unfinished) wizard session.
 * Used to determine if closing the tab should show a confirmation modal.
 *
 * @param tab - The AI tab to check
 * @returns True if the tab has an active wizard that hasn't completed
 */
export function hasActiveWizard(tab: AITab): boolean {
	return tab.wizardState?.isActive === true;
}

/**
 * Get the list of navigable tabs based on filter settings.
 * When showUnreadOnly is true, only returns unread tabs and tabs with unsent drafts/staged images.
 * When false (default), returns all tabs.
 *
 * @param session - The Maestro session containing tabs
 * @param showUnreadOnly - If true, filter to only unread tabs and tabs with drafts
 * @returns Array of navigable AITabs (may be empty if session has no tabs or filter excludes all)
 */
export function getNavigableTabs(session: Session, showUnreadOnly = false): AITab[] {
	if (!session || !session.aiTabs || session.aiTabs.length === 0) {
		return [];
	}

	if (showUnreadOnly) {
		return session.aiTabs.filter((tab) => tab.hasUnread || hasDraft(tab));
	}

	return session.aiTabs;
}

/**
 * Get the currently active AI tab for a session.
 * Returns the tab matching activeTabId, or the first tab if not found.
 * Returns undefined if the session has no tabs.
 *
 * @param session - The Maestro session
 * @returns The active AITab or undefined if no tabs exist
 */
export function getActiveTab(session: Session): AITab | undefined {
	if (!session || !session.aiTabs || session.aiTabs.length === 0) {
		return undefined;
	}

	const activeTab = session.aiTabs.find((tab) => tab.id === session.activeTabId);

	// Fallback to first tab if activeTabId doesn't match any tab
	// (can happen after tab deletion or data corruption)
	return activeTab ?? session.aiTabs[0];
}

/**
 * Options for creating a new AI tab.
 */
export interface CreateTabOptions {
	agentSessionId?: string | null; // Claude Code session UUID (null for new tabs)
	logs?: LogEntry[]; // Initial conversation history
	name?: string | null; // User-defined name (null = show UUID octet)
	starred?: boolean; // Whether session is starred
	usageStats?: UsageStats; // Token usage stats
	saveToHistory?: boolean; // Whether to save synopsis to history after completions
	showThinking?: ThinkingMode; // Thinking display mode: 'off' | 'on' (temporary) | 'sticky' (persistent)
}

/**
 * Result of creating a new tab - contains both the new tab and updated session.
 */
export interface CreateTabResult {
	tab: AITab; // The newly created tab
	session: Session; // Updated session with the new tab added and set as active
}

/**
 * Create a new AI tab for a session.
 * The new tab is appended to the session's aiTabs array and set as the active tab.
 *
 * @param session - The Maestro session to add the tab to
 * @param options - Optional tab configuration (agentSessionId, logs, name, starred)
 * @returns Object containing the new tab and updated session
 */
export function createTab(
	session: Session,
	options: CreateTabOptions = {}
): CreateTabResult | null {
	if (!session) {
		return null;
	}

	const {
		agentSessionId = null,
		logs = [],
		name = null,
		starred = false,
		usageStats,
		saveToHistory = true,
		showThinking = 'off',
	} = options;

	// Create the new tab with default values
	const newTab: AITab = {
		id: generateId(),
		agentSessionId,
		name,
		starred,
		logs,
		inputValue: '',
		stagedImages: [],
		usageStats,
		createdAt: Date.now(),
		state: 'idle',
		saveToHistory,
		showThinking,
	};

	// Update the session with the new tab added and set as active
	// Also clear activeFileTabId so the new AI tab is shown in the main panel
	// Add the new tab to unifiedTabOrder so it appears in the unified tab bar
	const newTabRef = { type: 'ai' as const, id: newTab.id };
	const updatedSession: Session = {
		...session,
		aiTabs: [...(session.aiTabs || []), newTab],
		activeTabId: newTab.id,
		activeFileTabId: null,
		unifiedTabOrder: [...(session.unifiedTabOrder || []), newTabRef],
	};

	return {
		tab: newTab,
		session: updatedSession,
	};
}

/**
 * Options for closing a tab.
 */
export interface CloseTabOptions {
	/** If true, skip adding to closed tab history (e.g., for wizard tabs) */
	skipHistory?: boolean;
}

/**
 * Result of closing a tab - contains the closed tab info and updated session.
 */
export interface CloseTabResult {
	closedTab: ClosedTab; // The closed tab data with original index
	session: Session; // Updated session with tab removed
}

/**
 * Close an AI tab and optionally add it to the closed tab history.
 * The closed tab is stored in closedTabHistory for potential restoration via Cmd+Shift+T,
 * unless skipHistory is true (e.g., for wizard tabs which should not be restorable).
 * If the closed tab was active, the next tab (or previous if at end) becomes active.
 * When showUnreadOnly is true, prioritizes switching to the next unread tab.
 * If closing the last tab, a fresh new tab is created to replace it.
 */
export function closeTab(
	session: Session,
	tabId: string,
	showUnreadOnly = false,
	options: CloseTabOptions = {}
): CloseTabResult | null {
	if (!session || !session.aiTabs || session.aiTabs.length === 0) {
		return null;
	}

	// Find the tab to close
	const tabIndex = session.aiTabs.findIndex((tab) => tab.id === tabId);
	if (tabIndex === -1) {
		return null;
	}

	const tabToClose = session.aiTabs[tabIndex];

	// Create closed tab entry with original index
	const closedTab: ClosedTab = {
		tab: { ...tabToClose },
		index: tabIndex,
		closedAt: Date.now(),
	};

	// Remove tab from aiTabs
	let updatedTabs = session.aiTabs.filter((tab) => tab.id !== tabId);

	// If we just closed the last tab, create a fresh new tab to replace it
	let newActiveTabId = session.activeTabId;
	if (updatedTabs.length === 0) {
		const freshTab: AITab = {
			id: generateId(),
			agentSessionId: null,
			name: null,
			starred: false,
			logs: [],
			inputValue: '',
			stagedImages: [],
			createdAt: Date.now(),
			state: 'idle',
		};
		updatedTabs = [freshTab];
		newActiveTabId = freshTab.id;
	} else if (session.activeTabId === tabId) {
		// If we closed the active tab, select the tab to the left (previous tab)
		// If closing the first tab, select the new first tab (was previously to the right)

		if (showUnreadOnly) {
			// When filtering unread tabs, find the previous unread tab to switch to
			// Build a temporary session with the updated tabs to use getNavigableTabs
			const tempSession = { ...session, aiTabs: updatedTabs };
			const navigableTabs = getNavigableTabs(tempSession, true);

			if (navigableTabs.length > 0) {
				const closedTabNavIndex = getNavigableTabs(session, true).findIndex((t) => t.id === tabId);
				const newNavIndex = Math.max(0, closedTabNavIndex - 1);
				newActiveTabId = navigableTabs[Math.min(newNavIndex, navigableTabs.length - 1)].id;
			} else {
				const newIndex = Math.max(0, tabIndex - 1);
				newActiveTabId = updatedTabs[newIndex].id;
			}
		} else {
			// Normal mode: select the tab to the left (previous tab)
			// If closing the first tab (index 0), select the new first tab
			const newIndex = Math.max(0, tabIndex - 1);
			newActiveTabId = updatedTabs[newIndex].id;
		}
	}

	// Add to closed tab history unless skipHistory is set (e.g., for wizard tabs)
	const updatedHistory = options.skipHistory
		? session.closedTabHistory || []
		: [closedTab, ...(session.closedTabHistory || [])].slice(0, MAX_CLOSED_TAB_HISTORY);

	// Also remove from unifiedTabOrder to keep AI and file tabs in sync
	const updatedUnifiedTabOrder = (session.unifiedTabOrder || []).filter(
		(ref) => !(ref.type === 'ai' && ref.id === tabId)
	);

	// If we created a fresh tab, add it to unifiedTabOrder at the end
	let finalUnifiedTabOrder = updatedUnifiedTabOrder;
	if (session.aiTabs.length === 1 && updatedTabs.length === 1 && updatedTabs[0].id !== tabId) {
		// A fresh tab was created to replace the closed one
		const freshTabRef: UnifiedTabRef = { type: 'ai', id: updatedTabs[0].id };
		finalUnifiedTabOrder = [...updatedUnifiedTabOrder, freshTabRef];
	}

	// Create updated session
	const updatedSession: Session = {
		...session,
		aiTabs: updatedTabs,
		activeTabId: newActiveTabId,
		closedTabHistory: updatedHistory,
		unifiedTabOrder: finalUnifiedTabOrder,
	};

	return {
		closedTab,
		session: updatedSession,
	};
}

/**
 * Result of reopening a closed tab.
 */
export interface ReopenTabResult {
	tab: AITab; // The reopened tab (either restored or existing duplicate)
	session: Session; // Updated session with tab restored/selected
	wasDuplicate: boolean; // True if we switched to an existing tab instead of restoring
}

/**
 * Reopen the most recently closed tab from the closed tab history.
 * Includes duplicate detection: if a tab with the same agentSessionId already exists,
 * switch to that existing tab instead of creating a duplicate.
 *
 * The tab is restored at its original index position if possible, otherwise appended to the end.
 * The reopened tab becomes the active tab.
 */
export function reopenClosedTab(session: Session): ReopenTabResult | null {
	// Check if there's anything in the history
	if (!session.closedTabHistory || session.closedTabHistory.length === 0) {
		return null;
	}

	// Pop the most recently closed tab from history
	const [closedTabEntry, ...remainingHistory] = session.closedTabHistory;
	const tabToRestore = closedTabEntry.tab;

	// Check for duplicate: does a tab with the same agentSessionId already exist?
	// Note: null agentSessionId (new/empty tabs) are never considered duplicates
	if (tabToRestore.agentSessionId !== null) {
		const existingTab = session.aiTabs.find(
			(tab) => tab.agentSessionId === tabToRestore.agentSessionId
		);

		if (existingTab) {
			// Duplicate found - switch to existing tab instead of restoring
			// Still remove from history since user "used" their undo
			return {
				tab: existingTab,
				session: {
					...session,
					activeTabId: existingTab.id,
					closedTabHistory: remainingHistory,
					unifiedTabOrder: ensureInUnifiedTabOrder(
						session.unifiedTabOrder || [],
						'ai',
						existingTab.id
					),
				},
				wasDuplicate: true,
			};
		}
	}

	// No duplicate - restore the tab
	// Generate a new ID to avoid any ID conflicts
	const restoredTab: AITab = {
		...tabToRestore,
		id: generateId(),
	};

	// Insert at original index if possible, otherwise append
	const insertIndex = Math.min(closedTabEntry.index, session.aiTabs.length);
	const updatedTabs = [
		...session.aiTabs.slice(0, insertIndex),
		restoredTab,
		...session.aiTabs.slice(insertIndex),
	];

	return {
		tab: restoredTab,
		session: {
			...session,
			aiTabs: updatedTabs,
			activeTabId: restoredTab.id,
			closedTabHistory: remainingHistory,
			unifiedTabOrder: ensureInUnifiedTabOrder(session.unifiedTabOrder || [], 'ai', restoredTab.id),
		},
		wasDuplicate: false,
	};
}

/**
 * Result of closing a file tab - contains the closed tab entry and updated session.
 */
export interface CloseFileTabResult {
	closedTabEntry: ClosedTabEntry; // The closed tab data with unified index
	session: Session; // Updated session with tab removed
}

/**
 * Close a file preview tab and add it to the unified closed tab history.
 * When the closed tab was active, selects the next tab in unifiedTabOrder.
 */
export function closeFileTab(session: Session, tabId: string): CloseFileTabResult | null {
	if (!session || !session.filePreviewTabs || session.filePreviewTabs.length === 0) {
		return null;
	}

	// Find the tab to close
	const tabToClose = session.filePreviewTabs.find((tab) => tab.id === tabId);
	if (!tabToClose) {
		return null;
	}

	// Find the position in unifiedTabOrder
	const unifiedIndex = session.unifiedTabOrder.findIndex(
		(ref) => ref.type === 'file' && ref.id === tabId
	);

	// Create closed tab entry
	const closedTabEntry: ClosedTabEntry = {
		type: 'file',
		tab: { ...tabToClose },
		unifiedIndex: unifiedIndex !== -1 ? unifiedIndex : session.unifiedTabOrder.length,
		closedAt: Date.now(),
	};

	// Remove from filePreviewTabs
	const updatedFilePreviewTabs = session.filePreviewTabs.filter((tab) => tab.id !== tabId);

	// Remove from unifiedTabOrder
	const updatedUnifiedTabOrder = session.unifiedTabOrder.filter(
		(ref) => !(ref.type === 'file' && ref.id === tabId)
	);

	// Determine new active tab if we closed the active file tab
	let newActiveFileTabId = session.activeFileTabId;
	let newActiveTabId = session.activeTabId;

	if (session.activeFileTabId === tabId) {
		// This was the active tab - select the tab to the left in unifiedTabOrder
		if (updatedUnifiedTabOrder.length > 0 && unifiedIndex !== -1) {
			const newIndex = Math.max(0, unifiedIndex - 1);
			const nextTabRef = updatedUnifiedTabOrder[newIndex];

			if (nextTabRef.type === 'file') {
				newActiveFileTabId = nextTabRef.id;
			} else {
				newActiveTabId = nextTabRef.id;
				newActiveFileTabId = null;
			}
		} else if (updatedUnifiedTabOrder.length > 0) {
			const firstTabRef = updatedUnifiedTabOrder[0];
			if (firstTabRef.type === 'file') {
				newActiveFileTabId = firstTabRef.id;
			} else {
				newActiveTabId = firstTabRef.id;
				newActiveFileTabId = null;
			}
		} else {
			newActiveFileTabId = null;
		}
	}

	// Add to unified closed tab history
	const updatedUnifiedHistory = [closedTabEntry, ...(session.unifiedClosedTabHistory || [])].slice(
		0,
		MAX_CLOSED_TAB_HISTORY
	);

	return {
		closedTabEntry,
		session: {
			...session,
			filePreviewTabs: updatedFilePreviewTabs,
			unifiedTabOrder: updatedUnifiedTabOrder,
			activeFileTabId: newActiveFileTabId,
			activeTabId: newActiveTabId,
			unifiedClosedTabHistory: updatedUnifiedHistory,
		},
	};
}

/**
 * Add an AI tab to the unified closed tab history.
 * This should be called when closing an AI tab to enable Cmd+Shift+T for all tab types.
 */
export function addAiTabToUnifiedHistory(
	session: Session,
	aiTab: AITab,
	unifiedIndex: number
): Session {
	const closedTabEntry: ClosedTabEntry = {
		type: 'ai',
		tab: { ...aiTab },
		unifiedIndex,
		closedAt: Date.now(),
	};

	const updatedUnifiedHistory = [closedTabEntry, ...(session.unifiedClosedTabHistory || [])].slice(
		0,
		MAX_CLOSED_TAB_HISTORY
	);

	return {
		...session,
		unifiedClosedTabHistory: updatedUnifiedHistory,
	};
}

/**
 * Result of reopening a tab from unified closed tab history.
 */
export interface ReopenUnifiedClosedTabResult {
	tabType: 'ai' | 'file'; // Type of tab that was reopened
	tabId: string; // ID of the restored or existing tab
	session: Session; // Updated session with tab restored/selected
	wasDuplicate: boolean; // True if we switched to an existing tab instead of restoring
}

/**
 * Reopen the most recently closed tab from the unified closed tab history.
 * Handles both AI tabs and file preview tabs with appropriate duplicate detection.
 */
export function reopenUnifiedClosedTab(session: Session): ReopenUnifiedClosedTabResult | null {
	// Check if there's anything in the unified history
	if (!session.unifiedClosedTabHistory || session.unifiedClosedTabHistory.length === 0) {
		// Fall back to legacy closedTabHistory for backwards compatibility
		const legacyResult = reopenClosedTab(session);
		if (legacyResult) {
			return {
				tabType: 'ai',
				tabId: legacyResult.tab.id,
				session: legacyResult.session,
				wasDuplicate: legacyResult.wasDuplicate,
			};
		}
		return null;
	}

	// Pop the most recently closed tab from unified history
	const [closedEntry, ...remainingHistory] = session.unifiedClosedTabHistory;

	if (closedEntry.type === 'ai') {
		// Restoring an AI tab
		const tabToRestore = closedEntry.tab;

		// Check for duplicate
		if (tabToRestore.agentSessionId !== null) {
			const existingTab = session.aiTabs.find(
				(tab) => tab.agentSessionId === tabToRestore.agentSessionId
			);

			if (existingTab) {
				return {
					tabType: 'ai',
					tabId: existingTab.id,
					session: {
						...session,
						activeTabId: existingTab.id,
						activeFileTabId: null,
						unifiedTabOrder: ensureInUnifiedTabOrder(session.unifiedTabOrder, 'ai', existingTab.id),
						unifiedClosedTabHistory: remainingHistory,
					},
					wasDuplicate: true,
				};
			}
		}

		// No duplicate - restore the tab
		const restoredTab: AITab = {
			...tabToRestore,
			id: generateId(),
		};

		// Calculate insert position in aiTabs based on unified index
		const targetUnifiedIndex = Math.min(closedEntry.unifiedIndex, session.unifiedTabOrder.length);

		// Count how many AI tabs come before this position
		let aiTabsBeforeIndex = 0;
		for (let i = 0; i < targetUnifiedIndex && i < session.unifiedTabOrder.length; i++) {
			if (session.unifiedTabOrder[i].type === 'ai') {
				aiTabsBeforeIndex++;
			}
		}
		const insertIndex = Math.min(aiTabsBeforeIndex, session.aiTabs.length);

		const updatedAiTabs = [
			...session.aiTabs.slice(0, insertIndex),
			restoredTab,
			...session.aiTabs.slice(insertIndex),
		];

		// Insert into unifiedTabOrder at the original position
		const newTabRef: UnifiedTabRef = { type: 'ai', id: restoredTab.id };
		const updatedUnifiedTabOrder = [
			...session.unifiedTabOrder.slice(0, targetUnifiedIndex),
			newTabRef,
			...session.unifiedTabOrder.slice(targetUnifiedIndex),
		];

		return {
			tabType: 'ai',
			tabId: restoredTab.id,
			session: {
				...session,
				aiTabs: updatedAiTabs,
				activeTabId: restoredTab.id,
				activeFileTabId: null,
				unifiedTabOrder: updatedUnifiedTabOrder,
				unifiedClosedTabHistory: remainingHistory,
			},
			wasDuplicate: false,
		};
	} else {
		// Restoring a file tab
		const tabToRestore = closedEntry.tab;

		// Check for duplicate
		const existingTab = session.filePreviewTabs.find((tab) => tab.path === tabToRestore.path);

		if (existingTab) {
			return {
				tabType: 'file',
				tabId: existingTab.id,
				session: {
					...session,
					activeFileTabId: existingTab.id,
					unifiedTabOrder: ensureInUnifiedTabOrder(session.unifiedTabOrder, 'file', existingTab.id),
					unifiedClosedTabHistory: remainingHistory,
				},
				wasDuplicate: true,
			};
		}

		// No duplicate - restore the tab
		const restoredTab: FilePreviewTab = {
			...tabToRestore,
			id: generateId(),
			editContent: undefined,
			editMode: false,
			navigationHistory: [
				{ path: tabToRestore.path, name: tabToRestore.name, scrollTop: tabToRestore.scrollTop },
			],
			navigationIndex: 0,
		};

		// Add to filePreviewTabs
		const updatedFilePreviewTabs = [...session.filePreviewTabs, restoredTab];

		// Insert into unifiedTabOrder at the original position
		const targetUnifiedIndex = Math.min(closedEntry.unifiedIndex, session.unifiedTabOrder.length);
		const newTabRef: UnifiedTabRef = { type: 'file', id: restoredTab.id };
		const updatedUnifiedTabOrder = [
			...session.unifiedTabOrder.slice(0, targetUnifiedIndex),
			newTabRef,
			...session.unifiedTabOrder.slice(targetUnifiedIndex),
		];

		return {
			tabType: 'file',
			tabId: restoredTab.id,
			session: {
				...session,
				filePreviewTabs: updatedFilePreviewTabs,
				activeFileTabId: restoredTab.id,
				unifiedTabOrder: updatedUnifiedTabOrder,
				unifiedClosedTabHistory: remainingHistory,
			},
			wasDuplicate: false,
		};
	}
}

/**
 * Result of setting the active tab.
 */
export interface SetActiveTabResult {
	tab: AITab; // The newly active tab
	session: Session; // Updated session with activeTabId changed
}

/**
 * Set the active AI tab for a session.
 * Changes which tab is currently displayed and receives input.
 */
export function setActiveTab(session: Session, tabId: string): SetActiveTabResult | null {
	// Validate that the session and tab exists
	if (!session || !session.aiTabs || session.aiTabs.length === 0) {
		return null;
	}

	const targetTab = session.aiTabs.find((tab) => tab.id === tabId);
	if (!targetTab) {
		return null;
	}

	// If already active and no file tab is selected, return current state (no mutation needed)
	if (session.activeTabId === tabId && session.activeFileTabId === null) {
		return {
			tab: targetTab,
			session,
		};
	}

	// When selecting an AI tab, deselect any active file preview tab
	return {
		tab: targetTab,
		session: {
			...session,
			activeTabId: tabId,
			activeFileTabId: null,
		},
	};
}

/**
 * Get the tab that is currently in write mode (busy state) for a session.
 */
export function getWriteModeTab(session: Session): AITab | undefined {
	if (!session || !session.aiTabs || session.aiTabs.length === 0) {
		return undefined;
	}

	return session.aiTabs.find((tab) => tab.state === 'busy');
}

/**
 * Get all tabs that are currently busy (in write mode) for a session.
 */
export function getBusyTabs(session: Session): AITab[] {
	if (!session || !session.aiTabs || session.aiTabs.length === 0) {
		return [];
	}

	return session.aiTabs.filter((tab) => tab.state === 'busy');
}

/**
 * Navigate to the next tab in the session's tab list.
 */
export function navigateToNextTab(
	session: Session,
	showUnreadOnly = false
): SetActiveTabResult | null {
	if (!session || !session.aiTabs || session.aiTabs.length < 2) {
		return null;
	}

	const navigableTabs = getNavigableTabs(session, showUnreadOnly);

	if (navigableTabs.length === 0) {
		return null;
	}

	const currentIndex = navigableTabs.findIndex((tab) => tab.id === session.activeTabId);

	if (currentIndex === -1) {
		const firstTab = navigableTabs[0];
		return {
			tab: firstTab,
			session: {
				...session,
				activeTabId: firstTab.id,
			},
		};
	}

	if (navigableTabs.length < 2) {
		return null;
	}

	const nextIndex = (currentIndex + 1) % navigableTabs.length;
	const nextTab = navigableTabs[nextIndex];

	return {
		tab: nextTab,
		session: {
			...session,
			activeTabId: nextTab.id,
		},
	};
}

/**
 * Navigate to the previous tab in the session's tab list.
 */
export function navigateToPrevTab(
	session: Session,
	showUnreadOnly = false
): SetActiveTabResult | null {
	if (!session || !session.aiTabs || session.aiTabs.length < 2) {
		return null;
	}

	const navigableTabs = getNavigableTabs(session, showUnreadOnly);

	if (navigableTabs.length === 0) {
		return null;
	}

	const currentIndex = navigableTabs.findIndex((tab) => tab.id === session.activeTabId);

	if (currentIndex === -1) {
		const lastTab = navigableTabs[navigableTabs.length - 1];
		return {
			tab: lastTab,
			session: {
				...session,
				activeTabId: lastTab.id,
			},
		};
	}

	if (navigableTabs.length < 2) {
		return null;
	}

	const prevIndex = (currentIndex - 1 + navigableTabs.length) % navigableTabs.length;
	const prevTab = navigableTabs[prevIndex];

	return {
		tab: prevTab,
		session: {
			...session,
			activeTabId: prevTab.id,
		},
	};
}

/**
 * Navigate to a specific tab by its index (0-based).
 * Used for Cmd+1 through Cmd+8 shortcuts.
 */
export function navigateToTabByIndex(
	session: Session,
	index: number,
	showUnreadOnly = false
): SetActiveTabResult | null {
	if (!session || !session.aiTabs || session.aiTabs.length === 0) {
		return null;
	}

	const navigableTabs = getNavigableTabs(session, showUnreadOnly);

	if (index < 0 || index >= navigableTabs.length) {
		return null;
	}

	const targetTab = navigableTabs[index];

	if (session.activeTabId === targetTab.id) {
		return {
			tab: targetTab,
			session,
		};
	}

	return {
		tab: targetTab,
		session: {
			...session,
			activeTabId: targetTab.id,
		},
	};
}

/**
 * Navigate to the last tab in the session's tab list.
 * Used for Cmd+0 shortcut.
 */
export function navigateToLastTab(
	session: Session,
	showUnreadOnly = false
): SetActiveTabResult | null {
	const navigableTabs = getNavigableTabs(session, showUnreadOnly);

	if (navigableTabs.length === 0) {
		return null;
	}

	const lastIndex = navigableTabs.length - 1;
	return navigateToTabByIndex(session, lastIndex, showUnreadOnly);
}

/**
 * Result of navigating to a unified tab (can be AI or file tab).
 */
export interface NavigateToUnifiedTabResult {
	type: 'ai' | 'file';
	id: string;
	session: Session;
}

/**
 * Navigate to a tab by its index in the unified tab order.
 * Used for Cmd+1 through Cmd+9 shortcuts to jump to tabs by position.
 * Works with both AI tabs and file preview tabs in the unified tab system.
 */
export function navigateToUnifiedTabByIndex(
	session: Session,
	index: number
): NavigateToUnifiedTabResult | null {
	// Use repaired order that includes any orphaned tabs
	const effectiveOrder = getRepairedUnifiedTabOrder(session);
	if (!session || effectiveOrder.length === 0) {
		return null;
	}

	if (index < 0 || index >= effectiveOrder.length) {
		return null;
	}

	const targetTabRef = effectiveOrder[index];
	// If orphans were repaired, persist the fix in the returned session
	const repairedSession =
		effectiveOrder !== session.unifiedTabOrder
			? { ...session, unifiedTabOrder: effectiveOrder }
			: session;

	if (targetTabRef.type === 'ai') {
		const aiTab = session.aiTabs.find((tab) => tab.id === targetTabRef.id);
		if (!aiTab) return null;

		if (session.activeTabId === targetTabRef.id && session.activeFileTabId === null) {
			return {
				type: 'ai',
				id: targetTabRef.id,
				session: repairedSession,
			};
		}

		return {
			type: 'ai',
			id: targetTabRef.id,
			session: {
				...repairedSession,
				activeTabId: targetTabRef.id,
				activeFileTabId: null,
			},
		};
	} else {
		const fileTab = session.filePreviewTabs.find((tab) => tab.id === targetTabRef.id);
		if (!fileTab) return null;

		if (session.activeFileTabId === targetTabRef.id) {
			return {
				type: 'file',
				id: targetTabRef.id,
				session: repairedSession,
			};
		}

		return {
			type: 'file',
			id: targetTabRef.id,
			session: {
				...repairedSession,
				activeFileTabId: targetTabRef.id,
			},
		};
	}
}

/**
 * Navigate to the last tab in the unified tab order.
 * Used for Cmd+0 shortcut.
 */
export function navigateToLastUnifiedTab(session: Session): NavigateToUnifiedTabResult | null {
	const effectiveOrder = getRepairedUnifiedTabOrder(session);
	if (!session || effectiveOrder.length === 0) {
		return null;
	}

	// Find the last valid tab, skipping orphaned entries
	for (let i = effectiveOrder.length - 1; i >= 0; i--) {
		const result = navigateToUnifiedTabByIndex(session, i);
		if (result) return result;
	}
	return null;
}

/**
 * Get the current index in the unified tab order.
 * Returns the index of the currently active tab (file tab if active, otherwise AI tab).
 */
function getCurrentUnifiedTabIndex(session: Session, effectiveOrder?: UnifiedTabRef[]): number {
	const order = effectiveOrder || getRepairedUnifiedTabOrder(session);
	if (order.length === 0) {
		return -1;
	}

	// If a file tab is active, find it in the unified order
	if (session.activeFileTabId) {
		return order.findIndex((ref) => ref.type === 'file' && ref.id === session.activeFileTabId);
	}

	// Otherwise find the active AI tab
	return order.findIndex((ref) => ref.type === 'ai' && ref.id === session.activeTabId);
}

/**
 * Navigate to the next tab in the unified tab order.
 * Cycles through both AI tabs and file preview tabs in their visual order.
 * Wraps around to the first tab if currently on the last tab.
 */
export function navigateToNextUnifiedTab(
	session: Session,
	showUnreadOnly = false
): NavigateToUnifiedTabResult | null {
	const effectiveOrder = getRepairedUnifiedTabOrder(session);
	if (!session || effectiveOrder.length < 2) {
		return null;
	}

	const currentIndex = getCurrentUnifiedTabIndex(session, effectiveOrder);
	const length = effectiveOrder.length;

	if (currentIndex === -1) {
		for (let i = 0; i < length; i++) {
			const result = navigateToUnifiedTabByIndex(session, i);
			if (result) return result;
		}
		return null;
	}

	if (showUnreadOnly) {
		for (let offset = 1; offset < length; offset++) {
			const nextIndex = (currentIndex + offset) % length;
			const tabRef = effectiveOrder[nextIndex];

			if (tabRef.type === 'file') {
				const result = navigateToUnifiedTabByIndex(session, nextIndex);
				if (result) return result;
				continue;
			}

			const aiTab = session.aiTabs.find((t) => t.id === tabRef.id);
			if (aiTab && (aiTab.hasUnread || hasDraft(aiTab))) {
				return navigateToUnifiedTabByIndex(session, nextIndex);
			}
		}
		return null;
	}

	for (let offset = 1; offset < length; offset++) {
		const nextIndex = (currentIndex + offset) % length;
		const result = navigateToUnifiedTabByIndex(session, nextIndex);
		if (result) return result;
	}
	return null;
}

/**
 * Navigate to the previous tab in the unified tab order.
 * Cycles through both AI tabs and file preview tabs in their visual order.
 * Wraps around to the last tab if currently on the first tab.
 */
export function navigateToPrevUnifiedTab(
	session: Session,
	showUnreadOnly = false
): NavigateToUnifiedTabResult | null {
	const effectiveOrder = getRepairedUnifiedTabOrder(session);
	if (!session || effectiveOrder.length < 2) {
		return null;
	}

	const currentIndex = getCurrentUnifiedTabIndex(session, effectiveOrder);
	const length = effectiveOrder.length;

	if (currentIndex === -1) {
		for (let i = length - 1; i >= 0; i--) {
			const result = navigateToUnifiedTabByIndex(session, i);
			if (result) return result;
		}
		return null;
	}

	if (showUnreadOnly) {
		for (let offset = 1; offset < length; offset++) {
			const prevIndex = (currentIndex - offset + length) % length;
			const tabRef = effectiveOrder[prevIndex];

			if (tabRef.type === 'file') {
				const result = navigateToUnifiedTabByIndex(session, prevIndex);
				if (result) return result;
				continue;
			}

			const aiTab = session.aiTabs.find((t) => t.id === tabRef.id);
			if (aiTab && (aiTab.hasUnread || hasDraft(aiTab))) {
				return navigateToUnifiedTabByIndex(session, prevIndex);
			}
		}
		return null;
	}

	for (let offset = 1; offset < length; offset++) {
		const prevIndex = (currentIndex - offset + length) % length;
		const result = navigateToUnifiedTabByIndex(session, prevIndex);
		if (result) return result;
	}
	return null;
}

/**
 * Options for creating a new AI tab at a specific position.
 */
export interface CreateTabAtPositionOptions extends CreateTabOptions {
	/** Insert the new tab after this tab ID */
	afterTabId: string;
}

/**
 * Create a new AI tab at a specific position in the session's tab list.
 * The new tab is inserted immediately after the specified tab.
 */
export function createTabAtPosition(
	session: Session,
	options: CreateTabAtPositionOptions
): CreateTabResult | null {
	const result = createTab(session, options);
	if (!result) return null;

	// Find the index of the afterTabId
	const afterIndex = result.session.aiTabs.findIndex((t) => t.id === options.afterTabId);
	if (afterIndex === -1) return result;

	// Move the new tab to be right after afterTabId
	const tabs = [...result.session.aiTabs];
	const newTabIndex = tabs.findIndex((t) => t.id === result.tab.id);

	// Only move if the new tab isn't already in the right position
	if (newTabIndex !== afterIndex + 1) {
		const [newTab] = tabs.splice(newTabIndex, 1);
		tabs.splice(afterIndex + 1, 0, newTab);
	}

	return {
		tab: result.tab,
		session: { ...result.session, aiTabs: tabs },
	};
}

/**
 * Options for creating a merged session from multiple context sources.
 */
export interface CreateMergedSessionOptions {
	/** Name for the new merged session */
	name: string;
	/** Project root directory for the new session */
	projectRoot: string;
	/** Agent type for the new session */
	toolType: ToolType;
	/** Pre-merged conversation logs to initialize the tab with */
	mergedLogs: LogEntry[];
	/** Aggregated usage stats from merged contexts (optional) */
	usageStats?: UsageStats;
	/** Group ID to assign the session to (optional) */
	groupId?: string;
	/** Whether to save completions to history (default: true) */
	saveToHistory?: boolean;
	/** Thinking display mode: 'off' | 'on' (temporary) | 'sticky' (persistent) */
	showThinking?: ThinkingMode;
}

/**
 * Result of creating a merged session.
 */
export interface CreateMergedSessionResult {
	/** The newly created session with merged context */
	session: Session;
	/** The ID of the active tab in the new session */
	tabId: string;
}

/**
 * Create a new Maestro session pre-populated with merged context logs.
 */
export function createMergedSession(
	options: CreateMergedSessionOptions
): CreateMergedSessionResult {
	const {
		name,
		projectRoot,
		toolType,
		mergedLogs,
		usageStats,
		groupId,
		saveToHistory = true,
		showThinking = 'off',
	} = options;

	const sessionId = generateId();
	const tabId = generateId();

	// Create the initial tab with merged logs
	const mergedTab: AITab = {
		id: tabId,
		agentSessionId: null,
		name: null,
		starred: false,
		logs: mergedLogs,
		inputValue: '',
		stagedImages: [],
		usageStats,
		createdAt: Date.now(),
		state: 'idle',
		saveToHistory,
		showThinking,
	};

	// Create the merged session with standard structure
	const session: Session = {
		id: sessionId,
		name,
		groupId,
		toolType,
		state: 'idle',
		cwd: projectRoot,
		fullPath: projectRoot,
		projectRoot,
		isGitRepo: false,
		aiLogs: [],
		shellLogs: [
			{
				id: generateId(),
				timestamp: Date.now(),
				source: 'system',
				text: 'Merged Context Session Ready.',
			},
		],
		workLog: [],
		contextUsage: 0,
		inputMode: toolType === 'terminal' ? 'terminal' : 'ai',
		aiPid: 0,
		terminalPid: 0,
		port: 3000 + Math.floor(Math.random() * 100),
		isLive: false,
		changedFiles: [],
		fileTree: [],
		fileExplorerExpanded: [],
		fileExplorerScrollPos: 0,
		fileTreeAutoRefreshInterval: 180,
		shellCwd: projectRoot,
		aiCommandHistory: [],
		shellCommandHistory: [],
		executionQueue: [],
		activeTimeMs: 0,
		aiTabs: [mergedTab],
		activeTabId: tabId,
		closedTabHistory: [],
		filePreviewTabs: [],
		activeFileTabId: null,
		unifiedTabOrder: [{ type: 'ai' as const, id: tabId }],
		unifiedClosedTabHistory: [],
		autoRunFolderPath: getAutoRunFolderPath(projectRoot),
	};

	return { session, tabId };
}

/**
 * Maximum number of log entries to keep at the start and end of a closed tab's logs
 * when preparing for persistence. This keeps the persisted session size manageable
 * while preserving enough context for the user to identify the tab.
 */
const CLOSED_TAB_LOG_BOOKEND_SIZE = 3;

/**
 * Truncate logs in closed tab history entries for efficient persistence.
 * Keeps the first N and last N log entries from each closed tab, discarding the middle.
 * This preserves enough context for display names and identification while limiting storage.
 *
 * @param closedTabs - Array of ClosedTab entries to truncate
 * @returns New array with truncated logs in each tab
 */
export function truncateClosedTabLogs(closedTabs: ClosedTab[]): ClosedTab[] {
	if (!closedTabs || closedTabs.length === 0) return [];

	return closedTabs.map((entry) => {
		const logs = entry.tab.logs;
		if (!logs || logs.length <= CLOSED_TAB_LOG_BOOKEND_SIZE * 2) {
			return entry; // No truncation needed
		}

		const truncatedLogs = [
			...logs.slice(0, CLOSED_TAB_LOG_BOOKEND_SIZE),
			...logs.slice(-CLOSED_TAB_LOG_BOOKEND_SIZE),
		];

		return {
			...entry,
			tab: {
				...entry.tab,
				logs: truncatedLogs,
			},
		};
	});
}
