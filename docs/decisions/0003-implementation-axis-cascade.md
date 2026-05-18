# ADR 0003 — Implementation axis: orthogonal narrow-wins cascade for `official-cli` vs `direct-client`

- **Status:** Accepted
- **Date:** 2026-05-18
- **Related:** [[claude-session-hosting-models]], [[maestro-direct-client]], [[docs/decisions/0002-transport-mode-value-space]]
- **Supersedes:** none (orthogonal to ADR 0002, not a replacement)

## Context

Phase 4+ introduces a Maestro-authored direct-client implementation that bypasses Anthropic's `claude` binary. Users (Doug, personal-fork only) need to opt sessions into the direct-client path without affecting other sessions. Three design candidates considered:

1. **Add `direct-client` as a 6th value to ADR 0002's `TransportMode` enum.** Compose with existing 5 values.
2. **Introduce a new orthogonal `implementation` axis with its own cascade.** `transportMode` continues to mean billing-tier + protocol; `implementation` means "which code path implements that transport." Default `official-cli` everywhere; `direct-client` opt-in.
3. **Make `direct-client` an Encore Feature flag** (single boolean, global) plus a per-session override.

## Decision

**Adopt Design 2: orthogonal `implementation` axis with its own narrow-wins 4-level cascade.**

```typescript
export type Implementation = 'official-cli' | 'direct-client';

export function resolveImplementation(
	tab: { implementation?: Implementation } | undefined,
	agent: { implementation?: Implementation } | undefined,
	project: { implementation?: Implementation } | undefined,
	app: { implementation: Implementation }
): Implementation {
	// Narrow-wins: tab > agent > project > app
	return (
		tab?.implementation ?? agent?.implementation ?? project?.implementation ?? app.implementation
	);
}
```

Default `app.implementation = 'official-cli'`. Each level may explicitly set `direct-client` or `official-cli`; narrower scope wins.

Dispatch composes the two axes:

- `resolved.transportMode = resolveClaudeTransportMode(...)` (broad-wins, per ADR 0002)
- `resolved.implementation = resolveImplementation(...)` (narrow-wins, per this ADR)
- Spawn handler in `process.ts` / `agent-spawner.ts` branches on **both** values.

**Cascade semantics (narrow-wins, opposite of transport's broad-wins):**

```
implementation cascade order (narrowest first wins):  tab > agent > project > app
```

If tab sets `direct-client` and project sets `official-cli`, tab wins → `direct-client` is used for that one session. No broader scope can opt narrower scopes into `direct-client`; it must be set explicitly at each desired scope.

## Rationale

### Why orthogonal axis (Design 2) over expanded enum (Design 1)

The transport-mode enum answers _"which billing tier and which Anthropic protocol does this session use?"_ — values are `legacy-print` (API tier via `--print` flag), `interactive-pty[-ide]` (subscription via interactive `claude`), `background-supervisor[-ide]` (subscription via `claude --bg` supervisor). Adding `direct-client` to that enum **conflates two unrelated questions** — billing-tier-and-protocol with which-Maestro-code-runs. A user might legitimately want "subscription billing via interactive-pty semantics, BUT via my direct-client implementation" or "API tier via legacy-print semantics, BUT via my direct-client implementation." The orthogonal axis expresses both; expanded enum can't.

The orthogonal axis also preserves cleaner cascade semantics. Transport's broad-wins design protects users from accidentally choosing a worse billing tier (legacy-print can't be narrowly opted-into when a broader scope wants subscription). Implementation's narrow-wins design protects users from accidentally landing in experimental code (direct-client never escalates from broader scopes). The two cascades have opposite safety polarities, which is the right shape for the actual user concerns.

### Why narrow-wins (opposite of transport's broad-wins)

Transport-mode's broad-wins exists because billing is a policy decision: "the organization decided this project uses subscription; you can't accidentally downgrade to API tier from a tab." That logic doesn't apply to implementation choice. The relevant concern is the inverse: "the experimental code shouldn't accidentally activate for sessions that didn't opt in."

Narrow-wins on `implementation` means:

- App default `official-cli` → all sessions use the wrapped CLI by default
- Project sets `direct-client` for one project → only that project's sessions use direct-client
- A specific agent within that project sets `official-cli` → that agent overrides back to wrapped CLI
- Most-specific scope is the source of truth; nothing inherits down

This matches Doug's "hardest to select" safety intent without breaking the established transport cascade.

### Why not an Encore Feature flag (Design 3)

Encore Features are app-level booleans for experimental UI surfaces. They don't support per-scope overrides; you'd need to bolt on per-tab/per-agent state separately. By the time you've done that, you've reimplemented the cascade infrastructure poorly. The 4-level cascade already exists for transport mode; reusing the same mental model for `implementation` is the path of least surprise.

## Consequences

### Positive

- **Cleanly separates concerns:** transport mode = billing+protocol, implementation = code path. UI presentation and settings can mirror this separation.
- **Safety asymmetry preserved:** transport broad-wins protects billing; implementation narrow-wins protects against experimental-code blast radius.
- **Composable matrix:** N transport modes × M implementations gives N×M concrete configurations without enumerating all of them as enum values.
- **Migration-friendly:** existing code that branches on `transportMode` is untouched in Phase 4+ unless it also needs to branch on implementation. Phase 4 only adds new branches; nothing rewrites.

### Negative

- **Two cascades to learn.** Documentation must clearly explain why one is broad-wins and the other is narrow-wins.
- **Settings UI grows.** Each cascade level now has TWO controls (transport radio + implementation checkbox) instead of one.
- **More test surface.** Cascade resolver tests need to cover the cross-product of cascade-level inputs for both axes.

### Neutral

- **Default-off opt-in for direct-client** means most users (= Doug's existing wrapped-CLI workflows) see no change. The implementation cascade is silent until explicitly opted in.

## Alternatives considered

- **Design 1 (expand the transport enum):** rejected for semantic conflation reasons above. Would have produced an 8+ value enum (legacy-print, interactive-pty[-ide], background-supervisor[-ide], direct-client-print, direct-client-pty, direct-client-supervisor, ...) with cross-cutting rules that wouldn't fit the strict-ratchet model.
- **Design 3 (Encore flag):** rejected — doesn't support per-scope overrides without reimplementing a cascade.

## Implementation notes

- Phase 4 ARD 01 (`PHASE_4-Direct-Client-MVP/01_IMPLEMENTATION-AXIS-FOUNDATION.md`) owns the actual type-extension + cascade-resolver implementation + UI plumbing.
- The `Implementation` type lives at `src/main/utils/claude-implementation-helpers.ts` (new file) to keep it adjacent to but separate from `claude-pty-helpers.ts`'s `TransportMode` machinery.
- Dispatchers in `src/main/ipc/handlers/process.ts` and `src/cli/services/agent-spawner.ts` gain a top-level branch on `implementation` BEFORE the existing `transportMode` branching:
  ```typescript
  if (resolvedImpl === 'direct-client') {
      // new direct-client code path (Phase 4)
      return dispatchDirectClient(resolvedMode, ...);
  }
  // existing official-cli code path (Phase 1/2/3) unchanged
  if (resolvedMode === 'interactive-pty') { ... }
  // etc.
  ```

## Test plan

Each new test file in Phase 4-7 that touches the cascade resolver MUST add scenarios covering the **cross-product**:

1. `impl=official-cli, transport=interactive-pty` → wrapped CLI path (Phase 1 behavior unchanged)
2. `impl=official-cli, transport=legacy-print` → wrapped CLI path
3. `impl=direct-client, transport=interactive-pty` → Maestro direct OAuth call
4. `impl=direct-client, transport=legacy-print` → Maestro direct API-key call
5. Implementation cascade tiebreaker tests (4 levels × 2 values = 16 scenarios), all narrow-wins-confirmed
6. Composition with `transportMode` resolver tests (broad-wins still works on its axis when both axes are set)
