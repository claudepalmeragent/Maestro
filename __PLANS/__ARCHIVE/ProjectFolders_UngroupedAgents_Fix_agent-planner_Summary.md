# Project Folders: Ungrouped Agents Fix Summary

**Agent:** agent-planner (claude cloud)
**Date:** 2026-02-01
**Commit:** `1f102b64`

## Issues Fixed

1. **Session disappears when unbookmarked in Project Folder**
2. **"Ungrouped Agents" section not visible in Project Folders**

## Root Causes Identified

| Issue | Root Cause | Location |
|-------|------------|----------|
| Session disappears when unbookmarked | "Ungrouped" section only renders when `folderGroups.length > 0` | Line 2176 |
| "Ungrouped Agents" not showing | Same condition - requires groups to exist | Line 2176 |
| Orphaned sessions invisible | Sessions with groupIds not in current folder's groups weren't included in `folderUngrouped` | Line 2091 |

## Changes Made

### File: `src/renderer/components/SessionList.tsx`

#### Fix 1: Updated `folderUngrouped` Filter (Lines 2091-2095)
```typescript
// Before:
const folderUngrouped = folderSessions.filter((s) => !s.groupId);

// After:
const folderGroupIds = new Set(folderGroups.map((g) => g.id));
const folderUngrouped = folderSessions.filter(
  (s) => !s.groupId || !folderGroupIds.has(s.groupId)
);
```

#### Fix 2: Removed `folderGroups.length > 0` Condition (Line 2180)
```typescript
// Before:
{folderUngrouped.length > 0 && folderGroups.length > 0 && (

// After:
{folderUngrouped.length > 0 && (
```

#### Fix 3: Removed Redundant Flat View Block (Lines 2198-2207)
Removed the entire block:
```typescript
{/* If no groups, show sessions directly */}
{folderSessions.length > 0 && folderGroups.length === 0 && (
  <div className="flex flex-col ml-2">
    {sortedFolderUngrouped.map((session) =>
      renderSessionWithWorktrees(session, 'flat', {
        keyPrefix: `folder-${folderId}-flat`,
      })
    )}
  </div>
)}
```

## Verification

- TypeScript compilation: ✅ No new errors
- Pre-commit hooks: ✅ Passed (prettier, eslint)

## Expected Behavior After Fix

1. Session dragged into Project Folder while bookmarked → Appears in "Bookmarks" section
2. Bookmark removed → Session moves to "Ungrouped" section (no longer disappears)
3. Non-bookmarked session dragged into folder → Appears in "Ungrouped" section
4. Session with groupId from another folder → Appears in "Ungrouped" section
5. Project Folder with only ungrouped sessions (no groups) → "Ungrouped" section is visible
