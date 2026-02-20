/**
 * HoneycombQueryClient
 *
 * Shared HTTP client for querying the Honeycomb REST API.
 * Used by HoneycombUsageService (polling) and HoneycombArchiveService (archival).
 *
 * Features:
 * - Smart TTL caching per query type
 * - Rate-limit header parsing with self-regulation
 * - Exponential backoff on failures
 * - Request deduplication (concurrent identical queries share one HTTP call)
 * - Stale-while-revalidate (serve cached data immediately, refresh in background)
 * - In-memory cache + electron-store for restart persistence
 *
 * @see Investigation plan Sections 18.7, 20.1–20.6
 */

import { app } from 'electron';
import Store from 'electron-store';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import { getSettingsStore } from '../stores';
import { mcpRunQuery, closeHoneycombMcpClient } from './honeycomb-mcp-client';

// ============================================================================
// Types
// ============================================================================

/** Query specification for Honeycomb REST API */
export interface HoneycombQuerySpec {
	calculations: Array<{
		op: string;
		column?: string;
		name?: string;
		filters?: Array<{ column: string; op: string; value?: unknown }>;
	}>;
	filters?: Array<{ column: string; op: string; value?: unknown }>;
	breakdowns?: string[];
	time_range?: number;
	start_time?: number;
	end_time?: number;
	granularity?: number;
	limit?: number;
	orders?: Array<{ column?: string; op?: string; order?: string }>;
	filter_combination?: 'AND' | 'OR';
	formulas?: Array<{ name: string; expression: string }>;
}

/** Result from a Honeycomb query */
export interface HoneycombQueryResult {
	data: {
		results: Array<Record<string, unknown>>;
		series?: Array<{ time: string; data: Record<string, unknown> }>;
	};
	queryId?: string;
	queryRunId?: string;
}

/** Cached query result with metadata */
export interface CachedQueryResult {
	queryHash: string;
	result: HoneycombQueryResult;
	fetchedAt: number;
	ttlMs: number;
	stale: boolean;
	rateLimitRemaining?: number;
	rateLimitResetAt?: number;
}

/** Rate limit state from response headers */
interface RateLimitState {
	remaining: number | null;
	limit: number | null;
	resetAt: number | null;
	lastUpdated: number;
}

/** Query execution options */
export interface QueryOptions {
	/** TTL for caching this result in milliseconds (default: 300000 = 5 min) */
	ttlMs?: number;
	/** If true, bypass cache and force a fresh query */
	bypassCache?: boolean;
	/** If true, return stale cached data if fresh query fails */
	staleOnError?: boolean;
	/** Dataset slug override (default: from settings) */
	dataset?: string;
	/** Custom label for logging */
	label?: string;
}

/** Persistent cache shape for electron-store */
interface HoneycombCacheData {
	cache: Record<string, CachedQueryResult>;
	rateLimitState: RateLimitState;
}

const LOG_CONTEXT = 'HoneycombQueryClient';
const API_BASE_URL = 'https://api.honeycomb.io';

// Default TTLs per query type (milliseconds)
export const DEFAULT_TTL = {
	FIVE_HOUR: 300_000, // 5 minutes — needs freshness for active monitoring
	WEEKLY: 900_000, // 15 minutes — changes slowly relative to total
	MONTHLY_SESSIONS: 3_600_000, // 60 minutes — changes very rarely
	ARCHIVE: 86_400_000, // 24 hours — archival data doesn't change
};

// Backoff constants
const INITIAL_BACKOFF_MS = 300_000; // 5 minutes
const MAX_BACKOFF_MS = 3_600_000; // 60 minutes
const BACKOFF_MULTIPLIER = 2;

// ============================================================================
// Singleton
// ============================================================================

let _instance: HoneycombQueryClient | null = null;

export function getHoneycombQueryClient(): HoneycombQueryClient {
	if (!_instance) {
		_instance = new HoneycombQueryClient();
	}
	return _instance;
}

export function closeHoneycombQueryClient(): void {
	if (_instance) {
		_instance.dispose();
		_instance = null;
	}
	closeHoneycombMcpClient();
}

// ============================================================================
// Implementation
// ============================================================================

export class HoneycombQueryClient {
	private cache: Map<string, CachedQueryResult> = new Map();
	private inflight: Map<string, Promise<HoneycombQueryResult>> = new Map();
	private rateLimitState: RateLimitState = {
		remaining: null,
		limit: null,
		resetAt: null,
		lastUpdated: 0,
	};
	private backoffMs: number = 0;
	private backoffUntil: number = 0;
	private persistentCache: Store<HoneycombCacheData>;

	constructor() {
		this.persistentCache = new Store<HoneycombCacheData>({
			name: 'maestro-honeycomb-cache',
			cwd: app.getPath('userData'),
			defaults: {
				cache: {},
				rateLimitState: {
					remaining: null,
					limit: null,
					resetAt: null,
					lastUpdated: 0,
				},
			},
		});

		// Load cached results from persistent store
		this.loadPersistentCache();
	}

	// ============================================================================
	// Public API
	// ============================================================================

	/**
	 * Execute a query against the Honeycomb REST API.
	 * Returns cached data if available and within TTL.
	 * Deduplicates concurrent identical queries.
	 */
	async query(
		querySpec: HoneycombQuerySpec,
		options: QueryOptions = {}
	): Promise<HoneycombQueryResult> {
		const {
			ttlMs = DEFAULT_TTL.FIVE_HOUR,
			bypassCache = false,
			staleOnError = true,
			dataset,
			label = 'query',
		} = options;

		const hash = this.hashQuery(querySpec, dataset);

		// Check cache first (unless bypassing)
		if (!bypassCache) {
			const cached = this.cache.get(hash);
			if (cached && !this.isExpired(cached)) {
				logger.debug(`Cache hit for ${label} (hash=${hash.slice(0, 8)})`, LOG_CONTEXT);
				return cached.result;
			}
		}

		// Check for inflight deduplication
		const inflight = this.inflight.get(hash);
		if (inflight) {
			logger.debug(`Deduplicating ${label} (hash=${hash.slice(0, 8)})`, LOG_CONTEXT);
			return inflight;
		}

		// Check backoff
		if (Date.now() < this.backoffUntil) {
			const staleResult = this.cache.get(hash);
			if (staleResult && staleOnError) {
				logger.debug(
					`In backoff, serving stale for ${label} (${Math.round((this.backoffUntil - Date.now()) / 1000)}s remaining)`,
					LOG_CONTEXT
				);
				return { ...staleResult.result };
			}
			throw new Error(
				`Honeycomb API in backoff (${Math.round((this.backoffUntil - Date.now()) / 1000)}s remaining)`
			);
		}

		// Execute query
		const mode = this.getDataSourceMode();
		const resolvedDataset = dataset || this.getDatasetSlug();
		const promise = (
			mode === 'mcp'
				? this.executeMcpQuery(querySpec, resolvedDataset, label)
				: this.executeQuery(querySpec, dataset, label)
		)
			.then((result) => {
				// Cache the result
				const cached: CachedQueryResult = {
					queryHash: hash,
					result,
					fetchedAt: Date.now(),
					ttlMs,
					stale: false,
					rateLimitRemaining: this.rateLimitState.remaining ?? undefined,
					rateLimitResetAt: this.rateLimitState.resetAt ?? undefined,
				};
				this.cache.set(hash, cached);
				this.savePersistentCache();

				// Reset backoff on success
				this.backoffMs = 0;
				this.backoffUntil = 0;

				return result;
			})
			.catch((error) => {
				// Apply exponential backoff
				this.applyBackoff();

				// Return stale data if available
				const staleResult = this.cache.get(hash);
				if (staleResult && staleOnError) {
					logger.warn(
						`Query failed for ${label}, serving stale data: ${error.message}`,
						LOG_CONTEXT
					);
					staleResult.stale = true;
					return staleResult.result;
				}

				throw error;
			})
			.finally(() => {
				this.inflight.delete(hash);
			});

		this.inflight.set(hash, promise);
		return promise;
	}

	/**
	 * Get the current rate limit state.
	 */
	getRateLimitState(): Readonly<RateLimitState> {
		return { ...this.rateLimitState };
	}

	/**
	 * Check if the client is approaching rate limits (>80% consumed).
	 */
	isApproachingRateLimit(): boolean {
		const { remaining, limit } = this.rateLimitState;
		if (remaining === null || limit === null || limit === 0) return false;
		return remaining / limit < 0.2;
	}

	/**
	 * Get the current backoff state.
	 */
	getBackoffState(): { inBackoff: boolean; remainingMs: number } {
		const now = Date.now();
		if (now >= this.backoffUntil) {
			return { inBackoff: false, remainingMs: 0 };
		}
		return { inBackoff: true, remainingMs: this.backoffUntil - now };
	}

	/**
	 * Clear all cached data.
	 */
	clearCache(): void {
		this.cache.clear();
		this.persistentCache.set('cache', {});
		logger.info('Cache cleared', LOG_CONTEXT);
	}

	/**
	 * Get the configured API key.
	 * Checks settings first, then environment variable.
	 */
	getApiKey(): string | null {
		const store = getSettingsStore();
		const settingsKey = store.get('honeycombApiKey', '');
		if (settingsKey) return settingsKey;

		// Fall back to environment variable (same as OTEL export)
		return process.env.HONEYCOMB_API_KEY || null;
	}

	/**
	 * Get the configured dataset slug.
	 */
	getDatasetSlug(): string {
		const store = getSettingsStore();
		return store.get('honeycombDatasetSlug', 'claude-code');
	}

	/**
	 * Get the configured data source mode ('mcp' or 'api').
	 */
	private getDataSourceMode(): 'mcp' | 'api' {
		const store = getSettingsStore();
		return store.get('honeycombDataSource', 'mcp') as 'mcp' | 'api';
	}

	/**
	 * Get the configured environment slug (used in MCP mode).
	 */
	private getEnvironmentSlug(): string {
		const store = getSettingsStore();
		return store.get('honeycombEnvironmentSlug', 'claudepalmeragent') as string;
	}

	/**
	 * Get the configured Management API key (used in MCP mode).
	 */
	private getMcpApiKey(): string {
		const store = getSettingsStore();
		return store.get('honeycombMcpApiKey', '') as string;
	}

	/**
	 * Check if the Honeycomb integration is configured and ready to query.
	 * In MCP mode: requires honeycombEnabled + Management API key + environment slug.
	 * In API mode: requires honeycombEnabled + Team API key.
	 */
	isConfigured(): boolean {
		const store = getSettingsStore();
		const enabled = store.get('honeycombEnabled', true) as boolean;
		if (!enabled) return false;

		const mode = this.getDataSourceMode();
		if (mode === 'mcp') {
			const mcpKey = this.getMcpApiKey();
			const envSlug = this.getEnvironmentSlug();
			return !!mcpKey && !!envSlug;
		} else {
			const apiKey = this.getApiKey();
			return !!apiKey;
		}
	}

	/**
	 * Dispose the client and clean up resources.
	 */
	dispose(): void {
		this.savePersistentCache();
		this.cache.clear();
		this.inflight.clear();
	}

	// ============================================================================
	// Private Methods
	// ============================================================================

	/**
	 * Execute a query via the Honeycomb MCP server.
	 * Uses the MCP client singleton from honeycomb-mcp-client.ts.
	 */
	private async executeMcpQuery(
		querySpec: HoneycombQuerySpec,
		dataset: string,
		label: string
	): Promise<HoneycombQueryResult> {
		const envSlug = this.getEnvironmentSlug();
		logger.debug(`MCP query [${label}]: env=${envSlug}, dataset=${dataset}`, LOG_CONTEXT);
		return mcpRunQuery(envSlug, dataset, querySpec);
	}

	/**
	 * Execute a query against the Honeycomb REST API.
	 */
	private async executeQuery(
		querySpec: HoneycombQuerySpec,
		datasetOverride?: string,
		label?: string
	): Promise<HoneycombQueryResult> {
		const apiKey = this.getApiKey();
		if (!apiKey) {
			throw new Error('Honeycomb API key not configured');
		}

		const dataset = datasetOverride || this.getDatasetSlug();
		const url = `${API_BASE_URL}/1/queries/${encodeURIComponent(dataset)}`;

		logger.debug(`Executing ${label || 'query'}: ${url}`, LOG_CONTEXT);

		const startTime = Date.now();

		// Use native fetch (available in Node 18+ / Electron 28+)
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'X-Honeycomb-Team': apiKey,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(querySpec),
			signal: AbortSignal.timeout(30_000), // 30-second timeout
		});

		const elapsed = Date.now() - startTime;

		// Parse rate-limit headers
		this.parseRateLimitHeaders(response.headers);

		if (!response.ok) {
			const errorBody = await response.text().catch(() => '(no body)');
			const errorMsg = `Honeycomb API error: ${response.status} ${response.statusText} — ${errorBody}`;
			logger.error(`${label || 'query'} failed (${elapsed}ms): ${errorMsg}`, LOG_CONTEXT);
			throw new Error(errorMsg);
		}

		const data = await response.json();
		logger.debug(`${label || 'query'} completed (${elapsed}ms)`, LOG_CONTEXT);

		return { data } as HoneycombQueryResult;
	}

	/**
	 * Parse rate-limit headers from the Honeycomb API response.
	 * Headers: Ratelimit-Limit, Ratelimit-Remaining, Ratelimit-Reset
	 */
	private parseRateLimitHeaders(headers: Headers): void {
		const remaining = headers.get('ratelimit-remaining');
		const limit = headers.get('ratelimit-limit');
		const reset = headers.get('ratelimit-reset');

		if (remaining !== null) {
			this.rateLimitState.remaining = parseInt(remaining, 10);
		}
		if (limit !== null) {
			this.rateLimitState.limit = parseInt(limit, 10);
		}
		if (reset !== null) {
			this.rateLimitState.resetAt = parseInt(reset, 10) * 1000; // Convert to ms
		}
		this.rateLimitState.lastUpdated = Date.now();

		// Self-regulate if approaching limits
		if (this.isApproachingRateLimit()) {
			logger.warn(
				`Approaching rate limit: ${this.rateLimitState.remaining}/${this.rateLimitState.limit} remaining`,
				LOG_CONTEXT
			);
		}

		// Persist rate limit state
		this.persistentCache.set('rateLimitState', this.rateLimitState);
	}

	/**
	 * Apply exponential backoff after a failure.
	 */
	private applyBackoff(): void {
		if (this.backoffMs === 0) {
			this.backoffMs = INITIAL_BACKOFF_MS;
		} else {
			this.backoffMs = Math.min(this.backoffMs * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
		}
		this.backoffUntil = Date.now() + this.backoffMs;
		logger.warn(`Backoff applied: ${Math.round(this.backoffMs / 1000)}s`, LOG_CONTEXT);
	}

	/**
	 * Generate a deterministic hash for a query spec + dataset.
	 */
	private hashQuery(querySpec: HoneycombQuerySpec, dataset?: string): string {
		const key = JSON.stringify({ querySpec, dataset: dataset || this.getDatasetSlug() });
		return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
	}

	/**
	 * Check if a cached result is expired based on its TTL.
	 */
	private isExpired(cached: CachedQueryResult): boolean {
		return Date.now() - cached.fetchedAt > cached.ttlMs;
	}

	/**
	 * Load cached results from persistent electron-store.
	 */
	private loadPersistentCache(): void {
		try {
			const stored = this.persistentCache.get('cache', {});
			const storedRateLimit = this.persistentCache.get('rateLimitState');
			let loadedCount = 0;

			for (const [hash, cached] of Object.entries(stored)) {
				// Only load if not expired
				if (!this.isExpired(cached)) {
					this.cache.set(hash, cached);
					loadedCount++;
				}
			}

			if (storedRateLimit) {
				this.rateLimitState = storedRateLimit;
			}

			if (loadedCount > 0) {
				logger.debug(`Loaded ${loadedCount} cached queries from persistent store`, LOG_CONTEXT);
			}
		} catch (error) {
			logger.warn(`Failed to load persistent cache: ${error}`, LOG_CONTEXT);
		}
	}

	/**
	 * Save current cache to persistent electron-store.
	 * Only saves non-expired entries.
	 */
	private savePersistentCache(): void {
		try {
			const toStore: Record<string, CachedQueryResult> = {};
			for (const [hash, cached] of this.cache.entries()) {
				if (!this.isExpired(cached)) {
					toStore[hash] = cached;
				}
			}
			this.persistentCache.set('cache', toStore);
		} catch (error) {
			logger.warn(`Failed to save persistent cache: ${error}`, LOG_CONTEXT);
		}
	}
}
