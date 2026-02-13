/**
 * Preload API for audit operations
 *
 * Provides the window.maestro.audit namespace for:
 * - Running audits to compare Anthropic vs Maestro usage
 * - Getting audit history
 * - Configuring scheduled audits
 */

import { ipcRenderer } from 'electron';

/**
 * Token count breakdown for audit results
 */
export interface TokenCounts {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
}

/**
 * Audit result comparing Anthropic and Maestro data
 */
export interface AuditResult {
	period: { start: string; end: string };
	generatedAt: number;

	tokens: {
		anthropic: TokenCounts;
		maestro: TokenCounts;
		difference: TokenCounts;
		percentDiff: number;
	};

	costs: {
		anthropic_total: number;
		maestro_anthropic: number;
		maestro_calculated: number;
		discrepancy: number;
		savings: number;
	};

	modelBreakdown: Array<{
		model: string;
		anthropic: { tokens: TokenCounts; cost: number };
		maestro: { tokens: TokenCounts; cost: number };
		match: boolean;
	}>;

	anomalies: Array<{
		type: 'missing_query' | 'token_mismatch' | 'cost_mismatch' | 'model_mismatch';
		severity: 'info' | 'warning' | 'error';
		description: string;
		details: unknown;
	}>;
}

/**
 * Individual audit entry for detailed comparison
 */
export interface AuditEntry {
	id: string;
	date: string;
	model: string;
	billingMode: 'api' | 'max' | 'unknown';
	tokens: {
		anthropic: TokenCounts;
		maestro: TokenCounts;
	};
	costs: {
		anthropicCost: number;
		maestroCost: number;
	};
	status: 'match' | 'minor' | 'major' | 'missing';
	discrepancyPercent: number;
}

/**
 * Billing mode breakdown for audit summary
 */
export interface BillingModeBreakdown {
	api: {
		entryCount: number;
		anthropicCost: number;
		maestroCost: number;
		tokenCount: number;
	};
	max: {
		entryCount: number;
		anthropicCost: number;
		maestroCost: number;
		cacheSavings: number;
		tokenCount: number;
	};
}

/**
 * Extended audit result with entry-level data
 */
export interface ExtendedAuditResult extends AuditResult {
	entries: AuditEntry[];
	billingModeBreakdown: BillingModeBreakdown;
	summary: {
		total: number;
		matches: number;
		minorDiscrepancies: number;
		majorDiscrepancies: number;
		missing: number;
	};
}

/**
 * Audit configuration settings
 */
export interface AuditConfig {
	dailyEnabled: boolean;
	dailyTime: string; // HH:MM format
	weeklyEnabled: boolean;
	weeklyDay: number; // 0-6 (Sunday-Saturday)
	monthlyEnabled: boolean;
}

/**
 * Schedule status for an audit type
 */
export interface ScheduleStatus {
	enabled: boolean;
	lastRunAt: number | null;
	lastRunStatus: string | null;
	nextRunAt: number | null;
}

/**
 * Creates the Audit API object for preload exposure
 */
export function createAuditApi() {
	return {
		/**
		 * Run an audit for a specific date range.
		 * Compares Anthropic's usage data (via ccusage) with Maestro's recorded data.
		 *
		 * @param startDate - Start date (YYYY-MM-DD)
		 * @param endDate - End date (YYYY-MM-DD)
		 * @returns The extended audit result with comparisons, entries, and breakdowns
		 */
		run: (startDate: string, endDate: string): Promise<ExtendedAuditResult> =>
			ipcRenderer.invoke('audit:run', startDate, endDate),

		/**
		 * Get historical audit results.
		 *
		 * @param limit - Maximum number of results to return (default: 10)
		 * @returns Array of past extended audit results
		 */
		getHistory: (limit?: number): Promise<ExtendedAuditResult[]> =>
			ipcRenderer.invoke('audit:getHistory', limit),

		/**
		 * Get audit snapshots within a date range.
		 *
		 * @param startDate - Start date (YYYY-MM-DD)
		 * @param endDate - End date (YYYY-MM-DD)
		 * @returns Array of audit results for the specified range
		 */
		getSnapshotsByRange: (startDate: string, endDate: string): Promise<AuditResult[]> =>
			ipcRenderer.invoke('audit:getSnapshotsByRange', startDate, endDate),

		/**
		 * Get the current audit configuration.
		 *
		 * @returns The current audit schedule configuration
		 */
		getConfig: (): Promise<AuditConfig> => ipcRenderer.invoke('audit:getConfig'),

		/**
		 * Save audit configuration.
		 * This will also reschedule audits based on the new configuration.
		 *
		 * @param config - The configuration to save
		 * @returns Success status
		 */
		saveConfig: (config: AuditConfig): Promise<{ success: boolean }> =>
			ipcRenderer.invoke('audit:saveConfig', config),

		/**
		 * Get the status of all scheduled audits.
		 *
		 * @returns Map of schedule type to status info
		 */
		getScheduleStatus: (): Promise<Record<string, ScheduleStatus>> =>
			ipcRenderer.invoke('audit:getScheduleStatus'),

		/**
		 * Start the audit scheduler.
		 * Called automatically on app startup.
		 *
		 * @returns Success status
		 */
		startScheduler: (): Promise<{ success: boolean }> => ipcRenderer.invoke('audit:startScheduler'),

		/**
		 * Stop the audit scheduler.
		 * Called automatically on app shutdown.
		 *
		 * @returns Success status
		 */
		stopScheduler: (): Promise<{ success: boolean }> => ipcRenderer.invoke('audit:stopScheduler'),

		/**
		 * Auto-correct selected entries by updating Maestro's records.
		 * This marks the entries as corrected.
		 *
		 * @param entryIds - Array of entry IDs to auto-correct
		 * @returns Number of entries corrected and total attempted
		 */
		autoCorrect: (entryIds: string[]): Promise<{ corrected: number; total: number }> =>
			ipcRenderer.invoke('audit:autoCorrect', entryIds),

		/**
		 * Subscribe to audit updates.
		 * Called when a new audit completes or configuration changes.
		 *
		 * @param callback - Function to call when audit data updates
		 * @returns Unsubscribe function
		 */
		onAuditUpdate: (callback: () => void) => {
			const handler = () => callback();
			ipcRenderer.on('audit:updated', handler);
			return () => ipcRenderer.removeListener('audit:updated', handler);
		},
	};
}

export type AuditApi = ReturnType<typeof createAuditApi>;
