---
type: reference
title: Maestro Codebase Context Document
created: 2026-02-12
tags:
  - architecture
  - codebase-analysis
  - electron
  - react
related:
  - "[[README]]"
---

# Maestro Codebase Context Document
Generated: 2026-02-12

## Executive Summary

Maestro is an Electron-based desktop application that serves as a unified interface for managing multiple AI coding agents (Claude Code, Codex, OpenCode). It provides:

- **Multi-agent orchestration**: Run and manage multiple AI agent sessions simultaneously
- **Group chat**: Enable multiple AI agents to collaborate on tasks with a moderator pattern
- **Auto Run**: Batch processing system for automated task execution across documents
- **SSH remote support**: Execute agent commands on remote machines via SSH
- **Usage tracking**: Comprehensive token/cost statistics with SQLite persistence
- **Web interface**: Remote control and monitoring via web browser
- **CLI tool**: Command-line interface for scripted operations

**Tech Stack**: Electron 28, React 18, TypeScript, Vite, Tailwind CSS, better-sqlite3, node-pty, Fastify

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MAESTRO APPLICATION                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                        RENDERER PROCESS (React)                      │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                  │    │
│  │  │ SessionList │  │  MainPanel  │  │ RightPanel  │                  │    │
│  │  │  (sidebar)  │  │  (center)   │  │ (explorer)  │                  │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                  │    │
│  │                                                                      │    │
│  │  ┌─────────────────────────────────────────────────────────────┐    │    │
│  │  │               CONTEXT PROVIDERS (State Management)           │    │    │
│  │  │  SessionContext │ GroupChatContext │ AutoRunContext │ ...   │    │    │
│  │  └─────────────────────────────────────────────────────────────┘    │    │
│  │                                                                      │    │
│  │  ┌─────────────────────────────────────────────────────────────┐    │    │
│  │  │                    HOOKS (Domain-organized)                   │    │    │
│  │  │  /session │ /batch │ /agent │ /keyboard │ /input │ /git     │    │    │
│  │  └─────────────────────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                      │                                       │
│                                      │ IPC (contextBridge)                   │
│                                      ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         PRELOAD SCRIPTS                              │    │
│  │            25+ modules exposing secure API to renderer               │    │
│  │         window.maestro.{process, git, fs, settings, ...}           │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                      │                                       │
│                                      │ ipcRenderer.invoke/on                 │
│                                      ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                          MAIN PROCESS (Node.js)                      │    │
│  │                                                                      │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  │    │
│  │  │   Process   │  │   Group     │  │    SSH      │  │   Web     │  │    │
│  │  │   Manager   │  │   Chat      │  │   Remote    │  │  Server   │  │    │
│  │  │  (node-pty) │  │   Router    │  │   Manager   │  │ (Fastify) │  │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └───────────┘  │    │
│  │                                                                      │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  │    │
│  │  │   Stats     │  │   History   │  │   Stores    │  │   IPC     │  │    │
│  │  │    DB       │  │   Manager   │  │  (electron- │  │ Handlers  │  │    │
│  │  │  (SQLite)   │  │             │  │   store)    │  │  (35+)    │  │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └───────────┘  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                      │                                       │
│                                      │ PTY / Child Process                   │
│                                      ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                           AI AGENTS (External)                       │    │
│  │           Claude Code │ Codex │ OpenCode (detected at runtime)       │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Process Responsibilities

| Process | Technology | Responsibilities |
|---------|------------|------------------|
| **Main** | Node.js/Electron | Process management, IPC handling, database, file system, SSH, web server |
| **Renderer** | React/Vite | UI rendering, state management, user interaction |
| **Preload** | Node.js (restricted) | Secure bridge between main and renderer |

---

## Directory Structure

```
/app/Maestro/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts             # Entry point (692 lines)
│   │   ├── ipc/                  # IPC handler registration
│   │   │   └── handlers/        # 20+ domain handlers
│   │   ├── process-manager/     # PTY/child process spawning
│   │   ├── process-listeners/   # Event routing from agents
│   │   ├── group-chat/          # Multi-agent orchestration
│   │   ├── web-server/          # Fastify HTTP/WebSocket server
│   │   ├── stores/              # electron-store persistence
│   │   ├── stats/               # SQLite usage database
│   │   ├── storage/             # Agent session storage
│   │   ├── preload/             # Preload script modules (25 files)
│   │   └── utils/               # Logger, validators, helpers
│   │
│   ├── renderer/                # React frontend
│   │   ├── main.tsx             # Entry point
│   │   ├── App.tsx              # Main component (~451KB)
│   │   ├── components/          # 137 UI components
│   │   │   ├── session-list/    # Left sidebar
│   │   │   ├── main-panel/      # Center panel
│   │   │   ├── right-panel/     # File explorer, history
│   │   │   ├── modals/          # 15+ modal components
│   │   │   └── UsageDashboard/  # Statistics views
│   │   ├── hooks/               # Domain-organized hooks
│   │   │   ├── session/         # Session management
│   │   │   ├── batch/           # Auto Run state machine
│   │   │   ├── agent/           # Agent execution
│   │   │   ├── keyboard/        # Shortcut handling
│   │   │   └── ...              # 10+ other domains
│   │   ├── contexts/            # React Context providers
│   │   ├── types/               # TypeScript interfaces
│   │   └── utils/               # Utility functions
│   │
│   ├── shared/                  # Shared between main/renderer
│   │   ├── types.ts             # Core data models
│   │   ├── stats-types.ts       # Statistics types
│   │   └── group-chat-types.ts  # Group chat types
│   │
│   ├── cli/                     # CLI tool
│   │   └── maestro-cli.ts       # Command-line interface
│   │
│   ├── web/                     # Standalone web interface
│   │   └── ...                  # Web-only build
│   │
│   └── prompts/                 # Prompt templates (markdown)
│       └── *.md                 # Generated to TypeScript
│
├── dist/                        # Compiled output
├── build/                       # Electron-builder resources
├── e2e/                         # Playwright E2E tests
├── scripts/                     # Build scripts (esbuild, prompts)
├── package.json                 # Dependencies, scripts, electron-builder config
├── vite.config.mts              # Renderer Vite config
├── vite.config.web.mts          # Web interface Vite config
└── tsconfig*.json               # TypeScript configurations (4 files)
```

---

## Main Process (src/main/)

### Entry Point (`index.ts`)

The main entry point (692 lines) orchestrates the Electron app lifecycle:

1. **Data directory configuration**: Supports demo mode, dev mode (separate data), and custom sync paths (iCloud)
2. **Store initialization**: Centralized via `initializeStores()` using electron-store
3. **Sentry integration**: Dynamic import for crash reporting (production only)
4. **Service initialization order**:
   - Stores → Logger → ProcessManager → AgentDetector → HistoryManager
   - → StatsDB → IPC handlers → Process listeners → Window creation

### IPC Handlers (`ipc/handlers/`)

Extensive IPC handler registration across 20+ domain files:

| Namespace | Key Operations |
|-----------|----------------|
| `process:*` | spawn, write, interrupt, kill, resize, runCommand |
| `git:*` | status, diff, branches, checkout, commit, push, pull, PR |
| `fs:*` | readDir, readFile, writeFile, remove, stat, watch |
| `settings:*` | get, set, getAll |
| `sessions:*` | getAll, save, update, delete |
| `stats:*` | recordQuery, getAggregation, exportCsv |
| `autorun:*` | listDocs, checkForNew, executeBatch |
| `groupChat:*` | create, delete, send, addParticipant |
| `live:*` | toggle, getStatus, broadcastActiveSession |
| `audit:*` | run, getHistory, scheduleStatus |

### Process Management (`process-manager/`)

**ProcessManager class** orchestrates spawning/managing processes:

- **Spawners**: `PtySpawner` (node-pty), `ChildProcessSpawner`
- **Buffers**: `DataBufferManager` for output aggregation
- **Runners**: `LocalCommandRunner`, `SshCommandRunner`
- **Capabilities**: Write to stdin, resize PTY, interrupt (SIGINT), kill
- **SSH support**: Commands wrapped for remote execution via SshRemoteManager

### Database Layer

1. **Stats Database** (`stats/stats-db.ts`):
   - SQLite via `better-sqlite3` in WAL mode
   - Tables: `query_events`, `auto_run_sessions`, `auto_run_tasks`, `session_lifecycle`
   - Features: Integrity checks, corruption recovery, weekly VACUUM, CSV export

2. **Stores** (`stores/`):
   - JSON-based via `electron-store`
   - Stores: Settings, Sessions, Groups, AgentConfigs, WindowState
   - Supports custom sync paths (e.g., iCloud)

3. **History Manager** (`history-manager.ts`):
   - Per-session history files in `history/` directory
   - 5,000 entries per session limit

### Key Services

| Service | Purpose |
|---------|---------|
| `ProcessManager` | Agent process lifecycle |
| `SshRemoteManager` | SSH config, connection testing, argument building |
| `GroupChatRouter` | Multi-agent conversation orchestration |
| `HistoryManager` | Per-session command history |
| `AgentDetector` | Detect available AI agents at runtime |
| `PowerManager` | Prevent system sleep during AI processing |
| `TunnelManager` | Network tunnel management |
| `AutoUpdater` | Electron app updates |
| `AuditScheduler` | Scheduled cost audits |

---

## Renderer Process (src/renderer/)

### Component Hierarchy

```
ErrorBoundary
└── ToastProvider
    └── LayerStackProvider
        └── ModalProvider
            └── UILayoutProvider
                └── WizardProvider
                    └── MaestroConsole (App.tsx)
                        └── SessionProvider
                            └── AutoRunProvider
                                └── GroupChatProvider
                                    └── InputProvider
                                        └── ProjectFoldersProvider
                                            └── InlineWizardProvider
                                                └── GitStatusProvider
                                                    ├── SessionList (left)
                                                    ├── MainPanel (center)
                                                    └── RightPanel (right)
```

### State Management

**React Context API** (no Redux/Zustand):

| Context | Purpose |
|---------|---------|
| `SessionContext` | Sessions list, active session, groups, batched updates |
| `GroupChatContext` | Multi-agent conversation state |
| `AutoRunContext` | Document list/tree for batch processing |
| `InputContext` | Tab completion, slash commands, @mention state |
| `ModalContext` | 50+ modal states (centralized) |
| `UILayoutContext` | Panel visibility, focus area, sidebar state |
| `ToastContext` | Notifications with audio/OS notification support |
| `LayerStackContext` | Modal z-index and shortcut blocking |
| `GitStatusContext` | Git branch/status per session |

**Batched Updates** (`useBatchedSessionUpdates`):
- Accumulates IPC updates in refs, flushes every 150ms
- Critical for handling 100+ updates/second during AI streaming
- Supports: appendLog, setStatus, updateUsage, updateContextUsage

### Key Hooks

| Domain | Key Hooks |
|--------|-----------|
| `session/` | useBatchedSessionUpdates, useNavigationHistory, useActivityTracker |
| `batch/` | useBatchProcessor, batchStateMachine (state machine) |
| `agent/` | useAgentExecution, useAgentCapabilities, useSendToAgent |
| `keyboard/` | useKeyboardShortcutHelpers, useMainKeyboardHandler |
| `input/` | useInputSync, useTabCompletion, useAtMentionCompletion |
| `git/` | useFileTreeManagement |
| `props/` | useMainPanelProps, useSessionListProps (memoized bundles) |

### UI Components

**137 components** organized by feature:

| Category | Components |
|----------|------------|
| Main layout | SessionList, MainPanel, RightPanel, TabBar, InputArea |
| Status | ThinkingStatusPill, GitStatusWidget, ContextWarningSash |
| Modals | SettingsModal (88KB), NewInstanceModal, AgentSessionsBrowser |
| Auto Run | AutoRun, AutoRunDocumentSelector, AutoRunExpandedModal |
| Group Chat | GroupChatPanel, GroupChatInput, GroupChatMessages |
| Wizards | MaestroWizard, WizardConversationView |
| File handling | FileExplorerPanel, FilePreview, DocumentGraph |
| Usage/Stats | UsageDashboard (subdirectory) |

**Styling**: Tailwind CSS with CSS custom properties for theming

---

## Data Flow

### Agent Communication Flow

```
1. User Input (InputArea)
       │
       ▼
2. useAgentExecution.execute()
       │
       ▼
3. IPC: window.maestro.process.spawn(config)
       │
       ▼
4. Main: ProcessManager.spawn() → PtySpawner/ChildProcessSpawner
       │
       ▼
5. Agent Process (Claude Code / Codex / OpenCode)
       │
       ▼ (stdout/stderr)
6. Process Listeners capture events:
   - data-listener → process:data
   - usage-listener → process:usage
   - session-id-listener → process:sessionId
   - exit-listener → process:exit
       │
       ▼
7. IPC events to renderer via safeSend()
       │
       ▼
8. useBatchedSessionUpdates accumulates in refs
       │
       ▼ (150ms flush)
9. React re-render → UI update
```

### Token/Usage Statistics Flow

```
1. Agent outputs usage JSON in stream
       │
       ▼
2. AgentOutputParser extracts usage stats
       │
       ▼
3. usage-listener.ts formats stats
       │
       ▼
4. IPC: process:usage event → renderer
       │
       ▼
5. useBatchedSessionUpdates.updateUsage()
       │
       ▼
6. Stats recorded to SQLite via stats:recordQuery
       │
       ▼
7. UI displays in ThinkingStatusPill:
   - Session name
   - Bytes received
   - Elapsed time
   - Tokens/second throughput
```

### Session Management Flow

```
Sessions stored in:
├── electron-store (sessions.json) - Persistent session config
├── SQLite (stats.db) - Usage statistics
└── History files (history/*.json) - Per-session command history

Session State:
'idle' → 'connecting' → 'busy' → 'idle'
                          │
                          └→ 'error' (recoverable or not)
                          └→ 'waiting_input'
```

---

## Type System

### Core Models

**Session** (`renderer/types/index.ts:506-701`) - ~200 fields:
- Identity: id, groupId, name, toolType, projectRoot, cwd
- State: state (idle|busy|waiting_input|connecting|error)
- AI Tabs: aiTabs[] (AITab[]), activeTabId, closedTabHistory[]
- Process: aiPid, terminalPid, port
- Git: isGitRepo, gitBranches[], worktreeConfig
- SSH: sshRemote, sshRemoteId, remoteCwd
- Auto Run: autoRunFolderPath, autoRunSelectedFile

**AITab** (`renderer/types/index.ts:469-496`):
- Core: id, agentSessionId, name, starred, logs[], state
- Input: inputValue, stagedImages[], readOnlyMode
- Usage: usageStats, cumulativeUsageStats

**UsageStats** (`shared/types.ts:82-99`):
- inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens
- totalCostUsd, contextWindow, reasoningTokens, detectedModel

**Group** (`shared/types.ts:7-14`):
- id, name, emoji, collapsed, projectFolderId

### IPC Types

**Preload API** (`main/preload/index.ts`):
35+ API modules exposed via `window.maestro`:
- settings, sessions, groups, process, git, fs, agents
- groupChat, autorun, stats, audit, web, live
- dialog, fonts, shells, tunnel, sshRemote, power, updates

**Event Types** (main → renderer):
- `process:data` - Streaming output
- `process:usage` - Token usage updates
- `process:sessionId` - Agent session ID
- `process:exit` - Process termination
- `agent-error` - Structured error

---

## Build System

### Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Development (main + renderer concurrent) |
| `npm run build` | Full production build |
| `npm run package` | Electron packaging (all platforms) |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | E2E tests (Playwright) |
| `npm run lint` | TypeScript compilation checks |

### Build Pipeline

```
npm run build:
1. build:prompts   → Generate TS from markdown prompts
2. build:main      → Compile main process (TSC → CommonJS)
3. build:preload   → Bundle preload (esbuild)
4. build:renderer  → Build React frontend (Vite)
5. build:web       → Build web interface (Vite)
6. build:cli       → Bundle CLI (esbuild)
```

### Configuration Files

| File | Purpose |
|------|---------|
| `tsconfig.json` | Renderer/Web (ESNext, noEmit) |
| `tsconfig.main.json` | Main process (CommonJS) |
| `tsconfig.cli.json` | CLI tool |
| `vite.config.mts` | Renderer Vite config |
| `vite.config.web.mts` | Web interface Vite config |
| `tailwind.config.mjs` | Tailwind CSS |
| `eslint.config.mjs` | ESLint 9 flat config |

---

## Key Implementation Details

### Batched State Updates

The `useBatchedSessionUpdates` hook is **critical** for performance:

```typescript
// Problem: AI streaming produces 100+ updates/second
// Solution: Accumulate in refs, flush every 150ms

const pendingUpdates = useRef<PendingUpdates>({});

// Updates accumulate without causing renders
const appendLog = (sessionId, chunk) => {
  pendingUpdates.current[sessionId] ??= { chunks: [] };
  pendingUpdates.current[sessionId].chunks.push(chunk);
};

// Single flush triggers React re-render
useEffect(() => {
  const interval = setInterval(flush, 150);
  return () => clearInterval(interval);
}, []);
```

### Keyboard Handler Pattern

All context stored in `useRef` to avoid re-attaching listeners:

```typescript
// Store all handler dependencies in ref
const contextRef = useRef({ sessions, activeSession, modals });

// Update ref on every render (no effect dependency change)
useEffect(() => {
  contextRef.current = { sessions, activeSession, modals };
});

// Single stable listener
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    const ctx = contextRef.current; // Always fresh
    // ... handle shortcuts
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []); // Empty deps = never re-attaches
```

### State Machine for Auto Run

Pure function-based state transitions (`batchStateMachine.ts`):

```typescript
// States: IDLE → INITIALIZING → RUNNING → COMPLETING → IDLE
//                                  ↓
//                           PAUSED_ERROR → (RESUME | SKIP | ABORT)

const transition = (context: BatchContext, event: BatchEvent): BatchContext => {
  // Pure function - returns new context without mutations
  // Validates state + event combination
  // Returns unchanged context for invalid transitions
};
```

### Session Persistence Debouncing

`useDebouncedPersistence` prevents disk I/O thrashing:

```typescript
// Flush triggers:
// 1. Timer: 2000ms debounce
// 2. Manual: flushNow() for critical moments
// 3. Visibility: App losing focus
// 4. beforeunload: App quitting
// 5. Unmount: Prevent data loss
```

---

## Common Patterns

### Hook Organization

- **Domain modules**: `/hooks/{domain}/index.ts`
- **Naming**: `use<Feature><Action>` (e.g., `useBatchProcessor`)
- **Memoization**: Selective (58 hooks use useMemo/useCallback)
- **Return types**: Explicit interfaces (e.g., `UseBatchedSessionUpdatesReturn`)

### Component Patterns

| Pattern | Usage |
|---------|-------|
| Props bundling | Large interfaces (MainPanel: 100+ props) |
| Props hooks | `useMainPanelProps` separates deps from props |
| forwardRef | 29 components expose imperative handles |
| React.memo | 49 components for pure optimization |

### Error Handling

- **Structured errors**: `AgentError` type with type, message, recoverable
- **Error boundaries**: Class component with Sentry integration
- **State machine errors**: `PAUSED_ERROR` state with recovery paths

### Logging

```typescript
// Renderer
logger.error('Message', 'ComponentName', { data });

// Main process
logger.info('Message', 'ServiceName');
```

---

## Gotchas and Edge Cases

### Performance

1. **Never store high-frequency data in React state** - Use refs + flush pattern
2. **Memoize props bundles** - Large components need `use<Component>Props` hooks
3. **Empty dependency arrays** - Keyboard handlers use refs to avoid re-attachment

### State Management

1. **Tab state vs Session state** - Tab has `state: 'idle'|'busy'`, Session has complex states
2. **Cumulative stats** - `cumulativeUsageStats` never decreases (for consistent pill display)
3. **Closed tab history** - Up to 25 tabs for undo (Cmd+Shift+T)

### SSH Remote

1. **All file operations support SSH** - Pass `sshRemoteId` to enable remote execution
2. **File watching on SSH** - Returns `isRemote: true` for polling guidance (no native watch)
3. **SSH errors** - Parsed into user-friendly messages by `SshRemoteManager`

### IPC Security

1. **Context isolation enabled** - Renderer cannot access Node.js directly
2. **No direct ipcRenderer** - All calls go through preload wrappers
3. **Unsubscribe pattern** - All event listeners return cleanup functions

### Database

1. **WAL mode** - SQLite uses WAL for concurrent access
2. **Corruption recovery** - Stats DB has auto-recovery from corruption
3. **Weekly VACUUM** - Automatic database optimization

### Build

1. **Four tsconfig files** - Different targets for main/renderer/CLI/lint
2. **Native modules** - `node-pty` and `better-sqlite3` need ASAR unpacking
3. **Prompt generation** - Markdown files compiled to TypeScript at build time

---

## Quick Reference

### Finding Code

| To find... | Look in... |
|------------|------------|
| Agent spawning | `src/main/process-manager/` |
| IPC handlers | `src/main/ipc/handlers/` |
| React components | `src/renderer/components/` |
| State contexts | `src/renderer/contexts/` |
| Hooks | `src/renderer/hooks/{domain}/` |
| Type definitions | `src/shared/types.ts`, `src/renderer/types/` |
| Database operations | `src/main/stats/stats-db.ts` |
| SSH support | `src/main/ssh-remote-manager.ts` |
| Group chat | `src/main/group-chat/` |

### Key File Sizes (Complexity Indicators)

| File | Size | Notes |
|------|------|-------|
| `App.tsx` | ~451KB | Main orchestration (largest) |
| `SettingsModal.tsx` | ~88KB | Most complex modal |
| `index.ts` (main) | ~20KB | App initialization |
| `stats-db.ts` | ~22KB | SQLite operations |
| `batchStateMachine.ts` | ~15KB | Auto Run state logic |

---

*Document generated by automated codebase analysis. For updates, re-run the analysis task.*
