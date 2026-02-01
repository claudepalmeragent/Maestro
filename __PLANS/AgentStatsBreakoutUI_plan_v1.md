# Agent Statistics Breakout UI - Implementation Plan v1

## Overview

Add enhanced metrics and throughput visualization to the Agents tab of the Usage Dashboard:

1. **Summary Cards**: Add TOTAL TIME, AVG DURATION, TOTAL TOKENS, AVG THROUGHPUT metrics to the top Agent Statistics section
2. **Throughput Chart**: Create a new "Agent Throughput Over Time" graph showing AVG THROUGHPUT per agent over time

---

## Current State Analysis

### Existing Agents Tab Structure

**File:** `src/renderer/components/UsageDashboard/UsageDashboardModal.tsx` (lines 928-1011)

Current sections:
1. **Agent Statistics** (`SessionStats.tsx`) - Shows session-based metrics (Total Agents, Git Repos, Plain Folders, Local/Remote)
2. **Provider Comparison Chart** (`AgentComparisonChart.tsx`) - Bar chart comparing query counts by agent type
3. **Agent Usage Over Time** (`AgentUsageChart.tsx`) - Line chart showing queries/time per session over time

### Data Currently Available

**`byAgent`** (per agent type):
```typescript
Record<string, { count: number; duration: number }>
```
- Has query count and total duration
- **Missing**: Token metrics (outputTokens, avgTokensPerSecond)

**`byAgentByDay`** (per agent type, per day):
```typescript
Record<string, Array<{ date: string; count: number; duration: number }>>
```
- Has daily query count and duration per agent
- **Missing**: Token metrics for throughput chart

### Gap Analysis

To implement the requested features, we need to:

1. **Extend `byAgent`** to include token metrics:
   - `totalOutputTokens`
   - `avgTokensPerSecond`

2. **Extend `byAgentByDay`** to include token metrics:
   - `outputTokens`
   - `avgTokensPerSecond`

3. **Create new UI components**:
   - Summary cards for agent-level metrics
   - New throughput line chart (similar to `ThroughputTrendsChart.tsx`)

---

## Implementation Plan

### Phase 1: Backend - Extend Database Queries

**File:** `src/main/stats-db.ts`

#### 1.1 Extend `byAgent` Query (line 1415)

**Current:**
```sql
SELECT agent_type, COUNT(*) as count, SUM(duration) as duration
FROM query_events
WHERE start_time >= ?
GROUP BY agent_type
```

**New:**
```sql
SELECT
  agent_type,
  COUNT(*) as count,
  SUM(duration) as duration,
  SUM(COALESCE(output_tokens, 0)) as total_output_tokens,
  AVG(CASE WHEN tokens_per_second IS NOT NULL THEN tokens_per_second END) as avg_tokens_per_second
FROM query_events
WHERE start_time >= ?
GROUP BY agent_type
```

#### 1.2 Extend `byAgentByDay` Query (line 1500)

**Current:**
```sql
SELECT agent_type,
       date(start_time / 1000, 'unixepoch', 'localtime') as date,
       COUNT(*) as count,
       SUM(duration) as duration
FROM query_events
WHERE start_time >= ?
GROUP BY agent_type, date(...)
ORDER BY agent_type, date ASC
```

**New:**
```sql
SELECT
  agent_type,
  date(start_time / 1000, 'unixepoch', 'localtime') as date,
  COUNT(*) as count,
  SUM(duration) as duration,
  SUM(COALESCE(output_tokens, 0)) as output_tokens,
  AVG(CASE WHEN tokens_per_second IS NOT NULL THEN tokens_per_second END) as avg_tokens_per_second
FROM query_events
WHERE start_time >= ?
GROUP BY agent_type, date(start_time / 1000, 'unixepoch', 'localtime')
ORDER BY agent_type, date ASC
```

---

### Phase 2: Type Definitions

**File:** `src/shared/stats-types.ts`

#### 2.1 Extend `byAgent` Type

```typescript
// Before
byAgent: Record<string, { count: number; duration: number }>;

// After
byAgent: Record<string, {
  count: number;
  duration: number;
  totalOutputTokens: number;
  avgTokensPerSecond: number;
}>;
```

#### 2.2 Extend `byAgentByDay` Type

```typescript
// Before
byAgentByDay: Record<string, Array<{ date: string; count: number; duration: number }>>;

// After
byAgentByDay: Record<string, Array<{
  date: string;
  count: number;
  duration: number;
  outputTokens: number;
  avgTokensPerSecond: number;
}>>;
```

**File:** `src/renderer/hooks/useStats.ts`

Update the `StatsAggregation` interface to match the new types.

---

### Phase 3: Frontend - Agent Statistics Summary Cards

**File:** `src/renderer/components/UsageDashboard/SessionStats.tsx`

#### 3.1 Add New Props

The component needs access to `data` (StatsAggregation) in addition to the existing `sessions` prop:

```typescript
interface SessionStatsProps {
  sessions: Session[];
  theme: Theme;
  colorblindMode: boolean;
  data: StatsAggregation;  // Add this prop
}
```

#### 3.2 Add Summary Cards Section

Add 4 new summary cards at the top of the Agent Statistics section:

| Card | Label | Value Source | Format |
|------|-------|--------------|--------|
| 1 | TOTAL TIME | Sum of `byAgent[*].duration` | `formatDuration()` |
| 2 | AVG DURATION | `totalDuration / totalQueries` from byAgent | `formatDuration()` |
| 3 | TOTAL TOKENS | Sum of `byAgent[*].totalOutputTokens` | `formatNumber()` with K/M suffix |
| 4 | AVG THROUGHPUT | Weighted avg of `byAgent[*].avgTokensPerSecond` | `XX.X tok/s` |

**Card Layout:**
```tsx
<div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
  <SummaryCard label="TOTAL TIME" value={formatDuration(totalTime)} />
  <SummaryCard label="AVG DURATION" value={formatDuration(avgDuration)} />
  <SummaryCard label="TOTAL TOKENS" value={formatTokensCompact(totalTokens)} />
  <SummaryCard label="AVG THROUGHPUT" value={`${avgThroughput.toFixed(1)} tok/s`} />
</div>
```

#### 3.3 Compute Metrics

```typescript
const agentMetrics = useMemo(() => {
  const agents = Object.values(data.byAgent || {});

  const totalTime = agents.reduce((sum, a) => sum + a.duration, 0);
  const totalQueries = agents.reduce((sum, a) => sum + a.count, 0);
  const avgDuration = totalQueries > 0 ? totalTime / totalQueries : 0;

  const totalTokens = agents.reduce((sum, a) => sum + (a.totalOutputTokens || 0), 0);

  // Weighted average throughput (by query count)
  const weightedThroughput = agents.reduce((sum, a) => {
    return sum + (a.avgTokensPerSecond || 0) * a.count;
  }, 0);
  const avgThroughput = totalQueries > 0 ? weightedThroughput / totalQueries : 0;

  return { totalTime, avgDuration, totalTokens, avgThroughput };
}, [data.byAgent]);
```

---

### Phase 4: Frontend - Agent Throughput Chart

**File:** `src/renderer/components/UsageDashboard/AgentThroughputChart.tsx` (NEW)

Create a new chart component similar to `ThroughputTrendsChart.tsx` and `AgentUsageChart.tsx`.

#### 4.1 Component Structure

```typescript
interface AgentThroughputChartProps {
  data: StatsAggregation;
  theme: Theme;
  colorblindMode: boolean;
  range: 'day' | 'week' | 'month' | 'year' | 'all';
}
```

#### 4.2 Data Processing

```typescript
const { agents, chartData, allDates } = useMemo(() => {
  const byAgentByDay = data.byAgentByDay || {};

  // Get all unique agents sorted by total throughput (descending)
  const agentTotals = Object.keys(byAgentByDay).map(agent => {
    const days = byAgentByDay[agent];
    const avgThroughput = days.reduce((sum, d) => sum + (d.avgTokensPerSecond || 0), 0) / days.length;
    return { agent, avgThroughput };
  });

  const topAgents = agentTotals
    .sort((a, b) => b.avgThroughput - a.avgThroughput)
    .slice(0, 10)
    .map(a => a.agent);

  // Build chart data matrix (date x agent -> avgTokensPerSecond)
  const allDatesSet = new Set<string>();
  for (const agent of topAgents) {
    for (const day of byAgentByDay[agent]) {
      allDatesSet.add(day.date);
    }
  }
  const allDates = Array.from(allDatesSet).sort();

  // Create data structure for rendering
  const chartData = allDates.map(date => {
    const point: Record<string, number> = { date };
    for (const agent of topAgents) {
      const dayData = byAgentByDay[agent]?.find(d => d.date === date);
      point[agent] = dayData?.avgTokensPerSecond || 0;
    }
    return point;
  });

  return { agents: topAgents, chartData, allDates };
}, [data.byAgentByDay]);
```

#### 4.3 Chart Rendering

Similar to existing charts:
- SVG-based line chart
- One line per agent type (color-coded)
- Y-axis: tok/s (0 to max + padding)
- X-axis: dates (formatted based on range)
- Hover tooltips showing agent name and throughput
- Legend showing agent types with colors
- Colorblind mode support

#### 4.4 Visual Design

```
┌─────────────────────────────────────────────────────────────┐
│  Agent Throughput Over Time                                 │
├─────────────────────────────────────────────────────────────┤
│  80 tok/s ┤                                                 │
│           │                    ╭──╮                         │
│  60 tok/s ┤      ╭────╮      ╱    ╲                        │
│           │     ╱      ╲────╱      ╲──── claude-code       │
│  40 tok/s ┤    ╱                       ╲                   │
│           │   ╱    ╭────────────────────╲── cursor         │
│  20 tok/s ┤  ╱    ╱                      ╲                 │
│           │ ╱____╱________________________╲___ aider       │
│   0 tok/s ┼──────────────────────────────────────────────  │
│           Jan 20  Jan 22  Jan 24  Jan 26  Jan 28  Jan 30   │
└─────────────────────────────────────────────────────────────┘
```

---

### Phase 5: Integration

**File:** `src/renderer/components/UsageDashboard/UsageDashboardModal.tsx`

#### 5.1 Import New Component

```typescript
import { AgentThroughputChart } from './AgentThroughputChart';
```

#### 5.2 Update SessionStats Props

Pass `data` to SessionStats:

```tsx
// Around line 933
<SessionStats
  sessions={sessions}
  theme={theme}
  colorblindMode={colorblindMode}
  data={data}  // Add this
/>
```

#### 5.3 Add Throughput Chart Section

Add after the existing "Agent Usage Over Time" section (around line 1005):

```tsx
{/* Agent Throughput Over Time - shows avg tok/s per agent by day */}
<div className="mt-6">
  <AgentThroughputChart
    data={data}
    theme={theme}
    colorblindMode={colorblindMode}
    range={range}
  />
</div>
```

---

## Files to Modify/Create

| File | Action | Changes |
|------|--------|---------|
| `src/main/stats-db.ts` | Modify | Extend byAgent and byAgentByDay SQL queries |
| `src/shared/stats-types.ts` | Modify | Add token fields to byAgent and byAgentByDay types |
| `src/renderer/hooks/useStats.ts` | Modify | Update StatsAggregation interface |
| `src/renderer/components/UsageDashboard/SessionStats.tsx` | Modify | Add data prop, add summary cards |
| `src/renderer/components/UsageDashboard/AgentThroughputChart.tsx` | Create | New throughput chart component |
| `src/renderer/components/UsageDashboard/UsageDashboardModal.tsx` | Modify | Pass data to SessionStats, add throughput chart |

---

## Implementation Order

1. **Backend first**: Extend database queries to return token metrics per agent
2. **Types**: Update TypeScript interfaces
3. **SessionStats**: Add summary cards (can test immediately with new data)
4. **AgentThroughputChart**: Create new chart component
5. **Integration**: Wire everything together in UsageDashboardModal
6. **Testing**: Verify all metrics display correctly

---

## Testing Checklist

### Summary Cards
- [ ] TOTAL TIME shows cumulative duration across all agent types
- [ ] AVG DURATION shows average query duration (total time / total queries)
- [ ] TOTAL TOKENS shows sum of output tokens across all agents
- [ ] AVG THROUGHPUT shows weighted average tok/s (N/A if no token data)
- [ ] Cards update when time range changes
- [ ] Cards show "N/A" gracefully when data is unavailable

### Throughput Chart
- [ ] Shows one line per agent type (top 10 by avg throughput)
- [ ] Lines are color-coded with legend
- [ ] Y-axis shows tok/s scale
- [ ] X-axis shows dates formatted for range
- [ ] Hover tooltip shows agent name and throughput value
- [ ] Colorblind mode changes line colors appropriately
- [ ] Empty state when no throughput data available
- [ ] Chart updates when time range changes

### Data Integrity
- [ ] Token metrics match what's stored in query_events table
- [ ] Averages are computed correctly (weighted by query count)
- [ ] Zero/null values handled gracefully
- [ ] Performance acceptable with large datasets

---

## Visual Mockup

### Agent Statistics Section (Updated)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Agent Statistics                              │
├────────────────┬────────────────┬────────────────┬──────────────────┤
│  TOTAL TIME    │  AVG DURATION  │  TOTAL TOKENS  │  AVG THROUGHPUT  │
│  4h 32m 15s    │  1m 23s        │  1.2M          │  52.3 tok/s      │
├────────────────┴────────────────┴────────────────┴──────────────────┤
│                                                                      │
│  Total Agents: 12 (3 bookmarked)                                    │
│  Git Repositories: 8 (2 worktrees)                                  │
│  Plain Folders: 4                                                    │
│  Local Agents: 10 (2 remote)                                        │
│                                                                      │
│  By Agent Type:                                                      │
│  ████████████████████████████░░░░░░  claude-code   45%  (5)         │
│  ██████████████████░░░░░░░░░░░░░░░░  cursor        30%  (3)         │
│  ████████░░░░░░░░░░░░░░░░░░░░░░░░░░  aider         15%  (2)         │
│  ████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  other         10%  (2)         │
└─────────────────────────────────────────────────────────────────────┘
```

### Agent Throughput Over Time (New Section)

```
┌─────────────────────────────────────────────────────────────────────┐
│            Agent Throughput Over Time                                │
│                                                                      │
│  80 ┤                     ╭─╮                                       │
│     │                    ╱   ╲          Legend:                     │
│  60 ┤      ╭────╮      ╱     ╲─────    ● claude-code               │
│     │     ╱      ╲────╱                 ● cursor                    │
│  40 ┤    ╱                              ● aider                     │
│     │   ╱    ╭──────────────────                                    │
│  20 ┤  ╱    ╱                                                       │
│     │ ╱____╱____________________________                            │
│   0 ┼───────────────────────────────────                            │
│     Jan 20   Jan 22   Jan 24   Jan 26   Jan 28   Jan 30             │
│                                                                      │
│  tok/s                                                               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Status

**Ready for Implementation**
