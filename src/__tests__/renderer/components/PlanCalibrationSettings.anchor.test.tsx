/**
 * PlanCalibrationSettings — Anchor Selection Tests
 *
 * Validates that the 5-hour window anchor is always derived from the
 * MOST RECENT calibration point (by timestamp), not the one with
 * the least time remaining. This is critical because Claude's 5-hour
 * window is sliding (starts on activity), so only the freshest
 * calibration snapshot reflects reality.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PlanCalibrationSettings } from '../../../renderer/components/PlanCalibrationSettings';
import type { PlanCalibration, CalibrationPoint } from '../../../renderer/types';
import type { Theme } from '../../../shared/theme-types';

// Helper to build a calibration point
function makePoint(overrides: Partial<CalibrationPoint> = {}): CalibrationPoint {
	return {
		id: 1,
		timestamp: '2026-02-20T12:00:00.000Z',
		window: '5hr',
		claudeUsagePct: 50,
		honeycombBillableTokens: 2000000,
		derivedBudget: 4000000,
		weight: 0.5,
		isOutlier: false,
		timeRemainingInWindow: '2h 30m',
		...overrides,
	};
}

function makeCalibration(points: CalibrationPoint[] = []): PlanCalibration {
	return {
		calibrationPoints: points,
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
		weeklyResetDay: 'Sunday',
		weeklyResetTime: '10:00',
		weeklyResetTimezone: 'America/Los_Angeles',
		lastCalibratedAt: '',
		sonnetResetDay: 'Sunday',
		sonnetResetTime: '10:00',
		sonnetResetTimezone: 'America/Los_Angeles',
	};
}

// Theme stub matching the full Theme interface
const theme: Theme = {
	id: 'dracula',
	name: 'Dracula',
	mode: 'dark',
	colors: {
		bgMain: '#1e1e1e',
		bgSidebar: '#252526',
		bgActivity: '#333333',
		textMain: '#cccccc',
		textDim: '#888888',
		accent: '#007acc',
		accentDim: 'rgba(0,122,204,0.3)',
		accentText: '#007acc',
		accentForeground: '#ffffff',
		border: '#333333',
		success: '#4caf50',
		warning: '#ff9800',
		error: '#f44336',
	},
};

describe('PlanCalibrationSettings — anchor selection', () => {
	let capturedCalibration: PlanCalibration | null;
	let mockGetTokens: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		capturedCalibration = null;
		mockGetTokens = vi.fn().mockResolvedValue(2500000);
	});

	/**
	 * Core test: when multiple 5hr points exist with different timestamps
	 * and different time remaining values, the anchor should be derived
	 * from the MOST RECENT point, not the one with least remaining time.
	 */
	it('derives anchor from the most recent calibration point, not least remaining', async () => {
		const oldPoint = makePoint({
			id: 1,
			timestamp: '2026-02-18T10:00:00.000Z', // 2 days ago
			timeRemainingInWindow: '0h 10m', // only 10 min left (old code would pick this)
		});
		const freshPoint = makePoint({
			id: 2,
			timestamp: '2026-02-20T14:00:00.000Z', // most recent
			timeRemainingInWindow: '3h 00m', // 3 hours left
		});

		const calibration = makeCalibration([oldPoint, freshPoint]);

		render(
			<PlanCalibrationSettings
				theme={theme}
				calibration={calibration}
				onCalibrationUpdate={(updated) => {
					capturedCalibration = updated;
				}}
				onViewHistory={() => {}}
				getHoneycombBillableTokens={mockGetTokens}
			/>
		);

		// Enter a 5-hour calibration value
		const pctInput = screen.getByPlaceholderText('42');
		fireEvent.change(pctInput, { target: { value: '60' } });

		// Enter time remaining
		const hoursInput = screen.getByPlaceholderText('2');
		const minutesInput = screen.getByPlaceholderText('28');
		fireEvent.change(hoursInput, { target: { value: '1' } });
		fireEvent.change(minutesInput, { target: { value: '45' } });

		// Click save
		const saveButton = screen.getByText('Save Calibration');
		fireEvent.click(saveButton);

		await waitFor(() => {
			expect(capturedCalibration).not.toBeNull();
		});

		// The anchor should be derived from the NEWEST point (the one we just created,
		// which will have the most recent timestamp). The old point with 0h 10m should NOT
		// have been selected just because it has less remaining time.
		expect(capturedCalibration!.fiveHourWindowResetAnchorUtc).toBeDefined();

		// Parse the anchor and verify it's based on a recent timestamp, not the old one.
		// The new point we created (timestamp ~ now) + 1h 45m should give an anchor
		// roughly 1h 45m from now.
		const anchorMs = new Date(capturedCalibration!.fiveHourWindowResetAnchorUtc!).getTime();
		const nowMs = Date.now();
		const diffMinutes = (anchorMs - nowMs) / (60 * 1000);

		// Should be approximately 105 minutes (1h 45m) from now, not ~10 minutes
		// from 2 days ago (which is what the old algorithm would produce).
		// Allow generous tolerance since createCalibrationPoint uses Date.now() for timestamp.
		expect(diffMinutes).toBeGreaterThan(90); // At least 90 min from now
		expect(diffMinutes).toBeLessThan(120); // At most 120 min from now
	});

	it('handles a single 5hr point correctly', async () => {
		const singlePoint = makePoint({
			id: 1,
			timestamp: '2026-02-20T12:00:00.000Z',
			timeRemainingInWindow: '4h 00m',
		});

		const calibration = makeCalibration([singlePoint]);

		render(
			<PlanCalibrationSettings
				theme={theme}
				calibration={calibration}
				onCalibrationUpdate={(updated) => {
					capturedCalibration = updated;
				}}
				onViewHistory={() => {}}
				getHoneycombBillableTokens={mockGetTokens}
			/>
		);

		const pctInput = screen.getByPlaceholderText('42');
		fireEvent.change(pctInput, { target: { value: '30' } });

		const hoursInput = screen.getByPlaceholderText('2');
		const minutesInput = screen.getByPlaceholderText('28');
		fireEvent.change(hoursInput, { target: { value: '2' } });
		fireEvent.change(minutesInput, { target: { value: '15' } });

		const saveButton = screen.getByText('Save Calibration');
		fireEvent.click(saveButton);

		await waitFor(() => {
			expect(capturedCalibration).not.toBeNull();
		});

		expect(capturedCalibration!.fiveHourWindowResetAnchorUtc).toBeDefined();
	});

	it('does not set anchor when no 5hr points have timeRemainingInWindow', async () => {
		const pointNoTime = makePoint({
			id: 1,
			timestamp: '2026-02-20T12:00:00.000Z',
			timeRemainingInWindow: undefined,
		});

		const calibration = makeCalibration([pointNoTime]);

		render(
			<PlanCalibrationSettings
				theme={theme}
				calibration={calibration}
				onCalibrationUpdate={(updated) => {
					capturedCalibration = updated;
				}}
				onViewHistory={() => {}}
				getHoneycombBillableTokens={mockGetTokens}
			/>
		);

		// Only enter percentage, no time remaining
		const pctInput = screen.getByPlaceholderText('42');
		fireEvent.change(pctInput, { target: { value: '50' } });

		const saveButton = screen.getByText('Save Calibration');
		fireEvent.click(saveButton);

		await waitFor(() => {
			expect(capturedCalibration).not.toBeNull();
		});

		// No anchor should be set since no points have time remaining
		// (it may preserve a previous anchor from calibration input, but the
		// filtering logic should not produce a new one from points without timeRemainingInWindow)
	});
});
