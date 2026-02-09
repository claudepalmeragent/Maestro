# Bug Fixes: Token Stats & Database Population

**Created:** 2026-02-08
**Status:** Ready for Implementation
**Priority:** High (Blocks accurate stats display)

---

## Executive Summary

This plan addresses three related bugs discovered during testing of the token display enhancements:

1. **"338 tokens" stuck display** - Current token count never updates for Claude agents
2. **Empty database columns** - cache_read_input_tokens, cache_creation_input_tokens, total_cost_usd are never populated
3. **Root cause** - `lastUsageTotals` is only set for Codex agents, never for Claude/other agents

---

## Bug Analysis

### Root Cause: `normalizeCodexUsage()` Only Called for Codex

**File:** `src/main/process-manager/handlers/StdoutHandler.ts` (lines 229-236)

```typescript
const usageStats = this.buildUsageStats(managedProcess, usage);
// Normalize Codex usage (cumulative -> delta)
const normalizedUsageStats =
    managedProcess.toolType === 'codex'
        ? normalizeCodexUsage(managedProcess, usageStats)  // <-- Sets lastUsageTotals
        : usageStats;                                       // <-- DOES NOT set lastUsageTotals
this.emitter.emit('usage', sessionId, normalizedUsageStats);
```

**What `normalizeCodexUsage` does:**
1. Converts cumulative Codex usage to delta (per-message) usage
2. **Sets `managedProcess.lastUsageTotals`** with the current totals

**For non-Codex agents:**
- `lastUsageTotals` is **never set**
- ExitHandler reads from `lastUsageTotals` and gets `undefined`
- Database columns are inserted as NULL

### Impact Chain

```
StdoutHandler.ts (line 232-235)
    ↓ toolType !== 'codex' → lastUsageTotals = undefined
ExitHandler.ts (lines 161-165)
    ↓ reads undefined values
stats-listener.ts
    ↓ receives undefined for cache tokens and cost
query_events table
    ↓ columns inserted as NULL
aggregations.ts
    ↓ returns 0 for all cache/cost metrics
Dashboard
    ↓ shows $0.00 and 0 cache tokens
```

---

## Implementation Plan

### Fix 1: Set `lastUsageTotals` for ALL Agents

**File:** `src/main/process-manager/handlers/StdoutHandler.ts`

**Current code (lines 229-236):**
```typescript
const usageStats = this.buildUsageStats(managedProcess, usage);
const normalizedUsageStats =
    managedProcess.toolType === 'codex'
        ? normalizeCodexUsage(managedProcess, usageStats)
        : usageStats;
this.emitter.emit('usage', sessionId, normalizedUsageStats);
```

**Fixed code:**
```typescript
const usageStats = this.buildUsageStats(managedProcess, usage);

// For Codex: Convert cumulative -> delta (also sets lastUsageTotals internally)
// For all other agents: Set lastUsageTotals directly (for ExitHandler to use)
let normalizedUsageStats: typeof usageStats;
if (managedProcess.toolType === 'codex') {
    normalizedUsageStats = normalizeCodexUsage(managedProcess, usageStats);
} else {
    // Store totals for non-Codex agents (Claude, OpenCode, etc.)
    // This is needed by ExitHandler to emit cache tokens and cost in query-complete
    managedProcess.lastUsageTotals = {
        inputTokens: usageStats.inputTokens,
        outputTokens: usageStats.outputTokens,
        cacheReadInputTokens: usageStats.cacheReadInputTokens,
        cacheCreationInputTokens: usageStats.cacheCreationInputTokens,
        reasoningTokens: usageStats.reasoningTokens || 0,
        totalCostUsd: usageStats.totalCostUsd,
    };
    normalizedUsageStats = usageStats;
}

this.emitter.emit('usage', sessionId, normalizedUsageStats);
```

### Fix 2: Import UsageTotals Type (if not already imported)

**File:** `src/main/process-manager/handlers/StdoutHandler.ts`

Add to imports if needed:
```typescript
import type { UsageTotals } from '../types';
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/main/process-manager/handlers/StdoutHandler.ts` | Set `lastUsageTotals` for all agents, not just Codex |

---

## Testing Plan

### Test 1: Verify Database Population
1. Start a Claude agent session
2. Send a few messages
3. Query the stats database:
   ```sql
   SELECT cache_read_input_tokens, cache_creation_input_tokens, total_cost_usd
   FROM query_events
   ORDER BY start_time DESC
   LIMIT 5;
   ```
4. **Expected:** Columns should contain actual values, not NULL

### Test 2: Verify "Current" Token Display
1. Open the Yellow Pill (active Claude session)
2. Send a message
3. **Expected:** "Current: X tokens" should update with real values during thinking

### Test 3: Verify Dashboard Updates
1. Open Usage Dashboard
2. Check SummaryCards for cost display
3. **Expected:** Cost should show actual dollar amounts, not $0.00

### Test 4: Verify Auto Run Stats
1. Run an Auto Run batch with a Claude agent
2. Check the throughput chart
3. **Expected:** Tokens per second should calculate correctly

### Test 5: Regression Test - Codex Still Works
1. Run a session with a Codex agent (if available)
2. Verify usage stats still work correctly
3. **Expected:** No regression in Codex behavior

---

## Rollback Plan

If issues arise, revert the single change in StdoutHandler.ts:
- Remove the `else` block that sets `lastUsageTotals`
- Restore the ternary expression

The change is minimal and isolated.

---

## Related Issues

This fix enables the following features to work correctly:
- Usage Dashboard cost display
- Cache token aggregations
- Per-agent cost tracking
- Accurate throughput calculations

---

## Verification Checklist

- [ ] Database columns populated for Claude agents
- [ ] Yellow Pill shows updating token count
- [ ] Dashboard shows non-zero costs
- [ ] Auto Run stats track correctly
- [ ] Codex agents still work (no regression)
