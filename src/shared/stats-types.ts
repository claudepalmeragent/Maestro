/**
 * Type definitions for the stats tracking system
 *
 * These types are shared between main process (stats/) and renderer (dashboard).
 */

/**
 * A single AI query event - represents one user/auto message -> AI response cycle
 */
export interface QueryEvent {
	id: string;
	sessionId: string;
	agentId?: string; // Maestro agent ID (stable identifier, no batch/ai/synopsis suffixes)
	agentType: string;
	source: 'user' | 'auto';
	startTime: number;
	duration: number;
	projectPath?: string;
	tabId?: string;
	/** Whether this query was executed on a remote SSH session */
	isRemote?: boolean;
	/** Input tokens sent in this request */
	inputTokens?: number;
	/** Output tokens received in response */
	outputTokens?: number;
	/** Calculated throughput: outputTokens / (duration/1000) */
	tokensPerSecond?: number;
	// Cache tokens and cost (added in v5)
	cacheReadInputTokens?: number;
	cacheCreationInputTokens?: number;
	/** @deprecated Use anthropicCostUsd instead. Kept for backward compatibility. */
	totalCostUsd?: number;

	// Anthropic values (from Claude Code response) - added in v7
	/** Cost reported by Anthropic/Claude Code */
	anthropicCostUsd?: number;
	/** Model name from Anthropic response */
	anthropicModel?: string;

	// Maestro calculated values - added in v7
	/** Cost calculated by Maestro pricing */
	maestroCostUsd?: number;
	/** Billing mode: 'api' | 'max' | 'free' */
	maestroBillingMode?: 'api' | 'max' | 'free';
	/** Pricing model used for calculation */
	maestroPricingModel?: string;
	/** Timestamp when Maestro calculated the cost */
	maestroCalculatedAt?: number;

	// Reconstruction tracking - added in v7
	/** Unique identifier for reconstruction */
	uuid?: string;
	/** Message ID from Anthropic for deduplication */
	anthropicMessageId?: string;
	/** Whether this record was reconstructed from external data */
	isReconstructed?: boolean;
	/** Timestamp when the record was reconstructed */
	reconstructedAt?: number;
}

/**
 * An Auto Run session - a complete batch processing run of a document
 */
export interface AutoRunSession {
	id: string;
	sessionId: string;
	agentType: string;
	documentPath?: string;
	startTime: number;
	duration: number;
	tasksTotal?: number;
	tasksCompleted?: number;
	projectPath?: string;
}

/**
 * A single task within an Auto Run session
 */
export interface AutoRunTask {
	id: string;
	autoRunSessionId: string;
	sessionId: string;
	agentType: string;
	taskIndex: number;
	taskContent?: string;
	startTime: number;
	duration: number;
	success: boolean;
}

/**
 * Session lifecycle event - tracks when sessions are created and closed
 */
export interface SessionLifecycleEvent {
	id: string;
	sessionId: string;
	agentType: string;
	projectPath?: string;
	createdAt: number;
	closedAt?: number;
	/** Duration in ms (computed from closedAt - createdAt when session is closed) */
	duration?: number;
	/** Whether this was a remote SSH session */
	isRemote?: boolean;
}

/**
 * Time range for querying stats
 */
export type StatsTimeRange = 'day' | 'week' | 'month' | 'year' | 'all';

/**
 * Aggregated stats for dashboard display
 */
export interface StatsAggregation {
	totalQueries: number;
	totalDuration: number;
	avgDuration: number;
	byAgent: Record<
		string,
		{ count: number; duration: number; totalOutputTokens: number; avgTokensPerSecond: number }
	>;
	bySource: { user: number; auto: number };
	byDay: Array<{
		date: string;
		count: number;
		duration: number;
		outputTokens?: number;
		avgTokensPerSecond?: number;
	}>;
	/** Breakdown by session location (local vs SSH remote) */
	byLocation: { local: number; remote: number };
	/** Breakdown by hour of day (0-23) for peak hours chart */
	byHour: Array<{ hour: number; count: number; duration: number }>;
	/** Total unique sessions launched in the time period */
	totalSessions: number;
	/** Sessions by agent type */
	sessionsByAgent: Record<string, number>;
	/** Sessions launched per day */
	sessionsByDay: Array<{ date: string; count: number }>;
	/** Average session duration in ms (for closed sessions) */
	avgSessionDuration: number;
	/** Queries and duration by provider per day (for provider comparison and throughput trends) */
	byAgentByDay: Record<
		string,
		Array<{
			date: string;
			count: number;
			duration: number;
			outputTokens: number;
			avgTokensPerSecond: number;
		}>
	>;
	/** Queries and duration by Maestro session per day (for agent usage chart and throughput trends) */
	bySessionByDay: Record<
		string,
		Array<{
			date: string;
			count: number;
			duration: number;
			outputTokens: number;
			avgTokensPerSecond: number;
		}>
	>;
	/** Aggregation by Maestro agent ID (not fragmented session IDs) - for proper agent attribution in charts */
	byAgentIdByDay: Record<
		string,
		Array<{
			date: string;
			count: number;
			duration: number;
			outputTokens: number;
			avgTokensPerSecond: number;
		}>
	>;
	/** Total output tokens generated across all queries */
	totalOutputTokens: number;
	/** Total input tokens sent across all queries */
	totalInputTokens: number;
	/** Average throughput in tokens per second (for queries with token data) */
	avgTokensPerSecond: number;
	/** Average output tokens per query (for queries with token data) */
	avgOutputTokensPerQuery: number;
	/** Number of queries that have token data */
	queriesWithTokenData: number;
	// Cache tokens and cost aggregates (added in v5)
	totalCacheReadInputTokens: number;
	totalCacheCreationInputTokens: number;
	/** Primary cost: Maestro calculated (billing-mode aware) */
	totalCostUsd: number;
	/** Secondary cost: Anthropic reported (API pricing) - added in v7 */
	anthropicCostUsd: number;
	/** Savings calculation (API - Maestro) - added in v7 */
	savingsUsd: number;
}

/**
 * Filters for querying stats
 */
export interface StatsFilters {
	agentType?: string;
	source?: 'user' | 'auto';
	projectPath?: string;
	sessionId?: string;
}

/**
 * Database schema version for migrations
 * Version 4: Added input_tokens, output_tokens, tokens_per_second columns to query_events
 * Version 5: Added cache_read_input_tokens, cache_creation_input_tokens, total_cost_usd columns
 * Version 6: Added agent_id column for proper Maestro agent attribution
 * Version 7: Added dual-source cost tracking (Anthropic + Maestro) and audit tables
 */
export const STATS_DB_VERSION = 7;
