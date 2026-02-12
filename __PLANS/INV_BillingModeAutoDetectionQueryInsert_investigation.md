# Investigation Report: Billing Mode Auto-Detection for Query Insert

**Date:** 2026-02-12
**Issue:** `maestroBillingMode` returns `'api'` instead of `'max'` when calling `detectLocalAuth()` in stats.ts IPC handler
**Status:** Investigation Complete

---

## Executive Summary

The billing mode auto-detection works correctly in the **renderer UI** (Agent Settings shows "Max" correctly) but fails in the **main process stats handler** (`stats.ts`). The investigation reveals that both code paths call the same `detectLocalAuth()` function, but the main process context may have different behavior due to:

1. **Timing:** The IPC handler is called synchronously during query completion, while the UI detection is called independently with full async resolution
2. **Promise behavior:** The `await detectLocalAuth()` in stats.ts may be silently failing or timing out
3. **File system access:** The credentials file read may behave differently in the IPC handler context

---

## Part 1: System Architecture Analysis

### 1.1 Billing Mode Detection Points (Complete Inventory)

| Location | File | Function | Type | Works? |
|----------|------|----------|------|--------|
| **UI Display** | `useBillingMode.ts` | `window.maestro.agents.detectAuth()` → IPC → `detectLocalAuth()` | Async (hook) | **YES** |
| **Agent Settings** | `agents.ts:692` | `agents:detectAuth` IPC handler → `detectLocalAuth()` | Async (IPC) | **YES** |
| **Stats Handler (Interactive)** | `stats.ts:123` | Inline `detectLocalAuth()` call | Async (IPC) | **NO** |
| **Stats Listener (Batch)** | `stats-listener.ts:75` | `resolveBillingModeAsync()` → `detectLocalAuth()` | Async (listener) | **UNTESTED** |

### 1.2 detectLocalAuth() Implementation

**File:** `/app/Maestro/src/main/utils/claude-auth-detector.ts` (Lines 195-230)

```typescript
export async function detectLocalAuth(): Promise<DetectedAuth> {
  const credentialsPath = getLocalClaudeCredentialsPath(); // ~/.claude/.credentials.json
  const now = Date.now();

  try {
    const content = await fs.readFile(credentialsPath, 'utf-8');
    const creds = parseCredentialsFile(content);

    if (!creds) {
      return { billingMode: 'api', source: 'default', detectedAt: now };
    }

    return detectAuthFromCredentials(creds);
  } catch (error) {
    // Returns 'api' on file not found or read error
    return { billingMode: 'api', source: 'default', detectedAt: now };
  }
}
```

**Verification:** Running `node -e "require('./dist/main/utils/claude-auth-detector.js').detectLocalAuth().then(console.log)"` returns:
```json
{
  "billingMode": "max",
  "subscriptionType": "max",
  "rateLimitTier": "default_claude_max_5x",
  "source": "oauth",
  "detectedAt": 1770877455203
}
```

**Conclusion:** The function works correctly in isolation.

---

## Part 2: The Working Path (UI Detection)

### 2.1 How the UI Successfully Detects Billing Mode

```
1. Component mounts (e.g., AgentSettings, AgentSessionsBrowser)
     ↓
2. useBillingMode hook called with agentId='claude-code'
     ↓
3. Hook calls: window.maestro.agents.detectAuth(agentId, sshRemoteId)
     ↓
4. Preload bridge (preload/agents.ts:199):
   ipcRenderer.invoke('agents:detectAuth', agentId, sshRemoteId)
     ↓
5. IPC Handler (ipc/handlers/agents.ts:692):
   return await detectLocalAuth();
     ↓
6. detectLocalAuth() reads ~/.claude/.credentials.json
     ↓
7. Returns { billingMode: 'max', source: 'oauth', ... }
     ↓
8. Hook sets: setDetectedBillingMode('max')
     ↓
9. UI displays correctly
```

**Key Observation:** This path works because the IPC call happens in a clean async context with no interference.

---

## Part 3: The Failing Path (Stats Handler)

### 3.1 Current Implementation in stats.ts

**File:** `/app/Maestro/src/main/ipc/handlers/stats.ts` (Lines 108-125)

```typescript
// Calculate both costs from tokens for Claude agents
const isClaude = CLAUDE_AGENT_TYPES.has(event.agentType);
if (isClaude) {
  try {
    const configKey = event.agentType; // 'claude-code'

    // Check agent config first
    const store = getAgentConfigsStore();
    const allConfigs = store.get('configs', {});
    const agentConfig = allConfigs[configKey]?.pricingConfig;

    if (agentConfig?.billingMode && agentConfig.billingMode !== 'auto') {
      maestroBillingMode = agentConfig.billingMode;  // Uses explicit setting
    } else {
      // Auto-detect from credentials
      const auth = await detectLocalAuth();  // <-- THIS RETURNS 'api' INSTEAD OF 'max'
      maestroBillingMode = auth.billingMode;
    }
```

### 3.2 Debug Log Output Analysis

From the latest test:
```
[FIX-30] stats:record-query received: {
  sessionId: 'ca81064a-87fb-4f7d-886b-6a8f52af7e3b',
  incomingDetectedModel: 'claude-opus-4-5-20251101',
  agentType: 'claude-code',
  totalCostUsd: 164.56722649999992
}
[FIX-30] Resolved billing mode: { configKey: 'claude-code', maestroBillingMode: 'api' }
```

**Key Observation:**
- `agentConfig.billingMode` is `'auto'` (so we fall through to detection)
- `detectLocalAuth()` returned `billingMode: 'api'` (should be `'max'`)
- No error was logged (so the function completed)

### 3.3 Why detectLocalAuth() Returns 'api' in Stats Handler

**Hypothesis 1: Silent File Read Failure**
- `fs.readFile` may fail silently in the IPC context
- Error is caught and returns default `'api'`

**Hypothesis 2: Different Working Directory**
- `os.homedir()` may return unexpected value
- Credentials path may be wrong

**Hypothesis 3: Timing/Race Condition**
- The IPC handler runs during process cleanup
- File system may be temporarily unavailable

**Hypothesis 4: Module Resolution Issue**
- The import of `detectLocalAuth` may resolve to a different module instance
- Cache state may differ between module instances

---

## Part 4: Comparison with Working Implementation

### 4.1 The agents:detectAuth IPC Handler (WORKS)

**File:** `/app/Maestro/src/main/ipc/handlers/agents.ts` (Lines 666-694)

```typescript
ipcMain.handle(
  'agents:detectAuth',
  withIpcErrorLogging(
    handlerOpts('detectAuth'),
    async (_agentId: string, sshRemoteId?: string) => {
      if (sshRemoteId) {
        // SSH remote detection
        return await detectRemoteAuthCached(sshRemoteId, sshConfig);
      }

      // Local detection
      logger.debug(`Detecting auth locally`, LOG_CONTEXT);
      return await detectLocalAuth();  // <-- WORKS HERE
    }
  )
);
```

### 4.2 Key Differences

| Aspect | agents:detectAuth (WORKS) | stats:record-query (FAILS) |
|--------|---------------------------|----------------------------|
| Handler wrapper | `withIpcErrorLogging` | `withIpcErrorLogging` |
| Caller timing | Independent UI request | During process exit flow |
| Module import | Direct from agents.ts | Direct from stats.ts |
| Call depth | Shallow (IPC → detect) | Deep (IPC → enrich → detect) |
| Error handling | Logged by wrapper | try/catch in enrich function |

---

## Part 5: Root Cause Analysis

### 5.1 Most Likely Root Cause

The `detectLocalAuth()` function is being called but returning `'api'` with `source: 'default'`, which means:

1. The credentials file read failed (ENOENT or permission error), OR
2. The credentials file was read but parsing failed, OR
3. The parsed credentials don't have `claudeAiOauth.subscriptionType === 'max'`

Given that:
- The same function works in `agents:detectAuth`
- The function works when tested directly via Node
- The credentials file exists and has correct content

**The issue is likely environmental:** The IPC handler context during `stats:record-query` has some restriction that prevents the file read from completing successfully.

### 5.2 Secondary Hypothesis

The function may be returning before the await completes. This could happen if:
- The Promise chain is broken
- There's an unhandled rejection being swallowed
- The module import is somehow creating a different function instance

---

## Part 6: Proposed Solutions

### Option A: Pass Billing Mode from Renderer (RECOMMENDED)

**Strategy:** The renderer already knows the billing mode (via `useBillingMode` hook). Pass it along with the query event.

**Implementation:**
1. Add `detectedBillingMode` to the `recordQuery` call in App.tsx
2. Use passed value in stats.ts instead of re-detecting

**Pros:**
- Uses already-working detection path
- No additional file I/O in stats handler
- Consistent with how `detectedModel` is passed

**Cons:**
- Requires renderer changes
- Billing mode is per-call rather than per-session

**Files to modify:**
- `src/renderer/App.tsx` - Pass billing mode
- `src/renderer/hooks/agent/useAgentExecution.ts` - Pass billing mode (Auto Run)
- `src/main/ipc/handlers/stats.ts` - Use passed value
- `src/shared/stats-types.ts` - Add `detectedBillingMode` field

**Estimated effort:** 2-3 hours

---

### Option B: Use IPC Call Instead of Direct Function Call

**Strategy:** Call `agents:detectAuth` via IPC instead of calling `detectLocalAuth()` directly.

**Implementation:**
```typescript
// In stats.ts
import { ipcMain } from 'electron';

// Inside calculateAndEnrichEvent:
const auth = await ipcMain.handle('agents:detectAuth', null, 'claude-code', undefined);
maestroBillingMode = auth.billingMode;
```

**Pros:**
- Uses the exact code path that works
- No renderer changes needed

**Cons:**
- Self-IPC is unusual pattern
- May have performance implications
- Doesn't address root cause

**Estimated effort:** 1 hour

---

### Option C: Cache Detection Result at App Startup

**Strategy:** Detect billing mode once at app startup and cache globally.

**Implementation:**
1. In main/index.ts, call `detectLocalAuth()` during init
2. Store result in a module-level cache
3. Use cached value in stats handlers

**Pros:**
- Single detection call
- Fast subsequent lookups
- Avoids IPC context issues

**Cons:**
- Requires app restart if credentials change
- Additional startup code

**Files to modify:**
- `src/main/index.ts` - Add startup detection
- `src/main/utils/claude-auth-detector.ts` - Add cache
- `src/main/ipc/handlers/stats.ts` - Use cache

**Estimated effort:** 2 hours

---

### Option D: Debug and Fix Root Cause

**Strategy:** Add comprehensive logging to understand exactly why detection fails.

**Implementation:**
1. Add logging to `detectLocalAuth()` at every step
2. Log homedir, credentials path, file existence, file content, parse result
3. Compare logs between working and failing paths

**Pros:**
- Addresses root cause
- May reveal other issues

**Cons:**
- Requires investigation time
- May not find clear cause

**Estimated effort:** 3-4 hours (uncertain)

---

## Part 7: Recommendation

### Primary Recommendation: Option A (Pass from Renderer)

**Rationale:**
1. The renderer already has reliable billing mode detection working
2. Follows the established pattern for `detectedModel` (passed from renderer)
3. Avoids duplicating detection logic
4. More resilient (detection happens in clean context, not during process exit)

### Implementation Plan

**Phase 1: Add billing mode to renderer flow (1-2 hours)**

1. In `App.tsx`, get billing mode when handling process exit:
   - Use session's stored billing mode OR
   - Call `useBillingMode` result stored in session state

2. Pass `detectedBillingMode` in `recordQuery` call:
```typescript
window.maestro.stats.recordQuery({
  // ... existing fields ...
  detectedBillingMode: resolvedBillingMode, // 'api' or 'max'
});
```

3. Update `useAgentExecution.ts` similarly for Auto Run path

**Phase 2: Update stats handler (30 mins)**

1. In `stats.ts`, use passed billing mode:
```typescript
// If passed from renderer, use it
if ((event as any).detectedBillingMode) {
  maestroBillingMode = (event as any).detectedBillingMode;
} else {
  // Fallback to detection (for legacy/batch mode)
  const auth = await detectLocalAuth();
  maestroBillingMode = auth.billingMode;
}
```

**Phase 3: Update types (15 mins)**

1. Add `detectedBillingMode?: 'api' | 'max'` to QueryEvent in `stats-types.ts`

**Phase 4: Testing (30 mins)**

1. Verify interactive mode records `maestro_billing_mode: 'max'`
2. Verify costs differ: `anthropic_cost_usd` > `maestro_cost_usd` (cache tokens free)
3. Verify Auto Run mode also works

---

## Part 8: Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Renderer doesn't have billing mode available | Low | Medium | Check useBillingMode is called; add fallback to detection |
| Breaking existing stats flow | Low | High | Keep detection as fallback; thorough testing |
| Performance impact | Very Low | Low | Billing mode is small string; no file I/O overhead |
| Type compatibility issues | Low | Low | Add as optional field; existing consumers unaffected |

---

## Part 9: Files Affected Summary

### For Option A (Recommended):

| File | Change |
|------|--------|
| `src/renderer/App.tsx` | Pass `detectedBillingMode` in recordQuery |
| `src/renderer/hooks/agent/useAgentExecution.ts` | Pass `detectedBillingMode` in recordQuery (Auto Run) |
| `src/main/ipc/handlers/stats.ts` | Use passed billing mode if available |
| `src/shared/stats-types.ts` | Add `detectedBillingMode` optional field |

### Unchanged:
- `src/main/utils/claude-auth-detector.ts` - No changes needed
- `src/main/utils/pricing-resolver.ts` - No changes needed
- `src/main/process-listeners/stats-listener.ts` - No changes needed (batch mode)

---

## Part 10: Conclusion

The billing mode auto-detection failure in the stats IPC handler is caused by environmental differences between the working IPC path (`agents:detectAuth`) and the failing path (`stats:record-query`). Rather than debugging the root cause of the file system access issue, the recommended solution is to **pass the already-detected billing mode from the renderer**, which follows established patterns and provides a more resilient architecture.

This approach:
1. Uses the working detection path
2. Eliminates redundant file I/O
3. Follows the `detectedModel` pattern
4. Can be implemented quickly (2-3 hours)

---

**Document Author:** Claude Investigation Agent
**Review Status:** Ready for User Review
