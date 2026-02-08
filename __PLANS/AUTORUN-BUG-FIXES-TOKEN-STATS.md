# Auto Run: Bug Fixes - Token Stats & Database Population

**Plan Reference:** BUG-FIXES-TOKEN-STATS.md
**Estimated Time:** 15 minutes

---

## Overview

This Auto Run document fixes the critical bug where `lastUsageTotals` is only set for Codex agents, causing:
- "338 tokens" stuck display for Claude agents
- Empty cache_read_input_tokens, cache_creation_input_tokens, total_cost_usd columns in database
- $0.00 cost display in Usage Dashboard

---

## Tasks

- [ ] **Task 1: Fix StdoutHandler to set lastUsageTotals for all agents**

  **File:** `src/main/process-manager/handlers/StdoutHandler.ts`

  **Location:** Lines 229-236 (the usage extraction section)

  **Current code:**
  ```typescript
  const usageStats = this.buildUsageStats(managedProcess, usage);
  const normalizedUsageStats =
      managedProcess.toolType === 'codex'
          ? normalizeCodexUsage(managedProcess, usageStats)
          : usageStats;
  this.emitter.emit('usage', sessionId, normalizedUsageStats);
  ```

  **Replace with:**
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

- [ ] **Task 2: Verify UsageTotals type is imported**

  **File:** `src/main/process-manager/handlers/StdoutHandler.ts`

  Check that `UsageTotals` type is imported from `../types`. If not already imported, add:
  ```typescript
  import type { UsageTotals } from '../types';
  ```

- [ ] **Task 3: Build and verify no TypeScript errors**

  Run: `npm run build` or `npm run typecheck`

  Ensure no compilation errors related to the changes.

- [ ] **Task 4: Test database population**

  1. Start the app
  2. Open a Claude agent session
  3. Send 2-3 messages to generate usage data
  4. Open developer console and run:
     ```sql
     SELECT cache_read_input_tokens, cache_creation_input_tokens, total_cost_usd
     FROM query_events
     ORDER BY start_time DESC
     LIMIT 5;
     ```
  5. Verify columns have actual values (not NULL)

- [ ] **Task 5: Test Yellow Pill token display**

  1. With Claude agent session active
  2. Send a message
  3. Observe the Yellow Pill during "thinking" state
  4. Verify "Current: X tokens" updates with real values (not stuck at 338)

---

## Verification Checklist

After completing all tasks, verify:

- [ ] TypeScript builds without errors
- [ ] Database columns are populated for new Claude queries
- [ ] Yellow Pill shows updating token count during thinking
- [ ] Usage Dashboard shows non-zero costs
- [ ] Codex agents still work correctly (no regression)

---

## Rollback

If issues arise, revert the single change in StdoutHandler.ts:
1. Remove the `else` block that sets `lastUsageTotals`
2. Restore the ternary expression to original form
