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
import { isCloudProviderModel } from '../utils/claude-pricing';
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
				breakdowns: ['model'],
			},
			hasBreakdowns: true,
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

	/**
	 * One-time backfill: Re-query Honeycomb for historical per-model breakdown data
	 * and update honeycomb_daily rows with properly classified billable/free splits.
	 *
	 * This fixes "All Time" views that were polluted with free model tokens.
	 */
	async runBackfill(): Promise<{ updatedDates: string[]; errors: string[] }> {
		const db = getHoneycombArchiveDB();
		const client = getHoneycombQueryClient();
		const updatedDates: string[] = [];
		const errors: string[] = [];

		logger.info('Starting historical model breakdown backfill...', LOG_CONTEXT);

		try {
			// Determine the date range to backfill
			const unbackfilledDates = db.getUnbackfilledDates('daily_token_volumes');
			if (unbackfilledDates.length === 0) {
				logger.info(
					'No dates need backfilling — all rows already have model breakdowns',
					LOG_CONTEXT
				);
				return { updatedDates, errors };
			}

			const startDate = unbackfilledDates[0];
			const endDate = unbackfilledDates[unbackfilledDates.length - 1];

			logger.info(
				`Backfilling ${unbackfilledDates.length} dates: ${startDate} to ${endDate}`,
				LOG_CONTEXT
			);

			// Query Honeycomb for per-model token breakdown across the full date range
			const startEpoch = Math.floor(new Date(startDate + 'T00:00:00Z').getTime() / 1000);
			const endEpoch = Math.floor(new Date(endDate + 'T23:59:59Z').getTime() / 1000);

			const tokenResult = await client.query(
				{
					calculations: [
						{ op: 'SUM', column: 'input_tokens', name: 'input' },
						{ op: 'SUM', column: 'output_tokens', name: 'output' },
						{ op: 'SUM', column: 'cache_read_tokens', name: 'cache_read' },
						{ op: 'SUM', column: 'cache_creation_tokens', name: 'cache_create' },
						{ op: 'SUM', column: 'cost_usd', name: 'cost' },
					],
					breakdowns: ['model'],
					start_time: startEpoch,
					end_time: endEpoch,
					granularity: 86400, // 1 day
				},
				{ ttlMs: 0, label: 'backfill-model-breakdown' }
			);

			// Process results — series format gives per-day, per-model data
			const resultRows = tokenResult.data?.results || [];
			const series = tokenResult.data?.series || [];

			// Build per-date, per-model classification
			type DateModelData = Record<
				string,
				{
					billable: {
						input: number;
						output: number;
						cacheRead: number;
						cacheCreate: number;
						cost: number;
					};
					free: {
						input: number;
						output: number;
						cacheRead: number;
						cacheCreate: number;
						cost: number;
					};
					models: { billable: string[]; free: string[] };
				}
			>;

			const dateData: DateModelData = {};

			// Helper to extract number
			const extractNum = (obj: Record<string, unknown>, key: string): number => {
				const v = obj[key];
				return typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) || 0 : 0;
			};

			// Process series format (time-bucketed)
			for (const point of series) {
				if (!point.time) continue;
				const dateStr = String(point.time).split('T')[0];
				const modelId = String((point as any).model || point.data?.model || '');

				if (!dateData[dateStr]) {
					dateData[dateStr] = {
						billable: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, cost: 0 },
						free: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, cost: 0 },
						models: { billable: [], free: [] },
					};
				}

				const input = extractNum(point.data || {}, 'input');
				const output = extractNum(point.data || {}, 'output');
				const cacheRead = extractNum(point.data || {}, 'cache_read');
				const cacheCreate = extractNum(point.data || {}, 'cache_create');
				const cost = extractNum(point.data || {}, 'cost');

				if (isCloudProviderModel(modelId)) {
					dateData[dateStr].billable.input += input;
					dateData[dateStr].billable.output += output;
					dateData[dateStr].billable.cacheRead += cacheRead;
					dateData[dateStr].billable.cacheCreate += cacheCreate;
					dateData[dateStr].billable.cost += cost;
					if (modelId && !dateData[dateStr].models.billable.includes(modelId)) {
						dateData[dateStr].models.billable.push(modelId);
					}
				} else {
					dateData[dateStr].free.input += input;
					dateData[dateStr].free.output += output;
					dateData[dateStr].free.cacheRead += cacheRead;
					dateData[dateStr].free.cacheCreate += cacheCreate;
					dateData[dateStr].free.cost += cost;
					if (modelId && !dateData[dateStr].models.free.includes(modelId)) {
						dateData[dateStr].models.free.push(modelId);
					}
				}
			}

			// Also process flat results (if series is empty)
			if (series.length === 0 && resultRows.length > 0) {
				// Flat results from MCP — each row has a model field
				// Without granularity-based time buckets, treat as aggregate for the full range
				for (const row of resultRows) {
					const modelId = String(row['model'] || '');
					const input = extractNum(row, 'input');
					const output = extractNum(row, 'output');
					const cacheRead = extractNum(row, 'cache_read');
					const cacheCreate = extractNum(row, 'cache_create');
					const cost = extractNum(row, 'cost');

					// Distribute aggregate totals evenly across all unbackfilled dates
					const dateCount = unbackfilledDates.length;
					const perDateInput = input / dateCount;
					const perDateOutput = output / dateCount;
					const perDateCacheRead = cacheRead / dateCount;
					const perDateCacheCreate = cacheCreate / dateCount;
					const perDateCost = cost / dateCount;

					for (const date of unbackfilledDates) {
						if (!dateData[date]) {
							dateData[date] = {
								billable: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, cost: 0 },
								free: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, cost: 0 },
								models: { billable: [], free: [] },
							};
						}

						if (isCloudProviderModel(modelId)) {
							dateData[date].billable.input += perDateInput;
							dateData[date].billable.output += perDateOutput;
							dateData[date].billable.cacheRead += perDateCacheRead;
							dateData[date].billable.cacheCreate += perDateCacheCreate;
							dateData[date].billable.cost += perDateCost;
							if (modelId && !dateData[date].models.billable.includes(modelId)) {
								dateData[date].models.billable.push(modelId);
							}
						} else {
							dateData[date].free.input += perDateInput;
							dateData[date].free.output += perDateOutput;
							dateData[date].free.cacheRead += perDateCacheRead;
							dateData[date].free.cacheCreate += perDateCacheCreate;
							dateData[date].free.cost += perDateCost;
							if (modelId && !dateData[date].models.free.includes(modelId)) {
								dateData[date].models.free.push(modelId);
							}
						}
					}

					logger.warn(
						`Backfill: MCP returned flat results without time buckets for model '${modelId}'. Per-date breakdown is approximate (evenly distributed).`,
						LOG_CONTEXT
					);
				}
			}

			// Update archive rows
			for (const [date, data] of Object.entries(dateData)) {
				try {
					db.backfillDailyRow(date, 'daily_token_volumes', null, {
						billable: data.billable,
						free: data.free,
						models: data.models,
						backfilled_at: new Date().toISOString(),
					});
					updatedDates.push(date);
				} catch (err) {
					const errMsg = err instanceof Error ? err.message : String(err);
					errors.push(`Failed to update ${date}: ${errMsg}`);
					logger.error(`Backfill error for ${date}: ${errMsg}`, LOG_CONTEXT);
				}
			}

			// Mark unbackfilled dates that had no Honeycomb data (outside retention or no activity)
			for (const date of unbackfilledDates) {
				if (!dateData[date]) {
					logger.warn(
						`Backfill: No Honeycomb data for ${date} — may be outside retention`,
						LOG_CONTEXT
					);
				}
			}

			logger.info(
				`Backfill complete: ${updatedDates.length} dates updated, ${errors.length} errors`,
				LOG_CONTEXT
			);

			// Store backfill metadata
			db.setMeta('last_backfill_date', new Date().toISOString());
			db.setMeta('backfill_dates_updated', String(updatedDates.length));
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			logger.error(`Backfill failed: ${errMsg}`, LOG_CONTEXT);
			errors.push(`Backfill failed: ${errMsg}`);
		}

		return { updatedDates, errors };
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
