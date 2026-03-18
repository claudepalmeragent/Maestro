# IPC & Preload API Reference

The `window.maestro` object exposes ~33 namespaces with ~120 IPC channels. Each namespace is defined as a preload module in `src/main/preload/` and backed by handler registrations in `src/main/ipc/handlers/`.

For the main guide, see [[CLAUDE.md]]. For the Session data model, see [[CLAUDE-SESSION]].

---

## Core APIs

### window.maestro.fs (Filesystem)

Preload: `src/main/preload/fs.ts` · Handler: `src/main/ipc/handlers/filesystem.ts`

| Method                                                           | IPC Channel             | Description                                                                                                           |
| ---------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `diagLog(tag, data?)`                                            | `fs:diagLog`            | Diagnostic logging relay — renderer logs to main process (console.\* stripped in prod)                                |
| `homeDir()`                                                      | `fs:homeDir`            | Get user home directory                                                                                               |
| `readDir(dirPath, sshRemoteId?)`                                 | `fs:readDir`            | Read directory contents; returns `DirectoryEntry[]` with name, isDirectory, isFile, path                              |
| `readFile(filePath, sshRemoteId?)`                               | `fs:readFile`           | Read file contents as UTF-8 text; images returned as base64 data URLs; returns `null` for ENOENT                      |
| `writeFile(filePath, content, sshRemoteId?)`                     | `fs:writeFile`          | Write content to file                                                                                                 |
| `stat(filePath, sshRemoteId?)`                                   | `fs:stat`               | Get file/directory stats: size, createdAt, modifiedAt, isDirectory, isFile                                            |
| `directorySize(dirPath, sshRemoteId?)`                           | `fs:directorySize`      | Calculate directory size recursively (skips node_modules, \_\_pycache\_\_); returns totalSize, fileCount, folderCount |
| `rename(oldPath, newPath, sshRemoteId?)`                         | `fs:rename`             | Rename file or directory                                                                                              |
| `delete(targetPath, options?)`                                   | `fs:delete`             | Delete file or directory; options: `{ recursive?, sshRemoteId? }`                                                     |
| `countItems(dirPath, sshRemoteId?)`                              | `fs:countItems`         | Count files and folders recursively (for delete confirmation)                                                         |
| `fetchImageAsBase64(url)`                                        | `fs:fetchImageAsBase64` | Fetch image from URL and return as base64 data URL; SSRF-protected (blocks private networks)                          |
| `loadFileTree(dirPath, sshRemoteId, maxDepth?, ignorePatterns?)` | `fs:loadFileTree`       | Load full file tree in one SSH round-trip using `find` (SSH remote only)                                              |

### window.maestro.git (Git Operations)

Preload: `src/main/preload/git.ts` · Handler: `src/main/ipc/handlers/git.ts`

**Basic Operations** — All accept optional `sshRemoteId` and `remoteCwd` for SSH remote execution:

| Method                                       | IPC Channel    | Description                                                               |
| -------------------------------------------- | -------------- | ------------------------------------------------------------------------- |
| `status(cwd, sshRemoteId?, remoteCwd?)`      | `git:status`   | Get `git status --porcelain` output                                       |
| `diff(cwd, file?, sshRemoteId?, remoteCwd?)` | `git:diff`     | Get git diff (optionally for a specific file)                             |
| `isRepo(cwd, sshRemoteId?, remoteCwd?)`      | `git:isRepo`   | Check if directory is inside a git work tree                              |
| `numstat(cwd, sshRemoteId?, remoteCwd?)`     | `git:numstat`  | Get `git diff --numstat` output                                           |
| `branch(cwd, sshRemoteId?, remoteCwd?)`      | `git:branch`   | Get current branch name                                                   |
| `branches(cwd, sshRemoteId?, remoteCwd?)`    | `git:branches` | List all branches (local + remote)                                        |
| `tags(cwd, sshRemoteId?, remoteCwd?)`        | `git:tags`     | List all tags                                                             |
| `remote(cwd, sshRemoteId?, remoteCwd?)`      | `git:remote`   | Get origin remote URL                                                     |
| `info(cwd, sshRemoteId?, remoteCwd?)`        | `git:info`     | Get comprehensive info: branch, remote, behind, ahead, uncommittedChanges |

**Advanced Queries:**

| Method                                         | IPC Channel       | Description                                                                      |
| ---------------------------------------------- | ----------------- | -------------------------------------------------------------------------------- |
| `log(cwd, options?, sshRemoteId?, remoteCwd?)` | `git:log`         | Get git log with limit, skip, search; returns `GitLogEntry[]`                    |
| `commitCount(cwd, sshRemoteId?, remoteCwd?)`   | `git:commitCount` | Get total commit count                                                           |
| `show(cwd, hash, sshRemoteId?, remoteCwd?)`    | `git:show`        | Show a specific commit (stat + patch)                                            |
| `showFile(cwd, ref, filePath)`                 | `git:showFile`    | Get file content at a specific ref; base64 for images, raw for text (local only) |

**Worktree Management** — Support SSH remote via optional `sshRemoteId`:

| Method                                                                      | IPC Channel                    | Description                                                               |
| --------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------- |
| `worktreeInfo(worktreePath, sshRemoteId?)`                                  | `git:worktreeInfo`             | Get worktree info: exists, isWorktree, currentBranch, repoRoot            |
| `getRepoRoot(cwd, sshRemoteId?)`                                            | `git:getRepoRoot`              | Get repository root directory                                             |
| `worktreeSetup(mainRepoCwd, worktreePath, branchName, sshRemoteId?)`        | `git:worktreeSetup`            | Create or reuse a worktree; validates path is not nested inside main repo |
| `worktreeCheckout(worktreePath, branchName, createIfMissing, sshRemoteId?)` | `git:worktreeCheckout`         | Checkout a branch in a worktree (checks for uncommitted changes)          |
| `listWorktrees(cwd, sshRemoteId?)`                                          | `git:listWorktrees`            | List all worktrees for a repository                                       |
| `scanWorktreeDirectory(parentPath, sshRemoteId?)`                           | `git:scanWorktreeDirectory`    | Scan directory for git repos/worktrees; returns first hit only            |
| `watchWorktreeDirectory(sessionId, worktreePath, sshRemoteId?)`             | `git:watchWorktreeDirectory`   | Watch for new worktrees (local only; returns isRemote for SSH)            |
| `unwatchWorktreeDirectory(sessionId)`                                       | `git:unwatchWorktreeDirectory` | Stop watching a worktree directory                                        |
| `removeWorktree(worktreePath, force?)`                                      | `git:removeWorktree`           | Remove a worktree from disk (local only)                                  |
| `onWorktreeDiscovered(callback)`                                            | `worktree:discovered` event    | Subscribe to discovered worktree events                                   |

**GitHub CLI Integration:**

| Method                                                          | IPC Channel            | Description                                                           |
| --------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------- |
| `createPR(worktreePath, baseBranch, title, body, ghPath?)`      | `git:createPR`         | Push branch and create a GitHub PR using `gh` CLI                     |
| `checkGhCli(ghPath?)`                                           | `git:checkGhCli`       | Check if GitHub CLI is installed and authenticated (cached for 1 min) |
| `getDefaultBranch(cwd)`                                         | `git:getDefaultBranch` | Get default branch name (main/master)                                 |
| `createGist(filename, content, description, isPublic, ghPath?)` | `git:createGist`       | Create a GitHub Gist from file content                                |

### window.maestro.process (Agent Lifecycle)

Preload: `src/main/preload/process.ts` · Handler: `src/main/ipc/handlers/process.ts`

**Process Management:**

| Method                          | IPC Channel                  | Description                                                                                                      |
| ------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `spawn(config)`                 | `process:spawn`              | Start a new process (agent or terminal); handles SSH remote, model selection, YOLO mode, images, custom env vars |
| `write(sessionId, data)`        | `process:write`              | Write data to process stdin                                                                                      |
| `interrupt(sessionId)`          | `process:interrupt`          | Send SIGINT (Ctrl+C) to a process                                                                                |
| `kill(sessionId)`               | `process:kill`               | Terminate a process                                                                                              |
| `resize(sessionId, cols, rows)` | `process:resize`             | Resize PTY terminal dimensions                                                                                   |
| `runCommand(config)`            | `process:runCommand`         | Execute a single command and capture stdout/stderr (no PTY); supports SSH remote                                 |
| `getActiveProcesses()`          | `process:getActiveProcesses` | List all running processes with metadata                                                                         |

**Process Events (renderer subscriptions):**

| Method                           | IPC Event                      | Description                                    |
| -------------------------------- | ------------------------------ | ---------------------------------------------- |
| `onData(callback)`               | `process:data`                 | Process data output                            |
| `onExit(callback)`               | `process:exit`                 | Process exit (sessionId, code, resultEmitted)  |
| `onSessionId(callback)`          | `process:session-id`           | Agent session ID detected                      |
| `onSlashCommands(callback)`      | `process:slash-commands`       | Slash commands discovered from agent           |
| `onThinkingChunk(callback)`      | `process:thinking-chunk`       | Thinking/streaming content chunks              |
| `onToolExecution(callback)`      | `process:tool-execution`       | Tool execution events                          |
| `onTaskToolInvocation(callback)` | `process:task-tool-invocation` | Subagent spawned via Task tool                 |
| `onSubagentClear(callback)`      | `process:subagent-clear`       | Subagent task completed                        |
| `onSshRemote(callback)`          | `process:ssh-remote`           | SSH remote execution status                    |
| `onUsage(callback)`              | `process:usage`                | Usage statistics (tokens, cost, model)         |
| `onAgentError(callback)`         | `agent:error`                  | Agent errors (auth expired, rate limits, etc.) |
| `onStderr(callback)`             | `process:stderr`               | Stderr stream from runCommand                  |
| `onCommandExit(callback)`        | `process:command-exit`         | Command exit from runCommand                   |

**Web Remote Events (from Live Sessions web interface):**

| Method                             | IPC Event               | Description                          |
| ---------------------------------- | ----------------------- | ------------------------------------ |
| `onRemoteCommand(callback)`        | `remote:executeCommand` | Web client sends command             |
| `onRemoteSwitchMode(callback)`     | `remote:switchMode`     | Web client switches AI/terminal mode |
| `onRemoteInterrupt(callback)`      | `remote:interrupt`      | Web client sends interrupt           |
| `onRemoteSelectSession(callback)`  | `remote:selectSession`  | Web client selects session           |
| `onRemoteSelectTab(callback)`      | `remote:selectTab`      | Web client selects tab               |
| `onRemoteNewTab(callback)`         | `remote:newTab`         | Web client creates new tab           |
| `onRemoteCloseTab(callback)`       | `remote:closeTab`       | Web client closes tab                |
| `onRemoteRenameTab(callback)`      | `remote:renameTab`      | Web client renames tab               |
| `onRemoteStarTab(callback)`        | `remote:starTab`        | Web client stars/unstars tab         |
| `onRemoteReorderTab(callback)`     | `remote:reorderTab`     | Web client reorders tab              |
| `onRemoteToggleBookmark(callback)` | `remote:toggleBookmark` | Web client toggles bookmark          |

### window.maestro.agents (Agent Detection & Configuration)

Preload: `src/main/preload/agents.ts` · Handler: `src/main/ipc/handlers/agents.ts`

**Detection:**

| Method                            | IPC Channel              | Description                                       |
| --------------------------------- | ------------------------ | ------------------------------------------------- |
| `detect(sshRemoteId?)`            | `agents:detect`          | Detect all available agents (local or SSH remote) |
| `refresh(agentId?, sshRemoteId?)` | `agents:refresh`         | Force re-detection with debug info (clears cache) |
| `get(agentId)`                    | `agents:get`             | Get a specific agent's configuration              |
| `getCapabilities(agentId)`        | `agents:getCapabilities` | Get agent capability flags                        |

**Configuration:**

| Method                                | IPC Channel             | Description                                         |
| ------------------------------------- | ----------------------- | --------------------------------------------------- |
| `getConfig(agentId)`                  | `agents:getConfig`      | Get all configuration (merged with defaults)        |
| `setConfig(agentId, config)`          | `agents:setConfig`      | Set all configuration                               |
| `getConfigValue(agentId, key)`        | `agents:getConfigValue` | Get a specific config value (with default fallback) |
| `setConfigValue(agentId, key, value)` | `agents:setConfigValue` | Set a specific config value                         |

**Custom Paths, Args, and Env Vars:**

| Method                               | IPC Channel                  | Description                                 |
| ------------------------------------ | ---------------------------- | ------------------------------------------- |
| `setCustomPath(agentId, customPath)` | `agents:setCustomPath`       | Set custom binary path for an agent         |
| `getCustomPath(agentId)`             | `agents:getCustomPath`       | Get custom binary path                      |
| `getAllCustomPaths()`                | `agents:getAllCustomPaths`   | Get all custom paths                        |
| `setCustomArgs(agentId, customArgs)` | `agents:setCustomArgs`       | Set custom CLI args appended to invocations |
| `getCustomArgs(agentId)`             | `agents:getCustomArgs`       | Get custom CLI args                         |
| `getAllCustomArgs()`                 | `agents:getAllCustomArgs`    | Get all custom args                         |
| `setCustomEnvVars(agentId, envVars)` | `agents:setCustomEnvVars`    | Set custom env vars for agent               |
| `getCustomEnvVars(agentId)`          | `agents:getCustomEnvVars`    | Get custom env vars                         |
| `getAllCustomEnvVars()`              | `agents:getAllCustomEnvVars` | Get all custom env vars                     |

**Model & Auth:**

| Method                                             | IPC Channel                    | Description                                          |
| -------------------------------------------------- | ------------------------------ | ---------------------------------------------------- |
| `getModels(agentId, forceRefresh?, sshRemoteId?)`  | `agents:getModels`             | Discover available models (local or SSH remote)      |
| `discoverSlashCommands(agentId, cwd, customPath?)` | `agents:discoverSlashCommands` | Discover available slash commands (Claude Code only) |
| `detectAuth(agentId, sshRemoteId?)`                | `agents:detectAuth`            | Detect billing mode (max vs api) from credentials    |
| `invalidateAuthCache(sshRemoteId?)`                | `agents:invalidateAuthCache`   | Clear cached auth detection                          |

**Pricing:**

| Method                                  | IPC Channel                  | Description                                    |
| --------------------------------------- | ---------------------------- | ---------------------------------------------- |
| `getPricingConfig(agentId)`             | `agents:getPricingConfig`    | Get pricing config (billingMode, pricingModel) |
| `setPricingConfig(agentId, config)`     | `agents:setPricingConfig`    | Set pricing config                             |
| `updateDetectedModel(agentId, modelId)` | `agents:updateDetectedModel` | Update detected model from agent output        |

**Version & Host Settings:**

| Method                                    | IPC Channel              | Description                                         |
| ----------------------------------------- | ------------------------ | --------------------------------------------------- |
| `getVersion(agentId, sshRemoteId?)`       | `agents:getVersion`      | Get installed agent version                         |
| `update(agentId, sshRemoteId?)`           | `agents:update`          | Update agent (runs `claude update` or equivalent)   |
| `getHostSettings(sshRemoteId?)`           | `agents:getHostSettings` | Read `~/.claude/settings.json` (model, effortLevel) |
| `setHostSettings(settings, sshRemoteId?)` | `agents:setHostSettings` | Merge changes into `~/.claude/settings.json`        |

### window.maestro.agentSessions (Provider Session Storage)

Preload: `src/main/preload/sessions.ts` · Handler: `src/main/ipc/handlers/agentSessions.ts`

Generic multi-agent session storage API. Replaces the deprecated `window.maestro.claude.*` API.

| Method                                                                                | IPC Channel                             | Description                                            |
| ------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------ |
| `list(agentId, projectPath, sshRemoteId?)`                                            | `agentSessions:list`                    | List sessions for an agent at a project path           |
| `listPaginated(agentId, projectPath, options?, sshRemoteId?)`                         | `agentSessions:listPaginated`           | List sessions with pagination (cursor, limit)          |
| `read(agentId, projectPath, sessionId, options?, sshRemoteId?)`                       | `agentSessions:read`                    | Read session messages (offset, limit)                  |
| `search(agentId, projectPath, query, searchMode, sshRemoteId?)`                       | `agentSessions:search`                  | Search sessions (mode: title, user, assistant, all)    |
| `getPath(agentId, projectPath, sessionId)`                                            | `agentSessions:getPath`                 | Get filesystem path to a session file                  |
| `deleteMessagePair(agentId, projectPath, sessionId, userMessageUuid, fallback?)`      | `agentSessions:deleteMessagePair`       | Delete a user+assistant message pair                   |
| `hasStorage(agentId)`                                                                 | `agentSessions:hasStorage`              | Check if agent has session storage                     |
| `getAvailableStorages()`                                                              | `agentSessions:getAvailableStorages`    | List all agent IDs with session storage                |
| `getGlobalStats()`                                                                    | `agentSessions:getGlobalStats`          | Get global stats from Usage Dashboard + message counts |
| `getAllNamedSessions()`                                                               | `agentSessions:getAllNamedSessions`     | Get all named sessions across providers                |
| `onGlobalStatsUpdate(callback)`                                                       | `agentSessions:globalStatsUpdate` event | Subscribe to progressive global stats updates          |
| `getOrigins(agentId, projectPath)`                                                    | `agentSessions:getOrigins`              | Get session metadata (origin, name, starred)           |
| `setSessionName(agentId, projectPath, sessionId, name)`                               | `agentSessions:setSessionName`          | Set/clear session display name                         |
| `setSessionStarred(agentId, projectPath, sessionId, starred)`                         | `agentSessions:setSessionStarred`       | Set/clear session starred status                       |
| `listSubagents(agentId, projectPath, sessionId, sshRemoteId?)`                        | `agentSessions:listSubagents`           | List subagents for a session                           |
| `getSubagentMessages(agentId, projectPath, sessionId, subId, options?, sshRemoteId?)` | `agentSessions:getSubagentMessages`     | Get messages for a subagent                            |
| `getSubagentStats(agentId, projectPath, sessionId, sshRemoteId?)`                     | `agentSessions:getSubagentStats`        | Get aggregated token stats from subagents              |
| `getSessionStats(agentId, projectPath, sessionId, sshRemoteId?)`                      | `agentSessions:getSessionStats`         | Get detailed session stats (tokens, cost, messages)    |

### window.maestro.agentError (Agent Error Handling)

Handler: `src/main/ipc/handlers/agent-error.ts`

| Method                                 | IPC Channel             | Description                                            |
| -------------------------------------- | ----------------------- | ------------------------------------------------------ |
| `clearError(sessionId)`                | `agent:clearError`      | Clear error state for a session after recovery         |
| `retryAfterError(sessionId, options?)` | `agent:retryAfterError` | Retry last operation with optional modified parameters |

### window.maestro.dialog (System Dialogs)

Preload: `src/main/preload/system.ts` · Handler: `src/main/ipc/handlers/system.ts`

| Method              | IPC Channel           | Description                        |
| ------------------- | --------------------- | ---------------------------------- |
| `selectFolder()`    | `dialog:selectFolder` | Open folder selection dialog       |
| `saveFile(options)` | `dialog:saveFile`     | Open file save dialog with filters |

### window.maestro.shells (Shell Detection)

Preload: `src/main/preload/system.ts` · Handler: `src/main/ipc/handlers/system.ts`

| Method     | IPC Channel     | Description                                     |
| ---------- | --------------- | ----------------------------------------------- |
| `detect()` | `shells:detect` | Detect available shells (zsh, bash, fish, etc.) |

### window.maestro.shell (Shell Operations)

Preload: `src/main/preload/system.ts` · Handler: `src/main/ipc/handlers/system.ts`

| Method                       | IPC Channel              | Description                                                                     |
| ---------------------------- | ------------------------ | ------------------------------------------------------------------------------- |
| `openExternal(url)`          | `shell:openExternal`     | Open URL in default browser (validates protocol; redirects file:// to openPath) |
| `openPath(itemPath)`         | `shell:openPath`         | Open file/folder in default application                                         |
| `trashItem(itemPath)`        | `shell:trashItem`        | Move item to system trash                                                       |
| `showItemInFolder(itemPath)` | `shell:showItemInFolder` | Reveal item in Finder/Explorer                                                  |

### window.maestro.fonts (Font Detection)

Preload: `src/main/preload/system.ts` · Handler: `src/main/ipc/handlers/system.ts`

| Method     | IPC Channel    | Description                         |
| ---------- | -------------- | ----------------------------------- |
| `detect()` | `fonts:detect` | Detect system fonts using `fc-list` |

### window.maestro.tunnel (Cloudflare Tunnel)

Preload: `src/main/preload/system.ts` · Handler: `src/main/ipc/handlers/system.ts`

| Method                     | IPC Channel                     | Description                                     |
| -------------------------- | ------------------------------- | ----------------------------------------------- |
| `isCloudflaredInstalled()` | `tunnel:isCloudflaredInstalled` | Check if cloudflared binary is available        |
| `start()`                  | `tunnel:start`                  | Start tunnel (auto-appends security token path) |
| `stop()`                   | `tunnel:stop`                   | Stop tunnel                                     |
| `getStatus()`              | `tunnel:getStatus`              | Get tunnel status                               |

### window.maestro.devtools (Developer Tools)

Preload: `src/main/preload/system.ts` · Handler: `src/main/ipc/handlers/system.ts`

| Method     | IPC Channel       | Description            |
| ---------- | ----------------- | ---------------------- |
| `open()`   | `devtools:open`   | Open Chrome DevTools   |
| `close()`  | `devtools:close`  | Close Chrome DevTools  |
| `toggle()` | `devtools:toggle` | Toggle Chrome DevTools |

### window.maestro.power (Sleep Prevention)

Preload: `src/main/preload/system.ts` · Handler: `src/main/ipc/handlers/system.ts`

| Method                 | IPC Channel          | Description                                             |
| ---------------------- | -------------------- | ------------------------------------------------------- |
| `setEnabled(enabled)`  | `power:setEnabled`   | Enable/disable sleep prevention (persisted in settings) |
| `isEnabled()`          | `power:isEnabled`    | Check if sleep prevention is enabled                    |
| `getStatus()`          | `power:getStatus`    | Get status: enabled, blocking, reasons[], platform      |
| `addReason(reason)`    | `power:addReason`    | Add a reason to block sleep (e.g., "session:abc")       |
| `removeReason(reason)` | `power:removeReason` | Remove a sleep block reason                             |

### window.maestro.updates (App & Model Updates)

Preload: `src/main/preload/system.ts` · Handler: `src/main/ipc/handlers/system.ts`

| Method                        | IPC Channel                  | Description                                           |
| ----------------------------- | ---------------------------- | ----------------------------------------------------- |
| `check(includePrerelease?)`   | `updates:check`              | Check for app updates from GitHub releases            |
| `download()`                  | `updates:download`           | Download available update                             |
| `install()`                   | `updates:install`            | Install downloaded update                             |
| `getStatus()`                 | `updates:getStatus`          | Get update status (idle, checking, downloading, etc.) |
| `onStatus(callback)`          | `updates:status` event       | Subscribe to update status changes                    |
| `setAllowPrerelease(allow)`   | `updates:setAllowPrerelease` | Enable/disable prerelease updates                     |
| `checkNewModels()`            | `models:checkNew`            | Check for new Claude models                           |
| `getModelOptions()`           | `models:getOptions`          | Get model options for pricing dropdown                |
| `addDetectedModel(modelInfo)` | `models:addDetected`         | Add a detected model to the registry                  |

### window.maestro.logger (System Logging)

Preload: `src/main/preload/logger.ts` · Handler: `src/main/ipc/handlers/system.ts`

| Method                                 | IPC Channel                   | Description                                              |
| -------------------------------------- | ----------------------------- | -------------------------------------------------------- |
| `log(level, message, context?, data?)` | `logger:log`                  | Log with level: debug, info, warn, error, toast, autorun |
| `getLogs(filter?)`                     | `logger:getLogs`              | Get logs with optional level/context/limit filter        |
| `clearLogs()`                          | `logger:clearLogs`            | Clear all logs                                           |
| `setLogLevel(level)`                   | `logger:setLogLevel`          | Set minimum log level                                    |
| `getLogLevel()`                        | `logger:getLogLevel`          | Get current log level                                    |
| `setMaxLogBuffer(max)`                 | `logger:setMaxLogBuffer`      | Set max log buffer size                                  |
| `getMaxLogBuffer()`                    | `logger:getMaxLogBuffer`      | Get max log buffer size                                  |
| `getLogFilePath()`                     | `logger:getLogFilePath`       | Get debug log file path                                  |
| `isFileLoggingEnabled()`               | `logger:isFileLoggingEnabled` | Check if file logging is enabled                         |
| `enableFileLogging()`                  | `logger:enableFileLogging`    | Enable file logging                                      |
| `onNewLog(callback)`                   | `logger:newLog` event         | Subscribe to new log entries                             |

### window.maestro.sync (Custom Storage Location)

Preload: `src/main/preload/system.ts` · Handler: `src/main/ipc/handlers/system.ts`

| Method                      | IPC Channel                  | Description                                     |
| --------------------------- | ---------------------------- | ----------------------------------------------- |
| `getDefaultPath()`          | `sync:getDefaultPath`        | Get default storage path (userData)             |
| `getSettings()`             | `sync:getSettings`           | Get sync settings (customSyncPath)              |
| `getCurrentStoragePath()`   | `sync:getCurrentStoragePath` | Get current storage path (custom or default)    |
| `selectSyncFolder()`        | `sync:selectSyncFolder`      | Open folder selection dialog for sync folder    |
| `setCustomPath(customPath)` | `sync:setCustomPath`         | Set custom sync path and migrate settings files |

### window.maestro.app (App Lifecycle)

Preload: `src/main/preload/system.ts`

| Method                                | IPC Event                     | Description                                    |
| ------------------------------------- | ----------------------------- | ---------------------------------------------- |
| `onQuitConfirmationRequest(callback)` | `app:requestQuitConfirmation` | Subscribe to quit confirmation requests        |
| `confirmQuit()`                       | `app:quitConfirmed`           | Confirm quit (sends IPC message)               |
| `cancelQuit()`                        | `app:quitCancelled`           | Cancel quit                                    |
| `forceQuit()`                         | `app:forceQuit`               | Force quit without confirmation                |
| `onSystemThemeChanged(callback)`      | `system-theme-changed`        | Subscribe to system dark/light mode changes    |
| `onSystemResume(callback)`            | `app:systemResume`            | Subscribe to system resume after sleep/suspend |

### window.maestro.claude (DEPRECATED)

Preload: `src/main/preload/sessions.ts`

Legacy Claude Code session API. All methods log deprecation warnings. Use `window.maestro.agentSessions` instead.

---

## Feature APIs

### window.maestro.projectFolders (Project Folder Management)

Preload: `src/main/preload/projectFolders.ts` · Handler: `src/main/ipc/handlers/projectFolders.ts`

**CRUD Operations:**

| Method                | IPC Channel              | Description                                                                       |
| --------------------- | ------------------------ | --------------------------------------------------------------------------------- |
| `getAll()`            | `projectFolders:getAll`  | Get all project folders, sorted by order                                          |
| `saveAll(folders)`    | `projectFolders:saveAll` | Bulk save all project folders                                                     |
| `create(folder)`      | `projectFolders:create`  | Create a new project folder (auto-generates id, createdAt, updatedAt)             |
| `update(id, updates)` | `projectFolders:update`  | Update an existing project folder                                                 |
| `delete(id)`          | `projectFolders:delete`  | Delete a folder; also removes projectFolderId from associated groups and sessions |

**Session & Group Assignment:**

| Method                               | IPC Channel                    | Description                                                         |
| ------------------------------------ | ------------------------------ | ------------------------------------------------------------------- |
| `addSession(folderId, sessionId)`    | `projectFolders:addSession`    | Add a session to a folder (sessions can belong to multiple folders) |
| `removeSession(folderId, sessionId)` | `projectFolders:removeSession` | Remove a session from a folder                                      |
| `assignGroup(folderId, groupId)`     | `projectFolders:assignGroup`   | Assign a group to a folder (1:1); pass `null` folderId to unassign  |
| `reorder(orderedIds)`                | `projectFolders:reorder`       | Reorder folders after drag-and-drop                                 |

**Pricing:**

| Method                                           | IPC Channel                              | Description                                                         |
| ------------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------- |
| `getPricingConfig(folderId)`                     | `projectFolders:getPricingConfig`        | Get pricing config for a folder                                     |
| `setPricingConfig(folderId, config)`             | `projectFolders:setPricingConfig`        | Set pricing config for a folder                                     |
| `applyPricingToAllAgents(folderId, billingMode)` | `projectFolders:applyPricingToAllAgents` | Apply billing mode to all agents in a folder; returns count updated |

### window.maestro.promptLibrary (Prompt Library)

Preload: `src/main/preload/promptLibrary.ts` · Handler: `src/main/ipc/handlers/prompt-library.ts`

| Method                      | IPC Channel                  | Description                                                     |
| --------------------------- | ---------------------------- | --------------------------------------------------------------- |
| `getAll()`                  | `promptLibrary:getAll`       | Get all prompts (sorted by most recently used)                  |
| `getById(id)`               | `promptLibrary:getById`      | Get a single prompt by ID                                       |
| `search(query)`             | `promptLibrary:search`       | Search prompts by title, content, tags                          |
| `add(entry)`                | `promptLibrary:add`          | Add a new prompt (auto-generates id, timestamps, useCount)      |
| `update(id, updates)`       | `promptLibrary:update`       | Update an existing prompt                                       |
| `delete(id)`                | `promptLibrary:delete`       | Delete a prompt                                                 |
| `recordUsage(id)`           | `promptLibrary:recordUsage`  | Record usage (increments useCount, updates lastUsedAt)          |
| `getByProject(projectPath)` | `promptLibrary:getByProject` | Get prompts for a specific project                              |
| `getStats()`                | `promptLibrary:getStats`     | Get library stats: totalPrompts, uniqueProjects, mostUsedPrompt |

### window.maestro.gpuMonitor (GPU Monitoring)

Preload: `src/main/preload/gpuMonitor.ts` · Handler: `src/main/ipc/handlers/gpu-monitor.ts`

| Method                  | IPC Channel                      | Description                                                                                     |
| ----------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------- |
| `getCapabilities()`     | `gpuMonitor:getCapabilities`     | Detect GPU monitoring tools (cached): platform, hasOllama, ollamaHost, hasMacmon, hasNvidiaSmi  |
| `refreshCapabilities()` | `gpuMonitor:refreshCapabilities` | Force re-detection of GPU capabilities (clears cache)                                           |
| `getMetrics()`          | `gpuMonitor:getMetrics`          | Get current GPU metrics: Ollama models + macmon hardware data; falls back to OS memory on macOS |
| `getSocInfo()`          | `gpuMonitor:getSocInfo`          | Get SoC hardware identity (cached): chipName, memoryGB, core counts, frequencies                |

### window.maestro.honeycomb (Honeycomb Telemetry & Usage)

Preload: `src/main/preload/honeycomb.ts` · Handlers: `src/main/ipc/handlers/honeycomb.ts`, `honeycomb-capacity-handler.ts`

**Query & Configuration:**

| Method                                 | IPC Channel                   | Description                                |
| -------------------------------------- | ----------------------------- | ------------------------------------------ |
| `query(querySpec, options?)`           | `honeycomb:query`             | Execute a Honeycomb API query              |
| `isConfigured()`                       | `honeycomb:is-configured`     | Check if Honeycomb API is configured       |
| `getRateLimitState()`                  | `honeycomb:rate-limit-state`  | Get current rate limit state               |
| `getBackoffState()`                    | `honeycomb:backoff-state`     | Get backoff state: inBackoff, remainingMs  |
| `clearCache()`                         | `honeycomb:clear-cache`       | Clear query cache                          |
| `getDataSourceMode()`                  | `honeycomb:data-source-mode`  | Get current data source mode (e.g., 'mcp') |
| `testConnection(envSlug, datasetSlug)` | `honeycomb:test-connection`   | Test MCP connection to Honeycomb           |
| `autoDiscoverEnv()`                    | `honeycomb:auto-discover-env` | Auto-discover environment slug via MCP     |

**Usage & Estimates:**

| Method                                                              | IPC Channel                  | Description                                                                      |
| ------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------- |
| `getUsage()`                                                        | `honeycomb:usage-get`        | Get latest cached usage data (no API call)                                       |
| `refreshUsage()`                                                    | `honeycomb:usage-refresh`    | Force immediate usage refresh (bypasses cache)                                   |
| `isUsageServiceRunning()`                                           | `honeycomb:usage-is-running` | Check if the usage polling service is active                                     |
| `getBestEstimate(windowTokens, calibratedBudget, safetyBufferPct?)` | `honeycomb:best-estimate`    | Get best available usage estimate for a billing window                           |
| `capacityCheck(task)`                                               | `honeycomb:capacity-check`   | Check if there is sufficient capacity for a task (uses calibration + usage data) |
| `getFlushStatus()`                                                  | `honeycomb:flush-status-get` | Get local token ledger flush status                                              |

**Archive:**

| Method                                                               | IPC Channel                    | Description                                            |
| -------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------ |
| `getArchiveState()`                                                  | `honeycomb:archive-state`      | Get archive state: last archive date, total days, etc. |
| `archiveNow()`                                                       | `honeycomb:archive-now`        | Manually trigger archival ("Archive Now" button)       |
| `isArchiveRunning()`                                                 | `honeycomb:archive-is-running` | Check if archival is in progress                       |
| `getArchivedDailyData(queryName, startDate, endDate, breakdownKey?)` | `honeycomb:archive-get-daily`  | Get archived daily data for a date range               |
| `runArchiveBackfill()`                                               | `honeycomb:archive-backfill`   | Run historical backfill for model breakdowns           |

**Events:**

| Method                          | IPC Event                | Description                       |
| ------------------------------- | ------------------------ | --------------------------------- |
| `onUsageUpdate(callback)`       | `honeycomb:usage-update` | Subscribe to usage data updates   |
| `onFlushStatusUpdate(callback)` | `honeycomb:flush-status` | Subscribe to flush status updates |

### window.maestro.groupChat (Group Chat Orchestration)

Preload: `src/main/preload/groupChat.ts` · Handler: `src/main/ipc/handlers/groupChat.ts`

**Storage:**

| Method                                                               | IPC Channel         | Description                                                                                                         |
| -------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `create(name, moderatorAgentId, moderatorConfig?, projectFolderId?)` | `groupChat:create`  | Create a group chat and auto-initialize the moderator                                                               |
| `list()`                                                             | `groupChat:list`    | List all group chats                                                                                                |
| `load(id)`                                                           | `groupChat:load`    | Load a specific group chat                                                                                          |
| `delete(id)`                                                         | `groupChat:delete`  | Delete a group chat (kills moderator + participants first)                                                          |
| `rename(id, name)`                                                   | `groupChat:rename`  | Rename a group chat                                                                                                 |
| `update(id, updates)`                                                | `groupChat:update`  | Update group chat (name, moderatorAgentId, moderatorConfig, maxRoundsOverride); restarts moderator if agent changes |
| `archive(id, archived)`                                              | `groupChat:archive` | Archive/unarchive; stops moderator+participants when archiving                                                      |

**Chat Log:**

| Method                               | IPC Channel               | Description                                              |
| ------------------------------------ | ------------------------- | -------------------------------------------------------- |
| `appendMessage(id, from, content)`   | `groupChat:appendMessage` | Append a message to the chat log                         |
| `getMessages(id)`                    | `groupChat:getMessages`   | Get all messages from the chat log                       |
| `saveImage(id, imageData, filename)` | `groupChat:saveImage`     | Save a base64 image to the group chat's images directory |
| `getImages(id)`                      | `groupChat:getImages`     | Get all images as base64 data URLs                       |

**Moderator:**

| Method                                             | IPC Channel                       | Description                                         |
| -------------------------------------------------- | --------------------------------- | --------------------------------------------------- |
| `startModerator(id)`                               | `groupChat:startModerator`        | Start the moderator process; returns session ID     |
| `sendToModerator(id, message, images?, readOnly?)` | `groupChat:sendToModerator`       | Route a user message to the moderator               |
| `stopModerator(id)`                                | `groupChat:stopModerator`         | Stop the moderator process                          |
| `getModeratorSessionId(id)`                        | `groupChat:getModeratorSessionId` | Get the moderator's session ID (null if not active) |

**Participants:**

| Method                                          | IPC Channel                         | Description                                                                |
| ----------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------- |
| `addParticipant(id, name, agentId, cwd?)`       | `groupChat:addParticipant`          | Add a participant agent to the group chat                                  |
| `sendToParticipant(id, name, message, images?)` | `groupChat:sendToParticipant`       | Send a message to a specific participant                                   |
| `removeParticipant(id, name)`                   | `groupChat:removeParticipant`       | Remove a participant from the group chat                                   |
| `resetParticipantContext(id, name, cwd?)`       | `groupChat:resetParticipantContext` | Summarize current session and start fresh; returns `{ newAgentSessionId }` |

**History:**

| Method                                     | IPC Channel                    | Description                                                  |
| ------------------------------------------ | ------------------------------ | ------------------------------------------------------------ |
| `getHistory(id)`                           | `groupChat:getHistory`         | Get all history entries for a group chat                     |
| `addHistoryEntry(id, entry)`               | `groupChat:addHistoryEntry`    | Add a history entry (delegation, response, synthesis, error) |
| `deleteHistoryEntry(groupChatId, entryId)` | `groupChat:deleteHistoryEntry` | Delete a history entry                                       |
| `clearHistory(id)`                         | `groupChat:clearHistory`       | Clear all history for a group chat                           |
| `getHistoryFilePath(id)`                   | `groupChat:getHistoryFilePath` | Get the history file path (for AI context integration)       |
| `getRoundState(id)`                        | `groupChat:getRoundState`      | Get round state for a group chat (for UI display)            |

**Events (main → renderer):**

| Method                                  | IPC Event                             | Description                                                 |
| --------------------------------------- | ------------------------------------- | ----------------------------------------------------------- |
| `onMessage(callback)`                   | `groupChat:message`                   | New chat message                                            |
| `onStateChange(callback)`               | `groupChat:stateChange`               | State change: idle, moderator-thinking, agent-working       |
| `onParticipantsChanged(callback)`       | `groupChat:participantsChanged`       | Participants added/removed                                  |
| `onModeratorUsage(callback)`            | `groupChat:moderatorUsage`            | Moderator usage stats (contextUsage, totalCost, tokenCount) |
| `onHistoryEntry(callback)`              | `groupChat:historyEntry`              | New history entry added                                     |
| `onParticipantState(callback)`          | `groupChat:participantState`          | Participant state change (idle/working)                     |
| `onModeratorSessionIdChanged(callback)` | `groupChat:moderatorSessionIdChanged` | Moderator's agent session ID captured                       |
| `onThinkingContent(callback)`           | `groupChat:thinkingContent`           | Streaming thinking/reasoning content                        |

### window.maestro.symphony (Open Source Contributions)

Preload: `src/main/preload/symphony.ts` · Handler: `src/main/ipc/handlers/symphony.ts`

**Registry & Issues:**

| Method                                     | IPC Channel               | Description                                                    |
| ------------------------------------------ | ------------------------- | -------------------------------------------------------------- |
| `getRegistry(forceRefresh?)`               | `symphony:getRegistry`    | Fetch Symphony repository registry (cached 2hr TTL)            |
| `getIssues(repoSlug, forceRefresh?)`       | `symphony:getIssues`      | Get GitHub issues with `runmaestro.ai` label (cached 5min TTL) |
| `getIssueCounts(repoSlugs, forceRefresh?)` | `symphony:getIssueCounts` | Get issue counts for multiple repositories                     |

**State:**

| Method                 | IPC Channel             | Description                                                        |
| ---------------------- | ----------------------- | ------------------------------------------------------------------ |
| `getState()`           | `symphony:getState`     | Get full Symphony state (active, history, stats)                   |
| `getActive()`          | `symphony:getActive`    | Get active contributions                                           |
| `getCompleted(limit?)` | `symphony:getCompleted` | Get completed contributions with optional limit                    |
| `getStats()`           | `symphony:getStats`     | Get contributor stats (total contributions, tokens, streaks, etc.) |

**Contribution Lifecycle:**

| Method                             | IPC Channel                 | Description                                                             |
| ---------------------------------- | --------------------------- | ----------------------------------------------------------------------- |
| `start(params)`                    | `symphony:start`            | Start a new contribution (clone repo, create branch, optional draft PR) |
| `registerActive(params)`           | `symphony:registerActive`   | Register an active contribution in state                                |
| `updateStatus(params)`             | `symphony:updateStatus`     | Update contribution status, progress, token usage                       |
| `complete(params)`                 | `symphony:complete`         | Complete a contribution (push branch, create PR)                        |
| `cancel(contributionId, cleanup?)` | `symphony:cancel`           | Cancel an active contribution; optionally clean up local files          |
| `checkPRStatuses()`                | `symphony:checkPRStatuses`  | Check PR statuses for all completed contributions                       |
| `syncContribution(contributionId)` | `symphony:syncContribution` | Sync a single contribution's PR status                                  |

**Repo & PR Operations:**

| Method                      | IPC Channel                     | Description                                          |
| --------------------------- | ------------------------------- | ---------------------------------------------------- |
| `cloneRepo(params)`         | `symphony:cloneRepo`            | Clone a repository to local path                     |
| `startContribution(params)` | `symphony:startContribution`    | Set up branch + optional draft PR for a contribution |
| `createDraftPR(params)`     | `symphony:createDraftPR`        | Create a draft GitHub PR                             |
| `fetchDocumentContent(url)` | `symphony:fetchDocumentContent` | Fetch document content from a URL                    |
| `manualCredit(params)`      | `symphony:manualCredit`         | Manually credit a contribution (for external PRs)    |
| `clearCache()`              | `symphony:clearCache`           | Clear all Symphony caches                            |

**Events:**

| Method                            | IPC Event                      | Description                                                             |
| --------------------------------- | ------------------------------ | ----------------------------------------------------------------------- |
| `onUpdated(callback)`             | `symphony:updated`             | Symphony state updated                                                  |
| `onContributionStarted(callback)` | `symphony:contributionStarted` | Contribution started (contributionId, sessionId, localPath, branchName) |
| `onPRCreated(callback)`           | `symphony:prCreated`           | PR created (contributionId, prNumber, prUrl)                            |

### window.maestro.documentGraph (Document Graph File Watching)

Preload: `src/main/preload/debug.ts` · Handler: `src/main/ipc/handlers/documentGraph.ts`

| Method                    | IPC Channel                        | Description                                                                                    |
| ------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| `watchFolder(rootPath)`   | `documentGraph:watchFolder`        | Start watching a directory for markdown file changes (recursive, debounced 500ms)              |
| `unwatchFolder(rootPath)` | `documentGraph:unwatchFolder`      | Stop watching a directory                                                                      |
| `onFilesChanged(handler)` | `documentGraph:filesChanged` event | Subscribe to batched file change events (add/change/unlink); renames appear as unlink+add pair |

### window.maestro.knowledgeGraph (Knowledge Graph Storage)

Preload: `src/main/preload/knowledgeGraph.ts` · Handler: `src/main/ipc/handlers/knowledge-graph.ts`

| Method             | IPC Channel             | Description                                                       |
| ------------------ | ----------------------- | ----------------------------------------------------------------- |
| `save(entry)`      | `knowledgeGraph:save`   | Save a knowledge graph entry as a markdown file; returns filepath |
| `list()`           | `knowledgeGraph:list`   | List all saved entries (filenames, sorted newest-first)           |
| `read(filename)`   | `knowledgeGraph:read`   | Read a knowledge graph entry by filename                          |
| `delete(filename)` | `knowledgeGraph:delete` | Delete a knowledge graph entry                                    |

### window.maestro.tabNaming (Automatic Tab Naming)

Preload: `src/main/preload/tabNaming.ts` · Handler: `src/main/ipc/handlers/tabNaming.ts`

| Method                    | IPC Channel                 | Description                                                                                                                                                                              |
| ------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generateTabName(config)` | `tabNaming:generateTabName` | Generate a descriptive tab name from user's first message; spawns an ephemeral read-only agent session (30s timeout); config: `{ userMessage, agentType, cwd, sessionSshRemoteConfig? }` |

### window.maestro.directorNotes (Director's Notes)

Preload: `src/main/preload/directorNotes.ts` · Handler: `src/main/ipc/handlers/director-notes.ts`

| Method                       | IPC Channel                        | Description                                                                                                                                                                                      |
| ---------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `getUnifiedHistory(options)` | `director-notes:getUnifiedHistory` | Aggregate history across all sessions with pagination; options: `{ lookbackDays, filter?, limit?, offset? }`; returns paginated entries + stats (agentCount, sessionCount, autoCount, userCount) |
| `generateSynopsis(options)`  | `director-notes:generateSynopsis`  | Generate AI synopsis via batch-mode agent; options: `{ lookbackDays, provider, customPath?, customArgs?, customEnvVars? }`; passes history file paths (not inline data) to the agent             |

---

## Automation APIs

### window.maestro.autorun (Auto Run Document Operations)

Preload: `src/main/preload/autorun.ts` · Handler: `src/main/ipc/handlers/autorun.ts`

All document operations accept an optional `sshRemoteId` parameter for SSH remote execution. File watching falls back to polling mode for remote sessions (chokidar can't watch remote directories).

| Method                                                                | IPC Channel                 | Description                                                                              |
| --------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------- |
| `listDocs(folderPath, sshRemoteId?)`                                  | `autorun:listDocs`          | List markdown files recursively; returns `{ files, tree }` (TreeNode structure)          |
| `hasDocuments(folderPath)`                                            | `autorun:hasDocuments`      | Quick check if folder contains any `.md` files (local only)                              |
| `readDoc(folderPath, filename, sshRemoteId?)`                         | `autorun:readDoc`           | Read a markdown document; auto-appends `.md` extension                                   |
| `writeDoc(folderPath, filename, content, sshRemoteId?)`               | `autorun:writeDoc`          | Write a markdown document; creates parent directories as needed                          |
| `saveImage(folderPath, docName, base64Data, extension, sshRemoteId?)` | `autorun:saveImage`         | Save image to `images/` subdirectory; returns `{ relativePath }`                         |
| `deleteImage(folderPath, relativePath, sshRemoteId?)`                 | `autorun:deleteImage`       | Delete an image from `images/` subdirectory                                              |
| `listImages(folderPath, docName, sshRemoteId?)`                       | `autorun:listImages`        | List images for a document (matched by `{docName}-` prefix)                              |
| `deleteFolder(projectPath)`                                           | `autorun:deleteFolder`      | Delete the entire `Auto Run Docs` folder (wizard "start fresh" feature)                  |
| `watchFolder(folderPath, sshRemoteId?)`                               | `autorun:watchFolder`       | Start watching folder for `.md` changes; returns `{ isRemote }` for SSH                  |
| `unwatchFolder(folderPath)`                                           | `autorun:unwatchFolder`     | Stop watching a folder                                                                   |
| `onFileChanged(handler)`                                              | `autorun:fileChanged` event | Subscribe to file change events `{ folderPath, filename, eventType }`                    |
| `createBackup(folderPath, filename, sshRemoteId?)`                    | `autorun:createBackup`      | Create `.backup.md` copy for reset-on-completion                                         |
| `restoreBackup(folderPath, filename, sshRemoteId?)`                   | `autorun:restoreBackup`     | Restore from backup and delete backup file                                               |
| `deleteBackups(folderPath, sshRemoteId?)`                             | `autorun:deleteBackups`     | Delete all `.backup.md` files recursively; returns `{ deletedCount }`                    |
| `createWorkingCopy(folderPath, filename, loopNumber, sshRemoteId?)`   | `autorun:createWorkingCopy` | Create working copy in `Runs/` subdirectory; returns `{ workingCopyPath, originalPath }` |

### window.maestro.playbooks (Playbook Management)

Preload: `src/main/preload/autorun.ts` · Handler: `src/main/ipc/handlers/playbooks.ts`

Playbooks are stored per-session as JSON files in `userData/playbooks/{sessionId}.json`.

| Method                                             | IPC Channel           | Description                                                                         |
| -------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------- |
| `list(sessionId)`                                  | `playbooks:list`      | List all playbooks for a session                                                    |
| `create(sessionId, playbook)`                      | `playbooks:create`    | Create a new playbook (auto-generates id, timestamps); supports `worktreeSettings`  |
| `update(sessionId, playbookId, updates)`           | `playbooks:update`    | Update an existing playbook                                                         |
| `delete(sessionId, playbookId)`                    | `playbooks:delete`    | Delete a playbook                                                                   |
| `deleteAll(sessionId)`                             | `playbooks:deleteAll` | Delete all playbooks for a session                                                  |
| `export(sessionId, playbookId, autoRunFolderPath)` | `playbooks:export`    | Export playbook to ZIP file (includes documents + assets)                           |
| `import(sessionId, autoRunFolderPath)`             | `playbooks:import`    | Import playbook from ZIP file; returns `{ playbook, importedDocs, importedAssets }` |

### window.maestro.marketplace (Playbook Marketplace)

Preload: `src/main/preload/autorun.ts` · Handler: `src/main/ipc/handlers/marketplace.ts`

Fetches playbooks from the RunMaestro/Maestro-Playbooks GitHub repository with 6-hour cache TTL. Supports local manifests (`local-manifest.json` in userData) that merge with/override official playbooks.

| Method                                                                                     | IPC Channel                         | Description                                                                                                         |
| ------------------------------------------------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `getManifest()`                                                                            | `marketplace:getManifest`           | Get manifest (from cache if valid, else GitHub); merges local manifest; returns `{ manifest, fromCache, cacheAge }` |
| `refreshManifest()`                                                                        | `marketplace:refreshManifest`       | Force refresh manifest (bypass cache)                                                                               |
| `getDocument(playbookPath, filename)`                                                      | `marketplace:getDocument`           | Fetch a single document (from GitHub or local filesystem)                                                           |
| `getReadme(playbookPath)`                                                                  | `marketplace:getReadme`             | Fetch README for a playbook (optional, returns null if not found)                                                   |
| `importPlaybook(playbookId, targetFolderName, autoRunFolderPath, sessionId, sshRemoteId?)` | `marketplace:importPlaybook`        | Import a playbook: fetch docs + assets, write to autorun folder, create playbook entry; supports SSH remote         |
| `onManifestChanged(handler)`                                                               | `marketplace:manifestChanged` event | Subscribe to local manifest file changes (hot reload for development)                                               |

### window.maestro.history (Command History)

Preload: `src/main/preload/sessions.ts` · Handler: `src/main/ipc/handlers/history.ts`

Per-session history persistence with 5,000 entries per session. Supports cross-session queries and pagination.

| Method                                           | IPC Channel                 | Description                                                                 |
| ------------------------------------------------ | --------------------------- | --------------------------------------------------------------------------- |
| `getAll(projectPath?, sessionId?)`               | `history:getAll`            | Get history entries (legacy, use paginated); filters by session or project  |
| `getAllPaginated(options?)`                      | `history:getAllPaginated`   | Get paginated history; options: `{ projectPath?, sessionId?, pagination? }` |
| `reload()`                                       | `history:reload`            | Force reload from disk (no-op for per-session storage, kept for API compat) |
| `add(entry)`                                     | `history:add`               | Add a new history entry                                                     |
| `clear(projectPath?, sessionId?)`                | `history:clear`             | Clear history (all, by project, or by session)                              |
| `delete(entryId, sessionId?)`                    | `history:delete`            | Delete a single history entry by ID                                         |
| `update(entryId, updates, sessionId?)`           | `history:update`            | Update a history entry (e.g., validated flag)                               |
| `updateSessionName(agentSessionId, sessionName)` | `history:updateSessionName` | Update sessionName for all entries matching an agent session ID             |
| `getFilePath(sessionId)`                         | `history:getFilePath`       | Get history file path (for AI context integration)                          |
| `listSessions()`                                 | `history:listSessions`      | List all session IDs with history                                           |

---

## System APIs

### window.maestro.settings (Settings Persistence)

Preload: `src/main/preload/settings.ts` · Handler: `src/main/ipc/handlers/persistence.ts`

Settings are stored via `electron-store` (`MaestroSettings` type). Changes to `activeThemeId` and `customAICommands` are broadcast to connected web clients.

| Method               | IPC Channel         | Description                                                                                                        |
| -------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `get(key)`           | `settings:get`      | Get a setting value by key                                                                                         |
| `set(key, value)`    | `settings:set`      | Set a setting value; returns false on disk errors (ENOSPC, etc.)                                                   |
| `getAll()`           | `settings:getAll`   | Get all settings as a plain object                                                                                 |
| `resetCalibration()` | `calibration:reset` | Reset plan calibration data (backs up to timestamped JSON first); returns `{ success, pointsCleared, backupPath }` |

### window.maestro.sessions (Session Persistence)

Preload: `src/main/preload/settings.ts` · Handler: `src/main/ipc/handlers/persistence.ts`

Stores UI session state (not agent conversation history). Session lifecycle changes are broadcast to connected web clients.

| Method             | IPC Channel       | Description                                                                |
| ------------------ | ----------------- | -------------------------------------------------------------------------- |
| `getAll()`         | `sessions:getAll` | Get all stored sessions (StoredSession[])                                  |
| `setAll(sessions)` | `sessions:setAll` | Save all sessions; detects lifecycle changes and broadcasts to web clients |

### window.maestro.groups (Group Persistence)

Preload: `src/main/preload/settings.ts` · Handler: `src/main/ipc/handlers/persistence.ts`

| Method           | IPC Channel     | Description                                   |
| ---------------- | --------------- | --------------------------------------------- |
| `getAll()`       | `groups:getAll` | Get all groups                                |
| `setAll(groups)` | `groups:setAll` | Save all groups; returns false on disk errors |

### window.maestro.stats (Usage Statistics & Analytics)

Preload: `src/main/preload/stats.ts` · Handler: `src/main/ipc/handlers/stats.ts`

SQLite-backed stats database for recording and querying AI interaction metrics. Supports dual cost calculation (Anthropic API pricing vs Maestro billing mode).

**Recording:**

| Method                                     | IPC Channel                    | Description                                                                        |
| ------------------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------- |
| `recordQuery(event)`                       | `stats:record-query`           | Record a query event (interactive conversation turn); auto-enriches with cost data |
| `startAutoRun(session)`                    | `stats:start-autorun`          | Start an Auto Run session; returns session ID                                      |
| `endAutoRun(id, duration, tasksCompleted)` | `stats:end-autorun`            | End an Auto Run session with final stats                                           |
| `recordAutoTask(task)`                     | `stats:record-task`            | Record an individual Auto Run task completion                                      |
| `recordSessionCreated(event)`              | `stats:record-session-created` | Record session creation event                                                      |
| `recordSessionClosed(sessionId, closedAt)` | `stats:record-session-closed`  | Record session closure event                                                       |

**Querying:**

| Method                              | IPC Channel                    | Description                                                               |
| ----------------------------------- | ------------------------------ | ------------------------------------------------------------------------- |
| `getStats(range, filters?)`         | `stats:get-stats`              | Get query events within time range (day, week, month, quarter, year, all) |
| `getAutoRunSessions(range)`         | `stats:get-autorun-sessions`   | Get Auto Run sessions within time range                                   |
| `getAutoRunTasks(autoRunSessionId)` | `stats:get-autorun-tasks`      | Get tasks for a specific Auto Run session                                 |
| `getAggregation(range)`             | `stats:get-aggregation`        | Get aggregated stats for dashboard display                                |
| `getSessionLifecycle(range)`        | `stats:get-session-lifecycle`  | Get session lifecycle events within range                                 |
| `getDailyCosts(range)`              | `stats:get-daily-costs`        | Get daily cost breakdown (localCost, anthropicCost, savings)              |
| `getCostsByModel(range)`            | `stats:get-costs-by-model`     | Get costs grouped by model                                                |
| `getCostsByAgent(range)`            | `stats:get-costs-by-agent`     | Get costs grouped by agent (includes billingMode)                         |
| `getFreeTokenStats(range)`          | `stats:get-free-token-stats`   | Get free token stats for DS Comparison tab                                |
| `getEarliestTimestamp()`            | `stats:get-earliest-timestamp` | Get earliest timestamp across all stats tables                            |

**Maintenance:**

| Method                        | IPC Channel                         | Description                                                                                                  |
| ----------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `exportCsv(range)`            | `stats:export-csv`                  | Export query events to CSV                                                                                   |
| `clearOldData(olderThanDays)` | `stats:clear-old-data`              | Clear old stats data; returns `{ success, deletedQueryEvents, deletedAutoRunSessions, deletedAutoRunTasks }` |
| `getDatabaseSize()`           | `stats:get-database-size`           | Get database file size in bytes                                                                              |
| `getInitializationResult()`   | `stats:get-initialization-result`   | Get DB initialization result (for reset notification)                                                        |
| `clearInitializationResult()` | `stats:clear-initialization-result` | Clear initialization result after user acknowledgment                                                        |
| `onStatsUpdate(callback)`     | `stats:updated` event               | Subscribe to stats update events                                                                             |

### window.maestro.audit (Anthropic Usage Audit)

Preload: `src/main/preload/audit.ts` · Handler: `src/main/ipc/handlers/audit.ts`

Compares Anthropic's usage data with Maestro's recorded data. Supports scheduled and manual audits.

| Method                                    | IPC Channel                 | Description                                                                                             |
| ----------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------- |
| `run(startDate, endDate)`                 | `audit:run`                 | Run a manual audit for a date range                                                                     |
| `getHistory(limit?)`                      | `audit:getHistory`          | Get audit history (most recent audits)                                                                  |
| `getSnapshotsByRange(startDate, endDate)` | `audit:getSnapshotsByRange` | Get audit snapshots within a date range                                                                 |
| `getConfig()`                             | `audit:getConfig`           | Get current audit configuration                                                                         |
| `saveConfig(config)`                      | `audit:saveConfig`          | Save audit configuration                                                                                |
| `getScheduleStatus()`                     | `audit:getScheduleStatus`   | Get schedule status for all audit types                                                                 |
| `startScheduler()`                        | `audit:startScheduler`      | Start scheduled audits                                                                                  |
| `stopScheduler()`                         | `audit:stopScheduler`       | Stop scheduled audits                                                                                   |
| `autoCorrect(entryIds)`                   | `audit:autoCorrect`         | Auto-correct entries by updating Maestro's records to match Anthropic's; returns `{ corrected, total }` |
| `delete(generatedAt)`                     | `audit:delete`              | Delete an audit snapshot                                                                                |
| `onAuditUpdate(callback)`                 | `audit:updated` event       | Subscribe to audit update events                                                                        |

### window.maestro.notification (OS Notifications & Custom Commands)

Preload: `src/main/preload/notifications.ts` · Handler: `src/main/ipc/handlers/notifications.ts`

Custom notification commands are queued with a 15-second minimum delay between calls to prevent audio overlap. Max queue size is 10.

| Method                        | IPC Channel                           | Description                                                                                     |
| ----------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `show(title, body)`           | `notification:show`                   | Show OS notification (silent — no system sound)                                                 |
| `speak(text, command?)`       | `notification:speak`                  | Execute custom notification command (text piped to stdin); default command is `say` (macOS TTS) |
| `stopSpeak(notificationId)`   | `notification:stopSpeak`              | Stop a running notification command process                                                     |
| `onCommandCompleted(handler)` | `notification:commandCompleted` event | Subscribe to notification command completion events                                             |

### window.maestro.attachments (Session Attachments)

Preload: `src/main/preload/attachments.ts` · Handler: `src/main/ipc/handlers/attachments.ts`

Image attachments stored in `userData/attachments/{sessionId}/{filename}`.

| Method                                  | IPC Channel           | Description                                                                               |
| --------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------- |
| `save(sessionId, base64Data, filename)` | `attachments:save`    | Save an image attachment; extracts data URL prefix; returns `{ success, path, filename }` |
| `load(sessionId, filename)`             | `attachments:load`    | Load attachment as base64 data URL; auto-detects MIME type from extension                 |
| `delete(sessionId, filename)`           | `attachments:delete`  | Delete an attachment                                                                      |
| `list(sessionId)`                       | `attachments:list`    | List all image attachments for a session                                                  |
| `getPath(sessionId)`                    | `attachments:getPath` | Get the attachments directory path for a session                                          |

### window.maestro.context (Context Merge & Grooming)

Preload: `src/main/preload/context.ts` · Handler: `src/main/ipc/handlers/context.ts`

Context transfer and grooming across AI agent sessions. The `groomContext` method is the recommended approach (single-call); the `createGroomingSession`/`sendGroomingPrompt` pair is deprecated.

| Method                                                   | IPC Channel                      | Description                                                                                                                      |
| -------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `getStoredSession(agentId, projectRoot, sessionId)`      | `context:getStoredSession`       | Retrieve messages from an agent session storage                                                                                  |
| `groomContext(projectRoot, agentType, prompt, options?)` | `context:groomContext`           | Single-call context grooming; spawns batch-mode agent; options: `{ sshRemoteConfig?, customPath?, customArgs?, customEnvVars? }` |
| `cancelGrooming()`                                       | `context:cancelGrooming`         | Cancel all active grooming sessions                                                                                              |
| `createGroomingSession(projectRoot, agentType)`          | `context:createGroomingSession`  | _DEPRECATED:_ Create a temporary grooming session                                                                                |
| `sendGroomingPrompt(sessionId, prompt)`                  | `context:sendGroomingPrompt`     | _DEPRECATED:_ Send a grooming prompt to a session                                                                                |
| `cleanupGroomingSession(sessionId)`                      | `context:cleanupGroomingSession` | Clean up a temporary grooming session                                                                                            |

### window.maestro.sshRemote (SSH Remote Configuration)

Preload: `src/main/preload/sshRemote.ts` · Handler: `src/main/ipc/handlers/ssh-remote.ts`

| Method                            | IPC Channel                    | Description                                                             |
| --------------------------------- | ------------------------------ | ----------------------------------------------------------------------- |
| `saveConfig(config)`              | `ssh-remote:saveConfig`        | Create or update an SSH remote configuration; validates before saving   |
| `deleteConfig(id)`                | `ssh-remote:deleteConfig`      | Delete an SSH remote configuration; clears default if deleted           |
| `getConfigs()`                    | `ssh-remote:getConfigs`        | Get all SSH remote configurations                                       |
| `getDefaultId()`                  | `ssh-remote:getDefaultId`      | Get the global default SSH remote ID                                    |
| `setDefaultId(id)`                | `ssh-remote:setDefaultId`      | Set the global default SSH remote ID (pass null to clear)               |
| `test(configOrId, agentCommand?)` | `ssh-remote:test`              | Test an SSH remote connection; registers with health monitor on success |
| `getSshConfigHosts()`             | `ssh-remote:getSshConfigHosts` | Parse `~/.ssh/config` and return available host entries                 |

### window.maestro.web (Web Client Broadcasting)

Preload: `src/main/preload/web.ts` · Handler: `src/main/ipc/handlers/web.ts`

Broadcasting from desktop app to connected Live Sessions web clients.

| Method                                                     | IPC Channel                 | Description                                                          |
| ---------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------- |
| `broadcastUserInput(sessionId, command, inputMode)`        | `web:broadcastUserInput`    | Broadcast user input to web clients                                  |
| `broadcastAutoRunState(sessionId, state)`                  | `web:broadcastAutoRunState` | Broadcast AutoRun state (always stored even if no clients connected) |
| `broadcastTabsChange(sessionId, aiTabs, activeTabId)`      | `web:broadcastTabsChange`   | Broadcast tab changes to web clients                                 |
| `broadcastSessionState(sessionId, state, additionalData?)` | `web:broadcastSessionState` | Broadcast session state changes for real-time busy/idle updates      |

### window.maestro.live (Live Session Management)

Preload: `src/main/preload/web.ts` · Handler: `src/main/ipc/handlers/web.ts`

| Method                               | IPC Channel                   | Description                                                             |
| ------------------------------------ | ----------------------------- | ----------------------------------------------------------------------- |
| `toggle(sessionId, agentSessionId?)` | `live:toggle`                 | Toggle session live/offline; waits for server startup if needed         |
| `getStatus(sessionId)`               | `live:getStatus`              | Get live status: `{ live, url }`                                        |
| `getDashboardUrl()`                  | `live:getDashboardUrl`        | Get the secure dashboard URL                                            |
| `getLiveSessions()`                  | `live:getLiveSessions`        | Get all live sessions                                                   |
| `broadcastActiveSession(sessionId)`  | `live:broadcastActiveSession` | Broadcast active session change to web clients                          |
| `startServer()`                      | `live:startServer`            | Start web server (creates if needed); returns `{ success, url }`        |
| `stopServer()`                       | `live:stopServer`             | Stop web server and clean up                                            |
| `disableAll()`                       | `live:disableAll`             | Disable all live sessions and stop server; returns `{ success, count }` |

### window.maestro.webserver (Web Server Info)

Preload: `src/main/preload/web.ts` · Handler: `src/main/ipc/handlers/web.ts`

| Method                  | IPC Channel                     | Description                    |
| ----------------------- | ------------------------------- | ------------------------------ |
| `getUrl()`              | `webserver:getUrl`              | Get the web server secure URL  |
| `getConnectedClients()` | `webserver:getConnectedClients` | Get connected web client count |

### window.maestro.leaderboard (Community Leaderboard)

Preload: `src/main/preload/leaderboard.ts` · Handler: `src/main/ipc/handlers/leaderboard.ts`

Communicates with the RunMaestro.ai leaderboard API. All fetch requests have a 30-second timeout.

| Method                        | IPC Channel                      | Description                                                                |
| ----------------------------- | -------------------------------- | -------------------------------------------------------------------------- |
| `getInstallationId()`         | `leaderboard:getInstallationId`  | Get unique installation ID                                                 |
| `submit(data)`                | `leaderboard:submit`             | Submit leaderboard entry; supports delta mode for multi-device aggregation |
| `pollAuthStatus(clientToken)` | `leaderboard:pollAuthStatus`     | Poll for auth token after email confirmation                               |
| `resendConfirmation(data)`    | `leaderboard:resendConfirmation` | Resend confirmation email                                                  |
| `get(options?)`               | `leaderboard:get`                | Get leaderboard entries (cumulative time rankings)                         |
| `getLongestRuns(options?)`    | `leaderboard:getLongestRuns`     | Get longest runs leaderboard                                               |
| `sync(data)`                  | `leaderboard:sync`               | Sync user stats from server (for new device installations)                 |

### window.maestro.cli (CLI Activity)

Handler: `src/main/ipc/handlers/persistence.ts`

| Method          | IPC Channel       | Description                                                      |
| --------------- | ----------------- | ---------------------------------------------------------------- |
| `getActivity()` | `cli:getActivity` | Get CLI activities (for detecting when CLI is running playbooks) |

---

## SSH Remote Execution Awareness

Many IPC channels accept an optional `sshRemoteId` parameter to execute operations on a remote host via SSH. Understanding the two SSH identifier types and the correct fallback pattern is critical to avoiding bugs.

### Channels with SSH Remote Support

**Filesystem (`fs:*`):** `readDir`, `readFile`, `writeFile`, `stat`, `rename`, `delete`, `directorySize`, `countItems`, `loadFileTree`

**Git (`git:*`):** All channels accept `sshRemoteId` (and optional `remoteCwd`). Includes: `status`, `diff`, `isRepo`, `numstat`, `branch`, `branches`, `tags`, `remote`, `info`, `log`, `commitCount`, `show`, `worktreeInfo`, `getRepoRoot`, `worktreeSetup`, `worktreeCheckout`, `listWorktrees`, `scanWorktreeDirectory`, `watchWorktreeDirectory`

**Process:** `spawn`, `runCommand` (via config object)

**Agents:** `detect`, `refresh`, `getModels`, `detectAuth`, `invalidateAuthCache`, `getVersion`, `update`, `getHostSettings`, `setHostSettings`

**Agent Sessions:** `list`, `listPaginated`, `read`, `search`, `listSubagents`, `getSubagentMessages`, `getSubagentStats`, `getSessionStats`

**Auto Run:** `listDocs`, `readDoc`, `writeDoc`, `saveImage`, `deleteImage`, `listImages`, `watchFolder`, `createBackup`, `restoreBackup`, `deleteBackups`, `createWorkingCopy`

**Marketplace:** `importPlaybook`

### Two SSH Identifier Types

There are two different SSH identifiers with different lifecycles:

| Identifier                                | Set When                                                  | Type                  |
| ----------------------------------------- | --------------------------------------------------------- | --------------------- |
| `session.sshRemoteId`                     | **After** AI agent spawns (via `onSshRemote` callback)    | `string \| undefined` |
| `session.sessionSshRemoteConfig.remoteId` | **Before** spawn (user configuration at session creation) | `string \| null`      |

**Critical pitfall:** `sshRemoteId` is only populated after the AI agent spawns. For terminal-only SSH sessions (no AI agent), it remains `undefined`.

### Correct Fallback Pattern

```typescript
// WRONG — fails for terminal-only SSH sessions
const sshId = session.sshRemoteId;

// CORRECT — works for all SSH sessions
const sshId = session.sshRemoteId || session.sessionSshRemoteConfig?.remoteId || undefined;
```

This fallback applies to any operation that needs to run on the remote host:

- `window.maestro.fs.readDir(path, sshId)`
- `window.maestro.git.isRepo(path, sshId)`
- Directory existence checks for `cd` command tracking

Similarly, for checking if a session is remote:

```typescript
// WRONG
const isRemote = !!session.sshRemoteId;

// CORRECT
const isRemote = !!session.sshRemoteId || !!session.sessionSshRemoteConfig?.enabled;
```

---

## Diagnostic Logging

The `fs:diagLog` channel serves as the diagnostic logging relay. The production renderer build strips `console.*` calls, so renderer code uses `window.maestro.fs.diagLog(tag, data?)` to log diagnostic info through the main process logger.
