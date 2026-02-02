# Work Package C: New Group Button Visibility Fixes

**Agent:** agent-dev-4
**Date:** 2026-02-02
**Commit:** `5767191a`

## Summary

Implemented two fixes to ensure users can always create new groups, regardless of whether sessions exist in ungrouped state.

## Changes Made

### Fix 1A: Add "New Group" button to Unassigned section header

**File:** `src/renderer/components/SessionList.tsx`
**Location:** Lines 2993-3019 (Unassigned section in project folders view)

**Before:**
```tsx
<div className="px-3 py-1.5 flex items-center gap-2 ...">
  <Folder className="w-3.5 h-3.5" />
  <span>Unassigned</span>
</div>
```

**After:**
```tsx
<div className="px-3 py-1.5 flex items-center justify-between ...">
  <div className="flex items-center gap-2">
    <Folder className="w-3.5 h-3.5" />
    <span>Unassigned</span>
  </div>
  <button onClick={() => createNewGroup()} ...>
    <Plus /> New Group
  </button>
</div>
```

### Fix 1B: Always show "Ungrouped" header with button in renderFolderSessions

**File:** `src/renderer/components/SessionList.tsx`
**Location:** Lines 2187-2225 (renderFolderSessions function)

**Before:**
```tsx
{folderUngrouped.length > 0 && (
  <div className="mb-1 ml-2">
    {/* Header with New Group button */}
    {/* Session list */}
  </div>
)}
```

**After:**
```tsx
{/* Always show header with New Group button */}
<div className="mb-1 ml-2">
  {/* Header with New Group button - ALWAYS visible */}
  {folderUngrouped.length > 0 && (
    {/* Session list - only when sessions exist */}
  )}
</div>
```

## Expected Behavior After Fix

| Scenario | Before | After |
|----------|--------|-------|
| Unassigned section (project folders exist) | No button | ✅ New Group button visible |
| Project Folder with all sessions grouped | No Ungrouped section visible | ✅ Ungrouped header with New Group button visible |
| Project Folder with ungrouped sessions | Button visible | ✅ Button visible (no change) |

## Verification

- TypeScript compilation: Passes (no new errors)
- Pre-commit hooks: Passed (prettier, eslint)
