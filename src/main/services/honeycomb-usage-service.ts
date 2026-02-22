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
	// Per-type token breakdown for weekly window (used by Summary Cards and tooltips)
	weeklyInputTokens: number;
	weeklyOutputTokens: number;
	weeklyCacheCreationTokens: number;
	sonnetWeeklySpendUsd: number;
	sonnetWeeklyBillableTokens: number;
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

/** Weekly: SUM(cost_usd) + billable token totals — base template, aligned at poll time */
const WEEKLY_QUERY_BASE: HoneycombQuerySpec = {
	calculations: [
		{ op: 'SUM', column: 'cost_usd', name: 'total_cost' },
		{ op: 'SUM', column: 'input_tokens', name: 'input' },
		{ op: 'SUM', column: 'output_tokens', name: 'output' },
		{ op: 'SUM', column: 'cache_creation_tokens', name: 'cache_create' },
	],
};

/** Sonnet-only weekly: same columns but filtered to Sonnet models — base template */
const SONNET_WEEKLY_QUERY_BASE: HoneycombQuerySpec = {
	calculations: [
		{ op: 'SUM', column: 'cost_usd', name: 'total_cost' },
		{ op: 'SUM', column: 'input_tokens', name: 'input' },
		{ op: 'SUM', column: 'output_tokens', name: 'output' },
		{ op: 'SUM', column: 'cache_creation_tokens', name: 'cache_create' },
	],
	filters: [{ column: 'model', op: 'contains', value: 'sonnet' }],
};

/** Monthly sessions: COUNT_DISTINCT(session.id) */
const MONTHLY_SESSIONS_QUERY: HoneycombQuerySpec = {
	calculations: [{ op: 'COUNT_DISTINCT', column: 'session.id' }],
	time_range: 2419200, // 28 days in seconds
};

// ============================================================================
// Weekly Window Alignment Helper
// ============================================================================

/**
 * Compute the start of the current weekly window from a reset schedule.
 * Returns epoch seconds for the most recent reset boundary.
 *
 * @param resetDay - Day of week: 'Sunday', 'Monday', etc.
 * @param resetTime - Time in HH:MM format (e.g., '10:00')
 * @param resetTimezone - IANA timezone (e.g., 'America/Los_Angeles')
 * @returns epoch seconds of the current window start, or null if inputs invalid
 */
function computeWeeklyWindowStart(
	resetDay: string,
	resetTime: string,
	resetTimezone: string
): number | null {
	const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
	const targetDayIndex = dayNames.indexOf(resetDay);
	if (targetDayIndex === -1) return null;

	const [hours, minutes] = (resetTime || '10:00').split(':').map(Number);
	if (isNaN(hours) || isNaN(minutes)) return null;

	// Build a date string for "today at reset time in the given timezone"
	// Then walk backwards to find the most recent occurrence of resetDay at resetTime
	const now = new Date();

	// Create a formatter to get current day-of-week in the target timezone
	const dayFormatter = new Intl.DateTimeFormat('en-US', {
		weekday: 'long',
		timeZone: resetTimezone,
	});
	const timeFormatter = new Intl.DateTimeFormat('en-US', {
		hour: 'numeric',
		minute: 'numeric',
		hour12: false,
		timeZone: resetTimezone,
	});

	const currentDayName = dayFormatter.format(now);
	const currentDayIndex = dayNames.indexOf(currentDayName);
	if (currentDayIndex === -1) return null;

	// How many days ago was the target reset day?
	let daysBack = (currentDayIndex - targetDayIndex + 7) % 7;

	// If it's the reset day, check if we've passed the reset time yet
	if (daysBack === 0) {
		const currentTimeParts = timeFormatter.format(now).split(':').map(Number);
		const currentMinutesSinceMidnight = currentTimeParts[0] * 60 + currentTimeParts[1];
		const resetMinutesSinceMidnight = hours * 60 + minutes;
		if (currentMinutesSinceMidnight < resetMinutesSinceMidnight) {
			// Haven't reached reset time yet, go back a full week
			daysBack = 7;
		}
	}

	// Construct the reset datetime. We need to work in the target timezone.
	// Use a known UTC offset approach for the target timezone.
	const resetDate = new Date(now);
	resetDate.setDate(resetDate.getDate() - daysBack);

	// Format resetDate in target timezone to get the date parts
	const dateFormatter = new Intl.DateTimeFormat('en-US', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		timeZone: resetTimezone,
	});
	const dateParts = dateFormatter.formatToParts(resetDate);
	const year = dateParts.find((p) => p.type === 'year')?.value;
	const month = dateParts.find((p) => p.type === 'month')?.value;
	const day = dateParts.find((p) => p.type === 'day')?.value;

	// Build an ISO-like string in the target timezone and parse it
	const isoString = `${year}-${month}-${day}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;

	// Parse in the target timezone by creating dates and comparing
	const tempDate = new Date(isoString + 'Z'); // treat as UTC first

	// Find offset by formatting a known epoch time using toLocaleString round-trip
	const probe = new Date();
	const utcString = probe.toLocaleString('en-US', { timeZone: 'UTC' });
	const tzString = probe.toLocaleString('en-US', { timeZone: resetTimezone });
	const utcProbe = new Date(utcString);
	const tzProbe = new Date(tzString);
	const offsetMs = utcProbe.getTime() - tzProbe.getTime();

	// The reset time in UTC = local reset time + offset
	const resetUtcMs = tempDate.getTime() + offsetMs;

	// Safety: if this is in the future, go back a week
	const finalMs = resetUtcMs > now.getTime() ? resetUtcMs - 7 * 24 * 60 * 60 * 1000 : resetUtcMs;

	return Math.floor(finalMs / 1000);
}

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

		// Compute 5-hour window anchor from calibration points on every startup
		const store = getSettingsStore();
		const planCal = store.get('planCalibration', null) as any;
		if (planCal && planCal.calibrationPoints?.length > 0) {
			const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
			const fiveHrPoints = planCal.calibrationPoints.filter(
				(p: any) => p.window === '5hr' && (p.timeRemainingInWindow || p.timeIntoWindow)
			);
			if (fiveHrPoints.length > 0) {
				let bestPoint = fiveHrPoints[0];
				let bestRemainingMs = Infinity;
				for (const p of fiveHrPoints) {
					let remainingMs: number;
					const remainingField = p.timeRemainingInWindow;
					const intoField = p.timeIntoWindow;

					if (remainingField) {
						const match = remainingField.match(/(\d+)h\s*(\d+)m/);
						if (!match) continue;
						remainingMs = (parseInt(match[1]) * 60 + parseInt(match[2])) * 60 * 1000;
					} else if (intoField) {
						const match = intoField.match(/(\d+)h\s*(\d+)m/);
						if (!match) continue;
						const intoMs = (parseInt(match[1]) * 60 + parseInt(match[2])) * 60 * 1000;
						remainingMs = FIVE_HOURS_MS - intoMs;
						if (remainingMs <= 0) continue; // Invalid — skip
					} else {
						continue;
					}

					if (remainingMs < bestRemainingMs) {
						bestRemainingMs = remainingMs;
						bestPoint = p;
					}
				}
				// Use the bestRemainingMs we already computed
				if (bestRemainingMs < Infinity) {
					const windowEndMs = new Date(bestPoint.timestamp).getTime() + bestRemainingMs;
					const anchorDate = new Date(windowEndMs);
					store.set('planCalibration', {
						...planCal,
						fiveHourWindowResetAnchorUtc: anchorDate.toISOString(),
					});
					logger.info(
						`Seeded 5hr window anchor from calibration data: ${anchorDate.toISOString()}`,
						LOG_CONTEXT
					);
				}
			}
		}

		this.running = true;
		logger.info('Usage service started', LOG_CONTEXT);

		// Immediate first poll
		this.poll().catch((err) => logger.error(`Initial poll failed: ${err.message}`, LOG_CONTEXT));

		// Set up interval
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
	getWindowEstimate(window: '5hr' | 'weekly' | 'sonnet-weekly'): UsageEstimate | null {
		if (!this.latestData) return null;

		if (window === '5hr') {
			return {
				billableTokens: this.latestData.fiveHourBillableTokens,
				spendUsd: this.latestData.fiveHourSpendUsd,
				asPercentOfBudget: null,
				stale: this.latestData.stale,
			};
		}

		if (window === 'sonnet-weekly') {
			return {
				billableTokens: this.latestData.sonnetWeeklyBillableTokens,
				spendUsd: this.latestData.sonnetWeeklySpendUsd,
				asPercentOfBudget: null,
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
			// Build 5-hour query — use aligned window if anchor available, else rolling
			const store = getSettingsStore();
			const planCalibration = store.get('planCalibration', null) as any;

			let fiveHourQuery: HoneycombQuerySpec;
			const anchorUtc = planCalibration?.fiveHourWindowResetAnchorUtc;
			if (anchorUtc) {
				const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
				const anchorMs = new Date(anchorUtc).getTime();
				const now = Date.now();
				// Find how many complete 5-hour windows have passed since anchor
				const windowsSinceAnchor = Math.floor((now - anchorMs) / FIVE_HOURS_MS);
				const currentWindowStart = anchorMs + windowsSinceAnchor * FIVE_HOURS_MS;
				// If anchor is in the future (shouldn't happen but safety), fall back to rolling
				if (currentWindowStart > now) {
					fiveHourQuery = FIVE_HOUR_QUERY; // rolling fallback
				} else {
					const { time_range: _, ...baseQuery } = FIVE_HOUR_QUERY;
					fiveHourQuery = {
						...baseQuery,
						start_time: Math.floor(currentWindowStart / 1000),
						end_time: Math.floor(now / 1000),
					};
				}
				logger.debug(
					`5hr window aligned: start=${new Date(currentWindowStart).toISOString()}, ` +
						`anchor=${anchorUtc}, windowsSince=${windowsSinceAnchor}`,
					LOG_CONTEXT
				);
			} else {
				fiveHourQuery = FIVE_HOUR_QUERY; // rolling fallback
				logger.debug('5hr window: no anchor, using rolling 5-hour lookback', LOG_CONTEXT);
			}

			// Build aligned weekly query from reset schedule
			let weeklyQuery: HoneycombQuerySpec;
			const weeklyResetDay = planCalibration?.weeklyResetDay;
			const weeklyResetTime = planCalibration?.weeklyResetTime;
			const weeklyResetTz = planCalibration?.weeklyResetTimezone;
			if (weeklyResetDay && weeklyResetTime && weeklyResetTz) {
				const windowStart = computeWeeklyWindowStart(
					weeklyResetDay,
					weeklyResetTime,
					weeklyResetTz
				);
				if (windowStart) {
					weeklyQuery = {
						...WEEKLY_QUERY_BASE,
						start_time: windowStart,
						end_time: Math.floor(Date.now() / 1000),
					};
					logger.debug(
						`Weekly window aligned: start=${new Date(windowStart * 1000).toISOString()}, ` +
							`resetDay=${weeklyResetDay}, resetTime=${weeklyResetTime}`,
						LOG_CONTEXT
					);
				} else {
					weeklyQuery = { ...WEEKLY_QUERY_BASE, time_range: 604800 }; // fallback
					logger.debug(
						'Weekly window: alignment failed, using rolling 7-day lookback',
						LOG_CONTEXT
					);
				}
			} else {
				weeklyQuery = { ...WEEKLY_QUERY_BASE, time_range: 604800 }; // fallback
				logger.debug('Weekly window: no reset schedule, using rolling 7-day lookback', LOG_CONTEXT);
			}

			// Build aligned sonnet-weekly query from its own separate reset schedule
			let sonnetWeeklyQuery: HoneycombQuerySpec;
			const sonnetResetDay = planCalibration?.sonnetResetDay;
			const sonnetResetTime = planCalibration?.sonnetResetTime;
			const sonnetResetTz = planCalibration?.sonnetResetTimezone;
			if (sonnetResetDay && sonnetResetTime && sonnetResetTz) {
				const windowStart = computeWeeklyWindowStart(
					sonnetResetDay,
					sonnetResetTime,
					sonnetResetTz
				);
				if (windowStart) {
					sonnetWeeklyQuery = {
						...SONNET_WEEKLY_QUERY_BASE,
						start_time: windowStart,
						end_time: Math.floor(Date.now() / 1000),
					};
					logger.debug(
						`Sonnet weekly window aligned: start=${new Date(windowStart * 1000).toISOString()}, ` +
							`resetDay=${sonnetResetDay}, resetTime=${sonnetResetTime}`,
						LOG_CONTEXT
					);
				} else {
					sonnetWeeklyQuery = { ...SONNET_WEEKLY_QUERY_BASE, time_range: 604800 }; // fallback
				}
			} else {
				sonnetWeeklyQuery = { ...SONNET_WEEKLY_QUERY_BASE, time_range: 604800 }; // fallback
			}

			// Run queries (differentiated TTLs, sequential with short delays)
			const [fiveHourResult, weeklyResult, sessionsResult, sonnetWeeklyResult] = await Promise.all([
				client.query(fiveHourQuery, {
					ttlMs: DEFAULT_TTL.FIVE_HOUR,
					bypassCache,
					label: '5hr-usage',
				}),
				client.query(weeklyQuery, {
					ttlMs: DEFAULT_TTL.WEEKLY,
					bypassCache,
					label: 'weekly-usage',
				}),
				client.query(MONTHLY_SESSIONS_QUERY, {
					ttlMs: DEFAULT_TTL.MONTHLY_SESSIONS,
					bypassCache,
					label: 'monthly-sessions',
				}),
				client.query(sonnetWeeklyQuery, {
					ttlMs: DEFAULT_TTL.WEEKLY,
					bypassCache,
					label: 'sonnet-weekly-usage',
				}),
			]);

			// Extract values from results
			const fiveHourRow = fiveHourResult.data?.results?.[0] || {};
			const weeklyRow = weeklyResult.data?.results?.[0] || {};
			const sessionsRow = sessionsResult.data?.results?.[0] || {};
			const sonnetWeeklyRow = sonnetWeeklyResult.data?.results?.[0] || {};

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
				weeklyInputTokens: this.extractNumber(weeklyRow, 'input'),
				weeklyOutputTokens: this.extractNumber(weeklyRow, 'output'),
				weeklyCacheCreationTokens: this.extractNumber(weeklyRow, 'cache_create'),
				sonnetWeeklySpendUsd: this.extractNumber(sonnetWeeklyRow, 'total_cost'),
				sonnetWeeklyBillableTokens:
					this.extractNumber(sonnetWeeklyRow, 'input') +
					this.extractNumber(sonnetWeeklyRow, 'output') +
					this.extractNumber(sonnetWeeklyRow, 'cache_create'),
				monthlySessions: this.extractNumber(sessionsRow, 'COUNT_DISTINCT(session.id)'),
				lastUpdatedAt: Date.now(),
				stale: false,
			};

			this.latestData = data;
			this.broadcastUpdate(data);

			logger.debug(
				`Poll complete: 5hr=$${data.fiveHourSpendUsd.toFixed(2)} (${(data.fiveHourBillableTokens / 1000).toFixed(0)}K tokens), ` +
					`weekly=$${data.weeklySpendUsd.toFixed(2)} (${(data.weeklyBillableTokens / 1000).toFixed(0)}K tokens), ` +
					`sonnet-wk=$${data.sonnetWeeklySpendUsd.toFixed(2)} (${(data.sonnetWeeklyBillableTokens / 1000).toFixed(0)}K tokens), ` +
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
