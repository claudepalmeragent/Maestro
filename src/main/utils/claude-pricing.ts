/**
 * Claude Model Pricing Registry
 *
 * All functions read from the model registry electron-store,
 * which is initialized with built-in defaults and can be
 * updated at runtime (e.g., by the model checker).
 *
 * @module claude-pricing
 */

import type { PricingConfig } from './pricing';
import { getModelRegistryStore } from '../stores/getters';
import type { ModelRegistryData } from '../stores/model-registry-types';

/**
 * Claude model identifier. Validated at runtime against the model registry store.
 */
export type ClaudeModelId = string;

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
	family: string;
}

/**
 * Get the current model registry data snapshot.
 * electron-store caches in memory, so this is fast.
 */
function getRegistry(): ModelRegistryData {
	return getModelRegistryStore().store;
}

/**
 * Get all model pricing as a Record (for backward compatibility).
 * Builds the record dynamically from the store.
 */
export function getModelPricingRecord(): Record<string, ClaudeModelPricing> {
	const reg = getRegistry();
	const result: Record<string, ClaudeModelPricing> = {};
	for (const [id, entry] of Object.entries(reg.models)) {
		result[id] = {
			...entry.pricing,
			displayName: entry.displayName,
			family: entry.family,
		};
	}
	return result;
}

/**
 * Get all model aliases as a Record (for backward compatibility).
 */
export function getModelAliasesRecord(): Record<string, string> {
	return getRegistry().aliases;
}

/**
 * Get the default model ID from the registry.
 */
export function getDefaultModelId(): string {
	return getRegistry().defaultModelId;
}

/**
 * Check if a model ID is a valid Claude model
 */
export function isClaudeModelId(modelId: string): boolean {
	return modelId in getRegistry().models;
}

/**
 * Get pricing configuration for a specific Claude model
 *
 * @param modelId - The model ID (can be full ID or alias)
 * @returns The pricing configuration for the model, or null if not found
 */
export function getPricingForModel(modelId: string): PricingConfig | null {
	const reg = getRegistry();

	// Check if it's a direct model ID
	if (modelId in reg.models) {
		return reg.models[modelId].pricing;
	}

	// Try to resolve as alias
	const resolvedId = resolveModelAlias(modelId);
	if (resolvedId && resolvedId in reg.models) {
		return reg.models[resolvedId].pricing;
	}

	return null;
}

/**
 * Resolve a model alias to its full model ID
 *
 * @param alias - The model alias (e.g., 'opus', 'sonnet-4.5')
 * @returns The full model ID, or null if no alias match
 */
export function resolveModelAlias(alias: string): string | null {
	const reg = getRegistry();
	const normalizedAlias = alias.toLowerCase().trim();

	// Direct alias lookup
	if (normalizedAlias in reg.aliases) {
		return reg.aliases[normalizedAlias];
	}

	// Check if it's already a valid model ID
	if (alias in reg.models) {
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
	const reg = getRegistry();

	// Check if it's a direct model ID
	if (modelId in reg.models) {
		return reg.models[modelId].displayName;
	}

	// Try to resolve as alias
	const resolvedId = resolveModelAlias(modelId);
	if (resolvedId && resolvedId in reg.models) {
		return reg.models[resolvedId].displayName;
	}

	return modelId;
}

/**
 * Get all supported model IDs
 */
export function getAllModelIds(): string[] {
	return Object.keys(getRegistry().models);
}

/**
 * Get models by family
 *
 * @param family - The model family ('opus', 'sonnet', or 'haiku')
 * @returns Array of model IDs in the specified family
 */
export function getModelsByFamily(family: string): string[] {
	const reg = getRegistry();
	return Object.entries(reg.models)
		.filter(([, entry]) => entry.family === family)
		.map(([id]) => id);
}

/**
 * Get the latest (newest) model ID for a given family.
 * Sorts by model ID descending — since IDs contain date suffixes (e.g., '20260115'),
 * lexicographic sort naturally puts the newest model first.
 *
 * This is used as a dynamic default when no model is explicitly configured,
 * avoiding hardcoded model IDs that break when new models are released.
 *
 * @param family - The model family ('opus', 'sonnet', or 'haiku')
 * @returns The full model ID of the latest model in the family, or null if no models exist
 */
export function getLatestModelByFamily(family: string): string | null {
	const reg = getRegistry();
	const familyModels = Object.entries(reg.models)
		.filter(([, entry]) => entry.family === family)
		.map(([id]) => id)
		.sort((a, b) => b.localeCompare(a));
	return familyModels[0] ?? null;
}

/**
 * Get all known model display names from the pricing registry.
 * Used by the model checker to compare against externally discovered models.
 *
 * @returns Set of all display names (e.g., 'Claude Opus 4.6', 'Claude Sonnet 4.5')
 */
export function getAllKnownModelDisplayNames(): Set<string> {
	const names = new Set<string>();
	for (const entry of Object.values(getRegistry().models)) {
		names.add(entry.displayName);
	}
	return names;
}
