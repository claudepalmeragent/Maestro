# Groups Project Scoping Fix Plan

**Date:** 2026-02-02
**Author:** agent-planner

## Issues Reported

1. **Groups not scoped to Project Folders** - New groups created inside a Project Folder appear in the main listing instead of being scoped to that folder.
2. **Create Group button missing in main list** - User reports the button is not showing.
3. **Cannot rename or delete custom Groups** - These operations don't appear to be working.
4. **Group Chats counter shows wrong count** - A newly created Project Folder shows "1" for Group Chats when it should show "0".

---

## Root Cause Analysis

### Issue 1: Groups Not Scoped to Project Folders

**Root Cause:** The `CreateGroupModal` component does NOT set `projectFolderId` when creating a new group.

**Location:** `src/renderer/components/CreateGroupModal.tsx`, lines 23-31

```typescript
const handleCreate = () => {
  if (groupName.trim()) {
    const newGroupId = `group-${generateId()}`;
    const newGroup: Group = {
      id: newGroupId,
      name: groupName.trim().toUpperCase(),
      emoji: groupEmoji,
      collapsed: false,
      // MISSING: projectFolderId should be set here when creating from within a Project Folder
    };
    setGroups([...groups, newGroup]);
    ...
  }
};
```

**Data Model:** The `Group` interface already supports `projectFolderId`:
```typescript
// src/shared/types.ts, lines 7-14
export interface Group {
  id: string;
  name: string;
  emoji: string;
  collapsed: boolean;
  /** Project Folder this group belongs to (1:1 relationship) */
  projectFolderId?: string;
}
```

**Storage:** Groups are stored in `maestro-groups.json` as a flat array. The `projectFolderId` field is already part of the schema but never being set during creation.

**Fix Required:**
1. Pass the current `projectFolderId` context to `CreateGroupModal`
2. Set `projectFolderId` on the new group when created from within a Project Folder

### Issue 2: Create Group Button Missing in Main List

**Analysis:** The button IS present in the code at `SessionList.tsx` line 3194-3209, inside the "Ungrouped Agents" section.

**Condition:** Line 3174: `{sessions.length > 0 && (`

**Possible Causes:**
1. User has no sessions, so the entire section is hidden
2. User's sessions are all assigned to Project Folders, leaving the main list empty
3. The button may not be visible because the user is looking in the wrong section (it's in "Ungrouped Agents" header, not a standalone button)

**Note:** The button was already added by the previous fix (`commit 4ba70e1b`) in the Project Folder's Ungrouped section. The main list button has always existed but may be hidden due to conditions.

**Fix Required:**
1. Clarify visibility - the button exists inside the "Ungrouped Agents" section header
2. Consider showing the button even when there are no ungrouped sessions (for discoverability)

### Issue 3: Cannot Rename or Delete Custom Groups

**Analysis:** Rename and delete functionality EXISTS but uses non-obvious UI patterns:

| Action | How to Trigger | Location |
|--------|----------------|----------|
| **Rename** | Double-click on group name | Line 3099: `onDoubleClick={() => startRenamingGroup(group.id)}` |
| **Delete** | Hover over empty group → click X button | Lines 3105-3121: X button appears on hover, only for empty groups |

**Problems:**
1. Double-click to rename is not discoverable
2. Delete button only shows on hover AND only for empty groups
3. No context menu for groups (unlike sessions/project folders)

**Fix Required:**
1. Add a context menu for groups with Rename/Delete options
2. Or add visible icons that appear on hover (similar to project folders)

### Issue 4: Group Chats Counter Shows Wrong Count

**Root Cause:** The `GroupChatList` component shows `groupChats.length` (total) instead of `sortedGroupChats.length` (filtered).

**Location:** `src/renderer/components/GroupChatList.tsx`, lines 228 and 236

```typescript
{groupChats.length > 0 && (
  <span ...>
    {groupChats.length}  // WRONG: Shows total count
  </span>
)}
```

Should be:
```typescript
{sortedGroupChats.length > 0 && (
  <span ...>
    {sortedGroupChats.length}  // CORRECT: Shows filtered count
  </span>
)}
```

**The `sortedGroupChats` variable** (line 199-212) correctly filters by `projectFolderId`, but the counter badge uses the unfiltered `groupChats` prop.

---

## Proposed Fixes

### Fix 1: Pass projectFolderId to CreateGroupModal

**Files to modify:**
- `src/renderer/components/CreateGroupModal.tsx`
- `src/renderer/components/AppModals.tsx` (where CreateGroupModal is rendered)
- `src/renderer/components/SessionList.tsx` (where createNewGroup is called)

**Changes:**

1. Add `projectFolderId?: string` prop to `CreateGroupModalProps`
2. Set `projectFolderId` on new group in `handleCreate()`
3. Track current folder context in SessionList and pass it through to the modal

### Fix 2: Fix Group Chats Counter

**File:** `src/renderer/components/GroupChatList.tsx`

**Change lines 228 and 236:**
```typescript
// Before:
{groupChats.length > 0 && (
  ...
    {groupChats.length}

// After:
{sortedGroupChats.length > 0 && (
  ...
    {sortedGroupChats.length}
```

### Fix 3: Improve Group Rename/Delete Discoverability

**Option A (Minimal):** Add visible action buttons on group headers (like project folders have)

**Option B (Better):** Add a context menu for groups with:
- Rename
- Change Emoji
- Delete (with confirmation, even for non-empty groups)
- Move to Project Folder (future)

### Fix 4: Consider Always Showing "New Group" Button

The button in "Ungrouped Agents" section could be shown even when there are no ungrouped sessions, to improve discoverability.

---

## Implementation Order

1. **Fix 4 (Counter)** - Simple, isolated change in GroupChatList.tsx
2. **Fix 1 (Project Folder scoping)** - Core functionality fix
3. **Fix 3 (Discoverability)** - UX improvement
4. **Fix 2 (Button visibility)** - May already be resolved, needs user clarification

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/renderer/components/GroupChatList.tsx` | Use `sortedGroupChats.length` for counter |
| `src/renderer/components/CreateGroupModal.tsx` | Add `projectFolderId` prop and set on new group |
| `src/renderer/components/AppModals.tsx` | Pass `projectFolderId` to CreateGroupModal |
| `src/renderer/components/SessionList.tsx` | Track current folder context, pass to modal, add group context menu |

---

## Testing Checklist

After implementation:
- [ ] Create group in Project Folder → group appears ONLY in that folder, not main list
- [ ] Create group in main list → group appears ONLY in main list (unassigned)
- [ ] Group Chats counter shows "0" for new empty Project Folder
- [ ] Group Chats counter shows correct count for folders with group chats
- [ ] Can rename group via context menu (or improved UI)
- [ ] Can delete group via context menu (or improved UI)
- [ ] "New Group" button is visible and accessible
