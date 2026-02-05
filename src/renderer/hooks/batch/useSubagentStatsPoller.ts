/**
 * useSubagentStatsPoller - Polls subagent JSONL files for token statistics
 *
 * Since Claude Code doesn't stream subagent usage events in real-time,
 * this hook periodically polls the subagent folder to aggregate token stats.
 *
 * Phase 3 of Auto Run Throughput Status Pill Implementation
 */

import { useEffect, useRef, useCallback } from 'react';

interface SubagentStatsPollerOptions {
	/** Agent ID (e.g., 'claude-code') */
	agentId: string;
	/** Project path for the session */
	projectPath: string;
	/** Claude Code session IDs to poll (all sessions in the batch for cumulative stats) */
	sessionIds: string[];
	/** Whether the Auto Run is currently active */
	isRunning: boolean;
	/** Poll interval in milliseconds (default: 5000ms) */
	pollIntervalMs?: number;
	/** Optional SSH remote ID for remote sessions */
	sshRemoteId?: string;
	/** Callback when new stats are available */
	onStats: (stats: SubagentStats) => void;
}

interface SubagentStats {
	inputTokens: number;
	outputTokens: number;
	cost: number;
	subagentCount: number;
}

export function useSubagentStatsPoller({
	agentId,
	projectPath,
	sessionIds,
	isRunning,
	pollIntervalMs = 5000,
	sshRemoteId,
	onStats,
}: SubagentStatsPollerOptions): void {
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const lastStatsRef = useRef<SubagentStats | null>(null);

	const pollSubagentStats = useCallback(async () => {
		if (!sessionIds.length || !projectPath || !isRunning) return;

		try {
			// Poll ALL session IDs and aggregate for cumulative stats across all tasks
			const allStats = await Promise.all(
				sessionIds.map((sessionId) =>
					window.maestro.agentSessions
						.getSubagentStats(agentId, projectPath, sessionId, sshRemoteId)
						.catch(() => ({ inputTokens: 0, outputTokens: 0, cost: 0, subagentCount: 0 }))
				)
			);

			// Aggregate stats from all sessions
			const stats: SubagentStats = allStats.reduce(
				(acc, s) => ({
					inputTokens: acc.inputTokens + (s?.inputTokens || 0),
					outputTokens: acc.outputTokens + (s?.outputTokens || 0),
					cost: acc.cost + (s?.cost || 0),
					subagentCount: acc.subagentCount + (s?.subagentCount || 0),
				}),
				{ inputTokens: 0, outputTokens: 0, cost: 0, subagentCount: 0 }
			);

			if (stats.subagentCount > 0) {
				// Only call onStats if values have changed
				if (
					!lastStatsRef.current ||
					stats.inputTokens !== lastStatsRef.current.inputTokens ||
					stats.outputTokens !== lastStatsRef.current.outputTokens
				) {
					lastStatsRef.current = stats;
					onStats(stats);
				}
			}
		} catch (error) {
			// Silently ignore polling errors - subagent folder may not exist yet
			console.debug('[SubagentStatsPoller] Poll error:', error);
		}
	}, [agentId, projectPath, sessionIds, isRunning, sshRemoteId, onStats]);

	useEffect(() => {
		if (!isRunning) {
			// Clear interval when not running
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
			lastStatsRef.current = null;
			return;
		}

		// Start polling
		pollSubagentStats(); // Initial poll
		intervalRef.current = setInterval(pollSubagentStats, pollIntervalMs);

		return () => {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
		};
	}, [isRunning, pollIntervalMs, pollSubagentStats]);
}

// Export types for use in other modules
export type { SubagentStatsPollerOptions, SubagentStats };
