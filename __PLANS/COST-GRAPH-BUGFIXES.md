# Cost Graph Bugfixes - Investigation & Fix Plan

**Created:** 2026-02-10
**Status:** Investigation Complete - Ready for Implementation
**Priority:** High

---

## Issues Identified

| Issue | Description | Root Cause | Severity |
|-------|-------------|------------|----------|
| #1 | Cost graphs positioned at top, should be at bottom | Layout order in UsageDashboardModal | Minor |
| #2 | Cost by Model shows "unknown" for all models | `detectedModel` is NULL during query storage | Critical |
| #3 | Cost by Agent shows agent IDs instead of names | No JOIN to sessions for custom names | Medium |
| #4 | All agents show "API" billing mode, not "Max" | Billing mode defaults to 'api', settings not resolved | Critical |
| #5 | All costs show API pricing, not Max-adjusted costs | Historical data fix (reconstruction) only ran in PREVIEW mode | Critical |

---

## Issue #1: Cost Graphs Positioned at Top

### Current Behavior
Cost graphs appear at the top of both Overview and Agents tabs, before other charts.

### Expected Behavior
Cost graphs should appear at the bottom of each tab.

### Root Cause
In `UsageDashboardModal.tsx`:
- **Overview Tab** (lines 761-793): CostOverTimeGraph and CostByModelGraph are rendered BEFORE AgentComparisonChart
- **Agents Tab** (line 1041): AgentCostGraph appears in the middle of the tab

### Fix
Move the cost graph JSX sections to after the existing charts in each tab.

---

## Issue #2: Cost by Model Shows "unknown"

### Current Behavior
The CostByModelGraph shows all queries grouped under "unknown" model.

### Root Cause Chain
1. **SQL Query** (`aggregations.ts` line 625):
   ```sql
   COALESCE(maestro_pricing_model, anthropic_model, 'unknown') as model
   ```

2. **Both columns are NULL** because:
   - `stats-listener.ts` line 52: `const anthropicModel = queryData.detectedModel || null;`
   - `maestroPricingModel` is initialized from `anthropicModel` (line 57)

3. **`detectedModel` is not being set** in the query complete event data

### Investigation Needed
Find where `QueryCompleteData.detectedModel` should be populated:
- Check `ExitHandler.ts` or equivalent in process manager
- Check output parsers for model extraction
- The model IS available in Claude responses (e.g., "claude-opus-4-5-20251101")

### Fix Required
1. Find where QueryCompleteData is built
2. Extract model from the Claude/agent response
3. Populate `detectedModel` field before emitting query-complete event

---

## Issue #3: Cost by Agent Shows IDs Instead of Names

### Current Behavior
AgentCostGraph displays agent IDs (e.g., "claude-123abc...") instead of custom names from sidebar.

### Root Cause
In `aggregations.ts` lines 676-724, `queryCostsByAgent()`:
```typescript
return rows.map((row) => {
  return {
    agentId: row.agent_id,
    agentName: row.agent_id,  // ← Uses agent_id as name!
    // ...
  };
});
```

The query does NOT join to get custom session names. Compare to working `AgentUsageChart.tsx` which receives sessions and does client-side lookup.

### Fix Options

**Option A: Client-side lookup (matches existing pattern)**
1. Add `sessions?: Session[]` prop to `AgentCostGraph`
2. Add `getAgentDisplayName()` helper (copy from AgentUsageChart)
3. Pass sessions from `UsageDashboardModal` to `AgentCostGraph`

**Option B: Server-side JOIN (better performance)**
1. Modify `queryCostsByAgent()` to JOIN with session data
2. Return actual session name from query

**Recommendation:** Option A - matches existing pattern, less invasive.

---

## Issue #4: All Agents Show "API" Billing Mode

### Current Behavior
AgentCostGraph shows all agents with blue "API" color, none show green "Max".

### Root Cause Chain

1. **Default is 'api'** (`stats-listener.ts` line 56):
   ```typescript
   let maestroBillingMode: 'api' | 'max' | 'free' = 'api';
   ```

2. **Billing mode only resolved IF**:
   - Agent type is 'claude-code' or 'claude' (line 61)
   - Model is detected (line 63) ← **FAILS because detectedModel is null!**
   - Model is a Claude model (line 66)

3. **Because Issue #2 (model detection) fails**, the billing mode resolver is never called!

4. **Result:** All queries default to 'api' billing mode.

### Fix
This is a cascading failure from Issue #2. Once model detection is fixed:
- `detectedModel` will have a value
- `isClaudeModel()` check will pass
- `resolveBillingMode()` will be called
- Billing mode will be correctly determined from agent/folder settings

### Additional Fix
Even without model detection, we should call `resolveBillingMode()` for Claude agents:
```typescript
// Current (buggy):
if (isClaudeModel(detectedModel)) {
  billingMode = await resolveBillingMode(agentId);
}

// Fixed:
if (toolType === 'claude-code' || toolType === 'claude') {
  billingMode = await resolveBillingMode(agentId);
}
```

---

## Issue #5: All Costs Show API Pricing (Reconstruction Not Run)

### Current Behavior
All costs display API pricing rates, not Max-adjusted costs (cache tokens should be free).

### Root Cause
**The historical data reconstruction was only run in PREVIEW mode!**

Evidence:
1. `ReconstructionPanel.tsx` line 38: `const [previewMode, setPreviewMode] = useState(true);`
2. Preview mode calls `reconstruction:preview` which sets `dryRun: true`
3. With `dryRun: true`, no database modifications occur

### Migration v7 Only Partially Backfills
`migrations.ts` lines 348-388:
- Creates new dual-cost columns
- Copies `total_cost_usd` → `anthropic_cost_usd` (good)
- Does NOT populate `maestro_cost_usd`, `maestro_billing_mode`, `maestro_pricing_model` (bad)

### Current State of Existing Records
| Column | Value |
|--------|-------|
| `anthropic_cost_usd` | Has values (backfilled from total_cost_usd) |
| `maestro_cost_usd` | **NULL** |
| `maestro_billing_mode` | **NULL** |
| `maestro_pricing_model` | **NULL** |

### Why Costs Show as API
The aggregation query (`aggregations.ts` line 682):
```sql
COALESCE(SUM(maestro_cost_usd), SUM(total_cost_usd), 0) as local_cost
```
Since `maestro_cost_usd` is NULL, it falls back to `total_cost_usd` which is API pricing.

### Fix
**User must actually run the reconstruction (not just preview):**

1. Open Settings → Audits tab
2. Scroll to "Historical Data Reconstruction" section
3. **Uncheck** "Preview only (don't modify database)"
4. Click "Start Reconstruction"

### Code Fix (Optional)
Consider adding a migration or startup check that auto-runs reconstruction if `maestro_cost_usd` is NULL for many records.

---

## Implementation Plan

### Phase 1: Fix Model Detection (Issue #2) - CRITICAL

**Priority:** Highest - This cascades to fix Issues #4 and partially #5

**Files to Investigate:**
- `src/main/process-manager/handlers/ExitHandler.ts` (or equivalent)
- `src/main/parsers/claude-output-parser.ts`
- Wherever `QueryCompleteData` is built

**Task:**
1. Find where query-complete event data is constructed
2. Extract model name from Claude response (it's in the output)
3. Set `detectedModel` field

### Phase 2: Fix Agent Names (Issue #3)

**Files to Modify:**
- `src/renderer/components/UsageDashboard/AgentCostGraph.tsx`
- `src/renderer/components/UsageDashboard/UsageDashboardModal.tsx`

**Tasks:**
1. Add `sessions?: Session[]` prop to AgentCostGraph
2. Copy `getAgentDisplayName()` helper from AgentUsageChart
3. Pass sessions prop from UsageDashboardModal

### Phase 3: Fix Billing Mode Fallback (Issue #4)

**File to Modify:**
- `src/main/process-listeners/stats-listener.ts`

**Task:**
Change billing mode resolution to not require model detection:
```typescript
// Call resolveBillingMode for Claude agents regardless of model detection
if (toolType === 'claude-code' || toolType === 'claude') {
  maestroBillingMode = await resolveBillingMode(agentId, folderId);
}
```

### Phase 4: Move Cost Graphs to Bottom (Issue #1)

**File to Modify:**
- `src/renderer/components/UsageDashboard/UsageDashboardModal.tsx`

**Tasks:**
1. Move CostOverTimeGraph and CostByModelGraph sections to after existing charts in Overview tab
2. Move AgentCostGraph section to bottom of Agents tab

### Phase 5: Run Historical Reconstruction (Issue #5)

**User Action Required:**
1. Open Maestro
2. Settings → Audits tab
3. Uncheck "Preview only"
4. Click "Start Reconstruction"
5. Wait for completion

**Optional Code Enhancement:**
Add startup check to prompt user if reconstruction is needed.

---

## Files Summary

| File | Changes Needed |
|------|----------------|
| `src/main/process-listeners/stats-listener.ts` | Fix billing mode resolution |
| `src/main/process-manager/handlers/ExitHandler.ts` | Fix model detection (investigate) |
| `src/renderer/components/UsageDashboard/AgentCostGraph.tsx` | Add sessions prop, name lookup |
| `src/renderer/components/UsageDashboard/UsageDashboardModal.tsx` | Pass sessions, move graphs |

---

## Test Verification

After fixes:
1. **Model Detection:** CostByModelGraph shows actual model names (opus, sonnet, haiku)
2. **Agent Names:** AgentCostGraph shows custom sidebar names
3. **Billing Mode:** Agents with Max subscription show green color
4. **Costs:** Max users see reduced costs (cache tokens free)
5. **Graph Position:** Cost graphs appear at bottom of each tab

---

## Auto Run Documents

| Phase | Document | Description |
|-------|----------|-------------|
| 1 | `__AUTORUN/COST-GRAPH-FIX-01-MODEL-DETECTION.md` | Fix model detection (investigation + fix) |
| 2 | `__AUTORUN/COST-GRAPH-FIX-02-BILLING-MODE-FALLBACK.md` | Fix billing mode resolution |
| 3 | `__AUTORUN/COST-GRAPH-FIX-03-AGENT-NAMES.md` | Fix agent names in graph |
| 4 | `__AUTORUN/COST-GRAPH-FIX-04-MOVE-GRAPHS-BOTTOM.md` | Move graphs to bottom of tabs |
| 5 | `__AUTORUN/COST-GRAPH-FIX-05-SSH-REMOTE-DROPDOWN.md` | Use existing SSH Remote dropdown in Reconstruction Panel |

### After Running Auto Fixes

5. **Run Reconstruction** - Open Settings → Audits → Historical Data Reconstruction
   - Configure SSH remotes if needed (for your 8 VM fleet)
   - Uncheck "Preview only"
   - Click "Start Reconstruction"

This will recalculate `maestro_cost_usd` with proper billing mode for all historical data.
