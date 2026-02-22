/**
 * HoneycombSettingsSection
 *
 * Self-contained settings section for Honeycomb usage warning thresholds,
 * capacity check settings, and archive controls.
 *
 * Rendered inside the SettingsModal when the Honeycomb tab is active.
 *
 * @see Investigation plan Sections 18.3, 18.5, 23.2.2
 */

import { useState, useCallback } from 'react';
import { Activity, Database, Shield, AlertTriangle, Wifi, Globe } from 'lucide-react';
import type { Theme } from '../types';
import type { HoneycombWarningSettings } from '../../main/stores/types';

export interface HoneycombSettingsSectionProps {
	theme: Theme;
	settings: HoneycombWarningSettings;
	onUpdate: (partial: Partial<HoneycombWarningSettings>) => void;
	hasCalibrationData: boolean;
	archiveSizeBytes?: number;
	onArchiveNow?: () => void;
	// Data source settings
	dataSource: 'mcp' | 'api';
	onDataSourceChange: (mode: 'mcp' | 'api') => void;
	mcpApiKey: string;
	onMcpApiKeyChange: (key: string) => void;
	environmentSlug: string;
	onEnvironmentSlugChange: (slug: string) => void;
	mcpRegion: 'us' | 'eu';
	onMcpRegionChange: (region: 'us' | 'eu') => void;
	apiKey: string;
	onApiKeyChange: (key: string) => void;
	datasetSlug: string;
	onDatasetSlugChange: (slug: string) => void;
}

const POLL_INTERVALS = [
	{ label: '1 min', value: 60000 },
	{ label: '2 min', value: 120000 },
	{ label: '5 min', value: 300000 },
	{ label: '10 min', value: 600000 },
	{ label: '15 min', value: 900000 },
	{ label: '30 min', value: 1800000 },
];

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function HoneycombSettingsSection({
	theme,
	settings,
	onUpdate,
	hasCalibrationData,
	archiveSizeBytes,
	onArchiveNow,
	dataSource,
	onDataSourceChange,
	mcpApiKey,
	onMcpApiKeyChange,
	environmentSlug,
	onEnvironmentSlugChange,
	mcpRegion,
	onMcpRegionChange,
	apiKey,
	onApiKeyChange,
	datasetSlug,
	onDatasetSlugChange,
}: HoneycombSettingsSectionProps) {
	const [isArchiving, setIsArchiving] = useState(false);
	const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
	const [isTesting, setIsTesting] = useState(false);

	const handleArchiveNow = useCallback(async () => {
		if (!onArchiveNow || isArchiving) return;
		setIsArchiving(true);
		try {
			onArchiveNow();
		} finally {
			// Reset after a delay to allow the archive to complete
			setTimeout(() => setIsArchiving(false), 5000);
		}
	}, [onArchiveNow, isArchiving]);

	const handleTestConnection = useCallback(async () => {
		if (isTesting) return;
		setIsTesting(true);
		setTestResult(null);
		try {
			// Auto-discover environment slug if empty
			if (!environmentSlug && dataSource === 'mcp') {
				const discovered = await window.maestro.honeycomb.autoDiscoverEnv();
				if (discovered) {
					onEnvironmentSlugChange(discovered);
				}
			}

			const envSlug = environmentSlug || 'claudepalmeragent';
			const result = await window.maestro.honeycomb.testConnection(
				envSlug,
				datasetSlug || 'claude-code'
			);
			setTestResult(result);
		} catch (err) {
			setTestResult({ success: false, error: String(err) });
		} finally {
			setIsTesting(false);
		}
	}, [isTesting, environmentSlug, dataSource, datasetSlug, onEnvironmentSlugChange]);

	const disabledStyle = {
		opacity: settings.honeycombWarningsEnabled ? 1 : 0.4,
		pointerEvents: (settings.honeycombWarningsEnabled
			? 'auto'
			: 'none') as React.CSSProperties['pointerEvents'],
	};

	return (
		<div className="space-y-5">
			{/* ── Data Source Selection ── */}
			<div className="space-y-3">
				<div
					className="font-medium flex items-center gap-2"
					style={{ color: theme.colors.textMain }}
				>
					<Globe className="w-4 h-4" />
					Honeycomb Data Source
				</div>
				<div className="flex items-center gap-3">
					<label className="text-xs font-medium" style={{ color: theme.colors.textMain }}>
						Mode
					</label>
					<select
						value={dataSource}
						onChange={(e) => onDataSourceChange(e.target.value as 'mcp' | 'api')}
						className="text-xs px-2 py-1 rounded border"
						style={{
							backgroundColor: theme.colors.bgMain,
							borderColor: theme.colors.border,
							color: theme.colors.textMain,
						}}
					>
						<option value="mcp">MCP (Free Tier)</option>
						<option value="api">REST API (Enterprise)</option>
					</select>
				</div>

				{/* MCP Settings */}
				{dataSource === 'mcp' && (
					<div className="space-y-2 pl-2 border-l-2" style={{ borderColor: theme.colors.accent }}>
						<div>
							<label
								className="text-xs font-medium block mb-1"
								style={{ color: theme.colors.textMain }}
							>
								Management API Key
							</label>
							<input
								type="password"
								value={mcpApiKey}
								onChange={(e) => onMcpApiKeyChange(e.target.value)}
								placeholder="KEY_ID:SECRET_KEY"
								className="w-full text-xs px-2 py-1 rounded border font-mono"
								style={{
									backgroundColor: theme.colors.bgMain,
									borderColor: theme.colors.border,
									color: theme.colors.textMain,
								}}
							/>
							<div className="text-xs mt-0.5" style={{ color: theme.colors.textDim }}>
								Format: KEY_ID:SECRET_KEY — Scopes: MCP (read) + Environments (read)
							</div>
						</div>
						<div>
							<label
								className="text-xs font-medium block mb-1"
								style={{ color: theme.colors.textMain }}
							>
								Environment Slug
							</label>
							<input
								type="text"
								value={environmentSlug}
								onChange={(e) => onEnvironmentSlugChange(e.target.value)}
								placeholder="Auto-discovered on Test Connection"
								className="w-full text-xs px-2 py-1 rounded border font-mono"
								style={{
									backgroundColor: theme.colors.bgMain,
									borderColor: theme.colors.border,
									color: theme.colors.textMain,
								}}
							/>
						</div>
						<div className="flex items-center gap-3">
							<label className="text-xs font-medium" style={{ color: theme.colors.textMain }}>
								Region
							</label>
							<select
								value={mcpRegion}
								onChange={(e) => onMcpRegionChange(e.target.value as 'us' | 'eu')}
								className="text-xs px-2 py-1 rounded border"
								style={{
									backgroundColor: theme.colors.bgMain,
									borderColor: theme.colors.border,
									color: theme.colors.textMain,
								}}
							>
								<option value="us">US</option>
								<option value="eu">EU</option>
							</select>
						</div>
					</div>
				)}

				{/* REST API Settings */}
				{dataSource === 'api' && (
					<div className="space-y-2 pl-2 border-l-2" style={{ borderColor: theme.colors.accent }}>
						<div>
							<label
								className="text-xs font-medium block mb-1"
								style={{ color: theme.colors.textMain }}
							>
								Team API Key
							</label>
							<input
								type="password"
								value={apiKey}
								onChange={(e) => onApiKeyChange(e.target.value)}
								placeholder="Enterprise Team API Key"
								className="w-full text-xs px-2 py-1 rounded border font-mono"
								style={{
									backgroundColor: theme.colors.bgMain,
									borderColor: theme.colors.border,
									color: theme.colors.textMain,
								}}
							/>
						</div>
					</div>
				)}

				{/* Common Settings */}
				<div className="space-y-2">
					<div>
						<label
							className="text-xs font-medium block mb-1"
							style={{ color: theme.colors.textMain }}
						>
							Dataset Slug
						</label>
						<input
							type="text"
							value={datasetSlug}
							onChange={(e) => onDatasetSlugChange(e.target.value)}
							placeholder="claude-code"
							className="w-full text-xs px-2 py-1 rounded border font-mono"
							style={{
								backgroundColor: theme.colors.bgMain,
								borderColor: theme.colors.border,
								color: theme.colors.textMain,
							}}
						/>
					</div>
				</div>

				{/* Test Connection Button */}
				<div className="flex items-center gap-3">
					<button
						onClick={handleTestConnection}
						disabled={isTesting || (dataSource === 'mcp' ? !mcpApiKey : !apiKey)}
						className="px-3 py-1 text-xs rounded border transition-colors hover:opacity-90 flex items-center gap-1.5"
						style={{
							backgroundColor: 'transparent',
							borderColor: theme.colors.border,
							color: theme.colors.textMain,
							opacity: isTesting ? 0.5 : 1,
						}}
					>
						<Wifi className="w-3 h-3" />
						{isTesting ? 'Testing...' : 'Test Connection'}
					</button>
					{testResult && (
						<span
							className="text-xs flex items-center gap-1"
							style={{ color: testResult.success ? '#22c55e' : '#ef4444' }}
						>
							{testResult.success ? '✓ Connected' : `✗ ${testResult.error || 'Failed'}`}
						</span>
					)}
				</div>
			</div>

			{/* ── Master Toggle ── */}
			<div
				className="flex items-center justify-between cursor-pointer"
				onClick={() => onUpdate({ honeycombWarningsEnabled: !settings.honeycombWarningsEnabled })}
				role="button"
				tabIndex={0}
				onKeyDown={(e) =>
					e.key === 'Enter' &&
					onUpdate({ honeycombWarningsEnabled: !settings.honeycombWarningsEnabled })
				}
			>
				<div className="flex-1 pr-3">
					<div
						className="font-medium flex items-center gap-2"
						style={{ color: theme.colors.textMain }}
					>
						<Activity className="w-4 h-4" />
						Usage Limit Warnings (Honeycomb)
					</div>
					<div className="text-xs opacity-50 mt-0.5">
						Monitor Honeycomb usage data and warn when approaching plan limits
					</div>
				</div>
				<button
					className="relative w-10 h-5 rounded-full transition-colors flex-shrink-0"
					style={{
						backgroundColor: settings.honeycombWarningsEnabled
							? theme.colors.accent
							: theme.colors.bgActivity,
					}}
					role="switch"
					aria-checked={settings.honeycombWarningsEnabled}
				>
					<div
						className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform"
						style={{
							transform: settings.honeycombWarningsEnabled ? 'translateX(22px)' : 'translateX(2px)',
						}}
					/>
				</button>
			</div>

			{/* ── Warning Mode ── */}
			<div style={disabledStyle}>
				<div className="flex items-center gap-2 mb-2">
					<label className="text-xs font-medium" style={{ color: theme.colors.textMain }}>
						Warning Mode
					</label>
				</div>
				<div className="flex gap-2">
					{(['usd', 'percentage', 'both'] as const).map((mode) => (
						<button
							key={mode}
							onClick={() => onUpdate({ warningMode: mode })}
							className="px-3 py-1 text-xs rounded-md border transition-colors"
							style={{
								backgroundColor:
									settings.warningMode === mode ? theme.colors.accent : 'transparent',
								color:
									settings.warningMode === mode
										? theme.colors.accentForeground
										: theme.colors.textDim,
								borderColor:
									settings.warningMode === mode ? theme.colors.accent : theme.colors.border,
							}}
						>
							{mode === 'usd' ? 'USD Only' : mode === 'percentage' ? '% Only' : 'Both'}
						</button>
					))}
				</div>
				{settings.warningMode !== 'usd' && !hasCalibrationData && (
					<div className="text-xs mt-1" style={{ color: theme.colors.warning }}>
						Percentage warnings require calibration data. Only USD thresholds active until
						calibrated.
					</div>
				)}
			</div>

			{/* ── 5-Hour Window USD Thresholds ── */}
			{settings.warningMode !== 'percentage' && (
				<div
					className="space-y-3 pt-3 border-t"
					style={{ borderColor: theme.colors.border, ...disabledStyle }}
				>
					<div className="text-xs font-semibold" style={{ color: theme.colors.textMain }}>
						5-Hour Window (USD)
					</div>

					{/* Yellow slider */}
					<div>
						<div className="flex items-center justify-between mb-1">
							<label className="text-xs font-medium flex items-center gap-2">
								<div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#eab308' }} />
								Warning
							</label>
							<span
								className="text-xs font-mono px-2 py-0.5 rounded"
								style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textMain }}
							>
								${settings.fiveHourWarningYellowUsd}
							</span>
						</div>
						<input
							type="range"
							min={10}
							max={80}
							step={5}
							value={settings.fiveHourWarningYellowUsd}
							onChange={(e) => {
								const newYellow = Number(e.target.value);
								if (newYellow >= settings.fiveHourWarningRedUsd) {
									onUpdate({
										fiveHourWarningYellowUsd: newYellow,
										fiveHourWarningRedUsd: Math.min(100, newYellow + 10),
									});
								} else {
									onUpdate({ fiveHourWarningYellowUsd: newYellow });
								}
							}}
							className="w-full h-2 rounded-lg appearance-none cursor-pointer"
							style={{
								background: `linear-gradient(to right, #eab308 0%, #eab308 ${
									((settings.fiveHourWarningYellowUsd - 10) / 70) * 100
								}%, ${theme.colors.bgActivity} ${
									((settings.fiveHourWarningYellowUsd - 10) / 70) * 100
								}%, ${theme.colors.bgActivity} 100%)`,
							}}
						/>
					</div>

					{/* Red slider */}
					<div>
						<div className="flex items-center justify-between mb-1">
							<label className="text-xs font-medium flex items-center gap-2">
								<div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#ef4444' }} />
								Critical
							</label>
							<span
								className="text-xs font-mono px-2 py-0.5 rounded"
								style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textMain }}
							>
								${settings.fiveHourWarningRedUsd}
							</span>
						</div>
						<input
							type="range"
							min={20}
							max={100}
							step={5}
							value={settings.fiveHourWarningRedUsd}
							onChange={(e) => {
								const newRed = Number(e.target.value);
								if (newRed <= settings.fiveHourWarningYellowUsd) {
									onUpdate({
										fiveHourWarningRedUsd: newRed,
										fiveHourWarningYellowUsd: Math.max(10, newRed - 10),
									});
								} else {
									onUpdate({ fiveHourWarningRedUsd: newRed });
								}
							}}
							className="w-full h-2 rounded-lg appearance-none cursor-pointer"
							style={{
								background: `linear-gradient(to right, #ef4444 0%, #ef4444 ${
									((settings.fiveHourWarningRedUsd - 20) / 80) * 100
								}%, ${theme.colors.bgActivity} ${
									((settings.fiveHourWarningRedUsd - 20) / 80) * 100
								}%, ${theme.colors.bgActivity} 100%)`,
							}}
						/>
					</div>
				</div>
			)}

			{/* ── 5-Hour Window Percentage Thresholds ── */}
			{settings.warningMode !== 'usd' && (
				<div
					className="space-y-3 pt-3 border-t"
					style={{ borderColor: theme.colors.border, ...disabledStyle }}
				>
					<div className="text-xs font-semibold" style={{ color: theme.colors.textMain }}>
						5-Hour Window (% of Budget)
						{!hasCalibrationData && (
							<span className="text-xs font-normal ml-2" style={{ color: theme.colors.warning }}>
								Requires calibration
							</span>
						)}
					</div>

					{/* Yellow slider */}
					<div>
						<div className="flex items-center justify-between mb-1">
							<label className="text-xs font-medium flex items-center gap-2">
								<div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#eab308' }} />
								Warning
							</label>
							<span
								className="text-xs font-mono px-2 py-0.5 rounded"
								style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textMain }}
							>
								{settings.fiveHourWarningYellowPct}%
							</span>
						</div>
						<input
							type="range"
							min={30}
							max={90}
							step={5}
							value={settings.fiveHourWarningYellowPct}
							onChange={(e) => {
								const newYellow = Number(e.target.value);
								if (newYellow >= settings.fiveHourWarningRedPct) {
									onUpdate({
										fiveHourWarningYellowPct: newYellow,
										fiveHourWarningRedPct: Math.min(100, newYellow + 5),
									});
								} else {
									onUpdate({ fiveHourWarningYellowPct: newYellow });
								}
							}}
							className="w-full h-2 rounded-lg appearance-none cursor-pointer"
							style={{
								background: `linear-gradient(to right, #eab308 0%, #eab308 ${
									((settings.fiveHourWarningYellowPct - 30) / 60) * 100
								}%, ${theme.colors.bgActivity} ${
									((settings.fiveHourWarningYellowPct - 30) / 60) * 100
								}%, ${theme.colors.bgActivity} 100%)`,
							}}
						/>
					</div>

					{/* Red slider */}
					<div>
						<div className="flex items-center justify-between mb-1">
							<label className="text-xs font-medium flex items-center gap-2">
								<div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#ef4444' }} />
								Critical
							</label>
							<span
								className="text-xs font-mono px-2 py-0.5 rounded"
								style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textMain }}
							>
								{settings.fiveHourWarningRedPct}%
							</span>
						</div>
						<input
							type="range"
							min={50}
							max={100}
							step={5}
							value={settings.fiveHourWarningRedPct}
							onChange={(e) => {
								const newRed = Number(e.target.value);
								if (newRed <= settings.fiveHourWarningYellowPct) {
									onUpdate({
										fiveHourWarningRedPct: newRed,
										fiveHourWarningYellowPct: Math.max(30, newRed - 5),
									});
								} else {
									onUpdate({ fiveHourWarningRedPct: newRed });
								}
							}}
							className="w-full h-2 rounded-lg appearance-none cursor-pointer"
							style={{
								background: `linear-gradient(to right, #ef4444 0%, #ef4444 ${
									((settings.fiveHourWarningRedPct - 50) / 50) * 100
								}%, ${theme.colors.bgActivity} ${
									((settings.fiveHourWarningRedPct - 50) / 50) * 100
								}%, ${theme.colors.bgActivity} 100%)`,
							}}
						/>
					</div>
				</div>
			)}

			{/* ── Weekly USD Thresholds ── */}
			{settings.warningMode !== 'percentage' && (
				<div
					className="space-y-3 pt-3 border-t"
					style={{ borderColor: theme.colors.border, ...disabledStyle }}
				>
					<div className="text-xs font-semibold" style={{ color: theme.colors.textMain }}>
						Weekly Spend (USD)
					</div>

					{/* Yellow slider */}
					<div>
						<div className="flex items-center justify-between mb-1">
							<label className="text-xs font-medium flex items-center gap-2">
								<div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#eab308' }} />
								Warning
							</label>
							<span
								className="text-xs font-mono px-2 py-0.5 rounded"
								style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textMain }}
							>
								${settings.weeklyWarningYellowUsd}
							</span>
						</div>
						<input
							type="range"
							min={100}
							max={800}
							step={25}
							value={settings.weeklyWarningYellowUsd}
							onChange={(e) => {
								const newYellow = Number(e.target.value);
								if (newYellow >= settings.weeklyWarningRedUsd) {
									onUpdate({
										weeklyWarningYellowUsd: newYellow,
										weeklyWarningRedUsd: Math.min(1000, newYellow + 50),
									});
								} else {
									onUpdate({ weeklyWarningYellowUsd: newYellow });
								}
							}}
							className="w-full h-2 rounded-lg appearance-none cursor-pointer"
							style={{
								background: `linear-gradient(to right, #eab308 0%, #eab308 ${
									((settings.weeklyWarningYellowUsd - 100) / 700) * 100
								}%, ${theme.colors.bgActivity} ${
									((settings.weeklyWarningYellowUsd - 100) / 700) * 100
								}%, ${theme.colors.bgActivity} 100%)`,
							}}
						/>
					</div>

					{/* Red slider */}
					<div>
						<div className="flex items-center justify-between mb-1">
							<label className="text-xs font-medium flex items-center gap-2">
								<div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#ef4444' }} />
								Critical
							</label>
							<span
								className="text-xs font-mono px-2 py-0.5 rounded"
								style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textMain }}
							>
								${settings.weeklyWarningRedUsd}
							</span>
						</div>
						<input
							type="range"
							min={200}
							max={1000}
							step={25}
							value={settings.weeklyWarningRedUsd}
							onChange={(e) => {
								const newRed = Number(e.target.value);
								if (newRed <= settings.weeklyWarningYellowUsd) {
									onUpdate({
										weeklyWarningRedUsd: newRed,
										weeklyWarningYellowUsd: Math.max(100, newRed - 50),
									});
								} else {
									onUpdate({ weeklyWarningRedUsd: newRed });
								}
							}}
							className="w-full h-2 rounded-lg appearance-none cursor-pointer"
							style={{
								background: `linear-gradient(to right, #ef4444 0%, #ef4444 ${
									((settings.weeklyWarningRedUsd - 200) / 800) * 100
								}%, ${theme.colors.bgActivity} ${
									((settings.weeklyWarningRedUsd - 200) / 800) * 100
								}%, ${theme.colors.bgActivity} 100%)`,
							}}
						/>
					</div>
				</div>
			)}

			{/* ── Weekly Percentage Thresholds ── */}
			{settings.warningMode !== 'usd' && (
				<div
					className="space-y-3 pt-3 border-t"
					style={{ borderColor: theme.colors.border, ...disabledStyle }}
				>
					<div className="text-xs font-semibold" style={{ color: theme.colors.textMain }}>
						Weekly (% of Budget)
						{!hasCalibrationData && (
							<span className="text-xs font-normal ml-2" style={{ color: theme.colors.warning }}>
								Requires calibration
							</span>
						)}
					</div>

					{/* Yellow slider */}
					<div>
						<div className="flex items-center justify-between mb-1">
							<label className="text-xs font-medium flex items-center gap-2">
								<div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#eab308' }} />
								Warning
							</label>
							<span
								className="text-xs font-mono px-2 py-0.5 rounded"
								style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textMain }}
							>
								{settings.weeklyWarningYellowPct}%
							</span>
						</div>
						<input
							type="range"
							min={30}
							max={90}
							step={5}
							value={settings.weeklyWarningYellowPct}
							onChange={(e) => {
								const newYellow = Number(e.target.value);
								if (newYellow >= settings.weeklyWarningRedPct) {
									onUpdate({
										weeklyWarningYellowPct: newYellow,
										weeklyWarningRedPct: Math.min(100, newYellow + 5),
									});
								} else {
									onUpdate({ weeklyWarningYellowPct: newYellow });
								}
							}}
							className="w-full h-2 rounded-lg appearance-none cursor-pointer"
							style={{
								background: `linear-gradient(to right, #eab308 0%, #eab308 ${
									((settings.weeklyWarningYellowPct - 30) / 60) * 100
								}%, ${theme.colors.bgActivity} ${
									((settings.weeklyWarningYellowPct - 30) / 60) * 100
								}%, ${theme.colors.bgActivity} 100%)`,
							}}
						/>
					</div>

					{/* Red slider */}
					<div>
						<div className="flex items-center justify-between mb-1">
							<label className="text-xs font-medium flex items-center gap-2">
								<div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#ef4444' }} />
								Critical
							</label>
							<span
								className="text-xs font-mono px-2 py-0.5 rounded"
								style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textMain }}
							>
								{settings.weeklyWarningRedPct}%
							</span>
						</div>
						<input
							type="range"
							min={50}
							max={100}
							step={5}
							value={settings.weeklyWarningRedPct}
							onChange={(e) => {
								const newRed = Number(e.target.value);
								if (newRed <= settings.weeklyWarningYellowPct) {
									onUpdate({
										weeklyWarningRedPct: newRed,
										weeklyWarningYellowPct: Math.max(30, newRed - 5),
									});
								} else {
									onUpdate({ weeklyWarningRedPct: newRed });
								}
							}}
							className="w-full h-2 rounded-lg appearance-none cursor-pointer"
							style={{
								background: `linear-gradient(to right, #ef4444 0%, #ef4444 ${
									((settings.weeklyWarningRedPct - 50) / 50) * 100
								}%, ${theme.colors.bgActivity} ${
									((settings.weeklyWarningRedPct - 50) / 50) * 100
								}%, ${theme.colors.bgActivity} 100%)`,
							}}
						/>
					</div>
				</div>
			)}

			{/* ── Monthly Sessions ── */}
			<div
				className="space-y-3 pt-3 border-t"
				style={{ borderColor: theme.colors.border, ...disabledStyle }}
			>
				<div>
					<div className="flex items-center justify-between mb-1">
						<label className="text-xs font-medium flex items-center gap-2">
							<div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#eab308' }} />
							Monthly Sessions Warning
						</label>
						<span
							className="text-xs font-mono px-2 py-0.5 rounded"
							style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textMain }}
						>
							{settings.monthlySessionsWarning}
						</span>
					</div>
					<input
						type="range"
						min={10}
						max={80}
						step={5}
						value={settings.monthlySessionsWarning}
						onChange={(e) => onUpdate({ monthlySessionsWarning: Number(e.target.value) })}
						className="w-full h-2 rounded-lg appearance-none cursor-pointer"
						style={{
							background: `linear-gradient(to right, #eab308 0%, #eab308 ${
								((settings.monthlySessionsWarning - 10) / 70) * 100
							}%, ${theme.colors.bgActivity} ${
								((settings.monthlySessionsWarning - 10) / 70) * 100
							}%, ${theme.colors.bgActivity} 100%)`,
						}}
					/>
				</div>
			</div>

			{/* ── Safety Buffer & Capacity Checks ── */}
			<div
				className="space-y-3 pt-3 border-t"
				style={{ borderColor: theme.colors.border, ...disabledStyle }}
			>
				<div
					className="text-xs font-semibold flex items-center gap-2"
					style={{ color: theme.colors.textMain }}
				>
					<Shield className="w-3 h-3" />
					Capacity Check Settings
				</div>

				<div>
					<div className="flex items-center justify-between mb-1">
						<label className="text-xs font-medium">
							Safety Buffer (reserve headroom before warning)
						</label>
						<span
							className="text-xs font-mono px-2 py-0.5 rounded"
							style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textMain }}
						>
							{settings.safetyBufferPct}%
						</span>
					</div>
					<input
						type="range"
						min={5}
						max={40}
						step={5}
						value={settings.safetyBufferPct}
						onChange={(e) => onUpdate({ safetyBufferPct: Number(e.target.value) })}
						className="w-full h-2 rounded-lg appearance-none cursor-pointer"
						style={{
							background: `linear-gradient(to right, ${theme.colors.accent} 0%, ${theme.colors.accent} ${
								((settings.safetyBufferPct - 5) / 35) * 100
							}%, ${theme.colors.bgActivity} ${
								((settings.safetyBufferPct - 5) / 35) * 100
							}%, ${theme.colors.bgActivity} 100%)`,
						}}
					/>
					<div className="text-xs mt-1" style={{ color: theme.colors.textDim }}>
						Warn me when within {settings.safetyBufferPct}% of plan limits
					</div>
				</div>

				<div className="flex items-center gap-4 mt-2">
					<label
						className="flex items-center gap-2 text-xs cursor-pointer"
						style={{ color: theme.colors.textMain }}
					>
						<input
							type="checkbox"
							checked={settings.capacityCheckAutoRun}
							onChange={(e) => onUpdate({ capacityCheckAutoRun: e.target.checked })}
							className="rounded"
						/>
						Pre-run checks: Auto Run
					</label>
					<label
						className="flex items-center gap-2 text-xs cursor-pointer"
						style={{ color: theme.colors.textMain }}
					>
						<input
							type="checkbox"
							checked={settings.capacityCheckInteractive}
							onChange={(e) => onUpdate({ capacityCheckInteractive: e.target.checked })}
							className="rounded"
						/>
						Interactive
					</label>
				</div>
			</div>

			{/* ── Poll Interval ── */}
			<div
				className="space-y-2 pt-3 border-t"
				style={{ borderColor: theme.colors.border, ...disabledStyle }}
			>
				<div className="flex items-center justify-between">
					<label className="text-xs font-medium" style={{ color: theme.colors.textMain }}>
						Poll Interval
					</label>
					<select
						value={settings.honeycombPollIntervalMs}
						onChange={(e) => onUpdate({ honeycombPollIntervalMs: Number(e.target.value) })}
						className="text-xs px-2 py-1 rounded border"
						style={{
							backgroundColor: theme.colors.bgMain,
							borderColor: theme.colors.border,
							color: theme.colors.textMain,
						}}
					>
						{POLL_INTERVALS.map((interval) => (
							<option key={interval.value} value={interval.value}>
								{interval.label}
							</option>
						))}
					</select>
				</div>
			</div>

			{/* ── Archive Settings ── */}
			<div className="space-y-2 pt-3 border-t" style={{ borderColor: theme.colors.border }}>
				<div
					className="text-xs font-semibold flex items-center gap-2"
					style={{ color: theme.colors.textMain }}
				>
					<Database className="w-3 h-3" />
					Archive Settings
				</div>

				<div className="flex items-center justify-between">
					<div className="flex items-center gap-3">
						<label
							className="flex items-center gap-2 text-xs cursor-pointer"
							style={{ color: theme.colors.textMain }}
						>
							<input
								type="checkbox"
								checked={settings.archiveEnabled}
								onChange={(e) => onUpdate({ archiveEnabled: e.target.checked })}
								className="rounded"
							/>
							Enable daily archival
						</label>
						{archiveSizeBytes !== undefined && (
							<span className="text-xs" style={{ color: theme.colors.textDim }}>
								Storage: {formatBytes(archiveSizeBytes)}
							</span>
						)}
						{archiveSizeBytes !== undefined && archiveSizeBytes > 200 * 1024 * 1024 && (
							<span
								className="text-xs flex items-center gap-1"
								style={{ color: theme.colors.warning }}
							>
								<AlertTriangle className="w-3 h-3" />
								Large archive
							</span>
						)}
					</div>
					{onArchiveNow && (
						<button
							onClick={handleArchiveNow}
							disabled={isArchiving}
							className="px-3 py-1 text-xs rounded border transition-colors hover:opacity-90"
							style={{
								backgroundColor: 'transparent',
								borderColor: theme.colors.border,
								color: theme.colors.textMain,
								opacity: isArchiving ? 0.5 : 1,
							}}
						>
							{isArchiving ? 'Archiving...' : 'Archive Now'}
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
