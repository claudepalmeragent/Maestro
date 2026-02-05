# Phase 1: Basic Token Display for Auto Run Pill

> **Feature:** Auto Run Throughput Status Pill
> **Phase:** 1 of 4
> **Scope:** Add real-time token count and throughput display to the Auto Run pill

---

## Overview

This phase adds the foundational token tracking infrastructure to `BatchRunState` and wires up the Auto Run pill to display real-time token statistics during task execution.

---

## Task 1.1: Add Token Tracking Fields to BatchRunState

Add the necessary fields to track token statistics during Auto Run execution.

- [ ] In `src/renderer/types/index.ts`, add the following fields to the `BatchRunState` interface after the `pollIntervalMs` field (around line 339):
  ```typescript
  // Token tracking for current task (Phase 1)
  currentTaskBytes?: number;        // Bytes received in current task (for estimation)
  currentTaskTokens?: number;       // Actual tokens from onUsage event
  currentTaskStartTime?: number;    // Start time for throughput calculation
  ```

---

## Task 1.2: Add Token Tracking Actions to Batch Reducer

Add reducer actions to handle token updates during Auto Run task execution.

- [ ] In `src/renderer/hooks/batch/batchReducer.ts`, add the following action types to the `BatchAction` type union (find the existing action types and add these):
  ```typescript
  | { type: 'UPDATE_TASK_BYTES'; payload: { bytes: number } }
  | { type: 'UPDATE_TASK_TOKENS'; payload: { tokens: number } }
  | { type: 'RESET_TASK_METRICS' }
  ```
  Then add the corresponding case handlers in the reducer function:
  ```typescript
  case 'UPDATE_TASK_BYTES':
    return {
      ...state,
      currentTaskBytes: (state.currentTaskBytes || 0) + action.payload.bytes,
    };

  case 'UPDATE_TASK_TOKENS':
    return {
      ...state,
      currentTaskTokens: (state.currentTaskTokens || 0) + action.payload.tokens,
    };

  case 'RESET_TASK_METRICS':
    return {
      ...state,
      currentTaskBytes: 0,
      currentTaskTokens: 0,
      currentTaskStartTime: Date.now(),
    };
  ```

---

## Task 1.3: Wire Up Token Updates in Batch Processor

Modify the batch processor to capture and dispatch token updates during task execution.

- [ ] In `src/renderer/hooks/batch/useBatchProcessor.ts`, find the section where `processTask` is called (around line 1077 where `callbacks.onSpawnAgent` is passed). Before calling `processTask`, dispatch `RESET_TASK_METRICS` to reset counters:
  ```typescript
  // Reset task metrics before starting new task
  dispatch({ type: 'RESET_TASK_METRICS' });
  ```
  Then, in the `onSpawnAgent` callback wrapper or in the task processing loop, set up listeners for the batch session's data and usage events. The batch processor spawns agents with a unique session ID format: `${sessionId}-batch-${timestamp}`. We need to listen for events from this session ID and dispatch updates. Find where `spawnAgentForSession` is called and add event listeners that dispatch to the reducer:
  ```typescript
  // In useBatchProcessor.ts, create a wrapper around onSpawnAgent that tracks metrics
  // The spawnAgentForSession already captures these internally, but we need real-time updates
  // Add listeners before spawning:
  const batchSessionId = `${session.id}-batch-${Date.now()}`;

  const unsubData = window.maestro.process.onData((sid, data) => {
    if (sid === batchSessionId) {
      dispatch({ type: 'UPDATE_TASK_BYTES', payload: { bytes: data.length } });
    }
  });

  const unsubUsage = window.maestro.process.onUsage((sid, usageStats) => {
    if (sid === batchSessionId) {
      dispatch({ type: 'UPDATE_TASK_TOKENS', payload: { tokens: usageStats.outputTokens } });
    }
  });
  ```
  Note: This may require refactoring how `onSpawnAgent` works to expose the session ID before spawning. Alternatively, pass a callback to receive real-time updates. Review the existing code structure and implement the cleanest solution.

---

## Task 1.4: Update ThroughputDisplay Component for Placeholder Support

Modify the ThroughputDisplay component to support showing a placeholder when waiting for data.

- [ ] In `src/renderer/components/ThinkingStatusPill.tsx`, update the `ThroughputDisplay` component (around line 77) to accept a new `showPlaceholder` prop and render a greyed placeholder when appropriate:
  ```typescript
  const ThroughputDisplay = memo(
    ({
      tokens,
      startTime,
      textColor,
      accentColor,
      showPlaceholder = false,  // New prop
    }: {
      tokens: number;
      startTime: number;
      textColor: string;
      accentColor: string;
      showPlaceholder?: boolean;  // New prop type
    }) => {
      const [throughput, setThroughput] = useState<number>(0);

      useEffect(() => {
        const updateThroughput = () => {
          const elapsedMs = Date.now() - startTime;
          if (elapsedMs > 0 && tokens > 0) {
            const tokPerSec = tokens / (elapsedMs / 1000);
            setThroughput(tokPerSec);
          }
        };

        updateThroughput();
        const interval = setInterval(updateThroughput, 500);
        return () => clearInterval(interval);
      }, [tokens, startTime]);

      // Show placeholder if requested and no throughput yet
      if (showPlaceholder && throughput === 0) {
        return (
          <span className="font-mono text-xs" style={{ color: textColor, opacity: 0.4 }}>
            — tok/s
          </span>
        );
      }

      if (throughput === 0) return null;

      return (
        <span className="font-mono text-xs font-medium" style={{ color: accentColor }}>
          {throughput.toFixed(1)} tok/s
        </span>
      );
    }
  );
  ```

---

## Task 1.5: Update AutoRunPill to Display Token Statistics

Add token count and throughput display to the AutoRunPill component.

- [ ] In `src/renderer/components/ThinkingStatusPill.tsx`, update the `AutoRunPill` component (around line 222) to display token statistics. First, add the import for `formatTokensCompact` if not already imported (it should be at the top). Then, inside the AutoRunPill component, add the token display section after the task progress section (after the "Tasks: X/Y" div). Use the `BYTES_PER_TOKEN_ESTIMATE` constant already defined at the top of the file:
  ```typescript
  // Inside AutoRunPill, after destructuring autoRunState, calculate display values:
  const currentBytes = autoRunState.currentTaskBytes || 0;
  const currentTokens = autoRunState.currentTaskTokens || 0;
  const taskStartTime = autoRunState.currentTaskStartTime || autoRunState.startTime || Date.now();

  // Estimate tokens from bytes when actual count unavailable
  const estimatedTokens = currentBytes > 0
    ? Math.floor(currentBytes / BYTES_PER_TOKEN_ESTIMATE)
    : 0;
  const displayTokens = currentTokens > 0 ? currentTokens : estimatedTokens;
  const isEstimated = currentTokens === 0 && displayTokens > 0;
  const isWaiting = displayTokens === 0;

  // Then in the JSX, after the task progress div and before the subagent indicator,
  // add a divider and the token stats section:

  {/* Divider */}
  <div className="w-px h-4 shrink-0" style={{ backgroundColor: theme.colors.border }} />

  {/* Token statistics */}
  <div
    className="flex items-center gap-1 shrink-0 text-xs"
    style={{
      color: isWaiting ? theme.colors.textDim : theme.colors.textMain,
      opacity: isWaiting ? 0.4 : 1
    }}
    title={isWaiting ? "Token statistics will appear when data arrives" : undefined}
  >
    <span style={{ color: theme.colors.textDim }}>
      Tokens{isEstimated ? '~' : ''}:
    </span>
    <span className="font-medium">
      {isWaiting ? '—' : formatTokensCompact(displayTokens)}
    </span>
    <span style={{ color: theme.colors.border }}>|</span>
    <ThroughputDisplay
      tokens={displayTokens}
      startTime={taskStartTime}
      textColor={theme.colors.textDim}
      accentColor={theme.colors.accent}
      showPlaceholder={isWaiting}
    />
  </div>
  ```

---

## Task 1.6: Update AutoRunPill Memoization Comparator

Ensure the AutoRunPill re-renders when token stats change.

- [ ] In `src/renderer/components/ThinkingStatusPill.tsx`, find the memoization comparator for `ThinkingStatusPill` (around line 608). In the section that checks autoRunState properties (around line 617-628), add checks for the new token tracking fields:
  ```typescript
  // Add these checks alongside the existing autoRunState property checks:
  prevAutoRun?.currentTaskBytes !== nextAutoRun?.currentTaskBytes ||
  prevAutoRun?.currentTaskTokens !== nextAutoRun?.currentTaskTokens ||
  prevAutoRun?.currentTaskStartTime !== nextAutoRun?.currentTaskStartTime
  ```

---

## Verification

After completing all tasks:
1. Build the project: `npm run build`
2. The Auto Run pill should now display token statistics during task execution
3. Stats should show greyed "Tokens: — | — tok/s" before data arrives
4. Stats should show "Tokens~: X.XK | ~XX.X tok/s" during streaming (estimated)
5. Stats should update to actual values when onUsage events fire

---

*Phase 1 of Auto Run Throughput Status Pill Implementation*
