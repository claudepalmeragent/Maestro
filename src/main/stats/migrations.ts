/**
 * Stats Database Migration System
 *
 * Manages schema evolution through versioned, sequential migrations.
 * Each migration runs exactly once and is recorded in the _migrations table.
 *
 * ### Adding New Migrations
 *
 * 1. Create a new `migrateVN()` function
 * 2. Add it to the `getMigrations()` array with version number and description
 * 3. Update `STATS_DB_VERSION` in `../../shared/stats-types.ts`
 */

import type Database from 'better-sqlite3';
import type { Migration, MigrationRecord } from './types';
import { mapMigrationRecordRow, type MigrationRecordRow } from './row-mappers';
import {
	CREATE_MIGRATIONS_TABLE_SQL,
	CREATE_QUERY_EVENTS_SQL,
	CREATE_QUERY_EVENTS_INDEXES_SQL,
	CREATE_AUTO_RUN_SESSIONS_SQL,
	CREATE_AUTO_RUN_SESSIONS_INDEXES_SQL,
	CREATE_AUTO_RUN_TASKS_SQL,
	CREATE_AUTO_RUN_TASKS_INDEXES_SQL,
	CREATE_SESSION_LIFECYCLE_SQL,
	CREATE_SESSION_LIFECYCLE_INDEXES_SQL,
	CREATE_AUDIT_SNAPSHOTS_SQL,
	CREATE_AUDIT_SNAPSHOTS_INDEXES_SQL,
	CREATE_AUDIT_SCHEDULE_SQL,
	runStatements,
} from './schema';
import { LOG_CONTEXT } from './utils';
import { logger } from '../utils/logger';

// ============================================================================
// Migration Registry
// ============================================================================

/**
 * Registry of all database migrations.
 * Migrations must be sequential starting from version 1.
 */
export function getMigrations(): Migration[] {
	return [
		{
			version: 1,
			description: 'Initial schema: query_events, auto_run_sessions, auto_run_tasks tables',
			up: (db) => migrateV1(db),
		},
		{
			version: 2,
			description: 'Add is_remote column to query_events for tracking SSH sessions',
			up: (db) => migrateV2(db),
		},
		{
			version: 3,
			description: 'Add session_lifecycle table for tracking session creation and closure',
			up: (db) => migrateV3(db),
		},
		{
			version: 4,
			description: 'Add token metrics columns to query_events for throughput tracking',
			up: (db) => migrateV4(db),
		},
		{
			version: 5,
			description: 'Add cache token and cost columns to query_events',
			up: (db) => migrateV5(db),
		},
		{
			version: 6,
			description: 'Add agent_id column for proper agent attribution in charts',
			up: (db) => migrateV6(db),
		},
		{
			version: 7,
			description: 'Add dual-source cost tracking columns and audit tables',
			up: (db) => migrateV7(db),
		},
		{
			version: 8,
			description: 'Add claude_session_id for reconstruction matching',
			up: (db) => migrateV8(db),
		},
	];
}

// ============================================================================
// Migration Execution
// ============================================================================

/**
 * Run all pending database migrations.
 *
 * 1. Creates the _migrations table if it doesn't exist
 * 2. Gets the current schema version from user_version pragma
 * 3. Runs each pending migration in a transaction
 * 4. Records each migration in the _migrations table
 * 5. Updates the user_version pragma
 */
export function runMigrations(db: Database.Database): void {
	// Create migrations table (the only table created outside the migration system)
	db.prepare(CREATE_MIGRATIONS_TABLE_SQL).run();

	// Get current version (0 if fresh database)
	const versionResult = db.pragma('user_version') as Array<{ user_version: number }>;
	const currentVersion = versionResult[0]?.user_version ?? 0;

	const migrations = getMigrations();
	const pendingMigrations = migrations.filter((m) => m.version > currentVersion);

	if (pendingMigrations.length === 0) {
		logger.debug(`Database is up to date (version ${currentVersion})`, LOG_CONTEXT);
		return;
	}

	// Sort by version to ensure sequential execution
	pendingMigrations.sort((a, b) => a.version - b.version);

	logger.info(
		`Running ${pendingMigrations.length} pending migration(s) (current version: ${currentVersion})`,
		LOG_CONTEXT
	);

	for (const migration of pendingMigrations) {
		applyMigration(db, migration);
	}
}

/**
 * Apply a single migration within a transaction.
 * Records the migration in the _migrations table with success/failure status.
 */
function applyMigration(db: Database.Database, migration: Migration): void {
	const startTime = Date.now();
	logger.info(`Applying migration v${migration.version}: ${migration.description}`, LOG_CONTEXT);

	try {
		const runMigrationTxn = db.transaction(() => {
			migration.up(db);

			db.prepare(
				`
        INSERT OR REPLACE INTO _migrations (version, description, applied_at, status, error_message)
        VALUES (?, ?, ?, 'success', NULL)
      `
			).run(migration.version, migration.description, Date.now());

			db.pragma(`user_version = ${migration.version}`);
		});

		runMigrationTxn();

		const duration = Date.now() - startTime;
		logger.info(`Migration v${migration.version} completed in ${duration}ms`, LOG_CONTEXT);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);

		db.prepare(
			`
      INSERT OR REPLACE INTO _migrations (version, description, applied_at, status, error_message)
      VALUES (?, ?, ?, 'failed', ?)
    `
		).run(migration.version, migration.description, Date.now(), errorMessage);

		logger.error(`Migration v${migration.version} failed: ${errorMessage}`, LOG_CONTEXT);
		throw error;
	}
}

// ============================================================================
// Migration Queries
// ============================================================================

/**
 * Get the list of applied migrations from the _migrations table.
 */
export function getMigrationHistory(db: Database.Database): MigrationRecord[] {
	const tableExists = db
		.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'")
		.get();

	if (!tableExists) {
		return [];
	}

	const rows = db
		.prepare(
			`
      SELECT version, description, applied_at, status, error_message
      FROM _migrations
      ORDER BY version ASC
    `
		)
		.all() as MigrationRecordRow[];

	return rows.map(mapMigrationRecordRow);
}

/**
 * Get the current database schema version.
 */
export function getCurrentVersion(db: Database.Database): number {
	const versionResult = db.pragma('user_version') as Array<{ user_version: number }>;
	return versionResult[0]?.user_version ?? 0;
}

/**
 * Get the target version (highest version in migrations registry).
 */
export function getTargetVersion(): number {
	const migrations = getMigrations();
	if (migrations.length === 0) return 0;
	return Math.max(...migrations.map((m) => m.version));
}

/**
 * Check if any migrations are pending.
 */
export function hasPendingMigrations(db: Database.Database): boolean {
	return getCurrentVersion(db) < getTargetVersion();
}

// ============================================================================
// Individual Migration Functions
// ============================================================================

/**
 * Migration v1: Initial schema creation
 */
function migrateV1(db: Database.Database): void {
	db.prepare(CREATE_QUERY_EVENTS_SQL).run();
	runStatements(db, CREATE_QUERY_EVENTS_INDEXES_SQL);

	db.prepare(CREATE_AUTO_RUN_SESSIONS_SQL).run();
	runStatements(db, CREATE_AUTO_RUN_SESSIONS_INDEXES_SQL);

	db.prepare(CREATE_AUTO_RUN_TASKS_SQL).run();
	runStatements(db, CREATE_AUTO_RUN_TASKS_INDEXES_SQL);

	logger.debug('Created stats database tables and indexes', LOG_CONTEXT);
}

/**
 * Migration v2: Add is_remote column for SSH session tracking
 */
function migrateV2(db: Database.Database): void {
	db.prepare('ALTER TABLE query_events ADD COLUMN is_remote INTEGER').run();
	db.prepare('CREATE INDEX IF NOT EXISTS idx_query_is_remote ON query_events(is_remote)').run();

	logger.debug('Added is_remote column to query_events table', LOG_CONTEXT);
}

/**
 * Migration v3: Add session_lifecycle table
 */
function migrateV3(db: Database.Database): void {
	db.prepare(CREATE_SESSION_LIFECYCLE_SQL).run();
	runStatements(db, CREATE_SESSION_LIFECYCLE_INDEXES_SQL);

	logger.debug('Created session_lifecycle table', LOG_CONTEXT);
}

/**
 * Migration v4: Add token metrics columns to query_events
 *
 * Adds columns to track per-request token counts and throughput:
 * - input_tokens: Number of tokens sent in the request
 * - output_tokens: Number of tokens received in the response
 * - tokens_per_second: Calculated throughput (output_tokens / duration_seconds)
 *
 * These enable throughput metrics in the Usage Dashboard.
 */
function migrateV4(db: Database.Database): void {
	db.prepare('ALTER TABLE query_events ADD COLUMN input_tokens INTEGER').run();
	db.prepare('ALTER TABLE query_events ADD COLUMN output_tokens INTEGER').run();
	db.prepare('ALTER TABLE query_events ADD COLUMN tokens_per_second REAL').run();

	logger.debug('Added token metrics columns to query_events table', LOG_CONTEXT);
}

/**
 * Migration v5: Add cache tokens and cost columns
 * - cache_read_input_tokens: Cache read tokens from prompt caching
 * - cache_creation_input_tokens: Cache creation tokens from prompt caching
 * - total_cost_usd: Total cost in USD for the query
 */
function migrateV5(db: Database.Database): void {
	// Add cache token columns
	db.prepare('ALTER TABLE query_events ADD COLUMN cache_read_input_tokens INTEGER').run();
	db.prepare('ALTER TABLE query_events ADD COLUMN cache_creation_input_tokens INTEGER').run();

	// Add cost column
	db.prepare('ALTER TABLE query_events ADD COLUMN total_cost_usd REAL').run();

	logger.debug('Added cache token and cost columns to query_events table', LOG_CONTEXT);
}

/**
 * Migration v6: Add agent_id column for proper agent attribution
 *
 * The agent_id column stores the base Maestro agent ID without
 * -batch-*, -ai-*, -synopsis-* suffixes. This enables proper
 * grouping of all queries from the same agent in Usage Dashboard charts.
 */
function migrateV6(db: Database.Database): void {
	logger.info('Migrating stats database to v6: Adding agent_id column', LOG_CONTEXT);

	// Add agent_id column
	db.prepare('ALTER TABLE query_events ADD COLUMN agent_id TEXT').run();

	// Create index for efficient GROUP BY queries
	db.prepare(
		'CREATE INDEX IF NOT EXISTS idx_query_events_agent_id ON query_events(agent_id)'
	).run();

	// Backfill existing data: Extract base agent ID from session_id
	// Strips -batch-*, -ai-*, -synopsis-* suffixes
	db.prepare(
		`
		UPDATE query_events
		SET agent_id = CASE
			WHEN session_id LIKE '%-batch-%' THEN substr(session_id, 1, instr(session_id, '-batch-') - 1)
			WHEN session_id LIKE '%-ai-%' THEN substr(session_id, 1, instr(session_id, '-ai-') - 1)
			WHEN session_id LIKE '%-synopsis-%' THEN substr(session_id, 1, instr(session_id, '-synopsis-') - 1)
			ELSE session_id
		END
		WHERE agent_id IS NULL
	`
	).run();

	logger.info('Migration v6 complete: agent_id column added and backfilled', LOG_CONTEXT);
}

/**
 * Migration v7: Add dual-source cost tracking and audit tables
 *
 * Adds columns to query_events for tracking costs from both Anthropic (Claude Code)
 * and Maestro's internal calculations:
 * - anthropic_cost_usd: Cost reported by Anthropic
 * - anthropic_model: Model name from the response
 * - maestro_cost_usd: Cost calculated by Maestro pricing
 * - maestro_billing_mode: 'api' | 'max' | 'free'
 * - maestro_pricing_model: Pricing model used
 * - maestro_calculated_at: Timestamp of calculation
 * - uuid: Unique identifier for reconstruction
 * - anthropic_message_id: Message ID for deduplication
 * - is_reconstructed: Whether the record was reconstructed
 * - reconstructed_at: When the record was reconstructed
 *
 * Also creates audit_snapshots and audit_schedule tables.
 */
function migrateV7(db: Database.Database): void {
	logger.info('Migrating stats database to v7: Adding dual-source cost tracking', LOG_CONTEXT);

	// Add Anthropic cost columns
	db.prepare('ALTER TABLE query_events ADD COLUMN anthropic_cost_usd REAL').run();
	db.prepare('ALTER TABLE query_events ADD COLUMN anthropic_model TEXT').run();

	// Add Maestro cost columns
	db.prepare('ALTER TABLE query_events ADD COLUMN maestro_cost_usd REAL').run();
	db.prepare('ALTER TABLE query_events ADD COLUMN maestro_billing_mode TEXT').run();
	db.prepare('ALTER TABLE query_events ADD COLUMN maestro_pricing_model TEXT').run();
	db.prepare('ALTER TABLE query_events ADD COLUMN maestro_calculated_at INTEGER').run();

	// Add reconstruction tracking columns
	db.prepare('ALTER TABLE query_events ADD COLUMN uuid TEXT').run();
	db.prepare('ALTER TABLE query_events ADD COLUMN anthropic_message_id TEXT').run();
	db.prepare('ALTER TABLE query_events ADD COLUMN is_reconstructed INTEGER DEFAULT 0').run();
	db.prepare('ALTER TABLE query_events ADD COLUMN reconstructed_at INTEGER').run();

	// Create indexes for reconstruction lookups
	db.prepare('CREATE INDEX IF NOT EXISTS idx_query_events_uuid ON query_events(uuid)').run();
	db.prepare(
		'CREATE INDEX IF NOT EXISTS idx_query_events_anthropic_msg_id ON query_events(anthropic_message_id)'
	).run();

	// Copy existing total_cost_usd to anthropic_cost_usd for backward compatibility
	db.prepare(
		'UPDATE query_events SET anthropic_cost_usd = total_cost_usd WHERE anthropic_cost_usd IS NULL AND total_cost_usd IS NOT NULL'
	).run();

	// Create audit tables
	db.prepare(CREATE_AUDIT_SNAPSHOTS_SQL).run();
	runStatements(db, CREATE_AUDIT_SNAPSHOTS_INDEXES_SQL);

	db.prepare(CREATE_AUDIT_SCHEDULE_SQL).run();

	logger.info(
		'Migration v7 complete: dual-source cost tracking columns and audit tables added',
		LOG_CONTEXT
	);
}

/**
 * Migration v8: Add claude_session_id column
 *
 * Stores Claude Code's internal session UUID to enable matching
 * between JSONL files and Maestro's query_events during reconstruction.
 */
function migrateV8(db: Database.Database): void {
	logger.info('Migrating stats database to v8: Adding claude_session_id column', LOG_CONTEXT);

	// Add claude_session_id column
	db.prepare('ALTER TABLE query_events ADD COLUMN claude_session_id TEXT').run();

	// Create index for efficient reconstruction matching
	db.prepare(
		'CREATE INDEX IF NOT EXISTS idx_query_events_claude_session_id ON query_events(claude_session_id)'
	).run();

	logger.info('Migration v8 complete: claude_session_id column added', LOG_CONTEXT);
}
