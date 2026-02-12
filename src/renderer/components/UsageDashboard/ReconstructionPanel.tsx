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
import type { SshRemoteConfig } from '../../../shared/types';
import { useSshRemotes } from '../../hooks/remote/useSshRemotes';
import {
	ReconstructionPreviewModal,
	type ReconstructionResult,
} from '../ReconstructionPreviewModal';

interface ReconstructionPanelProps {
	theme: Theme;
}

export function ReconstructionPanel({ theme }: ReconstructionPanelProps): React.ReactElement {
	const { configs: sshRemotes, loading: sshLoading } = useSshRemotes();
	const [options, setOptions] = useState({
		includeLocalAgents: true,
		includeSshRemotes: false,
		selectedRemoteIds: [] as string[],
		dateRange: {
			start: '',
			end: '',
		},
	});
	const [running, setRunning] = useState(false);
	const [result, setResult] = useState<ReconstructionResult | null>(null);
	const [previewMode, setPreviewMode] = useState(true);
	const [showPreviewModal, setShowPreviewModal] = useState(false);
	const [previewResult, setPreviewResult] = useState<ReconstructionResult | null>(null);

	function buildReconstructionOptions(): {
		includeLocalAgents: boolean;
		includeSshRemotes: boolean;
		sshConfigs: Array<{ id: string; host: string; user: string; identityFile?: string }>;
		dateRange: { start: string; end: string };
	} {
		// Convert selected remote IDs to SSH configs
		const sshConfigs = options.selectedRemoteIds
			.map((id) => sshRemotes.find((r) => r.id === id))
			.filter((r): r is SshRemoteConfig => r !== undefined)
			.map((remote) => ({
				id: remote.id, // Include SSH remote ID for session mapping
				host: remote.host,
				user: remote.username,
				identityFile: remote.privateKeyPath || undefined,
			}));

		return {
			includeLocalAgents: options.includeLocalAgents,
			includeSshRemotes: options.includeSshRemotes && sshConfigs.length > 0,
			sshConfigs,
			dateRange: options.dateRange,
		};
	}

	async function handleReconstruct(): Promise<void> {
		setRunning(true);
		setResult(null);

		try {
			const reconstructionOptions = buildReconstructionOptions();

			if (previewMode) {
				// Run preview and show modal
				const previewResultData =
					await window.maestro.reconstruction.preview(reconstructionOptions);
				setPreviewResult(previewResultData);
				setShowPreviewModal(true);
			} else {
				// Run live reconstruction
				const reconstructResult = await window.maestro.reconstruction.start(reconstructionOptions);
				setResult(reconstructResult);
			}
		} catch (error) {
			console.error('Reconstruction failed:', error);
		} finally {
			setRunning(false);
		}
	}

	async function handleRunLiveFromModal(): Promise<void> {
		// Use the same options that were used for preview
		const reconstructionOptions = buildReconstructionOptions();
		const liveResult = await window.maestro.reconstruction.start(reconstructionOptions);
		setResult(liveResult);
		setShowPreviewModal(false);
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
						{sshLoading ? (
							<p className="text-sm" style={{ color: theme.colors.textDim }}>
								Loading SSH remotes...
							</p>
						) : sshRemotes.filter((r) => r.enabled).length === 0 ? (
							<p className="text-sm" style={{ color: theme.colors.textDim }}>
								No SSH remotes configured.{' '}
								<span style={{ color: theme.colors.accent }}>
									Configure remotes in Settings → SSH Remotes.
								</span>
							</p>
						) : (
							<>
								<p className="text-sm mb-2" style={{ color: theme.colors.textDim }}>
									Select remotes to pull JSONL data from:
								</p>
								<div className="space-y-1">
									{sshRemotes
										.filter((r) => r.enabled)
										.map((remote) => (
											<label
												key={remote.id}
												className="flex items-center gap-2 cursor-pointer p-2 rounded transition-colors"
												style={{
													backgroundColor: options.selectedRemoteIds.includes(remote.id)
														? theme.colors.bgActivity
														: 'transparent',
												}}
											>
												<input
													type="checkbox"
													checked={options.selectedRemoteIds.includes(remote.id)}
													onChange={(e) => {
														if (e.target.checked) {
															setOptions({
																...options,
																selectedRemoteIds: [...options.selectedRemoteIds, remote.id],
															});
														} else {
															setOptions({
																...options,
																selectedRemoteIds: options.selectedRemoteIds.filter(
																	(id) => id !== remote.id
																),
															});
														}
													}}
													className="w-4 h-4 rounded"
													style={{ accentColor: theme.colors.accent }}
												/>
												<span style={{ color: theme.colors.textMain }}>{remote.name}</span>
												<span style={{ color: theme.colors.textDim }}>({remote.host})</span>
											</label>
										))}
								</div>

								{/* Select All / Deselect All buttons */}
								<div className="flex gap-2 mt-2">
									<button
										onClick={() =>
											setOptions({
												...options,
												selectedRemoteIds: sshRemotes.filter((r) => r.enabled).map((r) => r.id),
											})
										}
										className="text-xs px-2 py-1 rounded transition-colors"
										style={{
											color: theme.colors.accent,
											backgroundColor: theme.colors.bgMain,
										}}
									>
										Select All
									</button>
									<button
										onClick={() => setOptions({ ...options, selectedRemoteIds: [] })}
										className="text-xs px-2 py-1 rounded transition-colors"
										style={{
											color: theme.colors.textDim,
											backgroundColor: theme.colors.bgMain,
										}}
									>
										Deselect All
									</button>
								</div>
							</>
						)}
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

			{/* Preview Results Modal */}
			{previewResult && (
				<ReconstructionPreviewModal
					isOpen={showPreviewModal}
					onClose={() => setShowPreviewModal(false)}
					result={previewResult}
					onRunLive={handleRunLiveFromModal}
					theme={theme}
				/>
			)}
		</div>
	);
}
