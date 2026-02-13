# About Modal Global Statistics Enhancement

**Created:** 2026-02-13
**Updated:** 2026-02-13 (Added Leaderboard Analysis)
**Author:** maestro-planner (claude cloud)
**Status:** Implementation Complete - Ready for Testing
**Priority:** Medium (Enhancement to existing feature)

---

## Executive Summary

This document outlines the analysis and proposed implementation plan for enhancing the About Modal's Global Statistics section to include both **Local** and **SSH Remote** agent sessions. Currently, the Global Statistics only display totals from local sessions (stored in `~/.claude/projects/`), while SSH Remote sessions are excluded.

The enhancement also includes:
1. Updating the descriptive text from "Local sessions only. SSH Remote sessions shown in Session Explorer." to "Includes Local and SSH Remote sessions."
2. Adding a keyboard shortcut `Option+Command+A` to open the About Modal (if not reserved)
3. Adding a tooltip to the trophy icon in the left sidebar

---

## Leaderboard Integration Analysis

### Key Finding: Leaderboard Uses `AutoRunStats`, NOT `GlobalAgentStats`

The "Join Leaderboard" button in About Modal opens `LeaderboardRegistrationModal` which submits **AutoRun statistics** to `runmaestro.ai`, NOT the Global Statistics (sessions, messages, tokens).

#### Data Submitted to Leaderboard

**File:** `/app/Maestro/src/renderer/components/LeaderboardRegistrationModal.tsx` (lines 309-335)

```typescript
const result = await window.maestro.leaderboard.submit({
  email: email.trim(),
  displayName: displayName.trim(),
  // ... social handles ...
  badgeLevel,
  badgeName,
  cumulativeTimeMs: autoRunStats.cumulativeTimeMs,  // Total AutoRun time
  totalRuns: autoRunStats.totalRuns,                // Total AutoRun sessions
  longestRunMs: autoRunStats.longestRunMs,          // Longest single run
  longestRunDate,
  // ... keyboard mastery stats ...
});
```

#### AutoRunStats Interface (vs GlobalAgentStats)

**`AutoRunStats`** (`/app/Maestro/src/renderer/types/index.ts` lines 417-426):
```typescript
interface AutoRunStats {
  cumulativeTimeMs: number;      // Total AutoRun time across sessions
  longestRunMs: number;          // Longest single AutoRun
  longestRunTimestamp: number;   // When longest run occurred
  totalRuns: number;             // Number of AutoRun sessions
  currentBadgeLevel: number;     // Badge level (1-11)
  lastBadgeUnlockLevel: number;
  lastAcknowledgedBadgeLevel: number;
  badgeHistory: BadgeUnlockRecord[];
}
```

**`GlobalAgentStats`** (`/app/Maestro/src/shared/types.ts` lines 429-445):
```typescript
interface GlobalAgentStats {
  totalSessions: number;         // Agent sessions (from JSONL files)
  totalMessages: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalCostUsd: number;
  hasCostData: boolean;
  totalSizeBytes: number;
  isComplete: boolean;
  byProvider: Record<string, ProviderStats>;
}
```

### Implications

1. **Leaderboard is independent of this enhancement** - The leaderboard tracks AutoRun activity (time spent, run count, badges), not token/session metrics from `GlobalAgentStats`.

2. **Global Statistics section is purely informational** - The sessions/messages/tokens shown in About Modal are for user awareness, not submitted anywhere.

3. **No toggle needed** - Since GlobalAgentStats isn't sent to the leaderboard, there's no concern about mixing local/remote data for leaderboard purposes. Merging local + remote without a toggle is appropriate.

4. **User expectation alignment** - Users seeing "Global Statistics" would reasonably expect ALL their agent sessions to be counted, including remote ones. The current "local only" behavior is surprising.

---

## Current State Analysis

### About Modal Location
- **Component:** `/app/Maestro/src/renderer/components/AboutModal.tsx`
- **Lines:** 473 total
- **Props:** Receives `theme`, `autoRunStats`, `usageStats`, `handsOnTimeMs`, plus leaderboard-related props

### Global Statistics Display (lines 213-333)
The modal displays the following metrics in a grid layout:
- Sessions count
- Messages count
- Input Tokens total
- Output Tokens total
- Cache Read tokens (conditional)
- Cache Creation tokens (conditional)
- Hands-on Time (optional)
- Total Cost USD (if `hasCostData`)

### Current Note (line 321-326)
```tsx
<div className="text-[10px] text-center pt-2 mt-2 border-t" ...>
  Local sessions only. SSH Remote sessions shown in Session Explorer.
</div>
```

### Data Source: `getGlobalStats()` IPC Handler
**File:** `/app/Maestro/src/main/ipc/handlers/agentSessions.ts` (lines 933-1150+)

The `agentSessions:getGlobalStats` handler:
1. Discovers session files from **local** directories only:
   - Claude Code: `~/.claude/projects/*/*.jsonl`
   - Codex: `~/.codex/sessions/YYYY/MM/DD/*.jsonl`
2. Parses JSONL files to extract token usage stats
3. Caches results for performance (incremental updates on file modification)
4. Returns `GlobalAgentStats` interface:

```typescript
interface GlobalAgentStats {
  totalSessions: number;
  totalMessages: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalCostUsd: number;
  hasCostData: boolean;
  totalSizeBytes: number;
  isComplete: boolean;
  byProvider: Record<string, ProviderStats>;
}
```

### SSH Remote Session Access
SSH Remote sessions are accessed via the existing infrastructure:
- **Storage:** `readFileRemote()`, `readDirRemote()` in `/app/Maestro/src/main/utils/remote-fs.ts`
- **Config:** `SshRemoteConfig` stored in `settingsStore.get('sshRemotes')`
- **Session listing:** `agentSessions:list` accepts `sshRemoteId` parameter

### Current Discovery Functions (Local Only)
```typescript
// Line 204
async function discoverClaudeSessionFiles(): Promise<SessionFileInfo[]> {
  const claudeProjectsDir = path.join(homeDir, '.claude', 'projects');
  // Scans local ~/.claude/projects/ only
}

// Line 250
async function discoverCodexSessionFiles(): Promise<SessionFileInfo[]> {
  const codexSessionsDir = path.join(homeDir, '.codex', 'sessions');
  // Scans local ~/.codex/sessions/ only
}
```

### Keyboard Shortcuts Analysis
**File:** `/app/Maestro/src/renderer/constants/shortcuts.ts`

Current shortcuts using `Alt+Meta` (Option+Command):
- `toggleSidebar`: `['Alt', 'Meta', 'ArrowLeft']`
- `toggleRightPanel`: `['Alt', 'Meta', 'ArrowRight']`
- `newGroupChat`: `['Alt', 'Meta', 'c']`
- `agentSettings`: `['Alt', 'Meta', ',']`
- `systemLogs`: `['Alt', 'Meta', 'l']`
- `processMonitor`: `['Alt', 'Meta', 'p']`
- `usageDashboard`: `['Alt', 'Meta', 'u']`
- `tabSwitcher`: `['Alt', 'Meta', 't']`
- `closeOtherTabs`: `['Alt', 'Meta', 'w']`
- `jumpToSession` (1-0): `['Alt', 'Meta', '1-0']` (FIXED)

**`['Alt', 'Meta', 'a']` is NOT currently reserved** and can be assigned to open the About Modal.

### Trophy Icon Location
**File:** `/app/Maestro/src/renderer/components/SessionList.tsx` (lines 2470-2483)

```tsx
<button
  onClick={() => setAboutModalOpen(true)}
  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold..."
  title={`${getBadgeForTime(autoRunStats.cumulativeTimeMs)?.name || 'Apprentice'} - Click to view achievements`}
  ...
>
  <Trophy className="w-3 h-3" />
  <span>{autoRunStats.currentBadgeLevel}</span>
</button>
```

Current tooltip shows badge name only. Need to add keyboard shortcut hint.

---

## Proposed Implementation Plan

### Phase 1: Backend - Add SSH Remote Session Discovery

#### Task 1.1: Create SSH Remote Session Discovery Function
**File:** `/app/Maestro/src/main/ipc/handlers/agentSessions.ts`

Create a new function `discoverRemoteClaudeSessionFiles()`:
```typescript
async function discoverRemoteClaudeSessionFiles(
  sshConfig: SshRemoteConfig
): Promise<SessionFileInfo[]> {
  // Use readDirRemote to list ~/.claude/projects/ on remote
  // Parse each project directory for .jsonl files
  // Return with sessionKey prefixed by sshConfig.id for uniqueness
}
```

#### Task 1.2: Update Cache Structure for Remote Sessions
**File:** `/app/Maestro/src/main/utils/statsCache.ts`

Update `GlobalStatsCache` to track remote sessions separately:
```typescript
interface GlobalStatsCache {
  version: number;
  lastUpdated: number;
  providers: {
    'claude-code': { sessions: Record<string, CachedSessionStats> };
    'codex': { sessions: Record<string, CachedSessionStats> };
  };
  remoteProviders?: {
    [sshRemoteId: string]: {
      'claude-code': { sessions: Record<string, CachedSessionStats> };
    };
  };
}
```

#### Task 1.3: Update `getGlobalStats` Handler
**File:** `/app/Maestro/src/main/ipc/handlers/agentSessions.ts`

Modify the handler to:
1. Get all enabled SSH remotes from `settingsStore.get('sshRemotes')`
2. For each remote, discover and parse session files
3. Aggregate remote stats into the `GlobalAgentStats` result
4. Add `byRemote` field for per-remote breakdown (optional enhancement)

```typescript
// In buildResultFromCache, add remote session aggregation
for (const [remoteId, remoteProviders] of Object.entries(cache.remoteProviders || {})) {
  const remoteClaude = remoteProviders['claude-code']?.sessions || {};
  const remoteAgg = aggregateProviderStats(remoteClaude, true);
  result.totalSessions += remoteAgg.sessions;
  result.totalMessages += remoteAgg.messages;
  // ... etc
}
```

### Phase 2: Frontend - Update About Modal UI

#### Task 2.1: Update Note Text
**File:** `/app/Maestro/src/renderer/components/AboutModal.tsx`

Change line 325:
```tsx
// FROM:
Local sessions only. SSH Remote sessions shown in Session Explorer.

// TO:
Includes Local and SSH Remote sessions.
```

### Phase 3: Add Keyboard Shortcut

#### Task 3.1: Add Shortcut to Constants
**File:** `/app/Maestro/src/renderer/constants/shortcuts.ts`

Add new entry to `DEFAULT_SHORTCUTS`:
```typescript
aboutModal: {
  id: 'aboutModal',
  label: 'About Maestro',
  keys: ['Alt', 'Meta', 'a'],
},
```

#### Task 3.2: Add Handler in Main Keyboard Handler
**File:** `/app/Maestro/src/renderer/hooks/keyboard/useMainKeyboardHandler.ts`

Add case in keyboard handler:
```typescript
if (ctx.isShortcut('aboutModal', e)) {
  e.preventDefault();
  ctx.setAboutModalOpen(true);
  return;
}
```

#### Task 3.3: Update Trophy Icon Tooltip
**File:** `/app/Maestro/src/renderer/components/SessionList.tsx`

Update the trophy button title to include shortcut:
```tsx
title={`${getBadgeForTime(autoRunStats.cumulativeTimeMs)?.name || 'Apprentice'} - Click to view achievements (⌥⌘A)`}
```

### Phase 4: Testing & Verification

#### Test Cases
1. **Local-only setup:** Global stats should show same results as before
2. **With SSH remotes:** Stats should include remote session data
3. **Remote connection failure:** Should gracefully handle and show partial stats
4. **Keyboard shortcut:** `Option+Command+A` opens About Modal from any context
5. **Trophy tooltip:** Shows updated text with shortcut hint
6. **Performance:** Remote stats fetching should not block UI (async with streaming updates)

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/main/ipc/handlers/agentSessions.ts` | Add SSH remote session discovery, update `getGlobalStats` |
| `src/main/utils/statsCache.ts` | Add remote providers to cache structure |
| `src/renderer/components/AboutModal.tsx` | Update note text |
| `src/renderer/constants/shortcuts.ts` | Add `aboutModal` shortcut |
| `src/renderer/hooks/keyboard/useMainKeyboardHandler.ts` | Add shortcut handler |
| `src/renderer/components/SessionList.tsx` | Update trophy tooltip |

---

## Complexity Assessment

### Low Complexity
- Update note text in AboutModal
- Add keyboard shortcut constant and handler
- Update trophy tooltip

### Medium Complexity
- Implement SSH remote session discovery function
- Update cache structure for remote sessions

### Higher Complexity (Requires Careful Design)
- Integrate remote stats into existing aggregation without breaking local-only functionality
- Handle network timeouts and errors gracefully
- Ensure streaming updates work correctly with remote data

---

## Alternative Approaches Considered

### Approach A: Inline Remote Fetching (Selected)
Fetch remote stats as part of the existing `getGlobalStats` flow with streaming updates.
- **Pros:** Unified code path, consistent UX
- **Cons:** May slow down initial display if remotes are slow

### Approach B: Separate Remote Stats Button
Add a "Include Remotes" toggle in the About Modal.
- **Pros:** User control, no impact on default speed
- **Cons:** More UI complexity, less intuitive

### Approach C: Background Pre-fetch
Periodically fetch remote stats in background and cache.
- **Pros:** Fast display
- **Cons:** Stale data, extra complexity

**Recommendation:** Approach A with proper timeout handling (e.g., 5-second timeout per remote)

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Remote fetch slows About Modal | Use streaming updates, show local first |
| SSH connection failures | Graceful error handling, show partial stats |
| Cache invalidation complexity | Use mtime-based validation like local |
| Large remote session counts | Same incremental parsing as local |

---

## Open Questions for Discussion

1. ~~**Should remote stats be optional?** Add a toggle vs. always include?~~ **RESOLVED:** No toggle needed - leaderboard uses separate `AutoRunStats`, not `GlobalAgentStats`. Merging local+remote is appropriate.
2. **Per-remote breakdown?** Show stats broken down by remote in the UI? (Optional enhancement)
3. **Timeout handling:** What's acceptable latency before showing partial results? (Suggest 5s per remote)
4. **Cache invalidation:** How often to re-check remote session files? (Suggest on modal open, with mtime-based incremental updates)

---

## Summary: Leaderboard vs Global Stats

| Aspect | Leaderboard | Global Statistics |
|--------|-------------|-------------------|
| Data Source | `AutoRunStats` | `GlobalAgentStats` |
| What it tracks | AutoRun time, runs, badges | Sessions, messages, tokens, cost |
| Submitted externally? | Yes (runmaestro.ai) | No (display only) |
| Toggle needed? | N/A | No |
| SSH Remote impact | Separate concern | Should include |

---

## Next Steps

1. Review this plan and approve approach
2. Create Auto Run documents for implementation phases
3. Implement in order: Backend → Frontend → Shortcuts → Testing

---

---

## Implementation Notes

**Implemented:** 2026-02-13

### Changes Made:
1. Updated `GlobalAgentStats` interface with `byRemote` field for per-remote breakdown
2. Updated `GlobalStatsCache` to persist remote provider stats
3. Added `discoverRemoteClaudeSessionFiles` and `parseRemoteClaudeSession` functions
4. Integrated remote stats fetching into `getGlobalStats` IPC handler with streaming updates
5. Updated About Modal UI with remote breakdown expandable section
6. Changed note text to "Includes Local and SSH Remote sessions."
7. Added `Option+Command+A` keyboard shortcut to open About Modal
8. Updated trophy icon tooltip to show shortcut hint

### Files Modified:
- `src/shared/types.ts`
- `src/main/utils/statsCache.ts`
- `src/main/ipc/handlers/agentSessions.ts`
- `src/renderer/components/AboutModal.tsx`
- `src/renderer/constants/shortcuts.ts`
- `src/renderer/hooks/keyboard/useMainKeyboardHandler.ts`
- `src/renderer/components/SessionList.tsx`

### Phase 2 Changes (UI/UX Improvements - 2026-02-13):
1. Increased default SSH stats timeout from 5s to 30s
2. Added configurable timeout setting in General Settings tab
3. Added "Refresh" button to Global Statistics header for manual refresh
4. Added loading overlay on individual stats while data is fetching
5. Made remote breakdown list scrollable (max-height: 192px)
6. Improved spacing in per-remote stat displays (gap-x-4, gap-2)
7. Added subtle background styling to scrollable remote list

### Additional Files Modified:
- `src/main/ipc/handlers/persistence.ts` (MaestroSettings type)
- `src/main/stores/defaults.ts` (default sshStatsTimeoutMs value)
- `src/main/stores/types.ts` (MaestroSettings type definition)
- `src/renderer/hooks/settings/useSettings.ts` (sshStatsTimeoutMs state and persistence)

---

*Document prepared by maestro-planner. Ready for user review.*
