# CLAUDE-IPC: Electron IPC API Surface (Maestro v0.14.5)

> Regenerated 2026-02-17, archived at `__MD_ARCHIVE/CLAUDE-IPC_20260217_182050.md`. Cross-ref `Codebase_Context_20260217_180422.md`.

---

## 1. Overview

Maestro uses Electron's `contextBridge` to expose a typed IPC layer between the renderer and main processes. All APIs are available under `window.maestro.*` with **37 sub-namespaces**.

### Preload Architecture

- **Preload scripts**: `src/main/preload/` (27 module files)
- Each module registers one or more namespaces via `contextBridge.exposeInMainWorld()`
- Handler implementations live in `src/main/ipc/handlers/` (32 files)

### Three IPC Patterns

| Pattern | Usage | Direction | Description |
|---------|-------|-----------|-------------|
| `invoke` | ~95% of calls | Renderer -> Main -> Renderer | Request/response. Returns a Promise. |
| `on` | Push events | Main -> Renderer | Event subscription. Returns an unsubscribe function. |
| `send` | 3 uses only | Renderer -> Main (fire-and-forget) | `confirmQuit`, `cancelQuit`, `process:write` |

All `invoke` calls are wrapped via `safeInvoke()` with error serialization. All `on` subscriptions use `safeOn()` with automatic listener cleanup on window unload. The 3 `send` calls use `safeSend()`.

---

## 2. Complete Namespace Reference

### Core APIs

#### `settings`
Get/set/subscribe to all MaestroSettings fields.
- `get()`, `set(key, value)`, `getAll()`, `setAll(settings)`
- `onChanged(callback)` - push event on any setting change
- `reset()`, `resetKey(key)`

#### `sessions`
Session CRUD with diff-based synchronization.
- `getAll()`, `setAll(sessions)`, `get(id)`, `create(session)`, `update(id, partial)`
- `delete(id)`, `duplicate(id)`, `reorder(ids)`
- `sync(diff)` - diff-based sync to avoid full rewrites
- `onChanged(callback)`

#### `process`
Spawn and manage agent subprocesses. Highest event density in the app.
- **Commands**: `spawn(opts)`, `write(sessionId, data)`, `interrupt(sessionId)`, `kill(sessionId)`, `resize(sessionId, cols, rows)`
- **12 event channels** (all take `sessionId` + `callback`):
  - `onData`, `onExit`, `onUsage`, `onSessionId`
  - `onAgentError`, `onThinkingChunk`, `onToolExecution`
  - `onSlashCommands`, `onStderr`, `onCommandExit`
  - `onTaskToolInvocation`, `onSubagentClear`

#### `fs`
File system operations. Read operations are SSH-aware (see Section 5).
- `readFile(path, opts?)`, `readDir(path)`, `readDirRecursive(path, opts?)`
- `stat(path)`, `exists(path)`
- `writeFile(path, content)`, `mkdir(path, opts?)`
- `rename(oldPath, newPath)`, `unlink(path)`

#### `dialog`
Native OS file/folder dialogs.
- `openDirectory(opts?)`, `openFile(opts?)`, `saveFile(opts?)`

#### `shells`
Shell detection.
- `getAvailableShells()` - returns list of installed shells with paths

#### `shell`
Electron shell utilities (not subprocess shells).
- `openExternal(url)`, `showItemInFolder(path)`

#### `logger`
Application logging control.
- `setLevel(level)`, `getLogLevel()`
- `getLogs(opts?)`, `clearLogs()`
- `onNewLog(callback)` - push event

#### `sync`
Settings/session sync path management.
- `getSyncPath()`, `setSyncPath(path)`

#### `power`
OS power management.
- `preventSleep(reason?)`, `allowSleep()`

#### `fonts`
System font enumeration.
- `getSystemFonts()` - returns font family list

#### `devtools`
DevTools control.
- `toggle()`, `open()`

#### `updates`
Auto-update lifecycle.
- `check()`, `download()`, `install()`
- `getStatus()`, `onStatus(callback)` - push event

#### `app`
Application metadata and lifecycle.
- `getVersion()`, `getPlatform()`, `getArch()`, `getUserDataPath()`
- `quit()`, `relaunch()`
- `onRequestQuitConfirmation(callback)` - push event
- `confirmQuit()`, `cancelQuit()` - both use `safeSend` (fire-and-forget)

---

### Agent APIs

#### `agents`
Agent detection, configuration, and capability discovery. SSH-aware. **24 methods**.
- **Detection**: `detect(opts?)`, `getAvailableAgents()`, `getCapabilities(agentId)`
- **Models**: `getModels(agentId)`, `getDefaultModel(agentId)`
- **Config**: `getConfig(agentId)`, `setConfig(agentId, config)`, `resetConfig(agentId)`
- **Validation**: `validateApiKey(agentId, key)`, `validateEndpoint(agentId, url)`
- **Install**: `isInstalled(agentId)`, `getInstallPath(agentId)`, `install(agentId)`
- **Profiles**: `getProfiles()`, `getProfile(id)`, `createProfile(profile)`, `updateProfile(id, partial)`, `deleteProfile(id)`
- **Remote**: `detectRemote(sshRemoteId)`, `getRemoteCapabilities(sshRemoteId, agentId)`
- **Misc**: `getSystemPrompt(agentId)`, `getTokenLimits(agentId)`, `getVersion(agentId)`, `healthCheck(agentId)`

#### `agentSessions`
Agent session history and message retrieval. **16 methods**.
- **List**: `list(agentId, opts?)`, `listPaginated(agentId, opts?)`
- **Read**: `readMessages(agentId, sessionId)`, `search(agentId, query)`
- **Paths**: `getPath(agentId, sessionId)`
- **Delete**: `delete(agentId, sessionId)`
- **Origins**: `getOrigins()`, `setOrigin(sessionId, origin)`
- **Subagents**: `getSubagents(sessionId)`
- **Stats**: `getGlobalStats()`, `onGlobalStatsUpdate(callback)` - push event
- **Metadata**: `getSessionMeta(sessionId)`, `setSessionMeta(sessionId, meta)`
- **Export**: `exportSession(sessionId, format)`, `exportAll(agentId, format)`

#### `agentError`
Global agent error handling.
- `onError(callback)` - push event
- `clearError()`

#### `claude` (DEPRECATED)
Legacy namespace for Claude-specific session operations. All methods emit `console.warn` via `logDeprecationWarning()`. **Use `agentSessions` instead.**
- Methods mirror a subset of `agentSessions` with Claude-specific naming

---

### Git

#### `git`
Full Git operations suite. SSH-aware. **23 methods**.
- **Status**: `isRepo(path)`, `status(path)`, `diff(path, opts?)`, `numstat(path, opts?)`
- **Stash**: `stash(path, action, opts?)`
- **Commit**: `commit(path, message, opts?)`
- **Remote**: `push(path, opts?)`, `pull(path, opts?)`, `remote(path, action, opts?)`
- **Refs**: `branches(path, opts?)`, `tags(path)`, `log(path, opts?)`, `blame(path, file)`
- **Worktree**: `worktree.create(path, opts)`, `worktree.list(path)`, `worktree.checkout(path, branch)`, `worktree.remove(path, name)`
- **PR**: `createPR(path, opts)`
- **Config**: `getDefaultBranch(path)`, `getConfig(path, key)`, `setConfig(path, key, value)`
- **Misc**: `clone(url, dest, opts?)`, `init(path)`

---

### Web & Live

#### `web`
Web UI authentication and status.
- `getToken()`, `getPort()`, `isRunning()`

#### `live`
Live collaboration server control.
- `startServer(opts?)`, `stopServer()`

#### `webserver`
Web server lifecycle monitoring.
- `getStatus()`, `onStatusChange(callback)` - push event

#### `tunnel`
Tunnel/ngrok-style remote access.
- `start(opts?)`, `stop()`
- `getUrl()`, `onStatusChange(callback)` - push event

---

### Automation

#### `autorun`
File-watching automation engine. **14 methods**.
- **Watch**: `watchFolder(path, opts?)`, `unwatchFolder(path)`
- **Documents**: `getDocuments(path)`, `readDocument(path, docId)`, `writeDocument(path, docId, content)`
- **Stats**: `getStats(path)`
- **Config**: `getConfig()`, `setConfig(config)`, `getConfigForPath(path)`, `setConfigForPath(path, config)`
- **Events**: `onFileChanged(callback)` - push event
- **Control**: `pause(path)`, `resume(path)`, `getStatus(path)`

#### `playbooks`
Reusable automation playbook management. **7 methods**.
- `list()`, `get(id)`, `create(playbook)`, `update(id, partial)`, `delete(id)`
- `import(data)`, `export(id)`

#### `history`
Session and automation history tracking. **10 methods**.
- `getEntries(opts?)`, `addEntry(entry)`, `updateEntry(id, partial)`, `deleteEntry(id)`
- `clearForSession(sessionId)`, `getForSession(sessionId)`
- `search(query, opts?)`, `getStats()`
- `onExternalChange(callback)` - push event
- `export(format?)`

#### `cli`
CLI activity monitoring.
- `getActivity()`, `onActivityChange(callback)` - push event

#### `tempfile`
Temporary file management.
- `create(opts?)`, `cleanup(id?)`

---

### Analytics

#### `stats`
Usage statistics and cost tracking. **16 methods**.
- **Queries**: `getAggregated(opts?)`, `getByDateRange(start, end)`, `getBySession(sessionId)`
- **Costs**: `getDailyCosts(opts?)`, `getCostsByModel(opts?)`, `getCostsByAgent(opts?)`
- **AutoRun**: `getAutoRunStats(opts?)`
- **Tokens**: `getTokenMetrics(opts?)`
- **Export**: `exportCsv(opts?)`
- **Maintenance**: `purge(before)`, `vacuum()`
- **Events**: `onUpdated(callback)` - push event
- **Misc**: `getOverview()`, `getSummary(period)`, `getTopSessions(opts?)`, `reset()`

#### `documentGraph`
File relationship tracking.
- `getFiles(sessionId?)`, `onFilesChanged(callback)` - push event

#### `audit`
Session audit and reconstruction. **9 methods**.
- `runAudit(sessionId)`, `getHistory(opts?)`
- `getSchedule()`, `setSchedule(schedule)`
- `deleteSnapshot(id)`
- `getReconstructionStatus(sessionId)`, `startReconstruction(sessionId)`, `cancelReconstruction(sessionId)`
- `onUpdated(callback)` - push event

#### `reconstruction`
Standalone reconstruction control (overlaps with audit).
- `getStatus(sessionId)`, `start(sessionId)`

#### `leaderboard`
Gamification and scoring. **7 methods**.
- `getScores(opts?)`, `getAchievements(userId?)`
- `getBadge(userId?)`, `getHistory(userId?)`
- `getStats()`, `getRanking(opts?)`
- `onUpdated(callback)` - push event

---

### Features

#### `groupChat`
Multi-agent group conversations. **18+ methods, 8 event channels**.
- **Lifecycle**: `create(opts)`, `join(chatId)`, `leave(chatId)`, `close(chatId)`
- **Messages**: `sendMessage(chatId, msg)`, `getHistory(chatId, opts?)`, `clearHistory(chatId)`
- **Participants**: `getParticipants(chatId)`, `addParticipant(chatId, p)`, `removeParticipant(chatId, p)`
- **Config**: `getConfig(chatId)`, `setConfig(chatId, config)`
- **State**: `getState(chatId)`, `list()`, `getStats()`
- **Control**: `pause(chatId)`, `resume(chatId)`, `interrupt(chatId)`
- **8 event channels**: `onMessage`, `onParticipantUpdate`, `onError`, `onThinkingUpdate`, `onStateChange`, `onTyping`, `onToolExecution`, `onComplete`

#### `projectFolders`
Project organization. **10+ methods**.
- `list()`, `create(folder)`, `update(id, partial)`, `delete(id)`
- `addSession(folderId, sessionId)`, `removeSession(folderId, sessionId)`
- `reorder(ids)`, `getForSession(sessionId)`
- `getStats(folderId)`, `search(query)`
- `onChanged(callback)` - push event

#### `promptLibrary`
Prompt template management. **9 methods**.
- `list(opts?)`, `get(id)`, `create(prompt)`, `update(id, partial)`, `delete(id)`
- `search(query)`, `getCategories()`
- `import(data)`, `export(id?)`

#### `knowledgeGraph`
Persistent knowledge storage.
- `save(data)`, `list(opts?)`, `get(id)`, `delete(id)`

#### `feedback`
User feedback on agent responses.
- `submitRating(sessionId, messageId, rating)`, `getRatings(sessionId?)`

#### `context`
Context grooming for agent sessions.
- `groomContext(sessionId, opts)` - single-call API (preferred)
- **DEPRECATED**: `createGroomingSession()`, `sendGroomingPrompt(sessionId, prompt)`, `cleanupGroomingSession(sessionId)` - legacy multi-step flow

#### `marketplace`
Extension/plugin marketplace.
- `list(opts?)`, `get(id)`, `install(id)`, `update(id)`, `uninstall(id)`

---

### Commands

#### `speckit`
Speckit command integration.
- `getPrompts(opts?)`, `getMetadata(commandId)`
- `getCommand(commandId)`, `listCommands()`
- `getConfig()`, `setConfig(config)`

#### `openspec`
OpenSpec command integration (same shape as speckit).
- `getPrompts(opts?)`, `getMetadata(commandId)`
- `getCommand(commandId)`, `listCommands()`
- `getConfig()`, `setConfig(config)`

---

### UI

#### `attachments`
File attachment management for chat sessions.
- `add(sessionId, file)`, `remove(sessionId, attachmentId)`
- `list(sessionId)`, `getContent(sessionId, attachmentId)`
- `clear(sessionId)`

#### `notification`
Desktop notification control.
- `show(opts)`, `requestPermission()`, `isEnabled()`

#### `debug`
Debug package generation for bug reports.
- `generatePackage(opts?)`, `getPackagePath()`

---

## 3. Push Events Reference

All push events flow Main -> Renderer via `safeOn()` subscriptions.

| Source Namespace | Event Channels | Count |
|-----------------|----------------|-------|
| `process:*` | data, exit, usage, session-id, error, thinking-chunk, tool-execution, slash-commands, stderr, command-exit, task-tool-invocation, subagent-clear | 12 |
| `groupChat:*` | message, participantUpdate, error, thinkingUpdate, stateChange, typing, toolExecution, complete | 8 |
| `remote:*` | connected, disconnected, error, output, status, fileChanged, processExit, reconnecting | 8 |
| `settings` | changed | 1 |
| `sessions` | changed | 1 |
| `stats` | updated | 1 |
| `documentGraph` | filesChanged | 1 |
| `agentSessions` | globalStatsUpdate | 1 |
| `agentError` | error | 1 |
| `updates` | status | 1 |
| `webserver` | statusChange | 1 |
| `tunnel` | statusChange | 1 |
| `history` | externalChange | 1 |
| `cli` | activityChange | 1 |
| `autorun` | fileChanged | 1 |
| `audit` | updated | 1 |
| `reconstruction` | updated | 1 |
| `leaderboard` | updated | 1 |
| `projectFolders` | changed | 1 |
| `logger` | newLog | 1 |
| `app` | requestQuitConfirmation | 1 |
| `system` | theme-changed | 1 |
| **Total** | | **~47** |

---

## 4. IPC Handler Modules

Located in `src/main/ipc/handlers/`. Each file registers channels for one or more namespaces.

| File | Namespace(s) | Channels |
|------|-------------|----------|
| `settings.ts` | settings | 7 |
| `sessions.ts` | sessions | 10 |
| `process.ts` | process | 17 |
| `fs.ts` | fs | 9 |
| `dialog.ts` | dialog | 3 |
| `shells.ts` | shells | 1 |
| `shell.ts` | shell | 2 |
| `logger.ts` | logger | 5 |
| `sync.ts` | sync | 2 |
| `power.ts` | power | 2 |
| `fonts.ts` | fonts | 1 |
| `devtools.ts` | devtools | 2 |
| `updates.ts` | updates | 5 |
| `app.ts` | app | 10 |
| `agents.ts` | agents | 24 |
| `agent-sessions.ts` | agentSessions | 16 |
| `agent-error.ts` | agentError | 2 |
| `claude.ts` | claude (deprecated) | 6 |
| `git.ts` | git | 23 |
| `web.ts` | web | 3 |
| `live.ts` | live | 2 |
| `webserver.ts` | webserver | 2 |
| `tunnel.ts` | tunnel | 4 |
| `autorun.ts` | autorun | 14 |
| `playbooks.ts` | playbooks | 7 |
| `history.ts` | history | 10 |
| `cli.ts` | cli | 2 |
| `tempfile.ts` | tempfile | 2 |
| `stats.ts` | stats | 16 |
| `document-graph.ts` | documentGraph | 2 |
| `audit.ts` | audit, reconstruction | 11 |
| `leaderboard.ts` | leaderboard | 7 |
| `group-chat.ts` | groupChat | 26 |
| `project-folders.ts` | projectFolders | 11 |
| `prompt-library.ts` | promptLibrary | 9 |
| `knowledge-graph.ts` | knowledgeGraph | 4 |
| `feedback.ts` | feedback | 2 |
| `context.ts` | context | 4 |
| `marketplace.ts` | marketplace | 5 |
| `speckit.ts` | speckit | 6 |
| `openspec.ts` | openspec | 6 |
| `attachments.ts` | attachments | 5 |
| `notification.ts` | notification | 3 |
| `debug.ts` | debug | 2 |

**Total**: 32 handler files, ~300 IPC channels across 37 namespaces.

---

## 5. SSH Remote Support

The following namespaces accept `sshRemoteId` and/or `remoteCwd` parameters for remote execution:

| Namespace | Remote Parameters | Notes |
|-----------|------------------|-------|
| `fs` | `sshRemoteId` | Read operations only (readFile, readDir, readDirRecursive, stat, exists) |
| `agents` | `sshRemoteId` | detect, getAvailableAgents, getCapabilities, detectRemote, getRemoteCapabilities |
| `git` | `sshRemoteId`, `remoteCwd` | All path-based operations |
| `process` | `sshRemoteId`, `remoteCwd` | spawn (remote agent processes) |

Remote connections are managed by the SSH connection pool in `src/main/ssh/`. The `sshRemoteId` maps to a stored SSH configuration including host, port, user, and key path.

---

## 6. Deprecated APIs

| API | Status | Migration |
|-----|--------|-----------|
| `claude.*` (entire namespace) | Deprecated v0.13.0 | Use `agentSessions.*` - all methods have 1:1 equivalents |
| `context.createGroomingSession()` | Deprecated v0.14.0 | Use `context.groomContext()` single-call API |
| `context.sendGroomingPrompt()` | Deprecated v0.14.0 | Use `context.groomContext()` single-call API |
| `context.cleanupGroomingSession()` | Deprecated v0.14.0 | Use `context.groomContext()` single-call API |

All deprecated methods log warnings via `logDeprecationWarning()` which emits to `console.warn` with a migration hint. They remain functional but will be removed in v0.15.0.

---

## 7. Quick Reference: Channel Naming Convention

```
Namespace:action          -> invoke handler
Namespace:on-EventName    -> push event subscription
Namespace:send-Action     -> fire-and-forget (3 total)
```

Examples:
- `settings:get` -> invoke
- `process:on-data` -> push event
- `app:send-confirmQuit` -> fire-and-forget
