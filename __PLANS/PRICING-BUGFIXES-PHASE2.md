# Pricing Enhancement - Phase 2 Bugfixes

**Created:** 2026-02-09
**Status:** Investigation Complete - Ready for Implementation
**Priority:** High

---

## Summary

After initial testing of the Claude API Pricing Enhancement (Phase 1), the following issues were identified:

| Issue | Description | Severity | Status |
|-------|-------------|----------|--------|
| #1 | Agent Settings Detection | ✅ Working | No fix needed |
| #2 | Folder Settings Toggle Shows Blank | Minor | Ready to fix |
| #3 | Folder Settings Shows "API Key" instead of "Max" | Critical | Ready to fix |
| #4 | Which is correct? | #1 correct, #3 bug | Analysis complete |
| #5 | Usage Dashboard Still Uses API Pricing | Critical | Separate plan |

---

## Issue #1: Agent Settings Dialog - WORKING CORRECTLY ✅

**Observation:** In each individual Agent Settings dialog, the Billing Mode auto-detection properly shows "Detected: Max", and Pricing Model is correctly set to "Auto Detect".

**Analysis:** The code path works correctly:
- `EditAgentModal` in `NewInstanceModal.tsx` (line 1314) calls:
  ```typescript
  window.maestro.agents.detectAuth(session.toolType, sshRemoteId)
  ```
- It correctly passes the SSH remote ID when applicable
- The `detectLocalAuth()` function reads `~/.claude/.credentials.json`
- Finds `subscriptionType: "max"` and returns `{ billingMode: 'max', source: 'oauth' }`

**Verdict:** No fix needed.

---

## Issue #2: Folder Settings - Project Toggle Shows Blank

**Observation:** The project-level toggle shows blank (mixed state) even when all agents are set to 'auto' and have the same detected auth.

**Root Cause:** In `ProjectFolderSettingsModal.tsx`, the `calculateProjectBillingState()` function (lines 66-82):
```typescript
function calculateProjectBillingState(agents: AgentRowData[]): ProjectBillingState {
  const claudeAgents = agents.filter((a) => a.isClaude);
  if (claudeAgents.length === 0) return 'max';

  const modes = new Set(
    claudeAgents.map((a) => (a.billingMode === 'auto' ? 'auto' : a.billingMode))
  );

  if (modes.size === 1) {
    const mode = [...modes][0];
    // BUG: If all are 'auto', returns 'mixed' instead of using detected mode
    return mode === 'auto' ? 'mixed' : (mode as ClaudeBillingMode);
  }
  return 'mixed';
}
```

**Fix:** When all agents are 'auto', check if all detected modes match and use that value:
```typescript
if (mode === 'auto') {
  // Check if all detected billing modes match
  const detectedModes = new Set(
    claudeAgents
      .map((a) => a.detectedAuth?.billingMode)
      .filter((m): m is ClaudeBillingMode => m !== undefined)
  );
  if (detectedModes.size === 1) {
    return [...detectedModes][0];
  }
  return 'mixed';
}
```

---

## Issue #3: Folder Settings Shows "API Key" Instead of "Max"

**Observation:** In the Folder Settings dialog, each agent's Detected column shows "API Key" and dropdown shows "Auto (API)" instead of "Max" - even though all agents are authenticated with Max.

**Root Cause:** In `ProjectFolderSettingsModal.tsx`, line 242-243:
```typescript
const [pricingConfig, auth] = await Promise.all([
  window.maestro.agents.getPricingConfig(session.toolType),
  window.maestro.agents.detectAuth(session.toolType),  // BUG: Missing sshRemoteId!
]);
```

Compare to the working code in `EditAgentModal` (line 1314):
```typescript
window.maestro.agents.detectAuth(session.toolType, sshRemoteId)
```

The `ProjectFolderSettingsModal` doesn't extract the SSH remote ID from the session config. However, for **local agents** (no SSH), this should still work via `detectLocalAuth()`.

**Further Investigation:** The actual bug may be that `detectAuth` is being called in a loop rapidly, and there's some issue with how the results are being processed or displayed. The `detectAuth` handler does call `detectLocalAuth()` which reads the credentials file.

**Possible causes:**
1. The `session.toolType` is being passed but the actual session SSH config is not being extracted
2. The credentials file is being read but the result isn't being stored correctly in the agent row data
3. There's a race condition in the Promise.all loop

**Fix:** Update the agent loading loop to properly extract SSH remote ID:
```typescript
if (isClaude) {
  try {
    // Extract SSH remote ID from session config
    const sshRemoteId = session.sessionSshRemoteConfig?.enabled
      ? (session.sessionSshRemoteConfig.remoteId ?? undefined)
      : undefined;

    const [pricingConfig, auth] = await Promise.all([
      window.maestro.agents.getPricingConfig(session.toolType),
      window.maestro.agents.detectAuth(session.toolType, sshRemoteId),
    ]);
    // ...
  }
}
```

Also add logging to verify the detection is working:
```typescript
console.log(`[FolderSettings] Detected auth for ${session.name}:`, auth);
```

---

## Issue #4: Which is Correct?

**Answer:** Issue #1 (Agent Settings) is working correctly. Issue #3 (Folder Settings) has a bug.

**Reason:** The Agent Settings modal correctly passes the SSH remote ID and handles the detection properly. The Folder Settings modal has a bug in how it calls the detection API.

---

## Issue #5: Usage Dashboard Still Uses API Pricing

**Status:** Requires separate, more extensive plan. See `/app/Maestro/__PLANS/PRICING-DASHBOARD-COST-FIX.md`.

**Summary:** Costs are stored at query time using Claude's reported `total_cost_usd` which is always API pricing. The billing mode is never considered during cost calculation or storage.

---

## Implementation Order

1. **Fix #3 first** - Critical bug, detection not working in Folder Settings
2. **Fix #2 second** - Polish, project toggle should show detected mode when all agents are 'auto'
3. **Fix #5 separately** - Requires pipeline changes, database schema update, more planning

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/renderer/components/modals/ProjectFolderSettingsModal.tsx` | Fix #2 and #3 |

---

## Auto Run Documents

- `__AUTORUN/PRICING-FIX-02-FOLDER-TOGGLE.md` - Fix for project toggle blank state
- `__AUTORUN/PRICING-FIX-03-FOLDER-DETECTION.md` - Fix for detection showing API instead of Max
