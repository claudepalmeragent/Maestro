# Implementation Summary: Stats Recording & Token Display Fixes (Part B)

**Date:** 2026-02-09
**Branch:** main
**Previous Summary:** IMPLEMENTATION-SUMMARY-2026-02-09.md

---

## Overview

This implementation addresses additional issues discovered after the initial token stats fixes:

1. **Missing database fields for Auto Run sessions** - input_tokens, output_tokens, tokens_per_second were NULL
2. **Missing cache/cost fields for all sessions** - cacheReadInputTokens, cacheCreationInputTokens, totalCostUsd not passed
3. **Type synchronization issues** - Duplicate StatsAggregation interface causing type mismatches
4. **Batch session events going to wrong handler** - App.tsx onUsage processing batch events
5. **Real-time task count updates during batch runs** - AutoRun.tsx using savedContent instead of localContent

---

## Changes by File

### 1. Type Definitions

**`src/main/preload/stats.ts`**
- Added `agentId` field to QueryEvent interface
- Added `cacheReadInputTokens`, `cacheCreationInputTokens`, `totalCostUsd` to QueryEvent
- Added `byAgentIdByDay` aggregation to StatsAggregation
- Added `totalCacheReadInputTokens`, `totalCacheCreationInputTokens`, `totalCostUsd` aggregates

**`src/renderer/global.d.ts`**
- Added `agentId` to recordQuery parameter type
- Added cache/cost fields to recordQuery parameter type
- Added `byAgentIdByDay` to getAggregation return type
- Added cache/cost aggregate fields to getAggregation return type

---

### 2. Stats Recording Fixes

**`src/renderer/App.tsx`**
- Added `cacheReadInputTokens`, `cacheCreationInputTokens`, `totalCostUsd` to toastData type
- Populated cache/cost fields from `tabUsageStats` in toastData assignment
- Added `agentId: sessionIdForStats` to recordQuery call
- Added cache/cost fields to recordQuery call
- **Key fix:** Added early return in onUsage handler for batch session IDs (`-batch-`)
  - Prevents batch session usage events from being processed by main handler
  - These are already handled by useBatchProcessor.ts

**`src/renderer/hooks/agent/useAgentExecution.ts`**
- Added tokensPerSecond calculation for Auto Run sessions
- Added `agentId: sessionId` to recordQuery call
- Added `inputTokens`, `outputTokens`, `tokensPerSecond` from taskUsageStats
- Added `cacheReadInputTokens`, `cacheCreationInputTokens`, `totalCostUsd` from taskUsageStats
- **Key fix:** Now passes all token metrics that were previously missing for Auto Run sessions

---

### 3. UI Component Fixes

**`src/renderer/components/AutoRun.tsx`**
- **taskCounts:** Now uses `localContent` during batch runs for real-time task checkbox updates
- **tokenCount:** Now uses `localContent` during batch runs for real-time token count updates
- Fallback to `savedContent` when not running to avoid confusion with unsaved edits

**`src/renderer/components/BatchRunStats.tsx`** (NEW)
- Extracted token stats display logic from RightPanel.tsx
- Reusable component with `compact` prop for modal footer vs panel display
- Shows agent/subagent token breakdown with cost calculations
- Uses Claude Sonnet 4 pricing ($3/$15/$0.30/$3.75 per MTok)

**`src/renderer/components/RightPanel.tsx`**
- Removed inline token stats JSX (120+ lines)
- Now imports and uses `<BatchRunStats>` component
- Cleaner separation of concerns

**`src/renderer/components/AutoRunExpandedModal.tsx`**
- Added batch run stats bar to modal footer
- Shows progress info (X of Y tasks, loop iteration)
- Uses `<BatchRunStats compact />` for token summary

**`src/renderer/components/UsageDashboard/UsageDashboardModal.tsx`**
- Removed duplicate `StatsAggregation` interface (55+ lines)
- Now imports types from `useStats.ts` hook
- Ensures type consistency with backend API

---

## Data Flow Summary

### User Sessions (App.tsx)
```
AI Response Complete
    ↓
onData handler → toastData populated with:
  - inputTokens, outputTokens from tabUsageStats
  - cacheReadInputTokens, cacheCreationInputTokens, totalCostUsd from tabUsageStats
  - isRemote from sshRemoteId || sessionSshRemoteConfig?.enabled
    ↓
recordQuery called with all fields including agentId
    ↓
Database: query_events row with complete token data
```

### Auto Run Sessions (useAgentExecution.ts)
```
Batch Task Complete
    ↓
onExit handler → taskUsageStats accumulated from onUsage events
    ↓
recordQuery called with:
  - sessionId (original, not batch ID)
  - agentId (same as sessionId for proper attribution)
  - inputTokens, outputTokens, tokensPerSecond from taskUsageStats
  - cacheReadInputTokens, cacheCreationInputTokens, totalCostUsd from taskUsageStats
  - isRemote from session.sessionSshRemoteConfig?.enabled
    ↓
Database: query_events row with complete token data
```

### Batch Session Filtering (App.tsx onUsage)
```
Usage Event with sessionId containing '-batch-'
    ↓
Early return (handled by useBatchProcessor instead)
    ↓
No duplicate/incorrect processing
```

---

## Testing

**493 stats-related tests pass:**
- query-events.test.ts (39 tests)
- aggregations.test.ts (62 tests)
- stats-db.test.ts (48 tests)
- integration.test.ts (34 tests)
- useStats.test.ts (23 tests)
- And more...

**TypeScript:**
- No new type errors related to stats changes
- Pre-existing unused variable warnings only

---

## Database Impact

**No schema changes** - This builds on migration v6 from Part A

**Fields now populated:**
- `agent_id` - Stable Maestro agent ID for proper attribution
- `input_tokens` - For Auto Run sessions (was NULL)
- `output_tokens` - For Auto Run sessions (was NULL)
- `tokens_per_second` - For Auto Run sessions (was NULL)
- `cache_read_input_tokens` - For all sessions (was NULL)
- `cache_creation_input_tokens` - For all sessions (was NULL)
- `total_cost_usd` - For all sessions (was NULL)

---

## What's Fixed

| Issue | Status |
|-------|--------|
| Empty token columns for Auto Run sessions | ✅ Fixed |
| Empty cache/cost columns for all sessions | ✅ Fixed |
| Batch session double-processing in App.tsx | ✅ Fixed |
| Task counts not updating in real-time during batch | ✅ Fixed |
| Token count not updating in real-time during batch | ✅ Fixed |
| Duplicate StatsAggregation type causing mismatches | ✅ Fixed |
| Token stats display duplicated across components | ✅ Refactored |

---

---

## Part C: AutoRun Token Display Fix (Session ID Matching)

**Commit:** `b0fe1c94` (fix(autorun): Fix token display using exact session ID matching)

### Problem

The AutoRun blue pill was showing a stuck "338 tokens" value at the START of each task, then flashing the real value at the end before resetting. Investigation revealed:

1. The `338` value was consistent across all tasks (suspicious)
2. 338 tokens ≈ 1183 bytes at 3.5 bytes/token estimation
3. The tilde (~) indicated it was estimated from bytes, not actual token count
4. The value appeared at task START, not during processing

### Root Cause

In `useBatchProcessor.ts`, listeners used **prefix-matching** to filter batch session events:

```typescript
// OLD (buggy) - matched ANY batch session for this Maestro session
if (sid.startsWith(batchSessionPrefix)) {
    dispatch({ type: 'UPDATE_TASK_BYTES', ... });
}
```

The prefix pattern `${sessionId}-batch-` matched ALL batch sessions:
- Task 1 session: `session123-batch-1700000001000`
- Task 2 session: `session123-batch-1700000002000`
- Both matched prefix: `session123-batch-`

When Task 1's result arrived late (after Task 2's listener was set up), it was counted toward Task 2, causing the phantom "338 tokens" at task start.

### Solution

Moved the data/usage listeners INTO `spawnAgentForSession` where **exact session ID matching** (`===`) is used:

1. **`src/renderer/hooks/agent/useAgentExecution.ts`**
   - Added optional `callbacks` parameter: `{ onData?: (bytes: number) => void; onUsage?: (tokens: number) => void }`
   - Callbacks are called from existing exact-match listeners (`sid === targetSessionId`)

2. **`src/renderer/hooks/batch/useDocumentProcessor.ts`**
   - Updated `DocumentProcessorCallbacks` interface with `tokenCallbacks` field
   - Passes callbacks through to `onSpawnAgent`

3. **`src/renderer/hooks/batch/useBatchProcessor.ts`**
   - Removed prefix-matching listeners
   - Now provides callback functions that dispatch to reducer
   - Callbacks are invoked with exact session ID matching from inside `spawnAgentForSession`

### Files Changed

| File | Changes |
|------|---------|
| `useAgentExecution.ts` | +21 lines - Added callbacks param, wired to existing listeners |
| `useBatchProcessor.ts` | -12 lines - Replaced listeners with callback approach |
| `useDocumentProcessor.ts` | +17 lines - Updated interface, pass callbacks through |

---

## Related Documents

| Document | Location |
|----------|----------|
| Part A Summary | `__PLANS/__ARCHIVE/IMPLEMENTATION-SUMMARY-2026-02-09.md` |
| Part B Summary | This document (sections above) |
| Test Document | `/app/_AUTORUN/TEST-BATCH-STATS-DISPLAY.md` |
