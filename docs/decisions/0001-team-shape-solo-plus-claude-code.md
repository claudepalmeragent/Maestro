# ADR 0001 — Team shape: solo + Claude Code agents pairing (Maestro swarm)

- **Status:** Accepted
- **Date:** 2026-05-15
- **Related:** project planning docs

## Context

Build is solo developer + Maestro-managed Claude Code agent swarm. Original calendar projections were unconsciously based on human-developer wall-clock-hours; with Maestro 8-24+ hour agent runs + multi-VM parallelism, plausible recalibration is significantly shorter.

## Decision

Swarm topology:

- **`maestro-planner`** (this VM, Opus 4.7[1M]): planning, docs, ADRs, Build-ARD prep
- **`maestro-dev-1` / `-2` / `-3`** (local micro-VM, Ollama models): grunt work, offline-capable
- **`maestro-dev-4` / `-5` / `-6`** (cloud micro-VM, Sonnet 4.6 default): execute pre-planned Build-ARDs
- **`maestro-moderator`** (cloud, Haiku 4.5): group-chat moderation in Maestro

Each agent VM sees only its self-named worktree branch (Maestro-enforced) — clean isolation, minimizes rollback fuss.

Long-running agent sessions (8-24 hours) are reliable in this environment; later phases prefer longer runs with clean code-separation enabling parallelism over fine-grained Build-ARD decomposition.

## Alternatives considered

- **Hire contractor + work in parallel** — Rejected as inefficient given Maestro tooling.
- **Solo human only, no agent swarm** — would justify the original multi-month MVP estimate. Rejected as inefficient given Maestro tooling.

## Consequences

- **Positive:** Massive parallelism opportunity; later phases can run multiple agents in parallel on different services. 
- **Negative:** Build-ARD authoring becomes the bottleneck; planner agent (this one) needs to stay ahead of dev agents. Coordination via the moderator agent + repo-as-coordination-substrate.
- **Neutral:** Clean code separation and module boundaries become more important to enable parallel agent work.

## Implementation notes

- Build-ARD authoring template: `docs/ards/build-ard-template.md`
- Build-ARD acceptance criteria: `docs/ards/build-ard-acceptance.md`
- Worktree topology: `docs/repo-layout.md`
