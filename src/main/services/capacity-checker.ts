/**
 * capacity-checker.ts
 *
 * Pre-run capacity check service that evaluates whether starting
 * a task would exceed plan limits. Uses LocalTokenLedger for
 * best-available usage estimates and calibration data for
 * percentage-based checks.
 *
 * @see Investigation plan Section 23.2
 */

import {
	scoreTaskComplexity,
	complexityToEstimatedPct,
	type TaskDescriptor,
	type TaskComplexity,
} from '../utils/task-complexity-scorer';

export interface UsageEstimate {
	billableTokens: number;
	estimatedUnflushed: number;
	safetyMargin: number;
	total: number;
	confidenceLevel: 'synced' | 'pending' | 'stale';
	asPercentOfBudget: number | null;
}

export interface CapacityCheckResult {
	canProceed: boolean;
	reason?: 'burst_limit' | 'weekly_limit' | 'both';
	currentUsage: {
		fiveHour: UsageEstimate;
		weekly: UsageEstimate;
	};
	taskComplexity: TaskComplexity;
	estimatedTaskPct: number;
	safetyBufferPct: number;
}

export interface CapacityCheckerConfig {
	safetyBufferPct: number;
	capacityCheckAutoRun: boolean;
	capacityCheckInteractive: boolean;
}

export interface LedgerProvider {
	bestAvailableEstimate(window: '5hr' | 'weekly'): UsageEstimate;
}

/**
 * Check whether there is capacity to run a given task.
 */
export function checkCapacity(
	task: TaskDescriptor,
	ledger: LedgerProvider,
	config: CapacityCheckerConfig
): CapacityCheckResult {
	const fiveHour = ledger.bestAvailableEstimate('5hr');
	const weekly = ledger.bestAvailableEstimate('weekly');
	const complexity = scoreTaskComplexity(task);
	const estimatedTaskPct = complexityToEstimatedPct(complexity);
	const buffer = config.safetyBufferPct;

	const baseResult = {
		currentUsage: { fiveHour, weekly },
		taskComplexity: complexity,
		estimatedTaskPct,
		safetyBufferPct: buffer,
	};

	// If no calibration data, can't do percentage checks → proceed
	if (fiveHour.asPercentOfBudget === null && weekly.asPercentOfBudget === null) {
		return { ...baseResult, canProceed: true };
	}

	// Check burst (5-hr) limit
	const fiveHourPct = fiveHour.asPercentOfBudget ?? 0;
	const burstExceeded =
		fiveHourPct >= 100 - buffer || fiveHourPct + estimatedTaskPct >= 100 - buffer;

	// Check weekly limit
	const weeklyPct = weekly.asPercentOfBudget ?? 0;
	const weeklyExceeded = weeklyPct >= 100 - buffer || weeklyPct + estimatedTaskPct >= 100 - buffer;

	if (burstExceeded && weeklyExceeded) {
		return { ...baseResult, canProceed: false, reason: 'both' };
	}
	if (burstExceeded) {
		return { ...baseResult, canProceed: false, reason: 'burst_limit' };
	}
	if (weeklyExceeded) {
		return { ...baseResult, canProceed: false, reason: 'weekly_limit' };
	}

	return { ...baseResult, canProceed: true };
}
