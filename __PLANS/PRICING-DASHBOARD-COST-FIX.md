# Usage Dashboard Cost Calculation Fix

**Created:** 2026-02-09
**Status:** Investigation Complete - Awaiting Discussion
**Priority:** Critical (Core Feature Accuracy)
**Complexity:** High (Pipeline Changes + Database Schema)

---

## Executive Summary

The Usage Dashboard currently displays costs calculated at full API pricing regardless of the user's billing mode. For Claude Max subscribers, this means:

1. **Cache tokens are charged** at API rates instead of $0
2. **Costs are stored permanently** in the database with wrong values
3. **No way to recalculate** historical data without migration

This document outlines the complete investigation findings and proposed implementation plan.

---

## Problem Statement

### Current Behavior

For a Max subscriber with heavy cache usage:
- **Expected cost:** ~$5.00 (input/output only, cache free)
- **Displayed cost:** ~$15.00 (full API pricing including cache)
- **Difference:** ~67% overstated for cache-heavy workloads

### Root Cause

The cost calculation pipeline uses Claude Code's reported `total_cost_usd` directly without applying billing mode adjustments:

```
Claude Code Response
    ↓
    Contains: total_cost_usd (always API pricing)
    ↓
    StdoutHandler.buildUsageStats()
    ↓
    usage-aggregator.aggregateModelUsage()
    ↓
    Returns totalCostUsd = msg.total_cost_usd (UNCHANGED)
    ↓
    ExitHandler emits 'query-complete'
    ↓
    stats-listener inserts to database
    ↓
    DATABASE STORES API-PRICED COST
    ↓
    Usage Dashboard queries stored value
    ↓
    USER SEES WRONG COST
```

### Key Finding

The pricing resolution functions **exist but are never called**:
- `resolveBillingMode()` in `pricing-resolver.ts` - ✅ Exists
- `calculateClaudeCostWithModel()` in `pricing.ts` - ✅ Exists
- **Neither is called during cost storage** - ❌ Bug

---

## Investigation Details

### 1. Where Costs Are Displayed

**File:** `src/renderer/components/UsageDashboard/SummaryCards.tsx` (lines 185-196)

```typescript
// Displays totalCostDisplay from aggregated stats
<span>{data.totalCostDisplay}</span>
```

### 2. Where Costs Are Retrieved

**File:** `src/main/stats/aggregations.ts` (lines 467-518)

```sql
SELECT COALESCE(SUM(total_cost_usd), 0) as total_cost_usd
FROM query_events
WHERE ...
```

Costs are simply summed from the `total_cost_usd` column - no recalculation.

### 3. Where Costs Are Stored

**File:** `src/main/stats/query-events.ts` (line 47)

```typescript
// total_cost_usd is inserted directly from event parameter
INSERT INTO query_events (..., total_cost_usd, ...)
VALUES (..., event.totalCostUsd, ...)
```

### 4. Where Costs Should Be Calculated (But Aren't)

**File:** `src/main/parsers/usage-aggregator.ts` (line 213)

```typescript
// totalCostUsd passes through unchanged
return {
  ...usage,
  totalCostUsd,  // This is Claude's reported value, not recalculated
};
```

### 5. Billing Mode Resolution (Exists But Unused)

**File:** `src/main/utils/pricing-resolver.ts`

```typescript
// This function exists and works correctly, but is never called
// during the cost calculation/storage pipeline
export async function resolveBillingMode(
  agentId: string,
  projectFolderId?: string
): Promise<'max' | 'api'> {
  // Implementation exists and is correct
}
```

---

## Proposed Solution

### Option A: Recalculate at Storage Time (Recommended)

**Approach:** When storing query events, recalculate the cost using the resolved billing mode.

**Pros:**
- Stored costs are accurate from the start
- Dashboard queries don't need modification
- Historical accuracy for new queries

**Cons:**
- Need to resolve billing mode during storage (async operation)
- Need session → agent → folder mapping at storage time
- Slightly more complex pipeline

### Option B: Recalculate at Display Time

**Approach:** Store raw token counts and recalculate costs when displaying in the dashboard.

**Pros:**
- No pipeline changes for storage
- Can recalculate historical data easily
- Billing mode changes apply retroactively

**Cons:**
- Slower dashboard queries (calculation on every load)
- Need to store billing mode with each query for accuracy
- More complex aggregation logic

### Option C: Hybrid (Store Both)

**Approach:** Store both the original API cost and the billing-mode-adjusted cost.

**Pros:**
- Can show both values if needed
- Easy to audit/debug
- Historical data preserved

**Cons:**
- Database schema more complex
- Storage overhead (minor)

### Recommendation: Option A with Fallback

Store the correctly calculated cost at query time, but also store the billing mode used so we can:
1. Verify calculations are correct
2. Potentially recalculate if billing mode was wrong
3. Show billing mode in UI if desired

---

## Implementation Plan

### Phase 1: Database Schema Update

**File:** `src/main/stats/schema.ts`

Add columns to `query_events` table:

```sql
ALTER TABLE query_events ADD COLUMN billing_mode TEXT;
ALTER TABLE query_events ADD COLUMN detected_model TEXT;
ALTER TABLE query_events ADD COLUMN original_cost_usd REAL;
```

- `billing_mode`: 'max' | 'api' - the mode used for calculation
- `detected_model`: The Claude model detected from output
- `original_cost_usd`: The original API-priced cost (for auditing)

**Migration:** Add migration to handle existing tables.

### Phase 2: Update Stats Listener

**File:** `src/main/process-listeners/stats-listener.ts`

Before storing the query event:

```typescript
import { resolveBillingMode, resolveModelForPricing } from '../utils/pricing-resolver';
import { calculateClaudeCostWithModel } from '../utils/pricing';

async function insertQueryEventWithRetry(event: QueryEvent) {
  // For Claude agents, recalculate cost with proper billing mode
  if (event.toolType === 'claude' || event.toolType === 'claude-code') {
    const billingMode = await resolveBillingMode(event.agentId, event.projectFolderId);
    const modelId = event.detectedModel || await resolveModelForPricing(event.agentId);

    // Store original cost for auditing
    const originalCost = event.totalCostUsd;

    // Recalculate with proper billing mode
    const adjustedCost = calculateClaudeCostWithModel(
      {
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        cacheReadTokens: event.cacheReadTokens,
        cacheWriteTokens: event.cacheWriteTokens,
      },
      modelId,
      billingMode
    );

    event = {
      ...event,
      totalCostUsd: adjustedCost,
      originalCostUsd: originalCost,
      billingMode,
      detectedModel: modelId,
    };
  }

  // Continue with existing insert logic
  await insertQueryEvent(event);
}
```

### Phase 3: Update Query Event Types

**File:** `src/main/stats/types.ts` (or wherever QueryEvent is defined)

```typescript
interface QueryEvent {
  // ... existing fields
  totalCostUsd: number;

  // New fields
  billingMode?: 'max' | 'api';
  detectedModel?: string;
  originalCostUsd?: number;
}
```

### Phase 4: Update ExitHandler

**File:** `src/main/process-manager/handlers/ExitHandler.ts`

Ensure the query-complete event includes necessary context:

```typescript
// Add agentId and projectFolderId to the event data
const queryCompleteData = {
  ...existingData,
  agentId: this.session.id,
  projectFolderId: this.session.projectFolderIds?.[0],
  detectedModel: lastUsageTotals.detectedModel,
};
```

### Phase 5: Update StdoutHandler

**File:** `src/main/process-manager/handlers/StdoutHandler.ts`

Pass through session context for billing mode resolution:

```typescript
// Ensure session ID and folder ID are available for stats recording
buildUsageStats() {
  return {
    ...existingStats,
    sessionId: this.session.id,
    projectFolderIds: this.session.projectFolderIds,
  };
}
```

### Phase 6: Historical Data Migration (Optional)

Create a migration script to recalculate historical costs:

```typescript
async function migrateHistoricalCosts() {
  const events = await getAllQueryEvents();

  for (const event of events) {
    if (event.toolType === 'claude' || event.toolType === 'claude-code') {
      const billingMode = await resolveBillingMode(event.agentId, event.projectFolderId);
      const modelId = event.detectedModel || 'claude-sonnet-4-20250514'; // Default

      const adjustedCost = calculateClaudeCostWithModel(
        extractTokens(event),
        modelId,
        billingMode
      );

      await updateQueryEventCost(event.id, adjustedCost, billingMode);
    }
  }
}
```

**Note:** This is optional and may not be necessary if users are OK with historical data being inaccurate.

---

## Files to Modify

| File | Changes | Phase |
|------|---------|-------|
| `src/main/stats/schema.ts` | Add billing_mode, detected_model, original_cost_usd columns | 1 |
| `src/main/stats/types.ts` | Update QueryEvent interface | 3 |
| `src/main/stats/query-events.ts` | Update INSERT to include new columns | 1 |
| `src/main/process-listeners/stats-listener.ts` | Resolve billing mode and recalculate cost | 2 |
| `src/main/process-manager/handlers/ExitHandler.ts` | Pass agentId and projectFolderId | 4 |
| `src/main/process-manager/handlers/StdoutHandler.ts` | Pass session context | 5 |
| `src/main/process-manager/types.ts` | Update QueryCompleteData interface | 4 |

---

## Risk Assessment

### Low Risk
- Adding new database columns (additive, backward compatible)
- Type updates (compile-time safety)

### Medium Risk
- Changing cost calculation pipeline (affects displayed values)
- Async billing mode resolution in storage path (performance)

### High Risk
- Database migration on existing data (data integrity)
- Retroactive cost changes may confuse users

### Mitigation Strategies

1. **Store original cost:** Keep `original_cost_usd` for auditing/rollback
2. **Add feature flag:** Allow toggling between old/new calculation
3. **Show billing mode in UI:** Make it clear which mode was used
4. **Don't migrate historical:** Only apply to new queries

---

## Open Questions

1. **Should we migrate historical data?**
   - Pro: Consistent historical view
   - Con: May confuse users who remember old values

2. **What if billing mode changes after query?**
   - Option A: Cost remains as calculated at query time (recommended)
   - Option B: Recalculate on demand (complex)

3. **Should we show both costs in UI?**
   - Could show "API equivalent: $X.XX" alongside actual cost
   - Useful for Max users to see their savings

4. **Performance of async billing mode resolution?**
   - Resolution involves store reads, which are fast
   - Could cache resolved modes per session

---

## Success Criteria

1. **Accurate Costs:** Max subscribers see $0 for cache tokens
2. **Model-Specific Pricing:** Opus 4.5 uses $5/$25 rates, not Sonnet 4's $3/$15
3. **Billing Mode Stored:** Can verify which mode was used
4. **Original Cost Preserved:** Can audit/debug if needed
5. **No Regression:** API billing mode users see same costs as before
6. **Performance:** No noticeable slowdown in stats recording

---

## Timeline Estimate

| Phase | Effort | Dependencies |
|-------|--------|--------------|
| Phase 1: Schema Update | 2-3 hours | None |
| Phase 2: Stats Listener | 3-4 hours | Phase 1 |
| Phase 3: Type Updates | 1 hour | Phase 2 |
| Phase 4: ExitHandler | 1-2 hours | Phase 3 |
| Phase 5: StdoutHandler | 1-2 hours | Phase 4 |
| Phase 6: Migration (Optional) | 2-3 hours | Phase 5 |
| Testing & Verification | 2-3 hours | All |

**Total: 12-18 hours** (spread across multiple sessions)

---

## Next Steps

1. Review and discuss this plan
2. Decide on historical data migration approach
3. Create Auto Run documents for each phase
4. Implement in order
5. Test with real Claude Max subscription
6. Verify costs in Usage Dashboard
