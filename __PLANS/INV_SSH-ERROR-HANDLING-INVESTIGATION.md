# SSH Error Handling Investigation & Remediation Plan

**Date**: 2026-02-13
**Status**: Investigation Complete - **CRITICAL ROOT CAUSE IDENTIFIED**
**Priority**: High
**Type**: Bug Fix / Architecture Improvement

---

## Executive Summary

SSH connection errors in Maestro appear in multiple UI locations (chat logs, synopsis messages, error alert modals, toasts) and interrupt workflows during both Auto Run and interactive sessions.

### Primary Root Cause: NO SSH CONNECTION SHARING

**Maestro explicitly DISABLES SSH connection multiplexing** (`ssh-remote-manager.ts:71-73`):

```typescript
ControlMaster: 'no',    // Disable connection multiplexing
ControlPath: 'none',    // Ensure no ControlPath is used
ControlPersist: 'no',   // Don't persist control connections
```

**This means EVERY SSH operation creates a NEW TCP connection**, including:
- Each agent command execution
- Each file explorer operation
- Each git status check
- Each stats collection call
- Each "Test Connection" click
- Synopsis generation

For a host with multiple concurrent operations, this creates a **thundering herd** of SSH connections, which can:
1. Overwhelm the SSH server's connection limit (`MaxStartups` in sshd_config)
2. Cause race conditions in key agent authentication
3. Trigger connection timeouts when the queue backs up

### Secondary Issue: No Keep-Alives

There are **no SSH keep-alives configured** (`ServerAliveInterval`, `ServerAliveCountMax`). Combined with no connection sharing, idle connections may be silently dropped by the network/firewall, but Maestro won't know until the next operation fails.

### Why "Test Connection" Sometimes Helps

Clicking "Test Connection" runs a fresh SSH handshake which:
1. Validates the SSH key is in the agent
2. "Warms up" any network path caching
3. May clear stale state in ssh-agent

But this is a **temporary fix** - the next burst of concurrent operations can still fail.

### Your Environment: Local VMs

Since your remotes are VMs on local vmnet (no real network latency/disruption), the errors are almost certainly caused by **connection concurrency issues**, not network problems. The 10-second timeout is being hit because:
- Too many simultaneous connection attempts
- SSH server throttling new connections
- Connection queue backlog

---

## Error Types Observed

### 1. SSH Connection Timed Out
```json
{
  "type": "network_error",
  "message": "SSH connection timed out. Check network connectivity and firewall rules.",
  "recoverable": true
}
```
**Sources**:
- `error-patterns.ts:606` - Pattern match for `ssh:.*connection timed out`
- `agents.ts:132` - SSH timeout during agent detection (10s timeout)
- `remote-fs.ts:121` - Recoverable error pattern for retry logic

### 2. SSH Authentication Failed
```json
{
  "type": "permission_denied",
  "message": "SSH authentication failed. Check your SSH key configuration.",
  "recoverable": false
}
```
**Sources**:
- `error-patterns.ts:564` - Pattern match for `ssh:.*permission denied`

---

## Architecture Analysis

### Error Detection Points

SSH errors are detected at **three levels**:

1. **StdoutHandler.ts** (lines 169-191)
   - Checks agent stdout for SSH error patterns
   - Emits `agent-error` event when detected

2. **StderrHandler.ts** (lines 60-82)
   - Checks agent stderr for SSH error patterns
   - Emits `agent-error` event when detected

3. **ExitHandler.ts** (lines 134-163)
   - Checks accumulated stderr buffer on process exit
   - Emits `agent-error` event when detected

### Error Propagation Flow

```
SSH Error Detected (stdout/stderr/exit)
        │
        ▼
ProcessManager.emit('agent-error', sessionId, agentError)
        │
        ▼
error-listener.ts: safeSend('agent:error', sessionId, agentError)
        │
        ▼
Renderer: window.maestro.process.onAgentError()
        │
        ▼
App.tsx lines 2935-3157: Main error handler
        │
        ├─── Group Chat errors → setGroupChatError + message
        │
        ├─── Synopsis errors → IGNORED (line 3002-3009) ✓ Good
        │
        ├─── Batch mode errors → pauseBatchOnError + toast + history entry
        │
        └─── Interactive errors → Log entry + error modal + session state
```

### Problem: All Errors Go Through Same Pipeline

**Background operations that can trigger SSH errors:**

| Operation | Source Location | When Triggered |
|-----------|-----------------|----------------|
| Agent Detection | `agents.ts:109-199` | Settings modal, startup, "Test Connection" |
| File Explorer | `remote-fs.ts` | Panel refresh, navigation |
| Git Status | `git.ts` IPC handlers | Session creation, refresh |
| Stats Collection | `parseRemoteClaudeStatsViaShell` | Usage tracking |
| Synopsis | `useAgentExecution.ts` | After query completion |

**Current Behavior**:
- ALL these operations spawn SSH processes
- SSH errors from ANY of these operations emit `agent-error` events
- The `agent-error` handler in App.tsx treats them ALL as interactive session errors
- Result: Error modals, log entries, and state changes for background operation failures

---

## Specific Issues Identified

### Issue 1: Background SSH Operations Treated as Agent Errors

**Problem**: SSH operations for file explorer, git status, and stats collection go through the same error emission path as actual agent execution errors.

**Evidence**: Error appearing during "thinking" time when no agent is actively executing.

**Impact**:
- Error modals appear unexpectedly
- Session state set to 'error' incorrectly
- Log entries added to chat that aren't relevant to the conversation

### Issue 2: Inconsistent Session ID Patterns

**Problem**: Background operations may use session IDs that don't match the expected patterns for filtering.

**Current Filters** (App.tsx):
- Group chat: `group-chat-{UUID}-moderator-{timestamp}` or `group-chat-{UUID}-{participant}-{timestamp}`
- Synopsis: `*-synopsis-{timestamp}`
- Batch: `*-batch-{timestamp}`

**Missing Filters**:
- File explorer operations
- Git status checks
- Stats collection
- Agent detection (Test Connection)

### Issue 3: Error Messages in History JSON

**Problem**: The `errorLogEntry` (App.tsx:3039-3045) is added to the tab's `logs` array and persisted to `maestro-sessions.json`. This includes the full `agentError` object with `raw` data containing potentially large stderr output.

**Evidence**: Your JSON sample shows `raw.errorLine` containing 1021+ lines of file content - this was likely a stats parsing operation that timed out.

### Issue 4: No Distinction Between Transient and Fatal Errors

**Problem**: Transient network errors (connection timeout, connection reset) and fatal errors (authentication failed) both trigger the same error modal flow.

**Current Behavior**:
- `recoverable: true` errors still show blocking error modal
- User must manually dismiss even for transient issues
- Auto Run pauses on recoverable errors

---

## REVISED Solution Strategy

Given the root cause (no connection sharing, no keep-alives), the solution should be **architectural**, not just error routing.

### NEW Option D: SSH Connection Pool (RECOMMENDED)

**Concept**: Implement SSH connection multiplexing via ControlMaster to share a single SSH connection per remote host.

**Implementation**:
```typescript
// ssh-remote-manager.ts - REVISED defaults
private readonly defaultSshOptions: Record<string, string> = {
  BatchMode: 'yes',
  StrictHostKeyChecking: 'accept-new',
  ConnectTimeout: '10',
  ClearAllForwardings: 'yes',
  RequestTTY: 'no',
  // NEW: Enable connection sharing
  ControlMaster: 'auto',           // Automatically create/use master connection
  ControlPath: '/tmp/maestro-ssh-%r@%h:%p',  // Socket path for multiplexing
  ControlPersist: '300',           // Keep connection alive for 5 minutes after last use
  // NEW: Keep-alives
  ServerAliveInterval: '30',       // Send keep-alive every 30 seconds
  ServerAliveCountMax: '3',        // Fail after 3 missed responses (90s total)
};
```

**Benefits**:
1. **Single TCP connection per host** - No more connection storms
2. **Instant reconnect** - Subsequent operations reuse the master socket
3. **Keep-alives** - Detect dead connections proactively
4. **Built-in timeout** - ControlPersist handles idle cleanup

**Why This Was Disabled Originally**:
The comment says "prevent 'UNKNOWN port -1' errors when multiple agents connect to same server". This was likely a race condition when:
- Multiple processes tried to become ControlMaster simultaneously
- The socket file was corrupted or stale

**Mitigation for the original issue**:
1. Use atomic socket creation with unique paths per Maestro instance
2. Clean up stale sockets on startup
3. Handle ControlMaster errors gracefully (fall back to direct connection)

**Risk**: Medium - Changes SSH behavior fundamentally, but this is how SSH is *designed* to work for concurrent operations.

---

### Option A: Source-Aware Error Routing (Secondary - Still Valuable)

**Concept**: Tag SSH operations with their source/context and route errors differently based on source.

**Implementation**:
1. Add `errorSource` field to AgentError type: `'agent' | 'background' | 'synopsis' | 'batch' | 'detection'`
2. Set source when spawning processes (already have `querySource` for some operations)
3. Route errors based on source:
   - `agent` → Current behavior (modal + log + state)
   - `background` → Log only (debug level) + optional toast
   - `synopsis` → Already ignored correctly
   - `batch` → Pause + toast (current behavior)
   - `detection` → Toast only (no modal, no log)

**Pros**: Clean separation, maintains audit trail, minimal disruption
**Cons**: Requires changes to spawn parameters and error handling

### Option B: Separate Error Channels

**Concept**: Create separate IPC channels for different error types.

**Implementation**:
1. `agent:error` - Interactive session errors (current)
2. `agent:background-error` - File explorer, git, stats errors
3. `agent:detection-error` - Agent detection errors

**Pros**: Very explicit, no changes to existing error handler
**Cons**: Code duplication, more IPC surface area

### Option C: Error Severity/Context in Current Flow

**Concept**: Enhance current error handling with severity and context checks.

**Implementation**:
1. Add `severity` to AgentError: `'blocking' | 'warning' | 'info'`
2. Add `context` to AgentError: `'interactive' | 'background'`
3. Modify App.tsx handler to check these fields
4. Only show modal for `blocking` + `interactive` errors

**Pros**: Minimal structural changes
**Cons**: Still funnels all errors through same path, just filters at the end

---

## REVISED Recommended Implementation Plan

### Phase 0: SSH Connection Pool (HIGH PRIORITY - Fixes Root Cause)

**Goal**: Eliminate connection storms by sharing SSH connections

**Files to Modify**:
| File | Changes |
|------|---------|
| `src/main/ssh-remote-manager.ts` | Enable ControlMaster, ControlPath, ControlPersist, ServerAliveInterval |
| `src/main/index.ts` | Add startup cleanup for stale SSH sockets |
| `src/main/utils/ssh-socket-cleanup.ts` | New file - socket management utilities |

**Implementation Steps**:

1. **Update SSH defaults** (`ssh-remote-manager.ts`):
   ```typescript
   ControlMaster: 'auto',
   ControlPath: '/tmp/maestro-ssh-%C',  // %C = hash of connection params
   ControlPersist: '300',               // 5 minute idle timeout
   ServerAliveInterval: '30',
   ServerAliveCountMax: '3',
   ```

2. **Socket cleanup on startup**:
   - Remove stale `/tmp/maestro-ssh-*` sockets from previous runs
   - Handle graceful cleanup on app quit

3. **Fallback handling**:
   - If ControlMaster fails, retry with `ControlMaster: 'no'`
   - Log warning about potential performance impact

**Testing**:
- Run 10 concurrent file explorer operations → should use 1 connection
- Kill SSH daemon on VM → should detect via keep-alive within 90s
- Restart Maestro → should clean up old sockets

### Phase 1: Immediate Relief (Low Risk, Do in Parallel)

**Goal**: Reduce error noise while Phase 0 is implemented

1. **Add session ID patterns for background operations**
   - File: `App.tsx` onAgentError handler
   - Add filters for: `-git-`, `-explorer-`, `-stats-`, `-detection-`
   - These would be silently logged but not shown in UI

2. **Reduce error modal triggering for recoverable errors**
   - File: `App.tsx` line 3154
   - Only show modal for `recoverable: false` errors
   - Show toast for `recoverable: true` errors instead

### Phase 2: Proper Source Tagging (Medium Risk, Lower Priority Now)

**Goal**: Enable intelligent error routing (less critical if Phase 0 works)

1. **Add `errorContext` to AgentError type**
   ```typescript
   interface AgentError {
     // ... existing fields
     errorContext?: 'interactive' | 'background' | 'batch' | 'synopsis';
   }
   ```

2. **Tag process spawns with context**
   - Modify spawn options to include context
   - Pass through to ManagedProcess
   - Include in emitted errors

3. **Update error handlers to use context**
   - Filter by context in App.tsx
   - Different handling per context

### Phase 3: SSH Health Monitoring (UX Polish)

**Goal**: Proactive SSH health visibility

1. **Connection health indicator**
   - Show SSH status icon per remote in session header
   - Green = healthy, Yellow = reconnecting, Red = failed
   - Tooltip shows last successful operation time

2. **Proactive reconnection**
   - If ControlMaster socket dies, recreate on next operation
   - Optional "Reconnect All" button in Settings

3. **Batch mode resilience**
   - Already have retry logic in remote-fs.ts
   - With connection pooling, retries will be much faster
   - Configurable retry count in settings

---

## Answers to Your Questions

### Q1: Do all operations in Maestro share ONE SSH connection?

**No. Currently, EVERY SSH operation creates a NEW TCP connection.**

The code explicitly disables SSH multiplexing (`ssh-remote-manager.ts:71-73`):
```typescript
ControlMaster: 'no',
ControlPath: 'none',
ControlPersist: 'no',
```

### Q2: Does opening multiple SSH connections cause these errors?

**Yes, almost certainly.** With your local VM setup, there's no network latency to explain timeouts. The errors are caused by:

1. **Connection storm**: File explorer, git status, stats, synopsis all fire SSH connections simultaneously
2. **SSH server throttling**: `MaxStartups` in sshd_config limits concurrent handshakes (default: 10:30:100)
3. **Connection queue backup**: Requests waiting for a free slot can timeout
4. **Key agent contention**: Multiple processes querying ssh-agent simultaneously

### Q3: Why does clicking "Test Connection" sometimes help?

**It "primes the pump" for that specific moment:**

1. Validates SSH key is loaded in agent
2. Establishes that the host is reachable
3. May clear any cached DNS/routing state
4. Gives the SSH server a "fresh start" with that connection

But it's ephemeral - the next burst of operations can still overwhelm the connection pool.

### Q4: Are keep-alives already implemented?

**No.** I searched the entire codebase:
- No `ServerAliveInterval` configuration
- No `ServerAliveCountMax` configuration
- No application-level heartbeat for SSH connections
- The only "heartbeat" is for WebSocket connections (web interface)

### Q5: Could we implement global connection sharing?

**Yes! This is exactly what SSH ControlMaster is designed for.**

With `ControlMaster: 'auto'`:
- First SSH command to a host creates a "master" connection
- All subsequent commands to that host multiplex over the same TCP socket
- No new TCP handshakes, no new key exchanges
- Sub-millisecond overhead per operation instead of 100ms+ per new connection

### Q6: Could we implement global background keep-alives?

**With ControlMaster + ServerAliveInterval, yes:**

```
ControlMaster: 'auto'
ControlPersist: '300'        # Keep master alive 5 min after last use
ServerAliveInterval: '30'    # Ping every 30 seconds
ServerAliveCountMax: '3'     # Fail after 3 missed pongs (90s)
```

This gives:
- Automatic keep-alive on the shared connection
- Proactive detection of dead connections
- Automatic cleanup after idle period

### Q7: Impact on Conclusions

**The original plan was treating symptoms. The real fix is architectural:**

| Original Plan | Revised Plan |
|---------------|--------------|
| Filter/route errors differently | Fix the cause: connection pooling |
| Show toasts instead of modals | Still useful for any remaining errors |
| Add error context tags | Lower priority now |
| Retry logic | Already exists, will work better with pooling |

**With connection pooling:**
- 90%+ of "timeout" errors should disappear
- Operations will be faster (no handshake overhead)
- Keep-alives will detect dead connections proactively
- Remaining errors will be genuine issues (auth, server down)

---

## Risk Assessment

| Change | Risk | Mitigation |
|--------|------|------------|
| **Enabling ControlMaster** | Medium | Test thoroughly; keep fallback path |
| Adding session ID filters | Low | Existing pattern, just adding more |
| Changing modal trigger logic | Medium | Could hide real errors; add logging |
| Adding errorContext field | Low | Backward compatible (optional field) |
| Modifying spawn parameters | Medium | Affects many call sites; thorough testing |
| Auto-retry for batch mode | Medium | Could mask persistent issues; limit retries |

---

## Files to Modify

### Phase 0 (SSH Connection Pool)
| File | Changes |
|------|---------|
| `src/main/ssh-remote-manager.ts` | Enable ControlMaster, ControlPersist, ServerAliveInterval |
| `src/main/index.ts` | Add socket cleanup on startup |
| `src/main/utils/ssh-socket-cleanup.ts` | NEW: Socket management utilities |

### Phase 1 (Error Routing)
| File | Changes |
|------|---------|
| `src/renderer/App.tsx` | Add filters in onAgentError handler (~line 3000) |
| `src/renderer/App.tsx` | Conditional modal vs toast (~line 3154) |

### Phase 2 (Source Tagging - Lower Priority)
| File | Changes |
|------|---------|
| `src/shared/types.ts` | Add `errorContext` to AgentError |
| `src/main/process-manager/types.ts` | Add `spawnContext` to ManagedProcess |
| `src/main/ipc/handlers/process.ts` | Pass context through spawn |
| `src/main/process-manager/handlers/*.ts` | Include context in emitted errors |
| `src/renderer/App.tsx` | Route based on context |

### Phase 3 (SSH Health UI)
| File | Changes |
|------|---------|
| `src/renderer/components/session-list/SessionItem.tsx` | SSH status indicator |
| `src/renderer/hooks/batch/useBatchProcessor.ts` | Retry logic for SSH errors |
| `src/main/utils/remote-fs.ts` | Already has retry logic - expose config |

---

## Testing Plan

### Phase 0 Tests (Critical)

**Unit Tests**:
- Socket path generation is consistent per host
- Socket cleanup removes only Maestro sockets
- Fallback to direct connection on ControlMaster error

**Integration Tests**:
- 10 concurrent file explorer operations → verify single SSH connection (`ss -tnp | grep ssh`)
- SSH daemon restart → verify keep-alive detects and reconnects
- App restart → verify old sockets cleaned up

**Manual Tests**:
1. Start Maestro with 5 SSH sessions → verify 5 master connections (not 50+)
2. Open file explorer on remote → verify sub-second response (no handshake)
3. Run Auto Run document → verify no timeout errors
4. Kill VM SSH daemon → verify error within 90s (keep-alive)
5. Restart VM SSH daemon → verify next operation reconnects automatically

### Phase 1 Tests

**Manual Tests**:
1. Trigger background operation error → verify NO modal, log only
2. Trigger agent error → verify modal appears
3. `recoverable: true` error → verify toast (not modal)

---

## Open Questions

1. **Should background errors be logged at all in the session?**
   - Current: Yes, with source='error'
   - Proposed: No, log to debug/console only

2. **What about persistent SSH failures?**
   - After N retries, should we escalate to a modal?
   - Should there be a "connection lost" state distinct from "error"?

3. **Toast fatigue:**
   - If SSH is flaky, could get many toasts
   - Should we debounce/aggregate similar errors?

---

## Appendix: Code References

### Error Pattern Definitions
- `/app/Maestro/src/main/parsers/error-patterns.ts:555-717` (SSH_ERROR_PATTERNS)

### Error Detection
- `/app/Maestro/src/main/process-manager/handlers/StdoutHandler.ts:169-191`
- `/app/Maestro/src/main/process-manager/handlers/StderrHandler.ts:60-82`
- `/app/Maestro/src/main/process-manager/handlers/ExitHandler.ts:134-163`

### Error Propagation
- `/app/Maestro/src/main/process-listeners/error-listener.ts`

### Error Handling
- `/app/Maestro/src/renderer/App.tsx:2935-3157`

### Remote FS Retry Logic
- `/app/Maestro/src/main/utils/remote-fs.ts:116-164`

### Agent Detection SSH
- `/app/Maestro/src/main/ipc/handlers/agents.ts:109-199`

---

## Summary

### Root Cause Identified

The SSH errors are NOT caused by network issues - they're caused by **Maestro explicitly disabling SSH connection multiplexing** (`ControlMaster: 'no'`), resulting in:

1. **Every operation creates a new TCP connection** (handshake overhead)
2. **Connection storms** when multiple operations fire simultaneously
3. **SSH server throttling** when too many connections queue up
4. **No keep-alives** to detect dead connections proactively

### Recommended Fix

**Phase 0: Enable SSH Connection Pool** (fixes root cause)
- Enable `ControlMaster: 'auto'` for connection sharing
- Add `ControlPersist: '300'` for 5-minute idle connections
- Add `ServerAliveInterval: '30'` for keep-alives
- Clean up stale sockets on startup

**Phase 1: Error Routing** (reduces remaining noise)
- Filter background operation errors from UI
- Show toasts instead of modals for recoverable errors

### Expected Outcome

With connection pooling:
- **90%+ reduction in timeout errors**
- **Faster operations** (no handshake per command)
- **Proactive dead connection detection** (keep-alives)
- **"Test Connection" no longer needed** as a workaround

### Why ControlMaster Was Disabled

The comment in code mentions "UNKNOWN port -1" errors. This was likely a race condition when multiple processes tried to become ControlMaster simultaneously. The fix is proper socket path uniqueness and startup cleanup, not disabling multiplexing entirely.

---

## Decision Needed

Would you like me to:

1. **Create Auto Run documents for Phase 0 + Phase 1** (recommended - addresses root cause)
2. **Just Phase 1** (quick win, but doesn't fix root cause)
3. **Discuss further** (if you have concerns about the ControlMaster approach)

The Phase 0 change is ~20 lines of code but fundamentally changes how SSH connections work. I'd recommend testing on one remote first before rolling out.
