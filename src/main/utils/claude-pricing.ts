/**
 * Claude Model Pricing Registry
 *
 * Centralized pricing configuration for all Claude models.
 * Supports model-specific pricing and billing mode adjustments.
 *
 * @module claude-pricing
 */

import type { PricingConfig } from './pricing';

/**
 * All supported Claude model identifiers
 */
export type ClaudeModelId =
	| 'claude-opus-4-6-20260115'
	| 'claude-opus-4-5-20251101'
	| 'claude-opus-4-1-20250319'
	| 'claude-opus-4-20250514'
	| 'claude-sonnet-4-5-20250929'
	| 'claude-sonnet-4-20250514'
	| 'claude-haiku-4-5-20251001'
	| 'claude-haiku-3-5-20241022'
	| 'claude-3-haiku-20240307';

/**
 * Billing mode for Claude API usage
 * - 'api': Standard API billing (pay per token)
 * - 'max': Claude Max subscription (cache tokens are free)
 */
export type ClaudeBillingMode = 'api' | 'max';

/**
 * Extended pricing configuration with model metadata
 */
export interface ClaudeModelPricing extends PricingConfig {
	/** Human-readable model name */
	displayName: string;
	/** Model family (opus, sonnet, haiku) */
	family: 'opus' | 'sonnet' | 'haiku';
}

/**
 * Claude model pricing registry
 * Prices are per million tokens in USD
 *
 * | Model | Input | Output | Cache Read | Cache Write |
 * |-------|-------|--------|------------|-------------|
 * | Opus 4.6 | $5 | $25 | $0.50 | $6.25 |
 * | Opus 4.5 | $5 | $25 | $0.50 | $6.25 |
 * | Opus 4.1 | $15 | $75 | $1.50 | $18.75 |
 * | Opus 4 | $15 | $75 | $1.50 | $18.75 |
 * | Sonnet 4.5 | $3 | $15 | $0.30 | $3.75 |
 * | Sonnet 4 | $3 | $15 | $0.30 | $3.75 |
 * | Haiku 4.5 | $1 | $5 | $0.10 | $1.25 |
 * | Haiku 3.5 | $0.80 | $4 | $0.08 | $1 |
 * | Haiku 3 | $0.25 | $1.25 | $0.03 | $0.30 |
 */
export const CLAUDE_MODEL_PRICING: Record<ClaudeModelId, ClaudeModelPricing> = {
	// Opus 4.6 (latest)
	'claude-opus-4-6-20260115': {
		displayName: 'Claude Opus 4.6',
		family: 'opus',
		INPUT_PER_MILLION: 5,
		OUTPUT_PER_MILLION: 25,
		CACHE_READ_PER_MILLION: 0.5,
		CACHE_CREATION_PER_MILLION: 6.25,
	},
	// Opus 4.5
	'claude-opus-4-5-20251101': {
		displayName: 'Claude Opus 4.5',
		family: 'opus',
		INPUT_PER_MILLION: 5,
		OUTPUT_PER_MILLION: 25,
		CACHE_READ_PER_MILLION: 0.5,
		CACHE_CREATION_PER_MILLION: 6.25,
	},
	// Opus 4.1
	'claude-opus-4-1-20250319': {
		displayName: 'Claude Opus 4.1',
		family: 'opus',
		INPUT_PER_MILLION: 15,
		OUTPUT_PER_MILLION: 75,
		CACHE_READ_PER_MILLION: 1.5,
		CACHE_CREATION_PER_MILLION: 18.75,
	},
	// Opus 4
	'claude-opus-4-20250514': {
		displayName: 'Claude Opus 4',
		family: 'opus',
		INPUT_PER_MILLION: 15,
		OUTPUT_PER_MILLION: 75,
		CACHE_READ_PER_MILLION: 1.5,
		CACHE_CREATION_PER_MILLION: 18.75,
	},
	// Sonnet 4.5
	'claude-sonnet-4-5-20250929': {
		displayName: 'Claude Sonnet 4.5',
		family: 'sonnet',
		INPUT_PER_MILLION: 3,
		OUTPUT_PER_MILLION: 15,
		CACHE_READ_PER_MILLION: 0.3,
		CACHE_CREATION_PER_MILLION: 3.75,
	},
	// Sonnet 4
	'claude-sonnet-4-20250514': {
		displayName: 'Claude Sonnet 4',
		family: 'sonnet',
		INPUT_PER_MILLION: 3,
		OUTPUT_PER_MILLION: 15,
		CACHE_READ_PER_MILLION: 0.3,
		CACHE_CREATION_PER_MILLION: 3.75,
	},
	// Haiku 4.5
	'claude-haiku-4-5-20251001': {
		displayName: 'Claude Haiku 4.5',
		family: 'haiku',
		INPUT_PER_MILLION: 1,
		OUTPUT_PER_MILLION: 5,
		CACHE_READ_PER_MILLION: 0.1,
		CACHE_CREATION_PER_MILLION: 1.25,
	},
	// Haiku 3.5
	'claude-haiku-3-5-20241022': {
		displayName: 'Claude Haiku 3.5',
		family: 'haiku',
		INPUT_PER_MILLION: 0.8,
		OUTPUT_PER_MILLION: 4,
		CACHE_READ_PER_MILLION: 0.08,
		CACHE_CREATION_PER_MILLION: 1,
	},
	// Haiku 3
	'claude-3-haiku-20240307': {
		displayName: 'Claude Haiku 3',
		family: 'haiku',
		INPUT_PER_MILLION: 0.25,
		OUTPUT_PER_MILLION: 1.25,
		CACHE_READ_PER_MILLION: 0.03,
		CACHE_CREATION_PER_MILLION: 0.3,
	},
};

/**
 * Model alias map for short names
 * Maps common aliases to their full model IDs
 */
export const MODEL_ALIASES: Record<string, ClaudeModelId> = {
	// Latest aliases
	opus: 'claude-opus-4-5-20251101',
	sonnet: 'claude-sonnet-4-20250514',
	haiku: 'claude-haiku-4-5-20251001',

	// Versioned aliases
	'opus-4.6': 'claude-opus-4-6-20260115',
	'opus-4.5': 'claude-opus-4-5-20251101',
	'opus-4.1': 'claude-opus-4-1-20250319',
	'opus-4': 'claude-opus-4-20250514',
	'sonnet-4.5': 'claude-sonnet-4-5-20250929',
	'sonnet-4': 'claude-sonnet-4-20250514',
	'haiku-4.5': 'claude-haiku-4-5-20251001',
	'haiku-3.5': 'claude-haiku-3-5-20241022',
	'haiku-3': 'claude-3-haiku-20240307',

	// Underscore variants
	opus_4_6: 'claude-opus-4-6-20260115',
	opus_4_5: 'claude-opus-4-5-20251101',
	opus_4_1: 'claude-opus-4-1-20250319',
	opus_4: 'claude-opus-4-20250514',
	sonnet_4_5: 'claude-sonnet-4-5-20250929',
	sonnet_4: 'claude-sonnet-4-20250514',
	haiku_4_5: 'claude-haiku-4-5-20251001',
	haiku_3_5: 'claude-haiku-3-5-20241022',
	haiku_3: 'claude-3-haiku-20240307',
};

/**
 * Default model ID to use when model detection fails
 */
export const DEFAULT_MODEL_ID: ClaudeModelId = 'claude-sonnet-4-20250514';

/**
 * Check if a model ID is a valid Claude model
 *
 * @param modelId - The model ID to check
 * @returns True if the model ID is a known Claude model
 */
export function isClaudeModelId(modelId: string): modelId is ClaudeModelId {
	return modelId in CLAUDE_MODEL_PRICING;
}

/**
 * Get pricing configuration for a specific Claude model
 *
 * @param modelId - The model ID (can be full ID or alias)
 * @returns The pricing configuration for the model, or null if not found
 *
 * @example
 * ```typescript
 * const pricing = getPricingForModel('claude-opus-4-5-20251101');
 * const pricingByAlias = getPricingForModel('opus');
 * ```
 */
export function getPricingForModel(modelId: string): PricingConfig | null {
	// Check if it's a direct model ID
	if (isClaudeModelId(modelId)) {
		return CLAUDE_MODEL_PRICING[modelId];
	}

	// Try to resolve as alias
	const resolvedId = resolveModelAlias(modelId);
	if (resolvedId) {
		return CLAUDE_MODEL_PRICING[resolvedId];
	}

	return null;
}

/**
 * Resolve a model alias to its full model ID
 *
 * @param alias - The model alias (e.g., 'opus', 'sonnet-4.5')
 * @returns The full model ID, or null if no alias match
 *
 * @example
 * ```typescript
 * resolveModelAlias('opus') // 'claude-opus-4-5-20251101'
 * resolveModelAlias('haiku-3.5') // 'claude-haiku-3-5-20241022'
 * resolveModelAlias('unknown') // null
 * ```
 */
export function resolveModelAlias(alias: string): ClaudeModelId | null {
	const normalizedAlias = alias.toLowerCase().trim();

	// Direct alias lookup
	if (normalizedAlias in MODEL_ALIASES) {
		return MODEL_ALIASES[normalizedAlias];
	}

	// Check if it's already a valid model ID
	if (isClaudeModelId(alias)) {
		return alias;
	}

	return null;
}

/**
 * Get the display name for a model
 *
 * @param modelId - The model ID (can be full ID or alias)
 * @returns Human-readable model name, or the original ID if not found
 */
export function getModelDisplayName(modelId: string): string {
	// Check if it's a direct model ID
	if (isClaudeModelId(modelId)) {
		return CLAUDE_MODEL_PRICING[modelId].displayName;
	}

	// Try to resolve as alias
	const resolvedId = resolveModelAlias(modelId);
	if (resolvedId) {
		return CLAUDE_MODEL_PRICING[resolvedId].displayName;
	}

	return modelId;
}

/**
 * Get all supported model IDs
 *
 * @returns Array of all supported Claude model IDs
 */
export function getAllModelIds(): ClaudeModelId[] {
	return Object.keys(CLAUDE_MODEL_PRICING) as ClaudeModelId[];
}

/**
 * Get models by family
 *
 * @param family - The model family ('opus', 'sonnet', or 'haiku')
 * @returns Array of model IDs in the specified family
 */
export function getModelsByFamily(family: 'opus' | 'sonnet' | 'haiku'): ClaudeModelId[] {
	return (Object.entries(CLAUDE_MODEL_PRICING) as [ClaudeModelId, ClaudeModelPricing][])
		.filter(([, pricing]) => pricing.family === family)
		.map(([id]) => id);
}
