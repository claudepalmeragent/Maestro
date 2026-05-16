# Build-ARD acceptance criteria (universal)

Every Build-ARD must satisfy these gates in addition to its specific tasks. These are the universal acceptance criteria — the per-ARD `**Verification:**` blocks layer additional task-specific checks on top.

---

## Required gates (every Build-ARD)

```yaml
acceptance:
  required:
    - all_pre_commit_hooks_pass: true            # `pre-commit run --all-files` green
    - no_secrets_introduced: true                # 3-scanner clean (gitleaks + detect-secrets + trufflehog) — install per project
    - module_scoped_tests_pass: true             # vitest scoped to touched files; full suite is OUT OF SCOPE during ARD execution per Rule 7
    - coverage_not_decreased: true               # coverage >= prior baseline on touched modules (vitest --coverage)
    - typecheck_clean: true                      # `npm run lint` (TypeScript type-check) green
    - eslint_clean: true                         # `npm run lint:eslint` green
    - no_suppression_markers_introduced: true    # `scripts/lint-no-suppression-markers.sh` clean — TS/JS suppression markers (@ts-ignore, eslint-disable, etc.)
    - no_silent_error_swallow_introduced: true   # `scripts/lint-no-silent-error-swallow.sh` clean — bare or no-op catch blocks (Maestro CLAUDE.md anti-pattern)
    - markdown_lint_clean: true                  # for any docs touched
    - commit_message_conventional: true          # conventional-commits format (enforced by pre-commit)
```

## Conditional gates (when applicable to the project)

```yaml
acceptance:
  conditional:
    - if_terraform_touched: tfsec_clean                       # not applicable to Maestro
    - if_python_touched: mypy_strict_clean                    # not applicable to Maestro (TS/JS only)
    - if_dockerfile_touched: trivy_image_scan_clean           # not applicable to Maestro
    - if_typescript_touched: typecheck_clean + eslint_clean   # always applies in Maestro — promoted to required above
    - if_new_module: smoke_test_runs_in_dev                   # `npm run dev` boots without console.error
    - if_iam_or_terraform_introduced: no_iam_wildcard_clean   # not applicable to Maestro; included for portability if package is reused
```

The conditional list is intentionally inclusive of gates that don't apply to Maestro so the spec remains portable. Per-project install can drop the `if_*` entries that are unreachable.

---

## Security-sensitive extra gate

Build-ARDs that touch security-sensitive code (auth, IAM, KMS, secrets, billing) gain an extra gate: **explicit planner-agent approval before merge**, in addition to the founder's standard review via `/merge-after-review`. The planner reads the diff against the project's security ADRs and confirms no policy violations.

---

## How acceptance criteria interact with the per-ARD `**Verification:**` blocks

| Layer | What it checks | When it runs | Surface for failures |
|---|---|---|---|
| Per-task `**Verification:**` block | The specific task did what it claimed (file landed, function returns expected value, test passes) | After each task during agent execution | Agent stops, reports, doesn't tick checkbox |
| Universal acceptance criteria (this doc) | Repo-wide invariants are preserved (lints clean, tests green, no secrets, etc.) | At `/commit-ARD` time via pre-commit hooks | Commit-gate refuses; agent reports via `/commit-ARD` Step 1.5 |
| Founder review at `/merge-after-review` | Deliverable matches intent + ADR alignment + no scope creep | Before merge into main | Human triage; suppression audit at Step 2.5 |
| Optional planner approval (security-sensitive ARDs) | Diff conforms to security ADRs | Before merge, alongside founder review | Human escalation |

The four layers are deliberately redundant — each catches a different class of failure.

---

## Project-specific customization

This file documents the **universal** acceptance criteria pattern. Each project should:

1. **Add or remove gates per project policy** — e.g., for Maestro, the `lint-no-suppression-markers.sh` and `lint-no-silent-error-swallow.sh` scripts are required (shipped under `scripts/`); the `lint-no-iam-wildcard.sh` and `lint-no-vertical-terms.sh` scripts referenced by other projects are not applicable and have been dropped from the required list.
2. **Define the security-sensitive surface list** — which file paths trigger the planner-approval extra gate (e.g., `infra/terraform/**`, `services/*/auth/**`, `core/secrets/**`).
3. **Wire the gates into `.pre-commit-config.yaml`** so they fire automatically at commit time, not as a manual checklist.
4. **Document the gate failure recovery path** — what an agent should do when a gate refuses (typically: revert the offending change, address the root cause, re-run the gate).

---

**End of Build-ARD acceptance criteria.**
