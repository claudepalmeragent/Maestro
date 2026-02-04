/**
 * useDocumentPolling - Periodically re-reads Auto Run document during task execution
 *
 * This hook provides document polling functionality to detect partial checkbox
 * completion during long-running tasks. It re-reads the document at regular
 * intervals and updates progress counts if changes are detected.
 *
 * Key features:
 * - Automatic start/stop based on task processing state
 * - Configurable polling interval (different defaults for local vs SSH)
 * - Progress change detection to minimize unnecessary updates
 * - Uses existing IPC APIs for file reading (supports SSH remotes)
 */

import { useCallback, useRef, useEffect } from 'react';
import { countCheckedTasks, countUnfinishedTasks } from './batchUtils';

// Default polling intervals
const DEFAULT_LOCAL_POLL_INTERVAL_MS = 10000; // 10 seconds for local
const DEFAULT_SSH_POLL_INTERVAL_MS = 15000; // 15 seconds for SSH (reduce traffic)

/**
 * Props for the useDocumentPolling hook
 */
export interface UseDocumentPollingProps {
	/** Whether polling is enabled */
	enabled: boolean;
	/** Whether a task is currently being processed */
	isProcessingTask: boolean;
	/** Folder path containing the document */
	folderPath: string;
	/** Current document filename */
	documentFilename: string;
	/** SSH remote ID if applicable */
	sshRemoteId?: string;
	/** Custom polling interval (uses defaults if not specified) */
	pollingIntervalMs?: number;
	/** Callback when progress changes are detected */
	onProgressUpdate: (checkedCount: number, uncheckedCount: number) => void;
}

/**
 * Return type for the useDocumentPolling hook
 */
export interface UseDocumentPollingReturn {
	/** Start polling for the current document */
	startPolling: () => void;
	/** Stop polling */
	stopPolling: () => void;
	/** Force an immediate poll */
	pollNow: () => Promise<void>;
	/** Whether polling is currently active */
	isPolling: boolean;
}

/**
 * Hook for polling Auto Run documents during task execution to detect progress changes.
 *
 * This hook is designed to catch incremental checkbox completion during long-running
 * agent tasks. It periodically re-reads the document and calls onProgressUpdate
 * when the number of checked tasks changes.
 *
 * Memory safety guarantees:
 * - Polling interval is cleared on unmount
 * - isPollingRef prevents stale callbacks from triggering updates
 * - Cleanup effect handles component unmount gracefully
 */
export function useDocumentPolling({
	enabled,
	isProcessingTask,
	folderPath,
	documentFilename,
	sshRemoteId,
	pollingIntervalMs,
	onProgressUpdate,
}: UseDocumentPollingProps): UseDocumentPollingReturn {
	const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const isPollingRef = useRef(false);
	const lastCheckedCountRef = useRef<number | null>(null);

	// Determine polling interval based on environment
	const effectiveInterval =
		pollingIntervalMs ??
		(sshRemoteId ? DEFAULT_SSH_POLL_INTERVAL_MS : DEFAULT_LOCAL_POLL_INTERVAL_MS);

	// Read document and count tasks using existing IPC API
	const readAndCountTasks = useCallback(async () => {
		if (!folderPath || !documentFilename) {
			return null;
		}

		try {
			// Use window.maestro.autorun.readDoc which supports SSH remotes
			// The filename may or may not have .md extension - readDoc handles both
			const result = await window.maestro.autorun.readDoc(
				folderPath,
				documentFilename,
				sshRemoteId
			);

			if (!result.success || !result.content) {
				return null;
			}

			const checkedCount = countCheckedTasks(result.content);
			const uncheckedCount = countUnfinishedTasks(result.content);

			return { checkedCount, uncheckedCount };
		} catch (error) {
			console.warn('[useDocumentPolling] Error reading document:', error);
			return null;
		}
	}, [folderPath, documentFilename, sshRemoteId]);

	// Poll function
	const pollDocument = useCallback(async () => {
		if (!isPollingRef.current) {
			return;
		}

		const result = await readAndCountTasks();
		if (!result) {
			return;
		}

		const { checkedCount, uncheckedCount } = result;

		// Only trigger update if checked count has changed
		if (lastCheckedCountRef.current !== null && checkedCount !== lastCheckedCountRef.current) {
			console.log(
				`[useDocumentPolling] Progress change detected: ${lastCheckedCountRef.current} -> ${checkedCount}`
			);
			onProgressUpdate(checkedCount, uncheckedCount);
		}

		lastCheckedCountRef.current = checkedCount;
	}, [readAndCountTasks, onProgressUpdate]);

	// Start polling
	const startPolling = useCallback(() => {
		if (pollingIntervalRef.current) {
			return; // Already polling
		}

		isPollingRef.current = true;
		lastCheckedCountRef.current = null; // Reset baseline

		// Do an initial poll to establish baseline
		pollDocument();

		// Set up interval
		pollingIntervalRef.current = setInterval(pollDocument, effectiveInterval);

		console.log(
			`[useDocumentPolling] Started polling every ${effectiveInterval}ms for ${documentFilename}`
		);
	}, [pollDocument, effectiveInterval, documentFilename]);

	// Stop polling
	const stopPolling = useCallback(() => {
		if (pollingIntervalRef.current) {
			clearInterval(pollingIntervalRef.current);
			pollingIntervalRef.current = null;
		}
		isPollingRef.current = false;
		lastCheckedCountRef.current = null;

		console.log('[useDocumentPolling] Stopped polling');
	}, []);

	// Poll now (force immediate poll)
	const pollNow = useCallback(async () => {
		await pollDocument();
	}, [pollDocument]);

	// Auto-start/stop polling based on task processing state
	useEffect(() => {
		if (enabled && isProcessingTask) {
			startPolling();
		} else {
			stopPolling();
		}

		return () => {
			stopPolling();
		};
	}, [enabled, isProcessingTask, startPolling, stopPolling]);

	return {
		startPolling,
		stopPolling,
		pollNow,
		isPolling: isPollingRef.current,
	};
}

// Export default polling intervals for use in configuration
export { DEFAULT_LOCAL_POLL_INTERVAL_MS, DEFAULT_SSH_POLL_INTERVAL_MS };
