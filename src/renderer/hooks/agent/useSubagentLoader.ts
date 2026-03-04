import { useState, useCallback, useRef } from 'react';
import type { SubagentInfo } from '../../types';

interface UseSubagentLoaderOptions {
	agentId: string;
	projectPath: string | undefined;
	sshRemoteId?: string;
}

interface AggregatedStats {
	aggregatedInputTokens: number;
	aggregatedOutputTokens: number;
	aggregatedCacheReadTokens: number;
	aggregatedCacheCreationTokens: number;
	aggregatedCostUsd: number;
	aggregatedMessageCount: number;
	hasSubagents: boolean;
	subagentCount: number;
}

interface UseSubagentLoaderReturn {
	/** Map of sessionId -> subagents */
	subagentsBySession: Map<string, SubagentInfo[]>;
	/** Set of expanded session IDs */
	expandedSessions: Set<string>;
	/** Loading state for each session */
	loadingSubagents: Set<string>;
	/** Map of sessionId -> aggregated stats (loaded on expand) */
	aggregatedStatsBySession: Map<string, AggregatedStats>;
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
	const [aggregatedStatsBySession, setAggregatedStatsBySession] = useState<
		Map<string, AggregatedStats>
	>(new Map());

	// Track in-flight requests to prevent duplicates
	const pendingRequests = useRef<Map<string, Promise<SubagentInfo[]>>>(new Map());

	// Ref to access current cache without including it in useCallback deps
	// This breaks the dependency cycle: state updates don't change callback identity
	const subagentsCacheRef = useRef(subagentsBySession);
	subagentsCacheRef.current = subagentsBySession;

	const loadSubagentsForSession = useCallback(
		async (sessionId: string): Promise<SubagentInfo[]> => {
			// Return cached data if available
			const cached = subagentsCacheRef.current.get(sessionId);
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

					// Also fetch aggregated stats for this session
					try {
						const stats = await window.maestro.agentSessions.getSubagentStats(
							agentId,
							projectPath,
							sessionId,
							sshRemoteId
						);
						if (stats) {
							setAggregatedStatsBySession((prev) => {
								const next = new Map(prev);
								next.set(sessionId, {
									aggregatedInputTokens: stats.inputTokens,
									aggregatedOutputTokens: stats.outputTokens,
									aggregatedCacheReadTokens: stats.cacheReadTokens,
									aggregatedCacheCreationTokens: stats.cacheCreationTokens,
									aggregatedCostUsd: stats.cost,
									aggregatedMessageCount: 0, // Not available from IPC — subagent message count
									hasSubagents: stats.subagentCount > 0,
									subagentCount: stats.subagentCount,
								});
								return next;
							});
						}
					} catch {
						// Stats fetch failure is non-critical
					}

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
		[agentId, projectPath, sshRemoteId]
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
		setAggregatedStatsBySession(new Map());
		pendingRequests.current.clear();
	}, []);

	return {
		subagentsBySession,
		expandedSessions,
		loadingSubagents,
		aggregatedStatsBySession,
		loadSubagentsForSession,
		toggleSessionExpansion,
		expandSession,
		collapseSession,
		hasLoadedSubagents,
		clearCache,
	};
}
