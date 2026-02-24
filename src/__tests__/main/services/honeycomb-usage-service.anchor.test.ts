/**
 * HoneycombUsageService — Anchor Seeding Tests
 *
 * Validates that the start() method seeds the 5-hour window anchor
 * from the MOST RECENT calibration point (by timestamp), not the
 * one with the least time remaining.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before importing the service
const mockStore = {
	_data: {} as Record<string, any>,
	get: vi.fn((key: string, defaultVal?: any) => mockStore._data[key] ?? defaultVal),
	set: vi.fn((key: string, value: any) => {
		mockStore._data[key] = value;
	}),
};

vi.mock('../../../main/stores', () => ({
	getSettingsStore: () => mockStore,
}));

const mockQueryClient = {
	isConfigured: vi.fn().mockReturnValue(true),
	query: vi.fn().mockResolvedValue({ data: { results: [{}] } }),
};

vi.mock('../../../main/services/honeycomb-query-client', () => ({
	getHoneycombQueryClient: () => mockQueryClient,
	DEFAULT_TTL: { FIVE_HOUR: 60000, WEEKLY: 120000, MONTHLY_SESSIONS: 300000 },
}));

vi.mock('../../../main/utils/logger', () => ({
	logger: {
		info: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
	},
}));

vi.mock('electron', () => ({
	BrowserWindow: { getAllWindows: () => [] },
}));

import { HoneycombUsageService } from '../../../main/services/honeycomb-usage-service';

describe('HoneycombUsageService — anchor seeding on start()', () => {
	let service: HoneycombUsageService;

	beforeEach(() => {
		vi.clearAllMocks();
		mockStore._data = {};
		service = new HoneycombUsageService();
	});

	afterEach(() => {
		service.stop();
	});

	it('seeds anchor from the most recent point, not least remaining', () => {
		const oldPointTimestamp = '2026-02-18T10:00:00.000Z'; // 2 days ago
		const freshPointTimestamp = '2026-02-20T14:00:00.000Z'; // most recent

		mockStore._data['planCalibration'] = {
			calibrationPoints: [
				{
					id: 1,
					timestamp: oldPointTimestamp,
					window: '5hr',
					claudeUsagePct: 80,
					honeycombBillableTokens: 3000000,
					derivedBudget: 3750000,
					weight: 0.8,
					isOutlier: false,
					timeRemainingInWindow: '0h 10m', // Old code would pick this (least remaining)
				},
				{
					id: 2,
					timestamp: freshPointTimestamp,
					window: '5hr',
					claudeUsagePct: 50,
					honeycombBillableTokens: 2000000,
					derivedBudget: 4000000,
					weight: 0.5,
					isOutlier: false,
					timeRemainingInWindow: '3h 00m', // 3 hours left
				},
			],
		};

		service.start();

		// Verify store.set was called with the anchor
		expect(mockStore.set).toHaveBeenCalledWith(
			'planCalibration',
			expect.objectContaining({
				fiveHourWindowResetAnchorUtc: expect.any(String),
			})
		);

		// Extract the anchor that was set
		const setCall = mockStore.set.mock.calls.find((c: any[]) => c[0] === 'planCalibration');
		const anchor = setCall![1].fiveHourWindowResetAnchorUtc;
		const anchorMs = new Date(anchor).getTime();

		// The anchor should be based on the FRESH point (2026-02-20T14:00:00.000Z + 3h)
		// = 2026-02-20T17:00:00.000Z
		const expectedMs = new Date(freshPointTimestamp).getTime() + 3 * 60 * 60 * 1000;
		expect(anchorMs).toBe(expectedMs);

		// Verify it's NOT based on the old point (2026-02-18T10:00:00.000Z + 10m)
		const wrongMs = new Date(oldPointTimestamp).getTime() + 10 * 60 * 1000;
		expect(anchorMs).not.toBe(wrongMs);
	});

	it('seeds anchor from timeIntoWindow when timeRemainingInWindow is absent', () => {
		const pointTimestamp = '2026-02-20T12:00:00.000Z';

		mockStore._data['planCalibration'] = {
			calibrationPoints: [
				{
					id: 1,
					timestamp: pointTimestamp,
					window: '5hr',
					claudeUsagePct: 60,
					honeycombBillableTokens: 2400000,
					derivedBudget: 4000000,
					weight: 0.6,
					isOutlier: false,
					timeIntoWindow: '2h 00m', // 2 hours into window → 3 hours remaining
				},
			],
		};

		service.start();

		const setCall = mockStore.set.mock.calls.find((c: any[]) => c[0] === 'planCalibration');
		expect(setCall).toBeDefined();
		const anchor = setCall![1].fiveHourWindowResetAnchorUtc;
		const anchorMs = new Date(anchor).getTime();

		// 5h - 2h = 3h remaining → anchor = timestamp + 3h
		const expectedMs = new Date(pointTimestamp).getTime() + 3 * 60 * 60 * 1000;
		expect(anchorMs).toBe(expectedMs);
	});

	it('does not seed anchor when no 5hr points exist', () => {
		mockStore._data['planCalibration'] = {
			calibrationPoints: [
				{
					id: 1,
					timestamp: '2026-02-20T12:00:00.000Z',
					window: 'weekly', // Not a 5hr point
					claudeUsagePct: 70,
					honeycombBillableTokens: 5000000,
					derivedBudget: 7142857,
					weight: 0.7,
					isOutlier: false,
				},
			],
		};

		service.start();

		// store.set should not have been called with an anchor
		const setCall = mockStore.set.mock.calls.find((c: any[]) => c[0] === 'planCalibration');
		expect(setCall).toBeUndefined();
	});

	it('does not seed anchor when calibrationPoints is empty', () => {
		mockStore._data['planCalibration'] = {
			calibrationPoints: [],
		};

		service.start();

		const setCall = mockStore.set.mock.calls.find((c: any[]) => c[0] === 'planCalibration');
		expect(setCall).toBeUndefined();
	});

	it('picks the most recent even among three points with varying remaining times', () => {
		mockStore._data['planCalibration'] = {
			calibrationPoints: [
				{
					id: 1,
					timestamp: '2026-02-15T08:00:00.000Z', // oldest
					window: '5hr',
					claudeUsagePct: 90,
					honeycombBillableTokens: 3600000,
					derivedBudget: 4000000,
					weight: 0.9,
					isOutlier: false,
					timeRemainingInWindow: '0h 05m', // tiny remaining — old code would pick this
				},
				{
					id: 2,
					timestamp: '2026-02-18T12:00:00.000Z', // middle
					window: '5hr',
					claudeUsagePct: 60,
					honeycombBillableTokens: 2400000,
					derivedBudget: 4000000,
					weight: 0.6,
					isOutlier: false,
					timeRemainingInWindow: '1h 30m',
				},
				{
					id: 3,
					timestamp: '2026-02-20T16:00:00.000Z', // newest
					window: '5hr',
					claudeUsagePct: 40,
					honeycombBillableTokens: 1600000,
					derivedBudget: 4000000,
					weight: 0.4,
					isOutlier: false,
					timeRemainingInWindow: '4h 00m', // most remaining — but most recent
				},
			],
		};

		service.start();

		const setCall = mockStore.set.mock.calls.find((c: any[]) => c[0] === 'planCalibration');
		const anchor = setCall![1].fiveHourWindowResetAnchorUtc;
		const anchorMs = new Date(anchor).getTime();

		// Should be based on point 3: 2026-02-20T16:00:00.000Z + 4h = 2026-02-20T20:00:00.000Z
		const expectedMs = new Date('2026-02-20T16:00:00.000Z').getTime() + 4 * 60 * 60 * 1000;
		expect(anchorMs).toBe(expectedMs);
	});
});
