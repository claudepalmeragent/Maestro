/**
 * SessionContext - Centralized session and group state management
 *
 * This context extracts core session states from App.tsx to reduce
 * its complexity and provide a single source of truth for session state.
 *
 * Phase 6 of App.tsx decomposition - see refactor-details-2.md for full plan.
 *
 * States managed:
 * - Sessions list and active session ID
 * - Session groups
 * - Sessions loaded flag for initialization
 * - Refs for accessing current state in callbacks
 * - Computed values like activeSession and sorted sessions
 *
 * Note: This context provides the raw state and setters. Session operations
 * like creating, deleting, and restoring sessions continue to be handled
 * by App.tsx initially, but consumers can now read session state via context.
 */

import React, {
	createContext,
	useContext,
	useState,
	useCallback,
	useMemo,
	useRef,
	useEffect,
	ReactNode,
} from 'react';
import type { Session, Group } from '../types';
import { useBatchedSessionUpdates } from '../hooks';

/**
 * Session context value - all session states and their setters
 */
export interface SessionContextValue {
	// Core Session State
	sessions: Session[];
	setSessions: React.Dispatch<React.SetStateAction<Session[]>>;

	// Groups State
	groups: Group[];
	setGroups: React.Dispatch<React.SetStateAction<Group[]>>;

	// Active Session
	activeSessionId: string;
	setActiveSessionId: (id: string) => void;
	setActiveSessionIdInternal: React.Dispatch<React.SetStateAction<string>>;

	// Initialization State
	sessionsLoaded: boolean;
	setSessionsLoaded: React.Dispatch<React.SetStateAction<boolean>>;
	initialLoadComplete: React.MutableRefObject<boolean>;

	// Refs for accessing current state in callbacks (avoids stale closures)
	sessionsRef: React.MutableRefObject<Session[]>;
	groupsRef: React.MutableRefObject<Group[]>;
	activeSessionIdRef: React.MutableRefObject<string>;

	// Batched Updater for performance
	batchedUpdater: ReturnType<typeof useBatchedSessionUpdates>;

	// Computed Values
	activeSession: Session | null;

	// Cycle tracking for session navigation
	cyclePositionRef: React.MutableRefObject<number>;

	// Worktree tracking
	removedWorktreePaths: Set<string>;
	setRemovedWorktreePaths: React.Dispatch<React.SetStateAction<Set<string>>>;
	removedWorktreePathsRef: React.MutableRefObject<Set<string>>;
}

// Create context with null as default (will throw if used outside provider)
const SessionContext = createContext<SessionContextValue | null>(null);

interface SessionProviderProps {
	children: ReactNode;
}

/**
 * SessionProvider - Provides centralized session state management
 *
 * This provider manages all core session states that were previously
 * in App.tsx. It reduces App.tsx complexity and provides a single
 * location for session state management.
 *
 * Usage:
 * Wrap App with this provider (outermost after error boundary):
 * <SessionProvider>
 *   <AutoRunProvider>
 *     <GroupChatProvider>
 *       <InputProvider>
 *         <App />
 *       </InputProvider>
 *     </GroupChatProvider>
 *   </AutoRunProvider>
 * </SessionProvider>
 */
export function SessionProvider({ children }: SessionProviderProps) {
	// Core Session State
	const [sessions, setSessions] = useState<Session[]>([]);

	// Groups State
	const [groups, setGroups] = useState<Group[]>([]);

	// Track worktree paths that were manually removed - prevents re-discovery during this session
	const [removedWorktreePaths, setRemovedWorktreePaths] = useState<Set<string>>(new Set());
	// Ref to always access current removed paths (avoids stale closure in async scanner)
	const removedWorktreePathsRef = useRef<Set<string>>(removedWorktreePaths);
	removedWorktreePathsRef.current = removedWorktreePaths;

	// Track if initial data has been loaded to prevent overwriting on mount
	const initialLoadComplete = useRef(false);

	// Track if sessions/groups have been loaded (for splash screen coordination)
	const [sessionsLoaded, setSessionsLoaded] = useState(false);

	// Active session ID - internal state
	const [activeSessionId, setActiveSessionIdInternal] = useState<string>('');

	// Track current position in visual order for cycling (allows same session to appear twice)
	const cyclePositionRef = useRef<number>(-1);

	// Batched updater for performance during AI streaming
	const batchedUpdater = useBatchedSessionUpdates(setSessions);

	// Ref to access batchedUpdater without creating callback dependencies
	// This prevents re-creating setActiveSessionId when batchedUpdater changes
	const batchedUpdaterRef = useRef(batchedUpdater);
	batchedUpdaterRef.current = batchedUpdater;

	// Wrapper that resets cycle position when session is changed via click (not cycling)
	// Also flushes batched updates to ensure previous session's state is fully updated
	// Uses ref to avoid dependency on batchedUpdater, preventing render cascades
	const setActiveSessionId = useCallback((id: string) => {
		batchedUpdaterRef.current.flushNow(); // Flush pending updates before switching sessions
		cyclePositionRef.current = -1; // Reset so next cycle finds first occurrence
		setActiveSessionIdInternal(id);
	}, []);

	// Refs for accessing current state in callbacks (avoids stale closures)
	const groupsRef = useRef(groups);
	const sessionsRef = useRef(sessions);
	const activeSessionIdRef = useRef(activeSessionId);

	// Keep refs in sync with state
	useEffect(() => {
		groupsRef.current = groups;
	}, [groups]);

	useEffect(() => {
		sessionsRef.current = sessions;
	}, [sessions]);

	useEffect(() => {
		activeSessionIdRef.current = activeSessionId;
	}, [activeSessionId]);

	// Computed value: active session (with fallback to first session)
	const activeSession = useMemo(
		() => sessions.find((s) => s.id === activeSessionId) || sessions[0] || null,
		[sessions, activeSessionId]
	);

	// PERFORMANCE: Create stable context value
	// React's useState setters are stable (don't need to be in deps)
	// Refs are also stable. Only include values that consumers need reactively.
	//
	// IMPORTANT: sessions/groups/activeSession ARE included because consumers
	// need to re-render when they change. The performance issue is in OTHER contexts,
	// not here - SessionContext needs to propagate session changes.
	const value = useMemo<SessionContextValue>(
		() => ({
			// Core Session State
			sessions,
			setSessions,

			// Groups State
			groups,
			setGroups,

			// Active Session
			activeSessionId,
			setActiveSessionId,
			setActiveSessionIdInternal,

			// Initialization State
			sessionsLoaded,
			setSessionsLoaded,
			initialLoadComplete,

			// Refs
			sessionsRef,
			groupsRef,
			activeSessionIdRef,

			// Batched Updater
			batchedUpdater,

			// Computed Values
			activeSession,

			// Cycle tracking
			cyclePositionRef,

			// Worktree tracking
			removedWorktreePaths,
			setRemovedWorktreePaths,
			removedWorktreePathsRef,
		}),
		[
			// These values must trigger re-renders for consumers
			sessions,
			groups,
			activeSessionId,
			// setActiveSessionId is now stable (uses ref for batchedUpdater) so no need to include
			sessionsLoaded,
			// batchedUpdater is provided for API access but doesn't need to trigger re-renders
			// Consumers use it for imperative calls, not reactive subscriptions
			activeSession,
			removedWorktreePaths,
			// Note: setState functions from useState are stable and don't need to be deps
			// Refs are also stable objects (the ref itself doesn't change, only .current)
		]
	);

	return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/**
 * useSession - Hook to access session state management
 *
 * Must be used within a SessionProvider. Throws an error if used outside.
 *
 * @returns SessionContextValue - All session states and their setters
 *
 * @example
 * const { sessions, activeSession, setActiveSessionId } = useSession();
 *
 * // Switch to a session
 * setActiveSessionId('session-123');
 *
 * // Check active session
 * if (activeSession) {
 *   console.log(activeSession.name);
 * }
 *
 * @example
 * const { sessionsRef, setSessions } = useSession();
 *
 * // Access current sessions in a callback without stale closure
 * const handleEvent = useCallback(() => {
 *   const currentSessions = sessionsRef.current;
 *   // ...
 * }, [sessionsRef]);
 *
 * @example
 * const { batchedUpdater } = useSession();
 *
 * // Use batched updates for performance during AI streaming
 * batchedUpdater.appendLog(sessionId, tabId, true, data);
 */
export function useSession(): SessionContextValue {
	const context = useContext(SessionContext);

	if (!context) {
		throw new Error('useSession must be used within a SessionProvider');
	}

	return context;
}

// ============================================================================
// MEMOIZED SELECTOR HOOKS
// ============================================================================
// These hooks provide optimized access to specific session data without
// triggering re-renders when unrelated session data changes.

/**
 * useSessionState - Get the state of a specific session
 *
 * This is a memoized selector that only re-renders when the specific
 * session's state changes, not when other session data changes.
 *
 * @param sessionId - The session ID to get state for
 * @returns The session state or null if session not found
 *
 * @example
 * const state = useSessionState('session-123');
 * // Returns: 'idle' | 'busy' | 'waiting_input' | 'connecting' | 'error' | null
 */
export function useSessionState(sessionId: string): Session['state'] | null {
	const { sessions } = useSession();
	return useMemo(
		() => sessions.find((s) => s.id === sessionId)?.state ?? null,
		[sessions, sessionId]
	);
}

/**
 * useSessionLogs - Get logs for a specific session/tab
 *
 * This is a memoized selector that returns logs for a specific session
 * and optionally a specific tab.
 *
 * @param sessionId - The session ID to get logs for
 * @param tabId - Optional tab ID. If provided, returns that tab's logs.
 *                If not provided, returns session's aiLogs (deprecated).
 * @returns Array of log entries
 *
 * @example
 * // Get logs for active tab
 * const logs = useSessionLogs('session-123', 'tab-456');
 *
 * // Get session-level logs (deprecated aiLogs)
 * const sessionLogs = useSessionLogs('session-123');
 */
export function useSessionLogs(
	sessionId: string,
	tabId?: string
): import('../types').LogEntry[] {
	const { sessions } = useSession();
	return useMemo(() => {
		const session = sessions.find((s) => s.id === sessionId);
		if (!session) return [];
		if (tabId) {
			return session.aiTabs?.find((t) => t.id === tabId)?.logs ?? [];
		}
		return session.aiLogs ?? [];
	}, [sessions, sessionId, tabId]);
}

/**
 * useSessionUsage - Get usage statistics for a specific session
 *
 * This is a memoized selector that returns usage stats for a session.
 *
 * @param sessionId - The session ID to get usage for
 * @returns UsageStats or undefined if not available
 *
 * @example
 * const usage = useSessionUsage('session-123');
 * if (usage) {
 *   console.log(`Cost: $${usage.totalCostUsd.toFixed(4)}`);
 * }
 */
export function useSessionUsage(
	sessionId: string
): import('../types').UsageStats | undefined {
	const { sessions } = useSession();
	return useMemo(
		() => sessions.find((s) => s.id === sessionId)?.usageStats,
		[sessions, sessionId]
	);
}

/**
 * useSessionContextUsage - Get context window usage percentage
 *
 * @param sessionId - The session ID
 * @returns Context usage percentage (0-100) or 0 if not found
 *
 * @example
 * const contextUsage = useSessionContextUsage('session-123');
 * // Returns: 45 (meaning 45% of context window used)
 */
export function useSessionContextUsage(sessionId: string): number {
	const { sessions } = useSession();
	return useMemo(
		() => sessions.find((s) => s.id === sessionId)?.contextUsage ?? 0,
		[sessions, sessionId]
	);
}

/**
 * useSessionById - Get a specific session by ID
 *
 * This is a memoized selector that returns the full session object.
 * Use more specific selectors (useSessionState, useSessionLogs, etc.)
 * when you only need specific fields to avoid unnecessary re-renders.
 *
 * @param sessionId - The session ID to find
 * @returns The session or null if not found
 *
 * @example
 * const session = useSessionById('session-123');
 * if (session) {
 *   console.log(session.name, session.state);
 * }
 */
export function useSessionById(sessionId: string): Session | null {
	const { sessions } = useSession();
	return useMemo(
		() => sessions.find((s) => s.id === sessionId) ?? null,
		[sessions, sessionId]
	);
}

/**
 * useActiveTabLogs - Get logs for the active tab of the active session
 *
 * Convenience hook that combines active session lookup with tab logs.
 *
 * @returns Array of log entries for the active tab, or empty array
 *
 * @example
 * const logs = useActiveTabLogs();
 */
export function useActiveTabLogs(): import('../types').LogEntry[] {
	const { activeSession } = useSession();
	return useMemo(() => {
		if (!activeSession) return [];
		const activeTab = activeSession.aiTabs?.find(
			(t) => t.id === activeSession.activeTabId
		);
		return activeTab?.logs ?? activeSession.aiLogs ?? [];
	}, [activeSession]);
}
