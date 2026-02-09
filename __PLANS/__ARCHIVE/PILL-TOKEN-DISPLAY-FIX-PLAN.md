# Pill Token Display Fix Plan

**Date:** 2026-02-09
**Status:** DRAFT - Awaiting Review
**Scope:** Display-only changes to yellow (Agent Session) and blue (AutoRun) thinking pills

---

## Executive Summary

Two display issues have been identified in the thinking status pills:

1. **"Current" tokens accumulate** instead of showing latest round
2. **"Session" tokens decrease** when context compacts (user expectation mismatch)

After investigation, **both issues are display-only bugs** that can be fixed with minimal changes:

1. **Issue #1:** The batched updater accumulates cycle tokens instead of showing latest
2. **Issue #2:** The pill uses tab-level stats (replaced each response) instead of session-level stats (accumulated)

---

## Problem Analysis

### Issue #1: "Current" Tokens Accumulating

**User Report:** The "Current" token count in the yellow pill accumulates across multiple API calls within a thinking cycle instead of showing the tokens from the latest response.

**Example:**
- Claude sends response 1: 150 output tokens
- Claude sends response 2: 200 output tokens (tool use)
- Claude sends response 3: 100 output tokens (final)
- **User sees:** "Current: 450 tokens" (accumulated)
- **User expects:** "Current: 100 tokens" (latest)

**Root Cause:** The batched updater accumulates `cycleTokensDelta` additively:

```typescript
// useBatchedSessionUpdates.ts line 719
acc.cycleTokensDelta = (acc.cycleTokensDelta || 0) + tokens;  // Adds each update

// Then line 513
currentCycleTokens: (updatedSession.currentCycleTokens || 0) + acc.cycleTokensDelta,  // Adds to existing
```

**Data Flow:**
```
Claude Agent → onUsage event (150 tokens)
              → batchedUpdater.updateCycleTokens(sessionId, 150)
              → acc.cycleTokensDelta = 0 + 150 = 150
              → currentCycleTokens = 0 + 150 = 150

Claude Agent → onUsage event (200 tokens)
              → batchedUpdater.updateCycleTokens(sessionId, 200)
              → acc.cycleTokensDelta = 150 + 200 = 350  // BUG: Should replace, not add
              → currentCycleTokens = 150 + 350 = 500    // BUG: Should be 200
```

### Issue #2: "Session" Tokens Decreasing

**User Report:** Session token totals (input+output) decrease when Claude Code compacts the context window.

**Investigation Finding:** This is **expected behavior**, not a bug.

**Why it happens:**
1. Context window fills up with conversation history
2. Claude Code's "Summarize & Continue" activates
3. Long conversation is summarized into compact form
4. New request has fewer cached tokens (summary vs full history)
5. Claude reports the new, lower token counts

**What Claude reports:**
- `inputTokens`: NEW input tokens in THIS request (per-response)
- `outputTokens`: NEW output tokens in THIS response (per-response)
- `cacheReadInputTokens`: CUMULATIVE cache tokens read (session lifetime)
- `cacheCreationInputTokens`: NEW tokens written to cache (per-response)

After compaction, `cacheReadInputTokens` can drop because the cached conversation was replaced with a summary.

**User expectation:** Session totals should only increase
**Reality:** After compaction, new session has different token characteristics

---

## Proposed Solution

### Fix #1: Show Latest Round Tokens (Not Accumulated)

**Scope:** Display-only change in `useBatchedSessionUpdates.ts`

**Change 1a - Accumulator (line ~719):**
```typescript
// BEFORE (accumulates)
acc.cycleTokensDelta = (acc.cycleTokensDelta || 0) + tokens;

// AFTER (replaces with latest)
acc.cycleTokensDelta = tokens;
```

**Change 1b - Flush application (line ~513):**
```typescript
// BEFORE (adds to existing)
currentCycleTokens: (updatedSession.currentCycleTokens || 0) + acc.cycleTokensDelta,

// AFTER (replaces with latest)
currentCycleTokens: acc.cycleTokensDelta,
```

**Why this is safe:**
- Only affects `currentCycleTokens` which is used EXCLUSIVELY for the "Current: X tokens" display
- Does NOT affect `usageStats` (cumulative session totals for cost/tracking)
- Does NOT affect `updateUsage()` which handles the real session statistics
- The actual session token tracking remains unchanged

**Verification:**
```
grep -r "currentCycleTokens" src/renderer/
# Should only find:
# - useBatchedSessionUpdates.ts (setting)
# - App.tsx (reset to 0 on new cycle)
# - ThinkingStatusPill.tsx (display)
# - types/index.ts (type definition)
```

### Fix #2: Add Per-Tab Cumulative Stats (High-Water Mark)

**Scope:** Add new field to track per-tab cumulative usage that never decreases.

**User Requirement:** User has ~12 tabs open per Agent and needs per-tab cumulative totals, not session-wide totals.

**Approach:** Add `cumulativeUsageStats` field to `AITab` that only ever increases (high-water mark pattern).

**Changes Required:**

1. **Type definition** (`types/index.ts`):
```typescript
// Add to AITab interface
cumulativeUsageStats?: UsageStats; // Cumulative totals (never decreases, persisted)
```

2. **Accumulator logic** (`useBatchedSessionUpdates.ts`):
```typescript
// When applying tab usage, also update cumulative with accumulated values
const existingCumulative = tab.cumulativeUsageStats;
return {
    ...tab,
    usageStats: { ... },  // Existing logic unchanged
    cumulativeUsageStats: {
        inputTokens: (existingCumulative?.inputTokens || 0) + tabUsageDelta.inputTokens,
        outputTokens: (existingCumulative?.outputTokens || 0) + tabUsageDelta.outputTokens,
        cacheReadInputTokens: (existingCumulative?.cacheReadInputTokens || 0) + tabUsageDelta.cacheReadInputTokens,
        cacheCreationInputTokens: (existingCumulative?.cacheCreationInputTokens || 0) + tabUsageDelta.cacheCreationInputTokens,
        totalCostUsd: (existingCumulative?.totalCostUsd || 0) + tabUsageDelta.totalCostUsd,
        reasoningTokens: (existingCumulative?.reasoningTokens || 0) + (tabUsageDelta.reasoningTokens || 0),
        contextWindow: tabUsageDelta.contextWindow,
    },
};
```

3. **Display** (`ThinkingStatusPill.tsx`):
```typescript
// Use per-tab cumulative stats
const sessionUsage = writeModeTab?.cumulativeUsageStats || primarySession.usageStats;
```

**Why this is safe:**
- **Existing `tab.usageStats`**: UNCHANGED - still shows current context window (used by other parts of app)
- **New `tab.cumulativeUsageStats`**: Purely additive field, only used for pill display
- **Persisted**: Will survive app restarts (not in the runtime-only exclusion list)
- **No changes to**: StdoutHandler, App.tsx, parsers, cost calculations, context tracking

---

## Files to Change

| File | Change Type | Risk Level |
|------|-------------|------------|
| `src/renderer/hooks/session/useBatchedSessionUpdates.ts` | Replace accumulation with latest value + add cumulative tracking | LOW |
| `src/renderer/components/ThinkingStatusPill.tsx` | Use per-tab cumulative stats | LOW |
| `src/renderer/types/index.ts` | Add `cumulativeUsageStats` to `AITab` interface | NONE |

**Files NOT to change:**
- `src/main/process-manager/handlers/StdoutHandler.ts` - Core data pipeline
- `src/renderer/App.tsx` - Main coordinator (reset logic is correct)
- `src/main/parsers/*` - Agent output parsing
- Any cost calculation logic

---

## Detailed Code Changes

### File 1: `useBatchedSessionUpdates.ts`

**Location:** `/app/Maestro/src/renderer/hooks/session/useBatchedSessionUpdates.ts`

#### Change 1a: updateCycleTokens function (~line 710-724)

```typescript
// BEFORE
const updateCycleTokens = useCallback(
    (sessionId: string, tokens: number) => {
        const acc = getAccumulator(sessionId);
        acc.cycleTokensDelta = (acc.cycleTokensDelta || 0) + tokens;  // ← CHANGE THIS
        acc.changedFields.add('cycleMetrics');
        hasPendingRef.current = true;
    },
    [getAccumulator]
);

// AFTER
const updateCycleTokens = useCallback(
    (sessionId: string, tokens: number) => {
        const acc = getAccumulator(sessionId);
        // Use latest token count, not accumulated - "Current" should show latest response
        acc.cycleTokensDelta = tokens;
        acc.changedFields.add('cycleMetrics');
        hasPendingRef.current = true;
    },
    [getAccumulator]
);
```

#### Change 1b: Flush application (~line 507-521)

```typescript
// BEFORE
// Apply cycle tokens
if (acc.cycleTokensDelta !== undefined) {
    updatedSession = {
        ...updatedSession,
        currentCycleTokens: (updatedSession.currentCycleTokens || 0) + acc.cycleTokensDelta,
    };
}

// AFTER
// Apply cycle tokens - replace with latest value (not accumulated)
// This shows the tokens from the most recent response in "Current: X tokens"
if (acc.cycleTokensDelta !== undefined) {
    updatedSession = {
        ...updatedSession,
        currentCycleTokens: acc.cycleTokensDelta,
    };
}
```

### File 2: `ThinkingStatusPill.tsx`

**Location:** `/app/Maestro/src/renderer/components/ThinkingStatusPill.tsx`

#### Change 2: Use per-tab cumulative stats (~line 525)

```typescript
// BEFORE - uses tab stats (replaced on each response, can decrease)
const sessionUsage = writeModeTab?.usageStats || primarySession.usageStats;

// AFTER - uses per-tab cumulative stats (accumulated per-tab, never decreases)
const sessionUsage = writeModeTab?.cumulativeUsageStats || primarySession.usageStats;
```

This uses the new per-tab cumulative field, falling back to session-level for tabs without cumulative data yet.

---

## Testing Plan

### Manual Testing

1. **Start new Agent Session**
   - Send a message that triggers multiple tool uses
   - Observe "Current" token display
   - **Expected:** Shows tokens from LATEST response, not sum of all
   - **Verify:** Value should change (not always increase) as Claude makes tool calls

2. **Extended conversation with compaction**
   - Have long conversation until context compacts
   - Observe "Session Tokens" before and after
   - **Expected:** May decrease after compaction (this is correct)
   - **Verify:** Tooltip explains this behavior

3. **AutoRun batch processing**
   - Run multiple AutoRun tasks
   - Observe "Current" and cumulative displays
   - **Expected:** Current resets per task, cumulative grows
   - **Verify:** No regression in AutoRun behavior

4. **Cost calculations (regression test)**
   - Complete several sessions
   - Check cumulative cost in header bar
   - **Expected:** Cost should be accurate (unchanged by these fixes)
   - **Verify:** Compare with Claude's actual billing

### Automated Testing

None required - these are display-only changes with no impact on core logic.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Display shows wrong current tokens | LOW | LOW | Clear testing protocol |
| Breaks cost calculations | NONE | HIGH | Changes don't touch cost logic |
| Affects context tracking | NONE | HIGH | Changes don't touch context logic |
| User confusion about session totals | MEDIUM | LOW | Tooltip enhancement |

**Overall Risk: LOW**

The changes are isolated to display-only data paths. The `currentCycleTokens` field is used exclusively for the "Current: X tokens" display and has no downstream effects on cost, context, or any other calculations.

---

## Alternative Approaches Considered

### Alternative 1: Change at Source (StdoutHandler)
**Rejected:** Would affect all consumers of usage events, including cost calculations and context tracking. Too risky.

### Alternative 2: Track Cycle Tokens Separately from Session Tokens
**Current implementation:** Already does this. The issue is in HOW cycle tokens are tracked (accumulation vs replacement).

### Alternative 3: Add "Latest Response" as Separate Field
**Rejected:** Adds complexity. Simpler to fix the existing field's behavior.

### Alternative 4: Show Accumulated Cycle Tokens with Different Label
**Rejected:** Users expect "Current" to mean "current response," not "all responses this cycle."

---

## Implementation Order

1. **Phase 1:** Fix #1a and #1b in `useBatchedSessionUpdates.ts`
2. **Phase 2:** Test thoroughly with Agent Sessions and AutoRun
3. **Phase 3:** (Optional) Add tooltip enhancement if user feedback indicates confusion
4. **Phase 4:** Monitor for any unexpected side effects

---

## Final Approach (Approved)

1. **"Current" tokens:** Show latest response tokens (not accumulated within cycle)
2. **"Session Tokens":** Show per-tab cumulative from `writeModeTab?.cumulativeUsageStats` (never decreases)
3. **Context window info:** Already displayed at top of app, no duplication needed
4. **Per-tab granularity:** Each tab tracks its own cumulative totals (user has ~12 tabs per Agent)

---

## Appendix: Data Flow Diagrams

### Current Flow (Buggy)

```
onUsage(150 tokens) → cycleTokensDelta = 0 + 150 = 150
                    → currentCycleTokens = 0 + 150 = 150
                    → Display: "Current: 150 tokens" ✓

onUsage(200 tokens) → cycleTokensDelta = 150 + 200 = 350
                    → currentCycleTokens = 150 + 350 = 500
                    → Display: "Current: 500 tokens" ✗ (should be 200)

onUsage(100 tokens) → cycleTokensDelta = 350 + 100 = 450
                    → currentCycleTokens = 500 + 450 = 950
                    → Display: "Current: 950 tokens" ✗ (should be 100)
```

### Proposed Flow (Fixed)

```
onUsage(150 tokens) → cycleTokensDelta = 150
                    → currentCycleTokens = 150
                    → Display: "Current: 150 tokens" ✓

onUsage(200 tokens) → cycleTokensDelta = 200
                    → currentCycleTokens = 200
                    → Display: "Current: 200 tokens" ✓

onUsage(100 tokens) → cycleTokensDelta = 100
                    → currentCycleTokens = 100
                    → Display: "Current: 100 tokens" ✓
```

### Session-Level Flow (Now Used for Display)

```
onUsage(150 tokens) → updateUsage(sessionId, null, {inputTokens: 1000, outputTokens: 150, ...})
                    → session.usageStats.outputTokens = 0 + 150 = 150
                    → Display: "Session Tokens: 1.15K" ✓

onUsage(200 tokens) → updateUsage(sessionId, null, {inputTokens: 1000, outputTokens: 200, ...})
                    → session.usageStats.outputTokens = 150 + 200 = 350
                    → Display: "Session Tokens: 1.35K" ✓

[Context compaction occurs - Claude resets internal state]

onUsage(50 tokens)  → updateUsage(sessionId, null, {inputTokens: 500, outputTokens: 50, ...})
                    → session.usageStats.outputTokens = 350 + 50 = 400  ← ACCUMULATES
                    → Display: "Session Tokens: 1.4K" ✓ (never decreases!)
```

**Key insight:** Session-level stats (`primarySession.usageStats`) already accumulate correctly.
The fix is simply to use them instead of tab-level stats.

---

## Sign-off

- [ ] Planner review complete
- [ ] User approval received
- [ ] Implementation started
- [ ] Testing complete
- [ ] Deployed
