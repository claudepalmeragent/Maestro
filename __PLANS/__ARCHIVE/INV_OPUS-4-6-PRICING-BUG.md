# Investigation: Opus 4.6 Cost Recording Bug (0 USD)

**Date:** 2026-02-15 (Updated)
**Status:** Investigation Complete - Ready for Review
**Priority:** CRITICAL
**Affects:** All sessions using Claude Opus 4.6 (`claude-opus-4-6`)

---

## Executive Summary

New Claude Opus 4.6 sessions are recording `0` for both `anthropic_cost_usd` and `maestro_cost_usd` in the stats database. There are **two distinct bugs** causing this:

1. **`maestro_cost_usd = 0` (Model ID Mismatch):** Claude Code emits the short-form model ID `"claude-opus-4-6"` via `msg.message.model`, but the pricing registry only contains `"claude-opus-4-6-20260115"`, and the alias map doesn't include the short form. This causes `isClaudeModelId()` to fail, triggering the "non-Claude / free" branch.

2. **`anthropic_cost_usd = 0` (Pass-Through of Upstream Zero):** The `anthropicCostUsd` field is a **pure pass-through** of `queryData.totalCostUsd`, which originates from Claude Code's `total_cost_usd` field. Maestro never independently calculates it. When Claude Code reports `total_cost_usd` as 0, undefined, or omits it entirely (which appears to be happening with Opus 4.6), Maestro stores 0 with no fallback.

Both bugs must be fixed to restore accurate cost tracking.

---

## Root Cause Analysis

### Bug 1: maestro_cost_usd = 0 (Model ID Mismatch)

```
1. Claude Code emits: { message: { model: "claude-opus-4-6" } }
                                          ^^^^^^^^^^^^^^^^^^
                                          SHORT FORM (no date suffix)

2. ClaudeOutputParser captures: this.detectedModel = "claude-opus-4-6"
   (src/main/parsers/claude-output-parser.ts:151, 186)

3. StdoutHandler propagates to: managedProcess.lastUsageTotals.detectedModel
   (src/main/process-manager/handlers/StdoutHandler.ts:242, 303)

4. ExitHandler emits query-complete with: detectedModel: "claude-opus-4-6"
   (src/main/process-manager/handlers/ExitHandler.ts:182, 201)

5. stats-listener.ts receives: anthropicModel = "claude-opus-4-6"
   (src/main/process-listeners/stats-listener.ts:59)

6. isClaudeModelId("claude-opus-4-6") → FALSE
   (Only "claude-opus-4-6-20260115" exists in CLAUDE_MODEL_PRICING)

7. Falls into non-Claude branch (stats-listener.ts:94-103):
   maestroBillingMode = 'free'
   maestroCostUsd = 0

8. DB stores: maestro_cost_usd = 0, maestro_billing_mode = 'free'
```

### Bug 2: anthropic_cost_usd = 0 (No Fallback Calculation)

The `anthropicCostUsd` value is a **pure pass-through chain** with no independent calculation:

```
1. Claude Code emits:  msg.total_cost_usd = 0 / undefined / absent
   (src/main/parsers/claude-output-parser.ts:82 — ClaudeRawMessage interface)

2. extractUsageFromRaw: aggregateModelUsage(msg.modelUsage, msg.usage, msg.total_cost_usd || 0)
   (claude-output-parser.ts:372 — passes through as totalCostUsd)

3. aggregateModelUsage returns: { totalCostUsd: 0 }
   (usage-aggregator.ts:217 — pure pass-through of parameter)

4. ParsedEvent.usage.costUsd = 0
   (claude-output-parser.ts:381)

5. StdoutHandler.buildUsageStats: totalCostUsd = usage.costUsd || 0 → 0
   (StdoutHandler.ts:495)

6. managedProcess.lastUsageTotals.totalCostUsd = 0
   (StdoutHandler.ts:301)

7. ExitHandler passes: totalCostUsd = managedProcess.lastUsageTotals?.totalCostUsd → 0
   (ExitHandler.ts:181, 200)

8. stats-listener: anthropicCostUsd = queryData.totalCostUsd || 0 → 0
   (stats-listener.ts:58)

9. DB stores: anthropic_cost_usd = 0
```

**The critical design flaw:** `anthropicCostUsd` has **no fallback calculation**. If Claude Code doesn't provide `total_cost_usd` (or provides 0), Maestro blindly stores 0. Unlike `maestroCostUsd`, there is no "calculate it ourselves from tokens" path for the Anthropic cost field.

### Why Previous Models Worked

Previous models likely worked because:
- Claude Code's older output format may have included valid `total_cost_usd` values
- The `modelUsage` fallback path in `ClaudeOutputParser` may have been providing full-form IDs (e.g., `"claude-opus-4-5-20251101"` as `modelUsage` object keys)
- The `msg.message.model` primary detection source may not have been used or may have sent full-form IDs

The switch to Opus 4.6 likely introduced a change in Claude Code's output format where `message.model` is now the short form and `total_cost_usd` is absent or 0.

### Affected Code Locations

| File | Lines | Bug | Role |
|------|-------|-----|------|
| `src/main/utils/claude-pricing.ts` | 15-24, 59-141, 147-174, 187-189 | Bug 1 | Pricing registry missing short-form aliases |
| `src/main/process-listeners/stats-listener.ts` | 94 | Bug 1 | `isClaudeModelId()` check doesn't try alias resolution |
| `src/main/process-listeners/stats-listener.ts` | 58 | Bug 2 | `anthropicCostUsd` is pure pass-through with no fallback |
| `src/main/parsers/claude-output-parser.ts` | 372 | Bug 2 | `total_cost_usd` passed through without validation |
| `src/main/parsers/usage-aggregator.ts` | 174, 217 | Bug 2 | `totalCostUsd` is pure pass-through |
| `src/main/process-manager/handlers/StdoutHandler.ts` | 495 | Bug 2 | `costUsd` passed through |
| `src/main/process-manager/handlers/ExitHandler.ts` | 181, 200 | Bug 2 | `totalCostUsd` passed through |
| `src/main/utils/pricing.ts` | 120-134 | Both | Cost calculation (used for maestro, needed for anthropic fallback) |

### Dual-Cost Impact

| Field | Expected | Actual | Root Cause |
|-------|----------|--------|------------|
| `anthropic_cost_usd` | API-rate cost from tokens | 0 | Pure pass-through of Claude Code's `total_cost_usd` (0 or absent), no fallback calculation |
| `maestro_cost_usd` | Calculated from tokens + pricing | 0 | Model ID `"claude-opus-4-6"` not in pricing table or aliases → `'free'` billing mode |
| `maestro_billing_mode` | `'api'` or `'max'` | `'free'` | `isClaudeModelId("claude-opus-4-6")` returns false |
| `maestro_pricing_model` | `"claude-opus-4-6"` | `"claude-opus-4-6"` | Stored correctly but can't be looked up for pricing |
| `total_cost_usd` (legacy) | Same as `maestro_cost_usd` | 0 | Copied from `maestroCostUsd` (stats-listener.ts:187) |

---

## Pricing Verification

### Opus 4.6 Pricing (from Anthropic)

| Category | Price (USD per MTok) |
|----------|---------------------|
| Base Input | $5.00 |
| Output | $25.00 |
| Cache Read (5-min) | $0.50 |
| Cache Write (5-min) | $6.25 |
| Cache Write (1-hour) | $10.00 |
| Batch Input | $2.50 |
| Batch Output | $12.50 |

**Confirmed:** Opus 4.6 pricing is **identical** to Opus 4.5 ($5/$25 input/output).

### Current Code Pricing (claude-pricing.ts:61-68)

```typescript
'claude-opus-4-6-20260115': {
    displayName: 'Claude Opus 4.6',
    family: 'opus',
    INPUT_PER_MILLION: 5,      // $5/MTok  correct
    OUTPUT_PER_MILLION: 25,     // $25/MTok  correct
    CACHE_READ_PER_MILLION: 0.5, // $0.50/MTok  correct
    CACHE_CREATION_PER_MILLION: 6.25, // $6.25/MTok  correct
},
```

**The pricing data is correct.** The problem is purely that it can't be looked up (Bug 1), and the Anthropic cost has no fallback when upstream is absent (Bug 2).

---

## Proposed Fix: Option B (Comprehensive) + Anthropic Cost Fallback

### Part 1: Add Short-Form Model ID Aliases (Fixes Bug 1)

**File:** `src/main/utils/claude-pricing.ts` (~line 147, MODEL_ALIASES)

Add short-form aliases for **all** models:

```typescript
export const MODEL_ALIASES: Record<string, ClaudeModelId> = {
    // ... existing aliases ...

    // Short-form model IDs (without date suffix)
    // Claude Code may emit these via msg.message.model field
    'claude-opus-4-6': 'claude-opus-4-6-20260115',
    'claude-opus-4-5': 'claude-opus-4-5-20251101',
    'claude-opus-4-1': 'claude-opus-4-1-20250319',
    'claude-opus-4': 'claude-opus-4-20250514',
    'claude-sonnet-4-5': 'claude-sonnet-4-5-20250929',
    'claude-sonnet-4': 'claude-sonnet-4-20250514',
    'claude-haiku-4-5': 'claude-haiku-4-5-20251001',
    'claude-haiku-3-5': 'claude-haiku-3-5-20241022',
    'claude-3-haiku': 'claude-3-haiku-20240307',
};
```

**Lines added:** ~9 data lines

### Part 2: Use Alias Resolution in stats-listener (Fixes Bug 1 at the call site)

**File:** `src/main/process-listeners/stats-listener.ts` (~line 90-116)

The current code calls `isClaudeModelId()` directly, which only checks exact matches against `CLAUDE_MODEL_PRICING` keys. It should try alias resolution first:

```typescript
import { isClaudeModelId, resolveModelAlias } from '../utils/claude-pricing';

// ... inside calculateDualCosts, replacing lines 91-116 ...

// Calculate cost if model is detected
if (anthropicModel) {
    try {
        // Try to resolve the model (handles aliases, short-form IDs, and full IDs)
        const resolvedModel = resolveModelAlias(anthropicModel)
            || (isClaudeModelId(anthropicModel) ? anthropicModel : null);

        if (!resolvedModel) {
            // Non-Claude models are free (Ollama, local, etc.)
            maestroBillingMode = 'free';
            maestroCostUsd = 0;
            maestroPricingModel = anthropicModel;

            logger.debug('[stats-listener] Non-Claude model detected, marking as free', '[Stats]', {
                sessionId: queryData.sessionId,
                model: anthropicModel,
            });
        } else {
            maestroPricingModel = resolvedModel;

            // Calculate cost with proper billing mode
            const tokens = {
                inputTokens: queryData.inputTokens || 0,
                outputTokens: queryData.outputTokens || 0,
                cacheReadTokens: queryData.cacheReadInputTokens || 0,
                cacheCreationTokens: queryData.cacheCreationInputTokens || 0,
            };

            maestroCostUsd = calculateClaudeCostWithModel(tokens, resolvedModel, maestroBillingMode);
        }
    } catch (error) {
        // Fall back to Anthropic cost on any error
        logger.warn(
            '[stats-listener] Error calculating Maestro cost, falling back to Anthropic',
            '[Stats]',
            { error: String(error), sessionId: queryData.sessionId, model: anthropicModel }
        );
        maestroCostUsd = anthropicCostUsd;
    }
}
```

**Lines changed:** ~5 lines modified (add import, change conditional logic)

### Part 3: Add Anthropic Cost Fallback Calculation (Fixes Bug 2)

**File:** `src/main/process-listeners/stats-listener.ts` (~line 56-65, inside calculateDualCosts)

The `anthropicCostUsd` must have a fallback: when Claude Code doesn't provide `total_cost_usd` (or provides 0), but we have valid token counts and a resolved model, calculate it ourselves at **API pricing** (since `anthropic_cost_usd` represents what Anthropic would charge at standard API rates).

**Current code (line 58):**
```typescript
const anthropicCostUsd = queryData.totalCostUsd || 0;
```

**Proposed replacement (~lines 58-65 area, after the Maestro cost calculation block):**

The fix needs to be applied AFTER the model resolution logic runs (so we know the resolved model). The full updated `calculateDualCosts` flow becomes:

```typescript
async function calculateDualCosts(
    queryData: QueryCompleteData,
    logger: ProcessListenerDependencies['logger']
): Promise<{ ... }> {
    // Start with Anthropic's reported cost (may be 0 or absent)
    let anthropicCostUsd = queryData.totalCostUsd || 0;
    const anthropicModel = queryData.detectedModel || null;

    // Default Maestro values
    let maestroCostUsd = anthropicCostUsd;
    let maestroBillingMode: 'api' | 'max' | 'free' = 'api';
    let maestroPricingModel: string | null = anthropicModel;
    const maestroCalculatedAt = Date.now();

    const isClaude = CLAUDE_AGENT_TYPES.has(queryData.agentType);

    if (isClaude) {
        // ... billing mode resolution (unchanged) ...

        if (anthropicModel) {
            try {
                const resolvedModel = resolveModelAlias(anthropicModel)
                    || (isClaudeModelId(anthropicModel) ? anthropicModel : null);

                if (!resolvedModel) {
                    // Non-Claude models are free
                    maestroBillingMode = 'free';
                    maestroCostUsd = 0;
                    maestroPricingModel = anthropicModel;
                } else {
                    maestroPricingModel = resolvedModel;

                    const tokens = {
                        inputTokens: queryData.inputTokens || 0,
                        outputTokens: queryData.outputTokens || 0,
                        cacheReadTokens: queryData.cacheReadInputTokens || 0,
                        cacheCreationTokens: queryData.cacheCreationInputTokens || 0,
                    };

                    // Calculate Maestro cost (billing-mode-aware)
                    maestroCostUsd = calculateClaudeCostWithModel(
                        tokens, resolvedModel, maestroBillingMode
                    );

                    // NEW: Fallback for anthropicCostUsd
                    // If Anthropic didn't report a cost but we have tokens and a valid model,
                    // calculate what the API cost would be (always at 'api' billing mode,
                    // since anthropic_cost_usd represents standard API pricing)
                    if (anthropicCostUsd === 0 && (tokens.inputTokens > 0 || tokens.outputTokens > 0)) {
                        anthropicCostUsd = calculateClaudeCostWithModel(
                            tokens, resolvedModel, 'api'
                        );

                        logger.debug(
                            '[stats-listener] Anthropic cost was 0, calculated fallback from tokens',
                            '[Stats]',
                            {
                                sessionId: queryData.sessionId,
                                model: resolvedModel,
                                calculatedCost: anthropicCostUsd.toFixed(6),
                                inputTokens: tokens.inputTokens,
                                outputTokens: tokens.outputTokens,
                            }
                        );
                    }
                }
            } catch (error) {
                logger.warn( /* ... existing error handling ... */ );
                maestroCostUsd = anthropicCostUsd;
            }
        }
    }

    return {
        anthropicCostUsd,
        anthropicModel,
        maestroCostUsd,
        maestroBillingMode,
        maestroPricingModel,
        maestroCalculatedAt,
    };
}
```

**Key design decisions for the anthropicCostUsd fallback:**

1. **Only triggers when `anthropicCostUsd === 0` AND tokens are present.** This avoids overwriting valid Anthropic-reported costs.
2. **Always uses `'api'` billing mode** for the fallback calculation, since `anthropic_cost_usd` represents what Anthropic charges at standard API rates (not Max subscription discounts).
3. **Uses the same `calculateClaudeCostWithModel()` function** that already handles model-specific pricing, so pricing accuracy is guaranteed.
4. **Applies only to resolved Claude models.** Non-Claude models (Ollama, etc.) correctly remain at 0.

---

## Implementation Plan

### Phase 1: Fix Both Bugs (CRITICAL)

**Files to modify (3 files):**

| File | Changes | Bug |
|------|---------|-----|
| `src/main/utils/claude-pricing.ts` | Add 9 short-form aliases to `MODEL_ALIASES` | Bug 1 |
| `src/main/process-listeners/stats-listener.ts` | Add `resolveModelAlias` import; refactor `calculateDualCosts` to resolve aliases + add anthropic cost fallback | Bug 1 + Bug 2 |

**Estimated scope:** ~20 lines added, ~10 lines modified across 2 files

### Phase 2: Add/Update Tests

**Files to modify:**
1. `src/__tests__/main/utils/claude-pricing.test.ts` - Add test cases for short-form model IDs
2. `src/__tests__/main/process-listeners/stats-listener.test.ts` (if exists) - Test both fixes

**Test cases for Bug 1:**
- `resolveModelAlias('claude-opus-4-6')` returns `'claude-opus-4-6-20260115'`
- `getPricingForModel('claude-opus-4-6')` returns Opus 4.6 pricing config
- All 9 short-form model IDs resolve correctly

**Test cases for Bug 2:**
- `calculateDualCosts()` with `detectedModel: 'claude-opus-4-6'`, `totalCostUsd: 0`, and valid token counts should produce non-zero `anthropicCostUsd`
- `calculateDualCosts()` with `detectedModel: 'claude-opus-4-6'`, `totalCostUsd: 0.50` should preserve the reported `anthropicCostUsd` of 0.50 (no overwrite)
- `calculateDualCosts()` with `detectedModel: 'claude-opus-4-6'`, `totalCostUsd: 0`, and zero token counts should produce `anthropicCostUsd = 0` (no spurious calculation)

### Phase 3: Build & Verify

1. `npm run build` - Full production build
2. `npm test` - Run existing test suite + new tests
3. `npm run lint` - TypeScript compilation check
4. Manual verification: Start an Opus 4.6 session and confirm both costs appear in DB

### Phase 4: Historical Data Remediation (Optional)

Recalculate costs for existing Opus 4.6 entries with 0 cost:
- Query `query_events WHERE (anthropic_model = 'claude-opus-4-6' OR maestro_pricing_model = 'claude-opus-4-6') AND maestro_cost_usd = 0`
- Recalculate from stored token counts using correct pricing
- Update `anthropic_cost_usd`, `maestro_cost_usd`, `maestro_billing_mode`, `maestro_calculated_at`

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Alias maps to wrong model version | Very Low | Medium | Aliases are explicit 1:1 mappings, easily audited |
| Short-form ID conflicts with future models | Very Low | Low | New models get their own alias entry |
| Fix breaks other working models | Very Low | High | No logic changes for working models; only adds data + fallback path |
| Anthropic fallback overwrites valid cost | None | N/A | Only triggers when `anthropicCostUsd === 0` AND tokens > 0 |
| Fallback calculates wrong price | Very Low | Low | Uses same `calculateClaudeCostWithModel()` that powers `maestroCostUsd` |
| Tests fail after changes | Low | Low | Run full test suite before merge |
| SSH remote agents affected differently | None | N/A | Same cost calculation code path for local and remote |
| `anthropicCostUsd` fallback diverges from actual Anthropic billing | Low | Low | Uses identical pricing tables; any difference would be rounding |

---

## Files Reference

| File | Purpose | Changes |
|------|---------|---------|
| `src/main/utils/claude-pricing.ts` | Pricing registry, aliases, validation | Add 9 short-form aliases |
| `src/main/process-listeners/stats-listener.ts` | Cost calculation and DB storage | Alias resolution + anthropic fallback |
| `src/main/utils/pricing.ts` | Cost calculation functions | No changes (already correct) |
| `src/main/parsers/claude-output-parser.ts` | Model detection from output | No changes (model detection is correct) |
| `src/main/process-manager/handlers/StdoutHandler.ts` | Usage propagation | No changes |
| `src/main/process-manager/handlers/ExitHandler.ts` | Query-complete emission | No changes |
| `src/__tests__/main/utils/claude-pricing.test.ts` | Pricing tests | Add short-form alias tests |

---

## Conclusion

This bug has **two independent root causes** that both need to be fixed:

1. **Bug 1 (maestro_cost_usd):** A **data gap** -- the `MODEL_ALIASES` map is missing short-form model IDs, and `stats-listener.ts` doesn't try alias resolution before declaring a model as "non-Claude." Fix: add short-form aliases + use `resolveModelAlias()`.

2. **Bug 2 (anthropic_cost_usd):** A **missing fallback** -- the `anthropicCostUsd` field is a pure pass-through of Claude Code's `total_cost_usd` with no independent calculation when upstream provides 0. Fix: calculate from tokens at API pricing when the reported cost is 0 but tokens are present.

Both fixes are contained to 2 source files (~30 lines total), follow existing patterns, and carry minimal risk. The anthropic cost fallback is safe because it only activates when the reported cost is 0 and tokens exist, and always uses `'api'` billing mode to represent standard Anthropic pricing.
