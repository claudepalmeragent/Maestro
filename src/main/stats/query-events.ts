/**
 * Query Event CRUD Operations
 *
 * Handles insertion and retrieval of individual AI query/response cycle records.
 */

import type Database from 'better-sqlite3';
import type { QueryEvent, StatsTimeRange, StatsFilters } from '../../shared/stats-types';
import { generateId, getTimeRangeStart, normalizePath, LOG_CONTEXT } from './utils';
import { mapQueryEventRow, type QueryEventRow } from './row-mappers';
import { StatementCache } from './utils';
import { logger } from '../utils/logger';

const stmtCache = new StatementCache();

const INSERT_SQL = `
  INSERT INTO query_events
  (id, session_id, agent_id, agent_type, source, start_time, duration, project_path, tab_id,
   is_remote, input_tokens, output_tokens, tokens_per_second,
   cache_read_input_tokens, cache_creation_input_tokens, total_cost_usd,
   anthropic_cost_usd, anthropic_model,
   maestro_cost_usd, maestro_billing_mode, maestro_pricing_model, maestro_calculated_at,
   uuid, anthropic_message_id, is_reconstructed, reconstructed_at, claude_session_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

/**
 * Insert a new query event
 */
export function insertQueryEvent(db: Database.Database, event: Omit<QueryEvent, 'id'>): string {
	const id = generateId();
	const stmt = stmtCache.get(db, INSERT_SQL);

	stmt.run(
		id,
		event.sessionId,
		event.agentId ?? null,
		event.agentType,
		event.source,
		event.startTime,
		event.duration,
		normalizePath(event.projectPath),
		event.tabId ?? null,
		event.isRemote !== undefined ? (event.isRemote ? 1 : 0) : null,
		event.inputTokens ?? null,
		event.outputTokens ?? null,
		event.tokensPerSecond ?? null,
		event.cacheReadInputTokens ?? null,
		event.cacheCreationInputTokens ?? null,
		event.totalCostUsd ?? null,
		// Dual-source cost tracking (v7)
		event.anthropicCostUsd ?? null,
		event.anthropicModel ?? null,
		event.maestroCostUsd ?? null,
		event.maestroBillingMode ?? null,
		event.maestroPricingModel ?? null,
		event.maestroCalculatedAt ?? null,
		event.uuid ?? null,
		event.anthropicMessageId ?? null,
		event.isReconstructed !== undefined ? (event.isReconstructed ? 1 : 0) : 0,
		event.reconstructedAt ?? null,
		event.claudeSessionId ?? null
	);

	logger.debug(`Inserted query event ${id}`, LOG_CONTEXT);
	return id;
}

/**
 * Get query events within a time range with optional filters
 */
export function getQueryEvents(
	db: Database.Database,
	range: StatsTimeRange,
	filters?: StatsFilters
): QueryEvent[] {
	const startTime = getTimeRangeStart(range);
	let sql = 'SELECT * FROM query_events WHERE start_time >= ?';
	const params: (string | number)[] = [startTime];

	if (filters?.agentType) {
		sql += ' AND agent_type = ?';
		params.push(filters.agentType);
	}
	if (filters?.source) {
		sql += ' AND source = ?';
		params.push(filters.source);
	}
	if (filters?.projectPath) {
		sql += ' AND project_path = ?';
		// Normalize filter path to match stored format
		params.push(normalizePath(filters.projectPath) ?? '');
	}
	if (filters?.sessionId) {
		sql += ' AND session_id = ?';
		params.push(filters.sessionId);
	}

	sql += ' ORDER BY start_time DESC';

	const stmt = db.prepare(sql);
	const rows = stmt.all(...params) as QueryEventRow[];

	return rows.map(mapQueryEventRow);
}

/**
 * Clear the statement cache (call when database is closed)
 */
export function clearQueryEventCache(): void {
	stmtCache.clear();
}
