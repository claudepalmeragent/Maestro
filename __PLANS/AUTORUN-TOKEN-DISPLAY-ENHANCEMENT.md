# Auto Run Token Display Enhancement Plan

**Created:** 2026-02-08
**Status:** Ready for Implementation
**Phase:** Phase 4 of Throughput Status Pill Enhancement

## Executive Summary

This plan addresses the token display asymmetry identified in the Auto Run pill and panel. Currently:
- **Agents:** Track only `inputTokens`, `outputTokens`, and `cost` - cache tokens are NOT tracked
- **Subagents:** Track all 4 token types (input, output, cacheRead, cacheCreation)
- **Cost:** Calculated correctly using all 4 token types
- **Display:** Shows only input+output tokens, making cost appear disproportionate

The user has requested a comprehensive token display showing combined totals with cache token breakdowns for both Agents and Subagents.

---

## Pricing Investigation Results

### Internal Pricing (constants.ts:110-115)
```typescript
export const CLAUDE_PRICING = {
  INPUT_PER_MILLION: 3,      // $3/MTok
  OUTPUT_PER_MILLION: 15,    // $15/MTok
  CACHE_READ_PER_MILLION: 0.3,      // $0.30/MTok
  CACHE_CREATION_PER_MILLION: 3.75, // $3.75/MTok
};
```

### Official Claude Pricing (as of 2026-02-08)

| Model | Input | Output | Cache Read | Cache Write (5m) | Cache Write (1h) |
|-------|-------|--------|------------|------------------|------------------|
| Opus 4.5/4.6 | $5 | $25 | $0.50 | $6.25 | $10 |
| **Sonnet 4/4.5** | **$3** | **$15** | **$0.30** | **$3.75** | $6 |
| Haiku 4.5 | $1 | $5 | $0.10 | $1.25 | $2 |

### Pricing Verification: PASSED
The internal pricing matches Claude Sonnet 4 exactly for 5-minute cache TTL.

### Known Limitations (documented, not addressed in this plan)
1. **Model-specific pricing:** Hardcoded to Sonnet 4. Opus/Haiku users will see inaccurate costs.
2. **Cache TTL:** Assumes 5-minute cache. 1-hour cache writes cost 60% more ($6 vs $3.75).
3. **Long context:** >200K tokens incurs premium pricing (2x input, 1.5x output) - not handled.

---

## Current State Analysis

### BatchRunState Token Fields (types/index.ts:341-357)
```typescript
// Agent tokens (Phases 1-2)
currentTaskBytes?: number;       // Real-time byte tracking
currentTaskTokens?: number;      // Real-time token tracking
cumulativeInputTokens?: number;  // NOT STORED - always undefined
cumulativeOutputTokens?: number; // Accumulated across tasks
cumulativeCost?: number;         // Accumulated cost

// Subagent tokens (Phase 3)
subagentInputTokens?: number;
subagentOutputTokens?: number;
subagentCacheReadTokens?: number;
subagentCacheCreationTokens?: number;
subagentCost?: number;
```

### Key Issue: ACCUMULATE_TASK_USAGE Action (batchReducer.ts:249-253)
```typescript
| {
    type: 'ACCUMULATE_TASK_USAGE';
    sessionId: string;
    payload: { inputTokens: number; outputTokens: number; cost: number };
  }
```
**Problem:** This action only accepts `inputTokens`, `outputTokens`, and `cost`. Cache tokens are not passed through, so they cannot be accumulated for agents.

### Current Display (ThinkingStatusPill.tsx:259, 347-360)
- Shows `cumulativeOutputTokens` (not input+output)
- Shows subagent tokens as `subagentInputTokens + subagentOutputTokens`
- Cache tokens are completely hidden from display

---

## Target UI Specification

### Pill Display (Compact)
```
Tokens: 24.6K/7.2M (Agents: 11.1K/2.1M) (Subagents: 13.5K/5.1M)
        ↑     ↑              ↑     ↑               ↑     ↑
        |     |              |     |               |     └── subagent cache tokens
        |     |              |     |               └── subagent input+output
        |     |              |     └── agent cache tokens
        |     |              └── agent input+output
        |     └── total cache (agent + subagent)
        └── total input+output (agent + subagent)
```

### Panel Display (Detailed)
```
Total Tokens used: 24.6K ($6.66)
  ↳ Cache Read + Cache Write: 7.2M ($2.00)

Agent Tokens used: 11.1K ($3.00)
  ↳ Cache Read + Cache Write: 2.1M ($0.70)

Subagent Tokens used: 13.5K ($3.66)
  ↳ Cache Read + Cache Write: 5.1M ($1.30)
```

---

## Implementation Plan

### Step 1: Add Agent Cache Token Tracking to BatchRunState

**File:** `src/renderer/types/index.ts` (lines 346-349)

Add new fields to BatchRunState interface:
```typescript
// Cumulative token tracking across all tasks (Throughput Status Pill - Phase 2)
cumulativeInputTokens?: number;   // Total input tokens across all tasks
cumulativeOutputTokens?: number;  // Total output tokens across all tasks
cumulativeCacheReadTokens?: number;     // NEW: Cache read tokens (agents)
cumulativeCacheCreationTokens?: number; // NEW: Cache write tokens (agents)
cumulativeCost?: number;          // Total cost in USD across all tasks
```

### Step 2: Update ACCUMULATE_TASK_USAGE Action Type

**File:** `src/renderer/hooks/batch/batchReducer.ts` (lines 249-253)

Extend the action payload:
```typescript
| {
    type: 'ACCUMULATE_TASK_USAGE';
    sessionId: string;
    payload: {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;       // NEW
      cacheCreationTokens: number;   // NEW
      cost: number;
    };
  }
```

### Step 3: Update ACCUMULATE_TASK_USAGE Reducer Handler

**File:** `src/renderer/hooks/batch/batchReducer.ts` (lines 725-738)

Update the reducer to accumulate cache tokens:
```typescript
case 'ACCUMULATE_TASK_USAGE': {
  const { sessionId, payload } = action;
  const currentState = state[sessionId];
  if (!currentState) return state;

  return {
    ...state,
    [sessionId]: {
      ...currentState,
      cumulativeInputTokens: (currentState.cumulativeInputTokens || 0) + payload.inputTokens,
      cumulativeOutputTokens: (currentState.cumulativeOutputTokens || 0) + payload.outputTokens,
      cumulativeCacheReadTokens: (currentState.cumulativeCacheReadTokens || 0) + payload.cacheReadTokens,
      cumulativeCacheCreationTokens: (currentState.cumulativeCacheCreationTokens || 0) + payload.cacheCreationTokens,
      cumulativeCost: (currentState.cumulativeCost || 0) + payload.cost,
    },
  };
}
```

### Step 4: Update useBatchProcessor to Pass Cache Tokens

**File:** `src/renderer/hooks/batch/useBatchProcessor.ts`

Find where `ACCUMULATE_TASK_USAGE` is dispatched and update to include cache tokens from the usage event. The `onUsage` callback receives `UsageStats` which already contains all 4 token types.

### Step 5: Initialize Cache Token Fields on START_BATCH

**File:** `src/renderer/hooks/batch/batchReducer.ts` (lines 340-342)

Add initialization for the new fields:
```typescript
cumulativeInputTokens: 0,
cumulativeOutputTokens: 0,
cumulativeCacheReadTokens: 0,      // NEW
cumulativeCacheCreationTokens: 0,  // NEW
cumulativeCost: 0,
```

### Step 6: Update ThinkingStatusPill (Auto Run Pill)

**File:** `src/renderer/components/ThinkingStatusPill.tsx` (around lines 259-365)

Replace current token display with new comprehensive format:
```typescript
// Calculate totals
const agentInputOutput = (autoRunState.cumulativeInputTokens ?? 0) +
                         (autoRunState.cumulativeOutputTokens ?? 0);
const agentCache = (autoRunState.cumulativeCacheReadTokens ?? 0) +
                   (autoRunState.cumulativeCacheCreationTokens ?? 0);
const subagentInputOutput = (autoRunState.subagentInputTokens ?? 0) +
                            (autoRunState.subagentOutputTokens ?? 0);
const subagentCache = (autoRunState.subagentCacheReadTokens ?? 0) +
                      (autoRunState.subagentCacheCreationTokens ?? 0);
const totalInputOutput = agentInputOutput + subagentInputOutput;
const totalCache = agentCache + subagentCache;

// Display: Tokens: 24.6K/7.2M (Agents: 11.1K/2.1M) (Subagents: 13.5K/5.1M)
```

### Step 7: Update RightPanel (Auto Run Panel)

**File:** `src/renderer/components/RightPanel.tsx` (around lines 686-714)

Replace current token display with new detailed format showing:
- Total tokens with cost and cache breakdown
- Agent tokens with cost and cache breakdown
- Subagent tokens with cost and cache breakdown

### Step 8: Add Cost Breakdown Calculation

Create helper functions to calculate individual costs for display:
```typescript
// Agent cost breakdown
const agentInputCost = (cumulativeInputTokens / 1_000_000) * 3;
const agentOutputCost = (cumulativeOutputTokens / 1_000_000) * 15;
const agentCacheReadCost = (cumulativeCacheReadTokens / 1_000_000) * 0.30;
const agentCacheWriteCost = (cumulativeCacheCreationTokens / 1_000_000) * 3.75;

// Subagent cost breakdown (already calculated in subagentCost)
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/renderer/types/index.ts` | Add `cumulativeCacheReadTokens`, `cumulativeCacheCreationTokens` to BatchRunState |
| `src/renderer/hooks/batch/batchReducer.ts` | Update action type, reducer handler, and START_BATCH initialization |
| `src/renderer/hooks/batch/useBatchProcessor.ts` | Pass cache tokens to ACCUMULATE_TASK_USAGE |
| `src/renderer/components/ThinkingStatusPill.tsx` | New comprehensive pill display |
| `src/renderer/components/RightPanel.tsx` | New detailed panel display |

---

## Testing Plan

### Test 1: Basic Token Accumulation
1. Start an Auto Run with a simple task
2. Verify all 4 token types are accumulated for agents
3. Verify totals match between pill and panel

### Test 2: Subagent Integration
1. Run a task that spawns subagents (e.g., research task)
2. Verify subagent tokens are tracked separately
3. Verify combined totals are correct

### Test 3: Cost Verification
1. Run a session and note the displayed costs
2. Manually calculate expected costs using the formula:
   - Input: tokens × $3/MTok
   - Output: tokens × $15/MTok
   - Cache Read: tokens × $0.30/MTok
   - Cache Write: tokens × $3.75/MTok
3. Verify displayed costs match calculations

### Test 4: UI Layout
1. Verify pill doesn't overflow with large numbers
2. Verify panel formatting is readable
3. Test with zero subagent tokens (should hide subagent section or show 0)

---

## Rollback Plan

If issues arise, revert to the current behavior:
1. Remove new fields from BatchRunState
2. Revert ACCUMULATE_TASK_USAGE action to original signature
3. Restore original pill/panel display code

All changes are additive and backward-compatible (new fields default to undefined/0).

---

## Auto Run Documents

The following Auto Run documents will implement this plan:
1. `AUTORUN-TOKEN-DISPLAY-01.md` - Add cache token fields to types and reducer
2. `AUTORUN-TOKEN-DISPLAY-02.md` - Update useBatchProcessor to pass cache tokens
3. `AUTORUN-TOKEN-DISPLAY-03.md` - Update ThinkingStatusPill display
4. `AUTORUN-TOKEN-DISPLAY-04.md` - Update RightPanel display
5. `AUTORUN-TOKEN-DISPLAY-05.md` - Testing and verification
