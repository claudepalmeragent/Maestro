# CLAUDE-PERFORMANCE.md

> **Regenerated**: 2026-02-17
> **Archived version**: `__MD_ARCHIVE/CLAUDE-PERFORMANCE_20260217_182050.md`
> **Cross-reference**: `Codebase_Context_20260217_180422.md`

Performance best practices for Maestro v0.14.5.

---

## 1. React Component Optimization

### React.memo for List Items

Every list-rendered component must be wrapped in `React.memo` to prevent re-renders when parent state changes unrelated to the item.

**BAD:**
```tsx
const SessionItem = ({ session, onSelect }) => {
  return <div onClick={() => onSelect(session.id)}>{session.name}</div>;
};
```

**GOOD:**
```tsx
const SessionItem = React.memo(({ session, onSelect }) => {
  return <div onClick={() => onSelect(session.id)}>{session.name}</div>;
});
```

### Consolidated useMemo Chains

Avoid cascading `useMemo` calls that each depend on the previous. Consolidate into a single derivation.

**BAD:**
```tsx
const filtered = useMemo(() => sessions.filter(s => s.state !== 'idle'), [sessions]);
const sorted = useMemo(() => [...filtered].sort((a, b) => b.createdAt - a.createdAt), [filtered]);
const mapped = useMemo(() => sorted.map(s => ({ ...s, label: s.name })), [sorted]);
```

**GOOD:**
```tsx
const processedSessions = useMemo(() => {
  return sessions
    .filter(s => s.state !== 'idle')
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(s => ({ ...s, label: s.name }));
}, [sessions]);
```

### Pre-compiled Regex

Compile regex patterns outside the component or in a module-level constant. Never create regex inside render or callbacks.

**BAD:**
```tsx
const highlight = (text: string) => {
  return text.replace(/\b(error|warn)\b/gi, '<mark>$1</mark>');
};
```

**GOOD:**
```tsx
const ERROR_WARN_REGEX = /\b(error|warn)\b/gi;

const highlight = (text: string) => {
  return text.replace(ERROR_WARN_REGEX, '<mark>$1</mark>');
};
```

### Memoized Helpers

Utility functions that derive values from props should be wrapped in `useCallback` or `useMemo` as appropriate to maintain referential stability.

**BAD:**
```tsx
const getDisplayName = (session: Session) => session.name || `Session ${session.id.slice(0, 6)}`;
// Called in render — new ref every time
```

**GOOD:**
```tsx
const getDisplayName = useCallback(
  (session: Session) => session.name || `Session ${session.id.slice(0, 6)}`,
  []
);
```

---

## 2. Data Structure Pre-computation

Build indices and lookup maps once, then reference them. Avoid repeated `.find()` or `.filter()` over arrays.

**BAD:**
```tsx
const getSession = (id: string) => sessions.find(s => s.id === id);
// O(n) every call — called dozens of times per render cycle
```

**GOOD:**
```tsx
const sessionIndex = useMemo(() => {
  const map = new Map<string, Session>();
  for (const s of sessions) {
    map.set(s.id, s);
  }
  return map;
}, [sessions]);

const getSession = useCallback((id: string) => sessionIndex.get(id), [sessionIndex]);
```

This pattern applies broadly: group-to-session maps, tab indices, folder lookups, etc.

---

## 3. Main Process

### Cache Expensive Lookups

In the main process, cache results of file-system or database queries that do not change frequently. Invalidate on known mutation events rather than re-reading every time.

```ts
let cachedProjectRoot: string | null = null;

function getProjectRoot(sessionPath: string): string {
  if (cachedProjectRoot) return cachedProjectRoot;
  cachedProjectRoot = computeProjectRoot(sessionPath);
  return cachedProjectRoot;
}
```

### Async File Operations

Always prefer async (`fs.promises`) over sync (`fs.*Sync`) in the main process to avoid blocking the event loop.

**BAD:**
```ts
const data = fs.readFileSync(filePath, 'utf-8');
```

**GOOD:**
```ts
const data = await fs.promises.readFile(filePath, 'utf-8');
```

---

## 4. Debouncing & Throttling

| Operation | Strategy | Interval | Implementation |
|---|---|---|---|
| Session persistence | Debounce | 2000ms | `useDebouncedPersistence` hook |
| Search input | Debounce | 100ms | Standard debounce in search handlers |
| Scroll events | Throttle | 4ms | Throttled scroll handlers (~250fps cap) |

The `useDebouncedPersistence` hook consolidates rapid session mutations into a single IPC save call, preventing disk I/O storms during AI streaming where dozens of state updates occur per second.

---

## 5. Update Batching

During AI streaming, 100+ state updates per second can arrive (log entries, usage stats, token counts). The `useBatchedSessionUpdates` hook queues these updates and flushes them on a configurable interval.

```ts
// Reference constant
const DEFAULT_BATCH_FLUSH_INTERVAL = 150; // ms
```

Updates are collected into a batch buffer. Every 150ms, the buffer is flushed and applied as a single state transition. This reduces React re-renders from ~100/sec to ~7/sec during heavy streaming.

**BAD:**
```tsx
socket.on('log', (entry) => {
  setSession(prev => ({ ...prev, logs: [...prev.logs, entry] }));
});
// 100+ setState calls per second
```

**GOOD:**
```tsx
const { enqueue } = useBatchedSessionUpdates(sessionId);

socket.on('log', (entry) => {
  enqueue({ type: 'appendLog', payload: entry });
});
// Flushed every DEFAULT_BATCH_FLUSH_INTERVAL ms
```

---

## 6. Virtual Scrolling

Long lists use `@tanstack/react-virtual` to render only visible items plus a small overscan buffer. This is implemented in:

- **`HistoryPanel.tsx`** — Session history list, which can contain thousands of entries.
- **`FileExplorerPanel.tsx`** — File tree with potentially deep and wide directory structures.

Virtual scrolling keeps DOM node count constant regardless of list length, maintaining smooth 60fps scrolling.

```tsx
const virtualizer = useVirtualizer({
  count: items.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => ROW_HEIGHT,
  overscan: 5,
});
```

---

## 7. IPC Parallelization

When multiple independent IPC calls are needed, use `Promise.all` to execute them concurrently instead of sequentially.

**BAD:**
```ts
const settings = await ipcRenderer.invoke('settings:get');
const sessions = await ipcRenderer.invoke('sessions:list');
const stats = await ipcRenderer.invoke('stats:summary');
// Total: sum of all three latencies
```

**GOOD:**
```ts
const [settings, sessions, stats] = await Promise.all([
  ipcRenderer.invoke('settings:get'),
  ipcRenderer.invoke('sessions:list'),
  ipcRenderer.invoke('stats:summary'),
]);
// Total: max of the three latencies
```

---

## 8. Visibility-Aware Operations

Pause non-essential background work when the application window is hidden or minimized. This saves CPU and battery.

```ts
useEffect(() => {
  const handleVisibilityChange = () => {
    if (document.hidden) {
      pausePolling();
    } else {
      resumePolling();
    }
  };
  document.addEventListener('visibilitychange', handleVisibilityChange);
  return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
}, []);
```

Applies to: stats polling, file watcher refresh intervals, heartbeat pings, animation frames.

---

## 9. Context Provider Memoization

Wrap context provider values in `useMemo` to prevent all consumers from re-rendering when the provider's parent re-renders.

**BAD:**
```tsx
<SessionContext.Provider value={{ sessions, addSession, removeSession }}>
  {children}
</SessionContext.Provider>
// New object reference every render — all consumers re-render
```

**GOOD:**
```tsx
const contextValue = useMemo(
  () => ({ sessions, addSession, removeSession }),
  [sessions, addSession, removeSession]
);

<SessionContext.Provider value={contextValue}>
  {children}
</SessionContext.Provider>
```

---

## 10. Event Listener Cleanup

Always return cleanup functions from `useEffect` hooks that register event listeners or subscriptions.

**BAD:**
```tsx
useEffect(() => {
  window.addEventListener('resize', handleResize);
}, []);
// Listener leaks on unmount
```

**GOOD:**
```tsx
useEffect(() => {
  window.addEventListener('resize', handleResize);
  return () => window.removeEventListener('resize', handleResize);
}, [handleResize]);
```

This applies equally to IPC listeners, WebSocket subscriptions, and DOM event handlers.

---

## 11. Performance Profiling

Maestro runs on **Electron 28.3.3**. The DevTools profiler has a known limitation with Frame-Sequence-Aligned Allocation (FSAA) tracking, which can produce misleading allocation timelines.

**Workaround (still active):** Use the Performance panel with "Disable JavaScript samples" unchecked, and rely on the "Bottom-Up" and "Call Tree" views rather than the "Timeline" flame chart for allocation tracking. Cross-reference with `process.memoryUsage()` snapshots logged from the main process.

```ts
// Main process diagnostic
setInterval(() => {
  const mem = process.memoryUsage();
  log.debug('Memory:', {
    heapUsed: (mem.heapUsed / 1024 / 1024).toFixed(1) + 'MB',
    rss: (mem.rss / 1024 / 1024).toFixed(1) + 'MB',
  });
}, 30000);
```

---

## 12. Memoized Props Hooks

Three dedicated hooks extract and memoize props for major UI regions, preventing cascade re-renders when unrelated state changes:

- **`useMainPanelProps`** — Derives props for the main conversation/editor panel.
- **`useSessionListProps`** — Derives props for the session sidebar list.
- **`useRightPanelProps`** — Derives props for the right-side auxiliary panel.

Each hook internally uses `useMemo` to produce a stable object reference that only changes when the relevant slice of state updates. Components consuming these hooks re-render only when their specific inputs change.

```tsx
const mainPanelProps = useMainPanelProps(session, settings);
// Only re-computes when session or settings change — not on every parent render
```

---

## 13. Conditional Component Mounting

Prefer conditional rendering over CSS visibility for heavy components. Unmounted components release their state, event listeners, and DOM nodes.

**BAD:**
```tsx
<SettingsModal style={{ display: isOpen ? 'block' : 'none' }} />
// Component stays mounted, keeps all listeners and state alive
```

**GOOD:**
```tsx
{isOpen && <SettingsModal onClose={() => setIsOpen(false)} />}
// Component fully unmounts when closed — no wasted resources
```

Use this pattern for modals, drawers, and any panel that is not always visible. The slight mount cost on open is far outweighed by the resource savings while closed.
