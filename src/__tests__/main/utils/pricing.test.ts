/**
 * Tests for pricing utility
 */

import { describe, it, expect } from 'vitest';
import {
	calculateCost,
	calculateClaudeCost,
	calculateClaudeCostWithModel,
	PricingConfig,
} from '../../../main/utils/pricing';
import { CLAUDE_PRICING, TOKENS_PER_MILLION } from '../../../main/constants';

describe('pricing utilities', () => {
	describe('calculateCost', () => {
		it('should calculate cost correctly with default Claude pricing', () => {
			const cost = calculateCost({
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
				cacheReadTokens: 1_000_000,
				cacheCreationTokens: 1_000_000,
			});

			// Expected: 3 + 15 + 0.30 + 3.75 = 22.05
			expect(cost).toBeCloseTo(22.05, 2);
		});

		it('should handle zero tokens', () => {
			const cost = calculateCost({
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheCreationTokens: 0,
			});

			expect(cost).toBe(0);
		});

		it('should handle missing optional token counts', () => {
			const cost = calculateCost({
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
			});

			// Expected: 3 + 15 = 18
			expect(cost).toBeCloseTo(18, 2);
		});

		it('should accept custom pricing config', () => {
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

			// Expected: (2 * 1) + (1 * 2) + (0.5 * 0.5) + (0.25 * 1.5) = 2 + 2 + 0.25 + 0.375 = 4.625
			expect(cost).toBeCloseTo(4.625, 3);
		});

		it('should set cache costs to zero when billing mode is max', () => {
			const tokens = {
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
				cacheReadTokens: 1_000_000,
				cacheCreationTokens: 1_000_000,
			};

			const apiCost = calculateCost(tokens, CLAUDE_PRICING, 'api');
			const maxCost = calculateCost(tokens, CLAUDE_PRICING, 'max');

			// API: 3 + 15 + 0.30 + 3.75 = 22.05
			expect(apiCost).toBeCloseTo(22.05, 2);
			// Max: 3 + 15 + 0 + 0 = 18 (cache tokens are free)
			expect(maxCost).toBeCloseTo(18, 2);
		});

		it('should use api billing mode by default', () => {
			const tokens = {
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
				cacheReadTokens: 1_000_000,
				cacheCreationTokens: 1_000_000,
			};

			const defaultCost = calculateCost(tokens);
			const explicitApiCost = calculateCost(tokens, CLAUDE_PRICING, 'api');

			expect(defaultCost).toBe(explicitApiCost);
		});
	});

	describe('calculateClaudeCost (legacy interface)', () => {
		it('should produce same result as calculateCost', () => {
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
	});

	describe('TOKENS_PER_MILLION constant', () => {
		it('should equal one million', () => {
			expect(TOKENS_PER_MILLION).toBe(1_000_000);
		});
	});

	describe('CLAUDE_PRICING', () => {
		it('should have all required pricing fields', () => {
			expect(CLAUDE_PRICING).toHaveProperty('INPUT_PER_MILLION');
			expect(CLAUDE_PRICING).toHaveProperty('OUTPUT_PER_MILLION');
			expect(CLAUDE_PRICING).toHaveProperty('CACHE_READ_PER_MILLION');
			expect(CLAUDE_PRICING).toHaveProperty('CACHE_CREATION_PER_MILLION');
		});

		it('should have correct Sonnet 4 pricing values', () => {
			expect(CLAUDE_PRICING.INPUT_PER_MILLION).toBe(3);
			expect(CLAUDE_PRICING.OUTPUT_PER_MILLION).toBe(15);
			expect(CLAUDE_PRICING.CACHE_READ_PER_MILLION).toBe(0.3);
			expect(CLAUDE_PRICING.CACHE_CREATION_PER_MILLION).toBe(3.75);
		});
	});

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
			const defaultModelCost = calculateClaudeCostWithModel(tokens, 'claude-sonnet-4-20250514');

			// Should use Sonnet 4 (default) pricing
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
});
