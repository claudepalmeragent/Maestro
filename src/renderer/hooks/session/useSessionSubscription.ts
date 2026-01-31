/**
 * useSessionSubscription.ts
 *
 * Hook for subscribing to specific types of session changes.
 * Allows components to efficiently respond to only the changes they care about,
 * reducing unnecessary re-renders.
 *
 * @example
 * // Subscribe to log and status changes for a specific session
 * useSessionSubscription({
 *   sessionId: 'session-123',
 *   changeTypes: ['logs', 'status'],
 *   onUpdate: (changedTypes) => {
 *     console.log('Changed:', [...changedTypes]);
 *   },
 * });
 */

import { useEffect, useCallback, useRef } from 'react';
import { useSession } from '../../contexts/SessionContext';
import type { ChangeType, SubscriptionCallback } from './useBatchedSessionUpdates';

/**
 * Options for useSessionSubscription hook
 */
export interface SessionSubscriptionOptions {
	/** Session ID to subscribe to (omit to subscribe to all sessions) */
	sessionId?: string;
	/** Types of changes to listen for */
	changeTypes: ChangeType[];
	/** Callback when relevant changes occur */
	onUpdate: (changedTypes: Set<ChangeType>, sessionId: string) => void;
	/** Whether subscription is active (default: true) */
	enabled?: boolean;
}

/**
 * Hook to subscribe to specific types of session changes
 *
 * This hook provides fine-grained control over which session changes
 * trigger callbacks, allowing components to respond efficiently to
 * only the updates they care about.
 *
 * @param options - Subscription configuration
 *
 * @example
 * // Subscribe to usage updates for the active session
 * const { activeSessionId } = useSession();
 * useSessionSubscription({
 *   sessionId: activeSessionId,
 *   changeTypes: ['usage', 'contextUsage'],
 *   onUpdate: (changes) => {
 *     // Update local state or trigger side effects
 *     if (changes.has('usage')) {
 *       refreshUsageDisplay();
 *     }
 *   },
 * });
 *
 * @example
 * // Subscribe to all log changes across all sessions
 * useSessionSubscription({
 *   changeTypes: ['logs'],
 *   onUpdate: (changes, sessionId) => {
 *     console.log(`New logs in session ${sessionId}`);
 *   },
 * });
 */
export function useSessionSubscription(options: SessionSubscriptionOptions): void {
	const { sessionId, changeTypes, onUpdate, enabled = true } = options;
	const { batchedUpdater } = useSession();

	// Use refs to avoid recreating the subscription callback
	const sessionIdRef = useRef(sessionId);
	const changeTypesRef = useRef(changeTypes);
	const onUpdateRef = useRef(onUpdate);

	// Keep refs updated
	sessionIdRef.current = sessionId;
	changeTypesRef.current = changeTypes;
	onUpdateRef.current = onUpdate;

	// Memoized handler that filters changes
	const handleChanges = useCallback<SubscriptionCallback>((changes) => {
		const targetSessionId = sessionIdRef.current;
		const targetChangeTypes = changeTypesRef.current;
		const callback = onUpdateRef.current;

		// If sessionId is specified, only check that session
		if (targetSessionId) {
			const sessionChanges = changes.get(targetSessionId);
			if (!sessionChanges) return;

			// Filter to only the change types we care about
			const relevantChanges = new Set(
				[...sessionChanges].filter((c) => targetChangeTypes.includes(c))
			);

			if (relevantChanges.size > 0) {
				callback(relevantChanges, targetSessionId);
			}
		} else {
			// No sessionId specified - check all sessions
			for (const [sid, sessionChanges] of changes) {
				const relevantChanges = new Set(
					[...sessionChanges].filter((c) => targetChangeTypes.includes(c))
				);

				if (relevantChanges.size > 0) {
					callback(relevantChanges, sid);
				}
			}
		}
	}, []);

	// Subscribe to changes
	useEffect(() => {
		if (!enabled) return;

		const unsubscribe = batchedUpdater.subscribe(handleChanges);
		return unsubscribe;
	}, [batchedUpdater, handleChanges, enabled]);
}

/**
 * Hook to subscribe to log changes for a specific session
 *
 * Convenience wrapper around useSessionSubscription for the common
 * case of subscribing to log updates.
 *
 * @param sessionId - Session to subscribe to
 * @param onLogsUpdate - Callback when logs change
 * @param enabled - Whether subscription is active (default: true)
 *
 * @example
 * useSessionLogsSubscription('session-123', () => {
 *   // Scroll to bottom, update line count, etc.
 * });
 */
export function useSessionLogsSubscription(
	sessionId: string,
	onLogsUpdate: () => void,
	enabled: boolean = true
): void {
	useSessionSubscription({
		sessionId,
		changeTypes: ['logs'],
		onUpdate: onLogsUpdate,
		enabled,
	});
}

/**
 * Hook to subscribe to status changes for a specific session
 *
 * @param sessionId - Session to subscribe to
 * @param onStatusChange - Callback with new status when it changes
 * @param enabled - Whether subscription is active (default: true)
 *
 * @example
 * useSessionStatusSubscription('session-123', () => {
 *   // Update UI state, notifications, etc.
 * });
 */
export function useSessionStatusSubscription(
	sessionId: string,
	onStatusChange: () => void,
	enabled: boolean = true
): void {
	useSessionSubscription({
		sessionId,
		changeTypes: ['status', 'tabStatus'],
		onUpdate: onStatusChange,
		enabled,
	});
}

/**
 * Hook to subscribe to usage/cost updates for a specific session
 *
 * @param sessionId - Session to subscribe to
 * @param onUsageUpdate - Callback when usage stats change
 * @param enabled - Whether subscription is active (default: true)
 *
 * @example
 * useSessionUsageSubscription('session-123', () => {
 *   // Refresh cost display, update progress bar, etc.
 * });
 */
export function useSessionUsageSubscription(
	sessionId: string,
	onUsageUpdate: () => void,
	enabled: boolean = true
): void {
	useSessionSubscription({
		sessionId,
		changeTypes: ['usage', 'contextUsage'],
		onUpdate: onUsageUpdate,
		enabled,
	});
}
