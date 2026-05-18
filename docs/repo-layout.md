# `docs/repo-layout.md` — single source of filesystem truth

This document describes **where every kind of file lives** in the AgenticStacks monorepo. If a file's location is unclear, this doc is the tiebreaker.

---

## 1. Bare repo + worktree topology

We use a **bare-repo + sibling-worktrees** layout so each Maestro Agent VM operates on its own worktree (its own branch) without stepping on other agents' work.

```text
/app/                                          # parent dir; not itself a git workspace
├── .git-repo/                                 # the BARE git repo (contains all branches, refs, objects)
├── maestro-planner/                     		# worktree on branch 'maestro-planner'  ← this VM (Opus 4.7[1M])
├── maestro-dev-1/                       		# worktree on branch 'maestro-dev-1'    (local Ollama micro-VM)
├── maestro-dev-2/                       		# ...
├── maestro-dev-3/                       		# ...
├── maestro-dev-4/                       		# worktree on branch 'maestro-dev-4'    (cloud Sonnet micro-VM)
├── maestro-dev-5/                       		# ...
├── maestro-dev-6/                       		# ...
└── maestro-moderator/                   		# worktree on branch 'maestro-moderator' (cloud Haiku, group-chat moderator)
```

**Naming rule:** `worktree directory name == git branch name == Maestro Agent VM name`. One worktree per Agent VM, one branch per worktree. Agents see only their own worktree directory.

**Git hooks are shared across all worktrees.** Git resolves hooks via `$GIT_COMMON_DIR/hooks/`, which for our topology is `/app/.git-repo/hooks/` (the bare repo). A single `pre-commit install` from any one worktree installs hooks (`pre-commit`, `pre-push`, `commit-msg`, etc.) for ALL worktrees. Do NOT re-run `pre-commit install` per worktree — it is a one-time, repo-wide operation. Verify hooks via `ls /app/.git-repo/hooks/`, NOT via `ls /app/<worktree>/.git/hooks/` (the per-worktree `.git` is a pointer file, not a directory).

**Bootstrap commands:**

```bash
# Initial setup (run once on the host that holds the bare repo)
mkdir -p /app
cd /app
git init --bare --initial-branch=main .git-repo

# Create the planner worktree (and the initial main branch)
git --git-dir=/app/.git-repo worktree add --orphan -b main maestro-planner

# Add a new agent worktree (do this once per Agent VM; Agent VM is given access to ONLY its own worktree)
git --git-dir=/app/.git-repo worktree add ../maestro-dev-1 -b maestro-dev-1
```

**Per-worktree git operations:** inside any worktree, plain `git push`/`git pull`/`git fetch` work normally — they target the bare repo at `.git-repo/` automatically (each worktree's `.git` file points back to it).

### Bare-repo config invariant: NO `[user]` block

`/app/.git-repo/config` **MUST NOT** contain a `[user]` section. Author identity comes from the global git config (`~/.gitconfig`) on each VM, set during provisioning to the canonical GitHub creds (`claudepalmeragent / claude.palmer.agent@gmail.com`). Per-agent / per-model attribution lives in the `Co-Authored-By:` trailer of each commit message, driven by Maestro template substitution at commit time — never in the Author field.

**Why this matters:** because all worktrees share the same bare repo, any `[user]` block in `/app/.git-repo/config` overrides the global config for every commit produced by every agent — silently misattributing dev-N work to whatever identity the override carries. Git config precedence is *system → global → repo (bare) → worktree*, with the bare-repo layer winning over the global one.

**Audit-after-restore.** If a VM's home directory is ever restored from a tarball (e.g., to preserve Claude memory across re-provisioning), audit `/app/.git-repo/config` afterward and remove any injected `[user]` section:

```bash
# Inspect
cat /app/.git-repo/config

# If a [user] block is present, strip it
git config -f /app/.git-repo/config --remove-section user

# Verify fall-through to global config
cd /app/maestro-planner
git config --get user.name   # expect: claudepalmeragent
git config --get user.email  # expect: claude.palmer.agent@gmail.com
```

---

## 2. Per-worktree directory tree

Every worktree has the **same internal structure** (it is the same git repo, after all). The tree below is the canonical layout; depth is intentionally capped at ~3 levels for scannability — drop into the directories with `ls` for the exhaustive contents.

```text
maestro-<role>/                              # = repo root for an agent VM
│
├── .git                                     # pointer FILE (not dir) → /app/.git-repo/worktrees/<role>
├── .github/                                 # GitHub-side config
│   ├── instructions/                        # repo-scoped Copilot/agent instructions (memory.instruction.md)
│   └── workflows/                           # GitHub Actions (ci.yml, release.yml)
├── .husky/                                  # husky git-hook scripts (pre-commit, pre-push)
├── .editorconfig                            # editor indent/whitespace policy (tabs)
├── .gitignore                               # ignore rules; see Section 4 for what's excluded
├── .npmrc                                   # npm config
├── .prettierrc / .prettierignore            # prettier config
├── eslint.config.mjs                        # flat-config ESLint rules
├── postcss.config.mjs                       # PostCSS (Tailwind pipeline)
├── tailwind.config.mjs                      # Tailwind theme/content config
├── tsconfig.json                            # base TS config (renderer-ish defaults)
├── tsconfig.main.json                       # TS config for Electron main process
├── tsconfig.cli.json                        # TS config for the CLI bundle
├── tsconfig.lint.json                       # noEmit type-check config used by `npm run lint`
├── vite.config.mts                          # Vite config for renderer (desktop)
├── vite.config.web.mts                      # Vite config for web/mobile interface
├── vitest.config.mts                        # default unit-test config (jsdom)
├── vitest.integration.config.ts             # integration test config
├── vitest.e2e.config.ts                     # e2e (vitest-flavored) config
├── vitest.performance.config.mts            # perf test config
├── playwright.config.ts                     # Playwright e2e runner config
├── package.json                             # name=maestro; main=dist/main/index.js; bin=maestro-cli
├── package-lock.json
├── symphony-registry.json                   # Symphony agent registry metadata
│
├── AGENTS.md                                # symlink → CLAUDE.md
├── CLAUDE.md                                # primary agent guidance (top-level entry)
├── CLAUDE-AGENTS.md                         # supported-agents reference
├── CLAUDE-FEATURES.md                       # Usage Dashboard, Document Graph
├── CLAUDE-IPC.md                            # window.maestro.* IPC surface
├── CLAUDE-PATTERNS.md                       # core implementation patterns
├── CLAUDE-PERFORMANCE.md                    # React/perf guidelines
├── CLAUDE-PLATFORM.md                       # cross-platform concerns (Win/Mac/Linux/SSH)
├── CLAUDE-SESSION.md                        # Session interface + code conventions
├── CLAUDE-WIZARD.md                         # Wizard / Tour system
├── ARCHITECTURE.md                          # canonical architecture reference
├── AGENT_SUPPORT.md                         # detailed agent integration guide
├── CONTRIBUTING.md                          # dev contribution guide
├── CONSTITUTION.md                          # design principles
├── SECURITY.md                              # security policy
├── README.md                                # user-facing readme
├── LICENSE                                  # AGPL 3.0
├── THEMES.md                                # theme authoring notes
├── BUILDING_WINDOWS.md                      # Windows build instructions
├── SYMPHONY_ISSUES.md                       # Symphony known issues
├── SYMPHONY_REGISTRY.md                     # Symphony registry docs
├── Codebase_Context_*.md                    # autogenerated codebase snapshots
├── Maestro_Forked_FeatureUpgrades_*.md      # fork-history snapshots
├── __MD_ARCHIVE/                            # archived/timestamped older copies of the CLAUDE-*.md docs
│
├── build/                                   # electron-builder INPUTS (icons, entitlements) — NOT build OUTPUTS
│   ├── README.md
│   ├── entitlements.mac.plist               # macOS code-sign entitlements
│   ├── icon.icns / icon.ico / icon.png      # app icons (per platform)
│   ├── icon-wand.png
│   ├── archive/                             # historical icon sources
│   └── new-icon/                            # candidate icon set
│
├── docs/                                    # Mintlify documentation site (docs.runmaestro.ai)
│   ├── docs.json                            # navigation manifest
│   ├── index.md  getting-started.md  installation.md  ...
│   ├── *.md                                 # one file per user-facing topic (autorun, group-chat, etc.)
│   ├── about/overview.md
│   ├── assets/                              # docs media (non-screenshot)
│   ├── examples/                            # example payloads (local-manifest.json, …)
│   └── screenshots/                         # PNG screenshots, kebab-case names
│
├── scripts/                                 # build / maintenance Node + shell scripts
│   ├── build-cli.mjs                        # bundles src/cli → dist/cli/maestro-cli.js
│   ├── build-preload.mjs                    # bundles src/main/preload → dist/main/preload.js
│   ├── generate-prompts.mjs                 # bakes src/prompts/*.md into src/generated/
│   ├── notarize.js                          # macOS notarization (electron-builder afterSign hook)
│   ├── refresh-openspec.mjs                 # syncs OpenSpec command templates
│   ├── refresh-speckit.mjs                  # syncs Spec-Kit command templates
│   ├── set-version.mjs                      # stamps version into builds
│   ├── start-dev.ps1                        # Windows dev launcher
│   └── sync-release-notes.mjs               # release-notes sync
│
├── e2e/                                     # Playwright e2e specs (run by `npm run test:e2e`)
│   ├── autorun-*.spec.ts
│   └── fixtures/
│
└── src/                                     # ALL application source
    ├── main/                                # Electron main process (Node)
    │   ├── index.ts                         # main entry; registers IPC handlers
    │   ├── agents/                          # agent definitions, capabilities, detection, path-prober, session-storage
    │   ├── app-lifecycle/                   # window-manager, error-handlers, quit-handler, cli-watcher
    │   ├── debug-package/                   # debug-bundle generator + collectors/
    │   ├── group-chat/                      # group-chat agent, moderator, router, storage, parsers
    │   ├── ipc/handlers/                    # ~39 IPC handler modules (git, stats, autorun, marketplace, …)
    │   ├── parsers/                         # per-agent output parsers + error-patterns.ts + __tests__/
    │   ├── preload/                         # secure IPC bridge (bundled by build-preload.mjs)
    │   ├── process-listeners/               # event listeners on spawned processes (+ __tests__)
    │   ├── process-manager/                 # ProcessManager + spawners/, runners/, handlers/, utils/
    │   ├── runtime/                         # shell-env probing (getShellPath) + __tests__
    │   ├── services/                        # long-lived services (honeycomb, audit, capacity, symphony-runner, …)
    │   ├── stats/                           # SQLite-backed stats DB (schema, migrations, aggregations)
    │   ├── storage/                         # per-agent session storage (Base + claude/codex/factory-droid/opencode)
    │   ├── stores/                          # main-side settings/model-registry stores
    │   ├── utils/                           # execFile, ssh-spawn-wrapper, logger, pricing, sentry, … (+ __tests__)
    │   └── web-server/                      # embedded HTTP/WebSocket server (WebServer.ts, handlers/, routes/, services/, managers/)
    │
    ├── renderer/                            # React desktop frontend
    │   ├── App.tsx                          # main coordinator
    │   ├── assets/                          # bundled PNG assets (conductor avatars, icons)
    │   ├── components/                      # ~140 .tsx files + sub-folders: Wizard/, Settings/, History/,
    │   │                                    #   UsageDashboard/, DocumentGraph/, DirectorNotes/, InlineWizard/,
    │   │                                    #   SessionList/, common/, menus/, modals/, shared/, sidebar/, ui/
    │   ├── constants/                       # themes.ts, shortcuts.ts, modalPriorities.ts, colorblindPalettes.ts, …
    │   ├── contexts/                        # React contexts (LayerStack, GitStatus, ProjectFolders, …)
    │   ├── docs/                            # in-app help fragments (electron-app.ts)
    │   ├── hooks/                           # custom React hooks; sub-folders per domain
    │   │                                    #   (agent/, batch/, git/, keyboard/, modal/, session/, settings/, tabs/, …)
    │   ├── public/                          # static files served by Vite (splash.js, devtools-connect.js, icon.png)
    │   ├── services/                        # IPC wrappers (git, process, ipcWrapper) + contextGroomer/Summarizer
    │   ├── stores/                          # Zustand stores (agentStore, sessionStore, tabStore, settingsStore, …)
    │   ├── types/                           # renderer-only types (layer, fileTree, contextMerge)
    │   └── utils/                           # markdownConfig, remarkFileLinks, formatters, costCalculation, … (+ __tests__)
    │
    ├── web/                                 # web/mobile interface (separate Vite build)
    │   ├── components/                      # Button, Card, Input, ThemeProvider, PullToRefresh, …
    │   ├── hooks/                           # mobile-specific hooks (useWebSocket, useSwipeGestures, …)
    │   ├── mobile/                          # mobile React app (App.tsx, MessageHistory, CommandInputBar, …)
    │   ├── public/                          # PWA manifest.json, sw.js, icons/
    │   └── utils/                           # config, cssCustomProperties, serviceWorker, viewState, logger
    │
    ├── cli/                                 # CLI (`maestro-cli`) for batch automation
    │   ├── index.ts                         # CLI entry
    │   ├── commands/                        # send, list-agents, list-sessions, list-playbooks, run-playbook, …
    │   ├── output/                          # output formatters
    │   └── services/                        # playbook + batch-processing services
    │
    ├── prompts/                             # editable system prompts (.md), baked at build by generate-prompts.mjs
    │   ├── *.md                             # autorun-default, context-grooming, group-chat-*, tab-naming, wizard-*, …
    │   ├── index.ts                         # prompt registry
    │   ├── openspec/                        # OpenSpec command templates (refreshed by refresh-openspec.mjs)
    │   └── speckit/                         # Spec-Kit command templates (refreshed by refresh-speckit.mjs)
    │
    ├── shared/                              # types + utilities shared across main/renderer/web/cli
    │                                        #   agentIds.ts, agentMetadata.ts, agentConstants.ts, templateVariables.ts,
    │                                        #   themes.ts, theme-types.ts, performance-metrics.ts, group-chat-types.ts,
    │                                        #   stats-types.ts, symphony-*.ts, history.ts, pathUtils.ts, gitUtils.ts, …
    │
    ├── types/                               # ambient TS declarations (vite-raw.d.ts)
    │
    └── __tests__/                           # Vitest unit + integration tests; mirrors src/ layout
        ├── setup.ts                         # global mocks (lucide-react Proxy, ModalContext, window.maestro)
        ├── cli/                             # cli/commands/, cli/output/, cli/services/
        ├── e2e/                             # vitest-flavored e2e helpers
        ├── fixtures/                        # shared fixtures (maestro-test-image.png, …)
        ├── integration/                     # cross-layer integration tests (group-chat, remote-control, symphony, …)
        ├── main/                            # mirrors src/main/ (agents, ipc/handlers, parsers, storage, web-server, …)
        ├── performance/                     # perf-tagged tests
        ├── renderer/                        # mirrors src/renderer/ (components, hooks, stores, …)
        ├── shared/                          # tests for src/shared/
        └── web/                             # tests for src/web/ (components, hooks, mobile, utils)
```

**Notes on the tree:**

- The per-worktree `.git` is a **file**, not a directory — it points back to `/app/.git-repo/worktrees/<role>/`. Hooks resolve via `$GIT_COMMON_DIR/hooks/` (= `/app/.git-repo/hooks/`).
- `src/main/parsers/__tests__/`, `src/main/services/__tests__/`, `src/main/utils/__tests__/`, `src/renderer/hooks/batch/__tests__/`, `src/renderer/hooks/settings/__tests__/`, and `src/renderer/utils/__tests__/` are colocated test folders that exist *in addition to* the top-level `src/__tests__/` tree.
- `build/` here contains **build INPUTS** (icons, entitlements) for `electron-builder`. Compiled output (`dist/`, `release/`, `out/`) is gitignored — see Section 4.

---

## 3. File location rules

| Kind of file | Location |
|---|---|
| Electron main-process TS | `src/main/**/*.ts` |
| Electron preload (IPC bridge) | `src/main/preload/` (bundled by `scripts/build-preload.mjs` → `dist/main/preload.js`) |
| Renderer (desktop React) TS/TSX | `src/renderer/**/*.{ts,tsx}` |
| Web / mobile React TS/TSX | `src/web/**/*.{ts,tsx}` (mobile app in `src/web/mobile/`) |
| CLI TS source | `src/cli/**/*.ts` (entry: `src/cli/index.ts`) |
| Shared cross-process types/utils | `src/shared/*.ts` |
| Ambient TS declarations | `src/types/*.d.ts` |
| Unit tests (vitest, jsdom) | `src/__tests__/**` mirroring `src/` layout |
| Colocated unit tests | `src/**/__tests__/` (e.g. `src/main/parsers/__tests__/`) |
| Integration tests | `src/__tests__/integration/*.test.{ts,tsx}` (run via `vitest.integration.config.ts`) |
| Performance tests | `src/__tests__/performance/` (run via `vitest.performance.config.mts`) |
| Playwright e2e tests | `e2e/*.spec.ts` (config `playwright.config.ts`) |
| Test fixtures | `src/__tests__/fixtures/`, `e2e/fixtures/` |
| Vitest global setup / mocks | `src/__tests__/setup.ts` |
| IPC handler modules (main) | `src/main/ipc/handlers/*.ts` (registered from `src/main/ipc/handlers/index.ts` via `src/main/index.ts`) |
| Zustand stores (renderer) | `src/renderer/stores/*.ts` |
| Main-side stores | `src/main/stores/` |
| React components | `src/renderer/components/` (sub-folders per feature: `Wizard/`, `Settings/`, `UsageDashboard/`, `DocumentGraph/`, `DirectorNotes/`, `History/`, `SessionList/`, `InlineWizard/`, `common/`, `menus/`, `modals/`, `shared/`, `sidebar/`, `ui/`) |
| React hooks | `src/renderer/hooks/` (sub-folders per domain) |
| React contexts | `src/renderer/contexts/` |
| Renderer-side IPC wrappers | `src/renderer/services/` (`git.ts`, `process.ts`, `ipcWrapper.ts`, …) |
| Themes | Renderer constants: `src/renderer/constants/themes.ts`; shared types: `src/shared/themes.ts`, `src/shared/theme-types.ts` |
| Keyboard shortcuts | `src/renderer/constants/shortcuts.ts` |
| Modal priorities | `src/renderer/constants/modalPriorities.ts` |
| Assets (bundled images) | `src/renderer/assets/` (renderer), `src/web/public/icons/` (web PWA) |
| Static public files | `src/renderer/public/`, `src/web/public/` |
| Fonts | None checked in — fonts are CSS-loaded; configure via `tailwind.config.mjs` / global CSS |
| Agent definitions | `src/main/agents/definitions.ts`, capabilities in `src/main/agents/capabilities.ts`, IDs in `src/shared/agentIds.ts`, metadata in `src/shared/agentMetadata.ts` |
| Agent output parsers | `src/main/parsers/*.ts` (registered via `src/main/parsers/index.ts`) |
| Agent error patterns | `src/main/parsers/error-patterns.ts` |
| Agent session storage | `src/main/storage/*.ts` (extend `BaseSessionStorage`; registered in `src/main/storage/index.ts`) |
| System prompts (editable) | `src/prompts/*.md` (baked by `scripts/generate-prompts.mjs` into `src/generated/` at build time) |
| Spec-Kit / OpenSpec command templates | `src/prompts/speckit/`, `src/prompts/openspec/` (refreshed via `npm run refresh-speckit` / `refresh-openspec`) |
| MCP-related code | `src/main/services/honeycomb-mcp-client.ts` (Honeycomb MCP client); MCP server itself is hosted externally (`docs.runmaestro.ai/mcp`, see `CLAUDE.md` § MCP Server) |
| Mintlify docs (user-facing) | `docs/*.md`, navigation in `docs/docs.json`, screenshots in `docs/screenshots/` |
| In-app help fragments | `src/renderer/docs/` |
| Top-level agent docs (CLAUDE.md family) | Repo root: `CLAUDE.md`, `CLAUDE-*.md`, `ARCHITECTURE.md`, `AGENT_SUPPORT.md`, `CONTRIBUTING.md`, `CONSTITUTION.md`, `SECURITY.md`, `THEMES.md` |
| Archived markdown docs | `__MD_ARCHIVE/` (timestamped older copies of CLAUDE-*.md) |
| `package.json`, lockfile | Repo root |
| TypeScript configs | Repo root: `tsconfig.json`, `tsconfig.main.json`, `tsconfig.cli.json`, `tsconfig.lint.json` |
| ESLint config | Repo root: `eslint.config.mjs` (flat config) |
| Prettier config | Repo root: `.prettierrc`, `.prettierignore` |
| Vite configs | Repo root: `vite.config.mts` (renderer), `vite.config.web.mts` (web/mobile) |
| Vitest configs | Repo root: `vitest.config.mts`, `vitest.integration.config.ts`, `vitest.e2e.config.ts`, `vitest.performance.config.mts` |
| Playwright config | `playwright.config.ts` |
| PostCSS / Tailwind | `postcss.config.mjs`, `tailwind.config.mjs` |
| EditorConfig | `.editorconfig` (tabs) |
| Husky git-hook scripts | `.husky/pre-commit`, `.husky/pre-push` (installed once into `/app/.git-repo/hooks/` — see Section 1) |
| Build/maintenance scripts | `scripts/*.mjs`, `scripts/*.js`, `scripts/start-dev.ps1` |
| GitHub Actions workflows | `.github/workflows/ci.yml`, `.github/workflows/release.yml` |
| Repo-scoped Copilot/agent instructions | `.github/instructions/memory.instruction.md` |
| Electron-builder build inputs (icons, entitlements) | `build/` (icons in `build/`, `build/archive/`, `build/new-icon/`; macOS entitlements in `build/entitlements.mac.plist`) |
| Symphony registry | `symphony-registry.json` (root), code in `src/main/services/symphony-runner.ts`, types in `src/shared/symphony-*.ts` |
| Agent prompts package source (sibling) | `/app/agent-prompts/` — sibling directory of `/app/maestro-planner/`. Contains the source of truth for the package files; the deliverables are copied into the repo at the locations below. |
| Source-of-truth slash-command prompts | `docs/dev/agent-prompts.md` (copied from `/app/agent-prompts/agent-prompts.md`) |
| Commit-gate hook script | `scripts/commit-gate-check.sh` (copied from `/app/agent-prompts/commit-gate-check.sh`); invoked from `.husky/pre-commit` |
| Maestro lint shell scripts | `scripts/lint-no-suppression-markers.sh`, `scripts/lint-no-silent-error-swallow.sh` (copied from the package); invoked from `.husky/pre-commit` |
| Build-ARD format spec | `docs/ards/build-ard-template.md` (copied from `/app/agent-prompts/build-ard-template.md`) |
| Build-ARD acceptance gates | `docs/ards/build-ard-acceptance.md` (copied from `/app/agent-prompts/build-ard-acceptance.md`) |
| ADRs / decision records | `docs/decisions/<NNNN>-<slug>.md` — first ADR is `docs/decisions/0001-team-shape-solo-plus-claude-code.md` (copied from the package). Earlier informal architectural notes also in `ARCHITECTURE.md` and `CONSTITUTION.md`. |
| ARDs (Auto Run Documents) | NOT in repo. See Section 4. |
| `CLAUDE.md` (repo root) | `/app/maestro-planner/CLAUDE.md` (+ symlink `AGENTS.md → CLAUDE.md`) |

---

## 4. What does NOT live in this repo

| Kind | Where it lives instead |
|---|---|
| **ARDs (Auto Run Documents)** | `/app/__AUTORUN/` — one subdirectory per ARD (e.g. `2026-05-15-Claude-IDE-Host/`, `2026-05-15-Claude-PTY-Runner/`). Per `agent-prompts/build-ard-template.md`, ARDs are never checked into the maestro repo. |
| **ARD archive** | `/app/__AUTORUN/__ARCHIVE/` — completed/superseded ARDs moved here. |
| **Brainstorm / planning artifacts** | `/app/__PLANS/Brainstorms/` (and other subdirs of `/app/__PLANS/`). |
| **The bare git repo itself** | `/app/.git-repo/` — the bare repo whose worktrees are `/app/maestro-*/`. Holds all refs/objects/hooks. |
| **Other agent worktrees** | Sibling directories: `/app/maestro-dev-1/` … `/app/maestro-dev-6/`, `/app/maestro-moderator/`, `/app/maestro-planner/`. Each agent VM sees only its own worktree. |
| **Maestro Agent VM home directories** | Each VM's own `~/` on its VM. Not in any worktree; restored from per-VM tarballs during re-provisioning. |
| **Claude Code session transcripts (agent memory)** | `~/.claude/projects/-app/*.jsonl` on each agent VM. Append-only JSONL per session. Not in repo. |
| **Per-Maestro-tab session storage / app state** | Electron `userData` path on the user's machine (platform-dependent: `~/Library/Application Support/Maestro/` on macOS, `%APPDATA%/Maestro/` on Windows, `~/.config/Maestro/` on Linux). Holds SQLite stats DB, settings, per-agent session caches. |
| **Built Electron binaries / installers** | `release/` (electron-builder output) and `out/` — gitignored per `.gitignore`. Not committed. |
| **Compiled TS/JS bundles** | `dist/` (main + cli + renderer build outputs) — gitignored. Cleared by `npm run clean`. |
| **Generated prompts** | `src/generated/` — produced by `scripts/generate-prompts.mjs` from `src/prompts/*.md`. Gitignored. |
| **`node_modules/`** | Per-worktree, populated by `npm install`. Gitignored. |
| **Test artifacts** | `coverage/`, `e2e-results/`, `playwright-report/`, `test-results/` — all gitignored. |
| **Local dev scratch** | `tmp/`, `scratch/`, `logs/`, `*.log`, `.env`, `.env.local`, `.eslintcache` — gitignored. |
| **Temporary refactor planning docs** | `TEMP-REFACTORING-PLAN.md`, `TEMP-REFACTORING-PLAN-2.md` — gitignored (allowed to exist locally; not committed). |
| **`Auto Run Docs/`, `Work Trees/`, `community-data/`, `specs/`** | Gitignored at repo root if they exist locally; canonical homes are under `/app/__AUTORUN/`, `/app/maestro-*/` worktrees, etc. |
| **`.mcp.json`** | Gitignored — local MCP server configuration is per-VM, not committed. |
| **VS Code / JetBrains settings** | `.vscode/`, `.idea/`, `.VSCodeCounter`, `.qodo` — gitignored. |
| **OS junk** | `.DS_Store`, `Thumbs.db` — gitignored. |

---

## 5. Worktree maintenance

**List worktrees:**

```bash
git --git-dir=/app/.git-repo worktree list
```

**Add a new worktree (from any other worktree):**

```bash
git worktree add ../maestro-dev-N -b maestro-dev-N
```

**Remove a worktree:**

```bash
git worktree remove ../maestro-dev-N
git --git-dir=/app/.git-repo branch -D maestro-dev-N
```

**Prune stale worktree refs (after a directory was rm-rf'd manually):**

```bash
git --git-dir=/app/.git-repo worktree prune
```
