# Implementation Summary: Pill Token Display Fixes

**Date:** 2026-02-09
**Commit:** `038750b3`
**Plan:** `PILL-TOKEN-DISPLAY-FIX-PLAN.md`

---

## Summary

Fixed two display issues in the yellow (Agent Session) and blue (AutoRun) thinking status pills:

1. **"Current" tokens** - Now shows latest response tokens instead of accumulated total
2. **"Session Tokens"** - Now shows true cumulative totals that never decrease

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

### File 2: `src/renderer/components/ThinkingStatusPill.tsx`

**Change 2 - Data source (line ~525):**
```typescript
// BEFORE
const sessionUsage = writeModeTab?.usageStats || primarySession.usageStats;

// AFTER
const sessionUsage = primarySession.usageStats;
```

**Why:** Tab-level stats get replaced on each response (reflecting current context window). Session-level stats accumulate correctly and never decrease.

---

## What Was NOT Changed

- `StdoutHandler.ts` - Core data pipeline unchanged
- `App.tsx` - Main coordinator unchanged
- Cost calculations - Use separate `totalCostUsd` tracking
- Context window display at top of app - Uses different data source
- Global stats in green pill - Uses `globalStats`, not session stats
- Any persistent data storage

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
| `session.usageStats` | Cumulative totals | Add | "Session Tokens" display |
| `tab.usageStats` | Current context | Replace | Context window (top of app) |
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
