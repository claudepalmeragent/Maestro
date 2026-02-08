# Token Display Consistency Investigation

**Created:** 2026-02-08
**Status:** APPROVED - See Implementation Plan
**Related:** Phase 4 Token Display Enhancement (completed)
**Implementation:** See `/app/Maestro/__PLANS/TOKEN-DISPLAY-CONSISTENCY-IMPLEMENTATION.md`

---

## Executive Summary

This investigation analyzes how tokens and costs are displayed across the Maestro application to identify inconsistencies and recommend updates to match the new Auto Run display format.

**Key Finding:** The application has three distinct display contexts with different requirements:
1. **Real-time pills** (Yellow Agent Session, Blue Auto Run) - Show live token activity
2. **Usage Dashboard** - Shows historical aggregates from a different data source
3. **Session lists/history** - Shows per-session costs

---

## 1. Yellow Agent Session Pill

**File:** `/app/Maestro/src/renderer/components/ThinkingStatusPill.tsx` (lines 477-717)

### Current Display Format
```
[Yellow Pill] Session Name | Tokens~: 1.5K | 45 tok/s | Elapsed: 2m 34s | SESSION_ID | Stop
```

### What It Shows
- `currentCycleTokens` - Tokens for the **current thinking cycle only**
- Real-time throughput (tok/s)
- Elapsed time
- No cumulative totals
- No cache token breakdown
- No cost

### Data Source
- `primarySession.currentCycleTokens` (from Session state)
- `primarySession.currentCycleBytes` (fallback for estimation)

### Comparison to Auto Run Pill
| Feature | Yellow Pill | Blue Auto Run Pill |
|---------|-------------|-------------------|
| Current task tokens | ✓ `Tokens~: X` | ✓ `Current~: X tokens` |
| Throughput | ✓ `45 tok/s` | ✓ `45 tok/s` |
| Cumulative totals | ✗ Not shown | ✓ `Tokens: X/Y` |
| Cache breakdown | ✗ Not shown | ✓ `(Agents: A/B)` |
| Subagent tokens | ✗ N/A | ✓ `(Subagents: C/D)` |
| Cost | ✗ Not shown | ✗ Not shown (in panel only) |

### Data Availability for Cumulative Stats

**Good news:** The session object already has cumulative `usageStats` available:

```typescript
// Session.usageStats (or writeModeTab.usageStats) contains:
interface UsageStats {
  inputTokens: number;           // Cumulative input tokens for session
  outputTokens: number;          // Cumulative output tokens for session
  cacheReadInputTokens: number;  // Cumulative cache read tokens
  cacheCreationInputTokens: number; // Cumulative cache write tokens
  totalCostUsd: number;          // Cumulative cost
  contextWindow: number;         // Context window size
}
```

**Access in ThinkingStatusPill:**
- `primarySession.usageStats` - Session-level cumulative stats
- `writeModeTab?.usageStats` - Tab-level cumulative stats (for tabified sessions)

### Recommendation: **ADD CUMULATIVE SESSION STATS**

The Yellow Pill should mirror the Auto Run pill format for consistency:

**Current Format:**
```
Session Name | Tokens~: 1.5K | 45 tok/s | Elapsed: 2m 34s | SESSION_ID | Stop
```

**Proposed Format:**
```
Session Name | Current~: 338 tokens | 45 tok/s | Session: 12.5K/1.2M ($0.45) | Elapsed: 2m 34s | SESSION_ID | Stop
              ^^^^^^^^^^^^^^^^^^^^^^            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
              Current thinking cycle            Cumulative session totals
```

**Implementation Details:**
1. Rename `Tokens~:` → `Current~:` with "tokens" suffix (consistency with Auto Run)
2. Add cumulative session stats after throughput:
   - Format: `Session: X/Y ($Z.ZZ)` where X = input+output, Y = cache, Z = cost
   - Use `writeModeTab?.usageStats || primarySession.usageStats`
   - Only show if `inputTokens + outputTokens > 0`
3. Keep it compact - no Agent/Subagent breakdown (single session, not batch)

**Priority:** Medium - Provides valuable session-level cost visibility

### Comparison After Update

| Feature | Yellow Pill (Proposed) | Blue Auto Run Pill |
|---------|------------------------|-------------------|
| Current task tokens | ✓ `Current~: X tokens` | ✓ `Current~: X tokens` |
| Throughput | ✓ `45 tok/s` | ✓ `45 tok/s` |
| Cumulative totals | ✓ `Session: X/Y` | ✓ `Tokens: X/Y` |
| Cache breakdown | ✓ (in Y value) | ✓ (in Y value) |
| Cost | ✓ `($0.45)` | ✗ (in panel only) |
| Agent/Subagent split | ✗ N/A (single session) | ✓ `(Agents:...) (Subagents:...)` |

---

## 2. Usage Dashboard Modal

**File:** `/app/Maestro/src/renderer/components/UsageDashboard/UsageDashboardModal.tsx`

### Data Source: `StatsAggregation` Interface (lines 72-123)
```typescript
interface StatsAggregation {
  totalQueries: number;
  totalDuration: number;
  avgDuration: number;
  totalOutputTokens: number;      // ✓ Output tokens tracked
  totalInputTokens: number;       // ✓ Input tokens tracked
  avgTokensPerSecond: number;     // ✓ Throughput
  // ... per-agent, per-day breakdowns
}
```

### What's Missing from StatsAggregation
- ❌ `totalCacheReadTokens` - Not tracked
- ❌ `totalCacheCreationTokens` - Not tracked
- ❌ `totalCost` - Not tracked (calculated on-the-fly elsewhere)

### Sub-Components Analysis

| Component | File | What It Shows | Cache Tokens | Cost |
|-----------|------|---------------|--------------|------|
| SummaryCards | `SummaryCards.tsx` | Total tokens (output only) | ❌ No | ❌ No |
| SessionStats | `SessionStats.tsx` | Sessions, agents, tokens | ❌ No | ❌ No |
| ThroughputTrendsChart | `ThroughputTrendsChart.tsx` | tok/s over time | ❌ No | ❌ No |
| AgentThroughputChart | `AgentThroughputChart.tsx` | Per-agent throughput | ❌ No | ❌ No |
| AutoRunStats | `AutoRunStats.tsx` | Tasks completed, success rate | ❌ No | ❌ No |

### Recommendation: **BACKEND + FRONTEND UPDATE REQUIRED**

To show cache tokens and costs in the Usage Dashboard:

1. **Backend:** Update `StatsAggregation` to include:
   - `totalCacheReadTokens`
   - `totalCacheCreationTokens`
   - `totalCost` (pre-calculated)

2. **Frontend:** Update SummaryCards to show:
   - "Tokens: X/Y" format (input+output / cache)
   - "Cost: $X.XX" card

**Priority:** Medium - Valuable visibility but requires backend changes

---

## 3. Other Components Using Token/Cost Data

### A. HistoryPanel
**File:** `/app/Maestro/src/renderer/components/HistoryPanel.tsx`

**Current Display:**
- Shows `totalCostUsd` as `$X.XX` with green background
- Cost is pre-calculated and stored per-session

**Recommendation:** ✓ No changes needed - already shows cost correctly

### B. SessionList
**File:** `/app/Maestro/src/renderer/components/SessionList.tsx`

**Current Display:**
- Shows "Session Cost: $X.XX" when cost > 0
- Green accent color, monospace font

**Recommendation:** ✓ No changes needed - already shows cost correctly

### C. TabSwitcherModal
**File:** `/app/Maestro/src/renderer/components/TabSwitcherModal.tsx`

**Current Display:**
- Uses `formatTokensCompact()` for token display
- Uses `formatCost()` for cost display
- Shows context window usage gauge

**Recommendation:** ✓ No changes needed - already consistent

---

## 4. Pricing and Cost Calculation Utilities

### Current Implementation

| File | Function | Used By |
|------|----------|---------|
| `/app/Maestro/src/main/utils/pricing.ts` | `calculateCost()` | Session storage, IPC handlers |
| `/app/Maestro/src/renderer/components/RightPanel.tsx` | `calculateTokenCost()` | Auto Run panel (duplicated!) |

### Issue: Duplicated Pricing Logic

The `RightPanel.tsx` has its own `calculateTokenCost()` function (lines 25-41) that duplicates the logic from `pricing.ts`. This is a maintenance risk.

### Recommendation: **REFACTOR**

1. Export `calculateCost()` to renderer via preload bridge
2. Remove duplicate `calculateTokenCost()` from RightPanel
3. Use shared function everywhere

**Priority:** Low - Code quality improvement, not user-facing

---

## 5. Recommendations Summary

### Immediate (Low Effort)

| Change | File(s) | Effort | Impact |
|--------|---------|--------|--------|
| Rename Yellow Pill label `Tokens~:` → `Current~:` | ThinkingStatusPill.tsx | 5 min | Consistency |

### Short-Term (Medium Effort) - RECOMMENDED

| Change | File(s) | Effort | Impact |
|--------|---------|--------|--------|
| **Add cumulative session stats to Yellow Pill** | ThinkingStatusPill.tsx | 1-2 hrs | **High - Cost visibility** |
| Add cost display to SummaryCards | SummaryCards.tsx | 2 hrs | Visibility |
| Show cache token breakdown in dashboard | Multiple | 4 hrs | Visibility |

### Long-Term (High Effort - Backend Required)

| Change | File(s) | Effort | Impact |
|--------|---------|--------|--------|
| Add cache tokens to StatsAggregation | Backend + Frontend | 1 day | Complete picture |
| Refactor pricing utilities | pricing.ts, RightPanel.tsx | 2 hrs | Maintainability |

---

## 6. Decision Points for Discussion

1. **Yellow Pill Cumulative Stats (NEW - RECOMMENDED):**
   - Should we add cumulative session stats to the Yellow Pill?
   - Proposed format: `Session Name | Current~: 338 tokens | 45 tok/s | Session: 12.5K/1.2M ($0.45) | ...`
   - Data is already available via `session.usageStats` / `writeModeTab.usageStats`
   - Provides real-time cost visibility during active sessions
   - **Effort:** 1-2 hours

2. **Yellow Pill Label Change:**
   - Should we rename `Tokens~:` to `Current~:` for consistency with Auto Run?
   - This is purely cosmetic but improves consistency.
   - **Effort:** 5 minutes (can be done as part of #1)

3. **Usage Dashboard Enhancements:**
   - Do we want cache token breakdowns in the dashboard?
   - This requires backend changes to the stats aggregation.
   - Current dashboard shows only `outputTokens` - should we show `inputTokens` too?
   - **Effort:** Backend + Frontend changes (1 day)

4. **Cost Visibility in Dashboard:**
   - Should the Usage Dashboard show total cost across all sessions?
   - Currently costs are only visible per-session in HistoryPanel/SessionList.
   - **Effort:** Medium (depends on #3)

5. **Pricing Refactor:**
   - Should we consolidate the duplicate pricing logic now, or leave it as tech debt?
   - Low risk but improves long-term maintainability.
   - **Effort:** 2 hours

---

## Files Reference

### Token/Cost Display Components
- `/app/Maestro/src/renderer/components/ThinkingStatusPill.tsx` - Both pills
- `/app/Maestro/src/renderer/components/RightPanel.tsx` - Auto Run panel
- `/app/Maestro/src/renderer/components/HistoryPanel.tsx` - Session history
- `/app/Maestro/src/renderer/components/SessionList.tsx` - Session list
- `/app/Maestro/src/renderer/components/TabSwitcherModal.tsx` - Tab switcher

### Usage Dashboard Components
- `/app/Maestro/src/renderer/components/UsageDashboard/UsageDashboardModal.tsx`
- `/app/Maestro/src/renderer/components/UsageDashboard/SummaryCards.tsx`
- `/app/Maestro/src/renderer/components/UsageDashboard/SessionStats.tsx`
- `/app/Maestro/src/renderer/components/UsageDashboard/ThroughputTrendsChart.tsx`
- `/app/Maestro/src/renderer/components/UsageDashboard/AutoRunStats.tsx`

### Utility Functions
- `/app/Maestro/src/shared/formatters.ts` - `formatTokensCompact()`, `formatCost()`
- `/app/Maestro/src/main/utils/pricing.ts` - `calculateCost()`
- `/app/Maestro/src/renderer/utils/contextUsage.ts` - Context window calculations
