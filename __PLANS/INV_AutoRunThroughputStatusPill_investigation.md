# Investigation: Auto Run Throughput Status Pill

> **Investigation Date:** February 5, 2026
> **Status:** INVESTIGATION COMPLETE - READY FOR REVIEW
> **Investigator:** maestro-planner (claude cloud)
> **Related:** ThroughputStatusPill_plan_v1, INV_AutoRunProgressTracking_investigation

---

## Executive Summary

**Investigation Request:** Evaluate the feasibility and complexity of displaying Tokens and tok/s statistics (currently shown in the yellow Agent Session chat "pill") in the blue Auto Run "pill" that appears during Auto Run sessions.

**Key Findings:**

1. **Token/throughput stats ARE captured during Auto Runs** - The `spawnAgentForSession` function already captures `UsageStats` for each task via the `onUsage` listener. These stats are accumulated and stored in history entries but NOT displayed in real-time during execution.

2. **Subagent stats CAN be captured** - The codebase has comprehensive infrastructure for parsing subagent JSONL files, extracting token counts, and aggregating statistics. However, this is currently done on-demand, not in real-time.

3. **Feasibility: HIGH** - All necessary data is already captured; it just needs to be surfaced to the UI.

4. **Complexity: LOW to MEDIUM** - The main work is adding token tracking fields to `BatchRunState` and wiring up the display components.

---

## Part 1: Current Architecture Analysis

### 1.1 Yellow Thinking Pill (Agent Session) - How It Works

**Location:** `src/renderer/components/ThinkingStatusPill.tsx`

The yellow "Thinking" pill displays:
- Session name
- Token count (actual or estimated from bytes)
- Throughput (tok/s)
- Elapsed time
- Stop button

**Data Sources:**
- `session.currentCycleTokens` - Actual token count from `onUsage` events (only at response completion)
- `session.currentCycleBytes` - Bytes received during streaming (updated via `onData`)
- `session.thinkingStartTime` - Start timestamp for throughput calculation

**Key Insight - Estimation Approach (from ThroughputStatusPill implementation):**
```typescript
const BYTES_PER_TOKEN_ESTIMATE = 3.5;

// During streaming, estimate tokens from bytes
const estimatedTokens = bytes > 0 ? Math.floor(bytes / BYTES_PER_TOKEN_ESTIMATE) : 0;
const displayTokens = tokens > 0 ? tokens : estimatedTokens;
const isEstimated = tokens === 0 && displayTokens > 0;
```

The pill shows `~` (tilde) indicator when displaying estimated values during streaming.

### 1.2 Current Behavior When Stats Are Unavailable

**Question:** How does the current yellow pill UI handle cases where statistics are not available?

**Analysis of Current Behavior:**

The yellow thinking pill uses a **conditional rendering approach** with three states:

```typescript
// Lines 457-490 in ThinkingStatusPill.tsx

// State 1: Tokens available (actual or estimated) → Show tokens + throughput
{displayTokens > 0 && (
  <div>
    <span>Tokens{isEstimated ? '~' : ''}:</span>
    <span>{formatTokensCompact(displayTokens)}</span>
    <ThroughputDisplay tokens={displayTokens} startTime={...} />
  </div>
)}

// State 2: No tokens yet (before first chunk) → Show "Thinking..."
{displayTokens === 0 && (
  <span>Thinking...</span>
)}
```

**Additionally, ThroughputDisplay hides itself when throughput is 0:**

```typescript
// Lines 106-112 in ThroughputDisplay component
if (throughput === 0) return null;  // <-- Returns nothing when 0
```

**Result:** The UI falls back to showing **"Thinking..."** when:
1. `currentCycleBytes === 0` AND `currentCycleTokens === 0` (before first data arrives)
2. ThroughputDisplay returns `null` until there's enough data to calculate tok/s

**Scenarios Where Stats Don't Appear:**

| Scenario | Behavior | Why |
|----------|----------|-----|
| Before first chunk arrives | Shows "Thinking..." | Both bytes and tokens are 0 |
| Non-streaming agent (e.g., terminal) | Shows "Thinking..." | `supportsUsageStats: false` in capabilities |
| Agent that doesn't emit onData events | Shows "Thinking..." | No byte updates |
| Very short response | Brief flash of "Thinking...", then tokens | Bytes arrive quickly |
| Throughput calculation pending | Shows tokens, no tok/s | ThroughputDisplay returns null until calculated |

**UX Issue Identified:**

The current approach is **silent** - users cannot distinguish between:
1. "Stats will appear soon" (agent is working, data will come)
2. "Stats are not supported" (agent doesn't provide usage stats)
3. "Something might be wrong" (unexpected state)

### 1.3 UX Recommendations for Stats Unavailability

**Option 1: Always Show Stats Section (Greyed Out When Unavailable)**

```typescript
// Always render the stats section, but grey out when unavailable
<div style={{ opacity: displayTokens > 0 ? 1 : 0.4 }}>
  <span>Tokens:</span>
  <span>{displayTokens > 0 ? formatTokensCompact(displayTokens) : '—'}</span>
  <span>|</span>
  <span>{throughput > 0 ? `${throughput.toFixed(1)} tok/s` : '— tok/s'}</span>
</div>
```

**Pros:**
- UI layout is stable (no jumping when stats appear)
- Users know stats are expected
- Clear indication that data is being collected

**Cons:**
- Takes up space even when agent doesn't support stats
- May look "broken" for agents that never provide stats

**Option 2: Progressive Disclosure with Capability Check**

```typescript
// Check if agent supports usage stats
const supportsStats = agentCapabilities?.supportsUsageStats ?? true;

{supportsStats && (
  displayTokens > 0 ? (
    // Full stats display
    <StatsDisplay tokens={displayTokens} throughput={throughput} />
  ) : (
    // Greyed placeholder indicating stats will appear
    <span style={{ opacity: 0.4 }}>Tokens: — | — tok/s</span>
  )
)}

{!supportsStats && (
  // Optional: Show nothing, or a small indicator that stats aren't available
  null
)}
```

**Pros:**
- Only shows stats section when agent supports it
- Clear distinction between "waiting for data" vs "not supported"

**Cons:**
- Requires passing capabilities to the component
- Different appearance per agent type

**Option 3: Tooltip for Unavailable Stats (Recommended)**

```typescript
// Show a subtle indicator with explanation
{displayTokens === 0 && (
  <span
    style={{ opacity: 0.4 }}
    title="Token statistics will appear when data arrives"
  >
    Tokens: — | — tok/s
  </span>
)}
```

**Pros:**
- Stable layout
- Non-intrusive explanation via tooltip
- Users can hover to understand the state

**Recommendation for Auto Run Pill:**

Use **Option 3 (Tooltip)** for the Auto Run pill implementation because:
1. Auto Run always uses agents that support stats (claude-code, codex)
2. Stable layout prevents UI jumping during task execution
3. Tooltip provides context without cluttering the UI
4. Consistent with the existing `~` indicator approach for estimated values

**Suggested Implementation:**

```typescript
// In AutoRunPill component
const displayTokens = currentTaskTokens > 0
  ? currentTaskTokens
  : currentTaskBytes > 0
    ? Math.floor(currentTaskBytes / BYTES_PER_TOKEN_ESTIMATE)
    : 0;

const isEstimated = currentTaskTokens === 0 && displayTokens > 0;
const isWaiting = displayTokens === 0;

<div
  style={{ opacity: isWaiting ? 0.4 : 1 }}
  title={isWaiting ? "Token statistics will appear when data arrives" : undefined}
>
  <span>Tokens{isEstimated ? '~' : ''}:</span>
  <span>{isWaiting ? '—' : formatTokensCompact(displayTokens)}</span>
  <span>|</span>
  <ThroughputDisplay
    tokens={displayTokens}
    startTime={taskStartTime}
    showPlaceholder={isWaiting}  // New prop to show "— tok/s" when waiting
  />
</div>
```

### 1.4 Blue Auto Run Pill - Current Implementation

**Locations:**
- `src/renderer/components/ThinkingStatusPill.tsx` (AutoRunPill component, lines 222-353)
- `src/renderer/components/RightPanel.tsx` (Progress panel, lines 620-700)

**Current Display:**
- "AutoRun" label with pulsing indicator
- Task progress: `X/Y tasks completed`
- Worktree branch indicator (if applicable)
- Subagent indicator (if active): "Subagent: [type]"
- Elapsed time
- Stop button

**Current State:**
- **NO token count display**
- **NO throughput (tok/s) display**
- **NO bytes received display**

### 1.3 Data Flow Comparison

| Aspect | Agent Session (Yellow Pill) | Auto Run (Blue Pill) |
|--------|----------------------------|----------------------|
| Token updates | `batchedUpdater.updateCycleTokens()` | NOT wired |
| Byte updates | `batchedUpdater.updateCycleBytes()` | NOT wired |
| Usage stats | Session state via `onUsage` handler | Captured but not displayed |
| Start time | `session.thinkingStartTime` | `autoRunState.startTime` |

---

## Part 2: Where Token Stats ARE Captured During Auto Runs

### 2.1 Agent Execution Layer

**File:** `src/renderer/hooks/agent/useAgentExecution.ts`

```typescript
// Lines 220-227 in spawnAgentForSession
cleanupFns.push(
  window.maestro.process.onUsage((sid: string, usageStats) => {
    if (sid === targetSessionId) {
      // Accumulate usage stats for this task
      taskUsageStats = accumulateUsageStats(taskUsageStats, usageStats);
    }
  })
);
```

The `spawnAgentForSession` function:
1. Sets up an `onUsage` listener for the batch task's unique session ID
2. Accumulates `UsageStats` across multiple usage events
3. Returns `usageStats` in the result

### 2.2 Document Processor Layer

**File:** `src/renderer/hooks/batch/useDocumentProcessor.ts`

```typescript
// Lines 416-420 in processTask
return {
  success: result.success,
  agentSessionId: result.agentSessionId,
  usageStats: result.usageStats,  // <-- Stats are returned
  elapsedTimeMs,
  // ...
};
```

### 2.3 Batch Processor Layer

**File:** `src/renderer/hooks/batch/useBatchProcessor.ts`

```typescript
// Lines 1137-1144 - Stats are accumulated
if (usageStats) {
  loopTotalInputTokens += usageStats.inputTokens || 0;
  loopTotalOutputTokens += usageStats.outputTokens || 0;
  loopTotalCost += usageStats.totalCostUsd || 0;
  totalInputTokens += usageStats.inputTokens || 0;
  totalOutputTokens += usageStats.outputTokens || 0;
  totalCost += usageStats.totalCostUsd || 0;
}
```

**Current State:** Stats are accumulated for:
- Per-loop summaries (history entries)
- Final Auto Run summary

**NOT Used For:** Real-time display during execution.

---

## Part 3: Subagent Statistics Analysis

### 3.1 What's Available for Subagents

**Storage Location:** `~/.claude/projects/<encoded-path>/<session-id>/subagents/agent-*.jsonl`

**Captured Statistics per Subagent:**
```typescript
interface SubagentInfo {
  agentId: string;
  agentType: string;             // Explore, Plan, general-purpose, Bash, etc.
  inputTokens: number;           // Summed from JSONL
  outputTokens: number;          // Summed from JSONL
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;               // Calculated
  messageCount: number;
  durationSeconds: number;
  sizeBytes: number;
}
```

**Extraction Method:** Regex-based parsing of JSONL files (fast, doesn't require full JSON parsing)

### 3.2 Aggregation at Session Level

**File:** `src/main/storage/claude-session-storage.ts` (`computeAggregatedStats`)

```typescript
// Returns aggregated stats across parent session + all subagents:
aggregatedInputTokens: number;
aggregatedOutputTokens: number;
aggregatedCacheReadTokens: number;
aggregatedCacheCreationTokens: number;
aggregatedCostUsd: number;
aggregatedMessageCount: number;
hasSubagents: boolean;
subagentCount: number;
```

### 3.3 Current Limitations

| Capability | Status |
|------------|--------|
| Subagent token totals (on-demand) | **Available** |
| Subagent type identification | **Available** |
| Subagent cost calculation | **Available** |
| Real-time subagent token streaming | **NOT available** |
| Subagent throughput (tok/s) | **NOT available** |
| Per-subagent live updates | **NOT available** |

**Key Issue:** Subagent stats are computed by reading JSONL files on-demand, not streamed in real-time. Claude Code doesn't emit subagent usage events via the main process stdout - the stats are only available after parsing the files.

---

## Part 4: Feasibility Assessment

### 4.1 Agent Token Stats During Auto Run

| Requirement | Feasibility | Notes |
|-------------|-------------|-------|
| Display tokens during streaming | **HIGH** | Bytes are captured via `onData`; can estimate tokens |
| Display actual tokens at completion | **HIGH** | `onUsage` events already captured |
| Display throughput (tok/s) | **HIGH** | Start time + tokens = throughput |
| Cumulative tokens across tasks | **HIGH** | Already accumulated in batch processor |

### 4.2 Subagent Token Stats During Auto Run

| Requirement | Feasibility | Notes |
|-------------|-------------|-------|
| Display subagent tokens (on-demand) | **MEDIUM** | Requires polling JSONL files |
| Display subagent tokens (real-time) | **LOW** | Claude Code doesn't stream subagent usage |
| Display cumulative subagent tokens | **MEDIUM** | Can aggregate from files periodically |
| Display subagent throughput (tok/s) | **LOW** | No real-time data available |

---

## Part 5: Implementation Strategy

### Option A: Agent-Only Token Display (Recommended First Step)

**Complexity:** LOW
**Value:** HIGH
**Scope:** Only show main agent's token stats during Auto Run

**Implementation:**

1. **Add fields to `BatchRunState`:**
```typescript
// In src/renderer/types/index.ts
export interface BatchRunState {
  // ... existing fields ...

  // Token tracking for current task (Option A)
  currentTaskBytes?: number;        // Bytes received in current task
  currentTaskTokens?: number;       // Actual tokens (from onUsage)
  currentTaskStartTime?: number;    // Start time for throughput calculation

  // Cumulative token tracking across all tasks
  cumulativeInputTokens?: number;
  cumulativeOutputTokens?: number;
  cumulativeCost?: number;
}
```

2. **Wire up token updates in batch processor:**
```typescript
// In useBatchProcessor.ts during task execution
// - Listen to onData for byte updates
// - Listen to onUsage for actual token updates
// - Reset counters at task start
// - Dispatch to BatchRunState via reducer
```

3. **Update AutoRunPill display:**
```typescript
// In ThinkingStatusPill.tsx (AutoRunPill component)
// Add token display similar to regular thinking pill:
{autoRunState.currentTaskBytes > 0 && (
  <div>
    <span>Tokens{isEstimated ? '~' : ''}:</span>
    <span>{formatTokensCompact(displayTokens)}</span>
    <ThroughputDisplay tokens={displayTokens} startTime={taskStartTime} />
  </div>
)}
```

**Expected UI:**
```
[●] AutoRun | Tasks: 3/10 | Tokens~: 2.1K | ~45.2 tok/s | Elapsed: 5m 23s | [Stop]
```

### Option B: Add Cumulative Token Display

**Complexity:** LOW (after Option A)
**Value:** MEDIUM
**Scope:** Show total tokens consumed across all Auto Run tasks

**Implementation:**

1. **Add total tokens to display:**
```typescript
// Show cumulative tokens alongside current task tokens
<span>Total: {formatTokensCompact(autoRunState.cumulativeOutputTokens)}</span>
```

2. **Update reducer to track cumulative:**
```typescript
// In batchReducer.ts
case 'UPDATE_TASK_USAGE':
  return {
    ...state,
    currentTaskTokens: action.payload.tokens,
    cumulativeInputTokens: (state.cumulativeInputTokens || 0) + action.payload.inputTokens,
    cumulativeOutputTokens: (state.cumulativeOutputTokens || 0) + action.payload.outputTokens,
    cumulativeCost: (state.cumulativeCost || 0) + action.payload.cost,
  };
```

**Expected UI:**
```
[●] AutoRun | Tasks: 3/10 | Tokens~: 2.1K | ~45.2 tok/s | Total: 15.3K | Elapsed: 5m 23s | [Stop]
```

### Option C: Add Subagent Token Display

**Complexity:** MEDIUM-HIGH
**Value:** MEDIUM
**Scope:** Include subagent token consumption in the display

**Challenges:**
1. No real-time subagent usage events
2. Requires polling JSONL files during execution
3. SSH remote adds latency for file operations

**Implementation Approach:**

1. **Extend document polling to include subagent stats:**
```typescript
// In useDocumentPolling.ts or new useSubagentMonitor.ts
// Poll subagent folder for new/updated files
// Parse token counts from JSONL
// Aggregate with main agent stats
```

2. **Add subagent-specific fields to BatchRunState:**
```typescript
subagentInputTokens?: number;
subagentOutputTokens?: number;
totalInputTokensWithSubagents?: number;
totalOutputTokensWithSubagents?: number;
```

3. **Update display to show combined stats:**
```typescript
// Show main agent + subagent tokens
const totalTokens = (autoRunState.cumulativeOutputTokens || 0) +
                   (autoRunState.subagentOutputTokens || 0);
```

**Expected UI:**
```
[●] AutoRun | Tasks: 3/10 | Tokens: 2.1K | Subagent: 1.5K | Total: 18.8K | [Stop]
```

---

## Part 6: Risks and Considerations

### 6.1 Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Performance overhead from token tracking | LOW | Token updates are already batched (150ms) |
| UI cluttering with too much data | MEDIUM | Progressive disclosure; show basic stats first |
| Inaccurate estimates during streaming | LOW | Already solved with `~` indicator approach |
| Subagent file polling overhead | MEDIUM | Only poll if subagent indicator shows activity |
| SSH latency for remote sessions | MEDIUM | Use longer polling intervals (15-20s) |

### 6.2 UX Considerations

1. **Information Hierarchy:**
   - Primary: Task progress (X/Y)
   - Secondary: Token count + throughput
   - Tertiary: Cumulative stats, subagent stats

2. **Visual Balance:**
   - The pill shouldn't become too wide/overwhelming
   - Consider tooltip for detailed stats
   - Mobile/narrow views may need truncation

3. **Consistency:**
   - Use same formatting as yellow thinking pill
   - Use same `~` indicator for estimates
   - Use same `ThroughputDisplay` component

4. **Stats Unavailability States (NEW):**
   - **Waiting state:** Show greyed "Tokens: — | — tok/s" with tooltip explaining data will arrive
   - **Estimated state:** Show "Tokens~: X.XK | ~XX.X tok/s" with tilde indicators
   - **Actual state:** Show "Tokens: X.XK | XX.X tok/s" without tildes
   - **Layout stability:** Always render the stats section to prevent UI jumping

---

## Part 7: Implementation Roadmap

### Phase 1: Basic Token Display (Option A)
**Effort:** ~2-3 hours (AI agent)
**Files to modify:**
- `src/renderer/types/index.ts` - Add BatchRunState fields
- `src/renderer/hooks/batch/batchReducer.ts` - Add token tracking actions
- `src/renderer/hooks/batch/useBatchProcessor.ts` - Wire up onData/onUsage
- `src/renderer/components/ThinkingStatusPill.tsx` - Update AutoRunPill display

**UX Implementation Details:**
- Always render the token stats section (for stable layout)
- Use greyed "Tokens: — | — tok/s" with tooltip when waiting for data
- Use `~` indicator for estimated values during streaming
- Use `ThroughputDisplay` component with new `showPlaceholder` prop

### Phase 2: Cumulative Token Display (Option B)
**Effort:** ~1 hour (AI agent)
**Files to modify:**
- `src/renderer/hooks/batch/batchReducer.ts` - Add cumulative tracking
- `src/renderer/components/ThinkingStatusPill.tsx` - Add total display
- `src/renderer/components/RightPanel.tsx` - Add to progress panel

### Phase 3: Subagent Token Integration (Option C)
**Effort:** ~3-5 hours (AI agent)
**Files to modify:**
- `src/renderer/hooks/batch/useDocumentPolling.ts` or new hook
- `src/renderer/hooks/batch/batchReducer.ts` - Add subagent fields
- `src/main/ipc/handlers/agentSessions.ts` - Optimize for polling
- `src/renderer/components/ThinkingStatusPill.tsx` - Add subagent stats

### Phase 4: Testing & Refinement
**Effort:** ~1-2 hours
**Tasks:**
- Unit tests for new reducer actions
- Integration tests for end-to-end flow
- Manual testing with SSH remotes
- Performance profiling

---

## Part 8: Recommendation

### Recommended Approach: Phased Implementation

**Start with Phase 1 (Agent-Only Tokens)** because:
1. All data is already captured - minimal new infrastructure needed
2. Provides immediate value to users
3. Low risk, well-understood implementation pattern
4. Sets foundation for subsequent phases

**Defer Phase 3 (Subagent Tokens)** until:
1. Phase 1 & 2 are validated
2. User feedback confirms demand
3. Claude Code potentially adds real-time subagent usage events

### Expected Outcome

After Phase 1 implementation, the Auto Run pill will display:
```
[●] AutoRun | Tasks: 3/10 | Tokens~: 2.1K | ~45.2 tok/s | Elapsed: 5m 23s | [Stop]
```

This matches the yellow thinking pill's functionality while maintaining the Auto Run-specific task progress display.

---

## Appendix A: Key Code Locations

| Component | File Path |
|-----------|-----------|
| Yellow Thinking Pill | `src/renderer/components/ThinkingStatusPill.tsx` |
| Blue Auto Run Pill | `src/renderer/components/ThinkingStatusPill.tsx` (AutoRunPill) |
| Progress Panel | `src/renderer/components/RightPanel.tsx` |
| BatchRunState Type | `src/renderer/types/index.ts` |
| Batch Reducer | `src/renderer/hooks/batch/batchReducer.ts` |
| Batch Processor | `src/renderer/hooks/batch/useBatchProcessor.ts` |
| Document Processor | `src/renderer/hooks/batch/useDocumentProcessor.ts` |
| Agent Execution | `src/renderer/hooks/agent/useAgentExecution.ts` |
| Batched Updates | `src/renderer/hooks/session/useBatchedSessionUpdates.ts` |
| Claude Session Storage | `src/main/storage/claude-session-storage.ts` |
| Claude Output Parser | `src/main/parsers/claude-output-parser.ts` |

---

## Appendix B: Glossary

| Term | Definition |
|------|------------|
| Auto Run | Automated batch processing of markdown task documents |
| Yellow Pill | Status indicator shown during normal agent chat sessions |
| Blue Pill | Status indicator shown during Auto Run execution |
| Subagent | A Claude Code agent spawned via the Task tool to handle subtasks |
| BatchRunState | React state tracking Auto Run progress and configuration |
| Throughput | Token generation speed measured in tokens per second (tok/s) |
| Cycle Tokens | Tokens consumed in the current request/response cycle |
| Cycle Bytes | Raw bytes received during streaming (used for token estimation) |

---

## Appendix C: Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-05 | Initial investigation report |
| 1.1 | 2026-02-05 | Added Section 1.2-1.3: Analysis of stats unavailability handling and UX recommendations |

---

*Investigation completed by maestro-planner (claude cloud)*
*Document Version: 1.1*
