/**
 * Stats listener.
 * Handles query-complete events for usage statistics tracking.
 *
 * Implements dual-source cost storage (Phase 2 of PRICING-DASHBOARD-COST-FIX):
 * - Stores Anthropic's reported cost (totalCostUsd from Claude response)
 * - Calculates and stores Maestro's cost (based on billing mode and pricing model)
 */

import type { ProcessManager } from '../process-manager';
import type { QueryCompleteData } from '../process-manager/types';
import type { ProcessListenerDependencies } from './types';
import type { QueryEvent } from '../../shared/stats-types';
import { resolveBillingMode } from '../utils/pricing-resolver';
import { calculateClaudeCostWithModel } from '../utils/pricing';
import { isClaudeModelId } from '../utils/claude-pricing';
import { getSessionsStore } from '../stores';

/**
 * Maximum number of retry attempts for transient database failures.
 */
const MAX_RETRY_ATTEMPTS = 3;

/**
 * Base delay in milliseconds for exponential backoff (doubles each retry).
 */
const RETRY_BASE_DELAY_MS = 100;

/**
 * Agent types that use Claude models and support billing mode detection.
 */
const CLAUDE_AGENT_TYPES = new Set(['claude-code', 'claude']);

/**
 * Map of Maestro session IDs to Claude Code session IDs.
 * Populated by 'session-id' events from ProcessManager.
 */
const claudeSessionMap = new Map<string, string>();

/**
 * Calculate dual-source costs for a query event.
 *
 * Returns both Anthropic's reported cost and Maestro's calculated cost based on
 * the resolved billing mode (api/max) and detected model.
 */
function calculateDualCosts(
	queryData: QueryCompleteData,
	logger: ProcessListenerDependencies['logger']
): {
	anthropicCostUsd: number;
	anthropicModel: string | null;
	maestroCostUsd: number;
	maestroBillingMode: 'api' | 'max' | 'free';
	maestroPricingModel: string | null;
	maestroCalculatedAt: number;
} {
	// Default values - use Anthropic's reported cost
	const anthropicCostUsd = queryData.totalCostUsd || 0;
	const anthropicModel = queryData.detectedModel || null;

	// Default Maestro values (same as Anthropic for non-Claude agents)
	let maestroCostUsd = anthropicCostUsd;
	let maestroBillingMode: 'api' | 'max' | 'free' = 'api';
	let maestroPricingModel: string | null = anthropicModel;
	const maestroCalculatedAt = Date.now();

	// Resolve billing mode and calculate Maestro cost for Claude agents
	const isClaude = CLAUDE_AGENT_TYPES.has(queryData.agentType);

	if (isClaude) {
		// Resolve billing mode for all Claude agents regardless of model detection
		// The billing mode depends on user's subscription, not the specific model
		const agentId = queryData.agentId || queryData.sessionId;
		try {
			maestroBillingMode = resolveBillingMode(agentId);
			logger.debug('[stats-listener] Resolved billing mode for agent', '[Stats]', {
				sessionId: queryData.sessionId,
				agentId,
				billingMode: maestroBillingMode,
			});
		} catch (err) {
			logger.warn('[stats-listener] Failed to resolve billing mode, defaulting to api', '[Stats]', {
				error: String(err),
				sessionId: queryData.sessionId,
				agentId,
			});
			maestroBillingMode = 'api';
		}

		// Calculate cost if model is detected
		if (anthropicModel) {
			try {
				// Check if this is a non-Claude model (Ollama, local models, etc.)
				if (!isClaudeModelId(anthropicModel)) {
					// Non-Claude models are free (Ollama, local, etc.)
					maestroBillingMode = 'free';
					maestroCostUsd = 0;
					maestroPricingModel = anthropicModel;

					logger.debug('[stats-listener] Non-Claude model detected, marking as free', '[Stats]', {
						sessionId: queryData.sessionId,
						model: anthropicModel,
					});
				} else {
					maestroPricingModel = anthropicModel;

					// Calculate cost with proper billing mode
					const tokens = {
						inputTokens: queryData.inputTokens || 0,
						outputTokens: queryData.outputTokens || 0,
						cacheReadTokens: queryData.cacheReadInputTokens || 0,
						cacheCreationTokens: queryData.cacheCreationInputTokens || 0,
					};

					maestroCostUsd = calculateClaudeCostWithModel(tokens, anthropicModel, maestroBillingMode);
				}
			} catch (error) {
				// Fall back to Anthropic cost on any error
				logger.warn(
					'[stats-listener] Error calculating Maestro cost, falling back to Anthropic',
					'[Stats]',
					{
						error: String(error),
						sessionId: queryData.sessionId,
						model: anthropicModel,
					}
				);
				maestroCostUsd = anthropicCostUsd;
			}
		}
	}

	return {
		anthropicCostUsd,
		anthropicModel,
		maestroCostUsd,
		maestroBillingMode,
		maestroPricingModel,
		maestroCalculatedAt,
	};
}

/**
 * Attempts to insert a query event with retry logic for transient failures.
 * Uses exponential backoff: 100ms, 200ms, 400ms delays between retries.
 *
 * Calculates and stores dual-source costs (Anthropic + Maestro) for each query.
 */
async function insertQueryEventWithRetry(
	db: ReturnType<ProcessListenerDependencies['getStatsDB']>,
	queryData: QueryCompleteData,
	logger: ProcessListenerDependencies['logger']
): Promise<string | null> {
	// Calculate dual costs before insertion
	const dualCosts = calculateDualCosts(queryData, logger);

	// Log dual cost calculation for debugging
	const savings = dualCosts.anthropicCostUsd - dualCosts.maestroCostUsd;
	if (savings !== 0 || dualCosts.maestroBillingMode !== 'api') {
		logger.debug('[stats-listener] Storing query with dual costs', '[Stats]', {
			sessionId: queryData.sessionId,
			anthropicCost: dualCosts.anthropicCostUsd.toFixed(6),
			maestroCost: dualCosts.maestroCostUsd.toFixed(6),
			billingMode: dualCosts.maestroBillingMode,
			model: dualCosts.anthropicModel,
			savings: savings.toFixed(6),
		});
	}

	// Build enriched query event with dual costs
	const enrichedEvent: Omit<QueryEvent, 'id'> = {
		sessionId: queryData.sessionId,
		agentId: queryData.agentId,
		agentType: queryData.agentType,
		source: queryData.source,
		startTime: queryData.startTime,
		duration: queryData.duration,
		projectPath: queryData.projectPath,
		tabId: queryData.tabId,
		inputTokens: queryData.inputTokens,
		outputTokens: queryData.outputTokens,
		tokensPerSecond: queryData.tokensPerSecond,
		cacheReadInputTokens: queryData.cacheReadInputTokens,
		cacheCreationInputTokens: queryData.cacheCreationInputTokens,

		// Legacy field - use Maestro cost for backward compatibility
		totalCostUsd: dualCosts.maestroCostUsd,

		// Anthropic values (from Claude response)
		anthropicCostUsd: dualCosts.anthropicCostUsd,
		anthropicModel: dualCosts.anthropicModel || undefined,
		anthropicMessageId: queryData.anthropicMessageId,

		// Maestro calculated values
		maestroCostUsd: dualCosts.maestroCostUsd,
		maestroBillingMode: dualCosts.maestroBillingMode,
		maestroPricingModel: dualCosts.maestroPricingModel || undefined,
		maestroCalculatedAt: dualCosts.maestroCalculatedAt,

		// Claude session ID for reconstruction matching (v8)
		claudeSessionId: claudeSessionMap.get(queryData.sessionId),
	};

	for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
		try {
			const id = db.insertQueryEvent(enrichedEvent);
			return id;
		} catch (error) {
			const isLastAttempt = attempt === MAX_RETRY_ATTEMPTS;

			if (isLastAttempt) {
				logger.error(
					`Failed to record query event after ${MAX_RETRY_ATTEMPTS} attempts`,
					'[Stats]',
					{
						error: String(error),
						sessionId: queryData.sessionId,
					}
				);
			} else {
				const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
				logger.warn(
					`Stats DB insert failed (attempt ${attempt}/${MAX_RETRY_ATTEMPTS}), retrying in ${delay}ms`,
					'[Stats]',
					{
						error: String(error),
						sessionId: queryData.sessionId,
					}
				);
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		}
	}

	return null;
}

/**
 * Sets up the query-complete listener for stats tracking.
 * Records AI query events to the stats database with retry logic for transient failures.
 *
 * Stores dual-source costs:
 * - anthropic_cost_usd: Cost as reported by Anthropic/Claude
 * - maestro_cost_usd: Cost calculated by Maestro (respecting billing mode)
 */
export function setupStatsListener(
	processManager: ProcessManager,
	deps: Pick<ProcessListenerDependencies, 'safeSend' | 'getStatsDB' | 'logger'>
): void {
	const { safeSend, getStatsDB, logger } = deps;

	// Capture Claude session ID mapping from 'session-id' events
	// This handles both interactive and Auto Run sessions
	processManager.on('session-id', (maestroSessionId: string, claudeSessionId: string) => {
		claudeSessionMap.set(maestroSessionId, claudeSessionId);

		// Also persist to sessions store so agentSessionId survives app restart
		// This is critical for Auto Run sessions where no interactive handshake occurs
		try {
			const sessionsStore = getSessionsStore();
			const sessions = sessionsStore.get('sessions', []) as any[];
			const sessionIndex = sessions.findIndex((s: any) => s.id === maestroSessionId);
			if (sessionIndex >= 0 && !sessions[sessionIndex].agentSessionId) {
				sessions[sessionIndex].agentSessionId = claudeSessionId;
				sessionsStore.set('sessions', sessions);
				logger.debug('[stats-listener] Persisted agentSessionId to session store', '[Stats]', {
					maestroSessionId,
					claudeSessionId,
				});
			}
		} catch (err) {
			logger.warn('[stats-listener] Failed to persist agentSessionId to session store', '[Stats]', {
				error: String(err),
				maestroSessionId,
			});
		}

		logger.debug('[stats-listener] Captured Claude session mapping', '[Stats]', {
			maestroSessionId,
			claudeSessionId,
		});
	});

	// Handle query-complete events for stats tracking
	// This is emitted when a batch mode AI query completes (user or auto)
	processManager.on('query-complete', (_sessionId: string, queryData: QueryCompleteData) => {
		// Log incoming query data for debugging FIX-30 model tracking
		logger.debug('[stats-listener] Received query-complete event', '[Stats]', {
			sessionId: queryData.sessionId,
			detectedModel: queryData.detectedModel,
			anthropicMessageId: queryData.anthropicMessageId,
			agentType: queryData.agentType,
			source: queryData.source,
		});

		const db = getStatsDB();
		if (!db.isReady()) {
			return;
		}

		// Use async IIFE to handle retry logic without blocking
		void (async () => {
			const id = await insertQueryEventWithRetry(db, queryData, logger);

			if (id !== null) {
				logger.debug(`Recorded query event: ${id}`, '[Stats]', {
					sessionId: queryData.sessionId,
					agentType: queryData.agentType,
					source: queryData.source,
					duration: queryData.duration,
					detectedModel: queryData.detectedModel,
				});
				// Broadcast stats update to renderer for real-time dashboard refresh
				safeSend('stats:updated');
			}
		})();
	});
}
