/**
 * Model Registry Store Types
 *
 * Schema for the model registry electron-store instance.
 * This store is the single source of truth for all Claude model
 * pricing data, aliases, and metadata.
 */

/**
 * Top-level schema for the model registry store.
 */
export interface ModelRegistryData {
	/** Schema version for future migrations */
	schemaVersion: number;

	/** Model pricing entries keyed by full model ID (e.g., 'claude-opus-4-6-20260115') */
	models: Record<string, ModelEntry>;

	/** Alias map: short name → full model ID (e.g., 'opus' → 'claude-opus-4-5-20251101') */
	aliases: Record<string, string>;

	/** Default model ID to use when model detection fails */
	defaultModelId: string;

	/** Model display names to suppress in model-checker toast notifications */
	suppressedDisplayNames: string[];
}

/**
 * A single model entry in the registry.
 */
export interface ModelEntry {
	/** Human-readable name (e.g., 'Claude Opus 4.6') */
	displayName: string;

	/** Model family: 'opus', 'sonnet', 'haiku', or future families */
	family: string;

	/** Pricing per million tokens in USD */
	pricing: {
		INPUT_PER_MILLION: number;
		OUTPUT_PER_MILLION: number;
		CACHE_READ_PER_MILLION: number;
		CACHE_CREATION_PER_MILLION: number;
	};

	/** ISO timestamp when this entry was added or last updated */
	addedAt?: string;

	/** Source of this entry */
	source?: 'builtin' | 'auto' | 'manual';
}
