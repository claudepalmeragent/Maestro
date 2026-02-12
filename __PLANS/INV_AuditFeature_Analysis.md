# Investigation Report: Audit Feature Analysis & Compliance Review

**Date:** 2026-02-12
**Issue:** Review and verify the Audit feature in Settings > Audits tab
**Status:** INVESTIGATION COMPLETE - RECOMMENDATIONS PROVIDED

---

## Executive Summary

The Audit feature is designed to compare Maestro's recorded token usage and cost data against Anthropic's authoritative data (fetched via the `ccusage` CLI tool). This allows users to:

1. **Verify accuracy** of Maestro's token/cost tracking
2. **Detect discrepancies** between local records and Anthropic's billing data
3. **Schedule automated audits** (daily, weekly, monthly)
4. **Auto-correct entries** with discrepancies

### Current Implementation Status: **PARTIALLY COMPLETE**

The backend infrastructure is **fully implemented**, but there are several issues that prevent the feature from working correctly end-to-end:

| Component | Status | Notes |
|-----------|--------|-------|
| Database schema | ✅ Complete | `audit_snapshots` and `audit_schedule` tables exist (Migration v7) |
| IPC handlers | ✅ Complete | All 9 handlers registered (`audit:*`) |
| Preload API | ✅ Complete | `window.maestro.audit.*` exposed to renderer |
| Anthropic audit service | ⚠️ Issues | Uses `ccusage` but may have data format mismatches |
| Audit scheduler | ✅ Complete | Timer-based scheduling for daily/weekly/monthly |
| Settings UI | ✅ Complete | `AuditsSettingsTab.tsx` with schedule config and manual audit |
| History table | ✅ Complete | `AuditHistoryTable.tsx` displays past audits |
| Result modal | ⚠️ Incomplete | `AuditResultModal.tsx` exists but not integrated |
| Report panel | ⚠️ Data mismatch | `AuditReportPanel.tsx` expects different data shape |
| **Billing mode compliance** | ❌ **ISSUE** | Audit does NOT use `maestro_billing_mode` or dual-source costs |

---

## Part 1: Architecture Analysis

### 1.1 Data Flow

```
User clicks "Run Audit Now" (Settings > Audits)
    ↓
AuditsSettingsTab.tsx calls window.maestro.audit.run(startDate, endDate)
    ↓
IPC: 'audit:run' → audit.ts handler
    ↓
runManualAudit(startDate, endDate) in audit-scheduler.ts
    ↓
performAudit(startDate, endDate) in anthropic-audit-service.ts
    ↓
┌──────────────────────────────────┐   ┌──────────────────────────────────┐
│  fetchAnthropicUsage()           │   │  queryMaestroUsageByDate()       │
│  - Runs: npx ccusage@latest      │   │  - Queries: query_events table   │
│  - Returns: Daily usage records  │   │  - Groups by date                │
└──────────────────────────────────┘   └──────────────────────────────────┘
    ↓                                       ↓
    └─────────────── compareUsage() ────────┘
                        ↓
                  AuditResult
                        ↓
              saveAuditSnapshot()
                        ↓
              broadcastAuditUpdate()
                        ↓
              UI refreshes history table
```

### 1.2 Key Files

| File | Purpose |
|------|---------|
| `src/main/services/anthropic-audit-service.ts` | Core audit logic: fetch ccusage data, query Maestro DB, compare |
| `src/main/services/audit-scheduler.ts` | Schedule management, config storage, timer-based execution |
| `src/main/ipc/handlers/audit.ts` | IPC handlers for renderer communication |
| `src/main/preload/audit.ts` | Preload API exposure |
| `src/renderer/components/Settings/AuditsSettingsTab.tsx` | Main settings UI |
| `src/renderer/components/Settings/AuditHistoryTable.tsx` | History table display |
| `src/renderer/components/AuditResultModal.tsx` | Modal for detailed results (unused?) |
| `src/renderer/components/UsageDashboard/AuditReportPanel.tsx` | Detailed entry-level view |
| `src/main/stats/schema.ts` | Database table definitions |
| `src/main/stats/migrations.ts` | Migration v7 creates audit tables |

---

## Part 2: Issues Identified

### 2.1 CRITICAL: Billing Mode Not Used in Audit Queries

**Location:** `anthropic-audit-service.ts:262-314` (`queryMaestroUsageByDate`)

**Issue:** The Maestro query fetches costs as:
```sql
COALESCE(SUM(anthropic_cost_usd), SUM(total_cost_usd)) as anthropic_cost,
COALESCE(SUM(maestro_cost_usd), SUM(total_cost_usd)) as maestro_cost
```

This correctly uses the dual-source cost columns added in FIX-30, BUT:

1. **No billing mode awareness**: The audit comparison doesn't account for billing mode differences
2. **Savings calculation assumes API billing**: `savings = anthropic_total - maestro_calculated` is only meaningful for Max users where cache tokens are free
3. **No model-specific comparison**: The audit doesn't break down by model, which is important since different models have different pricing

**Impact:** Audit results may show misleading "savings" or "discrepancies" for users with different billing modes or model usage patterns.

### 2.2 MEDIUM: ccusage Output Format Assumptions

**Location:** `anthropic-audit-service.ts:129-154` (`fetchAnthropicUsage`)

**Issue:** The code assumes `ccusage` outputs a specific JSON format:
```typescript
const usageData = result[period] || result.daily || result.data || [];
```

The `normalizeAnthropicData` function handles some field name variations, but:
1. **No validation**: If ccusage changes its output format, the audit silently fails or returns incorrect data
2. **No error handling for parse failures**: JSON.parse errors are thrown but not caught gracefully

**Impact:** Audits may fail silently or return incorrect comparisons if ccusage updates.

### 2.3 MEDIUM: UI Data Shape Mismatch

**Location:** `AuditReportPanel.tsx:23-46` vs `anthropic-audit-service.ts:57-89`

**Issue:** The `AuditReportPanel` component expects a different data shape than what `performAudit` returns:

**AuditReportPanel expects:**
```typescript
interface AuditReportResult {
  period: { start: string; end: string };
  entries: AuditEntry[];  // ← Per-entry granularity
  summary: {
    total: number;
    matches: number;
    minorDiscrepancies: number;
    majorDiscrepancies: number;
    missing: number;
  };
}
```

**performAudit returns:**
```typescript
interface AuditResult {
  period: { start: string; end: string };
  tokens: { anthropic, maestro, difference, percentDiff };  // ← Aggregate only
  costs: { anthropic_total, maestro_anthropic, maestro_calculated, ... };
  modelBreakdown: [];  // ← Empty (TODO comment)
  anomalies: [];  // ← High-level anomalies only
}
```

**Impact:** The `AuditResultModal` and `AuditReportPanel` cannot display meaningful data because:
1. No per-entry data is generated
2. No entry-level status (match/minor/major/missing) is computed
3. The auto-correct feature has nothing to work with

### 2.4 LOW: Auto-Correct Only Sets Timestamp

**Location:** `audit.ts:172-206` (`audit:autoCorrect` handler)

**Issue:** The auto-correct handler only sets `maestro_corrected_at` timestamp:
```typescript
const stmt = db.database.prepare(`
  UPDATE query_events
  SET maestro_corrected_at = ?
  WHERE id = ?
`);
```

It doesn't actually update any token counts or cost values. This is a "mark as reviewed" feature, not a true auto-correct.

**Impact:** Users may expect auto-correct to fix discrepancies, but it only marks entries as reviewed.

### 2.5 LOW: Model Breakdown Not Implemented

**Location:** `anthropic-audit-service.ts:469`

```typescript
modelBreakdown: [], // TODO: Implement per-model breakdown if needed
```

**Impact:** Cannot compare costs per model, which is important for users using multiple Claude models with different pricing.

---

## Part 3: Compliance Analysis with Recent Pricing/Billing Fixes

### 3.1 FIX-30 Dual-Source Cost Tracking

**Status:** ✅ Partially Compliant

The audit service correctly references both `anthropic_cost_usd` and `maestro_cost_usd` columns from FIX-30. However:

- ❌ Does NOT check `maestro_billing_mode` to contextualize cost differences
- ❌ Does NOT account for SSH remote billing mode detection
- ❌ Savings calculation ignores billing mode context

### 3.2 Pricing Resolution (claude-pricing.ts, pricing-resolver.ts)

**Status:** ❌ Not Used

The audit service does NOT use:
- `resolveBillingMode()` or `resolveBillingModeAsync()`
- `getPricingForModel()` for model-specific comparisons
- Agent or Project Folder pricing configurations

### 3.3 Model Detection

**Status:** ❌ Not Used

The audit does NOT:
- Break down comparisons by detected model
- Use model-specific pricing for validation
- Cross-reference with `anthropic_model` column in query_events

---

## Part 4: What the Feature is MEANT to Do

Based on code analysis and documentation:

### 4.1 Primary Purpose

Compare Anthropic's authoritative usage data (from `ccusage`) against Maestro's recorded data to:
1. **Verify accuracy**: Ensure Maestro is tracking usage correctly
2. **Detect missing data**: Find queries that Anthropic recorded but Maestro missed
3. **Identify cost discrepancies**: Highlight differences in calculated costs
4. **Track savings**: For Max users, show how much they saved vs API billing

### 4.2 Expected User Flow

1. User opens Settings > Audits tab
2. User selects date range and clicks "Run Audit Now"
3. Audit fetches Anthropic data via ccusage
4. Audit queries Maestro's database for same period
5. Comparison generates:
   - Token count differences (input, output, cache read, cache write)
   - Cost comparisons (Anthropic total vs Maestro calculated)
   - Anomalies list (missing queries, mismatches)
6. Results displayed in history table
7. User can drill into details and optionally "auto-correct" entries

### 4.3 Scheduled Audits

Users can configure automatic audits:
- **Daily**: Run at a specific time, compare previous day
- **Weekly**: Run on a specific day, compare previous 7 days
- **Monthly**: Run on 1st of month, compare previous month

---

## Part 5: Recommended Implementation Plan

### Option A: Minimal Fix (Get It Working)

**Effort:** 1-2 days
**Goal:** Make the existing UI functional with current data

1. **Fix data shape transformation**: Create adapter function to convert `AuditResult` → `AuditReportResult`
2. **Wire up AuditResultModal**: Show modal when clicking on history row
3. **Add entry-level comparison**: Generate per-day entries with status
4. **Test with ccusage**: Verify ccusage output format matches expectations

### Option B: Full Compliance (Recommended)

**Effort:** 3-5 days
**Goal:** Fully integrate with billing mode and pricing infrastructure

#### Phase 1: Backend Enhancements (2 days)

1. **Add billing mode context to audit queries**:
   ```typescript
   // In queryMaestroUsageByDate
   SELECT
     date,
     maestro_billing_mode,
     anthropic_model,
     SUM(input_tokens),
     ...
   GROUP BY date, maestro_billing_mode, anthropic_model
   ```

2. **Generate per-entry comparisons**:
   - Fetch individual query_events for the period
   - Match against ccusage session data (if available)
   - Compute status (match/minor/major/missing)

3. **Implement model breakdown**:
   - Group comparisons by `anthropic_model`
   - Use `getPricingForModel()` for expected costs
   - Calculate discrepancies per model

4. **Add billing mode to AuditResult**:
   ```typescript
   billingModeBreakdown: {
     api: { count, anthropicCost, maestroCost },
     max: { count, anthropicCost, maestroCost, cacheSavings }
   }
   ```

#### Phase 2: UI Enhancements (1-2 days)

1. **Wire up AuditResultModal**: Show on history row click
2. **Populate AuditReportPanel**: With entry-level data
3. **Add billing mode filter**: Allow viewing by billing mode
4. **Add model filter**: Allow viewing by model
5. **Clarify auto-correct behavior**: Rename to "Mark Reviewed" or implement actual correction

#### Phase 3: Testing & Validation (1 day)

1. **Test with real ccusage data**: Verify format handling
2. **Test with Max billing mode**: Verify savings calculations
3. **Test with multiple models**: Verify model breakdown
4. **Test scheduled audits**: Verify timer-based execution

---

## Part 6: Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| ccusage output format change | Medium | High | Add format validation, graceful fallback |
| Large date range performance | Low | Medium | Add pagination, limit query scope |
| Billing mode mismatch confusion | Medium | Medium | Clear UI labels, tooltips explaining billing modes |
| Auto-correct expectation mismatch | High | Low | Rename to "Mark Reviewed" or document behavior |

---

## Part 7: Files to Modify

### Backend

| File | Changes |
|------|---------|
| `src/main/services/anthropic-audit-service.ts` | Add billing mode grouping, model breakdown, entry-level comparison |
| `src/main/ipc/handlers/audit.ts` | Add handler for fetching entry-level details |
| `src/main/preload/audit.ts` | Expose new entry-level API |

### Frontend

| File | Changes |
|------|---------|
| `src/renderer/components/Settings/AuditsSettingsTab.tsx` | Integrate AuditResultModal |
| `src/renderer/components/Settings/AuditHistoryTable.tsx` | Add click handler for detail view |
| `src/renderer/components/AuditResultModal.tsx` | Connect to real data |
| `src/renderer/components/UsageDashboard/AuditReportPanel.tsx` | Handle current data shape or adapt |

---

## Part 8: Conclusion

The Audit feature has a solid foundation but is **not production-ready** due to:

1. **Data shape mismatch** between backend and frontend
2. **Missing billing mode awareness** (critical for FIX-30 compliance)
3. **Missing model breakdown** (important for multi-model users)
4. **Misleading auto-correct functionality**

### Recommended Next Steps

1. **Short-term (Option A)**: Get the basic flow working with an adapter layer
2. **Medium-term (Option B)**: Full integration with billing mode and pricing infrastructure
3. **Long-term**: Add entry-level matching via ccusage session data

---

**Document Author:** Claude Investigation Agent
**Review Status:** Ready for User Review
