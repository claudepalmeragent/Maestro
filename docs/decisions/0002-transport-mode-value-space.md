# ADR 0002 — Transport-mode value space: flat enum with composable IDE flag

- **Status:** Accepted
- **Date:** 2026-05-17
- **Related:** [[claude-session-hosting-models]], [[docs/transport-mode]], `src/main/utils/claude-pty-helpers.ts` (`TransportMode` type), `src/main/utils/claude-pty-helpers.ts` (`resolveClaudeTransportMode`), Phase 1 ARD 02 (CLAUDE-PTY-02-TRANSPORT-MODE-CASCADE.md)
- **Supersedes:** none (extends Phase 1's two-value design)

## Context

Phase 1 shipped a `TransportMode` type with two values: `'legacy-print' | 'interactive-pty'`, resolved by a 4-level cascade (tab > agent > project > app) with strict-ratchet escalation (any level set to `interactive-pty` wins for everything below).

Phase 2 introduces a third axis (`--ide` MCP host) and Phase 3 introduces a third hosting model (`background-supervisor` via `claude --bg`). This raises a value-space question that must be answered _before_ any Phase 2 or Phase 3 ARD is authored, because the answer determines:

- The shape of the `TransportMode` type
- The signature of `resolveClaudeTransportMode`
- The UI presentation at all 4 cascade levels
- The strict-ratchet escalation rules between values
- How the dispatcher in `process.ts` / `agent-spawner.ts` branches

Three candidate designs were considered:

1. **Flat enum, one value per concrete config:** `'legacy-print' | 'interactive-pty' | 'interactive-pty-ide' | 'background-supervisor' | 'background-supervisor-ide'`
2. **Composable bitfield:** `{ host: 'pty' | 'supervisor' | 'print', ide: boolean }` — orthogonal axes combined at resolve time.
3. **Hierarchical:** parent enum + opt-in flags layered per level.

## Decision

**Adopt Design 1 (flat enum, one value per concrete config) with these specific values:**

```typescript
export type TransportMode =
	| 'legacy-print' // API-tier billed; escape hatch, preserved forever
	| 'interactive-pty' // Phase 1 — Model 1, no IDE host
	| 'interactive-pty-ide' // Phase 2 — Model 1 + Model 3
	| 'background-supervisor' // Phase 3 — Model 2, no IDE host
	| 'background-supervisor-ide'; // Phase 3 ARD 06 (composition) — Model 2 + Model 3
```

**Strict-ratchet escalation rules** (governs which value wins when multiple cascade levels disagree):

```
legacy-print < interactive-pty == interactive-pty-ide == background-supervisor == background-supervisor-ide
```

That is:

- `legacy-print` is the lowest rank (any non-`legacy-print` setting at any level escalates).
- The four subscription-billed modes are **same-rank**. They cannot demote one another. When two non-`legacy-print` values appear at different cascade levels, the higher level (broader scope) wins — i.e., **scope order is the tiebreaker among same-rank values**.

**Scope order for same-rank tiebreaking** (highest to lowest specificity, lowest to highest priority among equals):

```
tab < agent < project < app
```

So if app = `background-supervisor` and tab = `interactive-pty-ide`, the resolver returns `background-supervisor`. The narrower scope (tab) cannot override the broader scope (app) **among same-rank values** — broader scope wins. This preserves Phase 1's mental model: "higher-scope settings always win when ranks tie."

**No demotion across ranks** (preserves Phase 1 behavior): if any level is set to a higher-rank value, lower-level settings cannot demote it to `legacy-print`.

## Rationale

### Why flat enum (Design 1) over composable bitfield (Design 2)

The bitfield is appealing at first glance — `--ide` is orthogonal to host model, so why not model the orthogonality? Three reasons against:

1. **UI presentation:** users pick a transport mode at each cascade level via a radio group. A flat 5-option list is easier to reason about than a 2D matrix with implicit composition. Radio groups are also better at expressing the strict-ratchet semantics ("you can pick this OR something stronger, never something weaker").
2. **Strict-ratchet semantics are easier to specify on a flat list:** with the bitfield, what's the ratchet rule for the `ide` axis? Does enabling `--ide` at a higher level force it on for lower levels? If so, the bitfield collapses into a flat enum at resolve time anyway, with extra implementation complexity.
3. **Composition validity is enforced at the type level:** with the flat enum, illegal combinations (e.g., "legacy-print with --ide") don't exist as values. The bitfield would require runtime validation.

### Why same-rank for the four subscription modes (Design A in the Phase 2 discussion)

Founder decision (2026-05-17): preserves user granularity. None of the four modes is strictly "more powerful" than the others — they trade off different axes (PTY vs supervisor; with vs without IDE host). Forcing a strict total order would mean a user could not pick `interactive-pty` at the tab level when `background-supervisor` was the project default — which is wrong, because Maestro should respect the user's preference to stay in the PTY model for a specific session even when the project prefers supervisor mode.

The scope-order tiebreaker (broader wins) maintains the "intuitive direction" of the cascade: app-level decisions are broader policy, tab-level decisions are local preferences. Among same-rank values, policy wins. This is the same direction as the Phase 1 strict ratchet (broader scope is always at-least-as-restrictive).

### Why `legacy-print` keeps its lowest-rank floor

Per Phase 1 mandate: `legacy-print` is the rollback escape hatch and must remain _always available_ by setting it explicitly at the most-specific applicable level — **but only when no higher-rank level has been set higher in the cascade**. The strict-ratchet rule prevents this from being a demotion vector: if app = `interactive-pty`, a per-tab `legacy-print` cannot demote to legacy. This is by design — billing control is job #1.

To intentionally use `legacy-print` for a specific scope, the user must set it at a level where no higher cascade level is set to a non-legacy value. This is the same constraint Phase 1 shipped with; ADR 0002 inherits it unchanged.

### Why the `-ide` suffix variants are first-class enum values

Alternative considered: keep the enum at 3 values (`legacy-print`, `interactive-pty`, `background-supervisor`) and add a separate `ideHost: boolean` setting that composes independently. Rejected because:

- Forces a second cascade resolver for the IDE flag, doubling the cascade infrastructure.
- Decouples `--ide` opt-in from the host-model selection, which is _not_ the user mental model — users will think "I want PTY mode with editor support" as one choice, not two separate toggles.
- Phase 2's `--ide` work depends on the `interactive-pty` cascade machinery already being there; treating it as a separate axis means re-implementing cascade logic for the IDE flag.

The cost of treating `-ide` variants as first-class enum members is mostly UI: each cascade level's radio group has 4-5 options instead of 3, and we need clean naming. Acceptable trade-off.

## Consequences

### Positive

- **Type-safe composition:** TypeScript guarantees that only valid configurations exist as values.
- **One resolver:** `resolveClaudeTransportMode` continues to return a single `TransportMode` value; no new resolver needed for the IDE axis.
- **Clean UI:** each cascade level has a single radio group; user picks one value.
- **Forward-compatible:** if Anthropic introduces a fourth host model (e.g., the cloud-hosted "Claude Code on the web" variant), it joins as a new enum value with its own `-ide` variant if applicable.

### Negative

- **Verbose enum:** 5 values now, possibly 7+ in the future. Manageable via consistent naming convention (`<host>` or `<host>-ide`).
- **UI proliferation:** each cascade level's settings UI needs all 4-5 options. Mitigated by sensible defaults and tooltips explaining the trade-offs.
- **`-ide` variant explosion if Anthropic adds a non-`--ide` interaction flag in the future:** then the enum doubles again. If we hit this, revisit and consider promoting `-ide` to a separate flag despite the costs called out above. Trigger condition: a third compositional flag joins `--ide`.

### Neutral

- **Migration path from Phase 1 to Phase 2+:** existing persisted settings using `'legacy-print' | 'interactive-pty'` remain valid (the new values are additive). No migration code required. Settings UIs need to expand their option lists.
- **Strict-ratchet rule unchanged in spirit:** `legacy-print` still cannot be picked when a higher level escalated; broader scope still wins. Only the **set of values that participate in escalation** has grown.

## Alternatives considered

- **Composable bitfield (Design 2):** rejected for UI / semantics reasons above.
- **Hierarchical (Design 3):** rejected — adds nesting complexity without solving the composition validity problem the flat enum solves at the type level.
- **Defer IDE to a separate axis (variant of Design 2):** rejected — duplicates cascade infrastructure and fragments the user mental model.
- **Make `background-supervisor` outrank `interactive-pty` (rejected design A2):** would force users into supervisor mode whenever any higher level set it, eliminating per-tab PTY opt-out. Founder explicitly rejected this in the 2026-05-17 discussion ("same rank is fine — keeps granularity").

## Implementation notes

- The Phase 1 `TransportMode` type in `src/main/utils/claude-pty-helpers.ts` gets extended additively. Phase 2 ARD 08 adds `'interactive-pty-ide'`; Phase 3 ARD 02 adds `'background-supervisor'` and (later, in Phase 3 ARD 06) `'background-supervisor-ide'`.
- `resolveClaudeTransportMode` gets a new internal `rank()` helper that returns 0 for `legacy-print` and 1 for all subscription-billed values. The cascade evaluator becomes: among values appearing at any level, pick the highest rank; ties broken by scope order (broader wins).
- Cascade UI at each level (tab/agent/project/app) gets the expanded radio group. Settings persistence values are the new enum strings.
- The dispatcher in `process.ts` (local + SSH) and `agent-spawner.ts` (CLI) branches on the full resolved value, routing to `ClaudePtyRunner` (`interactive-pty[-ide]`), `ClaudeBgAdapter` (`background-supervisor[-ide]`), or the legacy `ChildProcessSpawner` (`legacy-print`).
- Phase 2 ARD 08 owns the actual type-extension edit + cascade-resolver update; ADR 0002 just locks in the design contract.

## Test plan

Each ARD that touches the cascade resolver MUST add:

1. **All-rank-0 baseline** test: every level at `legacy-print` → resolves `legacy-print`.
2. **Single-level escalation tests** for each non-legacy value at each level (4 levels × 4 non-legacy values = 16 tests).
3. **Same-rank tiebreaker tests:** app = X, tab = Y (X ≠ Y, both rank 1) → resolves X (broader wins). Repeat for each pair of non-legacy values.
4. **Strict-ratchet regression:** app = `interactive-pty`, tab = `legacy-print` → resolves `interactive-pty` (cannot demote). Repeat for each subscription mode.

The Phase 1 ARD 02 test suite covers cases 1-4 for the 2-value space; Phase 2 ARD 08 and Phase 3 ARD 02 extend it as their new values land.
