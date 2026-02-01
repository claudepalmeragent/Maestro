# Project Folders Feature - Implementation Plan v1

**Feature:** Project Folders for Sidebar Organization
**Date:** 2026-02-01
**Author:** agent-planner
**Status:** Ready for Review

---

## 1. Executive Summary

This plan outlines the implementation of **Project Folders** - a new top-level organizational structure in the Maestro left sidebar. Project Folders will allow users to organize their workflow by project, grouping Bookmarks, Agent Groups, Ungrouped Agents, and Group Chats under collapsible, nameable, draggable project containers.

### Key Capabilities
- N number of Project Folders at the highest level of sidebar hierarchy
- Collapsible, nameable, and draggable folders
- Optional highlight color (applies to folder when collapsed, left color bar when expanded)
- Agents can belong to multiple Project Folders (one-to-many)
- Group Chats, Bookmarks state, and Agent Groups are 1:1 with a Project Folder
- Visual indicators (color bars) on Agent blocks showing project membership

---

## 2. Current Architecture Analysis

### 2.1 Technology Stack
- **Framework:** React 18.2.0 with TypeScript 5.3.3
- **Desktop:** Electron
- **Build:** Vite
- **Styling:** TailwindCSS
- **State Management:** React Context API (no Redux/Zustand)
- **Persistence:** electron-store via IPC

### 2.2 Existing Data Models

#### Session (Agent)
```typescript
// /src/renderer/types/index.ts
interface Session {
  id: string;
  groupId?: string;           // Links to Group
  name: string;
  toolType: ToolType;
  bookmarked?: boolean;
  // ... other fields
}
```

#### Group (Agent Group)
```typescript
// /src/shared/types.ts
interface Group {
  id: string;
  name: string;
  emoji: string;
  collapsed: boolean;
}
```

#### GroupChat
```typescript
// /src/shared/group-chat-types.ts
interface GroupChat {
  id: string;
  name: string;
  participants: GroupChatParticipant[];
  // ... other fields
}
```

### 2.3 Current Sidebar Hierarchy
```
Left Sidebar (current):
├── [Bookmarks] (global, collapsible)
│   └── Bookmarked sessions
├── [Group 1] → [Group N] (alphabetical)
│   └── Sessions in group
├── [Ungrouped Agents] (if groups exist)
│   └── Ungrouped sessions
└── [Group Chats] (separate section)
    └── Chat 1, Chat 2, ...
```

### 2.4 Key Files Affected

| File | Purpose | Changes Required |
|------|---------|------------------|
| `/src/shared/types.ts` | Shared type definitions | Add ProjectFolder type |
| `/src/renderer/types/index.ts` | Renderer types | Add Session.projectFolderIds |
| `/src/shared/group-chat-types.ts` | Group chat types | Add GroupChat.projectFolderId |
| `/src/renderer/contexts/SessionContext.tsx` | Session/group state | Add projectFolders state |
| `/src/renderer/contexts/UILayoutContext.tsx` | UI layout state | Add projectFolder collapse state |
| `/src/renderer/components/SessionList.tsx` | Sidebar rendering | Major restructure for project hierarchy |
| `/src/renderer/components/SessionItem.tsx` | Session item display | Add project color bars |
| `/src/renderer/components/GroupChatList.tsx` | Group chat list | Filter by project folder |
| `/src/renderer/hooks/session/useGroupManagement.ts` | Group operations | Extend for project folders |
| `/src/renderer/hooks/session/useSortedSessions.ts` | Sorting logic | Project-aware sorting |
| `/src/main/store/` | Electron persistence | Add projectFolders store |

---

## 3. Data Model Design

### 3.1 New ProjectFolder Type

```typescript
// Add to /src/shared/types.ts

/**
 * Project Folder - Top-level organizational container
 * Contains Agent Groups, Group Chats, and references Bookmarked/Ungrouped agents
 */
export interface ProjectFolder {
  /** Unique identifier */
  id: string;

  /** User-defined name */
  name: string;

  /** Optional emoji prefix */
  emoji?: string;

  /** UI collapsed state */
  collapsed: boolean;

  /** Optional highlight color (hex string, e.g., "#3B82F6") */
  highlightColor?: string;

  /** Order index for drag-and-drop reordering */
  order: number;

  /** Creation timestamp */
  createdAt: number;

  /** Last modified timestamp */
  updatedAt: number;
}
```

### 3.2 Modified Types

#### Session (Agent) - Add projectFolderIds
```typescript
// Modify in /src/renderer/types/index.ts

interface Session {
  // ... existing fields ...

  /**
   * Project Folders this agent belongs to (one-to-many)
   * Empty array or undefined = appears in "Unassigned" area
   */
  projectFolderIds?: string[];
}
```

#### Group (Agent Group) - Add projectFolderId
```typescript
// Modify in /src/shared/types.ts

interface Group {
  // ... existing fields ...

  /**
   * Project Folder this group belongs to (1:1)
   * undefined = appears in "Unassigned" area
   */
  projectFolderId?: string;
}
```

#### GroupChat - Add projectFolderId
```typescript
// Modify in /src/shared/group-chat-types.ts

interface GroupChat {
  // ... existing fields ...

  /**
   * Project Folder this group chat belongs to (1:1)
   * undefined = appears in "Unassigned" area
   */
  projectFolderId?: string;
}
```

### 3.3 Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         ProjectFolder                            │
│  id, name, emoji, collapsed, highlightColor, order              │
└───────────────────────────┬─────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│    Group      │   │   GroupChat   │   │   Session     │
│ (1:1)         │   │ (1:1)         │   │ (many:many)   │
│ projectFolder │   │ projectFolder │   │ projectFolder │
│ Id            │   │ Id            │   │ Ids[]         │
└───────────────┘   └───────────────┘   └───────────────┘
        │                                       │
        │                                       │
        ▼                                       │
┌───────────────┐                               │
│   Sessions    │◄──────────────────────────────┘
│ in Group      │
│ (via groupId) │
└───────────────┘
```

### 3.4 Sidebar Hierarchy (New)

```
Left Sidebar (new structure):
│
├── [Project Folder 1] (colored header when collapsed, left bar when expanded)
│   ├── [Bookmarks] (scoped to this project)
│   │   └── Bookmarked sessions in this project
│   ├── [Group A]
│   │   └── Sessions in Group A
│   ├── [Ungrouped Agents]
│   │   └── Sessions with this projectFolderId but no groupId
│   └── [Group Chats]
│       └── Chats with this projectFolderId
│
├── [Project Folder 2] ...
│
└── [Unassigned] (special section for items without project folder)
    ├── [Bookmarks] (no projectFolderIds)
    ├── [Groups] (no projectFolderId)
    ├── [Ungrouped Agents]
    └── [Group Chats] (no projectFolderId)
```

---

## 4. State Management Design

### 4.1 New ProjectFolderContext

Create `/src/renderer/contexts/ProjectFolderContext.tsx`:

```typescript
export interface ProjectFolderContextValue {
  // Project Folders State
  projectFolders: ProjectFolder[];
  setProjectFolders: React.Dispatch<React.SetStateAction<ProjectFolder[]>>;

  // Refs for callbacks
  projectFoldersRef: React.MutableRefObject<ProjectFolder[]>;

  // Initialization
  projectFoldersLoaded: boolean;
  setProjectFoldersLoaded: React.Dispatch<React.SetStateAction<boolean>>;
}
```

### 4.2 UILayoutContext Extensions

Add to `/src/renderer/contexts/UILayoutContext.tsx`:

```typescript
// Add to UILayoutContextValue interface
{
  // Project folder collapse states (map of folderId -> collapsed)
  // Note: Each ProjectFolder has its own collapsed state in the model,
  // but we track sub-section collapses here
  projectFolderBookmarksCollapsed: Map<string, boolean>;
  setProjectFolderBookmarksCollapsed: React.Dispatch<React.SetStateAction<Map<string, boolean>>>;

  projectFolderGroupChatsCollapsed: Map<string, boolean>;
  setProjectFolderGroupChatsCollapsed: React.Dispatch<React.SetStateAction<Map<string, boolean>>>;

  projectFolderUngroupedCollapsed: Map<string, boolean>;
  setProjectFolderUngroupedCollapsed: React.Dispatch<React.SetStateAction<Map<string, boolean>>>;

  // Editing state for project folders
  editingProjectFolderId: string | null;
  setEditingProjectFolderId: React.Dispatch<React.SetStateAction<string | null>>;

  // Drag state for project folder reordering
  draggingProjectFolderId: string | null;
  setDraggingProjectFolderId: React.Dispatch<React.SetStateAction<string | null>>;
}
```

### 4.3 Persistence (Electron Store)

Add new IPC handlers in `/src/main/`:

```typescript
// In preload/index.ts - add to window.maestro
projectFolders: {
  getAll: () => ipcRenderer.invoke('projectFolders:getAll'),
  saveAll: (folders: ProjectFolder[]) => ipcRenderer.invoke('projectFolders:saveAll', folders),
  create: (folder: Omit<ProjectFolder, 'id'>) => ipcRenderer.invoke('projectFolders:create', folder),
  update: (id: string, updates: Partial<ProjectFolder>) => ipcRenderer.invoke('projectFolders:update', id, updates),
  delete: (id: string) => ipcRenderer.invoke('projectFolders:delete', id),
}
```

---

## 5. Component Changes

### 5.1 SessionList.tsx (Major Restructure)

**Current:** Renders flat hierarchy of Bookmarks → Groups → Ungrouped → Group Chats
**New:** Renders Project Folders containing scoped versions of each section

Key changes:
1. Add outer loop iterating over projectFolders (sorted by order)
2. Filter bookmarks/groups/sessions/groupChats by projectFolderId
3. Render "Unassigned" section for items without projectFolderId
4. Add ProjectFolderHeader component for folder headers
5. Support drag-drop reordering of project folders

### 5.2 SessionItem.tsx (Add Project Color Bars)

Add visual indicators showing which projects an agent belongs to:

```tsx
// Add to SessionItem component
{session.projectFolderIds && session.projectFolderIds.length > 1 && (
  <div className="absolute left-0 top-0 bottom-0 flex flex-col">
    {session.projectFolderIds.map((folderId) => {
      const folder = projectFolders.find(f => f.id === folderId);
      if (!folder?.highlightColor) return null;
      return (
        <div
          key={folderId}
          className="w-0.5 flex-1"
          style={{ backgroundColor: folder.highlightColor }}
          title={folder.name}
        />
      );
    })}
  </div>
)}
```

### 5.3 New Components

#### ProjectFolderHeader.tsx
```tsx
interface ProjectFolderHeaderProps {
  folder: ProjectFolder;
  isCollapsed: boolean;
  isEditing: boolean;
  onToggleCollapse: () => void;
  onStartRename: () => void;
  onFinishRename: (newName: string) => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  onColorChange: (color: string | undefined) => void;
}
```

#### ProjectFolderModal.tsx (Create/Edit)
```tsx
interface ProjectFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (folder: Omit<ProjectFolder, 'id' | 'createdAt' | 'updatedAt'>) => void;
  existingFolder?: ProjectFolder;  // If editing
}
```

#### MoveToProjectMenu.tsx (Context Menu Submenu)
For assigning sessions to project folders:
```tsx
interface MoveToProjectMenuProps {
  sessionId: string;
  currentProjectFolderIds: string[];
  projectFolders: ProjectFolder[];
  onToggleProject: (folderId: string) => void;
}
```

### 5.4 GroupChatList.tsx Changes

Modify to accept `projectFolderId` filter:
```tsx
interface GroupChatListProps {
  // ... existing props
  projectFolderId?: string | null;  // null = unassigned, undefined = show all
}
```

---

## 6. UI/UX Specifications

### 6.1 Project Folder Header (Collapsed)

```
┌────────────────────────────────────────────────────────────┐
│ [▶] 📦 PROJECT ALPHA                              [⋮]     │
│     ███████████████████████████████████████████████████   │  ← Full-width highlight color
└────────────────────────────────────────────────────────────┘
```

### 6.2 Project Folder Header (Expanded)

```
┌────────────────────────────────────────────────────────────┐
│ █ [▼] 📦 PROJECT ALPHA                            [⋮]     │  ← Left color bar
├────────────────────────────────────────────────────────────┤
│ █   [Bookmarks] (2)                                       │
│ █     ├── Agent 1                                         │
│ █     └── Agent 2                                         │
│ █   [🚀 BACKEND TEAM]                                     │
│ █     └── Agent 3                                         │
│ █   [Ungrouped Agents]                                    │
│ █     └── Agent 4                                         │
│ █   [Group Chats]                                         │
│ █     └── Backend Discussion                              │
└────────────────────────────────────────────────────────────┘
```

### 6.3 Agent with Multiple Project Memberships

```
┌────────────────────────────────────────────────────────────┐
│ ██  🤖 shared-agent-dev                           [●]     │
│ ██                                                        │
│ ↑ Two color bars indicating membership in 2 projects      │
└────────────────────────────────────────────────────────────┘
```

### 6.4 Color Picker for Project Folders

Predefined palette (8-10 colors) plus custom hex input:
- Blue (#3B82F6)
- Green (#22C55E)
- Yellow (#EAB308)
- Orange (#F97316)
- Red (#EF4444)
- Purple (#A855F7)
- Pink (#EC4899)
- Teal (#14B8A6)
- None (no highlight)

### 6.5 Drag-and-Drop Interactions

1. **Reorder Project Folders:** Drag folder header to change order
2. **Move Agent to Project:** Drag session to project folder header (adds to project)
3. **Move Group to Project:** Drag group header to project folder
4. **Move Group Chat to Project:** Context menu → "Move to Project..."

### 6.6 Context Menus

#### Project Folder Context Menu
- Rename
- Change Color
- Collapse All Sections
- Expand All Sections
- ---
- Delete (with confirmation if not empty)

#### Session Context Menu (Extended)
- ... existing items ...
- ---
- Add to Project → [submenu with checkboxes for each project]
- Remove from Project → [submenu, only if in multiple projects]

---

## 7. Work Packages for Parallel Implementation

The work has been divided into **3 non-conflicting packages** to enable parallel development.

---

### Work Package 1: Data Layer & Persistence
**Assigned to:** `@agent-planner`

**Scope:** Type definitions, context, IPC handlers, persistence layer

**Files to Create/Modify:**
1. `/src/shared/types.ts` - Add ProjectFolder interface
2. `/src/renderer/types/index.ts` - Add projectFolderIds to Session
3. `/src/shared/group-chat-types.ts` - Add projectFolderId to GroupChat
4. `/src/renderer/contexts/ProjectFolderContext.tsx` - NEW: Context provider
5. `/src/main/ipc/handlers/projectFolders.ts` - NEW: IPC handlers
6. `/src/main/stores/projectFoldersStore.ts` - NEW: Electron store
7. `/src/main/preload/projectFolders.ts` - NEW: Add projectFolders API
8. `/src/renderer/hooks/useProjectFolderManagement.ts` - NEW: CRUD hook

**Deliverables:**
- ProjectFolder type definition
- Modified Session, Group, GroupChat types
- ProjectFolderContext with full CRUD operations
- Persistence via electron-store
- Hook for project folder operations

**No conflicts with:** WP2 (components), WP3 (sidebar restructure)

---

### Work Package 2: UI Components
**Assigned to:** `@agent-dev-4`

**Scope:** New UI components and SessionItem modifications

**Files to Create/Modify:**
1. `/src/renderer/components/ProjectFolderHeader.tsx` - NEW
2. `/src/renderer/components/ProjectFolderModal.tsx` - NEW
3. `/src/renderer/components/MoveToProjectMenu.tsx` - NEW
4. `/src/renderer/components/ColorPicker.tsx` - NEW (reusable)
5. `/src/renderer/components/SessionItem.tsx` - Add project color bars
6. `/src/renderer/components/GroupChatItem.tsx` - Add project indicator (if applicable)

**Deliverables:**
- ProjectFolderHeader with collapse/expand, drag handle, color indicator
- ProjectFolderModal for create/edit with color picker
- MoveToProjectMenu for context menu integration
- ColorPicker component (palette + custom hex)
- SessionItem with multi-project color bars

**No conflicts with:** WP1 (data layer), WP3 (sidebar restructure)

---

### Work Package 3: Sidebar Restructure & Integration
**Assigned to:** `@moderator`

**Scope:** SessionList restructure, GroupChatList filtering, context menu integration

**Files to Create/Modify:**
1. `/src/renderer/components/SessionList.tsx` - Major restructure for project hierarchy
2. `/src/renderer/components/GroupChatList.tsx` - Add projectFolderId filtering
3. `/src/renderer/contexts/UILayoutContext.tsx` - Add project folder UI state
4. `/src/renderer/hooks/session/useSortedSessions.ts` - Project-aware sorting
5. `/src/renderer/App.tsx` - Integrate ProjectFolderContext provider

**Deliverables:**
- SessionList rendering project folders with nested sections
- GroupChatList filtered by project folder
- UILayoutContext with project-specific collapse states
- Sorted sessions respecting project folder structure
- Full integration in App.tsx provider hierarchy

**No conflicts with:** WP1 (data layer), WP2 (components)

---

## 8. Integration Points

### 8.1 Provider Hierarchy (After Implementation)

```tsx
<SessionProvider>
  <ProjectFolderProvider>       {/* NEW */}
    <AutoRunProvider>
      <GroupChatProvider>
        <InputProvider>
          <UILayoutProvider>
            <App />
          </UILayoutProvider>
        </InputProvider>
      </GroupChatProvider>
    </AutoRunProvider>
  </ProjectFolderProvider>
</SessionProvider>
```

### 8.2 Component Import Dependencies

```
WP1 (Data Layer)          WP2 (Components)           WP3 (Sidebar)
────────────────          ────────────────           ─────────────
types.ts         ───────► ProjectFolderHeader ◄───── SessionList
ProjectFolderContext ───► ProjectFolderModal         GroupChatList
useProjectFolder ───────► MoveToProjectMenu          UILayoutContext
                          SessionItem                App.tsx
                          ColorPicker
```

### 8.3 Integration Sequence

1. **WP1 completes first** - Provides types and context for WP2 and WP3
2. **WP2 and WP3 can proceed in parallel** - Use interfaces from WP1
3. **Final integration** - WP3 imports components from WP2, wires everything together

---

## 9. Migration Strategy

### 9.1 Backward Compatibility

- Sessions without `projectFolderIds` appear in "Unassigned" section
- Groups without `projectFolderId` appear in "Unassigned" section
- GroupChats without `projectFolderId` appear in "Unassigned" section
- No data migration required - new fields are optional

### 9.2 Default Behavior

- New installations: Empty project folders, all items in "Unassigned"
- Existing installations: All items in "Unassigned" until user creates project folders

---

## 10. Testing Checklist

### 10.1 Unit Tests
- [ ] ProjectFolder CRUD operations
- [ ] Session projectFolderIds manipulation
- [ ] Group projectFolderId assignment
- [ ] GroupChat projectFolderId assignment
- [ ] Sorting with project folders

### 10.2 Integration Tests
- [ ] Persistence across app restart
- [ ] Drag-and-drop reordering
- [ ] Multi-project agent display
- [ ] Context menu operations

### 10.3 UI/UX Tests
- [ ] Collapse/expand all sections
- [ ] Color picker functionality
- [ ] Inline renaming
- [ ] Keyboard navigation within project folders

---

## 11. Future Enhancements (Out of Scope)

1. **Project folder templates** - Pre-configured folder structures
2. **Project folder sharing** - Export/import project configurations
3. **Project-level settings** - Default working directory per project
4. **Project folder search** - Filter sidebar by project

---

## 12. Appendix: File Path Reference

### New Files
```
/src/shared/types.ts                                 (modify)
/src/renderer/types/index.ts                         (modify)
/src/shared/group-chat-types.ts                      (modify)
/src/renderer/contexts/ProjectFolderContext.tsx      (create)
/src/main/ipc/handlers/projectFolders.ts             (create)
/src/main/stores/projectFoldersStore.ts              (create)
/src/main/preload/projectFolders.ts                  (create)
/src/renderer/hooks/useProjectFolderManagement.ts    (create)
/src/renderer/components/ProjectFolderHeader.tsx     (create)
/src/renderer/components/ProjectFolderModal.tsx      (create)
/src/renderer/components/MoveToProjectMenu.tsx       (create)
/src/renderer/components/ColorPicker.tsx             (create)
```

### Modified Files
```
/src/main/preload/index.ts
/src/renderer/contexts/UILayoutContext.tsx
/src/renderer/components/SessionList.tsx
/src/renderer/components/SessionItem.tsx
/src/renderer/components/GroupChatList.tsx
/src/renderer/hooks/session/useSortedSessions.ts
/src/renderer/App.tsx
```

---

**Plan Status:** COMPLETE - Ready for Review

**Next Steps:**
1. @moderator reviews and approves plan
2. Work packages assigned to respective agents:
   - **WP1 (Data Layer):** @agent-planner
   - **WP2 (UI Components):** @agent-dev-4
   - **WP3 (Sidebar Restructure):** @moderator
3. Parallel implementation begins
4. Integration and testing

---

## 13. Implementation Priority Order

### Phase 1: Foundation (WP1 - agent-planner)
Must complete first as WP2 and WP3 depend on types and context.

1. Add `ProjectFolder` interface to `/src/shared/types.ts`
2. Add `projectFolderIds?: string[]` to Session type in `/src/renderer/types/index.ts`
3. Add `projectFolderId?: string` to Group type in `/src/shared/types.ts`
4. Add `projectFolderId?: string` to GroupChat type in `/src/shared/group-chat-types.ts`
5. Create `/src/main/stores/projectFoldersStore.ts` with electron-store persistence
6. Create IPC handlers in `/src/main/ipc/handlers/projectFolders.ts`
7. Add preload bridge in `/src/main/preload/projectFolders.ts`
8. Create `/src/renderer/contexts/ProjectFolderContext.tsx`
9. Create `/src/renderer/hooks/useProjectFolderManagement.ts`

### Phase 2: Components (WP2 - agent-dev-4) - Can start after Phase 1 types
1. Create `/src/renderer/components/ColorPicker.tsx`
2. Create `/src/renderer/components/ProjectFolderHeader.tsx`
3. Create `/src/renderer/components/ProjectFolderModal.tsx`
4. Create `/src/renderer/components/MoveToProjectMenu.tsx`
5. Modify `/src/renderer/components/SessionItem.tsx` - add project color bars

### Phase 3: Integration (WP3 - moderator) - Can start after Phase 1 types
1. Modify `/src/renderer/contexts/UILayoutContext.tsx` - add project folder UI state
2. Modify `/src/renderer/hooks/session/useSortedSessions.ts` - project-aware sorting
3. Modify `/src/renderer/components/GroupChatList.tsx` - add projectFolderId filtering
4. Modify `/src/renderer/components/SessionList.tsx` - major restructure
5. Modify `/src/renderer/App.tsx` - integrate ProjectFolderContext provider

### Phase 4: Final Integration
1. Wire up all components in SessionList
2. Add context menu integrations
3. Test drag-and-drop across project folders
4. Verify persistence across app restart
