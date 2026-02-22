/**
 * DatasourceSummaryCards
 *
 * Four summary cards: Local, Honeycomb, Divergence, Confidence.
 * Driven by the time range selector.
 *
 * @see Investigation plan Section 21.3.1
 */

import type { Theme } from '../../types';
import { TokenBreakdownTooltip } from './TokenBreakdownTooltip';
import type { TokenBreakdown } from './TokenBreakdownTooltip';

export interface DatasourceSummaryData {
	localCostUsd: number;
	localBillableTokens: number;
	honeycombCostUsd: number;
	honeycombBillableTokens: number;
	calibrationPointCount: number;
	calibrationConfidencePct: number;
	// Per-type token breakdown (optional, for tooltip display)
	localInputTokens?: number;
	localOutputTokens?: number;
	localCacheCreationTokens?: number;
	honeycombInputTokens?: number;
	honeycombOutputTokens?: number;
	honeycombCacheCreationTokens?: number;
}

export interface DatasourceSummaryCardsProps {
	theme: Theme;
	data: DatasourceSummaryData | null;
}

type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

function getConfidenceLevel(data: DatasourceSummaryData): ConfidenceLevel {
	// Effective confidence = calibration convergence scaled by sample size
	// This scales down confidence when few points exist (even if they cluster tightly)
	// and lets the underlying convergence math drive the rating with enough data.
	const pointScalar = Math.min(1, data.calibrationPointCount / 5);
	const effective = data.calibrationConfidencePct * pointScalar;

	if (effective > 85) return 'HIGH';
	if (effective > 50) return 'MEDIUM';
	return 'LOW';
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

	const localBreakdown: TokenBreakdown | undefined =
		data.localInputTokens !== undefined
			? {
					inputTokens: data.localInputTokens ?? 0,
					outputTokens: data.localOutputTokens ?? 0,
					cacheCreationTokens: data.localCacheCreationTokens ?? 0,
					costUsd: data.localCostUsd,
					billableTokens: data.localBillableTokens,
				}
			: undefined;

	const hcBreakdown: TokenBreakdown | undefined =
		data.honeycombInputTokens !== undefined
			? {
					inputTokens: data.honeycombInputTokens ?? 0,
					outputTokens: data.honeycombOutputTokens ?? 0,
					cacheCreationTokens: data.honeycombCacheCreationTokens ?? 0,
					costUsd: data.honeycombCostUsd,
					billableTokens: data.honeycombBillableTokens,
				}
			: undefined;

	const cards = [
		{
			label: 'Local',
			value: `$${data.localCostUsd.toFixed(2)}`,
			sub: `${formatTokens(data.localBillableTokens)} tokens`,
			breakdown: localBreakdown,
		},
		{
			label: 'Honeycomb',
			value: `$${data.honeycombCostUsd.toFixed(2)}`,
			sub: `${formatTokens(data.honeycombBillableTokens)} tokens`,
			breakdown: hcBreakdown,
		},
		{
			label: 'Δ Divergence',
			value: `$${divergenceUsd.toFixed(2)} (${divergencePct.toFixed(1)}%)`,
			sub: `${formatTokens(divergenceTokens)} tokens`,
			comparison:
				localBreakdown && hcBreakdown
					? { local: localBreakdown, honeycomb: hcBreakdown }
					: undefined,
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
				<TokenBreakdownTooltip
					key={card.label}
					theme={theme}
					breakdown={(card as any).breakdown}
					comparison={(card as any).comparison}
				>
					<div
						className="rounded-lg p-4 cursor-default"
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
				</TokenBreakdownTooltip>
			))}
		</div>
	);
}
