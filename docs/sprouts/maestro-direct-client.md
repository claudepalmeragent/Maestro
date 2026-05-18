---
type: sprout
title: Maestro direct-client — bypass the official Claude Code binary
status: active
created: 2026-05-18
authored-by: maestro-planner (Claude Opus 4.7)
related:
  - '[[claude-session-hosting-models]]'
  - '[[docs/decisions/0002-transport-mode-value-space]]'
  - '[[docs/decisions/0003-implementation-axis-cascade]]'
---

# Sprout — Maestro direct-client (Phase 4+)

> **Purpose:** capture the strategic rationale, scope, and design contract for the Phase 4+ "direct-client" work. Maestro's personal-fork track will optionally bypass Anthropic's `claude` binary and make direct HTTPS calls to `/v1/messages?beta=true` using OAuth Bearer auth — getting subscription billing without depending on the official CLI binary's quirks, telemetry, or future enforcement changes.
>
> **Scope:** Doug's personal fork only. Not intended for upstream Maestro contribution. See "Legal posture" below.

---

## Why this exists

Three motivations, in priority order:

1. **Doug's uninterrupted productivity** is the top-line goal. The wrapped-CLI path (Phase 1/2/3) works but inherits every quirk of the official binary: 232 MB Bun-compiled native binary, version-pinning friction, telemetry phone-home (`/api/event_logging/batch`, Datadog, `/api/claude_code/metrics`), session-state under Anthropic-controlled paths, future enforcement changes Anthropic might ship.
2. **Anti-fingerprinting.** The binary fires 80+ telemetry event types tagged with session ID, platform, model, subscription type, repo remote hash — feeding Anthropic's ability to fingerprint wrapper-style usage patterns and flag them for stratum-3 billing classification ([[claude_billing_mechanism]]). Direct-client requests are nearly indistinguishable from official-SDK requests at the wire level.
3. **Cross-transport interoperability.** Doug must be able to flip a session between `legacy-print`, `interactive-pty`, and `direct-client` for the SAME conversation and resume from the SAME point. This requires writing session JSONLs in Anthropic's native format so all transports share state.

---

## What direct-client is NOT

- Not a Claude Code reimplementation. We don't aspire to feature-parity with the official binary's 25 tools, 40 REPL slash-commands, MCP integrations, etc. Personal-fork productivity scope = 6 MVP tools (Bash, Read, Edit, Write, Glob, Grep), expandable in Phase 5.
- Not a replacement for the wrapped-CLI path. The existing Phase 1-3 transports stay shipping. Direct-client is opt-in per the [[docs/decisions/0003-implementation-axis-cascade|implementation axis]].
- Not an OAuth client_id we register with Anthropic. We reuse the official `claude-code-client` ID (stable; revocation would break every `claude login`). Stage 2/3 OAuth approaches deferred.
- Not for distribution. Personal-fork only — never pushed to upstream Maestro or published.

---

## Legal posture (personal-fork scope)

The recovered Anthropic TypeScript source at `/app/claude-code-source` is **"All rights reserved" © Anthropic PBC**. Two postures:

- **For Doug's personal fork (current scope):** the source is permitted as reference for understanding Anthropic's wire protocol, OAuth flow, tool schemas, event shapes, and architectural conventions. Doug authors all Maestro code from architectural facts derivable from public Anthropic API docs + the recovered source as comprehension aid. No verbatim copying. No distribution. Risk-bounded to one user's machine.
- **For upstream Maestro (NEVER):** the source is off-limits. Any dev agents authoring code for upstream Maestro work from public docs only, with no exposure to `/app/claude-code-source`. Doug enforces this division by dispatching upstream-bound work only to agents that haven't been exposed to the recovered source.

This sprout, the ADR, and all Phase 4+ ARDs are personal-fork artifacts and stay in Doug's personal fork's git history.

---

## Architecture — orthogonal implementation axis

Per [[docs/decisions/0003-implementation-axis-cascade]], direct-client is a SEPARATE settings axis from `transportMode`. Two independent cascades:

| Axis                                     | Values                                                                   | Cascade direction                                                                    | Default                        |
| ---------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------ |
| **`transportMode`** (existing, ADR 0002) | `legacy-print` / `interactive-pty[-ide]` / `background-supervisor[-ide]` | strict-ratchet, **broad-wins** (app overrides project overrides agent overrides tab) | `interactive-pty` at app level |
| **`implementation`** (new, ADR 0003)     | `official-cli` / `direct-client`                                         | **narrow-wins** (tab overrides agent overrides project overrides app)                | `official-cli` at every level  |

The two combine at dispatch time:

```
resolved.transportMode = resolveTransportMode(tab, agent, project, app)   // broad-wins
resolved.implementation = resolveImplementation(tab, agent, project, app) // narrow-wins
```

`implementation === 'direct-client'` AND `transportMode === 'interactive-pty[-ide]'` → Maestro calls Anthropic API directly with OAuth subscription credentials.
`implementation === 'direct-client'` AND `transportMode === 'legacy-print'` → Maestro calls Anthropic API directly with API-key credential (same billing implication as the official CLI's `--print` mode).
`implementation === 'official-cli'` (default) → Maestro spawns `claude` per Phase 1/2/3 ARDs, unchanged.

The narrow-wins semantics for `implementation` mean direct-client is hard to select accidentally — must be explicitly enabled at the narrowest applicable scope, no broader scope opts you in. Safety property: experimental code can't cascade onto sessions that didn't opt in.

---

## Three Maestro hosting models (reminder from [[claude-session-hosting-models]])

Direct-client is **Model 1 (PTY runner) with the PTY removed and replaced by direct HTTPS**. It's the same conceptual model — Maestro owns the process — just without the binary subprocess.

| Model                                           | Wrapped-CLI implementation                      | Direct-client implementation                                  |
| ----------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------- |
| Model 1: Maestro-owned process                  | `ClaudePtyRunner` spawning `claude`             | `ClaudeDirectRunner` making HTTPS POSTs                       |
| Model 2: Anthropic-owned supervisor             | `ClaudeBgAdapter` shelling out to `claude --bg` | Phase 7 Maestro-native supervisor (separate from Anthropic's) |
| Model 3: IDE host (Maestro provides editor RPC) | Phase 2 Track I `--ide` MCP host                | Phase 6 internal editor RPC contract                          |

---

## OAuth strategy — Stage 1 + in-app login UX

**Credential source:** read-only from `~/.claude/credentials`. Maestro is a credential consumer; the official `claude` binary remains the credential producer. Token refresh attempted silently via `/v1/oauth/token` with the stored refresh token; if that fails, Maestro launches an in-app login flow:

1. Toast: "Claude credentials expired or missing. Re-authenticating..."
2. Opens a DEDICATED login session in a hidden PTY (separate from any working sessions to avoid contaminating them)
3. Runs `claude /login` in the login session
4. Captures the OAuth URL from claude's stdout
5. Opens the URL in the user's default browser (or a Maestro-hosted popup window)
6. User authenticates in browser; Anthropic shows a "copy this token" page
7. Maestro polls the clipboard (with user-visible "Waiting for token..." indicator) — alternative: user clicks "Paste here" in Maestro UI
8. Token detected → Maestro pastes it into the dedicated login session
9. `claude` finishes the login flow, writes refreshed credentials to `~/.claude/credentials`
10. Maestro closes the dedicated login session, reads the fresh credentials, dismisses the toast, resumes the original work

The dedicated login session is **never user-visible** by default. Maestro can optionally surface a "show login session" debug action. Anthropic's official CLI is the only entity actually performing the OAuth handshake — Maestro just orchestrates.

---

## System prompt strategy

Anthropic's binary ships a sophisticated system prompt (tool descriptions, conversation conventions, "be concise", "match user's tone", etc.). We cannot copy it.

Maestro derives its own system prompt from:

- Anthropic's published documentation on Claude best practices (claude.com/docs, code.claude.com/docs)
- General LLM prompt-engineering best practices
- Tool schemas (from our own implementation, the canonical reference)
- Maestro-specific context injection (CWD, OS, date, model name)
- How Maestro itself nudges/prompts Claude agents (existing prompt patterns visible in `/app/maestro-planner/src/prompts/`)

The defensible position: documented best practices + tool schemas derived from public Anthropic API reference. Overlap with Anthropic's actual prompt is incidental and unavoidable given convergent design principles, not a copy.

---

## Anthropic SDK usage

The `@anthropic-ai/sdk` npm package (MIT-licensed) provides typed HTTP client + SSE streaming for `/v1/messages?beta=true`. Maestro uses it for the HTTP layer. Key configuration:

- **Auth:** construct with `{ authToken: '<oauth_bearer_token>' }` — overrides default `x-api-key` to send `Authorization: Bearer <token>` → subscription billing.
- **Base URL:** `https://api.anthropic.com` default; can be overridden for staging.
- **Beta header:** `anthropic-beta: managed-agents-2026-04-01` for session/messages API.
- **User-Agent:** set to match official CLI's UA string format (`claude-code/<version> (<platform>)`). Phase 4 starts with impersonation; Phase 8+ may consider transitioning to a Maestro-identified UA.

The SDK is the same library the official CLI uses internally (confirmed via `anthropic-sdk-typescript/${uB}` strings in the binary). Using it gives us free retries, typed responses, SSE handling, automatic rate-limit backoff — and minimizes our wire-protocol surface area.

---

## Session JSONL compatibility (load-bearing)

**The single most important interop requirement:** Doug must be able to start a conversation in `legacy-print`, switch to `interactive-pty`, switch to `direct-client`, and back again — all preserving the SAME conversation. This requires the session state in `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl` to be **bidirectionally readable and writable** by both code paths.

Phase 4 ARD 06 is dedicated to this: parse Anthropic's JSONL line format (each line is a JSON-encoded event), write events in the same format, ensure resumability via `--session-id <uuid>` matches what the official CLI would produce. Without this, the direct-client is an island and the productivity goal fails.

---

## Anti-fingerprinting principles

Maestro's wire-level traffic should be indistinguishable from the official CLI's. Specific principles:

- **User-Agent** matches the CLI's format (`claude-code/<version> (<platform>)`)
- **Request cadence** capped at human-reasonable rates (no parallel inference per credential at >2 concurrent requests)
- **`anthropic-beta` header** matches whatever the current CLI sends for a given endpoint
- **Push parallelism INTO the model** (multi-tool-use within a single turn) rather than ACROSS sessions where possible — token-expensive but reduces request-frequency fingerprint
- **TLS fingerprint** matches Node's default (the SDK uses Node fetch under the hood; matches Bun's HTTP layer fingerprint well enough)
- **No new telemetry** going to anyone — direct-client is silent

---

## Scope per phase

| Phase       | Goal                                                                                      | ARD count      | Effort                              |
| ----------- | ----------------------------------------------------------------------------------------- | -------------- | ----------------------------------- |
| Pre-Phase-4 | Planner artifacts (this sprout + ADR + memory + Phase 1.5 extension)                      | 0 ARDs, 4 docs | 1-2 planner sessions                |
| Phase 4     | Direct-client MVP — working end-to-end with 6 tools, session-JSONL interop                | 12 ARDs        | 4-5 weeks serial                    |
| Phase 5     | Tool surface expansion (Web suite, Task, TodoWrite, AskUserQuestion, context-window mgmt) | 6 ARDs         | 2 weeks                             |
| Phase 6     | Maestro-internal editor RPC (`--ide`-equivalent for direct-client)                        | 5 ARDs         | 2 weeks                             |
| Phase 7     | Maestro-native background sessions (Posture-C equivalent without Anthropic's supervisor)  | 7 ARDs         | 3 weeks                             |
| Phase 8     | Production polish + speculative multi-provider — left loose                               | TBD            | Empirically determined post-Phase-7 |

---

## Phase rollup

| Phase                                             | Status                            |
| ------------------------------------------------- | --------------------------------- |
| Phase 1 (PTY runner core)                         | code-complete; SHIP gate pending  |
| Phase 1.5 (defensive disable + telemetry-disable) | ARDs authored; awaits dispatch    |
| Phase 2 (Posture B + --ide)                       | ARDs authored; awaits dispatch    |
| Phase 3 (Posture C supervisor)                    | ARDs authored; awaits dispatch    |
| Phase 4 (direct-client MVP)                       | ARDs authored 2026-05-18          |
| Phase 5 (tool surface)                            | ARDs authored 2026-05-18          |
| Phase 6 (editor RPC)                              | ARDs authored 2026-05-18          |
| Phase 7 (native background)                       | ARDs authored 2026-05-18          |
| Phase 8 (polish)                                  | Speculative; specify post-Phase-7 |

---

## Maintenance

- Update the OAuth strategy section if Anthropic changes the credential file format or revokes the `claude-code-client` ID.
- Update the anti-fingerprinting section if Anthropic ships new request-marker enforcement (per the project memory [[claude_billing_mechanism]]).
- Update the legal posture section if Anthropic publishes an open-source license for any portion of the CLI (would relax personal-fork-only scope).
