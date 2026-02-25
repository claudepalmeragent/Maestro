/**
 * GpuResourcesPanel
 *
 * Rich GPU monitoring panel with donut gauges, power breakdowns,
 * CPU cluster stats, temperatures, and Ollama model memory visualization.
 * Designed to be embedded inside ProcessMonitor as a collapsible section.
 */

import { useState } from 'react';
import { ChevronRight, ChevronDown, Cpu, AlertCircle } from 'lucide-react';
import type { Theme } from '../types';
import {
	useGpuMetrics,
	type OllamaModelStatus,
	type MacmonMetrics,
	type SocInfo,
} from '../hooks/gpu';
import { DonutGauge, MODEL_COLORS } from './DonutGauge';

interface GpuResourcesPanelProps {
	theme: Theme;
	enabled: boolean;
}

/** Format bytes to human-readable string */
function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	const value = bytes / Math.pow(1024, i);
	return `${value.toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

/** Format expiration time relative to now */
function formatExpiry(expiresAt: string): string {
	const expiry = new Date(expiresAt).getTime();
	const now = Date.now();
	const diffMs = expiry - now;
	if (diffMs <= 0) return 'now';
	const minutes = Math.floor(diffMs / 60000);
	if (minutes < 1) return 'in <1m';
	if (minutes < 60) return `in ${minutes}m`;
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	return `in ${hours}h ${remainingMinutes}m`;
}

/** Format watts with 1 decimal */
function formatWatts(w: number): string {
	return `${Number(w).toFixed(1)}W`;
}

export function GpuResourcesPanel({ theme, enabled }: GpuResourcesPanelProps) {
	const [isExpanded, setIsExpanded] = useState(true);
	const { metrics, capabilities, socInfo, isLoading, error } = useGpuMetrics({ enabled });

	// Don't render if no GPU tools and no fallback memory data available
	if (capabilities && !capabilities.hasOllama && !capabilities.hasMacmon && !metrics?.macmon) {
		return null;
	}

	const ollamaModels = metrics?.ollama?.models ?? [];
	const hasModels = ollamaModels.length > 0;
	const macmon = metrics?.macmon;

	// Build header subtitle from SoC info
	const headerSubtitle = socInfo
		? `${socInfo.chipName} · ${socInfo.gpuCores} GPU cores`
		: undefined;

	return (
		<div className="border-b" style={{ borderColor: theme.colors.border }}>
			{/* Section header */}
			<button
				className="w-full px-4 py-2.5 flex items-center gap-2 hover:bg-opacity-5"
				style={{ color: theme.colors.textMain }}
				onClick={() => setIsExpanded(!isExpanded)}
				onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = `${theme.colors.accent}10`)}
				onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
			>
				{isExpanded ? (
					<ChevronDown className="w-4 h-4" style={{ color: theme.colors.textDim }} />
				) : (
					<ChevronRight className="w-4 h-4" style={{ color: theme.colors.textDim }} />
				)}
				<Cpu className="w-4 h-4" style={{ color: theme.colors.accent }} />
				<span className="text-sm font-medium">GPU Resources</span>
				{headerSubtitle && (
					<span className="text-xs ml-auto" style={{ color: theme.colors.textDim }}>
						{headerSubtitle}
					</span>
				)}
			</button>

			{/* Expanded content */}
			{isExpanded && (
				<div className="px-4 pb-3">
					{isLoading ? (
						<div className="text-xs py-4 text-center" style={{ color: theme.colors.textDim }}>
							Detecting GPU resources...
						</div>
					) : error && !hasModels && !macmon ? (
						<div className="flex items-center gap-2 py-2">
							<AlertCircle className="w-3.5 h-3.5" style={{ color: theme.colors.warning }} />
							<span className="text-xs" style={{ color: theme.colors.textDim }}>
								{error}
							</span>
						</div>
					) : !hasModels && !macmon ? (
						<div className="text-xs py-4 text-center" style={{ color: theme.colors.textDim }}>
							{capabilities?.hasOllama
								? 'No models loaded · No hardware metrics available'
								: 'No GPU monitoring tools detected'}
						</div>
					) : (
						<div className="space-y-3">
							{/* === Donut Gauges Row === */}
							<GaugeRow models={ollamaModels} macmon={macmon} socInfo={socInfo} theme={theme} />

							{/* === Power & Temperature === */}
							{macmon && <PowerTemperatureRow macmon={macmon} theme={theme} />}

							{/* === CPU Clusters === */}
							{macmon && <CpuClustersRow macmon={macmon} theme={theme} />}

							{/* === Memory & Swap === */}
							{macmon && <MemoryRow macmon={macmon} theme={theme} />}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

// ============================================================================
// Sub-components
// ============================================================================

function GaugeRow({
	models,
	macmon,
	socInfo,
	theme,
}: {
	models: OllamaModelStatus[];
	macmon?: MacmonMetrics;
	socInfo: SocInfo | null;
	theme: Theme;
}) {
	const gpuUtil = macmon?.gpuUtilizationPercent;
	const hasModels = models.length > 0;
	const memoryTotalBytes =
		macmon?.memoryTotalBytes ?? (socInfo ? socInfo.memoryGB * 1024 * 1024 * 1024 : 0);

	// Calculate model segments as % of total unified memory
	const modelSegments = models.map((model, i) => ({
		label: model.name,
		value: memoryTotalBytes > 0 ? (model.sizeBytes / memoryTotalBytes) * 100 : 0,
		color: MODEL_COLORS[i % MODEL_COLORS.length],
	}));
	const totalModelPercent = modelSegments.reduce((sum, s) => sum + s.value, 0);

	return (
		<div className="flex items-start justify-center gap-6">
			{/* GPU Utilization gauge */}
			{gpuUtil != null && (
				<DonutGauge
					variant="single"
					value={Number(gpuUtil)}
					label="GPU Utilization"
					theme={theme}
					size={110}
					thickness={10}
				/>
			)}

			{/* Model Memory gauge */}
			{hasModels && memoryTotalBytes > 0 && (
				<div className="flex flex-col items-center gap-1">
					<DonutGauge
						variant="multi"
						segments={modelSegments}
						totalPercent={totalModelPercent}
						label="Models Memory Usage"
						theme={theme}
						size={110}
						thickness={10}
					/>
					{/* Model legend */}
					<div className="flex flex-col gap-0.5 mt-1">
						{models.map((model, i) => (
							<ModelLegendItem
								key={model.name}
								model={model}
								color={MODEL_COLORS[i % MODEL_COLORS.length]}
								theme={theme}
							/>
						))}
					</div>
				</div>
			)}

			{/* Show model list even without memory total (no gauge, just list) */}
			{hasModels && memoryTotalBytes === 0 && (
				<div className="flex flex-col gap-0.5">
					<span className="text-xs font-medium mb-1" style={{ color: theme.colors.textDim }}>
						Loaded Models
					</span>
					{models.map((model) => (
						<div key={model.name} className="flex items-center gap-2">
							<span className="text-xs font-mono" style={{ color: theme.colors.textMain }}>
								{model.name}
							</span>
							<span className="text-xs" style={{ color: theme.colors.textDim }}>
								{formatBytes(model.sizeBytes)}
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function PowerTemperatureRow({ macmon, theme }: { macmon: MacmonMetrics; theme: Theme }) {
	const hasPower = macmon.gpuPowerWatts != null || macmon.cpuPowerWatts != null;
	const hasTemp = macmon.gpuTemperatureCelsius != null || macmon.cpuTemperatureCelsius != null;

	if (!hasPower && !hasTemp) return null;

	return (
		<div className="pt-2 border-t" style={{ borderColor: theme.colors.border }}>
			<div className="flex items-start justify-between gap-4">
				{/* Power */}
				{hasPower && (
					<div className="flex-1">
						<span
							className="text-xs font-medium uppercase tracking-wide"
							style={{ color: theme.colors.textDim }}
						>
							Power
						</span>
						<div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
							{macmon.gpuPowerWatts != null && (
								<Pill label="GPU" value={formatWatts(macmon.gpuPowerWatts)} theme={theme} />
							)}
							{macmon.cpuPowerWatts != null && (
								<Pill label="CPU" value={formatWatts(macmon.cpuPowerWatts)} theme={theme} />
							)}
							{macmon.anePowerWatts != null && (
								<Pill label="ANE" value={formatWatts(macmon.anePowerWatts)} theme={theme} />
							)}
							{macmon.sysPowerWatts != null && (
								<Pill label="Sys" value={formatWatts(macmon.sysPowerWatts)} theme={theme} />
							)}
							{macmon.ramPowerWatts != null && (
								<Pill label="RAM" value={formatWatts(macmon.ramPowerWatts)} theme={theme} />
							)}
						</div>
					</div>
				)}

				{/* Temperatures */}
				{hasTemp && (
					<div>
						<span
							className="text-xs font-medium uppercase tracking-wide"
							style={{ color: theme.colors.textDim }}
						>
							Temp
						</span>
						<div className="flex gap-x-3 mt-0.5">
							{macmon.gpuTemperatureCelsius != null && (
								<Pill
									label="GPU"
									value={`${Number(macmon.gpuTemperatureCelsius).toFixed(0)}°C`}
									theme={theme}
									warn={Number(macmon.gpuTemperatureCelsius) > 85}
								/>
							)}
							{macmon.cpuTemperatureCelsius != null && (
								<Pill
									label="CPU"
									value={`${Number(macmon.cpuTemperatureCelsius).toFixed(0)}°C`}
									theme={theme}
									warn={Number(macmon.cpuTemperatureCelsius) > 90}
								/>
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

function CpuClustersRow({ macmon, theme }: { macmon: MacmonMetrics; theme: Theme }) {
	const hasEcpu = macmon.ecpuFrequencyMHz != null || macmon.ecpuUtilizationPercent != null;
	const hasPcpu = macmon.pcpuFrequencyMHz != null || macmon.pcpuUtilizationPercent != null;

	if (!hasEcpu && !hasPcpu) return null;

	return (
		<div className="pt-2 border-t" style={{ borderColor: theme.colors.border }}>
			<span
				className="text-xs font-medium uppercase tracking-wide"
				style={{ color: theme.colors.textDim }}
			>
				CPU Clusters
			</span>
			<div className="flex gap-x-6 mt-0.5">
				{hasEcpu && (
					<div className="flex items-center gap-1">
						<span className="text-xs" style={{ color: theme.colors.textDim }}>
							E-cores:
						</span>
						{macmon.ecpuFrequencyMHz != null && (
							<span className="text-xs font-mono" style={{ color: theme.colors.textMain }}>
								{Number(macmon.ecpuFrequencyMHz).toFixed(0)} MHz
							</span>
						)}
						{macmon.ecpuUtilizationPercent != null && (
							<span className="text-xs font-mono" style={{ color: theme.colors.textMain }}>
								· {Number(macmon.ecpuUtilizationPercent).toFixed(1)}%
							</span>
						)}
					</div>
				)}
				{hasPcpu && (
					<div className="flex items-center gap-1">
						<span className="text-xs" style={{ color: theme.colors.textDim }}>
							P-cores:
						</span>
						{macmon.pcpuFrequencyMHz != null && (
							<span className="text-xs font-mono" style={{ color: theme.colors.textMain }}>
								{Number(macmon.pcpuFrequencyMHz).toFixed(0)} MHz
							</span>
						)}
						{macmon.pcpuUtilizationPercent != null && (
							<span className="text-xs font-mono" style={{ color: theme.colors.textMain }}>
								· {Number(macmon.pcpuUtilizationPercent).toFixed(1)}%
							</span>
						)}
					</div>
				)}
			</div>
		</div>
	);
}

function MemoryRow({ macmon, theme }: { macmon: MacmonMetrics; theme: Theme }) {
	const hasMem = macmon.memoryUsedBytes != null && macmon.memoryTotalBytes != null;
	const hasSwap = macmon.swapTotalBytes != null && Number(macmon.swapTotalBytes) > 0;

	if (!hasMem && !hasSwap) return null;

	return (
		<div className="pt-2 border-t" style={{ borderColor: theme.colors.border }}>
			<div className="flex gap-x-6">
				{hasMem && (
					<div className="flex items-center gap-1">
						<span className="text-xs" style={{ color: theme.colors.textDim }}>
							Memory:
						</span>
						<span className="text-xs font-mono" style={{ color: theme.colors.textMain }}>
							{(Number(macmon.memoryUsedBytes) / 1024 ** 3).toFixed(1)} /{' '}
							{(Number(macmon.memoryTotalBytes) / 1024 ** 3).toFixed(0)} GB
						</span>
					</div>
				)}
				{hasSwap && (
					<div className="flex items-center gap-1">
						<span className="text-xs" style={{ color: theme.colors.textDim }}>
							Swap:
						</span>
						<span className="text-xs font-mono" style={{ color: theme.colors.textMain }}>
							{(Number(macmon.swapUsedBytes ?? 0) / 1024 ** 3).toFixed(1)} /{' '}
							{(Number(macmon.swapTotalBytes) / 1024 ** 3).toFixed(0)} GB
						</span>
					</div>
				)}
			</div>
		</div>
	);
}

function ModelLegendItem({
	model,
	color,
	theme,
}: {
	model: OllamaModelStatus;
	color: string;
	theme: Theme;
}) {
	const [showTooltip, setShowTooltip] = useState(false);

	const formatContext = (ctx: number): string => {
		if (ctx >= 1000) return `${(ctx / 1024).toFixed(0)}K`;
		return String(ctx);
	};

	return (
		<div
			className="relative flex items-center gap-1.5 cursor-default"
			onMouseEnter={() => setShowTooltip(true)}
			onMouseLeave={() => setShowTooltip(false)}
		>
			<div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
			<span
				className="text-xs font-mono truncate"
				style={{ color: theme.colors.textDim, maxWidth: '120px' }}
			>
				{model.name}
			</span>
			<span className="text-xs font-mono" style={{ color: theme.colors.textDim }}>
				{formatBytes(model.sizeBytes)}
			</span>
			{model.expiresAt && (
				<span className="text-xs" style={{ color: theme.colors.textDim, opacity: 0.6 }}>
					· unloads {formatExpiry(model.expiresAt)}
				</span>
			)}

			{/* Hover tooltip */}
			{showTooltip && (
				<div
					className="absolute left-0 bottom-full mb-1 z-50 rounded shadow-lg border text-xs whitespace-nowrap"
					style={{
						backgroundColor: theme.colors.bgSidebar,
						borderColor: theme.colors.border,
						color: theme.colors.textMain,
						padding: '8px 10px',
					}}
				>
					<div className="font-mono font-medium mb-1" style={{ color: theme.colors.accent }}>
						{model.name}
					</div>
					<div className="grid gap-x-3 gap-y-0.5" style={{ gridTemplateColumns: 'auto auto' }}>
						<span style={{ color: theme.colors.textDim }}>Family</span>
						<span className="font-mono">{model.family}</span>
						<span style={{ color: theme.colors.textDim }}>Parameters</span>
						<span className="font-mono">{model.parameterSize}</span>
						<span style={{ color: theme.colors.textDim }}>Quantization</span>
						<span className="font-mono">{model.quantization}</span>
						<span style={{ color: theme.colors.textDim }}>Format</span>
						<span className="font-mono">{model.format}</span>
						{model.contextLength != null && (
							<>
								<span style={{ color: theme.colors.textDim }}>Context</span>
								<span className="font-mono">{formatContext(model.contextLength)}</span>
							</>
						)}
						<span style={{ color: theme.colors.textDim }}>Memory</span>
						<span className="font-mono">
							{formatBytes(model.sizeBytes)}
							{model.gpuPercent > 0 && ` (${model.gpuPercent}% GPU)`}
						</span>
					</div>
				</div>
			)}
		</div>
	);
}

function Pill({
	label,
	value,
	theme,
	warn = false,
}: {
	label: string;
	value: string;
	theme: Theme;
	warn?: boolean;
}) {
	return (
		<span className="text-xs">
			<span style={{ color: theme.colors.textDim }}>{label} </span>
			<span
				className="font-mono"
				style={{ color: warn ? theme.colors.warning : theme.colors.textMain }}
			>
				{value}
			</span>
		</span>
	);
}
