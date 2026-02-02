# Group Chat Data Loss Investigation

**Date:** 2026-02-01
**Reported by:** User
**Investigators:** @agent-planner, @agent-dev-4
**Status:** Investigation Complete

## Issue Description

The user reported that after updating to commit `30304f58`, their group chat history was destroyed:
- No files were deleted from the Application Support folder
- The chat, its context, and history were gone from the new version of the app
- The user is 100% confident this was not caused by their build process

## Investigation Summary

### Commit 30304f58 Analysis

**Files Changed:** Only `src/renderer/components/SessionList.tsx`
**Lines Added:** 141 lines
**Nature of Changes:**
1. Added `ProjectFolderContextMenu` component (UI only)
2. Added `projectFolderContextMenu` state for tracking menu visibility
3. Modified `handleProjectFolderDrop` to detect session drags and call `addSessionToFolder`
4. Wired up context menu to three dots button on folder headers

**Assessment:** ✅ **No impact on group chat storage**

The changes in commit `30304f58` are purely UI-related and do not touch:
- Group chat storage (`group-chat-storage.ts`)
- Group chat IPC handlers (`groupChat.ts`)
- Session/group chat loading logic in `App.tsx`
- Any data persistence mechanisms

### Group Chat Storage Architecture

Group chats are stored separately from the project folders system:

**Storage Location:** `{userData}/group-chats/{groupChatId}/`
- `metadata.json` - GroupChat metadata
- `chat.log` - Pipe-delimited message log
- `history.jsonl` - History entries (JSONL format)
- `images/` - Image attachments

**Loading Flow (`App.tsx:1261-1268`):**
```typescript
const savedGroupChats = await window.maestro.groupChat.list();
setGroupChats(savedGroupChats || []);
```

**Key Storage Functions:**
- `listGroupChats()` - Reads `{userData}/group-chats/` directory, loads each `metadata.json`
- `loadGroupChat(id)` - Loads specific chat from `metadata.json`
- `getConfigDir()` - Respects custom sync path from `bootstrapStore`

### Project Folders Storage (Separate System)

Project folders use `electron-store` for persistence:
- `projectFoldersStore` - Stores folder definitions
- `sessionsStore` - Sessions with `projectFolderIds` array
- `groupsStore` - Groups with `projectFolderId`

**Key Observation:** Group chats are NOT currently integrated with project folders. They use a completely independent file-based storage system.

## Potential Root Causes (Not Related to Commit 30304f58)

Since commit `30304f58` cannot explain the data loss, here are other possibilities:

### 1. Custom Sync Path Issue
```typescript
// group-chat-storage.ts:107-110
function getConfigDir(): string {
    const customPath = bootstrapStore.get('customSyncPath');
    return customPath || app.getPath('userData');
}
```
If `customSyncPath` changed or became undefined, the app would look for group chats in a different directory.

### 2. App Data Path Change
If the Electron app's `userData` path changed between versions (unlikely but possible with certain packaging changes).

### 3. Previous Code Change
The data loss might have been caused by a commit BEFORE `30304f58`. Worth investigating:
- Commit `e8a4bd3d` - IPC handler registration fix
- Any changes to store initialization order

### 4. Electron Store Reset
If the `electron-store` instances were somehow reset or the schema changed, it could affect the `bootstrapStore` which determines the config directory.

## Recommended Actions

### Immediate Verification
1. Check if group chat files still exist in the filesystem:
   ```bash
   ls -la ~/Library/Application\ Support/Maestro/group-chats/
   ```

2. Verify the `customSyncPath` setting:
   ```bash
   cat ~/Library/Application\ Support/Maestro/maestro-bootstrap.json
   ```

3. Check if metadata.json files are intact but not being loaded

### Code Safety Review
No code changes in commit `30304f58` could have caused this issue. However, to prevent future issues:

1. **Add defensive logging** to `listGroupChats()` to log when no chats are found
2. **Add startup diagnostics** to log the config directory being used
3. **Consider backup mechanism** before major operations

## Conclusion

**Commit `30304f58` is NOT the cause of the group chat data loss.**

The changes in this commit are isolated to:
- UI components for project folder context menus
- Drag-drop handling for sessions into folders
- State management for context menu visibility

None of these changes interact with:
- Group chat storage or loading
- File system operations on group chat data
- The config directory resolution

The root cause is likely elsewhere - possibly in the app's data path resolution, custom sync path handling, or a previous commit. Further investigation should focus on verifying the storage paths and checking for any electron-store schema changes.

---

## Files Reviewed
- `/app/Maestro/src/renderer/components/SessionList.tsx` - Commit changes
- `/app/Maestro/src/main/group-chat/group-chat-storage.ts` - Group chat persistence
- `/app/Maestro/src/main/ipc/handlers/groupChat.ts` - IPC handlers
- `/app/Maestro/src/main/ipc/handlers/projectFolders.ts` - Project folders handlers
- `/app/Maestro/src/main/stores/getters.ts` - Store getters
- `/app/Maestro/src/renderer/App.tsx` - Loading logic
- `/app/Maestro/src/renderer/contexts/GroupChatContext.tsx` - State management
