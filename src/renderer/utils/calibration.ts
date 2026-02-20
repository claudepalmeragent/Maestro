/**
 * calibration.ts
 *
 * Quality-weighted trimmed mean algorithm for plan budget calibration.
 * Computes convergent budget estimates from calibration data points.
 *
 * Algorithm:
 * 1. Assign quality weight = claudeUsagePct / 100 (higher % = more reliable)
 * 2. Compute weighted mean of derived budgets
 * 3. Compute weighted standard deviation
 * 4. Flag outliers: |derivedBudget - weightedMean| > 2σ
 * 5. Recompute excluding outliers → final estimate
 * 6. Confidence = 100 - (σ / mean × 100), capped at 99.9%
 *
 * @see Investigation plan Section 16.6.3
 */

import type { CalibrationPoint, BudgetEstimate } from '../types';

/**
 * Compute a quality-weighted trimmed mean budget estimate from calibration points.
 */
export function computeBudgetEstimate(
	points: CalibrationPoint[],
	window: '5hr' | 'weekly'
): BudgetEstimate {
	const windowPoints = points.filter((p) => p.window === window);

	if (windowPoints.length === 0) {
		return {
			weightedMean: 0,
			standardDeviation: 0,
			confidencePct: 0,
			activePoints: 0,
			totalPoints: 0,
		};
	}

	// Step 1: Initial weighted mean (all points)
	const initialMean = weightedMean(windowPoints);
	const initialStdDev = weightedStdDev(windowPoints, initialMean);

	// Step 2: Flag outliers (>2σ from mean)
	for (const point of windowPoints) {
		point.isOutlier =
			initialStdDev > 0 && Math.abs(point.derivedBudget - initialMean) > 2 * initialStdDev;
	}

	// Step 3: Recompute excluding outliers
	const activePoints = windowPoints.filter((p) => !p.isOutlier);

	if (activePoints.length === 0) {
		// All points are outliers — use all of them
		const mean = initialMean;
		const stdDev = initialStdDev;
		const confidence = stdDev > 0 ? Math.min(99.9, 100 - (stdDev / mean) * 100) : 0;
		return {
			weightedMean: Math.round(mean),
			standardDeviation: Math.round(stdDev),
			confidencePct: Math.max(0, Number(confidence.toFixed(1))),
			activePoints: windowPoints.length,
			totalPoints: windowPoints.length,
		};
	}

	const finalMean = weightedMean(activePoints);
	const finalStdDev = weightedStdDev(activePoints, finalMean);
	const confidence = finalMean > 0 ? Math.min(99.9, 100 - (finalStdDev / finalMean) * 100) : 0;

	return {
		weightedMean: Math.round(finalMean),
		standardDeviation: Math.round(finalStdDev),
		confidencePct: Math.max(0, Number(confidence.toFixed(1))),
		activePoints: activePoints.length,
		totalPoints: windowPoints.length,
	};
}

/**
 * Compute quality-weighted mean of derived budgets.
 * Weight = claudeUsagePct / 100 (higher usage % = more reliable).
 */
function weightedMean(points: CalibrationPoint[]): number {
	let sumWeighted = 0;
	let sumWeights = 0;
	for (const p of points) {
		sumWeighted += p.derivedBudget * p.weight;
		sumWeights += p.weight;
	}
	return sumWeights > 0 ? sumWeighted / sumWeights : 0;
}

/**
 * Compute quality-weighted standard deviation.
 */
function weightedStdDev(points: CalibrationPoint[], mean: number): number {
	if (points.length < 2) return 0;
	let sumWeightedSqDiff = 0;
	let sumWeights = 0;
	for (const p of points) {
		sumWeightedSqDiff += p.weight * (p.derivedBudget - mean) ** 2;
		sumWeights += p.weight;
	}
	return sumWeights > 0 ? Math.sqrt(sumWeightedSqDiff / sumWeights) : 0;
}

/**
 * Create a new CalibrationPoint from user input + Honeycomb data.
 */
export function createCalibrationPoint(
	existingPoints: CalibrationPoint[],
	window: '5hr' | 'weekly',
	claudeUsagePct: number,
	honeycombBillableTokens: number,
	timeIntoWindow?: string
): CalibrationPoint {
	const derivedBudget =
		claudeUsagePct > 0 ? Math.round(honeycombBillableTokens / (claudeUsagePct / 100)) : 0;

	const windowPoints = existingPoints.filter((p) => p.window === window);
	const nextId = windowPoints.length > 0 ? Math.max(...windowPoints.map((p) => p.id)) + 1 : 1;

	return {
		id: nextId,
		timestamp: new Date().toISOString(),
		window,
		claudeUsagePct,
		honeycombBillableTokens,
		derivedBudget,
		weight: claudeUsagePct / 100,
		isOutlier: false,
		timeIntoWindow,
	};
}

/**
 * Format token count for display (e.g., 3,637,000 → "3.64M").
 */
export function formatTokenCount(tokens: number): string {
	if (tokens >= 1_000_000) {
		return `${(tokens / 1_000_000).toFixed(2)}M`;
	}
	if (tokens >= 1_000) {
		return `${(tokens / 1_000).toFixed(1)}K`;
	}
	return tokens.toLocaleString();
}

/**
 * Export calibration points to CSV string.
 */
export function exportCalibrationCsv(points: CalibrationPoint[]): string {
	const headers = [
		'ID',
		'Date',
		'Window',
		'Usage %',
		'Billable Tokens',
		'Derived Budget',
		'Weight',
		'Status',
		'Time Into Window',
	].join(',');

	const rows = points.map((p) =>
		[
			p.id,
			p.timestamp,
			p.window,
			p.claudeUsagePct,
			p.honeycombBillableTokens,
			p.derivedBudget,
			p.weight.toFixed(2),
			p.isOutlier ? 'Outlier' : 'Active',
			p.timeIntoWindow || '',
		].join(',')
	);

	return [headers, ...rows].join('\n');
}
