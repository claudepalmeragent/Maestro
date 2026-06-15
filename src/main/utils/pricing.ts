/**
 * Pricing utilities for AI agent cost calculations.
 *
 * Thin main-process re-export of the shared, model-aware pricing in
 * `src/shared/modelPricing.ts`. Kept as a stable import surface for existing
 * call sites; new code should prefer `calculateModelCost` / `computeClaudeUsageCost`
 * so cost reflects the model that was actually used.
 */

import { TOKENS_PER_MILLION } from '../constants';
import { type ClaudeBillingMode, getPricingForModel, getDefaultModelId } from './claude-pricing';
import {
	calculateWithPricing,
	DEFAULT_MODEL_PRICING,
	type PricingConfig,
	type TokenCounts,
} from '../../shared/modelPricing';

// Re-export for convenience
export type { ClaudeBillingMode } from './claude-pricing';
export type { PricingConfig, TokenCounts } from '../../shared/modelPricing';
export {
	calculateModelCost,
	computeClaudeUsageCost,
	resolveModelPricing,
	MODEL_PRICING,
	DEFAULT_MODEL_PRICING,
	type ClaudeUsageBreakdown,
} from '../../shared/modelPricing';

/**
 * Calculate cost for an AI session based on token counts and pricing config.
 *
 * Defaults to the flat Sonnet-tier pricing. When the model is known, prefer
 * `calculateModelCost(tokens, modelId)` for per-model accuracy.
 *
 * @param tokens - Token counts from session usage
 * @param pricing - Pricing configuration (defaults to default model pricing)
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
 * const maxCost = calculateCost(tokens, pricing, 'max');
 * ```
 */
export function calculateCost(
	tokens: TokenCounts,
	pricing: PricingConfig = getPricingForModel(getDefaultModelId()) || DEFAULT_MODEL_PRICING,
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
 * @deprecated Use calculateModelCost() with a model ID, or calculateCost() with a
 * TokenCounts object.
 */
export function calculateClaudeCost(
	inputTokens: number,
	outputTokens: number,
	cacheReadTokens: number,
	cacheCreationTokens: number
): number {
	return calculateWithPricing({
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
	const pricing = getPricingForModel(modelId) || getPricingForModel(getDefaultModelId());

	// Should never be null since default model ID is always valid
	if (!pricing) {
		const fallbackPricing = getPricingForModel(getDefaultModelId()) || {
			INPUT_PER_MILLION: 5,
			OUTPUT_PER_MILLION: 25,
			CACHE_READ_PER_MILLION: 0.5,
			CACHE_CREATION_PER_MILLION: 6.25,
		};
		return calculateCost(tokens, fallbackPricing, billingMode);
	}

	return calculateCost(tokens, pricing, billingMode);
}
