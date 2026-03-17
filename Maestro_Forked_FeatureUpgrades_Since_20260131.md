# Maestro Fork — Feature Upgrades Since January 31, 2026

**Author:** Doug Palmer
**Fork:** `claudepalmeragent/Maestro` (forked from `pedramamini/Maestro`)
**Period:** January 31 – March 16, 2026
**Commits:** 603+ commits on the fork (186 through Feb 17, 417 since)
**Context:** All work driven by a local topology of dedicated micro-VMs per agent, connected via SSH Remote

---

## Overview

This document summarizes all feature upgrades, enhancements, and fixes made to the Maestro codebase since forking on ~January 31, 2026. The primary driver for most changes has been supporting a **dedicated micro-VM per agent** topology where every AI coding agent runs on its own remote VM, accessed through SSH. This architecture exposed gaps and created opportunities across the entire application — from SSH connection handling to token tracking, cost analytics, group chat orchestration, and UI polish.

---

## 1. SSH Remote — Deep Integration & Hardening

The single biggest theme: making SSH remotes a true first-class citizen throughout the app, not just a spawn-time option.

| Change                                    | Details                                                                                                                                                                                                                     | Key Files                                                       |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **SSH Connection Pooling**                | Implemented `ControlMaster` / `ControlPersist` for SSH multiplexing — dramatically reduces connection overhead when multiple operations hit the same remote VM                                                              | `src/main/ssh-remote-manager.ts`                                |
| **SSH Remote Moderators in Group Chat**   | Enabled SSH-hosted agents to serve as Group Chat moderators — previously only local agents could moderate                                                                                                                   | `src/main/group-chat/`, commit `dd041c92`                       |
| **SSH Remote Participants in Group Chat** | Fixed follow-up message delivery to SSH remote participants; resolved CWD path issues, @mention matching with parenthetical session names, and SSH config resolution across all config file locations                       | Multiple commits (`e3badc62`, `05440ab5`, `2adda937`, etc.)     |
| **SSH Remote Agent Detection**            | Group Chat moderator selection now detects and lists agents available on SSH remotes, not just locally installed ones                                                                                                       | `src/main/agents/detector.ts`, commit `32057f49`                |
| **SSH Remote Session Explorer**           | Session Explorer can now scan SSH remote hosts for agent session data; handles home directory expansion, large file partial reading, and proper folder path structures                                                      | `src/main/ipc/handlers/`, commits `768ddb72` through `53115f27` |
| **Bash Warning Filtering**                | SSH connections inject bash locale warnings (`bash: warning: setlocale...`) into agent output streams — built a multi-iteration regex filter to strip these without breaking token byte counts or state update flush cycles | Multiple commits, final: `20810505`                             |
| **Hybrid Billing Mode Detection**         | Stats pipeline detects billing mode (API key vs Max subscription) differently for SSH remote agents vs local agents, since remote agents may use different Anthropic accounts                                               | `src/main/stats/`, commit `f7380117`                            |

**Why this matters:** In a micro-VM topology, every agent interaction is an SSH call. These changes make that seamless — pooled connections, proper group chat support for remote agents, and clean output streams without SSH noise.

---

## 2. Project Folders — New Organizational Layer

Built an entirely new organizational abstraction above Groups, allowing agents/sessions to be organized by project context.

| Change                          | Details                                                                                               | Key Files                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Data Layer (WP1)**            | Project Folders store with CRUD operations, electron-store persistence, IPC handlers                  | `src/main/stores/`, `src/main/ipc/handlers/`                     |
| **UI Components (WP2)**         | `ProjectFolderHeader`, `FolderSettingsModal`, `ColorPicker` — full sidebar integration                | `src/renderer/components/`                                       |
| **Sidebar Restructure (WP3)**   | Session list now organized under collapsible Project Folder sections with color-coded background bars | `src/renderer/components/SessionList/`                           |
| **Drag & Drop**                 | Sessions can be dragged between Project Folders with proper React state updates                       | Commit `30304f58`                                                |
| **Group Scoping**               | Groups are scoped to their parent Project Folder; "New Group" button appears in folder context        | Commits `bb37845f`, `4ba70e1b`                                   |
| **Group Chat Folder Threading** | `projectFolderId` threaded through Group Chat creation — chats are scoped to folders                  | `src/shared/group-chat-types.ts`, commits `76215011`, `961bcb81` |
| **Background Colors**           | Project Folder highlight colors always visible in sidebar (not just on hover)                         | Commit `a69d55d7`                                                |
| **Folder-Level Billing Config** | Per-folder pricing configuration via Project Folder Settings modal                                    | `FolderSettingsModal`, commit `0b4077ac`                         |

**Why this matters:** When running 6+ agents across different VMs on different projects, you need a way to visually and logically group them. Project Folders provide that container with per-project pricing and color-coding.

---

## 3. Usage Dashboard & Cost Tracking — Major Overhaul

Completely reworked how Maestro tracks, attributes, and displays token usage and costs.

| Change                                | Details                                                                                                                                            | Key Files                                                                             |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Claude API Pricing Infrastructure** | Built a complete pricing model for all Claude models (Haiku, Sonnet, Opus across versions) with per-model token rates                              | `src/shared/pricing.ts` (new)                                                         |
| **Dual-Cost Tracking**                | Every query now records both Anthropic's actual cost and Maestro's calculated cost — enables savings visibility                                    | `src/main/stats/stats-db.ts`                                                          |
| **Agent ID Attribution**              | Added `agent_id` column to stats DB — queries are now attributed to specific agent instances, not just agent types                                 | DB migration v6, commit `d2c38e80`                                                    |
| **Cache Token Tracking**              | Added `cache_read_input_tokens` and `cache_creation_input_tokens` columns to stats pipeline through to dashboard Summary Cards                     | DB migration v5, commits `5f71d3a4`, `18d86131`                                       |
| **Agent Cost Graph**                  | New `AgentCostGraph` component showing per-agent cost breakdown over time                                                                          | `src/renderer/components/UsageDashboard/AgentCostGraph.tsx`                           |
| **Throughput Metrics**                | Token throughput (tokens/sec) tracked per query, displayed in ThinkingStatusPill during streaming, with `ThroughputTrendsChart` in dashboard       | Multiple files, commits `d525eaf0`, `b2e1e94c`                                        |
| **Agent Stats Breakout**              | New Agents tab in dashboard with per-agent summary cards and throughput charts                                                                     | Commit `d0979299`                                                                     |
| **Anthropic Audit Feature**           | Full audit system comparing Maestro-tracked costs against Anthropic's API billing — with billing mode breakdown, delete capability, scheduled runs | `src/main/services/anthropic-audit-service.ts`, commits `46c1a890` through `35a668d0` |
| **Cost Graph Bugfixes**               | 5 phases of fixes for chart rendering, tooltip positioning (React Portal), session name display, and overflow handling in modals                   | Commits `3d398c89`, `7bfabef3`, `df672a98`                                            |
| **Billing Mode Detection**            | Async detection of whether agent is using API key or Max subscription — critical for accurate cost calculation                                     | Commit `51817016`                                                                     |

**Why this matters:** Running multiple agents on dedicated VMs means costs add up fast. This overhaul gives full visibility into where tokens and dollars are going, per-agent and per-project.

---

## 4. Auto Run — Token Visibility & Progress Tracking

Enhanced the Auto Run batch execution system with comprehensive real-time statistics.

| Change                            | Details                                                                                                                             | Key Files                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **Real-Time Token Stats in Pill** | Auto Run pill now shows live token counts (input + output) for the currently running task                                           | Commit `9eb7a0bf`                          |
| **Subagent Token Display**        | When Auto Run spawns subagents (e.g., `claude-code` calls from an autorun agent), their tokens are tracked and displayed separately | Commits `8021bd03`, `680bbbe2`             |
| **Cumulative Token Display**      | Running totals across all documents in a batch, with "Current" vs cumulative labeling                                               | Commits `c5597b8f`, `1f46543c`             |
| **Cache Token Breakdown**         | Full cache read/creation token visibility in Auto Run display (Phase 4)                                                             | Commit `d3bad9f5`                          |
| **Polling Interval Config**       | User can now set the document polling interval in BatchRunnerModal                                                                  | Commit `fa51b84d`                          |
| **Subagent Detection**            | Auto Run detects when the executing agent spawns sub-processes and tracks them                                                      | Commit `fa51b84d`                          |
| **Stats Accuracy Overhaul**       | 7 fixes for Auto Run stats recording — exact session ID matching, proper token data for all session types                           | Commits `70238779`, `b0fe1c94`, `8fd13d71` |

**Why this matters:** Auto Run is the primary way to execute multi-step plans across VMs. Knowing exactly how many tokens each step costs — including subagent costs — is critical for budget management.

---

## 5. Group Chat Enhancements

Several quality-of-life improvements to multi-agent collaboration.

| Change                       | Details                                                                                                            | Key Files                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| **Thinking Toggle**          | New toggle in Group Chat to show/hide streaming AI reasoning (thinking tokens) from moderator and participants     | Commit `778634ce`              |
| **Agent Working Label**      | Shows which agent is currently working by name in the working indicator, instead of generic "working..."           | Commit `21a05f65`              |
| **Default Thinking Setting** | Global setting for whether Group Chat shows thinking by default                                                    | Commit `1d34718d`              |
| **@Mention Fixes**           | Fixed markdown bold formatting in @mention extraction; handle parenthetical session names like `agent-1 (VM-east)` | Commits `e1e933da`, `24921040` |

---

## 6. Prompt Library — New Feature

Built a complete save/reuse system for prompts.

| Change                         | Details                                                                                  | Key Files                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Full CRUD**                  | Save, load, edit, delete prompts with IPC handler registration                           | `src/renderer/components/PromptLibrary/`, `src/main/ipc/handlers/` |
| **Project Folder Integration** | Prompt Library pills show Project Folder context                                         | Commit `2fafe152`                                                  |
| **Keyboard Shortcuts**         | `Cmd+Shift+L` opens/closes Prompt Library; Escape closes without dismissing parent modal | Commits `021c7704`, `4b0a95a7`                                     |
| **Toast Notifications**        | Success/error feedback on prompt operations with auto-refresh                            | Commit `8a40b949`                                                  |

---

## 7. Token Display & Pill Fixes

Extensive work making the status pills accurate across all agent types and connection methods.

| Change                             | Details                                                                                    | Key Files                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------ |
| **Per-Tab Cumulative Tracking**    | Token stats now accumulate correctly per-tab, never decrease (important for long sessions) | Commit `5280dec9`              |
| **Session Tokens Display**         | Fixed session-level fallback removal; shows latest response + cumulative totals            | Commits `038750b3`, `03d90965` |
| **Streaming Throughput**           | ThinkingStatusPill shows estimated tokens/second during active streaming                   | Commit `b2e1e94c`              |
| **Cycle Bytes Fix**                | `currentCycleBytes` now updates during streaming for real-time display in yellow pill      | Commit `9ebf9077`              |
| **Cumulative Usage Normalization** | Fixed usage normalization for all agents (not just Codex) — prevents double-counting       | Commit `4fd009f0`              |

---

## 8. UI Enhancements & Polish

A large batch of UI improvements (11 enhancements + 16 iterative fixes in one commit alone).

| Change                         | Details                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------ |
| **Like/Dislike Buttons**       | AI response feedback buttons for rating agent output quality                                | Commit `0549c5e0`              |
| **Global Statistics in About** | Enhanced Global Statistics section with SSH remote support and Usage Dashboard integration  | Commit `81a58a6f`              |
| **Synopsis Toggle**            | Global setting to enable/disable automatic synopsis generation                              | Commit `520810f0`              |
| **Synopsis SSH Fix**           | Prevented premature synopsis triggering during SSH streaming delays                         | Commit `838b0352`              |
| **Group Management**           | Visible rename/delete icons on groups; non-empty groups can now be deleted                  | Commit `16ed8b04`              |
| **Pricing Model Updates**      | Default model updated to Opus 4.5; Opus 4.6 short-form model IDs resolved for cost tracking | Commits `ee613dd7`, `ed7a5dae` |

---

## 9. Documentation Overhaul

Comprehensive refresh of all project documentation.

| Change                          | Details                                                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **New Codebase Context**        | Full `Codebase_Context_20260217_180422.md` — 44KB comprehensive analysis reflecting all 186 commits       | `/app/Maestro/Codebase_Context_20260217_180422.md`                 |
| **Core MD File Investigation**  | Analyzed all 17 `*.md` files for staleness, accuracy, and agent-helpfulness                               | `/app/Maestro/__PLANS/INV_CORE_MD_FILES_UPDATE_20260217_181559.md` |
| **All 16 MD Files Regenerated** | Every core doc archived to `__MD_ARCHIVE/` and replaced with updated versions reflecting current codebase | `/app/Maestro/*.md`, `/app/Maestro/__MD_ARCHIVE/`                  |

---

## Summary by the Numbers

| Metric                          | Count                                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Total commits on fork           | 186                                                                                                        |
| Feature commits (`feat:`)       | ~50                                                                                                        |
| Bug fix commits (`fix:`)        | ~90                                                                                                        |
| New components created          | 15+                                                                                                        |
| New IPC handlers added          | 10+                                                                                                        |
| Database migrations             | 2 (v5: cache tokens, v6: agent_id)                                                                         |
| New UI features                 | Project Folders, Prompt Library, Audit, Agent Cost Graph, Throughput Charts, Like/Dislike, Synopsis Toggle |
| SSH-specific fixes              | ~25 commits                                                                                                |
| Documentation files regenerated | 17                                                                                                         |

---

## Architecture Note

All of this work stems from one fundamental topology decision: **one dedicated micro-VM per AI agent, all connected via SSH Remote**. This means:

- Every agent spawn is an SSH connection → SSH pooling and ControlMaster became essential
- Every Group Chat participant may be on a different VM → SSH remote participants/moderators needed full support
- Every output stream passes through SSH → bash warning filtering became critical
- Every token costs real money across multiple accounts → dual-cost tracking and audit became necessary
- Multiple projects run simultaneously across VMs → Project Folders provide the organizational layer
- Auto Run orchestrates work across VMs → per-task and subagent token tracking gives cost visibility

The fork enhances Maestro's core strengths (keyboard-first multi-agent management) while making it production-ready for distributed, SSH-based agent topologies.

---

## 10. Challenges, Open Work & Known Concerns

The pace of development (186 commits in ~17 days) has delivered substantial functionality, but several areas remain incomplete, require further investigation, or raise concerns that should be addressed before these changes could be considered production-stable.

### 10.1 The Cost Tracking Saga — Hard-Won Accuracy

Getting cost tracking right across SSH remote agents, multiple billing modes, and cumulative vs per-request usage patterns was by far the most labor-intensive effort on the fork. The `__AUTORUN/__ARCHIVE/` directory contains **30 sequential COST-GRAPH-FIX-** documents (FIX-01 through FIX-30), each addressing a different failure mode discovered during testing. Key issues encountered:

- **Session ID mismatches** between Maestro's internal session IDs and Claude's `agentSessionId` — especially across SSH remotes where path encoding differs
- **Billing mode ambiguity** — API key vs Max subscription users report costs differently, and SSH remote agents may use different Anthropic accounts than local agents. A hybrid detection system was built but required multiple iterations (`FIX-30-BillingMode-HybridDetection.md`)
- **Cumulative vs delta token reporting** — different agents (Claude Code, Codex, OpenCode) report usage differently. Normalization logic was needed and refined across several commits
- **Cache token double-counting** — `cache_read_input_tokens` were being included inside `input_tokens` by some agents, requiring careful regex-based extraction

**What remains:**

- **Opus 4.6 Pricing Bug** (`INV_OPUS-4-6-PRICING-BUG.md`): Investigation complete but code fix not yet implemented. Opus 4.6 sessions currently record $0.00 for both `anthropic_cost_usd` and `maestro_cost_usd` due to two independent bugs: (1) short-form model ID aliases aren't mapped to pricing table entries, and (2) the Anthropic cost fallback calculation path has a gap
- **Zero-Value Averaging** (`__DELAYED/FIX-ZERO-VALUE-AVERAGING.md`): Throughput averages include zero-value rows (from failed queries, old records, or short queries), deflating displayed averages. Ready to implement but deferred
- **Retroactive Data Backfill** (`__DELAYED/RETROACTIVE-DATA-BACKFILL.md`): Historical sessions from before cache token tracking and agent_id attribution was added could be backfilled from Claude's JSONL session files. Investigation complete, implementation deferred

### 10.2 SSH Error Handling — Connection Storms

The SSH error handling investigation (`INV_SSH-ERROR-HANDLING-INVESTIGATION.md`) identified a fundamental issue: without connection pooling, Maestro opens a new SSH connection for every operation against a remote VM. During Auto Run or Group Chat with multiple SSH participants, this creates "connection storms" that can overwhelm SSH daemons and produce cascading errors in the UI.

**Partial fix deployed:** SSH ControlMaster pooling was enabled (commit `b6fd8fbe`), which shares a single SSH connection per host. However, the investigation identified 3 additional phases that remain unimplemented:

- **Phase 1 — Error routing:** SSH errors currently surface as generic agent errors without distinguishing connection failures from agent failures. Session ID-based error filters and recovery logic are needed
- **Phase 2 — Source tagging:** An `errorContext` field should be added to the `AgentError` type to distinguish SSH transport errors from agent-level errors
- **Phase 3 — SSH health monitoring:** No UI indicator exists for SSH connection health. A connection health widget would prevent users from sending work to disconnected VMs

**Concern:** The ControlMaster socket files (`/tmp/maestro-ssh-*`) need cleanup on app startup and crash recovery. Stale sockets from previous sessions can block new connections.

### 10.3 OTEL Telemetry & Usage Limits — The Flush Gap

The Claude Global Token Usage investigation (`INV_ClaudeGlobalTokenUsageStatistics_investigation.md`) was one of the most ambitious efforts — attempting to track real-time Claude.ai usage limits (5-hour windows, weekly Opus quotas) by integrating Honeycomb telemetry data. A complete Honeycomb board with 13 queries and 5 calculated fields was built.

**Critical discovery:** An OTEL flush gap exists where idle Claude sessions don't flush their telemetry data to Honeycomb. This creates a blind spot: tokens consumed but not yet reported. In a multi-VM topology with many concurrent sessions, this gap means the usage tracking can significantly undercount actual consumption.

**What remains:**

- Honeycomb board query time ranges are all wrong (defaulting to 2h instead of 30d/12w)
- Calculated fields use hardcoded epoch timestamps that need dynamic approaches
- A local token ledger (to buffer unflushed OTEL data) was proposed but not built
- The MCP integration to surface Honeycomb data in Maestro's UI was never started
- Empirical limit discovery (correlating usage with rate-limit events) is still needed

### 10.4 Large File SSH Stats Collection

When scanning SSH remote VMs for session statistics, some Claude session JSONL files exceed the 10MB `maxBuffer` limit, causing stats collection to silently fail for those sessions (`LARGE-FILE-SSH-STATS.md`). A hybrid approach was recommended (normal read for small files, remote-side `grep` parsing for large ones) but **implementation has not started** and awaits user approval.

### 10.5 UI Enhancements — Partially Completed Batch

The UI Feature Enhancements investigation (`INV_UI-FEATURE-ENHANCEMENTS-PLAN.md`) analyzed 11 features. Auto Run documents were generated and executed for all 11, but the resulting implementation required 16 iterative fix rounds (UIENHANCEMENTS-FIX-01 through FIX-16). While the features are functional, some areas warrant attention:

- **Lockable Tabs** — Implemented but the UX for locked tab behavior during batch operations may need refinement
- **Knowledge Graph** — Canvas-based MindMap component was built to replace React Flow, but the feature's utility in a multi-VM context hasn't been validated
- **Dark/Light Mode Auto-Switch** — Implemented as theme auto-switching, but interaction with the Custom Theme Builder may have edge cases
- **Process Monitor / Auto Run Progress Bar** — Progress tracking works but the "estimated time remaining" calculation is rough

### 10.6 Stats Database — Migration Complexity

The stats database has undergone two schema migrations since the fork:

- **Migration v5:** Added `cache_read_input_tokens`, `cache_creation_input_tokens`, `total_cost_usd` columns
- **Migration v6:** Added `agent_id` column for per-instance attribution

Additionally, two new tables were added: `audit_snapshots` and `audit_schedule` for the Anthropic audit feature.

**Concern:** These migrations alter a SQLite database that runs in WAL mode with integrity checks and corruption recovery. While the migrations have been tested, there's no rollback path — if a migration fails mid-way on a user's machine, the recovery behavior hasn't been extensively tested. The existing corruption recovery (`PRAGMA integrity_check`, weekly VACUUM) may not handle a partially-migrated schema gracefully.

### 10.7 App.tsx Growth

`App.tsx` has grown from ~451KB to ~468KB (13,943 lines) during this fork. It remains the single largest file in the codebase by a wide margin, serving as the orchestration hub for the entire UI. Every new feature (Project Folders, Prompt Library, Auto Run enhancements) adds state, handlers, and provider wrappers to this file. While this is an inherited architectural choice (not introduced by the fork), the fork has accelerated the growth.

**Concern:** At nearly 14,000 lines, `App.tsx` is well beyond what most editors and AI coding agents can effectively reason about in a single context window. This creates a practical ceiling for agent-assisted development — agents frequently need to re-read the file in chunks, miss cross-cutting concerns, or produce edits that conflict with distant sections of the same file.

### 10.8 Upstream Sync Status

The fork has been synchronized with upstream once (commit `45540700`, February 1 — "Merge upstream refactoring and port token metrics to new module structure"). Since then, 16 days and ~180 commits have diverged. Key areas of potential merge conflict with upstream:

- **Process manager** — heavily modified for SSH pooling and hybrid billing
- **Stats database** — two new migrations, new tables, new columns
- **Preload scripts** — many new modules added
- **App.tsx** — extensive modifications to an already-complex file
- **New features** (Project Folders, Prompt Library, Audit) — entirely new subsystems with no upstream counterpart

A future upstream merge will require careful conflict resolution, particularly in IPC handlers, stats DB, and App.tsx. The longer the fork diverges, the more difficult this becomes.

### 10.9 Incomplete Auto Run Documents

The `__AUTORUN/__ARCHIVE/` directory contains **154 completed Auto Run documents**, demonstrating heavy use of the batch execution system. However, several investigation plans have not yet been converted to Auto Run documents for execution:

| Investigation                  | Status                                           | Blocking Factor                                             |
| ------------------------------ | ------------------------------------------------ | ----------------------------------------------------------- |
| Opus 4.6 Pricing Fix           | Code fix designed, no Auto Run created           | Needs review of fix approach                                |
| SSH Error Routing (Phases 1-3) | Phases identified, no Auto Run created           | Phase 0 (ControlMaster) was done; remaining phases deferred |
| OTEL Flush Gap Mitigation      | Approach proposed, no Auto Run created           | Requires Honeycomb MCP integration design                   |
| Large File SSH Stats           | Hybrid approach recommended, no Auto Run created | Awaiting implementation option approval                     |
| Retroactive Data Backfill      | Approach designed, deferred                      | Low priority — historical accuracy                          |
| Zero-Value Averaging           | Fix designed, deferred                           | Low priority — cosmetic accuracy                            |

---

---

# Work Completed: February 17 – March 16, 2026

**Commits in this period:** 417
**Major themes:** App.tsx decomposition, upstream merge (v0.15.2), SSH hardening completion, security hardening, git worktree integration, GPU monitoring, and many community PRs merged.

---

## 11. App.tsx Decomposition — The Big Refactor

The single largest engineering effort in this period: decomposing `App.tsx` from ~14,000 lines to ~4,000 lines through systematic hook extraction and Zustand store migration. This was a prerequisite for the upstream merge.

| Phase          | Change                              | Lines Extracted | Key Files Created                                |
| -------------- | ----------------------------------- | --------------- | ------------------------------------------------ |
| **Phase 2C**   | Extract `useModalHandlers`          | ~335 lines      | `src/renderer/hooks/useModalHandlers.ts`         |
| **Phase 2D**   | Extract `useWorktreeHandlers`       | ~1,139 lines    | `src/renderer/hooks/useWorktreeHandlers.ts`      |
| **Phase 2E**   | Extract `useSessionRestoration`     | —               | `src/renderer/hooks/useSessionRestoration.ts`    |
| **Phase 2F**   | Extract `useInputKeyDown`           | —               | `src/renderer/hooks/useInputKeyDown.ts`          |
| **Phase 2G**   | Extract `useAppInitialization`      | —               | `src/renderer/hooks/useAppInitialization.ts`     |
| **Phase 2H**   | Extract `useSessionLifecycle`       | —               | `src/renderer/hooks/useSessionLifecycle.ts`      |
| **Phase 2I**   | Extract `useBatchHandlers`          | —               | `src/renderer/hooks/useBatchHandlers.ts`         |
| **Phase 2J**   | Extract `useInputHandlers`          | —               | `src/renderer/hooks/useInputHandlers.ts`         |
| **Phase 2K**   | Extract `useRemoteHandlers`         | —               | `src/renderer/hooks/useRemoteHandlers.ts`        |
| **Phase 2.5**  | Extract `useMergeTransferHandlers`  | —               | `src/renderer/hooks/useMergeTransferHandlers.ts` |
| **Phase 2.6**  | Extract `useFileExplorerEffects`    | —               | `src/renderer/hooks/useFileExplorerEffects.ts`   |
| **Tier 2**     | Extract 10 inline hooks             | ~947 lines      | Various                                          |
| **Tier 3**     | Extract inline functions            | ~238 lines      | Module-level utilities                           |
| **Tier 1**     | Component self-sourcing from stores | ~209 lines      | Components read stores directly                  |
| **Phase 3A-C** | Store subscription migration        | Props → Zustand | RightPanel, SessionList, MainPanel               |

Additionally, `useWizardHandlers` (~1,130 lines), `useInterruptHandler` (~400 lines), `useSessionCrud` (~300 lines), and `useAgentConfiguration` were extracted in parallel tracks.

**Result:** App.tsx reduced from ~14,000 lines to ~4,000 lines. All components now self-source from Zustand stores instead of receiving 100+ props. This architectural change was critical for enabling the upstream merge.

---

## 12. Upstream Merge — v0.15.2 Integration

Successfully merged upstream Maestro v0.15.2 into the fork — a 7-phase operation spanning state management migration, component restructuring, and full fork feature restoration.

| Phase        | Change                                                                                              | Key Impact                    |
| ------------ | --------------------------------------------------------------------------------------------------- | ----------------------------- |
| **Phase 0**  | Install Zustand, establish test baselines                                                           | 23,355 tests passing baseline |
| **Phase 1A** | Create 4 core Zustand stores (notification, UI, modal, session)                                     | Replace React Context         |
| **Phase 1B** | Create 7 remaining Zustand stores (groupChat, batch, agent, operation, fileExplorer, tab, settings) | Complete state migration      |
| **Phase 1C** | Migrate all context consumers, delete old contexts                                                  | Providers removed             |
| **Phase 2**  | Decompose SessionList, SettingsModal; consolidate GroupChat modals                                  | Match upstream structure      |
| **Phase 3**  | Add shared agent metadata modules, upstream type additions                                          | Bridge type systems           |
| **Phase 4**  | Merge upstream/main (v0.15.2), resolve all conflicts                                                | Core merge                    |
| **Phase 5**  | Fix test failures, resolve type errors, stabilize                                                   | Build green                   |
| **Phase 6**  | Restore all fork-specific features lost during merge                                                | 42 issues fixed               |

**Post-merge audits identified 42 discrete issues** across two Delta Reports:

- 2 P0 issues (Project Folders UI removed, drag-drop stub)
- 12 P1 TODO stub handlers in App.tsx (pin, rate, save, effort, model, git rescan, etc.)
- 3 P0.5 broken features (synopsisEnabled guard, group chat thinking, editAgentSession sync)
- 7 P1 lost features (model checker, batch onComplete, SSH warning, gitRoot arg, ToolType compat, Aider support)
- 17+ P2 fork default values overwritten by upstream
- 3 P2 degraded features (capacity resume, safety valve shortcut, tab reopen index)

All 42 issues were resolved and verified through targeted code audits.

---

## 13. SSH Hardening — Completing the Infrastructure

The SSH error routing work identified as incomplete in Section 10.2 was fully implemented in this period.

| Change                                          | Details                                                                                                                          | Key Files                                 |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **Error Source Tagging**                        | Added `errorContext` and `spawnContext` fields to `AgentError` for distinguishing SSH transport errors from agent-level errors   | Commit `78c645c5`                         |
| **Unified SSH Options**                         | Consolidated SSH option constants into `ssh-options.ts` with dedicated MASTER, BASE, COMMAND, and AGENT configurations           | `src/main/utils/ssh-options.ts`           |
| **Pre-Flight Validation**                       | SSH connections validated before command execution; blocks until ControlMaster established                                       | `ssh-socket-cleanup.ts`                   |
| **Health Monitor**                              | Background 60s health checks with 3-failure backoff and 5-minute cooldown                                                        | `src/main/services/ssh-health-monitor.ts` |
| **ControlMaster Socket Race Fix**               | Dedicated ControlMaster establishment to eliminate socket race condition on parallel SSH connections                             | Commit `bef8dd32`                         |
| **SSH Resilience (ARDs 28-30)**                 | `not_found` error handling, batch validation, ControlMaster blocking wait, connection refused retry                              | Commit `b204d158`                         |
| **SSH Tuning (ARDs 31-35)**                     | Test modernization, p-limit CJS fix for concurrency limiter                                                                      | Commit `42c24452`                         |
| **SSH False-Positive Elimination (ARDs 36A-C)** | Pattern tightening, config loss fixes, context groomer SSH support                                                               | Commit `a176f6aa`                         |
| **SSH File Tree Optimization**                  | Debounce guard, AbortController cancellation, socket validation cache (30s TTL), single-command `find -printf` file tree loading | Commit `e9dacffa`                         |
| **SSH Agent Detection on Remotes**              | Detect npm/nvm-installed agents on SSH remotes; fix NVM semantic version sorting                                                 | Commits `607b75b8`, `6b0380eb`            |
| **SSH Session Browser 10x Speedup**             | Optimized SSH remote session scanning from 12s to 1.1s                                                                           | Commit `2aafe6fc`                         |

**Status of Section 10.2 items:**

- Phase 1 (Error routing): **COMPLETED** — errorContext/spawnContext tagging
- Phase 2 (Source tagging): **COMPLETED** — intelligent error routing
- Phase 3 (SSH health monitoring): **COMPLETED** — background health checks with UI status reporting

---

## 14. Security Hardening

A comprehensive security hardening pass was performed, addressing multiple OWASP categories.

| Change                               | Details                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------- | ----------------- |
| **Content Security Policy**          | Added CSP headers to renderer; extracted inline scripts to external files | Commit `08b8cd03` |
| **BrowserWindow Sandbox**            | Enabled sandbox mode, navigation lockdown, permission denial              | Commit `b2c94f10` |
| **DOMPurify Integration**            | Defense-in-depth sanitization for markdown `allowRawHtml` paths           | Commit `c3c4094b` |
| **Stored XSS Prevention**            | Removed `allowRawHtml` from HistoryDetailModal and AIOverviewTab          | Commit `fb52efb6` |
| **Path Traversal Guards**            | Added path traversal protection to marketplace handler file reads         | Commit `7ee177a2` |
| **Protocol Whitelist**               | `shell:openExternal` restricted to http/https/mailto only                 | Commit `59db4416` |
| **Attachment Path Traversal & SSRF** | Fixed path traversal in attachments and SSRF in `fetchImageAsBase64`      | Commit `0253a89c` |
| **Read-Only Enforcement**            | Gemini `-y` flag in read-only mode, `readOnlyCliEnforced` field           | Commit `79c68e67` |

---

## 15. Git Worktree Integration for Auto Run

A major new feature allowing Auto Run batch executions to dispatch work into isolated git worktrees, with automatic PR creation.

| Change                        | Details                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| **WorktreeRunSection UI**     | New section in BatchRunnerModal with worktree selector, create-new default, loading states                         | 12+ commits                    |
| **PR Auto-Creation**          | Automatic PR creation when worktree-dispatched Auto Runs complete; handles existing-open and existing-closed cases | Commit `5e2bbb0c`              |
| **Worktree Lifecycle**        | "Create New Worktree" and "Open Closed Worktree" execution modes                                                   | Commit `19689b10`              |
| **Stats Threading**           | Symphony stats tracking wired through batch run lifecycle                                                          | Commit `b9084bf3`              |
| **Race Condition Prevention** | Eliminated duplicate worktree entries on parallel creation, Windows path normalization                             | Commits `7193964e`, `99072e44` |

---

## 16. Git Infrastructure Improvements

Extensive git feature work beyond worktrees.

| Change                          | Details                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------ |
| **Subdirectory Git Scanning**   | Recursive git repo detection in subdirectories with race condition guards and SSH timeout | Commit `cdf058f9`              |
| **Bare Repo Detection**         | Proper detection and branch icon display for bare git repositories                        | ARDs 21-27                     |
| **Re-scan for Git Repo**        | New button in Edit Agent dialog to re-detect git root at runtime                          | Commit `e6805f70`              |
| **Git Log Viewer SSH Support**  | Fixed Git Log Viewer for SSH remote sessions; pipe escaping with ASCII Record Separator   | Commits `80a88761`, `d1944cea` |
| **Dot-Prefixed Subdirectories** | Git repo scanner now allows `.maestro` and other dot-prefixed directories                 | Commit `ce66147e`              |
| **Cross-Fork PR Discovery**     | Symphony fork-aware PR creation with deferred base branch handling                        | Commit `3f3e57c6`              |

---

## 17. GPU Monitoring Panel

New feature for monitoring GPU utilization and local model performance.

| Change                    | Details                                                                         | Key Files         |
| ------------------------- | ------------------------------------------------------------------------------- | ----------------- |
| **Full GPU Panel**        | GPU monitoring with Ollama integration and macOS macmon (Apple Silicon) support | Commit `0bcbcf68` |
| **macOS PATH Fix**        | Augmented PATH for Dock-launched Electron apps so macmon is discoverable        | Commit `52b11a95` |
| **Memory Gauge Fallback** | Node.js `os` module fallback when native memory APIs unavailable                | Commit `bc68e842` |
| **Ollama Host URL Fix**   | Protocol prefix handling and model legend layout                                | Commit `90dd30f3` |

---

## 18. Honeycomb MCP Integration

Full integration of Honeycomb observability data into the Maestro Usage Dashboard via MCP (Model Context Protocol).

| Change                          | Details                                                                  |
| ------------------------------- | ------------------------------------------------------------------------ | ------------------------------ |
| **MCP-Based Honeycomb Client**  | Dual-mode query client supporting both direct API and MCP-proxied access | 40+ HONEYCOMB-MCP ARDs         |
| **Usage Dashboard Enhancement** | Warnings, capacity checks, calibration improvements, budget bars         | Commits `b32b3695`, `0ca5b63d` |
| **5-Hour Window Alignment**     | Aligned to Anthropic billing boundaries for accurate limit tracking      | Commit `9934ce7a`              |
| **Inline Budget Bars**          | Model & Effort status line shows inline Honeycomb budget utilization     | Commit `f195753d`              |
| **Free Token Tracking**         | Free token exclusion from divergence tables, HC tooltips                 | 10+ commits                    |
| **Calibration UX**              | Dynamic dot sizing, sliding window anchor drift fix, normalized weights  | Multiple commits               |

---

## 19. Tab & Keyboard Enhancements

| Change                           | Details                                                               |
| -------------------------------- | --------------------------------------------------------------------- | ----------------- |
| **Recently Closed Tabs**         | "Recently Closed" view in Tab Switcher with persistent history        | Commit `6b5e0b61` |
| **Cmd+0 Remap**                  | Jump to last tab; `Cmd+Shift+0` for font size reset                   | Commit `fbd02cd5` |
| **Confirm Before Close**         | Confirmation dialog when closing tabs with unsent drafts              | Commit `ed9dff75` |
| **Font Size Shortcuts**          | Restored `Cmd+/-` font size shortcuts lost when custom menu was added | Commit `cc0fadad` |
| **Window Chrome Settings**       | Consolidated unified tab helpers with window chrome configuration     | Commit `b0584010` |
| **Bookmark Toggle & Long-Press** | Tab bookmark toggle and long-press actions for remote control         | Commit `e61c8be8` |

---

## 20. Model & Pricing Infrastructure

| Change                              | Details                                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------ |
| **Claude Sonnet 4.6 Support**       | Full pricing model entry and detection                                                    | Commit `84b54f77`              |
| **Model Detection on Startup**      | Auto-detect new Claude models on app launch with toast suppression for legacy models      | Commits `ce02927b`, `3a51b456` |
| **Externalized Pricing**            | Model pricing moved from hardcoded TypeScript to runtime-updateable JSON store            | Commit `baf41bbb`              |
| **SSH $HOME Expansion**             | Fixed model/effort settings resolution for SSH remotes                                    | Commit `2ca94ecf`              |
| **Codex Model Selection**           | Model selection support for Codex agent with turn.failed error handling                   | Commit `580fd8bb`              |
| **Capability-Based Feature Gating** | Replaced agent-specific feature checks with capability-based system using shared metadata | Commit `1dcbc9f1`              |

---

## 21. Symphony Fork Support

Full fork-aware workflow support for Symphony (the PR-based contribution system).

| Change                      | Details                                              |
| --------------------------- | ---------------------------------------------------- | ----------------- |
| **Fork Detection**          | `ensureForkSetup` utility with fork detection types  | Commit `d64cf57c` |
| **IPC Integration**         | Fork setup wired into Symphony IPC handlers          | Commit `0e2967b1` |
| **Runner Service**          | Fork support integrated into Symphony runner service | Commit `4640182e` |
| **Completion Handlers**     | Fork-aware completion handlers with workflow logging | Commit `5f0dc0f2` |
| **Cross-Fork PR Discovery** | Deferred PR base branch handling across forks        | Commit `3f3e57c6` |

---

## 22. Community Contributions Merged

Numerous community PRs were merged during this period:

| PR             | Contributor   | Change                                      |
| -------------- | ------------- | ------------------------------------------- |
| **#399**       | jeffscottward | Fix Codex duplicate flags                   |
| **#401**       | kianhub       | README team page link                       |
| **#404**       | RunMaestro    | Code refactor (App.tsx decomposition)       |
| **#405**       | chr1syy       | Global environment variables                |
| **#411**       | chr1syy       | Fix double worktree entries                 |
| **#413**       | RunMaestro    | Security hardening                          |
| **#414**       | RunMaestro    | Codex turn.failed + model selection         |
| **#416**       | chr1syy       | Fix reveal label                            |
| **#425**       | jeffscottward | Markdown list alignment                     |
| **#427**       | jeffscottward | React doctor cleanup phase 1                |
| **#428**       | chr1syy       | Fix top bar                                 |
| **#430**       | RunMaestro    | Hook architecture                           |
| **#439**       | kianhub       | Global stats cleanup                        |
| **#444**       | RunMaestro    | Worktree from Auto Run                      |
| **#450**       | —             | 0.15.0-RC polish                            |
| **#506**       | kianhub       | Focus input on mode toggle                  |
| **#519**       | chr1syy       | OpenCode multi-step result fix              |
| **#524**       | chr1syy       | CLI OpenCode Droid                          |
| **#533**       | chr1syy       | Symphony fork support                       |
| **#537**       | openasocket   | Read-only enforcement                       |
| **#538**       | openasocket   | Parser single parse                         |
| **#542**       | kianhub       | Duplicate files clean                       |
| **#546, #550** | RunMaestro    | Capability-based gating, provider hardening |
| **#553**       | jeffscottward | SSH remote CLI output                       |
| **#555**       | jeffscottward | Node 22 os import constants                 |

---

## 23. Additional Fixes & Polish

| Change                           | Details                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------- |
| **NDJSON Hot Path**              | Eliminated triple JSON parsing on NDJSON processing hot path                                                       | Commit `79dd8a85` |
| **File Tree Fixes**              | `.maestro` always visible; auto-refresh timer fix; NFC Unicode normalization for duplicates; stale load prevention | Multiple commits  |
| **UI Performance**               | Render optimization, event consolidation, debug cleanup to reduce UI lag                                           | Commit `68bd7440` |
| **Sentry Crash Fixes**           | Debug logging, clipboard, markdown details crash resolution                                                        | Commit `4bc38a6a` |
| **Light Theme Contrast**         | Improved syntax highlighting and color contrast in light mode                                                      | Commit `bbc242bb` |
| **Draft Input Preservation**     | Draft input preserved when replaying a previous message                                                            | Commit `cc0fadad` |
| **Directory Collision Warning**  | Skip warning when agents are on different hosts                                                                    | Commit `385b99fd` |
| **Global Environment Variables** | Full implementation with settings UI, SSH/PTY integration, validation, tests                                       | 15+ commits       |
| **OpenCode Integration**         | Fix multi-step result drops, JSON error event preservation, prompt separator fix                                   | Multiple commits  |
| **Wizard Inline Improvements**   | Pasted images support, user-scroll-aware auto-scroll                                                               | Commit `264ca005` |
| **CI/CD**                        | Added lint, format checks, test suite, and build:prompts to CI; husky pre-push hooks                               | Multiple commits  |

---

## Updated Summary by the Numbers

| Metric                           | Through Feb 17 | Through Mar 16        |
| -------------------------------- | -------------- | --------------------- |
| Total commits on fork            | 186            | 603+                  |
| Feature commits                  | ~50            | ~120                  |
| Bug fix commits                  | ~90            | ~250                  |
| Refactor commits                 | ~10            | ~90                   |
| New hooks extracted from App.tsx | 0              | 15+                   |
| App.tsx lines                    | ~14,000        | ~4,000                |
| Community PRs merged             | 0              | 25+                   |
| Auto Run documents in archive    | 154            | 250+                  |
| SSH-specific commits             | ~25            | ~77                   |
| Security hardening commits       | 0              | 8                     |
| Upstream merges                  | 1 (v0.13.x)    | 2 (v0.13.x + v0.15.2) |

---

## Updated Status of Previously Open Items (Section 10)

| Item                                  | Previous Status  | Current Status                                                                    |
| ------------------------------------- | ---------------- | --------------------------------------------------------------------------------- |
| **10.2 SSH Error Routing Phases 1-3** | Unimplemented    | **COMPLETED** — error source tagging, health monitor, pre-flight validation       |
| **10.7 App.tsx Growth (~14K lines)**  | Concern raised   | **RESOLVED** — decomposed to ~4,000 lines via 15+ hook extractions                |
| **10.8 Upstream Sync**                | 16 days diverged | **RESOLVED** — v0.15.2 merge completed (7-phase operation, 42 issues fixed)       |
| **10.9 Opus 4.6 Pricing Fix**         | Unimplemented    | **RESOLVED** — Sonnet 4.6 added, externalized pricing, model detection on startup |
| **10.3 OTEL Flush Gap**               | Proposed         | **PARTIALLY RESOLVED** — Honeycomb MCP integration built, calibration UX complete |
| **10.4 Large File SSH Stats**         | Unimplemented    | **RESOLVED** — SSH session browser 10x speedup (12s → 1.1s)                       |
| **10.5 UI Enhancements**              | Partially done   | **COMPLETED** — all 16 fix rounds done                                            |
| **10.9 Zero-Value Averaging**         | Deferred         | Still deferred                                                                    |
| **10.9 Retroactive Data Backfill**    | Deferred         | Still deferred                                                                    |

---

## Summary

This fork has matured from a local-first multi-agent manager to a production-grade distributed orchestration platform. The February 17 – March 16 period delivered three transformational changes: (1) the App.tsx decomposition from 14,000 to 4,000 lines via 15+ hook extractions and Zustand store migration, (2) a successful upstream merge with v0.15.2 including full restoration of all 42 fork features lost during merge, and (3) comprehensive SSH hardening completing all three previously-unfinished error routing phases plus a new file tree optimization layer. Additionally, the security posture was significantly improved with CSP, sandbox, DOMPurify, path traversal guards, and protocol whitelisting. The platform now supports git worktree-based Auto Run dispatching with automatic PR creation, GPU monitoring, Honeycomb MCP integration for usage tracking, and has incorporated 25+ community PRs. The remaining deferred items (zero-value averaging, retroactive data backfill) are low-priority cosmetic improvements.
