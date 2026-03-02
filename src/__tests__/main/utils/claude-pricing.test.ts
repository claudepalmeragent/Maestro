/**
 * Tests for Claude Model Pricing Registry
 */

import { describe, it, expect, vi } from 'vitest';
import {
	getModelPricingRecord,
	getModelAliasesRecord,
	getDefaultModelId,
	getPricingForModel,
	resolveModelAlias,
	getModelDisplayName,
	getAllModelIds,
	getModelsByFamily,
	getAllKnownModelDisplayNames,
	isClaudeModelId,
} from '../../../main/utils/claude-pricing';
import { MODEL_REGISTRY_DEFAULTS } from '../../../main/stores/model-registry-defaults';

vi.mock('../../../main/stores/getters', () => ({
	getModelRegistryStore: () => ({
		store: MODEL_REGISTRY_DEFAULTS,
	}),
}));

describe('claude-pricing', () => {
	describe('CLAUDE_MODEL_PRICING', () => {
		it('should have all required model entries', () => {
			const expectedModels: string[] = [
				'claude-opus-4-6-20260115',
				'claude-opus-4-5-20251101',
				'claude-opus-4-1-20250319',
				'claude-opus-4-20250514',
				'claude-sonnet-4-5-20250929',
				'claude-sonnet-4-6-20260218',
				'claude-sonnet-4-20250514',
				'claude-haiku-4-5-20251001',
				'claude-haiku-3-5-20241022',
				'claude-3-haiku-20240307',
			];

			for (const modelId of expectedModels) {
				expect(getModelPricingRecord()).toHaveProperty(modelId);
			}
		});

		it('should have correct pricing structure for all models', () => {
			for (const [modelId, pricing] of Object.entries(getModelPricingRecord())) {
				expect(pricing).toHaveProperty('INPUT_PER_MILLION');
				expect(pricing).toHaveProperty('OUTPUT_PER_MILLION');
				expect(pricing).toHaveProperty('CACHE_READ_PER_MILLION');
				expect(pricing).toHaveProperty('CACHE_CREATION_PER_MILLION');
				expect(pricing).toHaveProperty('displayName');
				expect(pricing).toHaveProperty('family');

				expect(typeof pricing.INPUT_PER_MILLION).toBe('number');
				expect(typeof pricing.OUTPUT_PER_MILLION).toBe('number');
				expect(typeof pricing.CACHE_READ_PER_MILLION).toBe('number');
				expect(typeof pricing.CACHE_CREATION_PER_MILLION).toBe('number');

				expect(['opus', 'sonnet', 'haiku']).toContain(pricing.family);
			}
		});

		it('should have correct Opus 4.5 pricing', () => {
			const pricing = getModelPricingRecord()['claude-opus-4-5-20251101'];
			expect(pricing.INPUT_PER_MILLION).toBe(5);
			expect(pricing.OUTPUT_PER_MILLION).toBe(25);
			expect(pricing.CACHE_READ_PER_MILLION).toBe(0.5);
			expect(pricing.CACHE_CREATION_PER_MILLION).toBe(6.25);
		});

		it('should have correct Sonnet 4 pricing', () => {
			const pricing = getModelPricingRecord()['claude-sonnet-4-20250514'];
			expect(pricing.INPUT_PER_MILLION).toBe(3);
			expect(pricing.OUTPUT_PER_MILLION).toBe(15);
			expect(pricing.CACHE_READ_PER_MILLION).toBe(0.3);
			expect(pricing.CACHE_CREATION_PER_MILLION).toBe(3.75);
		});

		it('should have correct Sonnet 4.6 pricing', () => {
			const pricing = getModelPricingRecord()['claude-sonnet-4-6-20260218'];
			expect(pricing.INPUT_PER_MILLION).toBe(3);
			expect(pricing.OUTPUT_PER_MILLION).toBe(15);
			expect(pricing.CACHE_READ_PER_MILLION).toBe(0.3);
			expect(pricing.CACHE_CREATION_PER_MILLION).toBe(3.75);
			expect(pricing.displayName).toBe('Claude Sonnet 4.6');
			expect(pricing.family).toBe('sonnet');
		});

		it('should have correct Haiku 3 pricing', () => {
			const pricing = getModelPricingRecord()['claude-3-haiku-20240307'];
			expect(pricing.INPUT_PER_MILLION).toBe(0.25);
			expect(pricing.OUTPUT_PER_MILLION).toBe(1.25);
			expect(pricing.CACHE_READ_PER_MILLION).toBe(0.03);
			expect(pricing.CACHE_CREATION_PER_MILLION).toBe(0.3);
		});
	});

	describe('MODEL_ALIASES', () => {
		it('should have basic aliases', () => {
			expect(getModelAliasesRecord().opus).toBeDefined();
			expect(getModelAliasesRecord().sonnet).toBeDefined();
			expect(getModelAliasesRecord().haiku).toBeDefined();
		});

		it('should have versioned aliases', () => {
			expect(getModelAliasesRecord()['opus-4.5']).toBe('claude-opus-4-5-20251101');
			expect(getModelAliasesRecord()['sonnet-4.6']).toBe('claude-sonnet-4-6-20260218');
			expect(getModelAliasesRecord()['sonnet-4']).toBe('claude-sonnet-4-20250514');
			expect(getModelAliasesRecord()['haiku-3']).toBe('claude-3-haiku-20240307');
		});

		it('should have underscore variants', () => {
			expect(getModelAliasesRecord().opus_4_5).toBe('claude-opus-4-5-20251101');
			expect(getModelAliasesRecord().sonnet_4).toBe('claude-sonnet-4-20250514');
			expect(getModelAliasesRecord().haiku_3).toBe('claude-3-haiku-20240307');
		});

		it('should have short-form model ID aliases (without date suffix)', () => {
			expect(getModelAliasesRecord()['claude-opus-4-6']).toBe('claude-opus-4-6-20260115');
			expect(getModelAliasesRecord()['claude-opus-4-5']).toBe('claude-opus-4-5-20251101');
			expect(getModelAliasesRecord()['claude-opus-4-1']).toBe('claude-opus-4-1-20250319');
			expect(getModelAliasesRecord()['claude-opus-4']).toBe('claude-opus-4-20250514');
			expect(getModelAliasesRecord()['claude-sonnet-4-5']).toBe('claude-sonnet-4-5-20250929');
			expect(getModelAliasesRecord()['claude-sonnet-4-6']).toBe('claude-sonnet-4-6-20260218');
			expect(getModelAliasesRecord()['claude-sonnet-4']).toBe('claude-sonnet-4-20250514');
			expect(getModelAliasesRecord()['claude-haiku-4-5']).toBe('claude-haiku-4-5-20251001');
			expect(getModelAliasesRecord()['claude-haiku-3-5']).toBe('claude-haiku-3-5-20241022');
			expect(getModelAliasesRecord()['claude-3-haiku']).toBe('claude-3-haiku-20240307');
		});
	});

	describe('DEFAULT_MODEL_ID', () => {
		it('should be a valid model ID', () => {
			expect(isClaudeModelId(getDefaultModelId())).toBe(true);
		});

		it('should be Opus 4.6', () => {
			expect(getDefaultModelId()).toBe('claude-opus-4-6-20260115');
		});
	});

	describe('isClaudeModelId', () => {
		it('should return true for valid model IDs', () => {
			expect(isClaudeModelId('claude-opus-4-5-20251101')).toBe(true);
			expect(isClaudeModelId('claude-sonnet-4-20250514')).toBe(true);
			expect(isClaudeModelId('claude-3-haiku-20240307')).toBe(true);
		});

		it('should return false for invalid model IDs', () => {
			expect(isClaudeModelId('invalid-model')).toBe(false);
			expect(isClaudeModelId('gpt-4')).toBe(false);
			expect(isClaudeModelId('')).toBe(false);
		});
	});

	describe('getPricingForModel', () => {
		it('should return pricing for valid model ID', () => {
			const pricing = getPricingForModel('claude-opus-4-5-20251101');
			expect(pricing).not.toBeNull();
			expect(pricing?.INPUT_PER_MILLION).toBe(5);
		});

		it('should return pricing for alias', () => {
			const pricing = getPricingForModel('opus');
			expect(pricing).not.toBeNull();
			expect(pricing?.INPUT_PER_MILLION).toBe(5);
		});

		it('should return null for unknown model', () => {
			const pricing = getPricingForModel('unknown-model');
			expect(pricing).toBeNull();
		});

		it('should return pricing for short-form model ID (without date suffix)', () => {
			const pricing = getPricingForModel('claude-opus-4-6');
			expect(pricing).not.toBeNull();
			expect(pricing?.INPUT_PER_MILLION).toBe(5);
			expect(pricing?.OUTPUT_PER_MILLION).toBe(25);
		});

		it('should return pricing for short-form Sonnet 4.6 model ID', () => {
			const pricing = getPricingForModel('claude-sonnet-4-6');
			expect(pricing).not.toBeNull();
			expect(pricing?.INPUT_PER_MILLION).toBe(3);
			expect(pricing?.OUTPUT_PER_MILLION).toBe(15);
		});
	});

	describe('resolveModelAlias', () => {
		it('should resolve basic aliases', () => {
			expect(resolveModelAlias('opus')).toBe('claude-opus-4-6-20260115');
			expect(resolveModelAlias('sonnet')).toBe('claude-sonnet-4-6-20260218');
			expect(resolveModelAlias('haiku')).toBe('claude-haiku-4-5-20251001');
		});

		it('should resolve versioned aliases', () => {
			expect(resolveModelAlias('opus-4.6')).toBe('claude-opus-4-6-20260115');
			expect(resolveModelAlias('haiku-3.5')).toBe('claude-haiku-3-5-20241022');
		});

		it('should return null for unknown alias', () => {
			expect(resolveModelAlias('unknown')).toBeNull();
		});

		it('should return the model ID if already valid', () => {
			expect(resolveModelAlias('claude-opus-4-6-20260115')).toBe('claude-opus-4-6-20260115');
		});

		it('should handle case insensitivity', () => {
			expect(resolveModelAlias('OPUS')).toBe('claude-opus-4-6-20260115');
			expect(resolveModelAlias('Sonnet')).toBe('claude-sonnet-4-6-20260218');
		});

		it('should resolve short-form model IDs (without date suffix)', () => {
			expect(resolveModelAlias('claude-opus-4-6')).toBe('claude-opus-4-6-20260115');
			expect(resolveModelAlias('claude-opus-4-5')).toBe('claude-opus-4-5-20251101');
			expect(resolveModelAlias('claude-sonnet-4-5')).toBe('claude-sonnet-4-5-20250929');
			expect(resolveModelAlias('claude-sonnet-4-6')).toBe('claude-sonnet-4-6-20260218');
			expect(resolveModelAlias('claude-haiku-4-5')).toBe('claude-haiku-4-5-20251001');
			expect(resolveModelAlias('claude-3-haiku')).toBe('claude-3-haiku-20240307');
		});
	});

	describe('getModelDisplayName', () => {
		it('should return display name for valid model ID', () => {
			expect(getModelDisplayName('claude-opus-4-5-20251101')).toBe('Claude Opus 4.5');
			expect(getModelDisplayName('claude-sonnet-4-20250514')).toBe('Claude Sonnet 4');
		});

		it('should return display name for alias', () => {
			expect(getModelDisplayName('opus')).toBe('Claude Opus 4.6');
		});

		it('should return original ID for unknown model', () => {
			expect(getModelDisplayName('unknown-model')).toBe('unknown-model');
		});
	});

	describe('getAllModelIds', () => {
		it('should return all model IDs', () => {
			const modelIds = getAllModelIds();
			expect(modelIds.length).toBeGreaterThanOrEqual(10);
			expect(modelIds).toContain('claude-opus-4-5-20251101');
			expect(modelIds).toContain('claude-sonnet-4-20250514');
			expect(modelIds).toContain('claude-3-haiku-20240307');
		});
	});

	describe('getModelsByFamily', () => {
		it('should return Opus models', () => {
			const opusModels = getModelsByFamily('opus');
			expect(opusModels.length).toBeGreaterThanOrEqual(4);
			expect(opusModels).toContain('claude-opus-4-5-20251101');
			expect(opusModels).toContain('claude-opus-4-6-20260115');
		});

		it('should return Sonnet models', () => {
			const sonnetModels = getModelsByFamily('sonnet');
			expect(sonnetModels.length).toBeGreaterThanOrEqual(3);
			expect(sonnetModels).toContain('claude-sonnet-4-20250514');
			expect(sonnetModels).toContain('claude-sonnet-4-5-20250929');
			expect(sonnetModels).toContain('claude-sonnet-4-6-20260218');
		});

		it('should return Haiku models', () => {
			const haikuModels = getModelsByFamily('haiku');
			expect(haikuModels.length).toBeGreaterThanOrEqual(3);
			expect(haikuModels).toContain('claude-haiku-4-5-20251001');
			expect(haikuModels).toContain('claude-3-haiku-20240307');
		});
	});

	describe('getAllKnownModelDisplayNames', () => {
		it('should return all display names from the pricing registry', () => {
			const names = getAllKnownModelDisplayNames();
			expect(names.size).toBe(Object.keys(getModelPricingRecord()).length);
			expect(names.has('Claude Opus 4.6')).toBe(true);
			expect(names.has('Claude Sonnet 4.6')).toBe(true);
			expect(names.has('Claude Sonnet 4.5')).toBe(true);
			expect(names.has('Claude Haiku 4.5')).toBe(true);
			expect(names.has('Claude Haiku 3')).toBe(true);
		});

		it('should return a Set (not an array)', () => {
			const names = getAllKnownModelDisplayNames();
			expect(names).toBeInstanceOf(Set);
		});

		it('should NOT contain model IDs, only display names', () => {
			const names = getAllKnownModelDisplayNames();
			expect(names.has('claude-opus-4-6-20260115')).toBe(false);
			expect(names.has('claude-sonnet-4-6-20260218')).toBe(false);
		});
	});
});
