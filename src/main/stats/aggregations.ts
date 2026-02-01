/**
 * Stats Aggregation Queries
 *
 * Decomposes the monolithic getAggregatedStats into focused sub-query functions,
 * each independently testable and readable.
 */

import type Database from 'better-sqlite3';
import type { StatsTimeRange, StatsAggregation } from '../../shared/stats-types';
import { PERFORMANCE_THRESHOLDS } from '../../shared/performance-metrics';
import { getTimeRangeStart, perfMetrics, LOG_CONTEXT } from './utils';
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

function queryTokenMetrics(
	db: Database.Database,
	startTime: number
): {
	queriesWithTokenData: number;
	totalInputTokens: number;
	totalOutputTokens: number;
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
		avg_tokens_per_second: number;
		avg_output_tokens: number;
	};
	perfMetrics.end(perfStart, 'getAggregatedStats:tokenMetrics');
	return {
		queriesWithTokenData: result.queries_with_data,
		totalInputTokens: result.total_input_tokens,
		totalOutputTokens: result.total_output_tokens,
		avgTokensPerSecond: result.avg_tokens_per_second,
		avgOutputTokensPerQuery: result.avg_output_tokens,
	};
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
	const tokenMetrics = queryTokenMetrics(db, startTime);

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
		byAgent,
		bySource,
		byDay,
		byLocation,
		byHour,
		...sessionStats,
		byAgentByDay,
		bySessionByDay,
		totalOutputTokens: tokenMetrics.totalOutputTokens,
		totalInputTokens: tokenMetrics.totalInputTokens,
		avgTokensPerSecond: tokenMetrics.avgTokensPerSecond,
		avgOutputTokensPerQuery: tokenMetrics.avgOutputTokensPerQuery,
		queriesWithTokenData: tokenMetrics.queriesWithTokenData,
	};
}
