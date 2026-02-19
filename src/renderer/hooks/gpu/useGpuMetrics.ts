/**
 * useGpuMetrics Hook
 *
 * Polls window.maestro.gpuMonitor.getMetrics() at a configurable interval.
 * Returns current GPU metrics (Ollama model status, macmon hardware data when available).
 */

import { useState, useEffect, useCallback, useRef } from 'react';

// Types matching the preload API response
export interface OllamaModelStatus {
	name: string;
	sizeBytes: number;
	sizeVramBytes: number;
	gpuPercent: number;
	parameterSize: string;
	quantization: string;
	family: string;
	format: string;
	contextLength?: number;
	expiresAt?: string;
}

export interface OllamaMetrics {
	models: OllamaModelStatus[];
	totalVramBytes: number;
	timestamp: number;
}

export interface MacmonMetrics {
	gpuUtilizationPercent?: number;
	gpuFrequencyMHz?: number;
	gpuPowerWatts?: number;
	ecpuUtilizationPercent?: number;
	ecpuFrequencyMHz?: number;
	pcpuUtilizationPercent?: number;
	pcpuFrequencyMHz?: number;
	cpuPowerWatts?: number;
	anePowerWatts?: number;
	allPowerWatts?: number;
	sysPowerWatts?: number;
	ramPowerWatts?: number;
	gpuRamPowerWatts?: number;
	gpuTemperatureCelsius?: number;
	cpuTemperatureCelsius?: number;
	memoryUsedBytes?: number;
	memoryTotalBytes?: number;
	swapUsedBytes?: number;
	swapTotalBytes?: number;
}

export interface GpuMetrics {
	timestamp: number;
	ollama?: OllamaMetrics;
	macmon?: MacmonMetrics;
	error?: string;
}

export interface GpuCapabilities {
	platform: string;
	hasOllama: boolean;
	ollamaHost: string;
	hasMacmon: boolean;
	hasNvidiaSmi: boolean;
}

export interface SocInfo {
	macModel: string;
	chipName: string;
	memoryGB: number;
	ecpuCores: number;
	pcpuCores: number;
	gpuCores: number;
	ecpuFreqs: number[];
	pcpuFreqs: number[];
	gpuFreqs: number[];
}

export interface UseGpuMetricsOptions {
	/** Polling interval in ms (default: 3000) */
	intervalMs?: number;
	/** Whether polling is active (default: true) */
	enabled?: boolean;
}

export interface UseGpuMetricsReturn {
	metrics: GpuMetrics | null;
	capabilities: GpuCapabilities | null;
	socInfo: SocInfo | null;
	isLoading: boolean;
	error: string | null;
	refresh: () => Promise<void>;
}

export function useGpuMetrics(options: UseGpuMetricsOptions = {}): UseGpuMetricsReturn {
	const { intervalMs = 3000, enabled = true } = options;

	const [metrics, setMetrics] = useState<GpuMetrics | null>(null);
	const [capabilities, setCapabilities] = useState<GpuCapabilities | null>(null);
	const [socInfo, setSocInfo] = useState<SocInfo | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const mountedRef = useRef(true);

	const fetchMetrics = useCallback(async () => {
		try {
			const result = await window.maestro.gpuMonitor.getMetrics();
			if (mountedRef.current) {
				setMetrics(result);
				setError(result.error ?? null);
			}
		} catch (err) {
			if (mountedRef.current) {
				setError(err instanceof Error ? err.message : String(err));
			}
		}
	}, []);

	// Detect capabilities once on mount
	useEffect(() => {
		if (!enabled) return;

		let cancelled = false;
		(async () => {
			try {
				const caps = await window.maestro.gpuMonitor.getCapabilities();
				if (!cancelled) {
					setCapabilities(caps);
				}
				// Also fetch SoC info if macmon is available
				if (caps.hasMacmon) {
					const soc = await window.maestro.gpuMonitor.getSocInfo();
					if (!cancelled) {
						setSocInfo(soc);
					}
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : String(err));
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [enabled]);

	// Poll metrics at interval
	useEffect(() => {
		if (!enabled) return;

		mountedRef.current = true;

		// Initial fetch
		fetchMetrics().finally(() => {
			if (mountedRef.current) {
				setIsLoading(false);
			}
		});

		const interval = setInterval(fetchMetrics, intervalMs);

		return () => {
			mountedRef.current = false;
			clearInterval(interval);
		};
	}, [enabled, intervalMs, fetchMetrics]);

	return { metrics, capabilities, socInfo, isLoading, error, refresh: fetchMetrics };
}
