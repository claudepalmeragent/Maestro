# Plan: Externalize Claude Model Pricing to JSON Store

## Context

Adding a new Claude model currently requires editing 5+ TypeScript files (`claude-pricing.ts`, `shared/types.ts`, `PricingModelDropdown.tsx`, tests, and the pricing table comment) and rebuilding the app. This is fragile, non-scalable, and violates separation of data from code. The model-checker already detects new models at runtime but can't act on them — it can only show a toast.

**Goal**: Move all model pricing data into a runtime-updateable electron-store (`maestro-model-registry.json`). Adding a new model becomes a data operation (write to JSON store), not a code change. The model-checker can auto-add detected models.

## Approach

Create a 10th electron-store instance that holds all model pricing, aliases, and metadata. Ship current models as defaults. Rewrite `claude-pricing.ts` functions to read from the store. Make `PricingModelDropdown` fetch model options dynamically via IPC. Update `model-checker.ts` to write new models directly into the store.

The static `ClaudeModelId` union type (duplicated in `claude-pricing.ts` and `shared/types.ts`) becomes `string` — validity is checked at runtime via `isClaudeModelId()` against the store.

---

## Phase 1: Create the Model Registry Store (Foundation)

**No existing code changes behavior. Purely additive.**

### Create new files

1. **`src/main/stores/model-registry-types.ts`** — Store schema:
   ```typescript
   export interface ModelRegistryData {
     schemaVersion: number;
     models: Record<string, ModelEntry>;
     aliases: Record<string, string>;
     defaultModelId: string;
     suppressedDisplayNames: string[];
   }
   export interface ModelEntry {
     displayName: string;
     family: string;
     pricing: { INPUT_PER_MILLION: number; OUTPUT_PER_MILLION: number; CACHE_READ_PER_MILLION: number; CACHE_CREATION_PER_MILLION: number; };
     addedAt?: string;
     source?: 'builtin' | 'auto' | 'manual';
   }
   ```

2. **`src/main/stores/model-registry-defaults.ts`** — Extract current 10 models, 30 aliases, suppressed names, and default model ID from `claude-pricing.ts` and `model-checker.ts` into a `MODEL_REGISTRY_DEFAULTS` constant.

### Modify existing files

3. **`src/main/stores/instances.ts`** — Add `_modelRegistryStore` variable, initialize in `initializeStores()` at `_productionDataPath`, add to `getStoreInstances()` return.

4. **`src/main/stores/getters.ts`** — Add `getModelRegistryStore()` getter following existing pattern.

5. **`src/main/stores/index.ts`** — Export new types, defaults, and getter.

### Verify
- `npm run build:main` — passes (no consumers yet)
- `npm test` — all existing tests pass

---

## Phase 2: Rewrite `claude-pricing.ts` to Read from Store

**Core swap. All 7 consumers continue working — same function signatures, backed by store reads.**

### Modify `src/main/utils/claude-pricing.ts`

- Replace `ClaudeModelId` union type with `type ClaudeModelId = string`
- Remove hardcoded `CLAUDE_MODEL_PRICING` Record — replace with `getModelPricingRecord()` function that builds it from the store
- Remove hardcoded `MODEL_ALIASES` Record — replace with `getModelAliasesRecord()` function
- Change `DEFAULT_MODEL_ID` const export to `getDefaultModelId()` function (const can't be lazy)
- Rewrite all functions (`isClaudeModelId`, `getPricingForModel`, `resolveModelAlias`, `getModelDisplayName`, `getAllModelIds`, `getModelsByFamily`, `getAllKnownModelDisplayNames`) to read from `getModelRegistryStore().store`
- Keep `ClaudeModelPricing` interface, `ClaudeBillingMode` type — unchanged

### Modify consumers of `DEFAULT_MODEL_ID` (2 files)

- **`src/main/utils/pricing.ts`** — Change import to `getDefaultModelId`, replace 1 usage
- **`src/main/utils/pricing-resolver.ts`** — Change import to `getDefaultModelId`, replace 2 usages

### Backward-compat note on `CLAUDE_MODEL_PRICING` and `MODEL_ALIASES`

Tests import `CLAUDE_MODEL_PRICING` directly. Rather than a Proxy (over-engineered), export the function and update the test to call it. Only 2 files import these directly: `claude-pricing.test.ts` and `cost-tracking.integration.test.ts`.

### Verify
- `npm run build:main` — passes
- `npm test` — passes (store initializes with same defaults as old hardcoded data)

---

## Phase 3: Eliminate Duplicate Types and Make Dropdown Dynamic

### Modify `src/shared/types.ts` (~line 487)

- Replace 10-literal `ClaudeModelId` union with `type ClaudeModelId = string`
- This is backward-compatible — all consumers already work with strings

### Add IPC channel for model options

- **`src/main/ipc/handlers/system.ts`** (or new `models.ts`) — Add `models:getOptions` handler that reads from the store and returns `[{ value, label, family }]` sorted by family then version
- **`src/main/preload/system.ts`** — Add `getModelOptions()` bridge method
- **`src/renderer/global.d.ts`** — Add type declaration

### Rewrite `src/renderer/components/ui/PricingModelDropdown.tsx`

- Remove hardcoded `MODEL_OPTIONS` array
- Accept `modelOptions` as a prop (parent fetches via IPC) OR fetch on mount with `useState`/`useEffect`
- The dropdown becomes fully data-driven

### Verify
- `npm run build:main` — passes
- Manual test: open dropdown, verify all 10 models appear
- Adding a model to the store (via dev tools or test) should make it appear in the dropdown on next open

---

## Phase 4: Integrate Model Checker with Store

### Modify `src/main/model-checker.ts`

- Remove hardcoded `SUPPRESSED_MODEL_NAMES` Set — read from `store.suppressedDisplayNames`
- Remove import of `getAllKnownModelDisplayNames` — read display names directly from store
- Add `addModelToRegistry(info: NewModelInfo): string | null` function that:
  - Generates model ID from display name (e.g., "Claude Sonnet 5" → `claude-sonnet-5-YYYYMMDD`)
  - Writes entry to store via `store.set('models.<id>', entry)`
  - Adds common aliases (short-form, versioned, underscore)
  - Returns the generated model ID

### Wire auto-add via IPC

- Add `models:addDetected` IPC handler that calls `addModelToRegistry()`
- The existing toast notification flow in `App.tsx` can be updated to either:
  - Auto-add on detection (simplest)
  - Show toast with "Add" action (future enhancement — requires toast action button support)

### Verify
- Unit test: call `addModelToRegistry()`, verify `isClaudeModelId()` and `getPricingForModel()` work for the new model
- Integration test: restart app, verify no toasts for models that were auto-added

---

## Phase 5: Update Tests and Cleanup

### Update test files

- **`src/__tests__/main/utils/claude-pricing.test.ts`** — Initialize store in `beforeAll`, update imports (function calls instead of const), relax exact counts to `toBeGreaterThanOrEqual(10)`
- **`src/__tests__/integration/cost-tracking.integration.test.ts`** — Update `CLAUDE_MODEL_PRICING` import
- **`src/__tests__/main/model-checker.test.ts`** — Add test for `addModelToRegistry()`

### Cleanup

- **`src/main/constants.ts`** — Remove deprecated `CLAUDE_PRICING` constant (line 117-122). Update fallback in `pricing.ts` to use `getDefaultModelId()` pricing instead.
- Remove the reusable `ADD-NEW-MODEL.md` Auto Run doc (no longer needed — models are added via store, not code changes)

### Verify
- `npm run build:main` — passes
- `npm test` — all tests pass
- Full build: `npm run build` — passes

---

## Key Files

| File | Phase | Action |
|------|-------|--------|
| `src/main/stores/model-registry-types.ts` | 1 | Create |
| `src/main/stores/model-registry-defaults.ts` | 1 | Create |
| `src/main/stores/instances.ts` | 1 | Add 10th store |
| `src/main/stores/getters.ts` | 1 | Add getter |
| `src/main/stores/index.ts` | 1 | Add exports |
| `src/main/utils/claude-pricing.ts` | 2 | Major rewrite |
| `src/main/utils/pricing.ts` | 2 | Update 1 import |
| `src/main/utils/pricing-resolver.ts` | 2 | Update 1 import |
| `src/shared/types.ts` | 3 | Simplify type |
| `src/main/ipc/handlers/system.ts` | 3 | Add IPC handler |
| `src/main/preload/system.ts` | 3 | Add bridge |
| `src/renderer/global.d.ts` | 3 | Add type |
| `src/renderer/components/ui/PricingModelDropdown.tsx` | 3 | Remove hardcoded list |
| `src/main/model-checker.ts` | 4 | Add store writes |
| `src/__tests__/main/utils/claude-pricing.test.ts` | 5 | Update for store |
| `src/__tests__/integration/cost-tracking.integration.test.ts` | 5 | Update imports |
| `src/main/constants.ts` | 5 | Remove deprecated const |

## Risks and Mitigations

- **Store corruption**: electron-store has built-in corruption handling. Defaults always available as fallback.
- **Performance**: electron-store caches JSON in memory (`.store` property). No disk reads on every `getPricingForModel()` call.
- **Type safety loss**: `ClaudeModelId` becomes `string`. All usage already goes through runtime validation functions (`isClaudeModelId`, `resolveModelAlias`). No code pattern-matches on specific model ID strings.
- **Migration**: No schema migration needed. Existing `pricingModel` values in agent configs store (e.g., `'claude-opus-4-5-20251101'`) remain valid — store defaults include all current models.

## Outcome

After this refactor:
- Adding a model = one JSON store entry (no TypeScript, no rebuild)
- Model-checker auto-adds detected models on startup
- `PricingModelDropdown` dynamically reflects store contents
- Single source of truth: `maestro-model-registry.json`
