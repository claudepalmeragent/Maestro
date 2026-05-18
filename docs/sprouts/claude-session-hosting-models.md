---
type: sprout
title: Claude session-hosting models — PTY runner vs supervisor vs IDE host
status: active
created: 2026-05-17
authored-by: maestro-planner (Claude Opus 4.7)
related:
  - '[[docs/decisions/0001-team-shape-solo-plus-claude-code]]'
  - '[[docs/decisions/0002-transport-mode-value-space]]'
  - '[[docs/transport-mode]]'
  - '[[docs/dev/agent-prompts]]'
---

# Sprout — Claude session-hosting models

> **Purpose:** capture the cross-session reasoning about _how a Claude conversation can be hosted_ and the trade-offs between the three patterns Maestro must support. Drives ARD authoring for Phase 2 (Posture B + `--ide`) and Phase 3 (Posture C — `background-supervisor`). Living doc; update as new patterns emerge.
>
> **Note on origin:** authored in-conversation during the Phase 1 close-out review where Anthropic's [`claude agents` Agent View](https://code.claude.com/docs/en/agent-view) was first analyzed. The `/new-sprout` two-pass transcript scan was _not_ run because all relevant cross-session context (Phase 1 ARDs, Gemini brainstorm, Agent View docs) was already loaded in the authoring conversation. Future entries that add new hosting models or revise trade-offs should run the scan.

---

## The three hosting models

A "Claude session" is a running multi-turn conversation with the Claude Code agent. The conversation can be **hosted** in three architecturally distinct ways. Each model determines: who owns the process, where state lives, how Maestro interacts with it, and how billing is metered.

### Model 1 — PTY runner (Maestro owns the process)

- **Process:** a `claude` child of Maestro's main process, wrapped in `node-pty`. Lives and dies with Maestro.
- **Lifetime:** one PTY per turn (current Phase 1 design — `executeTurn` spawn-per-turn) OR one PTY per session (alternative; deferred to a future ARD if Phase 1 spawn-per-turn churn becomes a cost).
- **State:** in-memory in the runner instance + Claude's own on-disk session log under `~/.claude/projects/-app/*.jsonl`. Resume across spawns via `--session-id` derived from Maestro tab ID.
- **Maestro's interface:** direct — events flow through the runner's `event` EventEmitter, raw bytes through `rawData`, exit through `end`.
- **Billing:** subscription (interactive Claude usage; the `--print` flag and Agent SDK are what get API-tier-metered post-2026-06-15).
- **Implementation:** `src/main/utils/claude-pty-runner.ts` (Phase 1 ARDs 1, 3, 5, 6).
- **Strengths:** lowest-latency control surface (mutex, userControlled, watchdog), tight integration with Maestro's Live Interactive Mode view and Take Control UI, no third-party process to coordinate with.
- **Weaknesses:** Maestro's process must stay alive for the session to live (kill Maestro → kill the session). N parallel agents = N PTYs in Maestro's process tree. Auto Run playbooks at scale hit OS PTY limits and Maestro process memory growth.

### Model 2 — Supervisor host (Anthropic owns the process)

- **Process:** Anthropic's per-user supervisor process at `~/.claude/daemon.*`. Independent of any terminal or wrapper. Auto-restarts on Claude binary update via local file watch.
- **Lifetime:** session-lived; supervisor stops idle sessions after ~1 hour and re-spawns them on next interaction (transparent to the consumer).
- **State:** on-disk under `~/.claude/jobs/<id>/state.json` per session, roster at `~/.claude/daemon/roster.json`. Anthropic-owned schema. Conversation transcripts in `~/.claude/projects/-app/*.jsonl` (same as Model 1).
- **Maestro's interface:** indirect — dispatch via `claude --bg "<prompt>"`, then poll state.json files + shell out to `claude attach|logs|stop|respawn|rm <id>` for lifecycle ops. **Maestro is a client of Anthropic's local "session API surface," not the host.**
- **Billing:** subscription (same as Model 1 — research-preview docs are explicit: "background sessions consume your subscription usage the same as interactive sessions").
- **Implementation:** Phase 3 `ClaudeBgAdapter` (`src/main/utils/claude-bg-adapter.ts`, Phase 3 ARDs 01-07). The adapter mirrors `ClaudePtyRunner`'s public API surface so the dispatcher in `process.ts` / `agent-spawner.ts` can swap implementations transparently based on resolved transport mode.
- **Strengths:** decoupled lifecycle — kill Maestro, sessions survive; N parallel agents share one supervisor process; Maestro CLI can exit after dispatching a 100-agent batch. Cross-Maestro-restart resilience (sessions auto-resume on reconnect). Eliminates whole class of PTY-management bugs.
- **Weaknesses:** higher latency for control (file polling + CLI shell-out vs direct EventEmitter); state schema is Anthropic-owned and may change without notice (research preview); composition with `--ide` is non-obvious and warrants explicit ARD (Phase 3 ARD 06); SSH variant requires remote state-file inspection (Phase 3 ARD 04 is the trickiest ARD in Phase 3).

### Model 3 — IDE host (Maestro provides editor RPC; Claude is the consumer)

- **Process:** orthogonal axis — `--ide` is a flag that augments either Model 1 OR Model 2. Adds a bidirectional MCP-style protocol channel where Claude calls into the host (Maestro) to perform editor operations (open file, propose diff, request approval).
- **Lifetime:** lifecycle bound to whichever underlying model hosts the session.
- **State:** the MCP channel is ephemeral; persistent state still lives in the underlying hosting model's locations.
- **Maestro's interface:** Maestro implements an MCP server inside its main process. Claude's `--ide` flag wires the runner's stdio (or the supervisor's bg session, in the Phase 3 composition case) to this server. Renderer file-preview tabs become MCP-aware; inline diff modals render Claude's proposed edits.
- **Billing:** unchanged — same as underlying model.
- **Implementation:** Phase 2 `--ide` track (Phase 2 ARDs 06-09); composition with Model 2 deferred to Phase 3 (Phase 3 ARD 06).
- **Strengths:** richer UX than text-only PTY (proper diff preview, file pickers, multi-file edit batching), Anthropic-blessed integration surface for future IDE-class features.
- **Weaknesses:** requires Maestro process to be alive for editor RPC to function (Model 1 always satisfies this; Model 2 composition has the case where Maestro is closed but the supervisor session is still alive — what should Claude do when it tries to call into a disconnected IDE host?).

---

## How they compose

Models 1 and 2 are **mutually exclusive** for any given session (the session is hosted by Maestro's process OR by the supervisor — not both).

Model 3 (`--ide`) is **additive** to either:

- Model 1 + Model 3 = `interactive-pty-ide` — Maestro-owned PTY with editor RPC. Phase 2.
- Model 2 + Model 3 = `background-supervisor` with optional `--ide` attach — supervisor-owned session, editor RPC active when Maestro is connected, gracefully degrades to plain when Maestro is closed. Phase 3 ARD 06.
- Model 2 standalone = `background-supervisor` without `--ide`. Phase 3.

This gives us a **2×2 matrix** of viable production configurations, plus the always-available `legacy-print` escape hatch:

|                           | Without `--ide`                                                         | With `--ide`                                            |
| ------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------- |
| **Maestro PTY (Model 1)** | `interactive-pty`                                                       | `interactive-pty-ide`                                   |
| **Supervisor (Model 2)**  | `background-supervisor`                                                 | `background-supervisor-ide` (Phase 3 ARD 06 if shipped) |
| **API tier (deprecated)** | `legacy-print` (escape hatch — preserved forever per dual-mode mandate) | —                                                       |

The transport-mode cascade resolves to one of these enum values per spawn. See [[0002-transport-mode-value-space]] for the lock-in decision on which values are first-class enum members vs composable flags.

---

## Decision criteria — when to pick which model

For founder + future planner sessions making per-project / per-agent / per-tab transport-mode decisions:

| Scenario                                                                       | Recommended model                                 | Why                                                                                          |
| ------------------------------------------------------------------------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Single interactive session, user actively driving                              | Model 1 (`interactive-pty`)                       | Lowest latency, tightest Maestro integration, Live Interactive Mode view works               |
| Single interactive session, user wants rich editor surface                     | Model 1 + Model 3 (`interactive-pty-ide`)         | Phase 2 sweet spot — UX upgrade without losing PTY control                                   |
| Auto Run playbook with N parallel agents (N > 3)                               | Model 2 (`background-supervisor`)                 | Maestro process doesn't hold N PTYs; can exit after dispatch; subscription billing preserved |
| Long-running background investigation, user wants to close laptop              | Model 2                                           | Survives Maestro restart, supervisor handles auto-resume                                     |
| User already lives in `claude agents` TUI, wants Maestro as a better UI for it | Model 2 (via Posture B's External Sessions group) | Posture B is the bridge; Posture C makes the bridge the default                              |
| CI / headless run on a box without GUI Maestro                                 | Model 2 (CLI path)                                | Maestro CLI dispatches, exits, supervisor runs the work                                      |
| Client requires API-tier billing (their account, their key)                    | `legacy-print`                                    | The escape hatch — always available                                                          |

---

## Resolved questions

### Q0 (resolved 2026-05-17): What is the actual mechanism by which Anthropic classifies a request as `--print` (API-tier) vs interactive (subscription)?

**Investigated by:** maestro-planner (Claude Opus 4.7), via `strings` extraction of the live `claude` v2.1.141 native binary at `/usr/local/lib/node_modules/@anthropic-ai/claude-code/node_modules/@anthropic-ai/claude-code-linux-arm64/claude` (Bun-compiled, GIT_SHA `4f4623ddd...`).

**Answer (as of v2.1.141, 2026-05-13 build):** the billing classifier is the `apiKeySource` property attached to each credential — NOT a `--print`-mode request header. Both `--print` and interactive sessions hit the **same** endpoint (`/v1/messages?beta=true`) with the **same** headers (modulo SDK and `anthropic-beta` versioning). What differs is _which credential_ the CLI selects:

- **OAuth-minted keys** via `claude login` → calls `/api/oauth/claude_cli/create_api_key` with scope `org:create_api_key`, stored in `~/.claude/credentials` → backend metadata marks them as subscription-billed.
- **`ANTHROPIC_API_KEY` env var** → manually-minted console key → API-tier billed.
- **`CLAUDE_CODE_API_KEY_HELPER_TTL_MS` / `_FILE_DESCRIPTOR`** → helper-script-provided keys (enterprise pattern).
- **Bedrock / Vertex** → cloud-provider-managed credentials (separate billing entirely).

**Implications for the Maestro arc:**

1. Phase 1's env-strip strategy in `interactive-pty` mode works because it forces the CLI to fall back to OAuth credentials when API key is absent. Confirmed sufficient for v2.1.141.
2. `--print` and interactive mode hit the **same endpoint** — Anthropic could add a `x-claude-code-mode: print` request header at any time that overrides credential classification (currently not present in the bundle). Phase 1's `interactive-pty` would still be safe (it doesn't pass `--print`), but the legacy escape hatch would always-bill-API regardless of credential — which matches its intent.
3. Doug's predicted change ("Anthropic requires `ANTHROPIC_API_KEY` env when `--print` is set, fail otherwise") only affects the `legacy-print` escape hatch. Phase 1's main `interactive-pty` path is immune.
4. **Hardest future threat:** backend-side pattern detection (request frequency, prompt patterns, TTY-presence detection on the CLI side). Maestro forces `TERM=dumb` which is potentially a tell. No defense exists today; Phase 4 watch item.

**Defensive change landed:** Phase 1.5 ARD 01 Task 1.9 added `assertNoPrintArgs(args, context)` that throws at spawn time if `--print` or `-p` survives into a `ClaudePtyRunner` invocation. Belt-and-suspenders against future enforcement changes.

**See also:** `[[docs/decisions/0002-transport-mode-value-space]]` for the cascade design that constrains where `legacy-print` can be selected.

---

## Open architectural questions (drive Phase 3 ARDs)

1. **Composition of `--ide` and `--bg`**: when a supervisor-hosted session tries to call into a disconnected Maestro IDE host (because Maestro was closed), should Claude (a) block waiting for reconnect, (b) degrade gracefully and proceed without the editor call, (c) abort the turn? Anthropic's `--ide` docs don't address this — needs empirical work in Phase 3 ARD 06.
2. **SSH + supervisor**: the supervisor's state files live on the _remote_ host's `~/.claude/`. Maestro's local state-reader needs an SSH-aware variant. Options: (a) `ssh host cat ~/.claude/jobs/...` per-poll, (b) `sshfs` mount, (c) `claude --json --remote` subcommand if Anthropic ships one. Decision deferred to Phase 3 ARD 04 with sub-decision triggers (perf benchmarking of option a; if > 200ms/poll on typical residential link, escalate to option b).
3. **Supervisor process auto-restart races**: when `claude` binary auto-updates, the supervisor restarts. Maestro's polling layer and any in-flight `claude attach`/`logs` subprocesses should reconnect cleanly. Documented but un-implemented — addressed in Phase 3 ARD 06.
4. **Maestro-aware session naming**: `claude --bg --name <maestroSessionId>` lets us tag supervisor-managed sessions with Maestro's identifiers. Should Maestro use a deterministic naming scheme (so the same Maestro tab can re-discover its background session after Maestro restart) or random/auto-generated (relying on Maestro-side mapping table)? Recommend deterministic; document in Phase 3 ARD 01.
5. **State drift detection**: Maestro's view of session state (polled at 5s default) can lag behind the supervisor's truth. Need a strategy for refresh-on-attach, optimistic UI updates, and conflict resolution. Detail in Phase 3 ARD 01's polling design.

---

## Anti-patterns to avoid (carry forward from Phase 1)

- **Don't bypass the cascade.** Every spawn site must resolve transport mode through `resolveClaudeTransportMode` (or its CLI sibling `resolveCliClaudeTransportMode`). No shortcuts.
- **Don't fork the parser.** All three hosting models must emit identical `ParsedEvent` shapes to Maestro's renderer. The parser is the contract.
- **Don't fight Anthropic's defaults.** When the supervisor disagrees with Maestro about a session's state, the supervisor wins; Maestro's job is to surface the divergence, not to overwrite Anthropic's state files.
- **Don't compose unless you've thought through the failure modes.** `--bg --ide` composition is two systems that can each independently fail; the cross-product matters. Hence Phase 3 ARD 06 gets its own design loop.

---

## Phase rollup

| Phase              | Models covered                                                                                                                                       | ARDs                                                                                                                       | Status                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Phase 1 (complete) | Model 1 (`interactive-pty`) + `legacy-print`                                                                                                         | 1, 01b, 01c, 02, 03, 04, 05, 06                                                                                            | Code-complete; SHIP gate pending |
| Phase 1.5          | Defensive: prevent Model 2 hijacking Model 1 sessions                                                                                                | Posture A — Phase 1.5 ARD 01                                                                                               | To author                        |
| Phase 2 Track B    | Coexist: surface Model 2 sessions in Maestro UI                                                                                                      | Posture B — Phase 2 ARD 01, Phase 2 ARD 02, Phase 2 ARD 03, Phase 2 ARD 04, Phase 2 ARD 05                                 | To author                        |
| Phase 2 Track I    | Add Model 3 to Model 1                                                                                                                               | `--ide` — Phase 2 ARD 06, Phase 2 ARD 07, Phase 2 ARD 08, Phase 2 ARD 09                                                   | To author                        |
| Phase 3            | Make Model 2 a first-class transport; compose with Model 3                                                                                           | Posture C — Phase 3 ARD 01, Phase 3 ARD 02, Phase 3 ARD 03, Phase 3 ARD 04, Phase 3 ARD 05, Phase 3 ARD 06, Phase 3 ARD 07 | To author                        |
| Phase 4+           | Open: web/cloud-hosted Maestro? Anthropic's [Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web) is a Model 4 candidate. | TBD                                                                                                                        | Speculative                      |

---

## Maintenance

- Update the matrix and decision-criteria table when a new hosting model emerges (e.g., the cloud-hosted variant Anthropic teased).
- When ARDs land that change the implementation, link back here from the ARD and update the "Implementation" line of the affected model.
- This sprout is the **architectural contract** that Phase 2/3 ARDs reference. Significant deviations from it require either an ADR (for binding decisions) or a sprout update + cross-reference (for additive clarifications).
