# Project Folders - Ungrouped Agents & Session Visibility Fix Plan

**Date:** 2026-02-01
**Author:** @agent-planner
**Status:** Ready for Implementation

## Issues Reported by User

1. **Agent disappears from Project Folder when bookmark is removed**
2. **"Ungrouped Agents" group is missing** - not visible within Project Folders

## Root Cause Analysis

### Issue 1: Session Disappears When Unbookmarked

**Location:** `SessionList.tsx:2089-2091`

```typescript
const renderFolderSessions = (folderId, folderGroups, folderSessions) => {
    const folderBookmarked = folderSessions.filter((s) => s.bookmarked);
    const folderUngrouped = folderSessions.filter((s) => !s.groupId);
    // ...
}
```

**The Problem:**
- `folderUngrouped` filters to sessions WITHOUT a `groupId`
- When a session is unbookmarked, it's still in `folderUngrouped` (if it has no groupId)
- **BUT** the "Ungrouped" section is only rendered when `folderGroups.length > 0` (line 2176)

**Line 2176:**
```typescript
{folderUngrouped.length > 0 && folderGroups.length > 0 && (
```

This means: **Ungrouped sessions are ONLY visible if there are also Groups in the folder.**

### Issue 2: "Ungrouped Agents" Section Not Showing

**Same root cause as above.** The condition on line 2176 requires `folderGroups.length > 0` for the "Ungrouped" section to appear.

Additionally, when there are NO groups (`folderGroups.length === 0`), sessions are rendered in a "flat" view (lines 2199-2206), but this flat view doesn't have an "Ungrouped" header - it just shows sessions directly.

### Why Bookmarked Sessions Show But Unbookmarked Don't

Looking at lines 2110-2133, the "Bookmarks" section is rendered unconditionally when there are bookmarked sessions:

```typescript
{folderBookmarked.length > 0 && (   // ← No dependency on groups!
    <div className="mb-1 ml-2">
        ...
    </div>
)}
```

But the "Ungrouped" section requires groups to exist:

```typescript
{folderUngrouped.length > 0 && folderGroups.length > 0 && (  // ← Requires groups!
```

### The Logic Flow

1. User drags a bookmarked session into a Project Folder
2. Session appears in "Bookmarks" section (works correctly)
3. User removes bookmark
4. Session is no longer in `folderBookmarked`
5. Session should appear in `folderUngrouped` (since it has no `groupId`)
6. **BUT** the condition `folderGroups.length > 0` fails (no groups in folder)
7. Session is invisible!

The "flat" view fallback (lines 2199-2206) does render the session, BUT it's filtered by `sortedFolderUngrouped` which uses `folderUngrouped` - this should work BUT the session may have `groupId` set or the condition is still failing.

**Wait** - re-reading line 2199:
```typescript
{folderSessions.length > 0 && folderGroups.length === 0 && (
```

This uses `folderSessions.length > 0` (all sessions), but renders `sortedFolderUngrouped` (sessions without groupId).

If the session has a `groupId` but the group is not assigned to this folder, the session won't appear anywhere!

## Detailed Fix Requirements

### Fix 1: Always Show "Ungrouped" Section Within Project Folders

**Change line 2176 from:**
```typescript
{folderUngrouped.length > 0 && folderGroups.length > 0 && (
```

**To:**
```typescript
{folderUngrouped.length > 0 && (
```

This will ALWAYS show the "Ungrouped" section when there are ungrouped sessions, regardless of whether groups exist.

### Fix 2: Remove Redundant "Flat" View in Favor of Consistent "Ungrouped" Section

**Lines 2198-2207 can be removed** or modified to only show when there are NEITHER bookmarked NOR ungrouped sessions (edge case).

Actually, the better fix is to keep the flat view for the case when `folderGroups.length === 0` but make it consistent:

**Option A (Recommended):** Always use "Ungrouped Agents" header when there are ungrouped sessions

**Option B:** Keep flat view but ensure it catches all sessions

### Fix 3: Handle Sessions with groupId That Belongs to Non-Assigned Group

Currently, if a session has `groupId = "abc"` but group "abc" is NOT assigned to the project folder, that session is:
- Not in `folderBookmarked` (unless bookmarked)
- Not in `folderUngrouped` (because it has a groupId)
- Not in `folderGroupedMap` (because the group isn't in `folderGroups`)

**Result:** The session is invisible!

**Fix:** When rendering sessions in a project folder, sessions whose `groupId` refers to a group NOT in this folder should be treated as "ungrouped" for display purposes within this folder.

## Implementation Plan

### Step 1: Fix the "Ungrouped" Section Visibility

**File:** `src/renderer/components/SessionList.tsx`
**Lines:** 2176

Change:
```typescript
{folderUngrouped.length > 0 && folderGroups.length > 0 && (
```
To:
```typescript
{folderUngrouped.length > 0 && (
```

### Step 2: Update folderUngrouped Filter to Include "Orphaned" Sessions

**File:** `src/renderer/components/SessionList.tsx`
**Lines:** 2091

Currently:
```typescript
const folderUngrouped = folderSessions.filter((s) => !s.groupId);
```

Change to:
```typescript
const folderGroupIds = new Set(folderGroups.map(g => g.id));
const folderUngrouped = folderSessions.filter(
    (s) => !s.groupId || !folderGroupIds.has(s.groupId)
);
```

This ensures sessions with a `groupId` that doesn't exist in this folder are still visible in "Ungrouped".

### Step 3: Remove or Adjust the "Flat" View Block

**Lines 2198-2207** - Since we're now always showing "Ungrouped" when there are ungrouped sessions, we can:
- Remove this block entirely, OR
- Keep it for styling purposes but change the condition

**Recommended:** Remove lines 2198-2207 since the "Ungrouped" section will now handle all cases.

### Step 4: Ensure Non-Bookmarked, Non-Grouped Sessions Are Visible

After Step 1 and Step 2, any session that:
- Is not bookmarked
- Has no groupId, OR has a groupId not in this folder's groups

Will appear in the "Ungrouped" section.

## Testing Checklist

1. **Drag a bookmarked session into a Project Folder**
   - Session appears in "Bookmarks" section ✓

2. **Remove the bookmark**
   - Session should appear in "Ungrouped Agents" section
   - Session should NOT disappear

3. **Drag a non-bookmarked session into a Project Folder**
   - Session appears in "Ungrouped Agents" section immediately

4. **Create a Group and add a session to it**
   - Session appears in the Group section

5. **Drag a grouped session into a different Project Folder**
   - Session appears in "Ungrouped Agents" (since its group isn't in this folder)

6. **Project Folder with only ungrouped sessions (no groups)**
   - "Ungrouped Agents" section should be visible

7. **Empty Project Folder**
   - Shows "Drag agents here to organize" message

## Files to Modify

| File | Changes |
|------|---------|
| `src/renderer/components/SessionList.tsx` | Lines 2091, 2176, and optionally 2198-2207 |

## Notes

- The existing logic for the main "Ungrouped Agents" section (lines 3154-3221) is different and works correctly - it's the project folder-specific rendering (`renderFolderSessions`) that has the bug.
- The fix is minimal and low-risk - just adjusting filter logic and a conditional.

## Assignee

**@agent-dev-4** - Please implement the changes as described above.

---

**IMPORTANT:** @moderator - Please distribute this plan to all agents before implementation begins. @agent-planner will STOP here and wait for confirmation.
