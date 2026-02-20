/**
 * HoneycombArchiveService
 *
 * Incrementally archives Honeycomb data to local SQLite database
 * on app open. Runs 8 aggregate queries per pull cycle to capture
 * daily rollups before the 60-day retention window expires.
 *
 * Phase 1: Tier 1 aggregated rollups only.
 *
 * @see Investigation plan Sections 19.3–19.8
 */

import { getHoneycombQueryClient, DEFAULT_TTL } from './honeycomb-query-client';
import type { HoneycombQuerySpec, HoneycombQueryResult } from './honeycomb-query-client';
import { getHoneycombArchiveDB } from './honeycomb-archive-db';
import { logger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface ArchiveConfig {
	enabled: boolean;
	maxPullDays: number;
	initialBackfillDays: number;
	minPullIntervalHours: number;
	queryDelayMs: number;
}

export interface ArchiveState {
	lastArchiveDate: string | null;
	firstDataDate: string | null;
	needsCatchUp: boolean;
	totalArchivedDays: number;
}

interface ArchiveQuery {
	name: string;
	spec: HoneycombQuerySpec;
	hasBreakdowns: boolean;
}

const LOG_CONTEXT = 'HoneycombArchiveService';

const DEFAULT_CONFIG: ArchiveConfig = {
	enabled: true,
	maxPullDays: 14,
	initialBackfillDays: 7,
	minPullIntervalHours: 24,
	queryDelayMs: 2000,
};

// ============================================================================
// Archive Query Definitions
// ============================================================================

function buildArchiveQueries(startTime: number, endTime: number): ArchiveQuery[] {
	const base = { start_time: startTime, end_time: endTime, granularity: 86400 };

	return [
		{
			name: 'daily_cost_by_model',
			spec: {
				...base,
				calculations: [{ op: 'SUM', column: 'cost_usd' }],
				breakdowns: ['model'],
			},
			hasBreakdowns: true,
		},
		{
			name: 'daily_token_volumes',
			spec: {
				...base,
				calculations: [
					{ op: 'SUM', column: 'input_tokens' },
					{ op: 'SUM', column: 'output_tokens' },
					{ op: 'SUM', column: 'cache_read_tokens' },
					{ op: 'SUM', column: 'cache_creation_tokens' },
				],
			},
			hasBreakdowns: false,
		},
		{
			name: 'daily_session_count',
			spec: {
				...base,
				calculations: [{ op: 'COUNT_DISTINCT', column: 'session.id' }],
			},
			hasBreakdowns: false,
		},
		{
			name: 'session_cost',
			spec: {
				start_time: startTime,
				end_time: endTime,
				calculations: [{ op: 'SUM', column: 'cost_usd' }, { op: 'COUNT' }],
				breakdowns: ['session.id'],
				limit: 100,
			},
			hasBreakdowns: true,
		},
		{
			name: 'daily_cache_efficiency',
			spec: {
				...base,
				calculations: [{ op: 'AVG', column: 'cache_hit_ratio_event' }],
			},
			hasBreakdowns: false,
		},
		{
			name: 'cost_by_user',
			spec: {
				start_time: startTime,
				end_time: endTime,
				calculations: [{ op: 'SUM', column: 'cost_usd' }],
				breakdowns: ['user.email'],
			},
			hasBreakdowns: true,
		},
		{
			name: 'daily_event_types',
			spec: {
				...base,
				calculations: [{ op: 'COUNT' }],
				breakdowns: ['event.name'],
			},
			hasBreakdowns: true,
		},
		{
			name: 'daily_cost_by_host',
			spec: {
				...base,
				calculations: [{ op: 'SUM', column: 'cost_usd' }],
				breakdowns: ['host.name'],
			},
			hasBreakdowns: true,
		},
	];
}

// ============================================================================
// Singleton
// ============================================================================

let _instance: HoneycombArchiveService | null = null;

export function getHoneycombArchiveService(): HoneycombArchiveService {
	if (!_instance) {
		_instance = new HoneycombArchiveService();
	}
	return _instance;
}

export function closeHoneycombArchiveService(): void {
	_instance = null;
}

// ============================================================================
// Implementation
// ============================================================================

export class HoneycombArchiveService {
	private config: ArchiveConfig = DEFAULT_CONFIG;
	private archiving = false;

	/**
	 * Run the archival process. Called on app open.
	 * Determines the gap since last archive and pulls only missing days.
	 */
	async runArchival(): Promise<void> {
		const client = getHoneycombQueryClient();
		if (!client.isConfigured()) {
			logger.debug('Honeycomb not configured — skipping archival', LOG_CONTEXT);
			return;
		}

		if (!this.config.enabled) {
			logger.debug('Archival disabled — skipping', LOG_CONTEXT);
			return;
		}

		if (this.archiving) {
			logger.debug('Archival already in progress — skipping', LOG_CONTEXT);
			return;
		}

		this.archiving = true;

		try {
			const db = getHoneycombArchiveDB();
			db.initialize();

			const state = this.loadState();
			const today = this.todayISO();
			const { startDate, endDate, pullDays, needsCatchUp } = this.calculatePullRange(state, today);

			if (pullDays === 0) {
				logger.debug('Archive is current — no pull needed', LOG_CONTEXT);
				return;
			}

			logger.info(`Archiving ${pullDays} days (${startDate} → ${endDate})`, LOG_CONTEXT);

			const startTime = this.isoToEpoch(startDate);
			const endTime = this.isoToEpoch(endDate) + 86400; // End of endDate
			const queries = buildArchiveQueries(startTime, endTime);
			let totalRows = 0;

			for (const query of queries) {
				try {
					const result = await client.query(query.spec, {
						ttlMs: DEFAULT_TTL.ARCHIVE,
						label: `archive-${query.name}`,
					});

					const rows = this.storeQueryResult(query, result, startDate, endDate);
					totalRows += rows;

					// Delay between queries to be API-friendly
					await this.delay(this.config.queryDelayMs);
				} catch (error) {
					logger.warn(
						`Archive query ${query.name} failed: ${error}. Continuing with remaining queries.`,
						LOG_CONTEXT
					);
					// Don't advance lastArchiveDate past failed queries
				}
			}

			// Update state
			db.setMeta('last_aggregate_date', endDate);
			if (needsCatchUp) {
				db.setMeta('needs_catch_up', 'true');
			} else {
				db.setMeta('needs_catch_up', 'false');
			}

			if (!state.firstDataDate) {
				db.setMeta('first_data_date', startDate);
			}

			const newTotal = (state.totalArchivedDays || 0) + pullDays;
			db.setMeta('total_archived_days', String(newTotal));

			logger.info(
				`Archived ${pullDays} days (${startDate} → ${endDate}), ${totalRows} rows inserted. Total archived: ${newTotal} days.`,
				LOG_CONTEXT
			);
		} catch (error) {
			logger.error(`Archival failed: ${error}`, LOG_CONTEXT);
		} finally {
			this.archiving = false;
		}
	}

	/**
	 * Get current archive state.
	 */
	getState(): ArchiveState {
		return this.loadState();
	}

	/**
	 * Check if archival is in progress.
	 */
	isArchiving(): boolean {
		return this.archiving;
	}

	// ============================================================================
	// Private Methods
	// ============================================================================

	private loadState(): ArchiveState {
		const db = getHoneycombArchiveDB();
		return {
			lastArchiveDate: db.getMeta('last_aggregate_date'),
			firstDataDate: db.getMeta('first_data_date'),
			needsCatchUp: db.getMeta('needs_catch_up') === 'true',
			totalArchivedDays: parseInt(db.getMeta('total_archived_days') || '0', 10),
		};
	}

	private calculatePullRange(
		state: ArchiveState,
		today: string
	): { startDate: string; endDate: string; pullDays: number; needsCatchUp: boolean } {
		if (!state.lastArchiveDate) {
			// First run: backfill
			const startDate = this.daysAgo(this.config.initialBackfillDays);
			const yesterday = this.daysAgo(1);
			return {
				startDate,
				endDate: yesterday,
				pullDays: this.config.initialBackfillDays,
				needsCatchUp: false,
			};
		}

		// Calculate gap
		const lastDate = new Date(state.lastArchiveDate);
		const todayDate = new Date(today);
		const gapDays = Math.floor((todayDate.getTime() - lastDate.getTime()) / 86_400_000);

		if (gapDays < 1) {
			return { startDate: today, endDate: today, pullDays: 0, needsCatchUp: false };
		}

		// Check minimum interval
		const hoursSinceLastArchive = gapDays * 24;
		if (hoursSinceLastArchive < this.config.minPullIntervalHours) {
			return { startDate: today, endDate: today, pullDays: 0, needsCatchUp: false };
		}

		// Cap at maxPullDays
		const pullDays = Math.min(gapDays, this.config.maxPullDays);
		const needsCatchUp = gapDays > this.config.maxPullDays;

		// Start from day after last archive
		const startDate = this.addDays(state.lastArchiveDate, 1);
		const endDate = this.addDays(state.lastArchiveDate, pullDays);

		return { startDate, endDate, pullDays, needsCatchUp };
	}

	private storeQueryResult(
		query: ArchiveQuery,
		result: HoneycombQueryResult,
		startDate: string,
		_endDate: string
	): number {
		const db = getHoneycombArchiveDB();
		let rowCount = 0;

		const results = result.data?.results || [];
		const series = result.data?.series || [];

		// Handle time-series data (granularity-based queries)
		if (series.length > 0) {
			for (const point of series) {
				const date = point.time ? point.time.split('T')[0] : startDate;

				if (query.hasBreakdowns) {
					// Each series point may have breakdown data in point.data
					for (const [key, value] of Object.entries(point.data || {})) {
						db.upsertDaily(date, query.name, key, { value, time: point.time });
						rowCount++;
					}
				} else {
					db.upsertDaily(date, query.name, null, point.data || {});
					rowCount++;
				}
			}
		}

		// Handle aggregate results (non-time-series queries)
		if (results.length > 0 && series.length === 0) {
			for (const row of results) {
				if (query.hasBreakdowns) {
					// Use the breakdown column value as the key
					const breakdownCols = query.spec.breakdowns || [];
					const breakdownKey = breakdownCols.map((col) => String(row[col] || 'unknown')).join('|');
					db.upsertDaily(startDate, query.name, breakdownKey, row);
					rowCount++;
				} else {
					db.upsertDaily(startDate, query.name, null, row);
					rowCount++;
				}
			}
		}

		return rowCount;
	}

	// Date helpers
	private todayISO(): string {
		return new Date().toISOString().split('T')[0];
	}

	private daysAgo(n: number): string {
		const d = new Date();
		d.setDate(d.getDate() - n);
		return d.toISOString().split('T')[0];
	}

	private addDays(dateStr: string, n: number): string {
		const d = new Date(dateStr);
		d.setDate(d.getDate() + n);
		return d.toISOString().split('T')[0];
	}

	private isoToEpoch(dateStr: string): number {
		return Math.floor(new Date(dateStr).getTime() / 1000);
	}

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
