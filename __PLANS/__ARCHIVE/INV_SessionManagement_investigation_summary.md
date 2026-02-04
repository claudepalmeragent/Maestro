# Session Management SSH Remote Support - Implementation Summary

> **Completion Date:** February 3, 2026
> **Final Commit:** `b854cf5e`
> **Status:** COMPLETED & VERIFIED

---

## Problem

When using SSH Remote agents in Maestro, the Session Explorer (Cmd+Shift+L) showed "0 sessions" even though sessions existed on the remote host. This occurred because:

1. Claude Code runs on the **remote host** and writes session files to the remote's `~/.claude/projects/`
2. Maestro's Session Explorer only looked at the **local machine's** `~/.claude/projects/`
3. The existing infrastructure for remote session listing existed but was not wired up in the UI

## Solution Implemented

**Option B: Full SSH Remote Support** - Pass `sshRemoteId` to all session-related API calls in the Session Explorer, plus scan ALL project folders on the remote host.

## Issues Encountered & Fixes

### Issue 1: Missing settingsStore parameter
**Symptom:** Log showed "Settings store not available for SSH remote lookup"

**Root cause:** `registerAgentSessionsHandlers()` was called without `settingsStore` parameter in `src/main/index.ts:466`

**Fix:** Added `settingsStore: store` to the handler registration (commit `70b01362`)

### Issue 2: Home directory expansion in SSH paths
**Symptom:** "Directory not found or not accessible: ~/.claude/projects/-app"

**Root cause:** `shellEscape()` wraps paths in single quotes (`'~/.claude/projects/-app'`), which prevents shell expansion of `~`

**Fix:** Added `escapeRemotePath()` helper in `remote-fs.ts` that uses `"$HOME"'/rest/of/path'` pattern to allow shell expansion while keeping the path safe (commit `69e4fbc3`)

### Issue 3: Large session files exceeding buffer limits
**Symptom:** "stdout maxBuffer length exceeded" for large session files (>10MB)

**Root cause:** SSH `cat` command output exceeded the 10MB buffer limit for large JSONL session files

**Fix:** Added `readFileRemotePartial()` function that uses `head`/`tail` to read only first 100 and last 50 lines for files >5MB. Added `parsePartialSessionContent()` to extract metadata from partial content. (commit `28d13c98`)

### Issue 4: Only showing sessions from current project folder
**Symptom:** Only 11 sessions shown instead of 38 (sessions were split across `-app` and `-home-maestro` folders)

**Root cause:** Session listing only scanned the encoded path for the current `projectRoot`, not all project folders

**Fix:** Modified `listSessionsPaginatedRemote()` to scan ALL subdirectories under `~/.claude/projects/` on the remote host. Added `decodeProjectPath()` to convert encoded dir names back to paths. (commit `b854cf5e`)

### Issue 5: Stats counters showing zero for SSH Remote sessions
**Symptom:** Session/messages/data/cost/token counters at top of Session Explorer all show zero for SSH Remote sessions, even after sessions loaded

**Root cause:** Claude Code sessions used `onProjectStatsUpdate` event listener which only fires for the current project path. Since SSH Remote now scans ALL project folders, this event doesn't cover all sessions.

**Fix:** Modified the stats computation useEffect in `AgentSessionsBrowser.tsx` to compute stats from the loaded sessions array for SSH Remote sessions (when `isRemoteSession` is true), instead of relying on the project-specific event listener. (commit `61ceb51b`)

## Changes Made

### 1. AgentSessionsModal.tsx
- Now passes `sshRemoteId` to `listPaginated()`, `loadMoreSessions()`, `loadMessages()`
- Effect dependencies updated to re-fetch when SSH config changes
- UI: Added "Remote" badge, loading text, and context-aware empty state

### 2. AboutModal.tsx
- Added informational note: "Local sessions only. SSH Remote sessions shown in Session Explorer."

### 3. src/main/index.ts
- Fixed handler registration to pass `settingsStore` for SSH remote config lookup

### 4. src/main/utils/remote-fs.ts
- Added `escapeRemotePath()` function to handle `~` and `$HOME` expansion in SSH paths
- Added `readFileRemotePartial()` for reading large files efficiently
- Updated `readDirRemote()`, `readFileRemote()`, `statRemote()` to use `escapeRemotePath()`

### 5. src/main/storage/claude-session-storage.ts
- Added `parsePartialSessionContent()` for extracting metadata from partial file content
- Updated `parseSessionFileRemote()` to use partial reading for files >5MB
- Modified `listSessionsPaginatedRemote()` to scan ALL project directories
- Added `decodeProjectPath()` to convert encoded dir names back to paths
- Added debug logging for remote session listing

### 6. Test Updates
- Updated 2 tests to expect `undefined` as the 4th parameter (sshRemoteId) for local sessions

## Files Modified

| File | Purpose |
|------|---------|
| `src/renderer/components/AgentSessionsModal.tsx` | SSH Remote session support |
| `src/renderer/components/AgentSessionsBrowser.tsx` | Stats computation for SSH Remote |
| `src/renderer/components/AboutModal.tsx` | Info note about local-only stats |
| `src/main/index.ts` | Pass settingsStore to handler registration |
| `src/main/utils/remote-fs.ts` | Fix home directory expansion, add partial file reading |
| `src/main/storage/claude-session-storage.ts` | Large file handling, scan all project folders |
| `src/__tests__/renderer/components/AgentSessionsModal.test.tsx` | Test updates |

## Commits

| Commit | Description |
|--------|-------------|
| `768ddb72` | Initial SSH Remote support for Session Explorer |
| `70b01362` | Fix: pass settingsStore to registerAgentSessionsHandlers |
| `dff8401c` | Debug: add logging for SSH remote session lookup |
| `69e4fbc3` | Fix: handle home directory expansion in SSH paths |
| `28d13c98` | Fix: handle large remote session files with partial reading |
| `b854cf5e` | Feat: scan ALL project folders for SSH Remote sessions |
| `61ceb51b` | Fix: compute stats from sessions for SSH Remote |

## Test Results

- AgentSessionsModal: **72/72 passed**
- AgentSessionsBrowser: **85/85 passed**
- AboutModal: **47/47 passed**
- remote-fs: **45/45 passed**
- claude-session-storage: **31/31 passed**
- TypeScript: **No new errors**

## User-Facing Changes

| Feature | Before | After |
|---------|--------|-------|
| Session Explorer for SSH Remote | Shows "0 sessions" | Lists ALL sessions from remote host |
| Project folders scanned | Only current project | ALL projects on remote host |
| Large session files | Hang/fail on >10MB files | Efficiently handled via partial reading |
| Stats counters | Shows zeros for SSH Remote | Computes from loaded sessions |
| Visual indicator | None | "Remote" badge in header |
| Loading state | Generic spinner | Shows "Loading from remote..." |
| Empty state | Generic message | Context-aware message for remote |
| About Modal stats | Shows 0 for SSH users | Note explaining local-only + direction to Session Explorer |

## Technical Details

### Shell Escaping Issue

The `~` character only expands when unquoted in shell:
```bash
ls ~/.claude/projects   # Works - ~ expands
ls '~/.claude/projects' # Fails - ~ is literal
```

Fix uses `$HOME` in double quotes concatenated with single-quoted rest:
```bash
ls "$HOME"'/.claude/projects/-app'  # Works - $HOME expands, rest is safe
```

### Large File Handling

For files >5MB, instead of reading entire content via `cat`, we use:
```bash
wc -l < file && echo "SEP" && head -n 100 file && echo "SEP" && tail -n 50 file
```

This gives us:
- Total line count (for message count estimation)
- First 100 lines (for first message preview, timestamp)
- Last 50 lines (for last timestamp/duration)

Trade-offs for large files:
- Message count is estimated (not exact)
- Token totals are partial (from head+tail only)
- Cost is approximate

### All-Projects Scanning

For SSH Remote, the listing now:
1. Lists all subdirectories under `~/.claude/projects/`
2. For each subdirectory, lists all `.jsonl` files
3. Collects all sessions with their decoded project paths
4. Sorts by modification date and returns paginated results

This allows users to see ALL their sessions from the remote host, regardless of which working directory they were created in.

## How to Test

1. Create/select an agent with SSH Remote enabled
2. Run some conversations to generate sessions on the remote (in different directories)
3. Press **Cmd+Shift+L** to open Session Explorer
4. Verify:
   - Sessions from ALL project folders on remote host are listed
   - "Remote" badge appears in header
   - Can view session messages
   - Can resume sessions
   - Large session files load quickly (partial reading)
