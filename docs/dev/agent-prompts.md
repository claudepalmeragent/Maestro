# Agent prompts — durable reference

This document captures the canonical Maestro slash-command prompts used for Maestro development. The user's Maestro instance has these wired up as `/preflight-sync`, `/postflight-rebase`, `/commit-ARD`, `/commit-adhoc`, `/merge-after-review`, and `/new-sprout`. This file is the source-of-truth for the prompt content and the design rationale; if any prompt evolves in Maestro, update it here too so sibling agents and future operators see the same expectations.

---

## Actor tagging — who runs what

**Critical for SOC 2 / change-management author/committer SoD.** Each slash command has a designated invoking actor. Agents must not autonomously invoke founder-side commands.

| Slash command         | Actor                                                                                                   | When                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/preflight-sync`     | **Agent-side** (auto-injected at start of agent's session by Maestro harness)                           | Before any work begins on a dispatched ARD                                                                                                           |
| `/commit-ARD`         | **Founder-side** (founder invokes via Maestro harness; harness injects prompt into the agent's session) | After agent reports "tasks complete; ready for founder review and `/commit-ARD`" AND founder has reviewed deliverables                               |
| `/commit-adhoc`       | **Founder-side** (same harness pattern as `/commit-ARD`)                                                | Founder-driven small commits (typos, planner-side docs, etc.)                                                                                        |
| `/postflight-rebase`  | **Founder-side** (founder invokes if siblings merged during the flight)                                 | After commit, before merge, when `git log main..<branch>` shows divergence                                                                           |
| `/merge-after-review` | **Planner-side** (planner runs on the planner worktree, founder explicit "yes" gates the actual merge)  | Final step — bring the agent's branch into main                                                                                                      |
| `/new-sprout`         | **Planner-side** (planner authors sprouts in the planner worktree; founder or planner can invoke)       | When authoring any new long-lived strategic doc — sprout, companion doc, ADR, market-analysis. NOT for Build-ARDs, per-task work, or sprout updates. |

**Anti-pattern:** agent autonomously running `/commit-ARD`, `git commit`, `/postflight-rebase`, or `/merge-after-review`. This collapses author/committer separation and breaks SOC 2 CC8.1 multi-actor SoD evidence. **Precedent incident:** a dev agent autonomously ran `/commit-ARD` after auto-ticking unescaped Human Verification boxes + reading an unguarded "commit message MUST follow..." instruction. Resolution: every ARD's CRITICAL INSTRUCTIONS now begin with a STOP-and-do-not-commit rule (see `docs/ards/build-ard-template.md` §"Format rules" item 7); commit-format instructions carry a "DO NOT COMMIT WITHOUT DIRECTION FROM THE FOUNDER" preamble (item 8); Human Verification checkboxes are backslash-escaped (item 6).

**Agent-side flow (correct):** `/preflight-sync` → execute tasks → record `**Verification:**` for each task → STOP and report "tasks complete; ready for founder review and `/commit-ARD`". Wait. Do not commit. Do not modify Human Verification boxes.

**Founder-side flow:** review deliverables → tick Human Verification boxes → invoke `/commit-ARD` via Maestro harness → if siblings merged, invoke `/postflight-rebase` → planner runs `/merge-after-review` with founder-explicit "yes".

---

## When to use which

| User-said                                                                                                                           | Underlying intent                                                                                                                                                                                               | Prompt to use         |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| "commit your work for ARD 04"                                                                                                       | Driven by an Auto Run document at `/app/__AUTORUN/NN_*.md`                                                                                                                                                      | `/commit-ARD`         |
| "commit the typo fix you just made"                                                                                                 | Ad-hoc work — bug fix, doc patch, review feedback, manual tweak                                                                                                                                                 | `/commit-adhoc`       |
| "commit" (ambiguous)                                                                                                                | Default to `/commit-adhoc`; ARD-driven work usually comes with explicit "for ARD NN" framing                                                                                                                    | `/commit-adhoc`       |
| "merge dev-4's ARD 01 to main"                                                                                                      | Post-review ceremony bringing an agent's branch into main                                                                                                                                                       | `/merge-after-review` |
| "sync from main" / "pre-flight" / before any ARD or ad-hoc work                                                                     | Bring agent's branch up to main's HEAD via rebase                                                                                                                                                               | `/preflight-sync`     |
| "rebase onto main" / "your branch is behind" / after a sibling agent merges while you were running                                  | Re-integrate sibling-agent merges that landed in main while your branch had a commit on it (regardless of whether the commit came from human-invoked `/commit-ARD` or from an autonomous-commit gate violation) | `/postflight-rebase`  |
| "spawn a sprout for X" / "let's capture this as a sprout" / "new sprout: <topic>" / "we need to think about this later — sprout it" | Authoring a new long-lived knowledge-aggregation doc (sprout/companion/ADR/market-analysis); requires cross-session transcript scan before authoring to avoid silently losing prior work                        | `/new-sprout`         |

If the founder is mid-review of an ARD and says "commit", default to `/commit-ARD` because the ARD context is implicit. (The founder invokes; the agent does not commit autonomously — see "Actor tagging" above.)

The five-prompt family covers the full lifecycle: **sync from main** (`/preflight-sync`, agent-side) → **agent does work and STOPS** → **founder reviews** → **founder invokes `/commit-ARD` (or `/commit-adhoc` for ad-hoc)** → **[if sibling agents merged during the flight: founder invokes `/postflight-rebase`]** → **planner runs `/merge-after-review`** with founder-explicit "yes".

`/postflight-rebase` is required only when an agent's branch ran in parallel with one or more sibling agents and one of those siblings merged into main first. The first-to-merge needs no post-flight rebase; every subsequent merger does. The human determines this by checking `git log main..<branch>` for unexpected divergence after the sibling merges land.

---

## Post-flight workflow ordering — decision matrix

When an agent reports completion, the human's choice of slash-command sequence depends on **two axes**, not one:

1. **Did the agent auto-commit during ARD execution?** (i.e., did it violate the `/commit-ARD` Step 1.5 gate?)
2. **Did sibling agents merge into main during this agent's flight?** (i.e., is `git log HEAD..main` non-empty?)

| Auto-commit during flight? | Siblings merged during flight? | Sequence                                                              |
| -------------------------- | ------------------------------ | --------------------------------------------------------------------- |
| **No** (clean discipline)  | **No**                         | verify → `/commit-ARD` → `/merge-after-review`                        |
| **No** (clean discipline)  | **Yes**                        | verify → `/commit-ARD` → `/postflight-rebase` → `/merge-after-review` |
| **Yes** (gate violation)   | (either)                       | verify → `/postflight-rebase` → `/merge-after-review`                 |

**Why `/commit-ARD` and `/postflight-rebase` are not mutually exclusive — they handle different things and chain cleanly:**

- `/commit-ARD` takes uncommitted work and produces a commit. Its Step 1.5 refuses if a commit already exists on the branch — so it is **skipped** in the auto-commit row.
- `/postflight-rebase` validates and integrates ANY existing commit-on-branch (whether produced by `/commit-ARD` or by an auto-commit). Its Step 3 exits early if no siblings merged — so running it when nothing to integrate costs ~30 seconds and stops cleanly. The Step 2.5 tree-vs-deliverable cross-check still runs and is useful as a sanity check on auto-commits even when no siblings merged.
- `/merge-after-review` is always the final step, run on the planner worktree.

**Why row 2 (clean discipline + siblings merged) needs `/postflight-rebase` after `/commit-ARD`:** `/commit-ARD` does not contain a rebase step. Its Step 1.5 only audits for unauthorized prior commits; it does not update the branch base. So even cleanly-gated commits land on the SESSION-START main HEAD that existed when `/preflight-sync` ran. If siblings merged during the flight, the branch is still behind main and `/merge-after-review` would either conflict or silently revert sibling work. `/postflight-rebase` slots in between to integrate the new main.

**Diagnostic to determine the row:** before invoking any post-completion command, run from the agent's worktree:

```bash
git log --oneline main..HEAD          # commits on this branch ahead of local main
git log --oneline HEAD..main          # commits on local main this branch is missing
```

> **Reference convention (until Gitea lands):** in our bare-repo (`/app/.git-repo/`) + sibling-worktrees layout, all branches share refs through the bare repo; `origin` is decorative until Gitea is wired in Phase 0+ scope. The canonical reference for "what's on main" is **local `main`**, not `origin/main`. When Gitea lands, revisit and switch to the `git fetch origin && ... origin/main` form throughout this doc.

- First output **empty** + worktree dirty → row 1 or 2 is in play (clean discipline). Run `/commit-ARD` first.
- First output **non-empty** → an autonomous commit exists. Row 3. Skip `/commit-ARD`; go straight to `/postflight-rebase`.
- Second output **non-empty** → siblings merged; `/postflight-rebase` is required (row 2 or 3, after the appropriate predecessor).
- Both outputs **empty** + worktree clean → branch is current and committed; go straight to `/merge-after-review`.

---

## `/preflight-sync` — bring your branch up to main before starting any work

Use this prompt at the start of any agent session before executing a Build-ARD or starting ad-hoc work. It is the same protocol embedded as `Task N.0` in every Phase 0+ ARD, packaged as a callable command so it can be invoked outside the ARD flow too. Safe to re-run — fast no-op if your branch is already current.

```text
Sync your worktree's branch up to main. Follow this exact protocol:

1. CONFIRM YOU ARE NOT ON MAIN
   - Run `git rev-parse --abbrev-ref HEAD`. If the output is `main`, STOP and tell the human you are already on main — there is nothing to rebase. (Only sibling-agent worktrees rebase from main; the planner worktree IS main.)

2. CONFIRM CLEAN WORKING TREE
   - Run `git status`. The output MUST report "nothing to commit, working tree clean".
   - If there are uncommitted changes, STOP. Do NOT auto-stash. Tell the human you have uncommitted changes and ask whether they should be stashed, committed, or discarded before the rebase.

3. SHOW WHAT'S LANDING (informational)
   - Run `git log --oneline main..HEAD` — commits on your branch that main does not have. Usually empty for a fresh sync; non-empty if you have unpushed work in progress (which is fine).
   - Run `git log --oneline HEAD..main` — commits on main that your branch does not have. This is what the rebase will integrate.
   - If `HEAD..main` is empty, your branch is already current — say so and skip step 4.

4. REBASE MAIN INTO YOUR BRANCH
   - Run `git rebase main`.
   - If the rebase reports conflicts, STOP. Do NOT attempt to auto-resolve. Run `git rebase --abort` to back out the rebase, then tell the human which files conflicted and ask for triage.
   - If the rebase succeeds, capture the new HEAD short-SHA via `git rev-parse --short HEAD`.

5. CONFIRM POST-SYNC STATE
   - Run `git log --oneline -1` and show the output.
   - Tell the human: "Branch <your-branch> synced to main as <short-SHA>. Ready for next task."
```

---

## `/postflight-rebase` — re-integrate sibling-agent merges after parallel-dispatch flights

Use this prompt when an agent's branch has a commit on it AND one or more sibling agents merged into main while this agent was still running. The branch is now behind main and a naive merge would either conflict heavily or silently revert the sibling agents' work. This prompt rebases the agent's single ARD commit onto post-sibling-merge main, with explicit defaults for the four conflict patterns that appear ~every time, and STOP-and-report for everything else.

**Important: how the commit got there does not affect this prompt.** Two paths produce the same end-state — both need `/postflight-rebase`:

- **Path A (clean):** The human invoked `/commit-ARD` (the only legitimate dev-N commit gate, since agents cannot invoke slash commands themselves — those are locked in the Maestro harness) and the agent left work uncommitted as Step 1.5 expects. The `/commit-ARD` invocation produced one commit on the agent's branch. During that interval (or before), a sibling agent's branch was merged into main.
- **Path B (gate violation):** The agent auto-committed autonomously during ARD execution, violating the `/commit-ARD` Step 1.5 rule. A sibling agent merged into main during/after.

In either path the agent's branch has a commit and main has moved ahead. `git rebase main` semantics are identical regardless of provenance. (Step 2's "exactly ONE commit" check catches the Path B sub-case where the agent auto-committed multiple times — that surfaces as >1 commit and triggers STOP-and-report, which is the correct behavior.)

**When this prompt is needed.** Parallel dispatch (e.g., dev-4 + dev-5 + dev-6 launched concurrently for ARDs 06/07/08) means all branches start at the same main HEAD. As each branch merges in series, the others fall behind. The first to merge needs no post-flight rebase. The second through Nth do — they need to integrate the new main before their own commit can land cleanly. `/preflight-sync` is _pre_-flight only; it does not address mid-flight or post-flight drift. `/commit-ARD` does not contain a rebase step either — its Step 1.5 only checks for unauthorized prior commits, it does not update the branch base. So even cleanly-gated commits land on the session-start main HEAD; if siblings merged during the flight, this prompt is still required.

**Diagnostic to confirm this prompt is the right tool.** Run `git log --oneline HEAD..main` from the agent's worktree (local `main` is canonical — see Reference convention note above). If the output is empty, your branch is already current — use `/merge-after-review` directly. If the output shows commits that aren't yours, you need `/postflight-rebase` first.

````text
Re-integrate sibling-agent merges that landed in main while you were running. Your single ARD commit will be rebased onto post-sibling-merge main. Follow this exact protocol:

1. CONFIRM YOU ARE NOT ON MAIN
   - `git rev-parse --abbrev-ref HEAD` → must be your agent branch (e.g., `maestro-dev-N`), not `main`. If you are on main, STOP — only sibling-agent worktrees rebase.
   - `git status` → must report "nothing to commit, working tree clean". If not, STOP and ask the human.

2. CAPTURE YOUR PRE-REBASE SCOPE (this is the first safety net)
   - `git log --oneline main..HEAD` → expected: exactly ONE commit, your ARD commit. Capture its short-SHA as `PRE_SHA`. If you see multiple commits or zero commits, STOP — your branch is in an unexpected state, report to the human. (Local `main` is canonical here — see Reference convention note in the Post-flight workflow ordering section. Until Gitea lands, do NOT use `origin/main`.)
   - `git show --stat $PRE_SHA` → capture the full list of files your ARD commit touched. Save this as your "scope manifest" — after the rebase, the diff `main..HEAD` MUST be a subset of this list (plus any dependency-lock-file changes from regen). Anything outside this set means the rebase went wrong.

2.5. TREE-VS-DELIVERABLE CROSS-CHECK ON PRE_SHA (catches incomplete original commits BEFORE rebase)
   - Some commits ship incomplete because of `/commit-ARD` gate violations (autonomous self-commits) or `git add` typos that miss files. If the original commit is already broken, rebasing won't fix it — and the bug will keep cascading. Catch it here before sinking effort into a doomed rebase.
   - `git log -1 --format=%B $PRE_SHA` → read the commit message body. Enumerate every file path mentioned in `Files changed:` / `Key deliverables:` / `- core/...:` / `- services/...:` / `- tests/...:` lines (both top-level and nested bullets).
   - For each enumerated path, run `git ls-files $PRE_SHA -- <path>` — output MUST be the path. Empty output means the commit's body claims the file but the tree does not contain it.
   - Cross-reference against your ARD's task headers (`Files (new):` or `File (new):` blocks under each `### Task N.X` heading in `/app/__AUTORUN/<NN>_*.md`). Every declared deliverable must exist in `git ls-files $PRE_SHA`.
   - If ANY claimed deliverable is missing from the tree, STOP. Your original commit is incomplete. Report to the human with: (a) the list of missing files, (b) whether each missing file exists on disk in the worktree (`ls -la <path>`), and (c) whether each is gitignored (`git check-ignore -v <path>`). The human will decide whether to amend the original commit before rebasing or escalate.
   - Why this matters: a previous incident had a credentials file missing from the original commit because of a `/commit-ARD` gate violation compounded by an over-broad `.gitignore` `credentials.*` pattern that hid the file from `git status`. The miss was caught only at HV review, after a successful rebase + push. This step would have caught it before rebasing.

3. INSPECT WHAT'S LANDING
   - `git log --oneline HEAD..main` → these are the sibling-agent commits + planner commits you must integrate. Show the output to the human. (Local `main`, not `origin/main` — see Reference convention note.)
   - If empty, STOP — `/postflight-rebase` is not needed; your branch is already current.

4. REBASE ONTO POST-MERGE MAIN
   - `git rebase main`
   - Conflicts WILL occur if your ARD touched files a sibling ARD also touched. Resolve per the four universal patterns below. STOP-and-report for anything outside the four patterns.

5. UNIVERSAL CONFLICT-RESOLUTION DEFAULTS

   **Pattern A — Dependency manifests (`pyproject.toml`, `package.json`, `pnpm-workspace.yaml`, etc.):**
   Almost always "keep both." Sibling ARDs add their own deps; your ARD adds its own deps; the rebase needs the union. Hand-merge the conflict markers preserving both sides' additions. Sort if surrounding code is sorted; preserve original order otherwise.

   **Pattern B — Lock files (`uv.lock`, `package-lock.json`, `pnpm-lock.yaml`, `poetry.lock`):**
   NEVER hand-merge. Resolve Pattern A first, then regenerate the lock file from scratch:
     - `uv.lock` → `uv lock`
     - `package-lock.json` → `npm install --package-lock-only`
     - `pnpm-lock.yaml` → `pnpm install --lockfile-only`
     - `poetry.lock` → `poetry lock --no-update`
   Then `git add <lockfile>`.

   **Pattern C — Stub `__init__.py` (or equivalent stub) you created during preflight when a parent package was absent:**
   Common when ARDs depend on each other and you flighted before the dependency landed. If main now has the real implementation at the same path, accept main's version (`git checkout --theirs <path>`); your stub is no longer needed because the sibling ARD shipped the real thing. If main still has nothing at that path, keep yours (`git checkout --ours <path>`). Decide by reading the conflict markers — main's version with substantive code = real implementation; main's version empty/missing = nothing landed there.

   **Pattern D — Allow-list / registry / lint-config files you DID NOT modify but a sibling did (`scripts/lint-no-*.sh`, `.pre-commit-config.yaml`, `docs/decisions/README.md` index, etc.):**
   Accept main's version (`git checkout --theirs <path>`). You did not modify these; the conflict is git being conservative.

   **Anything else (genuine code conflicts inside files in your ARD's scope):**
   STOP. `git rebase --abort`. Report to the human with file paths + conflict-marker excerpts. DO NOT attempt creative resolution. The human will either provide a per-file resolution policy as a one-off, or escalate.

6. CONTINUE THE REBASE
   - After each conflict batch resolved + `git add`-ed, run `git rebase --continue`.
   - When the rebase reports "Successfully rebased and updated refs/heads/<branch>", proceed to step 7.

7. POST-REBASE SCOPE-EQUALITY CHECK (mandatory safety net)
   - `git log --oneline -1` → capture new short-SHA as `POST_SHA`.
   - `git log --oneline main..HEAD` → must show exactly ONE commit (`POST_SHA`). If more or fewer, STOP and report.
   - `git diff --stat main..HEAD` → compare against the scope manifest from step 2. The post-rebase set MUST be a subset of (pre-rebase scope ∪ dependency-manifest changes ∪ lock-file changes). Files outside that set — especially DELETIONS of paths your ARD never touched — indicate the rebase silently reverted sibling work. If you see anything outside the expected set, STOP and report immediately. DO NOT push.

8. CLEAN-CHECKOUT VERIFICATION (mandatory; verify against the committed tree, not your worktree)
   - The rebase may have invalidated assumptions in your ARD's tests (e.g., your test mocks a function whose signature changed in a sibling ARD). It may also have silently dropped files. Your worktree may have untracked files that mask missing deliverables — running pytest from the worktree gives false positives. The fix: verify against a fresh clone of the rebased commit, which contains ONLY what is actually committed to the tree.
   - Spin up a temporary clone:
     ```
     TMPDIR=$(mktemp -d)
     git clone --branch <your-branch> /app/.git-repo "$TMPDIR/verify-clone"
     cd "$TMPDIR/verify-clone"
     git rev-parse HEAD  # MUST equal POST_SHA from step 7
     uv sync
     ```
   - From the clone, re-run the verification commands from your ARD's `Task N.last` (full-sweep) section, typically:
     - `uv run python -c "from <your ARD's top-level package> import <key symbols>; print('IMPORT OK')"` — fail-fast for missing files; the IMPORT OK line MUST appear.
     - `uv run mypy --strict <your ARD's package paths>` — MUST report Success.
     - `uv run pytest <your ARD's test paths> -v -ra` — MUST show the same passing count your ARD claims at Task N.last.
   - Then clean up: `cd /app/<your-worktree>; rm -rf "$TMPDIR"`.
   - If ANY verification fails in the clone, STOP and report — capture the raw output. DO NOT push.
   - Why the clone matters: a previous incident had a credentials file missing from the commit while still present in the worktree as an untracked file. Worktree-based verification passed because Python resolved the on-disk file; clone-based verification would have failed at the IMPORT step. This step is the durable structural defense against "works on my worktree" deficiencies.
   - Then run pre-commit on the worktree (where hooks live) — `cd /app/<your-worktree>; pre-commit run --all-files`. This catches lint/format issues the clone-based verification doesn't cover.

9. PUSH WITH LEASE (NOT plain force)
   - The rebase rewrites your commit's SHA. You must push with `--force-with-lease`:
     - `git push --force-with-lease origin <branch>`
   - `--force-with-lease` is mandatory — it refuses if anyone else pushed to your branch in the meantime. Plain `--force` is FORBIDDEN.

10. REPORT (paste raw output, do not summarize)
    - `PRE_SHA` (your ARD commit before rebase) and `POST_SHA` (after rebase).
    - Confirmation that step-2.5 tree-vs-deliverable cross-check passed (or the list of missing files that escalated).
    - Which sibling-agent commits got integrated (from step 3's output).
    - Which conflict patterns surfaced (A/B/C/D) and how each was resolved.
    - Confirmation that step-7 scope-equality check passed (no unexpected deletions).
    - The `IMPORT OK` line and last 40 lines of pytest output from step 8's clone-based verification.
    - The last 10 lines of mypy output from step 8.
    - The last 20 lines of pre-commit output from step 8's final worktree sweep.
    - Any STOP-and-report cases that escalated to the human.
````

---

## `/commit-ARD` — for Build-ARD-driven commits

Use this prompt when the agent has just finished executing a Build-ARD from `/app/__AUTORUN/NN_*.md`. It enforces ARD compliance, scope-creep disclosure, and ARD traceability in the commit message.

````text
Commit the work you've completed for the current Build-ARD. Follow this exact protocol:

1. SELF-CHECK ARD COMPLIANCE
   - Open the Build-ARD you've been executing (in /app/__AUTORUN/).
   - Verify EVERY task checkbox is `- [x]` (checked) with a non-empty agent fill-in line documenting what was done + verification result.
   - If ANY task is unchecked or missing evidence, STOP — return to that task and complete it before commiting.

1.5. PRE-COMMIT BRANCH-STATE CHECK (mandatory)
   - Run `git log --oneline main..HEAD`. This prompt is the SOLE authorized place where commits land on your agent branch.
   - Expected: zero commits beyond what existed on your branch before ARD execution started (typically zero new commits — your branch should be at main's HEAD with all your work UNCOMMITTED in the working tree).
   - If you see one or more commits made during ARD task execution (i.e., before this `/commit-ARD` invocation), that's a protocol violation. STOP and report to the human — DO NOT make a second commit on top. The human will decide whether to amend, squash, or accept the existing commit chain.
   - The CRITICAL constraint in every ARD says "Do NOT stage, commit, or push any code." That applies to ARD task execution; THIS prompt is the only authorized commit gate.

2. SCOPE-CREEP DISCLOSURE (mandatory section, even when empty)
   - Review your `git status` for any files NOT specified in any ARD task.
   - The Build-ARD MUST contain a `## Scope additions (out-of-ARD)` section before commit, regardless of whether you added anything. Two valid forms:
     - **Some additions:** list every out-of-scope file with `(a) file path, (b) one-sentence description, (c) why it was necessary`.
     - **No additions:** write a single line: `**Scope additions: none.**` Absence of the section is treated as a protocol violation, even if you genuinely added nothing — the explicit "none" disclosure protects against silent omissions.
   - **Exemption:** Files you will update in Step 3 below (DOCUMENTATION REVIEW) — `README.md`, `CLAUDE.md`, `docs/repo-layout.md`, `docs/dev/localdev-deviations.md`, and any other `*.md` referenced by your code changes — do NOT need to appear in the ARD's Scope additions section. Those are mandated by this prompt, not scope creep.

3. DOCUMENTATION REVIEW
   - Examine the current `git diff` and determine whether any of these need updates:
     - README.md (top-level project description / quick links)
     - CLAUDE.md (AI-agent orientation guide)
     - docs/repo-layout.md (canonical filesystem spec)
     - docs/dev/localdev-deviations.md (if your work introduced a tactical workaround)
     - Any other *.md file referenced by your changes
   - Make the documentation updates if needed. Stage them for the same commit.

4. TEST + MOCK REVIEW (DO NOT RUN THE FULL TEST SUITE)
   - Examine the test files + mocks associated with files in your diff.
   - Determine whether any unit tests, fixtures, or mocks need updates to remain accurate.
   - Make the updates if needed. Stage them for the same commit.

5. STAGE EXCLUSIONS
   - DO NOT stage the Build-ARD file itself (the file at /app/__AUTORUN/<NN>_*.md). Your task checkoffs are local working notes, not code artifacts.
   - DO NOT stage anything in /app/__AUTORUN/ regardless of whether you modified it.

6. COMPOSE COMMIT MESSAGE
   - Format:
     ```
     <type>(<scope>): <subject — under 70 chars>

     <detailed description — what changed and why, in prose>

     Files changed:
     - <path>: <one-line description>
     - <path>: <one-line description>

     Scope additions (out-of-ARD): <if any; else "none">
     - <path>: <why it was necessary>

     ARD: <NN_filename.md>
     Session: <your Maestro/Claude conversation UUID — see below>

     Co-Authored-By: <current model name> <noreply@anthropic.com>
     ```
   - `<type>` is one of: feat, fix, docs, chore, build, refactor, test, ci.
   - `<scope>` is the area touched (e.g., `phase0`, `localdev`, `orchestrator`).
   - The `Session:` line is REQUIRED in the body — never the subject.
   - The `ARD:` line lets us trace the commit back to its driving Auto Run doc.
   - **Session ID — what to use, what NOT to use:**
     - USE: your **Maestro/Claude conversation UUID** — the long hex identifier in 8-4-4-4-12 format (e.g., `97e22ee8-267b-4cd6-b04c-16728eca4dc8`). This identifier is present in your conversation's system context / runtime metadata; in Claude Code it appears as the `session_id` field on every turn. It lets the human grep back to your exact agent conversation when reviewing history.
     - DO NOT use loop-iteration identifiers like `maestro-dev-4/loop-00001` or `<branch>/loop-NNNNN`. Those are local autorun-counter values that cannot be linked back to the Maestro/Claude session and are not useful for traceability.
     - DO NOT copy the example UUID `97e22ee8-267b-4cd6-b04c-16728eca4dc8` literally. That's an illustrative shape, not your value. Use YOUR conversation's actual UUID.
     - If you genuinely cannot find your session UUID in your runtime context, write `Session: unknown` and tell the human in your response — better an explicit gap than a wrong value.

7. STAGE + COMMIT (no push by default; commit-gate token required)
   - `git add` only the files identified in steps 3-4 plus the original ARD code outputs.
   - The commit-gate hook (`scripts/commit-gate-check.sh`) requires a per-invocation token to be present. Generate the token, write it to the lock file, and run `git commit` with the token as an inline env-var override — a SINGLE bash invocation:
     ```bash
     TOKEN="$(python3 -c 'import uuid; print(uuid.uuid4())')" && \
       echo "$TOKEN" > /tmp/.commit-gate-token && \
       AS_COMMIT_GATE_TOKEN="$TOKEN" git commit -F /tmp/commit-msg.txt
     ```
     (Write the message from step 6 to `/tmp/commit-msg.txt` first, or use `git commit -m "$(cat <<'EOF' ... EOF)"` heredoc form. Either works as long as the token + git commit run in the SAME shell command.)
   - The hook validates: lock file present, mtime within 60 s, env-var token matches file contents. On pass, the hook consumes (deletes) the lock file. On fail, the commit is blocked and a `commit.gate.violation` OTLP event is emitted to the OTEL gateway.
   - **DO NOT** export `AS_COMMIT_GATE_TOKEN` in your shell or write it to any rc file — the inline form is the only authorized usage.
   - DO NOT push. The human reviews each commit before pushing/merging to main.
   - If the human has explicitly told you in this conversation to push, then run `git push` AFTER the commit lands.
````

---

## `/commit-adhoc` — for non-ARD-driven commits

Use this prompt when the agent has done ad-hoc work outside of any Build-ARD — manual fixes, doc patches, review feedback, exploratory tweaks. It substitutes "why-this-change" for ARD compliance and adds defensive stage-exclusions for files that should never be committed.

````text
Commit ad-hoc work (NOT driven by a Build-ARD). Follow this exact protocol:

1. WHY-THIS-CHANGE CHECK
   - In one sentence, articulate WHY this change exists. Examples: "fix typo in README", "address user-reported bug in conftest.py", "respond to review feedback on PR #42".
   - If you cannot articulate a clear "why" — STOP. Ad-hoc commits without intent become noise in git history. Ask the human for clarification before proceeding.

2. SCOPE CONFIRMATION
   - Run `git status` and `git diff --stat`.
   - Confirm every changed file is part of the user's actual request.
   - If you find files you don't recognize as part of the ask, STOP. Either revert them (`git restore <file>`) or explicitly ask the human whether they should be included.

3. DOCUMENTATION REVIEW
   - Examine the current `git diff` and determine whether any of these need updates:
     - README.md (top-level project description / quick links)
     - CLAUDE.md (AI-agent orientation guide)
     - docs/repo-layout.md (canonical filesystem spec — only if you moved/renamed/added directories)
     - docs/dev/localdev-deviations.md (if your work introduced a tactical workaround)
     - Any other *.md file referenced by your changes
   - Make the documentation updates if needed. Stage them for the same commit.

4. TEST + MOCK REVIEW (DO NOT RUN THE FULL TEST SUITE)
   - Examine the test files + mocks associated with files in your diff.
   - Determine whether any unit tests, fixtures, or mocks need updates.
   - If you ADDED new code, add corresponding unit tests in the same commit (TDD-after).
   - Run ONLY the module-scoped tests for the files you touched (e.g., `uv run pytest tests/test_<module>.py`). NEVER `make test`.
   - Make the updates if needed. Stage them.

5. STAGE EXCLUSIONS
   - DO NOT stage anything in /app/__AUTORUN/ — those are working notes, not code.
   - DO NOT stage anything in __do_not_commit__/ — that directory is gitignored as a quarantine and any presence in `git status` is a sign of leakage.
   - DO NOT stage .env, *.local, *.local.* files — those are per-developer overrides (gitignored, so this is mostly a defensive check).

6. COMPOSE COMMIT MESSAGE
   - Format:
     ```
     <type>(<scope>): <subject — under 70 chars>

     <one-paragraph "why" — what changed and why, in prose>

     Files changed:
     - <path>: <one-line description>
     - <path>: <one-line description>

     Session: <your Maestro/Claude conversation UUID — see below>

     Co-Authored-By: <current model name> <noreply@anthropic.com>
     ```
   - `<type>` is one of: feat, fix, docs, chore, build, refactor, test, ci.
   - `<scope>` is the area touched (e.g., `localdev`, `orchestrator`, `docs`).
   - The `Session:` line is REQUIRED in the body — never the subject.
   - **Session ID — what to use, what NOT to use** (same rule as `/commit-ARD`):
     - USE: your **Maestro/Claude conversation UUID** in 8-4-4-4-12 hex format (e.g., `97e22ee8-267b-4cd6-b04c-16728eca4dc8`) — sourced from your conversation's runtime metadata / system context.
     - DO NOT use loop-iteration identifiers (`<branch>/loop-NNNNN`).
     - DO NOT copy the illustrative example UUID literally — use YOUR actual conversation UUID.
     - If unavailable, write `Session: unknown` and flag it to the human.
   - There is NO `ARD:` line on ad-hoc commits — that field is reserved for ARD-driven commits to keep grep-ability of ARD-traceable work clean.

7. STAGE + COMMIT (no push by default; commit-gate token required)
   - `git add` only the files identified in steps 3-4 plus the original ad-hoc changes.
   - The commit-gate hook (`scripts/commit-gate-check.sh`) requires a per-invocation token. Generate, write to the lock file, and run `git commit` with the token as an inline env-var override — a SINGLE bash invocation:
     ```bash
     TOKEN="$(python3 -c 'import uuid; print(uuid.uuid4())')" && \
       echo "$TOKEN" > /tmp/.commit-gate-token && \
       AS_COMMIT_GATE_TOKEN="$TOKEN" git commit -F /tmp/commit-msg.txt
     ```
     (Write the message from step 6 to `/tmp/commit-msg.txt` first, or use `git commit -m "$(cat <<'EOF' ... EOF)"` heredoc form. The token + git commit MUST run in the same shell command.)
   - The hook validates: lock file present, mtime within 60 s, env-var token matches file contents. On pass, the hook consumes the lock file. On fail, commit is blocked and a `commit.gate.violation` OTLP event is emitted.
   - **DO NOT** export `AS_COMMIT_GATE_TOKEN` in your shell or write it to any rc file — the inline form is the only authorized usage.
   - DO NOT push. The human reviews each commit before pushing/merging to main.
   - If the human has explicitly told you in this conversation to push, then run `git push` AFTER the commit lands.
````

---

## `/merge-after-review` — for human-approved merge of an agent branch into main

Use this prompt **on the planner agent only**. The planner runs from its own `maestro-planner` branch worktree (per ADR 0001 swarm topology — each agent worktree on its own self-named branch). Merges happen from a _dedicated merge-only worktree_ at `/app/maestro-main/` that is permanently checked out to `main` and has no agent assigned to it. The human reviews an agent branch (typically a sibling worktree like `maestro-dev-4`), then invokes this prompt; the planner switches to the merge-only worktree, runs the merge, and reports back. Other agents pick up the merged work via their next ARD's pre-flight `git rebase main`.

````text
Merge a reviewed agent branch into main. This prompt MUST be run from the dedicated merge-only worktree at `/app/maestro-main/` (NOT from the maestro-planner worktree — the planner is now on its own self-named branch per ADR 0001). Follow this exact protocol:

1. ENTER MERGE-ONLY WORKTREE + VERIFY YOU ARE ON MAIN
   - Run `cd /app/maestro-main` FIRST — every subsequent command in this protocol runs from inside this directory. The merge-only worktree exists specifically so merges land on main without ever changing the planner worktree's HEAD.
   - Run `git status` and confirm the output begins with "On branch main".
   - If you are NOT on main (or the worktree at `/app/maestro-main/` does not exist), STOP. Tell the human the merge-only worktree is missing or misconfigured; do NOT fall back to running the merge from the planner worktree (that's the failure mode this topology was designed to prevent — see "Why the merge-only worktree exists" below).
   - Confirm `git status` reports a clean working tree. If not, STOP.

2. CONFIRM THE BRANCH TO MERGE
   - The human will tell you which branch to merge (e.g., "merge maestro-dev-4"). If they did not, ask explicitly.
   - Run `git log --oneline main..<branch>` and show the output. Each line is a commit that will land on main.
   - Run `git diff --stat main..<branch>` and show the output. This is the file-level breakdown of what's about to land.
   - Pause and ask the human "Confirm merge of <branch> into main? (yes/no)". DO NOT proceed without an explicit "yes".

2.5. SUPPRESSION AUDIT (mandatory; security-critical surface protection)

   Before asking the human for yes/no in Step 2, scan the incoming commits for hook-driven suppressions that may have masked real issues during the agent's `/commit-ARD` cycle. Pre-commit hooks frequently flag tfsec/trivy/IAM-wildcard/secret/type issues; agents under time pressure sometimes SUPPRESS via inline comments (`#tfsec:ignore:RULE`, `# noqa`, `# type: ignore`, `# pragma allowlist secret`, `# OUTBOUND_SCHEMA_EXEMPT: ...`) instead of fixing the underlying problem. Suppressions with substantive rationale are acceptable; suppressions without rationale or on security-critical surfaces (KMS policy, IAM scoping, encryption settings, tier gating) are NOT.

   **Required commands (run all six against the incoming diff):**

   ```bash
   for pattern in "tfsec:ignore" "trivy:ignore" "noqa" "type: ignore" "pragma: allowlist" "OUTBOUND_SCHEMA_EXEMPT" "OUTBOUND_AWS_ALLOWLIST" "allowlist-aws-sensitive" 'Resource\s*=\s*"\*"'; do
     echo "--- $pattern ---"
     git diff main..<branch> | grep -E "^\+" | grep -E "$pattern" | head -10
   done
   git diff main..<branch> | grep -E "^\+.*(tier|enable_hardened|kms|secret|iam_role|policy)" | grep -iE "Literal|str\s*=|Any" | head -10
   git diff --stat main..<branch> | grep -i "baseline\|gitleaks\|secrets" || echo "(no secret-tracking files modified)"
   ```

   **Note:** `OUTBOUND_AWS_ALLOWLIST` and `allowlist-aws-sensitive` should be BANNED at commit time by `scripts/lint-no-suppression-markers.sh` (configure this lint per your project's secret-hygiene policy). Audit grep here is defense-in-depth — if these patterns appear in the diff, the underlying pre-commit guard should have already rejected the commit; presence in the diff indicates either a bypass attempt or a stale agent operating with the old policy. Both warrant explicit founder review.

   **Surface findings to the human in Step 2 alongside the commit list and diff stat.** For each hit, classify:

- **TIER 1 (cosmetic, no action):** `ruff format`, `markdownlint`, `terraform fmt`, conventional-commits subject, whitespace fixes.
- **TIER 2 (low-medium, inspect):** `# type: ignore[import-untyped]` on third-party libs without stubs (test-only, common pattern); `# noqa` on non-security code with non-trivial rationale; `mypy` `Literal` widening (CHECK whether on tier/security fields — if so, escalate to TIER 3).
- **TIER 3 (HIGH RISK, requires explicit founder acknowledgment):** `tfsec:ignore` / `trivy:ignore` on security rules; `lint-no-iam-wildcard.sh` allowlist additions; new `.secrets.baseline` entries or `# pragma allowlist secret` on non-fixture code; substrate-conformance `OUTBOUND_SCHEMA_EXEMPT` with trivial reasons; IAM `Resource = "*"` introductions; Literal widening on `tier`/`hardened`/security fields. Each TIER-3 hit MUST have a substantive rationale in the suppression's inline comment AND be acknowledged in the merge body.

   **If any TIER-3 hit lacks a substantive rationale, STOP** before asking yes/no. Report the suppression + file:line + suggested remediation (fix the underlying issue OR add a substantive rationale comment). Do NOT proceed to merge until founder explicitly accepts each TIER-3 suppression.

3. CHECK FOR CONFLICTS PROACTIVELY
   - Run `git merge --no-commit --no-ff <branch>` to attempt the merge without committing.
   - If conflicts occur: run `git merge --abort` to clean up, then STOP and report the conflicting files to the human for triage. DO NOT attempt to auto-resolve.
   - If no conflicts: run `git merge --abort` to back out the test merge (we'll do the real one with a proper message in step 4).

3.5. VERIFY BRANCH ANCESTRY + CITE EVIDENCE FOR ALL BODY CLAIMS (mandatory; SOC 2 CC8.1 audit-trail integrity)

   Before composing the message body in Step 4, run these git checks and use their outputs to drive the body language. Every process-claim in the body MUST be backed by a command output you just executed in this step — never inferred from indirect signals like "no-conflict therefore X".

   **Required commands (run all three, capture outputs):**

- `git merge-base --is-ancestor <latest-main-merge-sha> <branch>` — returns 0 if the latest main merge is an ancestor of the branch tip (i.e., `/postflight-rebase` ran), non-zero if not. Determines body language: "rebased onto X" vs "branched off pre-X".
- `git rev-parse <branch>^` — shows the actual parent SHA of the branch tip. Confirms (or refutes) ancestry inference.
- `git log --oneline <latest-main-merge-sha>..<branch>` — lists commits unique to the branch (should be 1 for a single-ARD flight; >1 means rebase-bundled multiple commits worth flagging).

   **Self-check before drafting Step 4 body:** list every process-claim you intend to write (e.g., "dev-N rebased onto X", "no auto-commit occurred", "scope addition disclosed"), and pair each with a verifier command output from this step (or earlier work in the conversation). If any claim lacks a verifier, drop it or run the verifier now. Inference is not evidence.

   **Anti-pattern:** authoring a falsifiable process claim in the merge-commit body (which is immutable per no-amend policy) without first verifying via git. Precedent: a merge commit body asserted "dev-N did NOT run /postflight-rebase" based on inference from a clean test-merge; `git rev-parse <commit>^` returning the latest main-merge SHA at that time would have shown the assertion was false. The falsehood becomes permanent on the audit trail. SOC 2 CC8.1 (multi-actor change-management evidence) requires merge-message bodies to be factually accurate at compose time; this protocol prevents that class of recurrence.

4. COMPOSE MERGE COMMIT MESSAGE
   - Format:

     ```
     chore(merge): <ARD-or-feature-summary> from <branch>

     <one-paragraph "what's landing" — the deliverable summary, NOT the diff>

     Reviewed YYYY-MM-DD: <one-line review verdict — full compliance, scope additions accepted/rejected, etc.>
     <optional: ADR references for any architectural concerns surfaced by the review>

     Reviewed-by: maestro-planner (Claude Opus 4.7)
     ARD: <NN_filename.md if ARD-driven; omit if ad-hoc-merge>

     Session: <planner-session-UUID auto-derived from /home/maestro/.claude/projects/-app/*.jsonl>

     Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
     ```

   - Keep the subject under 70 chars. The body captures what the human approved + anything the human flagged.
   - **Subject MUST start with `chore(merge):`** — the repo's Conventional Commits pre-commit hook rejects bare `Merge ...` subjects. Lesson learned: an unprefixed `Merge ...` subject was rejected, leaving the merge in a staged-but-uncommitted state requiring a re-commit with the conventional prefix.
   - **Session line is mandatory** for planner-composed merge commits — auto-derive from the most-recently-modified `*.jsonl` under `/home/maestro/.claude/projects/-app/` per the Commit conventions section in CLAUDE.md.

5. DO THE MERGE (commit-gate token required)
   - The merge produces a commit; the commit-gate hook fires. Generate a token, write to the lock file, and run `git merge --no-ff` with the token as an inline env-var override — a SINGLE bash invocation:
     ```bash
     TOKEN="$(python3 -c 'import uuid; print(uuid.uuid4())')" && \
       echo "$TOKEN" > /tmp/.commit-gate-token && \
       AS_COMMIT_GATE_TOKEN="$TOKEN" git merge --no-ff <branch> -m "<message from step 4>"
     ```
     (Use heredoc form `-m "$(cat <<'EOF' ... EOF)"` if the message is multi-line.)
   - `--no-ff` is mandatory — preserves the "this came via human review" history trace even when fast-forward would work.
   - Show the merge-commit short-SHA from `git log --oneline -1` in your response.

6. CONFIRM POST-MERGE STATE
   - Run `git log --oneline -3` and show the output (merge commit + the two prior).
   - DO NOT push. The human pushes to the bare repo at /app/.git-repo/ (no-op for local-only setup; required for Gitea remote when wired in Phase 0+).
   - Tell the human: "Merge complete as <short-SHA>. Sibling agents will pick up via `git rebase main` on their next ARD pre-flight."

7. OPTIONAL: PRUNE THE SOURCE BRANCH
   - DO NOT prune by default. Branches are cheap and the historical trace is valuable.
   - If the human explicitly asks to prune the merged branch: `git branch -d <branch>` (safe — refuses if branch has unmerged commits) followed by removing the worktree if appropriate (`git worktree remove /app/<branch>`). For an agent VM's worktree, also coordinate with the human on shutting down the corresponding Maestro Agent VM if it is no longer needed.
````

---

## `/new-sprout` — author a sprout with mandatory cross-session knowledge recovery

Use this prompt when starting a new sprout, companion doc, ADR, market-analysis doc, or other long-lived knowledge-aggregation doc. The prompt enforces a **two-pass transcript scan** of prior planner conversation history before the doc is written, so cross-session strategic thinking isn't silently lost to single-conversation context.

**Why this exists:** New strategic docs DEFAULT to silently dropping prior cross-session work because the single-conversation context-window limit doesn't include prior planner sessions. In a precedent incident, a sprout was bootstrapped with 3 entries based on only-current-conversation memory; a subsequent transcript scan surfaced ~85 entries of prior cross-session analysis that would otherwise have been lost. This prompt is the mechanical enforcement of "scan history first."

```text
Author a new long-lived strategic doc (sprout, companion doc, ADR, market-analysis) with mandatory cross-session knowledge recovery. Follow this exact protocol:

CRITICAL: this protocol MUST run from the planner worktree (`maestro-planner`). Sprouts live at `docs/sprouts/*.md`; companion docs at `docs/companions/*.md`; ADRs at `docs/decisions/NNNN-*.md`. Build-ARDs, per-task work, and *updates to existing strategic docs* are OUT OF SCOPE — use direct file edits + `/commit-adhoc` for those.

The human will supply the topic / title as the prompt argument. If no argument is supplied, ask one clarifying question before proceeding.

1. CONFIRM INTENT
   - Restate to the human:
     - The doc TYPE you're about to author (sprout / companion / ADR / market-analysis). Default to sprout unless the topic clearly fits one of the others.
     - The proposed FILENAME (kebab-case, `.md`, under the correct directory).
     - The 1-sentence framing of WHAT the doc is about.
   - Wait for the human's explicit "yes" / refinement before proceeding. If the human is unclear or wants you to choose, ask ONE clarifying question. Do not infer past genuine ambiguity.

2. MANDATORY TWO-PASS TRANSCRIPT SCAN
   - Delegate the scans to one or more subagents (Explore for default, general-purpose if scan complexity warrants). DO NOT scan inline — the transcripts can be 60 MB+ and you must keep them out of the main context window.
   - **Pass A — competitive / decision framing**: grep patterns "competitor / vs / alternative to / displace / chose X over Y / instead of / rejected / evaluated" against all jsonls under `/home/maestro/.claude/projects/-app/*.jsonl`. Returns a deduplicated list of companies, products, technologies, or decisions the topic was previously compared against.
   - **Pass B — inspiration / reference framing**: grep patterns "look at / check out / inspired by / remind(s) me of / similar to / take a look / saw this at" + URL-bearing tokens (`<word>.ai`, `<word>.com`, `<word>.io`, `<word>.dev`, `<word>.co`). Returns a deduplicated list of references the founder dropped in passing that may have seeded the topic.
   - **Known-positive validation idiom**: ALWAYS include a known-positive case in each subagent's prompt — "X MUST appear in your output; if it doesn't, your patterns are too narrow, retry with broader instruction." Without this validation, scan-pattern misses go undetected.
   - Merge the two pass outputs. Note in your working draft which findings came from which pass.

3. EXISTING-STRATEGIC-DOC OVERLAP CHECK
   - Run `Glob "docs/sprouts/*.md"` and `Glob "docs/companions/*.md"` and `Glob "docs/decisions/*.md"`.
   - Skim filenames and any obvious title-overlap candidates. Read the candidate file's first 30 lines if title-similarity is high.
   - If overlap is found, REPORT it to the human and ask: "Should I extend `<existing-file>` instead of creating `<new-file>`? Reply 'extend' or 'new'." Wait for explicit answer.
   - On "extend": switch to direct file-edit mode, fold findings into the existing doc, then hand off to `/commit-adhoc`.

4. ADR INDEX CHECK
   - Read `docs/decisions/README.md`.
   - Scan ADR titles + Status lines for prior ratification or supersedence relevant to the topic.
   - Note any relevant ADRs in your working draft for cross-referencing.

5. AUTHOR THE DOC
   - Use the sprout-template format documented at `docs/sprouts/README.md` (or the equivalent ADR/companion template) — frontmatter, "What's the idea," "Why it might matter," "Open questions," "Notes / inspiration links" sections at minimum.
   - **Fold the four findings sources** (Pass A scan, Pass B scan, overlap check, ADR check) into the doc's content:
     - Pass A + Pass B findings of >10 items: add a categorized appendix or table; note the scan date + summary in "Notes / inspiration links."
     - Pass A + Pass B findings of <10 items: weave into the relevant body sections.
     - Overlap finding (if any): cross-reference in "Notes / inspiration links."
     - ADR finding (if any): cross-reference in "Notes / inspiration links" with ADR number + title.
   - Author for durability across sessions — assume the next reader has no current-conversation context and write so the doc stands on its own.

6. UPDATE THE INDEX
   - For sprouts: append a row to the table in `docs/sprouts/README.md` in alphabetical order with status "Sprout (review pending)" plus the next phase-trigger or "Phase-N+1 review."
   - For companions: update `docs/companions/README.md` if it exists; otherwise note in the closure or related doc.
   - For ADRs: add row to `docs/decisions/README.md` with Status "Proposed."

7. HAND OFF TO `/commit-adhoc`
   - Do NOT commit yourself. Preserve SoD between authoring and committing.
   - Your final-turn report sentence is:
     > "New <doc-type> authored at `<path>` with <count> findings folded in from two-pass transcript scan. Ready for founder review and `/commit-adhoc`."
   - Then STOP. Exit cleanly. Do not run any further tool calls.

STAGE EXCLUSIONS (defensive — should not apply to sprout authoring, but for sanity):
- DO NOT scan or fold in content from `/app/__AUTORUN/` (working notes, not durable knowledge).
- DO NOT scan or fold in content from `__do_not_commit__/` (gitignored quarantine).
- DO NOT include any session UUIDs, API keys, or personal contact info from the transcripts in the doc body.

FAILURE MODES TO AVOID:
- Skipping Pass B because Pass A returned plenty. Founders introduce companies under BOTH framings; single-pass misses ~20% of references.
- Inferring instead of asking when the human is ambiguous about doc type, filename, or topic framing. One clarifying question is fine; inferring three things is not.
- Folding scan output into the doc without categorization. ~70 raw names is noise; ~70 categorized entries is a watchlist.
- Auto-committing. SoD is preserved by handing off to `/commit-adhoc` — do not skip the handoff.
```

---

## Design rationale

### Why two prompts instead of one conditional prompt

Less cognitive load on the agent at execution time. A conditional prompt ("if you executed an ARD use steps X-Y, otherwise A-B") risks the agent picking the wrong branch under pressure. Two distinct slash commands at the Maestro layer make the choice explicit before the prompt fires.

### Why `ARD:` is exclusive to `/commit-ARD`

The `ARD:` line in commit bodies enables `git log --grep "ARD: 04_"` to find every commit traceable to a specific Auto Run document. If ad-hoc commits also used the field, the grep would surface false positives. The clean separation is worth the one-bullet-of-friction cost.

### Why `Session:` is universal

Every commit links back to the agent conversation that produced it (Maestro's `{{AGENT_SESSION_ID}}` token). This is independent of whether the work was ARD-driven or ad-hoc — both flavors benefit from conversation-level traceability.

### Why every commit-producing prompt wraps `git commit` / `git merge` with the commit-gate token

The commit-gate (pre-commit hook at `scripts/commit-gate-check.sh`, configured in `.pre-commit-config.yaml`) defends against autonomous `git commit` invocations that bypass these prompts' checklists — measured at ~20% during early dispatch cycles. Threat model: skip-the-checklist commits, NOT skip-the-human. An agent that reads this file and walks through the protocol (creating the lock file + passing the inline token) is acceptable degraded-mode behavior; the discipline still ran.

Mechanism: the slash command generates a per-invocation UUID token, writes it to `/tmp/.commit-gate-token`, and runs the commit/merge as `AS_COMMIT_GATE_TOKEN=<UUID> git commit ...` — a single inline env-var override. The hook validates lock-file presence, mtime within 60 s, and token match. On pass, the lock file is consumed (single-use). On fail, the commit is blocked and a `commit.gate.violation` OTLP event is emitted to `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/logs` with `agent.index` / `host.name` / `git.branch` attributes for downstream observability analysis. Telemetry failures are swallowed — a down OTEL gateway must NEVER block legitimate commits.

The inline form is critical: each Bash tool call inherits env from `/etc/environment` and Maestro provisioning, but `AS_COMMIT_GATE_TOKEN` is intentionally NOT in those — so a raw `git commit` from any other Bash invocation has the var unset and the hook denies. Operators must NOT `export AS_COMMIT_GATE_TOKEN` in any rc file or shell session; doing so silently disables the gate.

`--amend`, `merge --continue`, and `cherry-pick` all produce commits and trigger the hook. They need the same inline-token discipline; document on first use.

### Why `/postflight-rebase` exists as a separate prompt vs being part of `/commit-ARD`

Three reasons. (1) `/commit-ARD` runs at the end of the agent's flight, when the human may not yet have decided which agent merges first. The post-flight rebase only makes sense AFTER the merge order is known (i.e., after one or more siblings have already landed on main). Bundling the rebase into `/commit-ARD` would either rebase too eagerly (before siblings merge, which is a no-op) or too late (after the human invokes `/merge-after-review`, which is past the safe rebase point). (2) The conflict-resolution patterns (Patterns A/B/C/D) are post-rebase failure modes that depend on what specifically a sibling ARD touched — coupling them into `/commit-ARD` would bloat that prompt with rebase logic that 80% of single-flight ARDs don't need. (3) Separation lets the human invoke `/postflight-rebase` selectively for the second-and-subsequent mergers without re-running `/commit-ARD`'s scope-creep + documentation-review + commit-composition steps that already executed during the original flight.

### Why `/postflight-rebase` defaults to four conflict patterns rather than per-ARD custom resolution

Empirically the four patterns (dep-manifest keep-both, lock-file regen, stub-vs-real-impl, allow-list-take-theirs) cover ~every conflict that arises from parallel ARD dispatch. Encoding them as defaults means most rebases proceed without human intervention, while the explicit STOP-and-report fall-through ensures genuine code conflicts (which DO need human triage) never get auto-resolved. The pattern set is small enough to memorize. New patterns should be added here only after a third real incident — speculative additions inflate the prompt without earning their keep.

### Why Step 2.5 (tree-vs-deliverable cross-check) and Step 8 (clone-based verification) exist

Both steps came out of a real incident where a commit shipped without a key deliverable file because of a `/commit-ARD` gate violation (autonomous self-commit that skipped the gate's file-list-vs-deliverables checklist) compounded by an over-broad `.gitignore` pattern that hid the file from `git status` output entirely. The miss was masked through three layers of verification: (1) the agent's local pytest passed because the file was on disk in the worktree; (2) the agent's `pre-commit run --all-files` passed for the same reason; (3) the post-rebase scope-equality check (step 7) succeeded because the file was never in the manifest in the first place. The miss was caught only at HV review, after the merge ceremony was already underway.

Step 2.5 catches incomplete original commits BEFORE rebase. The `git log -1 --format=%B` enumeration cross-references every file path the commit message claims to deliver against `git ls-files`. If the original commit is broken, rebasing it just moves the broken state forward; better to escalate immediately so the human can amend the source commit.

Step 8's clone-based verification is the structural defense against "works on my worktree" deficiencies. A fresh clone of the rebased SHA contains ONLY what is in the committed tree — no untracked files masking missing deliverables, no stale local artifacts. Running `uv sync` + import test + pytest + mypy from the clone gives ground-truth answers about what main will look like after merge. Worktree-based verification is faster but unreliable; clone-based verification is the one that matters before push.

These two steps add ~2 minutes to a normal post-flight rebase but save hours when a violation has occurred. The cost is asymmetric in the right direction.

### Why `/preflight-sync` is its own prompt vs always-embedded as Task N.0

Embedded `Task N.0: Pre-flight` blocks live in every ARD because most agent sessions DO start by executing an ARD, and we want zero opportunity for the agent to skip the sync. But ad-hoc work, exploratory sessions, or "I just woke up, am I current?" moments don't have an ARD to embed in. `/preflight-sync` is the same protocol packaged for those cases. The two surfaces are intentionally redundant — the embedded version is mandatory, the slash-command version is convenient.

### Why `/merge-after-review` is planner-only

Centralizing the merge ceremony on the planner enforces separation-of-duties: the agent that authored the work isn't the one approving its landing on main. The planner runs from its own `maestro-planner` branch and switches into the merge-only worktree at `/app/maestro-main/` to perform each merge.

### Why the merge-only worktree exists

Every worktree's name matches its branch (`maestro-dev-N` on branch `maestro-dev-N`, `maestro-planner` on branch `maestro-planner`). To execute a merge into main, _some_ worktree has to be on main — that worktree is `/app/maestro-main/`, dedicated to merges with no agent attached. This topology removes a real failure mode: an earlier setup had the planner worktree checked out to main directly, and a single `git checkout main` from inside the planner shell (run accidentally during a merge protocol) silently switched the planner's HEAD to main and left it there for 9 days, with every subsequent planner commit landing directly on main. The merge-only worktree makes that impossible — the planner worktree is on its own branch, so accidental `git checkout main` from there is a no-op against main itself. Precedent: the planner-on-main drift incident — fix recipe was to give the planner its own branch and provision a separate merge-only worktree.

### Why `--no-ff` is mandatory in `/merge-after-review`

A fast-forward merge (default when main has no commits since the branch's parent) leaves no record that a review happened — main's history just absorbs the branch's commits as if they were authored on main directly. `--no-ff` forces a merge commit whose message captures the review verdict, the reviewer, and the ARD attribution. That commit becomes the auditable record. Cheap discipline, expensive without.

### Why no-push-by-default for both

Aligns with the user-controls-merges pattern that has held throughout the project's pre-launch phase. The human reviews each commit before pushing/merging to `main`. If trust + automation maturity grow, individual sessions can opt-in via explicit "push after commit" instruction; the prompts respect that override but never default to push.

### Why the universal stage exclusions matter

Both prompts forbid staging `/app/__AUTORUN/` content because Build-ARD files are working notes (the agent's checkoffs and audit trail) — not deliverable code. They are intentionally NOT version-controlled in the planner repo and live in their own shared `/app/__AUTORUN/` directory outside any worktree. The `/commit-adhoc` version additionally guards against `.env`, `*.local`, and `__do_not_commit__/` files appearing in commits — those are gitignored anyway, but a defensive check at commit time catches accidents (e.g., a developer who added a new secret-bearing file before the gitignore patterns updated).

---

## Maintenance

- This file is the source-of-truth for the prompt content. If either prompt is updated in Maestro's slash-command store, sync the change here in the same commit.
- New universal CRITICAL constraints added to autorun docs (`/app/__AUTORUN/00_*_README.md`) should be reflected in both prompts when relevant.
- The `Session: {{AGENT_SESSION_ID}}` token is Maestro-specific. If we adopt a different agent harness later, this token name may need adjusting in both prompts and at the Maestro slash-command store.

---

**End of agent prompts.**
