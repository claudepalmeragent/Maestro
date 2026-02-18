# Maestro v0.14.5 -- Deep Technical Architecture

> **Regenerated**: 2026-02-17
> **Archived version**: `__MD_ARCHIVE/ARCHITECTURE_20260217_182050.md`
> **Cross-reference**: `Codebase_Context_20260217_180422.md`

---

## Table of Contents

1. [Dual-Process Architecture](#1-dual-process-architecture)
2. [IPC Security Model](#2-ipc-security-model)
3. [Process Manager](#3-process-manager)
4. [Layer Stack System](#4-layer-stack-system)
5. [Custom Hooks](#5-custom-hooks)
6. [Services Layer](#6-services-layer)
7. [Custom AI Commands](#7-custom-ai-commands)
8. [Theme System](#8-theme-system)
9. [Settings Persistence](#9-settings-persistence)
10. [Agent Sessions API](#10-agent-sessions-api)
11. [Auto Run System](#11-auto-run-system)
12. [Achievement System](#12-achievement-system)
13. [AI Tab System](#13-ai-tab-system)
14. [Execution Queue](#14-execution-queue)
15. [Navigation History](#15-navigation-history)
16. [Group Chat System](#16-group-chat-system)
17. [Web/Mobile Interface](#17-webmobile-interface)
18. [CLI Tool](#18-cli-tool)
19. [Usage Dashboard](#19-usage-dashboard)
20. [Document Graph](#20-document-graph)
21. [Stats Database](#21-stats-database)
22. [Project Folders](#22-project-folders)
23. [Knowledge Graph](#23-knowledge-graph)
24. [Prompt Library](#24-prompt-library)
25. [Anthropic Audit](#25-anthropic-audit)
26. [Shared Module](#26-shared-module)
27. [SSH Remote](#27-ssh-remote)
28. [Error Handling Patterns](#28-error-handling-patterns)
29. [Styling](#29-styling)

---

## 1. Dual-Process Architecture

Maestro follows the standard Electron dual-process model, separating privileged
Node.js operations from the sandboxed Chromium renderer. This is the foundational
architectural decision upon which every other subsystem is built.

### 1.1 Main Process (Node.js)

The main process is the privileged half of the application. It has unrestricted
access to the filesystem, network, and operating system APIs. Responsibilities
include:

- **Window management**: Creating, positioning, and managing BrowserWindow
  instances including window state persistence across restarts.
- **IPC handler registration**: All `ipcMain.handle()` and `ipcMain.on()`
  registrations live here, organized by domain.
- **Process spawning**: PTY allocation for terminal shells, child_process
  management for AI agent subprocesses.
- **File system access**: All disk I/O operations are proxied through IPC
  handlers in the main process.
- **Native integrations**: System tray, native menus, global shortcuts,
  auto-updater, power monitor, and system notifications.
- **Store management**: Ten `electron-store` instances for persistent
  configuration (see Section 9).
- **SQLite database**: The stats database runs in the main process with WAL
  mode enabled (see Section 21).

```
Main Process Lifecycle:
  app.whenReady()
    -> createBootstrapStore()
    -> registerAllIpcHandlers()
    -> createMainWindow()
    -> initStatsDatabase()
    -> initAutoUpdater()
    -> startPowerMonitor()
```

### 1.2 Renderer Process (Chromium)

The renderer process runs in a sandboxed Chromium context. It has no direct
access to Node.js APIs. All privileged operations are performed via IPC calls
through the `window.maestro.*` bridge.

- **React application**: The entire UI is a single React application with
  component tree managed by React 18+.
- **State management**: A combination of React Context, hooks, and local
  component state. No external state library (Redux, Zustand, etc.).
- **IPC consumption**: All main-process features are accessed exclusively
  through the `window.maestro` namespace exposed by the preload script.

### 1.3 Preload Script and Context Bridge

The preload script is the critical security boundary. It runs in a special
context that has access to a limited set of Electron APIs and can expose
a controlled API surface to the renderer via `contextBridge.exposeInMainWorld`.

```typescript
// preload.ts (simplified)
contextBridge.exposeInMainWorld('maestro', {
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
    onChanged: (cb: SettingsCallback) => {
      const subscription = (_: IpcRendererEvent, ...args: unknown[]) => cb(...args);
      ipcRenderer.on('settings:changed', subscription);
      return () => ipcRenderer.removeListener('settings:changed', subscription);
    },
  },
  // ... 36 more namespaces
});
```

### 1.4 Security Configuration

Maestro enforces strict security defaults on all BrowserWindow instances:

```typescript
const windowOptions: BrowserWindowConstructorOptions = {
  webPreferences: {
    contextIsolation: true,       // Renderer cannot access preload scope
    nodeIntegration: false,       // No require() in renderer
    sandbox: true,                // OS-level sandboxing
    webSecurity: true,            // Enforce same-origin policy
    allowRunningInsecureContent: false,
    preload: path.join(__dirname, 'preload.js'),
  },
};
```

**macOS Hardened Runtime**: On macOS, the application is signed with hardened
runtime entitlements. This enables:

- Library validation (only Apple-signed or team-signed dylibs load)
- Restricted access to camera, microphone, location (not used)
- DYLD environment variable restrictions
- Debugging restrictions in production builds

**CSP Headers**: Content Security Policy headers are set to restrict inline
scripts and limit resource loading origins.

### 1.5 Inter-Process Communication Flow

```
Renderer (React)                    Main (Node.js)
    |                                     |
    |-- window.maestro.foo.bar() -------->|
    |   (ipcRenderer.invoke)              |
    |                                     |-- ipcMain.handle('foo:bar')
    |                                     |   executes handler
    |<-------- result/error --------------|
    |                                     |
    |<-- window.maestro.foo.onEvent() ----|
    |   (ipcRenderer.on)                  |
    |                                     |-- webContents.send('foo:event')
    |   callback fires                    |
```

All IPC communication is asynchronous. The `invoke`/`handle` pattern provides
request-response semantics with automatic error propagation. Event subscriptions
use the `on`/`send` pattern for push-based updates from main to renderer.

---

## 2. IPC Security Model

The `window.maestro.*` API surface is the sole communication channel between
the renderer and main process. It currently exposes **37 namespaces** organized
by functional domain. Each namespace groups related IPC calls behind a typed
interface.

### 2.1 Full Namespace Catalog

#### Core Namespaces (14)

| Namespace | Purpose | Key Methods |
|-----------|---------|-------------|
| `settings` | Application preferences | `get`, `set`, `getAll`, `onChanged`, `reset` |
| `sessions` | Session lifecycle management | `create`, `list`, `delete`, `rename`, `getActive`, `setActive`, `export`, `import` |
| `process` | Process spawning and management | `spawn`, `kill`, `write`, `resize`, `onData`, `onExit`, `list` |
| `fs` | Filesystem operations | `readFile`, `writeFile`, `readDir`, `stat`, `exists`, `mkdir`, `remove`, `watch`, `unwatch` |
| `dialog` | Native dialog windows | `showOpen`, `showSave`, `showMessage`, `showError` |
| `shells` | Shell environment detection | `getAvailable`, `getDefault`, `getEnvironment` |
| `shell` | OS shell integration | `openExternal`, `openPath`, `showItemInFolder`, `beep` |
| `logger` | Structured logging | `info`, `warn`, `error`, `debug`, `getLogPath` |
| `sync` | Settings sync across devices | `getStatus`, `enable`, `disable`, `getSyncPath`, `setSyncPath`, `resolve` |
| `power` | Power/sleep management | `onSuspend`, `onResume`, `getIdleTime`, `preventSleep`, `allowSleep` |
| `app` | Application metadata | `getVersion`, `getPath`, `getPlatform`, `getArch`, `quit`, `relaunch` |
| `fonts` | System font enumeration | `getInstalled`, `getMonospace` |
| `devtools` | Developer tools control | `open`, `close`, `toggle`, `isOpen` |
| `updates` | Auto-update management | `check`, `download`, `install`, `onStatus`, `getChannel`, `setChannel` |

#### Agent Namespaces (4)

| Namespace | Purpose | Key Methods |
|-----------|---------|-------------|
| `agents` | Agent configuration registry | `list`, `get`, `create`, `update`, `delete`, `getDefault`, `setDefault` |
| `agentSessions` | Agent conversation sessions | `create`, `send`, `cancel`, `getHistory`, `clearHistory`, `onMessage`, `onStatus`, `onError`, `getStorageInfo` |
| `agentError` | Agent error tracking | `report`, `getRecent`, `clear`, `onError`, `getTypes` |
| `claude` | **DEPRECATED** - Legacy Claude API | `send`, `cancel`, `getHistory` -- Forwards to `agentSessions` internally |

> **Deprecation Notice**: The `claude` namespace is maintained solely for
> backward compatibility. All new code must use `agentSessions`. The `claude`
> namespace proxies all calls to the equivalent `agentSessions` methods and
> will be removed in v0.16.0.

#### Git Namespace (1)

| Namespace | Purpose | Key Methods |
|-----------|---------|-------------|
| `git` | Full Git integration | `status`, `diff`, `diffStaged`, `log`, `branches`, `currentBranch`, `checkout`, `commit`, `push`, `pull`, `fetch`, `stash`, `stashPop`, `worktreeAdd`, `worktreeRemove`, `worktreeList`, `prCreate`, `prList`, `prView`, `remotes`, `getConfig` |

The Git namespace is one of the largest single namespaces, reflecting the deep
integration of version control into the Maestro workflow. Worktree operations
are particularly important for the Auto Run system (Section 11).

#### Web Namespaces (4)

| Namespace | Purpose | Key Methods |
|-----------|---------|-------------|
| `web` | Web interface server | `start`, `stop`, `getStatus`, `getUrl`, `onConnection`, `onDisconnect` |
| `live` | Live preview/hot reload | `start`, `stop`, `refresh`, `getUrl`, `onUpdate` |
| `webserver` | Static file serving | `start`, `stop`, `setRoot`, `getPort`, `addRoute` |
| `tunnel` | Secure tunnel management | `create`, `destroy`, `getUrl`, `getStatus`, `onStatusChange` |

#### Automation Namespaces (5)

| Namespace | Purpose | Key Methods |
|-----------|---------|-------------|
| `autorun` | Batch execution orchestration | `start`, `stop`, `pause`, `resume`, `getState`, `onStateChange`, `onProgress`, `getResults` |
| `playbooks` | Playbook definitions | `list`, `get`, `create`, `update`, `delete`, `execute`, `validate` |
| `history` | Execution history | `list`, `get`, `search`, `delete`, `export`, `getStats` |
| `cli` | CLI integration | `execute`, `getCommands`, `onOutput`, `isAvailable` |
| `tempfile` | Temporary file management | `create`, `read`, `write`, `delete`, `cleanup` |

#### Analytics Namespaces (5)

| Namespace | Purpose | Key Methods |
|-----------|---------|-------------|
| `stats` | Usage statistics database | `query`, `getUsage`, `getCosts`, `getTimeSeries`, `getDailyBreakdown`, `export`, `vacuum` |
| `documentGraph` | Document relationship mapping | `build`, `getNodes`, `getEdges`, `search`, `getLayout`, `setMaxNodes` |
| `audit` | Anthropic billing audit | `run`, `schedule`, `getResults`, `compare`, `getSchedule`, `setSchedule` |
| `reconstruction` | Session reconstruction | `reconstruct`, `getTimeline`, `getDiff`, `export` |
| `leaderboard` | Team usage leaderboard | `get`, `getByPeriod`, `getAchievements` |

#### Feature Namespaces (7)

| Namespace | Purpose | Key Methods |
|-----------|---------|-------------|
| `groupChat` | Multi-agent group conversations | `create`, `send`, `addParticipant`, `removeParticipant`, `getMessages`, `onMessage`, `getModerator`, `setModerator` |
| `projectFolders` | Project organization | `list`, `get`, `create`, `update`, `delete`, `addGroup`, `removeGroup`, `reorder` |
| `promptLibrary` | Prompt template management | `list`, `get`, `create`, `update`, `delete`, `search`, `import`, `export`, `getCategories` |
| `knowledgeGraph` | Persistent learning storage | `save`, `get`, `list`, `search`, `delete`, `getPath` |
| `feedback` | User feedback collection | `submit`, `getHistory`, `onRequest` |
| `context` | Context window management | `get`, `summarize`, `groom`, `getSize`, `getMax`, `onUpdate` |
| `marketplace` | Extension marketplace | `browse`, `install`, `uninstall`, `update`, `getInstalled`, `search`, `rate` |

#### Command Namespaces (2)

| Namespace | Purpose | Key Methods |
|-----------|---------|-------------|
| `speckit` | Spec-Kit generation | `generate`, `validate`, `getTemplate`, `listTemplates`, `export` |
| `openspec` | OpenSpec execution | `parse`, `execute`, `validate`, `getSchema`, `listSpecs` |

#### UI Namespaces (3)

| Namespace | Purpose | Key Methods |
|-----------|---------|-------------|
| `attachments` | File attachment handling | `add`, `remove`, `get`, `list`, `getPreview`, `getSize` |
| `notification` | System notifications | `show`, `clear`, `getPermission`, `requestPermission`, `onAction` |
| `debug` | Debug tooling | `getState`, `getMemory`, `getProcessInfo`, `exportDiagnostics`, `toggleOverlay` |

### 2.2 IPC Handler Registration Pattern

All IPC handlers in the main process follow a consistent factory pattern that
provides automatic error wrapping, logging, and type safety:

```typescript
// ipc-handler-factory.ts
function createIpcHandler<TArgs extends unknown[], TResult>(
  channel: string,
  handler: (...args: TArgs) => Promise<TResult>,
  options?: {
    timeout?: number;
    retries?: number;
    logLevel?: 'debug' | 'info' | 'warn';
  }
): void {
  ipcMain.handle(channel, async (event, ...args: TArgs) => {
    const startTime = Date.now();
    const requestId = generateRequestId();

    logger.log(options?.logLevel ?? 'debug', `IPC ${channel}`, {
      requestId,
      args: sanitizeArgs(args),
    });

    try {
      const result = await withTimeout(
        handler(...args),
        options?.timeout ?? 30_000
      );

      logger.debug(`IPC ${channel} completed`, {
        requestId,
        duration: Date.now() - startTime,
      });

      return result;
    } catch (error) {
      logger.error(`IPC ${channel} failed`, {
        requestId,
        error: serializeError(error),
        duration: Date.now() - startTime,
      });

      throw serializeError(error); // Must be serializable across IPC
    }
  });
}
```

### 2.3 Subscription Cleanup Pattern

Event-based IPC subscriptions return unsubscribe functions to prevent memory
leaks. The renderer side enforces cleanup:

```typescript
// In preload.ts - every onXxx method returns a cleanup function
onData: (processId: string, cb: DataCallback): (() => void) => {
  const channel = `process:data:${processId}`;
  const handler = (_: IpcRendererEvent, data: Buffer) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
},
```

```typescript
// In React components - cleanup in useEffect
useEffect(() => {
  const unsubscribe = window.maestro.process.onData(processId, (data) => {
    appendToBuffer(data);
  });
  return () => unsubscribe();
}, [processId]);
```

---

## 3. Process Manager

The Process Manager is the subsystem responsible for spawning, managing, and
monitoring all child processes. This includes interactive terminal shells (via
PTY) and AI agent subprocesses (via child_process).

### 3.1 Architecture Overview

```
process-manager/
  index.ts                  -- Public API and ProcessManager class
  types.ts                  -- Shared type definitions
  spawners/
    pty-spawner.ts          -- PTY allocation for terminal shells
    agent-spawner.ts        -- AI agent process spawning
    remote-spawner.ts       -- SSH remote process spawning
  runners/
    shell-runner.ts         -- Interactive shell session management
    agent-runner.ts         -- Agent process lifecycle
    batch-runner.ts         -- Batch execution runner
  handlers/
    stdout-handler.ts       -- Raw stdout processing
    stderr-handler.ts       -- Error stream handling
    exit-handler.ts         -- Process exit code interpretation
    signal-handler.ts       -- Signal forwarding (SIGTERM, SIGINT, etc.)
  utils/
    buffer-manager.ts       -- DataBufferManager implementation
    env-resolver.ts         -- Environment variable resolution
    path-resolver.ts        -- Executable path resolution
    platform-utils.ts       -- Platform-specific behaviors
```

### 3.2 PTY Spawning (Terminals)

Terminal shells are spawned using `node-pty`, which allocates a real
pseudo-terminal. This provides full terminal emulation including ANSI escape
codes, cursor positioning, and interactive program support.

```typescript
interface PtySpawnOptions {
  shell: string;           // e.g., '/bin/zsh', 'powershell.exe'
  cwd: string;             // Working directory
  env: Record<string, string>;  // Environment variables
  cols: number;            // Terminal columns
  rows: number;            // Terminal rows
}

class PtySpawner {
  spawn(options: PtySpawnOptions): ManagedProcess {
    const pty = nodePty.spawn(options.shell, [], {
      name: 'xterm-256color',
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
    });

    return new ManagedProcess(pty, 'pty');
  }
}
```

### 3.3 Agent Process Spawning

AI agent subprocesses use Node.js `child_process.spawn()` rather than PTY.
This is intentional: agent processes produce structured output (JSON lines)
rather than terminal-formatted text, and do not need terminal emulation.

```typescript
class AgentSpawner {
  spawn(config: AgentConfig, sessionId: string): ManagedProcess {
    const child = spawn(config.executable, config.args, {
      cwd: config.workingDirectory,
      env: {
        ...process.env,
        ...config.env,
        MAESTRO_SESSION_ID: sessionId,
        MAESTRO_AGENT_ID: config.id,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return new ManagedProcess(child, 'agent');
  }
}
```

### 3.4 Three-Layer Error Detection

The Process Manager implements three layers of error detection to maximize
reliability:

**Layer 1: Exit Code Analysis**
```typescript
function interpretExitCode(code: number | null, signal: string | null): ProcessExitReason {
  if (signal === 'SIGTERM') return 'terminated';
  if (signal === 'SIGKILL') return 'killed';
  if (code === 0) return 'success';
  if (code === 1) return 'general-error';
  if (code === 127) return 'command-not-found';
  if (code === 126) return 'permission-denied';
  if (code !== null && code > 128) return 'signal';
  return 'unknown';
}
```

**Layer 2: Stderr Pattern Matching**
```typescript
const ERROR_PATTERNS = [
  { pattern: /ENOENT/, type: 'file-not-found' },
  { pattern: /EACCES/, type: 'permission-denied' },
  { pattern: /ETIMEDOUT/, type: 'timeout' },
  { pattern: /rate.?limit/i, type: 'rate-limited' },
  { pattern: /authentication/i, type: 'auth-error' },
  { pattern: /out of memory/i, type: 'oom' },
];
```

**Layer 3: Heartbeat Monitoring**
For long-running agent processes, a heartbeat mechanism detects stuck processes:

```typescript
class HeartbeatMonitor {
  private lastActivity: number = Date.now();
  private readonly timeout: number = 120_000; // 2 minutes

  recordActivity(): void {
    this.lastActivity = Date.now();
  }

  isStale(): boolean {
    return Date.now() - this.lastActivity > this.timeout;
  }
}
```

### 3.5 Output Pipeline

The output pipeline processes raw stdout from child processes through a
multi-stage chain before emitting events to the renderer:

```
stdout (raw bytes)
  -> StdoutHandler (decoding, line splitting)
    -> DataBufferManager (batching: 50ms window OR 8KB threshold)
      -> IPC emit to renderer (webContents.send)
```

#### DataBufferManager

The DataBufferManager is a critical performance component. Without it, a fast-
producing process (e.g., `cat` on a large file) would flood the IPC channel
with thousands of tiny messages per second, causing UI jank.

```typescript
class DataBufferManager {
  private buffer: string = '';
  private timer: NodeJS.Timeout | null = null;

  private readonly FLUSH_INTERVAL_MS = 50;
  private readonly FLUSH_SIZE_BYTES = 8192; // 8KB

  append(data: string): void {
    this.buffer += data;

    if (Buffer.byteLength(this.buffer) >= this.FLUSH_SIZE_BYTES) {
      this.flush();
      return;
    }

    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.FLUSH_INTERVAL_MS);
    }
  }

  private flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.buffer.length > 0) {
      this.emit('data', this.buffer);
      this.buffer = '';
    }
  }
}
```

The dual-threshold approach ensures:
- **Low-latency for interactive use**: The 50ms timer ensures keystrokes and
  small outputs appear promptly.
- **High-throughput for bulk output**: The 8KB size threshold batches large
  outputs efficiently without waiting for the timer.

---

## 4. Layer Stack System

The Layer Stack is Maestro's centralized modal and overlay management system.
It solves the common problem of z-index conflicts and focus trapping in
applications with many overlapping UI elements.

### 4.1 Priority Range Architecture

Every modal, overlay, panel, and dialog in Maestro is assigned a priority
from the `modalPriorities.ts` file. Priorities determine stacking order and
focus behavior.

```
Priority Range    Category           Examples
---------------------------------------------------------------------------
1 - 99            Search             CommandPalette, GlobalSearch,
                                     FileSearch, SymbolSearch
100 - 399         Overlays           SettingsOverlay, ProjectFolders,
                                     PromptLibrary, KnowledgeGraph,
                                     Marketplace, GroupChatSetup
400 - 699         Information        UsageDashboard, DocumentGraph,
                                     Leaderboard, AuditResults,
                                     SessionReconstruction
700 - 899         Standard Modals    ConfirmDialog, RenameDialog,
                                     ExportDialog, ImportDialog,
                                     AgentConfigEditor, ThemePicker
900 - 999         High Priority      ErrorModal, UpdateAvailable,
                                     LicenseExpired, CriticalWarning
1000+             Critical           CrashRecovery, DataLoss,
                                     ForceUpdate, SecurityAlert
```

### 4.2 Layer Stack Manager

```typescript
interface LayerEntry {
  id: string;
  priority: number;
  component: React.ComponentType;
  props: Record<string, unknown>;
  onClose: () => void;
  trapFocus: boolean;
  closeOnEscape: boolean;
  closeOnBackdrop: boolean;
}

class LayerStackManager {
  private stack: LayerEntry[] = [];

  push(entry: LayerEntry): void {
    this.stack.push(entry);
    this.stack.sort((a, b) => a.priority - b.priority);
    this.notifyListeners();
  }

  pop(id: string): void {
    this.stack = this.stack.filter(e => e.id !== id);
    this.notifyListeners();
  }

  getTopLayer(): LayerEntry | undefined {
    return this.stack[this.stack.length - 1];
  }

  isTopLayer(id: string): boolean {
    return this.getTopLayer()?.id === id;
  }
}
```

### 4.3 modalPriorities.ts

The `modalPriorities.ts` file contains approximately **55 entries** that define
the priority for every layer-managed component in the application:

```typescript
export const modalPriorities = {
  // Search (1-99)
  commandPalette: 10,
  globalSearch: 20,
  fileSearch: 30,
  symbolSearch: 40,
  gotoLine: 50,

  // Overlays (100-399)
  settingsOverlay: 100,
  projectFoldersOverlay: 110,
  promptLibraryOverlay: 120,
  knowledgeGraphOverlay: 130,
  marketplaceOverlay: 140,
  groupChatSetup: 150,
  agentConfigOverlay: 160,
  sessionManagerOverlay: 170,
  gitOverlay: 180,
  webInterfaceOverlay: 190,
  tunnelConfigOverlay: 200,
  syncConfigOverlay: 210,
  cliConfigOverlay: 220,
  autorunConfigOverlay: 230,
  playbookEditorOverlay: 240,
  feedbackOverlay: 250,

  // Information (400-699)
  usageDashboard: 400,
  documentGraph: 410,
  leaderboard: 420,
  auditResults: 430,
  sessionReconstruction: 440,
  achievementUnlocked: 450,
  historyBrowser: 460,
  statsExport: 470,

  // Standard Modals (700-899)
  confirmDialog: 700,
  renameDialog: 710,
  deleteConfirm: 720,
  exportDialog: 730,
  importDialog: 740,
  agentConfigEditor: 750,
  themePicker: 760,
  fontPicker: 770,
  shortcutEditor: 780,
  templateEditor: 790,
  contextViewer: 800,

  // High Priority (900-999)
  errorModal: 900,
  updateAvailable: 910,
  licenseExpired: 920,
  criticalWarning: 930,
  connectionLost: 940,
  sessionRecovery: 950,

  // Critical (1000+)
  crashRecovery: 1000,
  dataLossWarning: 1010,
  forceUpdate: 1020,
  securityAlert: 1030,
} as const;
```

### 4.4 Focus Management

When a layer is the top-most entry and has `trapFocus: true`, keyboard
focus is constrained within that layer. Tab and Shift+Tab cycle through
focusable elements within the layer boundary. Escape handling respects
the `closeOnEscape` flag and always targets the top-most layer first.

---

## 5. Custom Hooks

Maestro employs **98 custom React hooks** organized across **12 directories**
by functional domain. These hooks encapsulate reusable stateful logic, IPC
interactions, and domain-specific behaviors.

### 5.1 Hook Directory Structure

```
hooks/
  agent/           -- 15 hooks for AI agent interaction
  batch/           -- 16 hooks for batch/autorun operations
  session/         -- 8 hooks for session management
  input/           -- 5 hooks for input handling
  props/           -- 3 hooks for prop computation
  keyboard/        -- 4 hooks for keyboard shortcuts
  settings/        -- 3 hooks for settings access
  git/             -- 2 hooks for Git operations
  remote/          -- 6 hooks for SSH remote
  ui/              -- 10 hooks for UI state
  utils/           -- 3 hooks for general utilities
  prompt-library/  -- 1 hook for prompt library
  (root level)     -- 3 hooks (useApp, useTheme, useAuth)
```

### 5.2 Agent Hooks (15)

| Hook | Purpose |
|------|---------|
| `useAgentSession` | Manages a single agent conversation session lifecycle |
| `useAgentMessages` | Message history with optimistic updates |
| `useAgentStatus` | Real-time agent status (idle, thinking, responding, error) |
| `useAgentConfig` | Agent configuration loading and editing |
| `useAgentList` | Enumeration of available agent configurations |
| `useAgentError` | Error state management with auto-clear on success |
| `useAgentStreaming` | Streaming response handling with partial message assembly |
| `useAgentCancel` | Cancellation of in-flight requests |
| `useAgentUsage` | Token usage tracking for current session |
| `useAgentContext` | Context window state and grooming triggers |
| `useAgentWizard` | First-run wizard state for agent setup |
| `useAgentRating` | Response quality rating interface |
| `useAgentHistory` | Cross-session agent history browsing |
| `useAgentExport` | Session export to various formats |
| `useAgentRetry` | Failed message retry with backoff |

### 5.3 Batch/Autorun Hooks (16)

| Hook | Purpose |
|------|---------|
| `useBatchProcessor` | Core batch orchestration (2076 lines) |
| `useBatchState` | Batch state machine subscription |
| `useBatchProgress` | Progress tracking with ETA estimation |
| `useBatchResults` | Result aggregation and display |
| `useBatchConfig` | Batch configuration management |
| `useBatchQueue` | Queue management for pending items |
| `useAutorunTrigger` | Auto-run trigger configuration |
| `useAutorunSchedule` | Scheduled execution management |
| `useAutorunHistory` | Execution history for auto-runs |
| `usePlaybook` | Single playbook loading and execution |
| `usePlaybookList` | Playbook enumeration and search |
| `usePlaybookEditor` | Playbook editing with validation |
| `useWorktree` | Git worktree management for isolation |
| `useLoopExecution` | Loop/repeat execution support |
| `useDocumentPolling` | Document change polling (10-15s interval) |
| `useBatchRecovery` | Batch execution recovery after failure |

### 5.4 Session Hooks (8)

| Hook | Purpose |
|------|---------|
| `useSession` | Current session state and operations |
| `useSessionList` | Session enumeration with filtering |
| `useSessionCreate` | Session creation with defaults |
| `useSessionNavigation` | Back/forward navigation between sessions |
| `useSessionTabs` | Multi-tab management within sessions |
| `useSessionExport` | Session export functionality |
| `useSessionImport` | Session import with validation |
| `useSessionRecovery` | Crash recovery for active sessions |

### 5.5 Input Hooks (5)

| Hook | Purpose |
|------|---------|
| `useInputHistory` | Input history with up/down arrow navigation |
| `useInputCompletion` | Tab completion for commands and paths |
| `useInputValidation` | Real-time input validation |
| `useInputResize` | Auto-resizing textarea management |
| `useInputFocus` | Focus management across input elements |

### 5.6 Props Hooks (3)

| Hook | Purpose |
|------|---------|
| `useComputedProps` | Memoized derived props computation |
| `usePropsDiff` | Prop change detection for debugging |
| `usePropsValidation` | Runtime prop type validation (dev mode) |

### 5.7 Keyboard Hooks (4)

| Hook | Purpose |
|------|---------|
| `useKeyboardShortcuts` | Global keyboard shortcut registration |
| `useKeyboardNavigation` | Arrow key navigation in lists |
| `useKeySequence` | Multi-key sequence detection (e.g., `gg`, `dd`) |
| `useKeyboardMastery` | Keyboard usage tracking for achievements |

### 5.8 Settings Hooks (3)

| Hook | Purpose |
|------|---------|
| `useSettings` | Settings read/write with reactivity |
| `useSettingsSync` | Sync status and conflict resolution |
| `useSettingsMigration` | Settings schema migration |

### 5.9 Git Hooks (2)

| Hook | Purpose |
|------|---------|
| `useGitStatus` | Real-time Git status with polling |
| `useGitBranch` | Branch management operations |

### 5.10 Remote Hooks (6)

| Hook | Purpose |
|------|---------|
| `useRemoteConnection` | SSH connection lifecycle |
| `useRemoteFileSystem` | Remote filesystem operations |
| `useRemoteProcess` | Remote process spawning |
| `useRemoteSync` | File synchronization with remote |
| `useRemoteStatus` | Connection health monitoring |
| `useRemoteConfig` | Remote host configuration |

### 5.11 UI Hooks (10)

| Hook | Purpose |
|------|---------|
| `useLayerStack` | Layer stack interaction |
| `useToast` | Toast notification management |
| `useContextMenu` | Right-click context menu |
| `useResize` | Resizable panel management |
| `useDragDrop` | Drag and drop behavior |
| `useVirtualScroll` | Virtualized list scrolling |
| `useClipboard` | System clipboard interaction |
| `useMediaQuery` | Responsive breakpoint detection |
| `useAnimation` | Animation state management |
| `useScrollPosition` | Scroll position tracking and restoration |

### 5.12 Utils Hooks (3)

| Hook | Purpose |
|------|---------|
| `useDebounce` | Debounced value updates |
| `useThrottle` | Throttled callback execution |
| `usePrevious` | Previous render value retention |

### 5.13 Prompt Library Hook (1)

| Hook | Purpose |
|------|---------|
| `usePromptLibrary` | Prompt CRUD with search and categorization |

### 5.14 Root-Level Hooks (3)

| Hook | Purpose |
|------|---------|
| `useApp` | Application-level state and lifecycle |
| `useTheme` | Theme state and switching |
| `useAuth` | Authentication state for web/remote features |

---

## 6. Services Layer

The Services Layer provides abstracted interfaces to complex subsystems,
shielding components and hooks from implementation details.

### 6.1 Git Service

The Git Service wraps all Git operations behind a clean async API. It handles:

- **Command construction**: Building git command-line arguments safely
- **Output parsing**: Parsing porcelain and machine-readable Git output formats
- **Error normalization**: Converting Git error messages into typed errors
- **Worktree management**: Creating and managing Git worktrees for isolation

```typescript
class GitService {
  async getStatus(cwd: string): Promise<GitStatus> {
    const raw = await this.exec(['status', '--porcelain=v2', '--branch'], cwd);
    return parseGitStatus(raw);
  }

  async getDiff(cwd: string, options?: DiffOptions): Promise<GitDiff> {
    const args = ['diff'];
    if (options?.staged) args.push('--staged');
    if (options?.file) args.push('--', options.file);
    const raw = await this.exec(args, cwd);
    return parseGitDiff(raw);
  }

  async worktreeAdd(cwd: string, path: string, branch: string): Promise<void> {
    await this.exec(['worktree', 'add', path, branch], cwd);
  }

  async worktreeList(cwd: string): Promise<GitWorktree[]> {
    const raw = await this.exec(['worktree', 'list', '--porcelain'], cwd);
    return parseWorktreeList(raw);
  }
}
```

### 6.2 Process Service

The Process Service is the high-level interface to the Process Manager
(Section 3). It provides:

- Process lifecycle management (spawn, kill, resize)
- Event subscription and forwarding to renderer
- Process health monitoring
- Resource cleanup on window close

### 6.3 Context Groomer

The Context Groomer manages the AI context window to prevent overflow.
When the context approaches the model's token limit, the groomer:

1. Identifies low-value messages (old, system-generated, redundant)
2. Summarizes sequences of messages into condensed representations
3. Removes or collapses messages while preserving coherence
4. Maintains a minimum set of recent messages for continuity

```typescript
interface GroomingStrategy {
  maxTokens: number;
  reserveTokens: number;      // Reserved for next response
  minRecentMessages: number;   // Always keep this many recent messages
  summarizeThreshold: number;  // Summarize when above this ratio
}

class ContextGroomer {
  async groom(
    messages: Message[],
    strategy: GroomingStrategy
  ): Promise<GroomedContext> {
    const currentTokens = await this.countTokens(messages);

    if (currentTokens < strategy.maxTokens * strategy.summarizeThreshold) {
      return { messages, wasTrimmed: false };
    }

    const recent = messages.slice(-strategy.minRecentMessages);
    const older = messages.slice(0, -strategy.minRecentMessages);
    const summary = await this.summarize(older);

    return {
      messages: [summary, ...recent],
      wasTrimmed: true,
      removedCount: older.length,
      summarizedTokens: await this.countTokens([summary]),
    };
  }
}
```

### 6.4 Context Summarizer

The Context Summarizer generates condensed representations of message
sequences. It uses the configured AI agent to produce summaries, with
fallback to extractive summarization if the agent is unavailable.

### 6.5 IPC Wrapper with 30s Cache

The IPC Wrapper provides a caching layer for frequently-read IPC calls.
This reduces IPC round-trips for data that changes infrequently (e.g.,
system fonts, shell list, app version).

```typescript
class IpcCache {
  private cache = new Map<string, { value: unknown; expires: number }>();
  private readonly TTL_MS = 30_000; // 30 seconds

  async invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    const key = `${channel}:${JSON.stringify(args)}`;
    const cached = this.cache.get(key);

    if (cached && cached.expires > Date.now()) {
      return cached.value as T;
    }

    const result = await ipcRenderer.invoke(channel, ...args);
    this.cache.set(key, { value: result, expires: Date.now() + this.TTL_MS });
    return result;
  }

  invalidate(channel?: string): void {
    if (channel) {
      for (const key of this.cache.keys()) {
        if (key.startsWith(channel)) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.clear();
    }
  }
}
```

---

## 7. Custom AI Commands

Maestro provides two systems for extending AI capabilities with structured
command interfaces: **Spec-Kit** and **OpenSpec**.

### 7.1 Spec-Kit

Spec-Kit is a template-based code generation system. Users define specification
templates that describe desired output structures, and the AI agent generates
code conforming to those specifications.

```typescript
interface SpecKitTemplate {
  id: string;
  name: string;
  description: string;
  version: string;
  schema: {
    inputs: SpecKitInput[];
    outputs: SpecKitOutput[];
    constraints: string[];
  };
  prompt: string;  // Template with {{variable}} placeholders
}

interface SpecKitInput {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'file' | 'directory';
  description: string;
  required: boolean;
  default?: unknown;
}

interface SpecKitOutput {
  name: string;
  type: 'file' | 'directory' | 'stdout';
  path?: string;
  description: string;
}
```

**Workflow**:
1. User selects a Spec-Kit template
2. Template inputs are presented as a form
3. User fills in inputs; template variables are resolved
4. The resolved prompt is sent to the agent
5. Agent output is validated against the output schema
6. Generated files are written to the specified paths

### 7.2 OpenSpec

OpenSpec is a declarative specification format for defining complex AI
workflows. Unlike Spec-Kit's single-prompt approach, OpenSpec supports
multi-step execution with conditional logic.

```typescript
interface OpenSpec {
  version: '1.0';
  name: string;
  description: string;
  steps: OpenSpecStep[];
  variables: Record<string, OpenSpecVariable>;
}

interface OpenSpecStep {
  id: string;
  type: 'prompt' | 'validate' | 'transform' | 'condition';
  prompt?: string;
  validation?: OpenSpecValidation;
  transform?: OpenSpecTransform;
  condition?: {
    if: string;    // Expression
    then: string;  // Step ID
    else: string;  // Step ID
  };
  dependsOn?: string[];  // Step IDs
}
```

---

## 8. Theme System

Maestro's theme system supports **17 built-in themes** with user customization
capabilities.

### 8.1 Theme Categories

| Category | Count | Themes |
|----------|-------|--------|
| Dark | 6 | Default Dark, Midnight, Dracula, Nord Dark, Solarized Dark, Monokai |
| Light | 6 | Default Light, Paper, Solarized Light, Nord Light, GitHub Light, Sepia |
| Vibes | 4 | Synthwave, Cyberpunk, Forest, Ocean |
| Custom | 1 | User-defined theme |

### 8.2 ThemeMode

```typescript
type ThemeMode = 'light' | 'dark' | 'vibe';
```

The application stores separate theme selections for light and dark modes,
plus an optional vibe theme:

```typescript
interface ThemeSettings {
  mode: ThemeMode;
  lightThemeId: string;    // Used when mode === 'light' or system prefers light
  darkThemeId: string;     // Used when mode === 'dark' or system prefers dark
  vibeThemeId?: string;    // Used when mode === 'vibe'
  systemSync: boolean;     // Sync with OS dark/light preference
}
```

When `systemSync` is enabled, Maestro listens to `prefers-color-scheme` media
query changes and automatically switches between `lightThemeId` and
`darkThemeId` based on the operating system's appearance setting.

### 8.3 ThemeColors Interface

Each theme defines **14 color properties** through the `ThemeColors` interface:

```typescript
interface ThemeColors {
  // Backgrounds
  bgPrimary: string;       // Main background
  bgSecondary: string;     // Secondary/sidebar background
  bgTertiary: string;      // Tertiary/card background
  bgAccent: string;        // Accent background (selections, highlights)

  // Text
  textPrimary: string;     // Primary text color
  textSecondary: string;   // Secondary/muted text
  textAccent: string;      // Accent text (links, highlights)

  // Borders
  borderPrimary: string;   // Primary border color
  borderAccent: string;    // Accent border color

  // Semantic
  success: string;         // Success/positive color
  warning: string;         // Warning color
  error: string;           // Error/destructive color
  info: string;            // Informational color

  // Interactive
  interactive: string;     // Primary interactive element color
}
```

### 8.4 Theme Propagation (Prop Drilling)

**Important architectural decision**: The theme is propagated via **prop
drilling**, not React Context. This is intentional.

Rationale:
- **Explicitness**: Every component that uses theme colors receives them as
  explicit props, making data flow traceable.
- **Performance**: Avoids Context-triggered re-renders across the entire tree
  when the theme changes. Only components that receive the theme prop re-render.
- **Testing**: Components are easier to test in isolation when theme is a prop
  rather than requiring a Context provider wrapper.

```typescript
// Theme flows down from the root
function App() {
  const theme = useTheme();
  return (
    <MainLayout theme={theme}>
      <Sidebar theme={theme} />
      <Content theme={theme}>
        <ChatPanel theme={theme} />
        <Terminal theme={theme} />
      </Content>
    </MainLayout>
  );
}
```

### 8.5 CSS Variable Integration

Theme colors are also mapped to CSS custom properties for use in Tailwind
utilities and plain CSS:

```typescript
function applyThemeToCss(theme: ThemeColors): void {
  const root = document.documentElement;
  root.style.setProperty('--bg-primary', theme.bgPrimary);
  root.style.setProperty('--bg-secondary', theme.bgSecondary);
  root.style.setProperty('--bg-tertiary', theme.bgTertiary);
  root.style.setProperty('--bg-accent', theme.bgAccent);
  root.style.setProperty('--text-primary', theme.textPrimary);
  root.style.setProperty('--text-secondary', theme.textSecondary);
  root.style.setProperty('--text-accent', theme.textAccent);
  root.style.setProperty('--border-primary', theme.borderPrimary);
  root.style.setProperty('--border-accent', theme.borderAccent);
  root.style.setProperty('--success', theme.success);
  root.style.setProperty('--warning', theme.warning);
  root.style.setProperty('--error', theme.error);
  root.style.setProperty('--info', theme.info);
  root.style.setProperty('--interactive', theme.interactive);
}
```

---

## 9. Settings Persistence

Maestro uses **10 separate `electron-store` instances** to persist application
state. Each store has its own file, schema, and migration logic.

### 9.1 Store Inventory

| Store Name | File | Purpose |
|------------|------|---------|
| `maestro-bootstrap` | `maestro-bootstrap.json` | First-run flags, installation ID, telemetry consent |
| `maestro-settings` | `maestro-settings.json` | User preferences (theme, font, keybindings, editor config) |
| `maestro-sessions` | `maestro-sessions.json` | Session metadata (not content -- content is in agent storage) |
| `maestro-groups` | `maestro-groups.json` | Session group definitions and ordering |
| `maestro-project-folders` | `maestro-project-folders.json` | Project folder configuration and group associations |
| `maestro-agent-configs` | `maestro-agent-configs.json` | AI agent configurations (models, API keys, parameters) |
| `maestro-window-state` | `maestro-window-state.json` | Window position, size, maximized state, display |
| `maestro-claude-session-origins` | `maestro-claude-session-origins.json` | Legacy Claude session origin tracking |
| `maestro-agent-session-origins` | `maestro-agent-session-origins.json` | Agent session origin mapping |
| `maestro-model-registry` | `maestro-model-registry.json` | Claude model pricing, aliases, and metadata (runtime-updateable) |

### 9.2 Store Configuration

```typescript
interface StoreOptions<T> {
  name: string;
  defaults: T;
  schema?: JSONSchema;
  migrations?: Record<string, (store: Store<T>) => void>;
  encryptionKey?: string;  // Used for API key storage
  watch?: boolean;         // Enable file watching for sync
  cwd?: string;            // Custom storage directory
}
```

### 9.3 Sync Path Support

When settings sync is enabled, stores can be configured to read/write from
a shared directory (e.g., Dropbox, iCloud Drive, or a custom sync folder):

```typescript
class SyncableStore<T> extends Store<T> {
  private syncPath: string | null = null;

  enableSync(syncPath: string): void {
    this.syncPath = syncPath;
    // Copy current data to sync location
    fs.copyFileSync(this.path, path.join(syncPath, this.name + '.json'));
    // Watch sync location for changes from other machines
    this.watcher = fs.watch(path.join(syncPath, this.name + '.json'), () => {
      this.reloadFromSync();
    });
  }

  private reloadFromSync(): void {
    const syncData = JSON.parse(
      fs.readFileSync(path.join(this.syncPath!, this.name + '.json'), 'utf-8')
    );
    // Merge strategy: last-write-wins with timestamp comparison
    const merged = this.mergeWithTimestamps(this.store, syncData);
    this.store = merged;
    this.emit('sync', merged);
  }
}
```

### 9.4 Encryption

The `maestro-agent-configs` store uses `electron-store`'s built-in encryption
for API keys. The encryption key is derived from the machine ID using the
`safeStorage` API when available, falling back to a hardcoded key (with a
warning in logs).

---

## 10. Agent Sessions API

The `agentSessions` namespace is the primary API for AI agent conversations.
It replaces the deprecated `claude` namespace and supports multiple AI
provider backends.

### 10.1 API Surface

```typescript
interface AgentSessionsAPI {
  // Lifecycle
  create(config: AgentSessionConfig): Promise<AgentSessionId>;
  destroy(sessionId: AgentSessionId): Promise<void>;

  // Communication
  send(sessionId: AgentSessionId, message: AgentMessage): Promise<void>;
  cancel(sessionId: AgentSessionId): Promise<void>;

  // History
  getHistory(sessionId: AgentSessionId): Promise<AgentMessage[]>;
  clearHistory(sessionId: AgentSessionId): Promise<void>;

  // Events
  onMessage(sessionId: AgentSessionId, cb: MessageCallback): Unsubscribe;
  onStatus(sessionId: AgentSessionId, cb: StatusCallback): Unsubscribe;
  onError(sessionId: AgentSessionId, cb: ErrorCallback): Unsubscribe;

  // Storage
  getStorageInfo(sessionId: AgentSessionId): Promise<StorageInfo>;
}
```

### 10.2 Storage Implementations

Three storage backends exist to support different agent types:

#### ClaudeSessionStorage (JSONL)

The default storage for Claude/Anthropic sessions. Messages are stored as
newline-delimited JSON (JSONL), one message per line:

```typescript
class ClaudeSessionStorage implements SessionStorage {
  private filePath: string;

  async append(message: AgentMessage): Promise<void> {
    const line = JSON.stringify(message) + '\n';
    await fs.appendFile(this.filePath, line, 'utf-8');
  }

  async readAll(): Promise<AgentMessage[]> {
    const content = await fs.readFile(this.filePath, 'utf-8');
    return content
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
  }

  async getStorageInfo(): Promise<StorageInfo> {
    const stat = await fs.stat(this.filePath);
    return {
      format: 'jsonl',
      sizeBytes: stat.size,
      messageCount: (await this.readAll()).length,
      path: this.filePath,
    };
  }
}
```

#### CodexSessionStorage (Dual JSONL)

Codex sessions use a dual-file JSONL format. One file stores user messages,
another stores agent responses. This supports Codex's specific replay
requirements:

```typescript
class CodexSessionStorage implements SessionStorage {
  private userPath: string;
  private agentPath: string;

  async append(message: AgentMessage): Promise<void> {
    const target = message.role === 'user' ? this.userPath : this.agentPath;
    const line = JSON.stringify(message) + '\n';
    await fs.appendFile(target, line, 'utf-8');
  }

  async readAll(): Promise<AgentMessage[]> {
    const users = await this.readFile(this.userPath);
    const agents = await this.readFile(this.agentPath);
    return this.interleave(users, agents);
  }

  private interleave(users: AgentMessage[], agents: AgentMessage[]): AgentMessage[] {
    const all = [...users, ...agents];
    return all.sort((a, b) => a.timestamp - b.timestamp);
  }
}
```

#### OpenCodeSessionStorage (Individual JSON)

OpenCode sessions store each message as a separate JSON file in a directory.
This supports OpenCode's file-per-message architecture:

```typescript
class OpenCodeSessionStorage implements SessionStorage {
  private dirPath: string;

  async append(message: AgentMessage): Promise<void> {
    const filename = `${message.timestamp}_${message.role}.json`;
    const filePath = path.join(this.dirPath, filename);
    await fs.writeFile(filePath, JSON.stringify(message, null, 2), 'utf-8');
  }

  async readAll(): Promise<AgentMessage[]> {
    const files = await fs.readdir(this.dirPath);
    const messages: AgentMessage[] = [];

    for (const file of files.sort()) {
      if (file.endsWith('.json')) {
        const content = await fs.readFile(path.join(this.dirPath, file), 'utf-8');
        messages.push(JSON.parse(content));
      }
    }

    return messages;
  }
}
```

---

## 11. Auto Run System

The Auto Run system provides batch orchestration for executing sequences of
AI agent prompts across one or more sessions, with optional Git worktree
isolation.

### 11.1 State Machine

The Auto Run state machine governs the lifecycle of batch execution:

```
                     +----------------+
                     |                |
           start()   |     IDLE       |<---+
          +--------->|                |    |
          |          +-------+--------+    |
          |                  |             |
          |            INITIALIZING        |
          |                  |             |
          |                  v             |
          |          +-------+--------+    |
          |          |                |    |
          |          |    RUNNING     +----+ complete()
          |          |                |    |
          |          +---+------+-----+    |
          |              |      |          |
          |        error |      | pause()  |
          |              v      v          |
          |     +--------+-+ +--+-------+  |
          |     |          | |          |  |
          |     | PAUSED_  | | COMPLETING  |
          |     | ERROR    | |          +--+
          |     |          | +----------+
          |     +----+-----+
          |          |
          |    stop() |
          |          v
          |   +------+-------+
          |   |              |
          +---+   STOPPING   |
              |              |
              +--------------+
```

**States**:
- `IDLE`: No batch execution in progress
- `INITIALIZING`: Setting up worktrees, validating configuration
- `RUNNING`: Actively processing batch items
- `COMPLETING`: Finalizing results, cleaning up worktrees
- `PAUSED_ERROR`: Paused due to an error, awaiting user decision
- `STOPPING`: User-initiated stop, cleaning up

**Action Types (18)**:
```typescript
type BatchAction =
  | { type: 'START'; payload: BatchConfig }
  | { type: 'INITIALIZE_COMPLETE' }
  | { type: 'INITIALIZE_ERROR'; payload: Error }
  | { type: 'PROCESS_NEXT' }
  | { type: 'ITEM_START'; payload: { index: number } }
  | { type: 'ITEM_PROGRESS'; payload: { index: number; progress: number } }
  | { type: 'ITEM_COMPLETE'; payload: { index: number; result: BatchItemResult } }
  | { type: 'ITEM_ERROR'; payload: { index: number; error: Error } }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'STOP' }
  | { type: 'STOP_COMPLETE' }
  | { type: 'COMPLETE' }
  | { type: 'RETRY_ITEM'; payload: { index: number } }
  | { type: 'SKIP_ITEM'; payload: { index: number } }
  | { type: 'WORKTREE_CREATED'; payload: { path: string } }
  | { type: 'WORKTREE_CLEANUP' }
  | { type: 'LOOP_ITERATION'; payload: { iteration: number } };
```

### 11.2 Worktree Integration

When batch execution requires isolation (e.g., running multiple prompts that
may modify the same files), the Auto Run system creates Git worktrees:

```typescript
async function setupWorktree(config: BatchConfig): Promise<WorktreeInfo> {
  const branchName = `maestro/autorun/${Date.now()}`;
  const worktreePath = path.join(config.cwd, '.maestro-worktrees', branchName);

  await gitService.worktreeAdd(config.cwd, worktreePath, branchName);

  return {
    path: worktreePath,
    branch: branchName,
    cleanup: async () => {
      await gitService.worktreeRemove(config.cwd, worktreePath);
    },
  };
}
```

### 11.3 Playbooks

Playbooks are reusable batch execution configurations:

```typescript
interface Playbook {
  id: string;
  name: string;
  description: string;
  steps: PlaybookStep[];
  variables: Record<string, PlaybookVariable>;
  options: {
    useWorktree: boolean;
    continueOnError: boolean;
    maxRetries: number;
    loopCount?: number;
  };
}

interface PlaybookStep {
  id: string;
  prompt: string;           // May contain {{variables}}
  agentConfig?: string;     // Override agent config for this step
  timeout?: number;
  validation?: string;      // Validation expression
  dependsOn?: string[];     // Step IDs
}
```

### 11.4 Loop Support

The Auto Run system supports repeating batch execution in a loop:

```typescript
interface LoopConfig {
  count: number;            // Number of iterations (0 = infinite)
  delayMs: number;          // Delay between iterations
  stopOnError: boolean;     // Stop looping on first error
  aggregateResults: boolean; // Combine results across iterations
}
```

### 11.5 Document Polling

During batch execution, the system polls for document changes at
10-15 second intervals. This allows the UI to reflect file changes
made by the agent in near-real-time:

```typescript
class DocumentPoller {
  private interval: NodeJS.Timeout | null = null;
  private readonly MIN_INTERVAL_MS = 10_000;
  private readonly MAX_INTERVAL_MS = 15_000;

  start(cwd: string, onChange: (changes: FileChange[]) => void): void {
    const poll = async () => {
      const changes = await this.detectChanges(cwd);
      if (changes.length > 0) {
        onChange(changes);
      }
      const nextInterval = this.MIN_INTERVAL_MS +
        Math.random() * (this.MAX_INTERVAL_MS - this.MIN_INTERVAL_MS);
      this.interval = setTimeout(poll, nextInterval);
    };
    poll();
  }

  stop(): void {
    if (this.interval) {
      clearTimeout(this.interval);
      this.interval = null;
    }
  }
}
```

### 11.6 useBatchProcessor

The `useBatchProcessor` hook is the largest single hook in the codebase at
**2076 lines**. It encapsulates the entire batch orchestration logic including:

- State machine management
- Worktree setup/teardown
- Sequential and parallel item processing
- Error handling with retry/skip
- Progress tracking and ETA estimation
- Result aggregation
- Loop iteration management
- Playbook variable resolution
- Document polling coordination
- IPC event forwarding

---

## 12. Achievement System

Maestro includes a gamification layer that tracks user proficiency and awards
badges based on usage patterns.

### 12.1 Badge Hierarchy (11 Levels)

```typescript
const BADGE_LEVELS = [
  { level: 1,  name: 'Apprentice',          threshold: 0 },
  { level: 2,  name: 'Journeyman',          threshold: 100 },
  { level: 3,  name: 'Practitioner',        threshold: 500 },
  { level: 4,  name: 'Skilled Artisan',     threshold: 1500 },
  { level: 5,  name: 'Expert',              threshold: 4000 },
  { level: 6,  name: 'Master',              threshold: 8000 },
  { level: 7,  name: 'Grand Master',        threshold: 15000 },
  { level: 8,  name: 'Virtuoso',            threshold: 25000 },
  { level: 9,  name: 'Sage',                threshold: 40000 },
  { level: 10, name: 'Transcendent Maestro', threshold: 60000 },
  { level: 11, name: 'Legendary Maestro',    threshold: 100000 },
] as const;
```

Thresholds are based on cumulative interaction points earned through:
- Sending messages to AI agents
- Completing batch runs
- Using keyboard shortcuts
- Creating and using playbooks
- Exploring features (knowledge graph, document graph, etc.)

### 12.2 Keyboard Mastery (5 Levels)

A separate progression track for keyboard shortcut proficiency:

```typescript
const KEYBOARD_MASTERY_LEVELS = [
  { level: 1, name: 'Novice',       shortcutsUsed: 0 },
  { level: 2, name: 'Familiar',     shortcutsUsed: 10 },
  { level: 3, name: 'Proficient',   shortcutsUsed: 25 },
  { level: 4, name: 'Expert',       shortcutsUsed: 50 },
  { level: 5, name: 'Keyboard Zen', shortcutsUsed: 100 },
] as const;
```

Keyboard mastery tracks unique keyboard shortcuts used (not repetitions).
Each unique shortcut discovered counts toward the next level.

---

## 13. AI Tab System

Maestro supports multiple simultaneous AI conversations within a single
session through the tab system.

### 13.1 AITab Interface

```typescript
interface AITab {
  id: string;
  sessionId: string;         // Parent session
  agentSessionId: string;    // Agent session for this tab
  name: string;              // User-visible tab name
  logs: LogEntry[];          // Conversation log entries
  usageStats: UsageStats;    // Token/cost tracking for this tab
  wizardState: WizardState;  // First-run wizard progress
  rating: TabRating | null;  // User quality rating
  createdAt: number;
  lastActiveAt: number;
  isPinned: boolean;
}

interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  totalCost: number;         // Calculated using active pricing model
  messageCount: number;
  averageResponseTime: number;
}

interface WizardState {
  completed: boolean;
  currentStep: number;
  totalSteps: number;
  skipped: boolean;
}

type TabRating = 1 | 2 | 3 | 4 | 5;
```

### 13.2 Tab Lifecycle

1. **Creation**: New tabs spawn a fresh agent session with the configured default agent
2. **Activation**: Switching tabs activates the tab's agent session and loads its logs
3. **Background**: Inactive tabs continue receiving messages (agent keeps running)
4. **Destruction**: Closing a tab destroys the agent session and cleans up storage
5. **Pinning**: Pinned tabs are protected from accidental closure

---

## 14. Execution Queue

The Execution Queue provides sequential prompt delivery to ensure ordered
processing of user inputs.

```typescript
interface QueuedItem {
  id: string;
  prompt: string;
  priority: 'normal' | 'high';
  createdAt: number;
  metadata?: Record<string, unknown>;
}

class ExecutionQueue {
  private queue: QueuedItem[] = [];
  private processing: boolean = false;

  enqueue(item: QueuedItem): void {
    if (item.priority === 'high') {
      // Insert at front of queue (after any currently processing item)
      this.queue.unshift(item);
    } else {
      this.queue.push(item);
    }
    this.processNext();
  }

  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;
    const item = this.queue.shift()!;

    try {
      await this.executeItem(item);
    } finally {
      this.processing = false;
      this.processNext(); // Continue with next item
    }
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue = [];
  }
}
```

The queue ensures that even if a user submits multiple prompts rapidly,
they are processed one at a time in order. High-priority items (e.g.,
system-generated prompts for error recovery) can jump the queue.

---

## 15. Navigation History

Maestro maintains a navigation history stack for session-to-session movement,
similar to browser back/forward navigation.

```typescript
interface NavigationState {
  backStack: NavigationEntry[];
  forwardStack: NavigationEntry[];
  current: NavigationEntry;
}

interface NavigationEntry {
  sessionId: string;
  tabId?: string;
  scrollPosition?: number;
  timestamp: number;
}

class NavigationHistory {
  private state: NavigationState;

  navigate(entry: NavigationEntry): void {
    this.state.backStack.push(this.state.current);
    this.state.current = entry;
    this.state.forwardStack = []; // Clear forward on new navigation
  }

  goBack(): NavigationEntry | null {
    if (this.state.backStack.length === 0) return null;
    this.state.forwardStack.push(this.state.current);
    this.state.current = this.state.backStack.pop()!;
    return this.state.current;
  }

  goForward(): NavigationEntry | null {
    if (this.state.forwardStack.length === 0) return null;
    this.state.backStack.push(this.state.current);
    this.state.current = this.state.forwardStack.pop()!;
    return this.state.current;
  }

  canGoBack(): boolean {
    return this.state.backStack.length > 0;
  }

  canGoForward(): boolean {
    return this.state.forwardStack.length > 0;
  }
}
```

The navigation history preserves scroll positions so that returning to a
previous session restores the user's viewport to where they left off.

---

## 16. Group Chat System

Group Chat enables multi-agent conversations where a moderator orchestrates
interactions between multiple AI agents.

### 16.1 Architecture

```
User Message
    |
    v
Moderator (non-persistent, spawned fresh per message)
    |
    +-- Analyzes message for @mentions and intent
    |
    +-- Routes to participants based on:
    |     - Explicit @mentions
    |     - Topic/expertise matching
    |     - Round-robin (if no clear target)
    |
    v
Participant Agents (parallel execution)
    |
    +-- Each agent receives:
    |     - The user message
    |     - Relevant conversation context
    |     - Their role description
    |
    v
Moderator Synthesis
    |
    +-- Collects all participant responses
    +-- Synthesizes into coherent response
    +-- Resolves conflicts between agents
    +-- Formats final response
    |
    v
User sees synthesized response
```

### 16.2 Moderator Design

The moderator is **non-persistent**: a new moderator instance is spawned for
every incoming message and destroyed after synthesis. This design choice:

- Prevents moderator state from drifting over time
- Ensures consistent routing behavior
- Avoids context accumulation in the moderator
- Simplifies error recovery (no stale moderator state)

```typescript
interface ModeratorConfig {
  model: string;
  systemPrompt: string;
  routingStrategy: 'mention' | 'topic' | 'round-robin' | 'auto';
  synthesisStyle: 'merged' | 'attributed' | 'ranked';
  maxParticipantsPerMessage: number;
}

async function moderateMessage(
  message: UserMessage,
  participants: AgentConfig[],
  config: ModeratorConfig,
  history: GroupMessage[]
): Promise<SynthesizedResponse> {
  // 1. Spawn fresh moderator
  const moderator = await spawnModerator(config);

  // 2. Determine routing
  const mentions = extractMentions(message.text); // @agent-name detection
  const targets = mentions.length > 0
    ? participants.filter(p => mentions.includes(p.name))
    : await moderator.routeMessage(message, participants);

  // 3. Fan out to participants (parallel)
  const responses = await Promise.allSettled(
    targets.map(agent =>
      sendToParticipant(agent, message, history)
    )
  );

  // 4. Synthesize
  const synthesis = await moderator.synthesize(responses, config.synthesisStyle);

  // 5. Destroy moderator
  await moderator.destroy();

  return synthesis;
}
```

### 16.3 @Mention Detection

```typescript
function extractMentions(text: string): string[] {
  const mentionRegex = /@([a-zA-Z0-9_-]+)/g;
  const mentions: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = mentionRegex.exec(text)) !== null) {
    mentions.push(match[1]);
  }

  return mentions;
}
```

### 16.4 Stale Cleanup

Group chat sessions implement a 10-minute stale detection timer. If no
messages are sent for 10 minutes, participant sessions are cleaned up to
free resources:

```typescript
class GroupChatGarbageCollector {
  private readonly STALE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

  checkStale(session: GroupChatSession): boolean {
    const lastActivity = session.lastMessageTimestamp;
    return Date.now() - lastActivity > this.STALE_TIMEOUT_MS;
  }

  async cleanup(session: GroupChatSession): Promise<void> {
    for (const participant of session.participants) {
      try {
        await participant.destroy();
      } catch (error) {
        logger.warn('Failed to cleanup participant', {
          participantId: participant.id,
          error,
        });
      }
    }
  }
}
```

### 16.5 Session Recovery

When a participant agent returns `session_not_found`, the Group Chat system
automatically recovers by spawning a new session for that participant:

```typescript
async function sendWithRecovery(
  participant: AgentSession,
  message: AgentMessage,
  retries: number = 1
): Promise<AgentMessage> {
  try {
    return await participant.send(message);
  } catch (error) {
    if (error.code === 'session_not_found' && retries > 0) {
      logger.info('Recovering participant session', { id: participant.id });
      await participant.reinitialize();
      return sendWithRecovery(participant, message, retries - 1);
    }
    throw error;
  }
}
```

---

## 17. Web/Mobile Interface

Maestro exposes a web interface for remote access from browsers and mobile
devices, built on Fastify and WebSocket.

### 17.1 Server Architecture

```
Electron Main Process
    |
    +-- Fastify HTTP Server
    |     |
    |     +-- REST API (rate-limited)
    |     |     +-- GET  /api/sessions
    |     |     +-- POST /api/sessions/:id/messages
    |     |     +-- GET  /api/status
    |     |     +-- ...
    |     |
    |     +-- Static File Server
    |     |     +-- Mobile-optimized SPA
    |     |
    |     +-- WebSocket Server
    |           +-- Real-time subscriptions
    |           +-- Bi-directional messaging
    |
    +-- Token Auth Manager
          +-- UUID token (regenerated on restart)
          +-- Token validation middleware
```

### 17.2 Authentication

The web interface uses token-based authentication. A UUID token is generated
when the server starts and regenerated on every restart:

```typescript
class WebAuthManager {
  private token: string;

  constructor() {
    this.token = crypto.randomUUID();
  }

  regenerate(): void {
    this.token = crypto.randomUUID();
  }

  validate(request: FastifyRequest): boolean {
    const header = request.headers.authorization;
    if (!header) return false;
    const [scheme, token] = header.split(' ');
    return scheme === 'Bearer' && token === this.token;
  }

  getToken(): string {
    return this.token;
  }
}
```

The token is displayed in the Maestro UI and can be shared via QR code for
easy mobile device setup.

### 17.3 Rate Limiting

REST API endpoints are rate-limited to prevent abuse:

```typescript
const rateLimitConfig = {
  global: {
    max: 100,
    timeWindow: '1 minute',
  },
  message: {
    max: 20,
    timeWindow: '1 minute',
  },
};
```

### 17.4 WebSocket Subscriptions

Clients can subscribe to real-time events via WebSocket:

```typescript
interface WebSocketMessage {
  type: 'subscribe' | 'unsubscribe' | 'message' | 'event';
  channel?: string;
  payload?: unknown;
}

// Channels:
// - session:{sessionId}:messages  -- New messages in a session
// - session:{sessionId}:status    -- Session status changes
// - agent:{agentId}:output        -- Agent output stream
// - system:notifications          -- System-level notifications
```

### 17.5 Mobile-Optimized Views

The web interface serves a mobile-optimized single-page application with:
- Responsive layout adapting to screen size
- Touch-friendly controls
- Simplified navigation
- Optimized data transfer (compressed responses)

### 17.6 Renderer as Source of Truth

All mutations from the web interface are forwarded to the Electron renderer
process, which serves as the single source of truth. The web server never
directly modifies state. Flow:

```
Mobile Client
    |
    +-- REST/WebSocket mutation request
    |
    v
Fastify Server (Main Process)
    |
    +-- Validates request
    +-- Forwards to renderer via IPC
    |
    v
Renderer Process
    |
    +-- Applies mutation (same as local UI)
    +-- State update propagates to all subscribers
    |
    v
Fastify Server
    |
    +-- Sends WebSocket events to connected clients
    +-- Returns REST response
```

---

## 18. CLI Tool

Maestro includes a command-line interface accessible via the `maestro-cli`
binary. It provides **7 commands** for headless and scripted usage.

### 18.1 Commands

```
maestro-cli <command> [options]

Commands:
  send <prompt>        Send a prompt to the active session
  sessions             List all sessions
  status               Show application status
  run <playbook>       Execute a playbook
  export <session-id>  Export a session
  config               View/edit configuration
  version              Show version information

Global Options:
  --format <json|text>  Output format (default: text)
  --quiet               Suppress non-essential output
  --token <token>       Authentication token (for remote)
  --host <host>         Remote host (default: localhost)
  --port <port>         Remote port (default: auto-detect)
```

### 18.2 IPC Communication

When run locally, the CLI communicates with the running Maestro instance
via a Unix domain socket (macOS/Linux) or named pipe (Windows). For remote
operation, it uses the HTTP REST API with token authentication.

---

## 19. Usage Dashboard

The Usage Dashboard provides comprehensive analytics on AI usage, costs,
and productivity metrics.

### 19.1 SQLite Stats Database

The stats database uses SQLite with WAL mode enabled for concurrent reads.
It has gone through **9 migrations** and contains **7 tables** (see
Section 21 for full schema).

### 19.2 Dual-Cost Model

The dashboard supports two simultaneous cost calculations:

- **Anthropic Pricing**: Direct API costs based on Anthropic's published
  token pricing, loaded from the `maestro-model-registry` store
- **Maestro Pricing**: Maestro's own pricing model (may differ for bundled
  or enterprise plans)

Model pricing data is externalized to the `maestro-model-registry.json`
electron-store (see Section 9.1). Rates are loaded at runtime via
`getPricingForModel(modelId)` which reads from the store. New models
detected on the Anthropic pricing page are auto-added to the registry
by the model checker on app startup.

```typescript
interface CostCalculation {
  inputTokens: number;
  outputTokens: number;
  anthropicCost: number;    // Based on Anthropic's rates (from model registry store)
  maestroCost: number;      // Based on Maestro's rates
  savings: number;          // anthropicCost - maestroCost
  savingsPercent: number;
}

function calculateDualCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): CostCalculation {
  // Rates loaded from maestro-model-registry.json via getPricingForModel()
  const anthropicRates = getAnthropicRates(model);
  const maestroRates = getMaestroRates(model);

  const anthropicCost =
    (inputTokens * anthropicRates.inputPerToken) +
    (outputTokens * anthropicRates.outputPerToken);

  const maestroCost =
    (inputTokens * maestroRates.inputPerToken) +
    (outputTokens * maestroRates.outputPerToken);

  return {
    inputTokens,
    outputTokens,
    anthropicCost,
    maestroCost,
    savings: anthropicCost - maestroCost,
    savingsPercent: ((anthropicCost - maestroCost) / anthropicCost) * 100,
  };
}
```

### 19.3 Chart Components (16)

The dashboard includes 16 chart components for data visualization:

| Component | Type | Purpose |
|-----------|------|---------|
| `TokenUsageChart` | Line | Token usage over time |
| `CostBreakdownChart` | Stacked Bar | Cost by model/provider |
| `DailyUsageChart` | Bar | Daily message/token counts |
| `ModelDistributionChart` | Pie | Usage distribution across models |
| `ResponseTimeChart` | Line | Average response latency |
| `SessionActivityChart` | Heatmap | Activity by hour/day |
| `CostComparisonChart` | Grouped Bar | Anthropic vs Maestro costs |
| `TokenEfficiencyChart` | Line | Tokens per task over time |
| `CumulativeCostChart` | Area | Cumulative spending |
| `TopSessionsChart` | Horizontal Bar | Most active sessions |
| `ErrorRateChart` | Line | Error frequency |
| `UsageTrendChart` | Line + Moving Average | Long-term trends |
| `BudgetGaugeChart` | Gauge | Budget utilization |
| `ProviderSplitChart` | Donut | Multi-provider usage split |
| `HourlyPatternChart` | Polar Area | Usage by hour of day |
| `WeeklyComparisonChart` | Grouped Bar | Week-over-week comparison |

### 19.4 Colorblind Palettes

All charts support colorblind-accessible palettes:

```typescript
const COLOR_PALETTES = {
  default: ['#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'],
  deuteranopia: ['#0077BB', '#33BBEE', '#009988', '#EE7733', '#CC3311', '#EE3377'],
  protanopia: ['#004488', '#DDAA33', '#BB5566', '#000000', '#AAAAAA', '#66CCEE'],
  tritanopia: ['#332288', '#88CCEE', '#44AA99', '#117733', '#999933', '#CC6677'],
};
```

### 19.5 Real-Time IPC Updates

The dashboard subscribes to real-time usage events via IPC:

```typescript
useEffect(() => {
  const unsubscribes = [
    window.maestro.stats.onUpdate('usage', handleUsageUpdate),
    window.maestro.stats.onUpdate('cost', handleCostUpdate),
    window.maestro.stats.onUpdate('session', handleSessionUpdate),
  ];
  return () => unsubscribes.forEach(fn => fn());
}, []);
```

---

## 20. Document Graph

The Document Graph visualizes relationships between files and documents
in the project workspace.

### 20.1 Canvas-Based Rendering

**Important**: The Document Graph uses a **custom Canvas-based MindMap
component**, NOT React Flow or any third-party graph library. This was
a deliberate choice for performance with large graphs.

```typescript
interface MindMapConfig {
  canvas: HTMLCanvasElement;
  maxNodes: number;          // Default: 200
  layout: 'force-directed' | 'hierarchical';
  physics: PhysicsConfig;
  interaction: InteractionConfig;
}

class MindMapRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private nodes: MindMapNode[] = [];
  private edges: MindMapEdge[] = [];
  private animationFrame: number | null = null;

  render(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawEdges();
    this.drawNodes();
    this.drawLabels();
    this.animationFrame = requestAnimationFrame(() => this.render());
  }
}
```

### 20.2 Layout Algorithms

**Force-Directed Layout**: Simulates physical forces (attraction along edges,
repulsion between nodes) to produce organic-looking layouts. Uses Barnes-Hut
approximation for O(n log n) performance.

**Hierarchical Layout**: Arranges nodes in levels based on dependency depth.
Uses the Sugiyama algorithm for layer assignment and crossing minimization.

```typescript
interface PhysicsConfig {
  repulsionForce: number;     // Default: 1000
  attractionForce: number;    // Default: 0.01
  dampingFactor: number;      // Default: 0.95
  maxVelocity: number;        // Default: 50
  stabilizationThreshold: number; // Default: 0.1
  barnesHutTheta: number;     // Default: 0.8
}
```

### 20.3 Keyboard Navigation

The Document Graph supports full keyboard navigation:

- Arrow keys: Move focus between connected nodes
- Enter: Select/expand focused node
- Escape: Deselect current node
- `+`/`-`: Zoom in/out
- `0`: Reset zoom
- `f`: Fit graph to viewport
- `h`: Switch to hierarchical layout
- `d`: Switch to force-directed layout

### 20.4 Node Limit

The default maximum of 200 nodes prevents performance degradation on large
projects. Users can adjust this limit, but a warning is shown above 500 nodes.

---

## 21. Stats Database

The Stats Database provides persistent storage for usage analytics using SQLite.

### 21.1 Configuration

```typescript
const DB_CONFIG = {
  filename: 'maestro-stats.db',
  wal: true,                    // Write-Ahead Logging for concurrent reads
  statementCache: true,         // Prepared statement caching
  vacuumThreshold: 100 * 1024 * 1024, // 100MB -- auto-VACUUM above this size
  vacuumSchedule: 'weekly',     // Weekly VACUUM check
};
```

### 21.2 Schema (7 Tables)

```sql
-- Table 1: Usage events (primary analytics table)
CREATE TABLE usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  anthropic_cost REAL,
  maestro_cost REAL,
  response_time_ms INTEGER,
  error_type TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- Table 2: Session summaries (aggregated per session)
CREATE TABLE session_summaries (
  session_id TEXT PRIMARY KEY,
  total_messages INTEGER NOT NULL DEFAULT 0,
  total_input_tokens INTEGER NOT NULL DEFAULT 0,
  total_output_tokens INTEGER NOT NULL DEFAULT 0,
  total_anthropic_cost REAL NOT NULL DEFAULT 0,
  total_maestro_cost REAL NOT NULL DEFAULT 0,
  avg_response_time_ms REAL,
  first_message_at INTEGER,
  last_message_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- Table 3: Daily aggregates (for dashboard charts)
CREATE TABLE daily_aggregates (
  date TEXT NOT NULL,          -- YYYY-MM-DD
  agent_id TEXT NOT NULL,
  model TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  anthropic_cost REAL NOT NULL DEFAULT 0,
  maestro_cost REAL NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, agent_id, model)
);

-- Table 4: Achievements
CREATE TABLE achievements (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  level INTEGER NOT NULL DEFAULT 1,
  points INTEGER NOT NULL DEFAULT 0,
  unlocked_at INTEGER,
  progress REAL NOT NULL DEFAULT 0  -- 0.0 to 1.0
);

-- Table 5: Keyboard shortcuts usage
CREATE TABLE keyboard_usage (
  shortcut TEXT PRIMARY KEY,
  use_count INTEGER NOT NULL DEFAULT 0,
  first_used_at INTEGER,
  last_used_at INTEGER
);

-- Table 6: Audit records
CREATE TABLE audit_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period TEXT NOT NULL,         -- 'daily', 'weekly', 'monthly'
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  anthropic_billed REAL,
  maestro_calculated REAL,
  difference REAL,
  difference_percent REAL,
  details TEXT,                 -- JSON blob
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- Table 7: Migrations tracking
CREATE TABLE migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
```

### 21.3 Dual-Cost COALESCE

Queries use COALESCE to handle NULL cost values gracefully:

```sql
SELECT
  date,
  SUM(message_count) as total_messages,
  SUM(input_tokens) as total_input_tokens,
  SUM(output_tokens) as total_output_tokens,
  SUM(COALESCE(anthropic_cost, 0)) as total_anthropic_cost,
  SUM(COALESCE(maestro_cost, 0)) as total_maestro_cost,
  SUM(COALESCE(anthropic_cost, 0)) - SUM(COALESCE(maestro_cost, 0)) as savings
FROM daily_aggregates
WHERE date BETWEEN ? AND ?
GROUP BY date
ORDER BY date;
```

### 21.4 Statement Caching

Frequently-used SQL statements are prepared once and cached:

```typescript
class StatsDatabase {
  private stmtCache = new Map<string, Statement>();

  private getStatement(sql: string): Statement {
    let stmt = this.stmtCache.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  recordUsage(event: UsageEvent): void {
    const stmt = this.getStatement(`
      INSERT INTO usage_events
        (session_id, agent_id, model, input_tokens, output_tokens,
         anthropic_cost, maestro_cost, response_time_ms, error_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      event.sessionId, event.agentId, event.model,
      event.inputTokens, event.outputTokens,
      event.anthropicCost, event.maestroCost,
      event.responseTimeMs, event.errorType
    );
  }
}
```

### 21.5 Weekly VACUUM

A scheduled task checks the database size weekly and runs VACUUM if it
exceeds 100MB:

```typescript
class VacuumScheduler {
  private readonly THRESHOLD_BYTES = 100 * 1024 * 1024; // 100MB

  async checkAndVacuum(): Promise<void> {
    const stat = await fs.stat(this.dbPath);

    if (stat.size > this.THRESHOLD_BYTES) {
      logger.info('Running VACUUM', { sizeMB: (stat.size / 1024 / 1024).toFixed(1) });
      this.db.exec('VACUUM');
      logger.info('VACUUM complete', {
        newSizeMB: ((await fs.stat(this.dbPath)).size / 1024 / 1024).toFixed(1),
      });
    }
  }
}
```

### 21.6 Migrations

The 9 migrations track schema evolution:

| Migration | Description |
|-----------|-------------|
| 001 | Initial schema (usage_events, migrations) |
| 002 | Add session_summaries table |
| 003 | Add daily_aggregates table |
| 004 | Add achievements and keyboard_usage tables |
| 005 | Add audit_records table |
| 006 | Add maestro_cost column to usage_events |
| 007 | Add error_type column to usage_events |
| 008 | Add response_time_ms to usage_events |
| 009 | Add indexes for common query patterns |

---

## 22. Project Folders

Project Folders are the top-level organizational container in Maestro's
hierarchy, sitting above Groups.

### 22.1 Hierarchy

```
Project Folder
  +-- Group A
  |     +-- Session 1
  |     +-- Session 2
  |
  +-- Group B
        +-- Session 3
        +-- Session 4

(Ungrouped Sessions)
  +-- Session 5
```

### 22.2 IPC Operations

```typescript
interface ProjectFoldersAPI {
  list(): Promise<ProjectFolder[]>;
  get(id: string): Promise<ProjectFolder>;
  create(data: CreateProjectFolderInput): Promise<ProjectFolder>;
  update(id: string, data: UpdateProjectFolderInput): Promise<ProjectFolder>;
  delete(id: string): Promise<void>;
  addGroup(folderId: string, groupId: string): Promise<void>;
  removeGroup(folderId: string, groupId: string): Promise<void>;
  reorder(folderId: string, groupIds: string[]): Promise<void>;
}

interface ProjectFolder {
  id: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  groupIds: string[];
  createdAt: number;
  updatedAt: number;
}
```

### 22.3 Persistence

Project folders are stored in the `maestro-project-folders` electron-store
instance. The store schema supports an ordered array of folder definitions
with embedded group ID references.

---

## 23. Knowledge Graph

The Knowledge Graph persists learnings extracted from AI sessions as markdown
files for long-term knowledge retention.

### 23.1 Storage

Knowledge entries are stored as individual `.md` files in the `userData`
directory:

```
userData/
  knowledge_graph/
    2024-01-15_react-hooks-patterns.md
    2024-01-16_typescript-generics.md
    2024-01-17_electron-ipc-security.md
    ...
```

### 23.2 Entry Format

```markdown
---
id: kg_abc123
title: React Hooks Patterns
tags: [react, hooks, patterns]
sessionId: session_xyz
createdAt: 2024-01-15T10:30:00Z
source: ai-extraction
confidence: 0.85
---

# React Hooks Patterns

## Key Learnings

1. Custom hooks should start with `use` prefix...
2. useEffect cleanup runs before re-execution...

## Code Examples

...
```

### 23.3 Search

The Knowledge Graph supports full-text search across entries:

```typescript
interface KnowledgeSearchOptions {
  query: string;
  tags?: string[];
  dateRange?: { start: number; end: number };
  limit?: number;
}
```

---

## 24. Prompt Library

The Prompt Library provides template management for reusable AI prompts.

### 24.1 IPC Methods (9)

```typescript
interface PromptLibraryAPI {
  list(options?: ListOptions): Promise<PromptTemplate[]>;
  get(id: string): Promise<PromptTemplate>;
  create(data: CreatePromptInput): Promise<PromptTemplate>;
  update(id: string, data: UpdatePromptInput): Promise<PromptTemplate>;
  delete(id: string): Promise<void>;
  search(query: string): Promise<PromptTemplate[]>;
  import(data: ExportedPrompts): Promise<number>;  // Returns imported count
  export(ids?: string[]): Promise<ExportedPrompts>;
  getCategories(): Promise<string[]>;
}

interface PromptTemplate {
  id: string;
  name: string;
  description?: string;
  prompt: string;             // Template text with {{variables}}
  variables: PromptVariable[];
  category: string;
  tags: string[];
  usageCount: number;
  lastUsedAt?: number;
  createdAt: number;
  updatedAt: number;
}

interface PromptVariable {
  name: string;
  description?: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  required: boolean;
  default?: unknown;
  options?: string[];         // For 'select' type
}
```

---

## 25. Anthropic Audit

The Anthropic Audit system compares Maestro-calculated costs against
Anthropic's billing to detect discrepancies.

### 25.1 Scheduled Audits

```typescript
interface AuditSchedule {
  daily: boolean;    // Run at midnight local time
  weekly: boolean;   // Run on Sunday midnight
  monthly: boolean;  // Run on 1st of month
}

interface AuditResult {
  period: 'daily' | 'weekly' | 'monthly';
  startDate: string;
  endDate: string;
  maestroCalculated: {
    inputTokens: number;
    outputTokens: number;
    totalCost: number;
  };
  anthropicBilled: {
    totalCost: number;       // From Anthropic billing API
  };
  difference: number;
  differencePercent: number;
  status: 'match' | 'minor-discrepancy' | 'major-discrepancy';
  details: AuditDetail[];
}

interface AuditDetail {
  model: string;
  maestroCost: number;
  anthropicCost: number;
  difference: number;
  possibleReason?: string;
}
```

### 25.2 Discrepancy Thresholds

| Status | Threshold |
|--------|-----------|
| `match` | < 1% difference |
| `minor-discrepancy` | 1% - 5% difference |
| `major-discrepancy` | > 5% difference |

Major discrepancies trigger a notification in the Maestro UI.

---

## 26. Shared Module

The shared module (`shared/`) contains **20 files** of code shared between
the main process, renderer, and preload script.

### 26.1 File Inventory

| File | Purpose |
|------|---------|
| `types.ts` | Core application type definitions |
| `stats-types.ts` | Statistics and analytics types |
| `theme-types.ts` | Theme system type definitions |
| `themes.ts` | Built-in theme color definitions |
| `formatters.ts` | Number, date, token, and cost formatting |
| `marketplace-types.ts` | Extension marketplace types |
| `group-chat-types.ts` | Group chat system types |
| `logger-types.ts` | Structured logging type definitions |
| `performance-metrics.ts` | Performance measurement utilities |
| `cli-activity.ts` | CLI activity tracking types |
| `synopsis.ts` | Session synopsis generation |
| `emojiUtils.ts` | Emoji detection and rendering utilities |
| `history.ts` | History entry types and utilities |
| `gitUtils.ts` | Git output parsing utilities |
| `pathUtils.ts` | Cross-platform path manipulation |
| `stringUtils.ts` | String manipulation (truncation, slugify, etc.) |
| `treeUtils.ts` | Tree data structure utilities |
| `templateVariables.ts` | Template variable resolution |
| `uuid.ts` | UUID generation (v4) |
| `constants.ts` | Shared constants and enums |

### 26.2 Key Shared Types

```typescript
// types.ts (excerpt)
interface Session {
  id: string;
  name: string;
  groupId?: string;
  agentConfigId: string;
  createdAt: number;
  updatedAt: number;
  lastActiveAt: number;
  metadata: SessionMetadata;
}

interface AgentConfig {
  id: string;
  name: string;
  provider: 'anthropic' | 'openai' | 'codex' | 'opencode' | 'custom';
  model: string;
  apiKey?: string;           // Encrypted in store
  baseUrl?: string;
  maxTokens: number;
  temperature: number;
  systemPrompt?: string;
  tools: AgentTool[];
  env: Record<string, string>;
}

interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  tokens?: { input: number; output: number };
  model?: string;
  metadata?: Record<string, unknown>;
}
```

---

## 27. SSH Remote

Maestro supports full remote execution over SSH, allowing users to run
AI agents on remote machines.

### 27.1 Architecture

```
Local Maestro                          Remote Machine
    |                                       |
    +-- SSH ControlMaster Connection ------>|
    |   (persistent multiplexed)            |
    |                                       |
    +-- File Sync (rsync over SSH) -------->|
    |                                       |
    +-- Remote Process Spawn -------------->|
    |   (ssh command execution)             |-- Agent process
    |                                       |
    +<-- stdout/stderr streaming -----------+
    |                                       |
    +-- Remote FS Operations -------------->|
        (sftp)                              |
```

### 27.2 SSH ControlMaster Pooling

Maestro uses SSH ControlMaster to maintain persistent, multiplexed connections:

```typescript
class SSHConnectionPool {
  private controlPath: string;

  async connect(config: SSHConfig): Promise<void> {
    const args = [
      '-o', 'ControlMaster=auto',
      '-o', `ControlPath=${this.controlPath}`,
      '-o', 'ControlPersist=600',      // 10 minutes
      '-o', 'ServerAliveInterval=30',
      '-o', 'ServerAliveCountMax=3',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-N',                             // No command, just connection
      `${config.user}@${config.host}`,
    ];

    if (config.port !== 22) {
      args.unshift('-p', String(config.port));
    }

    if (config.identityFile) {
      args.unshift('-i', config.identityFile);
    }

    await this.spawn('ssh', args);
  }

  async execute(command: string): Promise<ExecResult> {
    return this.spawn('ssh', [
      '-o', `ControlPath=${this.controlPath}`,
      '-o', 'ControlMaster=no',
      this.hostString,
      command,
    ]);
  }
}
```

### 27.3 Exponential Backoff Retry

Connection failures trigger exponential backoff retry:

```typescript
class RetryPolicy {
  private readonly BASE_DELAY_MS = 1000;
  private readonly MAX_DELAY_MS = 30_000;
  private readonly MAX_RETRIES = 5;

  async executeWithRetry<T>(
    operation: () => Promise<T>,
    context: string
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        const delay = Math.min(
          this.BASE_DELAY_MS * Math.pow(2, attempt),
          this.MAX_DELAY_MS
        );
        logger.warn(`Retry ${attempt + 1}/${this.MAX_RETRIES}: ${context}`, {
          error: lastError.message,
          nextRetryMs: delay,
        });
        await sleep(delay);
      }
    }

    throw lastError;
  }
}
```

### 27.4 SSH Utility Files (5)

| File | Purpose |
|------|---------|
| `ssh-connection.ts` | SSH connection management and ControlMaster |
| `ssh-exec.ts` | Remote command execution |
| `ssh-fs.ts` | Remote filesystem operations (SFTP) |
| `ssh-sync.ts` | File synchronization (rsync wrapper) |
| `ssh-config.ts` | SSH configuration parsing and host resolution |

---

## 28. Error Handling Patterns

Maestro implements multiple layers of error handling to prevent crashes and
provide useful error information.

### 28.1 Global Handlers (Never Crash)

The main process installs global handlers that catch all unhandled errors:

```typescript
// Main process - never crash
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: serializeError(error) });
  // Do NOT call process.exit() - keep running
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: serializeError(reason) });
  // Do NOT call process.exit() - keep running
});
```

### 28.2 IPC Handler Factory Wrapping

All IPC handlers are wrapped by the handler factory (Section 2.2), which
catches and serializes errors before they cross the IPC boundary. This
prevents unserializable error objects from crashing the IPC channel.

### 28.3 React ErrorBoundary

An ErrorBoundary component wraps the entire application at the root level:

```typescript
class AppErrorBoundary extends React.Component<Props, State> {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error('React error boundary caught error', {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return <CrashRecoveryScreen error={this.state.error} onRetry={this.reset} />;
    }
    return this.props.children;
  }

  private reset = () => {
    this.setState({ hasError: false, error: null });
  };
}
```

### 28.4 ChartErrorBoundary with Retry

Chart components have their own error boundary with automatic retry:

```typescript
class ChartErrorBoundary extends React.Component<Props, State> {
  state = { hasError: false, retryCount: 0 };
  private readonly MAX_RETRIES = 3;

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    if (this.state.retryCount < this.MAX_RETRIES) {
      setTimeout(() => {
        this.setState(prev => ({
          hasError: false,
          retryCount: prev.retryCount + 1,
        }));
      }, 1000 * (this.state.retryCount + 1)); // Increasing delay
    }
  }

  render() {
    if (this.state.hasError && this.state.retryCount >= this.MAX_RETRIES) {
      return <ChartFallback message="Chart failed to render" />;
    }
    return this.props.children;
  }
}
```

### 28.5 Agent Error Types (8)

```typescript
enum AgentErrorType {
  NETWORK_ERROR = 'network_error',           // Connection failures
  AUTH_ERROR = 'auth_error',                 // API key invalid/expired
  RATE_LIMIT = 'rate_limit',                 // API rate limiting
  CONTEXT_OVERFLOW = 'context_overflow',     // Token limit exceeded
  INVALID_RESPONSE = 'invalid_response',     // Malformed agent output
  TIMEOUT = 'timeout',                       // Response timeout
  PROVIDER_ERROR = 'provider_error',         // Provider-side errors
  UNKNOWN = 'unknown',                       // Catch-all
}
```

### 28.6 Auto-Clear on Success

Agent errors are automatically cleared when the next successful response
is received. This prevents stale error states from persisting:

```typescript
function useAgentErrorWithAutoClear(sessionId: string) {
  const [error, setError] = useState<AgentError | null>(null);

  useEffect(() => {
    const unsubError = window.maestro.agentError.onError(sessionId, (err) => {
      setError(err);
    });

    const unsubMessage = window.maestro.agentSessions.onMessage(sessionId, () => {
      // Success clears any previous error
      setError(null);
    });

    return () => {
      unsubError();
      unsubMessage();
    };
  }, [sessionId]);

  return error;
}
```

---

## 29. Styling

Maestro uses Tailwind CSS as the primary styling framework, augmented with
custom CSS for specialized components.

### 29.1 Tailwind Configuration

Tailwind is configured with custom extensions that integrate with the theme
system:

```typescript
// tailwind.config.ts (excerpt)
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'bg-primary': 'var(--bg-primary)',
        'bg-secondary': 'var(--bg-secondary)',
        'bg-tertiary': 'var(--bg-tertiary)',
        'bg-accent': 'var(--bg-accent)',
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-accent': 'var(--text-accent)',
        'border-primary': 'var(--border-primary)',
        'border-accent': 'var(--border-accent)',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
};
```

### 29.2 JetBrains Mono Font

JetBrains Mono is the default monospace font used throughout the application
for code display, terminal output, and the AI conversation interface. It is
bundled with the application to ensure consistent rendering across platforms.

### 29.3 CSS Variables for Theming

All theme colors are exposed as CSS custom properties (see Section 8.5).
This enables both Tailwind utility classes and custom CSS to reference
theme colors consistently:

```css
/* Custom CSS using theme variables */
.chat-message {
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border-left: 3px solid var(--border-accent);
}

.chat-message.error {
  border-left-color: var(--error);
  background-color: color-mix(in srgb, var(--error) 10%, var(--bg-tertiary));
}
```

### 29.4 Prefers-Reduced-Motion Support

Maestro respects the `prefers-reduced-motion` media query. When enabled,
all animations and transitions are disabled or reduced:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

This applies to:
- Page transitions
- Modal open/close animations
- Chart animations
- Loading spinners (replaced with static indicators)
- Document graph physics (instant layout, no animation)

### 29.5 Component Styling Patterns

Maestro follows these styling conventions:

1. **Layout**: Tailwind utility classes (`flex`, `grid`, `p-4`, `gap-2`)
2. **Theme colors**: Tailwind theme extensions (`bg-bg-primary`, `text-text-secondary`)
3. **Complex styles**: CSS modules or inline styles for dynamic/computed values
4. **Animations**: CSS keyframes defined in global CSS, triggered via className
5. **Responsive**: Tailwind breakpoints (`sm:`, `md:`, `lg:`)

```tsx
// Typical component styling pattern
function ChatBubble({ message, theme }: ChatBubbleProps) {
  return (
    <div
      className={cn(
        'rounded-lg p-3 mb-2 max-w-[80%]',
        message.role === 'user'
          ? 'ml-auto bg-bg-accent text-text-primary'
          : 'mr-auto bg-bg-tertiary text-text-primary',
      )}
    >
      <div className="text-sm font-mono whitespace-pre-wrap">
        {message.content}
      </div>
      <div className="text-xs text-text-secondary mt-1">
        {formatTimestamp(message.timestamp)}
      </div>
    </div>
  );
}
```

---

## Appendix A: Key TypeScript Interfaces Reference

```typescript
// Complete collection of critical interfaces referenced throughout this document

interface MaestroWindow {
  maestro: {
    settings: SettingsAPI;
    sessions: SessionsAPI;
    process: ProcessAPI;
    fs: FileSystemAPI;
    dialog: DialogAPI;
    shells: ShellsAPI;
    shell: ShellAPI;
    logger: LoggerAPI;
    sync: SyncAPI;
    power: PowerAPI;
    app: AppAPI;
    fonts: FontsAPI;
    devtools: DevtoolsAPI;
    updates: UpdatesAPI;
    agents: AgentsAPI;
    agentSessions: AgentSessionsAPI;
    agentError: AgentErrorAPI;
    claude: DeprecatedClaudeAPI;
    git: GitAPI;
    web: WebAPI;
    live: LiveAPI;
    webserver: WebserverAPI;
    tunnel: TunnelAPI;
    autorun: AutorunAPI;
    playbooks: PlaybooksAPI;
    history: HistoryAPI;
    cli: CliAPI;
    tempfile: TempfileAPI;
    stats: StatsAPI;
    documentGraph: DocumentGraphAPI;
    audit: AuditAPI;
    reconstruction: ReconstructionAPI;
    leaderboard: LeaderboardAPI;
    groupChat: GroupChatAPI;
    projectFolders: ProjectFoldersAPI;
    promptLibrary: PromptLibraryAPI;
    knowledgeGraph: KnowledgeGraphAPI;
    feedback: FeedbackAPI;
    context: ContextAPI;
    marketplace: MarketplaceAPI;
    speckit: SpeckitAPI;
    openspec: OpenspecAPI;
    attachments: AttachmentsAPI;
    notification: NotificationAPI;
    debug: DebugAPI;
  };
}
```

---

## Appendix B: Data Flow Diagrams

### B.1 Message Send Flow

```
User types message
    |
    v
InputComponent (React)
    |
    +-- useInputValidation()
    +-- useInputHistory() -- store in history
    |
    v
ExecutionQueue.enqueue()
    |
    v
ExecutionQueue.processNext()
    |
    v
window.maestro.agentSessions.send(sessionId, message)
    |
    v
ipcRenderer.invoke('agentSessions:send')
    |
    v
[IPC boundary - main process]
    |
    v
AgentSessionHandler.send()
    |
    +-- Append to SessionStorage
    +-- Forward to agent process (stdin)
    |
    v
Agent process generates response (streaming)
    |
    v
stdout -> StdoutHandler -> DataBufferManager -> IPC emit
    |
    v
[IPC boundary - renderer process]
    |
    v
window.maestro.agentSessions.onMessage() callback
    |
    v
useAgentMessages() -- update message list
    |
    v
ChatPanel re-renders with new message
    |
    v
window.maestro.stats.record() -- track usage
```

### B.2 Theme Change Flow

```
User selects new theme
    |
    v
ThemePicker component
    |
    v
window.maestro.settings.set('darkThemeId', newThemeId)
    |
    v
[IPC -> main process]
    |
    v
maestro-settings store updated
    |
    v
[IPC event -> renderer]
    |
    v
settings:changed event fires
    |
    v
useTheme() hook recomputes
    |
    v
applyThemeToCss(newTheme) -- update CSS variables
    |
    v
Theme prop propagates down component tree (prop drilling)
    |
    v
All themed components re-render
    |
    v
[IPC event -> web interface]
    |
    v
WebSocket broadcast to connected clients
```

---

## Appendix C: Performance Considerations

### C.1 IPC Batching

When multiple IPC calls need to be made in rapid succession (e.g., loading
a dashboard with 16 charts), calls are batched using `Promise.all` to avoid
sequential round-trip latency.

### C.2 Virtual Scrolling

Long lists (session list, message history, file browser) use virtual
scrolling via `useVirtualScroll` to render only visible items. This keeps
DOM node count constant regardless of list length.

### C.3 Canvas Rendering

The Document Graph uses Canvas (not DOM/SVG) for rendering, enabling
smooth 60fps interaction with up to 200+ nodes. DOM-based graph libraries
struggle above 50-100 nodes.

### C.4 WAL Mode SQLite

The stats database uses Write-Ahead Logging, allowing concurrent reads
from the renderer (via IPC) while the main process writes usage events.
This eliminates read-write contention.

### C.5 DataBufferManager

As detailed in Section 3.5, the dual-threshold buffer prevents IPC flooding
from fast-producing processes while maintaining low latency for interactive
use.

---

*End of Architecture Documentation -- Maestro v0.14.5*
