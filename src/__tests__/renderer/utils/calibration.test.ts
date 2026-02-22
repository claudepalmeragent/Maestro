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

		it('includes Quality Weight and Effective Weight columns in header', () => {
			const csv = exportCalibrationCsv([makePoint()]);
			const headerLine = csv.split('\n')[0];
			expect(headerLine).toContain('Quality Weight');
			expect(headerLine).toContain('Effective Weight');
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

		it('effective weight equals quality weight when only one point (recency = 1.0)', () => {
			const point = makePoint({ weight: 0.9 });
			const csv = exportCalibrationCsv([point]);
			const lines = csv.split('\n');
			const values = lines[1].split(',');
			// Quality weight index = 6, Effective weight index = 7
			expect(values[6]).toBe('0.90');
			expect(values[7]).toBe('0.9000');
		});

		it('effective weight is less than quality weight for older points', () => {
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

			const olderEffective = parseFloat(olderValues[7]);
			const newerEffective = parseFloat(newerValues[7]);

			expect(olderEffective).toBeCloseTo(0.45, 2); // 0.9 * 0.5
			expect(newerEffective).toBeCloseTo(0.9, 2); // 0.9 * 1.0
			expect(olderEffective).toBeLessThan(newerEffective);
		});

		it('computes recency per window independently', () => {
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

			// Both are the newest (and only) point in their window, so effective = quality
			expect(fiveHrValues[7]).toBe('0.8000');
			expect(weeklyValues[7]).toBe('0.8000');
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
