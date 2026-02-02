# Agent Statistics Breakout UI - Plan v3 Completed

## Summary

Fixed the Agent Throughput chart to display **all sessions**, including those without token data. Previously, sessions with NULL or missing token metrics were filtered out of the chart entirely.

---

## Problem

In `AgentThroughputChart.tsx`, sessions were being filtered out when they had zero average throughput:

```typescript
// Old code (line 167-170)
sessionTotals.sort((a, b) => b.avgThroughput - a.avgThroughput);
const topSessions = sessionTotals
  .filter((s) => s.avgThroughput > 0)  // <-- Excluded sessions with no token data
  .slice(0, 10);
```

This meant sessions that had queries but no token metrics (input_tokens, output_tokens, or tokens_per_second were NULL) would not appear in the chart at all.

---

## Solution

1. **Changed session selection** - Sort by total query count instead of throughput, and remove the filter:

```typescript
// New code
sessionTotals.sort((a, b) => b.totalQueries - a.totalQueries);
const topSessions = sessionTotals.slice(0, 10);  // No filter
```

2. **Include all points in line paths** - Lines now draw through zero-value points instead of skipping them

3. **Visual distinction for zero values** - Data points at y=0 are rendered smaller (radius 2 vs 4) and dimmer (opacity 0.5) to indicate missing data

---

## Changes Made

### File: `src/renderer/components/UsageDashboard/AgentThroughputChart.tsx`

| Location | Change |
|----------|--------|
| Lines 168-170 | Sort by `totalQueries` descending; removed `avgThroughput > 0` filter |
| Lines 285-292 | Line paths include all points (zeros appear at y=0) |
| Lines 433-444 | Data points: smaller radius (2 vs 4) and lower opacity (0.5) for zero values |

---

## Visual Result

**Before:**
- Chart showed only 3 sessions (those with token data)
- Sessions without throughput metrics were invisible

**After:**
- Chart shows up to 10 most active sessions (by query count)
- Sessions without token data appear as flat lines at y=0
- Zero-value data points are shown as smaller, dimmer circles
- All sessions are represented in the legend

---

## Commit

```
bd598ae3 fix: show all sessions in throughput chart including those without token data
```

---

## Testing

- TypeScript compilation: Passed
- Renderer build: Passed
- ESLint/Prettier: Passed via pre-commit hooks

---

## Status

**Completed**
