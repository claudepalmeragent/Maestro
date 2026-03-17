---
type: reference
title: 'Maestro Codebase Context — Comprehensive Analysis'
created: 2026-02-17
version: '0.14.5'
tags:
  - codebase-context
  - architecture
  - maestro
  - electron
  - react
related:
  - '[[CLAUDE.md]]'
  - '[[ARCHITECTURE.md]]'
  - '[[CONTRIBUTING.md]]'
  - '[[CLAUDE-PATTERNS.md]]'
  - '[[CLAUDE-IPC.md]]'
  - '[[CLAUDE-AGENTS.md]]'
---

# Maestro Codebase Context Document

**Generated:** 2026-02-17 18:04:22 UTC
**Codebase Version:** 0.14.5
**Repository:** https://github.com/pedramamini/maestro.git
**License:** AGPL 3.0
**Author:** Pedram Amini (pedram@runmaestro.ai)
**Analysis Period:** Full codebase with special attention to changes since 2026-01-31

---

## Executive Summary

Maestro is an **Electron desktop application** for managing multiple AI coding assistants simultaneously with a keyboard-first interface. It supports Claude Code, OpenAI Codex, OpenCode, and terminal sessions in a unified workspace with multi-tab conversations, group chat (multi-agent collaboration), Auto Run (batch task orchestration), SSH remote execution, and comprehensive usage analytics.

### Key Statistics

- **Source Files:** ~500+ TypeScript/TSX files across 5 major subsystems
- **App.tsx:** 468KB / 13,943 lines — the main coordinator component
- **IPC Channels:** ~340 channels across 32 handler modules
- **React Components:** 135 TSX files (96 root + 39 in subdirectories)
- **Custom Hooks:** 98 hook files across 12 directories
- **Context Providers:** 11 React contexts
- **Preload Modules:** 27 files (26 modules + 1 entry point), 37 API namespaces
- **Dependencies:** 42 production, 35 development
- **Test Configs:** 4 Vitest configs + Playwright E2E
- **183 commits since 2026-01-31** with significant new features

### Key Capabilities

- Multi-agent session management (Claude Code, Codex, OpenCode, terminal)
- Multi-tab AI conversations per session
- Group Chat: coordinated multi-agent discussions with AI moderator
- Auto Run: batch task orchestration with document-driven workflows
- SSH remote execution with ControlMaster pooling
- Usage Dashboard with dual-cost tracking (Anthropic vs Maestro pricing)
- Knowledge Graph: session learning persistence as Markdown
- Prompt Library: saved/reusable prompts with usage tracking
- Project Folders: organizational containers with per-folder pricing
- Document Graph: visual file relationship exploration
- Web/Mobile interface via Fastify + WebSocket
- CLI tooling for batch automation

---

## Architecture Overview

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            ELECTRON APPLICATION                            │
├─────────────────────────────┬───────────────────────────────────────────────┤
│     MAIN PROCESS (Node.js)  │         RENDERER PROCESS (Chromium)          │
│                             │                                              │
│  ┌─────────────────────┐    │    ┌──────────────────────────────────────┐  │
│  │   index.ts (wiring)  │    │    │  App.tsx (468KB coordinator)         │  │
│  │   ├─ IPC Handlers    │    │    │  ├─ SessionProvider                  │  │
│  │   ├─ ProcessManager  │◄───┼────┤  ├─ ProjectFoldersProvider           │  │
│  │   ├─ AgentDetector   │    │    │  ├─ AutoRunProvider                  │  │
│  │   ├─ StatsDB (SQLite)│    │    │  ├─ GroupChatProvider                │  │
│  │   ├─ HistoryManager  │    │    │  ├─ InlineWizardProvider             │  │
│  │   └─ WebServer       │    │    │  └─ InputProvider                    │  │
│  └─────────┬────────────┘    │    └──────────┬───────────────────────────┘  │
│            │                 │               │                              │
│  ┌─────────▼────────────┐    │    ┌──────────▼───────────────────────────┐  │
│  │  preload/index.ts    │────┼───►│  window.maestro.* (37 namespaces)   │  │
│  │  contextBridge       │    │    │  IPC Request/Response + Events       │  │
│  └──────────────────────┘    │    └──────────────────────────────────────┘  │
├──────────────────────────────┴──────────────────────────────────────────────┤
│                        EXTERNAL PROCESSES                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │  Claude  │ │  Codex   │ │ OpenCode │ │ Terminal │ │   SSH Remotes    │  │
│  │  Code    │ │          │ │          │ │  (PTY)   │ │ (ControlMaster)  │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────────────┘  │
├─────────────────────────────────────────────────────────────────────────────┤
│                     WEB / MOBILE INTERFACE                                  │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  Fastify + WebSocket (token-authenticated, rate-limited)              │  │
│  │  ├─ REST API: /api/sessions, /api/session/:id/send, /api/theme       │  │
│  │  └─ WS: subscribe, send_command, switch_mode, tabs, ping             │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow: Agent → User

```
AI Agent Process (PTY/child_process)
    → ProcessManager (parses agent output via typed parsers)
    → EventEmitter events: data, usage, session-id, thinking-chunk, tool-execution, etc.
    → process-listeners/ (setupProcessListeners)
        → safeSend() → mainWindow.webContents.send(channel, args)
        → webServer.broadcastToSessionClients() (WebSocket)
        → statsDB.insert() (SQLite)
    → Preload script (contextBridge) → window.maestro.*
    → React Renderer (contexts, hooks, components)
```

### IPC Communication Pattern

```
Renderer → Main:  ipcRenderer.invoke(channel, ...args)  → Promise<result>   (~95%)
Main → Renderer:  webContents.send(channel, ...args)     → Push events
Renderer → Main:  ipcRenderer.send(channel, ...args)     → Fire-and-forget   (3 uses only)
```

---

## Directory Structure

```
src/
├── main/                    # Electron main process (Node.js)
│   ├── index.ts             # Entry point + IPC setup (24KB, 711 lines)
│   ├── agents/              # Agent detection, capabilities, definitions, path probing
│   ├── app-lifecycle/       # CLI watcher, error handlers, quit handler, window manager
│   ├── debug-package/       # Debug packaging (14 categories, ZIP, privacy-safe)
│   ├── group-chat/          # Multi-agent group chat (9 files)
│   │   ├── moderator.ts     # Moderator spawn logic (batch-mode, not persistent)
│   │   ├── router.ts        # Message routing (user → moderator → participants → synthesis)
│   │   ├── storage.ts       # Chat persistence (metadata.json, chat.log, history.jsonl)
│   │   ├── session-recovery.ts  # Detects session_not_found → respawn with context
│   │   └── output-buffer.ts     # Per-session buffering with max size enforcement
│   ├── ipc/                 # IPC handler registration
│   │   └── handlers/        # 32 handler modules (~340 channels total)
│   ├── parsers/             # Agent output parsers (Claude, Codex, OpenCode)
│   ├── preload/             # 27 preload bridge modules → window.maestro.*
│   ├── process-listeners/   # Event listeners: data, error, exit, stats, usage, etc.
│   ├── process-manager/     # Process spawning (PTY + child_process)
│   │   ├── ProcessManager.ts    # Orchestrator (EventEmitter)
│   │   ├── spawners/        # PtySpawner, ChildProcessSpawner
│   │   ├── runners/         # LocalCommandRunner, SshCommandRunner
│   │   ├── handlers/        # DataBufferManager (50ms/8KB), StdoutHandler, StderrHandler, ExitHandler
│   │   └── utils/           # bufferUtils, envBuilder, imageUtils, pathResolver, streamJsonBuilder
│   ├── services/            # Anthropic audit, audit scheduler, historical reconstruction
│   ├── stats/               # SQLite stats DB (13 modules, 9 migrations, 7 tables)
│   ├── storage/             # Agent session storage (Claude, Codex, OpenCode)
│   ├── stores/              # 10 electron-store instances (settings, sessions, groups, model registry, etc.)
│   ├── utils/               # 27 utility modules (SSH, pricing, auth, logging, etc.)
│   └── web-server/          # Fastify web server (handlers, routes, WebSocket)
│
├── renderer/                # React frontend (desktop)
│   ├── App.tsx              # Main coordinator (468KB, 13,943 lines!)
│   ├── main.tsx             # Entry point (Sentry, ErrorBoundary, providers)
│   ├── global.d.ts          # window.maestro API types (74KB)
│   ├── components/          # 135 TSX files
│   │   ├── DocumentGraph/   # 9 files — visual file relationships
│   │   ├── InlineWizard/    # 12 files — inline /wizard command
│   │   ├── Settings/        # 5 files — settings panels
│   │   ├── UsageDashboard/  # 22 files — usage charts & analytics
│   │   ├── Wizard/          # 17 files — onboarding wizard + tour
│   │   ├── ui/              # 7 files — primitives (BillingModeToggle, etc.)
│   │   └── ... (common, menus, modals, shared, sidebar)
│   ├── hooks/               # 98 hook files across 12 directories
│   │   ├── agent/           # 15 hooks (execution, capabilities, sessions, errors)
│   │   ├── batch/           # 16 hooks (Auto Run orchestration)
│   │   ├── session/         # 8 hooks (batched updates, navigation, sorting)
│   │   ├── input/           # 5 hooks (processing, sync, tab/at-mention completion)
│   │   ├── keyboard/        # 4 hooks (main handler, navigation, shortcuts)
│   │   ├── props/           # 3 hooks (memoized MainPanel, SessionList, RightPanel props)
│   │   ├── settings/        # 3 hooks (settings, theme sync)
│   │   ├── git/             # 2 hooks (status polling, file tree)
│   │   ├── remote/          # 6 hooks (live overlay, web broadcasting, SSH)
│   │   ├── ui/              # 10 hooks (layer stack, modals, scroll, hover)
│   │   ├── utils/           # 3 hooks (throttle, debounced persistence)
│   │   └── prompt-library/  # 1 hook
│   ├── contexts/            # 11 React contexts
│   ├── services/            # 11 IPC wrapper services
│   ├── constants/           # 8 constant files (shortcuts, themes, modal priorities, etc.)
│   ├── types/               # Type definitions (index.ts=39KB, layer.ts, contextMerge.ts, fileTree.ts)
│   └── utils/               # 27 utility modules
│
├── web/                     # Web/mobile interface
│   ├── App.tsx              # Web app root
│   ├── components/          # Shared web components
│   ├── hooks/               # 19 web-specific hooks
│   ├── mobile/              # Mobile-optimized React app (21 files)
│   └── utils/               # Web utilities
│
├── cli/                     # CLI tooling for batch automation
│   ├── index.ts             # CLI entry point
│   ├── commands/            # 7 CLI command implementations
│   ├── services/            # Playbook and batch processing
│   └── output/              # CLI output formatting
│
├── prompts/                 # System prompts (editable .md files) — 22 files
│   ├── wizard-*.md          # 7 wizard conversation prompts
│   ├── autorun-*.md         # Auto Run default/synopsis prompts
│   ├── group-chat-*.md      # 4 group chat prompts
│   ├── context-*.md         # 3 context management prompts
│   ├── openspec/            # OpenSpec command prompts
│   ├── speckit/             # SpecKit command prompts
│   └── index.ts             # Central exports
│
├── shared/                  # Shared types and utilities — 20 files
│   ├── types.ts             # Common type definitions (14.5KB)
│   ├── stats-types.ts       # Stats type definitions (7.6KB)
│   ├── themes.ts            # Theme definitions (17 built-in + custom)
│   ├── formatters.ts        # Shared formatters (10KB)
│   └── ... (gitUtils, pathUtils, stringUtils, treeUtils, templateVariables, etc.)
│
├── generated/               # Auto-generated files
│   └── prompts.ts           # Generated prompt exports from .md files
│
├── __tests__/               # Test suites
│   ├── cli/                 # CLI tests
│   ├── e2e/                 # End-to-end tests
│   ├── integration/         # Integration tests
│   ├── main/                # Main process tests
│   ├── performance/         # Performance tests
│   ├── renderer/            # Renderer tests
│   ├── shared/              # Shared utility tests
│   └── web/                 # Web interface tests
│
└── docs/                    # Mintlify documentation (docs.runmaestro.ai)
    ├── docs.json            # Navigation and configuration
    ├── screenshots/         # Documentation screenshots
    └── *.md                 # Documentation pages
```

---

## Main Process Details

### Entry Point — `src/main/index.ts` (24KB, 711 lines)

A **wiring harness** that connects all subsystems. Progressively refactored from a monolith into modular imports.

**Startup Sequence (inside `app.whenReady()`):**

1. Configure logger (level, buffer size)
2. Log startup info (version, platform)
3. `checkWslEnvironment()` — warn if WSL with Windows mount
4. `cleanupStaleSshSockets()` — remove leftover SSH ControlMaster sockets
5. `new ProcessManager()` — PTY + child process manager
6. `new AgentDetector()` — agent path discovery
7. Load custom agent paths → `agentDetector.setCustomPaths()`
8. `historyManager.initialize()` — migrate legacy → per-session files
9. `historyManager.startWatching()` — watch for CLI changes
10. `initializeStatsDB()` — open SQLite database
11. `scheduleAudits()` — start audit scheduler
12. `setupIpcHandlers()` — register all ~340 IPC channels
13. `setupProcessListeners()` — ProcessManager → IPC forwarding
14. `createWindow()` — BrowserWindow + restore geometry
15. `nativeTheme.on('updated')` — forward dark-mode to renderer
16. `cliWatcher.start()` — poll CLI activity file
17. `app.on('activate')` — macOS dock click recreation

**Key Design Decision:** Web server NOT started at boot — started on-demand via `live:startServer` IPC call.

**Dependency Injection Pattern:** No handler module holds direct references to singletons. All passed as getter functions (`getMainWindow: () => mainWindow`). Handles null during startup/shutdown.

### IPC Handlers — 32 Modules, ~340 Channels

| Namespace                                | Count   | Module             | Key Purpose                                        |
| ---------------------------------------- | ------- | ------------------ | -------------------------------------------------- |
| `agents:*`                               | 24      | agents.ts          | Agent detection, config, paths, models, auth       |
| `agentSessions:*`                        | 16      | agentSessions.ts   | Session storage (list, read, search, subagents)    |
| `process:*`                              | 7       | process.ts         | Spawn, write, kill, resize, remote commands        |
| `claude:*`                               | 15      | claude.ts          | **LEGACY** — Claude-specific session management    |
| `groupChat:*`                            | 23      | groupChat.ts       | Multi-agent chat creation, messaging, participants |
| `settings:*` / `sessions:*` / `groups:*` | 8       | persistence.ts     | Settings and session persistence                   |
| `projectFolders:*`                       | 11      | projectFolders.ts  | Project folder CRUD + pricing                      |
| `git:*`                                  | 26      | git.ts             | Git operations, worktree, PR creation              |
| `fs:*`                                   | 10      | filesystem.ts      | File system operations                             |
| `stats:*`                                | 17      | stats.ts           | Usage analytics, cost breakdowns                   |
| `audit:*`                                | 9       | audit.ts           | Anthropic vs Maestro usage auditing                |
| `autorun:*`                              | 14      | autorun.ts         | Auto Run document management                       |
| `promptLibrary:*`                        | 9       | prompt-library.ts  | Saved prompts CRUD                                 |
| `knowledgeGraph:*`                       | 4       | knowledge-graph.ts | Session learnings as Markdown                      |
| `feedback:*`                             | 2       | feedback.ts        | Like/dislike AI response ratings                   |
| Plus 15+ more                            | Various | Various            | system, web, leaderboard, etc.                     |

### Process Management

**PTY vs child_process Selection:**

- **PTY** (`node-pty`): terminal sessions, explicit `requiresPty`. xterm-256color, 100x30 default.
- **child_process**: All AI agents (batch/streaming). Windows `.cmd`/`.bat` with `shell: true`.

**Agent Types:**
| Agent | Parser | Notes |
|-------|--------|-------|
| `claude-code` | ClaudeOutputParser | stream-json, session-id extraction, usage, tool-use blocks |
| `codex` | CodexOutputParser | Cumulative usage → delta normalization |
| `opencode` | OpenCodeOutputParser | Partial text events as `thinking-chunk` |
| `terminal` | No parser | PTY raw output, control sequence stripping |

**Output Pipeline:**

```
stdout → StdoutHandler (JSON parse) → DataBufferManager (50ms/8KB batch) → emit('data')
stderr → StderrHandler (error detection) → emit('stderr') / emit('agent-error')
exit   → ExitHandler (batch parse, cleanup) → emit('exit')
```

**Three-Layer Error Detection:**

1. Line-level: `outputParser.detectErrorFromLine()` + `matchSshErrorPattern()`
2. Exit-level: `outputParser.detectErrorFromExit(code, stderr, stdout)`
3. Spawn failure: `childProcess.on('error')` → emit agent-error with recoverable flag

### Stats Database — SQLite + WAL Mode

**Schema (9 migrations, 7 tables):**

| Table               | Purpose                                                        |
| ------------------- | -------------------------------------------------------------- |
| `_migrations`       | Migration audit log                                            |
| `_meta`             | Internal key-value                                             |
| `query_events`      | Core analytics — one row per AI query/response with dual costs |
| `auto_run_sessions` | One row per Auto Run batch execution                           |
| `auto_run_tasks`    | One row per agent invocation within Auto Run                   |
| `session_lifecycle` | Session open/close tracking                                    |
| `audit_snapshots`   | Periodic cost comparison snapshots                             |
| `audit_schedule`    | Scheduled audit configuration                                  |

**Dual-Cost Model:** `COALESCE(SUM(maestro_cost_usd), SUM(total_cost_usd), 0)` for backward compat. Savings = Anthropic cost - Maestro cost (Max/free tier).

**Performance:** `StatementCache` (Map) avoids repeated `db.prepare()`. Weekly VACUUM only if >100MB.

### App State Stores — 10 electron-store Instances

| Store                            | Path                  | Synced?               | Purpose                                                      |
| -------------------------------- | --------------------- | --------------------- | ------------------------------------------------------------ |
| `maestro-bootstrap`              | `userData/`           | Per-device            | Sync path config                                             |
| `maestro-settings`               | `syncPath/`           | Yes                   | All user preferences                                         |
| `maestro-sessions`               | `syncPath/`           | Yes                   | Session definitions                                          |
| `maestro-groups`                 | `syncPath/`           | Yes                   | Session groups                                               |
| `maestro-project-folders`        | `syncPath/`           | Yes                   | Project folder list                                          |
| `maestro-agent-configs`          | `productionDataPath/` | **Always production** | Per-agent configs                                            |
| `maestro-window-state`           | `userData/`           | Per-device            | Window geometry                                              |
| `maestro-claude-session-origins` | `syncPath/`           | Yes                   | Claude session metadata                                      |
| `maestro-agent-session-origins`  | `syncPath/`           | Yes                   | Non-Claude agent metadata                                    |
| `maestro-model-registry`         | `productionDataPath/` | Per-device            | Claude model pricing, aliases, metadata (runtime-updateable) |

### Group Chat System

**Architecture:** Coordinated multi-agent conversation with three roles: user (human), moderator (AI coordinator), participants (AI agents).

**Critical Design:** Moderator is **NOT a persistent process**. Each message spawns a fresh batch process with full context. Prevents context window exhaustion.

**Routing Flow:**

```
User message → routeUserMessage()
  → Auto-detect @mentions, auto-add matching sessions
  → Build prompt: system prompt + participant list + last 20 messages
  → Spawn moderator batch process

Moderator response → routeModeratorResponse()
  → Log + emit + record history
  → Scan for @mentions → spawn participant batch processes
  → Track in pendingParticipantResponses

Participant response → routeAgentResponse()
  → Log + emit + update stats
  → markParticipantResponded() → if last → spawnModeratorSynthesis()

Synthesis → moderator with synthesis prompt + last 30 messages
  → Loop: if @mentions → more participants; if none → idle (done)
```

### Web Server — Fastify + WebSocket

**Security:** Random UUID token regenerated on restart. All URLs require token as first path segment. Invalid token → redirect to `https://runmaestro.ai`.

**API Routes:**
| Endpoint | Rate Limit | Description |
|----------|------------|-------------|
| `GET /<token>/api/sessions` | 100/min | All sessions with live info |
| `POST /<token>/api/session/:id/send` | 30/min | Send command |
| `POST /<token>/api/session/:id/interrupt` | 30/min | Interrupt session |
| `GET /<token>/api/theme` | 100/min | Current theme |

**Design Principle:** All mutating operations forwarded to renderer via IPC. Renderer is single source of truth for session state.

---

## Renderer Process Details

### App.tsx — Main Coordinator (468KB, 13,943 lines)

**State Architecture:**

- 8 local `useState` — input values kept local for performance (avoids context re-renders per keystroke)
- 11 `useRef` — stale closure prevention, one-time guards, stable callback access
- 44 `useEffect` — session loading, ref sync, persistence, focus management, tour sync
- 150+ `useCallback` — modal handlers, session/tab management, agent execution
- 16 `useMemo` — computed values (activeTab, theme, suggestions)

**Context Provider Wrapping:**

```jsx
<SessionProvider>
	<ProjectFoldersProvider>
		<AutoRunProvider>
			<GroupChatProvider>
				<InlineWizardProvider>
					<InputProvider>
						<MaestroConsoleInner />
					</InputProvider>
				</InlineWizardProvider>
			</GroupChatProvider>
		</AutoRunProvider>
	</ProjectFoldersProvider>
</SessionProvider>
```

Plus `<GitStatusProvider>` wrapping the return JSX.

**Entry point wrapping (`main.tsx`):**

```
ErrorBoundary → ToastProvider → LayerStackProvider → ModalProvider → UILayoutProvider → WizardProvider → MaestroConsole
```

**JSX Layout:**

```
<GitStatusProvider>
  <div flex h-screen>
    {isDraggingImage && <DropOverlay />}
    <TitleBar />
    <AppModals {...extensiveProps} />
    {sessions.length === 0 ? <EmptyStateView /> : (
      <>
        <SessionList />                    {/* LEFT SIDEBAR */}
        {logViewerOpen ? <LogViewer /> :
         activeGroupChatId ? <GroupChatPanel /> :
         <MainPanel />}                     {/* CENTER */}
        <RightPanel /> or <GroupChatRightPanel />  {/* RIGHT SIDEBAR */}
      </>
    )}
    <SettingsModal />
    {wizardState.isOpen && <MaestroWizard />}
    {tourOpen && <TourOverlay />}
    <FlashNotifications />
    <ToastContainer />
  </div>
</GitStatusProvider>
```

### Context Providers (11 total)

| Context               | Key Purpose                                                               |
| --------------------- | ------------------------------------------------------------------------- |
| SessionContext        | Sessions, groups, active session, batched updates, memoized selectors     |
| ModalContext          | 45+ centralized modal visibility states                                   |
| UILayoutContext       | Sidebar, focus, file explorer, drag/drop, flash notifications             |
| InputContext          | Slash commands, tab completion, @mentions, command history                |
| GroupChatContext      | Group chat state, participants, thinking, error                           |
| AutoRunContext        | Document list, tree, loading, task counts                                 |
| GitStatusContext      | Three-context split: branch, file status, detail (re-render optimization) |
| InlineWizardContext   | Inline /wizard command state                                              |
| LayerStackContext     | Global Escape key handling, modal/overlay priority                        |
| ProjectFoldersContext | Project folder management with IPC persistence                            |
| ToastContext          | Toast queue, audio TTS, OS notifications                                  |

**All contexts follow the same pattern:**

- `createContext<T | null>(null)` with null default
- Custom `use*()` hooks with null-check error throwing
- `useMemo` for context value to prevent unnecessary re-renders

### Performance Optimization Patterns (11 key patterns)

1. **`useDeferredValue(inputValue)`** — defers expensive component re-renders
2. **Refs for callback stability** — avoid re-renders in memoized callbacks
3. **150+ `useCallback`** — prevent child re-renders
4. **Memoized props** — `useMainPanelProps`, `useSessionListProps`, `useRightPanelProps` hooks
5. **Debounced input values** — 50ms tab completion, 100ms @mention (only when menus open)
6. **Conditional effect dependencies** — skip debounce when menu closed
7. **Debounced session persistence** — 100+/sec → <1/sec during streaming
8. **Conditional component mounting** — `{isOpen && <Component />}`
9. **Memoized `activeTab`** — avoid O(n) `.find()` per keystroke
10. **30-second debounce on mouse move** — activity tracking
11. **`useBatchedSessionUpdates`** — batches 100+ rapid updates/sec into 150ms flushes

### Styling Approach

**Stack:** Tailwind CSS + Custom CSS (no CSS modules, no styled-components)

- Font: JetBrains Mono → Fira Code → Courier New (monospace stack)
- Theme application via inline styles + Tailwind utility classes
- `themeMode`: 'light' | 'dark' | 'system' with separate `lightThemeId` and `darkThemeId`
- 17 built-in themes + custom theme support
- CSS animations: `fade-in`, `slide-up`, `slide-down`
- `@media (prefers-reduced-motion: reduce)` support
- Theme is **always prop-drilled** (no theming Context) — `theme: Theme` is a universal required prop

---

## Type System Overview

### Core Data Model Hierarchy

```
ProjectFolder (top-level organizational container)
  ├── Group (session container)
  │   └── Session (50+ fields — the central data model)
  │       ├── AITab[] (multi-tab AI conversations)
  │       │   ├── LogEntry[] (stdout/stderr/system/user/ai/error/thinking/tool)
  │       │   ├── UsageStats (tokens, cost, context window)
  │       │   ├── SessionWizardState (inline wizard per tab)
  │       │   └── AgentError? (tab-scoped error)
  │       ├── QueuedItem[] (sequential execution queue)
  │       ├── FileArtifact[] (changed files)
  │       ├── WorktreeConfig? (git worktree)
  │       ├── BatchRunState? (Auto Run state machine)
  │       └── SshRemoteConfig? (SSH remote execution)
  └── GroupChat (multi-agent collaboration)
      ├── GroupChatParticipant[]
      ├── GroupChatMessage[]
      ├── GroupChatHistoryEntry[]
      └── ModeratorConfig?
```

### Key Types

**Session** (`src/renderer/types/index.ts`) — 50+ fields organized into domains:

- Identity: `id`, `groupId?`, `name`, `toolType`, `state`
- Paths: `cwd`, `fullPath`, `projectRoot`, `remoteCwd?`
- Multi-tab: `aiTabs: AITab[]`, `activeTabId`, `closedTabHistory`
- Usage: `contextUsage`, `usageStats?`, `currentCycleTokens?`
- Execution: `executionQueue`, `aiPid`, `busySource?`, `inputMode`
- SSH Remote: `sshRemote?`, `sshRemoteId?`, `sessionSshRemoteConfig?`
- Agent Config: `customPath?`, `customArgs?`, `customModel?`
- Project Folders: `projectFolderIds?: string[]` (one-to-many)

**AITab** — Multi-tab conversation model with `agentSessionId`, `logs: LogEntry[]`, `usageStats`, `cumulativeUsageStats`, `wizardState?`, `rating?`, etc.

**LogEntry** — Universal message format with `source` ('stdout'|'stderr'|'system'|'user'|'ai'|'error'|'thinking'|'tool'), `text`, `rating?`, `metadata?`.

**SessionState** = `'idle' | 'busy' | 'waiting_input' | 'connecting' | 'error'`

**UsageStats** — `inputTokens`, `outputTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens`, `totalCostUsd`, `contextWindow`, `reasoningTokens?`, `detectedModel?`.

**QueryEvent** (stats DB) — One row per AI query with dual costs: `anthropicCostUsd`, `maestroCostUsd`, `maestroBillingMode` ('api'|'max'|'free').

### Agent Capabilities (19 flags)

| Flag                    | claude-code | codex | opencode | terminal |
| ----------------------- | ----------- | ----- | -------- | -------- |
| supportsResume          | Yes         | Yes   | Yes      | No       |
| supportsReadOnlyMode    | Yes         | No    | Yes      | No       |
| supportsImageInput      | Yes         | No    | Yes      | No       |
| supportsSlashCommands   | Yes         | No    | No       | No       |
| supportsModelSelection  | Yes         | Yes   | No       | No       |
| supportsBatchMode       | Yes         | Yes   | Yes      | No       |
| supportsRemoteExecution | Yes         | No    | No       | No       |

7 total agents defined: `claude-code`, `terminal`, `codex`, `gemini-cli`, `qwen3-coder`, `aider`, `opencode`.

---

## Build System

### Build Pipeline Order

```
1. build:prompts   → generate TypeScript from markdown prompts
2. build:main      → compile main process TypeScript
3. build:preload   → bundle preload script (esbuild → CJS)
4. build:renderer  → Vite build for desktop
5. build:web       → Vite build for web interface
6. build:cli       → esbuild bundle for CLI
```

### Configuration Files

| File                  | Purpose                                                                      |
| --------------------- | ---------------------------------------------------------------------------- |
| `package.json`        | v0.14.5, 42 prod deps, 35 dev deps, 30+ npm scripts, electron-builder config |
| `tsconfig.json`       | Base TypeScript config (renderer), ES2020 target, ESNext module              |
| `tsconfig.main.json`  | Main process, CommonJS output to dist/                                       |
| `tsconfig.cli.json`   | CLI, CommonJS output to dist/cli/                                            |
| `vite.config.mts`     | Desktop renderer, port 5173                                                  |
| `vite.config.web.mts` | Web interface, port 5174, chunk splitting                                    |
| `eslint.config.mjs`   | Flat config, TypeScript + React + Prettier                                   |
| `tailwind.config.mjs` | Content: renderer + web, JetBrains Mono font                                 |

### Test Configuration

| Config                          | Environment | Timeout | Notes                                      |
| ------------------------------- | ----------- | ------- | ------------------------------------------ |
| `vitest.config.mts`             | jsdom       | 10s     | V8 coverage, excludes integration/e2e/perf |
| `vitest.integration.config.ts`  | jsdom       | 180s    | Forked, sequential, bail on first failure  |
| `vitest.performance.config.mts` | jsdom       | 30s     | Performance benchmarks                     |
| `vitest.e2e.config.ts`          | node        | 30s     | WebSocket/server tests                     |
| `playwright.config.ts`          | Electron    | 60s     | Sequential, single worker                  |

### Key Dependencies

| Package                       | Purpose                   |
| ----------------------------- | ------------------------- |
| `electron` ^28.3.3            | Runtime                   |
| `react` / `react-dom` ^18.2.0 | UI framework              |
| `better-sqlite3` ^12.5.0      | Stats database            |
| `node-pty` ^1.1.0             | PTY for terminal sessions |
| `fastify` ^4.25.2             | Web server                |
| `tailwindcss` ^3.4.1          | CSS framework             |
| `recharts` ^3.6.0             | Charts (Usage Dashboard)  |
| `reactflow` ^11.11.4          | Node graph UI             |
| `mermaid` ^11.12.1            | Diagram rendering         |
| `js-tiktoken` ^1.0.21         | Token counting            |

### Platform Packaging

| Platform | Formats            | Architectures |
| -------- | ------------------ | ------------- |
| macOS    | DMG, ZIP           | x64, arm64    |
| Windows  | NSIS, Portable     | x64           |
| Linux    | AppImage, DEB, RPM | default       |

---

## Key Implementation Details

### Preload Bridge — `window.maestro.*` (37 namespaces)

The preload (`src/main/preload/index.ts`) uses a single `contextBridge.exposeInMainWorld('maestro', {...})` call to expose 37 namespaces. Each namespace is built by a factory function returning a plain object of methods.

**Security:**

- `contextIsolation: true`, `nodeIntegration: false`
- macOS `hardenedRuntime: true`
- All event handlers discard `_event` parameter

**SSH-aware modules:** agents, fs (read ops), git, autorun, sessions (agentSessions), process, reconstruction.

**Deprecated API:** `window.maestro.claude.*` emits console.warn on every call. Use `agentSessions.*` instead.

### Agent Session Storage (3 implementations)

| Storage                | Location                             | Format                |
| ---------------------- | ------------------------------------ | --------------------- |
| ClaudeSessionStorage   | `~/.claude/projects/<encoded-path>/` | JSONL                 |
| CodexSessionStorage    | `~/.codex/sessions/YYYY/MM/DD/`      | JSONL (two formats)   |
| OpenCodeSessionStorage | `~/.local/share/opencode/storage/`   | Individual JSON files |

Common interface: `listSessions`, `listSessionsPaginated`, `readSessionMessages`, `searchSessions`, `getSessionPath`, `deleteMessagePair`.

### SSH Remote Execution

- SSH via ControlMaster pooling at `/tmp/maestro-ssh-*`
- `SshCommandRunner` with exponential backoff retry (3 attempts)
- Commands wrapped as `$SHELL -lc "command"` for proper shell init
- Socket cleanup at startup and shutdown
- Session-level SSH resolution (no global defaults)

### Pricing System

- **Model pricing externalized** to `maestro-model-registry.json` electron-store (10th store instance)
- **Runtime-updateable:** new models can be added without code changes or rebuilds
- **Auto-detection:** model checker scrapes Anthropic pricing page on startup, auto-adds new models to the registry
- **10+ Claude models shipped as defaults** (opus-4-6, sonnet-4-6, haiku-4-5, etc.) with ~30 aliases
- **Three billing modes:** 'api', 'max', 'free'
- **Billing mode precedence:** agent-level → project folder → auto-detected → 'api'
- **Max billing:** cache tokens free
- **Dual-cost tracking:** Anthropic cost vs Maestro cost, savings calculated

---

## Common Patterns

### Hook Structure

- **Organization:** Domain subdirectories with barrel `index.ts` exports
- **Naming:** `useHookName`, `UseHookNameDeps` (params), `UseHookNameReturn` (return)
- **Rules:** Every returned function wrapped in `useCallback`; "ref mirror" pattern for stale closure prevention; `useMemo` for derived state; effects always include cleanup
- **State machines:** `useReducer` with co-located pure transition functions (no xstate)

### Component Composition

- 95%+ functional components (only `ErrorBoundary` and `ChartErrorBoundary` are class components)
- `memo(function Name({...}: NameProps) {...})` — standard pattern
- Theme always prop-drilled, never via Context
- One component per file; features grouped by domain directory
- No HOCs or render props — Context + Hook pattern instead

### Error Handling

- **Main process:** `createIpcHandler()` factory wraps all handlers with `{ success, error }` return
- **Global:** `uncaughtException` and `unhandledRejection` caught, logged, never crash
- **Renderer:** `ErrorBoundary` at root, `ChartErrorBoundary` for charts with retry
- **Agent errors:** 7 error types with per-type recovery actions via `useAgentErrorRecovery`
- **Auto-clear:** Successful data arrival on errored session clears error automatically

### State Update Patterns

| Pattern                 | Mechanism                       | Purpose                                          |
| ----------------------- | ------------------------------- | ------------------------------------------------ |
| Streaming batch         | 150ms flush interval            | Batches 100+ IPC events/sec into single setState |
| Per-session debounce    | 200ms pending updates           | Batch progress updates                           |
| Session persistence     | 2s debounce                     | Disk writes limited to 1/2s                      |
| Ref mirrors             | `xRef.current = x` every render | Stale closure prevention                         |
| State machine           | `useReducer` + pure FSM         | Batch processing (6 states, 18 actions)          |
| Context value stability | `useMemo` wrapping              | Prevent cascade re-renders                       |

### Logging

- Custom in-house logger (no third-party)
- Levels: `debug`, `info`, `warn`, `error` + `toast` (user-facing) + `autorun`
- Namespace convention: `const LOG_CONTEXT = '[ModuleName]'`
- Main process: EventEmitter + 1000-entry ring buffer + optional file logging
- ~971 raw `console.*` calls remain across 110 files

---

## Gotchas and Edge Cases

1. **App.tsx is 468KB** — The largest complexity hotspot. Changes require understanding 150+ callbacks, 44 effects, and 16 memos. Decomposition is ongoing via context extraction (6 phases completed).

2. **Theme is prop-drilled, NOT via Context** — This is intentional for performance. Every component receives `theme: Theme` as a prop.

3. **`window.maestro.claude.*` is DEPRECATED** — Use `window.maestro.agentSessions.*` instead. The old API emits console warnings.

4. **PTY vs child_process is NOT agent-based** — It's determined by `toolType === 'terminal' || requiresPty === true`. All AI agents use child_process.

5. **Moderator is NOT persistent** — Group chat moderator spawns fresh for each message. This is by design to prevent context exhaustion.

6. **Web server is NOT started at boot** — Started on-demand via `live:startServer` IPC call.

7. **Stats cost uses COALESCE** — `COALESCE(SUM(maestro_cost_usd), SUM(total_cost_usd), 0)` for backward compatibility with pre-dual-cost data.

8. **Agent session storage varies by agent** — Claude uses JSONL, Codex uses JSONL (two formats), OpenCode uses individual JSON files. Each has its own storage implementation.

9. **Codex usage is CUMULATIVE** — Unlike Claude (per-message), Codex reports cumulative usage. Parser normalizes to deltas.

10. **`react-hooks/exhaustive-deps` is OFF** — Intentional. The ref mirror pattern is used extensively, and many effects intentionally omit deps.

11. **Agent IDs stripped of suffixes** — `agentId` in stats DB uses stable identifier (e.g., `claude-code` not `claude-code-1`).

12. **File watching doesn't work over SSH** — Remote sessions use polling intervals instead of event-based watching.

---

## Quick Reference Tables

### Common Tasks → Key Files

| Task                      | Primary Files                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------- |
| Add IPC handler           | `src/main/ipc/handlers/`, `src/main/preload/`, `src/main/index.ts`                 |
| Add UI component          | `src/renderer/components/`                                                         |
| Add keyboard shortcut     | `src/renderer/constants/shortcuts.ts`, `App.tsx`                                   |
| Add theme                 | `src/shared/themes.ts`                                                             |
| Add modal                 | Component + `src/renderer/constants/modalPriorities.ts` + register in ModalContext |
| Add setting               | `src/renderer/hooks/useSettings.ts`, `src/main/stores/types.ts`                    |
| Add template variable     | `src/shared/templateVariables.ts`                                                  |
| Modify system prompts     | `src/prompts/*.md`                                                                 |
| Configure agent           | `src/main/agents/definitions.ts`, `src/main/agents/capabilities.ts`                |
| Add agent parser          | `src/main/parsers/`, register in `initializeOutputParsers()`                       |
| Add CLI command           | `src/cli/commands/`, `src/cli/index.ts`                                            |
| Add stats feature         | `src/main/stats/`, `src/main/ipc/handlers/stats.ts`                                |
| Add Usage Dashboard chart | `src/renderer/components/UsageDashboard/`                                          |

### Quick Commands

```bash
npm run dev           # Development with hot reload
npm run dev:prod-data # Development using production data
npm run dev:web       # Web interface development
npm run build         # Full production build
npm run test          # Run unit tests
npm run test:watch    # Tests in watch mode
npm run lint          # TypeScript type checking
npm run lint:eslint   # ESLint checks
npm run clean         # Clean build artifacts
npm run package       # Package for all platforms
```

### Standardized UI Terms

| Term              | Meaning                                          | Component         |
| ----------------- | ------------------------------------------------ | ----------------- |
| Left Bar          | Left sidebar with session list                   | `SessionList.tsx` |
| Right Bar         | Right sidebar with Files, History, Auto Run tabs | `RightPanel.tsx`  |
| Main Window       | Center workspace                                 | `MainPanel.tsx`   |
| AI Terminal       | Main window in AI mode                           | Part of MainPanel |
| Command Terminal  | Main window in terminal/shell mode               | Part of MainPanel |
| System Log Viewer | Special view for system logs                     | `LogViewer.tsx`   |

### Session State Colors

| Color          | Meaning             |
| -------------- | ------------------- |
| Green          | Ready/idle          |
| Yellow         | Agent thinking/busy |
| Red            | No connection/error |
| Pulsing Orange | Connecting          |

---

## Changes Since 2026-01-31

### Summary

183 commits spanning 2026-01-31 to 2026-02-17 introduced significant new features and patterns.

### New Features

- **Project Folders** — Organizational containers with per-folder pricing configs
- **Anthropic Usage Audit** — Compares Maestro vs Anthropic billing via `ccusage` CLI
- **Knowledge Graph** — Session learnings persisted as Markdown files
- **AI Response Feedback** — Like/dislike rating system with Markdown logging
- **Prompt Library** — Saved/reusable prompts with usage tracking
- **Billing Mode System** — Three-mode (auto/max/api) with per-folder configs
- **SSH ControlMaster Pooling** — Socket management at `/tmp/maestro-ssh-*`
- **Dual-Source Theme Sync** — `useThemeSync` listens to CSS + Electron's nativeTheme
- **Context Grooming** — New single-call API replacing deprecated multi-step flow
- **Stats DB v9** — `tasks_completed_count` per Auto Run task

### New Architectural Patterns

1. **Context + Ref anti-stale-closure** — Contexts expose both reactive state AND refs
2. **Memoized selector hooks** — `useSessionState(id)`, `useSessionLogs(id, tabId?)`
3. **Subscription-based change notifications** — `useSessionSubscription` with typed callbacks
4. **Module decomposition** — `stats-db.ts` → `src/main/stats/` (13 files), `agent-detector.ts` → `src/main/agents/` (6 files)
5. **IPC-backed CRUD context providers** — `ProjectFoldersContext`
6. **Markdown-file persistence** — Feedback and Knowledge Graph use append-to-Markdown

### New UI Components (22+)

BillingModeToggle, PricingModelDropdown, DataSourceToggle, ColorPicker, ProjectFolderHeader, ProjectColorBars, MoveToProjectMenu, GroupChatThinkingBubble, SubagentListItem, BatchRunStats, AuditResultModal, ReconstructionPreviewModal, AuditHistoryTable, AuditsSettingsTab, AuditReportPanel, AgentThroughputChart, ThroughputTrendsChart, AgentCostGraph, CostByModelGraph, CostOverTimeGraph, PromptLibrarySearchBar, AutoRunExpandedModal

### New/Modified Hooks

- `useBillingMode` (Feb 17) — billing mode resolution
- `useDocumentProcessor` (Feb 17) — extracted from batch processor
- `useBatchProcessor` (Feb 17) — 2076 lines, Phase 3 subagent stats polling
- `useMainKeyboardHandler` (Feb 16) — 763 lines, shortcut updates
- `useMainPanelProps` (Feb 16) — performance optimization
- `useBatchedSessionUpdates` (Feb 13) — batching optimization

### Modified IPC Handlers (since Jan 31)

- `stats.ts` (Feb 17), `knowledge-graph.ts` (Feb 17), `feedback.ts` (Feb 16), `agents.ts` (Feb 13), `process.ts` (Feb 13), `persistence.ts` (Feb 13), `audit.ts` (Feb 13), `reconstruction.ts` (Feb 10), `projectFolders.ts` (Feb 9), `claude.ts` (Feb 5), `prompt-library.ts` (Feb 3), `groupChat.ts` (Feb 2), `context.ts` (Feb 1), `debug.ts` (Feb 1)

### Build/Config Changes

- Added `@types/plist` and `@types/verror` dev dependencies
- No changes to tsconfig, Vite, ESLint, Tailwind, or test configs

---

## Related Documents

- [[CLAUDE.md]] — Main agent instructions and quick reference
- [[ARCHITECTURE.md]] — Detailed architecture documentation
- [[CONTRIBUTING.md]] — Development setup and contribution guide
- [[CLAUDE-PATTERNS.md]] — Core implementation patterns
- [[CLAUDE-IPC.md]] — IPC API surface documentation
- [[CLAUDE-AGENTS.md]] — Supported agents and capabilities
- [[CLAUDE-SESSION.md]] — Session interface and code conventions
- [[CLAUDE-PERFORMANCE.md]] — Performance best practices
- [[CLAUDE-WIZARD.md]] — Wizard and tour system
- [[CLAUDE-FEATURES.md]] — Usage Dashboard and Document Graph features
