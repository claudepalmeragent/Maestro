# CLAUDE-PERFORMANCE.md

Performance best practices for the Maestro codebase. For the main guide, see [[CLAUDE.md]].

## React Component Optimization

**Use `React.memo` for list item components:**

```typescript
// Components rendered in arrays (tabs, agents, list items) should be memoized
const Tab = memo(function Tab({ tab, isActive, ... }: TabProps) {
  // Memoize computed values that depend on props
  const displayName = useMemo(() => getTabDisplayName(tab), [tab.name, tab.agentSessionId]);

  // Memoize style objects to prevent new references on every render
  const tabStyle = useMemo(() => ({
    borderRadius: '6px',
    backgroundColor: isActive ? theme.colors.accent : 'transparent',
  } as React.CSSProperties), [isActive, theme.colors.accent]);

  return <div style={tabStyle}>{displayName}</div>;
});
```

**Consolidate chained `useMemo` calls:**

```typescript
// BAD: Multiple dependent useMemo calls create cascade re-computations
const filtered = useMemo(() => agents.filter(...), [agents]);
const sorted = useMemo(() => filtered.sort(...), [filtered]);
const grouped = useMemo(() => groupBy(sorted, ...), [sorted]);

// GOOD: Single useMemo with all transformations
const { filtered, sorted, grouped } = useMemo(() => {
  const filtered = agents.filter(...);
  const sorted = filtered.sort(...);
  const grouped = groupBy(sorted, ...);
  return { filtered, sorted, grouped };
}, [agents]);
```

**Pre-compile regex patterns at module level:**

```typescript
// BAD: Regex compiled on every render
const Component = () => {
	const cleaned = text.replace(/^(\p{Emoji})+\s*/u, '');
};

// GOOD: Compile once at module load
const LEADING_EMOJI_REGEX = /^(\p{Emoji})+\s*/u;
const Component = () => {
	const cleaned = text.replace(LEADING_EMOJI_REGEX, '');
};
```

**Memoize helper function results used in render body:**

```typescript
// BAD: O(n) lookup on every keystroke (runs on every render)
const activeTab = activeSession ? getActiveTab(activeSession) : undefined;
// Then used multiple times in JSX...

// GOOD: Memoize once, use everywhere
const activeTab = useMemo(
	() => (activeSession ? getActiveTab(activeSession) : undefined),
	[activeSession?.aiTabs, activeSession?.activeTabId]
);
// Use activeTab directly in JSX - no repeated lookups
```

## Zustand Selector Optimization

**Subscribe to specific slices, not the entire store:**

```typescript
// BAD: Re-renders on ANY store change (sessions, groups, activeSessionId, etc.)
const { sessions, activeSessionId } = useSessionStore();

// GOOD: Only re-renders when activeSessionId changes
const activeSessionId = useSessionStore((s) => s.activeSessionId);

// GOOD: Only re-renders when sessions array changes
const sessions = useSessionStore((s) => s.sessions);
```

**Use selector equality functions for derived data:**

```typescript
// BAD: New array reference every render → always re-renders consumers
const activeSessions = useSessionStore((s) => s.sessions.filter((s) => s.isActive));

// GOOD: shallow comparison prevents re-render if result is equivalent
import { shallow } from 'zustand/shallow';
const activeSessions = useSessionStore((s) => s.sessions.filter((s) => s.isActive), shallow);
```

**Use `getState()` for one-shot reads outside React or in callbacks:**

```typescript
// In event handlers, effects, or non-React code — no subscription overhead
const sessions = useSessionStore.getState().sessions;
const activeId = useSessionStore.getState().activeSessionId;
```

> **Note:** The remaining Context Provider Memoization section below still applies to `LayerStackContext` and other non-store contexts. For state that has migrated to Zustand stores, prefer selectors over context consumption.

## setSessions Cascade Architecture

The `setSessions` call is the most performance-sensitive operation in the renderer. Understanding its cascade is critical for SSH performance.

**The cascade problem:**

```
setSessions(newSessions)
  → new sessions array reference
    → ~13 useSessionStore((s) => s.sessions) subscribers re-render
      → useEffect dependencies re-evaluate
        → SSH commands queued (file tree refresh, git status, etc.)
          → p-limit concurrency slots consumed (8 max per host)
```

**Mitigations:**

1. **sessionsRef pattern** — Read sessions via `useSessionStore.getState().sessions` (or a ref) inside effects instead of subscribing. This avoids re-triggering effects on every `setSessions` call. See [[CLAUDE-PATTERNS.md]] section 14.

   ```typescript
   // BAD: Effect re-runs on every setSessions call
   useEffect(() => {
   	const session = sessions.find((s) => s.id === activeSessionId);
   	refreshFileTree(session);
   }, [sessions, activeSessionId]); // sessions changes constantly

   // GOOD: Read sessions from store on-demand, only depend on activeSessionId
   useEffect(() => {
   	const session = useSessionStore.getState().sessions.find((s) => s.id === activeSessionId);
   	refreshFileTree(session);
   }, [activeSessionId]); // Only re-runs when active session changes
   ```

2. **Stats migration sentinel** — One-time effects (like migrating file tree stats for older sessions) use a sentinel check to run once per session, not on every state change.

3. **Debounced persistence** — Session persistence uses a 2-second debounce (`useDebouncedPersistence`) so rapid `setSessions` calls don't cause excessive disk I/O.

**SSH p-limit concurrency:**

```typescript
// src/main/utils/remote-fs.ts
// OpenSSH default MaxSessions = 10, minus 2 reserved for agent + overhead = 8 concurrent slots
const DEFAULT_MAX_SSH_SESSIONS = 10;
const RESERVED_SSH_CHANNELS = 2;
// Per-host limiter: calls exceeding the limit are queued FIFO, never dropped
const limiter = pLimit(Math.max(1, maxSessions - RESERVED_SSH_CHANNELS));
```

Exceeding SSH concurrency limits causes `connection refused` errors. Every unnecessary `setSessions` → effect → SSH command chain eats into these 8 slots.

## Data Structure Pre-computation

**Build indices once, reuse in renders:**

```typescript
// BAD: O(n) tree traversal on every markdown render
const result = remarkFileLinks({ fileTree, cwd });

// GOOD: Build index once when fileTree changes, pass to renders
const indices = useMemo(() => buildFileTreeIndices(fileTree), [fileTree]);
const result = remarkFileLinks({ indices, cwd });
```

## Main Process (Node.js)

**Cache expensive lookups:**

```typescript
// BAD: Synchronous file check on every shell spawn
fs.accessSync(shellPath, fs.constants.X_OK);

// GOOD: Cache resolved paths
const shellPathCache = new Map<string, string>();
const cached = shellPathCache.get(shell);
if (cached) return cached;
// ... resolve and cache
shellPathCache.set(shell, resolved);
```

**Use async file operations:**

```typescript
// BAD: Blocking the main process
fs.unlinkSync(tempFile);

// GOOD: Non-blocking cleanup
import * as fsPromises from 'fs/promises';
fsPromises.unlink(tempFile).catch(() => {});
```

## Debouncing and Throttling

**Use debouncing for user input and persistence:**

```typescript
// Agent persistence uses 2-second debounce to prevent excessive disk I/O
// See: src/renderer/hooks/utils/useDebouncedPersistence.ts
const { persist, isPending } = useDebouncedPersistence(session, 2000);

// Always flush on visibility change and beforeunload to prevent data loss
useEffect(() => {
	const handleVisibilityChange = () => {
		if (document.hidden) flushPending();
	};
	document.addEventListener('visibilitychange', handleVisibilityChange);
	window.addEventListener('beforeunload', flushPending);
	return () => {
		/* cleanup */
	};
}, []);
```

**Debounce expensive search operations:**

```typescript
// BAD: Fuzzy matching all files on every keystroke
const suggestions = useMemo(() => {
	return getAtMentionSuggestions(atMentionFilter); // Runs 2000+ fuzzy matches per keystroke
}, [atMentionFilter]);

// GOOD: Debounce the filter value first (100ms is imperceptible)
const debouncedFilter = useDebouncedValue(atMentionFilter, 100);
const suggestions = useMemo(() => {
	return getAtMentionSuggestions(debouncedFilter); // Only runs after user stops typing
}, [debouncedFilter]);
```

**Use throttling for high-frequency events:**

```typescript
// Scroll handlers should be throttled to ~4ms (240fps max)
const handleScroll = useThrottledCallback(() => {
	// expensive scroll logic
}, 4);
```

## Update Batching

**Batch rapid state updates during streaming:**

```typescript
// During AI streaming, IPC triggers 100+ updates/second
// Without batching: 100+ React re-renders/second
// With batching at 150ms: ~6 renders/second
// See: src/renderer/hooks/session/useBatchedSessionUpdates.ts

// Update types that get batched:
// - appendLog (accumulated via string chunks)
// - setStatus (last wins)
// - updateUsage (accumulated)
// - updateContextUsage (high water mark - never decreases)
```

## Virtual Scrolling

**Use virtual scrolling for large lists (100+ items):**

```typescript
// See: src/renderer/components/HistoryPanel.tsx
import { useVirtualizer } from '@tanstack/react-virtual';

const virtualizer = useVirtualizer({
	count: items.length,
	getScrollElement: () => scrollRef.current,
	estimateSize: () => 40, // estimated row height
});
```

## IPC Parallelization

**Parallelize independent async operations:**

```typescript
// BAD: Sequential awaits (4 × 50ms = 200ms)
const branches = await git.branch(cwd);
const remotes = await git.remote(cwd);
const status = await git.status(cwd);

// GOOD: Parallel execution (max 50ms = 4x faster)
const [branches, remotes, status] = await Promise.all([
	git.branch(cwd),
	git.remote(cwd),
	git.status(cwd),
]);
```

## Visibility-Aware Operations

**Pause background operations when app is hidden:**

```typescript
// See: src/renderer/hooks/git/useGitStatusPolling.ts
const handleVisibilityChange = () => {
	if (document.hidden) {
		stopPolling(); // Save battery/CPU when backgrounded
	} else {
		startPolling();
	}
};
document.addEventListener('visibilitychange', handleVisibilityChange);
```

## Context Provider Memoization

> **Note:** Most shared state now lives in Zustand stores (see Zustand Selector Optimization above). This section applies to the remaining React Contexts like `LayerStackContext`.

**Always memoize context values:**

```typescript
// BAD: New object on every render triggers all consumers to re-render
return <Context.Provider value={{ agents, updateAgent }}>{children}</Context.Provider>;

// GOOD: Memoized value only changes when dependencies change
const contextValue = useMemo(() => ({
  agents,
  updateAgent,
}), [agents, updateAgent]);
return <Context.Provider value={contextValue}>{children}</Context.Provider>;
```

## Event Listener Cleanup

**Always clean up event listeners:**

```typescript
useEffect(() => {
	const handler = (e: Event) => {
		/* ... */
	};
	document.addEventListener('click', handler);
	return () => document.removeEventListener('click', handler);
}, []);
```

## Performance Profiling

For React DevTools profiling workflow, see [[CONTRIBUTING.md#profiling]].

### Chrome DevTools Performance Traces

**Exporting DevTools Performance traces:**

The Chrome DevTools Performance panel's "Save profile" button fails in Electron with:

```
NotAllowedError: The request is not allowed by the user agent or the platform in the current context.
```

This occurs because Electron 28 doesn't fully support the File System Access API (`showSaveFilePicker`). Full support was added in Electron 30+ ([electron/electron#41419](https://github.com/electron/electron/pull/41419)).

**Workarounds:**

1. **Launch with experimental flag** (enables FSAA):

   ```bash
   # macOS
   /Applications/Maestro.app/Contents/MacOS/Maestro --enable-experimental-web-platform-features

   # Development
   npm run dev -- --enable-experimental-web-platform-features
   ```

2. **Use Maestro's native save dialog** (copy trace JSON from DevTools, then in renderer console):

   ```javascript
   navigator.clipboard
   	.readText()
   	.then((data) => window.maestro.dialog.saveFile({ defaultPath: 'trace.json', content: data }));
   ```

3. **Right-click context menu** - Right-click on the flame graph and select "Save profile..." which may use a different code path.
