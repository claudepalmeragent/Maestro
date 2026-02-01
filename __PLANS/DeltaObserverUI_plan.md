# Delta Observer UI Integration Plan

## Overview

This plan adds performance metrics (tokens/second, per-request timing) to the Maestro UI, exposing the statistics already tracked by the Delta Observer system.

## Current State

The codebase already tracks:
- **Per-request timing**: `startTime`, `duration` in `QueryEvent`
- **Real-time cycle metrics**: `currentCycleTokens`, `currentCycleBytes`, `thinkingStartTime` in Session
- **Cumulative token stats**: `UsageStats` (inputTokens, outputTokens, etc.)

What's **missing**:
1. Per-request token counts aren't recorded in `QueryEvent` (only timing)
2. Tokens/second calculation isn't computed or displayed
3. Usage Dashboard doesn't show throughput metrics

---

## Implementation Phases

### Phase 1: Extend Types with Token Metrics

**File:** `src/shared/stats-types.ts`

Extend `QueryEvent` to include token metrics:
```typescript
export interface QueryEvent {
  // ... existing fields ...

  // NEW: Token metrics for this specific request
  inputTokens?: number;        // Tokens sent in this request
  outputTokens?: number;       // Tokens received in response
  tokensPerSecond?: number;    // Calculated: outputTokens / (duration/1000)
}
```

Extend `StatsAggregation` to include throughput metrics:
```typescript
export interface StatsAggregation {
  // ... existing fields ...

  // NEW: Throughput metrics
  totalOutputTokens: number;        // Sum of all outputTokens
  avgTokensPerSecond: number;       // Aggregate throughput
  avgOutputTokensPerQuery: number;  // Average response size
}
```

### Phase 2: Database Schema Migration

**File:** `src/main/stats-db.ts`

Add columns to `query_events` table:
- `input_tokens INTEGER`
- `output_tokens INTEGER`
- `tokens_per_second REAL`

Increment `STATS_DB_VERSION` from 3 to 4.

Add migration logic to alter existing table.

### Phase 3: Capture Token Metrics When Recording Queries

**File:** `src/renderer/App.tsx`

When recording a query on process exit, capture the final token counts from the tab's usage stats:
```typescript
window.maestro.stats.recordQuery({
  // ... existing fields ...
  inputTokens: tabUsageStats?.inputTokens,
  outputTokens: tabUsageStats?.outputTokens,
  tokensPerSecond: outputTokens && duration > 0
    ? outputTokens / (duration / 1000)
    : undefined,
});
```

**File:** `src/main/ipc/handlers/stats.ts`

Update the `stats:record-query` handler to accept and store the new fields.

### Phase 4: Usage Dashboard Throughput Metrics

**File:** `src/renderer/components/UsageDashboard/UsageDashboardModal.tsx`

Add new summary cards in the Overview tab:
- **Avg Throughput**: Shows `avgTokensPerSecond` tok/s
- **Total Tokens**: Shows `totalOutputTokens` generated
- **Avg Response**: Shows `avgOutputTokensPerQuery` tokens per query

Update the `SummaryCards` component to display these metrics.

### Phase 5: Real-Time Throughput Display in Chat UI

**File:** `src/renderer/components/InputArea.tsx` or related component

During active AI requests (when `session.state === 'busy'`), show live throughput:
```
⚡ 45.2 tok/s | 1,234 tokens | 27.3s elapsed
```

Calculate from existing session state:
```typescript
const elapsedMs = Date.now() - session.thinkingStartTime;
const tokensPerSecond = session.currentCycleTokens / (elapsedMs / 1000);
```

---

## Data Flow

```
Agent Process (streaming response)
    ↓
useBatchedSessionUpdates.updateCycleTokens() - real-time accumulation
    ↓
Session state (currentCycleTokens, thinkingStartTime)
    ↓
UI shows live throughput during streaming (Phase 5)
    ↓
On completion: App.tsx recordQuery() with final token counts (Phase 3)
    ↓
stats-db.ts persists QueryEvent with tokens (Phase 2)
    ↓
Usage Dashboard aggregates: avgTokensPerSecond, totalOutputTokens (Phase 4)
```

---

## Files to Modify

| File | Changes | Phase |
|------|---------|-------|
| `src/shared/stats-types.ts` | Add token fields to QueryEvent and StatsAggregation | 1 |
| `src/main/stats-db.ts` | Schema migration, insert/query updates | 2 |
| `src/main/ipc/handlers/stats.ts` | Accept new fields in record-query | 3 |
| `src/renderer/App.tsx` | Pass token metrics to recordQuery | 3 |
| `src/renderer/components/UsageDashboard/UsageDashboardModal.tsx` | Add throughput cards | 4 |
| `src/renderer/components/InputArea.tsx` | Real-time throughput display | 5 |

---

## Success Criteria

1. **Data Capture**: Every query records inputTokens, outputTokens, tokensPerSecond
2. **Dashboard Display**: Usage Dashboard shows avg throughput and total tokens
3. **Real-Time Display**: Active requests show live tokens/second
4. **Backward Compatibility**: Existing queries without token data display gracefully
5. **Performance**: No impact on streaming performance or UI responsiveness

---

## Risk Mitigation

- **Schema Migration**: Use ALTER TABLE ADD COLUMN (SQLite supports this safely)
- **Missing Data**: All new fields are optional - old queries show "N/A"
- **UI Overflow**: Format large token counts with locale formatting (1,234,567)
- **Division by Zero**: Guard against zero duration when calculating tokens/second
