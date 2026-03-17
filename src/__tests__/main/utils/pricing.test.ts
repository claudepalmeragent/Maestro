/**
 * Comprehensive tests for pricing utility functions
 *
 * Covers: calculateCost, calculateClaudeCost, default pricing, custom pricing,
 * edge cases (zero/large tokens), optional cache token defaults, delegation,
 * manual calculation verification, and floating point precision.
 */

import { describe, it, expect, vi } from 'vitest';
import { MODEL_REGISTRY_DEFAULTS } from '../../../main/stores/model-registry-defaults';

vi.mock('../../../main/stores/getters', () => ({
	getModelRegistryStore: () => ({ store: MODEL_REGISTRY_DEFAULTS }),
}));

import {
	calculateCost,
	calculateClaudeCost,
	calculateClaudeCostWithModel,
	PricingConfig,
} from '../../../main/utils/pricing';
import { TOKENS_PER_MILLION } from '../../../main/constants';
import { getPricingForModel, getDefaultModelId } from '../../../main/utils/claude-pricing';

// Default model pricing (equivalent to removed DEFAULT_PRICING constant)
const DEFAULT_PRICING = getPricingForModel(getDefaultModelId())!;

describe('pricing utilities', () => {
	// -----------------------------------------------------------------------
	// 1. calculateCost with all token types
	// -----------------------------------------------------------------------
	describe('calculateCost with all token types', () => {
		it('should calculate cost correctly when all four token types are provided', () => {
			const cost = calculateCost({
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
				cacheReadTokens: 1_000_000,
				cacheCreationTokens: 1_000_000,
			});

			// Expected: 5 + 25 + 0.50 + 6.25 = 36.75
			expect(cost).toBeCloseTo(36.75, 2);
		});

		it('should scale linearly with token counts', () => {
			const costOneMillion = calculateCost({
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
				cacheReadTokens: 1_000_000,
				cacheCreationTokens: 1_000_000,
			});

			const costTwoMillion = calculateCost({
				inputTokens: 2_000_000,
				outputTokens: 2_000_000,
				cacheReadTokens: 2_000_000,
				cacheCreationTokens: 2_000_000,
			});

			expect(costTwoMillion).toBeCloseTo(costOneMillion * 2, 10);
		});

		it('should correctly break down each cost component', () => {
			const tokens = {
				inputTokens: 500_000,
				outputTokens: 200_000,
				cacheReadTokens: 300_000,
				cacheCreationTokens: 100_000,
			};

			const cost = calculateCost(tokens);

			const expectedInput = (500_000 / TOKENS_PER_MILLION) * DEFAULT_PRICING.INPUT_PER_MILLION;
			const expectedOutput = (200_000 / TOKENS_PER_MILLION) * DEFAULT_PRICING.OUTPUT_PER_MILLION;
			const expectedCacheRead =
				(300_000 / TOKENS_PER_MILLION) * DEFAULT_PRICING.CACHE_READ_PER_MILLION;
			const expectedCacheCreation =
				(100_000 / TOKENS_PER_MILLION) * DEFAULT_PRICING.CACHE_CREATION_PER_MILLION;

			const expectedTotal =
				expectedInput + expectedOutput + expectedCacheRead + expectedCacheCreation;
			expect(cost).toBeCloseTo(expectedTotal, 10);
		});
	});

	// -----------------------------------------------------------------------
	// 2. calculateCost with only input/output (no cache tokens)
	// -----------------------------------------------------------------------
	describe('calculateCost with only input/output (no cache tokens)', () => {
		it('should calculate cost with only input and output tokens (cache explicitly zero)', () => {
			const cost = calculateCost({
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
				cacheReadTokens: 0,
				cacheCreationTokens: 0,
			});

			// 5 + 25 = 30
			expect(cost).toBeCloseTo(30, 2);
		});

		it('should calculate cost when cache tokens are omitted entirely', () => {
			const cost = calculateCost({
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
			});

			// 5 + 25 = 30 (cache tokens default to 0)
			expect(cost).toBeCloseTo(30, 2);
		});

		it('should produce same result whether cache tokens are omitted or set to 0', () => {
			const costOmitted = calculateCost({
				inputTokens: 750_000,
				outputTokens: 250_000,
			});

			const costExplicitZero = calculateCost({
				inputTokens: 750_000,
				outputTokens: 250_000,
				cacheReadTokens: 0,
				cacheCreationTokens: 0,
			});

			expect(costOmitted).toBe(costExplicitZero);
		});
	});

	// -----------------------------------------------------------------------
	// 3. calculateCost with zero tokens
	// -----------------------------------------------------------------------
	describe('calculateCost with zero tokens', () => {
		it('should return 0 when all tokens are zero', () => {
			const cost = calculateCost({
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheCreationTokens: 0,
			});

			expect(cost).toBe(0);
		});

		it('should return 0 when input/output are zero and cache tokens are omitted', () => {
			const cost = calculateCost({
				inputTokens: 0,
				outputTokens: 0,
			});

			expect(cost).toBe(0);
		});

		it('should calculate correctly with only input tokens (others zero)', () => {
			const cost = calculateCost({
				inputTokens: 1_000_000,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheCreationTokens: 0,
			});

			expect(cost).toBeCloseTo(DEFAULT_PRICING.INPUT_PER_MILLION, 10);
		});

		it('should calculate correctly with only output tokens (others zero)', () => {
			const cost = calculateCost({
				inputTokens: 0,
				outputTokens: 1_000_000,
				cacheReadTokens: 0,
				cacheCreationTokens: 0,
			});

			expect(cost).toBeCloseTo(DEFAULT_PRICING.OUTPUT_PER_MILLION, 10);
		});

		it('should calculate correctly with only cache read tokens (others zero)', () => {
			const cost = calculateCost({
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 1_000_000,
				cacheCreationTokens: 0,
			});

			expect(cost).toBeCloseTo(DEFAULT_PRICING.CACHE_READ_PER_MILLION, 10);
		});

		it('should calculate correctly with only cache creation tokens (others zero)', () => {
			const cost = calculateCost({
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheCreationTokens: 1_000_000,
			});

			expect(cost).toBeCloseTo(DEFAULT_PRICING.CACHE_CREATION_PER_MILLION, 10);
		});
	});

	// -----------------------------------------------------------------------
	// 4. calculateCost with large token counts
	// -----------------------------------------------------------------------
	describe('calculateCost with large token counts', () => {
		it('should handle very large token counts (1 billion tokens each)', () => {
			const cost = calculateCost({
				inputTokens: 1_000_000_000,
				outputTokens: 1_000_000_000,
				cacheReadTokens: 1_000_000_000,
				cacheCreationTokens: 1_000_000_000,
			});

			// 1000 * (5 + 25 + 0.5 + 6.25) = 1000 * 36.75 = 36750
			expect(cost).toBeCloseTo(36750, 2);
		});

		it('should handle 100 million input tokens', () => {
			const cost = calculateCost({
				inputTokens: 100_000_000,
				outputTokens: 0,
			});

			// 100 * 5 = 500
			expect(cost).toBeCloseTo(500, 10);
		});

		it('should maintain precision with large asymmetric token counts', () => {
			const cost = calculateCost({
				inputTokens: 500_000_000,
				outputTokens: 10_000,
				cacheReadTokens: 999_999_999,
				cacheCreationTokens: 1,
			});

			const expected =
				(500_000_000 / TOKENS_PER_MILLION) * DEFAULT_PRICING.INPUT_PER_MILLION +
				(10_000 / TOKENS_PER_MILLION) * DEFAULT_PRICING.OUTPUT_PER_MILLION +
				(999_999_999 / TOKENS_PER_MILLION) * DEFAULT_PRICING.CACHE_READ_PER_MILLION +
				(1 / TOKENS_PER_MILLION) * DEFAULT_PRICING.CACHE_CREATION_PER_MILLION;

			expect(cost).toBeCloseTo(expected, 6);
		});
	});

	// -----------------------------------------------------------------------
	// 5. calculateCost with custom pricing config
	// -----------------------------------------------------------------------
	describe('calculateCost with custom pricing config', () => {
		it('should use custom pricing instead of defaults', () => {
			const customPricing: PricingConfig = {
				INPUT_PER_MILLION: 1,
				OUTPUT_PER_MILLION: 2,
				CACHE_READ_PER_MILLION: 0.5,
				CACHE_CREATION_PER_MILLION: 1.5,
			};

			const cost = calculateCost(
				{
					inputTokens: 2_000_000,
					outputTokens: 1_000_000,
					cacheReadTokens: 500_000,
					cacheCreationTokens: 250_000,
				},
				customPricing
			);

			// (2 * 1) + (1 * 2) + (0.5 * 0.5) + (0.25 * 1.5) = 2 + 2 + 0.25 + 0.375 = 4.625
			expect(cost).toBeCloseTo(4.625, 3);
		});

		it('should set cache costs to zero when billing mode is max', () => {
			const tokens = {
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
				cacheReadTokens: 1_000_000,
				cacheCreationTokens: 1_000_000,
			};

			const apiCost = calculateCost(tokens, DEFAULT_PRICING, 'api');
			const maxCost = calculateCost(tokens, DEFAULT_PRICING, 'max');

			// API: 5 + 25 + 0.50 + 6.25 = 36.75
			expect(apiCost).toBeCloseTo(36.75, 2);
			// Max: 5 + 25 + 0 + 0 = 30 (cache tokens are free)
			expect(maxCost).toBeCloseTo(30, 2);
		});

		it('should use api billing mode by default', () => {
			const tokens = {
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
				cacheReadTokens: 1_000_000,
				cacheCreationTokens: 1_000_000,
			};

			const defaultCost = calculateCost(tokens);
			const explicitApiCost = calculateCost(tokens, DEFAULT_PRICING, 'api');

			expect(defaultCost).toBe(explicitApiCost);
		});

		it('should handle custom pricing with zero rates', () => {
			const freePricing: PricingConfig = {
				INPUT_PER_MILLION: 0,
				OUTPUT_PER_MILLION: 0,
				CACHE_READ_PER_MILLION: 0,
				CACHE_CREATION_PER_MILLION: 0,
			};

			const cost = calculateCost(
				{
					inputTokens: 10_000_000,
					outputTokens: 5_000_000,
					cacheReadTokens: 2_000_000,
					cacheCreationTokens: 1_000_000,
				},
				freePricing
			);

			expect(cost).toBe(0);
		});

		it('should handle custom pricing with very high rates', () => {
			const expensivePricing: PricingConfig = {
				INPUT_PER_MILLION: 100,
				OUTPUT_PER_MILLION: 200,
				CACHE_READ_PER_MILLION: 50,
				CACHE_CREATION_PER_MILLION: 75,
			};

			const cost = calculateCost(
				{
					inputTokens: 1_000_000,
					outputTokens: 1_000_000,
					cacheReadTokens: 1_000_000,
					cacheCreationTokens: 1_000_000,
				},
				expensivePricing
			);

			// 100 + 200 + 50 + 75 = 425
			expect(cost).toBeCloseTo(425, 2);
		});

		it('should not affect other calls when custom pricing is passed', () => {
			const customPricing: PricingConfig = {
				INPUT_PER_MILLION: 10,
				OUTPUT_PER_MILLION: 20,
				CACHE_READ_PER_MILLION: 5,
				CACHE_CREATION_PER_MILLION: 7.5,
			};

			// Call with custom pricing
			calculateCost({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, customPricing);

			// Call without custom pricing should still use defaults
			const defaultCost = calculateCost({
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
			});

			// 5 + 25 = 30 (default Opus 4.5 pricing)
			expect(defaultCost).toBeCloseTo(30, 2);
		});
	});

	// -----------------------------------------------------------------------
	// 6. calculateCost defaults cache tokens to 0 when undefined
	// -----------------------------------------------------------------------
	describe('calculateCost defaults cache tokens to 0 when undefined', () => {
		it('should default cacheReadTokens to 0 when not provided', () => {
			const costWithoutCacheRead = calculateCost({
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
				cacheCreationTokens: 1_000_000,
			});

			const costWithExplicitZero = calculateCost({
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
				cacheReadTokens: 0,
				cacheCreationTokens: 1_000_000,
			});

			expect(costWithoutCacheRead).toBe(costWithExplicitZero);
		});

		it('should default cacheCreationTokens to 0 when not provided', () => {
			const costWithoutCacheCreation = calculateCost({
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
				cacheReadTokens: 1_000_000,
			});

			const costWithExplicitZero = calculateCost({
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
				cacheReadTokens: 1_000_000,
				cacheCreationTokens: 0,
			});

			expect(costWithoutCacheCreation).toBe(costWithExplicitZero);
		});

		it('should default both cache tokens to 0 when not provided', () => {
			const costMinimal = calculateCost({
				inputTokens: 500_000,
				outputTokens: 250_000,
			});

			const costExplicit = calculateCost({
				inputTokens: 500_000,
				outputTokens: 250_000,
				cacheReadTokens: 0,
				cacheCreationTokens: 0,
			});

			expect(costMinimal).toBe(costExplicit);
		});

		it('should only include non-cache cost when cache tokens are omitted', () => {
			const cost = calculateCost({
				inputTokens: 2_000_000,
				outputTokens: 500_000,
			});

			const expectedInputCost =
				(2_000_000 / TOKENS_PER_MILLION) * DEFAULT_PRICING.INPUT_PER_MILLION;
			const expectedOutputCost =
				(500_000 / TOKENS_PER_MILLION) * DEFAULT_PRICING.OUTPUT_PER_MILLION;
			const expected = expectedInputCost + expectedOutputCost;

			expect(cost).toBeCloseTo(expected, 10);
		});
	});

	// -----------------------------------------------------------------------
	// 7. calculateClaudeCost delegates to calculateCost correctly
	// -----------------------------------------------------------------------
	describe('calculateClaudeCost delegates to calculateCost correctly', () => {
		it('should produce identical results to calculateCost for same inputs', () => {
			const inputTokens = 500_000;
			const outputTokens = 250_000;
			const cacheReadTokens = 100_000;
			const cacheCreationTokens = 50_000;

			const legacyCost = calculateClaudeCost(
				inputTokens,
				outputTokens,
				cacheReadTokens,
				cacheCreationTokens
			);

			const modernCost = calculateCost({
				inputTokens,
				outputTokens,
				cacheReadTokens,
				cacheCreationTokens,
			});

			expect(legacyCost).toBe(modernCost);
		});

		it('should pass all four parameters through correctly', () => {
			// Test with distinctive values so each parameter matters
			const cost = calculateClaudeCost(1_000_000, 0, 0, 0);
			expect(cost).toBeCloseTo(DEFAULT_PRICING.INPUT_PER_MILLION, 10); // Only input cost

			const cost2 = calculateClaudeCost(0, 1_000_000, 0, 0);
			expect(cost2).toBeCloseTo(DEFAULT_PRICING.OUTPUT_PER_MILLION, 10); // Only output cost

			const cost3 = calculateClaudeCost(0, 0, 1_000_000, 0);
			expect(cost3).toBeCloseTo(DEFAULT_PRICING.CACHE_READ_PER_MILLION, 10); // Only cache read cost

			const cost4 = calculateClaudeCost(0, 0, 0, 1_000_000);
			expect(cost4).toBeCloseTo(DEFAULT_PRICING.CACHE_CREATION_PER_MILLION, 10); // Only cache creation cost
		});

		it('should handle zero values for all parameters', () => {
			const cost = calculateClaudeCost(0, 0, 0, 0);
			expect(cost).toBe(0);
		});

		it('should produce same result for various token combinations', () => {
			const testCases = [
				{ input: 100_000, output: 200_000, cacheRead: 300_000, cacheCreate: 400_000 },
				{ input: 1, output: 1, cacheRead: 1, cacheCreate: 1 },
				{ input: 999_999, output: 500_001, cacheRead: 123_456, cacheCreate: 789_012 },
			];

			for (const tc of testCases) {
				const legacy = calculateClaudeCost(tc.input, tc.output, tc.cacheRead, tc.cacheCreate);
				const modern = calculateCost({
					inputTokens: tc.input,
					outputTokens: tc.output,
					cacheReadTokens: tc.cacheRead,
					cacheCreationTokens: tc.cacheCreate,
				});
				expect(legacy).toBe(modern);
			}
		});
	});

	// -----------------------------------------------------------------------
	// 8. calculateClaudeCost matches manual calculation
	// -----------------------------------------------------------------------
	describe('calculateClaudeCost matches manual calculation', () => {
		it('should match hand-computed cost for a realistic session', () => {
			// Simulate a session: 50K input, 10K output, 200K cache read, 5K cache creation
			const inputTokens = 50_000;
			const outputTokens = 10_000;
			const cacheReadTokens = 200_000;
			const cacheCreationTokens = 5_000;

			const cost = calculateClaudeCost(
				inputTokens,
				outputTokens,
				cacheReadTokens,
				cacheCreationTokens
			);

			// Manual calculation using default (Opus 4.5) pricing:
			// Input:          50,000 / 1,000,000 * 5     = 0.25
			// Output:         10,000 / 1,000,000 * 25    = 0.25
			// Cache read:    200,000 / 1,000,000 * 0.5   = 0.10
			// Cache creation:  5,000 / 1,000,000 * 6.25  = 0.03125
			// Total: 0.25 + 0.25 + 0.10 + 0.03125 = 0.63125
			const expected =
				(inputTokens / TOKENS_PER_MILLION) * DEFAULT_PRICING.INPUT_PER_MILLION +
				(outputTokens / TOKENS_PER_MILLION) * DEFAULT_PRICING.OUTPUT_PER_MILLION +
				(cacheReadTokens / TOKENS_PER_MILLION) * DEFAULT_PRICING.CACHE_READ_PER_MILLION +
				(cacheCreationTokens / TOKENS_PER_MILLION) * DEFAULT_PRICING.CACHE_CREATION_PER_MILLION;
			expect(cost).toBeCloseTo(expected, 5);
		});

		it('should match manual calculation for exactly 1 million of each token type', () => {
			const cost = calculateClaudeCost(1_000_000, 1_000_000, 1_000_000, 1_000_000);

			// 5 + 25 + 0.5 + 6.25 = 36.75
			expect(cost).toBeCloseTo(36.75, 10);
		});

		it('should match manual calculation for fractional token-to-million ratios', () => {
			const cost = calculateClaudeCost(333_333, 666_667, 111_111, 222_222);

			const expected =
				(333_333 / 1_000_000) * DEFAULT_PRICING.INPUT_PER_MILLION +
				(666_667 / 1_000_000) * DEFAULT_PRICING.OUTPUT_PER_MILLION +
				(111_111 / 1_000_000) * DEFAULT_PRICING.CACHE_READ_PER_MILLION +
				(222_222 / 1_000_000) * DEFAULT_PRICING.CACHE_CREATION_PER_MILLION;

			expect(cost).toBeCloseTo(expected, 10);
		});
	});

	// -----------------------------------------------------------------------
	// 9. Verify default model pricing values are used
	// -----------------------------------------------------------------------
	describe('Default model pricing', () => {
		it('should have TOKENS_PER_MILLION equal to 1,000,000', () => {
			expect(TOKENS_PER_MILLION).toBe(1_000_000);
		});

		it('should have all required pricing fields', () => {
			expect(DEFAULT_PRICING).toHaveProperty('INPUT_PER_MILLION');
			expect(DEFAULT_PRICING).toHaveProperty('OUTPUT_PER_MILLION');
			expect(DEFAULT_PRICING).toHaveProperty('CACHE_READ_PER_MILLION');
			expect(DEFAULT_PRICING).toHaveProperty('CACHE_CREATION_PER_MILLION');
		});

		it('should have correct Opus 4.5 pricing values', () => {
			expect(DEFAULT_PRICING.INPUT_PER_MILLION).toBe(5);
			expect(DEFAULT_PRICING.OUTPUT_PER_MILLION).toBe(25);
			expect(DEFAULT_PRICING.CACHE_READ_PER_MILLION).toBe(0.5);
			expect(DEFAULT_PRICING.CACHE_CREATION_PER_MILLION).toBe(6.25);
		});

		it('should use default pricing when no pricing config is provided', () => {
			// Calculate with default pricing
			const defaultCost = calculateCost({
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
			});

			// Calculate with explicit DEFAULT_PRICING
			const explicitCost = calculateCost(
				{
					inputTokens: 1_000_000,
					outputTokens: 1_000_000,
				},
				DEFAULT_PRICING
			);

			expect(defaultCost).toBe(explicitCost);
		});

		it('should produce different results with different pricing than defaults', () => {
			const differentPricing: PricingConfig = {
				INPUT_PER_MILLION: 10,
				OUTPUT_PER_MILLION: 30,
				CACHE_READ_PER_MILLION: 1,
				CACHE_CREATION_PER_MILLION: 5,
			};

			const defaultCost = calculateCost({
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
			});

			const customCost = calculateCost(
				{
					inputTokens: 1_000_000,
					outputTokens: 1_000_000,
				},
				differentPricing
			);

			expect(customCost).not.toBe(defaultCost);
			expect(customCost).toBeCloseTo(40, 2); // 10 + 30
			expect(defaultCost).toBeCloseTo(30, 2); // 5 + 25
		});
	});

	// -----------------------------------------------------------------------
	// 10. calculateClaudeCostWithModel
	// -----------------------------------------------------------------------
	describe('calculateClaudeCostWithModel', () => {
		it('should use model-specific pricing for known models', () => {
			const tokens = {
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
			};

			// Opus 4.5 has different pricing than Sonnet 4
			const opusCost = calculateClaudeCostWithModel(tokens, 'claude-opus-4-5-20251101');
			const sonnetCost = calculateClaudeCostWithModel(tokens, 'claude-sonnet-4-20250514');

			// Opus: 5 + 25 = 30
			expect(opusCost).toBeCloseTo(30, 2);
			// Sonnet: 3 + 15 = 18
			expect(sonnetCost).toBeCloseTo(18, 2);
		});

		it('should fall back to default pricing for unknown models', () => {
			const tokens = {
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
			};

			const unknownModelCost = calculateClaudeCostWithModel(tokens, 'unknown-model');
			const defaultModelCost = calculateClaudeCostWithModel(tokens, 'claude-opus-4-5-20251101');

			// Should use default model (Opus 4.5) pricing
			expect(unknownModelCost).toBeCloseTo(defaultModelCost, 2);
		});

		it('should respect billing mode with model-specific pricing', () => {
			const tokens = {
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
				cacheReadTokens: 1_000_000,
				cacheCreationTokens: 1_000_000,
			};

			const apiCost = calculateClaudeCostWithModel(tokens, 'claude-opus-4-5-20251101', 'api');
			const maxCost = calculateClaudeCostWithModel(tokens, 'claude-opus-4-5-20251101', 'max');

			// Opus API: 5 + 25 + 0.5 + 6.25 = 36.75
			expect(apiCost).toBeCloseTo(36.75, 2);
			// Opus Max: 5 + 25 + 0 + 0 = 30 (cache free)
			expect(maxCost).toBeCloseTo(30, 2);
		});

		it('should handle Haiku pricing correctly', () => {
			const tokens = {
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
			};

			const haiku45Cost = calculateClaudeCostWithModel(tokens, 'claude-haiku-4-5-20251001');
			const haiku3Cost = calculateClaudeCostWithModel(tokens, 'claude-3-haiku-20240307');

			// Haiku 4.5: 1 + 5 = 6
			expect(haiku45Cost).toBeCloseTo(6, 2);
			// Haiku 3: 0.25 + 1.25 = 1.50
			expect(haiku3Cost).toBeCloseTo(1.5, 2);
		});
	});

	// -----------------------------------------------------------------------
	// 11. Cost precision (floating point math checks)
	// -----------------------------------------------------------------------
	describe('cost precision (floating point math)', () => {
		it('should handle small token counts without floating point drift', () => {
			const cost = calculateCost({
				inputTokens: 1,
				outputTokens: 1,
				cacheReadTokens: 1,
				cacheCreationTokens: 1,
			});

			// Each token cost is price / 1_000_000
			const expected =
				(DEFAULT_PRICING.INPUT_PER_MILLION +
					DEFAULT_PRICING.OUTPUT_PER_MILLION +
					DEFAULT_PRICING.CACHE_READ_PER_MILLION +
					DEFAULT_PRICING.CACHE_CREATION_PER_MILLION) /
				1_000_000;
			expect(cost).toBeCloseTo(expected, 15);
		});

		it('should produce finite numbers for all reasonable inputs', () => {
			const cost = calculateCost({
				inputTokens: 999_999_999,
				outputTokens: 999_999_999,
				cacheReadTokens: 999_999_999,
				cacheCreationTokens: 999_999_999,
			});

			expect(Number.isFinite(cost)).toBe(true);
			expect(cost).toBeGreaterThan(0);
		});

		it('should not lose significance with mixed large and small values', () => {
			const cost = calculateCost({
				inputTokens: 100_000_000,
				outputTokens: 1,
				cacheReadTokens: 0,
				cacheCreationTokens: 0,
			});

			// Large: 100 * 5 = 500
			// Small: 1 / 1_000_000 * 25 = 0.000025
			// Total should be 500.000025
			const expected =
				100 * DEFAULT_PRICING.INPUT_PER_MILLION + DEFAULT_PRICING.OUTPUT_PER_MILLION / 1_000_000;
			expect(cost).toBeCloseTo(expected, 10);
		});

		it('should handle decimal pricing rates without accumulating error', () => {
			// Cache read rate (0.5) — test with custom pricing to use a repeating binary fraction
			const customPricing: PricingConfig = {
				INPUT_PER_MILLION: 0,
				OUTPUT_PER_MILLION: 0,
				CACHE_READ_PER_MILLION: 0.3, // repeating binary fraction
				CACHE_CREATION_PER_MILLION: 0,
			};
			const cost = calculateCost(
				{
					inputTokens: 0,
					outputTokens: 0,
					cacheReadTokens: 3_000_000,
					cacheCreationTokens: 0,
				},
				customPricing
			);

			// 3 * 0.3 = 0.9
			expect(cost).toBeCloseTo(0.9, 10);
		});

		it('should return exactly 0 for zero tokens regardless of pricing', () => {
			const weirdPricing: PricingConfig = {
				INPUT_PER_MILLION: 0.1 + 0.2, // floating point imprecision intentional
				OUTPUT_PER_MILLION: Math.PI,
				CACHE_READ_PER_MILLION: Math.E,
				CACHE_CREATION_PER_MILLION: Math.SQRT2,
			};

			const cost = calculateCost(
				{
					inputTokens: 0,
					outputTokens: 0,
					cacheReadTokens: 0,
					cacheCreationTokens: 0,
				},
				weirdPricing
			);

			expect(cost).toBe(0);
		});

		it('should compute costs that can be meaningfully compared', () => {
			// More output tokens should cost more than more input tokens (at default rates)
			const inputHeavy = calculateCost({
				inputTokens: 1_000_000,
				outputTokens: 0,
			});

			const outputHeavy = calculateCost({
				inputTokens: 0,
				outputTokens: 1_000_000,
			});

			expect(outputHeavy).toBeGreaterThan(inputHeavy);
			expect(outputHeavy / inputHeavy).toBeCloseTo(5, 10); // 25/5 = 5x
		});
	});
});
