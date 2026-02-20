/**
 * HoneycombUsageService
 *
 * Background polling service that queries Honeycomb REST API for current usage
 * metrics and broadcasts results to renderer via IPC.
 *
 * Polls on configurable interval (default: 5 min) using HoneycombQueryClient.
 * Pauses when app is minimized/unfocused, resumes on focus.
 *
 * @see Investigation plan Sections 18.1–18.7
 */

import { BrowserWindow } from 'electron';
import { getHoneycombQueryClient, DEFAULT_TTL } from './honeycomb-query-client';
import type { HoneycombQuerySpec } from './honeycomb-query-client';
import { getSettingsStore } from '../stores';
import { logger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface UsageData {
	fiveHourSpendUsd: number;
	fiveHourBillableTokens: number;
	weeklySpendUsd: number;
	weeklyBillableTokens: number;
	monthlySessions: number;
	lastUpdatedAt: number;
	stale: boolean;
	error?: string;
}

export interface UsageEstimate {
	billableTokens: number;
	spendUsd: number;
	asPercentOfBudget: number | null;
	stale: boolean;
}

const LOG_CONTEXT = 'HoneycombUsageService';

// ============================================================================
// Query Specs
// ============================================================================

/** 5-hour window: SUM(cost_usd) + billable token totals */
const FIVE_HOUR_QUERY: HoneycombQuerySpec = {
	calculations: [
		{ op: 'SUM', column: 'cost_usd', name: 'total_cost' },
		{ op: 'SUM', column: 'input_tokens', name: 'input' },
		{ op: 'SUM', column: 'output_tokens', name: 'output' },
		{ op: 'SUM', column: 'cache_creation_tokens', name: 'cache_create' },
	],
	time_range: 18000, // 5 hours in seconds
};

/** Weekly: SUM(cost_usd) + billable token totals */
const WEEKLY_QUERY: HoneycombQuerySpec = {
	calculations: [
		{ op: 'SUM', column: 'cost_usd', name: 'total_cost' },
		{ op: 'SUM', column: 'input_tokens', name: 'input' },
		{ op: 'SUM', column: 'output_tokens', name: 'output' },
		{ op: 'SUM', column: 'cache_creation_tokens', name: 'cache_create' },
	],
	time_range: 604800, // 7 days in seconds
};

/** Monthly sessions: COUNT_DISTINCT(session.id) */
const MONTHLY_SESSIONS_QUERY: HoneycombQuerySpec = {
	calculations: [{ op: 'COUNT_DISTINCT', column: 'session.id' }],
	time_range: 2419200, // 28 days in seconds
};

// ============================================================================
// Singleton
// ============================================================================

let _instance: HoneycombUsageService | null = null;

export function getHoneycombUsageService(): HoneycombUsageService {
	if (!_instance) {
		_instance = new HoneycombUsageService();
	}
	return _instance;
}

export function closeHoneycombUsageService(): void {
	if (_instance) {
		_instance.stop();
		_instance = null;
	}
}

// ============================================================================
// Implementation
// ============================================================================

export class HoneycombUsageService {
	private pollTimer: ReturnType<typeof setInterval> | null = null;
	private latestData: UsageData | null = null;
	private running = false;

	/**
	 * Start the polling service.
	 * Performs an immediate poll, then sets up the interval.
	 */
	start(): void {
		const client = getHoneycombQueryClient();
		if (!client.isConfigured()) {
			logger.info('Honeycomb not configured — usage service not started', LOG_CONTEXT);
			return;
		}

		if (this.running) {
			logger.debug('Usage service already running', LOG_CONTEXT);
			return;
		}

		this.running = true;
		logger.info('Usage service started', LOG_CONTEXT);

		// Immediate first poll
		this.poll().catch((err) => logger.error(`Initial poll failed: ${err.message}`, LOG_CONTEXT));

		// Set up interval
		const store = getSettingsStore();
		const intervalMs = store.get('honeycombPollIntervalMs', 300000);
		this.pollTimer = setInterval(() => {
			this.poll().catch((err) => logger.error(`Poll failed: ${err.message}`, LOG_CONTEXT));
		}, intervalMs);
	}

	/**
	 * Stop the polling service.
	 */
	stop(): void {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
		this.running = false;
		logger.info('Usage service stopped', LOG_CONTEXT);
	}

	/**
	 * Pause polling (e.g., when app is minimized).
	 */
	pause(): void {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
			logger.debug('Usage service paused', LOG_CONTEXT);
		}
	}

	/**
	 * Resume polling (e.g., when app is focused).
	 */
	resume(): void {
		if (!this.running) return;
		if (this.pollTimer) return; // Already running

		// Immediate poll on resume
		this.poll().catch((err) => logger.error(`Resume poll failed: ${err.message}`, LOG_CONTEXT));

		const store = getSettingsStore();
		const intervalMs = store.get('honeycombPollIntervalMs', 300000);
		this.pollTimer = setInterval(() => {
			this.poll().catch((err) => logger.error(`Poll failed: ${err.message}`, LOG_CONTEXT));
		}, intervalMs);
		logger.debug('Usage service resumed', LOG_CONTEXT);
	}

	/**
	 * Force an immediate poll (e.g., triggered by user or pre-task check).
	 * Bypasses cache TTL.
	 */
	async forceRefresh(): Promise<UsageData> {
		return this.poll(true);
	}

	/**
	 * Get the latest cached usage data (no API call).
	 */
	getLatest(): UsageData | null {
		return this.latestData;
	}

	/**
	 * Get a usage estimate for a specific window.
	 */
	getWindowEstimate(window: '5hr' | 'weekly'): UsageEstimate | null {
		if (!this.latestData) return null;

		if (window === '5hr') {
			return {
				billableTokens: this.latestData.fiveHourBillableTokens,
				spendUsd: this.latestData.fiveHourSpendUsd,
				asPercentOfBudget: null, // Computed by capacity checker using calibration data
				stale: this.latestData.stale,
			};
		}

		return {
			billableTokens: this.latestData.weeklyBillableTokens,
			spendUsd: this.latestData.weeklySpendUsd,
			asPercentOfBudget: null,
			stale: this.latestData.stale,
		};
	}

	/**
	 * Check if the service is currently running.
	 */
	isRunning(): boolean {
		return this.running;
	}

	// ============================================================================
	// Private Methods
	// ============================================================================

	/**
	 * Execute a poll cycle: run all usage queries and broadcast results.
	 */
	private async poll(bypassCache = false): Promise<UsageData> {
		const client = getHoneycombQueryClient();

		try {
			// Run queries (differentiated TTLs, sequential with short delays)
			const [fiveHourResult, weeklyResult, sessionsResult] = await Promise.all([
				client.query(FIVE_HOUR_QUERY, {
					ttlMs: DEFAULT_TTL.FIVE_HOUR,
					bypassCache,
					label: '5hr-usage',
				}),
				client.query(WEEKLY_QUERY, {
					ttlMs: DEFAULT_TTL.WEEKLY,
					bypassCache,
					label: 'weekly-usage',
				}),
				client.query(MONTHLY_SESSIONS_QUERY, {
					ttlMs: DEFAULT_TTL.MONTHLY_SESSIONS,
					bypassCache,
					label: 'monthly-sessions',
				}),
			]);

			// Extract values from results
			const fiveHourRow = fiveHourResult.data?.results?.[0] || {};
			const weeklyRow = weeklyResult.data?.results?.[0] || {};
			const sessionsRow = sessionsResult.data?.results?.[0] || {};

			const data: UsageData = {
				fiveHourSpendUsd: this.extractNumber(fiveHourRow, 'total_cost'),
				fiveHourBillableTokens:
					this.extractNumber(fiveHourRow, 'input') +
					this.extractNumber(fiveHourRow, 'output') +
					this.extractNumber(fiveHourRow, 'cache_create'),
				weeklySpendUsd: this.extractNumber(weeklyRow, 'total_cost'),
				weeklyBillableTokens:
					this.extractNumber(weeklyRow, 'input') +
					this.extractNumber(weeklyRow, 'output') +
					this.extractNumber(weeklyRow, 'cache_create'),
				monthlySessions: this.extractNumber(sessionsRow, 'COUNT_DISTINCT(session.id)'),
				lastUpdatedAt: Date.now(),
				stale: false,
			};

			this.latestData = data;
			this.broadcastUpdate(data);

			logger.debug(
				`Poll complete: 5hr=$${data.fiveHourSpendUsd.toFixed(2)} (${(data.fiveHourBillableTokens / 1000).toFixed(0)}K tokens), ` +
					`weekly=$${data.weeklySpendUsd.toFixed(2)} (${(data.weeklyBillableTokens / 1000).toFixed(0)}K tokens), ` +
					`sessions=${data.monthlySessions}`,
				LOG_CONTEXT
			);

			return data;
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error(`Poll failed: ${errorMsg}`, LOG_CONTEXT);

			// Mark existing data as stale
			if (this.latestData) {
				this.latestData.stale = true;
				this.latestData.error = errorMsg;
				this.broadcastUpdate(this.latestData);
			}

			throw error;
		}
	}

	/**
	 * Extract a numeric value from a query result row.
	 * Honeycomb may return values as strings, numbers, or missing.
	 */
	private extractNumber(row: Record<string, unknown>, key: string): number {
		// Try the key directly
		let val = row[key];

		// Also try common result key formats
		if (val === undefined || val === null) {
			// Honeycomb returns results with keys like "SUM(cost_usd)" when no name is given
			for (const [k, v] of Object.entries(row)) {
				if (k.includes(key) || k === key) {
					val = v;
					break;
				}
			}
		}

		if (val === undefined || val === null) return 0;
		const num = typeof val === 'string' ? parseFloat(val) : Number(val);
		return isNaN(num) ? 0 : num;
	}

	/**
	 * Broadcast usage data to all renderer windows via IPC.
	 */
	private broadcastUpdate(data: UsageData): void {
		const windows = BrowserWindow.getAllWindows();
		for (const win of windows) {
			if (!win.isDestroyed()) {
				win.webContents.send('honeycomb:usage-update', data);
			}
		}
	}
}
