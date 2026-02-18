# Plan: New Claude Model Detection on Startup (Option B — Detection + Notification)

**Date**: 2026-02-18
**Status**: Approved — Ready for Auto Run Documents
**Priority**: Medium (Quality of Life — prevents silent $0 cost recording)

---

## Context

When Anthropic releases new Claude models (like Sonnet 4.6 yesterday), Maestro's static pricing registry doesn't recognize them, causing sessions to record $0 costs. Currently, adding a model requires manual code changes across 5+ files. This feature will automatically detect new models on app startup and notify the user via a toast, so they know a Maestro update is needed.

**This is detection + notification only — no auto-apply of pricing.**

---

## Data Source: Anthropic Pricing Page

**URL**: `https://docs.anthropic.com/en/about-claude/pricing` (redirects to `https://platform.claude.com/docs/en/about-claude/pricing`)

**Why this source:**
- Lists ALL Claude models (current + deprecated) with names and pricing
- **No authentication required** — works for Claude Max users (OAuth), API key users, and everyone
- The `/v1/models` API was considered but rejected: it requires an API key header, which Claude Max (OAuth) users don't have

**Table structure**: The pricing page has a markdown table with model names like:
```
Claude Opus 4.6, Claude Opus 4.5, Claude Opus 4.1, Claude Opus 4,
Claude Sonnet 4.6, Claude Sonnet 4.5, Claude Sonnet 4, Claude Sonnet 3.7 (deprecated),
Claude Haiku 4.5, Claude Haiku 3.5, Claude Opus 3 (deprecated), Claude Haiku 3
```

Columns: `Model | Base Input Tokens | 5m Cache Writes | 1h Cache Writes | Cache Hits & Refreshes | Output Tokens`

**Parsing approach**: Fetch the page, extract model names matching `Claude [Family] [Version]` patterns from the pricing table. We only need model names for detection — pricing extraction is a bonus but not required for v1.

**Fragility mitigation**: If the page fetch or parse fails, the app continues normally with no notification. This is an informational feature, not a critical path.

---

## Architecture

Follows the existing **app update checker** pattern exactly:

```
model-checker.ts → IPC handler → preload bridge → App.tsx useEffect → toast
```

---

## Files to Create/Modify

### 1. NEW: `src/main/model-checker.ts`

Core module (mirrors `src/main/update-checker.ts` pattern):

- **`checkForNewModels()`** — fetches the Anthropic pricing page, parses model names from the HTML/markdown table, compares against `getAllKnownModelStrings()` from `claude-pricing.ts`, returns `ModelCheckResult`
- **`ModelCheckResult`** interface: `{ newModels: NewModelInfo[], error?: string, skipped?: boolean }`
- **`NewModelInfo`** interface: `{ name: string, inputPricePerMillion?: number, outputPricePerMillion?: number }`
- Module-level `sessionChecked` boolean — only checks once per app session (no persistence needed)
- Guards: skip if already checked this session, silent on network/parse errors

**Parsing strategy**:
1. Fetch `https://docs.anthropic.com/en/about-claude/pricing` (follows redirects)
2. Parse the response text to extract model names from the pricing table
3. Use regex to find model name patterns: `Claude\s+(Opus|Sonnet|Haiku)\s+[\d.]+`
4. Normalize extracted names to lowercase display-name format for comparison
5. Compare each found model against the set of known model display names from `CLAUDE_MODEL_PRICING` (using `displayName` field)
6. Return any models NOT found in the local registry

**Key design choice**: Compare by display name (e.g., "Claude Sonnet 4.6") rather than model ID (e.g., "claude-sonnet-4-6-20260218"), because the pricing page shows human-readable names, not API IDs. The `getAllKnownModelDisplayNames()` function will return a `Set<string>` of all `displayName` values from `CLAUDE_MODEL_PRICING`.

### 2. MODIFY: `src/main/utils/claude-pricing.ts`

Add one new export:

```typescript
/**
 * Get all known model display names from the pricing registry.
 * Used by the model checker to compare against externally discovered models.
 */
export function getAllKnownModelDisplayNames(): Set<string> {
  const names = new Set<string>();
  for (const pricing of Object.values(CLAUDE_MODEL_PRICING)) {
    names.add(pricing.displayName);
  }
  return names;
}
```

### 3. MODIFY: `src/main/ipc/handlers/system.ts`

Add after the `updates:check` handler (~line 282):

```typescript
import { checkForNewModels } from '../../model-checker';

ipcMain.handle('models:checkNew', async () => {
  return checkForNewModels();
});
```

No API key or settings needed — the model checker fetches a public page.

### 4. MODIFY: `src/main/preload/system.ts`

Extend `createUpdatesApi()` return object with:

```typescript
checkNewModels: (): Promise<{
  newModels: Array<{ name: string; inputPricePerMillion?: number; outputPricePerMillion?: number }>;
  error?: string;
  skipped?: boolean;
}> => ipcRenderer.invoke('models:checkNew'),
```

### 5. MODIFY: `src/renderer/global.d.ts`

Add to the `updates` section (~line 1674, before the closing `};`):

```typescript
checkNewModels: () => Promise<{
  newModels: Array<{ name: string; inputPricePerMillion?: number; outputPricePerMillion?: number }>;
  error?: string;
  skipped?: boolean;
}>;
```

### 6. MODIFY: `src/renderer/hooks/settings/useSettings.ts`

Add `checkForNewModelsOnStartup` boolean (default: `true`) following the exact pattern of `checkForUpdatesOnStartup`:
- Interface addition
- State declaration: `useState(true)`
- Setter callback with `window.maestro.settings.set('checkForNewModelsOnStartup', value)`
- Settings load block (read from `allSettings`)
- Return object

### 7. MODIFY: `src/renderer/App.tsx`

Add a `useEffect` after the existing update check effect (~line 1766):
- Guard: `settingsLoaded && checkForNewModelsOnStartup`
- 5-second delay (longer than update check's 2s to avoid competing)
- Calls `window.maestro.updates.checkNewModels()`
- If new models found: shows `'warning'` type toasts
  - 1-3 models: one toast per model
  - 4+ models: single aggregated toast
- Message: `"{name} detected on Anthropic's pricing page but is not yet configured in Maestro — costs will show as $0 until a Maestro update adds support."`

### 8. MODIFY: `src/renderer/components/SettingsModal.tsx`

Add props for `checkForNewModelsOnStartup` / `setCheckForNewModelsOnStartup`, and a `SettingCheckbox` after the Beta Updates toggle:
- Icon: `Cpu` from lucide-react
- Title: "Check for new Claude models on startup"
- Description: "Notify when Anthropic releases a Claude model not yet in Maestro's pricing registry"

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Network failure (no internet) | Log warning, return `{ error }`, no toast |
| Page returns non-200 | Log warning, return `{ error }`, no toast |
| Redirect to unexpected URL | Follow redirects (built into `fetch`) |
| Page HTML changed / table not found | Log warning, return `{ newModels: [] }` |
| Regex finds no model names | Return `{ newModels: [] }`, no toast |
| Setting disabled | `useEffect` guard prevents any call |
| Already checked this session | `sessionChecked` guard, returns `{ skipped: true }` |
| 0 new models found | No toast |
| "(deprecated)" in model name | Strip suffix before comparison |

---

## Phased Auto Run Documents

### Phase 01: Core Implementation
- Create `model-checker.ts` (fetch + parse + compare)
- Add `getAllKnownModelDisplayNames()` to `claude-pricing.ts`
- Add IPC handler in `system.ts`
- Add preload bridge in `system.ts`
- Update `global.d.ts`

### Phase 02: UI Integration
- Add setting to `useSettings.ts`
- Add startup effect to `App.tsx`
- Add toggle to `SettingsModal.tsx`

### Phase 03: Tests + Build + Verify
- Add tests for `getAllKnownModelDisplayNames()`
- Add tests for `model-checker.ts` (mocked fetch)
- Run `npm run lint`, `npm test`, `npm run build:main`

---

## Verification

1. `npm run lint` — no TypeScript errors in modified files
2. `npm test` — new tests pass
3. `npm run build:main` — main process builds
4. Manual: launch app, verify toast appears if a new model exists (or no toast if all known)
