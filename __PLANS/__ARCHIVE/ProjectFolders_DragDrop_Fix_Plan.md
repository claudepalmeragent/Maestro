# Project Folders Drag-Drop Fix Plan

**Date:** 2026-02-01
**Author:** @agent-planner
**Status:** Ready for Implementation

## Problem Statement

Drag-and-drop sessions into project folders does not work. The session is not visually moved into the folder after dropping.

## Root Cause Analysis

**CRITICAL BUG FOUND:** The `addSessionToFolder()` function in `ProjectFoldersContext.tsx` only updates the **backend** (electron-store) but does **NOT update React state**.

### The Bug (lines 157-161):
```typescript
const addSessionToFolder = useCallback(
    async (folderId: string, sessionId: string): Promise<boolean> => {
        return window.maestro.projectFolders.addSession(folderId, sessionId);
        // ❌ BUG: Does NOT update sessions React state!
    },
    []
);
```

### Why the UI Doesn't Update

1. **Backend is updated** - The session's `projectFolderIds` array is updated in `electron-store` via IPC
2. **React state is NOT updated** - The `sessions` state in `SessionContext` is never modified
3. **UI reads from React state** - `SessionList.tsx` filters sessions based on `s.projectFolderIds` from React state
4. **Result** - Session appears to stay in "Unassigned" because React doesn't know about the change

### Relevant Code Flow

```
SessionList.tsx:1888-1891 (handleProjectFolderDrop)
    └── addSessionToFolder(targetFolderId, draggingSessionId)
            └── ProjectFoldersContext.tsx:157-161 (addSessionToFolder)
                    └── window.maestro.projectFolders.addSession() ← IPC to backend
                            └── projectFolders.ts:175-194 (updates sessionsStore)
                                    ❌ No React state update!
```

### Where UI Filters Sessions (lines 1832-1837):
```typescript
// Unassigned sessions (no projectFolderIds or empty array)
return sessions.filter(
    (s) => !s.parentSessionId && (!s.projectFolderIds || s.projectFolderIds.length === 0)
);
// OR
return sessions.filter((s) => !s.parentSessionId && s.projectFolderIds?.includes(folderId));
```

The `sessions` here comes from `SessionContext`, which is never updated when `addSessionToFolder()` is called.

## Solution

Modify `addSessionToFolder()` in `ProjectFoldersContext.tsx` to **also update the React sessions state**.

### Implementation

#### Option A: Update Sessions State in ProjectFoldersContext (Recommended)

Since `ProjectFoldersProvider` is wrapped inside `SessionProvider`, it can access `useSession()` to get `setSessions`.

```typescript
// In ProjectFoldersContext.tsx

import { useSession } from './SessionContext';

export function ProjectFoldersProvider({ children }: ProjectFoldersProviderProps): JSX.Element {
    // Access session context
    const { setSessions } = useSession();

    // ... existing code ...

    const addSessionToFolder = useCallback(
        async (folderId: string, sessionId: string): Promise<boolean> => {
            const success = await window.maestro.projectFolders.addSession(folderId, sessionId);
            if (success) {
                // Update React state to trigger UI re-render
                setSessions((prev) =>
                    prev.map((s) =>
                        s.id === sessionId
                            ? { ...s, projectFolderIds: [...(s.projectFolderIds || []), folderId] }
                            : s
                    )
                );
            }
            return success;
        },
        [setSessions]
    );

    const removeSessionFromFolder = useCallback(
        async (folderId: string, sessionId: string): Promise<boolean> => {
            const success = await window.maestro.projectFolders.removeSession(folderId, sessionId);
            if (success) {
                // Update React state to trigger UI re-render
                setSessions((prev) =>
                    prev.map((s) =>
                        s.id === sessionId
                            ? { ...s, projectFolderIds: (s.projectFolderIds || []).filter(id => id !== folderId) }
                            : s
                    )
                );
            }
            return success;
        },
        [setSessions]
    );

    // ... rest of provider ...
}
```

#### Option B: Alternative - Update at Call Site

If modifying `ProjectFoldersContext` is not preferred, update `SessionList.tsx` directly:

```typescript
// In handleProjectFolderDrop
if (draggingSessionId) {
    const success = await addSessionToFolder(targetFolderId, draggingSessionId);
    if (success) {
        // Directly update sessions state
        setSessions((prev) =>
            prev.map((s) =>
                s.id === draggingSessionId
                    ? { ...s, projectFolderIds: [...(s.projectFolderIds || []), targetFolderId] }
                    : s
            )
        );
    }
    return;
}
```

## Recommendation

**Use Option A** - This ensures all calls to `addSessionToFolder()` and `removeSessionFromFolder()` correctly update React state, not just the drag-drop scenario. It's a more robust fix.

## Files to Modify

| File | Change |
|------|--------|
| `src/renderer/contexts/ProjectFoldersContext.tsx` | Import `useSession`, update `addSessionToFolder` and `removeSessionFromFolder` to also update sessions state |

## Testing Plan

1. **Drag session to folder**
   - Drag a session from "Unassigned" onto a folder header
   - Session should immediately appear inside the folder
   - Session should disappear from "Unassigned"

2. **Persistence check**
   - After dragging, reload the app
   - Session should still be in the folder (backend was already working)

3. **Remove session from folder**
   - Use context menu to remove session from folder
   - Session should return to "Unassigned"

## Assignee

**@agent-dev-4** - Please implement Option A as described above.

## Notes

- The backend persistence (electron-store) is working correctly
- Only the React state synchronization is missing
- This is a classic "backend updated but UI didn't refresh" bug
