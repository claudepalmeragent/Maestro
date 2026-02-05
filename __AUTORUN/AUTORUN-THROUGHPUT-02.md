# Phase 2: Cumulative Token Display for Auto Run Pill

> **Feature:** Auto Run Throughput Status Pill
> **Phase:** 2 of 4
> **Scope:** Add cumulative token tracking across all Auto Run tasks
> **Prerequisite:** Phase 1 must be completed first

---

## Overview

This phase adds cumulative token tracking across all tasks in an Auto Run session, allowing users to see both the current task's token usage and the total tokens consumed across the entire run.

---

## Task 2.1: Add Cumulative Token Fields to BatchRunState

Add fields to track cumulative token statistics across all tasks.

- [ ] In `src/renderer/types/index.ts`, add the following fields to the `BatchRunState` interface after the `currentTaskStartTime` field (the fields added in Phase 1):
  ```typescript
  // Cumulative token tracking across all tasks (Phase 2)
  cumulativeInputTokens?: number;   // Total input tokens across all tasks
  cumulativeOutputTokens?: number;  // Total output tokens across all tasks
  cumulativeCost?: number;          // Total cost in USD across all tasks
  ```

---

## Task 2.2: Add Cumulative Token Actions to Batch Reducer

Add reducer action to accumulate token statistics when a task completes.

- [ ] In `src/renderer/hooks/batch/batchReducer.ts`, add a new action type to the `BatchAction` type union:
  ```typescript
  | { type: 'ACCUMULATE_TASK_USAGE'; payload: { inputTokens: number; outputTokens: number; cost: number } }
  ```
  Then add the corresponding case handler in the reducer function:
  ```typescript
  case 'ACCUMULATE_TASK_USAGE':
    return {
      ...state,
      cumulativeInputTokens: (state.cumulativeInputTokens || 0) + action.payload.inputTokens,
      cumulativeOutputTokens: (state.cumulativeOutputTokens || 0) + action.payload.outputTokens,
      cumulativeCost: (state.cumulativeCost || 0) + action.payload.cost,
    };
  ```
  Also update the `RESET` or initialization action (find where the state is reset at the start of a new Auto Run) to reset cumulative fields:
  ```typescript
  // In the START or RESET action, ensure cumulative fields are initialized:
  cumulativeInputTokens: 0,
  cumulativeOutputTokens: 0,
  cumulativeCost: 0,
  ```

---

## Task 2.3: Dispatch Cumulative Update After Task Completion

Wire up the batch processor to accumulate token usage after each task completes.

- [ ] In `src/renderer/hooks/batch/useBatchProcessor.ts`, find the section where task results are processed after `processTask` returns (around line 1095-1145 where `usageStats` is already being accumulated into local variables). After the existing usage stats accumulation, dispatch the cumulative update to the reducer:
  ```typescript
  // After the existing usage stats tracking (around line 1137-1144):
  if (usageStats) {
    // ... existing accumulation code ...

    // Dispatch to update BatchRunState with cumulative totals
    dispatch({
      type: 'ACCUMULATE_TASK_USAGE',
      payload: {
        inputTokens: usageStats.inputTokens || 0,
        outputTokens: usageStats.outputTokens || 0,
        cost: usageStats.totalCostUsd || 0,
      },
    });
  }
  ```

---

## Task 2.4: Update AutoRunPill to Display Cumulative Tokens

Add cumulative token display to the AutoRunPill component.

- [ ] In `src/renderer/components/ThinkingStatusPill.tsx`, in the `AutoRunPill` component, update the token statistics display section (added in Phase 1, Task 1.5) to also show cumulative tokens. After the current task's token display, add a total display:
  ```typescript
  // Add these calculations after the existing displayTokens calculation:
  const cumulativeTokens = autoRunState.cumulativeOutputTokens || 0;
  const showCumulative = cumulativeTokens > 0;

  // Then update the JSX token statistics section to include cumulative:
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

  {/* Cumulative tokens - only show after first task completes */}
  {showCumulative && (
    <>
      <div className="w-px h-4 shrink-0" style={{ backgroundColor: theme.colors.border }} />
      <div
        className="flex items-center gap-1 shrink-0 text-xs"
        style={{ color: theme.colors.textDim }}
        title="Total tokens consumed across all tasks in this Auto Run"
      >
        <span>Total:</span>
        <span className="font-medium" style={{ color: theme.colors.textMain }}>
          {formatTokensCompact(cumulativeTokens + displayTokens)}
        </span>
      </div>
    </>
  )}
  ```

---

## Task 2.5: Update AutoRunPill Memoization Comparator for Cumulative Fields

Ensure the AutoRunPill re-renders when cumulative stats change.

- [ ] In `src/renderer/components/ThinkingStatusPill.tsx`, find the memoization comparator section that was updated in Phase 1 (Task 1.6). Add checks for the cumulative fields:
  ```typescript
  // Add these checks alongside the existing autoRunState property checks:
  prevAutoRun?.cumulativeInputTokens !== nextAutoRun?.cumulativeInputTokens ||
  prevAutoRun?.cumulativeOutputTokens !== nextAutoRun?.cumulativeOutputTokens ||
  prevAutoRun?.cumulativeCost !== nextAutoRun?.cumulativeCost
  ```

---

## Task 2.6: Add Cumulative Stats to RightPanel Progress Display

Add cumulative token display to the progress panel in the right sidebar.

- [ ] In `src/renderer/components/RightPanel.tsx`, find the Auto Run progress section (around line 660-700 where task progress is displayed). After the task progress text, add a line showing cumulative token usage:
  ```typescript
  // Find the section that displays "X of Y tasks completed"
  // After that text, add cumulative stats if available:

  {/* Cumulative token usage */}
  {currentSessionBatchState.cumulativeOutputTokens && currentSessionBatchState.cumulativeOutputTokens > 0 && (
    <div className="mt-1 text-[10px]" style={{ color: theme.colors.textDim }}>
      Tokens used: {formatTokensCompact(currentSessionBatchState.cumulativeOutputTokens)}
      {currentSessionBatchState.cumulativeCost && currentSessionBatchState.cumulativeCost > 0 && (
        <span> (${currentSessionBatchState.cumulativeCost.toFixed(4)})</span>
      )}
    </div>
  )}
  ```
  Make sure `formatTokensCompact` is imported at the top of the file from `'../utils/formatters'`.

---

## Verification

After completing all tasks:
1. Build the project: `npm run build`
2. Run an Auto Run with multiple tasks
3. Verify that:
   - Current task tokens show during execution
   - "Total: X.XK" appears after the first task completes
   - Total increases as more tasks complete
   - RightPanel progress section shows cumulative token usage
   - Cost displays if available (for agents that support it)

---

*Phase 2 of Auto Run Throughput Status Pill Implementation*
