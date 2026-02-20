/**
 * DatasourceComparisonTab
 *
 * Main tab container for "Global Token Usage, Datasource Comparison".
 * Assembles sub-components: SummaryCards, FlushStatus, DivergenceTable,
 * PlanBudgetTracker, and inline calibration form.
 *
 * @see Investigation plan Section 21
 */

import { useState, useCallback, useRef } from 'react';
import { RefreshCw, ExternalLink } from 'lucide-react';
import type { Theme } from '../../types';
import type { PlanCalibration } from '../../types';
import type { HoneycombUsageData } from '../../hooks/useHoneycombUsage';
import { DatasourceSummaryCards } from './DatasourceSummaryCards';
import type { DatasourceSummaryData } from './DatasourceSummaryCards';
import { FlushStatusIndicator } from './FlushStatusIndicator';
import type { FlushStatusData } from './FlushStatusIndicator';
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
	// Flush status from LocalTokenLedger
	flushStatus: FlushStatusData | null;
	// Calibration state
	calibration: PlanCalibration;
	onCalibrationUpdate: (updated: PlanCalibration) => void;
	// Divergence rows (computed by parent or hook)
	divergenceRows: DivergenceRow[];
	// Refresh callback
	onRefresh?: () => void;
	// Honeycomb billable tokens getter for calibration
	getHoneycombBillableTokens?: (window: '5hr' | 'weekly') => Promise<number>;
}

type TimeRange = '24h' | '7d' | '28d';

export function DatasourceComparisonTab({
	theme,
	honeycombUsageData,
	localCostUsd,
	localBillableTokens,
	flushStatus,
	calibration,
	onCalibrationUpdate,
	divergenceRows,
	onRefresh,
	getHoneycombBillableTokens,
}: DatasourceComparisonTabProps) {
	const [timeRange, setTimeRange] = useState<TimeRange>('7d');
	const [showCalibrationHistory, setShowCalibrationHistory] = useState(false);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const calibrationRef = useRef<HTMLDivElement>(null);

	const handleRefresh = useCallback(() => {
		if (!onRefresh || isRefreshing) return;
		setIsRefreshing(true);
		onRefresh();
		setTimeout(() => setIsRefreshing(false), 3000);
	}, [onRefresh, isRefreshing]);

	const handleCalibrateClick = useCallback(() => {
		calibrationRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, []);

	// Build summary data
	const summaryData: DatasourceSummaryData | null = honeycombUsageData
		? {
				localCostUsd,
				localBillableTokens,
				honeycombCostUsd: honeycombUsageData.weeklySpendUsd,
				honeycombBillableTokens: 0, // Will be populated when HoneycombUsageService provides token counts
				calibrationPointCount: calibration.calibrationPoints.length,
				calibrationConfidencePct: Math.max(
					calibration.currentEstimates.fiveHour.confidencePct,
					calibration.currentEstimates.weekly.confidencePct
				),
				flushState: flushStatus?.state || 'stale',
			}
		: null;

	// Build budget data
	const fiveHourBudget: BudgetWindowData | null =
		calibration.currentEstimates.fiveHour.weightedMean > 0
			? {
					localTokens: localBillableTokens,
					honeycombTokens: 0, // Will be populated when HoneycombUsageService provides token counts
					calibratedBudget: calibration.currentEstimates.fiveHour.weightedMean,
					resetLabel: 'Rolling 5-hour window',
				}
			: null;

	const weeklyBudget: BudgetWindowData | null =
		calibration.currentEstimates.weekly.weightedMean > 0
			? {
					localTokens: localBillableTokens,
					honeycombTokens: 0, // Will be populated when HoneycombUsageService provides token counts
					calibratedBudget: calibration.currentEstimates.weekly.weightedMean,
					resetLabel: `Resets: ${calibration.weeklyResetDay} ${calibration.weeklyResetTime}`,
				}
			: null;

	return (
		<div className="space-y-4">
			{/* Title and external link */}
			<div className="flex items-center justify-between mb-2">
				<div className="text-xs font-medium" style={{ color: theme.colors.textMain }}>
					Data Source Comparison
				</div>
				<a
					href="https://ui.honeycomb.io"
					target="_blank"
					rel="noopener noreferrer"
					className="flex items-center gap-1 text-xs hover:opacity-80 transition-opacity"
					style={{ color: theme.colors.accent }}
				>
					<ExternalLink size={10} />
					Open in Honeycomb
				</a>
			</div>

			{/* Header with time range and refresh */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					{(['24h', '7d', '28d'] as TimeRange[]).map((range) => (
						<button
							key={range}
							onClick={() => setTimeRange(range)}
							className="px-3 py-1 text-xs rounded-md border transition-colors"
							style={{
								backgroundColor: timeRange === range ? theme.colors.accent : 'transparent',
								color: timeRange === range ? theme.colors.accentForeground : theme.colors.textDim,
								borderColor: timeRange === range ? theme.colors.accent : theme.colors.border,
							}}
						>
							{range}
						</button>
					))}
				</div>

				{onRefresh && (
					<button
						onClick={handleRefresh}
						disabled={isRefreshing}
						className="flex items-center gap-1.5 px-3 py-1 text-xs rounded-md border transition-colors hover:opacity-80"
						style={{
							borderColor: theme.colors.border,
							color: theme.colors.textMain,
						}}
					>
						<RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
						Refresh Now
					</button>
				)}
			</div>

			{/* Summary Cards */}
			<DatasourceSummaryCards theme={theme} data={summaryData} />

			{/* Flush Status */}
			<FlushStatusIndicator
				theme={theme}
				flushStatus={flushStatus}
				lastCalibratedAt={calibration.lastCalibratedAt}
				onCalibrateClick={handleCalibrateClick}
			/>

			{/* Divergence Table */}
			<div className="rounded-lg border" style={{ borderColor: theme.colors.border }}>
				<div
					className="px-3 py-2 text-xs font-semibold border-b"
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

			{/* Plan Budget Tracker */}
			<div className="rounded-lg border p-3" style={{ borderColor: theme.colors.border }}>
				<div className="text-xs font-semibold mb-3" style={{ color: theme.colors.textMain }}>
					Plan Budget Tracker
				</div>
				<PlanBudgetTracker theme={theme} fiveHour={fiveHourBudget} weekly={weeklyBudget} />
			</div>

			{/* Inline Calibration */}
			<div
				ref={calibrationRef}
				className="rounded-lg border p-3"
				style={{ borderColor: theme.colors.border }}
			>
				<PlanCalibrationSettings
					theme={theme}
					calibration={calibration}
					onCalibrationUpdate={onCalibrationUpdate}
					onViewHistory={() => setShowCalibrationHistory(true)}
					getHoneycombBillableTokens={getHoneycombBillableTokens}
				/>
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
