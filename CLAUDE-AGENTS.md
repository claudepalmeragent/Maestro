# CLAUDE-AGENTS.md - Agent Support Quick Reference

> **Regenerated**: 2026-02-17
> **Archived version**: `__MD_ARCHIVE/CLAUDE-AGENTS_20260217_182050.md`
> **Cross-reference**: [`Codebase_Context_20260217_180422.md`](./Codebase_Context_20260217_180422.md)

Agent support quick reference for **Maestro v0.14.5**. For full implementation
details, see [AGENT_SUPPORT.md](./AGENT_SUPPORT.md).

---

## 1. Supported Agents

| # | Binary Name    | Display Name  | Status           |
|---|----------------|---------------|------------------|
| 1 | `claude`       | Claude Code   | Fully Implemented|
| 2 | `codex`        | Codex         | Fully Implemented|
| 3 | `opencode`     | OpenCode      | Implemented      |
| 4 | (built-in)     | Terminal       | Built-in         |
| 5 | `gemini`       | Gemini CLI    | Placeholder      |
| 6 | `qwen3-coder`  | Qwen3 Coder   | Placeholder      |
| 7 | `aider`        | Aider         | Placeholder      |

**Fully Implemented**: Complete JSON output parsing, resume support, and all
mode flags. **Implemented**: Working output parsing and core flags.
**Placeholder**: Agent definition exists but parser/integration is stubbed.
**Built-in**: Native terminal session, not an external AI agent.

---

## 2. Agent Capabilities

All 19 capability flags and the UI features they gate:

| Capability Flag                    | UI Feature Gated                                      |
|------------------------------------|-------------------------------------------------------|
| `supportsInput`                    | Text input field in session panel                     |
| `supportsStreamJsonInput`          | Streaming JSON input mode for structured messaging    |
| `supportsImageInput`               | Image attachment button in input bar                  |
| `supportsApiKeyAuth`               | API key configuration in agent settings               |
| `supportsMaxAuth`                  | Max authentication flow (OAuth/token-based)           |
| `supportsModelOverride`            | Model selector dropdown in session config             |
| `supportsContextWindowOverride`    | Context window size slider in session config          |
| `supportsReadOnlyMode`             | Read-only toggle in session toolbar                   |
| `supportsYoloMode`                 | YOLO mode toggle (auto-approve all tool use)          |
| `supportsResume`                   | Resume button for interrupted sessions                |
| `supportsSlashCommands`            | Slash command palette in input bar                    |
| `supportsPrintMode`                | Print/non-interactive output mode flag                |
| `supportsCustomPath`               | Custom binary path override in agent settings         |
| `supportsCustomArgs`               | Custom CLI arguments field in agent settings          |
| `supportsCustomEnvVars`            | Environment variable editor in agent settings         |
| `supportsStatusBar`                | Agent status bar with live metrics                    |
| `supportsRemoteExecution`          | SSH remote execution target selector                  |
| `supportsBatch`                    | Batch/multi-prompt execution mode                     |
| `supportsAttachments`              | File attachment support in message input              |

---

## 3. Agent-Specific Details

### Claude Code

- **Binary**: `claude`
- **JSON output**: `--output-format stream-json`
- **Resume args**: `--resume --session-id <id>`
- **Read-only mode**: `--permission-mode bypassPermissions` with read-only flag
- **YOLO mode**: `--dangerously-skip-permissions`

### Codex

- **Binary**: `codex`
- **JSON output**: `--full-json`
- **Resume args**: `--resume <session-id>`
- **Read-only mode**: `--read-only`
- **YOLO mode**: `--full-auto`

### OpenCode

- **Binary**: `opencode`
- **JSON output**: `--json`
- **Resume args**: `--resume <session-id>`
- **Read-only mode**: Not supported
- **YOLO mode**: `--yolo`

---

## 4. Adding New Agents

To add a new agent to Maestro, follow these steps in order. All files reside
under `src/main/agents/`:

1. **`definitions.ts`** - Add agent metadata (binary name, display name, icon,
   description) to the agent definitions registry.

2. **`capabilities.ts`** - Define the capability flags for the new agent.
   Set each of the 19 flags to `true` or `false` based on what the agent
   supports.

3. **`detector.ts`** - Add binary detection logic so Maestro can discover
   whether the agent is installed and resolve its path.

4. **Parser (`registerOutputParser`)** - Implement an output parser that
   converts the agent's stdout/stderr into Maestro's normalized message
   format. Register it via `registerOutputParser`.

5. **Storage** - Ensure session persistence handles the new agent type
   (session creation, resume, history).

6. **Test** - Add unit tests for the parser and integration tests for
   session lifecycle (start, message, resume, stop).

---

## 5. Further Reading

- [AGENT_SUPPORT.md](./AGENT_SUPPORT.md) - Full implementation details,
  parser internals, and capability matrix deep dive.
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture overview.
- [Codebase_Context_20260217_180422.md](./Codebase_Context_20260217_180422.md) -
  Full codebase context snapshot.
