import { useCallback, useRef, useEffect, useMemo, useState } from 'react';
import type {
	BatchRunState,
	BatchRunConfig,
	Session,
	HistoryEntry,
	UsageStats,
	Group,
	AutoRunStats,
	AgentError,
} from '../../types';
import type { CapacityCheckModalData } from '../../components/CapacityCheckModal';
// Extracted batch processing modules
import { countUnfinishedTasks, uncheckAllTasks } from './batchUtils';
import { useBatchStore } from '../../stores/batchStore';
import { useTimeTracking } from './useTimeTracking';
import { useWorktreeManager } from './useWorktreeManager';
import { useDocumentProcessor } from './useDocumentProcessor';
import { useSubagentStatsPoller } from './useSubagentStatsPoller';
import type { AgentSpawnErrorKind } from '../agent/useAgentExecution';
// Decomposed internal hooks (see ./internal/)
import type { BatchAction } from './batchReducer';
import { type AutoRunFlushState } from './internal/batchFlushState';
import { useBatchSelectors } from './internal/useBatchSelectors';
import { useBatchBroadcast } from './internal/useBatchBroadcast';
import {
	useBatchControlActions,
	type ErrorResolutionEntry,
} from './internal/useBatchControlActions';
import { useBatchKillAction } from './internal/useBatchKillAction';
import { useBatchRunner } from './internal/useBatchRunner';

export interface BatchCompleteInfo {
	sessionId: string;
	sessionName: string;
	completedTasks: number;
	totalTasks: number;
	wasStopped: boolean;
	elapsedTimeMs: number;
	/** Total input tokens consumed across all tasks */
	inputTokens: number;
	/** Total output tokens consumed across all tasks */
	outputTokens: number;
	/** Total estimated cost in USD across all tasks */
	totalCostUsd: number;
	/** Number of documents processed */
	documentsProcessed: number;
}

export interface PRResultInfo {
	sessionId: string;
	sessionName: string;
	success: boolean;
	prUrl?: string;
	error?: string;
}

interface UseBatchProcessorProps {
	sessions: Session[];
	groups: Group[];
	onUpdateSession: (sessionId: string, updates: Partial<Session>) => void;
	onSpawnAgent: (
		sessionId: string,
		prompt: string,
		cwdOverride?: string,
		callbacks?: {
			onData?: (bytes: number) => void;
			onUsage?: (tokens: number) => void;
		}
	) => Promise<{
		success: boolean;
		response?: string;
		agentSessionId?: string;
		usageStats?: UsageStats;
		contextUsage?: number;
		error?: string;
		errorKind?: AgentSpawnErrorKind;
	}>;
	onAddHistoryEntry: (entry: Omit<HistoryEntry, 'id'>) => void | Promise<void>;
	onComplete?: (info: BatchCompleteInfo) => void;
	// Callback for PR creation results (success or failure)
	onPRResult?: (info: PRResultInfo) => void;
	// TTS settings for speaking synopsis after each task
	audioFeedbackEnabled?: boolean;
	audioFeedbackCommand?: string;
	// Auto Run stats for achievement progress in final summary
	autoRunStats?: AutoRunStats;
	// Callback to process queued items after batch completion/stop
	// This ensures pending user messages are processed after Auto Run ends
	onProcessQueueAfterCompletion?: (sessionId: string) => void;
}

interface UseBatchProcessorReturn {
	// Map of session ID to batch state
	batchRunStates: Record<string, BatchRunState>;
	// Get batch state for a specific session
	getBatchState: (sessionId: string) => BatchRunState;
	// Check if any session has an active batch
	hasAnyActiveBatch: boolean;
	// Get list of session IDs with active batches
	activeBatchSessionIds: string[];
	// Get list of session IDs that are in stopping state
	stoppingBatchSessionIds: string[];
	// Start batch run for a specific session with multi-document support
	startBatchRun: (sessionId: string, config: BatchRunConfig, folderPath: string) => Promise<void>;
	// Stop batch run for a specific session
	stopBatchRun: (sessionId: string) => void;
	// Force kill the running process and immediately end the batch run
	killBatchRun: (sessionId: string) => Promise<void>;
	// Custom prompts per session
	customPrompts: Record<string, string>;
	setCustomPrompt: (sessionId: string, prompt: string) => void;
	// Error handling (Phase 5.10)
	pauseBatchOnError: (
		sessionId: string,
		error: AgentError,
		documentIndex: number,
		taskDescription?: string
	) => void;
	skipCurrentDocument: (sessionId: string) => void;
	resumeAfterError: (sessionId: string) => void;
	abortBatchOnError: (sessionId: string) => void;
	// Subagent tracking (Progress Enhancement)
	setSubagentActive: (sessionId: string, subagentType: string) => void;
	clearSubagentActive: (sessionId: string) => void;
	// Capacity check (Pre-run gate)
	capacityCheckData: CapacityCheckModalData | null;
	onCapacityCancel: () => void;
	onCapacityRunAnyway: () => void;
}

// Re-export utility functions for backwards compatibility
// (countUnfinishedTasks and uncheckAllTasks are imported from ./batch/batchUtils)
export { countUnfinishedTasks, uncheckAllTasks };

/**
 * Hook for managing batch processing of scratchpad tasks across multiple sessions
 *
 * Memory safety guarantees:
 * - All error resolution promises are rejected with 'abort' on unmount
 * - stopRequestedRefs are cleared when batches complete normally
 * - isMountedRef check prevents all state updates after unmount
 * - Extracted hooks (useSessionDebounce, useTimeTracking) handle their own cleanup
 */
export function useBatchProcessor({
	sessions,
	groups,
	onUpdateSession,
	onSpawnAgent,
	onAddHistoryEntry,
	onComplete,
	onPRResult,
	audioFeedbackEnabled,
	audioFeedbackCommand,
	autoRunStats,
	onProcessQueueAfterCompletion,
}: UseBatchProcessorProps): UseBatchProcessorReturn {
	// Reactive selectors over the batch store
	const {
		batchRunStates,
		getBatchState,
		hasAnyActiveBatch,
		activeBatchSessionIds,
		stoppingBatchSessionIds,
		customPrompts,
		setCustomPrompt,
	} = useBatchSelectors();
	// Ref-mirror of batchRunStates for synchronous access from subagent stats poller
	// (fork feature: subagent stats updates dispatch against the latest snapshot
	// without needing to re-subscribe).
	const batchRunStatesRef = useRef(batchRunStates);
	batchRunStatesRef.current = batchRunStates;

	// Dispatch batch actions through the store. The store applies batchReducer
	// synchronously, eliminating the need for manual ref syncing.
	const dispatch = useCallback((action: BatchAction) => {
		useBatchStore.getState().dispatchBatch(action);
	}, []);

	// Capacity check state (fork feature: pre-run capacity gate via Honeycomb)
	const [capacityCheckData, setCapacityCheckData] = useState<CapacityCheckModalData | null>(null);
	const [pendingBatchStart, setPendingBatchStart] = useState<{
		sessionId: string;
		config: BatchRunConfig;
		folderPath: string;
	} | null>(null);

	// Refs for tracking stop requests per session
	const stopRequestedRefs = useRef<Record<string, boolean>>({});

	// Ref to always have access to latest sessions (fixes stale closure in startBatchRun)
	const sessionsRef = useRef(sessions);
	sessionsRef.current = sessions;

	// Refs to always have access to latest audio feedback settings (fixes stale closure during batch run)
	// Without refs, toggling settings off during a batch run won't take effect until the next run
	const audioFeedbackEnabledRef = useRef(audioFeedbackEnabled);
	audioFeedbackEnabledRef.current = audioFeedbackEnabled;
	const audioFeedbackCommandRef = useRef(audioFeedbackCommand);
	audioFeedbackCommandRef.current = audioFeedbackCommand;

	// Ref to track latest updateBatchStateAndBroadcast for async callbacks (fixes HMR stale closure)
	const updateBatchStateAndBroadcastRef = useRef<typeof updateBatchStateAndBroadcast | null>(null);

	// Error resolution promises to pause batch processing until user action (per session)
	const errorResolutionRefs = useRef<Record<string, ErrorResolutionEntry>>({});

	// Per-session state for emergency stats/history flush on force-kill.
	// Whoever deletes the entry first (the loop's normal cleanup, or killBatchRun) is
	// responsible for writing the final history + endAutoRun. This guards against the
	// case where killBatchRun calls timeTracking.stopTracking (which zeros the tracker)
	// before the loop's cleanup reads it, resulting in a 0ms duration being recorded.
	const autoRunFlushStateRefs = useRef<Record<string, AutoRunFlushState>>({});

	// Track whether the component is still mounted to prevent state updates after unmount
	const isMountedRef = useRef(false);

	// Mount/unmount effect: set isMountedRef on mount, clear on unmount
	// This handles React 18 StrictMode double-render and ensures ref is always correct
	useEffect(() => {
		isMountedRef.current = true;
		return () => {
			isMountedRef.current = false;

			// Reject all pending error resolution promises with 'abort' to unblock any waiting async code
			// This prevents memory leaks from promises that would never resolve
			Object.entries(errorResolutionRefs.current).forEach(([, entry]) => {
				entry.resolve('abort');
			});
			// Clear the refs to allow garbage collection
			errorResolutionRefs.current = {};

			// Clear stop requested refs (though they should already be cleaned up per-session)
			stopRequestedRefs.current = {};

			// Drop any outstanding Auto Run flush state — nothing to flush against after unmount.
			autoRunFlushStateRefs.current = {};
		};
	}, []);

	// Web/mobile bridge: synchronous broadcast + debounced state-update wrapper
	const { broadcastAutoRunState, updateBatchStateAndBroadcast, flushDebouncedUpdate } =
		useBatchBroadcast({ dispatch });

	// External lifecycle controls (stop + pause/skip/resume/abort)
	const {
		stopBatchRun,
		pauseBatchOnError,
		skipCurrentDocument,
		resumeAfterError,
		abortBatchOnError,
	} = useBatchControlActions({
		broadcastAutoRunState,
		dispatch,
		errorResolutionRefs,
		stopRequestedRefs,
		isMountedRef,
	});

	// Use extracted time tracking hook (replaces manual visibility-based time tracking)
	const timeTracking = useTimeTracking({
		getActiveSessionIds: useCallback(() => {
			return Object.entries(useBatchStore.getState().batchRunStates)
				.filter(([, state]) => state.isRunning && !state.errorPaused)
				.map(([sessionId]) => sessionId);
		}, []),
		onTimeUpdate: useCallback(
			(sessionId: string, accumulatedMs: number, activeTimestamp: number | null) => {
				// Update batch state with new time tracking values
				dispatch({
					type: 'UPDATE_PROGRESS',
					sessionId,
					payload: {
						accumulatedElapsedMs: accumulatedMs,
						lastActiveTimestamp: activeTimestamp ?? undefined,
					},
				});
			},
			[]
		),
	});

	// Force-kill action with kill-vs-natural-completion arbitration.
	// Must follow `useTimeTracking` because it captures elapsed time from the
	// live tracker before tearing it down.
	const { killBatchRun } = useBatchKillAction({
		broadcastAutoRunState,
		flushDebouncedUpdate,
		dispatch,
		timeTracking,
		autoRunFlushStateRefs,
		errorResolutionRefs,
		stopRequestedRefs,
		isMountedRef,
		onAddHistoryEntry,
		onComplete,
	});

	// Use extracted worktree manager hook for git worktree operations
	const worktreeManager = useWorktreeManager();

	// Use extracted document processor hook for document processing
	const documentProcessor = useDocumentProcessor();

	// Callback for subagent stats updates (Phase 3)
	// This is called by useSubagentStatsPoller when new subagent token stats are available
	const handleSubagentStats = useCallback(
		(stats: {
			inputTokens: number;
			outputTokens: number;
			cacheReadTokens: number;
			cacheCreationTokens: number;
			cost: number;
		}) => {
			// Get the first active batch session to update
			const activeSessionId = Object.entries(batchRunStatesRef.current).find(
				([, state]) => state.isRunning
			)?.[0];
			if (activeSessionId) {
				dispatch({
					type: 'UPDATE_SUBAGENT_TOKENS',
					sessionId: activeSessionId,
					payload: stats,
				});
			}
		},
		[]
	);

	// Compute subagent polling parameters from first active batch session (Phase 3)
	// We need to poll subagent stats during Auto Run to show token usage from spawned subagents
	const subagentPollingParams = useMemo(() => {
		// Find the first active batch session
		const activeEntry = Object.entries(batchRunStates).find(([, state]) => state.isRunning);
		if (!activeEntry) {
			return {
				agentId: 'claude-code',
				projectPath: '',
				sessionIds: [] as string[],
				isRunning: false,
				sshRemoteId: undefined,
			};
		}

		const [maestroSessionId, batchState] = activeEntry;
		// Find the corresponding session from the sessions prop
		const session = sessions.find((s) => s.id === maestroSessionId);

		// Get ALL agent session IDs to poll for cumulative subagent stats across all tasks
		const agentSessionIds = batchState.sessionIds || [];

		return {
			agentId: session?.toolType || 'claude-code',
			projectPath: session?.cwd || '',
			sessionIds: agentSessionIds,
			isRunning: batchState.isRunning && !batchState.errorPaused,
			sshRemoteId: session?.sshRemoteId || session?.sessionSshRemoteConfig?.remoteId || undefined,
		};
	}, [batchRunStates, sessions]);

	// Poll for subagent stats during Auto Run (Phase 3)
	// This periodically checks for token usage from spawned subagents (Explore, Plan, Bash, etc.)
	// Polls ALL session IDs to get cumulative subagent stats across all tasks in the batch
	useSubagentStatsPoller({
		agentId: subagentPollingParams.agentId,
		projectPath: subagentPollingParams.projectPath,
		sessionIds: subagentPollingParams.sessionIds,
		isRunning: subagentPollingParams.isRunning,
		pollIntervalMs: 5000, // Poll every 5 seconds
		sshRemoteId: subagentPollingParams.sshRemoteId,
		onStats: handleSubagentStats,
	});

	// Update ref to always have latest updateBatchStateAndBroadcast (fixes HMR stale closure
	// in long-running async loops; safe across module boundaries because Vite invalidates
	// per-module — keeping the ref in the coordinator is intentional).
	updateBatchStateAndBroadcastRef.current = updateBatchStateAndBroadcast;

	// Auto Run orchestrator (the main `startBatchRun` callback)
	const { startBatchRun: startBatchRunInternal } = useBatchRunner({
		sessionsRef,
		audioFeedbackEnabledRef,
		audioFeedbackCommandRef,
		autoRunFlushStateRefs,
		errorResolutionRefs,
		stopRequestedRefs,
		isMountedRef,
		updateBatchStateAndBroadcastRef,
		broadcastAutoRunState,
		flushDebouncedUpdate,
		dispatch,
		pauseBatchOnError,
		timeTracking,
		worktreeManager,
		documentProcessor,
		groups,
		autoRunStats,
		onUpdateSession,
		onSpawnAgent,
		onAddHistoryEntry,
		onComplete,
		onPRResult,
		onProcessQueueAfterCompletion,
	});

	/**
	 * Public startBatchRun with pre-run capacity check gate (fork feature).
	 * Wraps the upstream `useBatchRunner` startBatchRun so users hit the Honeycomb
	 * capacity-check modal before any long-running Auto Run kicks off.
	 */
	const startBatchRun = useCallback(
		async (sessionId: string, config: BatchRunConfig, folderPath: string) => {
			// Pre-run capacity check
			try {
				const settings = (await window.maestro.settings.getAll()) as Record<string, unknown>;
				const warningSettings = (settings.honeycombWarningSettings || {}) as Record<
					string,
					unknown
				>;
				const isAutoRun = true; // This is the batch/Auto Run path
				const shouldCheck = isAutoRun
					? (warningSettings.capacityCheckAutoRun ?? true)
					: (warningSettings.capacityCheckInteractive ?? true);

				if (shouldCheck) {
					console.log('[BatchProcessor] Running pre-run capacity check...');
					const result = (await window.maestro.honeycomb.capacityCheck({
						description: config.documents.map((d) => d.filename).join(', '),
						estimatedTokens: null,
						isAutoRun,
					})) as any;

					if (result && !result.canProceed) {
						// Show the capacity check modal and pause
						setCapacityCheckData({
							reason: result.reason || 'both',
							fiveHourPct: result.currentUsage?.fiveHour?.asPercentOfBudget ?? 0,
							weeklyPct: result.currentUsage?.weekly?.asPercentOfBudget ?? 0,
							taskComplexity: result.taskComplexity || 'MEDIUM',
							estimatedTaskPct: result.estimatedTaskPct || 20,
							safetyBufferPct: result.safetyBufferPct || 20,
						});
						setPendingBatchStart({ sessionId, config, folderPath });
						return; // Don't proceed, wait for user decision
					}
				} else {
					console.log('[BatchProcessor] Capacity check disabled in settings, skipping');
				}
			} catch (err) {
				// If capacity check fails, log and proceed anyway
				window.maestro.logger.log('warn', 'Capacity check failed, proceeding', 'BatchProcessor', {
					error: String(err),
				});
			}

			startBatchRunInternal(sessionId, config, folderPath);
		},
		[startBatchRunInternal]
	);

	const handleCapacityCancel = useCallback(() => {
		setCapacityCheckData(null);
		setPendingBatchStart(null);
	}, []);

	const handleCapacityRunAnyway = useCallback(() => {
		const pending = pendingBatchStart;
		setCapacityCheckData(null);
		setPendingBatchStart(null);
		if (pending) {
			startBatchRunInternal(pending.sessionId, pending.config, pending.folderPath);
		}
	}, [pendingBatchStart, startBatchRunInternal]);

	/**
	 * Set subagent as active (Task tool invocation detected)
	 * Called when the Task tool is detected in agent output stream
	 */
	const setSubagentActive = useCallback((sessionId: string, subagentType: string) => {
		if (!isMountedRef.current) return;

		// Only update if batch is running for this session
		const currentState = batchRunStatesRef.current[sessionId];
		if (!currentState?.isRunning) return;

		dispatch({
			type: 'SET_SUBAGENT_ACTIVE',
			sessionId,
			payload: {
				subagentType,
				startTime: Date.now(),
			},
		});
	}, []);

	/**
	 * Clear subagent active state (Task completed)
	 * Called when agent result is received
	 */
	const clearSubagentActive = useCallback((sessionId: string) => {
		if (!isMountedRef.current) return;

		// Only update if batch is running for this session
		const currentState = batchRunStatesRef.current[sessionId];
		if (!currentState?.isRunning) return;

		dispatch({
			type: 'CLEAR_SUBAGENT_ACTIVE',
			sessionId,
		});
	}, []);

	return {
		batchRunStates,
		getBatchState,
		hasAnyActiveBatch,
		activeBatchSessionIds,
		stoppingBatchSessionIds,
		startBatchRun,
		stopBatchRun,
		killBatchRun,
		customPrompts,
		setCustomPrompt,
		// Error handling (Phase 5.10)
		pauseBatchOnError,
		skipCurrentDocument,
		resumeAfterError,
		abortBatchOnError,
		// Subagent tracking (Progress Enhancement)
		setSubagentActive,
		clearSubagentActive,
		// Capacity check (Pre-run gate)
		capacityCheckData,
		onCapacityCancel: handleCapacityCancel,
		onCapacityRunAnyway: handleCapacityRunAnyway,
	};
}
