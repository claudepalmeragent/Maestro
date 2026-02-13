# Synopsis Spawn Error Bug Investigation

**Date**: 2026-02-13
**Status**: Investigation Complete
**Priority**: High (affects every SSH session interaction)

---

## Executive Summary

The synopsis feature shows an error toast notification (`[error] spawn /usr/local/bin/claude ENOENT`) at the end of EVERY query when running on an SSH remote host. This occurs because:

1. **Missing SSH Config**: The synopsis process is spawned WITHOUT the session's SSH remote configuration, causing it to try to run `/usr/local/bin/claude` locally instead of on the remote host
2. **Poor Error Handling**: The spawn handler returns `success: true` even when the process errors with exit code 1

---

## Root Cause Analysis

### Issue 1: Missing `sessionSshRemoteConfig` in Synopsis Data

**Location**: `/app/Maestro/src/renderer/App.tsx`, lines 2143-2149

```typescript
sessionConfig: {
    customPath: currentSession.customPath,
    customArgs: currentSession.customArgs,
    customEnvVars: currentSession.customEnvVars,
    customModel: currentSession.customModel,
    customContextWindow: currentSession.customContextWindow,
    // MISSING: sessionSshRemoteConfig
},
```

The `synopsisData` object does NOT include `sessionSshRemoteConfig`, even though:
- The Session type has `sessionSshRemoteConfig` property (types/index.ts:685-689)
- The `spawnBackgroundSynopsis` function accepts it (useAgentExecution.ts:522-526)
- The spawn IPC handler supports it (process.ts:507-510)

**Result**: Synopsis tries to spawn `/usr/local/bin/claude` locally when it should spawn via SSH.

### Issue 2: Exit Code Ignored in `spawnBackgroundSynopsis`

**Location**: `/app/Maestro/src/renderer/hooks/agent/useAgentExecution.ts`, lines 577-588

```typescript
cleanupFns.push(
    window.maestro.process.onExit((sid: string) => {  // Exit code is available but ignored!
        if (sid === targetSessionId) {
            cleanup();
            resolve({
                success: true,  // Always returns true, even on error!
                response: responseText,
                agentSessionId,
                usageStats: synopsisUsageStats,
            });
        }
    })
);
```

The `onExit` callback receives `(sessionId: string, code: number)` but only uses `sid`. When the spawn fails, the process emits `exit` with code 1, but the handler still returns `success: true` with the error message as `responseText`.

### Issue 3: Error Output Captured as Response

**Location**: `/app/Maestro/src/main/process-manager/handlers/ExitHandler.ts`, line 295

```typescript
this.emitter.emit('data', sessionId, `[error] ${error.message}`);
this.emitter.emit('exit', sessionId, 1);
```

When a spawn error occurs, the error message is emitted as a `data` event BEFORE the `exit` event. This gets captured in `responseText` and displayed in the toast because `success: true` is returned.

---

## Data Flow Diagram

```
User completes query on SSH remote
        │
        ▼
App.tsx onProcessExit handler
        │
        ├── synopsisData built (MISSING sessionSshRemoteConfig)
        │
        ▼
spawnBackgroundSynopsis called
        │
        ▼
window.maestro.process.spawn({
    sessionSshRemoteConfig: undefined  // Not passed!
})
        │
        ▼
Main Process: spawn("/usr/local/bin/claude", ...)
        │
        ▼ LOCAL SPAWN FAILS (ENOENT)
        │
ExitHandler.handleError
        ├── emit('data', '[error] spawn /usr/local/bin/claude ENOENT')
        └── emit('exit', sessionId, 1)
        │
        ▼
spawnBackgroundSynopsis onData: responseText += '[error]...'
spawnBackgroundSynopsis onExit: resolve({ success: true, response: '[error]...' })
        │
        ▼
App.tsx then block:
    addToastRef.current({
        type: 'info',
        title: 'Synopsis',
        message: '[error] spawn /usr/local/bin/claude ENOENT'  // Bug!
    })
```

---

## Impact Assessment

| Aspect | Impact |
|--------|--------|
| **User Experience** | Every SSH session query shows an error toast, confusing users |
| **Synopsis Feature** | 100% broken for SSH remote sessions |
| **History Entries** | No USER history entries created for SSH sessions |
| **Data Loss** | Work summaries are not being saved for SSH users |
| **Performance** | Wasted process spawn attempts for every query |

---

## Questions Answered

### Q1: Is a Toast notification desired behavior at the end of a task?

**Yes**, but only for SUCCESS cases. The synopsis toast (type: 'info', title: 'Synopsis') is designed to show users a brief summary of the work completed. This is valuable UX feedback.

### Q2: Why is an error replacing whatever message should be shown?

Two compounding bugs:
1. The SSH config is not passed, so the spawn fails
2. The error handler returns `success: true` with the error as the response text
3. The toast code shows `result.response` assuming it's a valid synopsis

### Q3: What does the error mean, and is it a separate issue?

**Error meaning**: `spawn /usr/local/bin/claude ENOENT` means Node.js tried to spawn a process at `/usr/local/bin/claude` on the LOCAL machine, but that file doesn't exist locally.

**Important clarification**: `/usr/local/bin/claude` IS the correct path - but on the REMOTE SSH host. The error occurs because:
- The synopsis spawn is missing SSH config
- Therefore it runs LOCALLY instead of via SSH
- The local machine doesn't have Claude at that path (Claude is on the remote)
- ENOENT = "Error NO ENTry" (file not found)

**Separate issue**: No, this is part of the same bug. The error is a symptom of missing SSH configuration. Once SSH config is passed, the spawn will execute on the remote host where `/usr/local/bin/claude` exists.

---

## Recommended Fix Strategy

### Option A: Minimal Fix (Pass SSH Config)

**Risk**: Low
**Effort**: Small (1-2 lines changed)
**Coverage**: Fixes synopsis for SSH sessions

Add `sessionSshRemoteConfig` to the `synopsisData.sessionConfig` object:

```typescript
sessionConfig: {
    customPath: currentSession.customPath,
    customArgs: currentSession.customArgs,
    customEnvVars: currentSession.customEnvVars,
    customModel: currentSession.customModel,
    customContextWindow: currentSession.customContextWindow,
    sessionSshRemoteConfig: currentSession.sessionSshRemoteConfig, // ADD THIS
},
```

### Option B: Defensive Fix (Also Handle Exit Code)

**Risk**: Low
**Effort**: Small (5-10 lines changed)
**Coverage**: Fixes SSH issue AND prevents future error-as-success bugs

1. Apply Option A fix
2. Modify `spawnBackgroundSynopsis` to check exit code:

```typescript
window.maestro.process.onExit((sid: string, code: number) => {
    if (sid === targetSessionId) {
        cleanup();
        const isError = code !== 0 || responseText.includes('[error]');
        resolve({
            success: !isError,
            response: isError ? '' : responseText,
            agentSessionId,
            usageStats: synopsisUsageStats,
        });
    }
})
```

### Option C: Comprehensive Fix (Full Error Handling Refactor)

**Risk**: Medium
**Effort**: Medium (refactor error handling pattern)
**Coverage**: Fixes issue + improves overall error handling

1. Apply Option A and B fixes
2. Add `onAgentError` listener in `spawnBackgroundSynopsis` to capture structured errors
3. Add explicit failure state tracking (`errorReceived` flag)
4. Consider whether synopsis errors should show a different toast type ('warning' vs 'error')

---

## Recommendation

**Implement Option B (Defensive Fix)**:
- Low risk, fixes the immediate bug
- Adds defensive programming against future similar issues
- Does not require significant refactoring
- Can be followed up with Option C if more comprehensive error handling is needed later

---

## Files to Modify

| File | Change |
|------|--------|
| `src/renderer/App.tsx` | Add `sessionSshRemoteConfig` to synopsisData.sessionConfig (~line 2148) |
| `src/renderer/hooks/agent/useAgentExecution.ts` | Check exit code in onExit handler (~line 578) |

---

## Testing Plan

1. **SSH Session Test**:
   - Connect to SSH remote
   - Run a query
   - Verify synopsis toast shows correct summary (not error)
   - Verify history entry is created

2. **Local Session Test** (regression):
   - Run query locally
   - Verify synopsis still works as expected

3. **Error Handling Test**:
   - Simulate agent crash (e.g., kill process mid-stream)
   - Verify no false "success" toast is shown

---

## Related Issues

- Previous attempt to fix this in earlier context (reverted with other changes)
- The `onAgentError` handler at App.tsx:2920 already filters out synopsis errors, but that's AFTER the toast is shown

---

## Appendix: Code References

### Synopsis Data Construction
- `/app/Maestro/src/renderer/App.tsx:2132-2150`

### Background Synopsis Spawn
- `/app/Maestro/src/renderer/hooks/agent/useAgentExecution.ts:509-619`

### Exit Handler Error Emission
- `/app/Maestro/src/main/process-manager/handlers/ExitHandler.ts:265-298`

### Session SSH Config Type
- `/app/Maestro/src/renderer/types/index.ts:685-689`
