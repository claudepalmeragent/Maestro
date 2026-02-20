/**
 * BudgetBarInline
 *
 * Compact percentage-only budget bars for the Model & Effort status line.
 * Shows 5-hour and weekly usage as tiny progress bars with percentages.
 * Self-hiding when no calibration data exists.
 */

import type { Theme } from '../types';

interface BudgetBarInlineProps {
	theme: Theme;
	fiveHourTokens: number;
	fiveHourBudget: number;
	weeklyTokens: number;
	weeklyBudget: number;
}

function MiniBar({ theme, label, pct }: { theme: Theme; label: string; pct: number }) {
	const barColor = pct >= 85 ? '#ef4444' : pct >= 60 ? '#eab308' : theme.colors.accent;

	return (
		<div className="flex items-center gap-1.5">
			<span style={{ color: theme.colors.textDim }}>{label}</span>
			<div
				className="rounded-full overflow-hidden"
				style={{
					width: '96px',
					height: '4px',
					backgroundColor: theme.colors.bgActivity,
				}}
			>
				<div
					className="h-full rounded-full transition-all"
					style={{
						width: `${Math.min(100, pct)}%`,
						backgroundColor: barColor,
					}}
				/>
			</div>
			<span className="font-mono font-semibold" style={{ color: barColor }}>
				{pct.toFixed(0)}%
			</span>
		</div>
	);
}

export function BudgetBarInline({
	theme,
	fiveHourTokens,
	fiveHourBudget,
	weeklyTokens,
	weeklyBudget,
}: BudgetBarInlineProps) {
	// Self-hide when no calibration exists
	if (fiveHourBudget <= 0 && weeklyBudget <= 0) return null;

	const fiveHourPct =
		fiveHourBudget > 0 ? Math.min(100, (fiveHourTokens / fiveHourBudget) * 100) : 0;
	const weeklyPct = weeklyBudget > 0 ? Math.min(100, (weeklyTokens / weeklyBudget) * 100) : 0;

	return (
		<div className="flex items-center gap-3 ml-auto">
			{fiveHourBudget > 0 && <MiniBar theme={theme} label="5hr" pct={fiveHourPct} />}
			{weeklyBudget > 0 && <MiniBar theme={theme} label="Wk" pct={weeklyPct} />}
		</div>
	);
}
