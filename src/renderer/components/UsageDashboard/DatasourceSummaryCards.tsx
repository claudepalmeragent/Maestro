/**
 * DatasourceSummaryCards
 *
 * Four summary cards: Local, Honeycomb, Divergence, Confidence.
 * Driven by the time range selector.
 *
 * @see Investigation plan Section 21.3.1
 */

import type { Theme } from '../../types';

export interface DatasourceSummaryData {
	localCostUsd: number;
	localBillableTokens: number;
	honeycombCostUsd: number;
	honeycombBillableTokens: number;
	calibrationPointCount: number;
	calibrationConfidencePct: number;
	flushState: 'synced' | 'pending' | 'stale';
}

export interface DatasourceSummaryCardsProps {
	theme: Theme;
	data: DatasourceSummaryData | null;
}

type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

function getConfidenceLevel(data: DatasourceSummaryData): ConfidenceLevel {
	const divergencePct =
		data.honeycombCostUsd > 0
			? (Math.abs(data.localCostUsd - data.honeycombCostUsd) / data.honeycombCostUsd) * 100
			: 0;

	if (
		data.calibrationPointCount >= 3 &&
		data.calibrationConfidencePct > 90 &&
		divergencePct < 5 &&
		data.flushState === 'synced'
	) {
		return 'HIGH';
	}

	if (data.calibrationPointCount === 0 || divergencePct > 10 || data.flushState === 'stale') {
		return 'LOW';
	}

	return 'MEDIUM';
}

const confidenceColors: Record<ConfidenceLevel, string> = {
	HIGH: '#22c55e',
	MEDIUM: '#eab308',
	LOW: '#ef4444',
};

function formatTokens(tokens: number): string {
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
	if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
	return tokens.toLocaleString();
}

export function DatasourceSummaryCards({ theme, data }: DatasourceSummaryCardsProps) {
	if (!data) {
		return (
			<div className="grid grid-cols-4 gap-3">
				{[1, 2, 3, 4].map((i) => (
					<div
						key={i}
						className="rounded-lg p-4 animate-pulse"
						style={{ backgroundColor: theme.colors.bgActivity, height: '80px' }}
					/>
				))}
			</div>
		);
	}

	const divergenceUsd = Math.abs(data.localCostUsd - data.honeycombCostUsd);
	const divergenceTokens = Math.abs(data.localBillableTokens - data.honeycombBillableTokens);
	const divergencePct =
		data.honeycombCostUsd > 0 ? (divergenceUsd / data.honeycombCostUsd) * 100 : 0;
	const confidence = getConfidenceLevel(data);

	const cards = [
		{
			label: 'Local',
			value: `$${data.localCostUsd.toFixed(2)}`,
			sub: `${formatTokens(data.localBillableTokens)} tokens`,
		},
		{
			label: 'Honeycomb',
			value: `$${data.honeycombCostUsd.toFixed(2)}`,
			sub: `${formatTokens(data.honeycombBillableTokens)} tokens`,
		},
		{
			label: 'Δ Divergence',
			value: `$${divergenceUsd.toFixed(2)} (${divergencePct.toFixed(1)}%)`,
			sub: `${formatTokens(divergenceTokens)} tokens`,
		},
		{
			label: 'Confidence',
			value: confidence,
			sub: `${data.calibrationPointCount} calibration${data.calibrationPointCount !== 1 ? 's' : ''}`,
			color: confidenceColors[confidence],
		},
	];

	return (
		<div className="grid grid-cols-4 gap-3">
			{cards.map((card) => (
				<div
					key={card.label}
					className="rounded-lg p-4"
					style={{
						backgroundColor: theme.colors.bgActivity,
						border: `1px solid ${theme.colors.border}`,
					}}
				>
					<div
						className="text-xs font-medium uppercase tracking-wide mb-1"
						style={{ color: theme.colors.textDim }}
					>
						{card.label}
					</div>
					<div
						className="text-2xl font-bold"
						style={{ color: card.color || theme.colors.textMain }}
					>
						{card.label === 'Confidence' && <span style={{ color: card.color }}>● </span>}
						{card.value}
					</div>
					<div className="text-xs mt-1" style={{ color: theme.colors.textDim }}>
						{card.sub}
					</div>
				</div>
			))}
		</div>
	);
}
