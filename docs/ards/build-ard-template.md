# Build-ARD authoring template (canonical)

This is the canonical format every **Build-ARD** (development task script for a Maestro Claude Code agent) must follow. Build-ARDs are authored, executed, and archived under `/app/__AUTORUN/` — a sibling directory of all git worktrees and intentionally NOT inside any repo. See **Storage convention** at the bottom of this document for the exact paths.

> **Reminder:** Build-ARDs are *internal* scripts that drive Maestro dev agents to *build* the platform. They are distinct from any runtime workflows that customers or end-users might author.

---

## Format requirements

### Required structure (in order)

```markdown
# ARD <N>: <Short Title>

## Context

(One paragraph. Why this Build-ARD exists. What it depends on.)

## CRITICAL INSTRUCTIONS FOR AGENT

- You MUST implement EVERY change described below COMPLETELY. No stubs. No placeholders. No shortcuts.
- After completing EACH task, come back to this document, check off ONLY that task's checkbox, and SAVE this file before starting the next task.
- Do NOT create your own checkboxes. Only use the ones provided below.
- Do NOT stage, commit, or push any code unless explicitly instructed in a task.
- **Run ONLY module-scoped tests for the files you touched** (e.g., `uv run pytest tests/<module>/test_<name>.py` or `uv run pytest tests/<module>/`). Each task's `**Verification:**` block specifies the exact scoped command — execute only that.
- **NEVER run `make test`, `make ci`, or any full test suite invocation** during ARD execution. Full-suite invocations destroy timeline compression with no benefit to ARD verification.
- **Closure-ARD carve-out.** This prohibition applies to implementation ARDs. ARDs whose frontmatter contains `closure_ard: true` (the per-phase closure ARD) are EXEMPT and explicitly REQUIRE `make test` to run as a triple-check safeguard at phase boundary. The carve-out is scoped to closure ARDs only — per-task verification within them still uses scoped commands; the full-suite run is its own dedicated task with output captured to the closure note.
- Lines with `\- [ ]` are **human verification items** — do NOT attempt to complete or evaluate them.
- **Dynamic-agent placeholders.** Paths in this Build-ARD use `{{AGENT_NAME}}` (sometimes `{{WORKTREE}}` — synonyms) as a stand-in for your assigned worktree directory. If the placeholder appears literal (e.g., `/app/{{AGENT_NAME}}/services/...`), the orchestrator did not pre-substitute it — replace it with your own worktree name from the `$AGENT_NAME` env var (also visible in your bashrc welcome banner) before executing any command. Example: agent `maestro-dev-3` running a task that says `cd /app/{{AGENT_NAME}}/services` should execute `cd /app/maestro-dev-3/services`.

---

## Tasks

### Task <N>.<sub>: <Task name>

**File:** `<absolute-path-from-repo-root>` *(if single file; omit if multi-file)*

(Brief description of what this task accomplishes — 1-3 sentences. Reference exact file paths + line numbers + function names where possible.)

**Step 1:** *(if multi-step task)*

​```<language>
<exact code to add or replace>
​```

**Step 2:** ...

**Verification:** `<exact command to run>`

- [ ] Task <N>.<sub> complete — *(agent fills in this line with what was done + test results when checking off)*

---

(repeat for each task)

---

## Human Verification

\- [ ] *(human-only verification item)*
\- [ ] *(human-only verification item)*
```

---

## Format rules (strict)

1. **Title line** is `# ARD <N>: <Short Title>` — N is the integer Build-ARD ID (zero-padded if 4-digit slug used in filename)
2. **Context section** is exactly one paragraph. Not multiple paragraphs. Not bullet points. Just enough to anchor the agent on why and what depends on it.
3. **CRITICAL INSTRUCTIONS section** is required. Adapt the bullets per Build-ARD but always include: (a) implement everything completely no stubs, (b) check off after each task save before next, (c) don't create your own checkboxes, (d) don't stage/commit/push unless told, (e) test command per task.
4. **Tasks numbered hierarchically** as Task `N.M` where N is the ARD's integer ID and M is the sub-task index. (e.g., Task 26.1, 26.2, 26.3 for ARD 26.)
5. **Each task has its own AGENT checkbox** at the end: `- [ ] Task N.M complete — *(agent fills with verification result citation)*`. The agent fills in WHAT was done + cited verification result when checking off. **Authoring self-check before merging an ARD into `__AUTORUN/`:** count of `- [ ] Task ` per-task checkboxes MUST equal count of `### N.M — ` task headers. Use:
   ```bash
   tasks=$(grep -c "^### [0-9]\+\.[0-9]\+" path/to/ard.md)
   boxes=$(grep -c "^- \[ \] Task " path/to/ard.md)
   [ "$tasks" = "$boxes" ] && echo "OK ($tasks)" || echo "MISMATCH: $tasks tasks vs $boxes boxes"
   ```

   **Anti-pattern:** authoring `**Verification:** <line>` blocks without the trailing per-task agent checkbox. Precedent: an entire phase's ARDs were authored with Verification blocks but no per-task `- [ ]` checkboxes, surfaced by founder review post-merge of the first ARD. Without the per-task agent checkbox, agents have nowhere to record per-task completion + verification citation, breaking Rule 15's audit-trail-per-task discipline. Fix: append the checkbox to every task; re-run the self-check.
6. **Do not nest checkboxes inside tasks.** Each task = one checkbox. Sub-steps are described as `**Step 1:** ... **Step 2:** ...` but don't have their own checkboxes.
7. **Code blocks must specify language** (`typescript`, `python`, `bash`, etc.).
8. **Verification command** at the end of each task is mandatory. Exact command. Full path.
9. **`\- [ ]`** (with literal escaped backslash) at the end of the document for human-only verification items. The agent must NOT touch these.
10. **`---`** horizontal rules between major sections + between tasks.
11. **Frontmatter (optional, top of file, before first `#` heading):** Priority / Estimated Effort / Files Changed / Depends on. Useful for triage but not required.
12. **Tool side-effects must be explicit.** When a task uses a tool that mutates non-obvious files (lockfiles, generated configs, dependency manifests), the task body MUST enumerate every file that gets touched so the eventual commit doesn't miss any. Common cases:
    - `uv add <pkg>` → mutates `pyproject.toml` **AND** `uv.lock` — both must be staged at commit time.
    - `uv sync` / `uv lock` → mutates `uv.lock`.
    - `pnpm add <pkg>` → mutates `package.json` **AND** `pnpm-lock.yaml`.
    - `terraform init` (in a permanent module dir) → may create `.terraform.lock.hcl` — stage it.
    - `alembic revision -m "..."` → creates a new file under `migrations/versions/` — stage it.
    - `pre-commit autoupdate` → mutates `.pre-commit-config.yaml` — stage it.
    Precedent: a task using `uv add` was committed without `uv.lock`, requiring a follow-up commit to fix. Enumerating side-effects in the task body prevents this.
13. **CRITICAL INSTRUCTIONS section MUST be inlined verbatim — never `(Standard.)`, `(See ARD 0X.)`, or any reference-to-elsewhere shorthand.** Agents reliably read inline rules in the ARD body but skip cross-references to README files or sibling ARDs. Every Build-ARD must inline the full bulleted list:
    - (a) Implement EVERY change COMPLETELY. No stubs. No placeholders. No shortcuts.
    - (b) After completing EACH task, check off ONLY that task's checkbox and SAVE this file before starting the next task.
    - (c) Do NOT create your own checkboxes. Only use the ones provided.
    - (d) **DO NOT stage, commit, or push any code unless explicitly instructed. The `/commit-ARD` slash-command is the SOLE authorized commit gate — running `git commit` during task execution is a protocol violation.**
    - (e) Run the verification command per task: `<exact command>`.
    - (f) Dynamic-agent placeholders: `{{AGENT_NAME}}` / `{{WORKTREE}}` → substitute from `$AGENT_NAME` env var before executing.
    - (g) **Per-fact verification (Rule 15):** every Task includes a `**Verification:**` block with a runnable command + expected output. Task closure notes cite which verification confirmed the work.
    Precedent: consecutive commit-during-task-execution slips traced to agents skipping cross-referenced CRITICAL INSTRUCTIONS. The `/commit-ARD` Step 1.5 branch-state check catches these post-hoc, but inlining closes the loophole at the source.
14. **Outbound-schema rule (per project policy).** If a Build-ARD introduces a NEW customer-facing surface (browser plugin route, public API endpoint, webhook emitter, partner adapter), it MUST include a task that registers an `OutboundSchema` for that surface and tests confirming `enforce_schema` passes for the intended payload + fails for any field outside the allowlist. Internal-only surfaces (cross-service A2A, internal admin) are exempt — mark them with `# OUTBOUND_SCHEMA_EXEMPT: <reason>`. **Adapt or remove this rule based on the project's outbound-schema architecture; remove entirely if the project doesn't enforce schema discipline at every customer-facing boundary.**
15. **Rule 15 — Per-fact verification.** Every Task in a Build-ARD MUST include an explicit `**Verification:**` block with a runnable command and expected output (or expected outcome if non-runnable, e.g. "file present", "field set to X"). The closure note for each task MUST cite which verification confirmed the work, not just that the work was done. Rationale: per-fact verification catches drift between intent and outcome. Without it, post-merge surprises are common; with it, surprises surface before commit.

---

## Why this format works

The format was iterated across 40+ sample Build-ARDs, evolving from heavy phase docs (~3,000 lines) → mid-detail step-by-step (~310 lines) → tight checklist-driven (~100 lines). **Later iterations performed materially better** for the following reasons:

1. **Smaller scope per Build-ARD** = lower cognitive load on the agent + tighter feedback loop per task
2. **Explicit forbidden patterns** in CRITICAL INSTRUCTIONS (no stubs / no shortcuts / don't create checkboxes / don't push code) prevent common agent mistakes
3. **Per-task verification command** forces the agent to validate before moving on, surfacing regressions early
4. **Inline `> VERIFIED:` notes** under each checked-off bullet create a self-documenting audit trail
5. **Line-number-specific references** ("verify useEffect at line 156-167") force the agent to read actual code, not pattern-match descriptions
6. **Human Verification section** with `\- [ ]` (BACKSLASH-ESCAPED) keeps human-only items separate from agent-doable items
   - **Header MUST be `## Human Verification`** (capital V) — the canonical form; lowercase `## Human verification` is incorrect and breaks audit-trail conventions
   - **Every checkbox MUST start with `\- [ ]`** (literal backslash before the dash). Markdown renders the dash; the backslash signals to an executing agent "this is a human-only item, not a task you should auto-tick"
   - **Anti-pattern:** unescaped `- [ ]` in this section. Agents see unescaped task-style bullets and natural behavior is to tick them on completion — even when they shouldn't. Precedent: an early misauthoring incident had all of a phase's ARDs authored with unescaped `- [ ]`, and the executing dev-N agent auto-ticked the HV boxes during execution, bypassing the founder-side check. Fix: bulk-escape via the planner and harden this rule.
   - **Authoring self-check before merging an ARD into `__AUTORUN/`:** `grep -A 20 "## Human" path/to/ard.md | grep -E "^- \[ \]"` MUST return zero matches. If it returns any, escape them.

7. **Mandatory STOP-and-do-not-commit CRITICAL INSTRUCTION** — every ARD's CRITICAL INSTRUCTIONS section MUST begin with this rule (item #1) verbatim:
   > *For EACH task you complete: (1) **Edit this ARD file** to flip the task's agent checkbox from `- [ ]` to `- [x]` with your verification citation inline. Maestro re-reads this file AFTER your process exits and counts checkbox deltas to decide whether progress was made — without a flipped box Maestro concludes the run stalled and stops dispatching new agents. (2) Then end your turn cleanly — no further tool calls. **(2a) Run all verification commands (pytest, terraform plan, make, etc.) in the FOREGROUND — never use `run_in_background`. Pending background tasks keep the Claude Code process alive past your apparent turn-end and prevent next-agent dispatch.** (3) Do NOT `git add`, `git commit`, `git push`, or run `/commit-ARD`, `/postflight-rebase`, or `/merge-after-review` — those are founder-injected via Maestro harness only; the commit-gate hook will refuse anyway, and any extra tool calls keep the Claude Code process alive past turn-end and delay the next agent. (4) Do NOT modify the Human Verification checkboxes — those are founder-side. (5) When ALL agent task checkboxes in this ARD are `- [x]`, your final turn's report sentence is: "tasks complete; ready for founder review and `/commit-ARD`". Then STOP — do not start the next ARD; another agent instance handles it. **Per SoD: do NOT commit; do NOT push. EXIT CLEANLY without commit — clean Claude Code process exit is what resolves the Maestro Promise and triggers next-agent dispatch.***

   **Why mandatory at item #1:** agents read CRITICAL INSTRUCTIONS top-down. The actor-boundary + Maestro-dispatch-mechanic message must land before any other instruction. Precedent: an early misauthoring lacked this rule, which let a dev-N agent interpret task-completion + auto-ticked HV boxes as license to autonomously run `/commit-ARD`. The clauses about checkbox-flip (Maestro detects progress via markdown checkbox edit → `documentChanged` + `tasksCompletedThisRun > 0`) and FOREGROUND-only verification (Maestro `process:exit` IPC fires only on real OS-level child-process exit; pending background tasks delay next-agent dispatch) were added after subsequent incidents revealed both failure modes.

8. **Commit-format instruction must carry its own gatekeeper preamble.** When an ARD includes a commit-format CRITICAL INSTRUCTION (it's a backup-control safety valve in case STOP rule is ever bypassed), it MUST begin with: *"DO NOT COMMIT WITHOUT DIRECTION FROM THE FOUNDER. When the Founder eventually runs `/commit-ARD` with you, the commit message MUST follow conventional-commits format with `Session: <UUID>` trailer."* The preamble reframes the rule as conditional ("when the founder triggers a commit, here's the format") instead of imperative ("you should commit and here's how"). Each rule self-contains the actor boundary — belt-and-suspenders.

   **Anti-pattern (DO NOT WRITE):** `"Commit message MUST follow conventional-commits format with Session: <UUID> trailer."` — this reads as imperative permission to commit.

---

## Example: a tight Build-ARD

(Illustrative example showing the tightest, best-performing format. The specific file paths and module names below are illustrative — substitute the equivalents from your project.)

````markdown
# ARD 0042: Wire ConnectorAuth into Provisioner per-Stack onboarding

## Context

This Build-ARD wires ConnectorAuth into the Provisioner's `provision_new_stack` flow so each new Stack gets per-Stack OAuth token storage initialized at provision time. Depends on ARDs 0035-0040 (Provisioner + Secure ID Broker complete).

---

## CRITICAL INSTRUCTIONS FOR AGENT

- You MUST implement EVERY change described below COMPLETELY. No stubs. No placeholders.
- After completing EACH task, come back to this document, check off ONLY that task's checkbox, and SAVE this file before starting the next task.
- Do NOT create your own checkboxes. Only use the ones provided below.
- Do NOT stage, commit, or push any code.
- Run after EACH task: `cd /app/{{AGENT_NAME}} && pytest tests/services/test_provisioner.py`

---

## Tasks

### Task 42.1: Add ConnectorAuth import to Provisioner

**File:** `/app/{{AGENT_NAME}}/services/provisioner/provisioner.py`

Add import: `from services.secure_id_broker.connector_auth import ConnectorAuth` in the imports block at top of file. Verify no circular import.

**Verification:** `python -c "from services.provisioner.provisioner import Provisioner"`

- [ ] Task 42.1 complete — *(agent fills)*

### Task 42.2: Initialize ConnectorAuth namespace in provision_new_stack

**File:** `/app/{{AGENT_NAME}}/services/provisioner/provisioner.py`

Find the `provision_new_stack(spec)` method. After the Aurora-schema-init step and before the SkillsLoader step, add:

```python
        # Initialize per-Stack ConnectorAuth namespace
        connector_auth = ConnectorAuth(client_id=spec.client_id)
        await connector_auth.initialize_namespace()
        log.info("connector_auth_namespace_initialized", client_id=spec.client_id)
```

**Verification:** `pytest tests/services/test_provisioner.py::test_provision_new_stack_initializes_connector_auth -v`

- [ ] Task 42.2 complete — *(agent fills)*

### Task 42.3: Add integration test

**File:** `/app/{{AGENT_NAME}}/tests/services/test_provisioner_connector_auth.py` *(new file)*

Create test verifying that calling `Provisioner.provision_new_stack(spec)` results in a ConnectorAuth namespace being created in Secrets Manager under `tenant/{client_id}/oauth/`. Use moto or LocalStack to mock Secrets Manager.

**Verification:** `pytest tests/services/test_provisioner_connector_auth.py -v`

- [ ] Task 42.3 complete — *(agent fills)*

---

## Human Verification

\- [ ] Provision a fresh test Stack via `make deploy-branch BRANCH=test-ard-42`; confirm Secrets Manager namespace appears in AWS console
\- [ ] Confirm Secure ID Broker can mint scoped credentials for that namespace
````

---

## Anti-patterns (what NOT to do)

Lessons from earlier samples showing what makes Build-ARDs underperform:

- ❌ **Don't use giant phase-level Build-ARDs** (>1000 lines). Cognitive load too high; agents miss steps. Aim for 100-300 lines.
- ❌ **Don't write narrative descriptions in lieu of exact instructions.** "Update the IPC handler factory" is wrong; "In `handler_factory.py` line 47, change `timeout=5` to `timeout=30`" is right.
- ❌ **Don't embed multiple unrelated changes in one task.** One task = one logical change.
- ❌ **Don't nest checkboxes inside tasks.** Confuses agents; they'll start creating their own.
- ❌ **Don't omit verification commands.** "Run the tests" without exact command is ambiguous.
- ❌ **Don't write code-as-description.** If you want code added, paste the exact code in a fenced code block.
- ❌ **Don't mix human-doable and agent-doable items in the same checklist.** Use `\- [ ]` (escaped) for human items in a separate Human Verification section.

---

## Storage convention

**Hard rule:** Build-ARDs are NEVER stored inside any git worktree or repo. `/app/__AUTORUN/` is a sibling of all worktrees and is intentionally NOT a git repo. ARDs are working notes managed on local disk by the planner agent; their lifecycle (author → dispatch → execute → archive) all happens at `/app/__AUTORUN/`. Attempting to author, copy, or commit an ARD anywhere under a worktree (e.g., `/app/maestro-planner/docs/ards/build/`) is a protocol violation.

### Paths

- **Single-document ARDs (one-shot work):** `/app/__AUTORUN/<NN>-<slug>.md` flat (e.g., `/app/__AUTORUN/0042-wire-connector-auth.md`).
- **Multi-document related ARD sets (efforts spanning ≥2 ARDs):** `/app/__AUTORUN/YYYY-MM-DD-<Effort-Name>/<PREFIX>-<NN>-<NAME>.md` — date-prefixed folder + per-doc prefix (e.g., `/app/__AUTORUN/2026-05-15-Claude-PTY-Runner/CLAUDE-PTY-01a-RUNNER-SKELETON.md`). Use this whenever a single effort produces ≥2 related ARDs.
- **Execution location:** same as authoring. Agents read from where the ARD was authored — no copy step.
- **Completed (after merge to `main`):** move to `/app/__AUTORUN/__ARCHIVE/<original-folder-or-filename>/` (preserve folder structure for multi-doc sets).
- **Deferred / cancelled / superseded:** move to `/app/__AUTORUN/__ARCHIVE/` with `-DEFERRED`, `-CANCELLED`, `-OBSOLETE`, or `-WRONG-DRAFT` suffix on the folder/file name and a one-liner reason at the top of the doc (or in a sibling `README.md` for folder-level archives).

### Why outside the repo

- **Per-VM isolation by default.** Each Maestro Agent VM has its own `/app/__AUTORUN/` (or sees only its own worktree's view). ARDs are dispatched to a specific agent's view.
- **No git noise.** ARD authoring iteration is high-frequency (drafts, rewrites, scope changes). Keeping ARDs out of git history avoids polluting the commit log with non-shipping artifacts.
- **No accidental shipping of working notes.** A misconfigured `.gitignore` could otherwise let working ARDs leak into a release.
- **Planner is the source of truth.** ARD lifecycle is driven by the planner agent's interactive sessions; the planner persists ARDs to disk for cross-session continuity but doesn't need (and explicitly should not have) version control on them. Cross-session continuity is via the planner's `~/.claude/projects/-app/*.jsonl` transcript history + the on-disk ARD files themselves.

### Frontmatter (optional)

At top of file, before first `#` heading:
- `priority: P0|P1|P2`
- `target_agent: any|maestro-dev-N`
- `parallelism: false|true`
- `depends_on: [list of build_ard_ids]`
- `related_adr: [...]`
- `phase: 0|1|2|3|4|5|6|7|8|9`

---

**End of Build-ARD authoring template.**
