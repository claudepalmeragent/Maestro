# Agent Statistics Breakout UI - Plan v4

## Problem

The Agent Throughput chart and TOTAL TOKENS / AVG THROUGHPUT summary cards show no data for most agents because token metrics are not being recorded in the `query_events` database table.

### Root Cause Analysis

1. **Token data IS available** during query execution via `managedProcess.lastUsageTotals` (populated by `StdoutHandler.ts` from agent JSON output)

2. **But it's not being passed through the event chain:**
   - `ExitHandler.handleExit()` emits `query-complete` without token fields
   - `QueryCompleteData` interface doesn't include token fields
   - `stats-listener.ts` calls `insertQueryEvent()` without token data

3. **Result:** `query_events.input_tokens`, `output_tokens`, and `tokens_per_second` columns are always NULL

---

## Solution

Wire the token metrics through the event chain from `ExitHandler` → `query-complete` event → `stats-listener` → `insertQueryEvent()`.

---

## Implementation Steps

### Step 1: Update `QueryCompleteData` interface

**File:** `src/main/process-manager/types.ts`

Add optional token fields to the interface:

```typescript
export interface QueryCompleteData {
  sessionId: string;
  agentType: string;
  source: 'user' | 'auto';
  startTime: number;
  duration: number;
  projectPath?: string;
  tabId?: string;
  // NEW: Token metrics
  inputTokens?: number;
  outputTokens?: number;
  tokensPerSecond?: number;
}
```

### Step 2: Update `ExitHandler` to include token metrics

**File:** `src/main/process-manager/handlers/ExitHandler.ts`

In `handleExit()`, compute and include token metrics from `managedProcess.lastUsageTotals`:

```typescript
// Emit query-complete event for batch mode processes (for stats tracking)
if (isBatchMode && managedProcess.querySource) {
  const duration = Date.now() - managedProcess.startTime;

  // Compute tokens per second from lastUsageTotals
  const durationSeconds = duration / 1000;
  const outputTokens = managedProcess.lastUsageTotals?.outputTokens;
  const inputTokens = managedProcess.lastUsageTotals?.inputTokens;
  const tokensPerSecond = outputTokens && durationSeconds > 0
    ? outputTokens / durationSeconds
    : undefined;

  this.emitter.emit('query-complete', sessionId, {
    sessionId,
    agentType: toolType,
    source: managedProcess.querySource,
    startTime: managedProcess.startTime,
    duration,
    projectPath: managedProcess.projectPath,
    tabId: managedProcess.tabId,
    // NEW: Include token metrics
    inputTokens,
    outputTokens,
    tokensPerSecond,
  });
  // ... existing logging
}
```

### Step 3: Update `stats-listener` to pass token data

**File:** `src/main/process-listeners/stats-listener.ts`

In `insertQueryEventWithRetry()`, include the token fields:

```typescript
const id = db.insertQueryEvent({
  sessionId: queryData.sessionId,
  agentType: queryData.agentType,
  source: queryData.source,
  startTime: queryData.startTime,
  duration: queryData.duration,
  projectPath: queryData.projectPath,
  tabId: queryData.tabId,
  // NEW: Include token metrics
  inputTokens: queryData.inputTokens,
  outputTokens: queryData.outputTokens,
  tokensPerSecond: queryData.tokensPerSecond,
});
```

---

## Files Modified

| File | Change |
|------|--------|
| `src/main/process-manager/types.ts` | Add `inputTokens`, `outputTokens`, `tokensPerSecond` to `QueryCompleteData` |
| `src/main/process-manager/handlers/ExitHandler.ts` | Compute and include token metrics in `query-complete` event |
| `src/main/process-listeners/stats-listener.ts` | Pass token fields to `insertQueryEvent()` |

---

## Testing

1. TypeScript compilation passes
2. Main process build succeeds
3. Existing stats-listener tests pass (may need updates)

---

## Expected Result

After this fix:
- New queries will have token metrics recorded in the database
- TOTAL TOKENS and AVG THROUGHPUT cards will show real data
- Agent Throughput chart will display actual throughput values
- Legacy queries (before this fix) will still show as zeros (expected)
