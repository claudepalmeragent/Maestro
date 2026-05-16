---
title: Transport Mode Cascade
description: Control how Claude Code agents are spawned — Legacy (--print) or Interactive PTY — at the app, project, agent, and tab level.
icon: terminal
---

Maestro supports two transport modes for Claude Code agents. The **Transport Mode Cascade** lets you set a default at the app level and selectively override it at the project, agent, or individual tab level — with a strict-ratchet rule that ensures once a broader scope opts into Interactive PTY, narrower scopes cannot demote it.

## Two Modes

| Mode                          | CLI Invocation         | Billing                 | When to Use                                                             |
| ----------------------------- | ---------------------- | ----------------------- | ----------------------------------------------------------------------- |
| **Legacy (`claude --print`)** | `claude --print`       | API key (token-metered) | Client billing, cost tracking, programmatic output, headless automation |
| **Interactive PTY**           | `claude` (interactive) | Claude Max subscription | Personal use, Max subscribers, interactive sessions                     |

<Warning>
As of 2026-06-15, Anthropic meters `claude --print` (Legacy mode) against API rates rather than the Max subscription. If you are on a Max plan, switching to Interactive PTY keeps your usage within the subscription tier.
</Warning>

## The Four-Level Cascade

Transport mode is resolved from four scopes, from narrowest (highest priority) to broadest:

```
Tab  →  Agent  →  Project Folder  →  App Default
```

The **strict-ratchet rule** applies: any level set to `interactive-pty` wins for everything below it. A narrower scope can opt **into** Interactive PTY (escalate), but it cannot opt **out** of a mode already set by a broader scope. `undefined` at any level is treated as `legacy-print`.

### Resolution Order

1. **Tab** — overrides everything below it
2. **Agent** — overrides Project and App
3. **Project Folder** — overrides App default
4. **App Default** — the baseline (`legacy-print` out of the box)

Mode is resolved **at spawn time** only. Changing settings does not live-update running sessions.

### "Inherited from \<source\>" Indicators

Wherever a transport mode control appears in Maestro's UI, a read-only indicator shows where the currently resolved mode comes from:

- **"Inherited from app: Legacy"** — the App default is driving the result
- **"Inherited from project: Interactive PTY"** — a Project Folder opted in
- **"Inherited from agent: Interactive PTY"** — the Agent opted in

When the mode is forced from a broader scope (e.g., the Project Folder is set to Interactive PTY), the control at the narrower scope (Agent or Tab) becomes **read-only**, because allowing a demotion there would violate the strict-ratchet rule.

## Configuring Each Level

### App Default

Open **Settings** (`Cmd+,` / `Ctrl+,`) → **General** tab → **Claude Code Transport Mode**.

Select one of:

- **Legacy (`claude --print`)** — default; token-metered against the API
- **Interactive PTY (Claude Max)** — interactive spawn; stays within the Max subscription tier

A note beneath the control reads: _"This is the app-wide default. Project folders, agents, and individual tabs may override this only by opting into Interactive PTY — they cannot opt out once this is set to Interactive PTY."_

### Project Folder

Open the **Rename/Edit Project Folder** dialog (right-click or edit icon on a group in the Left Bar) → **Transport Mode** field.

The "Inherited from app" indicator above the select shows what the app-level default is currently set to. Choosing `Interactive PTY` here forces all agents in this project into PTY mode regardless of their individual settings.

### Agent

Open the **Agent Config** panel (edit icon next to an agent in the Left Bar) → **Transport Mode** field.

- When the project or app above is already `interactive-pty`, the control renders **read-only** with an "Inherited from project/app: Interactive PTY" label.
- Otherwise, the agent can opt into `interactive-pty` (escalating its own spawns) while leaving sibling agents on the project's default.

### Individual Tab

A **Terminal** icon button in the input bar (bottom of the Main Window) shows the current resolved mode for the active tab. Click it to toggle between modes.

- When the agent, project, or app above already resolves to `interactive-pty`, the button is replaced by a read-only "Inherited from \<source\>: PTY" indicator.
- Only shown for Claude Code agents in AI mode.

### Tab Header Badge

Each tab in the Tab Bar displays a small badge showing the **resolved** transport mode:

- `Legacy -p` — subtle border chip; the tab will spawn with `claude --print`
- `Interactive PTY` — accented chip; the tab will spawn interactively

Hover the badge for a tooltip showing the cascade source (e.g., "Inherited from project: Interactive PTY").

## Mixed-Billing Example

A common use case during the migration period: personal projects billed against the Max subscription, client projects billed against a dedicated API key.

```
App Default: Legacy (--print)         ← tokens metered against client API key by default

├── Project A (personal work)
│   transportMode: interactive-pty    ← forces all agents in Project A to Max subscription
│   ├── Agent 1  →  Interactive PTY  (inherited from project)
│   └── Agent 2  →  Interactive PTY  (inherited from project)
│
└── Project B (client billing)
    transportMode: undefined          ← falls through to App Default
    ├── Agent 3  →  Legacy (--print)  (inherited from app)
    └── Agent 4  →  Legacy (--print)  (inherited from app)
```

In this setup, Project A's agents consume Max subscription quota while Project B's agents consume the API key — with no per-agent configuration needed beyond the single project-level toggle.

## Environment Variable Override (CLI)

When running Maestro via the CLI or in headless automation, the `MAESTRO_CLAUDE_TRANSPORT_MODE` environment variable provides a 5th, highest-priority override above all four UI levels:

```bash
MAESTRO_CLAUDE_TRANSPORT_MODE=interactive-pty maestro run my-playbook.md
```

Valid values: `legacy-print`, `interactive-pty`. This is typically handled automatically by CLI tooling (ARD 7/05) and does not affect the UI controls.

## Spawn Behavior

<Note>
Zero spawn-behavior change is in effect until the PTY runner is wired in a future Maestro release. Both modes currently produce identical spawns. The cascade, UI controls, and persistence are available now so settings can be pre-configured before the runner ships.
</Note>

## Technical Reference

The cascade is implemented in `src/shared/transport-mode.ts`:

```typescript
export type TransportMode = 'legacy-print' | 'interactive-pty';
export type CascadeSource = 'tab' | 'agent' | 'project' | 'app' | 'default';

resolveClaudeTransportMode(tab, agent, project, app): TransportMode
describeCascadeSource(tab, agent, project, app): { mode, source }
```

The resolver applies the strict-ratchet rule: the first level (narrowest to broadest) that is explicitly `'interactive-pty'` wins; otherwise `'legacy-print'` is returned.
