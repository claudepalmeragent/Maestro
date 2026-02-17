# CLAUDE-SESSION.md

> **Regenerated**: 2026-02-17
> **Archived version**: `__MD_ARCHIVE/CLAUDE-SESSION_20260217_182050.md`
> **Cross-reference**: `Codebase_Context_20260217_180422.md`

Session interface reference for Maestro v0.14.5.

---

## Authoritative Source

See `src/renderer/types/index.ts` for the authoritative full `Session` and `AITab` interface definitions. This document is a summarized reference; the source file is the ground truth.

---

## Session Interface Summary

The `Session` interface contains 50+ fields organized by domain. Below is a categorized overview.

### Identity

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique session identifier (UUID) |
| `name` | `string` | User-visible session name |
| `groupId` | `string \| null` | Group this session belongs to |
| `toolType` | `string` | Agent tool type identifier |
| `state` | `SessionState` | Current session state |
| `inputMode` | `string` | Current input mode |

### Paths

| Field | Type | Description |
|---|---|---|
| `cwd` | `string` | Current working directory |
| `projectRoot` | `string` | Detected project root |
| `fullPath` | `string` | Full resolved path |
| `remoteCwd` | `string \| undefined` | Remote CWD for SSH sessions |

### Processes

| Field | Type | Description |
|---|---|---|
| `aiPid` | `number \| null` | AI agent process ID |
| `port` | `number \| null` | Communication port |

### Multi-Tab

| Field | Type | Description |
|---|---|---|
| `aiTabs` | `AITab[]` | Array of conversation tabs |
| `activeTabId` | `string \| null` | Currently active tab ID |
| `closedTabHistory` | `AITab[]` | Recently closed tabs for undo |

### Execution Queue

Fields for managing queued commands and sequential execution within a session.

### Usage & Stats

Cumulative and per-tab usage statistics including token counts, cost, and timing.

### Git

| Field | Type | Description |
|---|---|---|
| `branch` | `string \| null` | Current git branch |
| `hasChanges` | `boolean` | Whether working tree has uncommitted changes |

### File Explorer

State for the integrated file explorer panel: expanded directories, selected file, scroll position.

### Web / Live

Fields related to web preview and live reload functionality.

### Auto Run (Batch Run)

| Field | Type | Description |
|---|---|---|
| `batchRunState` | `object \| null` | State of auto-run / batch execution |

### SSH Remote

| Field | Type | Description |
|---|---|---|
| `sshRemoteId` | `string \| null` | SSH remote connection identifier |
| `sessionSshRemoteConfig` | `object \| null` | SSH remote configuration for this session |

### Agent Config

| Field | Type | Description |
|---|---|---|
| `customPath` | `string \| null` | Custom agent binary path |
| `customArgs` | `string[] \| null` | Custom agent arguments |
| `customModel` | `string \| null` | Custom model override |
| `customProviderPath` | `string \| null` | Custom provider configuration path |

### Wizard

| Field | Type | Description |
|---|---|---|
| `wizardState` | `object \| null` | Onboarding/inline wizard state |

### Project Folders

Association with a project folder organizational container.

### Error

| Field | Type | Description |
|---|---|---|
| `agentError` | `string \| null` | Current agent error message |
| `agentErrorPaused` | `boolean` | Whether session is paused due to error |

### Activity

| Field | Type | Description |
|---|---|---|
| `activeTimeMs` | `number` | Cumulative active time in milliseconds |

### Worktree

| Field | Type | Description |
|---|---|---|
| `worktreeConfig` | `object \| null` | Git worktree configuration |
| `worktreeBranch` | `string \| null` | Branch used in worktree |

---

## AITab Interface

Each session contains one or more `AITab` instances representing individual conversation tabs.

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique tab identifier |
| `agentSessionId` | `string \| null` | Agent-side session ID (null before first message) |
| `name` | `string` | Tab display name |
| `logs` | `LogEntry[]` | Conversation log entries |
| `usageStats` | `object` | Current-period usage statistics |
| `cumulativeUsageStats` | `object` | All-time cumulative usage statistics |
| `inputValue` | `string` | Current input field value (NOT `draftInput`) |
| `readOnlyMode` | `boolean` | Whether tab is in read-only mode |
| `showThinking` | `boolean` | Whether to display thinking/reasoning |
| `wizardState` | `object \| null` | Inline wizard state for this tab |
| `rating` | `number \| null` | User rating for this conversation |
| `state` | `SessionState` | Tab-level state |
| `starred` | `boolean` | Whether tab is starred/bookmarked |
| `locked` | `boolean` | Whether tab is locked from editing |
| `hasUnread` | `boolean` | Whether tab has unread messages |
| `createdAt` | `number` | Creation timestamp (epoch ms) |

---

## SessionState

```typescript
type SessionState = 'idle' | 'busy' | 'waiting_input' | 'connecting' | 'error';
```

- **`idle`**: No active operation. Ready for input.
- **`busy`**: Agent is processing a request.
- **`waiting_input`**: Agent is waiting for user confirmation or input.
- **`connecting`**: Establishing connection to agent process.
- **`error`**: Session encountered an error. See `agentError` field.

---

## Code Conventions

1. **TypeScript strict mode** is enforced across the entire codebase. No `any` types without explicit justification.

2. **Functional React components** using `React.memo` for all components that receive props. Class components are not used.

3. **Tailwind CSS + inline styles** for all styling. No CSS modules or styled-components. Inline styles are used only when dynamic values are required (e.g., calculated positions, dimensions).

4. **Conventional commit messages**: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `perf:`, `test:`. Scope is optional but encouraged (e.g., `feat(wizard): add step 4 preparing plan`).

5. **NO `CHANGELOG.md`** file is maintained. Release notes are derived from commit history.
