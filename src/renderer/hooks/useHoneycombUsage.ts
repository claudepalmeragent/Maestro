/**
 * useHoneycombUsage
 *
 * React hook for accessing Honeycomb usage data from the renderer process.
 * Subscribes to IPC updates from HoneycombUsageService.
 */

import { useState, useEffect, useCallback } from 'react';

// Mirror of UsageData from main process (avoid cross-boundary imports)
export interface HoneycombUsageData {
	fiveHourSpendUsd: number;
	fiveHourBillableTokens: number;
	weeklySpendUsd: number;
	weeklyBillableTokens: number;
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

interface UseHoneycombUsageReturn {
	data: HoneycombUsageData | null;
	isLoading: boolean;
	error: string | null;
	refresh: () => Promise<void>;
	isConfigured: boolean;
}

export function useHoneycombUsage(): UseHoneycombUsageReturn {
	const [data, setData] = useState<HoneycombUsageData | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [isConfigured, setIsConfigured] = useState(false);

	// Check if configured on mount
	useEffect(() => {
		window.maestro?.honeycomb
			?.isConfigured()
			.then((configured: boolean) => setIsConfigured(configured))
			.catch(() => setIsConfigured(false));
	}, []);

	// Fetch initial data
	useEffect(() => {
		window.maestro?.honeycomb
			?.getUsage()
			.then((usage: unknown) => {
				if (usage) {
					setData(usage as HoneycombUsageData);
				}
				setIsLoading(false);
			})
			.catch((err: Error) => {
				setError(err.message);
				setIsLoading(false);
			});
	}, []);

	// Subscribe to live updates
	useEffect(() => {
		const unsubscribe = window.maestro?.honeycomb?.onUsageUpdate((usage: unknown) => {
			setData(usage as HoneycombUsageData);
			setIsLoading(false);
			setError(null);
		});
		return unsubscribe;
	}, []);

	// Manual refresh
	const refresh = useCallback(async () => {
		setIsLoading(true);
		try {
			const usage = await window.maestro.honeycomb.refreshUsage();
			setData(usage as HoneycombUsageData);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsLoading(false);
		}
	}, []);

	return { data, isLoading, error, refresh, isConfigured };
}
