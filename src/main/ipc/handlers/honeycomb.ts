/**
 * Honeycomb IPC Handlers
 *
 * Exposes Honeycomb query client functionality to the renderer process.
 */

import { ipcMain } from 'electron';
import { getHoneycombQueryClient } from '../../services/honeycomb-query-client';
import type { HoneycombQuerySpec, QueryOptions } from '../../services/honeycomb-query-client';
import { logger } from '../../utils/logger';

const LOG_CONTEXT = 'HoneycombIPC';

export function registerHoneycombHandlers(): void {
	// Query the Honeycomb API
	ipcMain.handle(
		'honeycomb:query',
		async (_event, querySpec: HoneycombQuerySpec, options?: QueryOptions) => {
			try {
				const client = getHoneycombQueryClient();
				return await client.query(querySpec, options);
			} catch (error) {
				logger.error(`honeycomb:query failed: ${error}`, LOG_CONTEXT);
				throw error;
			}
		}
	);

	// Check if Honeycomb is configured
	ipcMain.handle('honeycomb:is-configured', async () => {
		const client = getHoneycombQueryClient();
		return client.isConfigured();
	});

	// Get rate limit state
	ipcMain.handle('honeycomb:rate-limit-state', async () => {
		const client = getHoneycombQueryClient();
		return client.getRateLimitState();
	});

	// Get backoff state
	ipcMain.handle('honeycomb:backoff-state', async () => {
		const client = getHoneycombQueryClient();
		return client.getBackoffState();
	});

	// Clear cache
	ipcMain.handle('honeycomb:clear-cache', async () => {
		const client = getHoneycombQueryClient();
		client.clearCache();
		return { success: true };
	});

	// Get current flush status
	ipcMain.handle('honeycomb:flush-status-get', async () => {
		const { getLocalTokenLedger } = await import('../../services/local-token-ledger');
		const ledger = getLocalTokenLedger();
		return ledger.getFlushStatus();
	});

	// Get latest cached usage data (no API call)
	ipcMain.handle('honeycomb:usage-get', async () => {
		const { getHoneycombUsageService } = await import('../../services/honeycomb-usage-service');
		const service = getHoneycombUsageService();
		return service.getLatest();
	});

	// Force an immediate usage refresh (bypasses cache)
	ipcMain.handle('honeycomb:usage-refresh', async () => {
		const { getHoneycombUsageService } = await import('../../services/honeycomb-usage-service');
		const service = getHoneycombUsageService();
		return await service.forceRefresh();
	});

	// Check if usage service is running
	ipcMain.handle('honeycomb:usage-is-running', async () => {
		const { getHoneycombUsageService } = await import('../../services/honeycomb-usage-service');
		const service = getHoneycombUsageService();
		return service.isRunning();
	});

	// Get best available usage estimate for a window
	ipcMain.handle(
		'honeycomb:best-estimate',
		async (
			_event,
			windowHoneycombTokens: number,
			calibratedBudget: number | null,
			safetyBufferPct?: number
		) => {
			const { getLocalTokenLedger } = await import('../../services/local-token-ledger');
			const ledger = getLocalTokenLedger();
			return ledger.bestAvailableEstimate(windowHoneycombTokens, calibratedBudget, safetyBufferPct);
		}
	);

	// Get archive state (last archive date, total days, etc.)
	ipcMain.handle('honeycomb:archive-state', async () => {
		const { getHoneycombArchiveService } = await import('../../services/honeycomb-archive-service');
		const service = getHoneycombArchiveService();
		return service.getState();
	});

	// Manually trigger archival ("Archive Now" button)
	ipcMain.handle('honeycomb:archive-now', async () => {
		const { getHoneycombArchiveService } = await import('../../services/honeycomb-archive-service');
		const service = getHoneycombArchiveService();
		await service.runArchival();
		return service.getState();
	});

	// Check if archival is in progress
	ipcMain.handle('honeycomb:archive-is-running', async () => {
		const { getHoneycombArchiveService } = await import('../../services/honeycomb-archive-service');
		const service = getHoneycombArchiveService();
		return service.isArchiving();
	});

	// Get archived daily data for a date range
	ipcMain.handle(
		'honeycomb:archive-get-daily',
		async (
			_event,
			queryName: string,
			startDate: string,
			endDate: string,
			breakdownKey?: string
		) => {
			const { getHoneycombArchiveDB } = await import('../../services/honeycomb-archive-db');
			const db = getHoneycombArchiveDB();
			return db.getDailyData(queryName, startDate, endDate, breakdownKey);
		}
	);

	// Get current data source mode
	ipcMain.handle('honeycomb:data-source-mode', async () => {
		const { getSettingsStore } = await import('../../stores');
		const store = getSettingsStore();
		return store.get('honeycombDataSource', 'mcp') as string;
	});

	// Test MCP connection
	ipcMain.handle(
		'honeycomb:test-connection',
		async (_event, environmentSlug: string, datasetSlug: string) => {
			try {
				const { mcpTestConnection } = await import('../../services/honeycomb-mcp-client');
				return await mcpTestConnection(environmentSlug, datasetSlug);
			} catch (error) {
				logger.error(`honeycomb:test-connection failed: ${error}`, LOG_CONTEXT);
				return { success: false, error: String(error) };
			}
		}
	);

	// Auto-discover environment slug via MCP
	ipcMain.handle('honeycomb:auto-discover-env', async () => {
		try {
			const { mcpDiscoverEnvironment } = await import('../../services/honeycomb-mcp-client');
			return await mcpDiscoverEnvironment();
		} catch (error) {
			logger.error(`honeycomb:auto-discover-env failed: ${error}`, LOG_CONTEXT);
			return null;
		}
	});
}
