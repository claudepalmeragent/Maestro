---
title: Installation
description: Download and install Maestro on macOS, Windows, or Linux.
icon: download
---

## Download

Download the latest release for your platform from the [Releases](https://github.com/pedramamini/maestro/releases) page:

- **macOS**: `.dmg` or `.zip`
- **Windows**: `.exe` installer
- **Linux**: `.AppImage`, `.deb`, or `.rpm`
- **Upgrading**: Simply replace the old binary with the new one. All your data (sessions, settings, playbooks, history) persists in your [config directory](./configuration).

## Requirements

- At least one supported AI coding agent installed and authenticated:
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code) - Anthropic's AI coding assistant
  - [OpenAI Codex](https://github.com/openai/codex) - OpenAI's coding agent
  - [OpenCode](https://github.com/sst/opencode) - Open-source AI coding assistant
- Git (optional, for git-aware features)

## WSL2 Users (Windows Subsystem for Linux)

<Warning>
When developing or running Maestro with WSL2, always clone and run from the **native Linux filesystem** (e.g., `/home/username/maestro`), NOT from Windows-mounted paths (`/mnt/c/...`, `/mnt/d/...`).
</Warning>

Using Windows mounts causes several critical issues:

| Issue | Symptom |
|-------|---------|
| Socket binding failures | `EPERM: operation not permitted` when starting dev server |
| Electron sandbox crashes | `FATAL:sandbox_host_linux.cc` errors |
| npm install failures | Timeouts, `ENOTEMPTY` rename errors |
| Git corruption | Missing index files, spurious lock files |

### Recommended WSL2 Setup

```bash
# Clone to Linux filesystem (not /mnt/...)
cd ~
git clone https://github.com/pedramamini/maestro.git
cd maestro

# Install dependencies
npm install

# Run in development mode
npm run dev
```

### Accessing Files from Windows

You can browse your WSL2 files from Windows Explorer using:
```
\\wsl$\Ubuntu\home\<username>\maestro
```

### Troubleshooting WSL2

If you encounter `electron-rebuild` failures, try setting the temp directory:
```bash
TMPDIR=/tmp npm run rebuild
```

For persistent issues, see [Troubleshooting](./troubleshooting) for additional WSL-specific guidance
