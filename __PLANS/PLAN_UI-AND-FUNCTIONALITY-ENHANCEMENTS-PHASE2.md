# UI & Functionality Enhancements — Phase 2

**Date**: 2026-02-18
**Status**: APPROVED — Ready for Auto Run Document Creation
**Author**: maestro-planner (Claude Opus 4.6)
**Last Updated**: 2026-02-18 (incorporated user feedback)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Feature-by-Feature Analysis](#2-feature-by-feature-analysis)
3. [Feasibility & Risk Assessment](#3-feasibility--risk-assessment)
4. [Proposed Phased Auto Run Documents](#4-proposed-phased-auto-run-documents)
5. [Dependencies & Ordering](#5-dependencies--ordering)
6. [Open Questions — Resolved](#6-open-questions--resolved)

---

## 1. Executive Summary

This plan covers 12 feature enhancement requests spanning model selection, agent teams, group chat loop safety, Claude version management, and several UI polish items. After thorough investigation of the codebase, Claude Code CLI documentation, and existing infrastructure, I've organized these into **8 phased Auto Run documents** with clear dependencies.

**Key findings:**
- Claude Code supports `--model`, `/model`, effort levels, and fast mode — Maestro just doesn't expose any of it yet
- Agent teams (teammates) is an experimental Claude Code feature requiring `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` — needs formal investigation before UI work
- Group chat has **no turn limit** — the response loop is purely prompt-based, which is the root cause of the "response trap" at agent join time
- Claude Code version detection is trivial (`claude --version`) and update is just `claude update` or `npm install -g @anthropic-ai/claude-code`
- Several quick wins (icon consistency, subagent scroll, model display) can be batched

---

## 2. Feature-by-Feature Analysis

### 2.1 Model Selection in Agent Settings (HIGH)

**Request**: Add 'Execution Model' section in Edit Agent modal for Claude Code.

**Design decision**: Keep Execution Model SEPARATE from Pricing Model. More flexibility — user may want to run a cheaper model but track costs against a different pricing tier, or vice versa.

**Current state**: `supportsModelSelection: false` for `claude-code` in `capabilities.ts:131`. No `modelArgs` defined in `definitions.ts:124-138`. No `--model` flag is ever passed. Model is determined by the user's Anthropic account defaults.

**What Claude Code supports**:
- `--model <alias|full-name>` CLI flag at startup
- Aliases: `opus`, `sonnet`, `haiku`, `opusplan`, `sonnet[1m]`
- Full names: `claude-opus-4-6`, `claude-sonnet-4-6`, etc.
- `/model <name>` slash command mid-session (interactive mode only — NOT usable in `--print` batch mode)
- Env var: `ANTHROPIC_MODEL=<model-id>` (lower priority than `--model`)

**Model discovery**: We cannot dynamically discover available models in batch mode. The `/model` command lists them in interactive mode but that's not capturable. However, `detectedModel` (from `claude-output-parser.ts`) tells us what model IS SET after the first response — we should surface this in the UI. For the selector, hardcode the known aliases.

**Implementation approach**:
1. Add `modelArgs` to Claude Code definition: `modelArgs: (modelId) => ['--model', modelId]`
2. Set `supportsModelSelection: true` in capabilities
3. Hardcode known model aliases for the picker: `opus`, `sonnet`, `haiku`, `opusplan`, `sonnet[1m]`
4. The Edit Agent modal already has model selection UI via `AgentConfigPanel` — it will appear automatically once `supportsModelSelection: true`
5. Session-level `customModel` field already exists and is plumbed through `process:spawn` → `buildAgentArgs()`
6. Surface `detectedModel` from output parser to confirm what model is actually running

**SSH remote**: `--model` is a CLI flag, so it works identically over SSH. No special handling needed.

**Files to modify**: `definitions.ts` (add `modelArgs`), `capabilities.ts` (flip flag), potentially `detector.ts` (model list)

**Risk**: Low. All plumbing exists — just gated behind `supportsModelSelection: false`.

---

### 2.2 Effort Level Control (HIGH)

**Request**: Add ability to flip high/medium/low effort on Opus/Sonnet 4.6 to save tokens.

**What Claude Code supports**:
- Env var: `CLAUDE_CODE_EFFORT_LEVEL=low|medium|high`
- Settings file: `"effortLevel": "low|medium|high"`
- Applies to **both Opus 4.6 and Sonnet 4.6** (not just Opus)

**Scope**: Two levels of granularity:
- **Agent-level** (minimum): persists in agent config, applied every session. 1 Agent = 1 model = 1 VM.
- **Per-prompt** (desired): toggle in InputArea, like LLM chat providers do. Changes effort mid-session.

**Implementation approach**:
1. Add `effortLevel` field to `AgentPricingConfig` or a new `AgentExecutionConfig` type
2. Pass as env var when spawning: `{ CLAUDE_CODE_EFFORT_LEVEL: effortLevel }` via `sessionCustomEnvVars`
3. UI: Add effort level selector in Edit Agent modal (dropdown: High/Medium/Low), shown for Opus 4.6 AND Sonnet 4.6
4. Per-prompt effort: Phase H — dropdown/toggle in `InputArea.tsx` that updates the env var before each prompt

**Files to modify**: Agent config types, `NewInstanceModal.tsx` (Edit Agent section), `envBuilder.ts` or session env vars

**Risk**: Low. Env var is the simplest integration path.

---

### 2.3 Model/Effort Display in Input Area (MED)

**Request**: Always show current model/effort level being used by Main Agent above text area.

**Current state**: `InputArea.tsx` placeholder shows `"Talking to ${session.name} powered by ${getProviderDisplayName(session.toolType)}"` — shows "Claude Code", not the specific model. `detectedModel` is available on `activeTab.usageStats?.detectedModel` after the first AI response.

**Implementation approach**:
1. Add a compact info bar between the `ThinkingStatusPill` and the textarea
2. Display: `Model: claude-opus-4-6 | Effort: High`
3. Data sources: `session.customModel` (configured), `activeTab.usageStats?.detectedModel` (runtime-detected), effort from session env vars
4. Could be clickable to open model picker (stretch goal)

**Files to modify**: `InputArea.tsx` (new status line component)

**Risk**: Low. Pure UI addition, data already available.

---

### 2.4 1M Context Model & Subagent Model Env Vars (LOW)

**Request**: Set 1M context model through local/SSH.

**What Claude Code supports**: `--model sonnet[1m]` — the `[1m]` suffix selects the 1M context window variant.

**Implementation**: Falls out naturally from 2.1 (model selection). Once `--model` is supported, users can select `sonnet[1m]` from the model picker.

**Subagent model env vars**: `ANTHROPIC_DEFAULT_HAIKU_MODEL` and `ANTHROPIC_DEFAULT_SONNET_MODEL` exist and can be used to control which models Claude Code uses for its internal subagents. These should be exposed in Agent Settings as optional advanced config.

**Risk**: None beyond 2.1.

---

### 2.5 Fast Mode Pricing Support (LOW — DEFERRED)

**Request**: Explore building support for Claude Fast Mode pricing.

**Status**: Reassigned to LOW priority. May be API-only feature. User hasn't used it yet.

**Gating rule**: Fast Mode should NOT be selectable if billing mode is Pro or Max (auto-detected). It's only relevant for API/cloud billing.

**What Fast Mode is**:
- Toggled via `/fast` slash command or `"fastMode": true` in settings
- Uses same Opus 4.6 model, but optimized for speed (~2.5x faster)
- **Different pricing**: $30/MTok input, $150/MTok output (vs standard Opus $15/MTok input, $75/MTok output)
- Billed as extra usage, NOT included in subscription rate limits

**Deferred**: Will revisit after user has tried fast mode in the CLI and confirmed it works with their setup.

**Risk**: Medium. Pricing accuracy depends on reliable fast mode detection.

---

### 2.6 Claude Version Detection & Update (HIGH)

**Request**: Auto-detect Claude version, one-click update across all agents instead of opening 8 terminals.

**Current state**: Zero version detection. `AgentDetector` only probes for binary existence.

**Simplified approach** (per user feedback):
- Don't need to find "latest version" ourselves — Claude CLI handles that internally
- Just run the update commands; Claude will report if it's already up to date or update itself
- The maestro user is in sudoers on all VMs, so `sudo` is fine over SSH

**Implementation approach**:
1. Add `checkVersion()` to `AgentDetector` — runs `claude --version`, parses version string
2. Store version in agent config or detector cache
3. Display version in Edit Agent modal: "Claude Code v1.0.33"
4. "Update" button that runs `claude update` (local) or `ssh host "sudo claude update"` (remote)
5. Alternatively/additionally: `npm install -g @anthropic-ai/claude-code` (Claude will sort out versioning)
6. Show update output in a modal or status area so user can see progress
7. "Update All" button to run update across all detected agents (the real value — one click instead of 8 terminals)

**Files to modify**: `detector.ts`, `definitions.ts` (add `versionCommand`), `NewInstanceModal.tsx` (version display + update button), new IPC handler for update

**Risk**: Low. No version comparison needed — just run the update command and show output.

---

### 2.7 Group Chat Response Trap Fix (HIGH)

**Request**: Fix agents endlessly replying to each other when they join the group chat.

**Clarification**: The problem is NOT in synthesis — it's specifically when agents are joining. All agents continuously respond to each other without the user saying STOP multiple times.

**Root cause**: `group-chat-router.ts` has **zero turn limits**. The loop only stops when the moderator produces output with no `@mentions` — purely LLM-dependent.

**Implementation approach (revised per user feedback)**:

**Round limit logic**:
- Default `maxRounds = 0` — meaning NO autonomous rounds until the user prompts
- After user prompts, allow `n - 1` rounds where `n` = number of participants
- This ensures each participant gets to respond once, then stops for user input
- User-configurable override in Group Chat settings

**Layer 1 — Hard turn limit** (critical safety net):
- Add `maxRounds` config to group chat settings
- Track `currentRound` counter in the router
- When `currentRound >= maxRounds`, force synthesis with instruction "produce final answer now, do not @mention any agents"
- Display warning in UI: "Round limit reached — synthesizing final response"
- Reset counter when user sends a new message

**Layer 2 — Smarter moderator prompts**:
- Modify `group-chat-moderator-synthesis.md` to include: "If agents are repeating themselves or no new information is being added, synthesize and respond to the user immediately"
- Add a "rounds so far" count to the synthesis context so the moderator has self-awareness

**Files to modify**: `group-chat-router.ts` (turn counter + limit), `group-chat-moderator-synthesis.md` (smarter prompts), `GroupChatContext.tsx` (expose `maxRounds` setting)

**Risk**: Low for Layer 1 (pure safety net).

---

### 2.8 Local GPU Usage Monitoring (LOW)

**Request**: Show local model GPU usage (like iStat Menus).

**Scope**: Apple Silicon only for now. Local Ollama models only (not Claude Code — that's cloud API). Defer cross-platform support.

**Implementation approach**:
1. New IPC handler: `system:getGpuUsage` — uses Apple Silicon-specific commands (e.g., `powermetrics` or `ioreg` for GPU utilization, `sysctl` for memory)
2. Poll every 2-5 seconds when a local model session is active
3. Display in `ProcessMonitor.tsx` (already shows CPU/memory) or a new GPU section

**Files to modify**: New handler in `system.ts`, `ProcessMonitor.tsx`

**Risk**: Low for Apple Silicon. `powermetrics` may require sudo — investigate alternatives.

---

### 2.9 Subagent View Scrolling Fix (LOW)

**Request**: Subagent views in Agent Sessions log are not scrollable once clicked into.

**Root cause**: `AgentSessionsBrowser.tsx` line 1121 uses `overflow: auto` with no scrollbar styling, while the session list (line 1755) uses `scrollbar-thin` Tailwind class. The subagent detail view may also have a height constraint issue.

**Implementation**: Add `scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/20` classes to the subagent detail view container. Ensure `flex: 1` and parent height constraints allow scrolling.

**Files to modify**: `AgentSessionsBrowser.tsx` (1 line change)

**Risk**: None. Pure CSS fix.

---

### 2.10 Agent Group Icons Consistency (LOW)

**Request**: Pull agent group icons for all agent lists.

**Current state**: 3+ separate icon systems exist:
- `constants/agentIcons.ts` — centralized emoji map (used by `SendToAgentModal`)
- `hooks/agent/useAvailableAgents.ts` — duplicate switch statement
- `modals/ProjectFolderSettingsModal.tsx` line 286 — hardcodes `🤖` for ALL agents (bug)
- `SubagentListItem.tsx` — uses Lucide React SVG icons

**Implementation**: Consolidate to use `agentIcons.ts` everywhere. Fix the `ProjectFolderSettingsModal` bug. Replace the `useAvailableAgents` switch with an import from the constants.

**Files to modify**: `useAvailableAgents.ts`, `ProjectFolderSettingsModal.tsx`, potentially `SessionListItem.tsx`

**Risk**: None. Straightforward consolidation.

---

### 2.11 Claude Code Teammates Support (HIGH — INVESTIGATION FIRST)

**Request**: Explore building UI for Claude Code agent teams.

**What it is**: Experimental feature (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`). One session becomes "team lead", spawns independent Claude Code instances ("teammates") that share a task list and can message each other.

**Revised phasing** (per user feedback):

**Phase 0 — UI Labeling** (can do now):
- In the Agent Session log view, differentiate between subagents and team agents
- Add visual distinction (different icon, label, or badge) so the user can tell which is which
- This is purely a display enhancement to the existing `AgentSessionsBrowser.tsx`

**Phases 1-4 — Need Investigation First**:
The following require a formal investigation Auto Run to determine feasibility:
1. **Enable**: Can we reliably enable teammates via env var and `--teammate-mode in-process`?
2. **Detect**: What do teammate events look like in `stream-json` output? Are they distinguishable from subagent events?
3. **UI**: Can we show teammate status, task list, inbox?
4. **Orchestration**: Can we configure team size, assign tasks from Maestro?

**Action**: Create a formal investigation Auto Run document (INVESTIGATE-TEAMMATES-01) to run an actual teammates session, capture raw output, and document findings before any implementation work.

**Risk**: HIGH. Experimental, undocumented output format.

---

### 2.12 Support for `/debug` Slash Command (HIGH)

**Request**: Explore support for using /debug in Claude.

**What `/debug` does**: Reads the current session's debug log and troubleshoots session issues. Different from `--debug` CLI flag (verbose logging).

**Current state**: Maestro already discovers slash commands from Claude Code via `discoverSlashCommands()`. If `/debug` is in the discovered commands list, it should already appear in the slash command autocomplete.

**Implementation approach**:
1. **Verify discovery**: Check if `/debug` appears in the discovered slash commands
2. **Test passthrough**: Send `/debug` as a user message and see if the response comes back correctly through the parser
3. **If it works**: No code changes needed — just verify and document
4. **If it doesn't**: May need to handle `/debug` output as a special case in the parser, or run it via a separate interactive session

**Files to modify**: Potentially none if it already works, or `claude-output-parser.ts` if output format is non-standard

**Risk**: Low. This is primarily a verification task.

---

## 3. Feasibility & Risk Assessment

| # | Feature | Feasibility | Risk | Effort | Priority |
|---|---------|------------|------|--------|----------|
| 2.1 | Model Selection | High — all plumbing exists | Low | Small | HIGH |
| 2.2 | Effort Level | High — env var approach | Low | Small | HIGH |
| 2.3 | Model/Effort Display | High — data available | Low | Small | MED |
| 2.4 | 1M Context + Subagent Env Vars | High — falls out of 2.1 | None | Small | LOW |
| 2.5 | Fast Mode Pricing | Medium — detection uncertain | Medium | Medium | **LOW (deferred)** |
| 2.6 | Version Detection/Update | High — simplified approach | Low | Medium | HIGH |
| 2.7 | Group Chat Loop Fix | High — Layer 1 is simple | Low | Small-Med | HIGH |
| 2.8 | GPU Usage (Apple Silicon) | Medium — Apple-specific APIs | Low | Medium | LOW |
| 2.9 | Subagent Scroll Fix | High — CSS only | None | Tiny | LOW |
| 2.10 | Icon Consistency | High — consolidation | None | Small | LOW |
| 2.11 | Teammates Support | Low-Med — experimental | HIGH | Investigation | HIGH (investigate) |
| 2.12 | `/debug` Support | High — may already work | Low | Small | HIGH |

---

## 4. Proposed Phased Auto Run Documents

### Phase A: Model Selection & Effort (2.1 + 2.2 + 2.3 + 2.4)
**Auto Run: `ENHANCE-MODEL-01-SELECTION-AND-EFFORT`**
**Priority**: HIGH | **Effort**: Medium | **Dependencies**: None

Tasks:
1. Add `modelArgs` to Claude Code definition in `definitions.ts`
2. Set `supportsModelSelection: true` in `capabilities.ts`
3. Hardcode known model aliases for the picker: `opus`, `sonnet`, `haiku`, `opusplan`, `sonnet[1m]`
4. Add effort level dropdown to Edit Agent modal (shown for **both** Opus 4.6 and Sonnet 4.6)
5. Pass `CLAUDE_CODE_EFFORT_LEVEL` env var when spawning
6. Add model/effort status line in `InputArea.tsx` (shows `detectedModel` + configured effort)
7. Surface `detectedModel` from output parser in the status line
8. Add `ANTHROPIC_DEFAULT_HAIKU_MODEL` and `ANTHROPIC_DEFAULT_SONNET_MODEL` as optional advanced env var config in Agent Settings (2.4)
9. TypeScript verification

### Phase B: Group Chat Safety (2.7)
**Auto Run: `ENHANCE-GROUPCHAT-01-TURN-LIMIT`**
**Priority**: HIGH | **Effort**: Medium | **Dependencies**: None

Tasks:
1. Add `maxRounds` config to group chat settings (default: `0` — no autonomous rounds until user prompts)
2. Implement round tracking in `routeModeratorResponse()` / synthesis loop
3. After user prompt, set allowed rounds to `n - 1` where `n` = number of participants
4. When round limit reached, force final synthesis with modified prompt: "produce final answer now, do not @mention agents"
5. Reset round counter when user sends a new message
6. Add round counter display to `GroupChatMessages` UI
7. Update `group-chat-moderator-synthesis.md` with self-awareness instructions
8. Add `maxRounds` override setting to Group Chat settings UI
9. TypeScript verification

### Phase C: Claude Version Management (2.6)
**Auto Run: `ENHANCE-VERSION-01-DETECTION-AND-UPDATE`**
**Priority**: HIGH | **Effort**: Medium | **Dependencies**: None

Tasks:
1. Add `checkVersion()` to `AgentDetector` — runs `claude --version`, parses version string
2. Add `versionCommand` to agent definitions
3. Add `agents:getVersion` and `agents:update` IPC handlers
4. Display version in Edit Agent modal header: "Claude Code v1.0.33"
5. Add "Update" button — runs `claude update` (local) or `ssh host "sudo claude update"` (remote)
6. Show update output in modal/status area
7. Add "Update All" button to update all detected agents in one click
8. TypeScript verification

### Phase D: `/debug` Support (2.12)
**Auto Run: `ENHANCE-DEBUG-01-VERIFY-AND-ENABLE`**
**Priority**: HIGH | **Effort**: Small | **Dependencies**: Phase A (model selection should be in place first for context)

Tasks:
1. Verify `/debug` appears in discovered slash commands
2. Test sending `/debug` as user message — check output parsing
3. If output fails to parse: add special-case handling in `claude-output-parser.ts`
4. If it works: document in codebase, no code changes needed
5. TypeScript verification (if changes made)

### Phase E: Fast Mode Pricing (2.5) — DEFERRED
**Auto Run: `ENHANCE-FASTMODE-01-PRICING-SUPPORT`**
**Priority**: LOW (deferred) | **Effort**: Medium-Large | **Dependencies**: Phase A + user testing fast mode in CLI

**Gating**: Cannot select fast mode if billing mode is Pro or Max (auto-detected). API/cloud billing only.

Tasks (when revisited):
1. Add `fastMode` boolean to agent execution config
2. Gate toggle: only shown when billing mode is `api`
3. Add fast mode pricing multiplier (2x) to `claude-pricing.ts`
4. Update cost calculation chain
5. Display fast mode indicator in `InputArea.tsx` status line
6. TypeScript verification

### Phase F: Teammates Investigation (2.11)
**Auto Run: `INVESTIGATE-TEAMMATES-01-STREAM-FORMAT`**
**Priority**: HIGH (investigation only) | **Effort**: Medium | **Dependencies**: Phase A

Tasks:
1. Enable teammates: set env var `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, add `--teammate-mode in-process`
2. Run an actual teammates session and capture raw `stream-json` output
3. Document the teammate event format (event types, fields, lifecycle)
4. Determine: are teammate events distinguishable from subagent events?
5. Determine: can we detect team size, task assignments, inbox messages?
6. Write findings to `__PLANS/INVESTIGATION-TEAMMATES-FINDINGS.md`
7. Phase 0 (if feasible): Add subagent vs team agent labeling to Agent Session log view

### Phase G: Quick Wins (2.8, 2.9, 2.10)
**Auto Run: `ENHANCE-POLISH-01-ICONS-SCROLL-GPU`**
**Priority**: LOW | **Effort**: Small | **Dependencies**: None

Tasks:
1. Fix subagent view scrolling in `AgentSessionsBrowser.tsx` (add `scrollbar-thin` classes)
2. Consolidate agent icons — import from `constants/agentIcons.ts` everywhere
3. Fix `ProjectFolderSettingsModal.tsx` hardcoded `🤖` bug
4. (Optional) Add GPU usage to `ProcessMonitor.tsx` for Apple Silicon / local Ollama models only
5. TypeScript verification

### Phase H: Per-Prompt Effort Selector (2.2 extension)
**Auto Run: `ENHANCE-MODEL-02-PER-PROMPT-EFFORT`**
**Priority**: MED | **Effort**: Medium | **Dependencies**: Phase A

Tasks:
1. Add effort level toggle/dropdown to `InputArea.tsx` (similar to LLM chat provider UIs)
2. Before each prompt send, set `CLAUDE_CODE_EFFORT_LEVEL` env var on the process
3. Visual indicator showing current per-prompt effort level
4. Default to agent-level setting; per-prompt overrides it for that prompt only
5. TypeScript verification

---

## 5. Dependencies & Ordering

```
Phase G (Quick Wins)     ─── no deps ──→ can start immediately
Phase B (Group Chat)     ─── no deps ──→ can start immediately
Phase C (Version Mgmt)   ─── no deps ──→ can start immediately
Phase A (Model/Effort)   ─── no deps ──→ can start immediately
                              │
                              ├──→ Phase D (/debug)
                              ├──→ Phase F (Teammates Investigation)
                              └──→ Phase H (Per-Prompt Effort)

Phase E (Fast Mode)      ─── deferred ──→ revisit after user tests CLI
```

**Recommended execution order**:
1. **Phase A** (Model Selection + Effort) — unlocks the most downstream work
2. **Phase B** (Group Chat Safety) — critical safety fix, independent
3. **Phase G** (Quick Wins) — easy wins, independent
4. **Phase C** (Version Management) — independent, high value (one-click update all)
5. **Phase D** (/debug) — quick verification after Phase A
6. **Phase F** (Teammates Investigation) — exploration, depends on A
7. **Phase H** (Per-Prompt Effort) — builds on A, desired feature
8. **Phase E** (Fast Mode) — deferred until user tests in CLI

---

## 6. Open Questions — Resolved

1. **Model discovery for Claude Code**: Hardcode known aliases (`opus`, `sonnet`, `haiku`, `opusplan`, `sonnet[1m]`). Cannot discover dynamically in batch mode. Use `detectedModel` from output parser to confirm what model is actually running.

2. **Fast mode detection**: May be API-only feature. User hasn't tried it yet. Deferred to LOW priority. Will revisit after user tests in CLI.

3. **Teammates output format**: Formal investigation step (Phase F) will run an actual teammates session and capture raw `stream-json` output to reverse-engineer the format.

4. **Claude update permissions**: Resolved — maestro user is in sudoers on all VMs. `sudo claude update` over SSH will work without password prompts.

5. **Group chat maxRounds default**: Start at `0` (no autonomous rounds until user prompts). After user prompt, allow `n - 1` rounds where `n` = number of participants. User-configurable override available.

6. **Effort level scope**: Agent-level minimum (1 agent = 1 model = 1 VM). Per-prompt toggle also desired — implemented as Phase H with dropdown in InputArea similar to LLM chat providers.
