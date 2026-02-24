/**
 * PlanCalibrationSettings
 *
 * Settings panel for entering calibration data from the Claude usage page.
 * User enters current usage % and time remaining; Maestro queries Honeycomb
 * for matching token totals and computes a derived budget estimate.
 *
 * Rendered below HoneycombSettingsSection in the Settings Honeycomb tab.
 *
 * @see Investigation plan Section 16.6.2
 */

import { useState, useCallback } from 'react';
import { History } from 'lucide-react';
import type { Theme } from '../types';
import type { PlanCalibration, CalibrationPoint } from '../types';
import {
	createCalibrationPoint,
	computeBudgetEstimate,
	formatTokenCount,
} from '../utils/calibration';

export interface PlanCalibrationSettingsProps {
	theme: Theme;
	calibration: PlanCalibration;
	onCalibrationUpdate: (updated: PlanCalibration) => void;
	onViewHistory: () => void;
	getHoneycombBillableTokens?: (window: '5hr' | 'weekly' | 'sonnet-weekly') => Promise<number>;
	onSaveComplete?: () => void;
}

export function PlanCalibrationSettings({
	theme,
	calibration,
	onCalibrationUpdate,
	onViewHistory,
	getHoneycombBillableTokens,
	onSaveComplete,
}: PlanCalibrationSettingsProps) {
	// 5-hour inputs
	const [fiveHourPct, setFiveHourPct] = useState('');
	const [fiveHourTimeH, setFiveHourTimeH] = useState('');
	const [fiveHourTimeM, setFiveHourTimeM] = useState('');

	// Weekly inputs
	const [weeklyPct, setWeeklyPct] = useState('');

	// Sonnet-only inputs
	const [sonnetPct, setSonnetPct] = useState('');

	const [isSaving, setIsSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);

	// Reset calibration state
	const [showResetConfirm, setShowResetConfirm] = useState(false);
	const [resetResult, setResetResult] = useState<{
		pointsCleared: number;
		backupPath: string | null;
	} | null>(null);

	const handleSave = useCallback(async () => {
		if (!getHoneycombBillableTokens) {
			setSaveError('Honeycomb not connected');
			return;
		}

		const fiveHourVal = Number(fiveHourPct);
		const weeklyVal = Number(weeklyPct);
		const sonnetVal = Number(sonnetPct);

		if (!fiveHourVal && !weeklyVal && !sonnetVal) {
			setSaveError('Enter at least one usage percentage');
			return;
		}

		if (
			(fiveHourVal && (fiveHourVal < 1 || fiveHourVal > 100)) ||
			(weeklyVal && (weeklyVal < 1 || weeklyVal > 100)) ||
			(sonnetVal && (sonnetVal < 1 || sonnetVal > 100))
		) {
			setSaveError('Usage percentage must be between 1 and 100');
			return;
		}

		setIsSaving(true);
		setSaveError(null);

		try {
			const newPoints: CalibrationPoint[] = [];
			const allPoints = [...calibration.calibrationPoints];

			if (fiveHourVal > 0) {
				const tokens = await getHoneycombBillableTokens('5hr');
				const timeStr =
					fiveHourTimeH || fiveHourTimeM
						? `${fiveHourTimeH || '0'}h ${fiveHourTimeM || '0'}m`
						: undefined;
				const point = createCalibrationPoint(allPoints, '5hr', fiveHourVal, tokens, timeStr);
				newPoints.push(point);
				allPoints.push(point);
			}

			if (weeklyVal > 0) {
				const tokens = await getHoneycombBillableTokens('weekly');
				const point = createCalibrationPoint(allPoints, 'weekly', weeklyVal, tokens);
				newPoints.push(point);
				allPoints.push(point);
			}

			if (sonnetVal > 0) {
				const tokens = await getHoneycombBillableTokens('sonnet-weekly');
				const point = createCalibrationPoint(allPoints, 'sonnet-weekly', sonnetVal, tokens);
				newPoints.push(point);
				allPoints.push(point);
			}

			// Recompute estimates with all points
			const fiveHourEstimate = computeBudgetEstimate(allPoints, '5hr');
			const weeklyEstimate = computeBudgetEstimate(allPoints, 'weekly');
			const sonnetWeeklyEstimate = computeBudgetEstimate(allPoints, 'sonnet-weekly');

			const calibrationUpdate: PlanCalibration = {
				...calibration,
				calibrationPoints: allPoints,
				currentEstimates: {
					fiveHour: fiveHourEstimate,
					weekly: weeklyEstimate,
					sonnetWeekly: sonnetWeeklyEstimate,
				},
				lastCalibratedAt: new Date().toISOString(),
			};

			// Compute 5-hour window reset anchor from the MOST RECENT calibration point.
			// Claude's 5-hour window is sliding (starts on activity), so the freshest
			// calibration snapshot best reflects the current window boundaries.
			const fiveHrPoints = allPoints.filter((p) => p.window === '5hr' && p.timeRemainingInWindow);
			if (fiveHrPoints.length > 0) {
				const sorted = [...fiveHrPoints].sort(
					(a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
				);
				const bestPoint = sorted[0];
				const match = bestPoint.timeRemainingInWindow!.match(/(\d+)h\s*(\d+)m/);
				if (match) {
					const remainingMs = (parseInt(match[1]) * 60 + parseInt(match[2])) * 60 * 1000;
					const windowEndMs = new Date(bestPoint.timestamp).getTime() + remainingMs;
					calibrationUpdate.fiveHourWindowResetAnchorUtc = new Date(windowEndMs).toISOString();
				}
			}

			onCalibrationUpdate(calibrationUpdate);
			onSaveComplete?.();

			// Clear inputs
			setFiveHourPct('');
			setFiveHourTimeH('');
			setFiveHourTimeM('');
			setWeeklyPct('');
			setSonnetPct('');
		} catch (err) {
			setSaveError(err instanceof Error ? err.message : 'Failed to save calibration');
		} finally {
			setIsSaving(false);
		}
	}, [
		fiveHourPct,
		weeklyPct,
		sonnetPct,
		fiveHourTimeH,
		fiveHourTimeM,
		calibration,
		onCalibrationUpdate,
		getHoneycombBillableTokens,
		onSaveComplete,
	]);

	const handleResetCalibration = useCallback(async () => {
		try {
			const result = await window.maestro.settings.resetCalibration();
			if (result.success) {
				setResetResult({ pointsCleared: result.pointsCleared, backupPath: result.backupPath });
				// Update local state — preserve schedule config from current calibration
				onCalibrationUpdate({
					calibrationPoints: [],
					currentEstimates: {
						fiveHour: {
							weightedMean: 0,
							standardDeviation: 0,
							confidencePct: 0,
							activePoints: 0,
							totalPoints: 0,
						},
						weekly: {
							weightedMean: 0,
							standardDeviation: 0,
							confidencePct: 0,
							activePoints: 0,
							totalPoints: 0,
						},
						sonnetWeekly: {
							weightedMean: 0,
							standardDeviation: 0,
							confidencePct: 0,
							activePoints: 0,
							totalPoints: 0,
						},
					},
					weeklyResetDay: calibration.weeklyResetDay,
					weeklyResetTime: calibration.weeklyResetTime,
					weeklyResetTimezone: calibration.weeklyResetTimezone,
					lastCalibratedAt: '',
					fiveHourWindowResetAnchorUtc: calibration.fiveHourWindowResetAnchorUtc,
					sonnetResetDay: calibration.sonnetResetDay,
					sonnetResetTime: calibration.sonnetResetTime,
					sonnetResetTimezone: calibration.sonnetResetTimezone,
				});
			}
		} catch (err) {
			console.error('Calibration reset failed:', err);
		}
		setShowResetConfirm(false);
	}, [calibration, onCalibrationUpdate]);

	const { fiveHour, weekly } = calibration.currentEstimates;
	const sonnetWeekly = (calibration.currentEstimates as any).sonnetWeekly || {
		weightedMean: 0,
		standardDeviation: 0,
		confidencePct: 0,
		activePoints: 0,
		totalPoints: 0,
	};

	return (
		<div className="space-y-4">
			<div className="text-sm" style={{ color: theme.colors.textDim }}>
				Enter values from your Claude usage page to calibrate plan limit thresholds. Higher usage %
				readings produce more accurate estimates.
			</div>

			{/* 5-Hour Window */}
			<div className="space-y-2">
				<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
					5-Hour Window
				</div>
				<div className="flex items-center gap-2">
					<label className="text-sm" style={{ color: theme.colors.textDim }}>
						Usage %:
					</label>
					<input
						type="number"
						min={1}
						max={100}
						value={fiveHourPct}
						onChange={(e) => setFiveHourPct(e.target.value)}
						placeholder="42"
						className="w-16 px-2 py-1 text-sm rounded border"
						style={{
							backgroundColor: theme.colors.bgMain,
							borderColor: theme.colors.border,
							color: theme.colors.textMain,
						}}
					/>
					<span className="text-sm" style={{ color: theme.colors.textDim }}>
						%
					</span>

					<label className="text-sm ml-2" style={{ color: theme.colors.textDim }}>
						Time left:
					</label>
					<input
						type="number"
						min={0}
						max={5}
						value={fiveHourTimeH}
						onChange={(e) => setFiveHourTimeH(e.target.value)}
						placeholder="2"
						className="w-12 px-2 py-1 text-sm rounded border"
						style={{
							backgroundColor: theme.colors.bgMain,
							borderColor: theme.colors.border,
							color: theme.colors.textMain,
						}}
					/>
					<span className="text-sm" style={{ color: theme.colors.textDim }}>
						h
					</span>
					<input
						type="number"
						min={0}
						max={59}
						value={fiveHourTimeM}
						onChange={(e) => setFiveHourTimeM(e.target.value)}
						placeholder="28"
						className="w-12 px-2 py-1 text-sm rounded border"
						style={{
							backgroundColor: theme.colors.bgMain,
							borderColor: theme.colors.border,
							color: theme.colors.textMain,
						}}
					/>
					<span className="text-sm" style={{ color: theme.colors.textDim }}>
						m
					</span>
				</div>
				{fiveHour.totalPoints > 0 && (
					<div className="text-sm" style={{ color: theme.colors.textDim }}>
						Budget estimate: {formatTokenCount(fiveHour.weightedMean)} tokens &plusmn;
						{fiveHour.confidencePct.toFixed(1)}% ({fiveHour.activePoints} calibration
						{fiveHour.activePoints !== 1 ? 's' : ''})
					</div>
				)}
			</div>

			{/* Weekly + Sonnet side-by-side */}
			<div className="grid grid-cols-2 gap-4">
				{/* Weekly Limit */}
				<div className="space-y-2">
					<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
						Weekly Limit
					</div>
					<div className="flex items-center gap-2">
						<label className="text-sm" style={{ color: theme.colors.textDim }}>
							Usage %:
						</label>
						<input
							type="number"
							min={1}
							max={100}
							value={weeklyPct}
							onChange={(e) => setWeeklyPct(e.target.value)}
							placeholder="71"
							className="w-16 px-2 py-1 text-sm rounded border"
							style={{
								backgroundColor: theme.colors.bgMain,
								borderColor: theme.colors.border,
								color: theme.colors.textMain,
							}}
						/>
						<span className="text-sm" style={{ color: theme.colors.textDim }}>
							%
						</span>
					</div>

					<div className="flex items-center gap-2 mt-1">
						<label className="text-sm" style={{ color: theme.colors.textDim }}>
							Resets:
						</label>
						<select
							value={calibration.weeklyResetDay}
							onChange={(e) =>
								onCalibrationUpdate({ ...calibration, weeklyResetDay: e.target.value })
							}
							className="text-sm px-2 py-1 rounded border"
							style={{
								backgroundColor: theme.colors.bgMain,
								borderColor: theme.colors.border,
								color: theme.colors.textMain,
							}}
						>
							{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(
								(day) => (
									<option key={day} value={day}>
										{day}
									</option>
								)
							)}
						</select>
						<span className="text-sm" style={{ color: theme.colors.textDim }}>
							at
						</span>
						<input
							type="time"
							value={calibration.weeklyResetTime}
							onChange={(e) =>
								onCalibrationUpdate({ ...calibration, weeklyResetTime: e.target.value })
							}
							className="text-sm px-2 py-1 rounded border"
							style={{
								backgroundColor: theme.colors.bgMain,
								borderColor: theme.colors.border,
								color: theme.colors.textMain,
							}}
						/>
					</div>

					{weekly.totalPoints > 0 && (
						<div className="text-xs" style={{ color: theme.colors.textDim }}>
							Budget: {formatTokenCount(weekly.weightedMean)} &plusmn;
							{weekly.confidencePct.toFixed(0)}% ({weekly.activePoints} pt
							{weekly.activePoints !== 1 ? 's' : ''})
						</div>
					)}
				</div>

				{/* Sonnet-Only Limit */}
				<div className="space-y-2">
					<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
						Sonnet-Only Limit
					</div>
					<div className="flex items-center gap-2">
						<label className="text-sm" style={{ color: theme.colors.textDim }}>
							Usage %:
						</label>
						<input
							type="number"
							min={1}
							max={100}
							value={sonnetPct}
							onChange={(e) => setSonnetPct(e.target.value)}
							placeholder="35"
							className="w-16 px-2 py-1 text-sm rounded border"
							style={{
								backgroundColor: theme.colors.bgMain,
								borderColor: theme.colors.border,
								color: theme.colors.textMain,
							}}
						/>
						<span className="text-sm" style={{ color: theme.colors.textDim }}>
							%
						</span>
					</div>

					<div className="flex items-center gap-2 mt-1">
						<label className="text-sm" style={{ color: theme.colors.textDim }}>
							Resets:
						</label>
						<select
							value={calibration.sonnetResetDay || 'Sunday'}
							onChange={(e) =>
								onCalibrationUpdate({ ...calibration, sonnetResetDay: e.target.value })
							}
							className="text-sm px-2 py-1 rounded border"
							style={{
								backgroundColor: theme.colors.bgMain,
								borderColor: theme.colors.border,
								color: theme.colors.textMain,
							}}
						>
							{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(
								(day) => (
									<option key={day} value={day}>
										{day}
									</option>
								)
							)}
						</select>
						<span className="text-sm" style={{ color: theme.colors.textDim }}>
							at
						</span>
						<input
							type="time"
							value={calibration.sonnetResetTime || '10:00'}
							onChange={(e) =>
								onCalibrationUpdate({ ...calibration, sonnetResetTime: e.target.value })
							}
							className="text-sm px-2 py-1 rounded border"
							style={{
								backgroundColor: theme.colors.bgMain,
								borderColor: theme.colors.border,
								color: theme.colors.textMain,
							}}
						/>
					</div>

					{sonnetWeekly.totalPoints > 0 && (
						<div className="text-xs" style={{ color: theme.colors.textDim }}>
							Budget: {formatTokenCount(sonnetWeekly.weightedMean)} &plusmn;
							{sonnetWeekly.confidencePct.toFixed(0)}% ({sonnetWeekly.activePoints} pt
							{sonnetWeekly.activePoints !== 1 ? 's' : ''})
						</div>
					)}
				</div>
			</div>

			{/* Actions */}
			<div className="flex items-center gap-3 pt-2">
				<button
					onClick={handleSave}
					disabled={isSaving || (!fiveHourPct && !weeklyPct && !sonnetPct)}
					className="px-4 py-1.5 text-sm font-medium rounded transition-colors"
					style={{
						backgroundColor: theme.colors.accent,
						color: theme.colors.accentForeground,
						opacity: isSaving || (!fiveHourPct && !weeklyPct && !sonnetPct) ? 0.5 : 1,
					}}
				>
					{isSaving ? 'Saving...' : 'Save Calibration'}
				</button>

				<button
					onClick={onViewHistory}
					className="px-3 py-1.5 text-sm rounded border transition-colors hover:opacity-80 flex items-center gap-1.5"
					style={{
						borderColor: theme.colors.border,
						color: theme.colors.textMain,
						backgroundColor: 'transparent',
					}}
				>
					<History className="w-3 h-3" />
					View History & Convergence...
				</button>
			</div>

			{/* Reset Calibration */}
			<div
				style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border-color, #333)' }}
			>
				{!showResetConfirm && !resetResult && (
					<button
						onClick={() => setShowResetConfirm(true)}
						disabled={!calibration.calibrationPoints.length}
						style={{
							padding: '6px 12px',
							backgroundColor: 'transparent',
							color: calibration.calibrationPoints.length ? '#ef4444' : '#666',
							border: `1px solid ${calibration.calibrationPoints.length ? '#ef4444' : '#444'}`,
							borderRadius: 4,
							cursor: calibration.calibrationPoints.length ? 'pointer' : 'not-allowed',
							fontSize: 12,
						}}
					>
						Reset All Calibration Points ({calibration.calibrationPoints.length})
					</button>
				)}
				{showResetConfirm && (
					<div style={{ fontSize: 12, color: '#ef4444' }}>
						<p style={{ margin: '0 0 8px' }}>
							This will clear all {calibration.calibrationPoints.length} calibration points and zero
							out budget estimates. A JSON backup will be saved automatically. Continue?
						</p>
						<button
							onClick={handleResetCalibration}
							style={{
								padding: '4px 10px',
								backgroundColor: '#ef4444',
								color: '#fff',
								border: 'none',
								borderRadius: 4,
								cursor: 'pointer',
								fontSize: 12,
								marginRight: 8,
							}}
						>
							Yes, Reset
						</button>
						<button
							onClick={() => setShowResetConfirm(false)}
							style={{
								padding: '4px 10px',
								backgroundColor: 'transparent',
								color: '#ccc',
								border: '1px solid #555',
								borderRadius: 4,
								cursor: 'pointer',
								fontSize: 12,
							}}
						>
							Cancel
						</button>
					</div>
				)}
				{resetResult && (
					<div style={{ fontSize: 12, color: '#22c55e' }}>
						<p style={{ margin: 0 }}>
							Cleared {resetResult.pointsCleared} calibration points. Backup saved to:{' '}
							{resetResult.backupPath}
						</p>
						<button
							onClick={() => setResetResult(null)}
							style={{
								marginTop: 6,
								padding: '4px 10px',
								backgroundColor: 'transparent',
								color: '#ccc',
								border: '1px solid #555',
								borderRadius: 4,
								cursor: 'pointer',
								fontSize: 12,
							}}
						>
							Dismiss
						</button>
					</div>
				)}
			</div>

			{saveError && (
				<div
					className="text-sm px-3 py-1.5 rounded"
					style={{ color: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)' }}
				>
					{saveError}
				</div>
			)}

			{calibration.lastCalibratedAt && (
				<div className="text-sm" style={{ color: theme.colors.textDim }}>
					Last calibrated: {new Date(calibration.lastCalibratedAt).toLocaleString()}
				</div>
			)}
		</div>
	);
}
