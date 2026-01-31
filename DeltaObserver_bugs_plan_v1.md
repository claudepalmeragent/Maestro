# Delta Observer UI Fixes - Diagnosis and Plan v1

## Issues Diagnosed

### Issue 1: AVG THROUGHPUT and TOTAL TOKENS Show "N/A"

**Root Cause:** The `StatsAggregation` interface in `src/renderer/hooks/useStats.ts` (lines 23-41) is missing the new token metrics fields that were added to the backend.

The backend (`src/main/stats-db.ts`) correctly returns these fields in `getAggregatedStats()`:
```typescript
totalOutputTokens: tokenMetrics.total_output_tokens,
totalInputTokens: tokenMetrics.total_input_tokens,
avgTokensPerSecond: Math.round(tokenMetrics.avg_tokens_per_second * 10) / 10,
avgOutputTokensPerQuery: Math.round(tokenMetrics.avg_output_tokens),
queriesWithTokenData: tokenMetrics.queries_with_data,
```

But the frontend `StatsAggregation` interface in `useStats.ts` doesn't include these fields:
```typescript
// Missing from interface:
// totalOutputTokens: number;
// totalInputTokens: number;
// avgTokensPerSecond: number;
// avgOutputTokensPerQuery: number;
// queriesWithTokenData: number;
```

**Result:** TypeScript treats these as `undefined`, so `data.avgTokensPerSecond` is falsy and displays "N/A".

---

### Issue 2: Summary Cards Layout is 3 Columns (Not 4)

**Root Cause:** The `summaryCardsCols` calculation in `UsageDashboardModal.tsx` (line 323) is hardcoded to 3:
```typescript
summaryCardsCols: isNarrow ? 2 : 3,
```

With 8 metrics and 3 columns, the grid becomes:
- Row 1: Sessions, Total Queries, Total Time (3 items)
- Row 2: Avg Duration, Avg Throughput, Total Tokens (3 items)
- Row 3: Top Agent, Interactive % (2 items)

This matches the user's observation: "two columns of three items each, and one column of two items."

**Fix:** Change to 4 columns for 8 metrics (2 rows x 4 cols):
```typescript
summaryCardsCols: isNarrow ? 2 : isMedium ? 3 : 4,
```

Also update the SummaryCards default in `SummaryCards.tsx` from `columns = 3` to `columns = 4`.

---

### Issue 3: Missing Throughput Trends Graph

**Root Cause:** No chart exists for throughput/tokens over time.

The DurationTrendsChart shows duration trends using `data.byDay` which contains `{ date, count, duration }` per day, but lacks token metrics.

**Required:**
1. Add per-day token metrics to the database aggregation query
2. Add `byDay` token fields to `StatsAggregation` interface
3. Create a new `ThroughputTrendsChart` component with dual Y-axes

---

## Implementation Plan

### Phase 1: Fix StatsAggregation Interface (Frontend Type Sync)

**File:** `src/renderer/hooks/useStats.ts`

Add missing token metrics fields to `StatsAggregation` interface:

```typescript
export interface StatsAggregation {
  // ... existing fields ...

  // Token metrics for throughput statistics
  totalOutputTokens: number;
  totalInputTokens: number;
  avgTokensPerSecond: number;
  avgOutputTokensPerQuery: number;
  queriesWithTokenData: number;
}
```

---

### Phase 2: Fix Summary Cards Column Layout

**File:** `src/renderer/components/UsageDashboard/UsageDashboardModal.tsx`

Update `summaryCardsCols` calculation (around line 323):
```typescript
// Before:
summaryCardsCols: isNarrow ? 2 : 3,

// After:
summaryCardsCols: isNarrow ? 2 : isMedium ? 3 : 4,
```

**File:** `src/renderer/components/UsageDashboard/SummaryCards.tsx`

Update default columns prop:
```typescript
// Before:
export function SummaryCards({ data, theme, columns = 3 }: SummaryCardsProps) {

// After:
export function SummaryCards({ data, theme, columns = 4 }: SummaryCardsProps) {
```

---

### Phase 3: Add Per-Day Token Metrics to Database Query

**File:** `src/main/stats-db.ts`

Extend the `byDay` query in `getAggregatedStats()` to include token metrics:

```sql
SELECT date(start_time / 1000, 'unixepoch', 'localtime') as date,
       COUNT(*) as count,
       SUM(duration) as duration,
       COALESCE(SUM(output_tokens), 0) as output_tokens,
       COALESCE(AVG(CASE WHEN output_tokens IS NOT NULL THEN tokens_per_second END), 0) as avg_tokens_per_second
FROM query_events
WHERE start_time >= ?
GROUP BY date(start_time / 1000, 'unixepoch', 'localtime')
ORDER BY date ASC
```

Update the return type of `byDay` in the stats aggregation.

---

### Phase 4: Extend StatsAggregation Types for byDay Token Metrics

**File:** `src/shared/stats-types.ts`

Extend the `byDay` type to include token metrics:
```typescript
byDay: Array<{
  date: string;
  count: number;
  duration: number;
  outputTokens?: number;
  avgTokensPerSecond?: number;
}>;
```

**File:** `src/renderer/hooks/useStats.ts`

Sync the frontend interface with the updated backend type.

---

### Phase 5: Create ThroughputTrendsChart Component

**File:** `src/renderer/components/UsageDashboard/ThroughputTrendsChart.tsx` (NEW)

Create a dual-axis line chart similar to `DurationTrendsChart.tsx`:

Features:
- **Left Y-axis:** Avg Throughput (tok/s) - line color: accent/primary
- **Right Y-axis:** Total Output Tokens - line color: secondary/warning
- **X-axis:** Date (same formatting as DurationTrendsChart)
- **Tooltip:** Shows date, throughput, total tokens on hover
- **Smoothing toggle:** Moving average support (like DurationTrendsChart)
- **Colorblind mode support:** Use COLORBLIND_LINE_COLORS

Chart structure (dual Y-axis):
```
tok/s │                                    │ Tokens
  60  │    ╭──────╮        ╭╮              │ 100K
  40  │   ╱      ╲       ╱  ╲             │ 66K
  20  │ ──╯        ╲ ────╯    ╲──         │ 33K
   0  ├───────────────────────────────────│ 0
      Jan    Feb    Mar    Apr    May
```

SVG structure:
1. Gradient definition for area fill (two gradients, one per series)
2. Grid lines (horizontal for both Y scales)
3. Left Y-axis labels (tok/s)
4. Right Y-axis labels (Tokens)
5. X-axis labels (dates)
6. Two line paths (throughput and tokens)
7. Two area fills (under each line)
8. Interactive data points with tooltips

---

### Phase 6: Integrate ThroughputTrendsChart into Dashboard

**File:** `src/renderer/components/UsageDashboard/UsageDashboardModal.tsx`

Add the ThroughputTrendsChart below the DurationTrendsChart in the Overview tab:

```tsx
{/* Duration Trends Chart */}
<div ref={setSectionRef('duration-trends')} ...>
  <ChartErrorBoundary theme={theme} chartName="Duration Trends">
    <DurationTrendsChart data={data} timeRange={timeRange} theme={theme} colorBlindMode={colorBlindMode} />
  </ChartErrorBoundary>
</div>

{/* NEW: Throughput Trends Chart */}
<div ref={setSectionRef('throughput-trends')} ...>
  <ChartErrorBoundary theme={theme} chartName="Throughput Trends">
    <ThroughputTrendsChart data={data} timeRange={timeRange} theme={theme} colorBlindMode={colorBlindMode} />
  </ChartErrorBoundary>
</div>
```

Add keyboard navigation support for the new section.

---

## Files to Modify

| File | Phase | Changes |
|------|-------|---------|
| `src/renderer/hooks/useStats.ts` | 1, 4 | Add token metrics to StatsAggregation interface |
| `src/renderer/components/UsageDashboard/UsageDashboardModal.tsx` | 2, 6 | Fix summaryCardsCols, add ThroughputTrendsChart |
| `src/renderer/components/UsageDashboard/SummaryCards.tsx` | 2 | Change default columns from 3 to 4 |
| `src/main/stats-db.ts` | 3 | Extend byDay query with token metrics |
| `src/shared/stats-types.ts` | 4 | Extend byDay array type with token fields |
| `src/renderer/components/UsageDashboard/ThroughputTrendsChart.tsx` | 5 | NEW: Dual-axis throughput chart |

---

## Testing Plan

1. **Type Check:** Run `npm run typecheck` to verify interface consistency
2. **N/A Fix:** Open Usage Dashboard, verify Avg Throughput and Total Tokens show values
3. **Layout Fix:** Verify Summary Cards display in 4-column grid (2 rows x 4 cols)
4. **Chart:** Verify ThroughputTrendsChart renders with dual Y-axes
5. **Hover:** Verify tooltips show correct throughput/token values
6. **Smoothing:** Verify toggle works on throughput chart
7. **Empty State:** Verify chart handles missing token data gracefully

---

## Estimated Scope

- 6 files modified
- 1 new file created
- ~400 lines of new code (mostly ThroughputTrendsChart component)
- Database query already captures token data, just needs byDay extension
