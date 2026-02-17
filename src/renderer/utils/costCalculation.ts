/**
 * Cost Calculation Utilities
 *
 * Provides billing-mode-aware cost display functions.
 * Delegates to existing shared formatters and pricing infrastructure
 * rather than duplicating cost calculation logic.
 *
 * The main process calculates `totalCostUsd` on UsageStats using the
 * appropriate billing mode (API vs Max), so this module primarily
 * provides the display layer for those pre-calculated costs.
 *
 * @module utils/costCalculation
 */

import type { UsageStats } from '../../shared/types';
import type { BillingModeDisplay } from '../../shared/formatters';

// Re-export formatting utilities for convenience
export { formatCost, getCostTooltip } from '../../shared/formatters';
export type { BillingModeDisplay } from '../../shared/formatters';

/**
 * Get the appropriate display cost based on billing mode.
 *
 * Note: `totalCostUsd` on UsageStats is already calculated by the main process
 * with billing-mode awareness (e.g., cache tokens are free for Max subscribers).
 * This function extracts the cost value with a safe fallback.
 *
 * @param stats - Usage statistics (contains pre-calculated totalCostUsd)
 * @param _billingMode - The billing mode (reserved for future per-mode overrides)
 * @returns The cost to display in USD
 */
export function getDisplayCost(
	stats: UsageStats | undefined,
	_billingMode?: BillingModeDisplay
): number {
	if (!stats) return 0;
	return stats.totalCostUsd ?? 0;
}
