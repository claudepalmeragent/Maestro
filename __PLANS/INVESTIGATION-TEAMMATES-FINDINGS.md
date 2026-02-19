---
type: research
title: Claude Code Teammates — Investigation Findings
created: 2026-02-18
tags:
  - claude-code
  - teammates
  - investigation
  - subagents
related:
  - "[[PLAN_UI-AND-FUNCTIONALITY-ENHANCEMENTS-PHASE2]]"
---

# Claude Code Teammates — Investigation Findings

**Date**: 2026-02-18
**Status**: Investigation Complete
**Investigator**: Agent (maestro-planner)

---

## 1. Current Subagent Event Format

### How Subagents Are Detected
Subagents are detected in the stream-json output via **tool_use blocks** with `name === 'Task'` inside `type: 'assistant'` messages.

### Parser: `claude-output-parser.ts`
The `ClaudeOutputParser` class handles these message types:
- `system` (subtype `init`): Session initialization with `session_id`, `slash_commands`
- `assistant`: Streaming text content with `message.content` (text, thinking, tool_use blocks)
- `result`: Final response with `result` text, `modelUsage`, `usage`, `total_cost_usd`
- `usage`: Token usage statistics only
- `error` / `turn.failed`: Error events

### Subagent Detection: `detectTaskToolInvocation()`
Extracts from `tool_use` blocks where `name === 'Task'`:
- `subagentType`: from `input.subagent_type` (e.g., 'Explore', 'Plan', 'general-purpose', 'Bash')
- `taskDescription`: from `input.prompt` (truncated to 100 chars for display)
- `toolId`: from `taskBlock.id`

### SubagentInfo Interface (session-storage.ts:91)
Stored subagent metadata includes:
- `agentId`: Extracted from filename `agent-{agentId}.jsonl`
- `agentType`: Type string ('Explore', 'Plan', 'general-purpose', etc.)
- `parentSessionId`: Parent session ID
- `filePath`: Full path to transcript file
- `timestamp`, `modifiedAt`: Timing info
- `messageCount`, `sizeBytes`: Size stats
- Token/cost fields: `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheCreationTokens`, `costUsd`

### Key Observation
There is **no teammate-specific handling** anywhere in the parser or session storage. All child agents are treated uniformly as "subagents."

---

## 2. Teammate References in Codebase

### Source Code Search Results
| Search Term | `/app/Maestro/src/` | Result |
|---|---|---|
| `teammate` | 0 matches | Not implemented |
| `AGENT_TEAMS` | 0 matches | Not implemented |
| `team-lead` | 0 matches | Not implemented |
| `team_lead` | 0 matches | Not implemented |

### Planning Documents
- **`__PLANS/PLAN_UI-AND-FUNCTIONALITY-ENHANCEMENTS-PHASE2.md`** (section 2.11):
  - Describes teammates as experimental: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
  - Proposes `--teammate-mode in-process` CLI flag
  - Outlines Phase 0 (labeling) through Phase 4 (orchestration)
  - Tags as HIGH risk, experimental, undocumented output format

### Conclusion
**Zero implementation exists.** All teammate knowledge is in planning documents only.

---

## 3. CLI Arguments & Environment Variables

### Claude Code CLI Status
- **Installed**: Yes, at `/usr/local/bin/claude`
- **Cannot run nested**: Detects `CLAUDECODE` env var and refuses to start

### Help Text Analysis (`claude --help`)
| Expected Flag | Present in Help? | Notes |
|---|---|---|
| `--teammate-mode` | **NO** | Not listed |
| `--team-lead` | **NO** | Not listed |
| `--agent-teams` | **NO** | Not listed |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | **NO** | Not in help text |

### Potentially Related Flags
- `--agent <agent>`: Selects agent mode (e.g., 'plan'), NOT teammates
- `--agents <json>`: Defines **custom agents** via JSON. This is a different feature from "teammates" but may be the successor/replacement

### Interpretation
The teammates feature as described in the plan document (`--teammate-mode`, env var) does **not appear in current CLI help output**. This could mean:
1. The feature was removed or deprecated
2. It's hidden until `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set
3. It was renamed/absorbed into the `--agents` custom agents feature

Without running a live session with the env var set, we cannot determine which scenario is correct.

---

## 4. Differentiation: Subagent vs Teammate

### Can We Tell Them Apart?
**Not currently.** There are no distinguishing fields:
- `SubagentInfo.agentType` contains values like 'Explore', 'Plan', 'general-purpose' — no 'teammate' type exists
- The stream-json parser has no teammate event types
- Session storage has no teammate flag

### What Would We Need?
To differentiate, we would need one of:
1. A new `type` field in stream-json events (e.g., `type: 'teammate'` or a `teammate: true` flag)
2. A naming convention in transcript files (e.g., `teammate-{id}.jsonl` vs `agent-{id}.jsonl`)
3. An env var or CLI flag on the parent session that we could use heuristically

### Phase 0 Approach
Since we cannot detect teammates, Phase 0 will add a **"Sub" badge** to all subagent items as a placeholder. This provides the UI infrastructure that can later be updated when teammate detection data becomes available.

---

## 5. Feasibility Assessment

### Phase 0: UI Labeling — **FEASIBLE NOW** ✅
- Add "Sub" badge to `SubagentListItem` component
- Infrastructure for future "Team" badge
- No teammate data needed

### Phase 1: Enable Teammates — **BLOCKED** ❌
- `--teammate-mode` CLI flag doesn't exist in current help
- Need to test with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in a live (non-nested) session
- Cannot verify from within this environment

### Phase 2: Detect Teammate Events — **BLOCKED** ❌
- No live data to analyze
- Parser would need new event type handlers
- Depends on Phase 1

### Phase 3: Teammate UI — **BLOCKED** ❌
- Depends on Phases 1 & 2

### Phase 4: Orchestration — **BLOCKED** ❌
- Depends on all previous phases

---

## 6. Recommendations

### Immediate Actions
1. **Implement Phase 0** — Add "Sub" badge to subagent list items (done in this investigation)
2. **Manual test needed** — Run Claude Code with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` outside of Maestro to see:
   - Whether `--teammate-mode` becomes available
   - What teammate events look like in `stream-json`
   - How teammate transcript files are stored

### Investigation Follow-up
- The `--agents <json>` flag for custom agents may be worth investigating separately — it could provide multi-agent orchestration without the experimental teammates feature
- Consider whether the `--agents` feature + existing subagent infrastructure could achieve similar goals to the teammates vision

### Risk Assessment
**The teammates feature appears unstable or deprecated.** The plan document (written earlier) references CLI flags that no longer appear in help output. Phases 1-4 should be deferred until a live session confirms the feature still exists and its output format is documented.
