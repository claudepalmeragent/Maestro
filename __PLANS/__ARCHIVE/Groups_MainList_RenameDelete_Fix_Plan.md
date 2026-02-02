# Groups: Main List Button & Rename/Delete Fix Plan

**Date:** 2026-02-02
**Author:** agent-planner

## Issues Reported

1. **Create Group button missing in main list** - Users cannot create groups outside of Project Folders when Project Folders exist
2. **Cannot rename or delete custom Groups** - Need improved discoverability for these operations

---

## Root Cause Analysis

### Issue 1: Create Group Button Missing When Project Folders Exist

**Root Cause:** The "New Group" button visibility depends on multiple conditions that hide it in certain scenarios.

**Problem Areas:**

#### A. "Unassigned" Section (lines 2981-3007)
When project folders exist, there's an "Unassigned" section for items without a `projectFolderId`. This section:
- Has NO "New Group" button at all
- Only renders if there are unassigned items (line 2991: `if (!hasUnassigned) return null`)

```typescript
// Line 2994-3001 - No New Group button in Unassigned header
<div className="px-3 py-1.5 flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
  <Folder className="w-3.5 h-3.5" />
  <span>Unassigned</span>
</div>
```

#### B. Project Folder's Ungrouped Section (lines 2187-2226)
Inside `renderFolderSessions()`, the "New Group" button only appears when:
- `folderUngrouped.length > 0` (line 2188)

If all sessions in a folder are already in groups, there's no way to create a new group.

#### C. Legacy View (lines 3173-3210)
The legacy "Ungrouped Agents" section (when NO project folders exist) correctly shows the New Group button, but this entire section is hidden when `hasProjectFolders` is true.

**Summary:** When project folders exist, users can only create groups if:
1. They're inside a Project Folder AND
2. That folder has ungrouped sessions

### Issue 2: Group Rename/Delete Not Discoverable

**Current Behavior (Legacy View):**
- **Rename:** Double-click on group name (line 3099)
- **Delete:** Hover to reveal X button, only for EMPTY groups (lines 3105-3121)

**Problems:**
1. Double-click to rename is not discoverable
2. Delete only works for empty groups - can't delete groups with agents
3. No context menu for groups
4. Inside Project Folders (`renderFolderSessions`), there's NO rename/delete UI at all for groups

---

## Proposed Fixes

### Fix 1: Always Show "New Group" Button in Key Locations

#### Fix 1A: Add New Group button to "Unassigned" section header

**File:** `src/renderer/components/SessionList.tsx`
**Location:** Lines 2994-3001

Add a "New Group" button similar to the legacy Ungrouped section:
```typescript
<div className="px-3 py-1.5 flex items-center justify-between">
  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
    <Folder className="w-3.5 h-3.5" />
    <span>Unassigned</span>
  </div>
  <button onClick={() => createNewGroup()} ...>
    <Plus /> New Group
  </button>
</div>
```

#### Fix 1B: Show "Ungrouped" section even when empty (inside renderFolderSessions)

**File:** `src/renderer/components/SessionList.tsx`
**Location:** Line 2188

Change from:
```typescript
{folderUngrouped.length > 0 && (
```

To always show the header with button, but only show session list if sessions exist:
```typescript
{/* Always show header with New Group button */}
<div className="mb-1 ml-2">
  <div className="px-3 py-1 flex items-center justify-between ...">
    <div className="flex items-center gap-2">
      <Folder className="w-3 h-3" />
      <span>Ungrouped</span>
    </div>
    <button onClick={() => createNewGroup(folderId ?? undefined)} ...>
      New Group
    </button>
  </div>
  {folderUngrouped.length > 0 && (
    <div className="flex flex-col border-l ml-4">
      {/* session list */}
    </div>
  )}
</div>
```

### Fix 2: Add Context Menu for Groups

Add a right-click context menu for group headers with:
- **Rename** - Opens inline edit or modal
- **Delete** - With confirmation (works for non-empty groups too, moving agents to ungrouped)
- **Change Emoji** - Quick access to emoji picker

**Implementation:**

1. Add `GroupContextMenu` component similar to `SessionContextMenu`
2. Add `onContextMenu` handler to group header divs
3. Track `groupContextMenu` state (x, y, groupId)

**Files to modify:**
- `src/renderer/components/SessionList.tsx` - Add context menu state and handlers
- Create new component or add to existing context menu system

### Fix 3: Add Visible Action Icons on Group Headers

As an alternative/addition to context menu, add always-visible or hover-visible icons:

```typescript
<div className="group-header flex items-center justify-between">
  <span>{group.emoji} {group.name}</span>
  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
    <button onClick={() => startRenamingGroup(group.id)} title="Rename">
      <Pencil className="w-3 h-3" />
    </button>
    <button onClick={() => handleDeleteGroup(group.id)} title="Delete">
      <Trash2 className="w-3 h-3" />
    </button>
  </div>
</div>
```

### Fix 4: Allow Deleting Non-Empty Groups

Current code only allows deleting empty groups. Change to:
- Show confirmation dialog that explains agents will be moved to ungrouped
- On confirm, clear `groupId` from all sessions in that group, then delete the group

---

## Implementation Order

1. **Fix 1A** - Add New Group button to Unassigned section (quick win)
2. **Fix 1B** - Always show Ungrouped header with button in renderFolderSessions
3. **Fix 3** - Add visible action icons on group headers (moderate)
4. **Fix 4** - Allow deleting non-empty groups
5. **Fix 2** - Add context menu (optional, for consistency with sessions)

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/renderer/components/SessionList.tsx` | - Add New Group button to Unassigned section<br>- Always show Ungrouped header in renderFolderSessions<br>- Add action icons to group headers<br>- Allow deleting non-empty groups<br>- (Optional) Add group context menu |

---

## Testing Checklist

After implementation:
- [ ] Can create group in main list when project folders exist (via Unassigned section)
- [ ] Can create group inside a Project Folder even when all sessions are grouped
- [ ] Can rename a group by clicking visible edit icon
- [ ] Can delete a group with agents (agents move to ungrouped)
- [ ] Can delete an empty group
- [ ] Rename and delete work in both legacy view and project folders view
