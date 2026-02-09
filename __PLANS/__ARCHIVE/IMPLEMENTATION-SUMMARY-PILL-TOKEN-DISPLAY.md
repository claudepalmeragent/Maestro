# Implementation Summary: Pill Token Display Fixes

**Date:** 2026-02-09
**Commits:**
- `038750b3` - fix(pills): Show latest response tokens and cumulative session totals
- `5280dec9` - fix(pills): Add per-tab cumulative token tracking for Session Tokens display
**Plan:** `PILL-TOKEN-DISPLAY-FIX-PLAN.md`

---

## Summary

Fixed two display issues in the yellow (Agent Session) and blue (AutoRun) thinking status pills:

1. **"Current" tokens** - Now shows latest response tokens instead of accumulated total
2. **"Session Tokens"** - Now shows per-tab cumulative totals that never decrease

---

## Changes Made

### File 1: `src/renderer/hooks/session/useBatchedSessionUpdates.ts`

**Change 1a - Accumulator function (line ~719):**
```typescript
// BEFORE
acc.cycleTokensDelta = (acc.cycleTokensDelta || 0) + tokens;

// AFTER
acc.cycleTokensDelta = tokens;
```

**Change 1b - Flush application (line ~513):**
```typescript
// BEFORE
currentCycleTokens: (updatedSession.currentCycleTokens || 0) + acc.cycleTokensDelta,

// AFTER
currentCycleTokens: acc.cycleTokensDelta,
```

**Why:** Multiple API responses within a thinking cycle were being summed. Now shows only the latest.

**Change 1c - Per-tab cumulative tracking (line ~466):**
```typescript
// NEW - alongside existing usageStats
cumulativeUsageStats: {
    inputTokens: (existingCumulative?.inputTokens || 0) + tabUsageDelta.inputTokens,
    outputTokens: (existingCumulative?.outputTokens || 0) + tabUsageDelta.outputTokens,
    // ... same for cache tokens, cost, reasoning
},
```

**Why:** Users have ~12 tabs per Agent and need per-tab cumulative totals, not session-wide.

### File 2: `src/renderer/types/index.ts`

**Change 2 - Add type field:**
```typescript
// In AITab interface
cumulativeUsageStats?: UsageStats; // Cumulative token usage (never decreases, for pill display)
```

### File 3: `src/renderer/components/ThinkingStatusPill.tsx`

**Change 3 - Data source (line ~525):**
```typescript
// BEFORE
const sessionUsage = writeModeTab?.usageStats || primarySession.usageStats;

// AFTER
const sessionUsage = writeModeTab?.cumulativeUsageStats || primarySession.usageStats;
```

**Why:** Use per-tab cumulative stats (never decreases), falling back to session-level for tabs without cumulative data yet.

---

## What Was NOT Changed

- `StdoutHandler.ts` - Core data pipeline unchanged
- `App.tsx` - Main coordinator unchanged
- Cost calculations - Use separate `totalCostUsd` tracking
- Context window display at top of app - Uses different data source
- Global stats in green pill - Uses `globalStats`, not session stats
- Existing `tab.usageStats` - Still shows current context window (used by other parts of app)

## Persistence

- `cumulativeUsageStats` **persists across app restarts** (not in runtime-only exclusion list)
- Existing tabs will start accumulating from 0 after upgrade (no migration needed)

---

## Technical Details

### Token Data Flow

```
Claude Agent Response
    ↓
Main Process (StdoutHandler)
    ↓ emits usage event
Renderer (App.tsx onUsage)
    ↓ calls batchedUpdater.updateCycleTokens(sessionId, outputTokens)
useBatchedSessionUpdates
    ↓ sets acc.cycleTokensDelta = tokens (NOW: latest only)
    ↓ sets session.currentCycleTokens = acc.cycleTokensDelta
ThinkingStatusPill
    ↓ displays "Current: X tokens"
```

### Two Separate Token Tracking Systems

| System | Purpose | Accumulation | Used For |
|--------|---------|--------------|----------|
| `currentCycleTokens` | Latest response | Replace | "Current" display |
| `tab.cumulativeUsageStats` | Per-tab cumulative | Add | "Session Tokens" display (NEW) |
| `tab.usageStats` | Current context | Replace | Context window (top of app) |
| `session.usageStats` | Session-wide cumulative | Add | Fallback if no tab cumulative |
| `globalStats` | All sessions | Add | Green pill at top |

---

## Testing Checklist

- [ ] Start new Agent Session, send message with tool calls
  - "Current" should show latest response tokens (changes between responses)
- [ ] Extended conversation with context compaction
  - "Session Tokens" should never decrease
- [ ] AutoRun batch processing
  - No regression in AutoRun pill behavior
- [ ] Check cost in green pill at top
  - Should be unchanged/accurate

---

## Related Files

| File | Purpose |
|------|---------|
| `__PLANS/PILL-TOKEN-DISPLAY-FIX-PLAN.md` | Full investigation and planning document |
| `__PLANS/__ARCHIVE/IMPLEMENTATION-SUMMARY-2026-02-09-b.md` | Previous session's work (bash warning fix, etc.) |
