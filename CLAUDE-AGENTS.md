# CLAUDE-AGENTS.md

Agent support documentation for the Maestro codebase. For the main guide, see [[CLAUDE.md]]. For detailed integration instructions, see [AGENT_SUPPORT.md](AGENT_SUPPORT.md).

## Supported Agents

| ID              | Name          | Status          | Notes                                                            |
| --------------- | ------------- | --------------- | ---------------------------------------------------------------- |
| `claude-code`   | Claude Code   | **Active**      | Primary agent, `--print --verbose --output-format stream-json`   |
| `codex`         | Codex         | **Active**      | Full support, `--json`, YOLO mode default                        |
| `gemini-cli`    | Gemini CLI    | **Placeholder** | Google Gemini CLI, `--output-format stream-json`                 |
| `qwen3-coder`   | Qwen3 Coder   | **Placeholder** | Alibaba Qwen coding model, capabilities TBD                      |
| `opencode`      | OpenCode      | **Active**      | Multi-provider support (75+ LLMs), stub provider session storage |
| `factory-droid` | Factory Droid | **Active**      | Factory's AI coding assistant, `-o stream-json`                  |
| `aider`         | Aider         | **Placeholder** | AI pair programming, capabilities TBD                            |
| `terminal`      | Terminal      | Internal        | Hidden from UI, used for shell sessions                          |

## Agent Capabilities

Each agent declares capabilities that control UI feature availability. See `src/main/agents/capabilities.ts` for the full `AgentCapabilities` interface (23 boolean flags + 1 optional). The complete capability list is shown below.

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
| `requiresPromptToStart`       | No eager spawn — needs prompt            | Deferred spawn             |
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
| `imageResumeMode?`            | Image handling on resume (optional)      | Resume image strategy      |

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
- `AGENT_DISPLAY_NAMES` — full `Record<AgentId, string>` map
- `BETA_AGENTS` — `ReadonlySet<AgentId>`

## Agent-Specific Details

### Claude Code

- **Binary:** `claude`
- **JSON Output:** `--output-format stream-json`
- **Resume:** `--resume <session-id>`
- **Read-only:** `--permission-mode plan`
- **Session Storage:** `~/.claude/projects/<encoded-path>/`

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

## Adding New Agents

To add support for a new agent:

1. Add agent ID to `src/shared/agentIds.ts` → `AGENT_IDS` tuple
2. Add agent definition to `src/main/agents/definitions.ts` → `AGENT_DEFINITIONS`
3. Define capabilities in `src/main/agents/capabilities.ts` → `AGENT_CAPABILITIES` (23 boolean flags)
4. Add display name and beta status to `src/shared/agentMetadata.ts` → `AGENT_DISPLAY_NAMES`, `BETA_AGENTS`
5. Add context window default to `src/shared/agentConstants.ts` → `DEFAULT_CONTEXT_WINDOWS`
6. Sync `AgentCapabilities` interface in renderer: `useAgentCapabilities.ts`, `types/index.ts`, `global.d.ts`
7. (If `supportsJsonOutput`) Create output parser in `src/main/parsers/{agent}-output-parser.ts`, register in `src/main/parsers/index.ts`
8. (If `supportsSessionStorage`) Create session storage extending `BaseSessionStorage` in `src/main/storage/`
9. (Optional) Add error patterns to `src/main/parsers/error-patterns.ts`

The `agent-completeness.test.ts` CI test will fail if required steps are missed. See [AGENT_SUPPORT.md](AGENT_SUPPORT.md) for comprehensive integration documentation.
