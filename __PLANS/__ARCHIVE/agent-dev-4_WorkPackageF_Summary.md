# Work Package F: GroupChat Backend - projectFolderId Support

**Agent:** agent-dev-4
**Date:** 2026-02-02
**Commit:** `76215011`

## Summary

Implemented backend support for scoping GroupChats to Project Folders. The GroupChat interface in `shared/group-chat-types.ts` already had the `projectFolderId` field, but the backend storage, IPC handler, and preload API were not passing or saving it during creation.

## Changes Made

### Fix 8: Update preload API to accept projectFolderId parameter

**File:** `src/main/preload/groupChat.ts`

```typescript
// Before:
create: (name: string, moderatorAgentId: string, moderatorConfig?: ModeratorConfig) =>
  ipcRenderer.invoke('groupChat:create', name, moderatorAgentId, moderatorConfig),

// After:
create: (
  name: string,
  moderatorAgentId: string,
  moderatorConfig?: ModeratorConfig,
  projectFolderId?: string
) =>
  ipcRenderer.invoke('groupChat:create', name, moderatorAgentId, moderatorConfig, projectFolderId),
```

### Fix 9: Update IPC handler to pass projectFolderId to storage

**File:** `src/main/ipc/handlers/groupChat.ts`

- Added `projectFolderId?: string` parameter to the handler function
- Added `projectFolderId` to the logging context
- Pass `projectFolderId` to `createGroupChat()` call

### Fix 10: Update storage to save projectFolderId

**File:** `src/main/group-chat/group-chat-storage.ts`

1. Added `projectFolderId?: string` to the `GroupChat` interface
2. Added `projectFolderId?: string` parameter to `createGroupChat()` function
3. Include `projectFolderId` in the GroupChat object saved to metadata.json

## Data Flow (After Fix)

```
Frontend calls window.maestro.groupChat.create(name, agentId, config, projectFolderId)
    ↓
Preload API invokes 'groupChat:create' IPC with all 4 params
    ↓
IPC Handler receives projectFolderId and passes to storage
    ↓
Storage creates GroupChat with projectFolderId in metadata.json
    ↓
GroupChat is scoped to folder and filtered correctly in UI
```

## Verification

- TypeScript compilation: Passes (no new errors)
- Pre-commit hooks: Passed (prettier, eslint)

## Note

This backend work package works in conjunction with Work Package E (Frontend), which handles:
- State tracking for which folder opened the modal
- Updating callback signatures in the frontend
- Passing the projectFolderId when calling the API
