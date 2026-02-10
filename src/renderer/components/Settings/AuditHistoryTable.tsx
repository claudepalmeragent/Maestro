/**
 * AuditHistoryTable - Displays a table of past audit results
 *
 * Shows audit history with key metrics:
 * - Date run
 * - Period covered
 * - Anthropic vs Maestro costs
 * - Savings
 * - Status (errors/warnings/OK)
 *
 * Usage:
 * ```tsx
 * <AuditHistoryTable theme={theme} />
 * ```
 */

import React, { useState, useEffect } from 'react';
import type { Theme } from '../../types';

/**
 * Summary of an audit result for display in the history table.
 * This is a subset of the full AuditResult used for list views.
 */
interface AuditSummary {
	period: { start: string; end: string };
	generatedAt: number;
	tokens: {
		percentDiff: number;
	};
	costs: {
		anthropic_total: number;
		maestro_calculated: number;
		savings: number;
		discrepancy: number;
	};
	anomalies: Array<{ severity: string }>;
}

export interface AuditHistoryTableProps {
	theme: Theme;
}

export function AuditHistoryTable({ theme }: AuditHistoryTableProps): React.ReactElement {
	const [history, setHistory] = useState<AuditSummary[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		loadHistory();
	}, []);

	async function loadHistory(): Promise<void> {
		try {
			const results = await window.maestro.audit.getHistory(10);
			setHistory(results);
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

	function getStatusBadge(audit: AuditSummary): React.ReactElement {
		const errorCount = audit.anomalies.filter((a) => a.severity === 'error').length;
		const warningCount = audit.anomalies.filter((a) => a.severity === 'warning').length;

		if (errorCount > 0) {
			return (
				<span
					className="px-2 py-1 rounded text-xs"
					style={{ backgroundColor: 'rgba(239, 68, 68, 0.2)', color: '#ef4444' }}
				>
					{errorCount} errors
				</span>
			);
		}
		if (warningCount > 0) {
			return (
				<span
					className="px-2 py-1 rounded text-xs"
					style={{ backgroundColor: 'rgba(234, 179, 8, 0.2)', color: '#eab308' }}
				>
					{warningCount} warnings
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
						Status
					</th>
				</tr>
			</thead>
			<tbody>
				{history.map((audit, i) => (
					<tr
						key={i}
						className="border-b hover:bg-opacity-50 transition-colors"
						style={{
							borderColor: theme.colors.border,
						}}
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
						<td className="py-2">{getStatusBadge(audit)}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}
