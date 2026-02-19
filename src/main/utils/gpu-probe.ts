/**
 * GPU Probe Utility
 *
 * Detects available GPU monitoring tools and queries Ollama for loaded model status.
 * All operations are local-only (no SSH).
 */

import { execFile } from 'child_process';
import { logger } from './logger';

const LOG_CONTEXT = '[gpu-probe]';

// ============================================================================
// Types
// ============================================================================

export interface GpuCapabilities {
	platform: string; // 'darwin' | 'linux' | 'win32'
	hasOllama: boolean;
	ollamaHost: string; // Default: 'http://localhost:11434'
	hasMacmon: boolean;
	hasNvidiaSmi: boolean;
}

export interface OllamaModelStatus {
	name: string; // e.g., "qwen3:8b"
	sizeBytes: number; // Total model size (RAM + VRAM)
	sizeVramBytes: number; // GPU allocation in bytes
	gpuPercent: number; // sizeVram / size * 100
	parameterSize: string; // e.g., "7.2B"
	quantization: string; // e.g., "Q4_0"
	family: string; // e.g., "qwen2", "llama", "gemma3"
	format: string; // e.g., "gguf"
	contextLength?: number; // e.g., 32768
	expiresAt?: string; // ISO 8601 auto-unload time
}

export interface OllamaMetrics {
	models: OllamaModelStatus[];
	totalVramBytes: number;
	timestamp: number;
}

export interface GpuMetrics {
	timestamp: number;
	ollama?: OllamaMetrics;
	macmon?: MacmonMetrics;
	error?: string;
}

export interface MacmonMetrics {
	// GPU
	gpuUtilizationPercent?: number;
	gpuFrequencyMHz?: number;
	gpuPowerWatts?: number;
	// CPU clusters
	ecpuUtilizationPercent?: number;
	ecpuFrequencyMHz?: number;
	pcpuUtilizationPercent?: number;
	pcpuFrequencyMHz?: number;
	// Power breakdown
	cpuPowerWatts?: number;
	anePowerWatts?: number;
	allPowerWatts?: number;
	sysPowerWatts?: number;
	ramPowerWatts?: number;
	gpuRamPowerWatts?: number;
	// Temperatures
	gpuTemperatureCelsius?: number;
	cpuTemperatureCelsius?: number;
	// Memory (unified)
	memoryUsedBytes?: number;
	memoryTotalBytes?: number;
	swapUsedBytes?: number;
	swapTotalBytes?: number;
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

// ============================================================================
// Detection
// ============================================================================

/**
 * Detect available GPU monitoring tools on the local system.
 * Called once on startup; results are cached.
 */
export async function detectGpuCapabilities(): Promise<GpuCapabilities> {
	const platform = process.platform;
	const [hasOllama, hasMacmon, hasNvidiaSmi] = await Promise.all([
		binaryExists('ollama'),
		binaryExists('macmon'),
		binaryExists('nvidia-smi'),
	]);

	const ollamaHost = process.env.OLLAMA_HOST || 'http://localhost:11434';

	logger.info('GPU capabilities detected', LOG_CONTEXT, {
		platform,
		hasOllama,
		hasMacmon,
		hasNvidiaSmi,
		ollamaHost,
	});

	return { platform, hasOllama, ollamaHost, hasMacmon, hasNvidiaSmi };
}

// ============================================================================
// Ollama Polling
// ============================================================================

/**
 * Query Ollama /api/ps for loaded model status.
 * Returns model list with VRAM allocation, quantization, expiration.
 */
export async function queryOllamaModels(ollamaHost: string): Promise<OllamaMetrics> {
	const url = `${ollamaHost}/api/ps`;

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 5000);

	try {
		const response = await fetch(url, { signal: controller.signal });
		if (!response.ok) {
			throw new Error(`Ollama API returned ${response.status}`);
		}

		const data = (await response.json()) as {
			models?: Array<{
				name: string;
				size: number;
				size_vram?: number;
				details?: {
					parameter_size?: string;
					quantization_level?: string;
					family?: string;
					format?: string;
				};
				expires_at?: string;
				context_length?: number;
			}>;
		};

		const models: OllamaModelStatus[] = (data.models || []).map((m) => {
			const sizeVram = m.size_vram || 0;
			const size = m.size || 1; // avoid division by zero
			return {
				name: m.name,
				sizeBytes: m.size,
				sizeVramBytes: sizeVram,
				gpuPercent: Math.round((sizeVram / size) * 100),
				parameterSize: m.details?.parameter_size || 'unknown',
				quantization: m.details?.quantization_level || 'unknown',
				family: m.details?.family || 'unknown',
				format: m.details?.format || 'unknown',
				contextLength: m.context_length,
				expiresAt: m.expires_at,
			};
		});

		const totalVramBytes = models.reduce((sum, m) => sum + m.sizeVramBytes, 0);

		return { models, totalVramBytes, timestamp: Date.now() };
	} finally {
		clearTimeout(timeout);
	}
}

// ============================================================================
// macmon Polling
// ============================================================================

/**
 * Query macmon for Apple Silicon GPU hardware metrics.
 * Spawns `macmon raw -s 1` and parses the JSON output.
 *
 * macmon output uses:
 * - Tuples [freq_mhz, util_pct] for gpu_usage, ecpu_usage, pcpu_usage
 * - Nested objects for temp.*, memory.*
 * - Flat numbers for power fields
 */
export async function queryMacmon(): Promise<MacmonMetrics> {
	return new Promise((resolve, reject) => {
		const child = execFile('macmon', ['raw', '-s', '1'], { timeout: 5000 }, (error, stdout) => {
			if (error) {
				reject(new Error(`macmon failed: ${error.message}`));
				return;
			}

			const firstLine = stdout.trim().split('\n')[0];
			if (!firstLine) {
				reject(new Error('macmon returned no output'));
				return;
			}

			try {
				 
				const data = JSON.parse(firstLine) as any;

				// gpu_usage, ecpu_usage, pcpu_usage are tuples: [freq_mhz, util_percent]
				const gpuUsage = Array.isArray(data.gpu_usage) ? data.gpu_usage : null;
				const ecpuUsage = Array.isArray(data.ecpu_usage) ? data.ecpu_usage : null;
				const pcpuUsage = Array.isArray(data.pcpu_usage) ? data.pcpu_usage : null;

				// temp and memory are nested objects
				const temp = data.temp ?? {};
				const memory = data.memory ?? {};

				const metrics: MacmonMetrics = {
					// GPU — macmon reports utilization as 0.0–1.0 fraction, multiply by 100 for percent
					gpuUtilizationPercent: gpuUsage ? Number(gpuUsage[1]) * 100 : undefined,
					gpuFrequencyMHz: gpuUsage ? Number(gpuUsage[0]) : undefined,
					gpuPowerWatts: data.gpu_power != null ? Number(data.gpu_power) : undefined,
					// CPU clusters — same 0.0–1.0 fraction format
					ecpuUtilizationPercent: ecpuUsage ? Number(ecpuUsage[1]) * 100 : undefined,
					ecpuFrequencyMHz: ecpuUsage ? Number(ecpuUsage[0]) : undefined,
					pcpuUtilizationPercent: pcpuUsage ? Number(pcpuUsage[1]) * 100 : undefined,
					pcpuFrequencyMHz: pcpuUsage ? Number(pcpuUsage[0]) : undefined,
					// Power breakdown
					cpuPowerWatts: data.cpu_power != null ? Number(data.cpu_power) : undefined,
					anePowerWatts: data.ane_power != null ? Number(data.ane_power) : undefined,
					allPowerWatts: data.all_power != null ? Number(data.all_power) : undefined,
					sysPowerWatts: data.sys_power != null ? Number(data.sys_power) : undefined,
					ramPowerWatts: data.ram_power != null ? Number(data.ram_power) : undefined,
					gpuRamPowerWatts: data.gpu_ram_power != null ? Number(data.gpu_ram_power) : undefined,
					// Temperatures
					gpuTemperatureCelsius: temp.gpu_temp_avg != null ? Number(temp.gpu_temp_avg) : undefined,
					cpuTemperatureCelsius: temp.cpu_temp_avg != null ? Number(temp.cpu_temp_avg) : undefined,
					// Memory (unified) — keep as raw bytes
					memoryUsedBytes: memory.ram_usage != null ? Number(memory.ram_usage) : undefined,
					memoryTotalBytes: memory.ram_total != null ? Number(memory.ram_total) : undefined,
					swapUsedBytes: memory.swap_usage != null ? Number(memory.swap_usage) : undefined,
					swapTotalBytes: memory.swap_total != null ? Number(memory.swap_total) : undefined,
				};

				resolve(metrics);
			} catch (parseErr) {
				reject(new Error(`macmon parse error: ${parseErr}`));
			}
		});

		// Kill child if it hangs
		setTimeout(() => {
			child.kill('SIGTERM');
		}, 4500);
	});
}

/**
 * Query macmon for SoC hardware identity.
 * Spawns `macmon raw -s 1 --soc-info` and extracts the `soc` object.
 * Called once and cached — the hardware doesn't change at runtime.
 */
export async function querySocInfo(): Promise<SocInfo | null> {
	return new Promise((resolve) => {
		const child = execFile(
			'macmon',
			['raw', '-s', '1', '--soc-info'],
			{ timeout: 5000 },
			(error, stdout) => {
				if (error) {
					logger.debug(`macmon soc-info failed: ${error.message}`, LOG_CONTEXT);
					resolve(null);
					return;
				}

				const firstLine = stdout.trim().split('\n')[0];
				if (!firstLine) {
					resolve(null);
					return;
				}

				try {
					 
					const data = JSON.parse(firstLine) as any;
					const soc = data.soc;

					if (!soc || !soc.chip_name) {
						resolve(null);
						return;
					}

					resolve({
						macModel: String(soc.mac_model ?? ''),
						chipName: String(soc.chip_name),
						memoryGB: Number(soc.memory_gb ?? 0),
						ecpuCores: Number(soc.ecpu_cores ?? 0),
						pcpuCores: Number(soc.pcpu_cores ?? 0),
						gpuCores: Number(soc.gpu_cores ?? 0),
						ecpuFreqs: Array.isArray(soc.ecpu_freqs) ? soc.ecpu_freqs.map(Number) : [],
						pcpuFreqs: Array.isArray(soc.pcpu_freqs) ? soc.pcpu_freqs.map(Number) : [],
						gpuFreqs: Array.isArray(soc.gpu_freqs) ? soc.gpu_freqs.map(Number) : [],
					});
				} catch {
					resolve(null);
				}
			}
		);

		setTimeout(() => {
			child.kill('SIGTERM');
		}, 4500);
	});
}

// ============================================================================
// Helpers
// ============================================================================

function binaryExists(name: string): Promise<boolean> {
	return new Promise((resolve) => {
		const cmd = process.platform === 'win32' ? 'where' : 'which';
		execFile(cmd, [name], (error) => {
			resolve(!error);
		});
	});
}
