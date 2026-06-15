/**
 * Stats Aggregation Queries
 *
 * Decomposes the monolithic getAggregatedStats into focused sub-query functions,
 * each independently testable and readable.
 */

import type Database from 'better-sqlite3';
import type { StatsTimeRange, StatsAggregation } from '../../shared/stats-types';
import {
	percentilesFromSorted,
	emptyPercentiles,
	type DurationPercentiles,
} from '../../shared/percentiles';
import { PERFORMANCE_THRESHOLDS } from '../../shared/performance-metrics';
import { getTimeRangeStart, perfMetrics, LOG_CONTEXT } from './utils';
import { countImageAnnotationsSince } from './image-annotations';
import { logger } from '../utils/logger';

// ============================================================================
// Sub-query Functions
// ============================================================================

function queryTotals(
	db: Database.Database,
	startTime: number
): { count: number; total_duration: number } {
	const perfStart = perfMetrics.start();
	const result = db
		.prepare(
			`
      SELECT COUNT(*) as count, COALESCE(SUM(duration), 0) as total_duration
      FROM query_events
      WHERE start_time >= ?
    `
		)
		.get(startTime) as { count: number; total_duration: number };
	perfMetrics.end(perfStart, 'getAggregatedStats:totals');
	return result;
}

function queryByAgent(
	db: Database.Database,
	startTime: number
): Record<
	string,
	{ count: number; duration: number; totalOutputTokens: number; avgTokensPerSecond: number }
> {
	const perfStart = perfMetrics.start();
	const rows = db
		.prepare(
			`
      SELECT agent_type,
             COUNT(*) as count,
             SUM(duration) as duration,
             COALESCE(SUM(output_tokens), 0) as total_output_tokens,
             COALESCE(AVG(tokens_per_second), 0) as avg_tokens_per_second
      FROM query_events
      WHERE start_time >= ?
      GROUP BY agent_type
    `
		)
		.all(startTime) as Array<{
		agent_type: string;
		count: number;
		duration: number;
		total_output_tokens: number;
		avg_tokens_per_second: number;
	}>;

	const result: Record<
		string,
		{ count: number; duration: number; totalOutputTokens: number; avgTokensPerSecond: number }
	> = {};
	for (const row of rows) {
		result[row.agent_type] = {
			count: row.count,
			duration: row.duration,
			totalOutputTokens: row.total_output_tokens,
			avgTokensPerSecond: row.avg_tokens_per_second,
		};
	}
	perfMetrics.end(perfStart, 'getAggregatedStats:byAgent', { agentCount: rows.length });
	return result;
}

function queryBySource(db: Database.Database, startTime: number): { user: number; auto: number } {
	const perfStart = perfMetrics.start();
	const rows = db
		.prepare(
			`
      SELECT source, COUNT(*) as count
      FROM query_events
      WHERE start_time >= ?
      GROUP BY source
    `
		)
		.all(startTime) as Array<{ source: 'user' | 'auto'; count: number }>;

	const result = { user: 0, auto: 0 };
	for (const row of rows) {
		result[row.source] = row.count;
	}
	perfMetrics.end(perfStart, 'getAggregatedStats:bySource');
	return result;
}

function queryByWorktreeStatus(
	db: Database.Database,
	startTime: number
): {
	worktreeQueries: number;
	parentQueries: number;
	byWorktreeStatus: {
		worktree: { count: number; duration: number };
		parent: { count: number; duration: number };
	};
} {
	const perfStart = perfMetrics.start();
	const rows = db
		.prepare(
			`
      SELECT COALESCE(is_worktree, 0) as is_worktree,
             COUNT(*) as count,
             COALESCE(SUM(duration), 0) as duration
      FROM query_events
      WHERE start_time >= ?
      GROUP BY COALESCE(is_worktree, 0)
    `
		)
		.all(startTime) as Array<{ is_worktree: number; count: number; duration: number }>;

	const byWorktreeStatus = {
		worktree: { count: 0, duration: 0 },
		parent: { count: 0, duration: 0 },
	};
	for (const row of rows) {
		if (row.is_worktree === 1) {
			byWorktreeStatus.worktree.count += row.count;
			byWorktreeStatus.worktree.duration += row.duration;
		} else {
			// Treat NULL (legacy data) and 0 as parent
			byWorktreeStatus.parent.count += row.count;
			byWorktreeStatus.parent.duration += row.duration;
		}
	}
	perfMetrics.end(perfStart, 'getAggregatedStats:byWorktreeStatus');
	return {
		worktreeQueries: byWorktreeStatus.worktree.count,
		parentQueries: byWorktreeStatus.parent.count,
		byWorktreeStatus,
	};
}

function queryByLocation(
	db: Database.Database,
	startTime: number
): { local: number; remote: number } {
	const perfStart = perfMetrics.start();
	const rows = db
		.prepare(
			`
      SELECT is_remote, COUNT(*) as count
      FROM query_events
      WHERE start_time >= ?
      GROUP BY is_remote
    `
		)
		.all(startTime) as Array<{ is_remote: number | null; count: number }>;

	const result = { local: 0, remote: 0 };
	for (const row of rows) {
		if (row.is_remote === 1) {
			result.remote = row.count;
		} else {
			// Treat NULL (legacy data) and 0 as local
			result.local += row.count;
		}
	}
	perfMetrics.end(perfStart, 'getAggregatedStats:byLocation');
	return result;
}

function queryByDay(
	db: Database.Database,
	startTime: number
): Array<{
	date: string;
	count: number;
	duration: number;
	outputTokens?: number;
	avgTokensPerSecond?: number;
}> {
	const perfStart = perfMetrics.start();
	const rows = db
		.prepare(
			`
      SELECT date(start_time / 1000, 'unixepoch', 'localtime') as date,
             COUNT(*) as count,
             SUM(duration) as duration,
             SUM(output_tokens) as output_tokens,
             AVG(tokens_per_second) as avg_tokens_per_second
      FROM query_events
      WHERE start_time >= ?
      GROUP BY date(start_time / 1000, 'unixepoch', 'localtime')
      ORDER BY date ASC
    `
		)
		.all(startTime) as Array<{
		date: string;
		count: number;
		duration: number;
		output_tokens: number | null;
		avg_tokens_per_second: number | null;
	}>;
	perfMetrics.end(perfStart, 'getAggregatedStats:byDay', { dayCount: rows.length });
	return rows.map((row) => ({
		date: row.date,
		count: row.count,
		duration: row.duration,
		outputTokens: row.output_tokens ?? undefined,
		avgTokensPerSecond: row.avg_tokens_per_second ?? undefined,
	}));
}

function queryByAgentByDay(
	db: Database.Database,
	startTime: number
): Record<
	string,
	Array<{
		date: string;
		count: number;
		duration: number;
		outputTokens: number;
		avgTokensPerSecond: number;
	}>
> {
	const perfStart = perfMetrics.start();
	const rows = db
		.prepare(
			`
      SELECT agent_type,
             date(start_time / 1000, 'unixepoch', 'localtime') as date,
             COUNT(*) as count,
             SUM(duration) as duration,
             COALESCE(SUM(output_tokens), 0) as output_tokens,
             COALESCE(AVG(tokens_per_second), 0) as avg_tokens_per_second
      FROM query_events
      WHERE start_time >= ?
      GROUP BY agent_type, date(start_time / 1000, 'unixepoch', 'localtime')
      ORDER BY agent_type, date ASC
    `
		)
		.all(startTime) as Array<{
		agent_type: string;
		date: string;
		count: number;
		duration: number;
		output_tokens: number;
		avg_tokens_per_second: number;
	}>;

	const result: Record<
		string,
		Array<{
			date: string;
			count: number;
			duration: number;
			outputTokens: number;
			avgTokensPerSecond: number;
		}>
	> = {};
	for (const row of rows) {
		if (!result[row.agent_type]) {
			result[row.agent_type] = [];
		}
		result[row.agent_type].push({
			date: row.date,
			count: row.count,
			duration: row.duration,
			outputTokens: row.output_tokens,
			avgTokensPerSecond: row.avg_tokens_per_second,
		});
	}
	perfMetrics.end(perfStart, 'getAggregatedStats:byAgentByDay');
	return result;
}

function queryByHour(
	db: Database.Database,
	startTime: number
): Array<{ hour: number; count: number; duration: number }> {
	const perfStart = perfMetrics.start();
	const rows = db
		.prepare(
			`
      SELECT CAST(strftime('%H', start_time / 1000, 'unixepoch', 'localtime') AS INTEGER) as hour,
             COUNT(*) as count,
             SUM(duration) as duration
      FROM query_events
      WHERE start_time >= ?
      GROUP BY hour
      ORDER BY hour ASC
    `
		)
		.all(startTime) as Array<{ hour: number; count: number; duration: number }>;
	perfMetrics.end(perfStart, 'getAggregatedStats:byHour');
	return rows;
}

function querySessionStats(
	db: Database.Database,
	startTime: number
): {
	totalSessions: number;
	sessionsByAgent: Record<string, number>;
	sessionsByDay: Array<{ date: string; count: number }>;
	avgSessionDuration: number;
} {
	const perfStart = perfMetrics.start();

	// Total unique sessions with queries
	const sessionTotals = db
		.prepare(
			`
      SELECT COUNT(DISTINCT session_id) as count
      FROM query_events
      WHERE start_time >= ?
    `
		)
		.get(startTime) as { count: number };

	// Average session duration from lifecycle table
	const avgResult = db
		.prepare(
			`
      SELECT COALESCE(AVG(duration), 0) as avg_duration
      FROM session_lifecycle
      WHERE created_at >= ? AND duration IS NOT NULL
    `
		)
		.get(startTime) as { avg_duration: number };

	// Sessions by agent type
	const byAgentRows = db
		.prepare(
			`
      SELECT agent_type, COUNT(*) as count
      FROM session_lifecycle
      WHERE created_at >= ?
      GROUP BY agent_type
    `
		)
		.all(startTime) as Array<{ agent_type: string; count: number }>;

	const sessionsByAgent: Record<string, number> = {};
	for (const row of byAgentRows) {
		sessionsByAgent[row.agent_type] = row.count;
	}

	// Sessions by day
	const byDayRows = db
		.prepare(
			`
      SELECT date(created_at / 1000, 'unixepoch', 'localtime') as date,
             COUNT(*) as count
      FROM session_lifecycle
      WHERE created_at >= ?
      GROUP BY date(created_at / 1000, 'unixepoch', 'localtime')
      ORDER BY date ASC
    `
		)
		.all(startTime) as Array<{ date: string; count: number }>;

	perfMetrics.end(perfStart, 'getAggregatedStats:sessions', {
		sessionCount: sessionTotals.count,
	});

	return {
		totalSessions: sessionTotals.count,
		sessionsByAgent,
		sessionsByDay: byDayRows,
		avgSessionDuration: Math.round(avgResult.avg_duration),
	};
}

function queryBySessionByDay(
	db: Database.Database,
	startTime: number
): Record<
	string,
	Array<{
		date: string;
		count: number;
		duration: number;
		outputTokens: number;
		avgTokensPerSecond: number;
	}>
> {
	const perfStart = perfMetrics.start();
	const rows = db
		.prepare(
			`
      SELECT session_id,
             date(start_time / 1000, 'unixepoch', 'localtime') as date,
             COUNT(*) as count,
             SUM(duration) as duration,
             COALESCE(SUM(output_tokens), 0) as output_tokens,
             COALESCE(AVG(tokens_per_second), 0) as avg_tokens_per_second
      FROM query_events
      WHERE start_time >= ?
      GROUP BY session_id, date(start_time / 1000, 'unixepoch', 'localtime')
      ORDER BY session_id, date ASC
    `
		)
		.all(startTime) as Array<{
		session_id: string;
		date: string;
		count: number;
		duration: number;
		output_tokens: number;
		avg_tokens_per_second: number;
	}>;

	const result: Record<
		string,
		Array<{
			date: string;
			count: number;
			duration: number;
			outputTokens: number;
			avgTokensPerSecond: number;
		}>
	> = {};
	for (const row of rows) {
		if (!result[row.session_id]) {
			result[row.session_id] = [];
		}
		result[row.session_id].push({
			date: row.date,
			count: row.count,
			duration: row.duration,
			outputTokens: row.output_tokens,
			avgTokensPerSecond: row.avg_tokens_per_second,
		});
	}
	perfMetrics.end(perfStart, 'getAggregatedStats:bySessionByDay');
	return result;
}

/**
 * Query stats aggregated by Maestro agent ID (not fragmented session IDs).
 * Uses COALESCE to fall back to session_id for records without agent_id.
 */
function queryByAgentIdByDay(
	db: Database.Database,
	startTime: number
): Record<
	string,
	Array<{
		date: string;
		count: number;
		duration: number;
		outputTokens: number;
		avgTokensPerSecond: number;
	}>
> {
	const perfStart = perfMetrics.start();
	const rows = db
		.prepare(
			`
      SELECT COALESCE(agent_id, session_id) as agent_id,
             date(start_time / 1000, 'unixepoch', 'localtime') as date,
             COUNT(*) as count,
             SUM(duration) as duration,
             COALESCE(SUM(output_tokens), 0) as output_tokens,
             COALESCE(AVG(tokens_per_second), 0) as avg_tokens_per_second
      FROM query_events
      WHERE start_time >= ?
      GROUP BY COALESCE(agent_id, session_id), date(start_time / 1000, 'unixepoch', 'localtime')
      ORDER BY agent_id, date ASC
    `
		)
		.all(startTime) as Array<{
		agent_id: string;
		date: string;
		count: number;
		duration: number;
		output_tokens: number;
		avg_tokens_per_second: number;
	}>;

	const result: Record<
		string,
		Array<{
			date: string;
			count: number;
			duration: number;
			outputTokens: number;
			avgTokensPerSecond: number;
		}>
	> = {};
	for (const row of rows) {
		if (!result[row.agent_id]) {
			result[row.agent_id] = [];
		}
		result[row.agent_id].push({
			date: row.date,
			count: row.count,
			duration: row.duration,
			outputTokens: row.output_tokens,
			avgTokensPerSecond: row.avg_tokens_per_second,
		});
	}
	perfMetrics.end(perfStart, 'getAggregatedStats:byAgentIdByDay');
	return result;
}

function queryTokenMetrics(
	db: Database.Database,
	startTime: number
): {
	queriesWithTokenData: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCacheReadInputTokens: number;
	totalCacheCreationInputTokens: number;
	totalCostUsd: number;
	anthropicCostUsd: number;
	savingsUsd: number;
	avgTokensPerSecond: number;
	avgOutputTokensPerQuery: number;
} {
	const perfStart = perfMetrics.start();
	const result = db
		.prepare(
			`
      SELECT
        COUNT(*) as queries_with_data,
        COALESCE(SUM(input_tokens), 0) as total_input_tokens,
        COALESCE(SUM(output_tokens), 0) as total_output_tokens,
        COALESCE(SUM(cache_read_input_tokens), 0) as total_cache_read_input_tokens,
        COALESCE(SUM(cache_creation_input_tokens), 0) as total_cache_creation_input_tokens,
        -- Primary cost: Maestro calculated (billing-mode aware)
        COALESCE(SUM(maestro_cost_usd), SUM(total_cost_usd), 0) as total_cost_usd,
        -- Secondary cost: Anthropic reported (API pricing)
        COALESCE(SUM(anthropic_cost_usd), SUM(total_cost_usd), 0) as anthropic_cost_usd,
        -- Savings calculation (API - Maestro)
        COALESCE(SUM(anthropic_cost_usd), SUM(total_cost_usd), 0) -
          COALESCE(SUM(maestro_cost_usd), SUM(total_cost_usd), 0) as savings_usd,
        COALESCE(AVG(tokens_per_second), 0) as avg_tokens_per_second,
        COALESCE(AVG(output_tokens), 0) as avg_output_tokens
      FROM query_events
      WHERE start_time >= ? AND output_tokens IS NOT NULL
    `
		)
		.get(startTime) as {
		queries_with_data: number;
		total_input_tokens: number;
		total_output_tokens: number;
		total_cache_read_input_tokens: number;
		total_cache_creation_input_tokens: number;
		total_cost_usd: number;
		anthropic_cost_usd: number;
		savings_usd: number;
		avg_tokens_per_second: number;
		avg_output_tokens: number;
	};
	perfMetrics.end(perfStart, 'getAggregatedStats:tokenMetrics');

	// Debug logging for dual cost tracking
	logger.debug('[aggregations] Token metrics result:', LOG_CONTEXT, {
		totalCostUsd: result.total_cost_usd,
		anthropicCostUsd: result.anthropic_cost_usd,
		savingsUsd: result.savings_usd,
		hasDualCosts: result.total_cost_usd !== result.anthropic_cost_usd,
	});

	return {
		queriesWithTokenData: result.queries_with_data,
		totalInputTokens: result.total_input_tokens,
		totalOutputTokens: result.total_output_tokens,
		totalCacheReadInputTokens: result.total_cache_read_input_tokens,
		totalCacheCreationInputTokens: result.total_cache_creation_input_tokens,
		totalCostUsd: result.total_cost_usd,
		anthropicCostUsd: result.anthropic_cost_usd,
		savingsUsd: result.savings_usd,
		avgTokensPerSecond: result.avg_tokens_per_second,
		avgOutputTokensPerQuery: result.avg_output_tokens,
	};
}

// ============================================================================
// Cost Data Queries
// ============================================================================

/**
 * Daily cost data for cost-over-time graph
 */
export interface DailyCostData {
	date: string;
	localCost: number;
	anthropicCost: number;
	savings: number;
}

/**
 * Model cost data for cost-by-model graph
 */
export interface ModelCostData {
	model: string;
	localCost: number;
	anthropicCost: number;
	savings: number;
}

/**
 * Agent cost data for cost-by-agent graph
 */
export interface AgentCostData {
	agentId: string;
	agentName: string;
	localCost: number;
	anthropicCost: number;
	savings: number;
	billingMode: 'api' | 'max' | 'free';
}

/**
 * Query session-source breakdown (per-session counts of user vs auto queries).
 */
function queryBySessionSource(
	db: Database.Database,
	startTime: number
): Record<string, { user: number; auto: number }> {
	const perfStart = perfMetrics.start();
	const rows = db
		.prepare(
			`
      SELECT session_id, source, COUNT(*) as count
      FROM query_events
      WHERE start_time >= ?
      GROUP BY session_id, source
    `
		)
		.all(startTime) as Array<{
		session_id: string;
		source: 'user' | 'auto';
		count: number;
	}>;

	const result: Record<string, { user: number; auto: number }> = {};
	for (const row of rows) {
		if (!result[row.session_id]) {
			result[row.session_id] = { user: 0, auto: 0 };
		}
		result[row.session_id][row.source] = row.count;
	}
	perfMetrics.end(perfStart, 'getAggregatedStats:bySessionSource');
	return result;
}

/**
 * Query duration distribution overall and per agent type.
 *
 * SQLite (better-sqlite3) has no `PERCENTILE_CONT`, so we pull the `duration`
 * column sorted ascending and slice in JS. One ordered scan feeds both the
 * overall distribution and every per-agent distribution (rows arrive grouped by
 * agent because the sort is `agent_type, duration`), so each group's slice is
 * already sorted.
 */
function queryDurationPercentiles(
	db: Database.Database,
	startTime: number
): {
	overall: DurationPercentiles;
	byAgent: Record<string, DurationPercentiles>;
} {
	const perfStart = perfMetrics.start();
	const rows = db
		.prepare(
			`
      SELECT agent_type, duration
      FROM query_events
      WHERE start_time >= ?
      ORDER BY duration ASC
    `
		)
		.all(startTime) as Array<{ agent_type: string; duration: number }>;

	// Overall: rows are globally sorted by duration already.
	const overall = percentilesFromSorted(rows.map((r) => r.duration));

	// Per agent: collect each agent's durations preserving ascending order.
	const perAgentSorted: Record<string, number[]> = {};
	for (const row of rows) {
		(perAgentSorted[row.agent_type] ??= []).push(row.duration);
	}
	const byAgent: Record<string, DurationPercentiles> = {};
	for (const [agent, durations] of Object.entries(perAgentSorted)) {
		byAgent[agent] = percentilesFromSorted(durations);
	}

	perfMetrics.end(perfStart, 'getAggregatedStats:durationPercentiles', {
		sampleCount: rows.length,
	});
	return { overall, byAgent };
}

/**
 * Auto Run task duration distribution (per individual task, which is the
 * closest analog to a single "run" and yields far more samples than the
 * batch-level `auto_run_sessions`).
 */
function queryAutoRunTaskPercentiles(
	db: Database.Database,
	startTime: number
): DurationPercentiles {
	const perfStart = perfMetrics.start();
	const rows = db
		.prepare(
			`
      SELECT duration
      FROM auto_run_tasks
      WHERE start_time >= ?
      ORDER BY duration ASC
    `
		)
		.all(startTime) as Array<{ duration: number }>;
	perfMetrics.end(perfStart, 'getAggregatedStats:autoRunTaskPercentiles', {
		sampleCount: rows.length,
	});
	return rows.length > 0 ? percentilesFromSorted(rows.map((r) => r.duration)) : emptyPercentiles();
}

/**
 * Query daily costs aggregated by date.
 * Returns both local (Maestro calculated) and Anthropic (API pricing) costs.
 */
export function queryDailyCosts(db: Database.Database, startTime: number): DailyCostData[] {
	const perfStart = perfMetrics.start();
	const rows = db
		.prepare(
			`
      SELECT
        date(start_time / 1000, 'unixepoch', 'localtime') as date,
        COALESCE(SUM(maestro_cost_usd), SUM(total_cost_usd), 0) as local_cost,
        COALESCE(SUM(anthropic_cost_usd), SUM(total_cost_usd), 0) as anthropic_cost,
        COALESCE(SUM(anthropic_cost_usd), SUM(total_cost_usd), 0) -
          COALESCE(SUM(maestro_cost_usd), SUM(total_cost_usd), 0) as savings
      FROM query_events
      WHERE start_time >= ?
      GROUP BY date(start_time / 1000, 'unixepoch', 'localtime')
      ORDER BY date ASC
    `
		)
		.all(startTime) as Array<{
		date: string;
		local_cost: number;
		anthropic_cost: number;
		savings: number;
	}>;

	perfMetrics.end(perfStart, 'queryDailyCosts', { dayCount: rows.length });

	return rows.map((row) => ({
		date: row.date,
		localCost: row.local_cost,
		anthropicCost: row.anthropic_cost,
		savings: row.savings,
	}));
}

/**
 * Query costs aggregated by model.
 * Uses maestro_pricing_model for grouping (falls back to 'unknown' for older data).
 */
export function queryCostsByModel(db: Database.Database, startTime: number): ModelCostData[] {
	const perfStart = perfMetrics.start();
	const rows = db
		.prepare(
			`
      SELECT
        COALESCE(maestro_pricing_model, anthropic_model, 'unknown') as model,
        COALESCE(SUM(maestro_cost_usd), SUM(total_cost_usd), 0) as local_cost,
        COALESCE(SUM(anthropic_cost_usd), SUM(total_cost_usd), 0) as anthropic_cost,
        COALESCE(SUM(anthropic_cost_usd), SUM(total_cost_usd), 0) -
          COALESCE(SUM(maestro_cost_usd), SUM(total_cost_usd), 0) as savings
      FROM query_events
      WHERE start_time >= ?
      GROUP BY COALESCE(maestro_pricing_model, anthropic_model, 'unknown')
      ORDER BY local_cost DESC
    `
		)
		.all(startTime) as Array<{
		model: string;
		local_cost: number;
		anthropic_cost: number;
		savings: number;
	}>;

	perfMetrics.end(perfStart, 'queryCostsByModel', { modelCount: rows.length });

	return rows.map((row) => ({
		model: row.model,
		localCost: row.local_cost,
		anthropicCost: row.anthropic_cost,
		savings: row.savings,
	}));
}

/**
 * Get daily costs for a time range.
 * Convenience function that applies the time range filter.
 */
export function getDailyCosts(db: Database.Database, range: StatsTimeRange): DailyCostData[] {
	const startTime = getTimeRangeStart(range);
	return queryDailyCosts(db, startTime);
}

/**
 * Get costs by model for a time range.
 * Convenience function that applies the time range filter.
 */
export function getCostsByModel(db: Database.Database, range: StatsTimeRange): ModelCostData[] {
	const startTime = getTimeRangeStart(range);
	return queryCostsByModel(db, startTime);
}

/**
 * Query costs aggregated by agent (Maestro agent ID).
 * Uses agent_id for grouping (falls back to session_id for older data).
 * Includes billing mode derived from maestro_billing_mode field.
 */
export function queryCostsByAgent(db: Database.Database, startTime: number): AgentCostData[] {
	const perfStart = perfMetrics.start();
	const rows = db
		.prepare(
			`
      SELECT
        COALESCE(agent_id, session_id) as agent_id,
        COALESCE(SUM(maestro_cost_usd), SUM(total_cost_usd), 0) as local_cost,
        COALESCE(SUM(anthropic_cost_usd), SUM(total_cost_usd), 0) as anthropic_cost,
        COALESCE(SUM(anthropic_cost_usd), SUM(total_cost_usd), 0) -
          COALESCE(SUM(maestro_cost_usd), SUM(total_cost_usd), 0) as savings,
        MAX(maestro_billing_mode) as billing_mode
      FROM query_events
      WHERE start_time >= ?
      GROUP BY COALESCE(agent_id, session_id)
      ORDER BY local_cost DESC
    `
		)
		.all(startTime) as Array<{
		agent_id: string;
		local_cost: number;
		anthropic_cost: number;
		savings: number;
		billing_mode: string | null;
	}>;

	perfMetrics.end(perfStart, 'queryCostsByAgent', { agentCount: rows.length });

	return rows.map((row) => {
		// Derive billing mode from database field
		let billingMode: 'api' | 'max' | 'free' = 'api';
		if (row.billing_mode === 'max') {
			billingMode = 'max';
		} else if (row.billing_mode === 'free') {
			billingMode = 'free';
		}

		return {
			agentId: row.agent_id,
			// Use agent_id as the name since we don't have a separate name field
			// The UI can lookup display names from sessions if needed
			agentName: row.agent_id,
			localCost: row.local_cost,
			anthropicCost: row.anthropic_cost,
			savings: row.savings,
			billingMode,
		};
	});
}

/**
 * Get costs by agent for a time range.
 * Convenience function that applies the time range filter.
 */
export function getCostsByAgent(db: Database.Database, range: StatsTimeRange): AgentCostData[] {
	const startTime = getTimeRangeStart(range);
	return queryCostsByAgent(db, startTime);
}

// ============================================================================
// Free Token Stats (for DS Comparison tab — does NOT filter existing queries)
// ============================================================================

export interface FreeTokenStats {
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCacheCreationTokens: number;
	totalBillableTokens: number;
	queryCount: number;
	models: string[];
}

/**
 * Query free (local model) token stats for a time range.
 * Free tokens are those with maestro_billing_mode = 'free'.
 *
 * This is a STANDALONE query — it does NOT modify any existing aggregation queries.
 * Used by the DS Comparison tab to display free token data alongside totals.
 */
export function queryFreeTokenStats(db: Database.Database, startTime: number): FreeTokenStats {
	const perfStart = perfMetrics.start();
	const result = db
		.prepare(
			`
      SELECT
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(cache_creation_input_tokens), 0) as cache_creation_tokens,
        COUNT(*) as query_count,
        GROUP_CONCAT(DISTINCT COALESCE(anthropic_model, 'unknown')) as models
      FROM query_events
      WHERE start_time >= ? AND maestro_billing_mode = 'free'
    `
		)
		.get(startTime) as {
		input_tokens: number;
		output_tokens: number;
		cache_creation_tokens: number;
		query_count: number;
		models: string | null;
	};

	perfMetrics.end(perfStart, 'queryFreeTokenStats');

	const inputTokens = result.input_tokens || 0;
	const outputTokens = result.output_tokens || 0;
	const cacheCreationTokens = result.cache_creation_tokens || 0;

	return {
		totalInputTokens: inputTokens,
		totalOutputTokens: outputTokens,
		totalCacheCreationTokens: cacheCreationTokens,
		totalBillableTokens: inputTokens + outputTokens + cacheCreationTokens,
		queryCount: result.query_count || 0,
		models: result.models ? result.models.split(',').filter(Boolean) : [],
	};
}

/**
 * Get free token stats for a time range.
 * Convenience function that applies the time range filter.
 */
export function getFreeTokenStats(db: Database.Database, range: StatsTimeRange): FreeTokenStats {
	const startTime = getTimeRangeStart(range);
	return queryFreeTokenStats(db, startTime);
}

// ============================================================================
// Orchestrator
// ============================================================================

/**
 * Get aggregated statistics for a time range.
 *
 * Composes results from focused sub-query functions for readability
 * and independent testability.
 */
export function getAggregatedStats(db: Database.Database, range: StatsTimeRange): StatsAggregation {
	const perfStart = perfMetrics.start();
	const startTime = getTimeRangeStart(range);

	const totals = queryTotals(db, startTime);
	const byAgent = queryByAgent(db, startTime);
	const bySource = queryBySource(db, startTime);
	const byLocation = queryByLocation(db, startTime);
	const byDay = queryByDay(db, startTime);
	const byAgentByDay = queryByAgentByDay(db, startTime);
	const byHour = queryByHour(db, startTime);
	const sessionStats = querySessionStats(db, startTime);
	const bySessionByDay = queryBySessionByDay(db, startTime);
	const byAgentIdByDay = queryByAgentIdByDay(db, startTime);
	const tokenMetrics = queryTokenMetrics(db, startTime);
	const bySessionSource = queryBySessionSource(db, startTime);
	const worktreeStatus = queryByWorktreeStatus(db, startTime);
	const durationPercentiles = queryDurationPercentiles(db, startTime);
	const autoRunTaskDurationPercentiles = queryAutoRunTaskPercentiles(db, startTime);
	const imageAnnotations = countImageAnnotationsSince(db, startTime);

	const totalDuration = perfMetrics.end(perfStart, 'getAggregatedStats:total', {
		range,
		totalQueries: totals.count,
	});

	// Log warning if the aggregation is slow
	if (totalDuration > PERFORMANCE_THRESHOLDS.DASHBOARD_LOAD) {
		logger.warn(
			`getAggregatedStats took ${totalDuration.toFixed(0)}ms (threshold: ${PERFORMANCE_THRESHOLDS.DASHBOARD_LOAD}ms)`,
			LOG_CONTEXT,
			{ range, totalQueries: totals.count }
		);
	}

	return {
		totalQueries: totals.count,
		totalDuration: totals.total_duration,
		avgDuration: totals.count > 0 ? Math.round(totals.total_duration / totals.count) : 0,
		queryDurationPercentiles: durationPercentiles.overall,
		queryDurationPercentilesByAgent: durationPercentiles.byAgent,
		autoRunTaskDurationPercentiles,
		byAgent,
		bySource,
		byDay,
		byLocation,
		byHour,
		...sessionStats,
		byAgentByDay,
		bySessionByDay,
		byAgentIdByDay,
		totalOutputTokens: tokenMetrics.totalOutputTokens,
		totalInputTokens: tokenMetrics.totalInputTokens,
		avgTokensPerSecond: tokenMetrics.avgTokensPerSecond,
		avgOutputTokensPerQuery: tokenMetrics.avgOutputTokensPerQuery,
		queriesWithTokenData: tokenMetrics.queriesWithTokenData,
		totalCacheReadInputTokens: tokenMetrics.totalCacheReadInputTokens,
		totalCacheCreationInputTokens: tokenMetrics.totalCacheCreationInputTokens,
		totalCostUsd: tokenMetrics.totalCostUsd,
		anthropicCostUsd: tokenMetrics.anthropicCostUsd,
		savingsUsd: tokenMetrics.savingsUsd,
		bySessionSource,
		worktreeQueries: worktreeStatus.worktreeQueries,
		parentQueries: worktreeStatus.parentQueries,
		byWorktreeStatus: worktreeStatus.byWorktreeStatus,
		imageAnnotations,
	};
}
