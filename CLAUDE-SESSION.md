# Session Interface Reference

The `Session` interface is the core data model for Maestro. Each session represents one agent workspace (what users see as an "agent" in the Left Bar). The name is historical — within each agent, "provider sessions" refer to individual conversation contexts (tabs). See [[CLAUDE.md#terminology-agent-vs-session]] for the full distinction.

> **Source:** `src/renderer/types/index.ts` — `export interface Session`

---

## Identity & Metadata

| Field         | Type                 | Optional | Description                                                                                           |
| ------------- | -------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| id            | `string`             |          | Unique session ID                                                                                     |
| name          | `string`             |          | Display name shown in sidebar                                                                         |
| groupId       | `string`             | ✓        | Agent grouping ID                                                                                     |
| toolType      | `ToolType`           |          | Agent type: `'claude-code'` \| `'codex'` \| `'opencode'` \| `'factory-droid'` \| `'terminal'` \| etc. |
| state         | `SessionState`       |          | Lifecycle state: `'idle'` \| `'busy'` \| `'waiting_input'` \| `'connecting'` \| `'error'`             |
| inputMode     | `'terminal' \| 'ai'` |          | Which process receives user input                                                                     |
| bookmarked    | `boolean`            | ✓        | Pinned to top of sidebar in dedicated section                                                         |
| statusMessage | `string`             | ✓        | Custom status for thinking indicator (e.g., "Agent is synopsizing...")                                |
| busySource    | `'ai' \| 'terminal'` | ✓        | Which mode triggered the busy state (for correct indicator when switching modes)                      |

## Paths

| Field       | Type     | Optional | Description                                                                |
| ----------- | -------- | -------- | -------------------------------------------------------------------------- |
| cwd         | `string` |          | Current working directory (can change via `cd`)                            |
| fullPath    | `string` |          | Full resolved path                                                         |
| projectRoot | `string` |          | Initial working directory (never changes, used for Claude session storage) |
| shellCwd    | `string` | ✓        | Current shell working directory (tracked separately from cwd)              |

## Processes & Communication

| Field       | Type     | Optional | Description                                                                                    |
| ----------- | -------- | -------- | ---------------------------------------------------------------------------------------------- |
| aiPid       | `number` |          | AI process PID (0 for batch-mode agents that spawn per-message)                                |
| terminalPid | `number` |          | Terminal PID (always 0 — kept for backwards compat; terminal uses `runCommand()` fresh shells) |
| port        | `number` |          | Web server communication port                                                                  |

## State & Lifecycle

| Field                       | Type      | Optional | Description                                                                          |
| --------------------------- | --------- | -------- | ------------------------------------------------------------------------------------ |
| thinkingStartTime           | `number`  | ✓        | Timestamp when agent started processing (for elapsed time display)                   |
| currentCycleTokens          | `number`  | ✓        | Token count for current thinking cycle (reset on new request)                        |
| currentCycleBytes           | `number`  | ✓        | Bytes received during current thinking cycle (for real-time progress)                |
| activeTimeMs                | `number`  |          | Cumulative milliseconds of active use                                                |
| agentSessionId              | `string`  | ✓        | **DEPRECATED** — Use `aiTabs[activeIndex].agentSessionId` instead                    |
| pendingJumpPath             | `string`  | ✓        | Pending jump path for `/jump` command (relative path within file tree)               |
| pendingAICommandForSynopsis | `string`  | ✓        | Pending AI command that triggers synopsis on completion (e.g., `'/commit'`)          |
| synopsisInProgress          | `boolean` | ✓        | Runtime only — set when synopsis running on SSH session to prevent message hijacking |
| nudgeMessage                | `string`  | ✓        | Appended to every interactive user message (max 1000 chars, not visible in UI)       |

## AI Tab System

| Field            | Type          | Optional | Description                                          |
| ---------------- | ------------- | -------- | ---------------------------------------------------- |
| aiTabs           | `AITab[]`     |          | Multiple conversation tabs within this session       |
| activeTabId      | `string`      |          | ID of the currently active AI tab                    |
| closedTabHistory | `ClosedTab[]` |          | Undo stack for closed AI tabs (max 25, runtime-only) |

## File Preview Tabs

| Field                   | Type                        | Optional | Description                                               |
| ----------------------- | --------------------------- | -------- | --------------------------------------------------------- |
| filePreviewTabs         | `FilePreviewTab[]`          |          | Open file preview tabs                                    |
| activeFileTabId         | `string \| null`            |          | Active file tab ID (`null` if an AI tab is active)        |
| unifiedTabOrder         | `UnifiedTabRef[]`           |          | Visual order of all tabs (AI + file)                      |
| unifiedClosedTabHistory | `ClosedTabEntry[]`          |          | Unified undo stack for Cmd+Shift+T (max 25, runtime-only) |
| filePreviewHistory      | `{ name, content, path }[]` | ✓        | Per-session file preview navigation history               |
| filePreviewHistoryIndex | `number`                    | ✓        | Current index in file preview navigation history          |

## Execution Queue

| Field          | Type           | Optional | Description                                                                |
| -------------- | -------------- | -------- | -------------------------------------------------------------------------- |
| executionQueue | `QueuedItem[]` |          | Sequential execution queue — messages and commands processed one at a time |

## Logs

| Field     | Type            | Optional | Description                    |
| --------- | --------------- | -------- | ------------------------------ |
| aiLogs    | `LogEntry[]`    |          | AI conversation output history |
| shellLogs | `LogEntry[]`    |          | Terminal output history        |
| workLog   | `WorkLogItem[]` |          | Work tracking entries          |

## Usage & Analytics

| Field        | Type         | Optional | Description                             |
| ------------ | ------------ | -------- | --------------------------------------- |
| usageStats   | `UsageStats` | ✓        | Token usage and cost statistics         |
| contextUsage | `number`     |          | Context window usage percentage (0–100) |

## Git & Repository

| Field            | Type             | Optional | Description                                                              |
| ---------------- | ---------------- | -------- | ------------------------------------------------------------------------ |
| isGitRepo        | `boolean`        |          | Whether git features are enabled                                         |
| gitRoot          | `string`         | ✓        | Git repository root path (may differ from cwd for subdirectory repos)    |
| isBareRepo       | `boolean`        | ✓        | True when gitRoot points to a bare repo (suppresses branch/diff display) |
| changedFiles     | `FileArtifact[]` |          | Git change tracking                                                      |
| gitBranches      | `string[]`       | ✓        | Branch cache for tab completion                                          |
| gitTags          | `string[]`       | ✓        | Tag cache for tab completion                                             |
| gitRefsCacheTime | `number`         | ✓        | Timestamp when branches/tags were last fetched                           |

## Worktree Support

| Field              | Type                                          | Optional | Description                                                                          |
| ------------------ | --------------------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| worktreeConfig     | `{ basePath: string; watchEnabled: boolean }` | ✓        | Only on parent sessions — directory where worktrees are stored + chokidar watch flag |
| parentSessionId    | `string`                                      | ✓        | Only on worktree children — links back to parent agent session                       |
| worktreeBranch     | `string`                                      | ✓        | Git branch this worktree is checked out to                                           |
| worktreesExpanded  | `boolean`                                     | ✓        | Whether worktree children are expanded in sidebar (parent sessions only)             |
| worktreeParentPath | `string`                                      | ✓        | **Legacy** — worktree parent path for auto-discovery (to be migrated)                |

## File Explorer

| Field                       | Type                                                   | Optional | Description                                                                     |
| --------------------------- | ------------------------------------------------------ | -------- | ------------------------------------------------------------------------------- |
| fileTree                    | `any[]`                                                |          | File tree structure                                                             |
| fileExplorerExpanded        | `string[]`                                             |          | Expanded folder paths                                                           |
| fileExplorerScrollPos       | `number`                                               |          | Scroll position                                                                 |
| fileTreeError               | `string`                                               | ✓        | Error message if file tree loading failed                                       |
| fileTreeRetryAt             | `number`                                               | ✓        | Timestamp when file tree should be retried after error (for backoff)            |
| fileTreeStats               | `{ fileCount, folderCount, totalSize }`                | ✓        | File tree statistics                                                            |
| fileTreeLoadingProgress     | `{ directoriesScanned, filesFound, currentDirectory }` | ✓        | Loading progress (shown during slow SSH connections)                            |
| fileTreeLoading             | `boolean`                                              | ✓        | Whether file tree is currently loading                                          |
| fileTreeLastScanTime        | `number`                                               | ✓        | Unix timestamp (seconds) of last successful scan — used for incremental refresh |
| fileTreeAutoRefreshInterval | `number`                                               | ✓        | Auto-refresh interval in seconds (0 = disabled)                                 |

## Auto Run / Batch

| Field                       | Type                  | Optional | Description                                                   |
| --------------------------- | --------------------- | -------- | ------------------------------------------------------------- |
| autoRunFolderPath           | `string`              | ✓        | Persisted folder path for Runner Docs                         |
| autoRunSelectedFile         | `string`              | ✓        | Currently selected markdown filename                          |
| autoRunContent              | `string`              | ✓        | Document content (per-session to prevent cross-contamination) |
| autoRunContentVersion       | `number`              | ✓        | Incremented on external file changes to force-sync            |
| autoRunMode                 | `'edit' \| 'preview'` | ✓        | Current editing mode                                          |
| autoRunEditScrollPos        | `number`              | ✓        | Scroll position in edit mode                                  |
| autoRunPreviewScrollPos     | `number`              | ✓        | Scroll position in preview mode                               |
| autoRunCursorPosition       | `number`              | ✓        | Cursor position in edit mode                                  |
| batchRunnerPrompt           | `string`              | ✓        | Custom batch runner prompt (persisted per session)            |
| batchRunnerPromptModifiedAt | `number`              | ✓        | Timestamp when batch runner prompt was last modified          |

## SSH Remote Execution

| Field                  | Type                                         | Optional | Description                                            |
| ---------------------- | -------------------------------------------- | -------- | ------------------------------------------------------ |
| sshRemote              | `{ id, name, host }`                         | ✓        | SSH remote being used for agent execution              |
| sshRemoteId            | `string`                                     | ✓        | SSH remote config ID (flattened from `sshRemote.id`)   |
| remoteCwd              | `string`                                     | ✓        | Current working directory on remote host               |
| sessionSshRemoteConfig | `{ enabled, remoteId, workingDirOverride? }` | ✓        | Per-session SSH remote config (overrides agent-level)  |
| sshConnectionFailed    | `boolean`                                    | ✓        | Runtime only — set when background SSH operations fail |

## Web / Live Sessions

| Field   | Type      | Optional | Description                                     |
| ------- | --------- | -------- | ----------------------------------------------- |
| isLive  | `boolean` |          | Whether session is accessible via web interface |
| liveUrl | `string`  | ✓        | Live session URL                                |

## Command History

| Field               | Type                         | Optional | Description                                                       |
| ------------------- | ---------------------------- | -------- | ----------------------------------------------------------------- |
| aiCommandHistory    | `string[]`                   | ✓        | AI input history                                                  |
| shellCommandHistory | `string[]`                   | ✓        | Terminal input history                                            |
| agentCommands       | `{ command, description }[]` | ✓        | Agent slash commands available (fetched per session based on cwd) |

## Error Handling

| Field            | Type         | Optional | Description                                                      |
| ---------------- | ------------ | -------- | ---------------------------------------------------------------- |
| agentError       | `AgentError` | ✓        | Current agent error (auth, tokens, rate limit, etc.)             |
| agentErrorTabId  | `string`     | ✓        | Tab ID where the error originated (for tab-scoped banners)       |
| agentErrorPaused | `boolean`    | ✓        | Whether operations are paused due to error (blocks new messages) |

## Per-Session Agent Config Overrides

| Field               | Type                     | Optional | Description                                          |
| ------------------- | ------------------------ | -------- | ---------------------------------------------------- |
| customPath          | `string`                 | ✓        | Custom path to agent binary (overrides agent-level)  |
| customArgs          | `string`                 | ✓        | Custom CLI arguments (overrides agent-level)         |
| customEnvVars       | `Record<string, string>` | ✓        | Custom environment variables (overrides agent-level) |
| customModel         | `string`                 | ✓        | Custom model ID (overrides agent-level)              |
| customProviderPath  | `string`                 | ✓        | Custom provider path (overrides agent-level)         |
| customContextWindow | `number`                 | ✓        | Custom context window size (overrides agent-level)   |

## Terminal

| Field              | Type     | Optional | Description                                                       |
| ------------------ | -------- | -------- | ----------------------------------------------------------------- |
| terminalScrollTop  | `number` | ✓        | Saved scroll position for terminal/shell output view              |
| terminalDraftInput | `string` | ✓        | Draft input for terminal mode (persisted across session switches) |

## Advanced Features

| Field               | Type                                      | Optional | Description                                                              |
| ------------------- | ----------------------------------------- | -------- | ------------------------------------------------------------------------ |
| wizardState         | `SessionWizardState`                      | ✓        | Per-session inline wizard state for `/wizard` command                    |
| documentGraphLayout | `'mindmap' \| 'radial' \| 'force'`        | ✓        | Document Graph layout algorithm preference (overrides global default)    |
| projectFolderIds    | `string[]`                                | ✓        | Project Folders this session belongs to (empty/undefined = "Unassigned") |
| symphonyMetadata    | `SymphonySessionMetadata`                 | ✓        | Symphony contribution metadata (only set for Symphony sessions)          |
| cliActivity         | `{ playbookId, playbookName, startedAt }` | ✓        | Present when CLI is running a playbook on this session                   |

---

## Related Types

### AITab

Each tab represents a separate AI agent conversation within a session.

| Field                | Type                 | Optional | Description                                                                         |
| -------------------- | -------------------- | -------- | ----------------------------------------------------------------------------------- |
| id                   | `string`             |          | Unique tab ID (generated UUID)                                                      |
| agentSessionId       | `string \| null`     |          | Agent session UUID (`null` for new tabs)                                            |
| name                 | `string \| null`     |          | User-defined name (`null` = show UUID octet)                                        |
| starred              | `boolean`            |          | Whether session is starred (for pill display)                                       |
| locked               | `boolean`            | ✓        | Prevents tab closure when true                                                      |
| logs                 | `LogEntry[]`         |          | Conversation history                                                                |
| agentError           | `AgentError`         | ✓        | Tab-specific agent error (shown in banner)                                          |
| inputValue           | `string`             |          | Pending input text for this tab                                                     |
| stagedImages         | `string[]`           |          | Staged images (base64) for this tab                                                 |
| usageStats           | `UsageStats`         | ✓        | Token usage for this tab (current context window state)                             |
| cumulativeUsageStats | `UsageStats`         | ✓        | Cumulative token usage (never decreases, for pill display)                          |
| createdAt            | `number`             |          | Timestamp for ordering                                                              |
| state                | `'idle' \| 'busy'`   |          | Tab-level state for write-mode tracking                                             |
| readOnlyMode         | `boolean`            | ✓        | When true, agent operates in plan/read-only mode                                    |
| saveToHistory        | `boolean`            | ✓        | When true, synopsis is saved to History on completion                               |
| lastSynopsisTime     | `number`             | ✓        | Timestamp of last synopsis generation                                               |
| showThinking         | `ThinkingMode`       |          | Controls thinking display: `'off'` \| `'on'` (temporary) \| `'sticky'` (persistent) |
| awaitingSessionId    | `boolean`            | ✓        | True when tab sent a message and is awaiting its session ID                         |
| thinkingStartTime    | `number`             | ✓        | Timestamp when tab started thinking                                                 |
| scrollTop            | `number`             | ✓        | Saved scroll position for this tab's output view                                    |
| hasUnread            | `boolean`            | ✓        | True when tab has new messages user hasn't seen                                     |
| isAtBottom           | `boolean`            | ✓        | True when user is scrolled to bottom of output                                      |
| pendingMergedContext | `string`             | ✓        | Context from merge that needs to be sent with next message                          |
| autoSendOnActivate   | `boolean`            | ✓        | Automatically send `inputValue` when tab becomes active                             |
| wizardState          | `SessionWizardState` | ✓        | Per-tab inline wizard state for `/wizard` command                                   |
| isGeneratingName     | `boolean`            | ✓        | True while automatic tab naming is in progress                                      |

### FilePreviewTab

In-tab file viewing. Tabs persist across session switches and app restarts.

| Field             | Type                        | Optional | Description                                                                |
| ----------------- | --------------------------- | -------- | -------------------------------------------------------------------------- |
| id                | `string`                    |          | Unique tab ID (UUID)                                                       |
| path              | `string`                    |          | Full file path                                                             |
| name              | `string`                    |          | Filename without extension (displayed as tab name)                         |
| extension         | `string`                    |          | File extension with dot (e.g., `'.md'`, `'.ts'`) — shown as badge          |
| content           | `string`                    |          | File content (stored directly — file previews are typically small)         |
| scrollTop         | `number`                    |          | Saved scroll position                                                      |
| searchQuery       | `string`                    |          | Preserved search query                                                     |
| editMode          | `boolean`                   |          | Whether tab was in edit mode                                               |
| editContent       | `string \| undefined`       |          | Unsaved edit content (`undefined` if no pending changes)                   |
| createdAt         | `number`                    |          | Timestamp for ordering                                                     |
| lastModified      | `number`                    |          | Timestamp (ms) when file was last modified on disk (for refresh detection) |
| sshRemoteId       | `string`                    | ✓        | SSH remote ID for re-fetching content if needed                            |
| isLoading         | `boolean`                   | ✓        | True while content is being loaded (for SSH remote files)                  |
| navigationHistory | `FilePreviewHistoryEntry[]` | ✓        | Stack of visited files for breadcrumb navigation                           |
| navigationIndex   | `number`                    | ✓        | Current position in navigation history                                     |

### UnifiedTabRef

```typescript
type UnifiedTabRef = { type: 'ai' | 'file'; id: string };
```

Reference to any tab in the unified tab system. Used for unified tab ordering across different tab types.

### ClosedTabEntry

```typescript
type ClosedTabEntry =
	| { type: 'ai'; tab: AITab; unifiedIndex: number; closedAt: number }
	| { type: 'file'; tab: FilePreviewTab; unifiedIndex: number; closedAt: number };
```

Discriminated union for undo functionality (Cmd+Shift+T). Uses `unifiedIndex` for restoring position in the unified tab order.

### QueuedItem

| Field              | Type             | Optional | Description                               |
| ------------------ | ---------------- | -------- | ----------------------------------------- |
| id                 | `string`         |          | Unique item ID                            |
| timestamp          | `number`         |          | When it was queued (for ordering)         |
| tabId              | `string`         |          | Target tab for this item                  |
| type               | `QueuedItemType` |          | `'message'` or `'command'`                |
| text               | `string`         | ✓        | Message text                              |
| images             | `string[]`       | ✓        | Attached images (base64)                  |
| command            | `string`         | ✓        | Slash command (e.g., `'/commit'`)         |
| commandArgs        | `string`         | ✓        | Arguments after the command               |
| commandDescription | `string`         | ✓        | Command description for display           |
| tabName            | `string`         | ✓        | Tab name at time of queuing (for display) |
| readOnlyMode       | `boolean`        | ✓        | True if queued from a read-only tab       |

### AgentError

Defined in `src/shared/types.ts`. Represents runtime errors from agents (auth failures, token limits, rate limits, etc.).

```typescript
type AgentErrorType = 'auth' | 'tokens' | 'rate_limit' | 'network' | 'crash' | 'unknown';
type AgentErrorRecovery = 'retry' | 'reauth' | 'wait' | 'restart' | 'dismiss';
```

### LogEntry

| Field                | Type                                                                                    | Optional | Description                                             |
| -------------------- | --------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------- |
| id                   | `string`                                                                                |          | Unique entry ID                                         |
| timestamp            | `number`                                                                                |          | Entry timestamp                                         |
| source               | `'stdout' \| 'stderr' \| 'system' \| 'user' \| 'ai' \| 'error' \| 'thinking' \| 'tool'` |          | Log source type                                         |
| text                 | `string`                                                                                |          | Message text                                            |
| interactive          | `boolean`                                                                               | ✓        | Whether entry expects interactive input                 |
| options              | `string[]`                                                                              | ✓        | Options for interactive prompts                         |
| images               | `string[]`                                                                              | ✓        | Attached images (base64)                                |
| aiCommand            | `{ command, description }`                                                              | ✓        | For custom AI commands — metadata for display           |
| delivered            | `boolean`                                                                               | ✓        | For user messages — tracks if message was sent to agent |
| readOnly             | `boolean`                                                                               | ✓        | For user messages — tracks if sent in read-only mode    |
| agentError           | `AgentError`                                                                            | ✓        | For error entries — full error for "View Details"       |
| metadata             | `{ toolState?: { status?, input?, output? } }`                                          | ✓        | Tool execution state and details                        |
| rating               | `'liked' \| 'disliked' \| null`                                                         | ✓        | User rating for AI responses                            |
| savedToLibrary       | `boolean`                                                                               | ✓        | Whether response was saved to Prompt Library            |
| promptLibraryEntryId | `string`                                                                                | ✓        | ID of the Prompt Library entry                          |
| elapsedMs            | `number`                                                                                | ✓        | Elapsed time in ms for AI responses (set on completion) |
| streamStartTime      | `number`                                                                                | ✓        | Timestamp when AI response started streaming            |
| pinned               | `boolean`                                                                               | ✓        | Whether message is pinned to sidebar                    |
| pinnedAt             | `number`                                                                                | ✓        | Timestamp when pinned                                   |
| pinSortOrder         | `number`                                                                                | ✓        | Custom sort order for pin reordering                    |

### WorkLogItem

| Field        | Type     | Optional | Description             |
| ------------ | -------- | -------- | ----------------------- |
| id           | `string` |          | Unique item ID          |
| title        | `string` |          | Work item title         |
| description  | `string` |          | Work item description   |
| timestamp    | `number` |          | When the work occurred  |
| relatedFiles | `number` | ✓        | Number of related files |

### FileArtifact

| Field        | Type             | Optional | Description                              |
| ------------ | ---------------- | -------- | ---------------------------------------- |
| path         | `string`         |          | File path                                |
| type         | `FileChangeType` |          | `'modified'` \| `'added'` \| `'deleted'` |
| linesAdded   | `number`         | ✓        | Lines added                              |
| linesRemoved | `number`         | ✓        | Lines removed                            |

### SessionWizardState

Per-session/per-tab wizard state for the `/wizard` command. See `src/renderer/types/index.ts` for the full definition (~30 fields covering wizard mode, conversation history, document generation, and thinking display).

---

## Code Conventions

### TypeScript

- Strict mode enabled
- Interface definitions for all data structures
- Types exported via `preload.ts` for renderer

### React Components

- Functional components with hooks
- Tailwind for layout, inline styles for theme colors
- `tabIndex={-1}` + `outline-none` for programmatic focus

### Commit Messages

```
feat: new feature
fix: bug fix
docs: documentation
refactor: code refactoring
```

**IMPORTANT**: Do NOT create a `CHANGELOG.md` file. This project does not use changelogs - all change documentation goes in commit messages and PR descriptions only.
