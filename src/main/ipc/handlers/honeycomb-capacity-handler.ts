import { ipcMain } from 'electron';
import { logger } from '../../utils/logger';
import { checkCapacity } from '../../services/capacity-checker';
import type {
	CapacityCheckResult,
	UsageEstimate,
	LedgerProvider,
} from '../../services/capacity-checker';
import type { TaskDescriptor } from '../../utils/task-complexity-scorer';
import { getHoneycombUsageService } from '../../services/honeycomb-usage-service';
import { getSettingsStore } from '../../stores';

export function registerHoneycombCapacityHandlers(): void {
	ipcMain.handle(
		'honeycomb:capacity-check',
		async (_event, task: TaskDescriptor): Promise<CapacityCheckResult> => {
			const usageService = getHoneycombUsageService();
			const latestUsage = usageService.getLatest();
			const store = getSettingsStore();
			const planCalibration = store.get('planCalibration', null) as any;
			const warningSettings = store.get('honeycombWarningSettings');

			// If no calibration, can't do percentage checks — allow to proceed
			if (!planCalibration) {
				logger.warn(
					'Capacity check: No calibration data — proceeding without check',
					'CapacityCheck'
				);
				const noDataEstimate: UsageEstimate = {
					billableTokens: 0,
					estimatedUnflushed: 0,
					safetyMargin: 0,
					total: 0,
					confidenceLevel: 'stale',
					asPercentOfBudget: null,
				};
				return {
					canProceed: true,
					currentUsage: { fiveHour: noDataEstimate, weekly: noDataEstimate },
					taskComplexity: 'MEDIUM',
					estimatedTaskPct: 20,
					safetyBufferPct: warningSettings?.safetyBufferPct ?? 20,
				};
			}

			// If no usage data, try a fresh poll before giving up
			let usageData = latestUsage;
			if (!usageData) {
				logger.info('Capacity check: No cached usage data — forcing fresh poll', 'CapacityCheck');
				try {
					usageData = await usageService.forceRefresh();
				} catch (err) {
					logger.warn(
						`Capacity check: Fresh poll failed — proceeding without check: ${err}`,
						'CapacityCheck'
					);
					const noDataEstimate: UsageEstimate = {
						billableTokens: 0,
						estimatedUnflushed: 0,
						safetyMargin: 0,
						total: 0,
						confidenceLevel: 'stale',
						asPercentOfBudget: null,
					};
					return {
						canProceed: true,
						currentUsage: { fiveHour: noDataEstimate, weekly: noDataEstimate },
						taskComplexity: 'MEDIUM',
						estimatedTaskPct: 20,
						safetyBufferPct: warningSettings?.safetyBufferPct ?? 20,
					};
				}
			}

			const fiveHourBudget = planCalibration.currentEstimates?.fiveHour?.weightedMean ?? 0;
			const weeklyBudget = planCalibration.currentEstimates?.weekly?.weightedMean ?? 0;
			const safetyBufferPct = warningSettings?.safetyBufferPct ?? 20;

			// Build a ledger provider from the latest usage data and calibration
			const ledger: LedgerProvider = {
				bestAvailableEstimate(window: '5hr' | 'weekly'): UsageEstimate {
					const tokens =
						window === '5hr' ? usageData.fiveHourBillableTokens : usageData.weeklyBillableTokens;
					const budget = window === '5hr' ? fiveHourBudget : weeklyBudget;
					const safetyMargin = tokens * (safetyBufferPct / 100);

					return {
						billableTokens: tokens,
						estimatedUnflushed: 0,
						safetyMargin,
						total: tokens + safetyMargin,
						confidenceLevel: usageData.stale ? 'stale' : 'synced',
						asPercentOfBudget: budget > 0 ? ((tokens + safetyMargin) / budget) * 100 : null,
					};
				},
			};

			const config = {
				safetyBufferPct,
				capacityCheckAutoRun: warningSettings?.capacityCheckAutoRun ?? true,
				capacityCheckInteractive: warningSettings?.capacityCheckInteractive ?? true,
			};

			// Log the capacity check inputs for debugging
			const fiveHourEst = ledger.bestAvailableEstimate('5hr');
			const weeklyEst = ledger.bestAvailableEstimate('weekly');
			logger.info(
				`Capacity check: 5hr=${fiveHourEst.asPercentOfBudget?.toFixed(1) ?? 'N/A'}% of budget, ` +
					`weekly=${weeklyEst.asPercentOfBudget?.toFixed(1) ?? 'N/A'}% of budget, ` +
					`safetyBuffer=${config.safetyBufferPct}%, ` +
					`task=${(task as any).description?.substring(0, 50) ?? 'unknown'}`,
				'CapacityCheck'
			);

			return checkCapacity(task, ledger, config);
		}
	);
}
