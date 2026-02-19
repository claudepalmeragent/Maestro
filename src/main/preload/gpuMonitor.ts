/**
 * Preload API for GPU Monitor
 *
 * Provides the window.maestro.gpuMonitor namespace for:
 * - Detecting available GPU monitoring tools
 * - Polling Ollama model status and GPU metrics
 */

import { ipcRenderer } from 'electron';

export type GpuMonitorApi = ReturnType<typeof createGpuMonitorApi>;

export function createGpuMonitorApi() {
	return {
		/** Detect available GPU monitoring tools (cached after first call) */
		getCapabilities: (): Promise<{
			platform: string;
			hasOllama: boolean;
			ollamaHost: string;
			hasMacmon: boolean;
			hasNvidiaSmi: boolean;
		}> => ipcRenderer.invoke('gpuMonitor:getCapabilities'),

		/** Force re-detection of GPU capabilities */
		refreshCapabilities: (): Promise<{
			platform: string;
			hasOllama: boolean;
			ollamaHost: string;
			hasMacmon: boolean;
			hasNvidiaSmi: boolean;
		}> => ipcRenderer.invoke('gpuMonitor:refreshCapabilities'),

		/** Get current GPU metrics (Ollama models + hardware metrics) */
		getMetrics: (): Promise<{
			timestamp: number;
			ollama?: {
				models: Array<{
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
				}>;
				totalVramBytes: number;
				timestamp: number;
			};
			macmon?: {
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
			};
			error?: string;
		}> => ipcRenderer.invoke('gpuMonitor:getMetrics'),

		/** Get SoC hardware identity (chip name, core counts, etc.) — cached */
		getSocInfo: (): Promise<{
			macModel: string;
			chipName: string;
			memoryGB: number;
			ecpuCores: number;
			pcpuCores: number;
			gpuCores: number;
			ecpuFreqs: number[];
			pcpuFreqs: number[];
			gpuFreqs: number[];
		} | null> => ipcRenderer.invoke('gpuMonitor:getSocInfo'),
	};
}
