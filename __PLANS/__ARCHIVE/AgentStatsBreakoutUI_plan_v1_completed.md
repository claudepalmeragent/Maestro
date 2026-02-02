# Agent Statistics Breakout UI - Implementation Complete

## Summary

Successfully implemented enhanced metrics and throughput visualization for the Agents tab in the Usage Dashboard.

---

## Features Implemented

### 1. Query-Based Summary Cards

Added 4 new summary cards at the top of the Agent Statistics section:

| Card | Value | Source |
|------|-------|--------|
| **TOTAL TIME** | Cumulative duration (e.g., "4h 32m") | Sum of `byAgent[*].duration` |
| **AVG DURATION** | Average query duration (e.g., "1m 23s") | `totalTime / totalQueries` |
| **TOTAL TOKENS** | Output tokens (e.g., "1.2M") | Sum of `byAgent[*].totalOutputTokens` |
| **AVG THROUGHPUT** | Weighted avg tok/s (e.g., "52.3 tok/s") | Weighted by query count |

### 2. Agent Throughput Over Time Chart

Created a new line chart showing throughput trends per agent type:

- One line per agent type (top 10 by average throughput)
- Y-axis: Average throughput in tok/s
- X-axis: Dates (formatted based on time range)
- Color-coded lines with legend
- Hover tooltips showing exact values
- Colorblind mode support via `COLORBLIND_AGENT_PALETTE`
- Empty state when no throughput data available

---

## Files Modified

| File | Changes |
|------|---------|
| `src/main/stats-db.ts` | Extended `byAgent` and `byAgentByDay` SQL queries to include `totalOutputTokens` and `avgTokensPerSecond` |
| `src/shared/stats-types.ts` | Updated type definitions for `byAgent` and `byAgentByDay` |
| `src/renderer/hooks/useStats.ts` | Updated `StatsAggregation` interface to match new types |
| `src/renderer/components/UsageDashboard/SessionStats.tsx` | Added `data` prop, computed metrics, and rendered new summary cards |
| `src/renderer/components/UsageDashboard/AgentThroughputChart.tsx` | **NEW** - 430-line chart component |
| `src/renderer/components/UsageDashboard/UsageDashboardModal.tsx` | Imported chart, added section, passed `data` to SessionStats |

---

## Backend Changes

### Extended `byAgent` Query

```sql
SELECT agent_type,
       COUNT(*) as count,
       SUM(duration) as duration,
       COALESCE(SUM(output_tokens), 0) as total_output_tokens,
       COALESCE(AVG(CASE WHEN output_tokens IS NOT NULL THEN tokens_per_second END), 0) as avg_tokens_per_second
FROM query_events
WHERE start_time >= ?
GROUP BY agent_type
```

### Extended `byAgentByDay` Query

```sql
SELECT agent_type,
       date(start_time / 1000, 'unixepoch', 'localtime') as date,
       COUNT(*) as count,
       SUM(duration) as duration,
       COALESCE(SUM(output_tokens), 0) as output_tokens,
       COALESCE(AVG(CASE WHEN output_tokens IS NOT NULL THEN tokens_per_second END), 0) as avg_tokens_per_second
FROM query_events
WHERE start_time >= ?
GROUP BY agent_type, date(...)
ORDER BY agent_type, date ASC
```

---

## Type Definitions Updated

```typescript
// byAgent now includes token metrics
byAgent: Record<string, {
  count: number;
  duration: number;
  totalOutputTokens: number;
  avgTokensPerSecond: number;
}>;

// byAgentByDay now includes token metrics per day
byAgentByDay: Record<string, Array<{
  date: string;
  count: number;
  duration: number;
  outputTokens: number;
  avgTokensPerSecond: number;
}>>;
```

---

## UI Layout

### Agent Statistics Section (Updated)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Agent Statistics                              │
├────────────────┬────────────────┬────────────────┬──────────────────┤
│  TOTAL TIME    │  AVG DURATION  │  TOTAL TOKENS  │  AVG THROUGHPUT  │
│  4h 32m 15s    │  1m 23s        │  1.2M          │  52.3 tok/s      │
├────────────────┴────────────────┴────────────────┴──────────────────┤
│  Total Agents: 12 (3 bookmarked)                                    │
│  Git Repositories: 8 (2 worktrees)                                  │
│  ...                                                                 │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│            Agent Throughput Over Time                                │
│  [Line chart with one line per agent type showing tok/s over time]  │
│                                                                      │
│  Legend: ● claude-code  ● cursor  ● aider  ...                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Keyboard Navigation

Added `'agent-throughput'` to the `AGENTS_SECTIONS` array for keyboard navigation support. Section label added to `getSectionLabel()` function.

---

## Verification Checklist

- [x] Summary cards show TOTAL TIME, AVG DURATION, TOTAL TOKENS, AVG THROUGHPUT
- [x] Cards display "N/A" gracefully when no token data available
- [x] Cards update when time range changes
- [x] Throughput chart shows one line per agent type
- [x] Chart limits to top 10 agents by average throughput
- [x] Lines are color-coded with legend
- [x] Hover tooltip shows agent name and throughput value
- [x] Colorblind mode support
- [x] Empty state when no throughput data
- [x] Keyboard navigation includes new section

---

## Commit

```
d0979299 feat: add agent metrics summary cards and throughput chart to Agents tab
```

---

## Status

**Complete** - Implementation committed and ready for testing.
