/**
 * DivergenceTable
 *
 * Tabular daily breakdown of Local vs Honeycomb with computed deltas.
 * Footer shows average divergence, max divergence, and directional pattern.
 *
 * @see Investigation plan Section 21.3.4
 */

import type { Theme } from '../../types';
import { formatTokenCount } from '../../utils/calibration';

export interface DivergenceRow {
	period: string;
	localCostUsd: number;
	honeycombCostUsd: number;
	deltaTokens: number;
	deltaPct: number;
}

export interface DivergenceTableProps {
	theme: Theme;
	rows: DivergenceRow[];
}

function getStatus(deltaPct: number): { label: string; color: string } {
	const absPct = Math.abs(deltaPct);
	if (absPct > 10) return { label: '▲▲ High', color: '#ef4444' };
	if (absPct > 5) return { label: '▲ Elevated', color: '#eab308' };
	return { label: '● Normal', color: '#22c55e' };
}

export function DivergenceTable({ theme, rows }: DivergenceTableProps) {
	if (rows.length === 0) {
		return (
			<div className="text-sm py-4 text-center" style={{ color: theme.colors.textDim }}>
				No divergence data available for the selected time range.
			</div>
		);
	}

	const avgDivergence = rows.reduce((sum, r) => sum + Math.abs(r.deltaPct), 0) / rows.length;
	const maxRow = rows.reduce(
		(max, r) => (Math.abs(r.deltaPct) > Math.abs(max.deltaPct) ? r : max),
		rows[0]
	);
	const localHigherCount = rows.filter((r) => r.deltaPct > 0).length;
	const pattern = localHigherCount > rows.length / 2 ? 'Local > HC' : 'HC > Local';

	return (
		<div>
			<div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: '105px' }}>
				<table className="w-full text-sm">
					<thead className="sticky top-0" style={{ backgroundColor: theme.colors.bgMain }}>
						<tr style={{ borderBottom: `1px solid ${theme.colors.border}` }}>
							{['Period', 'Local ($)', 'Honeycomb ($)', 'HC Tokens', 'Δ %', 'Status'].map((h) => (
								<th
									key={h}
									className="px-3 py-2 text-left font-medium"
									style={{ color: theme.colors.textDim }}
								>
									{h}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => {
							const status = getStatus(row.deltaPct);
							return (
								<tr key={row.period} style={{ borderBottom: `1px solid ${theme.colors.border}` }}>
									<td className="px-3 py-2" style={{ color: theme.colors.textMain }}>
										{row.period}
									</td>
									<td className="px-3 py-2 font-mono" style={{ color: theme.colors.textMain }}>
										${row.localCostUsd.toFixed(2)}
									</td>
									<td className="px-3 py-2 font-mono" style={{ color: theme.colors.textMain }}>
										${row.honeycombCostUsd.toFixed(2)}
									</td>
									<td className="px-3 py-2 font-mono" style={{ color: theme.colors.textMain }}>
										{row.deltaTokens > 0 ? formatTokenCount(row.deltaTokens) : '—'}
									</td>
									<td className="px-3 py-2 font-mono" style={{ color: theme.colors.textMain }}>
										{row.deltaPct >= 0 ? '+' : ''}
										{row.deltaPct.toFixed(1)}%
									</td>
									<td className="px-3 py-2">
										<span style={{ color: status.color }}>{status.label}</span>
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>

			{/* Footer summary */}
			<div
				className="flex items-center gap-4 px-3 py-2 text-sm border-t"
				style={{ borderColor: theme.colors.border, color: theme.colors.textDim }}
			>
				<span>Avg divergence: {avgDivergence.toFixed(1)}%</span>
				<span>
					Max: {Math.abs(maxRow.deltaPct).toFixed(1)}% ({maxRow.period})
				</span>
				<span>Pattern: {pattern}</span>
			</div>
		</div>
	);
}
