# CLAUDE-AGENTS.md

Agent support documentation for the Maestro codebase. For the main guide, see [[CLAUDE.md]]. For detailed integration instructions, see [AGENT_SUPPORT.md](AGENT_SUPPORT.md).

## Supported Agents

| ID              | Name          | Status          | Notes                                                                                                                               |
| --------------- | ------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `claude-code`   | Claude Code   | **Active**      | Primary agent, `--print --verbose --output-format stream-json`                                                                      |
| `codex`         | Codex         | **Active**      | Full support, `--json`, YOLO mode default                                                                                           |
| `gemini-cli`    | Gemini CLI    | **Placeholder** | Google Gemini CLI, `--output-format stream-json`                                                                                    |
| `qwen3-coder`   | Qwen3 Coder   | **Placeholder** | Alibaba Qwen coding model, capabilities TBD                                                                                         |
| `opencode`      | OpenCode      | **Active**      | Multi-provider support (75+ LLMs), stub provider session storage                                                                    |
| `factory-droid` | Factory Droid | **Active**      | Factory's AI coding assistant, `-o stream-json`                                                                                     |
| `copilot-cli`   | Copilot-CLI   | **Beta**        | `-p/--prompt`, `--output-format json`, `--resume`, `@image` mentions, permission filters, reasoning stream, models.dev model picker |
| `aider`         | Aider         | **Placeholder** | AI pair programming, capabilities TBD                                                                                               |
| `terminal`      | Terminal      | Internal        | Hidden from UI, used for shell sessions                                                                                             |

## Agent Capabilities

Each agent declares capabilities that control UI feature availability. The canonical `AgentCapabilities` interface lives in `src/shared/types.ts` and is re-exported from `src/main/agents/capabilities.ts`. The complete capability list is shown below (25 boolean flags + 1 optional enum).

| Capability                    | Description                              | UI Feature Controlled      |
| ----------------------------- | ---------------------------------------- | -------------------------- |
| `supportsResume`              | Can resume previous conversations        | Resume button              |
| `supportsReadOnlyMode`        | Has plan/read-only mode                  | Read-only toggle           |
| `supportsJsonOutput`          | Emits structured JSON                    | Output parsing             |
| `supportsSessionId`           | Emits provider session ID                | Session ID pill            |
| `supportsImageInput`          | Accepts image attachments                | Attach image button        |
| `supportsImageInputOnResume`  | Accepts images when resuming             | Attach button on resume    |
| `supportsSlashCommands`       | Has discoverable commands                | Slash autocomplete         |
| `supportsSessionStorage`      | Persists browsable provider sessions     | Sessions browser           |
| `supportsCostTracking`        | Reports token costs                      | Cost widget                |
| `supportsUsageStats`          | Reports token counts                     | Context window widget      |
| `supportsBatchMode`           | Runs per-message                         | Batch processing           |
| `requiresPromptToStart`       | No eager spawn, needs prompt             | Deferred spawn             |
| `supportsStreaming`           | Streams output                           | Real-time display          |
| `supportsModelSelection`      | Supports --model flag                    | Model dropdown             |
| `supportsResultMessages`      | Distinguishes final result               | Message classification     |
| `supportsThinkingDisplay`     | Emits thinking/reasoning content         | Thinking panel             |
| `supportsContextMerge`        | Can receive merged context               | Merge option               |
| `supportsContextExport`       | Can export context                       | Export option              |
| `supportsWizard`              | Supports inline wizard structured output | Wizard agent selection     |
| `supportsGroupChatModeration` | Can serve as group chat moderator        | Moderator dropdown         |
| `usesJsonLineOutput`          | Uses JSONL output in batch mode          | CLI batch parsing strategy |
| `usesCombinedContextWindow`   | Uses combined input+output context       | Context bar display mode   |
| `supportsStreamJsonInput`     | Accepts stream-json input via stdin      | Image input method         |
| `supportsAppendSystemPrompt`  | Accepts a system-prompt append flag      | Append-system-prompt path  |
| `supportsProjectMemory`       | Stores per-project memory                | Project memory feature     |
| `imageResumeMode?`            | Image handling on resume (optional)      | Resume image strategy      |

### Claude Token-Source Flags (Claude Code only)

Claude Code's spawn path is uniquely bimodal: it can run via the `maestro-p` TUI (Max-plan quota) or `claude --print` (per-token API billing). Two coupled fields track which path was taken per turn:

- **`session.claudeInteractive`** (`src/shared/types.ts`) - persisted on the agent session as `{ mode: 'interactive' | 'api', modeReason: 'auto' | 'limit' }`. Set by `resolveClaudeSpawnMode()` in `src/main/agents/resolveClaudeSpawnMode.ts` for every Claude spawn surface (desktop turn, Auto Run, group chat, Cue, background synopsis, tab naming). Sticky-limit semantics: once `modeReason === 'limit'`, subsequent spawns stay on API until the Max-plan quota recovers.
- **`HistoryEntry.tokenSource`** + **`tokenSourceReason`** - per-turn copies stamped into the history entry from `session.claudeInteractive` (see `src/renderer/hooks/agent/useAgentSessionManagement.ts`). Drives the history token-source pill (`getTokenSourcePill()` in `HistoryEntryItem.tsx` / `HistoryDetailModal.tsx`). Absent on non-Claude agents and on entries pre-dating the flag.

Mode selection logic lives in `src/main/agents/claude-mode-selector.ts` (`selectMode()`), driven by the cached usage snapshot in `claudeUsageStore`. Replay/back-fill helpers are in `src/main/agents/claude-interactive-replay.ts`. These fields are **not** part of `AgentCapabilities` - they are session/history state, not static per-agent flags.

### Accessing Capabilities

| Context             | Function                                   | Import                                             |
| ------------------- | ------------------------------------------ | -------------------------------------------------- |
| Main process        | `hasCapability(agentId, 'flagName')`       | `src/main/agents/capabilities.ts`                  |
| Renderer callbacks  | `hasCapabilityCached(agentId, 'flagName')` | `src/renderer/hooks/agent/useAgentCapabilities.ts` |
| Renderer components | `useAgentCapabilities(toolType)` hook      | Same file                                          |

### Agent Detection Flow

Agent availability is determined at runtime by `AgentDetector` (`src/main/agents/detector.ts`):

1. **PATH probing** — checks if each agent's `binaryName` exists via `checkBinaryExists()` (from `path-prober.ts`)
2. **Custom path fallback** — if user has configured a custom path, checks that first; falls back to PATH
3. **Capability assignment** — merges static `AGENT_CAPABILITIES` from `capabilities.ts` into the detected `AgentConfig`
4. **Cache** — results are cached after first detection; cleared when custom paths change
5. **Promise deduplication** — concurrent detection calls share the same promise to avoid parallel probing

On the renderer side, `agentStore.ts` (Zustand store) manages the detection lifecycle:

- `refreshAgents()` calls `window.maestro.agents.detect()` IPC and caches results in `availableAgents`
- `getAgentConfig(agentId)` retrieves a cached agent config by ID
- `agentsDetected` boolean tracks whether detection has completed at least once
- Error recovery actions (`clearAgentError`, `restartAgentAfterError`, etc.) compose `sessionStore` mutations with IPC calls

### Display Names & Beta Classification

Centralized in `src/shared/agentMetadata.ts` (importable from any process):

- `getAgentDisplayName(agentId)` — human-readable name with fallback
- `isBetaAgent(agentId)` — beta badge check

The backing data (`AGENT_DISPLAY_NAMES` record, `BETA_AGENTS` set) is module-private. Use the functions above to access it.

## Agent-Specific Details

### Claude Code

- **Binary:** `claude`
- **JSON Output:** `--output-format stream-json`
- **Resume:** `--resume <session-id>`
- **Read-only:** `--permission-mode plan`
- **Session Storage:** `~/.claude/projects/<encoded-path>/`
- **Append System Prompt:** `--append-system-prompt`
- **Project Memory:** `~/.claude/projects/<path>/memory/`
- **Token Source (Maestro-only):** Each spawn is resolved by `resolveClaudeSpawnMode()` to either `interactive` (maestro-p TUI driving the Max-plan quota) or `api` (`claude --print`). The decision is persisted on `session.claudeInteractive` and stamped per turn onto `HistoryEntry.tokenSource` / `tokenSourceReason`. See the Claude Token-Source Flags section above.

### Codex

- **Binary:** `codex`
- **JSON Output:** `--json`
- **Batch Mode:** `exec` subcommand
- **Resume:** `resume <thread_id>` (v0.30.0+)
- **Read-only:** `--sandbox read-only`
- **YOLO Mode:** `--dangerously-bypass-approvals-and-sandbox` (enabled by default)
- **Session Storage:** `~/.codex/sessions/YYYY/MM/DD/*.jsonl`

### Gemini CLI

- **Binary:** `gemini`
- **JSON Output:** `--output-format stream-json`
- **YOLO Mode:** `-y` (auto-approve)
- **Working Dir:** `--include-directories <dir>`
- **Model Selection:** `-m <model>` (auto, pro, flash, flash-lite, or full model IDs)
- **Read-only:** Not CLI-enforced; prompt-only enforcement (plan mode requires experimental config)
- **Status:** Placeholder — most capabilities disabled until Gemini CLI is stable and tested

### Qwen3 Coder

- **Binary:** `qwen3-coder`
- **Status:** Placeholder — minimal definition, no argument builders or config options yet

### OpenCode

- **Binary:** `opencode`
- **JSON Output:** `--format json`
- **Batch Mode:** `run` subcommand
- **Resume:** `--session <session-id>`
- **Read-only:** `--agent plan`
- **YOLO Mode:** Auto-enabled via `OPENCODE_CONFIG_CONTENT` env var (blanket `"*":"allow"`)
- **Multi-Provider:** Supports 75+ LLMs including Ollama, LM Studio, llama.cpp
- **Image Input:** `-f <path>` (file attachment)

### Factory Droid

- **Binary:** `droid`
- **JSON Output:** `-o stream-json`
- **Batch Mode:** `exec` subcommand
- **Resume:** `-s <session-id>` (requires a prompt)
- **Read-only:** Default mode in `droid exec` (no flag needed)
- **YOLO Mode:** `--skip-permissions-unsafe`
- **Working Dir:** `--cwd <dir>`
- **Image Input:** `-f <path>`
- **Model Selection:** `-m <model>` (GPT, Claude, Gemini models)
- **Session Storage:** `~/.factory/sessions/` (JSONL files)

### Aider

- **Binary:** `aider`
- **Model Selection:** `--model` flag
- **Status:** Placeholder — capabilities are conservative defaults pending integration

### Copilot-CLI

- **Agent ID:** `copilot-cli`
- **Binary:** `copilot`
- **Status:** Beta (v0.17.0 expansion; see `BETA_AGENTS` set in `src/shared/agentMetadata.ts`)
- **JSON Output:** `--output-format json` (emits JSONL; `usesJsonLineOutput: true`)
- **Batch Mode:** `-p, --prompt <text>`
- **Initial Prompt:** `-i <text>` (interactive mode seed prompt)
- **Resume:** `--continue`, `--resume[=session-id]`
- **Read-only:** CLI-enforced via `--allow-tool=read,url`, `--deny-tool=write,shell,memory,github`, `--no-ask-user`
- **Model Selection:** `--model <model>`
- **Thinking Display:** Streams `assistant.reasoning_delta` / `assistant.reasoning` events through Maestro's thinking-chunk pipeline
- **Result Messages:** `assistant.message` events with `phase=final_answer` (also drives wizard structured output)
- **Usage Stats:** `session.shutdown` event includes `modelMetrics` with per-model token counts. Uses combined input+output context window math (`usesCombinedContextWindow: true`) because Copilot's usage layer reports cumulative input (including cache) regardless of underlying model.
- **Images:** Prompt-embedded `@/tmp/...` mentions (maps Maestro uploads to Copilot file/image mentions). Works on resume as well.
- **Session Storage:** `~/.copilot/session-state/<session-id>/` (local and SSH-remote)
- **Slash Commands:** Supported in interactive mode
- **Group Chat Moderation:** Supported (uses the standard batch-mode orchestration path)
- **Wizard:** Supported via JSON `final_answer` events
- **Model Discovery:** Fetches available models from [models.dev](https://models.dev) (github-copilot provider) with a 3s timeout, falling back to the user's configured model in `~/.copilot/config.json`. See `readCopilotConfiguredModel` / `fetchCopilotModelsFromApi` in `src/main/agents/detector.ts`.
- **Not supported:** `supportsCostTracking`, `supportsStreamJsonInput`, `supportsAppendSystemPrompt`, `supportsProjectMemory` (no CLI equivalents verified).
- **Known Limitations:**
  - **SSH interactive mode:** PTY-based interactive Copilot sessions do not go through `wrapSpawnWithSsh()`, so interactive Copilot over SSH remote is not supported. Batch mode (`-p`) over SSH works correctly via the standard child-process spawner.

## Adding New Agents

To add support for a new agent:

1. Add agent ID to `src/shared/agentIds.ts` → `AGENT_IDS` tuple
2. Add agent definition to `src/main/agents/definitions.ts` → `AGENT_DEFINITIONS`
3. Define capabilities in `src/main/agents/capabilities.ts` → `AGENT_CAPABILITIES` (25 boolean flags + optional `imageResumeMode`)
4. Add display name and beta status to `src/shared/agentMetadata.ts` (internal maps, accessed via `getAgentDisplayName()` / `isBetaAgent()`)
5. Add context window default to `src/shared/agentConstants.ts` → `DEFAULT_CONTEXT_WINDOWS`
6. Sync `AgentCapabilities` interface in renderer: `useAgentCapabilities.ts`, `types/index.ts`, `global.d.ts`
7. (If `supportsJsonOutput`) Create output parser in `src/main/parsers/{agent}-output-parser.ts`, register in `src/main/parsers/index.ts`
8. (If `supportsSessionStorage`) Create session storage extending `BaseSessionStorage` in `src/main/storage/`
9. (Optional) Add error patterns to `src/main/parsers/error-patterns.ts`

The `agent-completeness.test.ts` CI test will fail if required steps are missed. See [AGENT_SUPPORT.md](AGENT_SUPPORT.md) for comprehensive integration documentation.
