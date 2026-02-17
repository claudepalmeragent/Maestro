# Maestro v0.14.5 Implementation Patterns

Regenerated 2026-02-17, archived at `__MD_ARCHIVE/CLAUDE-PATTERNS_20260217_182050.md`. Cross-ref `Codebase_Context_20260217_180422.md`.

---

## Key Corrections

- **useSettings path** is `src/renderer/hooks/settings/useSettings.ts` (NOT `hooks/useSettings.ts`)
- **AITab field** is `inputValue` (NOT `draftInput`)
- **agentSessionId type** is `string | null` (NOT `string | undefined`)
- **session.terminalPid** is legacy/always-zero -- do not rely on this value

---

## Pattern 1: Process Management

Dual AI + Terminal processes per session. AI processes are spawned as child_process instances
via ProcessManager. Terminal processes use PTY (node-pty).

Process spawning goes through the `process:spawn` IPC channel with full configuration:

```typescript
// Main process - spawning an AI process
const result = await ipcMain.handle('process:spawn', async (_event, config) => {
  const { sessionId, command, args, cwd, env } = config;
  const process = processManager.spawn(sessionId, {
    command,
    args,
    cwd,
    env,
  });
  return { pid: process.pid, sessionId };
});
```

Each session maintains references to both processes. The AI process handles agent
communication while the PTY handles interactive terminal I/O. They are independent --
killing one does not affect the other.

---

## Pattern 2: Security Requirements

Use `execFileNoThrow` for all external command execution. Never use shell execution
(`exec`, `execSync`, or `spawn` with `shell: true`).

```typescript
// CORRECT - no shell injection possible
const result = await execFileNoThrow('git', ['status', '--porcelain'], { cwd });

// WRONG - shell injection risk
const result = await exec(`git status --porcelain`, { cwd });
```

Input validation on IPC handlers uses the `createIpcHandler()` envelope pattern:

```typescript
const handler = createIpcHandler({
  channel: 'settings:update',
  validate: (payload) => {
    if (typeof payload.key !== 'string') throw new Error('Invalid key');
    return payload;
  },
  handle: async (validated) => {
    await store.set(validated.key, validated.value);
  },
});
```

All IPC messages pass through this envelope for consistent validation and error handling.

---

## Pattern 3: Settings Persistence

The `useSettings()` hook lives at `src/renderer/hooks/settings/useSettings.ts`.

Pattern: useState + IPC wrapper + batch loading from electron-store.

```typescript
// Usage in components
const { settings, updateSetting, loading } = useSettings();

// Internal pattern (simplified)
function useSettings() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Batch load all settings from electron-store via IPC
    ipcRenderer.invoke('settings:getAll').then((all) => {
      setSettings(all);
      setLoading(false);
    });
  }, []);

  const updateSetting = useCallback(async (key: string, value: unknown) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    await ipcRenderer.invoke('settings:update', { key, value });
  }, []);

  return { settings, updateSetting, loading };
}
```

---

## Pattern 4: Adding Modals

Four-step process for every new modal:

1. **Component**: Create the modal component in `src/renderer/components/modals/`
2. **Priority**: Add entry in `modalPriorities.ts` to define stacking order
3. **State**: Add open/close state in `ModalContext.tsx`
4. **LayerStack**: Register for Escape key handling via LayerStack

```typescript
// modalPriorities.ts
export const MODAL_PRIORITIES = {
  // ... existing modals
  myNewModal: 50, // higher = renders on top
};

// ModalContext.tsx - add state
const [myNewModalOpen, setMyNewModalOpen] = useState(false);

// In the modal component
function MyNewModal() {
  const { myNewModalOpen, setMyNewModalOpen } = useModalContext();

  useLayerStack({
    isOpen: myNewModalOpen,
    onEscape: () => setMyNewModalOpen(false),
    priority: MODAL_PRIORITIES.myNewModal,
  });

  if (!myNewModalOpen) return null;
  return <ModalShell>...</ModalShell>;
}
```

---

## Pattern 5: Theme Colors

Use inline styles with `theme.colors` for all theme-dependent colors. Do NOT use
Tailwind classes for colors that change with the theme.

Theme is prop-drilled through the entire component tree. This is intentional for
performance -- avoids context re-render overhead on every theme-dependent component.

```typescript
// CORRECT
function MyComponent({ theme }: { theme: Theme }) {
  return (
    <div style={{
      backgroundColor: theme.colors.background,
      color: theme.colors.text,
      borderColor: theme.colors.border,
    }}>
      <span style={{ color: theme.colors.textSecondary }}>
        Subtitle
      </span>
    </div>
  );
}

// WRONG - Tailwind classes for theme colors
function MyComponent() {
  return (
    <div className="bg-gray-900 text-white border-gray-700">
      ...
    </div>
  );
}
```

Tailwind is fine for layout, spacing, and non-theme-dependent styling (e.g., `flex`,
`p-4`, `rounded-lg`).

---

## Pattern 6: Multi-Tab Sessions

The AITab interface is defined in `src/renderer/types/index.ts`. Key fields:

```typescript
interface AITab {
  id: string;
  agentSessionId: string | null;   // null until agent connects (NOT undefined)
  name: string;
  logs: LogEntry[];
  usageStats: UsageStats;
  cumulativeUsageStats: UsageStats;
  inputValue: string;              // current input text (NOT draftInput)
  readOnlyMode: boolean;
  showThinking: boolean;
  wizardState: WizardState;
  rating: Rating;
  state: TabState;
  starred: boolean;
  locked: boolean;
  hasUnread: boolean;
  createdAt: number;
}
```

Tabs are managed per-session. Each session holds an array of AITab instances.
The `agentSessionId` starts as `null` and is populated once the AI agent process
establishes a connection for that tab.

---

## Pattern 7: Execution Queue

Each session maintains a `QueuedItem[]` for sequential prompt delivery:

```typescript
interface QueuedItem {
  prompt: string;
  tabId: string;
  timestamp: number;
}
```

Items are queued when the session/tab is busy (agent is processing), and delivered
in FIFO order when the session becomes idle:

```typescript
// Simplified queue delivery logic
function onSessionIdle(sessionId: string) {
  const queue = sessionQueues.get(sessionId);
  if (queue && queue.length > 0) {
    const next = queue.shift();
    deliverPrompt(sessionId, next.tabId, next.prompt);
  }
}
```

This ensures prompts are never dropped when users type while the agent is working.

---

## Pattern 8: Auto Run

Folder-based automation with playbook assets. The state machine governs the lifecycle:

```
IDLE -> INITIALIZING -> RUNNING -> COMPLETING -> IDLE
                          |
                    PAUSED_ERROR -> STOPPING
```

Key implementation details:
- **Worktree support**: Each auto-run can operate in an isolated git worktree
- **Document polling**: 10-15 second intervals for checking new playbook documents
- **Playbook assets**: Stored in designated folders, discovered at initialization

```typescript
type AutoRunState =
  | 'IDLE'
  | 'INITIALIZING'
  | 'RUNNING'
  | 'COMPLETING'
  | 'PAUSED_ERROR'
  | 'STOPPING';

// State transitions are explicit
function transitionAutoRun(current: AutoRunState, event: AutoRunEvent): AutoRunState {
  switch (current) {
    case 'IDLE':
      if (event === 'START') return 'INITIALIZING';
      break;
    case 'INITIALIZING':
      if (event === 'READY') return 'RUNNING';
      break;
    case 'RUNNING':
      if (event === 'COMPLETE') return 'COMPLETING';
      if (event === 'ERROR') return 'PAUSED_ERROR';
      break;
    case 'PAUSED_ERROR':
      if (event === 'STOP') return 'STOPPING';
      if (event === 'RETRY') return 'RUNNING';
      break;
    case 'COMPLETING':
      if (event === 'DONE') return 'IDLE';
      break;
    case 'STOPPING':
      if (event === 'STOPPED') return 'IDLE';
      break;
  }
  return current;
}
```

---

## Pattern 9: Tab Hover Overlay Menu

Consistent hover menu UX across tab components:

- **400ms delay** before showing the overlay (prevents flash on quick mouse movement)
- **Portal rendering** to avoid z-index and overflow clipping issues
- **Disabled states** when the session is busy (agent processing)

```typescript
function useTabHoverMenu(tabId: string, isBusy: boolean) {
  const [showMenu, setShowMenu] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const onMouseEnter = useCallback(() => {
    if (isBusy) return;
    timerRef.current = setTimeout(() => setShowMenu(true), 400);
  }, [isBusy]);

  const onMouseLeave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setShowMenu(false);
  }, []);

  return { showMenu, onMouseEnter, onMouseLeave };
}

// Render via portal
{showMenu && createPortal(
  <TabOverlayMenu tabId={tabId} />,
  document.getElementById('overlay-root')!
)}
```

---

## Pattern 10: SSH Remote Sessions

CRITICAL dual-identifier pattern. Two distinct concepts must not be confused:

| Identifier | Purpose | When to use |
|---|---|---|
| `sshRemoteId` | Reference to saved SSH config entry | Settings UI, detecting if session is remote |
| `sessionSshRemoteConfig` | Snapshot of SSH config at session creation | All runtime operations, process spawning |

```typescript
interface Session {
  // For config lookup only -- points to saved SSH settings
  sshRemoteId: string | null;

  // For runtime execution -- frozen snapshot at session creation
  sessionSshRemoteConfig: SSHRemoteConfig | null;
}

// CORRECT - use snapshot for execution
function spawnRemoteProcess(session: Session) {
  if (session.sessionSshRemoteConfig) {
    return connectAndSpawn(session.sessionSshRemoteConfig);
  }
}

// WRONG - do not look up config by ID at runtime
// The saved config may have changed since session creation
function spawnRemoteProcess(session: Session) {
  const config = getSavedConfig(session.sshRemoteId); // BAD
  return connectAndSpawn(config);
}
```

Always use `sessionSshRemoteConfig` for runtime operations. The `sshRemoteId` exists
only for config lookup and detection (e.g., "is this session remote?").

---

## Pattern 11: Hook Structure Patterns

_New since Jan 31._

### Domain subdirectories with barrel re-exports

```
src/renderer/hooks/
  settings/
    useSettings.ts
    useSettingsValidation.ts
    index.ts              // re-exports all hooks
  sessions/
    useSessionState.ts
    useSessionLogs.ts
    index.ts
```

### Naming conventions

- Hook: `useHookName`
- Deps type: `UseHookNameDeps`
- Options type: `UseHookNameOptions`
- Return type: `UseHookNameReturn`

### Ref mirror pattern

Prevents stale closures in callbacks that reference frequently-changing values:

```typescript
function useMyHook(value: string, onChange: (v: string) => void) {
  const valueRef = useRef(value);
  valueRef.current = value;

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const handleUpdate = useCallback(() => {
    // Always reads current value, never stale
    onChangeRef.current(valueRef.current + ' updated');
  }, []); // empty deps -- safe because refs are always current

  return { handleUpdate };
}
```

### Every returned function wrapped in useCallback

```typescript
function useMyFeature(): UseMyFeatureReturn {
  const doSomething = useCallback(() => { /* ... */ }, [dep1, dep2]);
  const doOther = useCallback(() => { /* ... */ }, [dep3]);

  return { doSomething, doOther }; // all stable references
}
```

### useReducer for complex state machines

```typescript
type State = { status: 'idle' | 'loading' | 'error'; data: Data | null };
type Action = { type: 'FETCH' } | { type: 'SUCCESS'; data: Data } | { type: 'FAIL' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'FETCH': return { ...state, status: 'loading' };
    case 'SUCCESS': return { status: 'idle', data: action.data };
    case 'FAIL': return { ...state, status: 'error' };
  }
}

const [state, dispatch] = useReducer(reducer, { status: 'idle', data: null });
```

### Four parameter patterns

1. **Deps object**: `useHook({ sessionId, tabId }: UseHookDeps)`
2. **Options object**: `useHook(opts: UseHookOptions)`
3. **Destructured**: `useHook({ enabled, interval }: { enabled: boolean; interval: number })`
4. **Positional**: `useHook(sessionId: string, tabId: string)` (max 2-3 args)

---

## Pattern 12: State Update Patterns

_New since Jan 31._

### Streaming batch: 150ms flush

Handles 100+ events/sec from agent streaming, batched into single setState calls:

```typescript
function useBatchedSessionUpdates(sessionId: string) {
  const pendingRef = useRef<LogEntry[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const addLogEntry = useCallback((entry: LogEntry) => {
    pendingRef.current.push(entry);

    if (!timerRef.current) {
      timerRef.current = setTimeout(() => {
        const batch = pendingRef.current;
        pendingRef.current = [];
        timerRef.current = null;

        // Single setState for entire batch
        updateSessionLogs(sessionId, (prev) => [...prev, ...batch]);
      }, 150);
    }
  }, [sessionId]);

  return { addLogEntry };
}
```

### Per-session debounce: 200ms

```typescript
function useSessionDebounce(sessionId: string) {
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const debouncedUpdate = useCallback((updater: () => void) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(updater, 200);
  }, []);

  return { debouncedUpdate };
}
```

### Persistence debounce: 2s with log truncation

Logs are truncated to 100 entries per AI tab before persisting to avoid
excessive storage and slow load times:

```typescript
function useDebouncedPersistence(sessionId: string) {
  const persist = useCallback((session: Session) => {
    const truncated = {
      ...session,
      tabs: session.tabs.map((tab) => ({
        ...tab,
        logs: tab.logs.slice(-100), // keep last 100 entries
      })),
    };
    ipcRenderer.invoke('session:persist', truncated);
  }, []);

  // 2-second debounce
  const debouncedPersist = useDebouncedCallback(persist, 2000);

  return { debouncedPersist };
}
```

### Context + Ref anti-stale-closure pattern

Combines React Context for reactivity with refs for stable callback access:

```typescript
const SessionContext = createContext<SessionState>(initialState);

function SessionProvider({ children }) {
  const [state, dispatch] = useReducer(sessionReducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Stable dispatch that always reads current state
  const getState = useCallback(() => stateRef.current, []);

  return (
    <SessionContext.Provider value={{ state, dispatch, getState }}>
      {children}
    </SessionContext.Provider>
  );
}
```

### Memoized selector hooks

Avoid unnecessary re-renders by selecting only the needed slice of state:

```typescript
function useSessionState(sessionId: string) {
  const { state } = useContext(SessionContext);
  return useMemo(
    () => state.sessions.find((s) => s.id === sessionId),
    [state.sessions, sessionId]
  );
}

function useSessionLogs(sessionId: string, tabId?: string) {
  const session = useSessionState(sessionId);
  return useMemo(() => {
    if (!session) return [];
    if (tabId) {
      const tab = session.tabs.find((t) => t.id === tabId);
      return tab?.logs ?? [];
    }
    return session.tabs.flatMap((t) => t.logs);
  }, [session, tabId]);
}
```

### Subscription-based change notifications

For cases where polling or context re-renders are too expensive:

```typescript
function useSessionSubscription(
  sessionId: string,
  onChange: (session: Session) => void
) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const unsubscribe = sessionStore.subscribe(sessionId, (session) => {
      onChangeRef.current(session);
    });
    return unsubscribe;
  }, [sessionId]);
}
```
