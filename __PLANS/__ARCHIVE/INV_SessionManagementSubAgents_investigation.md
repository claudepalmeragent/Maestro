# Investigation: Claude Code Subagent Session Support in Maestro

> **Investigation Date:** February 3, 2026
> **Status:** INVESTIGATION COMPLETE - READY FOR REVIEW
> **Related:** [INV_SessionManagement_investigation_summary.md](./__ARCHIVE/../../__ARCHIVE/../INV_SessionManagement_investigation_summary.md)

---

## Executive Summary

**Question:** What is contained in the "subagents" folders inside Claude Code session folders, and can Maestro support viewing them?

**Answer:**
- **YES** - Subagent conversations are stored in a `subagents/` subfolder within each session directory
- **YES** - They are human-readable JSONL files (same format as main sessions)
- **YES** - They represent conversations between the main agent and spawned subagents (Task tool)
- **PARTIAL** - Subagent token/cost usage is tracked separately; not currently aggregated into parent session stats

**Complexity Assessment:** **MEDIUM** - Requires new folder scanning, UI components, and optional stats aggregation. Well-defined integration points exist.

---

## Part 1: Understanding Claude Code Subagents

### 1.1 What Are Subagents?

Subagents are specialized AI assistants that Claude Code spawns via the **Task tool** to handle specific tasks. Each subagent:

- Runs in its **own context window** (separate from parent)
- Has a **custom system prompt** tailored to its purpose
- Can have **restricted tool access** (e.g., read-only)
- Operates with **independent permissions**
- Can use **different models** (e.g., Haiku for speed/cost)

**Built-in Subagents in Claude Code:**

| Subagent | Model | Purpose | Tools |
|----------|-------|---------|-------|
| **Explore** | Haiku | Fast codebase exploration | Read-only |
| **Plan** | Inherits | Research for plan mode | Read-only |
| **general-purpose** | Inherits | Complex multi-step tasks | All tools |
| **Bash** | Inherits | Terminal command isolation | Bash only |

### 1.2 Why Subagents Exist

Subagents help:
1. **Preserve context** - Keep verbose exploration/test output out of main conversation
2. **Enforce constraints** - Limit tools available for specific tasks
3. **Control costs** - Route simple tasks to cheaper/faster models (Haiku)
4. **Specialize behavior** - Focused system prompts for domains
5. **Parallel execution** - Multiple subagents can work concurrently

---

## Part 2: Subagent Storage Structure

### 2.1 File System Layout

Claude Code stores subagent transcripts in a **dedicated subfolder** within each session:

```
~/.claude/projects/<encoded-path>/
├── <session-uuid>.jsonl           # Main session transcript
├── subagents/                     # Subagent transcripts folder
│   ├── agent-<subagent-id-1>.jsonl
│   ├── agent-<subagent-id-2>.jsonl
│   └── agent-<subagent-id-3>.jsonl
└── <another-session-uuid>.jsonl
```

**Key Points:**
- Subagent folder: `~/.claude/projects/<encoded-path>/subagents/`
- File naming: `agent-<agentId>.jsonl`
- Each subagent invocation creates a new transcript file
- Subagent transcripts persist **independently** of main conversation

### 2.2 JSONL File Format

Subagent transcript files use the **same JSONL format** as main sessions:

```jsonl
{"type":"user","timestamp":"2026-02-03T10:00:00.000Z","message":{"role":"user","content":"Search for authentication files"},"uuid":"abc123"}
{"type":"assistant","timestamp":"2026-02-03T10:00:05.000Z","message":{"role":"assistant","content":[{"type":"text","text":"I'll search for authentication-related files..."}]},"uuid":"def456"}
{"type":"result","timestamp":"2026-02-03T10:00:10.000Z","message":{"usage":{"input_tokens":1500,"output_tokens":350,"cache_read_input_tokens":0}}}
```

**Entry Types:**
- `user` - User/parent message to subagent
- `assistant` - Subagent response
- `result` - Contains token usage data
- `system` - System events (e.g., compaction)

### 2.3 Subagent Lifecycle Events

Special system entries in subagent transcripts:

```jsonl
{"type":"system","subtype":"compact_boundary","compactMetadata":{"trigger":"auto","preTokens":167189}}
```

The `preTokens` value shows token usage before compaction occurred.

### 2.4 Subagent Persistence

- **Session persistence:** Subagent transcripts persist within their session
- **Resume capability:** Can resume a subagent by resuming the same session with its agent ID
- **Cleanup:** Transcripts cleaned up based on `cleanupPeriodDays` setting (default: 30 days)
- **Independence:** Main conversation compaction does NOT affect subagent transcripts

---

## Part 3: Current Maestro Capabilities Analysis

### 3.1 What Maestro Currently Does

| Capability | Status | Location |
|------------|--------|----------|
| List main sessions | ✅ Supported | `claude-session-storage.ts` |
| Parse JSONL format | ✅ Supported | `parseSessionContent()` |
| Extract token usage | ✅ Supported | Regex-based extraction |
| SSH Remote sessions | ✅ Supported | `listSessionsPaginatedRemote()` |
| Display session list | ✅ Supported | `AgentSessionsBrowser.tsx` |
| View session messages | ✅ Supported | `useSessionViewer` hook |
| Session stats aggregation | ✅ Supported | Progressive stats calculation |

### 3.2 What Maestro Does NOT Currently Do

| Capability | Status | Gap |
|------------|--------|-----|
| Scan `subagents/` folder | ❌ Missing | No folder scanning logic |
| List subagent files | ❌ Missing | No file enumeration |
| Parse subagent metadata | ❌ Missing | No subagent-specific parsing |
| Link subagents to parent | ❌ Missing | No parent-child relationship |
| Aggregate subagent tokens | ❌ Missing | Stats are separate |
| Display subagents in UI | ❌ Missing | No UI components |

### 3.3 Existing Code That Can Be Leveraged

**Session Storage (`claude-session-storage.ts`):**
- `parseSessionContent()` - Can parse subagent JSONL files as-is
- `readDirRemote()` - Can scan subagent folder on SSH Remote
- `parseSessionFileRemote()` - Can read subagent files via SSH

**UI Components (`AgentSessionsBrowser.tsx`):**
- `SessionListItem` - Can be adapted for subagent display
- `useSessionViewer` - Can view subagent messages
- `useSessionPagination` - Pattern for loading subagent lists

---

## Part 4: Token/Cost Tracking Analysis

### 4.1 Current Tracking Mechanism

Maestro extracts tokens from session files using regex:

```typescript
// From claude-session-storage.ts
const inputMatches = content.matchAll(/"input_tokens"\s*:\s*(\d+)/g);
const outputMatches = content.matchAll(/"output_tokens"\s*:\s*(\d+)/g);
const cacheReadMatches = content.matchAll(/"cache_read_input_tokens"\s*:\s*(\d+)/g);
const cacheCreationMatches = content.matchAll(/"cache_creation_input_tokens"\s*:\s*(\d+)/g);
```

**Cost Calculation:**
```typescript
const costUsd = calculateClaudeCost(
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheCreationTokens
);
```

### 4.2 Subagent Token Isolation

**Current State:**
- Subagent tokens are recorded **only** in subagent transcript files
- Parent session transcript does NOT include subagent token usage
- The main session's `/cost` and `/context` commands show **only main context**

**Implications for Maestro:**
- Session stats shown in UI currently **exclude subagent costs**
- To show true session cost, would need to aggregate parent + all subagent tokens

### 4.3 Aggregation Strategy Options

| Option | Description | Complexity |
|--------|-------------|------------|
| **A. Display Only** | Show subagents separately, no aggregation | Low |
| **B. Lazy Aggregation** | Sum tokens when viewing parent session detail | Medium |
| **C. Pre-computed** | Scan and sum on session list load | High (performance) |
| **D. Hybrid** | Option A default, Option B on demand | Medium |

**Recommendation:** **Option D (Hybrid)** - Display subagents separately by default, with a "Include subagent costs" toggle in the session detail view.

---

## Part 5: Proposed UI Design

### 5.1 Session List Enhancement

Add expandable subagent rows beneath parent sessions:

```
┌─────────────────────────────────────────────────────────────┐
│ ▼ Session: "Fix auth bug"          2h ago    $0.45   150 msgs│
│   └─ 🔹 Explore: "Search auth files"   20 mins  $0.02  12 msgs│
│   └─ 🔹 Explore: "Find error handler"  15 mins  $0.01   8 msgs│
│   └─ 🔹 general-purpose: "Implement fix" 45 mins $0.12  35 msgs│
│                                                              │
│ ► Session: "Add logging"           1d ago    $0.23    89 msgs│
│ ► Session: "Update tests"          2d ago    $0.18    67 msgs│
└─────────────────────────────────────────────────────────────┘
```

**UI Elements:**
- **Expand/Collapse Icon** (▼/►) - Toggle subagent visibility
- **Subagent Indicator** (🔹) - Visual distinction from main sessions
- **Subagent Type Label** - "Explore:", "Plan:", "general-purpose:", etc.
- **Indentation** - Visual hierarchy under parent

### 5.2 Session Detail View Enhancement

When viewing a session with subagents:

```
┌─────────────────────────────────────────────────────────────┐
│ Session Detail: "Fix auth bug"                    [Resume]  │
├─────────────────────────────────────────────────────────────┤
│ ┌─ Main Conversation ─────────────────────────────────────┐ │
│ │ User: Find and fix the authentication bug...            │ │
│ │ Assistant: I'll explore the codebase to find...         │ │
│ │ [Task: Explore agent started]                           │ │
│ │ ...                                                      │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌─ Subagent Conversations ────────────────────────────────┐ │
│ │ ▼ Explore (agent-abc123)         $0.02   12 messages    │ │
│ │   User: Search for authentication files                  │ │
│ │   Assistant: Found 5 auth-related files...               │ │
│ │                                                          │ │
│ │ ► general-purpose (agent-def456) $0.12   35 messages    │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌─ Stats ─────────────────────────────────────────────────┐ │
│ │ Main:      $0.30  |  103 messages  |  45,000 tokens     │ │
│ │ Subagents: $0.15  |   55 messages  |  22,000 tokens     │ │
│ │ ─────────────────────────────────────────────────────── │ │
│ │ Total:     $0.45  |  158 messages  |  67,000 tokens     │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 5.3 Aggregate Stats Toggle

Add checkbox to Session Explorer header:

```
[✓] Include subagent usage in totals
```

When enabled:
- Session stats include aggregated subagent tokens/cost
- Total stats bar shows combined metrics
- Individual sessions show "Main + Subagents" breakdown

---

## Part 6: Implementation Plan

### Phase 1: Backend - Subagent Discovery & Parsing (Medium Effort)

**Files to Modify:**
1. `src/main/storage/claude-session-storage.ts`
2. `src/main/utils/remote-fs.ts` (if SSH support needed)
3. `src/main/agents/types.ts` (new types)

**New Functions:**

```typescript
// claude-session-storage.ts

interface SubagentInfo {
    agentId: string;           // e.g., "abc123" from filename
    agentType: string;         // e.g., "Explore", "Plan", "general-purpose"
    filePath: string;          // Full path to transcript file
    timestamp: string;         // First message timestamp
    modifiedAt: string;        // File modification time
    messageCount: number;      // Total messages
    sizeBytes: number;         // File size
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    firstMessage: string;      // Preview text
}

async function listSubagentsForSession(
    projectPath: string,
    sessionId: string,
    sshConfig?: SshRemoteConfig
): Promise<SubagentInfo[]>;

async function getSubagentMessages(
    projectPath: string,
    sessionId: string,
    agentId: string,
    options?: { offset?: number; limit?: number },
    sshConfig?: SshRemoteConfig
): Promise<SessionMessagesResult>;
```

**Implementation Steps:**

1. **Add subagent folder path helper:**
```typescript
private getSubagentsFolderPath(projectPath: string): string {
    const encodedPath = encodeClaudeProjectPath(projectPath);
    return path.join(this.getProjectsDir(), encodedPath, 'subagents');
}
```

2. **Implement subagent listing:**
```typescript
async listSubagentsForSession(
    projectPath: string,
    sessionId: string,
    sshConfig?: SshRemoteConfig
): Promise<SubagentInfo[]> {
    const subagentsDir = this.getSubagentsFolderPath(projectPath);

    // Check if subagents folder exists
    const dirExists = sshConfig
        ? await checkDirExistsRemote(subagentsDir, sshConfig)
        : await fs.access(subagentsDir).then(() => true).catch(() => false);

    if (!dirExists) return [];

    // List agent-*.jsonl files
    const files = sshConfig
        ? await readDirRemote(subagentsDir, sshConfig)
        : await fs.readdir(subagentsDir);

    const agentFiles = files.filter(f =>
        f.name?.endsWith('.jsonl') && f.name?.startsWith('agent-')
    );

    // Parse each subagent file
    return Promise.all(agentFiles.map(f => parseSubagentFile(f, ...)));
}
```

3. **Extract subagent type from transcript:**
```typescript
function extractSubagentType(content: string): string {
    // Look for subagent_type in first few lines
    const lines = content.split('\n').slice(0, 10);
    for (const line of lines) {
        try {
            const entry = JSON.parse(line);
            if (entry.subagent_type) return entry.subagent_type;
            if (entry.type === 'system' && entry.agentType) return entry.agentType;
        } catch {}
    }
    return 'unknown';
}
```

### Phase 2: IPC Handlers (Low Effort)

**Files to Modify:**
1. `src/main/ipc/handlers/agentSessions.ts`
2. `src/main/preload/agentSessions.ts`

**New IPC Channels:**

```typescript
// agentSessions.ts
ipcMain.handle('agentSessions:listSubagents', async (_, agentId, projectPath, sessionId, sshRemoteId) => {
    const storage = getStorageForAgent(agentId);
    const sshConfig = sshRemoteId ? await getSshConfig(sshRemoteId) : undefined;
    return storage.listSubagentsForSession(projectPath, sessionId, sshConfig);
});

ipcMain.handle('agentSessions:getSubagentMessages', async (_, agentId, projectPath, sessionId, subagentId, options, sshRemoteId) => {
    const storage = getStorageForAgent(agentId);
    const sshConfig = sshRemoteId ? await getSshConfig(sshRemoteId) : undefined;
    return storage.getSubagentMessages(projectPath, sessionId, subagentId, options, sshConfig);
});
```

**Preload Bridge:**

```typescript
// preload/agentSessions.ts
agentSessions: {
    // ... existing methods ...
    listSubagents: (agentId: string, projectPath: string, sessionId: string, sshRemoteId?: string) =>
        ipcRenderer.invoke('agentSessions:listSubagents', agentId, projectPath, sessionId, sshRemoteId),
    getSubagentMessages: (agentId: string, projectPath: string, sessionId: string, subagentId: string, options?: SessionReadOptions, sshRemoteId?: string) =>
        ipcRenderer.invoke('agentSessions:getSubagentMessages', agentId, projectPath, sessionId, subagentId, options, sshRemoteId),
}
```

### Phase 3: Frontend - UI Components (Medium Effort)

**Files to Modify:**
1. `src/renderer/components/AgentSessionsBrowser.tsx`
2. `src/renderer/components/SessionListItem.tsx`
3. `src/renderer/hooks/useSessionViewer.ts`
4. `src/renderer/types/index.ts`

**New Components:**

```typescript
// SubagentListItem.tsx
interface SubagentListItemProps {
    subagent: SubagentInfo;
    theme: Theme;
    isSelected: boolean;
    onClick: () => void;
}

export function SubagentListItem({ subagent, theme, isSelected, onClick }: SubagentListItemProps) {
    return (
        <button
            onClick={onClick}
            className={`subagent-item ${isSelected ? 'selected' : ''}`}
            style={{ paddingLeft: '2rem' }} // Indentation
        >
            <span className="subagent-icon">🔹</span>
            <span className="subagent-type">{subagent.agentType}:</span>
            <span className="subagent-preview">{subagent.firstMessage}</span>
            <span className="subagent-cost">${subagent.costUsd.toFixed(2)}</span>
            <span className="subagent-messages">{subagent.messageCount} msgs</span>
        </button>
    );
}
```

**State Management:**

```typescript
// In AgentSessionsBrowser.tsx
const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
const [subagentsBySession, setSubagentsBySession] = useState<Map<string, SubagentInfo[]>>(new Map());
const [viewingSubagent, setViewingSubagent] = useState<SubagentInfo | null>(null);

// Toggle session expansion
const handleToggleExpand = async (sessionId: string) => {
    if (expandedSessions.has(sessionId)) {
        setExpandedSessions(prev => {
            const next = new Set(prev);
            next.delete(sessionId);
            return next;
        });
    } else {
        // Load subagents if not cached
        if (!subagentsBySession.has(sessionId)) {
            const subagents = await window.maestro.agentSessions.listSubagents(
                agentId, projectPathForSessions, sessionId, sshRemoteId
            );
            setSubagentsBySession(prev => new Map(prev).set(sessionId, subagents));
        }
        setExpandedSessions(prev => new Set(prev).add(sessionId));
    }
};
```

### Phase 4: Stats Aggregation (Low-Medium Effort)

**Files to Modify:**
1. `src/renderer/components/AgentSessionsBrowser.tsx`
2. `src/main/storage/claude-session-storage.ts`

**Aggregation Logic:**

```typescript
// Calculate aggregate stats including subagents
const calculateAggregateStatsWithSubagents = useCallback(async () => {
    let totalSubagentCost = 0;
    let totalSubagentTokens = 0;
    let totalSubagentMessages = 0;

    for (const session of sessions) {
        const subagents = subagentsBySession.get(session.sessionId) || [];
        for (const subagent of subagents) {
            totalSubagentCost += subagent.costUsd;
            totalSubagentTokens += subagent.inputTokens + subagent.outputTokens;
            totalSubagentMessages += subagent.messageCount;
        }
    }

    return {
        ...aggregateStats,
        totalCostUsd: aggregateStats.totalCostUsd + totalSubagentCost,
        totalTokens: aggregateStats.totalTokens + totalSubagentTokens,
        totalMessages: aggregateStats.totalMessages + totalSubagentMessages,
    };
}, [sessions, subagentsBySession, aggregateStats]);
```

---

## Part 7: Testing Strategy

### 7.1 Unit Tests

**New Test Files:**
- `src/__tests__/main/storage/claude-session-storage-subagents.test.ts`
- `src/__tests__/renderer/components/SubagentListItem.test.tsx`

**Test Cases:**

```typescript
describe('ClaudeSessionStorage - Subagents', () => {
    it('should list subagents for a session', async () => {
        const subagents = await storage.listSubagentsForSession(projectPath, sessionId);
        expect(subagents).toHaveLength(3);
        expect(subagents[0].agentType).toBe('Explore');
    });

    it('should return empty array when no subagents folder exists', async () => {
        const subagents = await storage.listSubagentsForSession(projectPath, 'no-subagents');
        expect(subagents).toEqual([]);
    });

    it('should parse subagent token usage correctly', async () => {
        const subagents = await storage.listSubagentsForSession(projectPath, sessionId);
        expect(subagents[0].inputTokens).toBe(1500);
        expect(subagents[0].outputTokens).toBe(350);
    });

    it('should handle SSH remote subagent listing', async () => {
        const subagents = await storage.listSubagentsForSession(
            projectPath, sessionId, mockSshConfig
        );
        expect(subagents).toHaveLength(2);
    });
});
```

### 7.2 Integration Tests

**Test Scenarios:**

1. **Local Session with Subagents**
   - Create mock session folder with subagents subfolder
   - Verify session list shows expand indicator
   - Verify expanding shows subagent list
   - Verify clicking subagent shows messages

2. **SSH Remote Session with Subagents**
   - Mock SSH remote connection
   - Verify subagent folder scanning via SSH
   - Verify subagent messages load via SSH

3. **Stats Aggregation**
   - Create session with known token counts
   - Create subagents with known token counts
   - Verify aggregate toggle shows correct totals

### 7.3 E2E Tests

**Playwright Test:**

```typescript
test('can view subagent conversations', async ({ page }) => {
    // Open Session Explorer
    await page.keyboard.press('Meta+Shift+L');

    // Find session with subagents (has expand indicator)
    const sessionWithSubagents = page.locator('[data-has-subagents="true"]').first();
    await sessionWithSubagents.click();

    // Expand to show subagents
    await sessionWithSubagents.locator('[data-expand-toggle]').click();

    // Verify subagent row appears
    await expect(page.locator('.subagent-item')).toBeVisible();

    // Click subagent to view messages
    await page.locator('.subagent-item').first().click();

    // Verify subagent messages display
    await expect(page.locator('.subagent-messages-view')).toBeVisible();
});
```

---

## Part 8: Effort Estimation

| Phase | Description | Effort | Files Changed |
|-------|-------------|--------|---------------|
| Phase 1 | Backend - Subagent Discovery | 4-6 hours | 3 files |
| Phase 2 | IPC Handlers | 1-2 hours | 2 files |
| Phase 3 | Frontend - UI Components | 6-8 hours | 4 files |
| Phase 4 | Stats Aggregation | 2-3 hours | 2 files |
| Testing | Unit + Integration Tests | 4-5 hours | 3 new files |
| **Total** | | **17-24 hours** | **~14 files** |

---

## Part 9: Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Large number of subagents | Performance | Lazy load, paginate, limit initial scan |
| SSH Remote latency | UX | Cache subagent list, progressive loading |
| Claude Code format changes | Compatibility | Graceful degradation, error handling |
| Token aggregation complexity | Accuracy | Clear labeling ("estimated" for large files) |

---

## Part 10: Open Questions for Stakeholder

1. **Expand by default?** Should sessions with subagents auto-expand, or require user action?

2. **Stats aggregation default?** Should the "Include subagent usage" toggle be on or off by default?

3. **Subagent resume capability?** Should Maestro support resuming individual subagent sessions (like Claude Code does)?

4. **Filter subagents?** Should there be a filter to show/hide subagent conversations in the list?

5. **Subagent type icons?** Should different subagent types (Explore, Plan, general-purpose) have distinct icons?

---

## Part 11: References

- [Claude Code Subagents Documentation](https://code.claude.com/docs/en/sub-agents)
- [Claude Code Cost Tracking](https://code.claude.com/docs/en/costs)
- [ccusage - JSONL Analysis Tool](https://github.com/ryoppippi/ccusage)
- [GitHub Issue: Expose sub-agent context sizes](https://github.com/anthropics/claude-code/issues/15677)

---

## Conclusion

Integrating subagent session support into Maestro is **feasible and well-scoped**. The existing session storage infrastructure can be extended to handle subagent folders with moderate effort. The proposed UI design provides intuitive access to subagent conversations while maintaining the familiar Session Explorer experience.

**Recommended Next Steps:**
1. Review and approve this investigation document
2. Create Auto Run documents for phased implementation
3. Begin with Phase 1 (Backend) as foundation
4. Iterate on UI design based on user feedback

---

*Investigation completed by maestro-planner (claude cloud)*
*Document Version: 1.0*
