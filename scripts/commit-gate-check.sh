#!/usr/bin/env bash
# =============================================================================
# Commit-gate check — anti-autocommit pre-commit hook.
#
# Defends against autonomous `git commit` invocations that bypass the
# `/commit-ARD`, `/commit-adhoc`, and `/merge-after-review` slash-command
# checklists. Threat model: skip-the-checklist commits, NOT skip-the-human.
# An agent that reads `docs/dev/agent-prompts.md` and walks through the
# protocol (creating the lock file + passing the inline token) is
# acceptable degraded-mode behavior — the discipline still ran.
#
# Mechanism:
#   1. The slash command generates a per-invocation UUID token, writes it
#      to /tmp/.commit-gate-token, and runs the commit as
#      `AS_COMMIT_GATE_TOKEN=<UUID> git commit ...` (inline env override).
#   2. This hook fires on every git commit. It checks: (a) the lock file
#      exists, (b) its mtime is within GATE_TTL_SECONDS, (c) the env var
#      $AS_COMMIT_GATE_TOKEN matches the lock file's contents.
#   3. On pass, the lock file is consumed (deleted). On fail, the hook
#      exits 1 (commit blocked) and emits a `commit.gate.violation` OTLP
#      event to the configured OTEL gateway.
#
# Failure-tolerant telemetry: OTLP emission failures are swallowed via
# `|| true`. A down OTEL gateway must NEVER block legitimate commits.
# =============================================================================

set -euo pipefail

GATE_LOCK_FILE="/tmp/.commit-gate-token"
GATE_TTL_SECONDS=60

emit_violation() {
    local reason="$1"
    local endpoint="${OTEL_EXPORTER_OTLP_ENDPOINT:-}"
    [[ -z "$endpoint" ]] && return 0

    local subject
    subject=$(git log -1 --format=%s 2>/dev/null || echo "<no-prior-commit>")
    local branch
    branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
    local time_ns
    time_ns="$(date +%s)000000000"
    local service_name="${OTEL_SERVICE_NAME:-claude-code-maestro}"

    # Parse OTEL_RESOURCE_ATTRIBUTES (comma-separated key=value) into JSON
    # attribute entries. Defensive: empty attrs string is fine.
    local res_attrs_json='[{"key":"service.name","value":{"stringValue":"'"$service_name"'"}}'
    if [[ -n "${OTEL_RESOURCE_ATTRIBUTES:-}" ]]; then
        local IFS=','
        for kv in $OTEL_RESOURCE_ATTRIBUTES; do
            local k="${kv%%=*}"
            local v="${kv#*=}"
            res_attrs_json+=',{"key":"'"$k"'","value":{"stringValue":"'"$v"'"}}'
        done
    fi
    res_attrs_json+=']'

    # POST OTLP/HTTP logs payload. `|| true` on the final pipe so curl/network
    # failures NEVER block the commit-block decision (we already decided).
    curl -sS -X POST -H 'Content-Type: application/json' \
        --max-time 2 \
        "${endpoint}/v1/logs" \
        --data-binary @- >/dev/null 2>&1 <<EOF || true
{
  "resourceLogs": [{
    "resource": {"attributes": $res_attrs_json},
    "scopeLogs": [{
      "scope": {"name": "commit-gate-check"},
      "logRecords": [{
        "timeUnixNano": "$time_ns",
        "severityNumber": 13,
        "severityText": "WARN",
        "body": {"stringValue": "commit.gate.violation"},
        "attributes": [
          {"key": "violation.reason", "value": {"stringValue": "$reason"}},
          {"key": "git.branch", "value": {"stringValue": "$branch"}},
          {"key": "git.last_commit.subject", "value": {"stringValue": "$subject"}}
        ]
      }]
    }]
  }]
}
EOF
}

deny() {
    local reason="$1"
    local message="$2"
    emit_violation "$reason"
    cat >&2 <<EOF

❌ Commit gate violation ($reason).

$message

Use the \`/commit-ARD\` slash command (for ARD-driven work),
\`/commit-adhoc\` (for ad-hoc work), or \`/merge-after-review\`
(for planner merges) — these prompts wrap \`git commit\` with the
required gate-token discipline (lock file + inline env-var token).

See \`docs/dev/agent-prompts.md\` for the full protocol.

EOF
    exit 1
}

# 1. Lock file must exist.
if [[ ! -f "$GATE_LOCK_FILE" ]]; then
    deny "no_lock_file" "No commit-gate lock file at $GATE_LOCK_FILE."
fi

# 2. Lock file must be fresh (mtime within TTL).
now=$(date +%s)
if [[ "$(uname)" == "Darwin" ]]; then
    mtime=$(stat -f %m "$GATE_LOCK_FILE")
else
    mtime=$(stat -c %Y "$GATE_LOCK_FILE")
fi
age=$((now - mtime))
if (( age > GATE_TTL_SECONDS )); then
    deny "lock_file_expired" "Lock file at $GATE_LOCK_FILE is $age seconds old (TTL: $GATE_TTL_SECONDS)."
fi

# 3. Env var token must be set.
if [[ -z "${AS_COMMIT_GATE_TOKEN:-}" ]]; then
    deny "missing_token_env" "AS_COMMIT_GATE_TOKEN env var not set in this commit invocation."
fi

# 4. Env var token must match the lock file's contents.
expected_token=$(cat "$GATE_LOCK_FILE")
if [[ "$AS_COMMIT_GATE_TOKEN" != "$expected_token" ]]; then
    deny "token_mismatch" "AS_COMMIT_GATE_TOKEN does not match lock file contents."
fi

# Pass — consume the lock file (single-use; idempotent re-runs would deny).
rm -f "$GATE_LOCK_FILE"
exit 0
