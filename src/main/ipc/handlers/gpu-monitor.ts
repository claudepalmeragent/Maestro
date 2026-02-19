/**
 * GPU Monitor IPC Handlers
 *
 * Provides IPC interface for GPU monitoring:
 * - Capability detection (what tools are available)
 * - Ollama model status polling
 * - Metrics aggregation
 */

import { ipcMain } from 'electron';
import {
	detectGpuCapabilities,
	queryOllamaModels,
	queryMacmon,
	querySocInfo,
	type GpuCapabilities,
	type GpuMetrics,
	type SocInfo,
} from '../../utils/gpu-probe';
import { logger } from '../../utils/logger';

const LOG_CONTEXT = '[gpu-monitor]';

// Cache capabilities after first detection
let cachedCapabilities: GpuCapabilities | null = null;
let cachedSocInfo: SocInfo | null = null;
let socInfoQueried = false;

export function registerGpuMonitorHandlers(): void {
	// Detect available GPU monitoring tools
	ipcMain.handle('gpuMonitor:getCapabilities', async (): Promise<GpuCapabilities> => {
		if (!cachedCapabilities) {
			cachedCapabilities = await detectGpuCapabilities();
		}
		return cachedCapabilities;
	});

	// Force re-detection of capabilities (e.g., after user installs macmon)
	ipcMain.handle('gpuMonitor:refreshCapabilities', async (): Promise<GpuCapabilities> => {
		cachedCapabilities = await detectGpuCapabilities();
		return cachedCapabilities;
	});

	// Get SoC hardware identity (cached after first call)
	ipcMain.handle('gpuMonitor:getSocInfo', async (): Promise<SocInfo | null> => {
		if (!socInfoQueried) {
			cachedSocInfo = await querySocInfo();
			socInfoQueried = true;
		}
		return cachedSocInfo;
	});

	// Get current GPU metrics (Ollama models + macmon if available)
	ipcMain.handle('gpuMonitor:getMetrics', async (): Promise<GpuMetrics> => {
		if (!cachedCapabilities) {
			cachedCapabilities = await detectGpuCapabilities();
		}

		const metrics: GpuMetrics = { timestamp: Date.now() };

		// Query Ollama if available
		if (cachedCapabilities.hasOllama) {
			try {
				metrics.ollama = await queryOllamaModels(cachedCapabilities.ollamaHost);
			} catch (err) {
				logger.debug(`Ollama query failed: ${err}`, LOG_CONTEXT);
				metrics.error = `Ollama: ${err instanceof Error ? err.message : String(err)}`;
			}
		}

		// Query macmon if available (Apple Silicon only)
		if (cachedCapabilities.hasMacmon) {
			try {
				metrics.macmon = await queryMacmon();
			} catch (err) {
				logger.debug(`macmon query failed: ${err}`, LOG_CONTEXT);
				const macmonError = `macmon: ${err instanceof Error ? err.message : String(err)}`;
				metrics.error = metrics.error ? `${metrics.error}; ${macmonError}` : macmonError;
			}
		}

		return metrics;
	});

	logger.info('GPU monitor handlers registered', LOG_CONTEXT);
}
