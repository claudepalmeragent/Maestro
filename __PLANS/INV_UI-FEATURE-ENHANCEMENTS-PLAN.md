# UI/Functionality Enhancements Investigation & Implementation Plan

**Date**: 2026-02-14
**Status**: Investigation Complete - Ready for Implementation
**Priority**: High
**Type**: Feature Enhancement / UI Improvements

---

## Executive Summary

This document outlines a comprehensive plan for implementing a significant set of UI and functionality enhancements to Maestro. These enhancements build on the foundation of new features added since 01/31/2026, including:
- Project Folders, Group Chat, SSH Remote Sessions
- Auto Run progress tracking and throughput display
- Pricing/Billing mode detection and display
- Usage Dashboard improvements
- Synopsis toggle setting
- SSH connection pooling (recently completed)

The requested enhancements span multiple UI surfaces: tabs, message bubbles, context menus, modals, system processes, auto run, and usage dashboard components.

---

## Historical Context Review

Before implementation, each feature was checked against existing implementations to avoid collisions:

| Feature | Existing Implementation? | Notes |
|---------|-------------------------|-------|
| **1. Lockable Tabs** | ❌ None | `isLocked` exists in AutoRun context (different purpose) |
| **2. Save Prompt to Library** | ⚠️ **Prompt Library exists** | Library created 2026-02-03 (commit 8b0336c5). Feature 2 adds button to USER messages to save - this is NEW functionality building on existing infrastructure |
| **3. Knowledge Graph** | ❌ None | Only reference is in wizard prompts as a concept |
| **4. Like/Dislike Responses** | ❌ None | No rating/feedback system exists |
| **5. Last Agent Focus** | ⚠️ **restoreSession exists** | `restoreSession()` in App.tsx restores session data, but no "last active session" persistence across app restart |
| **6. Dashboard Graphs** | ⚠️ **Extensive work done** | 27+ COST-GRAPH-FIX phases completed. Feature 6 is visual polish, not architectural |
| **7. Process Monitor Progress** | ❌ None | ProcessMonitor doesn't have batch progress display |
| **8. AutoRun Progress Bar** | ❌ None | Expanded modal has text progress but no visual bar |
| **9. Billing Mode Cost** | ⚠️ **Detection implemented** | Billing mode detection works (INV_BillingModeAutoDetectionQueryInsert). Feature 9 is about displaying in green pill |
| **10. Dark/Light Mode** | ⚠️ **Web has it** | `useDeviceColorScheme` exists in `/src/web/` for mobile web. Desktop Electron app doesn't have system theme sync |
| **11. Group Chat Thinking** | ✅ **Fully implemented** | GroupChatThinkingBubble created 2026-02-02. Feature 11 just changes default value |

### Key Existing References

- **Prompt Library**: `/app/Maestro/__PLANS/__ARCHIVE/FR_PromptComposer_PromptLibrary_plan_completed.md` (2026-02-03)
- **Auto Run Progress Tracking**: `/app/Maestro/__PLANS/__ARCHIVE/IMPL_AutoRunProgressTracking_summary.md` (2026-02-04)
- **Billing Mode Detection**: `/app/Maestro/__PLANS/__ARCHIVE/INV_BillingModeAutoDetectionQueryInsert_investigation.md` (2026-02-12)
- **Group Chat Thinking**: `/app/Maestro/__PLANS/__ARCHIVE/FR_GroupChatThinkingMessages_plan_completed.md` (2026-02-02)
- **Dashboard/Cost Fixes**: 27 COST-GRAPH-FIX autorun documents (2026-02-09 through 2026-02-11)

---

## Feature Analysis & Implementation Details

### Feature 1: Lockable Tabs [HIGH PRIORITY]

**Purpose**: Prevent accidental tab closure via keyboard shortcuts or X button clicks.

**Current State Analysis**:
- Tab system located in `/app/Maestro/src/renderer/components/TabBar.tsx` (1,290 lines)
- AITab interface at `/app/Maestro/src/renderer/types/index.ts` lines 471-496
- Already has `starred: boolean` property with star icon display
- Star icon appears near tab close button when `tab.starred && tab.agentSessionId`
- Tab close handled by `onClose` callback (line 71)
- Keyboard tab close via `Cmd+W` handled in keyboard handler

**Proposed Implementation**:

1. **Add `locked` property to AITab interface**:
   ```typescript
   // types/index.ts - AITab interface
   locked?: boolean;  // Prevents tab closure when true
   ```

2. **Add lock icon to TabBar.tsx**:
   - Position: Near star icon on tab (left of close button)
   - Icon: Use `Lock` / `Unlock` from lucide-react
   - Toggle behavior: Click to toggle locked state
   - Visual: Show `Lock` icon (filled) when locked, `Unlock` icon (outline) when unlocked

3. **Block tab closure when locked**:
   - Modify `onClose` handler in Tab component to check `tab.locked`
   - Modify keyboard handler to skip locked tabs for `Cmd+W`
   - Add tooltip: "Tab is locked - unlock to close"

4. **Add TabBar callback**:
   ```typescript
   onTabLock?: (tabId: string, locked: boolean) => void;
   ```

**Files to Modify**:
| File | Changes |
|------|---------|
| `src/renderer/types/index.ts` | Add `locked?: boolean` to AITab (~line 475) |
| `src/renderer/components/TabBar.tsx` | Add lock icon, toggle handler, close blocking |
| `src/renderer/App.tsx` | Add `handleTabLock` callback, persistence |
| `src/renderer/hooks/keyboard/useMainKeyboardHandler.ts` | Skip locked tabs in Cmd+W handler |
| `src/renderer/utils/tabHelpers.ts` | Add `isTabLocked` helper |

**Keyboard Shortcut**:
- **Proposed**: `Cmd+Shift+L` - Toggle Tab Lock
- Add to `TAB_SHORTCUTS` in `src/renderer/constants/shortcuts.ts`:
  ```typescript
  toggleTabLock: { id: 'toggleTabLock', label: 'Toggle Tab Lock', keys: ['Meta', 'Shift', 'l'] },
  ```
- Note: `Cmd+Shift+L` is currently used for "View Agent Sessions" (`agentSessions`). Consider alternatives:
  - `Cmd+L` (currently unassigned in tab shortcuts)
  - `Alt+Cmd+L` (conflicts with System Logs - less ideal)
  - **Recommendation**: Use `Cmd+L` for tab lock toggle

**Estimated Effort**: 2-3 hours

---

### Feature 2: Save Prompt to Prompt Library Button [HIGH PRIORITY]

**Purpose**: Allow users to save USER message content directly to the Prompt Library.

**Existing Implementation Reference** (2026-02-03):
- **Plan**: `/app/Maestro/__PLANS/__ARCHIVE/FR_PromptComposer_PromptLibrary_plan_completed.md`
- **Commit**: `8b0336c5`
- **What exists**: Full Prompt Library with CRUD, search, IPC handlers, file storage
- **What's missing**: Quick-save button on USER message bubbles (current save is only via Prompt Composer)

**Current State Analysis**:
- Message bubbles rendered in `/app/Maestro/src/renderer/components/TerminalOutput.tsx`
- User messages identified by `log.source === 'user'` (line 334)
- LogItem component has existing action buttons (Copy, Delete, Replay, etc.)
- **Prompt Library already exists**:
  - Component: `/app/Maestro/src/renderer/components/PromptLibrarySearchBar.tsx`
  - Manager: `/app/Maestro/src/main/prompt-library-manager.ts`
  - IPC: `window.maestro.promptLibrary.add(entry)` - **ready to use**
  - Hook: `/app/Maestro/src/renderer/hooks/prompt-library/usePromptLibrary.ts`
- PromptLibraryEntry interface at `types/index.ts` lines 845-876

**Proposed Implementation**:

1. **Add "Save to Prompt Library" button to USER message bubbles**:
   - Position: Lower right corner of user message bubble
   - Icon: `BookMarked` or `Library` from lucide-react
   - Tooltip: "Save Prompt to Prompt Library"
   - Only show on hover (similar to other action buttons)

2. **Create save handler**:
   ```typescript
   onSaveToPromptLibrary?: (text: string, images?: string[]) => void;
   ```

3. **Wire to Prompt Library**:
   - Call `window.maestro.promptLibrary.add()` with message content
   - Auto-generate title from first line or first N words
   - Show toast on success: "Prompt saved to library"

4. **Add props to LogItemComponent**:
   ```typescript
   onSaveToPromptLibrary?: (text: string, images?: string[]) => void;
   ```

**Files to Modify**:
| File | Changes |
|------|---------|
| `src/renderer/components/TerminalOutput.tsx` | Add save button to user messages, new callback |
| `src/renderer/App.tsx` | Implement `handleSaveToPromptLibrary` handler |
| `src/renderer/hooks/prompt-library/usePromptLibrary.ts` | Add `savePrompt` method if not present |

**Keyboard Shortcut**:
- Not recommended for this feature (contextual action on specific message)
- Button-only interaction is more appropriate since:
  - Action requires selecting specific USER message content
  - Not a frequent enough action to warrant a global shortcut
  - Hover-to-reveal button pattern matches existing Copy/Delete actions

**Estimated Effort**: 2-3 hours

---

### Feature 3: Save Synopsis to Knowledge Graph [HIGH PRIORITY]

**Purpose**: Save session learnings/synopsis to a local `knowledge_graph` folder for future reference.

**Current State Analysis**:
- Synopsis parsing: `/app/Maestro/src/shared/synopsis.ts`
- History entries with synopsis: `/app/Maestro/src/renderer/components/HistoryPanel.tsx`
- History detail modal: `/app/Maestro/src/renderer/components/HistoryDetailModal.tsx`
- Session context menu: `/app/Maestro/src/renderer/components/SessionList.tsx` (~lines 87-403)
- Tab context menu: `/app/Maestro/src/renderer/components/TabBar.tsx` (hover menu)

**Proposed Implementation**:

1. **Create Knowledge Graph storage mechanism**:
   - Store path: `{dataDir}/knowledge_graph/`
   - File format: `{session-name}_{YYYYMMDD_HHMMSS}.md`
   - Content structure:
     ```markdown
     # Knowledge Gained: {Session Name}

     **Date**: {timestamp}
     **Agent**: {agent type}
     **Project**: {project path}

     ## Summary
     {short summary from synopsis}

     ## Detailed Learnings
     {full synopsis content}

     ## Session Statistics
     - Total Queries: {count}
     - Total Cost: ${cost}
     - Context Usage: {percentage}%
     ```

2. **Add context menu option to Agent Session Tab**:
   - Menu item: "Save to Knowledge Graph" with `Brain` icon
   - Position: Near existing "Rename" / "Star" options

3. **Add button to History Modal popup**:
   - Button: "Save to Knowledge Graph"
   - Shows when viewing a history entry with synopsis

4. **Create IPC handler**:
   ```typescript
   // preload - knowledgeGraph.ts
   save: (entry: KnowledgeGraphEntry) => Promise<string>
   list: () => Promise<string[]>
   read: (filename: string) => Promise<string>
   ```

**Files to Create**:
| File | Purpose |
|------|---------|
| `src/main/ipc/handlers/knowledge-graph.ts` | IPC handlers for knowledge graph |
| `src/main/preload/knowledgeGraph.ts` | Preload API exposure |
| `src/renderer/types/knowledgeGraph.ts` | KnowledgeGraphEntry interface |

**Files to Modify**:
| File | Changes |
|------|---------|
| `src/renderer/components/TabBar.tsx` | Add context menu item for saving |
| `src/renderer/components/HistoryDetailModal.tsx` | Add "Save to Knowledge Graph" button |
| `src/renderer/components/SessionList.tsx` | Add context menu item |
| `src/main/preload/index.ts` | Register knowledgeGraph API |

**Keyboard Shortcut**:
- **Proposed**: `Alt+Cmd+K` - Save to Knowledge Graph
- Add to `DEFAULT_SHORTCUTS` in `src/renderer/constants/shortcuts.ts`:
  ```typescript
  saveToKnowledgeGraph: {
    id: 'saveToKnowledgeGraph',
    label: 'Save to Knowledge Graph',
    keys: ['Alt', 'Meta', 'k']
  },
  ```
- Action: Saves current tab's synopsis/context to knowledge graph
- Note: Works on active tab, not requiring message selection

**Estimated Effort**: 4-6 hours

---

### Feature 4: Like/Dislike Buttons for AI Responses [HIGH PRIORITY]

**Purpose**: Allow users to rate AI responses for future context/learning.

**Current State Analysis**:
- AI messages identified by `log.source === 'ai' || log.source === 'stdout'`
- Message actions rendered in TerminalOutput.tsx
- No existing rating system

**Proposed Implementation**:

1. **Add Like/Dislike buttons to AI message bubbles**:
   - Position: Lower right corner, alongside existing action buttons
   - Icons: `ThumbsUp` / `ThumbsDown` from lucide-react
   - Show on hover

2. **Create ResponseFeedback storage**:
   - File: `{dataDir}/feedback/ResponsesLikedByTheUser.md`
   - Format:
     ```markdown
     # Liked Responses

     ## Entry: {timestamp}
     **Agent**: {agent}
     **Context**: {brief context/user query}
     **Response Summary**: {first 200 chars}
     **Rating**: 👍 / 👎
     **Reason**: (optional user input)
     ```

3. **Add rating state to LogEntry interface**:
   ```typescript
   rating?: 'liked' | 'disliked' | null;
   ```

4. **Future Enhancement Ideas** (for later development):
   - Include top liked responses in system prompt context
   - Supplement AGENTS.md with learned preferences
   - Create a "preferences" system prompt section that summarizes patterns from liked responses
   - Auto-summarize patterns: "User prefers concise responses", "User likes code examples"

**Files to Create**:
| File | Purpose |
|------|---------|
| `src/main/ipc/handlers/feedback.ts` | Feedback storage handlers |
| `src/main/preload/feedback.ts` | Preload API |

**Files to Modify**:
| File | Changes |
|------|---------|
| `src/renderer/types/index.ts` | Add `rating` to LogEntry |
| `src/renderer/components/TerminalOutput.tsx` | Add thumbs up/down buttons |
| `src/renderer/App.tsx` | Add feedback handlers |

**Keyboard Shortcut**:
- Not recommended for this feature (contextual action on specific AI response)
- Like/Dislike requires targeting a specific message
- Button-only interaction is appropriate
- Future consideration: Arrow key navigation through messages + Enter to rate (advanced)

**Estimated Effort**: 3-4 hours

---

### Feature 5: Auto-Store Last Agent Focus [HIGH PRIORITY]

**Purpose**: Persist the last focused agent/session and restore on app reopen.

**Current State Analysis**:
- Active session tracked in App.tsx state
- Session persistence via `window.maestro.sessions.*`
- Settings persistence via `window.maestro.settings.*`
- No current "last active session" persistence on app close

**Proposed Implementation**:

1. **Store last active session on app close/blur**:
   ```typescript
   // Settings key
   lastActiveSessionId?: string;
   lastActiveTabId?: string;
   ```

2. **Listen to window blur/close events**:
   - Save current `activeSession?.id` to settings
   - Save current `activeTab?.id` to settings

3. **Restore on app load**:
   - On initial mount, read `lastActiveSessionId`
   - If session exists, set it as active
   - Navigate to last active tab

4. **Implementation in App.tsx**:
   ```typescript
   // On mount
   useEffect(() => {
     const lastSessionId = settings.lastActiveSessionId;
     if (lastSessionId && sessions.find(s => s.id === lastSessionId)) {
       setActiveSessionId(lastSessionId);
     }
   }, []);

   // Before unload
   useEffect(() => {
     const handleBeforeUnload = () => {
       window.maestro.settings.set('lastActiveSessionId', activeSession?.id);
       window.maestro.settings.set('lastActiveTabId', activeTab?.id);
     };
     window.addEventListener('beforeunload', handleBeforeUnload);
     return () => window.removeEventListener('beforeunload', handleBeforeUnload);
   }, [activeSession?.id, activeTab?.id]);
   ```

**Files to Modify**:
| File | Changes |
|------|---------|
| `src/main/stores/types.ts` | Add `lastActiveSessionId`, `lastActiveTabId` to settings |
| `src/renderer/App.tsx` | Add persistence on blur/close, restore on mount |

**Keyboard Shortcut**:
- N/A - This is automatic behavior, not a user-triggered action
- The feature persists/restores state without user intervention

**Estimated Effort**: 1-2 hours

---

### Feature 6: Update Usage Dashboard Graphs [HIGH PRIORITY]

**Purpose**: Improve graph readability, fix fonts, show token composition.

**Current State Analysis**:
- Usage Dashboard: `/app/Maestro/src/renderer/components/UsageDashboard/`
- Multiple chart components using Recharts
- Auto Run bar graph: `AutoRunStats.tsx`
- Fonts: Uses theme fontFamily
- Token composition shown in tooltips, not inline

**Issues Identified**:
1. Token composition only in tooltips - want inline breakout
2. Large fonts causing overlap on axes/titles
3. Auto Run bar graph width doesn't match scale

**Proposed Implementation**:

1. **Token composition breakout**:
   - Add subtext labels below main token count
   - Format: "Input: X | Output: Y | Cache: Z"
   - Use smaller font (10px) with reduced opacity

2. **Font standardization**:
   - Axes/titles: 11px regular weight
   - Tooltips: 10px
   - Reduce chart padding to maximize data area

3. **Auto Run bar graph fix**:
   - Review `AutoRunStats.tsx` bar chart configuration
   - Fix `barSize` or `maxBarSize` setting
   - Ensure proper domain scaling for x-axis

**Files to Modify**:
| File | Changes |
|------|---------|
| `src/renderer/components/UsageDashboard/SummaryCards.tsx` | Add token breakout subtext |
| `src/renderer/components/UsageDashboard/AutoRunStats.tsx` | Fix bar graph scaling |
| `src/renderer/components/UsageDashboard/ChartComponents.tsx` | Standardize fonts |
| `src/renderer/components/UsageDashboard/*.tsx` | Apply consistent font sizing |

**Keyboard Shortcut**:
- Existing shortcut available: `Alt+Cmd+U` - Usage Dashboard
- No new shortcut needed - this is a visual enhancement to existing dashboard

**Estimated Effort**: 3-4 hours

---

### Feature 7: Show Auto Run Task Progress in System Processes Modal [HIGH PRIORITY]

**Purpose**: Display task x/y progress for AUTO processes in the Process Monitor.

**Current State Analysis**:
- Process Monitor: `/app/Maestro/src/renderer/components/ProcessMonitor.tsx` (1,640 lines)
- ProcessNode interface has `isAutoRun?: boolean` field (line 69)
- Batch run state available via `batchRunState`
- Progress bar component exists in `BatchRunStats.tsx`

**Proposed Implementation**:

1. **Pass batchRunState to ProcessMonitor**:
   - Add prop: `batchRunStates?: Map<string, BatchRunState>`
   - Key by session ID

2. **Display progress for AUTO processes**:
   - Show "Task 3/10" text next to AUTO badge
   - Include mini progress bar (same style as right panel)

3. **Update ProcessNode interface**:
   ```typescript
   interface ProcessNode {
     // ... existing fields
     batchProgress?: {
       completedTasks: number;
       totalTasks: number;
       completedDocs: number;
       totalDocs: number;
     };
   }
   ```

**Files to Modify**:
| File | Changes |
|------|---------|
| `src/renderer/components/ProcessMonitor.tsx` | Add progress display for AUTO processes |
| `src/renderer/App.tsx` | Pass batchRunStates to ProcessMonitor |
| `src/renderer/components/AppModals.tsx` | Wire props through modal wrapper |

**Keyboard Shortcut**:
- Existing shortcut available: `Alt+Cmd+P` - Process Monitor
- No new shortcut needed - this enhances existing Process Monitor display

**Estimated Effort**: 2-3 hours

---

### Feature 8: Add Task Progress Bar to Auto Run Expanded Modal [HIGH PRIORITY]

**Purpose**: Show tasks x/y progress bar in the center-bottom of expanded Auto Run modal.

**Current State Analysis**:
- Auto Run Expanded Modal: `/app/Maestro/src/renderer/components/AutoRunExpandedModal.tsx`
- Already shows progress text at bottom (lines 452-458)
- BatchRunStats component used for token stats
- Bottom bar exists with stats

**Proposed Implementation**:

1. **Add visual progress bar**:
   - Position: Center of bottom stats bar
   - Style: Match existing progress bar from right panel
   - Show: "Task 3/10" with filled progress bar

2. **Use existing progress calculation**:
   - `batchRunState.completedTasksAcrossAllDocs`
   - `batchRunState.totalTasksAcrossAllDocs`

3. **Component structure**:
   ```tsx
   <div className="flex items-center gap-2">
     <span>Task {completed}/{total}</span>
     <div className="w-32 h-2 rounded bg-gray-700">
       <div className="h-full rounded bg-accent" style={{ width: `${percent}%` }} />
     </div>
   </div>
   ```

**Files to Modify**:
| File | Changes |
|------|---------|
| `src/renderer/components/AutoRunExpandedModal.tsx` | Add progress bar in bottom stats section |

**Keyboard Shortcut**:
- Existing shortcut available: `Cmd+Shift+E` - Toggle Auto Run Expanded
- No new shortcut needed - this enhances existing expanded modal

**Estimated Effort**: 1 hour

---

### Feature 9: Correct Green Pill Total Cost for Billing Mode [MEDIUM PRIORITY]

**Purpose**: Show cost calculated based on the agent's configured billing mode, not just Anthropic API cost.

**Current State Analysis**:
- Green pill renders cost in multiple locations (SessionList, GroupChatHeader, HistoryPanel)
- Cost calculation uses `totalCostUsd` from `usageStats`
- Billing mode configuration exists per agent/project folder
- Recently added dual cost tracking (Anthropic vs Maestro calculated)

**Proposed Implementation**:

1. **Determine appropriate cost source**:
   - Check agent's `billingMode` setting
   - If API billing → use `anthropicCostUsd`
   - If Max billing → use `maestroCostUsd` calculated at MAX rates
   - If Pro billing → use `maestroCostUsd` calculated at PRO rates

2. **Update cost pill rendering**:
   - Pass billing mode to cost display components
   - Use `getMaestroCost(stats, billingMode)` utility

3. **Create cost calculation utility**:
   ```typescript
   function getDisplayCost(stats: UsageStats, billingMode: ClaudeBillingMode): number {
     if (billingMode === 'api') return stats.anthropicCostUsd || stats.totalCostUsd;
     return stats.maestroCostUsd || calculateMaestroCost(stats, billingMode);
   }
   ```

**Files to Modify**:
| File | Changes |
|------|---------|
| `src/renderer/utils/costCalculation.ts` | Add `getDisplayCost` utility |
| `src/renderer/components/SessionList.tsx` | Use billing-mode-aware cost |
| `src/renderer/components/GroupChatHeader.tsx` | Use billing-mode-aware cost |
| `src/renderer/components/HistoryPanel.tsx` | Use billing-mode-aware cost |

**Keyboard Shortcut**:
- N/A - Visual display enhancement only, not a toggleable action

**Estimated Effort**: 2-3 hours

---

### Feature 10: Dark/Light Mode Auto Switching [MEDIUM PRIORITY]

**Purpose**: Automatically switch theme based on system preferences.

**Existing Implementation Reference** (Web Interface):
- **File**: `/app/Maestro/src/web/hooks/useDeviceColorScheme.ts`
- **What exists in web**: `useDeviceColorScheme` hook using `prefers-color-scheme` media query
- **File**: `/app/Maestro/src/web/components/ThemeProvider.tsx` - switches based on device preference
- **What's missing**: Desktop Electron app doesn't have this - only web interface does

**Current State Analysis**:
- Theme system: `/app/Maestro/src/shared/theme-types.ts`
- ThemeId includes: 17 themes (dark: dracula, monokai, nord, tokyo-night, etc.; light: github-light, solarized-light, one-light, etc.)
- ThemeMode: `'light' | 'dark' | 'vibe'`
- ThemePicker component: `/app/Maestro/src/renderer/components/ThemePicker.tsx`
- Active theme stored as `activeThemeId` in settings
- Themes grouped by mode in ThemePicker (dark/light sections)
- **Can reference web implementation** for `prefers-color-scheme` pattern

**Proposed Implementation**:

1. **Add "System" theme mode option**:
   - Extend ThemeMode type: `'light' | 'dark' | 'vibe' | 'system'`
   - Or add separate setting: `themeFollowSystem: boolean`

2. **Add setting for theme auto-switching**:
   ```typescript
   // src/main/stores/types.ts - MaestroSettings
   themeMode?: 'manual' | 'system';  // Default: 'manual'
   lightThemeId?: ThemeId;           // Theme for light mode (default: 'github-light')
   darkThemeId?: ThemeId;            // Theme for dark mode (default: 'dracula')
   ```

3. **Listen to system preference changes**:
   ```typescript
   // src/renderer/hooks/settings/useThemeSync.ts (NEW)
   export function useThemeSync(
     themeMode: 'manual' | 'system',
     lightThemeId: ThemeId,
     darkThemeId: ThemeId,
     setActiveThemeId: (id: ThemeId) => void
   ) {
     useEffect(() => {
       if (themeMode !== 'system') return;

       const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

       const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
         setActiveThemeId(e.matches ? darkThemeId : lightThemeId);
       };

       // Set initial value
       handleChange(mediaQuery);

       // Listen for changes
       mediaQuery.addEventListener('change', handleChange);
       return () => mediaQuery.removeEventListener('change', handleChange);
     }, [themeMode, lightThemeId, darkThemeId, setActiveThemeId]);
   }
   ```

4. **Update ThemePicker UI**:
   - Add toggle at top: "Follow System" switch
   - When enabled, show dropdown selectors for light/dark themes
   - When disabled, show current theme grid picker
   ```tsx
   // In ThemePicker.tsx
   <div className="flex items-center justify-between mb-4">
     <span>Follow System Appearance</span>
     <Toggle checked={themeMode === 'system'} onChange={...} />
   </div>
   {themeMode === 'system' && (
     <div className="space-y-3">
       <ThemeDropdown label="Light Mode Theme" themes={lightThemes} value={lightThemeId} />
       <ThemeDropdown label="Dark Mode Theme" themes={darkThemes} value={darkThemeId} />
     </div>
   )}
   ```

5. **Add main process listener for system theme** (optional enhancement):
   ```typescript
   // src/main/index.ts - Listen to native theme changes
   import { nativeTheme } from 'electron';

   nativeTheme.on('updated', () => {
     mainWindow?.webContents.send('system-theme-changed', nativeTheme.shouldUseDarkColors);
   });
   ```

**Files to Create**:
| File | Purpose |
|------|---------|
| `src/renderer/hooks/settings/useThemeSync.ts` | System theme sync hook |

**Files to Modify**:
| File | Changes |
|------|---------|
| `src/main/stores/types.ts` | Add `themeMode`, `lightThemeId`, `darkThemeId` to settings |
| `src/renderer/components/ThemePicker.tsx` | Add system mode toggle and theme selectors |
| `src/renderer/components/SettingsModal.tsx` | Wire new theme settings |
| `src/renderer/App.tsx` | Use `useThemeSync` hook |
| `src/main/index.ts` | (Optional) Add nativeTheme listener |

**Keyboard Shortcut**:
- **Proposed**: `Alt+Cmd+T` - Cycle Theme Mode (Manual → System → Manual)
- Or: No shortcut needed - infrequent setting change
- **Recommendation**: No dedicated shortcut; access via Settings (`Cmd+,`)

**Estimated Effort**: 4-6 hours

---

### Feature 11: Thinking Mode Default in Group Chats [MEDIUM PRIORITY]

**Purpose**: Enable thinking mode by default for group chat input, building on the existing collapsible thinking bubbles feature.

**Existing Implementation Reference** (completed 2026-02-02):
- **Plan**: `/app/Maestro/__PLANS/__ARCHIVE/FR_GroupChatThinkingMessages_plan_completed.md`
- **Commit**: `feat(group-chat): Add Thinking toggle to show streaming AI reasoning` (778634ce)
- **Components created**:
  - `GroupChatThinkingBubble.tsx` - Collapsible bubble with streaming thinking content
  - Brain icon toggle in GroupChatInput
  - Per-participant thinking content via `Map<string, string>`
  - Per-participant collapsed state via `Map<string, boolean>`
  - IPC streaming via `groupChat:thinkingContent` channel

**Current State Analysis**:
- GroupChatInput component: `/app/Maestro/src/renderer/components/GroupChatInput.tsx`
- GroupChatContext manages state: `/app/Maestro/src/renderer/contexts/GroupChatContext.tsx`
- Current state: `groupChatShowThinking` initialized to `false` (line 205)
- Toggle: Brain icon button + `onToggleShowThinking` callback
- Thinking bubbles: `GroupChatThinkingBubble.tsx` with expand/collapse per participant
- Content clears automatically when chat returns to idle state

**What This Feature Adds**:
Simply change the **default initial value** of `groupChatShowThinking` from `false` to a user-configurable setting, so users who want thinking visible by default don't need to click the toggle every time.

**Proposed Implementation**:

1. **Add setting for default thinking mode**:
   ```typescript
   // src/main/stores/types.ts - MaestroSettings
   groupChatDefaultShowThinking?: boolean;  // Default: false (backward compat)
   ```

2. **Initialize from setting**:
   ```typescript
   // src/renderer/contexts/GroupChatContext.tsx - line 205
   // BEFORE:
   const [groupChatShowThinking, setGroupChatShowThinking] = useState(false);

   // AFTER:
   const [groupChatShowThinking, setGroupChatShowThinking] = useState(
     settings.groupChatDefaultShowThinking ?? false
   );
   ```

3. **Add UI toggle in Settings**:
   - Section: "Group Chat" or "AI Input"
   - Toggle: "Show Thinking by default"
   - Description: "Start group chats with thinking bubbles visible"

4. **Optional: Per-group-chat override** (lower priority):
   ```typescript
   // src/shared/group-chat-types.ts - GroupChat interface
   showThinkingOverride?: boolean | null;  // null = use global setting
   ```
   - Store in group chat metadata
   - UI: Add toggle in group chat header/settings

5. **Sync with global setting changes**:
   ```typescript
   // When setting changes, update current state if no per-chat override
   useEffect(() => {
     if (activeGroupChat?.showThinkingOverride === undefined) {
       setGroupChatShowThinking(settings.groupChatDefaultShowThinking ?? false);
     }
   }, [settings.groupChatDefaultShowThinking]);
   ```

**Files to Modify**:
| File | Changes |
|------|---------|
| `src/main/stores/types.ts` | Add `groupChatDefaultShowThinking` to settings |
| `src/renderer/contexts/GroupChatContext.tsx` | Initialize from setting (1 line change) |
| `src/renderer/components/SettingsModal.tsx` | Add toggle in settings UI |
| `src/renderer/hooks/settings/useSettings.ts` | Expose new setting |
| (Optional) `src/shared/group-chat-types.ts` | Add per-chat override |
| (Optional) `src/renderer/components/GroupChatPanel.tsx` | Per-chat override UI |

**Keyboard Shortcut**:
- Existing: `Cmd+Shift+K` - Toggle Show Thinking (works in AI tabs)
- For Group Chat: The same shortcut should work when Group Chat is focused
- May need to ensure keyboard handler routes to `setGroupChatShowThinking` when in group chat context

**Implementation Note**:
```typescript
// src/renderer/hooks/keyboard/useMainKeyboardHandler.ts
// Modify existing toggleShowThinking handler (if not already routing to GC):
if (ctx.isTabShortcut(e, 'toggleShowThinking')) {
  e.preventDefault();
  if (ctx.activeGroupChatId) {
    // Group chat context
    ctx.setGroupChatShowThinking(!ctx.groupChatShowThinking);
  } else if (ctx.activeSession && activeTab) {
    // AI tab context (existing logic)
    ctx.handleToggleShowThinking(activeTab.id);
  }
  trackShortcut('toggleShowThinking');
}
```

**Estimated Effort**: 1-2 hours (basic - just the default setting) / 3-4 hours (with per-chat override)

---

## Keyboard Shortcuts Summary

### New Shortcuts to Add

| Shortcut | Action | Category | Config Location |
|----------|--------|----------|-----------------|
| `Cmd+L` | Toggle Tab Lock | TAB_SHORTCUTS | `constants/shortcuts.ts` |
| `Alt+Cmd+K` | Save to Knowledge Graph | DEFAULT_SHORTCUTS | `constants/shortcuts.ts` |

### Existing Shortcuts Referenced

| Shortcut | Action | Used By Feature |
|----------|--------|-----------------|
| `Cmd+Shift+S` | Toggle Tab Star | (existing - similar to lock) |
| `Alt+Cmd+U` | Usage Dashboard | Feature 6 (Dashboard) |
| `Alt+Cmd+P` | Process Monitor | Feature 7 (Process Progress) |
| `Cmd+Shift+E` | Toggle Auto Run Expanded | Feature 8 (Progress Bar) |
| `Cmd+Shift+P` | Open Prompt Composer | (related to Feature 2) |
| `Cmd+Shift+K` | Toggle Show Thinking | Feature 11 (Group Chat - extend to work in GC context) |

### Implementation Details

**Adding to `TAB_SHORTCUTS`** (for Feature 1 - Lockable Tabs):
```typescript
// src/renderer/constants/shortcuts.ts - add to TAB_SHORTCUTS
toggleTabLock: { id: 'toggleTabLock', label: 'Toggle Tab Lock', keys: ['Meta', 'l'] },
```

**Adding to `DEFAULT_SHORTCUTS`** (for Feature 3 - Knowledge Graph):
```typescript
// src/renderer/constants/shortcuts.ts - add to DEFAULT_SHORTCUTS
saveToKnowledgeGraph: {
  id: 'saveToKnowledgeGraph',
  label: 'Save to Knowledge Graph',
  keys: ['Alt', 'Meta', 'k']
},
```

**Keyboard Handler Updates Required**:
```typescript
// src/renderer/hooks/keyboard/useMainKeyboardHandler.ts

// For toggleTabLock (add near line 547 with other tab shortcuts):
if (ctx.isTabShortcut(e, 'toggleTabLock')) {
  e.preventDefault();
  const activeTab = ctx.activeSession?.aiTabs.find(
    (t: AITab) => t.id === ctx.activeSession.activeTabId
  );
  if (activeTab) {
    ctx.handleTabLock(activeTab.id, !activeTab.locked);
    trackShortcut('toggleTabLock');
  }
}

// For saveToKnowledgeGraph (add with other global shortcuts):
if (ctx.isShortcut(e, 'saveToKnowledgeGraph')) {
  e.preventDefault();
  ctx.handleSaveToKnowledgeGraph();
  trackShortcut('saveToKnowledgeGraph');
}
```

### Shortcut Availability Check

Before implementing, verified these shortcuts are not in use:
- ✅ `Cmd+L` - Available (not in TAB_SHORTCUTS or DEFAULT_SHORTCUTS)
- ✅ `Alt+Cmd+K` - Available (not conflicting with existing shortcuts)

### Shortcuts NOT Recommended

| Feature | Reason |
|---------|--------|
| Save Prompt to Library | Contextual action on specific message - button-only |
| Like/Dislike Response | Contextual action on specific message - button-only |
| Last Agent Focus | Automatic behavior - no user action needed |
| Billing Mode Cost | Display enhancement - no toggleable action |

---

## Phased Auto Run Documents Plan

Based on the analysis above, here is the recommended phasing for Auto Run documents:

| Phase | Document Name | Features | Shortcut | Priority | Estimated Time |
|-------|--------------|----------|----------|----------|----------------|
| **01** | `UIENHANCEMENTS-01-LOCKABLE-TABS.md` | Lockable tabs functionality | `Cmd+L` | High | 2-3 hours |
| **02** | `UIENHANCEMENTS-02-PROMPT-LIBRARY-SAVE.md` | Save prompt to library button | (button only) | High | 2-3 hours |
| **03** | `UIENHANCEMENTS-03-KNOWLEDGE-GRAPH.md` | Save synopsis to knowledge graph | `Alt+Cmd+K` | High | 4-6 hours |
| **04** | `UIENHANCEMENTS-04-RESPONSE-FEEDBACK.md` | Like/dislike buttons for AI responses | (button only) | High | 3-4 hours |
| **05** | `UIENHANCEMENTS-05-LAST-AGENT-FOCUS.md` | Auto-store last focused agent | (automatic) | High | 1-2 hours |
| **06** | `UIENHANCEMENTS-06-DASHBOARD-GRAPHS.md` | Usage dashboard graph improvements | `Alt+Cmd+U` ✓ | High | 3-4 hours |
| **07** | `UIENHANCEMENTS-07-PROCESS-MONITOR-AUTORUN.md` | Auto Run progress in System Processes | `Alt+Cmd+P` ✓ | High | 2-3 hours |
| **08** | `UIENHANCEMENTS-08-AUTORUN-PROGRESS-BAR.md` | Task progress bar in expanded modal | `Cmd+Shift+E` ✓ | High | 1 hour |
| **09** | `UIENHANCEMENTS-09-BILLING-MODE-COST.md` | Green pill billing mode cost correction | (display only) | Medium | 2-3 hours |
| **10** | `UIENHANCEMENTS-10-DARK-LIGHT-MODE.md` | System dark/light mode auto-switching | (via Settings) | Medium | 4-6 hours |
| **11** | `UIENHANCEMENTS-11-GROUPCHAT-THINKING.md` | Thinking mode default in Group Chats | `Cmd+Shift+K` ✓ | Medium | 1-2 hours |

*Legend: ✓ = existing shortcut, (button only) = no shortcut recommended, (automatic/display only) = no action needed*

**Total Estimated Time**: 26-40 hours for all phases (01-11)

---

## Implementation Dependencies

```
Phase 01 (Tabs) ──────────────────────┐
Phase 02 (Prompt Library) ────────────┼── Independent, can run in parallel
Phase 05 (Last Focus) ────────────────┘

Phase 03 (Knowledge Graph) ───────────┐
Phase 04 (Feedback) ──────────────────┼── Similar IPC patterns, can share code
                                      │
Phase 06 (Dashboard) ─────────────────┤── Independent
                                      │
Phase 07 (Process Monitor) ───────────┼── Depends on batchRunState availability
Phase 08 (AutoRun Progress) ──────────┘

Phase 09 (Billing Cost) ──────────────── Independent, but verify recent pricing work

Phase 10 (Dark/Light Mode) ───────────┐
                                      ├── Settings-based, touch similar files
Phase 11 (Group Chat Thinking) ───────┘   (both modify SettingsModal, stores/types)
```

---

## Risk Assessment

| Feature | Risk Level | Mitigation |
|---------|-----------|------------|
| Lockable tabs | Low | Simple boolean flag, no breaking changes |
| Prompt Library save | Low | Uses existing infrastructure |
| Knowledge Graph | Medium | New file storage system, test file permissions |
| Response feedback | Medium | New state in LogEntry, ensure backward compat |
| Last agent focus | Low | Simple settings persistence |
| Dashboard graphs | Medium | Recharts configuration, test across data ranges |
| Process Monitor progress | Low | Display only, no state changes |
| AutoRun progress bar | Low | UI only, no logic changes |
| Billing mode cost | Medium | Ensure all cost paths use same calculation |
| Dark/Light mode | Medium | Test theme switching with all 17 themes; ensure no flicker |
| Group Chat thinking default | Very Low | Single setting + 1-line initialization change; all UI already exists |

---

## Testing Considerations

### Unit Tests Needed:
- `isTabLocked` helper function
- `getDisplayCost` calculation for different billing modes
- Knowledge graph filename generation
- Synopsis to knowledge graph markdown conversion

### Integration Tests:
- Tab lock persistence across sessions
- Prompt library save and retrieval
- Knowledge graph file creation and reading
- Last focused agent restoration on app restart

### Manual Testing:
- All new UI buttons have proper hover states
- Progress bars render correctly at 0%, 50%, 100%
- Graph fonts are readable at all zoom levels
- Auto Run bar graph scales properly with different data

---

## Code Patterns to Follow

Based on codebase analysis, new features should follow these patterns:

1. **Component Props**: Use comprehensive interfaces with all callbacks
2. **Callbacks**: Wrap in `useCallback` with proper dependencies
3. **Icons**: Use lucide-react library consistently
4. **Styling**: Use theme colors via inline `style={}` prop
5. **Tooltips**: Add `title` attribute for accessibility
6. **State**: Use React state for UI, IPC for persistence
7. **Memoization**: Apply `React.memo` to list items
8. **Layer Stack**: Register modals with proper priority

---

## Next Steps

1. **Review this plan** with stakeholders
2. **Prioritize** which phases to implement first
3. **Create Auto Run documents** for approved phases
4. **Begin implementation** with independent features (01, 02, 05)
5. **Test incrementally** after each phase

---

## Appendix: File Location Reference

| Component/Feature | Primary File Location |
|-------------------|----------------------|
| Tab System | `/app/Maestro/src/renderer/components/TabBar.tsx` |
| Message Bubbles | `/app/Maestro/src/renderer/components/TerminalOutput.tsx` |
| History Panel | `/app/Maestro/src/renderer/components/HistoryPanel.tsx` |
| History Detail Modal | `/app/Maestro/src/renderer/components/HistoryDetailModal.tsx` |
| Session Context Menu | `/app/Maestro/src/renderer/components/SessionList.tsx` |
| Process Monitor | `/app/Maestro/src/renderer/components/ProcessMonitor.tsx` |
| Auto Run Expanded | `/app/Maestro/src/renderer/components/AutoRunExpandedModal.tsx` |
| Usage Dashboard | `/app/Maestro/src/renderer/components/UsageDashboard/` |
| Prompt Library | `/app/Maestro/src/renderer/components/PromptLibrarySearchBar.tsx` |
| Cost Pill | Various (SessionList, GroupChatHeader, HistoryPanel) |
| AITab Type | `/app/Maestro/src/renderer/types/index.ts` lines 471-496 |
| LogEntry Type | `/app/Maestro/src/renderer/types/index.ts` |
| Settings Store | `/app/Maestro/src/main/stores/types.ts` |
| Keyboard Handler | `/app/Maestro/src/renderer/hooks/keyboard/useMainKeyboardHandler.ts` |
| Shortcuts Config | `/app/Maestro/src/renderer/constants/shortcuts.ts` |
| Theme Types | `/app/Maestro/src/shared/theme-types.ts` |
| Theme Picker | `/app/Maestro/src/renderer/components/ThemePicker.tsx` |
| Group Chat Context | `/app/Maestro/src/renderer/contexts/GroupChatContext.tsx` |
| Group Chat Input | `/app/Maestro/src/renderer/components/GroupChatInput.tsx` |

---

**Document Prepared By**: maestro-planner (claude cloud)
**Investigation Completed**: 2026-02-14
**Ready for Review**: Yes
