/**
 * PlanBudgetTracker
 *
 * Progress bars for 5-hour and weekly windows using calibrated budgets.
 * Shows both Local and Honeycomb token totals under each bar.
 * Percentage uses Honeycomb tokens (authoritative billing source).
 *
 * @see Investigation plan Section 21.3.5
 */

import type { Theme } from '../../types';

export interface BudgetWindowData {
	localTokens: number;
	honeycombTokens: number;
	calibratedBudget: number;
	resetLabel: string;
}

export interface PlanBudgetTrackerProps {
	theme: Theme;
	fiveHour: BudgetWindowData | null;
	weekly: BudgetWindowData | null;
}

function formatTokens(tokens: number): string {
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
	if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
	return tokens.toLocaleString();
}

function BudgetBar({
	theme,
	label,
	data,
}: {
	theme: Theme;
	label: string;
	data: BudgetWindowData;
}) {
	const pct =
		data.calibratedBudget > 0
			? Math.min(100, (data.honeycombTokens / data.calibratedBudget) * 100)
			: 0;

	const barColor = pct >= 85 ? '#ef4444' : pct >= 60 ? '#eab308' : theme.colors.accent;

	return (
		<div className="flex-1">
			<div className="flex items-center justify-between mb-1">
				<span className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
					{label}
				</span>
				<span className="text-sm font-mono font-bold" style={{ color: barColor }}>
					{pct.toFixed(0)}%
				</span>
			</div>

			{/* Progress bar */}
			<div
				className="h-3 rounded-full overflow-hidden"
				style={{ backgroundColor: theme.colors.bgActivity }}
			>
				<div
					className="h-full rounded-full transition-all"
					style={{
						width: `${pct}%`,
						backgroundColor: barColor,
					}}
				/>
			</div>

			{/* Source breakdown */}
			<div className="flex justify-between mt-1 text-xs" style={{ color: theme.colors.textDim }}>
				<span>
					Local: {formatTokens(data.localTokens)} / ~{formatTokens(data.calibratedBudget)}
				</span>
				<span>
					HC: {formatTokens(data.honeycombTokens)} / ~{formatTokens(data.calibratedBudget)}
				</span>
			</div>

			{/* Reset time */}
			<div className="text-xs mt-0.5" style={{ color: theme.colors.textDim }}>
				{data.resetLabel}
			</div>
		</div>
	);
}

export function PlanBudgetTracker({ theme, fiveHour, weekly }: PlanBudgetTrackerProps) {
	if (!fiveHour && !weekly) {
		return (
			<div className="text-sm py-4 text-center" style={{ color: theme.colors.textDim }}>
				Budget tracking requires calibration data. Enter values from the Claude usage page below.
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			{fiveHour && <BudgetBar theme={theme} label="5-Hour Window" data={fiveHour} />}
			{weekly && <BudgetBar theme={theme} label="Weekly Limit" data={weekly} />}
		</div>
	);
}
