# Investigation: Auto Run Progress Tracking Not Updating in Real-Time

> **Investigation Date:** February 4, 2026
> **Status:** INVESTIGATION COMPLETE - READY FOR REVIEW
> **Related:** Subagent Session Support Implementation (SUBAGENT-01 through SUBAGENT-05)

---

## Executive Summary

**Issue:** During execution of Auto Run documents SUBAGENT-01.md through SUBAGENT-04.md, the progress indicators (red pill, blue pill, progress panel) did not update in real-time. Progress only became visible upon completion via toast notification. However, SUBAGENT-05.md worked correctly with real-time progress updates.

**Root Cause Analysis:** After thorough investigation, the issue is **most likely caused by Claude Code's use of subagents (Task tool)** during Auto Run execution. When Claude Code spawns subagents to perform complex tasks, the main agent's output stream is paused or minimal, preventing Maestro from detecting task completion until the subagent returns control.

**Secondary factors:** 200ms debouncing and legacy field synchronization may contribute but are not the primary cause.

---

## Part 1: How Auto Run Progress Tracking Works

### 1.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Auto Run Progress Flow                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Document (.md)     Agent Execution      State Update       UI Render    │
│       │                   │                   │                 │        │
│       ▼                   ▼                   ▼                 ▼        │
│  ┌─────────┐       ┌───────────┐       ┌──────────┐      ┌──────────┐   │
│  │ Read    │ ───▶  │ Spawn     │ ───▶  │ Dispatch │ ───▶ │ Pills    │   │
│  │ Doc &   │       │ Agent     │       │ UPDATE_  │      │ Update   │   │
│  │ Count   │       │ Wait for  │       │ PROGRESS │      │          │   │
│  │ Tasks   │       │ Completion│       │          │      │          │   │
│  └─────────┘       └───────────┘       └──────────┘      └──────────┘   │
│       │                   │                   │                 │        │
│       │                   │                   │                 │        │
│       │            ┌──────┴──────┐     ┌──────┴──────┐          │        │
│       │            │ Re-read Doc │     │ 200ms       │          │        │
│       │            │ After Task  │     │ Debounce    │          │        │
│       └────────────┴─────────────┴─────┴─────────────┴──────────┘        │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Task Count Detection

The system tracks progress by counting markdown checkboxes:

**File:** `src/renderer/hooks/batch/batchUtils.ts`
```typescript
// Unchecked: - [ ] task (also * [ ])
const UNCHECKED_REGEX = /^[\s]*[-*]\s*\[\s\]/gim;

// Checked: - [x] task (also * [x])
const CHECKED_REGEX = /^[\s]*[-*]\s*\[x\]/gim;
```

**Progress Calculation (`useDocumentProcessor.ts:358-360`):**
```typescript
// After agent completes, re-read document
const afterResult = await readDocAndCountTasks(folderPath, filename, sshRemoteId);
const { checkedCount: newCheckedCount } = afterResult;

// Calculate tasks completed
const tasksCompletedThisRun = Math.max(0, newCheckedCount - previousCheckedCount);
```

### 1.3 State Update Flow

1. **Task completes** → Document re-read → Checkbox count calculated
2. **State dispatch** → `UPDATE_PROGRESS` action with new counts
3. **Debounce layer** → 200ms delay before UI update
4. **React render** → Pills read from `batchRunState`

### 1.4 UI Components Affected

| Component | Location | Fields Used | Updates When |
|-----------|----------|-------------|--------------|
| **Red Pill** (top) | `ThinkingStatusPill.tsx:222-336` | `completedTasks`, `totalTasks` | Debounced state change |
| **Blue Pill** (bottom) | `RightPanel.tsx:640-683` | `completedTasksAcrossAllDocs` | Debounced state change |
| **Progress Panel** | `AutoRun.tsx` | `currentDocTasksCompleted`, `currentDocTasksTotal` | Debounced state change |

---

## Part 2: Comparison of Auto Run Documents

### 2.1 Task Counts

| Document | Task Count | Worked? |
|----------|------------|---------|
| SUBAGENT-01.md | 11 tasks | No real-time updates |
| SUBAGENT-02.md | 7 tasks | No real-time updates |
| SUBAGENT-03.md | 12 tasks | No real-time updates |
| SUBAGENT-04.md | 9 tasks | No real-time updates |
| SUBAGENT-05.md | 24 tasks | **YES - real-time updates** |

### 2.2 Document Structure Analysis

All documents follow the same markdown format:
```markdown
### Task X.Y: Description

- [x] Task instruction with details...
```

**No structural differences** were found between the documents that would affect parsing.

### 2.3 Task Type Analysis

| Document | Primary Task Types |
|----------|-------------------|
| SUBAGENT-01.md | Add TypeScript code, functions, interfaces |
| SUBAGENT-02.md | Add IPC handlers, preload bridge methods |
| SUBAGENT-03.md | Create React components, hooks |
| SUBAGENT-04.md | Modify backend stats calculation |
| SUBAGENT-05.md | Create test files, run tests, update summary doc |

**Key Observation:** SUBAGENT-01 through SUBAGENT-04 primarily involve **complex code generation** tasks that Claude Code likely delegated to subagents. SUBAGENT-05 involves **simpler file operations** (create test file, run command) that don't require subagent delegation.

---

## Part 3: Root Cause Analysis

### 3.1 Primary Hypothesis: Subagent Delegation

**Claude Code's Task tool spawns subagents** for complex operations. When a subagent is active:

1. The **main agent's output stream pauses** or becomes minimal
2. The subagent works in its own context window
3. **Maestro only sees the main agent's output**, not subagent progress
4. Progress detection depends on **checkbox changes in the document**
5. Checkboxes are only updated **after the main agent regains control**

**Evidence supporting this hypothesis:**

1. **SUBAGENT-01 through SUBAGENT-04** tasks required:
   - Adding large TypeScript code blocks
   - Creating new functions/interfaces
   - Modifying complex existing code

   These are exactly the types of tasks Claude Code delegates to subagents (Explore, Plan, general-purpose).

2. **SUBAGENT-05** tasks were simpler:
   - Create test files (mostly boilerplate)
   - Run bash commands (`npm test`)
   - Manual checklist items (marked by human)
   - Update markdown summary

   These don't typically require subagent delegation.

3. **The investigation document you just completed** confirms Claude Code uses subagents extensively - we literally added support for viewing them in Maestro!

### 3.2 Secondary Factor: 200ms Debounce

**File:** `useBatchProcessor.ts:28`
```typescript
const BATCH_STATE_DEBOUNCE_MS = 200;
```

Progress updates are batched and delayed by 200ms. While this prevents UI flicker, it means:
- Rapid task completions may appear as a single jump
- If tasks complete faster than 200ms apart, intermediate states are skipped

**Impact:** Minor - would cause slight delay, not complete absence of updates.

### 3.3 Tertiary Factor: Legacy Field Synchronization

The Auto Run system has two sets of progress fields:

**Legacy fields (used by Red Pill):**
```typescript
completedTasks: number;
totalTasks: number;
```

**Modern fields (used by Blue Pill/Progress Panel):**
```typescript
completedTasksAcrossAllDocs: number;
totalTasksAcrossAllDocs: number;
currentDocTasksCompleted: number;
currentDocTasksTotal: number;
```

Both are updated together in `updateBatchStateAndBroadcast()`, so this is unlikely to be the cause.

---

## Part 4: Why SUBAGENT-05 Worked

SUBAGENT-05 exhibited correct progress tracking because:

### 4.1 Task Nature

| Task | Type | Subagent Likely? |
|------|------|------------------|
| 5.1: Create test file | Template-based file creation | No |
| 5.2: Create component test | Template-based file creation | No |
| 5.3: Create hook test | Template-based file creation | No |
| 5.4: Update existing test | Simple addition | No |
| 5.5: Run all tests | Bash command | No |
| 5.6: Run TypeScript | Bash command | No |
| 5.7: Manual checklist | Human marks as complete | N/A |
| 5.8: Update summary | Simple file edit | No |

### 4.2 Output Stream Behavior

For SUBAGENT-05 tasks:
- Main agent executed tasks directly without subagent delegation
- Output streamed continuously to Maestro
- Document was updated in real-time after each task
- Checkbox changes detected immediately

### 4.3 Contrast with SUBAGENT-01-04

For SUBAGENT-01 through SUBAGENT-04:
- Complex code generation likely triggered subagent spawning
- Main agent waited for subagent to complete
- Minimal output during subagent execution
- Document updated only after subagent returned
- Multiple tasks may have completed in rapid succession after long waits

---

## Part 5: Proposed Solutions

### Option A: Accept Current Behavior (No Code Change)

**Description:** Document that complex tasks using subagents won't show incremental progress.

**Pros:**
- No code changes required
- Matches Claude Code's actual execution model

**Cons:**
- Poor user experience for complex Auto Run documents
- Users can't see if progress is being made

**Effort:** None

### Option B: Show "Agent Working" Indicator During Subagent Execution

**Description:** Detect when the main agent has spawned a subagent and show a different status indicator.

**Implementation:**
1. Monitor agent output for Task tool invocation patterns
2. Switch progress pill to "Subagent working..." state
3. Resume normal progress display when subagent completes

**Pros:**
- Users know work is happening
- Doesn't require subagent integration

**Cons:**
- Requires parsing agent output for Task tool patterns
- May have false positives/negatives

**Effort Estimates:**
| Implementer | Time |
|-------------|------|
| Human Developer | 8-12 hours (1-2 days) |
| AI Agent | ~1-2 hours execution |

**Files to modify:**
- `src/main/parsers/claude-output-parser.ts` - Detect Task tool invocation
- `src/renderer/hooks/batch/useBatchProcessor.ts` - Track subagent state
- `src/renderer/components/ThinkingStatusPill.tsx` - Show subagent indicator

### Option C: Integrate Subagent Progress Tracking

**Description:** Use the new subagent session support to track progress within subagents.

**Implementation:**
1. When Auto Run detects a new subagent folder, track it
2. Parse subagent JSONL files for progress indicators
3. Aggregate subagent progress with main task progress

**Pros:**
- Most accurate progress representation
- Leverages work done in SUBAGENT-01 through SUBAGENT-05
- Could show subagent type and activity in progress UI

**Cons:**
- Complex implementation
- Subagent files are per-session, not per-Auto-Run-task
- May not correlate well with checkbox progress
- Subagent JSONL files don't contain "task X of Y" progress - only token counts and messages

**Effort Estimates:**
| Implementer | Time |
|-------------|------|
| Human Developer | 20-30 hours (3-5 days) |
| AI Agent | ~3-5 hours execution |

**Files to modify:**
- `src/renderer/hooks/batch/useBatchProcessor.ts` - Monitor subagent folder
- `src/main/storage/claude-session-storage.ts` - Real-time subagent parsing
- `src/renderer/components/ThinkingStatusPill.tsx` - Display subagent progress
- New: `src/renderer/hooks/batch/useSubagentMonitor.ts` - Subagent folder watcher

### Option D: Document-Based Polling During Long Tasks

**Description:** Periodically re-read the Auto Run document during task execution to detect partial checkbox completion.

**Implementation:**
1. Start a background timer when task begins
2. Every N seconds, re-read document and count checkboxes
3. Update progress if any new checkboxes are checked
4. Stop timer when task completes

**Pros:**
- Works regardless of subagent usage
- Simple implementation

**Cons:**
- Adds file I/O overhead
- May miss rapid changes between polls
- Doesn't help if agent checks all boxes at once at the end

**Effort Estimates:**
| Implementer | Time |
|-------------|------|
| Human Developer | 4-6 hours (half day) |
| AI Agent | ~30-60 minutes execution |

**Files to modify:**
- `src/renderer/hooks/batch/useDocumentProcessor.ts` - Add polling logic
- `src/renderer/hooks/batch/useBatchProcessor.ts` - Integrate polling

---

## Part 6: Recommendation

### Recommended Approach: Option B + Option D Hybrid

**Rationale:**

Options B and D complement each other by addressing different aspects of the problem:

1. **Option B (Subagent indicator)** provides **psychological assurance**
   - Users immediately see "Subagent working on [type]..." when the agent delegates
   - Eliminates the anxiety of seeing no activity for extended periods
   - Low complexity - just detecting Task tool invocation and showing a status change

2. **Option D (Document polling)** provides **technical accuracy**
   - Catches cases where checkboxes are incrementally checked during long operations
   - Works regardless of whether subagents are used
   - Simple file I/O with minimal overhead (one read per 10 seconds)

**Why not Option C?** See "Option C Viability Analysis" section below.

**Combined Effort Estimate:**
| Implementer | Time |
|-------------|------|
| Human Developer | 12-18 hours (2-3 days) |
| AI Agent | ~2-3 hours execution |

### Implementation Plan

**Phase 1: Subagent Detection (Option B)**
1. Add Task tool invocation detection to output parser
2. Track "subagent active" state in batch processor
3. Update progress pill to show "Subagent working on [type]..." when detected
4. Clear subagent state when Task tool result received

**Phase 2: Document Polling (Option D)**
1. Add configurable polling interval (default 10 seconds)
2. Implement background document re-read during task execution
3. Update progress counts if checkboxes change mid-task
4. Add setting to enable/disable polling (for performance-sensitive environments)

### Expected Outcomes

| Scenario | Before | After |
|----------|--------|-------|
| Simple task | Progress updates | No change |
| Complex task with subagent | No updates until completion | "Subagent working..." indicator |
| Long-running task | No updates | Periodic progress updates via polling |
| Multiple rapid tasks | May miss intermediate states | Smoother progress display |

---

## Part 6.5: SSH Remote Considerations

Since all agent sessions in your environment use SSH Remotes, there are specific factors to consider:

### Impact on Root Cause Analysis

SSH Remote sessions **reinforce the subagent hypothesis** rather than weaken it:
- Network latency makes the "output stream pause" effect more pronounced
- File operations (reading document for checkbox counts) have additional overhead
- The 200ms debounce becomes less significant compared to SSH round-trip times

### Impact on Solution Options

| Option | SSH Remote Impact |
|--------|-------------------|
| **A (Accept)** | No change |
| **B (Subagent indicator)** | **More valuable** - reassures users during network-induced delays |
| **C (Subagent tracking)** | **More complex** - requires watching remote subagent folders via SSH |
| **D (Document polling)** | **Slightly slower** - each poll requires remote file read |

### Recommendation Adjustment

For SSH Remote environments, **Option B becomes even more attractive** because:
1. It provides immediate local feedback without network dependency
2. The "Subagent working..." state can display instantly while waiting for remote operations
3. Network latency already trains users to expect some delay

Option D's polling interval may need to be increased (e.g., 15-20 seconds instead of 10) to avoid excessive SSH traffic in remote environments.

---

## Part 6.6: Option C Viability Analysis

### Why Option C Was Not Recommended

Option C (Integrate Subagent Progress Tracking) appears attractive because it leverages the newly-implemented subagent session support. However, it has fundamental limitations:

**1. Subagent JSONL files don't contain task progress**
- Files contain: token counts, message content, timestamps
- Files do NOT contain: "task 3 of 7 complete" or checkbox status
- Progress would be inferred from message count/activity, not actual task completion

**2. Subagent scope doesn't match Auto Run task scope**
- A single Auto Run task might spawn 0, 1, or multiple subagents
- A single subagent might work on parts of multiple tasks
- No 1:1 mapping between subagent activity and checkbox items

**3. Implementation complexity**
- Requires real-time file watching of remote subagent folders
- Needs correlation logic to map subagent activity to specific tasks
- For SSH Remote sessions, this means continuous remote file polling

**4. Diminishing returns**
- After all the complexity, the UI would show "Subagent has 47 messages" instead of "Task 3 of 7"
- Not significantly more informative than Option B's "Subagent working..."

### When Option C Makes Sense

Option C becomes viable if:
1. Users want to see **which subagent type** is active (Explore, Plan, Bash, etc.)
2. Users want to see **subagent token consumption** during execution
3. The subagent JSONL format is extended to include task-level progress indicators

**Current Assessment:** Option C adds complexity without proportional user benefit. The hybrid B+D approach provides 80% of the value at 30% of the cost.

---

## Part 7: Alternative Explanation (If Hypothesis is Wrong)

If the subagent hypothesis is incorrect, other possible causes include:

### 7.1 File System Caching

SSH remote file operations may have caching that delays seeing document changes.

**Test:** Check if issue occurs only with SSH Remote sessions or also with local sessions.

### 7.2 Agent Session ID Mismatch

If the agent session ID changes mid-run, state updates may be lost.

**Test:** Review logs for session ID changes during Auto Run.

### 7.3 React Memo Optimization

Components may be memoized and not re-rendering despite state changes.

**Test:** Add console.log to render functions of progress components.

### 7.4 Web Interface Broadcast Failure

If testing via web interface, broadcast may have failed.

**Test:** Confirm issue occurs in desktop app, not just web interface.

---

## Part 8: Testing Protocol

To validate the hypothesis before implementation:

### 8.1 Controlled Test

1. Create a simple Auto Run document with one task: "Add a console.log to file X"
2. Run and observe progress
3. Create another document with one complex task: "Refactor module Y to use new pattern Z"
4. Run and observe progress
5. Compare behavior

### 8.2 Log Analysis

Enable verbose logging and look for:
- `[Task tool]` or `<invoke name="Task">` in agent output
- Timing gaps between progress updates
- Subagent JSONL file creation during Auto Run

### 8.3 Subagent Folder Monitoring

During Auto Run execution:
1. Watch `~/.claude/projects/<path>/subagents/` folder
2. Note when new `agent-*.jsonl` files appear
3. Correlate with progress update timing

---

## Conclusion

The Auto Run progress tracking issue is most likely caused by **Claude Code's use of subagents** for complex tasks. When the main agent delegates work to a subagent, Maestro loses visibility into progress until the subagent completes. This explains why SUBAGENT-01 through SUBAGENT-04 (complex code generation) showed no progress, while SUBAGENT-05 (simple file operations) worked correctly.

The recommended solution is a hybrid approach:
1. **Detect and display subagent activity** to assure users work is happening
2. **Poll the document periodically** to catch partial progress

This investigation provides the foundation for a future implementation if desired.

---

## Part 9: Implementation Status

### Implemented (Hybrid B+D)

**Option B - Subagent Detection:** ✅ Completed
- Task tool invocation detection added to `claude-output-parser.ts`
- Subagent state tracking added to `BatchRunState`
- Purple "Subagent working: [type]" indicator in progress pills

**Option D - Document Polling:** ✅ Completed
- `useDocumentPolling` hook created
- Configurable polling intervals (10s local, 15s SSH)
- Progress updates detected during long tasks
- User toggle to enable/disable polling

### Test Coverage
- Unit tests for Task tool detection (`claude-output-parser-task-tool.test.ts`)
- Unit tests for document polling hook (`useDocumentPolling.test.ts`)
- Integration tests for combined features (`progress-tracking-integration.test.ts`)
- Manual integration testing documented in Phase 3

### Files Modified
- `src/main/parsers/claude-output-parser.ts`
- `src/main/parsers/agent-output-parser.ts`
- `src/renderer/types/index.ts`
- `src/renderer/hooks/batch/batchReducer.ts`
- `src/renderer/hooks/batch/useBatchProcessor.ts`
- `src/renderer/hooks/batch/useDocumentPolling.ts` (new)
- `src/renderer/components/ThinkingStatusPill.tsx`
- `src/renderer/components/RightPanel.tsx`

### New Test Files
- `src/main/parsers/__tests__/claude-output-parser-task-tool.test.ts`
- `src/renderer/hooks/batch/__tests__/progress-tracking-integration.test.ts`

---

*Investigation completed by maestro-planner (claude cloud)*
*Document Version: 1.2*
*Refinements: Added SSH Remote considerations, Option C viability analysis, detailed hybrid B+D rationale, and implementation status*
