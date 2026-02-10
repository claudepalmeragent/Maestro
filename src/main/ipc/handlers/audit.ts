/**
 * Audit IPC Handlers
 *
 * These handlers provide access to the Anthropic audit service for comparing
 * Anthropic's usage data with Maestro's recorded data.
 *
 * Features:
 * - Run manual audits for a date range
 * - Get audit history
 * - Configure and manage scheduled audits
 */

import { ipcMain, BrowserWindow } from 'electron';
import { logger } from '../../utils/logger';
import { withIpcErrorLogging, CreateHandlerOptions } from '../../utils/ipcHandler';
import {
	getAuditHistory,
	getAuditSnapshotsByRange,
	AuditResult,
	AuditConfig,
} from '../../services/anthropic-audit-service';
import {
	getAuditConfig,
	saveAuditConfig,
	scheduleAudits,
	getScheduleStatus,
	runManualAudit,
	clearScheduledTimers,
} from '../../services/audit-scheduler';
import { getStatsDB } from '../../stats';

const LOG_CONTEXT = '[Audit]';

// Helper to create handler options with consistent context
const handlerOpts = (operation: string): Pick<CreateHandlerOptions, 'context' | 'operation'> => ({
	context: LOG_CONTEXT,
	operation,
});

/**
 * Dependencies for audit handlers
 */
export interface AuditHandlerDependencies {
	getMainWindow: () => BrowserWindow | null;
}

/**
 * Broadcast audit update to renderer
 */
function broadcastAuditUpdate(getMainWindow: () => BrowserWindow | null): void {
	const mainWindow = getMainWindow();
	if (mainWindow && !mainWindow.isDestroyed()) {
		mainWindow.webContents.send('audit:updated');
	}
}

/**
 * Register all Audit-related IPC handlers.
 *
 * These handlers provide audit operations:
 * - Run a manual audit for a date range
 * - Get audit history
 * - Get/save audit configuration
 * - Get schedule status
 */
export function registerAuditHandlers(deps: AuditHandlerDependencies): void {
	const { getMainWindow } = deps;

	// Run an audit for a specific date range
	ipcMain.handle(
		'audit:run',
		withIpcErrorLogging(
			handlerOpts('runAudit'),
			async (startDate: string, endDate: string): Promise<AuditResult> => {
				logger.info(`Running audit for ${startDate} to ${endDate}`, LOG_CONTEXT);
				const result = await runManualAudit(startDate, endDate);
				broadcastAuditUpdate(getMainWindow);
				return result;
			}
		)
	);

	// Get audit history (most recent audits)
	ipcMain.handle(
		'audit:getHistory',
		withIpcErrorLogging(
			handlerOpts('getHistory'),
			async (limit?: number): Promise<AuditResult[]> => {
				logger.debug(`Getting audit history (limit: ${limit || 10})`, LOG_CONTEXT);
				return await getAuditHistory(limit);
			}
		)
	);

	// Get audit snapshots within a date range
	ipcMain.handle(
		'audit:getSnapshotsByRange',
		withIpcErrorLogging(
			handlerOpts('getSnapshotsByRange'),
			async (startDate: string, endDate: string): Promise<AuditResult[]> => {
				logger.debug(`Getting audit snapshots for ${startDate} to ${endDate}`, LOG_CONTEXT);
				return await getAuditSnapshotsByRange(startDate, endDate);
			}
		)
	);

	// Get current audit configuration
	ipcMain.handle(
		'audit:getConfig',
		withIpcErrorLogging(handlerOpts('getConfig'), async (): Promise<AuditConfig> => {
			return await getAuditConfig();
		})
	);

	// Save audit configuration
	ipcMain.handle(
		'audit:saveConfig',
		withIpcErrorLogging(
			handlerOpts('saveConfig'),
			async (config: AuditConfig): Promise<{ success: boolean }> => {
				logger.info('Saving audit config', LOG_CONTEXT, { config });
				await saveAuditConfig(config);
				broadcastAuditUpdate(getMainWindow);
				return { success: true };
			}
		)
	);

	// Get schedule status for all audit types
	ipcMain.handle(
		'audit:getScheduleStatus',
		withIpcErrorLogging(
			handlerOpts('getScheduleStatus'),
			async (): Promise<
				Record<
					string,
					{
						enabled: boolean;
						lastRunAt: number | null;
						lastRunStatus: string | null;
						nextRunAt: number | null;
					}
				>
			> => {
				const status = await getScheduleStatus();
				// Convert Map to plain object for IPC serialization
				return Object.fromEntries(status);
			}
		)
	);

	// Start scheduled audits (called on app startup)
	ipcMain.handle(
		'audit:startScheduler',
		withIpcErrorLogging(handlerOpts('startScheduler'), async (): Promise<{ success: boolean }> => {
			logger.info('Starting audit scheduler', LOG_CONTEXT);
			await scheduleAudits();
			return { success: true };
		})
	);

	// Stop scheduled audits (called on app shutdown)
	ipcMain.handle(
		'audit:stopScheduler',
		withIpcErrorLogging(handlerOpts('stopScheduler'), async (): Promise<{ success: boolean }> => {
			logger.info('Stopping audit scheduler', LOG_CONTEXT);
			clearScheduledTimers();
			return { success: true };
		})
	);

	// Auto-correct selected entries by updating Maestro's records to match Anthropic's data
	ipcMain.handle(
		'audit:autoCorrect',
		withIpcErrorLogging(
			handlerOpts('autoCorrect'),
			async (entryIds: string[]): Promise<{ corrected: number; total: number }> => {
				logger.info(`Auto-correcting ${entryIds.length} entries`, LOG_CONTEXT);

				const db = getStatsDB();
				let corrected = 0;

				for (const id of entryIds) {
					try {
						// Update the query event with corrected values
						// This marks the entry as auto-corrected by setting the maestro_corrected_at timestamp
						const stmt = db.database.prepare(`
							UPDATE query_events
							SET maestro_corrected_at = ?
							WHERE id = ?
						`);
						const result = stmt.run(Date.now(), id);
						if (result.changes > 0) {
							corrected++;
						}
					} catch (error) {
						logger.error(`Failed to correct entry ${id}:`, LOG_CONTEXT, { error });
					}
				}

				logger.info(`Auto-corrected ${corrected}/${entryIds.length} entries`, LOG_CONTEXT);
				broadcastAuditUpdate(getMainWindow);
				return { corrected, total: entryIds.length };
			}
		)
	);

	logger.info('Audit IPC handlers registered', LOG_CONTEXT);
}
