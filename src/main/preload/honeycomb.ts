/**
 * Honeycomb Preload API
 *
 * Exposes Honeycomb query functionality to the renderer via contextBridge.
 */

import { ipcRenderer } from 'electron';

export interface HoneycombPreloadAPI {
	query: (querySpec: unknown, options?: unknown) => Promise<unknown>;
	isConfigured: () => Promise<boolean>;
	getRateLimitState: () => Promise<unknown>;
	getBackoffState: () => Promise<{ inBackoff: boolean; remainingMs: number }>;
	clearCache: () => Promise<{ success: boolean }>;
	getUsage: () => Promise<unknown>;
	refreshUsage: () => Promise<unknown>;
	isUsageServiceRunning: () => Promise<boolean>;
	onUsageUpdate: (callback: (data: unknown) => void) => () => void;
	getFlushStatus: () => Promise<unknown>;
	getBestEstimate: (
		windowHoneycombTokens: number,
		calibratedBudget: number | null,
		safetyBufferPct?: number
	) => Promise<unknown>;
	capacityCheck: (task: unknown) => Promise<unknown>;
	onFlushStatusUpdate: (callback: (status: unknown) => void) => () => void;
	getArchiveState: () => Promise<unknown>;
	archiveNow: () => Promise<unknown>;
	isArchiveRunning: () => Promise<boolean>;
	getArchivedDailyData: (
		queryName: string,
		startDate: string,
		endDate: string,
		breakdownKey?: string
	) => Promise<unknown>;
	getDataSourceMode: () => Promise<string>;
	testConnection: (
		environmentSlug: string,
		datasetSlug: string
	) => Promise<{ success: boolean; error?: string }>;
	autoDiscoverEnv: () => Promise<string | null>;
}

export function createHoneycombAPI(): HoneycombPreloadAPI {
	return {
		query: (querySpec: unknown, options?: unknown) =>
			ipcRenderer.invoke('honeycomb:query', querySpec, options),
		isConfigured: () => ipcRenderer.invoke('honeycomb:is-configured'),
		getRateLimitState: () => ipcRenderer.invoke('honeycomb:rate-limit-state'),
		getBackoffState: () => ipcRenderer.invoke('honeycomb:backoff-state'),
		clearCache: () => ipcRenderer.invoke('honeycomb:clear-cache'),
		getUsage: () => ipcRenderer.invoke('honeycomb:usage-get'),
		refreshUsage: () => ipcRenderer.invoke('honeycomb:usage-refresh'),
		isUsageServiceRunning: () => ipcRenderer.invoke('honeycomb:usage-is-running'),
		onUsageUpdate: (callback: (data: unknown) => void) => {
			const handler = (_event: unknown, data: unknown) => callback(data);
			ipcRenderer.on('honeycomb:usage-update', handler);
			return () => {
				ipcRenderer.removeListener('honeycomb:usage-update', handler);
			};
		},
		getFlushStatus: () => ipcRenderer.invoke('honeycomb:flush-status-get'),
		getBestEstimate: (
			windowHoneycombTokens: number,
			calibratedBudget: number | null,
			safetyBufferPct?: number
		) =>
			ipcRenderer.invoke(
				'honeycomb:best-estimate',
				windowHoneycombTokens,
				calibratedBudget,
				safetyBufferPct
			),
		capacityCheck: (task: unknown) => ipcRenderer.invoke('honeycomb:capacity-check', task),
		onFlushStatusUpdate: (callback: (status: unknown) => void) => {
			const handler = (_event: unknown, status: unknown) => callback(status);
			ipcRenderer.on('honeycomb:flush-status', handler);
			return () => {
				ipcRenderer.removeListener('honeycomb:flush-status', handler);
			};
		},
		getArchiveState: () => ipcRenderer.invoke('honeycomb:archive-state'),
		archiveNow: () => ipcRenderer.invoke('honeycomb:archive-now'),
		isArchiveRunning: () => ipcRenderer.invoke('honeycomb:archive-is-running'),
		getArchivedDailyData: (
			queryName: string,
			startDate: string,
			endDate: string,
			breakdownKey?: string
		) =>
			ipcRenderer.invoke(
				'honeycomb:archive-get-daily',
				queryName,
				startDate,
				endDate,
				breakdownKey
			),
		getDataSourceMode: () => ipcRenderer.invoke('honeycomb:data-source-mode'),
		testConnection: (environmentSlug: string, datasetSlug: string) =>
			ipcRenderer.invoke('honeycomb:test-connection', environmentSlug, datasetSlug),
		autoDiscoverEnv: () => ipcRenderer.invoke('honeycomb:auto-discover-env'),
	};
}
