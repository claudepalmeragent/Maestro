# Investigation: Sonnet 4.6 Support

**Date**: 2026-02-18
**Status**: Investigation Complete - Ready for Implementation
**Priority**: High (model released 2026-02-17, sessions using Sonnet 4.6 will record $0 costs)

---

## Summary

Claude Sonnet 4.6 was released on 2026-02-17 and is **NOT supported** in the Maestro codebase. Any sessions using Sonnet 4.6 will hit the same $0 cost bug we just fixed for Opus 4.6 — the model ID won't be recognized by the pricing registry, so `maestro_cost_usd` will be 0. The `anthropic_cost_usd` fallback we added will still work (calculates from tokens when Claude Code reports $0), but proper model-based pricing requires adding Sonnet 4.6 to the registry.

---

## Sonnet 4.6 Details (from Anthropic docs)

| Field | Value |
|-------|-------|
| **Claude API ID** | `claude-sonnet-4-6` (no date suffix in official docs) |
| **Claude API alias** | `claude-sonnet-4-6` |
| **Family** | Sonnet |
| **Input** | $3 / MTok |
| **Output** | $15 / MTok |
| **Cache Read** | $0.30 / MTok |
| **Cache Write (5m)** | $3.75 / MTok |
| **Context Window** | 200K (1M beta) |
| **Max Output** | 64K tokens |

**Key observation**: Unlike older models (e.g., `claude-sonnet-4-5-20250929`), the official docs list Sonnet 4.6's API ID as just `claude-sonnet-4-6` without a date suffix. This is the same pattern as Opus 4.6 (listed as `claude-opus-4-6` in the latest models table).

**Note on Opus 4.6**: Our codebase uses `claude-opus-4-6-20260115` as the full model ID. The Anthropic docs currently show Opus 4.6 as just `claude-opus-4-6` in the latest models table (without date suffix). However, since our short-form alias `'claude-opus-4-6'` already maps to the full ID, this works correctly.

**Decision**: Use `claude-sonnet-4-6-20260218` as the full model ID in `CLAUDE_MODEL_PRICING` (following the existing convention), with `claude-sonnet-4-6` as a short-form alias. If Anthropic later publishes a date-suffixed version, we can update the full ID. The alias system ensures the short-form will always resolve correctly regardless.

---

## Files Requiring Changes

### 1. `src/main/utils/claude-pricing.ts` (PRIMARY)

**Changes needed:**

#### a. Add to `ClaudeModelId` type union (line ~20)
```typescript
| 'claude-sonnet-4-6-20260218'
```
Add between `'claude-haiku-4-5-20251001'` line and the Opus entries, or after Sonnet 4.5 entry to maintain family grouping.

#### b. Add to `CLAUDE_MODEL_PRICING` record (after Sonnet 4.5 entry, ~line 104)
```typescript
// Sonnet 4.6
'claude-sonnet-4-6-20260218': {
    displayName: 'Claude Sonnet 4.6',
    family: 'sonnet',
    INPUT_PER_MILLION: 3,
    OUTPUT_PER_MILLION: 15,
    CACHE_READ_PER_MILLION: 0.3,
    CACHE_CREATION_PER_MILLION: 3.75,
},
```

#### c. Add to `MODEL_ALIASES` — all 4 sections:

**Latest aliases** (~line 150): Update `sonnet` alias to point to Sonnet 4.6:
```typescript
sonnet: 'claude-sonnet-4-6-20260218',
```

**Versioned aliases** (~line 158): Add:
```typescript
'sonnet-4.6': 'claude-sonnet-4-6-20260218',
```

**Underscore variants** (~line 169): Add:
```typescript
sonnet_4_6: 'claude-sonnet-4-6-20260218',
```

**Short-form model IDs** (~line 181): Add:
```typescript
'claude-sonnet-4-6': 'claude-sonnet-4-6-20260218',
```

#### d. Update pricing table comment (~line 53)
Add Sonnet 4.6 row to the markdown table in the JSDoc.

---

### 2. `src/shared/types.ts` (line ~492)

Add to duplicate `ClaudeModelId` type union:
```typescript
| 'claude-sonnet-4-6-20260218'
```

---

### 3. `src/renderer/components/ui/PricingModelDropdown.tsx` (line ~49)

Add to `MODEL_OPTIONS` array between Opus family and existing Sonnet entries:
```typescript
{ value: 'claude-sonnet-4-6-20260218', label: 'Sonnet 4.6', family: 'sonnet' },
```

---

### 4. `src/__tests__/main/utils/claude-pricing.test.ts`

Add Sonnet 4.6 test cases to existing describe blocks:
- Direct model ID lookup
- Short-form alias resolution (`claude-sonnet-4-6`)
- Versioned alias resolution (`sonnet-4.6`)
- `sonnet` alias now resolves to Sonnet 4.6

---

### 5. Other test files (may need model ID updates)

- `src/__tests__/main/process-listeners/stats-listener.test.ts`
- `src/__tests__/renderer/components/ui/PricingModelDropdown.test.tsx`

These may have hardcoded model counts or lists that need updating.

---

## Implementation Approach

This is a straightforward additive change — identical in structure to the existing Opus 4.6 and Sonnet 4.5 entries. No architectural changes needed. The alias system we just built for the Opus 4.6 fix handles the short-form ID resolution automatically.

**Recommended**: Create Auto Run documents following the same 3-phase pattern used for Opus 4.6:
1. Phase 1: Code changes (pricing registry + types + UI dropdown)
2. Phase 2: Test updates
3. Phase 3: Build & verify

---

## Risk Assessment

**Low risk**. The pricing is identical to Sonnet 4.5 ($3/$15 input/output). The changes are purely additive — adding a new model entry and aliases. No existing functionality is modified.

**Without this fix**: Any Maestro user running Claude Code with Sonnet 4.6 will see $0 for `maestro_cost_usd`. The `anthropic_cost_usd` fallback will still calculate a cost from tokens, but the model won't appear correctly in model-specific reporting.
