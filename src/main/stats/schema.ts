/**
 * Stats Database Schema
 *
 * SQL definitions for all tables and indexes, plus helper utilities
 * for executing multi-statement SQL strings.
 */

import type Database from 'better-sqlite3';

// ============================================================================
// Migrations Infrastructure
// ============================================================================

export const CREATE_MIGRATIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS _migrations (
    version INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('success', 'failed')),
    error_message TEXT
  )
`;

// ============================================================================
// Metadata Table (for internal key-value storage like vacuum timestamps)
// ============================================================================

export const CREATE_META_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS _meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`;

// ============================================================================
// Query Events (Migration v1)
// ============================================================================

/**
 * Query events table schema
 * Stores individual query/completion events for analytics
 *
 * Base columns (v1):
 * - id: TEXT PRIMARY KEY
 * - session_id: TEXT NOT NULL
 * - agent_type: TEXT NOT NULL
 * - source: TEXT NOT NULL ('user' | 'auto')
 * - start_time: INTEGER NOT NULL
 * - duration: INTEGER NOT NULL
 * - project_path: TEXT (nullable)
 * - tab_id: TEXT (nullable)
 *
 * Added via migrations:
 * - is_remote: INTEGER (nullable) - SSH session indicator (v2)
 * - input_tokens: INTEGER (nullable) - Input token count (v4)
 * - output_tokens: INTEGER (nullable) - Output token count (v4)
 * - tokens_per_second: REAL (nullable) - Throughput metric (v4)
 * - cache_read_input_tokens: INTEGER (nullable) - Cache read tokens (v5)
 * - cache_creation_input_tokens: INTEGER (nullable) - Cache creation tokens (v5)
 * - total_cost_usd: REAL (nullable) - Cost in USD (v5)
 * - agent_id: TEXT (nullable) - Maestro agent ID without suffixes (v6)
 *
 * Dual-source cost tracking (v7):
 * - anthropic_cost_usd: REAL (nullable) - Cost reported by Anthropic/Claude Code
 * - anthropic_model: TEXT (nullable) - Model name from Anthropic response
 * - maestro_cost_usd: REAL (nullable) - Cost calculated by Maestro pricing
 * - maestro_billing_mode: TEXT (nullable) - 'api' | 'max' | 'free'
 * - maestro_pricing_model: TEXT (nullable) - Pricing model used for calculation
 * - maestro_calculated_at: INTEGER (nullable) - Timestamp of Maestro calculation
 * - uuid: TEXT (nullable) - Unique identifier for reconstruction
 * - anthropic_message_id: TEXT (nullable) - Message ID from Anthropic for deduplication
 * - is_reconstructed: INTEGER DEFAULT 0 - Whether this record was reconstructed
 * - reconstructed_at: INTEGER (nullable) - When the record was reconstructed
 */
export const CREATE_QUERY_EVENTS_SQL = `
  CREATE TABLE IF NOT EXISTS query_events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('user', 'auto')),
    start_time INTEGER NOT NULL,
    duration INTEGER NOT NULL,
    project_path TEXT,
    tab_id TEXT
  )
`;

export const CREATE_QUERY_EVENTS_INDEXES_SQL = `
  CREATE INDEX IF NOT EXISTS idx_query_start_time ON query_events(start_time);
  CREATE INDEX IF NOT EXISTS idx_query_agent_type ON query_events(agent_type);
  CREATE INDEX IF NOT EXISTS idx_query_source ON query_events(source);
  CREATE INDEX IF NOT EXISTS idx_query_session ON query_events(session_id);
  CREATE INDEX IF NOT EXISTS idx_query_project_path ON query_events(project_path);
  CREATE INDEX IF NOT EXISTS idx_query_agent_time ON query_events(agent_type, start_time)
`;

// ============================================================================
// Auto Run Sessions (Migration v1)
// ============================================================================

export const CREATE_AUTO_RUN_SESSIONS_SQL = `
  CREATE TABLE IF NOT EXISTS auto_run_sessions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    document_path TEXT,
    start_time INTEGER NOT NULL,
    duration INTEGER NOT NULL,
    tasks_total INTEGER,
    tasks_completed INTEGER,
    project_path TEXT
  )
`;

export const CREATE_AUTO_RUN_SESSIONS_INDEXES_SQL = `
  CREATE INDEX IF NOT EXISTS idx_auto_session_start ON auto_run_sessions(start_time)
`;

// ============================================================================
// Auto Run Tasks (Migration v1)
// ============================================================================

export const CREATE_AUTO_RUN_TASKS_SQL = `
  CREATE TABLE IF NOT EXISTS auto_run_tasks (
    id TEXT PRIMARY KEY,
    auto_run_session_id TEXT NOT NULL REFERENCES auto_run_sessions(id),
    session_id TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    task_index INTEGER NOT NULL,
    task_content TEXT,
    start_time INTEGER NOT NULL,
    duration INTEGER NOT NULL,
    success INTEGER NOT NULL CHECK(success IN (0, 1))
  )
`;

export const CREATE_AUTO_RUN_TASKS_INDEXES_SQL = `
  CREATE INDEX IF NOT EXISTS idx_task_auto_session ON auto_run_tasks(auto_run_session_id);
  CREATE INDEX IF NOT EXISTS idx_task_start ON auto_run_tasks(start_time)
`;

// ============================================================================
// Session Lifecycle (Migration v3)
// ============================================================================

export const CREATE_SESSION_LIFECYCLE_SQL = `
  CREATE TABLE IF NOT EXISTS session_lifecycle (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL UNIQUE,
    agent_type TEXT NOT NULL,
    project_path TEXT,
    created_at INTEGER NOT NULL,
    closed_at INTEGER,
    duration INTEGER,
    is_remote INTEGER
  )
`;

export const CREATE_SESSION_LIFECYCLE_INDEXES_SQL = `
  CREATE INDEX IF NOT EXISTS idx_session_created_at ON session_lifecycle(created_at);
  CREATE INDEX IF NOT EXISTS idx_session_agent_type ON session_lifecycle(agent_type)
`;

// ============================================================================
// Audit Snapshots (Migration v7)
// ============================================================================

/**
 * Audit snapshots table - stores periodic cost comparison results
 *
 * Captures snapshots of token and cost data from both Anthropic (via ccusage)
 * and Maestro's internal calculations for reconciliation and auditing.
 */
export const CREATE_AUDIT_SNAPSHOTS_SQL = `
  CREATE TABLE IF NOT EXISTS audit_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    audit_type TEXT NOT NULL CHECK(audit_type IN ('daily', 'weekly', 'monthly', 'manual')),

    -- Anthropic totals (from ccusage)
    anthropic_input_tokens INTEGER,
    anthropic_output_tokens INTEGER,
    anthropic_cache_read_tokens INTEGER,
    anthropic_cache_write_tokens INTEGER,
    anthropic_total_cost REAL,

    -- Maestro totals (from our database)
    maestro_input_tokens INTEGER,
    maestro_output_tokens INTEGER,
    maestro_cache_read_tokens INTEGER,
    maestro_cache_write_tokens INTEGER,
    maestro_anthropic_cost REAL,
    maestro_calculated_cost REAL,

    -- Comparison results
    token_match_percent REAL,
    cost_discrepancy_usd REAL,
    anomaly_count INTEGER,

    -- Full audit result (JSON blob)
    audit_result_json TEXT,

    -- Status
    status TEXT DEFAULT 'completed' CHECK(status IN ('completed', 'failed', 'partial'))
  )
`;

export const CREATE_AUDIT_SNAPSHOTS_INDEXES_SQL = `
  CREATE INDEX IF NOT EXISTS idx_audit_snapshots_period ON audit_snapshots(period_start, period_end);
  CREATE INDEX IF NOT EXISTS idx_audit_snapshots_created ON audit_snapshots(created_at)
`;

// ============================================================================
// Audit Schedule (Migration v7)
// ============================================================================

/**
 * Audit schedule table - configuration for scheduled audits
 *
 * Stores settings for automatic daily/weekly/monthly audit runs.
 */
export const CREATE_AUDIT_SCHEDULE_SQL = `
  CREATE TABLE IF NOT EXISTS audit_schedule (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_type TEXT NOT NULL CHECK(schedule_type IN ('daily', 'weekly', 'monthly')),
    enabled INTEGER DEFAULT 0,

    -- Schedule configuration
    run_time TEXT,
    run_day INTEGER,

    -- Last run info
    last_run_at INTEGER,
    last_run_status TEXT,
    next_run_at INTEGER,

    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`;

// ============================================================================
// Utilities
// ============================================================================

/**
 * Execute a multi-statement SQL string by splitting on semicolons.
 *
 * Useful for running multiple CREATE INDEX statements defined in a single string.
 */
export function runStatements(db: Database.Database, multiStatementSql: string): void {
	for (const sql of multiStatementSql.split(';').filter((s) => s.trim())) {
		db.prepare(sql).run();
	}
}
