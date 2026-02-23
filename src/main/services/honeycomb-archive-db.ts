/**
 * HoneycombArchiveDB
 *
 * Manages the dedicated SQLite database for Honeycomb data archival.
 * Separate from stats.db to keep archival data portable and independent.
 *
 * Tables:
 * - honeycomb_daily: Tier 1 aggregated rollups (Phase 1)
 * - honeycomb_raw_events: Tier 2 raw events (Phase 2 — created but not populated yet)
 * - task_complexity_log: Task complexity scoring for self-calibration
 * - honeycomb_archive_meta: Shared metadata (last archive date, flags, etc.)
 *
 * @see Investigation plan Section 19.5
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { logger } from '../utils/logger';

const LOG_CONTEXT = 'HoneycombArchiveDB';

// ============================================================================
// Schema
// ============================================================================

const SCHEMA_SQL = `
-- ============================================
-- Tier 1: Aggregated rollups (Phase 1)
-- ============================================
CREATE TABLE IF NOT EXISTS honeycomb_daily (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    query_name TEXT NOT NULL,
    breakdown_key TEXT,
    data JSON NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE (date, query_name, breakdown_key)
);

-- ============================================
-- Tier 2: Raw events (Phase 2 — table created but not populated yet)
-- ============================================
CREATE TABLE IF NOT EXISTS honeycomb_raw_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_timestamp TEXT NOT NULL,
    session_id TEXT,
    model TEXT,
    event_name TEXT,
    cost_usd REAL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_read_tokens INTEGER,
    cache_creation_tokens INTEGER,
    host_name TEXT,
    user_email TEXT,
    duration_ms REAL,
    extra JSON,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE (event_timestamp, session_id, event_name)
);

-- ============================================
-- Tier 3: Task complexity log (capacity checks)
-- ============================================
CREATE TABLE IF NOT EXISTS task_complexity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    task_type TEXT NOT NULL,
    complexity_score INTEGER,
    complexity_bucket TEXT,
    estimated_pct REAL,
    actual_billable_tokens INTEGER,
    actual_pct REAL,
    accuracy_ratio REAL,
    session_id TEXT,
    auto_run_doc TEXT,
    num_tasks INTEGER,
    num_files_touched INTEGER,
    num_lines_inserted INTEGER,
    was_limit_hit BOOLEAN DEFAULT 0,
    user_overrode_warning BOOLEAN DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================
-- Shared metadata
-- ============================================
CREATE TABLE IF NOT EXISTS honeycomb_archive_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_daily_date ON honeycomb_daily(date);
CREATE INDEX IF NOT EXISTS idx_daily_query ON honeycomb_daily(query_name);
CREATE INDEX IF NOT EXISTS idx_daily_date_range ON honeycomb_daily(date, query_name);

CREATE INDEX IF NOT EXISTS idx_raw_timestamp ON honeycomb_raw_events(event_timestamp);
CREATE INDEX IF NOT EXISTS idx_raw_session ON honeycomb_raw_events(session_id);

CREATE INDEX IF NOT EXISTS idx_complexity_timestamp ON task_complexity_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_complexity_bucket ON task_complexity_log(complexity_bucket);
CREATE INDEX IF NOT EXISTS idx_complexity_accuracy ON task_complexity_log(accuracy_ratio);
`;

// ============================================================================
// Singleton
// ============================================================================

let _instance: HoneycombArchiveDB | null = null;

export function getHoneycombArchiveDB(): HoneycombArchiveDB {
	if (!_instance) {
		_instance = new HoneycombArchiveDB();
	}
	return _instance;
}

export function closeHoneycombArchiveDB(): void {
	if (_instance) {
		_instance.close();
		_instance = null;
	}
}

// ============================================================================
// Implementation
// ============================================================================

export class HoneycombArchiveDB {
	private db: Database.Database | null = null;
	private dbPath: string;

	constructor() {
		this.dbPath = path.join(app.getPath('userData'), 'honeycomb-archive.db');
	}

	/**
	 * Initialize the database — create tables if they don't exist.
	 */
	initialize(): void {
		try {
			this.db = new Database(this.dbPath);
			this.db.pragma('journal_mode = WAL');
			this.db.pragma('synchronous = NORMAL');
			this.db.exec(SCHEMA_SQL);

			// Migration: Add data_backup column for backfill reversibility
			try {
				this.db.exec(`ALTER TABLE honeycomb_daily ADD COLUMN data_backup JSON`);
				logger.info('Added data_backup column to honeycomb_daily', LOG_CONTEXT);
			} catch {
				// Column already exists — this is expected after first run
			}

			// Migration: Add model_breakdown_available flag
			try {
				this.db.exec(
					`ALTER TABLE honeycomb_daily ADD COLUMN model_breakdown_available INTEGER DEFAULT 0`
				);
				logger.info('Added model_breakdown_available column to honeycomb_daily', LOG_CONTEXT);
			} catch {
				// Column already exists — this is expected after first run
			}

			logger.info(`Archive database initialized at ${this.dbPath}`, LOG_CONTEXT);
		} catch (error) {
			logger.error(`Failed to initialize archive database: ${error}`, LOG_CONTEXT);
			throw error;
		}
	}

	/**
	 * Get the raw database instance (for direct SQL access).
	 */
	getDB(): Database.Database {
		if (!this.db) {
			this.initialize();
		}
		return this.db!;
	}

	/**
	 * Insert or replace an aggregated daily data point.
	 */
	upsertDaily(date: string, queryName: string, breakdownKey: string | null, data: unknown): void {
		const db = this.getDB();
		const stmt = db.prepare(`
			INSERT OR REPLACE INTO honeycomb_daily (date, query_name, breakdown_key, data, updated_at)
			VALUES (?, ?, ?, ?, datetime('now'))
		`);
		stmt.run(date, queryName, breakdownKey, JSON.stringify(data));
	}

	/**
	 * Get a metadata value.
	 */
	getMeta(key: string): string | null {
		const db = this.getDB();
		const row = db.prepare('SELECT value FROM honeycomb_archive_meta WHERE key = ?').get(key) as
			| { value: string }
			| undefined;
		return row?.value ?? null;
	}

	/**
	 * Set a metadata value.
	 */
	setMeta(key: string, value: string): void {
		const db = this.getDB();
		db.prepare(
			`
			INSERT OR REPLACE INTO honeycomb_archive_meta (key, value, updated_at)
			VALUES (?, ?, datetime('now'))
		`
		).run(key, value);
	}

	/**
	 * Get daily aggregated data for a date range and query name.
	 */
	getDailyData(
		queryName: string,
		startDate: string,
		endDate: string,
		breakdownKey?: string
	): Array<{ date: string; breakdown_key: string | null; data: unknown }> {
		const db = this.getDB();
		let sql = `SELECT date, breakdown_key, data FROM honeycomb_daily
			WHERE query_name = ? AND date >= ? AND date <= ?`;
		const params: unknown[] = [queryName, startDate, endDate];

		if (breakdownKey !== undefined) {
			sql += ' AND breakdown_key = ?';
			params.push(breakdownKey);
		}

		sql += ' ORDER BY date ASC';

		const rows = db.prepare(sql).all(...params) as Array<{
			date: string;
			breakdown_key: string | null;
			data: string;
		}>;

		return rows.map((row) => ({
			date: row.date,
			breakdown_key: row.breakdown_key,
			data: JSON.parse(row.data),
		}));
	}

	/**
	 * Update a daily row with model breakdown data, backing up the original.
	 */
	backfillDailyRow(
		date: string,
		queryName: string,
		breakdownKey: string | null,
		newData: unknown
	): void {
		const db = this.getDB();
		// Backup original data before overwriting
		db.prepare(
			`
			UPDATE honeycomb_daily
			SET data_backup = CASE WHEN data_backup IS NULL THEN data ELSE data_backup END,
			    data = ?,
			    model_breakdown_available = 1,
			    updated_at = datetime('now')
			WHERE date = ? AND query_name = ? AND breakdown_key IS ?
		`
		).run(JSON.stringify(newData), date, queryName, breakdownKey);
	}

	/**
	 * Get all dates that have NOT been backfilled with model breakdowns.
	 */
	getUnbackfilledDates(queryName: string): string[] {
		const db = this.getDB();
		const rows = db
			.prepare(
				`
			SELECT DISTINCT date FROM honeycomb_daily
			WHERE query_name = ? AND (model_breakdown_available IS NULL OR model_breakdown_available = 0)
			ORDER BY date ASC
		`
			)
			.all(queryName) as Array<{ date: string }>;
		return rows.map((r) => r.date);
	}

	/**
	 * Insert a task complexity log entry.
	 */
	insertComplexityLog(entry: {
		timestamp: string;
		taskType: string;
		complexityScore: number;
		complexityBucket: string;
		estimatedPct: number;
		actualBillableTokens?: number;
		actualPct?: number;
		accuracyRatio?: number;
		sessionId?: string;
		autoRunDoc?: string;
		numTasks?: number;
		numFilesTouched?: number;
		numLinesInserted?: number;
		wasLimitHit?: boolean;
		userOverrodeWarning?: boolean;
	}): void {
		const db = this.getDB();
		db.prepare(
			`
			INSERT INTO task_complexity_log (
				timestamp, task_type, complexity_score, complexity_bucket,
				estimated_pct, actual_billable_tokens, actual_pct, accuracy_ratio,
				session_id, auto_run_doc, num_tasks, num_files_touched,
				num_lines_inserted, was_limit_hit, user_overrode_warning
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`
		).run(
			entry.timestamp,
			entry.taskType,
			entry.complexityScore,
			entry.complexityBucket,
			entry.estimatedPct,
			entry.actualBillableTokens ?? null,
			entry.actualPct ?? null,
			entry.accuracyRatio ?? null,
			entry.sessionId ?? null,
			entry.autoRunDoc ?? null,
			entry.numTasks ?? null,
			entry.numFilesTouched ?? null,
			entry.numLinesInserted ?? null,
			entry.wasLimitHit ? 1 : 0,
			entry.userOverrodeWarning ? 1 : 0
		);
	}

	/**
	 * Get database file size in bytes.
	 */
	getFileSize(): number {
		try {
			const stat = fs.statSync(this.dbPath);
			return stat.size;
		} catch {
			return 0;
		}
	}

	/**
	 * Close the database connection.
	 */
	close(): void {
		if (this.db) {
			this.db.close();
			this.db = null;
			logger.info('Archive database closed', LOG_CONTEXT);
		}
	}
}
