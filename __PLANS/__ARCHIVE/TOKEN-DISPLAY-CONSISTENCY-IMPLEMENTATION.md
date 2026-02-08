# Token Display Consistency - Implementation Plan

**Created:** 2026-02-08
**Status:** Ready for Implementation
**Depends On:** Phase 4 Token Display Enhancement (completed)

---

## Approved Changes

Based on user approval of recommendations:

### 1. Yellow Pill Enhancement (Frontend Only)
- Add cumulative session stats to Yellow Pill
- Rename label `Tokens~:` → `Current~:` for consistency
- **Effort:** 1-2 hours
- **Files:** ThinkingStatusPill.tsx only

### 2. Usage Dashboard Enhancement (Backend + Frontend)
- Add cache tokens to StatsAggregation
- Add cost display to dashboard
- Show input+output tokens (not just output)
- **Effort:** 1 day
- **Files:** Multiple backend and frontend files

### 3. Pricing Refactor
- **HOLD** - Deferred to future Feature Request

---

## Implementation Phases

### Phase 1: Yellow Pill Enhancement (Auto Run documents 01-02)
No backend changes needed - data already available via `session.usageStats`.

### Phase 2: Usage Dashboard Backend (Auto Run documents 03-06)
Database schema and aggregation changes.

### Phase 3: Usage Dashboard Frontend (Auto Run documents 07-08)
SummaryCards and chart updates.

---

## Phase 1: Yellow Pill Enhancement

### Current Yellow Pill Format
```
Session Name | Tokens~: 1.5K | 45 tok/s | Elapsed: 2m 34s | SESSION_ID | Stop
```

### New Yellow Pill Format
```
Session Name | Current~: 338 tokens | 45 tok/s | Session: 12.5K/1.2M ($0.45) | Elapsed: 2m 34s | SESSION_ID | Stop
```

### Data Source
Already available - no backend changes:
```typescript
// In ThinkingStatusPill.tsx
const usageStats = writeModeTab?.usageStats || primarySession.usageStats;
// Contains: inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, totalCostUsd
```

### Files to Modify
| File | Changes |
|------|---------|
| `src/renderer/components/ThinkingStatusPill.tsx` | Add session cumulative display, rename label |

---

## Phase 2: Usage Dashboard Backend

### Problem Statement
Cache tokens and costs are available during parsing (`UsageStats`) but are **not persisted** to the stats database. The data is lost in the pipeline.

### Data Flow (Current vs. Required)
```
Agent Output → Parser → UsageStats → QueryCompleteData → query_events table → Aggregation → Dashboard
                           ↓
              Has cache/cost fields     ❌ Missing      ❌ Missing       ❌ Missing    ❌ Missing
```

### Database Schema Changes (Migration v5)

**New columns in `query_events` table:**
```sql
ALTER TABLE query_events ADD COLUMN cache_read_input_tokens INTEGER;
ALTER TABLE query_events ADD COLUMN cache_creation_input_tokens INTEGER;
ALTER TABLE query_events ADD COLUMN total_cost_usd REAL;
```

### Type Changes Required

| File | Type | Changes |
|------|------|---------|
| `shared/stats-types.ts` | `QueryEvent` | Add 3 fields |
| `shared/stats-types.ts` | `StatsAggregation` | Add 3 aggregate fields |
| `shared/stats-types.ts` | `STATS_DB_VERSION` | 4 → 5 |
| `main/process-manager/types.ts` | `QueryCompleteData` | Add 3 fields |
| `main/stats/row-mappers.ts` | `QueryEventRow` | Add 3 columns, update mapper |

### SQL Changes Required

| File | Function | Changes |
|------|----------|---------|
| `main/stats/migrations.ts` | `migrateV5()` | New function to add columns |
| `main/stats/query-events.ts` | `INSERT_SQL` | Add 3 params |
| `main/stats/query-events.ts` | `insertQueryEvent()` | Pass 3 new fields |
| `main/stats/aggregations.ts` | `queryTokenMetrics()` | Add cache/cost to SQL |

### Data Pipeline Fix

**File:** `main/process-listeners/stats-listener.ts`

Currently missing fields when calling `insertQueryEvent()`. Need to pass:
- `cacheReadInputTokens`
- `cacheCreationInputTokens`
- `totalCostUsd`

---

## Phase 3: Usage Dashboard Frontend

### SummaryCards Changes

**File:** `src/renderer/components/UsageDashboard/SummaryCards.tsx`

Current cards:
- Sessions, Queries, Total Time, Avg Duration
- Avg Throughput, Total Tokens, Top Agent, Interactive %

New/updated cards:
- **Total Tokens:** Show `input+output / cache` format
- **Total Cost:** New card showing `$X.XX`

### StatsAggregation Interface Update

```typescript
export interface StatsAggregation {
  // ... existing fields ...

  // New fields (Phase 2)
  totalCacheReadInputTokens: number;
  totalCacheCreationInputTokens: number;
  totalCostUsd: number;
}
```

---

## Files Summary

### Phase 1 (Yellow Pill)
| File | Action |
|------|--------|
| `src/renderer/components/ThinkingStatusPill.tsx` | Add session stats, rename label |

### Phase 2 (Backend)
| File | Action |
|------|--------|
| `src/shared/stats-types.ts` | Update types, increment version |
| `src/main/process-manager/types.ts` | Add fields to QueryCompleteData |
| `src/main/stats/migrations.ts` | Add migrateV5() |
| `src/main/stats/row-mappers.ts` | Add columns, update mapper |
| `src/main/stats/query-events.ts` | Update INSERT SQL |
| `src/main/stats/aggregations.ts` | Update aggregation queries |
| `src/main/process-listeners/stats-listener.ts` | Pass new fields |

### Phase 3 (Frontend)
| File | Action |
|------|--------|
| `src/renderer/components/UsageDashboard/SummaryCards.tsx` | Add cost card, update token display |

---

## Auto Run Documents

1. **YELLOW-PILL-01.md** - Rename label and add session cumulative stats
2. **YELLOW-PILL-02.md** - Testing and verification

3. **DASHBOARD-BACKEND-01.md** - Update type definitions
4. **DASHBOARD-BACKEND-02.md** - Add database migration v5
5. **DASHBOARD-BACKEND-03.md** - Update query-events insertion
6. **DASHBOARD-BACKEND-04.md** - Update aggregation queries
7. **DASHBOARD-BACKEND-05.md** - Update stats listener pipeline

8. **DASHBOARD-FRONTEND-01.md** - Update SummaryCards display
9. **DASHBOARD-FRONTEND-02.md** - Testing and verification

---

## Testing Plan

### Yellow Pill Testing
1. Start a session, send messages
2. Verify `Current~: X tokens` shows during thinking
3. Verify `Session: X/Y ($Z.ZZ)` shows cumulative stats
4. Verify cost updates correctly

### Dashboard Backend Testing
1. Run queries with various agents
2. Check stats database has cache/cost columns populated
3. Verify aggregation returns cache/cost totals

### Dashboard Frontend Testing
1. Open Usage Dashboard
2. Verify Total Tokens shows input+output / cache format
3. Verify Total Cost card displays correctly
4. Verify time range filtering works with new fields

---

## Rollback Plan

### Yellow Pill
- Revert ThinkingStatusPill.tsx to previous version
- No data changes needed

### Dashboard Backend
- Database migration is additive (new columns)
- Old data will have NULL values (handled with COALESCE)
- To fully rollback: increment version again with DROP COLUMN statements (not recommended)

### Dashboard Frontend
- Revert SummaryCards.tsx to previous version
- Dashboard will work without new backend fields (shows 0/null)
