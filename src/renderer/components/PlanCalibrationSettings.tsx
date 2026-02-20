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
import { Crosshair, History } from 'lucide-react';
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
	getHoneycombBillableTokens?: (window: '5hr' | 'weekly') => Promise<number>;
}

export function PlanCalibrationSettings({
	theme,
	calibration,
	onCalibrationUpdate,
	onViewHistory,
	getHoneycombBillableTokens,
}: PlanCalibrationSettingsProps) {
	// 5-hour inputs
	const [fiveHourPct, setFiveHourPct] = useState('');
	const [fiveHourTimeH, setFiveHourTimeH] = useState('');
	const [fiveHourTimeM, setFiveHourTimeM] = useState('');

	// Weekly inputs
	const [weeklyPct, setWeeklyPct] = useState('');

	const [isSaving, setIsSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);

	const handleSave = useCallback(async () => {
		if (!getHoneycombBillableTokens) {
			setSaveError('Honeycomb not connected');
			return;
		}

		const fiveHourVal = Number(fiveHourPct);
		const weeklyVal = Number(weeklyPct);

		if (!fiveHourVal && !weeklyVal) {
			setSaveError('Enter at least one usage percentage');
			return;
		}

		if (
			(fiveHourVal && (fiveHourVal < 1 || fiveHourVal > 100)) ||
			(weeklyVal && (weeklyVal < 1 || weeklyVal > 100))
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

			// Recompute estimates with all points
			const fiveHourEstimate = computeBudgetEstimate(allPoints, '5hr');
			const weeklyEstimate = computeBudgetEstimate(allPoints, 'weekly');

			onCalibrationUpdate({
				...calibration,
				calibrationPoints: allPoints,
				currentEstimates: {
					fiveHour: fiveHourEstimate,
					weekly: weeklyEstimate,
				},
				lastCalibratedAt: new Date().toISOString(),
			});

			// Clear inputs
			setFiveHourPct('');
			setFiveHourTimeH('');
			setFiveHourTimeM('');
			setWeeklyPct('');
		} catch (err) {
			setSaveError(err instanceof Error ? err.message : 'Failed to save calibration');
		} finally {
			setIsSaving(false);
		}
	}, [
		fiveHourPct,
		weeklyPct,
		fiveHourTimeH,
		fiveHourTimeM,
		calibration,
		onCalibrationUpdate,
		getHoneycombBillableTokens,
	]);

	const { fiveHour, weekly } = calibration.currentEstimates;

	return (
		<div className="space-y-4 pt-4 border-t" style={{ borderColor: theme.colors.border }}>
			<div className="flex items-center gap-2">
				<Crosshair className="w-4 h-4" style={{ color: theme.colors.textMain }} />
				<span className="text-sm font-semibold" style={{ color: theme.colors.textMain }}>
					Plan Calibration
				</span>
			</div>

			<div className="text-xs" style={{ color: theme.colors.textDim }}>
				Enter values from your Claude usage page to calibrate plan limit thresholds. Higher usage %
				readings produce more accurate estimates.
			</div>

			{/* 5-Hour Window */}
			<div className="space-y-2">
				<div className="text-xs font-medium" style={{ color: theme.colors.textMain }}>
					5-Hour Window
				</div>
				<div className="flex items-center gap-2">
					<label className="text-xs" style={{ color: theme.colors.textDim }}>
						Usage %:
					</label>
					<input
						type="number"
						min={1}
						max={100}
						value={fiveHourPct}
						onChange={(e) => setFiveHourPct(e.target.value)}
						placeholder="42"
						className="w-16 px-2 py-1 text-xs rounded border"
						style={{
							backgroundColor: theme.colors.bgMain,
							borderColor: theme.colors.border,
							color: theme.colors.textMain,
						}}
					/>
					<span className="text-xs" style={{ color: theme.colors.textDim }}>
						%
					</span>

					<label className="text-xs ml-2" style={{ color: theme.colors.textDim }}>
						Time left:
					</label>
					<input
						type="number"
						min={0}
						max={5}
						value={fiveHourTimeH}
						onChange={(e) => setFiveHourTimeH(e.target.value)}
						placeholder="2"
						className="w-12 px-2 py-1 text-xs rounded border"
						style={{
							backgroundColor: theme.colors.bgMain,
							borderColor: theme.colors.border,
							color: theme.colors.textMain,
						}}
					/>
					<span className="text-xs" style={{ color: theme.colors.textDim }}>
						h
					</span>
					<input
						type="number"
						min={0}
						max={59}
						value={fiveHourTimeM}
						onChange={(e) => setFiveHourTimeM(e.target.value)}
						placeholder="28"
						className="w-12 px-2 py-1 text-xs rounded border"
						style={{
							backgroundColor: theme.colors.bgMain,
							borderColor: theme.colors.border,
							color: theme.colors.textMain,
						}}
					/>
					<span className="text-xs" style={{ color: theme.colors.textDim }}>
						m
					</span>
				</div>
				{fiveHour.totalPoints > 0 && (
					<div className="text-xs" style={{ color: theme.colors.textDim }}>
						Budget estimate: {formatTokenCount(fiveHour.weightedMean)} tokens &plusmn;
						{fiveHour.confidencePct.toFixed(1)}% ({fiveHour.activePoints} calibration
						{fiveHour.activePoints !== 1 ? 's' : ''})
					</div>
				)}
			</div>

			{/* Weekly Limit */}
			<div className="space-y-2">
				<div className="text-xs font-medium" style={{ color: theme.colors.textMain }}>
					Weekly Limit
				</div>
				<div className="flex items-center gap-2">
					<label className="text-xs" style={{ color: theme.colors.textDim }}>
						Usage %:
					</label>
					<input
						type="number"
						min={1}
						max={100}
						value={weeklyPct}
						onChange={(e) => setWeeklyPct(e.target.value)}
						placeholder="71"
						className="w-16 px-2 py-1 text-xs rounded border"
						style={{
							backgroundColor: theme.colors.bgMain,
							borderColor: theme.colors.border,
							color: theme.colors.textMain,
						}}
					/>
					<span className="text-xs" style={{ color: theme.colors.textDim }}>
						%
					</span>
				</div>

				<div className="flex items-center gap-2 mt-1">
					<label className="text-xs" style={{ color: theme.colors.textDim }}>
						Resets:
					</label>
					<select
						value={calibration.weeklyResetDay}
						onChange={(e) =>
							onCalibrationUpdate({ ...calibration, weeklyResetDay: e.target.value })
						}
						className="text-xs px-2 py-1 rounded border"
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
					<span className="text-xs" style={{ color: theme.colors.textDim }}>
						at
					</span>
					<input
						type="time"
						value={calibration.weeklyResetTime}
						onChange={(e) =>
							onCalibrationUpdate({ ...calibration, weeklyResetTime: e.target.value })
						}
						className="text-xs px-2 py-1 rounded border"
						style={{
							backgroundColor: theme.colors.bgMain,
							borderColor: theme.colors.border,
							color: theme.colors.textMain,
						}}
					/>
				</div>

				{weekly.totalPoints > 0 && (
					<div className="text-xs" style={{ color: theme.colors.textDim }}>
						Budget estimate: {formatTokenCount(weekly.weightedMean)} tokens &plusmn;
						{weekly.confidencePct.toFixed(1)}% ({weekly.activePoints} calibration
						{weekly.activePoints !== 1 ? 's' : ''})
					</div>
				)}
			</div>

			{/* Actions */}
			<div className="flex items-center gap-3 pt-2">
				<button
					onClick={handleSave}
					disabled={isSaving || (!fiveHourPct && !weeklyPct)}
					className="px-4 py-1.5 text-xs font-medium rounded transition-colors"
					style={{
						backgroundColor: theme.colors.accent,
						color: theme.colors.accentForeground,
						opacity: isSaving || (!fiveHourPct && !weeklyPct) ? 0.5 : 1,
					}}
				>
					{isSaving ? 'Saving...' : 'Save Calibration'}
				</button>

				<button
					onClick={onViewHistory}
					className="px-3 py-1.5 text-xs rounded border transition-colors hover:opacity-80 flex items-center gap-1.5"
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

			{saveError && (
				<div
					className="text-xs px-3 py-1.5 rounded"
					style={{ color: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)' }}
				>
					{saveError}
				</div>
			)}

			{calibration.lastCalibratedAt && (
				<div className="text-xs" style={{ color: theme.colors.textDim }}>
					Last calibrated: {new Date(calibration.lastCalibratedAt).toLocaleString()}
				</div>
			)}
		</div>
	);
}
