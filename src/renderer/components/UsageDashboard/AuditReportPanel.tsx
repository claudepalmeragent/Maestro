/**
 * AuditReportPanel - Displays audit entries with filtering and details
 *
 * Features:
 * - Summary header with total/match/minor/major/missing counts
 * - Billing mode breakdown showing API vs Max usage
 * - Model breakdown table
 * - Filterable entries table
 * - Mark as Reviewed action (formerly auto-correct)
 */

import React, { useState, useMemo } from 'react';
import type { Theme } from '../../types';
import type {
	ExtendedAuditResult,
	AuditEntry,
	BillingModeBreakdown,
	ModelBreakdownEntry,
} from '../Settings/AuditHistoryTable';

export interface AuditReportPanelProps {
	result: ExtendedAuditResult;
	onMarkReviewed?: (selectedIds: string[]) => Promise<void>;
	theme: Theme;
}

type FilterStatus = 'all' | 'match' | 'minor' | 'major' | 'missing';
type FilterBillingMode = 'all' | 'api' | 'max' | 'unknown';

export function AuditReportPanel({
	result,
	onMarkReviewed,
	theme,
}: AuditReportPanelProps): React.ReactElement {
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [marking, setMarking] = useState(false);
	const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
	const [billingModeFilter, setBillingModeFilter] = useState<FilterBillingMode>('all');

	// Filter entries based on current filters
	const filteredEntries = useMemo(() => {
		if (!result.entries) return [];
		return result.entries.filter((entry) => {
			if (statusFilter !== 'all' && entry.status !== statusFilter) return false;
			if (billingModeFilter !== 'all' && entry.billingMode !== billingModeFilter) return false;
			return true;
		});
	}, [result.entries, statusFilter, billingModeFilter]);

	const discrepancies = useMemo(
		() => filteredEntries.filter((e) => e.status !== 'match'),
		[filteredEntries]
	);

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

	async function handleMarkReviewed(): Promise<void> {
		if (selectedIds.size === 0 || !onMarkReviewed) return;

		const confirmed = window.confirm(
			`Mark ${selectedIds.size} entries as reviewed?\n\nThis will mark the entries as manually verified. It does not change any values.`
		);

		if (!confirmed) return;

		setMarking(true);
		try {
			await onMarkReviewed(Array.from(selectedIds));
			setSelectedIds(new Set());
		} finally {
			setMarking(false);
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

	function formatTokens(count: number): string {
		if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
		if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
		return count.toString();
	}

	// Safely access summary with defaults
	const summary = result.summary || {
		total: result.entries?.length || 0,
		matches: 0,
		minorDiscrepancies: 0,
		majorDiscrepancies: 0,
		missing: 0,
	};

	const billingBreakdown: BillingModeBreakdown = result.billingModeBreakdown || {
		api: { entryCount: 0, anthropicCost: 0, maestroCost: 0, tokenCount: 0 },
		max: { entryCount: 0, anthropicCost: 0, maestroCost: 0, cacheSavings: 0, tokenCount: 0 },
	};

	return (
		<div className="space-y-6">
			{/* Summary Header */}
			<div
				className="grid grid-cols-5 gap-4 p-4 rounded"
				style={{ backgroundColor: theme.colors.bgActivity }}
			>
				<div className="text-center">
					<div className="text-2xl font-bold" style={{ color: theme.colors.textMain }}>
						{summary.total}
					</div>
					<div className="text-sm" style={{ color: theme.colors.textDim }}>
						Total Entries
					</div>
				</div>
				<div className="text-center">
					<div className="text-2xl font-bold" style={{ color: '#22c55e' }}>
						{summary.matches}
					</div>
					<div className="text-sm" style={{ color: theme.colors.textDim }}>
						Matches
					</div>
				</div>
				<div className="text-center">
					<div className="text-2xl font-bold" style={{ color: '#eab308' }}>
						{summary.minorDiscrepancies}
					</div>
					<div className="text-sm" style={{ color: theme.colors.textDim }}>
						Minor
					</div>
				</div>
				<div className="text-center">
					<div className="text-2xl font-bold" style={{ color: '#ef4444' }}>
						{summary.majorDiscrepancies}
					</div>
					<div className="text-sm" style={{ color: theme.colors.textDim }}>
						Major
					</div>
				</div>
				<div className="text-center">
					<div className="text-2xl font-bold" style={{ color: theme.colors.textDim }}>
						{summary.missing}
					</div>
					<div className="text-sm" style={{ color: theme.colors.textDim }}>
						Missing
					</div>
				</div>
			</div>

			{/* Billing Mode Breakdown */}
			<div className="grid grid-cols-2 gap-4">
				<div className="p-4 rounded" style={{ backgroundColor: theme.colors.bgActivity }}>
					<h4 className="font-medium mb-2" style={{ color: theme.colors.textMain }}>
						API Billing
					</h4>
					<div className="text-sm space-y-1" style={{ color: theme.colors.textDim }}>
						<div>Entries: {billingBreakdown.api.entryCount}</div>
						<div>Tokens: {formatTokens(billingBreakdown.api.tokenCount)}</div>
						<div>Anthropic: {formatCurrency(billingBreakdown.api.anthropicCost)}</div>
						<div>Maestro: {formatCurrency(billingBreakdown.api.maestroCost)}</div>
					</div>
				</div>
				<div className="p-4 rounded" style={{ backgroundColor: theme.colors.bgActivity }}>
					<h4 className="font-medium mb-2" style={{ color: theme.colors.textMain }}>
						Max Billing (Cache Free)
					</h4>
					<div className="text-sm space-y-1" style={{ color: theme.colors.textDim }}>
						<div>Entries: {billingBreakdown.max.entryCount}</div>
						<div>Tokens: {formatTokens(billingBreakdown.max.tokenCount)}</div>
						<div>Anthropic: {formatCurrency(billingBreakdown.max.anthropicCost)}</div>
						<div>Maestro: {formatCurrency(billingBreakdown.max.maestroCost)}</div>
						<div style={{ color: '#22c55e' }}>
							Cache Savings: {formatCurrency(billingBreakdown.max.cacheSavings)}
						</div>
					</div>
				</div>
			</div>

			{/* Model Breakdown */}
			{result.modelBreakdown && result.modelBreakdown.length > 0 && (
				<div>
					<h4 className="font-medium mb-2" style={{ color: theme.colors.textMain }}>
						Model Breakdown
					</h4>
					<table className="w-full text-sm">
						<thead>
							<tr className="text-left border-b" style={{ borderColor: theme.colors.border }}>
								<th className="py-2" style={{ color: theme.colors.textDim }}>
									Model
								</th>
								<th className="py-2 text-right" style={{ color: theme.colors.textDim }}>
									Anthropic
								</th>
								<th className="py-2 text-right" style={{ color: theme.colors.textDim }}>
									Maestro
								</th>
								<th className="py-2 text-right" style={{ color: theme.colors.textDim }}>
									Entries
								</th>
								<th className="py-2 text-center" style={{ color: theme.colors.textDim }}>
									Status
								</th>
							</tr>
						</thead>
						<tbody>
							{result.modelBreakdown.map((model) => (
								<tr
									key={model.model}
									className="border-b"
									style={{ borderColor: theme.colors.border }}
								>
									<td className="py-2 font-mono text-xs" style={{ color: theme.colors.textMain }}>
										{model.model}
									</td>
									<td className="py-2 text-right" style={{ color: theme.colors.textMain }}>
										{formatCurrency(model.anthropic.cost)}
									</td>
									<td className="py-2 text-right" style={{ color: theme.colors.textMain }}>
										{formatCurrency(model.maestro.cost)}
									</td>
									<td className="py-2 text-right" style={{ color: theme.colors.textMain }}>
										{model.entryCount}
									</td>
									<td
										className="py-2 text-center"
										style={{ color: model.match ? '#22c55e' : '#ef4444' }}
									>
										{model.match ? '\u2713' : `${model.discrepancyPercent.toFixed(1)}%`}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			{/* Filters and Actions */}
			<div className="flex items-center gap-4 flex-wrap">
				<label className="flex items-center gap-2 text-sm" style={{ color: theme.colors.textMain }}>
					Status:
					<select
						value={statusFilter}
						onChange={(e) => setStatusFilter(e.target.value as FilterStatus)}
						className="px-2 py-1 rounded border bg-transparent"
						style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
					>
						<option value="all">All</option>
						<option value="match">Match</option>
						<option value="minor">Minor</option>
						<option value="major">Major</option>
						<option value="missing">Missing</option>
					</select>
				</label>

				<label className="flex items-center gap-2 text-sm" style={{ color: theme.colors.textMain }}>
					Billing:
					<select
						value={billingModeFilter}
						onChange={(e) => setBillingModeFilter(e.target.value as FilterBillingMode)}
						className="px-2 py-1 rounded border bg-transparent"
						style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
					>
						<option value="all">All</option>
						<option value="api">API</option>
						<option value="max">Max</option>
						<option value="unknown">Unknown</option>
					</select>
				</label>

				{discrepancies.length > 0 && onMarkReviewed && (
					<>
						<button
							onClick={selectAllDiscrepancies}
							className="px-3 py-1 text-sm rounded border transition-colors hover:bg-opacity-10"
							style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
						>
							Select Discrepancies ({discrepancies.length})
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
							Clear
						</button>
						<button
							onClick={handleMarkReviewed}
							disabled={selectedIds.size === 0 || marking}
							className="px-4 py-1 text-sm rounded font-medium transition-opacity"
							style={{
								backgroundColor: theme.colors.accent,
								color: '#ffffff',
								opacity: selectedIds.size === 0 || marking ? 0.5 : 1,
							}}
						>
							{marking ? 'Marking...' : `Mark Reviewed (${selectedIds.size})`}
						</button>
					</>
				)}
			</div>

			{/* Entries Table */}
			{filteredEntries.length > 0 ? (
				<table className="w-full text-sm">
					<thead>
						<tr className="text-left border-b" style={{ borderColor: theme.colors.border }}>
							{onMarkReviewed && <th className="py-2 w-8"></th>}
							<th className="py-2" style={{ color: theme.colors.textDim }}>
								Date
							</th>
							<th className="py-2" style={{ color: theme.colors.textDim }}>
								Model
							</th>
							<th className="py-2" style={{ color: theme.colors.textDim }}>
								Billing
							</th>
							<th className="py-2 text-right" style={{ color: theme.colors.textDim }}>
								Anthropic
							</th>
							<th className="py-2 text-right" style={{ color: theme.colors.textDim }}>
								Maestro
							</th>
							<th className="py-2 text-right" style={{ color: theme.colors.textDim }}>
								Diff %
							</th>
							<th className="py-2 text-center" style={{ color: theme.colors.textDim }}>
								Status
							</th>
						</tr>
					</thead>
					<tbody>
						{filteredEntries.map((entry) => (
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
								{onMarkReviewed && (
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
								)}
								<td className="py-2" style={{ color: theme.colors.textMain }}>
									{entry.date}
								</td>
								<td className="py-2 font-mono text-xs" style={{ color: theme.colors.textMain }}>
									{entry.model.replace('claude-', '').slice(0, 20)}
								</td>
								<td className="py-2" style={{ color: theme.colors.textMain }}>
									<span
										className="px-1.5 py-0.5 rounded text-xs"
										style={{
											backgroundColor:
												entry.billingMode === 'max'
													? 'rgba(34, 197, 94, 0.2)'
													: entry.billingMode === 'api'
														? 'rgba(59, 130, 246, 0.2)'
														: 'rgba(156, 163, 175, 0.2)',
											color:
												entry.billingMode === 'max'
													? '#22c55e'
													: entry.billingMode === 'api'
														? '#3b82f6'
														: theme.colors.textDim,
										}}
									>
										{entry.billingMode.toUpperCase()}
									</span>
								</td>
								<td className="py-2 text-right" style={{ color: theme.colors.textMain }}>
									{formatCurrency(entry.costs.anthropicCost)}
								</td>
								<td className="py-2 text-right" style={{ color: theme.colors.textMain }}>
									{formatCurrency(entry.costs.maestroCost)}
								</td>
								<td className="py-2 text-right" style={{ color: getStatusColor(entry.status) }}>
									{entry.discrepancyPercent.toFixed(1)}%
								</td>
								<td className="py-2 text-center" style={{ color: getStatusColor(entry.status) }}>
									{getStatusIcon(entry.status)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			) : (
				<div className="text-sm py-4" style={{ color: theme.colors.textDim }}>
					No entries match the current filters.
				</div>
			)}
		</div>
	);
}

// Re-export the type for external use
export type { ExtendedAuditResult as AuditReportResult };
