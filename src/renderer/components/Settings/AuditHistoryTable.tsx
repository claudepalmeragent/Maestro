/**
 * AuditHistoryTable - Displays a table of past audit results
 *
 * Shows audit history with key metrics:
 * - Date run
 * - Period covered
 * - Anthropic vs Maestro costs
 * - Savings
 * - Status (errors/warnings/OK)
 * - Click to view details
 */

import React, { useState, useEffect } from 'react';
import type { Theme } from '../../types';

/**
 * Extended audit result type matching backend ExtendedAuditResult
 */
interface ExtendedAuditResult {
	period: { start: string; end: string };
	generatedAt: number;
	tokens: {
		anthropic: TokenCounts;
		maestro: TokenCounts;
		difference: TokenCounts;
		percentDiff: number;
	};
	costs: {
		anthropic_total: number;
		maestro_anthropic: number;
		maestro_calculated: number;
		discrepancy: number;
		savings: number;
	};
	modelBreakdown: ModelBreakdownEntry[];
	anomalies: Array<{ type: string; severity: string; description: string; details: unknown }>;
	entries: AuditEntry[];
	billingModeBreakdown: BillingModeBreakdown;
	summary: {
		total: number;
		matches: number;
		minorDiscrepancies: number;
		majorDiscrepancies: number;
		missing: number;
	};
}

interface TokenCounts {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
}

interface AuditEntry {
	id: string;
	date: string;
	model: string;
	billingMode: 'api' | 'max' | 'unknown';
	tokens: {
		anthropic: TokenCounts;
		maestro: TokenCounts;
	};
	costs: {
		anthropicCost: number;
		maestroCost: number;
	};
	status: 'match' | 'minor' | 'major' | 'missing';
	discrepancyPercent: number;
}

interface BillingModeBreakdown {
	api: { entryCount: number; anthropicCost: number; maestroCost: number; tokenCount: number };
	max: {
		entryCount: number;
		anthropicCost: number;
		maestroCost: number;
		cacheSavings: number;
		tokenCount: number;
	};
}

interface ModelBreakdownEntry {
	model: string;
	anthropic: { tokens: TokenCounts; cost: number };
	maestro: { tokens: TokenCounts; cost: number };
	entryCount: number;
	discrepancyPercent: number;
	match: boolean;
}

export interface AuditHistoryTableProps {
	theme: Theme;
	onSelectAudit?: (audit: ExtendedAuditResult) => void;
	onDeleteAudit?: (audit: ExtendedAuditResult) => void;
}

export function AuditHistoryTable({
	theme,
	onSelectAudit,
	onDeleteAudit,
}: AuditHistoryTableProps): React.ReactElement {
	const [history, setHistory] = useState<ExtendedAuditResult[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		loadHistory();
	}, []);

	async function loadHistory(): Promise<void> {
		try {
			const results = await window.maestro.audit.getHistory(10);
			setHistory(results as ExtendedAuditResult[]);
		} catch (error) {
			console.error('Failed to load audit history:', error);
		} finally {
			setLoading(false);
		}
	}

	function formatDate(timestamp: number): string {
		return new Date(timestamp).toLocaleDateString();
	}

	function formatCurrency(value: number): string {
		return `$${value.toFixed(2)}`;
	}

	function getStatusBadge(audit: ExtendedAuditResult): React.ReactElement {
		const errorCount = audit.anomalies.filter((a) => a.severity === 'error').length;
		const warningCount = audit.anomalies.filter((a) => a.severity === 'warning').length;

		// Also consider entry-level discrepancies
		const majorCount = audit.summary?.majorDiscrepancies || 0;
		const minorCount = audit.summary?.minorDiscrepancies || 0;

		if (errorCount > 0 || majorCount > 0) {
			return (
				<span
					className="px-2 py-1 rounded text-xs"
					style={{ backgroundColor: 'rgba(239, 68, 68, 0.2)', color: '#ef4444' }}
				>
					{errorCount + majorCount} issues
				</span>
			);
		}
		if (warningCount > 0 || minorCount > 0) {
			return (
				<span
					className="px-2 py-1 rounded text-xs"
					style={{ backgroundColor: 'rgba(234, 179, 8, 0.2)', color: '#eab308' }}
				>
					{warningCount + minorCount} warnings
				</span>
			);
		}
		return (
			<span
				className="px-2 py-1 rounded text-xs"
				style={{ backgroundColor: 'rgba(34, 197, 94, 0.2)', color: '#22c55e' }}
			>
				OK
			</span>
		);
	}

	function handleRowClick(audit: ExtendedAuditResult): void {
		if (onSelectAudit) {
			onSelectAudit(audit);
		}
	}

	function handleDeleteClick(e: React.MouseEvent, audit: ExtendedAuditResult): void {
		e.stopPropagation(); // Prevent row click
		if (onDeleteAudit) {
			onDeleteAudit(audit);
		}
	}

	if (loading) {
		return (
			<div className="text-sm" style={{ color: theme.colors.textDim }}>
				Loading history...
			</div>
		);
	}

	if (history.length === 0) {
		return (
			<div className="text-sm" style={{ color: theme.colors.textDim }}>
				No audits have been run yet.
			</div>
		);
	}

	return (
		<table className="w-full text-sm">
			<thead>
				<tr className="text-left border-b" style={{ borderColor: theme.colors.border }}>
					<th className="py-2" style={{ color: theme.colors.textDim }}>
						Date Run
					</th>
					<th className="py-2" style={{ color: theme.colors.textDim }}>
						Period
					</th>
					<th className="py-2" style={{ color: theme.colors.textDim }}>
						Anthropic
					</th>
					<th className="py-2" style={{ color: theme.colors.textDim }}>
						Maestro
					</th>
					<th className="py-2" style={{ color: theme.colors.textDim }}>
						Savings
					</th>
					<th className="py-2" style={{ color: theme.colors.textDim }}>
						Entries
					</th>
					<th className="py-2" style={{ color: theme.colors.textDim }}>
						Status
					</th>
					{onDeleteAudit && <th className="py-2 w-10" style={{ color: theme.colors.textDim }}></th>}
				</tr>
			</thead>
			<tbody>
				{history.map((audit, i) => (
					<tr
						key={i}
						className="border-b hover:bg-opacity-50 transition-colors cursor-pointer"
						style={{
							borderColor: theme.colors.border,
						}}
						onClick={() => handleRowClick(audit)}
						onKeyDown={(e) => e.key === 'Enter' && handleRowClick(audit)}
						tabIndex={0}
						role="button"
					>
						<td className="py-2" style={{ color: theme.colors.textMain }}>
							{formatDate(audit.generatedAt)}
						</td>
						<td className="py-2" style={{ color: theme.colors.textMain }}>
							{audit.period.start} to {audit.period.end}
						</td>
						<td className="py-2" style={{ color: theme.colors.textMain }}>
							{formatCurrency(audit.costs.anthropic_total)}
						</td>
						<td className="py-2" style={{ color: theme.colors.textMain }}>
							{formatCurrency(audit.costs.maestro_calculated)}
						</td>
						<td className="py-2" style={{ color: '#22c55e' }}>
							{formatCurrency(audit.costs.savings)}
						</td>
						<td className="py-2" style={{ color: theme.colors.textMain }}>
							{audit.summary?.total || audit.entries?.length || '-'}
						</td>
						<td className="py-2">{getStatusBadge(audit)}</td>
						{onDeleteAudit && (
							<td className="py-2">
								<button
									onClick={(e) => handleDeleteClick(e, audit)}
									className="p-1 rounded hover:bg-red-500 hover:bg-opacity-20 transition-colors"
									style={{ color: theme.colors.textDim }}
									title="Delete audit"
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										width="16"
										height="16"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
									>
										<path d="M3 6h18" />
										<path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
										<path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
									</svg>
								</button>
							</td>
						)}
					</tr>
				))}
			</tbody>
		</table>
	);
}

export type { ExtendedAuditResult, AuditEntry, BillingModeBreakdown, ModelBreakdownEntry };
