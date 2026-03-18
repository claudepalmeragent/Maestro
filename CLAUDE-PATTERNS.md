# CLAUDE-PATTERNS.md

Core implementation patterns for the Maestro codebase. For the main guide, see [[CLAUDE.md]].

## 1. Process Management

Each agent runs **two processes** simultaneously:

- AI agent process (Claude Code, etc.) - spawned with `-ai` suffix
- Terminal process (PTY shell) - spawned with `-terminal` suffix

```typescript
// Agent stores both PIDs (code interface: Session object)
session.aiPid; // AI agent process
session.terminalPid; // Terminal process
```

## 2. Security Requirements

**Always use `execFileNoThrow`** for external commands:

```typescript
import { execFileNoThrow } from './utils/execFile';
const result = await execFileNoThrow('git', ['status'], cwd);
// Returns: { stdout, stderr, exitCode } - never throws
```

**Never use shell-based command execution** - it creates injection vulnerabilities. The `execFileNoThrow` utility is the safe alternative.

## 3. Settings Persistence

Add new settings in `useSettings.ts`:

```typescript
// 1. Add state with default value
const [mySetting, setMySettingState] = useState(defaultValue);

// 2. Add wrapper that persists
const setMySetting = (value) => {
	setMySettingState(value);
	window.maestro.settings.set('mySetting', value);
};

// 3. Load from batch response in useEffect (settings use batch loading)
// In the loadSettings useEffect, extract from allSettings object:
const allSettings = await window.maestro.settings.getAll();
const savedMySetting = allSettings['mySetting'];
if (savedMySetting !== undefined) setMySettingState(savedMySetting);
```

## 4. Adding Modals

1. Create component in `src/renderer/components/`
2. Add priority in `src/renderer/constants/modalPriorities.ts`
3. Register with layer stack:

```typescript
import { useLayerStack } from '../contexts/LayerStackContext';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';

const { registerLayer, unregisterLayer } = useLayerStack();
const onCloseRef = useRef(onClose);
onCloseRef.current = onClose;

useEffect(() => {
	if (isOpen) {
		const id = registerLayer({
			type: 'modal',
			priority: MODAL_PRIORITIES.YOUR_MODAL,
			onEscape: () => onCloseRef.current(),
		});
		return () => unregisterLayer(id);
	}
}, [isOpen, registerLayer, unregisterLayer]);
```

## 5. Theme Colors

Themes have 13 required colors. Use inline styles for theme colors:

```typescript
style={{ color: theme.colors.textMain }}  // Correct
className="text-gray-500"                  // Wrong for themed text
```

## 6. Multi-Tab Agents & Unified Tab System

Agents support multiple AI conversation tabs and file preview tabs in a unified tab bar.

### Critical Invariant: `unifiedTabOrder` Must Stay in Sync

**Every tab in `aiTabs` or `filePreviewTabs` MUST have a corresponding entry in `unifiedTabOrder`.** The TabBar renders from `unifiedTabOrder` — tabs missing from this array are invisible even if their content renders.

```typescript
// Session tab state (three arrays that MUST stay in sync)
session.aiTabs: AITab[]                    // AI conversation tab data
session.filePreviewTabs: FilePreviewTab[]  // File preview tab data
session.unifiedTabOrder: UnifiedTabRef[]   // Visual order — TabBar source of truth

session.activeTabId: string                // Active AI tab
session.activeFileTabId: string | null     // Active file tab (null if AI tab active)
```

### When Adding Tabs

Always update both the tab array AND `unifiedTabOrder`:

```typescript
// CORRECT — tab appears in TabBar
return {
	...s,
	aiTabs: [...s.aiTabs, newTab],
	activeTabId: newTabId,
	unifiedTabOrder: [...s.unifiedTabOrder, { type: 'ai', id: newTabId }],
};

// WRONG — tab content renders but no tab visible
return {
	...s,
	aiTabs: [...s.aiTabs, newTab],
	activeTabId: newTabId,
	// unifiedTabOrder not updated — ghost tab!
};
```

### When Activating Existing Tabs

Use `ensureInUnifiedTabOrder()` to repair orphaned tabs defensively:

```typescript
import { ensureInUnifiedTabOrder } from '../utils/tabHelpers';

return {
	...s,
	activeFileTabId: existingTab.id,
	unifiedTabOrder: ensureInUnifiedTabOrder(s.unifiedTabOrder, 'file', existingTab.id),
};
```

### Shared Utilities (`tabHelpers.ts`)

- **`buildUnifiedTabs(session)`** — Builds the unified tab list from session data. Follows `unifiedTabOrder` then appends orphaned tabs as a safety net. Single source of truth used by both `useTabHandlers.ts` and `tabStore.ts`.
- **`ensureInUnifiedTabOrder(order, type, id)`** — Returns order unchanged if tab is present, appends it otherwise. Zero-cost no-op when no repair needed (returns same reference).

## 7. Execution Queue

Messages are queued when the AI is busy:

```typescript
// Queue items for sequential execution
interface QueuedItem {
	type: 'message' | 'slashCommand';
	content: string;
	timestamp: number;
}

// Add to queue instead of sending directly when busy
session.executionQueue.push({ type: 'message', content, timestamp: Date.now() });
```

## 8. Auto Run

File-based document automation system:

```typescript
// Auto Run state on session
session.autoRunFolderPath?: string;    // Document folder path
session.autoRunSelectedFile?: string;  // Currently selected document
session.autoRunMode?: 'edit' | 'preview';

// API for Auto Run operations
window.maestro.autorun.listDocuments(folderPath);
window.maestro.autorun.readDocument(folderPath, filename);
window.maestro.autorun.saveDocument(folderPath, filename, content);
```

**Worktree Support:** Auto Run can operate in a git worktree, allowing users to continue interactive editing in the main repo while Auto Run processes tasks in the background. When `batchRunState.worktreeActive` is true, read-only mode is disabled and a git branch icon appears in the UI. See `useBatchProcessor.ts` for worktree setup logic.

**Playbook Assets:** Playbooks can include non-markdown assets (config files, YAML, Dockerfiles, scripts) in an `assets/` subfolder. When installing playbooks from the marketplace or importing from ZIP files, Maestro copies the entire folder structure including assets. See the [Maestro-Playbooks repository](https://github.com/RunMaestro/Maestro-Playbooks) for the convention documentation.

```
playbook-folder/
├── 01_TASK.md
├── 02_TASK.md
├── README.md
└── assets/
    ├── config.yaml
    ├── Dockerfile
    └── setup.sh
```

Documents can reference assets using `{{AUTORUN_FOLDER}}/assets/filename`. The manifest lists assets explicitly:

```json
{
  "id": "example-playbook",
  "documents": [...],
  "assets": ["config.yaml", "Dockerfile", "setup.sh"]
}
```

## 9. Tab Hover Overlay Menu

AI conversation tabs display a hover overlay menu after a 400ms delay when hovering over tabs with an established provider session. The overlay includes tab management and context operations:

**Menu Structure:**

```typescript
// Tab operations (always shown)
- Copy Session ID (if provider session exists)
- Star/Unstar Session (if provider session exists)
- Rename Tab
- Mark as Unread

// Context management (shown when applicable)
- Context: Compact (if tab has 5+ messages)
- Context: Merge Into (if provider session exists)
- Context: Send to Agent (if provider session exists)

// Tab close actions (always shown)
- Close (disabled if only one tab)
- Close Others (disabled if only one tab)
- Close Tabs to the Left (disabled if first tab)
- Close Tabs to the Right (disabled if last tab)
```

**Implementation Pattern:**

```typescript
const [overlayOpen, setOverlayOpen] = useState(false);
const [overlayPosition, setOverlayPosition] = useState<{ top: number; left: number } | null>(null);

const handleMouseEnter = () => {
  if (!tab.agentSessionId) return; // Only for tabs with provider sessions

  hoverTimeoutRef.current = setTimeout(() => {
    if (tabRef.current) {
      const rect = tabRef.current.getBoundingClientRect();
      setOverlayPosition({ top: rect.bottom + 4, left: rect.left });
    }
    setOverlayOpen(true);
  }, 400);
};

// Render overlay via portal to escape stacking context
{overlayOpen && overlayPosition && createPortal(
  <div style={{ top: overlayPosition.top, left: overlayPosition.left }}>
    {/* Overlay menu items */}
  </div>,
  document.body
)}
```

**Key Features:**

- Appears after 400ms hover delay (only for tabs with `agentSessionId`)
- Fixed positioning at tab bottom
- Mouse can move from tab to overlay without closing
- Disabled states with visual feedback (opacity-40, cursor-default)
- Theme-aware styling
- Dividers separate action groups

See `src/renderer/components/TabBar.tsx` (Tab component) for implementation details.

## 10. SSH Remote Agents

Agents can execute commands on remote hosts via SSH. **Critical:** There are two different SSH identifiers with different lifecycles:

```typescript
// Set AFTER AI agent spawns (via onSshRemote callback)
session.sshRemoteId: string | undefined

// Set BEFORE spawn (user configuration)
session.sessionSshRemoteConfig: {
  enabled: boolean;
  remoteId: string | null;      // The SSH config ID
  workingDirOverride?: string;
}
```

**Common pitfall:** `sshRemoteId` is only populated after the AI agent spawns. For terminal-only SSH agents (no AI process), it remains `undefined`. Always use both as fallback:

```typescript
// WRONG - fails for terminal-only SSH agents
const sshId = session.sshRemoteId;

// CORRECT - works for all SSH agents
const sshId = session.sshRemoteId || session.sessionSshRemoteConfig?.remoteId;
```

This applies to any operation that needs to run on the remote:

- `window.maestro.fs.readDir(path, sshId)`
- `gitService.isRepo(path, sshId)`
- Directory existence checks for `cd` command tracking

Similarly for checking if an agent is remote:

```typescript
// WRONG
const isRemote = !!session.sshRemoteId;

// CORRECT
const isRemote = !!session.sshRemoteId || !!session.sessionSshRemoteConfig?.enabled;
```

## 11. UI Bug Debugging Checklist

When debugging visual issues (tooltips clipped, elements not visible, scroll behavior):

1. **CSS First:** Check parent container properties before code logic:
   - `overflow: hidden` on ancestors (clipping issues)
   - `z-index` stacking context conflicts
   - `position` mismatches (fixed/absolute/relative)

2. **Scroll Issues:** Use `scrollIntoView({ block: 'nearest' })` not centering

3. **Portal Escape:** For overlays/tooltips that get clipped, use `createPortal(el, document.body)` to escape stacking context

4. **Fixed Positioning:** Elements with `position: fixed` inside transformed parents won't position relative to viewport—check ancestor transforms

**Common fixes:**

```typescript
// Tooltip/overlay escaping parent overflow
import { createPortal } from 'react-dom';
{isOpen && createPortal(<Overlay />, document.body)}

// Scroll element into view without centering
element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
```

## 12. Encore Features (Feature Gating)

Optional features that not all users need should be gated behind Encore Features — disabled by default, completely invisible when off (no shortcuts, menus, or command palette entries).

**Critical architecture detail:** `encoreFeatures` state lives in App.tsx's `useSettings()` and is passed to SettingsModal as **props** (not consumed via SettingsModal's own `useSettings()`). This ensures toggles propagate immediately to App.tsx for gating.

### Gating Checklist

When adding a new Encore Feature, gate **all** access points:

1. **Type flag** — Add to `EncoreFeatureFlags` in `src/renderer/types/index.ts`
2. **Default** — Set to `false` in `DEFAULT_ENCORE_FEATURES` in `useSettings.ts`
3. **Toggle UI** — Add section in SettingsModal's Encore tab (follow Director's Notes pattern)
4. **App.tsx** — Gate modal rendering and callback props on `encoreFeatures.yourFeature`
5. **Keyboard shortcuts** — Guard with `ctx.encoreFeatures?.yourFeature` in `useMainKeyboardHandler.ts`
6. **Hamburger menu** — Make the setter optional, conditionally render the menu item in `SessionList.tsx`
7. **Command palette** — Pass `undefined` for the handler in `QuickActionsModal.tsx` (already conditionally renders based on handler existence)

### Reference Implementation: Director's Notes

Director's Notes is the first Encore Feature and serves as the canonical example:

- **Flag:** `encoreFeatures.directorNotes` in `EncoreFeatureFlags`
- **App.tsx gating:** Modal render wrapped in `{encoreFeatures.directorNotes && directorNotesOpen && (…)}`, callback passed as `encoreFeatures.directorNotes ? () => setDirectorNotesOpen(true) : undefined`
- **Keyboard shortcut:** `ctx.encoreFeatures?.directorNotes` guard in `useMainKeyboardHandler.ts`
- **Hamburger menu:** `setDirectorNotesOpen` made optional in `SessionList.tsx`, button conditionally rendered with `{setDirectorNotesOpen && (…)}`
- **Command palette:** `onOpenDirectorNotes` already conditionally renders in `QuickActionsModal.tsx` — passing `undefined` from App.tsx is sufficient

When adding a new Encore Feature, mirror this pattern across all access points.

See [CONTRIBUTING.md → Encore Features](CONTRIBUTING.md#encore-features-feature-gating) for the full contributor guide.

## 13. Modal Store Registry Pattern

The modal system uses a Zustand-based registry (`modalStore.ts`) instead of individual boolean state fields. This replaces 90+ boolean fields from the legacy `ModalContext` with a single `Map<ModalId, ModalEntry>`.

**Core API:**

```typescript
import { useModalStore } from '../stores/modalStore';

// Open a modal with optional typed data
useModalStore
	.getState()
	.openModal('confirm', { message: 'Are you sure?', onConfirm: handleDelete });

// Close a modal
useModalStore.getState().closeModal('settings');

// Subscribe to a specific modal's open state (granular re-renders)
const isOpen = useModalStore(selectModalOpen('settings'));

// Get modal data
const data = useModalStore(selectModalData('settings'));
```

**Why this pattern:**

- **Granular subscriptions:** Components subscribe to specific modal IDs only, avoiding re-renders when unrelated modals change
- **Type-safe:** `ModalId` union type prevents typos; `ModalDataMap` maps each ID to its data type
- **Replaces prop-drilling:** Components use `useModalStore` directly instead of receiving modal state through App.tsx props
- **Incremental migration:** `getModalActions()` and `useModalActions()` provide backward-compatible APIs matching the old `ModalContext` shape

See `src/renderer/stores/modalStore.ts` for the full implementation and type definitions.

## 14. sessionsRef Pattern (Cascade Avoidance)

When accessing sessions inside effects or callbacks, use `sessionsRef.current` (or `useSessionStore.getState().sessions`) instead of subscribing to the `sessions` array reactively. This prevents cascading re-renders and effect re-evaluations.

```typescript
// WRONG — effect re-runs on every setSessions call, triggering SSH commands
useEffect(() => {
	const session = sessions.find((s) => s.id === activeSessionId);
	if (session) loadFileTree(session);
}, [sessions, activeSessionId]); // sessions changes constantly

// CORRECT — effect only re-runs when activeSessionId changes
useEffect(() => {
	const session = sessionsRef.current.find((s) => s.id === activeSessionId);
	if (session) loadFileTree(session);
}, [activeSessionId, sessionsRef]);
```

**Why this matters:** Every `setSessions` call creates a new sessions array reference → 13+ subscribers re-render → effects re-evaluate → SSH commands get queued. For SSH sessions with `p-limit(8)` concurrency, this can exhaust all available slots and cause timeouts. The `sessionsRef` pattern breaks this cascade by reading the latest value without subscribing to changes.

See `src/renderer/hooks/git/useFileTreeManagement.ts` for the canonical implementation.

## 15. Defensive Array Guard Pattern

When accessing array fields on sessions restored from storage, always provide a fallback default. Sessions saved by older versions of Maestro may lack fields added in later releases.

```typescript
// WRONG — crashes if filePreviewTabs is undefined (older session format)
const existingTab = s.filePreviewTabs.find((tab) => tab.path === file.path);

// CORRECT — defensive guard with nullish coalescing
const filePreviewTabs = s.filePreviewTabs ?? [];
const existingTab = filePreviewTabs.find((tab) => tab.path === file.path);
```

**Motivating bug:** The `filePreviewTabs` field was added after the initial release. Sessions restored from storage before this field existed had `undefined` for `filePreviewTabs`, causing `.find()` to throw. The fix is a simple `?? []` guard before any array method call.

**When to apply:** Any time you access an array field on a `Session` object that was added after the initial session schema — especially in `setSessions` callbacks where you're iterating over restored sessions.

See `src/renderer/hooks/tabs/useTabHandlers.ts` (`handleOpenFileTab`) for the pattern in use.

## 16. SSH Safety Exclusions (Hardcoded)

The file tree loader always excludes certain directories regardless of user-configured ignore patterns. These are hardcoded safety exclusions that prevent catastrophic SSH performance degradation:

**Always excluded:** `.git`, `.git-repo`, `node_modules`, `__pycache__`

```typescript
// From src/renderer/utils/fileExplorer.ts — loadFileTreeRecursive()
if (
	entry.name === 'node_modules' ||
	entry.name === '__pycache__' ||
	entry.name === '.git' ||
	entry.name === '.git-repo'
) {
	continue;
}
```

**Why this matters:** For SSH remotes, each subdirectory requires a separate `readDir` SSH call (in the recursive fallback path). Traversing `node_modules` (which can contain thousands of nested directories) would exhaust the `p-limit(8)` SSH concurrency limiter, blocking all other SSH operations and causing timeouts. The `.git` exclusion prevents accidental repository corruption.

User-configured ignore patterns from settings are applied **in addition** to these hardcoded exclusions.

## 17. Find-Based SSH Tree Loading

SSH file tree loading uses a single `find -printf` command instead of N recursive `readDir` SSH calls. This is the primary performance optimization for remote file explorer:

```typescript
// Single SSH round-trip replaces N sequential calls
// IPC: window.maestro.fs.loadFileTree(dirPath, sshRemoteId, maxDepth, ignorePatterns)
// Main process: loadFileTreeRemote() in src/main/utils/remote-fs.ts

// The find command runs entirely on the remote host:
find <path> -maxdepth 10 -mindepth 1 \( -name 'node_modules' -prune \) -o -printf '%y\t%P\n'
// Output: "d\tsrc" or "f\tsrc/index.ts" (type + relative path)
```

**Architecture:**

- **SSH remotes** use `fs:loadFileTree` IPC channel → `loadFileTreeRemote()` → single `find -printf` command
- **Local paths** use `fs:readDir` IPC channel → recursive `readDirSync` calls

**Fallback:** If `find -printf` is unavailable (macOS/BSD), falls back to `stat -c` based approach.

The flat path list is converted to a nested `FileTreeNode[]` tree client-side in `loadFileTreeViaFind()` (`src/renderer/utils/fileExplorer.ts`).

## 18. SSH Socket Validation Cache

SSH socket validation results are cached with a 30-second TTL to avoid redundant `ssh -O check` calls during rapid file tree loads:

```typescript
// From src/main/utils/ssh-socket-cleanup.ts
const socketValidationCache = new Map<string, number>(); // key → last-validated timestamp
const SOCKET_VALIDATION_CACHE_TTL_MS = 30000; // 30 seconds

// Called before every SSH operation in execRemoteCommandInner():
await validateSshSocket(config.host, config.port, config.username);
// Fast path: returns immediately if validated within last 30s
```

**What `validateSshSocket` does:**

1. Checks cache — if validated within TTL, returns immediately (~0ms)
2. Runs `ssh -O check` to verify the ControlMaster socket is alive (~1ms, local only)
3. If socket is stale or missing, triggers master re-establishment via `sshHealthMonitor`
4. Updates cache on success

**Why this matters:** During a file tree load, `execRemoteCommand` is called many times in quick succession. Without the cache, each call would run `ssh -O check` (spawning a child process), adding ~1ms overhead per operation that compounds during bulk operations.
