# SSH Error Handling Investigation & Remediation Plan

**Date**: 2026-02-13 (Original) | 2026-02-17 (Revalidated & Expanded, plan fully verified)
**Status**: Phase 0 PARTIALLY IMPLEMENTED - Critical gaps found in revalidation
**Priority**: High
**Type**: Bug Fix / Architecture Improvement

---

## Executive Summary

SSH connection errors in Maestro appear in multiple UI locations (chat logs, synopsis messages, error alert modals, toasts) and interrupt workflows during both Auto Run and interactive sessions.

### Phase 0 Revalidation (2026-02-17)

Phase 0 (SSH connection pooling) was implemented on 2026-02-13 but **only fixed 1 of 3 SSH code paths**. Two critical paths still create fresh TCP connections per operation, explaining why SSH errors persist.

### Root Cause: ControlMaster Only Applied to `ssh-remote-manager.ts`

Phase 0 correctly enabled ControlMaster in `ssh-remote-manager.ts`, but there are **three separate SSH code paths** in Maestro:

| Code Path | File | Has ControlMaster? | Has Keep-Alives? | Used For |
|-----------|------|-------------------|------------------|----------|
| `ssh-remote-manager.ts` | `buildSshArgs()` | **YES** | **YES** | remote-fs (file explorer, stats), testConnection, audit service |
| `SshCommandRunner.ts` | Own SSH args (lines 46-53) | **NO** | **NO** | Terminal commands on remote hosts |
| `ssh-command-builder.ts` | `DEFAULT_SSH_OPTIONS` (lines 45-52) | **NO** | **NO** | Agent spawning, git operations, agent detection, group chat |

**The two paths that handle agent execution, git operations, group chat, and agent detection are still opening fresh TCP connections for every operation.**

---

## Current State of SSH Code Paths

### Path 1: `ssh-remote-manager.ts` — FIXED in Phase 0

```typescript
// Lines 65-79 — Phase 0 changes intact
private readonly defaultSshOptions: Record<string, string> = {
  BatchMode: 'yes',
  StrictHostKeyChecking: 'accept-new',
  ConnectTimeout: '10',
  ClearAllForwardings: 'yes',
  RequestTTY: 'no',
  ControlMaster: 'auto',           // ✅ Phase 0
  ControlPath: '/tmp/maestro-ssh-%C',  // ✅ Phase 0
  ControlPersist: '300',           // ✅ Phase 0
  ServerAliveInterval: '30',       // ✅ Phase 0
  ServerAliveCountMax: '3',        // ✅ Phase 0
};
```

**Consumers**: `remote-fs.ts` (file explorer, stats parsing, file read/write), `testConnection()`, `anthropic-audit-service.ts`

### Path 2: `SshCommandRunner.ts` — NOT FIXED

```typescript
// Lines 46-53 — Missing ControlMaster, ControlPath, ControlPersist, ServerAliveInterval
const sshOptions: Record<string, string> = {
  BatchMode: 'yes',
  StrictHostKeyChecking: 'accept-new',
  ConnectTimeout: '10',
  ClearAllForwardings: 'yes',
  RequestTTY: 'no',
};
```

**Consumers**: `ProcessManager.ts` for terminal commands on remote hosts

### Path 3: `ssh-command-builder.ts` — NOT FIXED

```typescript
// Lines 45-52 — Missing ControlMaster, ControlPath, ControlPersist, ServerAliveInterval
const DEFAULT_SSH_OPTIONS: Record<string, string> = {
  BatchMode: 'yes',
  StrictHostKeyChecking: 'accept-new',
  ConnectTimeout: '10',
  ClearAllForwardings: 'yes',
  RequestTTY: 'force',
  LogLevel: 'ERROR',
};
```

**Consumers**:
- `ssh-spawn-helper.ts` → `wrapSpawnWithSsh()` → group chat agents, group chat router
- `agents.ts` → agent detection on remote hosts
- `process.ts` → session spawning on remotes
- `remote-git.ts` → all git operations (worktree setup/checkout, repo root, etc.)

---

## Phase 0 Supporting Infrastructure — Intact

| Component | File | Status |
|-----------|------|--------|
| Socket cleanup on startup | `ssh-socket-cleanup.ts:cleanupStaleSshSockets()` | ✅ Working |
| Socket close on shutdown | `ssh-socket-cleanup.ts:closeSshConnections()` | ✅ Working |
| Quit handler integration | `quit-handler.ts:197` | ✅ Working |
| Startup integration | `index.ts:103` | ✅ Working |

---

## Minor Issue: `anthropic-audit-service.ts`

Line 259 creates a NEW `SshRemoteManager()` instance per call (rather than using the singleton). While it does get ControlMaster options, line 276 uses shell string interpolation (`ssh ${sshArgs.join(' ')}`) via `execAsync`, which is fragile for paths with special characters. Should use the singleton and `execFileNoThrow` for consistency.

---

## REVISED Implementation Plan

### Phase 0B: Complete ControlMaster Coverage (HIGH PRIORITY)

**Goal**: Apply ControlMaster + keep-alives to ALL SSH code paths

**Strategy**: Rather than maintaining SSH options in 3 separate places, centralize them. Import and reuse the options from `ssh-remote-manager.ts`.

**Option A — Centralize via shared constants module (RECOMMENDED)**:
Create `src/main/utils/ssh-options.ts` with typed option sets and import in all three locations:

```typescript
// src/main/utils/ssh-options.ts

/** Base options shared by ALL SSH operations */
export const BASE_SSH_OPTIONS: Record<string, string> = {
    BatchMode: 'yes',
    StrictHostKeyChecking: 'accept-new',
    ConnectTimeout: '10',
    ClearAllForwardings: 'yes',
    ControlMaster: 'auto',
    ControlPath: '/tmp/maestro-ssh-%C',
    ControlPersist: '300',
    ServerAliveInterval: '30',
    ServerAliveCountMax: '3',
};

/** For non-interactive commands (file ops, stats, terminal, git) */
export const COMMAND_SSH_OPTIONS: Record<string, string> = {
    ...BASE_SSH_OPTIONS,
    RequestTTY: 'no',
};

/** For agent spawning (needs TTY for --print mode) */
export const AGENT_SSH_OPTIONS: Record<string, string> = {
    ...BASE_SSH_OPTIONS,
    RequestTTY: 'force',
    LogLevel: 'ERROR',
};
```

**Option B — Make all paths use `sshRemoteManager.buildSshArgs()`**:
More invasive but eliminates duplication. `SshCommandRunner` and `ssh-command-builder` would need to call `buildSshArgs()` and then add their context-specific options (like `-tt` for TTY).

#### Files to Modify

| File | Changes |
|------|---------|
| `src/main/ssh-remote-manager.ts` | Export `defaultSshOptions` as a shared constant (or create a new shared module) |
| `src/main/process-manager/runners/SshCommandRunner.ts` | Import and use shared SSH options (add ControlMaster, ControlPath, ControlPersist, ServerAliveInterval, ServerAliveCountMax) |
| `src/main/utils/ssh-command-builder.ts` | Import and use shared SSH options (add ControlMaster, ControlPath, ControlPersist, ServerAliveInterval, ServerAliveCountMax). Note: Keep `RequestTTY: 'force'` and `LogLevel: 'ERROR'` as overrides since this path needs TTY for Claude Code `--print` mode |
| `src/main/services/anthropic-audit-service.ts` | Use singleton `sshRemoteManager` instead of creating new instance; switch from `execAsync` shell string to `execFileNoThrow` |

#### Specific Changes per File

**`SshCommandRunner.ts`** (lines 46-53) — Add these options:
```typescript
const sshOptions: Record<string, string> = {
  BatchMode: 'yes',
  StrictHostKeyChecking: 'accept-new',
  ConnectTimeout: '10',
  ClearAllForwardings: 'yes',
  RequestTTY: 'no',
  // ADD:
  ControlMaster: 'auto',
  ControlPath: '/tmp/maestro-ssh-%C',
  ControlPersist: '300',
  ServerAliveInterval: '30',
  ServerAliveCountMax: '3',
};
```

**`ssh-command-builder.ts`** (lines 45-52) — Add these options:
```typescript
const DEFAULT_SSH_OPTIONS: Record<string, string> = {
  BatchMode: 'yes',
  StrictHostKeyChecking: 'accept-new',
  ConnectTimeout: '10',
  ClearAllForwardings: 'yes',
  RequestTTY: 'force',   // Keep - needed for Claude Code --print mode
  LogLevel: 'ERROR',     // Keep - suppress SSH warnings
  // ADD:
  ControlMaster: 'auto',
  ControlPath: '/tmp/maestro-ssh-%C',
  ControlPersist: '300',
  ServerAliveInterval: '30',
  ServerAliveCountMax: '3',
};
```

**Note on TTY and ControlMaster**: `ssh-command-builder.ts` uses `-tt` (force TTY) AND `RequestTTY: 'force'`. ControlMaster works with TTY allocation — the master connection handles the transport, and each multiplexed session can independently request a TTY. No conflict.

---

### Phase 1: Proactive Connection Health Management (NEW)

**Goal**: Keep SSH connections alive automatically, detect and repair dead connections BEFORE they cause errors — no user intervention required.

#### Why Keep-Alives Alone Aren't Enough

`ServerAliveInterval: '30'` (Phase 0) only exists in `ssh-remote-manager.ts`. Agent sessions spawned via `ssh-command-builder.ts` and `SshCommandRunner.ts` have **zero keep-alives**. During long agent cycles (10+ minutes), the SSH connection has no heartbeat — if TCP drops silently, the next write fails with "broken pipe". **Phase 0B fixes this by adding ServerAliveInterval to all code paths.**

Even with keep-alives everywhere, they're reactive (detect death after 90s). Pre-flight checks are proactive (detect death before the operation).

#### Timing: 60s Background + Pre-Flight Checks (Hybrid Approach)

**Pre-flight check** (near-zero overhead):
```
Before any SSH operation:
  1. stat('/tmp/maestro-ssh-%C') → does socket exist? (~0.1ms, local filesystem)
  2. If yes: ssh -O check <host> → is socket alive? (~1ms, local unix IPC, no network)
  3. If check fails: rm stale socket, let ControlMaster=auto create fresh one
  4. If no socket: proceed (ControlMaster=auto handles creation)
  5. Execute actual operation
```

`ssh -O check` talks to the **local ControlMaster process** via unix socket — it does NOT make a network round-trip. Overhead is <1ms per operation. This catches 100% of stale socket scenarios.

**60s background sweep** (complementary):
- Pre-warms connections that expired during idle (ControlPersist=300 = 5 min)
- Logs health status for diagnostics
- Detects host-level problems (SSH daemon down) before user triggers an operation

**During long agent cycles**: With Phase 0B's `ServerAliveInterval: '30'` on all code paths, the SSH client sends keep-alive packets every 30s during the agent's execution. Combined with the VM's `tcp_keepalive_time=30`, the connection stays alive through idle periods. If the connection truly dies, SSH detects it within 90s (3 missed pings) and the process exits with an error — which the existing handlers catch and report.

#### 1A: Pre-Flight Socket Validation

Add a lightweight socket check before SSH operations. This is the primary defense against stale pipes.

**Implementation**: Add to the shared `ssh-options.ts` module (Phase 0B):

```typescript
/**
 * Validate ControlMaster socket is alive before an SSH operation.
 * Near-zero overhead (~1ms, local unix IPC only).
 * Returns true if socket is healthy or doesn't exist yet.
 * If stale, removes the socket file so ControlMaster=auto creates a fresh one.
 */
export async function validateSshSocket(config: SshRemoteConfig): Promise<boolean>
```

**Integration points** (add pre-flight call before SSH execution):
- `remote-fs.ts` `execRemoteCommand()` — before line 186
- `ssh-command-builder.ts` `buildSshCommand()` — before returning
- `SshCommandRunner.ts` `run()` — before spawning

#### 1B: Background Health Monitor Service

Create a background service for idle pre-warming and diagnostics.

**New File**: `src/main/services/ssh-health-monitor.ts`

**Behavior**:
- Runs a periodic health check loop (every 60 seconds)
- For each configured SSH remote that has been used in the current session:
  - Check if ControlMaster socket exists at `/tmp/maestro-ssh-%C`
  - If socket exists, run `ssh -O check` to verify it's alive
  - If socket is dead/stale: remove it and pre-warm a new connection
  - If socket doesn't exist and remote was recently active: pre-warm a new connection
- Pre-warming: spawn `ssh -fN -o ControlMaster=auto ...` to establish master connection

**Integration Points**:
- Start on app startup (after initial socket cleanup)
- Stop on app shutdown (before `closeSshConnections`)
- Pause when all SSH remotes are disabled/removed
- Resume when SSH remote is configured/enabled

#### 1C: Pre-Warm Connections on Config Change

When a user saves/tests an SSH remote config, immediately establish a ControlMaster connection so it's ready before any operation needs it.

**File**: `src/main/ipc/handlers/ssh-remote.ts`
- After successful `ssh-remote:test` (line 267): the test already establishes a connection, and with ControlMaster it will persist
- After `ssh-remote:saveConfig` (line 92): optionally pre-warm if the remote was previously working

#### 1D: Stale Socket Detection in `remote-fs.ts` Retry Logic

Enhance the existing retry logic to detect stale ControlMaster sockets and remove them before retrying.

**File**: `src/main/utils/remote-fs.ts`

**Current**: `RECOVERABLE_SSH_ERRORS` triggers retry with backoff (lines 116-164)
**Enhancement**: On first retry for `banner exchange` or `socket is not connected` errors (already in the pattern list, line 129-130), remove the ControlMaster socket before retrying. This forces SSH to establish a fresh master connection on the retry.

```typescript
// In the retry loop, before retrying:
if (isStaleSocketError(combinedOutput)) {
  removeStaleSocket(config);  // rm /tmp/maestro-ssh-<hash>
}
```

#### 1E: Connection Health Event Emission

The health monitor should emit events that the renderer can optionally display:

```typescript
// Events:
'ssh:connection-healthy'    // (remoteId) — connection verified OK
'ssh:connection-degraded'   // (remoteId) — socket missing, pre-warming
'ssh:connection-failed'     // (remoteId, error) — pre-warm failed, host unreachable
'ssh:connection-restored'   // (remoteId) — previously failed, now healthy
```

These events feed into Phase 3 (UI indicators) but are not blocking — the health monitor works silently regardless of UI.

---

### Phase 2: Error Routing (Previously Phase 1)

**Goal**: Reduce error noise for any remaining SSH errors that slip through

**Changes to `App.tsx` onAgentError handler**:

1. **Add session ID pattern filters** for background operations:
   - `-git-`, `-explorer-`, `-stats-`, `-detection-`
   - These should be silently logged but NOT shown in UI

2. **Conditional modal vs toast** for recoverable errors:
   - `recoverable: true` → toast notification (non-blocking)
   - `recoverable: false` → error modal (current behavior)

**Files to modify**:
| File | Changes |
|------|---------|
| `src/renderer/App.tsx` | Add filters in onAgentError handler; conditional modal vs toast |

---

### Phase 3: Source Tagging (Previously Phase 2)

**Goal**: Enable intelligent error routing based on operation context

1. Add `errorContext` field to `AgentError` type in `src/shared/types.ts`:
   ```typescript
   errorContext?: 'interactive' | 'background' | 'batch' | 'synopsis';
   ```

2. Tag process spawns with context in `src/main/ipc/handlers/process.ts`

3. Pass context through `ManagedProcess` in `src/main/process-manager/types.ts`

4. Include context in emitted errors in `src/main/process-manager/handlers/*.ts`

5. Route based on context in `src/renderer/App.tsx`

---

### Phase 4: SSH Health UI (Previously Phase 3, Expanded)

**Goal**: Visual indicators for SSH connection health (nice-to-have since Phase 1 keeps things alive automatically)

1. **Connection status indicator per remote** in session header
   - Green = healthy (last health check passed)
   - Yellow = reconnecting (pre-warming in progress)
   - Red = failed (host unreachable)

2. **"Reconnect All" button** in Settings (manual override)
   - Clears all ControlMaster sockets
   - Re-establishes connections

3. **Connection status in Settings SSH panel**
   - Show last health check timestamp per remote
   - Show connection state (connected/disconnected/error)

---

## Implementation Priority

| Phase | Priority | Risk | Effort | Impact |
|-------|----------|------|--------|--------|
| **0B: Complete ControlMaster Coverage** | **CRITICAL** | Low | Small (4 files, ~20 lines each) | Fixes the root cause for 2/3 of SSH paths |
| **1: Proactive Health Management** | High | Medium | Medium (new service + integration) | Prevents errors before they happen |
| **2: Error Routing** | Medium | Low | Small (1 file) | Reduces UI noise for remaining errors |
| **3: Source Tagging** | Low | Low | Medium (5+ files) | Better error intelligence |
| **4: SSH Health UI** | Low | Low | Medium (new components) | UX polish |

**Recommendation**: Phase 0B is the most urgent — it's a small change that fixes the root cause. Phase 1 is the user's specific request (automatic health management). Phases 2-4 are polish.

---

## Testing Plan

### Phase 0B Tests

**Verification**:
1. After changes, `grep -r "ControlMaster" src/main/` should show ALL three SSH code paths have it
2. Run agent on remote → verify ControlMaster socket created at `/tmp/maestro-ssh-*`
3. Run git operations on remote → verify reuses same socket (not new connection)
4. Run group chat with remote agents → verify reuses same socket
5. Run Auto Run on remote → monitor with `ss -tnp | grep ssh` — should see 1 connection per host, not N

### Phase 1 Tests

**Health Monitor**:
1. Start Maestro with SSH remotes → verify health check runs every 60s in logs
2. Kill ControlMaster socket (`rm /tmp/maestro-ssh-*`) → verify health monitor detects and pre-warms within 60s
3. Stop SSH daemon on VM → verify `ssh:connection-failed` event emitted within 60s
4. Restart SSH daemon → verify `ssh:connection-restored` event on next health check

**Stale Socket Recovery**:
1. Kill SSH daemon while Maestro is running → stale socket remains
2. Restart SSH daemon → next remote-fs operation should detect stale socket, remove, retry, succeed

---

## Risk Assessment

| Change | Risk | Mitigation |
|--------|------|------------|
| Adding ControlMaster to `SshCommandRunner` | Low | Same approach already proven in `ssh-remote-manager` |
| Adding ControlMaster to `ssh-command-builder` | Low | Same approach; `-tt` TTY works with ControlMaster |
| Health monitor service | Medium | Lightweight; fire-and-forget checks; no impact if it fails |
| Stale socket removal in retry | Low | Only removes Maestro sockets; already proven in startup cleanup |

---

## Appendix: All SSH Code Path Consumers

### `ssh-remote-manager.ts` buildSshArgs() — HAS ControlMaster
- `remote-fs.ts` → all file operations (readDir, readFile, writeFile, stat, mkdir, delete, etc.)
- `ssh-remote.ts` IPC → testConnection
- `anthropic-audit-service.ts` → usage tracking (creates own instance — should use singleton)

### `ssh-command-builder.ts` buildSshCommand() — MISSING ControlMaster
- `ssh-spawn-helper.ts` → `wrapSpawnWithSsh()`:
  - `group-chat-agent.ts` → group chat agent execution
  - `group-chat-router.ts` → group chat routing
- `agents.ts` IPC → agent detection on remote hosts
- `process.ts` IPC → session spawning on remotes
- `remote-git.ts` → all git operations (worktree, checkout, status, etc.)

### `SshCommandRunner.ts` own args — MISSING ControlMaster
- `ProcessManager.ts` → terminal commands executed on remote hosts

---

## SSH Error Persistence Flow (Verified)

How SSH errors end up in `maestro-sessions.json`:

```
SSH Error detected (StdoutHandler | StderrHandler | ExitHandler)
    │ matchSshErrorPattern() → AgentError { type, message, recoverable, raw }
    │ managedProcess.errorEmitted = true (prevents duplicate emission)
    ▼
ProcessManager.emit('agent-error', sessionId, agentError)
    ▼
error-listener.ts → safeSend('agent:error', sessionId, agentError) [IPC]
    ▼
App.tsx onAgentError handler (~line 3023)
    │ Filters: group chat (routed separately), synopsis (IGNORED ✓)
    │ Creates LogEntry: { id, timestamp, source: 'error', text, agentError }
    │ setSessions → adds to aiTabs[activeTab].logs[]
    │ Sets: session.state='error', agentErrorPaused=true
    │ Shows: error modal via setAgentErrorModalSessionId()
    ▼
useDebouncedPersistence (2-second debounce)
    │ prepareSessionForPersistence():
    │   - Truncates to MAX 100 logs per tab (keeps newest)
    │   - Clears runtime: agentError=undefined, state='idle'
    │   - KEEPS errorLogEntry in logs[] array (with full agentError including raw.stderr)
    ▼
window.maestro.sessions.setAll() → IPC → sessionsStore.set()
    ▼
~/.config/Maestro/maestro-sessions.json
```

**Key findings**:
- `agentError` on the session object is **runtime-only** (cleared during persistence prep)
- But the `errorLogEntry` in `logs[]` **persists permanently** with full `agentError` including `raw.stderr`
- `SshCommandRunner.ts` does NOT emit `agent-error` — terminal SSH errors only log/emit stderr, they don't persist to sessions JSON and aren't shown as modals
- There is NO filtering for background operation errors (file explorer, git, stats, detection) — they all hit the same modal+persist path as interactive agent errors
- Max 100 logs per tab — error entries count toward this limit and can push out actual conversation content

---

## Existing Retry Logic (Verified)

`remote-fs.ts` has robust retry logic (lines 113-221) that ONLY covers file operations:
- **13 recoverable error patterns**: connection closed/reset, broken pipe, network unreachable, timed out, ssh_exchange_identification, packet corrupt, protocol error, kex_exchange_identification, banner exchange, socket not connected
- **Retry config**: 3 retries, 500ms base, 5000ms max, exponential backoff with 0-20% jitter
- **Note**: `banner exchange` errors (line 129) are specifically called out as "often due to stale ControlMaster sockets"

**Gap**: Agent spawning (`ssh-command-builder.ts`), git operations (`remote-git.ts`), and terminal commands (`SshCommandRunner.ts`) have **NO retry logic**. If Phase 0B fixes connection sharing, retries become less critical for these paths since they'll share the healthy ControlMaster socket.

---

## Recovery Hook: useAgentErrorRecovery (Verified)

`src/renderer/hooks/agent/useAgentErrorRecovery.tsx` provides recovery actions per error type:
- `network_error` → "Retry Connection" button
- `permission_denied` → "Try Again" button
- `agent_crashed` → "Restart Agent" + "Start New Session"
- `auth_expired` → "Use Terminal" / "Re-authenticate"

This hook is functional but will be less frequently triggered once Phase 0B eliminates most SSH connection issues.

---

## Decision History

- **2026-02-13**: Investigation complete. Root cause: ControlMaster disabled. Phase 0 approved.
- **2026-02-13**: Phase 0 implemented (commit `b6fd8fbe`). ControlMaster enabled in `ssh-remote-manager.ts`.
- **2026-02-17**: Revalidation reveals Phase 0 only covered 1 of 3 SSH code paths. SSH errors persist because `SshCommandRunner.ts` and `ssh-command-builder.ts` still open fresh connections. Plan expanded with Phase 0B (complete coverage) and Phase 1 (proactive health management).
