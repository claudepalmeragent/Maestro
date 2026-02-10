/**
 * AuditReportPanel - Displays audit entries with checkboxes for selective correction
 *
 * Features:
 * - Summary header with total/match/minor/major/missing counts
 * - Table of audit entries with selection checkboxes
 * - Select All Discrepancies button
 * - Auto-Correct Selected button with confirmation
 *
 * Usage:
 * ```tsx
 * <AuditReportPanel
 *   result={auditResult}
 *   onAutoCorrect={handleAutoCorrect}
 *   theme={theme}
 * />
 * ```
 */

import React, { useState } from 'react';
import type { Theme } from '../../types';

export interface AuditEntry {
	id: string;
	date: string;
	source: 'anthropic' | 'maestro';
	model: string;
	inputTokens: number;
	outputTokens: number;
	cacheTokens: number;
	anthropicCost: number;
	maestroCost: number;
	status: 'match' | 'minor' | 'major' | 'missing';
}

export interface AuditReportResult {
	period: { start: string; end: string };
	entries: AuditEntry[];
	summary: {
		total: number;
		matches: number;
		minorDiscrepancies: number;
		majorDiscrepancies: number;
		missing: number;
	};
}

export interface AuditReportPanelProps {
	result: AuditReportResult;
	onAutoCorrect: (selectedIds: string[]) => Promise<void>;
	theme: Theme;
}

export function AuditReportPanel({
	result,
	onAutoCorrect,
	theme,
}: AuditReportPanelProps): React.ReactElement {
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [correcting, setCorrecting] = useState(false);

	const discrepancies = result.entries.filter((e) => e.status !== 'match');

	function toggleSelection(id: string): void {
		const newSet = new Set(selectedIds);
		if (newSet.has(id)) {
			newSet.delete(id);
		} else {
			newSet.add(id);
		}
		setSelectedIds(newSet);
	}

	function selectAllDiscrepancies(): void {
		setSelectedIds(new Set(discrepancies.map((e) => e.id)));
	}

	function clearSelection(): void {
		setSelectedIds(new Set());
	}

	async function handleAutoCorrect(): Promise<void> {
		if (selectedIds.size === 0) return;

		const confirmed = window.confirm(
			`Are you sure you want to auto-correct ${selectedIds.size} entries?\n\nThis will update Maestro's records to match Anthropic's data.`
		);

		if (!confirmed) return;

		setCorrecting(true);
		try {
			await onAutoCorrect(Array.from(selectedIds));
			setSelectedIds(new Set());
		} finally {
			setCorrecting(false);
		}
	}

	function getStatusIcon(status: AuditEntry['status']): string {
		switch (status) {
			case 'match':
				return '\u2713'; // checkmark
			case 'minor':
				return '\u0394'; // delta
			case 'major':
				return '\u26A0'; // warning
			case 'missing':
				return '\u2717'; // x
		}
	}

	function getStatusColor(status: AuditEntry['status']): string {
		switch (status) {
			case 'match':
				return '#22c55e';
			case 'minor':
				return '#eab308';
			case 'major':
				return '#ef4444';
			case 'missing':
				return theme.colors.textDim;
		}
	}

	function formatCurrency(value: number): string {
		return `$${value.toFixed(4)}`;
	}

	return (
		<div className="space-y-4">
			{/* Summary Header */}
			<div
				className="grid grid-cols-5 gap-4 p-4 rounded"
				style={{ backgroundColor: theme.colors.bgActivity }}
			>
				<div className="text-center">
					<div className="text-2xl font-bold" style={{ color: theme.colors.textMain }}>
						{result.summary.total}
					</div>
					<div className="text-sm" style={{ color: theme.colors.textDim }}>
						Total Entries
					</div>
				</div>
				<div className="text-center">
					<div className="text-2xl font-bold" style={{ color: '#22c55e' }}>
						{result.summary.matches}
					</div>
					<div className="text-sm" style={{ color: theme.colors.textDim }}>
						Matches
					</div>
				</div>
				<div className="text-center">
					<div className="text-2xl font-bold" style={{ color: '#eab308' }}>
						{result.summary.minorDiscrepancies}
					</div>
					<div className="text-sm" style={{ color: theme.colors.textDim }}>
						Minor
					</div>
				</div>
				<div className="text-center">
					<div className="text-2xl font-bold" style={{ color: '#ef4444' }}>
						{result.summary.majorDiscrepancies}
					</div>
					<div className="text-sm" style={{ color: theme.colors.textDim }}>
						Major
					</div>
				</div>
				<div className="text-center">
					<div className="text-2xl font-bold" style={{ color: theme.colors.textDim }}>
						{result.summary.missing}
					</div>
					<div className="text-sm" style={{ color: theme.colors.textDim }}>
						Missing
					</div>
				</div>
			</div>

			{/* Action Buttons */}
			{discrepancies.length > 0 && (
				<div className="flex items-center gap-4">
					<button
						onClick={selectAllDiscrepancies}
						className="px-3 py-1 text-sm rounded border transition-colors hover:bg-opacity-10"
						style={{
							borderColor: theme.colors.border,
							color: theme.colors.textMain,
						}}
					>
						Select All Discrepancies ({discrepancies.length})
					</button>
					<button
						onClick={clearSelection}
						disabled={selectedIds.size === 0}
						className="px-3 py-1 text-sm rounded border transition-colors hover:bg-opacity-10"
						style={{
							borderColor: theme.colors.border,
							color: theme.colors.textMain,
							opacity: selectedIds.size === 0 ? 0.5 : 1,
						}}
					>
						Clear Selection
					</button>
					<button
						onClick={handleAutoCorrect}
						disabled={selectedIds.size === 0 || correcting}
						className="px-4 py-1 text-sm rounded font-medium transition-opacity"
						style={{
							backgroundColor: theme.colors.accent,
							color: '#ffffff',
							opacity: selectedIds.size === 0 || correcting ? 0.5 : 1,
						}}
					>
						{correcting ? 'Correcting...' : `Auto-Correct Selected (${selectedIds.size})`}
					</button>
				</div>
			)}

			{/* Entries Table */}
			<table className="w-full text-sm">
				<thead>
					<tr className="text-left border-b" style={{ borderColor: theme.colors.border }}>
						<th className="py-2 w-8"></th>
						<th className="py-2" style={{ color: theme.colors.textDim }}>
							Date
						</th>
						<th className="py-2" style={{ color: theme.colors.textDim }}>
							Model
						</th>
						<th className="py-2 text-right" style={{ color: theme.colors.textDim }}>
							Input
						</th>
						<th className="py-2 text-right" style={{ color: theme.colors.textDim }}>
							Output
						</th>
						<th className="py-2 text-right" style={{ color: theme.colors.textDim }}>
							Cache
						</th>
						<th className="py-2 text-right" style={{ color: theme.colors.textDim }}>
							Anthropic
						</th>
						<th className="py-2 text-right" style={{ color: theme.colors.textDim }}>
							Maestro
						</th>
						<th className="py-2 text-center" style={{ color: theme.colors.textDim }}>
							Status
						</th>
					</tr>
				</thead>
				<tbody>
					{result.entries.map((entry) => (
						<tr
							key={entry.id}
							className="border-b transition-colors"
							style={{
								borderColor: theme.colors.border,
								backgroundColor: selectedIds.has(entry.id)
									? `${theme.colors.accent}20`
									: 'transparent',
							}}
						>
							<td className="py-2">
								{entry.status !== 'match' && (
									<input
										type="checkbox"
										checked={selectedIds.has(entry.id)}
										onChange={() => toggleSelection(entry.id)}
										className="w-4 h-4 rounded"
										style={{ accentColor: theme.colors.accent }}
									/>
								)}
							</td>
							<td className="py-2" style={{ color: theme.colors.textMain }}>
								{entry.date}
							</td>
							<td className="py-2 font-mono text-xs" style={{ color: theme.colors.textMain }}>
								{entry.model}
							</td>
							<td className="py-2 text-right" style={{ color: theme.colors.textMain }}>
								{entry.inputTokens.toLocaleString()}
							</td>
							<td className="py-2 text-right" style={{ color: theme.colors.textMain }}>
								{entry.outputTokens.toLocaleString()}
							</td>
							<td className="py-2 text-right" style={{ color: theme.colors.textMain }}>
								{entry.cacheTokens.toLocaleString()}
							</td>
							<td className="py-2 text-right" style={{ color: theme.colors.textMain }}>
								{formatCurrency(entry.anthropicCost)}
							</td>
							<td className="py-2 text-right" style={{ color: theme.colors.textMain }}>
								{formatCurrency(entry.maestroCost)}
							</td>
							<td className="py-2 text-center" style={{ color: getStatusColor(entry.status) }}>
								{getStatusIcon(entry.status)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
