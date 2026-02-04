# Session Management Investigation Report

> **Investigation Date:** February 3, 2026
> **Status:** UPDATED - Root Cause Identified
> **Verdict:** BUG/LIMITATION with SSH Remote Sessions

---

## Executive Summary

**UPDATE:** Further investigation revealed the **actual root cause** of the "0 sessions" issue when using SSH Remote agents.

### Root Cause: Session Storage Location Mismatch

When using SSH Remote, Claude Code runs on the **remote host** (container/server) and writes session files to the **remote machine's** `~/.claude/projects/` directory. However, Maestro's Session Explorer looks for sessions on the **local machine** (your Mac) where the Electron app runs.

```
┌─────────────────────────────┐          ┌─────────────────────────────┐
│     YOUR MAC (Maestro)      │   SSH    │   REMOTE HOST (Container)   │
├─────────────────────────────┤  ────►   ├─────────────────────────────┤
│ Session Explorer looks at:  │          │ Claude Code writes to:      │
│ ~/Users/you/.claude/projects│          │ /home/maestro/.claude/projects
│                             │          │                             │
│ Result: 0 sessions found    │          │ 58 session files exist!     │
└─────────────────────────────┘          └─────────────────────────────┘
```

### Evidence

On the remote host (`maestro-planner` container), we found:
- **58 session files** total in `~/.claude/projects/`
- **12 sessions** in `-app` directory (for `/app` project path)
- **Multiple sessions** in `-home-maestro` directory

But Maestro's About modal shows "0 sessions" because it scans the **local** Mac's home directory.

---

## Table of Contents

1. [Updated Findings](#1-updated-findings)
2. [Root Cause Analysis](#2-root-cause-analysis)
3. [Architecture Diagram](#3-architecture-diagram)
4. [Code Analysis](#4-code-analysis)
5. [Proposed Solution Options](#5-proposed-solution-options)
6. [Implementation Complexity Assessment](#6-implementation-complexity-assessment)
7. [Original Investigation Notes](#7-original-investigation-notes-preserved)

---

## 1. Updated Findings

### Session Files DO Exist

```bash
# On the remote host (container):
$ find ~/.claude/projects -name "*.jsonl" -type f -size +0 | wc -l
58

$ ls ~/.claude/projects/
-app
-home-maestro
```

### Path Encoding is Correct

The path encoding works correctly:
- `/app` encodes to `-app` ✓
- `/home/maestro` encodes to `-home-maestro` ✓

### The Problem

1. Maestro's Electron main process runs on your **Mac**
2. It uses `os.homedir()` which returns your **Mac's** home directory
3. It scans `~/Users/<you>/.claude/projects/` on your **Mac**
4. But Claude Code (via SSH Remote) wrote sessions to the **remote container's** `~/.claude/projects/`

---

## 2. Root Cause Analysis

### Current Behavior

```typescript
// src/main/storage/claude-session-storage.ts:269-271
private getProjectsDir(): string {
    return path.join(os.homedir(), '.claude', 'projects');
}
```

This ALWAYS looks locally, even for SSH Remote sessions.

### The AgentSessionsModal Problem

```typescript
// src/renderer/components/AgentSessionsModal.tsx:172-174
const result = await window.maestro.agentSessions.listPaginated(agentId, projectPath, {
    limit: 100,
});
```

**Critical:** The modal does NOT pass `sshRemoteId` to the IPC handler, even though the handler supports it:

```typescript
// src/main/ipc/handlers/agentSessions.ts:419-423
async (
    agentId: string,
    projectPath: string,
    options?: SessionListOptions,
    sshRemoteId?: string  // <-- This parameter exists but is never passed!
): Promise<PaginatedSessionsResult>
```

### About Modal Problem

```typescript
// src/main/ipc/handlers/agentSessions.ts:200-202
async function discoverClaudeSessionFiles(): Promise<SessionFileInfo[]> {
    const homeDir = os.homedir();  // <-- Always local!
    const claudeProjectsDir = path.join(homeDir, '.claude', 'projects');
```

The global stats discovery has **no SSH Remote support at all**.

---

## 3. Architecture Diagram

### Current (Broken for SSH Remote)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           YOUR MAC                                       │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    MAESTRO ELECTRON APP                          │   │
│  │  ┌──────────────────┐    ┌────────────────────────────────────┐ │   │
│  │  │  AgentSessions   │───►│ ClaudeSessionStorage.listSessions  │ │   │
│  │  │  Modal (Cmd+L)   │    │ - os.homedir() → /Users/you        │ │   │
│  │  └──────────────────┘    │ - Scans: /Users/you/.claude/...    │ │   │
│  │                          │ - Result: 0 sessions (no files!)   │ │   │
│  │  ┌──────────────────┐    └────────────────────────────────────┘ │   │
│  │  │  About Modal     │───►│ discoverClaudeSessionFiles          │ │   │
│  │  │  (Global Stats)  │    │ - Same problem: always local        │ │   │
│  │  └──────────────────┘    └────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                    │
│                                    │ SSH                                │
│                                    ▼                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     REMOTE CONTAINER                             │   │
│  │  ┌──────────────────────────────────────────────────────────┐   │   │
│  │  │  Claude Code CLI (runs via SSH)                          │   │   │
│  │  │  - Writes to: /home/maestro/.claude/projects/-app/       │   │   │
│  │  │  - 58 session files exist here!                          │   │   │
│  │  └──────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Desired (Fixed)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           YOUR MAC                                       │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    MAESTRO ELECTRON APP                          │   │
│  │  ┌──────────────────┐    ┌────────────────────────────────────┐ │   │
│  │  │  AgentSessions   │───►│ ClaudeSessionStorage                │ │   │
│  │  │  Modal (Cmd+L)   │    │ - Detects: Is this SSH Remote?     │ │   │
│  │  └──────────────────┘    │ - YES → listSessionsRemote(ssh)    │ │   │
│  │         │                │ - NO  → listSessions(local)        │ │   │
│  │         │                └────────────────────────────────────┘ │   │
│  │         │ passes sshRemoteId                                    │   │
│  │         ▼                                                       │   │
│  │  ┌──────────────────┐                                           │   │
│  │  │ IPC Handler      │───► Uses SSH to read remote ~/.claude/   │   │
│  │  │ listPaginated    │                                           │   │
│  │  └──────────────────┘                                           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                    │
│                                    │ SSH (reads session files)         │
│                                    ▼                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     REMOTE CONTAINER                             │   │
│  │  - /home/maestro/.claude/projects/-app/*.jsonl                  │   │
│  │  - Sessions are discovered and displayed!                       │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Code Analysis

### What Already Exists (Infrastructure)

The good news: **The infrastructure for remote session listing already exists!**

#### 1. Storage supports SSH Remote

```typescript
// src/main/storage/claude-session-storage.ts:325-331
async listSessions(
    projectPath: string,
    sshConfig?: SshRemoteConfig
): Promise<AgentSessionInfo[]> {
    // Use SSH remote access if config provided
    if (sshConfig) {
        return this.listSessionsRemote(projectPath, sshConfig);  // <-- EXISTS!
    }
    // ... local fallback
}
```

#### 2. IPC Handler accepts sshRemoteId

```typescript
// src/main/ipc/handlers/agentSessions.ts:419-432
async (
    agentId: string,
    projectPath: string,
    options?: SessionListOptions,
    sshRemoteId?: string  // <-- Parameter exists!
): Promise<PaginatedSessionsResult> => {
    // ...
    const sshConfig = sshRemoteId ? getSshRemoteById(sshRemoteId) : undefined;
    const result = await storage.listSessionsPaginated(projectPath, options, sshConfig);
    // ...
}
```

### What's Missing (The Gap)

#### 1. AgentSessionsModal doesn't pass sshRemoteId

```typescript
// src/renderer/components/AgentSessionsModal.tsx:172-174
// CURRENT (broken):
const result = await window.maestro.agentSessions.listPaginated(agentId, projectPath, {
    limit: 100,
});

// NEEDED (fixed):
const result = await window.maestro.agentSessions.listPaginated(
    agentId,
    projectPath,
    { limit: 100 },
    getSessionSshRemoteId(activeSession)  // <-- Pass SSH remote ID!
);
```

#### 2. About Modal global stats has no SSH Remote support

The `discoverClaudeSessionFiles()` function doesn't scan remote hosts at all.

---

## 5. Proposed Solution Options

### Option A: Pass sshRemoteId to Session Explorer (Minimal Fix)

**Scope:** Small - ~5-10 lines changed

**Changes Required:**

1. **AgentSessionsModal.tsx** - Pass `sshRemoteId` when listing sessions:
   ```typescript
   import { getSessionSshRemoteId } from '../utils/sessionHelpers';

   // In loadSessions():
   const sshRemoteId = getSessionSshRemoteId(activeSession);
   const result = await window.maestro.agentSessions.listPaginated(
       agentId,
       projectPath,
       { limit: 100 },
       sshRemoteId
   );
   ```

2. **Same for loadMoreSessions, toggleStar, etc.**

**Pros:**
- Minimal code changes
- Uses existing infrastructure
- Session Explorer (Cmd+Shift+L) would work for SSH Remote sessions

**Cons:**
- About modal global stats still won't include remote sessions
- Only fixes one entry point

---

### Option B: Full SSH Remote Support (Comprehensive)

**Scope:** Medium - ~50-100 lines changed

**Changes Required:**

1. All changes from Option A
2. **About Modal** - Add SSH Remote session discovery
3. **Global Stats** - Aggregate sessions from all configured SSH Remotes

**Pros:**
- Complete fix for all session displays
- About modal shows accurate global count

**Cons:**
- More complex
- Need to track which SSH Remotes have been used
- Performance considerations (scanning multiple remotes)

---

### Option C: Hybrid Storage Approach (Advanced)

**Scope:** Large - ~200+ lines

**Concept:** Automatically sync or cache remote session metadata locally

**Pros:**
- Faster session browsing (no SSH roundtrip)
- Works offline after initial sync
- Cleaner architecture

**Cons:**
- Significant complexity
- Cache invalidation challenges
- Storage duplication

---

## 6. Implementation Complexity Assessment

### Recommended: Option A (Start Here)

| Aspect | Assessment |
|--------|------------|
| **Code Changes** | ~10 lines in AgentSessionsModal.tsx |
| **Risk** | Very Low - uses existing, tested infrastructure |
| **Testing Required** | Manual testing with SSH Remote session |
| **Dependencies** | None - all infrastructure exists |

### Files to Modify

1. `src/renderer/components/AgentSessionsModal.tsx`
   - Import `getSessionSshRemoteId` from sessionHelpers
   - Pass sshRemoteId to `listPaginated`, `read`, `toggleStar`, etc.

### Existing Helper to Use

```typescript
// src/renderer/utils/sessionHelpers.ts:326-331
export function getSessionSshRemoteId(
    session: SessionSshInfo | null | undefined
): string | undefined {
    if (!session) return undefined;
    return session.sshRemoteId || session.sessionSshRemoteConfig?.remoteId || undefined;
}
```

---

## 7. Original Investigation Notes (Preserved)

### How Sessions Work (General)

Sessions are JSONL files written by Claude Code CLI to:
- **Local:** `~/.claude/projects/<encoded-path>/<session-id>.jsonl`
- **Remote:** `~/.claude/projects/<encoded-path>/<session-id>.jsonl` (on the remote host)

### Path Encoding

The encoding function replaces `/` and `.` with `-`:
```typescript
// src/main/utils/statsCache.ts:60-62
export function encodeClaudeProjectPath(projectPath: string): string {
    return projectPath.replace(/[/.]/g, '-');
}
```

Examples:
- `/app` → `-app`
- `/home/maestro` → `-home-maestro`
- `/Users/doug/Projects/Maestro` → `-Users-doug-Projects-Maestro`

### Session Lifecycle

1. User sends message in Maestro tab
2. Claude Code spawns and generates `session_id`
3. Claude Code writes messages to JSONL file
4. Session appears in Explorer (if storage is accessible)

---

## Appendix: Key Code References

| File | Line(s) | Purpose |
|------|---------|---------|
| `src/renderer/components/AgentSessionsModal.tsx` | 172-174 | Session list loading (MISSING sshRemoteId) |
| `src/main/storage/claude-session-storage.ts` | 325-385 | listSessions with SSH support |
| `src/main/storage/claude-session-storage.ts` | 390-449 | listSessionsRemote implementation |
| `src/main/ipc/handlers/agentSessions.ts` | 415-442 | listPaginated handler (supports sshRemoteId) |
| `src/main/ipc/handlers/agentSessions.ts` | 200-240 | discoverClaudeSessionFiles (NO SSH support) |
| `src/renderer/utils/sessionHelpers.ts` | 326-331 | getSessionSshRemoteId helper |

---

## Conclusion

**This IS a bug/limitation** when using SSH Remote agents. The infrastructure to fix it exists but is not wired up in the UI components.

**Recommended next step:** Implement Option A (pass sshRemoteId to AgentSessionsModal) as a minimal fix to enable Session Explorer for SSH Remote sessions.
