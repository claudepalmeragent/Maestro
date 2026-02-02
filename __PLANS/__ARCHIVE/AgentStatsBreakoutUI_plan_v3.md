# Agent Statistics Breakout UI - Plan v3 (Fix)

## Issue

The "Agent Throughput Over Time" chart only shows sessions that have throughput data. Sessions with NULL/missing token metrics are excluded from the chart entirely.

**Expected behavior:** All sessions should appear in the chart, with sessions lacking token data shown as zero throughput.

---

## Current Behavior

In `AgentThroughputChart.tsx`, line 167-170:

```typescript
// Sort by average throughput descending and take top 10 with data
const topSessions = sessionTotals
  .filter((s) => s.avgThroughput > 0)  // <-- PROBLEM: Filters out sessions with no data
  .slice(0, 10);
```

This filters out any session where `avgThroughput === 0`, which happens when:
1. Session has no queries with token data
2. All `tokens_per_second` values are NULL in the database

---

## Solution

1. **Remove the filter** that excludes sessions with zero throughput
2. **Sort by total queries** instead of average throughput (so most active sessions appear regardless of token data)
3. **Handle zero values** gracefully in the chart (show points at y=0)

---

## Changes Required

### File: `src/renderer/components/UsageDashboard/AgentThroughputChart.tsx`

#### Change 1: Sort by query count, not throughput

```typescript
// Before (line 166-170)
sessionTotals.sort((a, b) => b.avgThroughput - a.avgThroughput);
const topSessions = sessionTotals
  .filter((s) => s.avgThroughput > 0)
  .slice(0, 10);

// After
sessionTotals.sort((a, b) => b.totalQueries - a.totalQueries);
const topSessions = sessionTotals
  .slice(0, 10);  // No filter - include all sessions
```

#### Change 2: Show data points at zero (optional visual indicator)

Keep the existing logic that skips rendering circles for zero values, OR change it to show them as smaller/dimmer points. The line will still connect through zero-value points.

#### Change 3: Handle line paths for zero values

Currently, line paths skip zero values. Change to include them so lines draw through zero points:

```typescript
// Before (line 285-290)
const pointsWithData = sessionDays
  .map((day, idx) => ({ day, idx }))
  .filter((p) => p.day.avgTokensPerSecond > 0);  // Skips zeros

// After - include all points
const allPoints = sessionDays.map((day, idx) => ({ day, idx }));
```

---

## Implementation Steps

1. Remove `.filter((s) => s.avgThroughput > 0)` from session selection
2. Sort by `totalQueries` descending to show most active sessions
3. Include zero-value points in line paths
4. Optionally show zero-value data points as smaller circles

---

## Visual Result

Before:
- Chart shows 3 sessions (only those with token data)

After:
- Chart shows up to 10 sessions (most active by query count)
- Sessions without token data appear as flat lines at y=0
- Sessions with partial data show lines that dip to zero on days without data

---

## Status

**Ready for Implementation**
