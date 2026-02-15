# Investigation: Claude.ai Global Token Usage Statistics

**Created:** 2026-02-14
**Updated:** 2026-02-14 (Major Revision: Honeycomb/OTEL approach replaces CLI approach)
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
1. **Feasible via Honeycomb** - OTEL telemetry pipeline active with token data flowing
2. **5 calculated fields** already computing cost, quota %, burn rate, and forecast
3. **$150/month budget** used as ceiling for quota calculations
4. **MCP tools available** for querying Honeycomb from Maestro
5. **Data is early** — limited historical data, needs accumulation for reliable estimates

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
| 9 | **Observability chain latency** — There will be delay between a Claude event occurring on a VM and it appearing in Honeycomb query results (OTEL batching + Honeycomb ingestion + query execution). When an agent needs to check remaining capacity *before* consuming tokens on the next task, this lag could mean the data is stale by seconds or minutes. | **OPEN — NEEDS MEASUREMENT** | Must measure actual end-to-end latency. Mitigation: (a) add a safety margin buffer to estimates, (b) track "tokens committed but not yet in Honeycomb" locally in Maestro, (c) accept some staleness and document it |
| 10 | **$150 ceiling is placeholder** — The `max_quota_percent` and `forecast_days_remaining` fields use $150 as the Max plan budget. This is a rough estimate, not a confirmed limit. Need to define separate configurable ceilings for: **BURST** (5-hour window), **WEEKLY** (7-day rolling), and **MONTHLY** (billing cycle). These are three different limit dimensions, not one number. | **OPEN — NEEDS RESEARCH** | Approach: (a) make all three configurable in Maestro Settings with sensible defaults, (b) discover empirically by correlating usage with rate-limit events in Honeycomb, (c) update Honeycomb calculated fields once values are known, (d) community research for best-known estimates per plan tier |

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
| `claude-code` | 53 (48 raw + 5 calculated) | Primary aggregated dataset |
| `claude-code-worker-$(hostname)` | 37 (all raw) | Per-VM telemetry |

**Data flowing since:** 2025-12-16

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
| **Boards** | No Honeycomb boards created | Create monitoring boards for visual tracking |
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
| Honeycomb query latency (>5s) | Medium | Medium | Aggressive caching, async refresh |
| Empirical limits change over time | Medium | Medium | Configurable values, periodic re-calibration |
| MCP connection to Honeycomb drops | Low | Medium | Fallback to cached values with "stale" indicator |
| String-typed token fields cause issues | Low | Low | Honeycomb auto-casts; can create float copies |
| $150 budget assumption is wrong | Medium | Medium | Make configurable, document as estimate |

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
1. User reviews this revised investigation
2. Validate data quality in Honeycomb (are token fields populated correctly?)
3. Create Honeycomb monitoring board
4. Wait for sufficient data accumulation
5. Begin empirical limit discovery
6. Implement Maestro integration (Phases 3-5)

---

*Document revised by maestro-planner (claude cloud). Honeycomb-based approach adopted 2026-02-14.*
