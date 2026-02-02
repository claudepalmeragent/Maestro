# Maestro Delta Observer Implementation Plan - Revised

## Review of Original Plan

### Overall Assessment: **CONDITIONAL APPROVAL** with significant revisions needed

The original plan demonstrates a reasonable understanding of the batching system but contains several inaccuracies about the existing architecture and proposes an implementation that may be unnecessarily complex for the actual use case.

---

## Original Plan Analysis

### What the Plan Gets RIGHT

| Claim | Status | Evidence |
|-------|--------|----------|
| Batching with 150ms interval | **ACCURATE** | `useBatchedSessionUpdates.ts` line 20: `DEFAULT_BATCH_FLUSH_INTERVAL = 150` |
| Supports multiple update types | **ACCURATE** | Lines 25-41 define 9 update types |
| Session has aiTabs, shellLogs, state, usageStats, contextUsage | **ACCURATE** | `types/index.ts` lines 435-623 |
| Flush mechanism exists | **ACCURATE** | Lines 154-437 implement sophisticated flush logic |
| IPC handlers trigger state updates | **ACCURATE** | Multiple handlers in `src/main/ipc/handlers/` |

### What the Plan Gets WRONG

| Claim | Issue | Reality |
|-------|-------|---------|
| "Observer pattern already implemented" | **OVERSTATED** | No traditional observer pattern exists. Uses event listeners (desktop) and WebSocket broadcasts (web) |
| "Delta tracking for changes" | **INACCURATE** | No delta tracking exists. Uses batch accumulation with full state replacement |
| Session structure is complete | **INCOMPLETE** | Session has 50+ fields; plan only mentions 5. Missing critical fields like `activeTabId`, `executionQueue`, `workLog`, `agentError`, etc. |
| "Generate compact delta objects" | **OVERENGINEERED** | The batch accumulator already provides efficient updates without needing a separate delta layer |

### Architectural Misunderstanding

The plan proposes adding a "DeltaObserver" on top of an existing system that already solves the same problem differently:

**Current Architecture:**
```
Agent Process → PTY Events → IPC Bridge → Event Listeners →
  BatchAccumulator (150ms) → React setState → Context Provider →
    Components + WebSocket Broadcasts
```

**Proposed Addition:**
```
BatchAccumulator → DeltaObserver → Delta Events → Components
                                 ↓
                          Previous State Comparison
```

This adds complexity without clear benefit. The batch accumulator already:
- Groups related updates (logs by time window)
- Accumulates incremental changes (usage stats, bytes, tokens)
- Flushes efficiently to minimize re-renders
- Supports selective subscription via React context selectors

---

## Revised Recommendations

### Option A: Enhance Existing Batch System (RECOMMENDED)

Instead of a new observer layer, enhance `useBatchedSessionUpdates` to emit change metadata:

**File:** `src/renderer/hooks/session/useBatchedSessionUpdates.ts`

```typescript
// Add to SessionAccumulator interface
interface SessionAccumulator {
  // ... existing fields
  changedFields: Set<'logs' | 'status' | 'tabStatus' | 'usage' | 'contextUsage' | 'cycleMetrics'>;
}

// Modify flush to include change summary
interface FlushResult {
  sessionId: string;
  changedFields: Set<string>;
  hasNewLogs: boolean;
  hasStatusChange: boolean;
  hasUsageUpdate: boolean;
}

// Add optional callback for change notifications
const batchedUpdater = useBatchedSessionUpdates({
  flushInterval: 150,
  onFlush?: (results: FlushResult[]) => void
});
```

**Benefits:**
- Minimal code changes
- Leverages existing batching logic
- No additional state comparison overhead
- Components can subscribe to specific change types

### Option B: Lightweight Change Tracker (If Delta Tracking Required)

If explicit delta tracking is needed (e.g., for analytics, debugging, or undo/redo):

**New File:** `src/renderer/hooks/session/useSessionChangeTracker.ts`

```typescript
interface SessionChange {
  sessionId: string;
  timestamp: number;
  type: 'log' | 'status' | 'usage' | 'tab' | 'context';
  summary: {
    field: string;
    previousValue?: unknown;
    newValue?: unknown;
  };
}

interface ChangeTrackerOptions {
  maxHistorySize?: number;  // Default: 100
  trackFields?: string[];   // Specific fields to track
  onChange?: (change: SessionChange) => void;
}

function useSessionChangeTracker(
  sessions: Session[],
  options?: ChangeTrackerOptions
): {
  changes: SessionChange[];
  getChangesForSession: (sessionId: string) => SessionChange[];
  clearHistory: () => void;
}
```

**Implementation Notes:**
- Use `usePrevious` hook pattern to compare states
- Only track specified fields to minimize overhead
- Ring buffer for change history to prevent memory leaks
- Optional external callback for real-time change events

### Option C: Full Delta Observer (NOT RECOMMENDED)

The original plan's approach is overengineered for Maestro's needs. However, if truly required:

**Issues to Address:**
1. State comparison is expensive for 50+ field objects
2. Deep comparison of nested arrays (logs, tabs) is O(n)
3. Maintaining "previous state" doubles memory for large sessions
4. Integration with existing batch system is complex

**If proceeding anyway, simplify the delta types:**

```typescript
// Simplified delta - focus on categories, not individual fields
type DeltaType =
  | { type: 'session-state'; sessionId: string; from: SessionState; to: SessionState }
  | { type: 'logs-added'; sessionId: string; tabId?: string; count: number }
  | { type: 'usage-updated'; sessionId: string; delta: Partial<UsageStats> }
  | { type: 'context-changed'; sessionId: string; percentage: number }
  | { type: 'tab-changed'; sessionId: string; tabId: string; field: string };
```

---

## Revised Implementation Plan

### Phase 1: Audit Current Performance (1-2 days)

Before adding any observer/delta system, measure actual performance:

1. Add timing instrumentation to flush cycle
2. Measure React re-render frequency and duration
3. Identify which components re-render unnecessarily
4. Profile memory usage during long sessions

**Key Files to Instrument:**
- `src/renderer/hooks/session/useBatchedSessionUpdates.ts`
- `src/renderer/contexts/SessionContext.tsx`
- `src/renderer/components/MainPanel.tsx`
- `src/renderer/components/TabBar.tsx`

### Phase 2: Optimize Context Selectors (2-3 days)

React Context causes full re-renders. Add memoized selectors:

**File:** `src/renderer/contexts/SessionContext.tsx`

```typescript
// Add selector hooks
export function useSessionState(sessionId: string): SessionState | null {
  const { sessions } = useSessionContext();
  return useMemo(
    () => sessions.find(s => s.id === sessionId)?.state ?? null,
    [sessions, sessionId]
  );
}

export function useSessionLogs(sessionId: string, tabId?: string): LogEntry[] {
  const { sessions } = useSessionContext();
  return useMemo(() => {
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return [];
    if (tabId) {
      return session.aiTabs.find(t => t.id === tabId)?.logs ?? [];
    }
    return session.aiLogs;
  }, [sessions, sessionId, tabId]);
}

export function useSessionUsage(sessionId: string): UsageStats | undefined {
  const { sessions } = useSessionContext();
  return useMemo(
    () => sessions.find(s => s.id === sessionId)?.usageStats,
    [sessions, sessionId]
  );
}
```

### Phase 3: Add Change Metadata to Flush (1-2 days)

Enhance batch flush to report what changed:

**File:** `src/renderer/hooks/session/useBatchedSessionUpdates.ts`

```typescript
// Add to existing flush function (around line 154)
function flush() {
  const changeReports: Map<string, Set<string>> = new Map();

  for (const [sessionId, accumulator] of accumulators.entries()) {
    const changes = new Set<string>();

    if (accumulator.logAccumulators.size > 0) changes.add('logs');
    if (accumulator.status !== undefined) changes.add('status');
    if (accumulator.usageDeltas.size > 0) changes.add('usage');
    if (accumulator.contextUsage !== undefined) changes.add('contextUsage');
    if (accumulator.tabStatuses.size > 0) changes.add('tabStatus');

    if (changes.size > 0) {
      changeReports.set(sessionId, changes);
    }
  }

  // Existing flush logic...

  // Notify listeners of what changed
  if (options.onFlush && changeReports.size > 0) {
    options.onFlush(changeReports);
  }
}
```

### Phase 4: Implement Selective Subscriptions (2-3 days)

Allow components to subscribe to specific change types:

**New File:** `src/renderer/hooks/session/useSessionSubscription.ts`

```typescript
type ChangeType = 'logs' | 'status' | 'usage' | 'contextUsage' | 'tabStatus';

interface SubscriptionOptions {
  sessionId: string;
  changeTypes: ChangeType[];
  onUpdate: (changeTypes: Set<string>) => void;
}

function useSessionSubscription(options: SubscriptionOptions): void {
  const { batchedUpdater } = useSessionContext();

  useEffect(() => {
    const unsubscribe = batchedUpdater.subscribe((changes) => {
      const sessionChanges = changes.get(options.sessionId);
      if (!sessionChanges) return;

      const relevantChanges = new Set(
        [...sessionChanges].filter(c => options.changeTypes.includes(c as ChangeType))
      );

      if (relevantChanges.size > 0) {
        options.onUpdate(relevantChanges);
      }
    });

    return unsubscribe;
  }, [options.sessionId, options.changeTypes, options.onUpdate]);
}
```

### Phase 5: Component Integration Analysis (Completed)

Analysis of UI components reveals they are **already optimized** using a props-based architecture:

**Current Architecture (Already Optimized):**

1. **MainPanel.tsx** - Receives `activeSession` as a prop from App.tsx. Uses internal memoization (lines 469-475) for tab lookups. Does not consume SessionContext directly.

2. **TabBar.tsx** - Receives `tabs`, `activeTabId`, and handlers as props. Uses `React.memo()` on both the component and individual `Tab` items. All state management happens through props.

3. **RightPanel.tsx** - Receives `session` as a prop. Wrapped in `React.memo()`. Handles its own internal state for panel-specific features.

4. **SessionList.tsx** - Uses `SessionItem` component (also memoized) for each session. Session data flows through props from App.tsx.

**Why the Props Pattern Works:**

The existing architecture avoids the "full context consumption" anti-pattern because:
- App.tsx is the single consumer of SessionContext
- It pre-filters and passes specific props to child components
- Children use `React.memo()` to skip re-renders when props haven't changed
- The batched updater in SessionContext groups updates to minimize re-renders

**Where the New Hooks ARE Useful:**

The memoized selectors and subscription hooks created in Phases 2-4 provide value for:

1. **New feature development** - Future components can use `useSessionState()`, `useSessionLogs()`, etc. directly without consuming the full context

2. **Custom hooks** - Building higher-level abstractions that need specific session data

3. **Performance debugging** - Subscriptions provide visibility into what's changing and when

4. **Extensions/plugins** - Third-party code can subscribe to specific changes without understanding the full architecture

**Example Usage for Future Components:**

```typescript
// A new component that only cares about usage stats
function UsageWidget({ sessionId }: { sessionId: string }) {
  const usage = useSessionUsage(sessionId);
  const contextUsage = useSessionContextUsage(sessionId);

  // Only re-renders when usage/context changes, not on every log entry
  return (
    <div>
      <span>Cost: ${usage?.totalCostUsd.toFixed(2) ?? 0}</span>
      <span>Context: {contextUsage}%</span>
    </div>
  );
}

// A component that reacts to specific change types
function LogAutoScroller({ sessionId }: { sessionId: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useSessionLogsSubscription(sessionId, () => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, true);

  return <div ref={scrollRef}>...</div>;
}
```

**Conclusion:**

No changes to existing UI components are needed - they're already well-optimized. The new hooks provide a foundation for future optimization and feature development

---

## Files to Modify

| File | Changes | Priority |
|------|---------|----------|
| `src/renderer/hooks/session/useBatchedSessionUpdates.ts` | Add change metadata tracking, subscription support | High |
| `src/renderer/contexts/SessionContext.tsx` | Add memoized selector hooks | High |
| `src/renderer/components/MainPanel.tsx` | Use selective subscriptions and log selector | Medium |
| `src/renderer/components/TabBar.tsx` | Use session state selector | Medium |
| `src/renderer/components/RightPanel.tsx` | Use usage and context selectors | Medium |
| `src/renderer/components/SessionList.tsx` | Use sessionById selector for list items | Medium |

---

## Success Criteria

1. **Performance:** No increase in flush cycle time (target: <5ms)
2. **Memory:** Change tracking overhead <1KB per session
3. **Re-renders:** 50% reduction in unnecessary component re-renders
4. **API:** Components can subscribe to specific change types
5. **Compatibility:** No breaking changes to existing batch updater API

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Performance regression from change tracking | Medium | High | Phase 1 benchmarking, opt-in tracking |
| Memory leaks from subscriptions | Low | Medium | Proper cleanup in useEffect, WeakMap for subscriptions |
| Breaking existing flush behavior | Low | High | Comprehensive tests before modification |
| Over-notification causing excessive callbacks | Medium | Low | Debounce subscription callbacks |

---

## Conclusion

The original plan's analysis of the codebase is **mostly accurate** but the proposed implementation is **overengineered**. The existing batch accumulator already provides most of the benefits of delta tracking without the complexity.

**Recommended approach:** Enhance the existing system with change metadata and selective subscriptions rather than adding a separate observer layer. This provides the same benefits with less code, lower risk, and better integration with the existing architecture.

The key insight the original plan missed: **the batch accumulator IS the delta tracker** - it just doesn't expose the delta information to consumers. The solution is to expose that information, not rebuild it in a separate system.
