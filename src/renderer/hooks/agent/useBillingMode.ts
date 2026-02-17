/**
 * useBillingMode Hook
 *
 * Provides the resolved billing mode for an agent.
 * Used by cost display components to show "(incl. in Max sub.)" suffix
 * and provide appropriate tooltips.
 *
 * @module hooks/agent/useBillingMode
 */

import { useState, useEffect } from 'react';
import type { ClaudeBillingMode } from '../../../shared/types';

export type BillingModeValue = ClaudeBillingMode | 'auto';

export interface UseBillingModeResult {
	/** The current billing mode ('api', 'max', or 'auto') */
	billingMode: BillingModeValue;
	/** The resolved billing mode (never 'auto' - resolved to 'api' or 'max') */
	resolvedBillingMode: ClaudeBillingMode;
	/** The detected billing mode from credentials (if available) */
	detectedBillingMode?: ClaudeBillingMode;
	/** Whether billing mode is still loading */
	loading: boolean;
	/** Whether this agent is a Max subscriber */
	isMaxSubscriber: boolean;
	/** Error message if fetching billing mode failed */
	error?: string;
}

/**
 * Hook to get the billing mode for an agent.
 * Fetches the pricing config from the main process and resolves the effective billing mode.
 *
 * @param agentId - The agent ID (toolType) to get billing mode for
 * @returns The billing mode information
 */
export function useBillingMode(agentId: string | undefined): UseBillingModeResult {
	const [billingMode, setBillingMode] = useState<BillingModeValue>('auto');
	const [detectedBillingMode, setDetectedBillingMode] = useState<ClaudeBillingMode | undefined>();
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | undefined>();

	useEffect(() => {
		if (!agentId) {
			setLoading(false);
			return;
		}

		// Normalize legacy 'claude' toolType to 'claude-code'
		const normalizedAgentId = agentId === 'claude' ? 'claude-code' : agentId;

		// Only fetch billing mode for Claude agents
		if (normalizedAgentId !== 'claude-code') {
			setBillingMode('api');
			setLoading(false);
			return;
		}

		let cancelled = false;

		const fetchBillingMode = async () => {
			setError(undefined);
			try {
				const pricingConfig = await window.maestro.agents.getPricingConfig(normalizedAgentId);

				if (cancelled) return;

				// Set the configured billing mode
				setBillingMode(pricingConfig?.billingMode || 'auto');

				// Set the detected billing mode from the cached value in the config store
				if (pricingConfig?.detectedBillingMode) {
					setDetectedBillingMode(pricingConfig.detectedBillingMode);
				}
			} catch (err) {
				if (cancelled) return;
				const errorMessage = err instanceof Error ? err.message : 'Failed to fetch billing mode';
				console.error('Failed to fetch billing mode:', err);
				setError(errorMessage);
				setBillingMode('auto');
				setDetectedBillingMode(undefined);
			} finally {
				if (!cancelled) {
					setLoading(false);
				}
			}
		};

		fetchBillingMode();

		return () => {
			cancelled = true;
		};
	}, [agentId]);

	// Resolve the effective billing mode
	// If set to 'auto', use the detected mode; otherwise use the configured mode
	const resolvedBillingMode: ClaudeBillingMode =
		billingMode === 'auto' ? detectedBillingMode || 'api' : billingMode;

	return {
		billingMode,
		resolvedBillingMode,
		detectedBillingMode,
		loading,
		isMaxSubscriber: resolvedBillingMode === 'max',
		error,
	};
}

/**
 * Simple utility to resolve billing mode synchronously when you already have the config.
 * Used by components that fetch pricing config separately.
 *
 * @param billingMode - The configured billing mode ('auto', 'max', or 'api')
 * @param detectedBillingMode - The detected billing mode from credentials
 * @returns The resolved billing mode ('max' or 'api')
 */
export function resolveBillingModeSync(
	billingMode: BillingModeValue,
	detectedBillingMode?: ClaudeBillingMode
): ClaudeBillingMode {
	if (billingMode === 'auto') {
		return detectedBillingMode || 'api';
	}
	return billingMode;
}
