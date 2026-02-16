# Investigation: Claude.ai Global Token Usage Statistics

**Created:** 2026-02-14
**Updated:** 2026-02-15 (Added Section 13: Honeycomb Audit of Calculated Fields & Board Queries)
**Author:** maestro-planner (claude cloud)
**Status:** Investigation Complete - Revised Approach via Honeycomb - Ready for Planning Review
**Priority:** High (Foundation for Auto Run and Parallel Agent efficiency)

---

## Executive Summary

This investigation analyzes the feasibility of implementing real-time Claude.ai global token usage statistics in Maestro.

### Revision History

| Date | Change |
|------|--------|
| 2026-02-14 (AM) | Initial investigation: proposed `claude /usage` CLI approach |
| 2026-02-14 (PM) | **BLOCKED:** `/usage` is interactive-only, no programmatic CLI access |
| 2026-02-14 (PM) | **PIVOT:** Honeycomb + OTEL telemetry approach adopted |
| 2026-02-15 | **AUDIT:** Full audit of 5 calculated fields + 13 board queries (Section 13) |
| 2026-02-15 | **FINDING:** OTEL flush gap confirmed — idle sessions don't flush (Q#9, Q#11, Section 13.5) |

### Original Approach (BLOCKED)

The original plan was to execute `claude /usage` on remote SSH VMs to get Anthropic's internal utilization percentages. **This is not feasible** because:
- `/usage` is an interactive-only slash command inside Claude Code sessions
- No CLI flag (`-p "/usage"`) can invoke it programmatically
- Anthropic does not expose 5-hour/weekly utilization via any public API
- Known plan tier limits are only approximate (Pro ~44K tokens/window, undocumented exactly)

### New Approach: Honeycomb + OTEL Telemetry

A Honeycomb MCP server and OTEL telemetry pipeline have been set up to send token usage statistics from each VM to Honeycomb. This enables:
1. **Real telemetry data** — actual token consumption per event, session, and model
2. **Calculated fields** already computing cost, burn rate, quota %, and forecast
3. **MCP integration** — Maestro can query Honeycomb directly via the MCP tools
4. **Empirical limit discovery** — observe when rate limiting occurs to determine actual ceilings

**Key Findings:**
1. **Feasible via Honeycomb** — OTEL telemetry pipeline active with token data flowing (verified Feb 14)
2. **5 calculated fields** already built — but audit (Section 13) found 3 of 5 need rework
3. **13-query ROI board** exists — but all queries use 2h default time range (needs 30d+)
4. **$150/month budget** used as ceiling — needs splitting into BURST/WEEKLY/MONTHLY dimensions
5. **MCP tools available** for querying Honeycomb from Maestro
6. **Data is early** — historical backfill from stats DB/JSONL planned; empirical limit discovery pending

---

## Table of Contents

1. [Background & Requirements](#1-background--requirements)
2. [Claude /usage Command Analysis](#2-claude-usage-command-analysis)
3. [Existing Maestro Infrastructure](#3-existing-maestro-infrastructure)
4. [Technical Architecture Options](#4-technical-architecture-options)
5. [UI/UX Design Considerations](#5-uiux-design-considerations)
6. [Implementation Strategy](#6-implementation-strategy)
7. [Risk Assessment](#7-risk-assessment)
8. [Recommendations](#8-recommendations)
9. [Open Questions](#9-open-questions)
10. [Appendix: Reference Materials](#appendix-reference-materials)
13. [Honeycomb Audit: Calculated Fields & Board Queries](#13-honeycomb-audit-calculated-fields--board-queries)

---

## 1. Background & Requirements

### 1.1 Problem Statement

Maestro users running long Auto Run playbooks or parallel agents on Max/Pro Claude plans need visibility into their global token usage to:

- **Avoid hitting rate limits** mid-workflow, which causes failures and wasted context
- **Estimate remaining capacity** before starting expensive tasks
- **Coordinate parallel agents** to stay within weekly/session limits
- **Make informed decisions** about pausing/resuming Auto Run operations

### 1.2 Requirements Summary

| Requirement | Description | Priority |
|-------------|-------------|----------|
| **R1** | Gather token usage by executing `claude /usage` on remote SSH VMs | High |
| **R2** | Parse bars & percentages from the command output | High |
| **R3** | Display 3 usage bars/pills in app title bar area | High |
| **R4** | Cache values locally between fetches | High |
| **R5** | Refresh before every new Auto Run task | Medium |
| **R6** | Refresh before every interactive session query | Medium |
| **R7** | Allow agents to query & estimate before next task | Medium |
| **R8** | Enable agents to run/pause/abort based on limits | Low |

### 1.3 Three Metrics to Display

Based on Claude documentation and the `/usage` command output:

| Metric | Description | Reset Cycle |
|--------|-------------|-------------|
| **Current Session** | 5-hour rolling window usage | Every 5 hours |
| **Weekly Limit** | Total usage across all sessions in the week | Weekly (Monday) |
| **Sonnet Only** | Opus-specific weekly allocation (if applicable) | Weekly |

> **Note:** The "Sonnet Only" bar may actually be "Opus Only" based on Claude's tiered model limits. The `/usage` JSON has a `seven_day_opus` field.

---

## 2. Claude /usage Command Analysis

### 2.1 Command Execution

The `/usage` command is a **slash command** within a Claude Code interactive session, NOT a CLI flag. To execute it programmatically:

```bash
# Option A: Use --print mode with the command as input
echo "/usage" | claude --print --output-format json

# Option B: Execute in a minimal session
claude -p "/usage" --output-format json

# Option C (if available): Direct API endpoint (not confirmed)
```

**Important Discovery:** The `/usage` command is interactive - it requires an active Claude Code session or specific invocation pattern.

### 2.2 Output Format

Based on [community research](https://codelynx.dev/posts/claude-code-usage-limits-statusline), the `/usage` command returns **JSON**:

```json
{
  "five_hour": {
    "utilization": 6.0,
    "resets_at": "2025-11-04T04:59:59.943648+00:00"
  },
  "seven_day": {
    "utilization": 35.0,
    "resets_at": "2025-11-06T03:59:59.943679+00:00"
  },
  "seven_day_oauth_apps": null,
  "seven_day_opus": {
    "utilization": 0.0,
    "resets_at": null
  },
  "iguana_necktie": null
}
```

### 2.3 Field Definitions

| Field | Type | Description |
|-------|------|-------------|
| `five_hour.utilization` | `number` | Percentage (0-100) of 5-hour session limit used |
| `five_hour.resets_at` | `string` (ISO 8601) | When the 5-hour window resets |
| `seven_day.utilization` | `number` | Percentage (0-100) of weekly limit used |
| `seven_day.resets_at` | `string` (ISO 8601) | When the weekly limit resets |
| `seven_day_opus.utilization` | `number` | Percentage of Opus-specific weekly limit |
| `seven_day_opus.resets_at` | `string \| null` | Reset time (null if not applicable) |
| `seven_day_oauth_apps` | `object \| null` | OAuth app usage (usually null) |
| `iguana_necktie` | `any` | Unknown internal field (ignore) |

### 2.4 Execution Considerations

| Consideration | Details |
|---------------|---------|
| **Latency** | ~1-3 seconds for local execution, 3-10 seconds via SSH |
| **Rate Limiting** | Unknown if `/usage` itself is rate-limited |
| **Authentication** | Requires Claude Code to be authenticated on the target machine |
| **SSH Context** | Command must run in user's shell context with proper PATH |
| **Error States** | Not authenticated, network errors, parse failures |

---

## 3. Existing Maestro Infrastructure

### 3.1 SSH Remote Execution

**Files:**
- `src/main/ssh-remote-manager.ts` - SSH configuration management
- `src/main/process-manager/runners/SshCommandRunner.ts` - Remote command execution
- `src/main/process-manager/ProcessManager.ts` - Process orchestration

**Key Patterns:**
```typescript
// SshCommandRunner wraps commands in SSH for remote execution
// Uses ControlMaster for connection pooling (5-minute persistence)
// Handles stdout/stderr streaming with event emitters

// Command execution flow:
ProcessManager.runCommand()
  → SshCommandRunner.run()
  → child_process.spawn('ssh', [...args, 'command'])
  → Event: 'data' | 'stderr' | 'command-exit'
```

**SSH Options Applied:**
- `BatchMode=yes` - No interactive prompts
- `ControlMaster=auto` - Connection reuse
- `ControlPersist=300` - 5-minute connection keep-alive
- `RequestTTY=no` - No TTY allocation

### 3.2 Usage Stats Infrastructure

**Files:**
- `src/main/parsers/usage-aggregator.ts` - Token aggregation
- `src/main/parsers/claude-output-parser.ts` - Stream JSON parsing
- `src/main/ipc/handlers/stats.ts` - Stats IPC handlers
- `src/main/stats-db.ts` - SQLite storage (56KB)

**Existing `UsageStats` Interface:**
```typescript
interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  totalCostUsd: number;
  contextWindow: number;
  reasoningTokens?: number;
  detectedModel?: string;
  anthropicMessageId?: string;
}
```

**Note:** This interface tracks per-session/per-query stats, NOT global account limits. New interface needed.

### 3.3 Caching Infrastructure

**Files:**
- `src/main/utils/statsCache.ts` - Global stats caching
- `src/main/stores/` - electron-store persistence

**Cache Patterns:**
- TTL-based invalidation (configurable)
- mtime-based incremental updates
- Streaming progress updates to renderer

### 3.4 UI Components for Status Pills

**Files:**
- `src/renderer/components/ThinkingStatusPill.tsx` - Pulsing status indicator (759 lines)
- `src/renderer/components/SessionList.tsx` - Contains trophy/badge indicator
- `src/renderer/components/InputArea.tsx` - Where ThinkingStatusPill is rendered

**ThinkingStatusPill Features:**
- Pulsing animation during activity
- Progress bars for Auto Run tasks
- Click-to-expand details
- Memoized for performance

### 3.5 IPC Patterns

**Files:**
- `src/main/ipc/handlers/process.ts` - `process:runCommand` handler
- `src/main/preload/` - Secure bridge to renderer

**Existing Pattern:**
```typescript
// IPC handler registration
ipcMain.handle('process:runCommand', async (_, config) => {
  return processManager.runCommand(sessionId, command, cwd, shell, envVars, sshConfig);
});

// Renderer invocation
const result = await window.maestro.process.runCommand({ ... });
```

---

## 4. Technical Architecture Options

### 4.1 Option A: Polling-Based (Recommended)

**Architecture:**
```
┌──────────────────┐      poll interval      ┌─────────────────────┐
│  Renderer        │ ──────────────────────► │  Main Process       │
│  (GlobalUsage    │                          │  (UsageService)     │
│   Pills)         │ ◄────────────────────── │                     │
│                  │      IPC: usage-update   │                     │
└──────────────────┘                          └──────────┬──────────┘
                                                          │
                                                          │ SSH or Local
                                                          ▼
                                              ┌─────────────────────┐
                                              │  claude /usage      │
                                              │  (Remote VM or      │
                                              │   Local Machine)    │
                                              └─────────────────────┘
```

**Flow:**
1. Main process runs a background service polling at configurable intervals
2. Executes `claude /usage` via SSH or locally
3. Parses JSON response, updates cache
4. Broadcasts to all renderer windows via IPC event
5. Renderer updates pills with animation

**Pros:**
- Simple to implement
- Consistent refresh without user interaction
- Works well for background monitoring

**Cons:**
- May poll unnecessarily when user is idle
- SSH connection overhead per poll

### 4.2 Option B: Event-Driven Refresh

**Architecture:**
- Refresh triggered by specific events:
  - Before Auto Run task starts
  - Before interactive query sent
  - Manual refresh button click
  - Window focus (first time after 5+ minutes)

**Pros:**
- Efficient - only fetches when needed
- Ties directly to user actions
- Lower SSH overhead

**Cons:**
- May miss limit changes during long sessions
- Slightly stale data between actions

### 4.3 Option C: Hybrid (Recommended)

**Combine Options A + B:**
- Base polling interval: 5 minutes (configurable)
- Event-triggered refresh before Auto Run tasks
- Manual refresh button in UI
- Pause polling when app is minimized/unfocused

**This is the recommended approach.**

### 4.4 Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              GLOBAL USAGE DATA FLOW                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌────────────────┐                                                              │
│  │  SSH Remote    │                                                              │
│  │  (Primary)     │ ◄─────────────────────────────────────────────────┐          │
│  └───────┬────────┘                                                   │          │
│          │                                                            │          │
│          │ ssh user@host "echo '/usage' | claude --print"             │          │
│          │                                                            │          │
│          ▼                                                            │          │
│  ┌────────────────┐     JSON output      ┌─────────────────┐          │          │
│  │  Claude CLI    │ ──────────────────► │  Parser         │          │          │
│  │  /usage cmd    │                      │  (New module)   │          │          │
│  └────────────────┘                      └───────┬─────────┘          │          │
│                                                  │                    │          │
│                                                  ▼                    │          │
│                                         ┌─────────────────┐           │          │
│                                         │  Cache          │           │          │
│                                         │  (electron-     │           │          │
│                                         │   store + TTL)  │           │          │
│                                         └───────┬─────────┘           │          │
│                                                 │                     │          │
│      IPC: global-usage:refresh ────────────────►│                     │          │
│                                                 │                     │          │
│      IPC: global-usage:update ◄─────────────────┘                     │          │
│                                                                       │          │
│          │                                                            │          │
│          ▼                                                            │          │
│  ┌────────────────┐                                                   │          │
│  │  Renderer      │                                                   │          │
│  │  GlobalUsage   │   ┌───────────────────────────────────────────┐   │          │
│  │  Pills (x3)    │ ► │  Session: ████████░░░░ 65% (resets 2:34) │   │          │
│  │                │   │  Weekly:  ██████░░░░░░ 42% (resets 3d)   │   │          │
│  │                │   │  Opus:    ██░░░░░░░░░░ 12% (resets 3d)   │   │          │
│  └───────┬────────┘   └───────────────────────────────────────────┘   │          │
│          │                                                            │          │
│          │  onClick (manual refresh)                                  │          │
│          └────────────────────────────────────────────────────────────┘          │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. UI/UX Design Considerations

### 5.1 Placement Options

| Location | Pros | Cons |
|----------|------|------|
| **A. Top Title Bar** | Always visible, OS-native feel | Limited space, conflicts with traffic lights (macOS) |
| **B. Tab Bar (Right Side)** | Consistent with existing UI, near actions | May compete with tab controls |
| **C. SessionList Header** | Near trophy badge, logical grouping | May be hidden if panel collapsed |
| **D. Status Bar (Bottom)** | Standard app pattern | May be overlooked, competes with InputArea |
| **E. InputArea (Above)** | Near ThinkingStatusPill, visible during work | Only visible in AI mode |

**Recommendation:** **Option B (Tab Bar, Right Side)** or **Option C (SessionList Header)**

### 5.2 Pill Design

```
┌───────────────────────────────────────────────────────────────┐
│                                                               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌───────────────┐  │
│  │ Session  65%    │  │ Weekly   42%    │  │ Opus    12%   │  │
│  │ ████████░░░░░░░ │  │ ██████░░░░░░░░░ │  │ ██░░░░░░░░░░░ │  │
│  │ resets 2:34     │  │ resets 3d       │  │ resets 3d     │  │
│  └─────────────────┘  └─────────────────┘  └───────────────┘  │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

**Design Elements:**
- **Color Coding:** Green (0-50%), Yellow (50-75%), Red (75-100%)
- **Animation:** Subtle pulse when refreshing
- **Tooltip:** Show exact values, reset countdown, last refresh time
- **Click Action:** Expand for details or trigger manual refresh

### 5.3 Compact Mode

For limited space, use a single combined indicator:
```
┌────────────────────────┐
│  Usage: 65% | 42% | 12%│ ← Click to expand
│  ▇▇▇▇▇▇░░│▇▇▇▇░░░░│▇░░░│
└────────────────────────┘
```

### 5.4 Error States

| State | Display |
|-------|---------|
| **Refreshing** | Pulsing animation, "Updating..." text |
| **Stale Data** | Dimmed color, "(5m ago)" timestamp |
| **Error** | Red border, "!" icon, tooltip with error |
| **Not Configured** | Gray, "N/A" or "Setup SSH" prompt |
| **Not Authenticated** | Orange, "Auth Required" with action |

---

## 6. Implementation Strategy

### 6.1 Phase 1: Core Infrastructure (Backend)

**New Files:**
```
src/main/
├── services/
│   └── global-usage-service.ts    # Usage polling service
├── parsers/
│   └── claude-usage-parser.ts     # Parse /usage JSON output
├── ipc/handlers/
│   └── globalUsage.ts             # IPC handlers for usage
└── stores/
    └── globalUsageStore.ts        # Persist cached values
```

**New Interfaces:**
```typescript
// src/shared/types.ts
interface GlobalUsageStats {
  fiveHour: UsageBucket;
  sevenDay: UsageBucket;
  sevenDayOpus: UsageBucket | null;
  lastRefreshedAt: number;      // Unix timestamp
  source: 'local' | 'remote';
  sshRemoteId?: string;
  error?: string;
}

interface UsageBucket {
  utilization: number;          // 0-100 percentage
  resetsAt: string | null;      // ISO 8601 timestamp
  resetsIn?: number;            // Computed: seconds until reset
}

interface GlobalUsageRefreshConfig {
  pollIntervalMs: number;       // Default: 300000 (5 minutes)
  refreshBeforeAutoRun: boolean;
  refreshBeforeQuery: boolean;
  pauseWhenMinimized: boolean;
}
```

**IPC Channels:**
```typescript
// Handlers
'globalUsage:get'           // Get current cached stats
'globalUsage:refresh'       // Force refresh from CLI
'globalUsage:configure'     // Update refresh settings
'globalUsage:getConfig'     // Get current settings

// Events
'globalUsage:update'        // Broadcast new stats to renderer
'globalUsage:error'         // Broadcast errors
```

### 6.2 Phase 2: SSH Remote Integration

**Logic:**
1. Determine which remote to use for usage query:
   - If active session has SSH remote → use that
   - Else if global default SSH remote configured → use that
   - Else → use local machine
2. Execute command via existing `SshCommandRunner`
3. Parse JSON output
4. Handle errors gracefully

**Command Execution:**
```typescript
// Option 1: Echo to stdin (preferred if supported)
const command = `echo "/usage" | claude --print --output-format json`;

// Option 2: Direct print mode (may not work for slash commands)
const command = `claude -p "/usage" --output-format json`;

// Option 3: Use cat with heredoc
const command = `cat <<< "/usage" | claude --print --output-format json`;
```

> **IMPORTANT:** Testing required to determine which invocation method works for `/usage`.

### 6.3 Phase 3: Frontend UI

**New Components:**
```
src/renderer/components/
├── GlobalUsagePill.tsx         # Single usage pill (reusable)
├── GlobalUsagePills.tsx        # Container for all 3 pills
└── GlobalUsageSettings.tsx     # Settings panel section
```

**Integration Points:**
- `TabBar.tsx` - Add pills to right side
- `SessionList.tsx` - Alternative: add below trophy badge
- `SettingsModal.tsx` - Add configuration section

### 6.4 Phase 4: Auto Run Integration

**Modifications:**
- `useBatchProcessor.ts` - Check usage before starting task
- `BatchRunnerModal.tsx` - Show current usage stats
- Add "pause if over threshold" option

### 6.5 Phase 5: Agent Estimation (Advanced)

**Features:**
- Estimate tokens needed for pending task
- Compare against remaining capacity
- Suggest pause/skip if insufficient capacity
- Integrate with parallel agent coordination

---

## 7. Risk Assessment

### 7.1 Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| `/usage` not accessible via non-interactive mode | Medium | High | Test multiple invocation methods; fallback to session scraping |
| SSH latency impacts UX | Medium | Medium | Aggressive caching, async refresh, stale-while-revalidate |
| Claude CLI not installed on remote | Low | Medium | Graceful error handling, setup instructions |
| Rate limiting on `/usage` calls | Low | Medium | Minimum poll interval, exponential backoff |
| JSON format changes | Low | High | Version detection, schema validation, graceful degradation |
| SSH authentication failures | Medium | Medium | Clear error states, retry logic, user notification |

### 7.2 UX Risks

| Risk | Mitigation |
|------|------------|
| UI clutter from 3 pills | Collapsible/compact mode, single combined indicator option |
| Confusing reset times | Clear labeling, relative time ("resets in 2h 34m") |
| Stale data misleads users | Clear "last updated" timestamp, pulse on fresh data |
| Performance impact | Memoized components, batched updates, background polling |

### 7.3 Security Risks

| Risk | Mitigation |
|------|------------|
| Exposing usage data | Data stays local, no external transmission |
| SSH key exposure in logs | Redact sensitive paths in error messages |
| Command injection | Use parameterized commands, no user input in shell |

---

## 8. Recommendations

### 8.1 Recommended Approach

**Implement Option C (Hybrid Polling + Event-Driven)** with the following configuration:

| Setting | Default | Rationale |
|---------|---------|-----------|
| Poll Interval | 5 minutes | Balance between freshness and overhead |
| Refresh Before Auto Run Task | Yes | Critical for long-running workflows |
| Refresh Before Interactive Query | No | Too aggressive, user can manually refresh |
| Pause When Minimized | Yes | Save resources |
| SSH Timeout | 10 seconds | Fail fast on network issues |
| Cache TTL | 5 minutes | Match poll interval |

### 8.2 Implementation Priority

| Phase | Components | Effort | Value |
|-------|------------|--------|-------|
| **P1** | Parser + IPC Handlers + Local Execution | 2 days | High |
| **P2** | SSH Remote Execution | 1 day | High |
| **P3** | UI Pills (Tab Bar placement) | 2 days | High |
| **P4** | Caching + Settings | 1 day | Medium |
| **P5** | Auto Run Integration | 1 day | Medium |
| **P6** | Agent Estimation | 3 days | Low |

**Total Estimate:** 10 days for full feature

### 8.3 Testing Strategy

1. **Unit Tests:**
   - `claude-usage-parser.ts` - JSON parsing edge cases
   - Cache TTL logic
   - Reset time calculations

2. **Integration Tests:**
   - SSH command execution
   - IPC handler round-trip
   - Error state handling

3. **Manual Testing:**
   - Various Claude plans (Pro, Max5, Max20)
   - Different SSH remote configurations
   - Network failure scenarios

### 8.4 Future Enhancements

- **Multi-Remote Aggregation:** Show combined usage across multiple SSH remotes
- **Usage Predictions:** Estimate when limits will reset based on current rate
- **Notifications:** Alert when approaching limits
- **Historical Graphs:** Track usage over time in Usage Dashboard
- **API Integration:** Direct Anthropic API for usage stats (if/when available)

---

## 9. Open Questions

### Original Questions (CLI Approach - Most Now Moot)

| # | Question | Status | Answer |
|---|----------|--------|--------|
| 1 | Can `/usage` be invoked via `claude -p "/usage"`? | **CLOSED - NO** | Interactive-only; entire CLI approach blocked |
| 2 | Is there rate limiting on `/usage` calls? | **CLOSED** | N/A — not using CLI approach |
| 3 | What happens on Claude plans without Opus access? | Still relevant | `seven_day_opus` may be null |
| 4 | Can we get usage from Anthropic API directly? | Unknown | Not documented; not pursuing for now |
| 5 | Where should pills be placed in UI? | **USER INPUT NEEDED** | Tab Bar (right) or SessionList header |
| 6 | Should Auto Run automatically pause at threshold? | **USER INPUT NEEDED** | Suggest warning, not auto-pause |
| 7 | What's acceptable latency for usage refresh? | Suggest 10s max | |

### New Questions (Honeycomb Approach)

| # | Question | Status | Notes |
|---|----------|--------|-------|
| 8 | **Hardcoded epoch in calculated fields** — `daily_burn_rate` and `forecast_days_remaining` use hardcoded epoch `1738281600` (Jan 31, 2025). Need a dynamic Honeycomb calculated field or query-time approach that doesn't require manual date updates. | **OPEN — NEEDS FIX** | Options: (a) use `time_range` in queries instead of calculated field math, (b) create a Honeycomb Custom Query with relative time, (c) periodically update the epoch in the calculated field |
| 9 | **Observability chain latency — CONFIRMED** — Observed Feb 15: idle Claude Code sessions do NOT flush OTEL telemetry. Each session runs its own OTEL batch exporter process. When a session is idle (waiting for user input), the batch timer does not fire — events accumulate locally and only flush when the session next processes a message. This means Honeycomb queries will **undercount actual consumption** by the amount of unflushed events across all idle sessions. Active sessions flush promptly. | **CONFIRMED — NEEDS MITIGATION** | Confirmed by observing two sessions on same VM with same env vars: only the active session's events appeared in Honeycomb; the idle session's events were missing until it received its next message. See Q#11 for mitigation strategy. |
| 10 | **$150 ceiling is placeholder** — The `max_quota_percent` and `forecast_days_remaining` fields use $150 as the Max plan budget. This is a rough estimate, not a confirmed limit. Need to define separate configurable ceilings for: **BURST** (5-hour window), **WEEKLY** (7-day rolling), and **MONTHLY** (billing cycle). These are three different limit dimensions, not one number. | **OPEN — NEEDS RESEARCH** | Approach: (a) make all three configurable in Maestro Settings with sensible defaults, (b) discover empirically by correlating usage with rate-limit events in Honeycomb, (c) update Honeycomb calculated fields once values are known, (d) community research for best-known estimates per plan tier |
| 11 | **Unflushed token tracking across sessions** — Because idle sessions hold unflushed OTEL events (Q#9), Honeycomb alone cannot provide an accurate real-time view of total consumption. Maestro needs a complementary mechanism to track "committed but not yet in Honeycomb" tokens. This is critical for pre-task capacity checks — without it, an agent could approve a large task based on stale Honeycomb data while other sessions have already consumed significant unreported tokens. | **OPEN — NEEDS DESIGN** | See Section 13.5 for proposed mitigation strategies. |

---

## Appendix: Reference Materials

### A.1 Files to Modify/Create

**New Files:**
```
src/main/services/global-usage-service.ts
src/main/parsers/claude-usage-parser.ts
src/main/ipc/handlers/globalUsage.ts
src/main/stores/globalUsageStore.ts
src/shared/globalUsageTypes.ts
src/renderer/components/GlobalUsagePills.tsx
src/renderer/components/GlobalUsagePill.tsx
src/renderer/hooks/useGlobalUsage.ts
```

**Files to Modify:**
```
src/shared/types.ts              # Add GlobalUsageStats interface
src/main/preload/index.ts        # Expose globalUsage IPC
src/main/index.ts                # Register IPC handlers
src/renderer/App.tsx             # Add GlobalUsagePills
src/renderer/components/TabBar.tsx # Integrate pills (if Tab Bar placement)
src/renderer/components/SessionList.tsx # Integrate pills (if SessionList placement)
src/renderer/components/SettingsModal.tsx # Add configuration UI
src/renderer/hooks/batch/useBatchProcessor.ts # Pre-task refresh trigger
```

### A.2 Related Documentation

- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference)
- [Claude Code Slash Commands](https://code.claude.com/docs/en/slash-commands)
- [Claude Usage Limits](https://claudelog.com/claude-code-limits/)
- [Community Usage Monitor](https://codelynx.dev/posts/claude-code-usage-limits-statusline)

### A.3 External Tools Reference

- [ccusage](https://github.com/ryoppippi/ccusage) - CLI tool for analyzing Claude Code usage from JSONL files
- [Claude-Code-Usage-Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) - Real-time usage monitor with predictions

### A.4 Sample `/usage` Output (Documented Format)

```json
{
  "five_hour": {
    "utilization": 6.0,
    "resets_at": "2025-11-04T04:59:59.943648+00:00"
  },
  "seven_day": {
    "utilization": 35.0,
    "resets_at": "2025-11-06T03:59:59.943679+00:00"
  },
  "seven_day_oauth_apps": null,
  "seven_day_opus": {
    "utilization": 0.0,
    "resets_at": null
  },
  "iguana_necktie": null
}
```

---

---

## 10. REVISED APPROACH: Honeycomb + OTEL Telemetry

> **This section supersedes Sections 2.1 and 4.x above.** The CLI-based approach is blocked.
> The Honeycomb/OTEL approach is now the recommended path forward.

### 10.1 Current Honeycomb Setup

**Workspace:** `claudepalmeragent`
**Environment:** `claudepalmeragent`

**Two datasets actively receiving data:**

| Dataset | Columns | Purpose |
|---------|---------|---------|
| `claude-code` | 63 (58 raw + 5 calculated) | Primary aggregated dataset |
| `claude-code-test` | — | Test dataset |
| `claude-code-worker-$(hostname)` | 37 (all raw) | Per-VM telemetry (being eliminated) |

**Data flowing since:** 2025-12-17 (oldest event)
**Latest event:** 2026-02-15 (resource attributes actively writing)

**Resource Attributes (added Feb 2026):**
- `host.name` — VM hostname
- `host.image.id`, `host.image.name` — VM image identifiers
- `vm.node` — e.g., `apple-silicon`
- `swarm.id` — e.g., `maestro`
- `agent.index` — agent number within swarm
- `plan.type` — e.g., `max`
- `plan.limit` — e.g., `max_burst`

### 10.2 Available Token Fields

**Raw OTEL fields (from Claude Code telemetry):**

| Field | Type | Description |
|-------|------|-------------|
| `input_tokens` | string | Input tokens per event |
| `output_tokens` | string | Output tokens per event |
| `cache_read_tokens` | string | Cache read tokens per event |
| `cache_creation_tokens` | string | Cache creation tokens per event |
| `cost_usd` | string | Cost per event (from Claude) |
| `model` | string | Model used (sonnet, opus, etc.) |
| `session.id` | string | Claude session identifier |
| `user.id` | string | User identifier |
| `user.email` | string | User email |
| `event.name` | string | Event type |
| `duration_ms` | string | Event duration |
| `service.name` | string | Service identifier |

**Pre-built aggregate fields (from Claude OTEL):**

| Field | Type | Description |
|-------|------|-------------|
| `claude_code.token.usage` | float | Aggregate token metric |
| `claude_code.cost.usage` | float | Aggregate cost metric |
| `claude_code.session.count` | float | Session count metric |
| `claude_code.active_time.total` | float | Active time metric |

### 10.3 Existing Calculated Fields (Already Built)

These are already configured in Honeycomb and do significant work:

**1. `total_usage_cost`** — API-equivalent cost per event
```
($input_tokens / 1M * $5) +
($output_tokens / 1M * $25) +
($cache_creation_tokens / 1M * $10) +
($cache_read_tokens / 1M * $0.50)
```

**2. `max_quota_percent`** — Percentage of $150 monthly budget consumed
```
(total_usage_cost / $150) * 100
```
> Note: Uses $150 as the assumed Max plan ceiling. This value should be configurable.

**3. `daily_burn_rate`** — Cost per day since epoch Jan 31, 2025
```
total_usage_cost / days_elapsed_since_epoch
```

**4. `forecast_days_remaining`** — Days until $150 budget exhausted
```
($150 - total_usage_cost) / daily_burn_rate
```

**5. `cache_hit_ratio_event`** — Per-event cache efficiency
```
cache_read_tokens / (input_tokens + cache_read_tokens)
```

### 10.4 What's Missing / Needs Work

| Gap | Description | Resolution |
|-----|-------------|------------|
| **5-hour window aggregation** | No calculated field for rolling 5-hour token sum | Build Honeycomb query with `time_range: "5h"` SUM |
| **Weekly aggregation** | No calculated field for rolling 7-day token sum | Build Honeycomb query with `time_range: "7d"` SUM |
| **Model-specific breakdowns** | No per-model (Opus vs Sonnet) aggregation | Add `breakdowns: ["model"]` to queries |
| **Actual limit values** | $150 is hardcoded, may not match real limits | Need empirical observation or configurable setting |
| **String-typed token fields** | `input_tokens`, etc. are `string` not `float` | Honeycomb auto-casts in expressions, but dedicated numeric columns would be cleaner |
| **Per-VM breakdown** | `claude-code-worker-$(hostname)` has no calculated fields | Mirror calculated fields or use cross-dataset queries |
| **Boards** | ROI board created but needs time_range fixes | Fix all 13 queries per Section 13 audit |
| **Triggers/Alerts** | No alerts when approaching limits | Create Honeycomb triggers at 75% and 90% thresholds |

### 10.5 Revised Architecture: Honeycomb as Data Source

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       REVISED DATA FLOW: HONEYCOMB APPROACH                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌──────────────┐     OTEL telemetry      ┌─────────────────┐                    │
│  │ VM 1 (Claude)│ ─────────────────────► │                 │                    │
│  └──────────────┘                         │                 │                    │
│  ┌──────────────┐     OTEL telemetry      │   Honeycomb     │                    │
│  │ VM 2 (Claude)│ ─────────────────────► │   (cloud)       │                    │
│  └──────────────┘                         │                 │                    │
│  ┌──────────────┐     OTEL telemetry      │                 │                    │
│  │ VM N (Claude)│ ─────────────────────► │                 │                    │
│  └──────────────┘                         └────────┬────────┘                    │
│                                                    │                             │
│                                    Honeycomb MCP   │  Query results               │
│                                                    │                             │
│                                                    ▼                             │
│  ┌─────────────────────────────────────────────────────────────────┐              │
│  │                    Maestro App                                   │              │
│  │                                                                  │              │
│  │  ┌──────────────────┐    ┌──────────────────────────────┐       │              │
│  │  │  Main Process     │    │  Renderer                    │       │              │
│  │  │                   │    │                               │       │              │
│  │  │  HoneycombService │──►│  GlobalUsagePills             │       │              │
│  │  │  - MCP queries    │    │  ┌──────┐ ┌──────┐ ┌──────┐ │       │              │
│  │  │  - Cache results  │    │  │5hr % │ │Wk  % │ │Opus %│ │       │              │
│  │  │  - Poll interval  │    │  │██░░░░│ │████░░│ │█░░░░░│ │       │              │
│  │  │                   │    │  └──────┘ └──────┘ └──────┘ │       │              │
│  │  └──────────────────┘    └──────────────────────────────┘       │              │
│  └─────────────────────────────────────────────────────────────────┘              │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────┘
```

### 10.6 Honeycomb Queries Needed for Maestro

**Query 1: 5-Hour Rolling Window Usage**
```json
{
  "dataset_slug": "claude-code",
  "query_spec": {
    "calculations": [
      { "op": "SUM", "column": "total_usage_cost" },
      { "op": "SUM", "column": "input_tokens" },
      { "op": "SUM", "column": "output_tokens" },
      { "op": "COUNT" }
    ],
    "time_range": "5h"
  }
}
```

**Query 2: 7-Day Rolling Window Usage**
```json
{
  "dataset_slug": "claude-code",
  "query_spec": {
    "calculations": [
      { "op": "SUM", "column": "total_usage_cost" },
      { "op": "SUM", "column": "input_tokens" },
      { "op": "SUM", "column": "output_tokens" },
      { "op": "COUNT" }
    ],
    "time_range": "7d"
  }
}
```

**Query 3: 7-Day Opus-Only Usage**
```json
{
  "dataset_slug": "claude-code",
  "query_spec": {
    "calculations": [
      { "op": "SUM", "column": "total_usage_cost" },
      { "op": "COUNT" }
    ],
    "filters": [
      { "column": "model", "op": "contains", "value": "opus" }
    ],
    "time_range": "7d"
  }
}
```

**Query 4: Per-Model Breakdown (for dashboard)**
```json
{
  "dataset_slug": "claude-code",
  "query_spec": {
    "breakdowns": ["model"],
    "calculations": [
      { "op": "SUM", "column": "total_usage_cost" },
      { "op": "SUM", "column": "input_tokens" },
      { "op": "SUM", "column": "output_tokens" },
      { "op": "COUNT" }
    ],
    "time_range": "7d",
    "limit": 10
  }
}
```

### 10.7 Integration Strategy: Honeycomb MCP → Maestro

**Option A: MCP-Based Queries from Renderer (Simpler)**
- Use Honeycomb MCP tools directly from within Claude sessions
- Agents can query usage before tasks via MCP
- No Maestro code changes needed for agent access
- UI pills would require separate IPC integration

**Option B: Backend Service with Honeycomb API (More Robust)**
- Maestro main process calls Honeycomb API directly (REST)
- Cache results with TTL
- Broadcast to renderer via IPC
- Independent of MCP connection

**Option C: Hybrid MCP + Cache (Recommended)**
- Main process polls Honeycomb via MCP or REST API periodically
- Caches results in electron-store
- Renderer reads from cache via IPC
- Agents can also query MCP directly for latest data
- Pre-task refresh triggers Honeycomb query

### 10.8 Configurable Limits

Since Anthropic doesn't publish exact limits, these should be user-configurable in Maestro Settings:

```typescript
interface UsageLimitsConfig {
  // Monthly budget ceiling (used in max_quota_percent)
  monthlyBudgetUsd: number;         // Default: 150 (Max5 plan estimate)

  // 5-hour window estimate (API-equivalent cost)
  fiveHourWindowLimitUsd: number;   // Default: TBD (needs empirical data)

  // Weekly limit estimate
  weeklyLimitUsd: number;           // Default: TBD (needs empirical data)

  // Opus-specific weekly limit
  weeklyOpusLimitUsd: number;       // Default: TBD

  // Warning thresholds
  warningThresholdPct: number;      // Default: 75
  criticalThresholdPct: number;     // Default: 90

  // Plan tier (informational)
  planTier: 'pro' | 'max5' | 'max20' | 'custom';
}
```

### 10.9 Empirical Limit Discovery Strategy

Since exact limits are unknown, we need a strategy to determine them:

1. **Phase 1 (Now):** Accumulate telemetry data in Honeycomb over 1-2 weeks
2. **Phase 2:** Correlate token consumption with rate-limit events (look for `error` or `status_code` fields indicating throttling)
3. **Phase 3:** Use BubbleUp analysis on rate-limited vs. successful events to identify the threshold
4. **Phase 4:** Set configurable limits based on empirical findings
5. **Ongoing:** Honeycomb triggers alert when approaching discovered limits

**Key Fields for Limit Discovery:**
- `error` — Look for rate-limit error messages
- `status_code` — HTTP 429 or similar
- `event.name` — May distinguish between normal and throttled events
- Correlate SUM of `total_usage_cost` at time of throttle = discovered limit

---

## 11. Revised Implementation Plan

### Phase 1: Honeycomb Data Maturation (1-2 weeks, passive)
- [ ] Let OTEL telemetry accumulate in Honeycomb
- [ ] Monitor data quality (are token fields populating?)
- [ ] Create Honeycomb board with key queries
- [ ] Set up Honeycomb triggers for threshold alerts

### Phase 2: Limit Discovery (1 week, analysis)
- [ ] Analyze correlation between usage and rate-limiting events
- [ ] Determine empirical 5-hour and weekly ceilings
- [ ] Document findings and set default config values

### Phase 3: Backend Integration (2-3 days, code)
- [ ] Create `HoneycombUsageService` in Maestro main process
- [ ] Implement polling + caching of Honeycomb query results
- [ ] Add IPC handlers for renderer access
- [ ] Add configurable limits to Settings

### Phase 4: Frontend UI (2-3 days, code)
- [ ] Create `GlobalUsagePills` component (3 bars/pills)
- [ ] Integrate into Tab Bar or SessionList header
- [ ] Add Settings panel for limit configuration
- [ ] Color-coded thresholds (green/yellow/red)

### Phase 5: Auto Run Integration (1-2 days, code)
- [ ] Pre-task usage check before Auto Run tasks
- [ ] Warning/pause UI when approaching limits
- [ ] Agent-queryable usage status via MCP

---

## 12. Revised Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| OTEL data missing token fields | Low | High | Validate data quality early; check for nulls |
| **OTEL flush gap (CONFIRMED)** | **High** | **High** | **Local token ledger + safety margin buffer (Section 13.5)** |
| Honeycomb query latency (>5s) | Medium | Medium | Aggressive caching, async refresh |
| Empirical limits change over time | Medium | Medium | Configurable values, periodic re-calibration |
| MCP connection to Honeycomb drops | Low | Medium | Fallback to cached values with "stale" indicator |
| String-typed token fields cause issues | Low | Low | Honeycomb auto-casts; can create float copies |
| $150 budget assumption is wrong | Medium | Medium | Make configurable, document as estimate |

---

## 13. Honeycomb Audit: Calculated Fields & Board Queries

> **Audit Date:** 2026-02-15
> **Dataset:** `claude-code` (63 columns: 58 raw + 5 calculated)
> **Board:** "Claude Code - ROI & Cost Monitoring" (ID: `km4k4GU5bzx`, 13 queries)

### 13.1 Calculated Fields Audit

#### CF-1: `total_usage_cost` — OK (with caveat)

**Expression:**
```
($input_tokens / 1M * 5) + ($output_tokens / 1M * 25) +
($cache_creation_tokens / 1M * 10) + ($cache_read_tokens / 1M * 0.50)
```

**Assessment:** Correct for Opus API-equivalent pricing ($5/$25/$10/$0.50 per 1M tokens). However, this uses a single pricing model for all events regardless of model. Sonnet events (cheaper: $3/$15 per 1M) will be **overstated** by ~40-67%. For a cost ceiling tracker this is conservative (over-estimates usage), which is arguably safe. To improve accuracy, a model-aware calculated field would use `IF(CONTAINS($model, "opus"), <opus_rates>, <sonnet_rates>)`.

**Verdict:** Acceptable as-is. Conservative overestimate is preferable to underestimate for limit tracking.

#### CF-2: `max_quota_percent` — Per-Event, Not Cumulative

**Expression:**
```
((total_usage_cost) / 150) * 100
```

**Assessment:** This computes the percentage of $150 that a **single event** costs — producing values like 0.001% per event. It does NOT show cumulative spend as a percentage of budget. To get actual quota utilization, use a query-time `SUM(total_usage_cost)` over the desired window, then divide by the ceiling in application code or a board formula.

**Verdict:** Misleading as a raw column. Only useful if wrapped in `SUM()` at query time (which would sum the per-event percentages, mathematically equivalent to `SUM(cost)/150*100`). Recommend renaming to `event_quota_percent` or replacing with query-time aggregation.

#### CF-3: `daily_burn_rate` — Per-Event, Hardcoded Epoch

**Expression:**
```
IF(GT(SUB(DIV(UNIX_TIMESTAMP(EVENT_TIMESTAMP()), 1000), 1738281600), 3600),
   DIV(total_usage_cost / (days_since_epoch), days_since_epoch),
   0)
```

**Assessment:** Two issues:
1. **Per-event:** Divides a single event's cost by days since epoch. A single event's "daily burn rate" is meaningless — burn rate is only meaningful as an aggregate across all events.
2. **Hardcoded epoch:** `1738281600` = Jan 31, 2025. This must be updated manually or replaced with a query using relative `time_range`.

**Verdict:** Not useful as-is. Replace with query-time approach: `SUM(total_usage_cost)` over `time_range: "30d"` divided by 30 in application code.

#### CF-4: `forecast_days_remaining` — Per-Event, Hardcoded Epoch

**Expression:**
```
(150 - total_usage_cost) / (total_usage_cost / days_since_epoch)
```

**Assessment:** Same two issues as CF-3. Computes per-event: `(150 - $0.003) / ($0.003 / 400)` = astronomical number of days. Only meaningful as an aggregate. Also inherits the hardcoded epoch problem.

**Verdict:** Not useful as-is. Replace with query-time approach using cumulative SUM values.

#### CF-5: `cache_hit_ratio_event` — OK

**Expression:**
```
IF(GT(($input_tokens + $cache_read_tokens), 0),
   DIV($cache_read_tokens, ($input_tokens + $cache_read_tokens)),
   0)
```

**Assessment:** Correct per-event cache hit ratio. Properly handles division by zero. Useful both as raw column and when aggregated via `AVG(cache_hit_ratio_event)`.

**Verdict:** Good. Works as intended.

### 13.2 Calculated Fields Summary

| # | Field | Status | Issue | Recommendation |
|---|-------|--------|-------|----------------|
| 1 | `total_usage_cost` | **OK** | Opus-only pricing; Sonnet overstated ~40-67% | Acceptable (conservative). Optionally add model-aware pricing. |
| 2 | `max_quota_percent` | **Misleading** | Per-event, not cumulative | Rename or replace with query-time `SUM(total_usage_cost)/150*100` |
| 3 | `daily_burn_rate` | **Not Useful** | Per-event + hardcoded epoch | Replace with query-time `SUM(cost)/days` over rolling window |
| 4 | `forecast_days_remaining` | **Not Useful** | Per-event + hardcoded epoch | Replace with query-time `(ceiling - SUM(cost)) / burn_rate` |
| 5 | `cache_hit_ratio_event` | **OK** | None | Keep as-is |

### 13.3 Board Queries Audit

**Board:** "Claude Code - ROI & Cost Monitoring" (13 queries)

#### Critical Issue: All Queries Use `time_range: 7200` (2 Hours)

Every query on the board uses the default `time_range: 7200` seconds (2 hours). Combined with daily or weekly granularity settings, this produces **0-1 data points per time bucket**, making trends invisible. This appears to be a board template default that was not adjusted after creation.

**Required Fix:** Change `time_range` per query:
- Daily trend queries → `time_range: "30d"` (30 days)
- Weekly trend queries → `time_range: "12w"` (12 weeks / ~90 days)
- Snapshot/current queries → `time_range: "7d"` (7 days)
- 5-hour window queries → `time_range: "5h"`

#### Per-Query Assessment

| # | Query | time_range | Granularity | Issue | Fix |
|---|-------|-----------|-------------|-------|-----|
| 1 | Total Spend | 2h | — | Too short for meaningful total | → 30d |
| 2 | Cost Trends Over Time | 2h | daily | 0-1 data points | → 30d |
| 3 | Cost per User (Top 20) | 2h | daily | 0-1 data points | → 30d |
| 4 | Cost per Session | 2h | daily | 0-1 data points | → 30d |
| 5 | Active Time per Dollar | 2h | daily | 0-1 data points | → 30d |
| 6 | Cost Efficiency Trend | 2h | weekly | 0-1 data points | → 12w |
| 7 | Model Usage & Cost Breakdown | 2h | daily | 0-1 data points | → 30d |
| 8 | Token Usage by Type | 2h | daily | 0-1 data points | → 30d |
| 9 | Lines of Code Trends | 2h | daily | 0-1 data points | → 30d |
| 10 | Total Active Time Trends | 2h | daily | 0-1 data points | → 30d |
| 11 | Tool Acceptance Rate | 2h | daily | 0-1 data points | → 30d |
| 12 | Session Count Trends | 2h | daily | 0-1 data points | → 30d |
| 13 | Active Time vs Cost by User | 2h | — | Too short for user comparison | → 30d |

#### Other Board Query Observations

1. **Template boilerplate:** All queries include inline calculated fields (e.g., `cost_per_event`, `active_time_hours`) that duplicate dataset-level calculated fields. Not harmful but adds maintenance overhead.
2. **UUID breakdowns:** Some queries break down by `user.id` (UUID) rather than `user.email`. For readability, prefer `user.email`.
3. **New resource attributes available:** Queries don't yet use `host.name`, `vm.node`, `agent.index`, `swarm.id`, `plan.type`, or `plan.limit` — these were added more recently and could enable per-VM and per-agent breakdowns.

### 13.4 Recommended Actions

**Immediate (fix the board):**
1. Update all 13 query `time_range` values from 2h to 30d/12w as listed above
2. Switch `user.id` breakdowns to `user.email` for readability
3. Add `host.name` breakdown to relevant queries for per-VM visibility

**Short-term (improve calculated fields):**
4. Rename `max_quota_percent` → `event_quota_percent` (or remove; use query-time aggregation)
5. Remove or mark `daily_burn_rate` and `forecast_days_remaining` as deprecated — replace with query-time computations using relative `time_range`
6. Optionally add model-aware pricing to `total_usage_cost`

**Medium-term (Maestro integration queries):**
7. Build the 4 Maestro integration queries from Section 10.6 (5h window, 7d window, 7d Opus-only, per-model breakdown)
8. These queries should use `total_usage_cost` with `SUM()` aggregation, avoiding the problematic per-event calculated fields

### 13.5 OTEL Flush Gap: Unflushed Token Mitigation Strategies

> **Finding Date:** 2026-02-15
> **Severity:** High — directly impacts accuracy of pre-task capacity checks
> **Related:** Open Questions #9 (confirmed) and #11

#### The Problem

Claude Code's OTEL batch exporter only flushes when the session is actively processing (handling messages, running tools). Idle sessions accumulate events locally. In a Maestro swarm with N parallel agents, at any given moment some agents are active and some are idle. Honeycomb only reflects the active agents' consumption — the idle agents' unreported tokens create a **blind spot**.

**Worst case scenario:** Agent A queries Honeycomb, sees 60% of weekly limit consumed, approves a large task. Meanwhile Agents B, C, D have collectively consumed another 25% that hasn't flushed yet. Agent A's task pushes total to >100%, triggering rate limiting mid-task.

#### Mitigation Strategies

**Strategy A: Safety Margin Buffer (Simplest)**
- Reserve a configurable percentage (e.g., 15-20%) of each limit as a buffer
- Pre-task check: `if (honeycomb_usage + buffer) > threshold → warn/pause`
- Buffer accounts for unflushed events across all sessions
- Scale buffer with number of active agents: `buffer = base_pct + (N_agents * per_agent_pct)`
- **Pro:** Zero additional infrastructure. **Con:** Wastes capacity; buffer may be too conservative or too aggressive.

**Strategy B: Local Token Ledger in Maestro (Recommended)**
- Maestro already parses token counts from each agent's output stream (via `claude-output-parser.ts` and `usage-aggregator.ts`)
- Maintain a local in-memory ledger: `Map<sessionId, { tokensConsumed, lastFlushedAt }>`
- On each agent response: increment local ledger immediately
- On pre-task check: `actual_usage = honeycomb_sum + SUM(local_ledger_unflushed)`
- Periodically reconcile: when Honeycomb data catches up, zero out the local ledger for that session
- **Pro:** Accurate, real-time, uses existing parser infrastructure. **Con:** Requires Maestro code changes; ledger lives in memory (lost on restart, but restart also restarts sessions).

**Strategy C: Cross-Session Flush Coordination (Complex)**
- Before a pre-task capacity check, Maestro sends a "flush request" to all active agents
- Each agent triggers its session to process a lightweight message, forcing an OTEL flush
- Wait a short interval (2-5 seconds) for Honeycomb ingestion
- Then query Honeycomb for the now-up-to-date totals
- **Pro:** Gets true Honeycomb accuracy. **Con:** Adds latency to every pre-task check; requires a mechanism to trigger flushes; may not be possible without Claude Code supporting explicit OTEL flush.

**Strategy D: Hybrid A+B (Recommended for Implementation)**
- Implement Strategy B (local token ledger) as the primary mechanism
- Use Strategy A (safety margin) as a secondary safeguard for edge cases (e.g., tokens consumed before Maestro parser captured them, or during app restart)
- Default safety margin: 10% when local ledger is active, 20% when local ledger is unavailable
- Pre-task formula: `estimated_total = honeycomb_sum + local_unflushed + safety_margin`

#### Impact on Architecture

This finding means the Maestro integration (Phases 3-5 in Section 11) needs an additional component:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Maestro Main Process                          │
│                                                                  │
│  ┌──────────────────┐    ┌──────────────────┐                    │
│  │ HoneycombService  │    │ LocalTokenLedger │ ◄── parser events │
│  │ (query remote)    │    │ (track local)    │                    │
│  └────────┬─────────┘    └────────┬─────────┘                    │
│           │                        │                             │
│           ▼                        ▼                             │
│  ┌─────────────────────────────────────────────┐                 │
│  │ UsageAggregator                              │                 │
│  │ total = honeycomb + local_unflushed + buffer │                 │
│  └──────────────────────┬──────────────────────┘                 │
│                          │                                        │
│                          ▼                                        │
│  ┌──────────────────────────────────────────┐                    │
│  │ Pre-task check: can_proceed(task_estimate)│                    │
│  │ → YES / WARN / BLOCK                     │                    │
│  └──────────────────────────────────────────┘                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Conclusion (Revised)

The original CLI-based approach (`claude /usage`) is **blocked** — no programmatic access exists.

The **Honeycomb + OTEL telemetry approach** is the viable alternative:

1. **OTEL pipeline is active** — token data is flowing from VMs to Honeycomb
2. **Calculated fields exist** — cost, quota %, burn rate, and forecast already computed
3. **MCP integration available** — Maestro can query Honeycomb directly
4. **Limits need empirical discovery** — exact ceilings unknown, must be observed and configured
5. **Data needs maturation** — 1-2 weeks of accumulation for reliable baselines

**Immediate Next Steps:**
1. **Fix board query time ranges** — All 13 queries use 2h default; change to 30d/12w (see Section 13.4)
2. **Fix/remove per-event calculated fields** — CF #2-4 are misleading; replace with query-time aggregations
3. Backfill historical data from stats DB and JSONL files (user in progress)
4. Wait for sufficient data accumulation (1-2 weeks)
5. Begin empirical limit discovery (correlate usage with rate-limit events)
6. Build Maestro integration queries (Section 10.6)
7. Implement Maestro code integration (Phases 3-5)

---

*Document revised by maestro-planner (claude cloud). Honeycomb-based approach adopted 2026-02-14.*
