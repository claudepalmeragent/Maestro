# Security Policy — Maestro v0.14.5

> Regenerated 2026-02-17, archived at `__MD_ARCHIVE/SECURITY_20260217_182050.md`.
> Cross-ref `Codebase_Context_20260217_180422.md`.

---

## 1. Reporting Security Vulnerabilities

For most security issues, please open a GitHub issue with the `security` label.

For **critical vulnerabilities** that could affect users before a fix is available,
contact the maintainer directly via email: **pedram@runmaestro.ai**

## 2. Scope

### In-Scope

- Application code
- IPC communication
- Process spawning
- File system operations
- Web server authentication
- SSH remote execution
- Preload bridge security

### Out-of-Scope

- AI agent vulnerabilities — Claude Code, Codex, and OpenCode are external tools
  and not maintained by this project
- Upstream Electron/Node.js dependencies
- Social engineering
- Denial-of-service (DoS) attacks
- Physical access attacks

> **Note:** Gemini CLI, Qwen3 Coder, and Aider are placeholder agents not yet fully
> implemented and are therefore also out-of-scope.

## 3. Response Timeline

Maestro is a **volunteer-maintained open source project**. There are no guaranteed
response timelines for security reports. Critical issues will be prioritized as
maintainer availability allows.

## 4. Recognition

Contributors who responsibly disclose security vulnerabilities will receive credit
in the release notes of the version containing the fix.

## 5. Bug Bounty

**None.** Maestro is an open source project and does not operate a bug bounty program.

## 6. Known Security Considerations

### Process Execution

Agents run with user-level privileges via `child_process` and PTY. External commands
are invoked using `execFileNoThrow`, which avoids shell execution and the associated
injection risks.

### Local Web Server

The web interface is served via Fastify bound to `localhost`. Authentication uses a
random UUID token that is regenerated on every restart. Requests with invalid tokens
are redirected to `runmaestro.ai`. Rate limiting is applied on all endpoints.

### Tunnel Exposure

An optional tunnel feature can expose the web interface externally. When enabled,
the same token-based authentication protects the exposed endpoint.

### IPC Security

Electron is configured with hardened defaults:

- `contextIsolation = true`
- `nodeIntegration = false`
- Hardened runtime enabled on macOS

There are currently 27 preload modules exposed via `contextBridge`. The deprecated
`window.maestro.claude.*` namespace still exists for backward compatibility — it
emits console warnings on use and is planned for removal in a future release.

### Sentry DSN

The Sentry DSN included in the source is **public by design** (standard practice for
client-side error reporting). Crash reporting is opt-in.

### SSH Remote Execution

SSH connections use `ControlMaster` socket pooling with the following settings:

- `BatchMode=yes`
- `StrictHostKeyChecking=accept-new`

Socket cleanup is performed at both startup and shutdown.

### Settings Sync

Path values are validated to ensure they are:

- Absolute paths
- Free of null bytes
- Free of directory traversal sequences
- Not pointing to system directories

## 7. Security Best Practices for Contributors

- **Use `execFileNoThrow` for external commands** — never use `exec` or `execSync`
  with shell interpolation.
- **Validate IPC inputs** via the `createIpcHandler()` envelope pattern.
- **Minimize the preload API surface** — avoid exposing new APIs through the bridge
  unless strictly necessary.
- **Sanitize file paths** — reject any input containing traversal sequences.
- **Web server input validation** — sanitize `sessionId` and `tabId` parameters
  with the `[a-zA-Z0-9_-]+` regex pattern.
- **No secrets in debug packages** — API keys and conversation content must be
  excluded from any debug or diagnostic output.

---

*This document covers the security posture of Maestro as of v0.14.5. For questions
or clarifications, reach out via GitHub issues or the maintainer email above.*
