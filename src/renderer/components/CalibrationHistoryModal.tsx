/**
 * CalibrationHistoryModal
 *
 * Modal showing convergence chart (sparkline with confidence bands),
 * all calibration data points table, and CSV export.
 *
 * Opened from PlanCalibrationSettings "View History & Convergence..." button
 * or from the DS Comparison tab's inline calibration form.
 *
 * @see Investigation plan Section 16.6.2
 */

import { useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Download } from 'lucide-react';
import type { Theme } from '../types';
import type { PlanCalibration, CalibrationPoint, BudgetEstimate } from '../types';
import { formatTokenCount, exportCalibrationCsv, recencyMultiplier } from '../utils/calibration';

export interface CalibrationHistoryModalProps {
	theme: Theme;
	calibration: PlanCalibration;
	isOpen: boolean;
	onClose: () => void;
}

export function CalibrationHistoryModal({
	theme,
	calibration,
	isOpen,
	onClose,
}: CalibrationHistoryModalProps) {
	const modalRef = useRef<HTMLDivElement>(null);

	const fiveHourPoints = useMemo(
		() => calibration.calibrationPoints.filter((p) => p.window === '5hr'),
		[calibration.calibrationPoints]
	);

	const weeklyPoints = useMemo(
		() => calibration.calibrationPoints.filter((p) => p.window === 'weekly'),
		[calibration.calibrationPoints]
	);

	const sonnetWeeklyPoints = useMemo(
		() => calibration.calibrationPoints.filter((p) => p.window === 'sonnet-weekly'),
		[calibration.calibrationPoints]
	);

	const handleExport = useCallback(() => {
		const csv = exportCalibrationCsv(calibration.calibrationPoints);
		const blob = new Blob([csv], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `calibration-history-${new Date().toISOString().slice(0, 10)}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}, [calibration.calibrationPoints]);

	if (!isOpen) return null;

	return createPortal(
		<div
			className="fixed inset-0 z-[10000] flex items-center justify-center"
			style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
			onClick={(e) => e.target === e.currentTarget && onClose()}
		>
			<div
				ref={modalRef}
				className="rounded-lg shadow-xl overflow-hidden"
				style={{
					backgroundColor: theme.colors.bgMain,
					border: `1px solid ${theme.colors.border}`,
					width: '900px',
					maxHeight: '80vh',
				}}
			>
				{/* Header */}
				<div
					className="flex items-center justify-between px-4 py-3 border-b"
					style={{ borderColor: theme.colors.border }}
				>
					<h2 className="text-base font-semibold" style={{ color: theme.colors.textMain }}>
						Calibration History & Convergence
					</h2>
					<div className="flex items-center gap-2">
						<button
							onClick={handleExport}
							className="flex items-center gap-1 px-2 py-1 text-sm rounded border hover:opacity-80"
							style={{
								borderColor: theme.colors.border,
								color: theme.colors.textMain,
							}}
						>
							<Download className="w-3 h-3" />
							Export CSV
						</button>
						<button
							onClick={onClose}
							className="p-1 rounded hover:bg-white/10"
							style={{ color: theme.colors.textDim }}
						>
							<X className="w-4 h-4" />
						</button>
					</div>
				</div>

				{/* Content */}
				<div className="overflow-y-auto p-4 space-y-6" style={{ maxHeight: 'calc(80vh - 52px)' }}>
					{/* 5-Hour Window Section */}
					<ConvergenceSection
						theme={theme}
						title="5-Hour Window Budget Estimate"
						estimate={calibration.currentEstimates.fiveHour}
						points={fiveHourPoints}
					/>

					{/* Weekly Section */}
					<ConvergenceSection
						theme={theme}
						title="Weekly Budget Estimate"
						estimate={calibration.currentEstimates.weekly}
						points={weeklyPoints}
					/>

					{/* Sonnet-Only Section */}
					<ConvergenceSection
						theme={theme}
						title="Sonnet-Only Budget Estimate"
						estimate={
							(calibration.currentEstimates as any).sonnetWeekly || {
								weightedMean: 0,
								standardDeviation: 0,
								confidencePct: 0,
								activePoints: 0,
								totalPoints: 0,
							}
						}
						points={sonnetWeeklyPoints}
					/>

					{/* All Points Table */}
					{calibration.calibrationPoints.length > 0 && (
						<div>
							<h3 className="text-sm font-semibold mb-2" style={{ color: theme.colors.textMain }}>
								All Calibration Points
							</h3>
							<div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: '120px' }}>
								<table className="w-full text-sm">
									<thead className="sticky top-0" style={{ backgroundColor: theme.colors.bgMain }}>
										<tr style={{ borderBottom: `1px solid ${theme.colors.border}` }}>
											{[
												'#',
												'Date',
												'Window',
												'Usage %',
												'Billable',
												'Derived Budget',
												'Quality',
												'Contribution',
												'Status',
											].map((h) => (
												<th
													key={h}
													className="px-2 py-1.5 text-left font-medium"
													style={{ color: theme.colors.textDim }}
												>
													{h}
												</th>
											))}
										</tr>
									</thead>
									<tbody>
										{(() => {
											// Pre-compute normalized contribution weights per window
											const windowGroups: Record<
												string,
												{ points: typeof calibration.calibrationPoints; newestTs: string }
											> = {};
											for (const p of calibration.calibrationPoints) {
												if (!windowGroups[p.window]) {
													windowGroups[p.window] = { points: [], newestTs: p.timestamp };
												}
												windowGroups[p.window].points.push(p);
												if (p.timestamp > windowGroups[p.window].newestTs) {
													windowGroups[p.window].newestTs = p.timestamp;
												}
											}

											const contributionMap = new Map<string, number | null>();
											for (const [, group] of Object.entries(windowGroups)) {
												const allOutliers = group.points.every((p) => p.isOutlier);
												const contributing = allOutliers
													? group.points
													: group.points.filter((p) => !p.isOutlier);
												const sumEffective = contributing.reduce(
													(sum, p) =>
														sum + p.weight * recencyMultiplier(p.timestamp, group.newestTs),
													0
												);

												for (const p of group.points) {
													const ew = p.weight * recencyMultiplier(p.timestamp, group.newestTs);
													const key = `${p.window}-${p.id}`;
													if (p.isOutlier && !allOutliers) {
														contributionMap.set(key, null);
													} else {
														contributionMap.set(key, sumEffective > 0 ? ew / sumEffective : 0);
													}
												}
											}

											return calibration.calibrationPoints.map((point) => {
												const key = `${point.window}-${point.id}`;
												const contribution = contributionMap.get(key) ?? null;

												return (
													<tr
														key={key}
														style={{
															borderBottom: `1px solid ${theme.colors.border}`,
															opacity: point.isOutlier ? 0.5 : 1,
														}}
													>
														<td className="px-2 py-1.5" style={{ color: theme.colors.textMain }}>
															{point.id}
														</td>
														<td className="px-2 py-1.5" style={{ color: theme.colors.textMain }}>
															{new Date(point.timestamp).toLocaleDateString()}
														</td>
														<td className="px-2 py-1.5" style={{ color: theme.colors.textMain }}>
															{point.window}
														</td>
														<td
															className="px-2 py-1.5 font-mono"
															style={{ color: theme.colors.textMain }}
														>
															{point.claudeUsagePct}%
														</td>
														<td
															className="px-2 py-1.5 font-mono"
															style={{ color: theme.colors.textMain }}
														>
															{formatTokenCount(point.honeycombBillableTokens)}
														</td>
														<td
															className="px-2 py-1.5 font-mono"
															style={{ color: theme.colors.textMain }}
														>
															{formatTokenCount(point.derivedBudget)}
														</td>
														<td
															className="px-2 py-1.5 font-mono"
															style={{ color: theme.colors.textMain }}
														>
															{point.weight.toFixed(2)}
														</td>
														<td
															className="px-2 py-1.5 font-mono"
															style={{
																color:
																	contribution === null
																		? theme.colors.textDim
																		: contribution! > 0.05
																			? '#22c55e'
																			: contribution! > 0.02
																				? theme.colors.textMain
																				: theme.colors.textDim,
																fontWeight:
																	contribution !== null && contribution! > 0.05 ? 600 : 400,
															}}
															title={
																contribution !== null
																	? `This point contributes ${(contribution! * 100).toFixed(1)}% of the ${point.window} budget estimate`
																	: 'Excluded from estimate (outlier)'
															}
														>
															{contribution !== null ? `${(contribution * 100).toFixed(1)}%` : '—'}
														</td>
														<td className="px-2 py-1.5">
															<span
																className="px-1.5 py-0.5 rounded text-xs"
																style={{
																	backgroundColor: point.isOutlier
																		? 'rgba(239,68,68,0.15)'
																		: 'rgba(34,197,94,0.15)',
																	color: point.isOutlier ? '#ef4444' : '#22c55e',
																}}
															>
																{point.isOutlier ? 'Outlier' : 'Active'}
															</span>
														</td>
													</tr>
												);
											});
										})()}
									</tbody>
								</table>
							</div>

							{calibration.calibrationPoints.some((p) => p.isOutlier) && (
								<div className="text-sm mt-2" style={{ color: theme.colors.textDim }}>
									Outlier points (&gt;2&sigma; from mean) are excluded from the estimate but
									preserved in history. Clusters of outliers may indicate Anthropic changed plan
									limits.
								</div>
							)}
						</div>
					)}

					{calibration.calibrationPoints.length === 0 && (
						<div className="text-center py-8 text-sm" style={{ color: theme.colors.textDim }}>
							No calibration data yet. Enter usage percentages from the Claude usage page to start
							building budget estimates.
						</div>
					)}
				</div>
			</div>
		</div>,
		document.body
	);
}

/**
 * Section showing convergence sparkline and current estimate for a single window.
 */
function ConvergenceSection({
	theme,
	title,
	estimate,
	points,
}: {
	theme: Theme;
	title: string;
	estimate: BudgetEstimate;
	points: CalibrationPoint[];
}) {
	if (points.length === 0) {
		return (
			<div>
				<h3 className="text-sm font-semibold mb-1" style={{ color: theme.colors.textMain }}>
					{title}
				</h3>
				<div className="text-sm" style={{ color: theme.colors.textDim }}>
					No calibration data for this window.
				</div>
			</div>
		);
	}

	const minBudget = Math.min(...points.map((p) => p.derivedBudget));
	const maxBudget = Math.max(...points.map((p) => p.derivedBudget));
	const range = maxBudget - minBudget || 1;

	// SVG sparkline dimensions
	const svgWidth = 650;
	const svgHeight = 120;
	const padding = 10;
	const plotWidth = svgWidth - 2 * padding;
	const plotHeight = svgHeight - 2 * padding;

	const toX = (i: number) => padding + (i / Math.max(1, points.length - 1)) * plotWidth;
	const toY = (budget: number) =>
		padding + plotHeight - ((budget - minBudget) / range) * plotHeight;

	// Build sparkline path
	const linePath = points
		.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i)} ${toY(p.derivedBudget)}`)
		.join(' ');

	// Dynamic point radius — shrinks as data density increases
	const pointRadius = Math.max(2, Math.min(5, Math.round(120 / points.length)));
	const outlierRadius = Math.max(1.5, pointRadius - 1);

	// Confidence band (mean +/- sigma)
	const meanY = toY(estimate.weightedMean);
	const upperY = toY(estimate.weightedMean + estimate.standardDeviation);
	const lowerY = toY(estimate.weightedMean - estimate.standardDeviation);

	return (
		<div>
			<h3 className="text-sm font-semibold mb-1" style={{ color: theme.colors.textMain }}>
				{title}
			</h3>
			<div className="text-sm mb-2" style={{ color: theme.colors.textDim }}>
				Current: {formatTokenCount(estimate.weightedMean)} tokens &plusmn;
				{estimate.confidencePct.toFixed(1)}% (confidence: {estimate.confidencePct.toFixed(1)}%)
			</div>

			{/* Sparkline */}
			{points.length >= 2 && (
				<svg
					width="100%"
					viewBox={`0 0 ${svgWidth} ${svgHeight}`}
					className="rounded"
					style={{ backgroundColor: theme.colors.bgActivity }}
				>
					{/* Confidence band */}
					{estimate.standardDeviation > 0 && (
						<rect
							x={padding}
							y={Math.min(upperY, lowerY)}
							width={plotWidth}
							height={Math.abs(lowerY - upperY)}
							fill={theme.colors.accent}
							opacity={0.1}
						/>
					)}

					{/* Mean line */}
					<line
						x1={padding}
						y1={meanY}
						x2={svgWidth - padding}
						y2={meanY}
						stroke={theme.colors.accent}
						strokeWidth={1.5}
						strokeDasharray="4 2"
						opacity={0.6}
					/>

					{/* Data line */}
					<path
						d={linePath}
						fill="none"
						stroke={theme.colors.accent}
						strokeWidth={points.length > 40 ? 1.5 : 2.5}
					/>

					{/* Data points */}
					{points.map((p, i) => (
						<circle
							key={p.id}
							cx={toX(i)}
							cy={toY(p.derivedBudget)}
							r={p.isOutlier ? outlierRadius : pointRadius}
							fill={p.isOutlier ? '#ef4444' : theme.colors.accent}
							opacity={p.isOutlier ? 0.5 : 1}
						/>
					))}
				</svg>
			)}
		</div>
	);
}
