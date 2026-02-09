/**
 * Pricing utilities for AI agent cost calculations
 *
 * Centralizes cost calculation logic to eliminate duplication across
 * session storage, IPC handlers, and stats aggregation.
 */

import { CLAUDE_PRICING, TOKENS_PER_MILLION } from '../constants';
import { type ClaudeBillingMode, getPricingForModel, DEFAULT_MODEL_ID } from './claude-pricing';

// Re-export for convenience
export type { ClaudeBillingMode } from './claude-pricing';

/**
 * Pricing configuration type (matches CLAUDE_PRICING structure)
 */
export interface PricingConfig {
	INPUT_PER_MILLION: number;
	OUTPUT_PER_MILLION: number;
	CACHE_READ_PER_MILLION: number;
	CACHE_CREATION_PER_MILLION: number;
}

/**
 * Token counts for cost calculation
 */
export interface TokenCounts {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens?: number;
	cacheCreationTokens?: number;
}

/**
 * Calculate cost for an AI session based on token counts and pricing config.
 *
 * @param tokens - Token counts from session usage
 * @param pricing - Pricing configuration (defaults to CLAUDE_PRICING)
 * @param billingMode - Billing mode ('api' or 'max'). When 'max', cache tokens are free.
 * @returns Total cost in USD
 *
 * @example
 * ```typescript
 * const cost = calculateCost({
 *   inputTokens: 1000,
 *   outputTokens: 500,
 *   cacheReadTokens: 200,
 *   cacheCreationTokens: 100
 * });
 *
 * // With Max billing mode (cache tokens free)
 * const maxCost = calculateCost(tokens, CLAUDE_PRICING, 'max');
 * ```
 */
export function calculateCost(
	tokens: TokenCounts,
	pricing: PricingConfig = CLAUDE_PRICING,
	billingMode: ClaudeBillingMode = 'api'
): number {
	const { inputTokens, outputTokens, cacheReadTokens = 0, cacheCreationTokens = 0 } = tokens;

	// Apply billing mode adjustments
	// Cache tokens are FREE for Max subscribers
	const effectivePricing: PricingConfig =
		billingMode === 'max'
			? {
					...pricing,
					CACHE_READ_PER_MILLION: 0,
					CACHE_CREATION_PER_MILLION: 0,
				}
			: pricing;

	const inputCost = (inputTokens / TOKENS_PER_MILLION) * effectivePricing.INPUT_PER_MILLION;
	const outputCost = (outputTokens / TOKENS_PER_MILLION) * effectivePricing.OUTPUT_PER_MILLION;
	const cacheReadCost =
		(cacheReadTokens / TOKENS_PER_MILLION) * effectivePricing.CACHE_READ_PER_MILLION;
	const cacheCreationCost =
		(cacheCreationTokens / TOKENS_PER_MILLION) * effectivePricing.CACHE_CREATION_PER_MILLION;

	return inputCost + outputCost + cacheReadCost + cacheCreationCost;
}

/**
 * Calculate cost using individual token parameters (legacy interface).
 *
 * @deprecated Use calculateCost() with TokenCounts object instead
 */
export function calculateClaudeCost(
	inputTokens: number,
	outputTokens: number,
	cacheReadTokens: number,
	cacheCreationTokens: number
): number {
	return calculateCost({
		inputTokens,
		outputTokens,
		cacheReadTokens,
		cacheCreationTokens,
	});
}

/**
 * Calculate cost with model-specific pricing.
 * Combines model lookup and cost calculation in a single function.
 *
 * @param tokens - Token counts from session usage
 * @param modelId - The Claude model ID (e.g., 'claude-opus-4-5-20251101')
 * @param billingMode - Billing mode ('api' or 'max'). When 'max', cache tokens are free.
 * @returns Total cost in USD
 *
 * @example
 * ```typescript
 * const cost = calculateClaudeCostWithModel(
 *   { inputTokens: 1000, outputTokens: 500 },
 *   'claude-opus-4-5-20251101',
 *   'api'
 * );
 * ```
 */
export function calculateClaudeCostWithModel(
	tokens: TokenCounts,
	modelId: string,
	billingMode: ClaudeBillingMode = 'api'
): number {
	// Get model-specific pricing, fall back to default model pricing if not found
	const pricing = getPricingForModel(modelId) || getPricingForModel(DEFAULT_MODEL_ID);

	// Should never be null since DEFAULT_MODEL_ID is always valid
	if (!pricing) {
		return calculateCost(tokens, CLAUDE_PRICING, billingMode);
	}

	return calculateCost(tokens, pricing, billingMode);
}
