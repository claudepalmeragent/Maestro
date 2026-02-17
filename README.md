# Maestro

> **Regenerated**: 2026-02-17
> **Archived version**: `__MD_ARCHIVE/README_20260217_182050.md`
> **Cross-reference**: [`Codebase_Context_20260217_180422.md`](./Codebase_Context_20260217_180422.md)

[![npm version](https://img.shields.io/npm/v/maestro-app)](https://www.npmjs.com/package/maestro-app)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)]()

**A cross-platform desktop app for orchestrating AI agent fleets.**

Manage multiple AI coding assistants simultaneously with a keyboard-first
interface. Maestro transforms fractured attention into focused productivity.

---

## Power Features

- **Git Worktrees** - Isolated working directories per agent session for
  conflict-free parallel development.
- **Auto Run & Playbooks** - Automated task execution with reusable playbook
  definitions for common workflows.
- **Group Chat** - Multi-agent coordination where multiple AI agents
  collaborate on shared tasks.
- **Mobile Remote Control** - Control your agent fleet from your phone via
  QR-code pairing.
- **CLI** - Command-line interface for scripting and automation.
- **Multi-Agent Management** - Support for 7 agents: Claude Code, Codex,
  OpenCode, Terminal, Gemini CLI, Qwen3 Coder, and Aider.
- **Message Queueing** - Queue messages while agents are busy; they process
  sequentially when ready.
- **SSH Remote Agents** - Run agent sessions on remote machines via SSH.
- **Prompt Library** - Curated and custom prompt templates for common tasks.

## Core Features

- **Dual-Mode Sessions** - AI agent sessions and native terminal sessions
  side by side.
- **Keyboard-First Design** - Every action accessible via keyboard shortcut.
  Mouse optional.
- **Session Discovery** - Automatically discover and attach to running agent
  sessions.
- **Git Integration** - Branch display, diff views, and worktree management
  built in.
- **File Explorer** - Browse project files with syntax-highlighted preview.
- **Output Filtering** - Filter agent output by type (tool use, errors,
  thinking, etc.).
- **Slash Commands** - Quick actions via `/command` syntax in the input bar.
- **Draft Auto-Save** - Unsent messages persist across session switches and
  app restarts.
- **Speakable Notifications** - Text-to-speech alerts when agents complete
  tasks or need attention.
- **17 Themes (+Custom)** - Built-in themes plus custom theme editor with
  full color control.
- **Cost Tracking** - Dual cost model: Anthropic API costs and Maestro
  platform costs tracked independently.
- **Achievements** - 11-level badge hierarchy rewarding usage milestones.
- **Project Folders** - First-class organizational surface for grouping
  related sessions and groups by project.

## Analytics & Visualization

- **Usage Dashboard** - Comprehensive analytics with 16 chart components
  visualizing session metrics, cost trends, agent utilization, token
  consumption, and productivity patterns. Dual-cost model tracks both
  Anthropic API costs and Maestro platform costs independently.
  Colorblind-accessible palettes ensure readability for all users.
- **Document Graph** - Canvas-based MindMap visualization of project
  documentation relationships. Navigate your project's knowledge graph
  with full keyboard navigation support. Zoom, pan, and explore
  documentation connections visually.

## Architecture

Maestro is built on **Electron + React + TypeScript** with:

- **node-pty** for terminal emulation
- **SQLite** for session analytics and stats
- **Fastify** web server for mobile remote control
- **electron-store** (9 instances) for persistent settings
- **~340 IPC channels** bridging main and renderer processes
- **135 UI components** and **98 hooks** in the renderer

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full breakdown.

---

## Quick Start

### Installation

Download the latest release for your platform from
[GitHub Releases](https://github.com/pedramamini/maestro/releases).

| Platform | Download                          |
|----------|-----------------------------------|
| macOS    | `.dmg` (Apple Silicon & Intel)    |
| Windows  | `.exe` installer                  |
| Linux    | `.AppImage` / `.deb`              |

### Building from Source

**Requirements**: Node.js 22+

```bash
git clone https://github.com/pedramamini/maestro.git
cd maestro
npm install
npm run build
```

### Development

```bash
npm run dev                    # Start in dev mode
npm run lint:eslint            # Lint
npm test                       # Unit tests
npm run test:integration       # Integration tests
npm run test:e2e               # End-to-end tests
npx tsc --noEmit               # Type check (main)
npx tsc --noEmit -p tsconfig.node.json   # Type check (node)
npx tsc --noEmit -p tsconfig.web.json    # Type check (web)
```

### Essential Shortcuts

| Shortcut            | Action                    |
|---------------------|---------------------------|
| `Cmd/Ctrl + N`      | New session               |
| `Cmd/Ctrl + K`      | Command palette           |
| `Cmd/Ctrl + J`      | Toggle sidebar            |
| `Cmd/Ctrl + 1-9`    | Switch to session N       |
| `Cmd/Ctrl + Enter`  | Send message              |
| `Cmd/Ctrl + Shift + P` | Prompt Library         |
| `Cmd/Ctrl + ,`      | Settings                  |
| `Cmd/Ctrl + .`      | Toggle output filter      |
| `Esc`               | Close panel / Cancel      |

---

## Screenshots

![Maestro Main Interface](https://raw.githubusercontent.com/pedramamini/maestro/main/docs/screenshots/main-interface.png)

![Usage Dashboard](https://raw.githubusercontent.com/pedramamini/maestro/main/docs/screenshots/usage-dashboard.png)

![Group Chat](https://raw.githubusercontent.com/pedramamini/maestro/main/docs/screenshots/group-chat.png)

---

## Documentation

Full documentation is available at **[docs.runmaestro.ai](https://docs.runmaestro.ai)**.

Key documentation files in this repository:

- [CONSTITUTION.md](./CONSTITUTION.md) - Guiding philosophy and design tenets
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture overview
- [AGENT_SUPPORT.md](./AGENT_SUPPORT.md) - Full agent integration details
- [CLAUDE-AGENTS.md](./CLAUDE-AGENTS.md) - Agent quick reference
- [CONTRIBUTING.md](./CONTRIBUTING.md) - Contribution guidelines

---

## Community

- **Discord**: [discord.gg/maestro](https://discord.gg/maestro) - Chat with
  the community, get help, share workflows.
- **GitHub Issues**: [github.com/pedramamini/maestro/issues](https://github.com/pedramamini/maestro/issues) -
  Bug reports and feature requests.

---

## License

Maestro is licensed under the [GNU Affero General Public License v3.0](LICENSE)
(AGPL-3.0).

---

## Author

**Pedram Amini** - [pedram@runmaestro.ai](mailto:pedram@runmaestro.ai)

- GitHub: [@pedramamini](https://github.com/pedramamini)
- Website: [runmaestro.ai](https://runmaestro.ai)

---

*For full codebase context, see
[Codebase_Context_20260217_180422.md](./Codebase_Context_20260217_180422.md).*
