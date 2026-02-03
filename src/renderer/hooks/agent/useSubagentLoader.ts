import { useState, useCallback, useRef } from 'react';
import type { SubagentInfo } from '../../types';

interface UseSubagentLoaderOptions {
	agentId: string;
	projectPath: string | undefined;
	sshRemoteId?: string;
}

interface UseSubagentLoaderReturn {
	/** Map of sessionId -> subagents */
	subagentsBySession: Map<string, SubagentInfo[]>;
	/** Set of expanded session IDs */
	expandedSessions: Set<string>;
	/** Loading state for each session */
	loadingSubagents: Set<string>;
	/** Load subagents for a session */
	loadSubagentsForSession: (sessionId: string) => Promise<SubagentInfo[]>;
	/** Toggle expansion of a session */
	toggleSessionExpansion: (sessionId: string) => Promise<void>;
	/** Expand a session (auto-loads subagents if needed) */
	expandSession: (sessionId: string) => Promise<void>;
	/** Collapse a session */
	collapseSession: (sessionId: string) => void;
	/** Check if a session has subagents loaded */
	hasLoadedSubagents: (sessionId: string) => boolean;
	/** Clear all cached subagents */
	clearCache: () => void;
}

/**
 * Hook for loading and caching subagent data for sessions.
 * Manages expansion state and lazy-loads subagents on demand.
 */
export function useSubagentLoader({
	agentId,
	projectPath,
	sshRemoteId,
}: UseSubagentLoaderOptions): UseSubagentLoaderReturn {
	const [subagentsBySession, setSubagentsBySession] = useState<Map<string, SubagentInfo[]>>(
		new Map()
	);
	const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
	const [loadingSubagents, setLoadingSubagents] = useState<Set<string>>(new Set());

	// Track in-flight requests to prevent duplicates
	const pendingRequests = useRef<Map<string, Promise<SubagentInfo[]>>>(new Map());

	const loadSubagentsForSession = useCallback(
		async (sessionId: string): Promise<SubagentInfo[]> => {
			// Return cached data if available
			const cached = subagentsBySession.get(sessionId);
			if (cached !== undefined) {
				return cached;
			}

			// Return existing request if in progress
			const pending = pendingRequests.current.get(sessionId);
			if (pending) {
				return pending;
			}

			if (!projectPath) {
				return [];
			}

			// Mark as loading
			setLoadingSubagents((prev) => new Set(prev).add(sessionId));

			// Create and track the request
			const request = (async () => {
				try {
					const subagents = await window.maestro.agentSessions.listSubagents(
						agentId,
						projectPath,
						sessionId,
						sshRemoteId
					);

					// Cache the result
					setSubagentsBySession((prev) => {
						const next = new Map(prev);
						next.set(sessionId, subagents);
						return next;
					});

					return subagents;
				} catch (error) {
					console.error('Failed to load subagents for session:', sessionId, error);
					// Cache empty array to prevent retries
					setSubagentsBySession((prev) => {
						const next = new Map(prev);
						next.set(sessionId, []);
						return next;
					});
					return [];
				} finally {
					// Remove from loading and pending
					setLoadingSubagents((prev) => {
						const next = new Set(prev);
						next.delete(sessionId);
						return next;
					});
					pendingRequests.current.delete(sessionId);
				}
			})();

			pendingRequests.current.set(sessionId, request);
			return request;
		},
		[agentId, projectPath, sshRemoteId, subagentsBySession]
	);

	const expandSession = useCallback(
		async (sessionId: string) => {
			// Load subagents if not cached
			await loadSubagentsForSession(sessionId);

			// Expand
			setExpandedSessions((prev) => new Set(prev).add(sessionId));
		},
		[loadSubagentsForSession]
	);

	const collapseSession = useCallback((sessionId: string) => {
		setExpandedSessions((prev) => {
			const next = new Set(prev);
			next.delete(sessionId);
			return next;
		});
	}, []);

	const toggleSessionExpansion = useCallback(
		async (sessionId: string) => {
			if (expandedSessions.has(sessionId)) {
				collapseSession(sessionId);
			} else {
				await expandSession(sessionId);
			}
		},
		[expandedSessions, expandSession, collapseSession]
	);

	const hasLoadedSubagents = useCallback(
		(sessionId: string) => subagentsBySession.has(sessionId),
		[subagentsBySession]
	);

	const clearCache = useCallback(() => {
		setSubagentsBySession(new Map());
		setExpandedSessions(new Set());
		setLoadingSubagents(new Set());
		pendingRequests.current.clear();
	}, []);

	return {
		subagentsBySession,
		expandedSessions,
		loadingSubagents,
		loadSubagentsForSession,
		toggleSessionExpansion,
		expandSession,
		collapseSession,
		hasLoadedSubagents,
		clearCache,
	};
}
