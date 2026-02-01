# Maestro Codebase Architecture Reference

> **Purpose**: This document provides comprehensive architectural context for AI agents working on the Maestro codebase. It eliminates the need for exploratory file reading.

---

## Quick Reference

| Aspect | Details |
|--------|---------|
| **Framework** | Electron 28.3.3 + React 18.2.0 + TypeScript 5.3.3 |
| **Build Tool** | Vite 5.0.11 |
| **Version** | 0.14.5 |
| **Package Manager** | npm |
| **Entry Point (Main)** | `/app/Maestro/src/main/index.ts` |
| **Entry Point (Renderer)** | `/app/Maestro/src/renderer/App.tsx` |
| **Primary Types** | `/app/Maestro/src/shared/types.ts` and `/app/Maestro/src/renderer/types/index.ts` |

---

## 1. Project Structure

```
/app/Maestro/
├── src/
│   ├── main/                 # Electron main process (Node.js)
│   │   ├── index.ts          # App initialization (640 lines)
│   │   ├── agent-detector.ts # Agent detection & CLI args (31KB)
│   │   ├── agent-capabilities.ts # Capability flags (13KB)
│   │   ├── agent-session-storage.ts # Session persistence
│   │   ├── stats-db.ts       # SQLite analytics (56KB)
│   │   ├── ssh-remote-manager.ts # SSH configuration
│   │   ├── process-manager/  # PTY/subprocess management
│   │   ├── ipc/handlers/     # 26 IPC handler modules
│   │   ├── parsers/          # Agent output parsing
│   │   ├── storage/          # Session storage implementations
│   │   ├── stores/           # Persistent state (electron-store)
│   │   ├── group-chat/       # Multi-agent orchestration
│   │   ├── web-server/       # HTTP/WebSocket for mobile/web
│   │   └── preload/          # Secure IPC bridge
│   │
│   ├── renderer/             # React desktop UI
│   │   ├── App.tsx           # Main component (13,173 lines)
│   │   ├── components/       # 118 UI components
│   │   ├── contexts/         # 10 React contexts
│   │   ├── hooks/            # 50+ custom hooks
│   │   ├── types/            # Renderer type definitions
│   │   ├── services/         # IPC wrapper services
│   │   └── constants/        # Themes, shortcuts, etc.
│   │
│   ├── shared/               # Cross-process types
│   │   ├── types.ts          # Primary type definitions
│   │   ├── group-chat-types.ts
│   │   └── theme-types.ts
│   │
│   ├── web/                  # Web/mobile interface
│   ├── cli/                  # CLI tooling
│   ├── prompts/              # System prompts (markdown)
│   └── __tests__/            # Test suite
│
├── e2e/                      # Playwright E2E tests
├── dist/                     # Compiled output
└── package.json
```

---

## 2. Core Data Types

### Session (Primary UI State)

**Location**: `/app/Maestro/src/renderer/types/index.ts` (lines 435-623)

```typescript
interface Session {
  // Identity
  id: string;
  groupId?: string;
  name: string;
  toolType: ToolType;  // 'claude-code' | 'codex' | 'opencode' | 'terminal'

  // State
  state: SessionState; // 'idle' | 'busy' | 'waiting_input' | 'connecting' | 'error'
  inputMode: 'terminal' | 'ai';

  // File System
  cwd: string;
  fullPath: string;
  projectRoot: string;

  // Logs (deprecated - use aiTabs[].logs)
  aiLogs: LogEntry[];
  shellLogs: LogEntry[];
  workLog: WorkLogItem[];

  // Multi-Tab Support (IMPORTANT)
  aiTabs: AITab[];
  activeTabId: string;
  closedTabHistory: ClosedTab[];

  // Usage Statistics
  usageStats?: UsageStats;
  contextUsage: number;  // 0-100 context window percentage

  // Error Handling
  agentError?: AgentError;
  agentErrorPaused?: boolean;

  // SSH Remote
  sshRemote?: { id: string; name: string; host: string };
  sshRemoteId?: string;

  // Auto Run
  autoRunFolderPath?: string;
  autoRunSelectedFile?: string;

  // Execution Queue (for sequential messages)
  executionQueue: QueuedItem[];

  // ... 50+ total fields
}

interface AITab {
  id: string;
  agentSessionId: string | null;  // Claude's session UUID
  name: string | null;
  logs: LogEntry[];
  usageStats?: UsageStats;
  state: 'idle' | 'busy';
  readOnlyMode?: boolean;
  // ... 20+ fields
}

interface LogEntry {
  id: string;
  timestamp: number;
  source: 'stdout' | 'stderr' | 'system' | 'error' | 'thinking' | 'tool';
  text: string;
  sessionId?: string;
}
```

### Agent Configuration

**Location**: `/app/Maestro/src/shared/types.ts`

```typescript
type ToolType = 'claude' | 'claude-code' | 'aider' | 'opencode' | 'codex' | 'terminal';

interface AgentConfig {
  id: string;
  name: string;
  binaryName: string;  // e.g., 'claude'
  command: string;
  args: string[];
  available: boolean;
  path?: string;
  capabilities: AgentCapabilities;
  // ... 40+ fields
}

interface AgentCapabilities {
  supportsResume: boolean;
  supportsReadOnlyMode: boolean;
  supportsJsonOutput: boolean;
  supportsSessionId: boolean;
  supportsImageInput: boolean;
  supportsSlashCommands: boolean;
  supportsSessionStorage: boolean;
  supportsCostTracking: boolean;
  supportsUsageStats: boolean;
  supportsBatchMode: boolean;
  supportsStreaming: boolean;
  supportsThinkingDisplay: boolean;
  supportsContextMerge: boolean;
  supportsContextExport: boolean;
  // 19 capability flags total
}
```

### Usage Statistics

```typescript
interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  totalCostUsd: number;
  contextWindow: number;
  reasoningTokens?: number;
}
```

### SSH Remote

```typescript
interface SshRemoteConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  privateKeyPath?: string;
  useSshConfig?: boolean;
}

interface AgentSshRemoteConfig {
  enabled: boolean;
  remoteId: string | null;
  workingDirOverride?: string;
}
```

### Group Chat

**Location**: `/app/Maestro/src/shared/group-chat-types.ts`

```typescript
interface GroupChat {
  id: string;
  name: string;
  moderatorAgentId: string;
  moderatorSessionId: string;
  participants: GroupChatParticipant[];
  logPath: string;
}

interface GroupChatParticipant {
  name: string;
  agentId: string;
  sessionId: string;
  agentSessionId?: string;
  color?: string;
}
```

---

## 3. IPC Communication

### Architecture

```
┌─────────────────────┐     IPC Channels      ┌─────────────────────┐
│   Main Process      │ ◄──────────────────► │  Renderer Process   │
│   (Node.js)         │                       │  (React/Chromium)   │
├─────────────────────┤                       ├─────────────────────┤
│ ipc/handlers/*.ts   │                       │ window.maestro.*    │
│ ↓                   │                       │ ↓                   │
│ preload/*.ts        │ ─── contextBridge ──► │ services/*.ts       │
└─────────────────────┘                       └─────────────────────┘
```

### Key IPC Channels

| Namespace | Purpose | Example Channel |
|-----------|---------|-----------------|
| `settings` | User preferences | `settings:get`, `settings:set` |
| `process` | Agent execution | `process:spawn`, `process:write`, `process:kill` |
| `agents` | Agent management | `agents:detect`, `agents:getCapabilities` |
| `agentSessions` | Session persistence | `agentSessions:get`, `agentSessions:save` |
| `git` | Git operations | `git:status`, `git:diff`, `git:commit` |
| `fs` | File system | `fs:readFile`, `fs:writeFile`, `fs:exists` |
| `autorun` | Auto Run documents | `autorun:listDocuments`, `autorun:getContent` |
| `groupChat` | Group chat | `groupChat:create`, `groupChat:sendMessage` |
| `sshRemote` | SSH remotes | `sshRemote:list`, `sshRemote:test` |
| `web` | Web interface | `web:start`, `web:broadcast` |
| `stats` | Analytics | `stats:getGlobalStats` |

### Usage Pattern

```typescript
// In renderer code:
const agents = await window.maestro.agents.detect();
const session = await window.maestro.agentSessions.get('claude-code', sessionId);
await window.maestro.process.write(sessionId, 'Hello');
```

---

## 4. React Contexts

### SessionContext (Most Important)

**Location**: `/app/Maestro/src/renderer/contexts/SessionContext.tsx`

```typescript
interface SessionContextValue {
  sessions: Session[];
  setSessions: React.Dispatch<SetStateAction<Session[]>>;
  groups: Group[];
  setGroups: React.Dispatch<SetStateAction<Group[]>>;
  activeSessionId: string | null;
  setActiveSessionId: (id: string | null) => void;
  batchedUpdater: BatchedUpdater;  // For performance
  sessionsRef: React.RefObject<Session[]>;  // For callbacks
}
```

### Other Contexts

| Context | Purpose |
|---------|---------|
| `AutoRunContext` | Auto Run document state |
| `GroupChatContext` | Group chat list and state |
| `InputContext` | Per-tab input value, staged images |
| `LayerStackContext` | Modal z-index management |
| `ModalContext` | Modal visibility state |
| `ToastContext` | Toast notifications |
| `GitStatusContext` | Git status per session |

---

## 5. Key Hooks

### Session Management

| Hook | Purpose | Location |
|------|---------|----------|
| `useBatchedSessionUpdates` | Batched React updates (150ms) | `hooks/session/` |
| `useSortedSessions` | Session list sorting | `hooks/session/` |
| `useSessionNavigation` | Session cycling | `hooks/session/` |
| `useGroupManagement` | Group CRUD | `hooks/session/` |

### Agent Execution

| Hook | Purpose | Location |
|------|---------|----------|
| `useAgentExecution` | Spawn agents, route output | `hooks/agent/` |
| `useAgentErrorRecovery` | Handle agent errors | `hooks/agent/` |
| `useAgentCapabilities` | Feature detection | `hooks/agent/` |

### Auto Run

| Hook | Purpose | Location |
|------|---------|----------|
| `useBatchProcessor` | Main batch orchestrator | `hooks/batch/` |
| `useAutoRunFolder` | Folder watching | `hooks/batch/` |
| `useBatchTaskTracking` | Task count updates | `hooks/batch/` |

---

## 6. Process Management

### ProcessManager

**Location**: `/app/Maestro/src/main/process-manager/ProcessManager.ts`

```typescript
class ProcessManager {
  spawn(config: ProcessConfig): Promise<{ pid: number }>;
  write(sessionId: string, data: string): void;
  resize(sessionId: string, cols: number, rows: number): void;
  interrupt(sessionId: string): void;  // SIGINT
  kill(sessionId: string): void;       // SIGTERM
  getProcess(sessionId: string): ManagedProcess | undefined;
}
```

### Spawners

- **PtySpawner** (`spawners/PtySpawner.ts`) - For interactive terminals
- **ChildProcessSpawner** (`spawners/ChildProcessSpawner.ts`) - For batch/headless

### Output Parsing

**Location**: `/app/Maestro/src/main/parsers/`

```typescript
interface ParsedEvent {
  type: 'init' | 'text' | 'tool_use' | 'result' | 'error' | 'usage' | 'system';
  sessionId?: string;
  text?: string;
  toolName?: string;
  usage?: UsageStats;
}
```

Agent-specific parsers:
- `claude-output-parser.ts` - Stream JSON events
- `codex-output-parser.ts` - Codex JSON format
- `opencode-output-parser.ts` - OpenCode format

---

## 7. Key Components

### Layout Components

| Component | Purpose |
|-----------|---------|
| `App.tsx` | Main coordinator (13K lines) |
| `MainPanel.tsx` | Center workspace (AI/terminal) |
| `SessionList.tsx` | Left sidebar |
| `RightPanel.tsx` | Right sidebar (Files, History, Auto Run) |
| `TabBar.tsx` | Tab navigation |
| `InputArea.tsx` | Message input |

### Modal Components

| Component | Purpose |
|-----------|---------|
| `AppModals.tsx` | Modal aggregator |
| `SettingsModal.tsx` | Settings UI |
| `NewGroupChatModal.tsx` | Create group chat |
| `EditGroupChatModal.tsx` | Edit group chat |
| `AutoRunSetupModal.tsx` | Auto Run configuration |
| `QuickActionsModal.tsx` | Command palette |

### Feature Components

| Feature | Components |
|---------|-----------|
| **Auto Run** | `AutoRun.tsx`, `AutoRunDocumentSelector.tsx`, `BatchRunnerModal.tsx` |
| **Group Chat** | `GroupChatPanel.tsx`, `GroupChatInput.tsx`, `SendToAgentModal.tsx` |
| **Git** | `GitStatusWidget.tsx`, `GitDiffViewer.tsx`, `CreatePRModal.tsx` |
| **History** | `HistoryPanel.tsx`, `HistoryDetailModal.tsx` |
| **Wizard** | `MaestroWizard.tsx`, `InlineWizard/*` |

---

## 8. Key Patterns

### Batched Updates Pattern

**Location**: `/app/Maestro/src/renderer/hooks/session/useBatchedSessionUpdates.ts`

For high-frequency updates (streaming output):

```typescript
// Accumulates updates for 150ms before applying
const batchedUpdater = useBatchedSessionUpdates(setSessions, {
  flushInterval: 150,
});

// Usage (many calls batched into single render)
batchedUpdater.appendLog(sessionId, tabId, text);
batchedUpdater.updateUsage(sessionId, stats);
batchedUpdater.setStatus(sessionId, 'busy');
```

### Modal Stack Pattern

**Location**: `/app/Maestro/src/renderer/contexts/LayerStackContext.tsx`

```typescript
// Push modal to stack (handles z-index and Escape key)
layerStack.pushLayer({
  id: 'my-modal',
  priority: MODAL_PRIORITIES.SETTINGS,
  onEscape: handleClose,
});

// Pop when closing
layerStack.popLayer();
```

### Session Update Pattern

```typescript
// Direct update
setSessions(prev => prev.map(s =>
  s.id === sessionId ? { ...s, state: 'busy' } : s
));

// Batched update (for streaming)
batchedUpdater.appendLog(sessionId, tabId, newText);
```

---

## 9. Agent System

### Supported Agents

| Agent | Binary | Key Capabilities |
|-------|--------|------------------|
| `claude-code` | `claude` | Resume, read-only, JSON output, images, thinking display |
| `codex` | `codex` | Resume, JSON output, batch mode |
| `opencode` | `opencode` | Streaming, batch mode |
| `terminal` | User shell | None (raw terminal) |

### Agent Detection Flow

```
main/agent-detector.ts
├── Check PATH for binary
├── Run `which <binary>`
├── Build args from config
└── Return AgentConfig with capabilities
```

### Agent CLI Args (Claude Code)

```typescript
const baseArgs = [
  '--print',
  '--verbose',
  '--output-format', 'stream-json',
  '--dangerously-skip-permissions'
];

// Resume adds: --resume <sessionId>
// Read-only adds: --permission-mode plan
```

---

## 10. Group Chat System

### Architecture

```
User Message
    ↓
Moderator Agent (orchestrates)
    ↓
Parse @mentions → Delegate to participants
    ↓
Participants work in parallel
    ↓
All respond → Moderator synthesizes
    ↓
Synthesis returned to user
```

### Key Files

| File | Purpose |
|------|---------|
| `group-chat-router.ts` | Message routing |
| `group-chat-moderator.ts` | Moderator orchestration |
| `group-chat-agent.ts` | Participant management |
| `group-chat-storage.ts` | Persistence |
| `group-chat-log.ts` | JSONL message log |

---

## 11. Web Server

### Architecture

**Location**: `/app/Maestro/src/main/web-server/`

```
Fastify Server (random port)
├── Security token (UUID per session)
├── REST API (sessions, settings)
├── WebSocket (real-time sync)
└── Static assets (web UI)

URL: http://localhost:PORT/$TOKEN/
```

### WebSocket Protocol

```typescript
// Client → Server
{ type: 'subscribe', payload: { sessionId } }
{ type: 'write', payload: { sessionId, data } }

// Server → Client
{ type: 'session-update', payload: { sessionId, logs, state } }
{ type: 'log-entry', payload: { sessionId, entry } }
```

---

## 12. SSH Remote

### Configuration

**Location**: `/app/Maestro/src/main/ssh-remote-manager.ts`

```typescript
interface SshRemoteConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  privateKeyPath?: string;
}
```

### Remote Agent Detection

```typescript
// In NewGroupChatModal.tsx and EditGroupChatModal.tsx
const sshRemoteId = sshRemoteConfig?.enabled ? sshRemoteConfig.remoteId : undefined;
const agents = await window.maestro.agents.detect(sshRemoteId);

// Agents on remote have same structure but detected via SSH
```

---

## 13. Settings Storage

### Store Instances

**Location**: `/app/Maestro/src/main/stores/`

| Store | Purpose |
|-------|---------|
| `settingsStore` | User preferences |
| `sessionsStore` | Active sessions |
| `groupsStore` | Session groups |
| `agentConfigsStore` | Per-agent CLI config |
| `windowStateStore` | Window position/size |

### Data Directory

- **Production**: `~/.config/Maestro/` (Linux) or OS equivalent
- **Development**: `~/.config/maestro-dev/`

---

## 14. Common Tasks

### Adding a New IPC Handler

1. Create handler in `/app/Maestro/src/main/ipc/handlers/myfeature.ts`:
```typescript
export function registerMyFeatureHandlers() {
  ipcMain.handle('myfeature:doSomething', async (_, arg) => {
    return { result: 'done' };
  });
}
```

2. Register in `/app/Maestro/src/main/index.ts`

3. Add preload bridge in `/app/Maestro/src/main/preload/myfeature.ts`

4. Expose in `/app/Maestro/src/main/preload/index.ts`

### Modifying Session State

```typescript
// Get session context
const { sessions, setSessions } = useSession();

// Update session
setSessions(prev => prev.map(s =>
  s.id === targetId ? { ...s, newField: value } : s
));
```

### Adding a Modal

1. Create component in `/app/Maestro/src/renderer/components/`
2. Add state to `AppModals.tsx` or use `ModalContext`
3. Register with `LayerStackContext` for z-index management

### Working with Agent Output

```typescript
// In App.tsx, process:onData handler
window.maestro.process.onData((sessionId, data) => {
  const parser = getOutputParser(session.toolType);
  const event = parser.parseJsonLine(data);

  if (event.type === 'text') {
    batchedUpdater.appendLog(sessionId, activeTabId, event.text);
  }
});
```

---

## 15. Testing

### Test Structure

```
src/__tests__/
├── main/           # Main process unit tests
├── renderer/       # Component tests
├── integration/    # Integration tests
├── e2e/           # E2E tests (Playwright)
└── performance/   # Benchmarks
```

### Running Tests

```bash
npm test           # Unit tests (Vitest)
npm run test:e2e   # E2E tests (Playwright)
```

---

## 16. Key Metrics

| Metric | Value |
|--------|-------|
| TypeScript Files | 600+ |
| React Components | 118 |
| Custom Hooks | 50+ |
| IPC Handlers | 26 modules |
| Contexts | 10 |
| Lines of Code | 50,000+ |
| Test Files | 500+ |

---

## Quick Lookup Table

| Need To... | Look At... |
|------------|------------|
| Understand session structure | `src/renderer/types/index.ts:435-623` |
| Add IPC handler | `src/main/ipc/handlers/` + `src/main/preload/` |
| Modify React state | `src/renderer/contexts/SessionContext.tsx` |
| Add new component | `src/renderer/components/` |
| Parse agent output | `src/main/parsers/` |
| Manage processes | `src/main/process-manager/` |
| Handle SSH remotes | `src/main/ssh-remote-manager.ts` |
| Group chat logic | `src/main/group-chat/` |
| Web server | `src/main/web-server/` |
| Settings persistence | `src/main/stores/` |
| Agent detection | `src/main/agent-detector.ts` |
| Agent capabilities | `src/main/agent-capabilities.ts` |

---

*Last updated: January 2026*
