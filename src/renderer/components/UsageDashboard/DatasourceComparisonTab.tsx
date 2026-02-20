/**
 * DatasourceComparisonTab
 *
 * Main tab container for "Global Token Usage, Datasource Comparison".
 * Assembles sub-components: SummaryCards, FlushStatus, DivergenceTable,
 * PlanBudgetTracker, and inline calibration form.
 *
 * @see Investigation plan Section 21
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { RefreshCw, ExternalLink, BarChart3, Crosshair } from 'lucide-react';
import type { Theme } from '../../types';
import type { PlanCalibration } from '../../types';
import type { HoneycombUsageData } from '../../hooks/useHoneycombUsage';
import { DatasourceSummaryCards } from './DatasourceSummaryCards';
import type { DatasourceSummaryData } from './DatasourceSummaryCards';
import { DivergenceTable } from './DivergenceTable';
import type { DivergenceRow } from './DivergenceTable';
import { PlanBudgetTracker } from './PlanBudgetTracker';
import type { BudgetWindowData } from './PlanBudgetTracker';
import { PlanCalibrationSettings } from '../PlanCalibrationSettings';
import { CalibrationHistoryModal } from '../CalibrationHistoryModal';

export interface DatasourceComparisonTabProps {
	theme: Theme;
	// Honeycomb data from useHoneycombUsage hook
	honeycombUsageData: HoneycombUsageData | null;
	// Local stats data (from existing stats-db)
	localCostUsd: number;
	localBillableTokens: number;
	// Calibration state
	calibration: PlanCalibration;
	onCalibrationUpdate: (updated: PlanCalibration) => void;
	// Refresh callback
	onRefresh?: () => void;
	// Honeycomb billable tokens getter for calibration
	getHoneycombBillableTokens?: (window: '5hr' | 'weekly') => Promise<number>;
}

export function DatasourceComparisonTab({
	theme,
	honeycombUsageData,
	localCostUsd,
	localBillableTokens,
	calibration,
	onCalibrationUpdate,
	onRefresh,
	getHoneycombBillableTokens,
}: DatasourceComparisonTabProps) {
	const [showCalibrationHistory, setShowCalibrationHistory] = useState(false);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const calibrationRef = useRef<HTMLDivElement>(null);

	const [planLabel, setPlanLabel] = useState<string>('');

	// Detect billing plan from recent stats
	useEffect(() => {
		window.maestro.stats
			.getCostsByAgent('week')
			.then((agents) => {
				if (!agents || agents.length === 0) return;
				// Find the most common billing mode across agents
				const modes = agents.map((a: { billingMode: string }) => a.billingMode).filter(Boolean);
				if (modes.length === 0) return;
				const modeCount: Record<string, number> = {};
				for (const m of modes) {
					modeCount[m] = (modeCount[m] || 0) + 1;
				}
				const dominant = Object.entries(modeCount).sort((a, b) => b[1] - a[1])[0][0];
				const labels: Record<string, string> = {
					max: 'Max Plan',
					api: 'API Plan',
					free: 'Free Plan',
				};
				setPlanLabel(labels[dominant] || dominant);
			})
			.catch(() => {});
	}, []);

	const [divergenceRows, setDivergenceRows] = useState<DivergenceRow[]>([]);

	// Compute divergence rows from archived Honeycomb data + local stats
	useEffect(() => {
		async function computeDivergence() {
			try {
				// Calculate date range (last 7 days)
				const endDate = new Date();
				endDate.setDate(endDate.getDate() - 1); // Yesterday
				const startDate = new Date(endDate);
				startDate.setDate(startDate.getDate() - 6); // 7 days back

				const fmt = (d: Date) => d.toISOString().split('T')[0];
				const startStr = fmt(startDate);
				const endStr = fmt(endDate);

				// Fetch both data sources in parallel
				const [archiveRows, localCosts] = await Promise.all([
					window.maestro.honeycomb.getArchivedDailyData('daily_cost_by_model', startStr, endStr),
					window.maestro.stats.getDailyCosts('week'),
				]);

				// Sum Honeycomb cost per day across model breakdowns
				const hcCostByDate: Record<string, number> = {};
				for (const row of archiveRows as Array<{ date: string; data: { value?: number } }>) {
					const val = typeof row.data?.value === 'number' ? row.data.value : 0;
					hcCostByDate[row.date] = (hcCostByDate[row.date] || 0) + val;
				}

				// Build local cost lookup
				const localCostByDate: Record<string, number> = {};
				for (const row of localCosts) {
					localCostByDate[row.date] = row.localCost;
				}

				// Get all unique dates from both sources
				const allDates = [
					...new Set([...Object.keys(hcCostByDate), ...Object.keys(localCostByDate)]),
				].sort();

				// Build divergence rows
				const rows: DivergenceRow[] = allDates.map((date) => {
					const localCost = localCostByDate[date] ?? 0;
					const hcCost = hcCostByDate[date] ?? 0;
					const deltaCost = localCost - hcCost;
					const deltaPct = hcCost > 0 ? (deltaCost / hcCost) * 100 : 0;

					return {
						period: date,
						localCostUsd: localCost,
						honeycombCostUsd: hcCost,
						deltaTokens: 0, // Archive stores cost, not tokens
						deltaPct,
					};
				});

				setDivergenceRows(rows);
			} catch (err) {
				console.warn('[DatasourceComparisonTab] Failed to compute divergence:', err);
			}
		}

		computeDivergence();
	}, []);

	const handleRefresh = useCallback(() => {
		if (!onRefresh || isRefreshing) return;
		setIsRefreshing(true);
		onRefresh();
		setTimeout(() => setIsRefreshing(false), 3000);
	}, [onRefresh, isRefreshing]);

	// Build summary data
	const summaryData: DatasourceSummaryData | null = honeycombUsageData
		? {
				localCostUsd,
				localBillableTokens,
				honeycombCostUsd: honeycombUsageData.weeklySpendUsd,
				honeycombBillableTokens: honeycombUsageData.weeklyBillableTokens,
				calibrationPointCount: calibration.calibrationPoints.length,
				calibrationConfidencePct: Math.max(
					calibration.currentEstimates.fiveHour.confidencePct,
					calibration.currentEstimates.weekly.confidencePct
				),
				flushState: 'stale',
			}
		: null;

	// Build budget data
	const fiveHourBudget: BudgetWindowData | null =
		calibration.currentEstimates.fiveHour.weightedMean > 0
			? {
					localTokens: localBillableTokens,
					honeycombTokens: honeycombUsageData?.fiveHourBillableTokens ?? 0,
					calibratedBudget: calibration.currentEstimates.fiveHour.weightedMean,
					resetLabel: 'Rolling 5-hour window',
				}
			: null;

	const weeklyBudget: BudgetWindowData | null =
		calibration.currentEstimates.weekly.weightedMean > 0
			? {
					localTokens: localBillableTokens,
					honeycombTokens: honeycombUsageData?.weeklyBillableTokens ?? 0,
					calibratedBudget: calibration.currentEstimates.weekly.weightedMean,
					resetLabel: `Resets: ${calibration.weeklyResetDay} ${calibration.weeklyResetTime}`,
				}
			: null;

	return (
		<div className="space-y-4">
			{/* Title + Actions row */}
			<div className="flex items-center justify-between">
				<a
					href="https://ui.honeycomb.io"
					target="_blank"
					rel="noopener noreferrer"
					className="flex items-center gap-1.5 text-sm hover:opacity-80 transition-opacity"
					style={{ color: theme.colors.accent }}
				>
					<ExternalLink size={14} />
					Open in Honeycomb
				</a>
				{onRefresh && (
					<button
						onClick={handleRefresh}
						disabled={isRefreshing}
						className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border transition-colors hover:opacity-80"
						style={{
							borderColor: theme.colors.border,
							color: theme.colors.textMain,
						}}
					>
						<RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
						Refresh Now
					</button>
				)}
			</div>

			{/* Summary Cards */}
			<DatasourceSummaryCards theme={theme} data={summaryData} />

			{/* Divergence Table */}
			<div className="rounded-lg border" style={{ borderColor: theme.colors.border }}>
				<div
					className="px-3 py-2 text-sm font-semibold border-b"
					style={{
						color: theme.colors.textMain,
						borderColor: theme.colors.border,
						backgroundColor: theme.colors.bgActivity,
					}}
				>
					Divergence Table
				</div>
				<DivergenceTable theme={theme} rows={divergenceRows} />
			</div>

			{/* Budget Tracker (left) + Calibration (right) */}
			<div className="grid grid-cols-2 gap-4">
				<div className="rounded-lg border p-3" style={{ borderColor: theme.colors.border }}>
					<div className="flex items-center justify-between mb-3">
						<div className="flex items-center gap-2">
							<BarChart3 className="w-4 h-4" style={{ color: theme.colors.textMain }} />
							<span className="text-sm font-semibold" style={{ color: theme.colors.textMain }}>
								Plan Budget Tracker
							</span>
						</div>
						{planLabel && (
							<span
								className="text-xs px-2 py-0.5 rounded-full font-medium"
								style={{
									backgroundColor: `${theme.colors.accent}15`,
									color: theme.colors.textMain,
								}}
							>
								{planLabel}
							</span>
						)}
					</div>
					<PlanBudgetTracker theme={theme} fiveHour={fiveHourBudget} weekly={weeklyBudget} />
				</div>

				<div
					ref={calibrationRef}
					className="rounded-lg border p-3"
					style={{ borderColor: theme.colors.border }}
				>
					<div className="flex items-center gap-2 mb-3">
						<Crosshair className="w-4 h-4" style={{ color: theme.colors.textMain }} />
						<span className="text-sm font-semibold" style={{ color: theme.colors.textMain }}>
							Plan Calibration
						</span>
					</div>
					<PlanCalibrationSettings
						theme={theme}
						calibration={calibration}
						onCalibrationUpdate={onCalibrationUpdate}
						onViewHistory={() => setShowCalibrationHistory(true)}
						getHoneycombBillableTokens={getHoneycombBillableTokens}
					/>
				</div>
			</div>

			{/* Calibration History Modal */}
			<CalibrationHistoryModal
				theme={theme}
				calibration={calibration}
				isOpen={showCalibrationHistory}
				onClose={() => setShowCalibrationHistory(false)}
			/>
		</div>
	);
}
