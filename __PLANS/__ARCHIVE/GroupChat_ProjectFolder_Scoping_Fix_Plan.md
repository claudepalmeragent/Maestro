# Group Chat Project Folder Scoping Fix Plan

## Issue Description
Group Chats created via the "New Chat" button inside a Project Folder are not being scoped to that Project Folder. Instead, they appear in the main group chat list (unassigned).

## Root Cause Analysis

The issue follows the same pattern as the Create Group scoping bug that was fixed previously.

### Current Flow (Broken)
1. User clicks "New Chat" button inside a Project Folder
2. `GroupChatList` calls `onNewGroupChat()` - a simple `() => void` callback
3. `handleNewGroupChat` in App.tsx just does `setShowNewGroupChatModal(true)`
4. `NewGroupChatModal` opens with no knowledge of which folder context it came from
5. On create, `handleCreateGroupChat` calls backend with no `projectFolderId`
6. New group chat is created without `projectFolderId` field set

### Evidence

1. **GroupChatList receives `projectFolderId` for filtering but not for creation:**
   - `src/renderer/components/GroupChatList.tsx:138` - has `projectFolderId?: string | null` prop
   - `src/renderer/components/GroupChatList.tsx:243` - calls `onNewGroupChat()` with no folder ID

2. **NewGroupChatModal has no projectFolderId prop:**
   - `src/renderer/components/NewGroupChatModal.tsx:22-27` - Props don't include `projectFolderId`
   - `onCreate: (name: string, moderatorAgentId: string, moderatorConfig?: ModeratorConfig) => void`

3. **Backend create API doesn't accept projectFolderId:**
   - `src/main/preload/groupChat.ts:71-72` - `create(name, moderatorAgentId, moderatorConfig)`
   - `src/main/group-chat/group-chat-storage.ts:171-175` - `createGroupChat(name, moderatorAgentId, moderatorConfig)`

4. **GroupChat type DOES have the field:**
   - `src/shared/group-chat-types.ts:142` - `projectFolderId?: string;` already exists

## Proposed Fixes

### Fix 1: Add state to track which folder the modal was opened from

**File: `src/renderer/App.tsx`**

Similar to `createGroupForFolderId` for groups, add state for group chats:

```typescript
// Near other group chat state
const [createGroupChatForFolderId, setCreateGroupChatForFolderId] = useState<string | undefined>(undefined);
```

### Fix 2: Update handleNewGroupChat to accept folderId parameter

**File: `src/renderer/App.tsx`**

```typescript
// Change from:
const handleNewGroupChat = useCallback(() => {
    setShowNewGroupChatModal(true);
}, []);

// To:
const handleNewGroupChat = useCallback((folderId?: string) => {
    setCreateGroupChatForFolderId(folderId);
    setShowNewGroupChatModal(true);
}, []);
```

### Fix 3: Update onNewGroupChat prop type throughout the chain

**Files to update:**
- `src/renderer/components/GroupChatList.tsx:116` - Change `onNewGroupChat: () => void` to `onNewGroupChat: (folderId?: string) => void`
- `src/renderer/components/SessionList.tsx:1118` - Update prop type
- `src/renderer/hooks/props/useSessionListProps.ts:131` - Update type

### Fix 4: Pass folderId when calling onNewGroupChat from inside Project Folder

**File: `src/renderer/components/GroupChatList.tsx`**

```typescript
// Around line 243, change:
onNewGroupChat();

// To:
onNewGroupChat(projectFolderId ?? undefined);
```

### Fix 5: Update NewGroupChatModal to accept projectFolderId

**File: `src/renderer/components/NewGroupChatModal.tsx`**

```typescript
interface NewGroupChatModalProps {
    theme: Theme;
    isOpen: boolean;
    onClose: () => void;
    onCreate: (name: string, moderatorAgentId: string, moderatorConfig?: ModeratorConfig, projectFolderId?: string) => void;
    projectFolderId?: string;  // ADD THIS
}
```

Pass `projectFolderId` in the `handleCreate` function call.

### Fix 6: Pass projectFolderId to NewGroupChatModal from AppModals

**File: `src/renderer/components/AppModals.tsx`**

Add `createGroupChatForFolderId` prop and pass to `NewGroupChatModal`:

```typescript
<NewGroupChatModal
    theme={theme}
    isOpen={showNewGroupChatModal}
    onClose={onCloseNewGroupChatModal}
    onCreate={onCreateGroupChat}
    projectFolderId={createGroupChatForFolderId}  // ADD THIS
/>
```

### Fix 7: Update handleCreateGroupChat to accept and pass projectFolderId

**File: `src/renderer/App.tsx`**

```typescript
const handleCreateGroupChat = useCallback(
    async (
        name: string,
        moderatorAgentId: string,
        moderatorConfig?: ModeratorConfig,
        projectFolderId?: string  // ADD THIS
    ) => {
        const chat = await window.maestro.groupChat.create(name, moderatorAgentId, moderatorConfig, projectFolderId);
        setGroupChats((prev) => [chat, ...prev]);
        setShowNewGroupChatModal(false);
        setCreateGroupChatForFolderId(undefined);  // Reset
        handleOpenGroupChat(chat.id);
    },
    [handleOpenGroupChat]
);
```

### Fix 8: Update preload API to accept projectFolderId

**File: `src/main/preload/groupChat.ts`**

```typescript
create: (name: string, moderatorAgentId: string, moderatorConfig?: ModeratorConfig, projectFolderId?: string) =>
    ipcRenderer.invoke('groupChat:create', name, moderatorAgentId, moderatorConfig, projectFolderId),
```

### Fix 9: Update IPC handler to accept and pass projectFolderId

**File: `src/main/ipc/handlers/groupChat.ts`**

Update the `groupChat:create` handler to accept the 4th parameter and pass it to storage.

### Fix 10: Update createGroupChat storage function

**File: `src/main/group-chat/group-chat-storage.ts`**

```typescript
export async function createGroupChat(
    name: string,
    moderatorAgentId: string,
    moderatorConfig?: ModeratorConfig,
    projectFolderId?: string  // ADD THIS
): Promise<GroupChat> {
    // ... existing code ...

    const groupChat: GroupChat = {
        id,
        name: sanitizedName,
        createdAt: now,
        updatedAt: now,
        moderatorAgentId,
        moderatorSessionId: `group-chat-${id}-moderator`,
        moderatorConfig,
        participants: [],
        logPath,
        imagesDir,
        projectFolderId,  // ADD THIS
    };
    // ...
}
```

## Work Package Summary

| Fix | Description | File(s) |
|-----|-------------|---------|
| 1 | Add `createGroupChatForFolderId` state | App.tsx |
| 2 | Update `handleNewGroupChat` to accept folderId | App.tsx |
| 3 | Update `onNewGroupChat` prop type | GroupChatList.tsx, SessionList.tsx, useSessionListProps.ts |
| 4 | Pass folderId when calling from Project Folder | GroupChatList.tsx |
| 5 | Add `projectFolderId` prop to NewGroupChatModal | NewGroupChatModal.tsx |
| 6 | Pass prop through AppModals | AppModals.tsx, App.tsx |
| 7 | Update handleCreateGroupChat | App.tsx |
| 8-10 | Backend: preload, IPC handler, storage | preload/groupChat.ts, handlers/groupChat.ts, group-chat-storage.ts |

## Suggested Work Package Division

**Work Package E (Frontend):**
- Fixes 1-7: State management and prop threading on frontend

**Work Package F (Backend):**
- Fixes 8-10: Preload API, IPC handler, and storage function updates

## Testing Plan

1. Create a new Project Folder
2. Click "New Chat" button inside the Project Folder
3. Create a new Group Chat
4. Verify the Group Chat appears ONLY inside that Project Folder
5. Verify the Group Chat does NOT appear in the main (unassigned) list
6. Create a Group Chat from outside any Project Folder (main list)
7. Verify it appears in the main (unassigned) section
