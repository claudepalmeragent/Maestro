# Agent Statistics Breakout UI v2 - Implementation Complete

## Summary

Fixed the "Agent Throughput Over Time" chart to show data by **individual session name** instead of by **agent type**.

---

## Issue

The throughput chart was grouping data by agent type (e.g., "Claude Code", "Cursor", "Aider") instead of by individual Maestro session names (e.g., "my-project", "backend-api"), which didn't match the "Agent Usage Over Time" chart above it.

---

## Solution

Changed the chart to use `bySessionByDay` data (grouped by session ID) instead of `byAgentByDay` (grouped by agent type), matching the behavior of the "Agent Usage Over Time" chart.

---

## Changes Made

### 1. Backend: Extended `bySessionByDay` Query

**File:** `src/main/stats-db.ts`

Added token metrics to the bySessionByDay SQL query:

```sql
SELECT session_id,
       date(start_time / 1000, 'unixepoch', 'localtime') as date,
       COUNT(*) as count,
       SUM(duration) as duration,
       COALESCE(SUM(output_tokens), 0) as output_tokens,
       COALESCE(AVG(CASE WHEN output_tokens IS NOT NULL THEN tokens_per_second END), 0) as avg_tokens_per_second
FROM query_events
WHERE start_time >= ?
GROUP BY session_id, date(...)
ORDER BY session_id, date ASC
```

### 2. Types: Updated `bySessionByDay`

**Files:** `src/shared/stats-types.ts`, `src/renderer/hooks/useStats.ts`

```typescript
// Before
bySessionByDay: Record<string, Array<{ date: string; count: number; duration: number }>>;

// After
bySessionByDay: Record<string, Array<{
  date: string;
  count: number;
  duration: number;
  outputTokens: number;
  avgTokensPerSecond: number;
}>>;
```

### 3. Frontend: Updated AgentThroughputChart

**File:** `src/renderer/components/UsageDashboard/AgentThroughputChart.tsx`

- Changed data source from `byAgentByDay` to `bySessionByDay`
- Added `sessions` prop for session ID to name mapping
- Renamed internal variables (agent → session) for clarity
- Added `getSessionDisplayName()` function (matching AgentUsageChart)
- Updated header subtitle from "tok/s by agent type" to "tok/s by agent"

### 4. Integration: Pass sessions prop

**File:** `src/renderer/components/UsageDashboard/UsageDashboardModal.tsx`

Added `sessions={sessions}` prop to AgentThroughputChart.

---

## Before vs After

### Before
Chart showed lines for:
- Claude Code
- Cursor
- Aider

### After
Chart shows lines for:
- my-project
- backend-api
- frontend-ui
- (individual session names from left panel)

---

## Verification

- [x] Chart uses bySessionByDay data
- [x] Session names display correctly (or UUID prefix as fallback)
- [x] Top 10 sessions by average throughput selected
- [x] Legend shows session names
- [x] Tooltips show session names
- [x] Matches behavior of Agent Usage Over Time chart above

---

## Commit

```
c30c931e fix: show throughput by session name instead of agent type
```

---

## Status

**Complete** - Implementation committed and ready for testing.
