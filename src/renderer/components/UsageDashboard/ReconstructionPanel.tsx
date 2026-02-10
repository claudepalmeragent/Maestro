/**
 * ReconstructionPanel - Historical Data Reconstruction UI
 *
 * Allows users to scan Claude Code's JSONL files and reconstruct
 * missing/incomplete usage data with proper dual-source cost values.
 *
 * Features:
 * - Local agent data reconstruction
 * - SSH remote agent data reconstruction
 * - Date range filtering
 * - Preview (dry run) mode
 * - Result statistics display
 */

import React, { useState } from 'react';
import type { Theme } from '../../types';

interface SshConfig {
	host: string;
	user: string;
	identityFile?: string;
}

interface ReconstructionResult {
	queriesFound: number;
	queriesInserted: number;
	queriesUpdated: number;
	queriesSkipped: number;
	dateRangeCovered: { start: string; end: string } | null;
	errors: Array<{ file: string; error: string }>;
	duration: number;
}

interface ReconstructionPanelProps {
	theme: Theme;
}

export function ReconstructionPanel({ theme }: ReconstructionPanelProps): React.ReactElement {
	const [options, setOptions] = useState({
		includeLocalAgents: true,
		includeSshRemotes: false,
		sshConfigs: [] as SshConfig[],
		dateRange: {
			start: '',
			end: '',
		},
	});
	const [running, setRunning] = useState(false);
	const [result, setResult] = useState<ReconstructionResult | null>(null);
	const [previewMode, setPreviewMode] = useState(true);

	async function handleReconstruct(): Promise<void> {
		setRunning(true);
		setResult(null);

		try {
			const reconstructResult = previewMode
				? await window.maestro.reconstruction.preview(options)
				: await window.maestro.reconstruction.start(options);

			setResult(reconstructResult);
		} catch (error) {
			console.error('Reconstruction failed:', error);
		} finally {
			setRunning(false);
		}
	}

	function addSshConfig(): void {
		setOptions({
			...options,
			sshConfigs: [...options.sshConfigs, { host: '', user: '' }],
		});
	}

	function updateSshConfig(index: number, config: Partial<SshConfig>): void {
		const newConfigs = [...options.sshConfigs];
		newConfigs[index] = { ...newConfigs[index], ...config };
		setOptions({ ...options, sshConfigs: newConfigs });
	}

	function removeSshConfig(index: number): void {
		setOptions({
			...options,
			sshConfigs: options.sshConfigs.filter((_, i) => i !== index),
		});
	}

	function formatDuration(ms: number): string {
		if (ms < 1000) return `${ms}ms`;
		if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
		return `${(ms / 60000).toFixed(1)}m`;
	}

	return (
		<div
			className="rounded-lg border p-6 space-y-6"
			style={{
				backgroundColor: theme.colors.bgActivity,
				borderColor: theme.colors.border,
			}}
		>
			<div>
				<h3 className="text-lg font-semibold" style={{ color: theme.colors.textMain }}>
					Historical Data Reconstruction
				</h3>
				<p className="text-sm mt-1" style={{ color: theme.colors.textDim }}>
					Scan Claude Code's JSONL files to reconstruct missing usage data and recalculate costs
					with proper billing mode.
				</p>
			</div>

			{/* Options */}
			<div className="space-y-4">
				<h4 className="font-medium" style={{ color: theme.colors.textMain }}>
					Data Sources
				</h4>

				<label className="flex items-center gap-2 cursor-pointer">
					<input
						type="checkbox"
						checked={options.includeLocalAgents}
						onChange={(e) => setOptions({ ...options, includeLocalAgents: e.target.checked })}
						className="w-4 h-4 rounded"
						style={{ accentColor: theme.colors.accent }}
					/>
					<span style={{ color: theme.colors.textMain }}>Local agents (~/.claude/projects/)</span>
				</label>

				<label className="flex items-center gap-2 cursor-pointer">
					<input
						type="checkbox"
						checked={options.includeSshRemotes}
						onChange={(e) => setOptions({ ...options, includeSshRemotes: e.target.checked })}
						className="w-4 h-4 rounded"
						style={{ accentColor: theme.colors.accent }}
					/>
					<span style={{ color: theme.colors.textMain }}>SSH remote agents</span>
				</label>

				{options.includeSshRemotes && (
					<div className="ml-6 space-y-2">
						{options.sshConfigs.map((config, i) => (
							<div key={i} className="flex items-center gap-2">
								<input
									type="text"
									placeholder="user"
									value={config.user}
									onChange={(e) => updateSshConfig(i, { user: e.target.value })}
									className="border rounded px-2 py-1 w-24"
									style={{
										backgroundColor: theme.colors.bgMain,
										borderColor: theme.colors.border,
										color: theme.colors.textMain,
									}}
								/>
								<span style={{ color: theme.colors.textDim }}>@</span>
								<input
									type="text"
									placeholder="hostname"
									value={config.host}
									onChange={(e) => updateSshConfig(i, { host: e.target.value })}
									className="border rounded px-2 py-1 flex-1"
									style={{
										backgroundColor: theme.colors.bgMain,
										borderColor: theme.colors.border,
										color: theme.colors.textMain,
									}}
								/>
								<button
									onClick={() => removeSshConfig(i)}
									className="px-2 py-1 text-sm rounded transition-colors"
									style={{ color: '#ef4444' }}
									onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#fef2f2')}
									onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
								>
									Remove
								</button>
							</div>
						))}
						<button
							onClick={addSshConfig}
							className="text-sm transition-colors"
							style={{ color: theme.colors.accent }}
							onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.8')}
							onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
						>
							+ Add SSH Remote
						</button>
					</div>
				)}
			</div>

			<div className="space-y-4">
				<h4 className="font-medium" style={{ color: theme.colors.textMain }}>
					Date Range (Optional)
				</h4>
				<div className="flex items-center gap-4">
					<label className="flex flex-col gap-1">
						<span className="text-sm" style={{ color: theme.colors.textDim }}>
							Start Date
						</span>
						<input
							type="date"
							value={options.dateRange.start}
							onChange={(e) =>
								setOptions({
									...options,
									dateRange: { ...options.dateRange, start: e.target.value },
								})
							}
							className="border rounded px-2 py-1"
							style={{
								backgroundColor: theme.colors.bgMain,
								borderColor: theme.colors.border,
								color: theme.colors.textMain,
							}}
						/>
					</label>
					<label className="flex flex-col gap-1">
						<span className="text-sm" style={{ color: theme.colors.textDim }}>
							End Date
						</span>
						<input
							type="date"
							value={options.dateRange.end}
							onChange={(e) =>
								setOptions({
									...options,
									dateRange: { ...options.dateRange, end: e.target.value },
								})
							}
							className="border rounded px-2 py-1"
							style={{
								backgroundColor: theme.colors.bgMain,
								borderColor: theme.colors.border,
								color: theme.colors.textMain,
							}}
						/>
					</label>
				</div>
				<p className="text-xs" style={{ color: theme.colors.textDim, opacity: 0.7 }}>
					Leave empty to process all available data.
				</p>
			</div>

			{/* Actions */}
			<div
				className="flex items-center gap-4 pt-4 border-t"
				style={{ borderColor: theme.colors.border }}
			>
				<label className="flex items-center gap-2 cursor-pointer">
					<input
						type="checkbox"
						checked={previewMode}
						onChange={(e) => setPreviewMode(e.target.checked)}
						className="w-4 h-4 rounded"
						style={{ accentColor: theme.colors.accent }}
					/>
					<span className="text-sm" style={{ color: theme.colors.textMain }}>
						Preview only (don't modify database)
					</span>
				</label>

				<button
					onClick={handleReconstruct}
					disabled={running}
					className="px-4 py-2 rounded font-medium transition-opacity"
					style={{
						backgroundColor: theme.colors.accent,
						color: '#ffffff',
						opacity: running ? 0.5 : 1,
					}}
				>
					{running ? 'Running...' : previewMode ? 'Preview Reconstruction' : 'Start Reconstruction'}
				</button>
			</div>

			{/* Results */}
			{result && (
				<div className="pt-4 border-t space-y-4" style={{ borderColor: theme.colors.border }}>
					<h4 className="font-medium" style={{ color: theme.colors.textMain }}>
						{previewMode ? 'Preview Results' : 'Reconstruction Results'}
					</h4>

					<div className="grid grid-cols-4 gap-4">
						<div
							className="text-center p-4 rounded"
							style={{ backgroundColor: theme.colors.bgMain }}
						>
							<div className="text-2xl font-bold" style={{ color: theme.colors.textMain }}>
								{result.queriesFound.toLocaleString()}
							</div>
							<div className="text-sm" style={{ color: theme.colors.textDim }}>
								Queries Found
							</div>
						</div>
						<div
							className="text-center p-4 rounded"
							style={{ backgroundColor: 'rgba(34, 197, 94, 0.1)' }}
						>
							<div className="text-2xl font-bold" style={{ color: '#22c55e' }}>
								{result.queriesInserted.toLocaleString()}
							</div>
							<div className="text-sm" style={{ color: theme.colors.textDim }}>
								New Records
							</div>
						</div>
						<div
							className="text-center p-4 rounded"
							style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)' }}
						>
							<div className="text-2xl font-bold" style={{ color: '#3b82f6' }}>
								{result.queriesUpdated.toLocaleString()}
							</div>
							<div className="text-sm" style={{ color: theme.colors.textDim }}>
								Updated
							</div>
						</div>
						<div
							className="text-center p-4 rounded"
							style={{ backgroundColor: theme.colors.bgMain }}
						>
							<div className="text-2xl font-bold" style={{ color: theme.colors.textDim }}>
								{result.queriesSkipped.toLocaleString()}
							</div>
							<div className="text-sm" style={{ color: theme.colors.textDim }}>
								Skipped
							</div>
						</div>
					</div>

					{result.dateRangeCovered && (
						<p className="text-sm" style={{ color: theme.colors.textDim }}>
							Date range: {result.dateRangeCovered.start} to {result.dateRangeCovered.end}
						</p>
					)}

					<p className="text-sm" style={{ color: theme.colors.textDim }}>
						Completed in {formatDuration(result.duration)}
					</p>

					{result.errors.length > 0 && (
						<div
							className="rounded p-4"
							style={{
								backgroundColor: 'rgba(239, 68, 68, 0.1)',
								borderColor: 'rgba(239, 68, 68, 0.2)',
								borderWidth: 1,
							}}
						>
							<h5 className="font-medium mb-2" style={{ color: '#ef4444' }}>
								Errors ({result.errors.length})
							</h5>
							<ul className="text-sm space-y-1" style={{ color: '#ef4444' }}>
								{result.errors.slice(0, 5).map((err, i) => (
									<li key={i}>
										<span className="font-mono">{err.file}</span>: {err.error}
									</li>
								))}
								{result.errors.length > 5 && (
									<li>... and {result.errors.length - 5} more errors</li>
								)}
							</ul>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
