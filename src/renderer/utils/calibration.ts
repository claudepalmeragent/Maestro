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
 * Compute a recency multiplier using exponential decay.
 * Half-life of 7 days: points lose half their influence every 7 days.
 * Applied at compute time — not stored on calibration points.
 */
export function recencyMultiplier(pointTimestamp: string, newestTimestamp: string): number {
	const ageMs = new Date(newestTimestamp).getTime() - new Date(pointTimestamp).getTime();
	const ageDays = Math.max(0, ageMs / (86400 * 1000));
	const HALF_LIFE_DAYS = 7;
	return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

/**
 * Compute a quality-weighted trimmed mean budget estimate from calibration points.
 */
export function computeBudgetEstimate(
	points: CalibrationPoint[],
	window: '5hr' | 'weekly' | 'sonnet-weekly'
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

	// Find newest timestamp for recency calculation
	const newestTimestamp = windowPoints.reduce((newest, p) => {
		return p.timestamp > newest ? p.timestamp : newest;
	}, windowPoints[0].timestamp);

	// Compute effective weights (quality weight * recency multiplier)
	const effectiveWeights = windowPoints.map(
		(p) => p.weight * recencyMultiplier(p.timestamp, newestTimestamp)
	);

	// Step 1: Initial weighted mean (all points)
	const initialMean = weightedMean(windowPoints, effectiveWeights);
	const initialStdDev = weightedStdDev(windowPoints, initialMean, effectiveWeights);

	// Step 2: Flag outliers (>2σ from mean)
	for (const point of windowPoints) {
		point.isOutlier =
			initialStdDev > 0 && Math.abs(point.derivedBudget - initialMean) > 2 * initialStdDev;
	}

	// Step 3: Recompute excluding outliers
	const activePoints = windowPoints.filter((p) => !p.isOutlier);
	const activeWeights = windowPoints
		.map((p, i) => ({ point: p, weight: effectiveWeights[i] }))
		.filter(({ point }) => !point.isOutlier)
		.map(({ weight }) => weight);

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

	const finalMean = weightedMean(activePoints, activeWeights);
	const finalStdDev = weightedStdDev(activePoints, finalMean, activeWeights);
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
 * Uses effectiveWeights if provided, otherwise falls back to p.weight.
 */
function weightedMean(points: CalibrationPoint[], effectiveWeights?: number[]): number {
	let sumWeighted = 0;
	let sumWeights = 0;
	for (let i = 0; i < points.length; i++) {
		const w = effectiveWeights ? effectiveWeights[i] : points[i].weight;
		sumWeighted += points[i].derivedBudget * w;
		sumWeights += w;
	}
	return sumWeights > 0 ? sumWeighted / sumWeights : 0;
}

/**
 * Compute quality-weighted standard deviation.
 * Uses effectiveWeights if provided, otherwise falls back to p.weight.
 */
function weightedStdDev(
	points: CalibrationPoint[],
	mean: number,
	effectiveWeights?: number[]
): number {
	if (points.length < 2) return 0;
	let sumWeightedSqDiff = 0;
	let sumWeights = 0;
	for (let i = 0; i < points.length; i++) {
		const w = effectiveWeights ? effectiveWeights[i] : points[i].weight;
		sumWeightedSqDiff += w * (points[i].derivedBudget - mean) ** 2;
		sumWeights += w;
	}
	return sumWeights > 0 ? Math.sqrt(sumWeightedSqDiff / sumWeights) : 0;
}

/**
 * Create a new CalibrationPoint from user input + Honeycomb data.
 */
export function createCalibrationPoint(
	existingPoints: CalibrationPoint[],
	window: '5hr' | 'weekly' | 'sonnet-weekly',
	claudeUsagePct: number,
	honeycombBillableTokens: number,
	timeRemainingInWindow?: string
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
		timeRemainingInWindow,
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
		'Quality Weight',
		'Contribution %',
		'Status',
		'Time Remaining In Window',
	].join(',');

	// Pre-compute newest timestamp per window for recency calculation
	const newestByWindow: Record<string, string> = {};
	for (const p of points) {
		if (!newestByWindow[p.window] || p.timestamp > newestByWindow[p.window]) {
			newestByWindow[p.window] = p.timestamp;
		}
	}

	// Pre-compute normalized contribution per window
	const windowGroups: Record<string, CalibrationPoint[]> = {};
	for (const p of points) {
		if (!windowGroups[p.window]) windowGroups[p.window] = [];
		windowGroups[p.window].push(p);
	}

	const contributionMap = new Map<string, number | null>();
	for (const [windowName, windowPoints] of Object.entries(windowGroups)) {
		const newest = newestByWindow[windowName] || windowPoints[0].timestamp;
		const allOutliers = windowPoints.every((p) => p.isOutlier);
		const contributing = allOutliers ? windowPoints : windowPoints.filter((p) => !p.isOutlier);
		const sumEffective = contributing.reduce(
			(sum, p) => sum + p.weight * recencyMultiplier(p.timestamp, newest),
			0
		);

		for (const p of windowPoints) {
			const ew = p.weight * recencyMultiplier(p.timestamp, newest);
			const key = `${p.window}-${p.id}`;
			if (p.isOutlier && !allOutliers) {
				contributionMap.set(key, null);
			} else {
				contributionMap.set(key, sumEffective > 0 ? ew / sumEffective : 0);
			}
		}
	}

	const rows = points.map((p) => {
		const key = `${p.window}-${p.id}`;
		const contribution = contributionMap.get(key) ?? null;
		return [
			p.id,
			p.timestamp,
			p.window,
			p.claudeUsagePct,
			p.honeycombBillableTokens,
			p.derivedBudget,
			p.weight.toFixed(2),
			contribution !== null ? (contribution * 100).toFixed(1) : '—',
			p.isOutlier ? 'Outlier' : 'Active',
			p.timeRemainingInWindow || '',
		].join(',');
	});

	return [headers, ...rows].join('\n');
}
