/**
 * Pricing Resolution Utility
 *
 * Resolves billing mode and pricing model for agents based on precedence:
 * 1. Agent-level setting (if not 'auto')
 * 2. Project Folder default (if agent is in a folder)
 * 3. Auto-detected from credentials
 * 4. Application default ('api')
 *
 * @module pricing-resolver
 */

import { getAgentConfigsStore, getProjectFoldersStore, getSessionsStore } from '../stores/getters';
import { logger } from './logger';
import type { AgentPricingConfig } from '../stores/types';
import type {
	ClaudeBillingMode,
	ClaudeModelId,
	ProjectFolderPricingConfig,
} from '../../shared/types';
import { DEFAULT_MODEL_ID } from './claude-pricing';
import { detectLocalAuth } from './claude-auth-detector';

const LOG_CONTEXT = '[PricingResolver]';

/** Default pricing config returned when store data is corrupted or unavailable */
const DEFAULT_PRICING_CONFIG: AgentPricingConfig = { billingMode: 'auto', pricingModel: 'auto' };

/**
 * Get the agent pricing configuration for a specific agent.
 * Returns the stored config or defaults if not found or if store data is corrupted.
 *
 * @param agentId - The agent ID to get pricing config for
 * @returns The agent pricing configuration
 */
export function getAgentPricingConfig(agentId: string): AgentPricingConfig {
	try {
		const store = getAgentConfigsStore();
		const allConfigs = store.get('configs', {});
		const config = allConfigs[agentId]?.pricingConfig as AgentPricingConfig | undefined;
		if (config && config.billingMode && config.pricingModel) {
			return config;
		}
		return DEFAULT_PRICING_CONFIG;
	} catch (error) {
		logger.warn(
			`${LOG_CONTEXT} Failed to get agent pricing config for ${agentId}: ${error instanceof Error ? error.message : String(error)}`,
			LOG_CONTEXT
		);
		return DEFAULT_PRICING_CONFIG;
	}
}

/**
 * Get the project folder pricing configuration for a specific folder.
 * Returns null if the folder doesn't exist, has no pricing config, or if store data is corrupted.
 *
 * @param folderId - The project folder ID
 * @returns The pricing config or null
 */
export function getProjectFolderPricingConfig(folderId: string): ProjectFolderPricingConfig | null {
	try {
		const store = getProjectFoldersStore();
		const folders = store.get('folders', []);
		if (!Array.isArray(folders)) {
			logger.warn(`${LOG_CONTEXT} Project folders data is not an array`, LOG_CONTEXT);
			return null;
		}
		const folder = folders.find((f) => f.id === folderId);
		return folder?.pricingConfig || null;
	} catch (error) {
		logger.warn(
			`${LOG_CONTEXT} Failed to get project folder pricing config for ${folderId}: ${error instanceof Error ? error.message : String(error)}`,
			LOG_CONTEXT
		);
		return null;
	}
}

/**
 * Get the project folder ID for an agent (session).
 * Returns the first folder ID if the session belongs to multiple folders.
 * Returns null if session not found or if store data is corrupted.
 *
 * @param agentId - The agent/session ID
 * @returns The project folder ID or null
 */
export function getAgentProjectFolderId(agentId: string): string | null {
	try {
		const store = getSessionsStore();
		const sessions = store.get('sessions', []);
		if (!Array.isArray(sessions)) {
			logger.warn(`${LOG_CONTEXT} Sessions data is not an array`, LOG_CONTEXT);
			return null;
		}
		const session = sessions.find((s) => s.id === agentId);
		if (session?.projectFolderIds && session.projectFolderIds.length > 0) {
			return session.projectFolderIds[0];
		}
		return null;
	} catch (error) {
		logger.warn(
			`${LOG_CONTEXT} Failed to get agent project folder ID for ${agentId}: ${error instanceof Error ? error.message : String(error)}`,
			LOG_CONTEXT
		);
		return null;
	}
}

/**
 * Resolve the billing mode for an agent based on configuration precedence (sync version).
 * NOTE: This does NOT auto-detect from credentials. Use resolveBillingModeAsync for full detection.
 *
 * Precedence order:
 * 1. Agent-level setting (if not 'auto')
 * 2. Project Folder default (if agent is in a folder)
 * 3. Cached auto-detected billing mode
 * 4. Application default ('api')
 *
 * @param agentId - The agent ID to resolve billing mode for
 * @param projectFolderId - Optional project folder ID (if known)
 * @returns The resolved billing mode ('max' or 'api')
 */
export function resolveBillingMode(agentId: string, projectFolderId?: string): ClaudeBillingMode {
	// 1. Check agent-level setting
	const agentConfig = getAgentPricingConfig(agentId);
	if (agentConfig.billingMode !== 'auto') {
		return agentConfig.billingMode;
	}

	// 2. Check project folder default
	const folderId = projectFolderId ?? getAgentProjectFolderId(agentId);
	if (folderId) {
		const folderConfig = getProjectFolderPricingConfig(folderId);
		if (folderConfig?.billingMode) {
			return folderConfig.billingMode;
		}
	}

	// 3. Check auto-detected
	if (agentConfig.detectedBillingMode) {
		return agentConfig.detectedBillingMode;
	}

	// 4. Default to 'api' (conservative)
	return 'api';
}

/**
 * Resolve the billing mode for an agent with async auto-detection from credentials.
 *
 * Precedence order:
 * 1. Agent-level setting (if not 'auto')
 * 2. Project Folder default (if agent is in a folder)
 * 3. Auto-detected from ~/.claude/.credentials.json
 * 4. Application default ('api')
 *
 * @param agentId - The agent ID to resolve billing mode for
 * @param projectFolderId - Optional project folder ID (if known)
 * @returns Promise resolving to the billing mode ('max' or 'api')
 */
export async function resolveBillingModeAsync(
	agentId: string,
	projectFolderId?: string
): Promise<ClaudeBillingMode> {
	// 1. Check agent-level setting
	const agentConfig = getAgentPricingConfig(agentId);
	console.log('[FIX-30] agentConfig:', {
		agentId,
		billingMode: agentConfig.billingMode,
		detectedBillingMode: agentConfig.detectedBillingMode,
	});
	if (agentConfig.billingMode !== 'auto') {
		console.log('[FIX-30] Using agent-level billingMode:', agentConfig.billingMode);
		return agentConfig.billingMode;
	}

	// 2. Check project folder default
	const folderId = projectFolderId ?? getAgentProjectFolderId(agentId);
	if (folderId) {
		const folderConfig = getProjectFolderPricingConfig(folderId);
		if (folderConfig?.billingMode) {
			return folderConfig.billingMode;
		}
	}

	// 3. Check cached auto-detected in agent config
	if (agentConfig.detectedBillingMode) {
		return agentConfig.detectedBillingMode;
	}

	// 4. Auto-detect from credentials file (same as agents:detectAuth IPC handler)
	try {
		const auth = await detectLocalAuth();
		console.log('[FIX-30] detectLocalAuth returned:', {
			billingMode: auth.billingMode,
			source: auth.source,
			subscriptionType: auth.subscriptionType,
		});
		return auth.billingMode;
	} catch (error) {
		console.log('[FIX-30] detectLocalAuth error:', error);
	}

	// 5. Default to 'api' (conservative)
	return 'api';
}

/**
 * Resolve the model for pricing calculations based on configuration precedence.
 *
 * Precedence order:
 * 1. Agent-level model setting (if not 'auto')
 * 2. Auto-detected model from agent output
 * 3. Application default model
 *
 * @param agentId - The agent ID to resolve model for
 * @returns The resolved Claude model ID
 */
export function resolveModelForPricing(agentId: string): ClaudeModelId {
	const agentConfig = getAgentPricingConfig(agentId);

	// 1. Check agent-level model setting
	if (agentConfig.pricingModel !== 'auto') {
		return agentConfig.pricingModel;
	}

	// 2. Check auto-detected model
	if (agentConfig.detectedModel) {
		return agentConfig.detectedModel;
	}

	// 3. Default model
	return DEFAULT_MODEL_ID;
}

/**
 * Resolved pricing configuration with all values determined.
 */
export interface ResolvedPricingConfig {
	/** The resolved billing mode */
	billingMode: ClaudeBillingMode;
	/** The resolved model ID for pricing */
	modelId: ClaudeModelId;
	/** Source of the billing mode resolution */
	billingModeSource: 'agent' | 'folder' | 'detected' | 'default';
	/** Source of the model resolution */
	modelSource: 'agent' | 'detected' | 'default';
}

/**
 * Resolve all pricing configuration for an agent.
 * Returns both the resolved values and their sources for debugging/UI display.
 *
 * @param agentId - The agent ID to resolve pricing for
 * @param projectFolderId - Optional project folder ID (if known)
 * @returns The fully resolved pricing configuration
 */
export function resolvePricingConfig(
	agentId: string,
	projectFolderId?: string
): ResolvedPricingConfig {
	const agentConfig = getAgentPricingConfig(agentId);
	const folderId = projectFolderId ?? getAgentProjectFolderId(agentId);

	// Resolve billing mode
	let billingMode: ClaudeBillingMode = 'api';
	let billingModeSource: ResolvedPricingConfig['billingModeSource'] = 'default';

	if (agentConfig.billingMode !== 'auto') {
		billingMode = agentConfig.billingMode;
		billingModeSource = 'agent';
	} else if (folderId) {
		const folderConfig = getProjectFolderPricingConfig(folderId);
		if (folderConfig?.billingMode) {
			billingMode = folderConfig.billingMode;
			billingModeSource = 'folder';
		} else if (agentConfig.detectedBillingMode) {
			billingMode = agentConfig.detectedBillingMode;
			billingModeSource = 'detected';
		}
	} else if (agentConfig.detectedBillingMode) {
		billingMode = agentConfig.detectedBillingMode;
		billingModeSource = 'detected';
	}

	// Resolve model
	let modelId: ClaudeModelId = DEFAULT_MODEL_ID;
	let modelSource: ResolvedPricingConfig['modelSource'] = 'default';

	if (agentConfig.pricingModel !== 'auto') {
		modelId = agentConfig.pricingModel;
		modelSource = 'agent';
	} else if (agentConfig.detectedModel) {
		modelId = agentConfig.detectedModel;
		modelSource = 'detected';
	}

	return {
		billingMode,
		modelId,
		billingModeSource,
		modelSource,
	};
}
