import { describe, it, expect } from 'vitest';
import {
	checkCapacity,
	type UsageEstimate,
	type LedgerProvider,
	type CapacityCheckerConfig,
} from '../../../main/services/capacity-checker';
import type { TaskDescriptor } from '../../../main/utils/task-complexity-scorer';

function createEstimate(overrides: Partial<UsageEstimate> = {}): UsageEstimate {
	return {
		billableTokens: 0,
		estimatedUnflushed: 0,
		safetyMargin: 0,
		total: 0,
		confidenceLevel: 'synced',
		asPercentOfBudget: null,
		...overrides,
	};
}

function createLedger(
	fiveHr: Partial<UsageEstimate> = {},
	weekly: Partial<UsageEstimate> = {}
): LedgerProvider {
	return {
		bestAvailableEstimate(window: '5hr' | 'weekly') {
			return window === '5hr' ? createEstimate(fiveHr) : createEstimate(weekly);
		},
	};
}

const defaultConfig: CapacityCheckerConfig = {
	safetyBufferPct: 20,
	capacityCheckAutoRun: true,
	capacityCheckInteractive: true,
};

const mediumTask: TaskDescriptor = { numTasks: 5, numFilesTouched: 3 };

describe('checkCapacity', () => {
	it('returns canProceed: true when no calibration data exists', () => {
		const ledger = createLedger();
		const result = checkCapacity(mediumTask, ledger, defaultConfig);
		expect(result.canProceed).toBe(true);
		expect(result.reason).toBeUndefined();
	});

	it('returns canProceed: true when usage is well within limits', () => {
		const ledger = createLedger({ asPercentOfBudget: 30 }, { asPercentOfBudget: 20 });
		const result = checkCapacity(mediumTask, ledger, defaultConfig);
		// 30 + 20 (estimated MEDIUM) = 50, threshold = 80 → OK
		expect(result.canProceed).toBe(true);
	});

	it('returns canProceed: false for burst_limit when 5-hr exceeds threshold', () => {
		const ledger = createLedger({ asPercentOfBudget: 65 }, { asPercentOfBudget: 20 });
		const result = checkCapacity(mediumTask, ledger, defaultConfig);
		// 65 + 20 = 85 >= 80 → burst exceeded
		expect(result.canProceed).toBe(false);
		expect(result.reason).toBe('burst_limit');
	});

	it('returns canProceed: false for weekly_limit when weekly exceeds threshold', () => {
		const ledger = createLedger({ asPercentOfBudget: 30 }, { asPercentOfBudget: 65 });
		const result = checkCapacity(mediumTask, ledger, defaultConfig);
		// weekly: 65 + 20 = 85 >= 80 → weekly exceeded
		expect(result.canProceed).toBe(false);
		expect(result.reason).toBe('weekly_limit');
	});

	it('returns canProceed: false with reason "both" when both limits exceeded', () => {
		const ledger = createLedger({ asPercentOfBudget: 85 }, { asPercentOfBudget: 85 });
		const result = checkCapacity(mediumTask, ledger, defaultConfig);
		expect(result.canProceed).toBe(false);
		expect(result.reason).toBe('both');
	});

	it('detects burst limit when current usage already exceeds threshold', () => {
		const ledger = createLedger({ asPercentOfBudget: 82 }, { asPercentOfBudget: 10 });
		const result = checkCapacity(mediumTask, ledger, defaultConfig);
		// 82 >= 80 → burst exceeded (even without adding task estimate)
		expect(result.canProceed).toBe(false);
		expect(result.reason).toBe('burst_limit');
	});

	it('correctly reports task complexity and estimate', () => {
		const ledger = createLedger();
		const result = checkCapacity(mediumTask, ledger, defaultConfig);
		expect(result.taskComplexity).toBe('MEDIUM');
		expect(result.estimatedTaskPct).toBe(20);
		expect(result.safetyBufferPct).toBe(20);
	});

	it('handles null 5-hr with non-null weekly', () => {
		const ledger = createLedger({ asPercentOfBudget: null }, { asPercentOfBudget: 90 });
		const result = checkCapacity(mediumTask, ledger, defaultConfig);
		// weekly 90 >= 80 → exceeded
		expect(result.canProceed).toBe(false);
		expect(result.reason).toBe('weekly_limit');
	});

	it('handles non-null 5-hr with null weekly', () => {
		const ledger = createLedger({ asPercentOfBudget: 90 }, { asPercentOfBudget: null });
		const result = checkCapacity(mediumTask, ledger, defaultConfig);
		expect(result.canProceed).toBe(false);
		expect(result.reason).toBe('burst_limit');
	});

	it('respects custom safety buffer', () => {
		const config: CapacityCheckerConfig = { ...defaultConfig, safetyBufferPct: 10 };
		const ledger = createLedger({ asPercentOfBudget: 75 }, { asPercentOfBudget: 30 });
		// threshold = 90, 75 + 20 = 95 >= 90 → exceeded
		const result = checkCapacity(mediumTask, ledger, config);
		expect(result.canProceed).toBe(false);
		expect(result.reason).toBe('burst_limit');
	});

	it('uses SMALL task estimate for small tasks', () => {
		const smallTask: TaskDescriptor = {};
		const ledger = createLedger({ asPercentOfBudget: 70 }, { asPercentOfBudget: 30 });
		const result = checkCapacity(smallTask, ledger, defaultConfig);
		// 70 + 12 = 82 >= 80 → exceeded
		expect(result.canProceed).toBe(false);
		expect(result.taskComplexity).toBe('SMALL');
		expect(result.estimatedTaskPct).toBe(12);
	});
});
