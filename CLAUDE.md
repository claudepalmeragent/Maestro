# CLAUDE.md — Maestro v0.14.5

> **Regenerated**: 2026-02-17 — Archived version: `__MD_ARCHIVE/CLAUDE_20260217_182050.md`

## Authoritative Codebase Context

For full architectural detail, module inventories, and metrics, see:
**[Codebase_Context_20260217_180422.md](Codebase_Context_20260217_180422.md)**

---

## Documentation Index

| Document | Purpose |
|----------|---------|
| [CLAUDE-ARCHITECTURE.md](CLAUDE-ARCHITECTURE.md) | Detailed architecture deep-dive |
| [CLAUDE-IPC.md](CLAUDE-IPC.md) | IPC channels and handler reference |
| [CLAUDE-PRELOAD.md](CLAUDE-PRELOAD.md) | Preload bridge modules |
| [CLAUDE-RENDERER.md](CLAUDE-RENDERER.md) | Renderer/React structure |
| [CLAUDE-TESTING.md](CLAUDE-TESTING.md) | Test strategy and suites |
| [CLAUDE-AGENTS.md](CLAUDE-AGENTS.md) | Agent integration details |
| [ARCHITECTURE.md](ARCHITECTURE.md) | High-level architecture overview |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution guidelines |
| [AGENT_SUPPORT.md](AGENT_SUPPORT.md) | Agent support matrix and integration |
| [CONSTITUTION.md](CONSTITUTION.md) | Project principles and constraints |
| [SECURITY.md](SECURITY.md) | Security considerations |
| [THEMES.md](THEMES.md) | Theming system reference |
| [BACKBURNER.md](BACKBURNER.md) | Deferred ideas and future work |
| [README.md](README.md) | Project readme |

---

## Standardized Vernacular

Use these terms consistently across code, docs, and conversation:

| UI Element | Code Name | Description |
|------------|-----------|-------------|
| Left Bar | `SessionList` | Session list sidebar |
| Right Bar | `RightPanel` | Collapsible right panel |
| Main Window | `MainPanel` | Central content area |
| AI Terminal | AI agent session | A session running an AI coding agent |
| Command Terminal | Shell session | A session running a standard shell |
| System Log Viewer | `LogViewer` | Internal log display |

---

## Project Overview

**Maestro** is an Electron desktop application for managing multiple AI coding assistants simultaneously. It provides a unified terminal-based interface for orchestrating sessions across different AI agents, with features including group chat, session management, theming, stats tracking, and a web/mobile companion interface.

- **Version**: 0.14.5
- **Author**: Pedram Amini
- **License**: AGPL 3.0
- **Stack**: Electron + React + TypeScript, node-pty, SQLite, Fastify

---

## Supported Agents

| Agent | Status | Notes |
|-------|--------|-------|
| Claude Code | Fully implemented | Primary agent, deepest integration |
| Codex | Fully implemented | Full feature parity |
| OpenCode | Implemented | Functional integration |
| Terminal | Built-in | Standard shell, always available |
| Gemini CLI | Placeholder | Detection/definition only |
| Qwen3 Coder | Placeholder | Detection/definition only |
| Aider | Placeholder | Detection/definition only |

---

## Quick Commands

```bash
# Development
npm run dev                          # Start in dev mode

# Build
npm run build                        # Production build

# Type checking (3 tsconfig targets)
npx tsc --noEmit                     # Main tsconfig
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json

# Linting
npm run lint:eslint                  # ESLint

# Testing
npm test                             # Unit tests
npm run test:integration             # Integration tests
npm run test:e2e                     # End-to-end tests
npm run test:performance             # Performance benchmarks

# Cleanup
npm run clean                        # Remove build artifacts
```

---

## Architecture at a Glance

```
src/
├── main/                    # Electron main process
│   ├── index.ts             # Entry point (24KB, 711 lines)
│   ├── agents/              # Agent detection, capabilities, definitions
│   ├── app-lifecycle/       # CLI watcher, error handlers, quit, window manager
│   ├── debug-package/       # Debug packaging
│   ├── group-chat/          # Multi-agent group chat (9 files)
│   ├── ipc/handlers/        # 32 IPC handler modules (~340 channels)
│   ├── parsers/             # Agent output parsers
│   ├── preload/             # 27 preload bridge modules
│   ├── process-listeners/   # Event listeners
│   ├── process-manager/     # PTY + child process management
│   ├── services/            # Audit, reconstruction services
│   ├── stats/               # SQLite stats DB (13 modules)
│   ├── storage/             # Agent session storage
│   ├── stores/              # 9 electron-store instances
│   ├── utils/               # 27 utility modules
│   └── web-server/          # Fastify web server
├── renderer/                # React frontend (desktop)
│   ├── App.tsx              # Main coordinator (468KB, 13,943 lines)
│   ├── components/          # 135 UI components
│   ├── hooks/               # 98 hooks across 12 directories
│   ├── contexts/            # 11 React contexts
│   ├── services/            # 11 IPC wrapper services
│   ├── constants/           # 8 constant files
│   ├── types/               # Type definitions
│   └── utils/               # UI utilities (27+ files)
├── web/                     # Web/mobile interface
├── cli/                     # CLI tooling (7 commands)
├── prompts/                 # 22 system prompt .md files
├── shared/                  # 20 shared type/utility files
├── generated/               # Auto-generated files
├── types/                   # Global type declarations
├── docs/                    # Mintlify documentation
└── __tests__/               # Test suites
```

For full module breakdowns, see [Codebase_Context_20260217_180422.md](Codebase_Context_20260217_180422.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Key Files for Common Tasks

| Task | File(s) |
|------|---------|
| **IPC** | |
| Add IPC handler | `src/main/ipc/handlers/` — add module, register in `src/main/ipc/index.ts` |
| Add preload API | `src/main/preload/` (27 bridge modules) |
| Modify IPC channel | Find handler in `src/main/ipc/handlers/`, update preload in `src/main/preload/` |
| **Renderer** | |
| Add component | `src/renderer/components/` |
| Add hook | `src/renderer/hooks/<domain>/` (12 domain directories) |
| Add context | `src/renderer/contexts/` |
| Add modal | Component + `src/renderer/constants/modalPriorities.ts` + `src/renderer/contexts/ModalContext.tsx` |
| Add keyboard shortcut | `src/renderer/constants/shortcuts.ts` + `src/renderer/hooks/keyboard/useMainKeyboardHandler.ts` |
| Add IPC service wrapper | `src/renderer/services/` |
| Add UI constant | `src/renderer/constants/` |
| Add utility (UI) | `src/renderer/utils/` |
| **Agents** | |
| Configure agent | `src/main/agents/definitions.ts` + `src/main/agents/capabilities.ts` |
| Add agent detection | `src/main/agents/` |
| Add agent session storage | `src/main/storage/` |
| Add agent output parser | `src/main/parsers/` — register via `registerOutputParser()` |
| **Main Process** | |
| Add stats/analytics | `src/main/stats/` (13 modules, SQLite) |
| Add electron-store | `src/main/stores/` (9 store instances) |
| Add setting | `src/main/stores/types.ts` + `src/renderer/hooks/settings/useSettings.ts` |
| Add theme | `src/shared/themes.ts` |
| Add system prompt | `src/prompts/` (22 .md files) |
| Add shared type | `src/shared/` |
| Add global type declaration | `src/types/` |
| **App Lifecycle** | |
| Modify startup/quit | `src/main/app-lifecycle/` |
| Modify window management | `src/main/app-lifecycle/` (window manager module) |
| Add CLI watcher | `src/main/app-lifecycle/` |
| **Group Chat** | |
| Modify group chat | `src/main/group-chat/` (9 files) |
| **Process Management** | |
| Modify PTY handling | `src/main/process-manager/` |
| Add process listener | `src/main/process-listeners/` |
| **Services** | |
| Modify audit/reconstruction | `src/main/services/` |
| Add web server route | `src/main/web-server/` |
| **Other** | |
| Add CLI command | `src/cli/` (7 commands) |
| Modify web/mobile UI | `src/web/` |
| Add auto-generated file | `src/generated/` |
| Add test | `src/__tests__/` |
| Add documentation page | `src/docs/` (Mintlify) |
| Debug packaging | `src/main/debug-package/` |

---

## Debugging Tips

- **Focus issues**: Check the `LayerStack` system. Modals, dropdowns, and panels register layers; focus is routed to the topmost active layer.
- **Settings not persisting**: Verify the electron-store path and that the correct store instance (of 9) is being used. Check `src/main/stores/`.
- **Modal won't close on Escape**: The `LayerStack` priority system controls which layer receives the Escape key. Check `src/renderer/constants/modalPriorities.ts` for ordering.
- **Dev tools**: `Ctrl+Shift+I` opens Chromium DevTools in the renderer.
- **Agent not detected**: Check `src/main/agents/` for detection logic; agents must be on `$PATH` or configured explicitly.
- **IPC not working**: Verify the channel is registered in all three layers: handler (`src/main/ipc/handlers/`), preload (`src/main/preload/`), and renderer service (`src/renderer/services/`).

---

## MCP Server

Maestro documentation is searchable via MCP using the **SearchMaestro** tool.

- Endpoint: [docs.runmaestro.ai/mcp](https://docs.runmaestro.ai/mcp)
