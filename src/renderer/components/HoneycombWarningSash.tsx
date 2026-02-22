/**
 * HoneycombWarningSash
 *
 * Warning banner that shows when Honeycomb usage data approaches plan limits.
 * Mirrors ContextWarningSash pattern with smart dismissal.
 *
 * Displays below ContextWarningSash in InputArea when active.
 * Shows 5-hour window and/or weekly spend warnings.
 *
 * @see Investigation plan Section 18.4
 */

import { useMemo, useState, useEffect, useCallback } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import type { Theme } from '../types';
import type { HoneycombUsageData } from '../hooks/useHoneycombUsage';

export interface HoneycombWarningSashProps {
	theme: Theme;
	usageData: HoneycombUsageData | null;
	enabled: boolean;
	// USD thresholds
	fiveHourYellowUsd: number;
	fiveHourRedUsd: number;
	weeklyYellowUsd: number;
	weeklyRedUsd: number;
	// Percentage-of-budget thresholds
	fiveHourYellowPct?: number;
	fiveHourRedPct?: number;
	weeklyYellowPct?: number;
	weeklyRedPct?: number;
	// Warning mode: which thresholds to evaluate
	warningMode?: 'usd' | 'percentage' | 'both';
	// Calibrated budget values (needed for percentage calculation)
	fiveHourBudgetTokens?: number;
	weeklyBudgetTokens?: number;
	// Optional: track tab for per-tab dismissal
	tabId?: string;
	/** Callback to open Usage Dashboard to DS Comparison tab */
	onViewUsageDashboard?: () => void;
}

type WarningLevel = 'yellow' | 'red' | null;
type WarningDimension = '5hr' | 'weekly';

interface ActiveWarning {
	dimension: WarningDimension;
	level: 'yellow' | 'red';
	spendUsd: number;
	message: string;
}

// Re-show threshold: dismissed spend must increase by 15% to re-show
const RESHOW_INCREASE_PCT = 0.15;

export function HoneycombWarningSash({
	theme,
	usageData,
	enabled,
	fiveHourYellowUsd,
	fiveHourRedUsd,
	weeklyYellowUsd,
	weeklyRedUsd,
	fiveHourYellowPct = 60,
	fiveHourRedPct = 85,
	weeklyYellowPct = 70,
	weeklyRedPct = 90,
	warningMode = 'both',
	fiveHourBudgetTokens = 0,
	weeklyBudgetTokens = 0,
	tabId,
	onViewUsageDashboard,
}: HoneycombWarningSashProps) {
	const [dismissedAt, setDismissedAt] = useState<{
		spendUsd: number;
		level: WarningLevel;
		dimension: WarningDimension;
	} | null>(null);

	// Reset dismissal when tab changes
	useEffect(() => {
		setDismissedAt(null);
	}, [tabId]);

	// Determine the most severe active warning
	const activeWarning = useMemo((): ActiveWarning | null => {
		if (!enabled || !usageData) return null;

		const checkUsd = warningMode === 'usd' || warningMode === 'both';
		const checkPct = warningMode === 'percentage' || warningMode === 'both';

		// --- 5-hour window checks (tighter constraint, check first) ---

		// Percentage check (tokens vs calibrated budget)
		if (checkPct && fiveHourBudgetTokens > 0) {
			const fiveHourUsagePct = (usageData.fiveHourBillableTokens / fiveHourBudgetTokens) * 100;
			if (fiveHourUsagePct >= fiveHourRedPct) {
				return {
					dimension: '5hr',
					level: 'red',
					spendUsd: usageData.fiveHourSpendUsd,
					message: `5-hour usage at ${fiveHourUsagePct.toFixed(0)}% of budget — limit likely reached`,
				};
			}
			if (fiveHourUsagePct >= fiveHourYellowPct) {
				return {
					dimension: '5hr',
					level: 'yellow',
					spendUsd: usageData.fiveHourSpendUsd,
					message: `5-hour usage at ${fiveHourUsagePct.toFixed(0)}% of budget — approaching limit`,
				};
			}
		}

		// USD check
		if (checkUsd) {
			const fiveHourSpend = usageData.fiveHourSpendUsd;
			if (fiveHourSpend >= fiveHourRedUsd) {
				return {
					dimension: '5hr',
					level: 'red',
					spendUsd: fiveHourSpend,
					message: `5-hour spend at $${fiveHourSpend.toFixed(0)} — window limit likely reached`,
				};
			}
			if (fiveHourSpend >= fiveHourYellowUsd) {
				return {
					dimension: '5hr',
					level: 'yellow',
					spendUsd: fiveHourSpend,
					message: `5-hour spend at $${fiveHourSpend.toFixed(0)} — approaching window limit`,
				};
			}
		}

		// --- Weekly window checks ---

		// Percentage check (tokens vs calibrated budget)
		if (checkPct && weeklyBudgetTokens > 0) {
			const weeklyUsagePct = (usageData.weeklyBillableTokens / weeklyBudgetTokens) * 100;
			if (weeklyUsagePct >= weeklyRedPct) {
				return {
					dimension: 'weekly',
					level: 'red',
					spendUsd: usageData.weeklySpendUsd,
					message: `Weekly usage at ${weeklyUsagePct.toFixed(0)}% of budget — limit likely reached`,
				};
			}
			if (weeklyUsagePct >= weeklyYellowPct) {
				return {
					dimension: 'weekly',
					level: 'yellow',
					spendUsd: usageData.weeklySpendUsd,
					message: `Weekly usage at ${weeklyUsagePct.toFixed(0)}% of budget — approaching limit`,
				};
			}
		}

		// USD check
		if (checkUsd) {
			const weeklySpend = usageData.weeklySpendUsd;
			if (weeklySpend >= weeklyRedUsd) {
				return {
					dimension: 'weekly',
					level: 'red',
					spendUsd: weeklySpend,
					message: `Weekly spend at $${weeklySpend.toFixed(0)} — weekly limit likely reached`,
				};
			}
			if (weeklySpend >= weeklyYellowUsd) {
				return {
					dimension: 'weekly',
					level: 'yellow',
					spendUsd: weeklySpend,
					message: `Weekly spend at $${weeklySpend.toFixed(0)} — approaching weekly limit`,
				};
			}
		}

		return null;
	}, [
		enabled,
		usageData,
		warningMode,
		fiveHourYellowUsd,
		fiveHourRedUsd,
		weeklyYellowUsd,
		weeklyRedUsd,
		fiveHourYellowPct,
		fiveHourRedPct,
		weeklyYellowPct,
		weeklyRedPct,
		fiveHourBudgetTokens,
		weeklyBudgetTokens,
	]);

	// Should we show the warning?
	const shouldShow = useMemo(() => {
		if (!activeWarning) return false;
		if (!dismissedAt) return true;

		// Re-show if severity escalated
		if (dismissedAt.level === 'yellow' && activeWarning.level === 'red') {
			return true;
		}

		// Re-show if spend increased by 15%+ since dismissal
		if (
			activeWarning.dimension === dismissedAt.dimension &&
			activeWarning.spendUsd > dismissedAt.spendUsd * (1 + RESHOW_INCREASE_PCT)
		) {
			return true;
		}

		// Re-show if different dimension is now warning
		if (activeWarning.dimension !== dismissedAt.dimension) {
			return true;
		}

		return false;
	}, [activeWarning, dismissedAt]);

	const handleDismiss = useCallback(() => {
		if (activeWarning) {
			setDismissedAt({
				spendUsd: activeWarning.spendUsd,
				level: activeWarning.level,
				dimension: activeWarning.dimension,
			});
		}
	}, [activeWarning]);

	const handleViewDetails = useCallback(() => {
		if (onViewUsageDashboard) {
			onViewUsageDashboard();
		}
	}, [onViewUsageDashboard]);

	if (!shouldShow || !activeWarning) return null;

	const isRed = activeWarning.level === 'red';
	const bgColor = isRed ? `${theme.colors.error}20` : `${theme.colors.warning}20`;
	const borderColor = isRed ? theme.colors.error : theme.colors.warning;
	const iconColor = isRed ? theme.colors.error : theme.colors.warning;

	return (
		<div
			role="alert"
			aria-live="polite"
			style={{
				display: 'flex',
				alignItems: 'center',
				gap: '8px',
				padding: '6px 12px',
				backgroundColor: bgColor,
				borderTop: `1px solid ${borderColor}`,
				fontSize: '12px',
				color: theme.colors.textMain,
			}}
		>
			<AlertTriangle size={14} color={iconColor} style={{ flexShrink: 0 }} />

			<span style={{ flex: 1 }}>
				{activeWarning.message}
				{usageData?.stale && (
					<span style={{ color: theme.colors.textDim, marginLeft: '4px' }}>(stale data)</span>
				)}
			</span>

			<button
				onClick={handleViewDetails}
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: '4px',
					padding: '2px 8px',
					fontSize: '11px',
					color: theme.colors.accentForeground,
					backgroundColor: theme.colors.accent,
					border: 'none',
					borderRadius: '3px',
					cursor: 'pointer',
					whiteSpace: 'nowrap',
				}}
			>
				View Details
			</button>

			<button
				onClick={handleDismiss}
				aria-label="Dismiss warning"
				style={{
					display: 'flex',
					alignItems: 'center',
					padding: '2px',
					background: 'none',
					border: 'none',
					cursor: 'pointer',
					color: theme.colors.textDim,
					borderRadius: '2px',
				}}
			>
				<X size={14} />
			</button>
		</div>
	);
}
