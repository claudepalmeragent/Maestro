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
	/** Fixed weekly local billable tokens for budget bars (independent of time dropdown) */
	localBillableTokensFixed?: number;
	// Calibration state
	calibration: PlanCalibration;
	onCalibrationUpdate: (updated: PlanCalibration) => void;
	// Refresh callback
	onRefresh?: () => void;
	// Honeycomb billable tokens getter for calibration
	getHoneycombBillableTokens?: (window: '5hr' | 'weekly' | 'sonnet-weekly') => Promise<number>;
	/** Currently selected time range from the dashboard dropdown */
	timeRange: 'day' | 'week' | 'month' | 'quarter' | 'year' | 'all';
	localInputTokens?: number;
	localOutputTokens?: number;
	localCacheCreationTokens?: number;
}

export function DatasourceComparisonTab({
	theme,
	honeycombUsageData,
	localCostUsd,
	localBillableTokens,
	localBillableTokensFixed,
	calibration,
	onCalibrationUpdate,
	onRefresh,
	getHoneycombBillableTokens,
	timeRange,
	localInputTokens,
	localOutputTokens,
	localCacheCreationTokens,
}: DatasourceComparisonTabProps) {
	const [showCalibrationHistory, setShowCalibrationHistory] = useState(false);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const calibrationRef = useRef<HTMLDivElement>(null);

	const [planLabel, setPlanLabel] = useState<string>('');

	const [freeTokenStats, setFreeTokenStats] = useState<{
		totalBillableTokens: number;
		totalInputTokens: number;
		totalOutputTokens: number;
		totalCacheCreationTokens: number;
	} | null>(null);

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

	// Fetch free token stats from local stats DB for Local Models budget
	useEffect(() => {
		let mounted = true;
		const fetchFreeStats = async () => {
			try {
				const stats = await window.maestro.stats.getFreeTokenStats(timeRange);
				if (mounted) setFreeTokenStats(stats);
			} catch {
				// Silently ignore — free token stats are informational only
			}
		};
		fetchFreeStats();
		return () => {
			mounted = false;
		};
	}, [timeRange]);

	const [divergenceRows, setDivergenceRows] = useState<DivergenceRow[]>([]);

	// Compute divergence rows from live Honeycomb queries + local stats
	useEffect(() => {
		async function computeDivergence() {
			try {
				// Map time range to seconds for the HC query
				const timeRangeSeconds: Record<string, number> = {
					day: 86400,
					week: 604800,
					month: 2592000,
					year: 31536000,
					all: 31536000,
				};
				const seconds = timeRangeSeconds[timeRange] || 604800;

				// Fetch local data
				const localCosts = await window.maestro.stats.getDailyCosts(timeRange);

				// Build local cost lookup
				const localCostByDate: Record<string, number> = {};
				for (const row of localCosts) {
					localCostByDate[row.date] = row.localCost;
				}

				// Strategy: Use calculated_fields + breakdowns to get per-day data from MCP.
				// The FORMAT_TIME function converts the timestamp to a date string,
				// and using it as a breakdown gives us one row per date in the markdown table.
				const hcByDate: Record<
					string,
					{ cost: number; input: number; output: number; cache: number }
				> = {};

				const extractNum = (obj: Record<string, unknown>, key: string): number => {
					const v = obj[key];
					return typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) || 0 : 0;
				};

				// Attempt 1: calculated_fields + breakdowns for per-day data
				let primaryFailed = false;
				try {
					const hcResult = (await window.maestro.honeycomb.query(
						{
							calculated_fields: [
								{ name: 'day_bucket', expression: 'FORMAT_TIME("%Y-%m-%d", $.__timestamp__)' },
							],
							calculations: [
								{ op: 'SUM', column: 'cost_usd', name: 'cost' },
								{ op: 'SUM', column: 'input_tokens', name: 'input' },
								{ op: 'SUM', column: 'output_tokens', name: 'output' },
								{ op: 'SUM', column: 'cache_creation_tokens', name: 'cache_create' },
							],
							filters: [{ column: 'model', op: 'starts-with', value: 'claude-' }],
							breakdowns: ['day_bucket'],
							orders: [{ column: 'day_bucket', order: 'ascending' }],
							time_range: seconds,
							limit: 366,
						},
						{ ttlMs: 120000, label: `divergence-daily-${timeRange}` }
					)) as {
						data?: {
							results?: Array<Record<string, unknown>>;
							series?: Array<{ time: string; data: Record<string, unknown> }>;
						};
					};

					// Process results — in MCP mode these come as flat rows with day_bucket column
					const hcResults = hcResult?.data?.results || [];
					for (const row of hcResults) {
						const dateBucket = row['day_bucket'];
						if (!dateBucket || typeof dateBucket !== 'string') continue;
						const dateStr = dateBucket.split('T')[0];
						if (!hcByDate[dateStr]) {
							hcByDate[dateStr] = { cost: 0, input: 0, output: 0, cache: 0 };
						}
						hcByDate[dateStr].cost += extractNum(row, 'cost');
						hcByDate[dateStr].input += extractNum(row, 'input');
						hcByDate[dateStr].output += extractNum(row, 'output');
						hcByDate[dateStr].cache += extractNum(row, 'cache_create');
					}

					// Also try series format (API mode)
					const hcSeries = hcResult?.data?.series || [];
					for (const point of hcSeries) {
						if (!point.time) continue;
						const dateStr = point.time.split('T')[0];
						if (!hcByDate[dateStr]) {
							hcByDate[dateStr] = { cost: 0, input: 0, output: 0, cache: 0 };
						}
						hcByDate[dateStr].cost += extractNum(point.data, 'cost');
						hcByDate[dateStr].input += extractNum(point.data, 'input');
						hcByDate[dateStr].output += extractNum(point.data, 'output');
						hcByDate[dateStr].cache += extractNum(point.data, 'cache_create');
					}

					// If primary query returned no usable data, fall through to aggregate
					if (Object.keys(hcByDate).length === 0) {
						console.warn(
							'[DatasourceComparisonTab] Per-day query returned no parseable results, falling back to aggregate'
						);
						primaryFailed = true;
					}
				} catch (err) {
					console.warn(
						'[DatasourceComparisonTab] Per-day HC query failed, trying aggregate fallback:',
						err
					);
					primaryFailed = true;
				}

				// Attempt 2: Aggregate fallback — single total row
				if (primaryFailed) {
					try {
						const fallbackResult = (await window.maestro.honeycomb.query(
							{
								calculations: [
									{ op: 'SUM', column: 'cost_usd', name: 'cost' },
									{ op: 'SUM', column: 'input_tokens', name: 'input' },
									{ op: 'SUM', column: 'output_tokens', name: 'output' },
									{ op: 'SUM', column: 'cache_creation_tokens', name: 'cache_create' },
								],
								filters: [{ column: 'model', op: 'starts-with', value: 'claude-' }],
								time_range: seconds,
							},
							{ ttlMs: 120000, label: `divergence-aggregate-${timeRange}` }
						)) as { data?: { results?: Array<Record<string, unknown>> } };

						const aggRow = fallbackResult?.data?.results?.[0];
						if (aggRow) {
							const localDates = Object.keys(localCostByDate).sort();
							if (localDates.length > 0) {
								// Show one row labeled "Total" with aggregate values
								hcByDate['Total'] = {
									cost: extractNum(aggRow, 'cost'),
									input: extractNum(aggRow, 'input'),
									output: extractNum(aggRow, 'output'),
									cache: extractNum(aggRow, 'cache_create'),
								};
								// Replace localCostByDate with a single Total row too
								const totalLocalCost = Object.values(localCostByDate).reduce(
									(sum, v) => sum + v,
									0
								);
								for (const key of Object.keys(localCostByDate)) {
									delete localCostByDate[key];
								}
								localCostByDate['Total'] = totalLocalCost;
							}
						}
					} catch (fallbackErr) {
						console.warn('[DatasourceComparisonTab] Aggregate fallback also failed:', fallbackErr);
					}
				}

				// Get all unique dates from both sources
				const allDates = [
					...new Set([...Object.keys(hcByDate), ...Object.keys(localCostByDate)]),
				].sort();

				// Build divergence rows with real cost deltas
				const rows: DivergenceRow[] = allDates.map((date) => {
					const localCost = localCostByDate[date] ?? 0;
					const hcData = hcByDate[date] ?? { cost: 0, input: 0, output: 0, cache: 0 };
					const hcCost = hcData.cost;
					const deltaCost = localCost - hcCost;
					const deltaPct = hcCost > 0 ? (deltaCost / hcCost) * 100 : localCost > 0 ? 100 : 0;
					// Compute token delta: sum of all HC token types vs local (cost-based proxy)
					const hcTotalTokens = hcData.input + hcData.output + hcData.cache;
					return {
						period: date,
						localCostUsd: localCost,
						honeycombCostUsd: hcCost,
						deltaTokens: Math.round(hcTotalTokens), // Show HC token count as reference
						deltaPct,
					};
				});

				setDivergenceRows(rows);
			} catch (err) {
				console.warn('[DatasourceComparisonTab] Failed to compute divergence:', err);
			}
		}

		computeDivergence();
	}, [timeRange]);

	// Time-range-specific Honeycomb data for Summary Cards
	const [timeRangeHcData, setTimeRangeHcData] = useState<{
		costUsd: number;
		billableTokens: number;
		inputTokens: number;
		outputTokens: number;
		cacheCreationTokens: number;
	} | null>(null);
	const [_timeRangeHcLoading, setTimeRangeHcLoading] = useState(false);
	const [timeRangeHcAllData, setTimeRangeHcAllData] = useState<{
		billableTokens: number;
		inputTokens: number;
		outputTokens: number;
		cacheCreationTokens: number;
	} | null>(null);

	// Fetch Honeycomb data matching the selected time range for Summary Cards
	useEffect(() => {
		async function fetchTimeRangeHcData() {
			const timeRangeSeconds: Record<string, number> = {
				day: 86400,
				week: 604800,
				month: 2592000,
				year: 31536000,
				all: 31536000,
			};
			const seconds = timeRangeSeconds[timeRange] || 604800;

			setTimeRangeHcLoading(true);
			try {
				// Run two queries in parallel: billable-only (cloud providers) and all tokens
				const [billableResult, allResult] = await Promise.all([
					window.maestro.honeycomb.query(
						{
							calculations: [
								{ op: 'SUM', column: 'cost_usd', name: 'total_cost' },
								{ op: 'SUM', column: 'input_tokens', name: 'input' },
								{ op: 'SUM', column: 'output_tokens', name: 'output' },
								{ op: 'SUM', column: 'cache_creation_tokens', name: 'cache_create' },
							],
							filters: [{ column: 'model', op: 'starts-with', value: 'claude-' }],
							time_range: seconds,
						},
						{ ttlMs: 60000, label: `summary-billable-${timeRange}` }
					) as Promise<{ data?: { results?: Array<Record<string, unknown>> } }>,
					window.maestro.honeycomb.query(
						{
							calculations: [
								{ op: 'SUM', column: 'input_tokens', name: 'input' },
								{ op: 'SUM', column: 'output_tokens', name: 'output' },
								{ op: 'SUM', column: 'cache_creation_tokens', name: 'cache_create' },
							],
							time_range: seconds,
						},
						{ ttlMs: 60000, label: `summary-all-${timeRange}` }
					) as Promise<{ data?: { results?: Array<Record<string, unknown>> } }>,
				]);

				const billableRow = billableResult?.data?.results?.[0] || {};
				const allRow = allResult?.data?.results?.[0] || {};

				const extractNum = (obj: Record<string, unknown>, key: string): number => {
					const v = obj[key];
					if (typeof v === 'number') return v;
					if (typeof v === 'string') return parseFloat(v) || 0;
					return 0;
				};

				setTimeRangeHcData({
					costUsd: extractNum(billableRow, 'total_cost'),
					billableTokens:
						extractNum(billableRow, 'input') +
						extractNum(billableRow, 'output') +
						extractNum(billableRow, 'cache_create'),
					inputTokens: extractNum(billableRow, 'input'),
					outputTokens: extractNum(billableRow, 'output'),
					cacheCreationTokens: extractNum(billableRow, 'cache_create'),
				});

				// Compute free tokens = all tokens minus billable tokens
				const allInput = extractNum(allRow, 'input');
				const allOutput = extractNum(allRow, 'output');
				const allCache = extractNum(allRow, 'cache_create');
				const billableInput = extractNum(billableRow, 'input');
				const billableOutput = extractNum(billableRow, 'output');
				const billableCache = extractNum(billableRow, 'cache_create');

				setTimeRangeHcAllData({
					billableTokens: allInput + allOutput + allCache,
					inputTokens: Math.max(0, allInput - billableInput),
					outputTokens: Math.max(0, allOutput - billableOutput),
					cacheCreationTokens: Math.max(0, allCache - billableCache),
				});
			} catch (err) {
				console.warn('[DatasourceComparisonTab] Failed to fetch time-range HC data:', err);
				if (honeycombUsageData) {
					setTimeRangeHcData({
						costUsd: honeycombUsageData.weeklySpendUsd,
						billableTokens: honeycombUsageData.weeklyBillableTokens,
						inputTokens: (honeycombUsageData as any).weeklyInputTokens ?? 0,
						outputTokens: (honeycombUsageData as any).weeklyOutputTokens ?? 0,
						cacheCreationTokens: (honeycombUsageData as any).weeklyCacheCreationTokens ?? 0,
					});
				}
				setTimeRangeHcAllData(null);
			} finally {
				setTimeRangeHcLoading(false);
			}
		}

		fetchTimeRangeHcData();
	}, [timeRange, honeycombUsageData]);

	const handleRefresh = useCallback(() => {
		if (!onRefresh || isRefreshing) return;
		setIsRefreshing(true);
		onRefresh();
		setTimeout(() => setIsRefreshing(false), 3000);
	}, [onRefresh, isRefreshing]);

	// Build summary data — use time-range-specific HC data if available, else fall back to weekly
	const summaryData: DatasourceSummaryData | null =
		timeRangeHcData || honeycombUsageData
			? {
					localCostUsd,
					localBillableTokens,
					honeycombCostUsd: timeRangeHcData?.costUsd ?? honeycombUsageData?.weeklySpendUsd ?? 0,
					honeycombBillableTokens:
						timeRangeHcData?.billableTokens ?? honeycombUsageData?.weeklyBillableTokens ?? 0,
					calibrationPointCount: calibration.calibrationPoints.length,
					calibrationConfidencePct: Math.max(
						calibration.currentEstimates.fiveHour.confidencePct,
						calibration.currentEstimates.weekly.confidencePct
					),
					// Per-type token breakdown for tooltips
					localInputTokens: localInputTokens,
					localOutputTokens: localOutputTokens,
					localCacheCreationTokens: localCacheCreationTokens,
					honeycombInputTokens: timeRangeHcData?.inputTokens ?? 0,
					honeycombOutputTokens: timeRangeHcData?.outputTokens ?? 0,
					honeycombCacheCreationTokens: timeRangeHcData?.cacheCreationTokens ?? 0,
					// Free tokens from local stats DB (for Local card tooltip)
					localFreeInputTokens: freeTokenStats?.totalInputTokens ?? 0,
					localFreeOutputTokens: freeTokenStats?.totalOutputTokens ?? 0,
					localFreeCacheCreationTokens: freeTokenStats?.totalCacheCreationTokens ?? 0,
					localFreeTotalTokens: freeTokenStats?.totalBillableTokens ?? 0,
					// Free tokens from local models as tracked by Honeycomb
					honeycombFreeInputTokens: timeRangeHcAllData?.inputTokens ?? 0,
					honeycombFreeOutputTokens: timeRangeHcAllData?.outputTokens ?? 0,
					honeycombFreeCacheCreationTokens: timeRangeHcAllData?.cacheCreationTokens ?? 0,
					honeycombFreeTotalTokens:
						(timeRangeHcAllData?.inputTokens ?? 0) +
						(timeRangeHcAllData?.outputTokens ?? 0) +
						(timeRangeHcAllData?.cacheCreationTokens ?? 0),
				}
			: null;

	// Build budget data
	const fiveHourBudget: BudgetWindowData | null =
		calibration.currentEstimates.fiveHour.weightedMean > 0
			? {
					localTokens: localBillableTokensFixed ?? localBillableTokens,
					honeycombTokens: honeycombUsageData?.fiveHourBillableTokens ?? 0,
					calibratedBudget: calibration.currentEstimates.fiveHour.weightedMean,
					resetLabel: calibration.fiveHourWindowResetAnchorUtc
						? (() => {
								const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
								const anchorMs = new Date(calibration.fiveHourWindowResetAnchorUtc!).getTime();
								const now = Date.now();
								const windowsSince = Math.floor((now - anchorMs) / FIVE_HOURS_MS);
								const windowEnd = new Date(anchorMs + (windowsSince + 1) * FIVE_HOURS_MS);
								const hours = windowEnd.getHours();
								const minutes = windowEnd.getMinutes();
								const timeStr = `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours >= 12 ? 'PM' : 'AM'}`;
								return `Resets at ${timeStr}`;
							})()
						: 'Rolling 5-hour window',
				}
			: null;

	const weeklyBudget: BudgetWindowData | null =
		calibration.currentEstimates.weekly.weightedMean > 0
			? {
					localTokens: localBillableTokensFixed ?? localBillableTokens,
					honeycombTokens: honeycombUsageData?.weeklyBillableTokens ?? 0,
					calibratedBudget: calibration.currentEstimates.weekly.weightedMean,
					resetLabel: `Resets: ${calibration.weeklyResetDay} ${calibration.weeklyResetTime}`,
				}
			: null;

	const sonnetWeeklyEstimate = (calibration.currentEstimates as any).sonnetWeekly || {
		weightedMean: 0,
	};
	const sonnetWeeklyBudget: BudgetWindowData | null =
		sonnetWeeklyEstimate.weightedMean > 0
			? {
					localTokens: localBillableTokensFixed ?? localBillableTokens,
					honeycombTokens: honeycombUsageData?.sonnetWeeklyBillableTokens ?? 0,
					calibratedBudget: sonnetWeeklyEstimate.weightedMean,
					resetLabel: `Resets: ${calibration.sonnetResetDay || 'Sunday'} ${calibration.sonnetResetTime || '10:00'}`,
				}
			: null;

	// Local Models: free tokens from local stats DB against the weekly calibrated budget
	const hcFreeTokenTotal =
		(timeRangeHcAllData?.inputTokens ?? 0) +
		(timeRangeHcAllData?.outputTokens ?? 0) +
		(timeRangeHcAllData?.cacheCreationTokens ?? 0);

	const localModelsBudget: BudgetWindowData | null =
		calibration.currentEstimates.weekly.weightedMean > 0 &&
		((freeTokenStats?.totalBillableTokens ?? 0) > 0 || hcFreeTokenTotal > 0)
			? {
					localTokens: freeTokenStats?.totalBillableTokens ?? 0,
					honeycombTokens: hcFreeTokenTotal,
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
					<PlanBudgetTracker
						theme={theme}
						fiveHour={fiveHourBudget}
						weekly={weeklyBudget}
						sonnetWeekly={sonnetWeeklyBudget}
						localModels={localModelsBudget}
					/>
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
						onSaveComplete={onRefresh}
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
