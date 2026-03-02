import {
	recencyMultiplier,
	formatTokenCount,
	exportCalibrationCsv,
	computeBudgetEstimate,
	createCalibrationPoint,
} from '../../../renderer/utils/calibration';
import type { CalibrationPoint } from '../../../renderer/types';

describe('calibration utilities', () => {
	describe('recencyMultiplier', () => {
		it('returns 1.0 when point timestamp equals newest timestamp', () => {
			const ts = '2026-02-20T12:00:00.000Z';
			expect(recencyMultiplier(ts, ts)).toBe(1.0);
		});

		it('returns 0.5 after exactly 7 days (half-life)', () => {
			const newest = '2026-02-20T12:00:00.000Z';
			const sevenDaysAgo = '2026-02-13T12:00:00.000Z';
			expect(recencyMultiplier(sevenDaysAgo, newest)).toBeCloseTo(0.5, 5);
		});

		it('returns 0.25 after 14 days (two half-lives)', () => {
			const newest = '2026-02-20T12:00:00.000Z';
			const fourteenDaysAgo = '2026-02-06T12:00:00.000Z';
			expect(recencyMultiplier(fourteenDaysAgo, newest)).toBeCloseTo(0.25, 5);
		});

		it('returns value between 0 and 1 for intermediate ages', () => {
			const newest = '2026-02-20T12:00:00.000Z';
			const threeDaysAgo = '2026-02-17T12:00:00.000Z';
			const result = recencyMultiplier(threeDaysAgo, newest);
			expect(result).toBeGreaterThan(0);
			expect(result).toBeLessThan(1);
			expect(result).toBeGreaterThan(0.5); // less than one half-life
		});

		it('returns 1.0 when point is newer than "newest" (clamped to 0 age)', () => {
			const oldest = '2026-02-13T12:00:00.000Z';
			const newer = '2026-02-20T12:00:00.000Z';
			// When point is newer than "newest", age is negative, clamped to 0
			expect(recencyMultiplier(newer, oldest)).toBe(1.0);
		});
	});

	describe('exportCalibrationCsv', () => {
		const makePoint = (overrides: Partial<CalibrationPoint> = {}): CalibrationPoint => ({
			id: 1,
			timestamp: '2026-02-20T12:00:00.000Z',
			window: '5hr',
			claudeUsagePct: 90,
			honeycombBillableTokens: 3637000,
			derivedBudget: 4041111,
			weight: 0.9,
			isOutlier: false,
			timeRemainingInWindow: '2h 30m',
			...overrides,
		});

		it('includes Quality Weight and Contribution % columns in header', () => {
			const csv = exportCalibrationCsv([makePoint()]);
			const headerLine = csv.split('\n')[0];
			expect(headerLine).toContain('Quality Weight');
			expect(headerLine).toContain('Contribution %');
			expect(headerLine).not.toContain(',Weight,');
		});

		it('has 10 columns in header', () => {
			const csv = exportCalibrationCsv([makePoint()]);
			const headerLine = csv.split('\n')[0];
			const headers = headerLine.split(',');
			expect(headers).toHaveLength(10);
		});

		it('has 10 values per row', () => {
			const csv = exportCalibrationCsv([makePoint()]);
			const lines = csv.split('\n');
			const dataRow = lines[1].split(',');
			expect(dataRow).toHaveLength(10);
		});

		it('contribution is 100% when only one point in window', () => {
			const point = makePoint({ weight: 0.9 });
			const csv = exportCalibrationCsv([point]);
			const lines = csv.split('\n');
			const values = lines[1].split(',');
			// Quality weight index = 6, Contribution % index = 7
			expect(values[6]).toBe('0.90');
			expect(values[7]).toBe('100.0');
		});

		it('older points have lower contribution % than newer points', () => {
			const newerPoint = makePoint({
				id: 2,
				timestamp: '2026-02-20T12:00:00.000Z',
				weight: 0.9,
			});
			const olderPoint = makePoint({
				id: 1,
				timestamp: '2026-02-13T12:00:00.000Z', // 7 days older
				weight: 0.9,
			});
			const csv = exportCalibrationCsv([olderPoint, newerPoint]);
			const lines = csv.split('\n');
			const olderValues = lines[1].split(',');
			const newerValues = lines[2].split(',');

			const olderContribution = parseFloat(olderValues[7]);
			const newerContribution = parseFloat(newerValues[7]);

			// ew_older = 0.9 * 0.5 = 0.45, ew_newer = 0.9 * 1.0 = 0.9, sum = 1.35
			// contribution_older = 0.45/1.35*100 ≈ 33.3%, contribution_newer = 0.9/1.35*100 ≈ 66.7%
			expect(olderContribution).toBeCloseTo(33.3, 1);
			expect(newerContribution).toBeCloseTo(66.7, 1);
			expect(olderContribution).toBeLessThan(newerContribution);
		});

		it('computes contribution per window independently', () => {
			const fiveHrPoint = makePoint({
				id: 1,
				window: '5hr',
				timestamp: '2026-02-20T12:00:00.000Z',
				weight: 0.8,
			});
			const weeklyPoint = makePoint({
				id: 1,
				window: 'weekly',
				timestamp: '2026-02-20T12:00:00.000Z',
				weight: 0.8,
			});
			const csv = exportCalibrationCsv([fiveHrPoint, weeklyPoint]);
			const lines = csv.split('\n');
			const fiveHrValues = lines[1].split(',');
			const weeklyValues = lines[2].split(',');

			// Both are the only point in their window, so contribution = 100%
			expect(fiveHrValues[7]).toBe('100.0');
			expect(weeklyValues[7]).toBe('100.0');
		});
	});

	describe('calibration point radius scaling', () => {
		// Replicates the formula: Math.max(2, Math.min(5, Math.round(120 / count)))
		const calcRadius = (count: number) => Math.max(2, Math.min(5, Math.round(120 / count)));
		const calcOutlierRadius = (count: number) => Math.max(1.5, calcRadius(count) - 1);

		it('returns max radius (5) for small point counts', () => {
			expect(calcRadius(1)).toBe(5);
			expect(calcRadius(10)).toBe(5);
			expect(calcRadius(24)).toBe(5);
		});

		it('scales down for medium point counts', () => {
			expect(calcRadius(30)).toBe(4);
			expect(calcRadius(40)).toBe(3);
		});

		it('reaches minimum radius (2) for large point counts', () => {
			expect(calcRadius(60)).toBe(2);
			expect(calcRadius(100)).toBe(2);
			expect(calcRadius(200)).toBe(2);
		});

		it('outlier radius is 1 less than normal (min 1.5)', () => {
			expect(calcOutlierRadius(10)).toBe(4);
			expect(calcOutlierRadius(30)).toBe(3);
			expect(calcOutlierRadius(60)).toBe(1.5);
			expect(calcOutlierRadius(100)).toBe(1.5);
		});
	});

	describe('computeBudgetEstimate', () => {
		it('returns zero estimate for empty points', () => {
			const result = computeBudgetEstimate([], '5hr');
			expect(result.weightedMean).toBe(0);
			expect(result.totalPoints).toBe(0);
		});

		it('computes estimate for a single point', () => {
			const points: CalibrationPoint[] = [
				{
					id: 1,
					timestamp: '2026-02-20T12:00:00.000Z',
					window: '5hr',
					claudeUsagePct: 90,
					honeycombBillableTokens: 3637000,
					derivedBudget: 4041111,
					weight: 0.9,
					isOutlier: false,
				},
			];
			const result = computeBudgetEstimate(points, '5hr');
			expect(result.weightedMean).toBe(4041111);
			expect(result.totalPoints).toBe(1);
			expect(result.activePoints).toBe(1);
		});
	});
});
