/**
 * Model Registry Default Data
 *
 * Built-in defaults for the model registry store.
 * Contains all shipping models, aliases, and configuration.
 * The store initializes with these values on first run.
 */

import type { ModelRegistryData } from './model-registry-types';

export const MODEL_REGISTRY_DEFAULTS: ModelRegistryData = {
	schemaVersion: 1,
	defaultModelId: 'claude-opus-4-5-20251101',
	models: {
		// Opus 4.6 (latest)
		'claude-opus-4-6-20260115': {
			displayName: 'Claude Opus 4.6',
			family: 'opus',
			pricing: {
				INPUT_PER_MILLION: 5,
				OUTPUT_PER_MILLION: 25,
				CACHE_READ_PER_MILLION: 0.5,
				CACHE_CREATION_PER_MILLION: 6.25,
			},
			source: 'builtin',
		},
		// Opus 4.5
		'claude-opus-4-5-20251101': {
			displayName: 'Claude Opus 4.5',
			family: 'opus',
			pricing: {
				INPUT_PER_MILLION: 5,
				OUTPUT_PER_MILLION: 25,
				CACHE_READ_PER_MILLION: 0.5,
				CACHE_CREATION_PER_MILLION: 6.25,
			},
			source: 'builtin',
		},
		// Opus 4.1
		'claude-opus-4-1-20250319': {
			displayName: 'Claude Opus 4.1',
			family: 'opus',
			pricing: {
				INPUT_PER_MILLION: 15,
				OUTPUT_PER_MILLION: 75,
				CACHE_READ_PER_MILLION: 1.5,
				CACHE_CREATION_PER_MILLION: 18.75,
			},
			source: 'builtin',
		},
		// Opus 4
		'claude-opus-4-20250514': {
			displayName: 'Claude Opus 4',
			family: 'opus',
			pricing: {
				INPUT_PER_MILLION: 15,
				OUTPUT_PER_MILLION: 75,
				CACHE_READ_PER_MILLION: 1.5,
				CACHE_CREATION_PER_MILLION: 18.75,
			},
			source: 'builtin',
		},
		// Sonnet 4.5
		'claude-sonnet-4-5-20250929': {
			displayName: 'Claude Sonnet 4.5',
			family: 'sonnet',
			pricing: {
				INPUT_PER_MILLION: 3,
				OUTPUT_PER_MILLION: 15,
				CACHE_READ_PER_MILLION: 0.3,
				CACHE_CREATION_PER_MILLION: 3.75,
			},
			source: 'builtin',
		},
		// Sonnet 4.6
		'claude-sonnet-4-6-20260218': {
			displayName: 'Claude Sonnet 4.6',
			family: 'sonnet',
			pricing: {
				INPUT_PER_MILLION: 3,
				OUTPUT_PER_MILLION: 15,
				CACHE_READ_PER_MILLION: 0.3,
				CACHE_CREATION_PER_MILLION: 3.75,
			},
			source: 'builtin',
		},
		// Sonnet 4
		'claude-sonnet-4-20250514': {
			displayName: 'Claude Sonnet 4',
			family: 'sonnet',
			pricing: {
				INPUT_PER_MILLION: 3,
				OUTPUT_PER_MILLION: 15,
				CACHE_READ_PER_MILLION: 0.3,
				CACHE_CREATION_PER_MILLION: 3.75,
			},
			source: 'builtin',
		},
		// Haiku 4.5
		'claude-haiku-4-5-20251001': {
			displayName: 'Claude Haiku 4.5',
			family: 'haiku',
			pricing: {
				INPUT_PER_MILLION: 1,
				OUTPUT_PER_MILLION: 5,
				CACHE_READ_PER_MILLION: 0.1,
				CACHE_CREATION_PER_MILLION: 1.25,
			},
			source: 'builtin',
		},
		// Haiku 3.5
		'claude-haiku-3-5-20241022': {
			displayName: 'Claude Haiku 3.5',
			family: 'haiku',
			pricing: {
				INPUT_PER_MILLION: 0.8,
				OUTPUT_PER_MILLION: 4,
				CACHE_READ_PER_MILLION: 0.08,
				CACHE_CREATION_PER_MILLION: 1,
			},
			source: 'builtin',
		},
		// Haiku 3
		'claude-3-haiku-20240307': {
			displayName: 'Claude Haiku 3',
			family: 'haiku',
			pricing: {
				INPUT_PER_MILLION: 0.25,
				OUTPUT_PER_MILLION: 1.25,
				CACHE_READ_PER_MILLION: 0.03,
				CACHE_CREATION_PER_MILLION: 0.3,
			},
			source: 'builtin',
		},
	},
	aliases: {
		// Latest aliases
		opus: 'claude-opus-4-5-20251101',
		sonnet: 'claude-sonnet-4-6-20260218',
		haiku: 'claude-haiku-4-5-20251001',

		// Versioned aliases
		'opus-4.6': 'claude-opus-4-6-20260115',
		'opus-4.5': 'claude-opus-4-5-20251101',
		'opus-4.1': 'claude-opus-4-1-20250319',
		'opus-4': 'claude-opus-4-20250514',
		'sonnet-4.5': 'claude-sonnet-4-5-20250929',
		'sonnet-4.6': 'claude-sonnet-4-6-20260218',
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
		sonnet_4_6: 'claude-sonnet-4-6-20260218',
		sonnet_4: 'claude-sonnet-4-20250514',
		haiku_4_5: 'claude-haiku-4-5-20251001',
		haiku_3_5: 'claude-haiku-3-5-20241022',
		haiku_3: 'claude-3-haiku-20240307',

		// Short-form model IDs (without date suffix)
		// Claude Code emits these via msg.message.model field
		'claude-opus-4-6': 'claude-opus-4-6-20260115',
		'claude-opus-4-5': 'claude-opus-4-5-20251101',
		'claude-opus-4-1': 'claude-opus-4-1-20250319',
		'claude-opus-4': 'claude-opus-4-20250514',
		'claude-sonnet-4-5': 'claude-sonnet-4-5-20250929',
		'claude-sonnet-4-6': 'claude-sonnet-4-6-20260218',
		'claude-sonnet-4': 'claude-sonnet-4-20250514',
		'claude-haiku-4-5': 'claude-haiku-4-5-20251001',
		'claude-haiku-3-5': 'claude-haiku-3-5-20241022',
		'claude-3-haiku': 'claude-3-haiku-20240307',
	},
	suppressedDisplayNames: [
		'Claude Sonnet 3.7',
		'Claude Sonnet 3.5',
		'Claude Opus 3',
		'Claude Opus 3.5',
		'Claude Sonnet 3',
		'Claude Haiku 3',
	],
};
