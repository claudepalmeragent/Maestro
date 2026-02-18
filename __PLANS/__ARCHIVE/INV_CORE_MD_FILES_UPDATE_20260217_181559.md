---
type: analysis
title: Investigation of Core MD Files - Currency, Accuracy, and Update Recommendations
created: 2026-02-17
tags:
  - documentation
  - investigation
  - codebase-analysis
related:
  - "[[Codebase_Context_20260217_180422]]"
  - "[[CODEBASE-ANALYSIS-MAESTRO]]"
---

# INV: Core MD Files Update Investigation

**Generated:** 2026-02-17 18:15 UTC
**Scope:** All `*.md` files in `/app/Maestro/` (top-level only)
**Context:** 183 commits since 2026-01-31 (the last modification date for most files)
**Current Version:** v0.14.5

---

## Executive Summary

18 top-level MD files were analyzed. Most were last modified on 2026-01-31 and are significantly out of date after 183 commits of active development. The codebase underwent major structural refactoring (agent module consolidation, IPC handler extraction, process manager modularization, stats DB expansion, and 15+ new feature systems). The most critical documentation gaps affect AI agent productivity: wrong file paths in ARCHITECTURE.md, CONTRIBUTING.md, and AGENT_SUPPORT.md will cause agents to navigate to non-existent locations.

### Priority Matrix

| Priority | Files | Impact |
|---|---|---|
| **Critical** | ARCHITECTURE.md, CONTRIBUTING.md, AGENT_SUPPORT.md | Wrong file paths, wrong test runner, missing 15+ features |
| **High** | CLAUDE.md, CLAUDE-IPC.md, CLAUDE-SESSION.md, CLAUDE-AGENTS.md | Stale paths, missing API namespaces, deprecated fields |
| **Medium** | CLAUDE-FEATURES.md, CLAUDE-WIZARD.md, CLAUDE-PATTERNS.md | Wrong component tech (React Flow → Canvas), missing wizard step |
| **Low** | README.md, SECURITY.md, THEMES.md, CONSTITUTION.md, BACKBURNER.md | Minor count errors, thin content |
| **Archive** | Codebase_Context_20260212.md | Superseded by Feb 17 version |
| **Current** | Codebase_Context_20260217_180422.md | Brand new, accurate |

---

## File-by-File Analysis

---

### 1. CLAUDE.md

| Attribute | Value |
|---|---|
| **Size** | 9,264 bytes / 210 lines |
| **Last Modified** | 2026-01-31 |
| **Commits Since** | 183 |
| **Helpfulness Rating** | 6/10 |

**Purpose:** Master index/entry-point for AI agents. Covers project overview, architecture diagram, quick commands, key-files lookup table, debugging tips, and MCP server info.

#### What's Out of Date

**Architecture Diagram — 7 stale file paths:**

| Doc Says | Actual Location |
|---|---|
| `src/main/process-manager.ts` | `src/main/process-manager/ProcessManager.ts` (directory with runners/, spawners/, handlers/) |
| `src/main/preload.ts` | `src/main/preload/index.ts` (directory with 27 module files) |
| `src/main/agent-detector.ts` | `src/main/agents/detector.ts` |
| `src/main/agent-capabilities.ts` | `src/main/agents/capabilities.ts` |
| `src/main/agent-session-storage.ts` | `src/main/agents/session-storage.ts` |
| `src/main/web-server.ts` | `src/main/web-server/WebServer.ts` (directory) |
| `src/main/stats-db.ts` | `src/main/stats/stats-db.ts` |

**Key Files Table — 5 stale paths:**
- "Add IPC handler" → `src/main/preload.ts` should be `src/main/preload/index.ts`
- "Add setting" → `src/renderer/hooks/useSettings.ts` should be `src/renderer/hooks/settings/useSettings.ts`
- "Configure agent" → wrong paths (see above)
- "Add agent session storage" → wrong path (see above)
- "Add stats/analytics feature" → wrong path (see above)

**Supported Agents Table — 3 missing agents:**
- `gemini-cli` (placeholder)
- `qwen3-coder` (placeholder)
- `aider` (placeholder)

**Architecture Diagram — Missing directories:** `src/main/agents/`, `src/main/process-listeners/`, `src/main/group-chat/`, `src/main/app-lifecycle/`, `src/main/debug-package/`, `src/main/stores/`, `src/main/services/`, `src/main/stats/`, `src/types/`, `src/generated/`.

#### What's Correct
- Quick commands section (npm scripts)
- Debugging tips
- Standardized vernacular
- Documentation Index (all cross-referenced files exist)
- MCP server info

#### Update Recommendations
1. Rewrite the architecture diagram to reflect modular subdirectory structure
2. Fix all 5 stale paths in Key Files table
3. Add gemini-cli, qwen3-coder, aider to Supported Agents table
4. Add missing directories to the tree
5. Cross-reference [[Codebase_Context_20260217_180422]] for detailed architecture

#### Preventing Duplicate Work
- Point agents to [[Codebase_Context_20260217_180422]] for the authoritative directory tree and feature inventory
- CLAUDE.md should remain a lightweight index, not duplicate the full architecture

---

### 2. CLAUDE-PATTERNS.md

| Attribute | Value |
|---|---|
| **Size** | 8,175 bytes / 254 lines |
| **Last Modified** | 2026-01-31 |
| **Commits Since** | 183 |
| **Helpfulness Rating** | 7/10 |

**Purpose:** Documents 10 implementation patterns: process management, security, settings, modals, themes, multi-tab sessions, execution queue, Auto Run, tab hover overlay, SSH remote.

#### What's Out of Date

1. **Settings path wrong:** `src/renderer/hooks/useSettings.ts` → actual: `src/renderer/hooks/settings/useSettings.ts`
2. **AITab interface significantly stale:** Shows `draftInput?: string` which no longer exists. The real field is `inputValue: string`. Missing 20+ fields including `starred`, `locked`, `agentError`, `usageStats`, `cumulativeUsageStats`, `createdAt`, `state`, `readOnlyMode`, `showThinking`, `hasUnread`, `wizardState`, etc.
3. **`session.terminalPid`** documented as active; actually always 0 (deprecated)
4. **`agentSessionId` type** documented as `string | undefined`; actually `string | null`

#### What's Correct
- Security requirements (`execFileNoThrow` pattern)
- Modal + layer stack pattern
- SSH Remote pitfall documentation
- Auto Run / playbook asset conventions
- Tab Hover Overlay implementation guide

#### Update Recommendations
1. Fix useSettings.ts path
2. Replace AITab snippet with current interface or link to `src/renderer/types/index.ts`
3. Mark `terminalPid` as legacy/always-zero
4. Change `draftInput` to `inputValue`
5. Fix `agentSessionId` type to `string | null`

---

### 3. CLAUDE-IPC.md

| Attribute | Value |
|---|---|
| **Size** | 3,362 bytes / 86 lines |
| **Last Modified** | 2026-01-31 |
| **Commits Since** | 183 |
| **Helpfulness Rating** | 4/10 |

**Purpose:** Documents the `window.maestro.*` API surface organized into thematic groups.

#### What's Out of Date

**18 of ~40 API namespaces are completely missing:**

| Missing Namespace | Description |
|---|---|
| `context` | Context merge operations |
| `sshRemote` | SSH remote config management |
| `groupChat` | Group chat (multi-agent) |
| `speckit` | Spec-Kit command API |
| `openspec` | OpenSpec command API |
| `marketplace` | Playbook exchange |
| `debug` | Debug package API |
| `audit` | Audit API |
| `reconstruction` | Historical reconstruction |
| `leaderboard` | Leaderboard API |
| `projectFolders` | Project folders API |
| `promptLibrary` | Prompt library API |
| `knowledgeGraph` | Knowledge graph API |
| `feedback` | Feedback API |
| `shell` | Shell API |
| `sync` | Sync API |
| `updates` | App update management |
| `app` | App lifecycle API |

**Stale reference:** Implies `preload.ts` as a single file; actual path is `src/main/preload/index.ts` (directory).

**History storage path:** macOS-specific; should be platform-agnostic.

#### What's Correct
- History API TypeScript signature (most detailed section)
- High-level namespace grouping concept

#### Update Recommendations
1. Add all 18 missing namespaces with at least one-line descriptions
2. Add TypeScript signatures for the 5 most commonly used namespaces
3. Note that preload is now a directory pattern
4. Make storage paths platform-agnostic
5. List IPC push events (`stats:updated`, `documentGraph:filesChanged`, etc.)

---

### 4. CLAUDE-SESSION.md

| Attribute | Value |
|---|---|
| **Size** | 3,507 bytes / 106 lines |
| **Last Modified** | 2026-01-31 |
| **Commits Since** | 183 |
| **Helpfulness Rating** | 5/10 |

**Purpose:** Documents the Session interface (abbreviated), AITab interface, and code conventions.

#### What's Out of Date

**Session interface missing 30+ fields:** Including `aiLogs`, `shellCwd`, `remoteCwd`, `worktreeConfig`, `parentSessionId`, `worktreeBranch`, `fileTreeStats`, `activeTimeMs`, `nudgeMessage`, `wizardState`, `customPath`, `customArgs`, `customModel`, `customProviderPath`, `currentCycleTokens`, `currentCycleBytes`, `busySource`, `batchRunnerPrompt`, `sshRemote`, `sessionSshRemoteConfig`, and many more.

**AITab `draftInput` → `inputValue`:** Concrete bug that produces broken code if an agent follows this.

**`agentSessionId` on Session** is deprecated in code but not marked as such in docs.

#### What's Correct
- Code conventions (TypeScript strict, functional components, commit messages)
- Note that interface is "abbreviated" (though agents may not realize how abbreviated)

#### Update Recommendations
1. Add prominent note: "See `src/renderer/types/index.ts` for the authoritative full definition"
2. Correct `draftInput` to `inputValue`
3. Mark `agentSessionId` on Session as deprecated
4. Add worktree fields, agent override fields, and `activeTimeMs`/`nudgeMessage`

---

### 5. CLAUDE-AGENTS.md

| Attribute | Value |
|---|---|
| **Size** | 3,315 bytes / 73 lines |
| **Last Modified** | 2026-01-31 |
| **Commits Since** | 183 |
| **Helpfulness Rating** | 5/10 |

**Purpose:** Covers supported agents, capability flags, per-agent CLI details, and the workflow for adding new agents.

#### What's Out of Date

**3 missing agents:** `gemini-cli`, `qwen3-coder`, `aider` (all defined in `src/main/agents/definitions.ts`).

**7 missing capability flags:** `supportsImageInputOnResume`, `requiresPromptToStart`, `supportsModelSelection`, `supportsStreamJsonInput`, `supportsThinkingDisplay`, `supportsContextMerge`, `supportsContextExport`. The doc shows 12; actual interface has 19.

**Wrong file paths:** `src/main/agent-capabilities.ts` → `src/main/agents/capabilities.ts`; `src/main/agent-detector.ts` → `src/main/agents/detector.ts`.

**Stale note:** "Additional `ToolType` values (`aider`, `claude`) are defined in types but not yet implemented in `agent-detector.ts`" — `aider` IS now in definitions.ts, `agent-detector.ts` no longer exists.

#### What's Correct
- Agent CLI flags and binary names
- YOLO mode notes
- General adding-agents workflow (conceptually sound)

#### Update Recommendations
1. Add 3 missing agents to the table
2. Add all 7 missing capabilities
3. Fix all file path references to `src/main/agents/` directory
4. Update the adding-agents workflow to reference `definitions.ts` and `capabilities.ts`
5. Remove stale note about `aider`/`claude` in types

---

### 6. CLAUDE-FEATURES.md

| Attribute | Value |
|---|---|
| **Size** | 6,079 bytes / 175 lines |
| **Last Modified** | 2026-01-31 |
| **Commits Since** | 183 |
| **Helpfulness Rating** | 4/10 |

**Purpose:** Documents Usage Dashboard and Document Graph features.

#### What's Out of Date

**Document Graph completely rewritten:**
- Doc says "uses React Flow" — actual implementation uses a canvas-based MindMap component (`MindMap.tsx`)
- Layout function names are wrong: doc shows `animateLayoutTransition`, `animateNodesEntering`, `animateNodesExiting` — actual exports are `createLayoutTransitionFrames`, `createNodeEntryFrames`, `createNodeExitFrames`, `mergeAnimatingNodes`, `positionNewNodesNearNeighbors`
- `DEFAULT_MAX_NODES` documented as 50; actual is 200
- Architecture tree lists `DocumentNode.tsx`, `ExternalLinkNode.tsx`, `NodeBreadcrumb.tsx` which are orphaned/unused
- **`MindMap.tsx`** (the core rendering engine) is entirely absent from docs

**Usage Dashboard missing 11 component files:** `AgentCostGraph.tsx`, `AgentThroughputChart.tsx`, `AgentUsageChart.tsx`, `AuditReportPanel.tsx`, `CostByModelGraph.tsx`, `CostOverTimeGraph.tsx`, `LocationDistributionChart.tsx`, `PeakHoursChart.tsx`, `ReconstructionPanel.tsx`, `SessionStats.tsx`, `ThroughputTrendsChart.tsx`.

**Backend stats path wrong:** `src/main/stats-db.ts` → `src/main/stats/stats-db.ts` (multi-file module).

**useSettings.ts path wrong:** Should be `src/renderer/hooks/settings/useSettings.ts`.

#### What's Correct
- Usage Dashboard tab structure overview
- Real-time update pattern concept

#### Update Recommendations
1. Rewrite Document Graph section entirely — replace React Flow with canvas/MindMap
2. Update layout algorithm function names
3. Update DEFAULT_MAX_NODES to 200
4. Add MindMap.tsx to architecture tree; remove orphaned React Flow components
5. Add all 11 new UsageDashboard components
6. Fix stats and useSettings paths

---

### 7. CLAUDE-PERFORMANCE.md

| Attribute | Value |
|---|---|
| **Size** | 8,294 bytes / 263 lines |
| **Last Modified** | 2026-01-31 |
| **Commits Since** | 183 |
| **Helpfulness Rating** | 9/10 |

**Purpose:** React and Node.js performance best practices: memoization, debouncing, batching, virtual scrolling, IPC parallelization, visibility-aware operations.

#### What's Out of Date

Very minor issues only:
1. Hardcoded 150ms batching interval — should reference `DEFAULT_BATCH_FLUSH_INTERVAL` constant name
2. Virtual scrolling documented only for `HistoryPanel.tsx` — also used in `FileExplorerPanel.tsx`
3. Electron 28 DevTools workaround described without noting the app is still on Electron 28.3.3 (so it remains relevant)

#### What's Correct
- All cited hook paths exist and export correct functions
- All pattern descriptions are accurate
- Code examples are illustrative and correct

#### Update Recommendations
1. Add `DEFAULT_BATCH_FLUSH_INTERVAL` constant name alongside the 150ms value
2. Note FileExplorerPanel.tsx also uses virtual scrolling
3. Clarify that Electron 28 is the current version (DevTools workaround is active, not theoretical)

---

### 8. CLAUDE-WIZARD.md

| Attribute | Value |
|---|---|
| **Size** | 7,844 bytes / 202 lines |
| **Last Modified** | 2026-01-31 |
| **Commits Since** | 183 |
| **Helpfulness Rating** | 6/10 |

**Purpose:** Documents Onboarding Wizard and Inline Wizard features.

#### What's Out of Date

**Missing 5th wizard step:** Doc describes 4 steps; actual `WIZARD_TOTAL_STEPS = 5` with `preparing-plan` as step 4 (auto-generates documents, no user input, advances automatically).

**All line number citations are stale** (drifted by 20+ lines due to 183 commits). Examples:
- `openWizard()` at `WizardContext.tsx:528-535` → actual: ~548-555
- `WizardContext.tsx:791` → actual: ~799-827

**Architecture tree missing 9+ files:** `ExistingAutoRunDocsModal.tsx`, `ExistingDocsModal.tsx`, `screens/PreparingPlanScreen.tsx`, `services/austinFacts.ts`, `services/fillerPhrases.ts`, `services/shuffle.ts`, `services/wizardErrorDetection.ts`, `shared/DocumentEditor.tsx`, `shared/DocumentSelector.tsx`.

**InlineWizard missing 7 components:** `GenerationCompleteOverlay.tsx`, `StreamingDocumentPreview.tsx`, `WizardConfidenceGauge.tsx`, `WizardExitConfirmDialog.tsx`, `WizardMessageBubble.tsx`, `WizardModePrompt.tsx`, `WizardPill.tsx`.

**`wizardCompleted` setting** listed in Related Settings but does not exist in useSettings.ts.

#### What's Correct
- General conceptual flow (state management, resume logic, tour system)
- Inline wizard behaviors
- `openWizard()` logic (correct content, wrong line numbers)

#### Update Recommendations
1. Add `preparing-plan` as step 4
2. Remove all line number citations; replace with grep-friendly identifiers
3. Update architecture trees for both Wizard/ and InlineWizard/
4. Add `ExistingAutoRunDocsModal.tsx`, `ExistingDocsModal.tsx`, `shared/` subdirectory
5. Remove `wizardCompleted` from Related Settings or add it to useSettings
6. Fix useSettings.ts path

---

### 9. ARCHITECTURE.md

| Attribute | Value |
|---|---|
| **Size** | 51,159 bytes / ~1,400 lines |
| **Last Modified** | 2026-01-31 |
| **Commits Since** | 183 |
| **Helpfulness Rating** | 4/10 |

**Purpose:** Deep-dive technical reference covering dual-process Electron architecture, IPC security model, process management, and all major feature systems.

#### What's Out of Date

**Main process directory structure is completely wrong.** Documents flat files; actual structure has been heavily refactored into subdirectories: `agents/`, `ipc/handlers/` (33 files), `parsers/`, `storage/`, `process-manager/` (with runners/, spawners/, handlers/), `stats/`, `services/`, `app-lifecycle/`, `preload/` (directory), `web-server/` (directory), `stores/`, `group-chat/` (expanded), `process-listeners/`.

**`window.maestro` API table missing 14+ namespaces:** `sshRemote`, `power`, `marketplace`, `documentGraph`, `stats`, `audit`, `reconstruction`, `leaderboard`, `projectFolders`, `knowledgeGraph`, `feedback`, `context`, `promptLibrary`, and more.

**Hooks count wrong:** Doc claims "15 hooks"; actual count is ~65+ hooks organized in 12+ subdirectories.

**Modal priority table severely outdated:** Doc lists ~25 entries; actual `modalPriorities.ts` has ~55 entries. Many documented values are wrong (e.g., `RENAME_TAB` is 875 not 880; `BATCH_RUNNER` is 720 not 660).

**Themes count wrong:** Doc says 12; actual is 17 (missing `pedurple`, `maestros-choice`, `dre-synth`, `inquest`, `custom`).

**15 major features completely undocumented:** Onboarding Wizard, Usage Dashboard, Document Graph, SSH Remote Manager, Context Management, Spec-Kit/OpenSpec, Prompt Library, Marketplace, Power Manager, Auto Updater, Audit Service, Historical Reconstruction, Leaderboard, Stats DB, Gist Publishing.

**Shared module incomplete:** Lists 5 files; actual has 20+ files.

#### What's Correct
- Conceptual explanations (Group Chat flow, Layer Stack, Auto Run execution logic, IPC patterns)
- Dual-process architecture description
- Security model concepts

#### Update Recommendations
1. Rewrite main process directory table for modular structure
2. Expand `window.maestro` API table with all missing namespaces
3. Update hooks section to reflect subdirectory organization and actual count
4. Replace entire modal priority table with current contents
5. Add sections for all 15 missing features
6. Update themes list to 17
7. Update shared module file listing
8. Cross-reference [[Codebase_Context_20260217_180422]] throughout

---

### 10. CONTRIBUTING.md

| Attribute | Value |
|---|---|
| **Size** | 33,337 bytes / ~900 lines |
| **Last Modified** | 2026-01-31 |
| **Commits Since** | 183 |
| **Helpfulness Rating** | 6/10 |

**Purpose:** Developer onboarding guide covering setup, project structure, development scripts, testing, common tasks, code style, and PR process.

#### What's Out of Date

**Test runner is wrong:** Documents Jest; actual is Vitest. Wrong flags: `npm test -- --watch` should be `npm run test:watch`; `--testPathPattern` should be Vitest syntax `-t`.

**Node.js requirement wrong:** Says "Node.js 20+"; actual `engines.node` is `>=22.0.0`.

**Missing test scripts:** `test:e2e`, `test:e2e:ui`, `test:e2e:headed`, `test:integration`, `test:integration:watch`, `test:performance`.

**Missing build step:** `npm run build:prompts` (runs `scripts/generate-prompts.mjs`) is not documented but runs before both build and dev.

**Missing scripts:** `npm run format`, `npm run format:check`.

**Agent file paths changed:** `src/main/agent-capabilities.ts` → `src/main/agents/capabilities.ts`; `src/main/agent-detector.ts` → `src/main/agents/detector.ts`.

**Project structure tree incomplete:** Missing `src/main/ipc/`, `src/main/agents/`, `src/generated/`, `src/main/stores/`, `src/main/stats/`, `src/main/services/`, refactored `src/main/process-manager/`.

**Parser registration pattern outdated:** Shows manual switch-case; actual uses `registerOutputParser()` registry.

#### What's Correct
- Patterns for adding modals, settings, keyboard shortcuts, themes
- Agent integration guide (conceptually)
- Code style guidelines
- PR process

#### Update Recommendations
1. Fix test runner from Jest to Vitest with correct CLI flags
2. Update Node.js prerequisite to 22+
3. Add all missing test and build scripts
4. Add `build:prompts` step
5. Fix agent file paths
6. Update project structure tree
7. Update parser registration to registry pattern

---

### 11. README.md

| Attribute | Value |
|---|---|
| **Size** | 10,565 bytes / ~280 lines |
| **Last Modified** | 2026-01-31 |
| **Commits Since** | 183 |
| **Helpfulness Rating** | 7/10 |

**Purpose:** Public-facing project introduction with features, quick start, keyboard shortcuts, screenshots.

#### What's Out of Date

1. **Theme count wrong:** Says "12 themes"; actual is 17
2. **Achievement rank count uncertain:** Says "11 conductor-themed ranks"; ARCHITECTURE says 15 — needs verification
3. **Node.js 22+ not in Requirements** for building from source
4. **Missing features in feature list:** SSH Remote Agents, Prompt Library, Spec-Kit/OpenSpec, Context Management, Auto Updater, Leaderboard
5. **CONTRIBUTING.md reference slightly misleading:** Says it contains "architecture details" — those are in ARCHITECTURE.md

#### What's Correct
- Feature descriptions for listed features
- Quick start guide
- Keyboard shortcuts
- Agent support list (Claude Code, Codex, OpenCode)
- Installation instructions

#### Update Recommendations
1. Fix theme count to 17
2. Verify and fix achievement rank count
3. Add Node.js 22+ to Requirements
4. Add SSH Remote Agents to Power Features
5. Fix CONTRIBUTING.md reference

---

### 12. AGENT_SUPPORT.md

| Attribute | Value |
|---|---|
| **Size** | 29,575 bytes / ~800 lines |
| **Last Modified** | 2026-01-31 |
| **Commits Since** | 183 |
| **Helpfulness Rating** | 5/10 |

**Purpose:** Developer guide for adding new AI coding agent support. Covers pluggable architecture, capability model, step-by-step integration, per-agent reference.

#### What's Out of Date

1. **All agent file paths wrong:** References `src/main/agent-detector.ts` and `src/main/agent-capabilities.ts` — actual: `src/main/agents/detector.ts`, `src/main/agents/capabilities.ts`, `src/main/agents/definitions.ts`
2. **Parser registration step wrong:** Shows manual switch-case `getOutputParser()` factory; actual uses `registerOutputParser(new YourParser())` in `initializeOutputParsers()` at `src/main/parsers/index.ts`
3. **Missing agent from reference section:** Aider is defined in `definitions.ts` but has no reference entry
4. **Capability count stale:** Shows 13 flags; actual interface has 19
5. **OpenCode status says "Stub Ready"** — likely outdated given active development
6. **Codex context window contradiction:** Listed as 128K in one place and 200,000 in the context window table

#### What's Correct
- Architecture description and integration pattern (conceptually)
- Per-agent CLI flag details
- Context window configuration concept

#### Update Recommendations
1. Fix all file paths to `src/main/agents/` directory
2. Rewrite Step 5 with `registerOutputParser()` registry pattern
3. Add Aider reference section
4. Update capability interface to 19 flags
5. Resolve 128K vs 200K Codex contradiction
6. Update OpenCode status

---

### 13. CONSTITUTION.md

| Attribute | Value |
|---|---|
| **Size** | 6,767 bytes / ~180 lines |
| **Last Modified** | 2026-01-31 |
| **Commits Since** | 183 |
| **Helpfulness Rating** | 9/10 |

**Purpose:** Philosophical and design principles: six core tenets, design principles, pre-ship checklist.

#### What's Out of Date

Very minor:
1. Information Architecture section doesn't mention Project Folders (a new first-class UI surface above Groups)
2. No mention of Group Chat as a mode of multi-agent interaction

#### What's Correct
- All six tenets remain accurate and relevant
- Visual language and interaction patterns
- "What Maestro Is Not" section
- The Maestro Test (6-question checklist)

#### Update Recommendations
1. Add Project Folders to the Information Architecture section
2. Optionally mention Group Chat in the Conductor's Perspective tenet

---

### 14. BACKBURNER.md

| Attribute | Value |
|---|---|
| **Size** | 1,656 bytes / ~40 lines |
| **Last Modified** | 2026-01-31 |
| **Commits Since** | 183 |
| **Helpfulness Rating** | 4/10 |

**Purpose:** Tracks disabled/dormant features behind feature flags.

#### What's Out of Date

1. Only tracks one item (LLM Settings Panel, disabled 2024-11-26)
2. Verified: `LLM_SETTINGS: false` is still set in `SettingsModal.tsx` line 62
3. No new dormant features documented despite 183 commits
4. Does not note whether LLM Settings conflicts with or complements newer features (Prompt Library, Anthropic Audit)

#### What's Correct
- The single documented item is accurate and verified

#### Update Recommendations
1. Audit codebase for other feature flags or conditionally disabled features
2. Note whether LLM Settings is still being considered or can be retired
3. Add any newly disabled/deferred features

---

### 15. SECURITY.md

| Attribute | Value |
|---|---|
| **Size** | 4,485 bytes / ~120 lines |
| **Last Modified** | 2026-01-31 |
| **Commits Since** | 183 |
| **Helpfulness Rating** | 8/10 |

**Purpose:** Security policy: vulnerability reporting, scope, response timeline, known considerations, contributor patterns.

#### What's Out of Date

1. **`execFileNoThrow`** — should verify function name is unchanged (likely still correct)
2. **Missing note about deprecated `window.maestro.claude.*` namespace** — still exists, emits console warnings, represents reduced attack surface goal
3. Gemini CLI and Qwen3 Coder listed as "integrated agents" in out-of-scope section — they're actually still placeholders

#### What's Correct
- Reporting channels
- In-scope vs out-of-scope definitions
- Process execution, web server, IPC, Sentry considerations
- Contributor security patterns
- Tunnel feature description

#### Update Recommendations
1. Verify `execFileNoThrow` function name
2. Add note about deprecated `window.maestro.claude.*` namespace
3. Clarify gemini-cli/qwen3-coder as placeholder status

---

### 16. THEMES.md

| Attribute | Value |
|---|---|
| **Size** | 2,830 bytes / ~70 lines |
| **Last Modified** | 2026-01-31 |
| **Commits Since** | 183 |
| **Helpfulness Rating** | 6/10 (as visual reference) |

**Purpose:** Visual gallery with screenshots of all built-in themes.

#### What's Out of Date

1. **"Custom" theme missing:** `src/shared/themes.ts` defines 17 themes; THEMES.md shows 16. Custom theme has a builder UI (`CustomThemeBuilder.tsx`)
2. **Minor capitalization:** "Github" in doc vs "GitHub" in code

#### What's Correct
- All 16 named themes listed correctly with screenshots
- Category organization (Dark, Light, Vibes)

#### Update Recommendations
1. Add Custom theme entry (explain it's user-configurable via Theme Builder)
2. Fix "Github" → "GitHub"

---

### 17. Codebase_Context_20260212.md (OLD)

| Attribute | Value |
|---|---|
| **Size** | 28,810 bytes |
| **Last Modified** | 2026-02-12 |
| **Commits Since** | ~50 (between Feb 12 and Feb 17) |
| **Helpfulness Rating** | 3/10 (superseded) |

**Purpose:** Previous codebase context analysis.

#### Status
**Superseded** by `Codebase_Context_20260217_180422.md`. Key differences:
- Uses old flat file paths (`src/main/agent-detector.ts` etc.)
- Lists only 4 stats DB tables (actual: 7)
- Shows App.tsx at ~451KB (actual: 468KB)
- Lists 9 contexts (actual: 11)
- Does not cover agents/ directory reorganization
- Missing Project Folders, Audit, Knowledge Graph, Prompt Library, Billing Mode, Feedback features

#### Update Recommendations
- Archive this file (Task 10 will handle this)
- Do NOT use as reference — use Feb 17 version instead

---

### 18. Codebase_Context_20260217_180422.md (NEW)

| Attribute | Value |
|---|---|
| **Size** | 44,551 bytes |
| **Last Modified** | 2026-02-17 (today) |
| **Commits Since** | 0 (brand new) |
| **Helpfulness Rating** | 10/10 |

**Purpose:** Comprehensive codebase context document generated by Task 8 of the current analysis run.

#### Status
**Brand new and current.** This is the most accurate and complete reference document in the repository.

**Verified current coverage includes:**
- Correct `src/main/agents/` directory (6 files)
- App.tsx at 468KB / 13,943 lines
- All 7 stats DB tables including `audit_snapshots` and `audit_schedule`
- All 9 electron-store instances
- 32 IPC handler modules, ~340 channels
- All major new features (Project Folders, Anthropic Audit, Knowledge Graph, Feedback, Prompt Library, Billing Mode, SSH ControlMaster Pooling)
- 7 defined agent IDs with 19 capability flags
- Deprecated `window.maestro.claude.*` namespace documented
- "Changes Since 2026-01-31" summary section
- Parser registration via `initializeOutputParsers()` / `registerOutputParser()` pattern
- PTY vs child_process selection logic
- DataBufferManager 50ms/8KB batching
- Stats DB dual-cost COALESCE pattern
- Web server on-demand startup gotcha

#### Update Recommendations
- None needed — this is the authoritative reference
- All other MD files should cross-reference this document

---

## Cross-Document Consistency Issues

| Issue | Affected Documents |
|---|---|
| Agent file paths (old monolith vs new `agents/` dir) | CLAUDE.md, CLAUDE-AGENTS.md, AGENT_SUPPORT.md, ARCHITECTURE.md, CONTRIBUTING.md, Codebase_Context_20260212.md |
| Parser registration (switch-case vs registry) | AGENT_SUPPORT.md, CONTRIBUTING.md |
| Missing agents (gemini-cli, qwen3-coder, aider) | CLAUDE.md, CLAUDE-AGENTS.md, AGENT_SUPPORT.md |
| Theme count (12 vs 16 vs 17) | README.md, ARCHITECTURE.md, THEMES.md |
| `draftInput` vs `inputValue` | CLAUDE-SESSION.md, CLAUDE-PATTERNS.md |
| useSettings.ts path | CLAUDE.md, CLAUDE-PATTERNS.md, CLAUDE-FEATURES.md, CLAUDE-WIZARD.md |
| Test runner (Jest vs Vitest) | CONTRIBUTING.md |
| Node.js version (20 vs 22) | CONTRIBUTING.md, README.md |
| Achievement rank count (11 vs 15) | README.md, ARCHITECTURE.md |
| Capability flag count (12/13 vs 19) | CLAUDE-AGENTS.md, AGENT_SUPPORT.md |

---

## Recommendations to Prevent Agents from Recreating Investigative Work

### 1. Establish a Single Source of Truth Hierarchy

```
Codebase_Context_YYYYMMDD.md (authoritative context)
  └── CLAUDE.md (lightweight index pointing to sub-docs)
       ├── CLAUDE-PATTERNS.md (implementation patterns)
       ├── CLAUDE-IPC.md (API surface)
       ├── CLAUDE-SESSION.md (data model)
       ├── CLAUDE-AGENTS.md (agent config)
       ├── CLAUDE-FEATURES.md (feature guides)
       ├── CLAUDE-PERFORMANCE.md (performance)
       └── CLAUDE-WIZARD.md (wizard system)
```

### 2. Add Cross-Reference Headers

Every CLAUDE-*.md file should include at its top:
```markdown
> For the complete, authoritative codebase context, see [[Codebase_Context_YYYYMMDD_HHMMSS]].
> This document covers specific patterns/APIs for [topic].
```

### 3. Prefer Code References Over Snapshots

Instead of pasting interface definitions (which drift), reference the source file:
```markdown
See `src/renderer/types/index.ts` for the full Session and AITab interfaces.
```

### 4. Use Grep-Friendly Identifiers Instead of Line Numbers

Replace `WizardContext.tsx:528` with `search for 'const openWizard'` — line numbers are guaranteed to drift.

### 5. Date-Stamp All Structural Claims

Any claim about counts, directory structure, or file lists should include a date:
```markdown
As of 2026-02-17, there are 19 agent capability flags in `AgentCapabilities`.
```
This lets future agents know when the claim was last verified.

### 6. Link New Investigative Work Back

When an agent produces investigative reports (like this one), they should be referenced from the relevant CLAUDE-*.md files so future agents discover them instead of re-investigating.

---

## Summary Statistics

| Metric | Value |
|---|---|
| Total files analyzed | 18 |
| Files last modified 2026-01-31 | 15 |
| Files modified after 2026-01-31 | 3 (both Codebase_Context files + none) |
| Commits since most files were updated | 183 |
| Files rated 7/10 or higher | 5 (CONSTITUTION, SECURITY, README, CLAUDE-PERFORMANCE, new Codebase_Context) |
| Files rated 5/10 or lower | 7 (CLAUDE-IPC, CLAUDE-FEATURES, ARCHITECTURE, BACKBURNER, CLAUDE-SESSION, CLAUDE-AGENTS, old Codebase_Context) |
| Total stale file path references | 15+ across all documents |
| Missing API namespaces in CLAUDE-IPC | 18 of ~40 |
| Missing agents across all docs | 3 (gemini-cli, qwen3-coder, aider) |
| Missing capability flags | 7 (of 19 total) |
