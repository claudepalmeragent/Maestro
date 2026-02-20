import { ipcMain } from 'electron';
import type { CapacityCheckResult, UsageEstimate } from '../../services/capacity-checker';
import type { TaskDescriptor } from '../../utils/task-complexity-scorer';

export function registerHoneycombCapacityHandlers(): void {
	ipcMain.handle(
		'honeycomb:capacity-check',
		async (_event, _task: TaskDescriptor): Promise<CapacityCheckResult> => {
			// Placeholder: when LocalTokenLedger and settings are wired up,
			// this will call checkCapacity with real data.
			// For now, return a "can proceed" result.
			const placeholderEstimate: UsageEstimate = {
				billableTokens: 0,
				estimatedUnflushed: 0,
				safetyMargin: 0,
				total: 0,
				confidenceLevel: 'synced',
				asPercentOfBudget: null,
			};

			return {
				canProceed: true,
				currentUsage: {
					fiveHour: placeholderEstimate,
					weekly: placeholderEstimate,
				},
				taskComplexity: 'MEDIUM',
				estimatedTaskPct: 20,
				safetyBufferPct: 20,
			};
		}
	);
}
