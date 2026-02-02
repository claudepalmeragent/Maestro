# Project Folders: Group Scoping & Create Group Button Fix Plan

**Date:** 2026-02-02
**Author:** agent-planner

## Issues Reported

1. **Custom groups are shared across projects** - When right-clicking an agent in a Project Folder, ALL groups appear in the "Move to Group" submenu, not just groups belonging to that folder.

2. **Create Group button not visible** - The "New Group" button is missing from both the main list's Ungrouped section and Project Folder views.

---

## Root Cause Analysis

### Issue 1: Groups Shared Across Projects

**Location:** `src/renderer/components/SessionList.tsx`, line 3382

**Problem:** The `SessionContextMenu` component receives the global `groups` prop without filtering:
```tsx
<SessionContextMenu
  ...
  groups={groups}  // ← PROBLEM: passes ALL groups, not folder-specific
  ...
/>
```

**Why it happens:** The context menu doesn't know which Project Folder the right-clicked session belongs to. It needs to:
1. Determine if the session is in a Project Folder
2. If so, filter groups to only show those with matching `projectFolderId`
3. If not (unassigned sessions), show only groups with no `projectFolderId`

**Existing helper function:** `getGroupsForProjectFolder(folderId: string | null)` at line 1845 already does the filtering correctly:
```tsx
const getGroupsForProjectFolder = useCallback(
  (folderId: string | null): Group[] => {
    if (folderId === null) {
      return groups.filter((g) => !g.projectFolderId);
    }
    return groups.filter((g) => g.projectFolderId === folderId);
  },
  [groups]
);
```

### Issue 2: Create Group Button Missing

**Location:** `src/renderer/components/SessionList.tsx`

**Problem A - Main List:** The "New Group" button at line 3188-3191 is inside the `{ungroupedSessions.length > 0 && (` block at line 3145. If there are no ungrouped sessions in the main list (because they've been assigned to Project Folders), the button disappears.

**Problem B - Project Folders:** The `renderFolderSessions()` function (lines 2085-2224) has NO "New Group" button at all. Compare:
- Main list Ungrouped section (line 3175-3192): Has header with "New Group" button
- Project Folder Ungrouped section (line 2181-2199): Only has header, NO button

---

## Proposed Fixes

### Fix 1: Filter Groups in Context Menu by Project Folder

**File:** `src/renderer/components/SessionList.tsx`

**Change at line 3382:**
```tsx
// Before:
groups={groups}

// After:
groups={(() => {
  // Determine which project folder this session belongs to
  const sessionFolderId = contextMenuSession.projectFolderIds?.[0] || null;
  return getGroupsForProjectFolder(sessionFolderId);
})()}
```

**Alternative (cleaner):** Create a memoized value before the JSX:
```tsx
// Add before the return statement in the render section
const contextMenuGroups = useMemo(() => {
  if (!contextMenuSession) return groups;
  const sessionFolderId = contextMenuSession.projectFolderIds?.[0] || null;
  return getGroupsForProjectFolder(sessionFolderId);
}, [contextMenuSession, getGroupsForProjectFolder, groups]);

// Then use:
groups={contextMenuGroups}
```

### Fix 2A: Show New Group Button Even When No Ungrouped Sessions (Main List)

**File:** `src/renderer/components/SessionList.tsx`

**Option 1:** Move the New Group button outside the `ungroupedSessions.length > 0` condition

**Option 2:** Change condition to always show the Ungrouped section header with button:
```tsx
// At line 3145, change:
{ungroupedSessions.length > 0 && (

// To:
{(ungroupedSessions.length > 0 || groups.filter(g => !g.projectFolderId).length > 0 || true) && (
```

**Recommended:** Option 1 - Move the "Ungrouped Agents" header with New Group button to always be visible, but only show the session list when there are sessions.

### Fix 2B: Add New Group Button to Project Folder's Ungrouped Section

**File:** `src/renderer/components/SessionList.tsx`

**Location:** Inside `renderFolderSessions()`, update the Ungrouped section (lines 2181-2199)

**Change the header from:**
```tsx
<div
  className="px-3 py-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider"
  style={{ color: theme.colors.textDim }}
>
  <Folder className="w-3 h-3" />
  <span>Ungrouped</span>
</div>
```

**To (matching main list pattern):**
```tsx
<div
  className="px-3 py-1 flex items-center justify-between"
>
  <div
    className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider"
    style={{ color: theme.colors.textDim }}
  >
    <Folder className="w-3 h-3" />
    <span>Ungrouped</span>
  </div>
  <button
    onClick={(e) => {
      e.stopPropagation();
      // Need to pass folderId to createNewGroup or use a folder-aware version
      createNewGroup(); // May need modification to accept folderId
    }}
    className="px-2 py-0.5 rounded-full text-[10px] font-medium hover:opacity-80 transition-opacity flex items-center gap-1"
    style={{
      backgroundColor: theme.colors.accent + '20',
      color: theme.colors.accent,
      border: `1px solid ${theme.colors.accent}40`,
    }}
    title="Create new group"
  >
    <Plus className="w-3 h-3" />
    <span>New Group</span>
  </button>
</div>
```

**Additional requirement:** The `createNewGroup` function may need to be modified to:
1. Accept an optional `projectFolderId` parameter
2. Automatically assign the new group to the current Project Folder

---

## Implementation Order

1. **Fix 1:** Filter groups in context menu (prevents cross-folder group visibility)
2. **Fix 2B:** Add New Group button to Project Folder's Ungrouped section
3. **Fix 2A:** Ensure main list New Group button is always visible
4. **Optional:** Modify `createNewGroup` to accept folder context

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/renderer/components/SessionList.tsx` | - Filter groups in context menu (line ~3382)<br>- Add New Group button to renderFolderSessions (line ~2181)<br>- Ensure main list button visibility (line ~3145) |

---

## Testing Checklist

After implementation:
- [ ] Right-click agent in Project Folder → "Move to Group" shows ONLY groups from that folder
- [ ] Right-click agent in main Unassigned → "Move to Group" shows ONLY unassigned groups
- [ ] "New Group" button visible in main list Ungrouped section
- [ ] "New Group" button visible in each Project Folder's Ungrouped section
- [ ] Creating a group in a Project Folder assigns it to that folder
- [ ] Creating a group in main list keeps it unassigned
