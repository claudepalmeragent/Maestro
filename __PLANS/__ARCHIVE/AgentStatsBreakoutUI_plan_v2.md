# Agent Statistics Breakout UI - Plan v2 (Fix)

## Issue

The "Agent Throughput Over Time" chart is currently grouped by **agent type** (e.g., "claude-code", "cursor", "aider") instead of by **agent name** (individual Maestro sessions like "my-project", "backend-api").

The user wants the throughput chart to match the "Agent Usage Over Time" chart above it, which shows one line per Maestro session (named agent).

---

## Current State

**AgentThroughputChart.tsx** uses:
- Data source: `data.byAgentByDay` (grouped by agent TYPE)
- Lines: One per agent type (claude-code, cursor, etc.)

**AgentUsageChart.tsx** uses:
- Data source: `data.bySessionByDay` (grouped by session ID)
- Lines: One per Maestro session (with session name lookup)

---

## Solution

Change `AgentThroughputChart` to use `bySessionByDay` instead of `byAgentByDay`.

### Problem: bySessionByDay lacks token metrics

Current `bySessionByDay` structure:
```typescript
Record<string, Array<{ date: string; count: number; duration: number }>>
```

**Missing**: `outputTokens` and `avgTokensPerSecond`

### Required Changes

#### 1. Backend: Extend `bySessionByDay` Query

**File:** `src/main/stats-db.ts`

Add token metrics to the bySessionByDay SQL query:

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

#### 2. Types: Update `bySessionByDay` Type

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

#### 3. Frontend: Update AgentThroughputChart

**File:** `src/renderer/components/UsageDashboard/AgentThroughputChart.tsx`

- Change data source from `byAgentByDay` to `bySessionByDay`
- Add `sessions` prop for session ID to name mapping
- Rename internal variables for clarity (agent → session)
- Use `getSessionDisplayName()` for legend labels

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/main/stats-db.ts` | Add token metrics to bySessionByDay query |
| `src/shared/stats-types.ts` | Update bySessionByDay type |
| `src/renderer/hooks/useStats.ts` | Update bySessionByDay interface |
| `src/renderer/components/UsageDashboard/AgentThroughputChart.tsx` | Use bySessionByDay, add sessions prop |
| `src/renderer/components/UsageDashboard/UsageDashboardModal.tsx` | Pass sessions to AgentThroughputChart |

---

## Implementation Order

1. Extend database query for bySessionByDay
2. Update type definitions
3. Update AgentThroughputChart component
4. Pass sessions prop in UsageDashboardModal
5. Test and commit

---

## Status

**Ready for Implementation**
