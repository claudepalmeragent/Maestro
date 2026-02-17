# SSH Connection Health Remediation Plan

**Date**: 2026-02-17
**Status**: Plan - Awaiting Approval
**Priority**: High
**Type**: Bug Fix / Architecture Improvement
**Previous Work**: Phase 0 implemented 2026-02-13 (commit `b6fd8fbe`)

---

## Executive Summary

Phase 0 (SSH Connection Pooling via ControlMaster) was implemented on 2026-02-13, but SSH errors persist in daily use. Revalidation reveals **Phase 0 only fixed 1 of 3 SSH code paths**. The two code paths responsible for agent execution, git operations, group chat, and agent detection never received ControlMaster or keep-alive settings.

Additionally, there is no proactive connection health management - when a ControlMaster socket goes stale or a connection dies, the first user-facing operation to hit it gets the error, causing a disruptive modal dialog.

---

## Revalidation Findings

### What Phase 0 Fixed (Working)

| Component | File | Status |
|-----------|------|--------|
| `SshRemoteManager.buildSshArgs()` | `ssh-remote-manager.ts:65-79` | Has ControlMaster + keep-alives |
| `remote-fs.ts` (file explorer, stats) | `remote-fs.ts:72-73` | Uses `sshRemoteManager.buildSshArgs()` - GOOD |
| Socket cleanup on startup | `index.ts` + `ssh-socket-cleanup.ts` | Working |
| Socket close on shutdown | `quit-handler.ts:196-199` | Working |
| `testConnection()` | `ssh-remote-manager.ts:178` | Uses `buildSshArgs()` - GOOD |

### What Phase 0 MISSED (Still Broken)

#### GAP 1: `SshCommandRunner.ts` - Terminal Commands on Remotes

**File**: `src/main/process-manager/runners/SshCommandRunner.ts:46-53`

Builds its own SSH options with **NO ControlMaster, NO keep-alives**:

```typescript
const sshOptions: Record<string, string> = {
    BatchMode: 'yes',
    StrictHostKeyChecking: 'accept-new',
    ConnectTimeout: '10',
    ClearAllForwardings: 'yes',
    RequestTTY: 'no',
    // MISSING: ControlMaster, ControlPath, ControlPersist
    // MISSING: ServerAliveInterval, ServerAliveCountMax
};
```

**Impact**: Every terminal command on a remote host opens a fresh TCP connection.

**Used by**: `ProcessManager` for user-initiated terminal commands on remote sessions.

#### GAP 2: `ssh-command-builder.ts` - Agent Spawning & Git Operations

**File**: `src/main/utils/ssh-command-builder.ts:45-52`

Has its own `DEFAULT_SSH_OPTIONS` with **NO ControlMaster, NO keep-alives**:

```typescript
const DEFAULT_SSH_OPTIONS: Record<string, string> = {
    BatchMode: 'yes',
    StrictHostKeyChecking: 'accept-new',
    ConnectTimeout: '10',
    ClearAllForwardings: 'yes',
    RequestTTY: 'force',
    LogLevel: 'ERROR',
    // MISSING: ControlMaster, ControlPath, ControlPersist
    // MISSING: ServerAliveInterval, ServerAliveCountMax
};
```

**Impact**: Every agent spawn, git operation, and agent detection creates a new TCP connection.

**Used by**:
- `ssh-spawn-helper.ts` → group chat agents + routers
- `agents.ts` → agent detection on remote hosts
- `process.ts` → session spawning (the main agent process!)
- `remote-git.ts` → all git operations on remotes

#### GAP 3: `anthropic-audit-service.ts` - Minor but Fragile

**File**: `src/main/services/anthropic-audit-service.ts:259`

Creates a **new `SshRemoteManager()` instance** per call (not the singleton), then uses shell string interpolation (`ssh ${sshArgs.join(' ')}` via `execAsync`) instead of `execFileNoThrow`. While it does get ControlMaster options from the new instance, the shell interpolation may not handle socket paths correctly.

### Root Cause of Persistent Errors

The main agent process (Claude Code running via SSH) is spawned through `ssh-command-builder.ts`, which has NO connection multiplexing. This means:

1. **Agent spawning** creates a fresh TCP connection every time
2. **Git operations** (worktree setup, status, checkout) each create fresh connections
3. **Group chat participants** each create fresh connections
4. **Agent detection** creates fresh connections

Meanwhile, `remote-fs.ts` operations (file explorer, stats) DO use ControlMaster via `sshRemoteManager.buildSshArgs()`. So you get a split situation:
- File explorer reuses connections (Phase 0 working)
- Agent and git operations don't (Phase 0 gap)
- When agent operations fail, the error goes through the full error pipeline → modal dialog

### Why the Modal Appears

**File**: `src/renderer/App.tsx:3241-3244`

```typescript
// Show the error modal for this session (skip for informational session_not_found)
if (!isSessionNotFound) {
    setAgentErrorModalSessionId(actualSessionId);
}
```

Every non-`session_not_found` error triggers a blocking modal. There's no distinction between:
- A background git status check failing (should be silent retry)
- The user's active agent session dying (should show modal)
- A transient "connection refused" during connection storm (should auto-retry)

---

## Revised Implementation Plan

### Phase 0.5: Unify SSH Options (HIGH PRIORITY - Fixes Remaining Root Cause)

**Goal**: Ensure ALL SSH code paths use ControlMaster and keep-alives.

**Approach**: Create a single source of truth for SSH options, then have all three code paths reference it.

#### Option A: All code paths import from `ssh-remote-manager.ts` (Recommended)

Export the default options from `SshRemoteManager` and have the other code paths merge them in.

**Files to modify**:

| File | Change |
|------|--------|
| `src/main/ssh-remote-manager.ts` | Export `DEFAULT_SSH_CONNECTION_OPTIONS` as a module-level constant |
| `src/main/process-manager/runners/SshCommandRunner.ts` | Import and merge `DEFAULT_SSH_CONNECTION_OPTIONS`, overriding only `RequestTTY: 'no'` |
| `src/main/utils/ssh-command-builder.ts` | Import and merge `DEFAULT_SSH_CONNECTION_OPTIONS`, overriding only `RequestTTY: 'force'` and adding `LogLevel: 'ERROR'` |
| `src/main/services/anthropic-audit-service.ts` | Use singleton `sshRemoteManager` instead of `new SshRemoteManager()` |

**Key constraint**: `SshCommandRunner` needs `RequestTTY: 'no'` while `ssh-command-builder` needs `RequestTTY: 'force'`. All other options should be identical. The shared constant should NOT include `RequestTTY`, letting each consumer set their own.

**Shared options** (exported from `ssh-remote-manager.ts`):
```typescript
export const DEFAULT_SSH_CONNECTION_OPTIONS: Record<string, string> = {
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
```

**Per-consumer overrides**:
- `SshRemoteManager.defaultSshOptions`: `{ ...DEFAULT_SSH_CONNECTION_OPTIONS, RequestTTY: 'no' }`
- `SshCommandRunner.sshOptions`: `{ ...DEFAULT_SSH_CONNECTION_OPTIONS, RequestTTY: 'no' }`
- `ssh-command-builder DEFAULT_SSH_OPTIONS`: `{ ...DEFAULT_SSH_CONNECTION_OPTIONS, RequestTTY: 'force', LogLevel: 'ERROR' }`

**Risk**: Low. Same options Phase 0 already validated, just applied to more code paths.

**Testing**:
- Verify agent sessions use ControlMaster: `ls /tmp/maestro-ssh-*` should show socket files after agent spawn
- Verify git operations share connections: run git status on remote, check no new TCP connections
- Verify group chat uses shared connections

---

### Phase 1: Proactive Connection Health Monitor (NEW - User's Primary Ask)

**Goal**: Keep SSH connections alive automatically. Detect and repair dead connections BEFORE user operations hit them. Never show an error modal for a connection that could have been auto-healed.

#### Architecture: `SshConnectionHealthMonitor`

**New file**: `src/main/utils/ssh-connection-health-monitor.ts`

```
┌─────────────────────────────────────────────────────┐
│           SshConnectionHealthMonitor                │
│                                                     │
│  Per configured remote host:                        │
│  ┌────────────────────────────────────────────────┐ │
│  │ Health Check Loop (every 60s)                  │ │
│  │                                                │ │
│  │  1. Check ControlMaster socket exists          │ │
│  │  2. Probe socket: ssh -O check user@host       │ │
│  │  3. If dead → ssh -O exit (cleanup)            │ │
│  │     → Re-establish: ssh -fNM user@host         │ │
│  │  4. Update connection state                    │ │
│  │  5. Emit 'connection-state-changed' event      │ │
│  └────────────────────────────────────────────────┘ │
│                                                     │
│  States per host:                                   │
│  - 'connected'    (socket exists, probe succeeded)  │
│  - 'reconnecting' (probe failed, re-establishing)   │
│  - 'disconnected' (re-establish failed)             │
│  - 'unknown'      (no socket yet, never connected)  │
│                                                     │
│  Events:                                            │
│  - 'connection-state-changed' (host, oldState,      │
│     newState)                                       │
│  - 'connection-recovered' (host)                    │
│  - 'connection-lost' (host, error)                  │
└─────────────────────────────────────────────────────┘
```

**Key behaviors**:

1. **Startup**: After app initializes and SSH configs are loaded, start monitoring all configured remotes that have `enabled: true`.

2. **Health check loop** (every 60 seconds per host):
   - `ssh -O check -o ControlPath='/tmp/maestro-ssh-%C' user@host` - asks the ControlMaster if it's alive
   - If check fails, attempt `ssh -O exit` to clean up the dead socket
   - Re-establish master connection: `ssh -fNM -o ControlMaster=yes -o ControlPath=... user@host`
   - The `-fN` flags: fork to background, no remote command (just establish the tunnel)
   - The `-M` flag: become the ControlMaster

3. **Pre-operation check** (called before any SSH operation):
   - `ensureConnection(config: SshRemoteConfig): Promise<boolean>`
   - Quick socket existence check + `ssh -O check`
   - If dead, synchronous re-establish before returning
   - Callers wait for this before proceeding (prevents errors)

4. **On connection loss detection**:
   - Immediately attempt reconnect (don't wait for next health check cycle)
   - If reconnect fails, mark as 'disconnected'
   - Emit event so UI can show non-blocking indicator (NOT a modal)

5. **On config change** (remote added/removed/edited):
   - Start/stop monitoring for affected hosts
   - Re-establish connection if config changed

**Integration points**:

| File | Change |
|------|--------|
| `src/main/index.ts` | Start health monitor after SSH configs loaded |
| `src/main/utils/remote-fs.ts` | Call `ensureConnection()` before `execRemoteCommand()` |
| `src/main/utils/ssh-command-builder.ts` | Call `ensureConnection()` before building command |
| `src/main/process-manager/runners/SshCommandRunner.ts` | Call `ensureConnection()` before spawning |
| `src/main/ipc/handlers/ssh-remote.ts` | Restart monitor on config save/delete |
| `src/main/app-lifecycle/quit-handler.ts` | Stop monitor on quit |

**Risk**: Medium. Background SSH processes need careful lifecycle management. Must not leak child processes.

**Testing**:
- Kill sshd on a VM → health monitor detects within 60s → reconnects after sshd restart
- Verify no error modals for connections the monitor auto-heals
- Verify monitor doesn't interfere with active agent sessions
- Verify clean shutdown (no orphaned ssh processes)

---

### Phase 2: Error Routing - Suppress Background Errors from UI

**Goal**: Background operation failures should NEVER show a blocking modal. Only active interactive session errors warrant a modal.

**Current problem** (`App.tsx:3241-3244`): Every non-`session_not_found` error triggers `setAgentErrorModalSessionId()`.

#### Approach: Add `errorContext` to AgentError

**Files to modify**:

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add `errorContext?: 'interactive' \| 'background' \| 'batch' \| 'health-check'` to `AgentError` |
| `src/main/process-manager/types.ts` | Add `spawnContext` to `ManagedProcess` |
| `src/main/process-manager/handlers/StdoutHandler.ts` | Include `errorContext` from managed process |
| `src/main/process-manager/handlers/StderrHandler.ts` | Include `errorContext` from managed process |
| `src/main/process-manager/handlers/ExitHandler.ts` | Include `errorContext` from managed process |
| `src/renderer/App.tsx` | Route errors based on `errorContext` |

**Error routing logic**:

```
onAgentError(sessionId, error):
  if error.errorContext === 'health-check':
    → SILENT (health monitor handles it)

  if error.errorContext === 'background':
    → LOG ONLY (debug console, not chat)
    → Optional: non-blocking status indicator

  if error.errorContext === 'batch':
    → Current behavior (pause + toast + history entry)

  if error.errorContext === 'interactive' OR undefined:
    if error.recoverable === true:
      → TOAST (not modal) + auto-retry once via health monitor
    if error.recoverable === false:
      → MODAL (current behavior - auth failures, etc.)
```

**Risk**: Low-Medium. The `errorContext` field is optional/backward-compatible. Existing errors without it default to current behavior.

---

### Phase 3: Smart Auto-Retry with Health Monitor Integration

**Goal**: When an SSH operation fails, automatically check connection health, repair if needed, and retry - all before the user ever sees an error.

**Approach**: Wrap the retry logic in `remote-fs.ts` (which already has exponential backoff) with a health monitor integration step.

**Enhanced retry flow**:
```
SSH operation fails
  → Is it a recoverable SSH error? (connection refused, timed out, broken pipe)
    → YES:
      1. Call healthMonitor.ensureConnection(config) - attempts reconnect
      2. If reconnect succeeds → retry operation immediately
      3. If reconnect fails → proceed with existing backoff retry
      4. After max retries → emit error with context
    → NO (auth failure, host key changed):
      → Emit error immediately (no retry)
```

**Files to modify**:

| File | Change |
|------|--------|
| `src/main/utils/remote-fs.ts` | Integrate `ensureConnection()` into retry loop |
| `src/main/process-manager/runners/SshCommandRunner.ts` | Add pre-flight health check |
| `src/main/utils/ssh-command-builder.ts` | Document that callers should pre-check health |

**Risk**: Low. Enhances existing retry logic, doesn't replace it.

---

### Phase 4: Connection Health IPC & UI (Optional Polish)

**Goal**: Surface connection health state to the renderer for non-blocking indicators.

This phase is explicitly **lower priority** per user request - the connection should just work. But a subtle indicator is useful for debugging.

**New IPC channel**: `ssh:connection-state`

**Renderer receives**: `{ host: string, state: 'connected' | 'reconnecting' | 'disconnected', lastChecked: number }`

**UI**: Small colored dot next to session name in sidebar when using SSH remote:
- Green dot: connected (default, no dot needed)
- Yellow dot (pulsing): reconnecting
- Red dot: disconnected (after all retry attempts failed)

No modal. No toast. Just a dot. Clicking it could show tooltip with details.

**Risk**: Low. Purely additive UI.

---

## Implementation Order

| Phase | Description | Priority | Risk | Effort |
|-------|-------------|----------|------|--------|
| **0.5** | Unify SSH options across all code paths | **CRITICAL** | Low | Small (4 files, ~20 lines each) |
| **1** | Connection Health Monitor | **HIGH** | Medium | Medium (new file ~200 lines + 6 integration points) |
| **2** | Error routing with `errorContext` | **HIGH** | Low-Med | Medium (7 files, type + handler changes) |
| **3** | Smart auto-retry with health integration | **MEDIUM** | Low | Small (enhance existing retry logic) |
| **4** | Connection health UI indicators | **LOW** | Low | Small (IPC + small UI component) |

**Recommended execution**:
- Phase 0.5 first (fixes the immediate root cause of 2/3 code paths missing ControlMaster)
- Phase 1 + 2 together (health monitor + error routing complement each other)
- Phase 3 after validating Phase 1 works (builds on health monitor)
- Phase 4 only if needed after Phase 1-3

---

## Expected Outcomes

After Phase 0.5:
- **All SSH operations share connections** via ControlMaster (not just file explorer)
- Significant reduction in "connection refused" / "timed out" errors
- Agent sessions reuse existing master connections

After Phase 1:
- **Dead connections detected and repaired automatically** before user operations hit them
- Health check every 60s catches stale sockets
- `ensureConnection()` pre-flight prevents operations from hitting dead pipes

After Phase 2:
- **Background errors never show modals** - only genuine interactive session failures do
- Recoverable errors show non-blocking toasts at most
- Health check errors are completely silent

After Phase 3:
- **Failed operations auto-retry after connection repair** - user never sees transient errors
- Only persistent failures (auth, server down) surface to the user

---

## Files Reference

### SSH Option Sources (must be unified in Phase 0.5)
- `src/main/ssh-remote-manager.ts:65-79` - Has ControlMaster (Phase 0)
- `src/main/process-manager/runners/SshCommandRunner.ts:46-53` - MISSING ControlMaster
- `src/main/utils/ssh-command-builder.ts:45-52` - MISSING ControlMaster

### Error Pipeline
- `src/main/parsers/error-patterns.ts:555-717` - SSH error pattern definitions
- `src/main/process-manager/handlers/StdoutHandler.ts` - Detection from stdout
- `src/main/process-manager/handlers/StderrHandler.ts` - Detection from stderr
- `src/main/process-manager/handlers/ExitHandler.ts` - Detection at exit
- `src/main/process-listeners/error-listener.ts` - Bridges main→renderer
- `src/renderer/App.tsx:3022-3246` - Error handler (modal trigger at 3241-3244)

### SSH Execution Paths
- `src/main/utils/remote-fs.ts` - File explorer, stats (uses sshRemoteManager)
- `src/main/utils/remote-git.ts` - Git operations (uses ssh-command-builder)
- `src/main/utils/ssh-spawn-helper.ts` - Agent wrapping (uses ssh-command-builder)
- `src/main/ipc/handlers/agents.ts` - Agent detection (uses ssh-command-builder)
- `src/main/ipc/handlers/process.ts` - Session spawning (uses ssh-command-builder)
- `src/main/group-chat/group-chat-agent.ts` - Group chat (uses ssh-spawn-helper)
- `src/main/services/anthropic-audit-service.ts` - Usage tracking (creates new SshRemoteManager)

### Lifecycle
- `src/main/index.ts` - Startup (socket cleanup)
- `src/main/app-lifecycle/quit-handler.ts` - Shutdown (socket close)
- `src/main/utils/ssh-socket-cleanup.ts` - Socket cleanup utilities
