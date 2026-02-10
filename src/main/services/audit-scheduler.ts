/**
 * Audit Scheduler Service
 *
 * Manages scheduled audit runs for daily, weekly, and monthly audits.
 * Uses setTimeout for scheduling to avoid external dependencies.
 */

import {
	performAudit,
	saveAuditSnapshot,
	AuditConfig,
	AuditResult,
} from './anthropic-audit-service';
import { getStatsDB } from '../stats';
import { logger } from '../utils/logger';

const LOG_CONTEXT = '[AuditScheduler]';

// Track active timers for cleanup
let scheduledTimers: NodeJS.Timeout[] = [];

// Default audit configuration
const DEFAULT_AUDIT_CONFIG: AuditConfig = {
	dailyEnabled: false,
	dailyTime: '00:00',
	weeklyEnabled: false,
	weeklyDay: 0, // Sunday
	monthlyEnabled: false,
};

// ============================================================================
// Configuration Management
// ============================================================================

/**
 * Get the current audit configuration from the database.
 *
 * @returns The current audit configuration
 */
export async function getAuditConfig(): Promise<AuditConfig> {
	try {
		const db = getStatsDB();
		const database = db.database;

		const row = database.prepare("SELECT value FROM _meta WHERE key = 'audit_config'").get() as
			| { value: string }
			| undefined;

		if (row?.value) {
			return JSON.parse(row.value) as AuditConfig;
		}

		return DEFAULT_AUDIT_CONFIG;
	} catch (error) {
		logger.warn(`Failed to get audit config: ${error}`, LOG_CONTEXT);
		return DEFAULT_AUDIT_CONFIG;
	}
}

/**
 * Save the audit configuration to the database.
 *
 * @param config - The configuration to save
 */
export async function saveAuditConfig(config: AuditConfig): Promise<void> {
	try {
		const db = getStatsDB();
		const database = db.database;

		database
			.prepare("INSERT OR REPLACE INTO _meta (key, value) VALUES ('audit_config', ?)")
			.run(JSON.stringify(config));

		logger.info('Saved audit config', LOG_CONTEXT, { config });

		// Reschedule with new config
		await scheduleAudits();
	} catch (error) {
		logger.error(`Failed to save audit config: ${error}`, LOG_CONTEXT);
		throw error;
	}
}

// ============================================================================
// Scheduling Functions
// ============================================================================

/**
 * Schedule all enabled audits based on the current configuration.
 */
export async function scheduleAudits(): Promise<void> {
	// Clear existing timers
	clearScheduledTimers();

	const config = await getAuditConfig();

	if (config.dailyEnabled) {
		scheduleDailyAudit(config.dailyTime);
	}

	if (config.weeklyEnabled) {
		scheduleWeeklyAudit(config.weeklyDay);
	}

	if (config.monthlyEnabled) {
		scheduleMonthlyAudit();
	}

	logger.info('Audits scheduled', LOG_CONTEXT, {
		dailyEnabled: config.dailyEnabled,
		weeklyEnabled: config.weeklyEnabled,
		monthlyEnabled: config.monthlyEnabled,
	});
}

/**
 * Clear all scheduled audit timers.
 */
export function clearScheduledTimers(): void {
	for (const timer of scheduledTimers) {
		clearTimeout(timer);
	}
	scheduledTimers = [];
	logger.debug('Cleared all scheduled audit timers', LOG_CONTEXT);
}

/**
 * Schedule a daily audit at the specified time.
 *
 * @param time - Time in HH:MM format
 */
function scheduleDailyAudit(time: string): void {
	const [hours, minutes] = time.split(':').map(Number);
	const now = new Date();
	const next = new Date();
	next.setHours(hours, minutes, 0, 0);

	// If the time has passed today, schedule for tomorrow
	if (next <= now) {
		next.setDate(next.getDate() + 1);
	}

	const delay = next.getTime() - now.getTime();

	logger.info(
		`Scheduling daily audit for ${next.toISOString()} (in ${Math.round(delay / 1000 / 60)} minutes)`,
		LOG_CONTEXT
	);

	const timer = setTimeout(async () => {
		await runScheduledAudit('daily');
		scheduleDailyAudit(time); // Reschedule for next day
	}, delay);

	scheduledTimers.push(timer);
}

/**
 * Schedule a weekly audit on the specified day.
 *
 * @param day - Day of the week (0-6, where 0 is Sunday)
 */
function scheduleWeeklyAudit(day: number): void {
	const now = new Date();
	const next = new Date();
	next.setHours(0, 0, 0, 0);

	// Calculate days until target day
	const daysUntil = (day - now.getDay() + 7) % 7 || 7;
	next.setDate(next.getDate() + daysUntil);

	const delay = next.getTime() - now.getTime();

	logger.info(
		`Scheduling weekly audit for ${next.toISOString()} (in ${Math.round(delay / 1000 / 60 / 60)} hours)`,
		LOG_CONTEXT
	);

	const timer = setTimeout(async () => {
		await runScheduledAudit('weekly');
		scheduleWeeklyAudit(day); // Reschedule for next week
	}, delay);

	scheduledTimers.push(timer);
}

/**
 * Schedule a monthly audit for the first day of the next month.
 */
function scheduleMonthlyAudit(): void {
	const now = new Date();
	const next = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0);

	const delay = next.getTime() - now.getTime();

	logger.info(
		`Scheduling monthly audit for ${next.toISOString()} (in ${Math.round(delay / 1000 / 60 / 60 / 24)} days)`,
		LOG_CONTEXT
	);

	const timer = setTimeout(async () => {
		await runScheduledAudit('monthly');
		scheduleMonthlyAudit(); // Reschedule for next month
	}, delay);

	scheduledTimers.push(timer);
}

// ============================================================================
// Audit Execution
// ============================================================================

/**
 * Run a scheduled audit.
 *
 * @param type - The type of audit to run
 * @returns The audit result
 */
async function runScheduledAudit(
	type: 'daily' | 'weekly' | 'monthly'
): Promise<AuditResult | null> {
	logger.info(`Running ${type} audit`, LOG_CONTEXT);

	const endDate = new Date().toISOString().split('T')[0];
	let startDate: string;

	switch (type) {
		case 'daily':
			startDate = endDate;
			break;
		case 'weekly': {
			const weekAgo = new Date();
			weekAgo.setDate(weekAgo.getDate() - 7);
			startDate = weekAgo.toISOString().split('T')[0];
			break;
		}
		case 'monthly': {
			const monthAgo = new Date();
			monthAgo.setMonth(monthAgo.getMonth() - 1);
			startDate = monthAgo.toISOString().split('T')[0];
			break;
		}
	}

	try {
		const result = await performAudit(startDate, endDate);
		await saveAuditSnapshot(result, type);

		logger.info(`${type} audit completed successfully`, LOG_CONTEXT, {
			anomalies: result.anomalies.length,
			savings: result.costs.savings,
		});

		// Update last run info in the audit_schedule table
		await updateScheduleLastRun(type, 'completed');

		return result;
	} catch (error) {
		const err = error as Error;
		logger.error(`${type} audit failed: ${err.message}`, LOG_CONTEXT);

		await updateScheduleLastRun(type, 'failed');

		return null;
	}
}

/**
 * Update the last run information for a schedule type.
 *
 * @param scheduleType - The type of schedule
 * @param status - The status of the last run
 */
async function updateScheduleLastRun(
	scheduleType: 'daily' | 'weekly' | 'monthly',
	status: 'completed' | 'failed'
): Promise<void> {
	try {
		const db = getStatsDB();
		const database = db.database;

		const now = Date.now();

		// Check if the schedule exists
		const existing = database
			.prepare('SELECT id FROM audit_schedule WHERE schedule_type = ?')
			.get(scheduleType);

		if (existing) {
			database
				.prepare(
					'UPDATE audit_schedule SET last_run_at = ?, last_run_status = ?, updated_at = ? WHERE schedule_type = ?'
				)
				.run(now, status, now, scheduleType);
		} else {
			database
				.prepare(
					'INSERT INTO audit_schedule (schedule_type, enabled, last_run_at, last_run_status, created_at, updated_at) VALUES (?, 1, ?, ?, ?, ?)'
				)
				.run(scheduleType, now, status, now, now);
		}
	} catch (error) {
		logger.warn(`Failed to update schedule last run: ${error}`, LOG_CONTEXT);
	}
}

/**
 * Get the last run information for all schedules.
 *
 * @returns Map of schedule type to last run info
 */
export async function getScheduleStatus(): Promise<
	Map<
		string,
		{
			enabled: boolean;
			lastRunAt: number | null;
			lastRunStatus: string | null;
			nextRunAt: number | null;
		}
	>
> {
	const db = getStatsDB();
	const database = db.database;

	const rows = database.prepare('SELECT * FROM audit_schedule').all() as Array<{
		schedule_type: string;
		enabled: number;
		last_run_at: number | null;
		last_run_status: string | null;
		next_run_at: number | null;
	}>;

	const result = new Map<
		string,
		{
			enabled: boolean;
			lastRunAt: number | null;
			lastRunStatus: string | null;
			nextRunAt: number | null;
		}
	>();

	for (const row of rows) {
		result.set(row.schedule_type, {
			enabled: row.enabled === 1,
			lastRunAt: row.last_run_at,
			lastRunStatus: row.last_run_status,
			nextRunAt: row.next_run_at,
		});
	}

	return result;
}

/**
 * Run an audit immediately (manual trigger).
 *
 * @param startDate - Start date (YYYY-MM-DD)
 * @param endDate - End date (YYYY-MM-DD)
 * @returns The audit result
 */
export async function runManualAudit(startDate: string, endDate: string): Promise<AuditResult> {
	logger.info(`Running manual audit from ${startDate} to ${endDate}`, LOG_CONTEXT);

	const result = await performAudit(startDate, endDate);
	await saveAuditSnapshot(result, 'manual');

	logger.info('Manual audit completed', LOG_CONTEXT, {
		anomalies: result.anomalies.length,
		savings: result.costs.savings,
	});

	return result;
}
