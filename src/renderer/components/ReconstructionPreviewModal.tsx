/**
 * ReconstructionPreviewModal - Modal to display reconstruction preview results
 *
 * Features:
 * - Displays preview statistics (found, inserted, updated, skipped)
 * - Shows terminal-style log output
 * - Cancel button to close
 * - "Run Reconstruction with Live Data" button (only if matches > 0)
 *
 * Usage:
 * ```tsx
 * <ReconstructionPreviewModal
 *   isOpen={showPreviewModal}
 *   onClose={() => setShowPreviewModal(false)}
 *   result={previewResult}
 *   onRunLive={handleRunLiveFromModal}
 *   theme={theme}
 * />
 * ```
 */

import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { Theme } from '../types';

export interface ReconstructionResult {
	queriesFound: number;
	queriesInserted: number;
	queriesUpdated: number;
	queriesSkipped: number;
	dateRangeCovered: { start: string; end: string } | null;
	errors: Array<{ file: string; error: string }>;
	duration: number;
}

export interface ReconstructionPreviewModalProps {
	isOpen: boolean;
	onClose: () => void;
	result: ReconstructionResult;
	onRunLive: () => Promise<void>;
	theme: Theme;
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	return `${(ms / 60000).toFixed(1)}m`;
}

export function ReconstructionPreviewModal({
	isOpen,
	onClose,
	result,
	onRunLive,
	theme,
}: ReconstructionPreviewModalProps): React.ReactElement | null {
	const [running, setRunning] = useState(false);

	// Calculate if we can run live (has matches to update)
	const hasMatches = result.queriesUpdated > 0 || result.queriesInserted > 0;

	async function handleRunLive(): Promise<void> {
		setRunning(true);
		try {
			await onRunLive();
			onClose(); // Close after successful run
		} finally {
			setRunning(false);
		}
	}

	if (!isOpen) return null;

	return (
		<div
			className="fixed inset-0 flex items-center justify-center z-50"
			style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
		>
			<div
				className="rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden"
				style={{ backgroundColor: theme.colors.bgSidebar }}
			>
				{/* Header */}
				<div
					className="flex items-center justify-between p-4 border-b"
					style={{ borderColor: theme.colors.border }}
				>
					<h2 className="text-lg font-semibold" style={{ color: theme.colors.textMain }}>
						Reconstruction Preview Results
					</h2>
					<button
						onClick={onClose}
						className="p-1 rounded hover:bg-opacity-10 transition-colors"
						style={{ color: theme.colors.textDim }}
					>
						<X className="w-5 h-5" />
					</button>
				</div>

				{/* Content - scrollable */}
				<div className="p-4 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 160px)' }}>
					{/* Statistics Grid */}
					<div className="grid grid-cols-4 gap-4 mb-6">
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

					{/* Date Range */}
					{result.dateRangeCovered && (
						<p className="text-sm mb-4" style={{ color: theme.colors.textDim }}>
							Date range: {result.dateRangeCovered.start} to {result.dateRangeCovered.end}
						</p>
					)}

					{/* Duration */}
					<p className="text-sm mb-4" style={{ color: theme.colors.textDim }}>
						Preview completed in {formatDuration(result.duration)}
					</p>

					{/* Log Output (styled like terminal) */}
					<div
						className="rounded p-4 font-mono text-sm overflow-x-auto"
						style={{ backgroundColor: theme.colors.bgMain }}
					>
						<div style={{ color: theme.colors.textDim }}>
							{result.queriesFound > 0 ? (
								<>
									<div>Found {result.queriesFound.toLocaleString()} entries in JSONL files</div>
									<div className="mt-2" style={{ color: '#3b82f6' }}>
										→ {result.queriesUpdated.toLocaleString()} would be UPDATED (matched existing
										records)
									</div>
									<div style={{ color: '#22c55e' }}>
										→ {result.queriesInserted.toLocaleString()} would be INSERTED (new records)
									</div>
									<div style={{ color: theme.colors.textDim }}>
										→ {result.queriesSkipped.toLocaleString()} would be SKIPPED (already complete)
									</div>
								</>
							) : (
								<div>No entries found in JSONL files.</div>
							)}
						</div>
					</div>

					{/* Errors */}
					{result.errors.length > 0 && (
						<div className="mt-4 rounded p-4" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)' }}>
							<h5 className="font-medium mb-2" style={{ color: '#ef4444' }}>
								Errors ({result.errors.length})
							</h5>
							<ul className="text-sm space-y-1 font-mono" style={{ color: '#ef4444' }}>
								{result.errors.slice(0, 10).map((err, i) => (
									<li key={i}>
										{err.file}: {err.error}
									</li>
								))}
								{result.errors.length > 10 && (
									<li>... and {result.errors.length - 10} more errors</li>
								)}
							</ul>
						</div>
					)}
				</div>

				{/* Footer with buttons */}
				<div
					className="flex justify-end gap-3 p-4 border-t"
					style={{ borderColor: theme.colors.border }}
				>
					<button
						onClick={onClose}
						className="px-4 py-2 rounded border transition-colors hover:bg-opacity-10"
						style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
					>
						Cancel
					</button>

					{hasMatches && (
						<button
							onClick={handleRunLive}
							disabled={running}
							className="px-4 py-2 rounded font-medium transition-opacity"
							style={{
								backgroundColor: '#22c55e',
								color: '#ffffff',
								opacity: running ? 0.5 : 1,
							}}
						>
							{running ? 'Running...' : 'Run Reconstruction with Live Data'}
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
