# Project Folder Colors Implementation Plan

## Summary

Implement two color-related features:
1. **ColorPicker UI for Project Folders** - Allow users to select a highlight color when creating/editing project folders
2. **Color Bar on SessionItem** - Show a colored vertical bar on sessions indicating which project folder they belong to

## Current State Analysis

### What Already Exists (Infrastructure Ready)
- `highlightColor?: string` field on `ProjectFolder` interface (`src/shared/types.ts:27`)
- `PROJECT_FOLDER_COLORS` palette with 8 predefined colors (`src/shared/types.ts:24-33`)
- `ColorPicker` component (`src/renderer/components/common/ColorPicker.tsx`)
- `ProjectFolderModal` with ColorPicker integrated (`src/renderer/components/modals/ProjectFolderModal.tsx`)
- `ProjectColorBars` component for rendering color indicators (`src/renderer/components/sidebar/ProjectColorBars.tsx`)
- `SessionItem` component accepts `projectFolders` prop and renders `ProjectColorBars` (lines 40, 96, 134)
- `ProjectFolderHeader` already renders color styling (left border when expanded, background tint when collapsed)

### What's Missing (Needs Implementation)

#### Feature 1: ColorPicker UI for Project Folders
The `ProjectFolderModal` exists with ColorPicker but is **NOT USED**. Current project folder creation uses hardcoded defaults:

**Problem Location:** `src/renderer/components/SessionList.tsx:2058-2065`
```typescript
const handleCreateProjectFolder = useCallback(async () => {
    const newFolder = await createFolder({
        name: 'New Project',
        emoji: '📁',
        collapsed: false,
        order: projectFolders.length,
    });
    // ...
}, [createFolder, projectFolders.length, renameProjectFolder]);
```

This bypasses the modal entirely - no opportunity to set color.

#### Feature 2: Color Bar on SessionItem
The `SessionItem` component accepts `projectFolders` prop but it's **NOT BEING PASSED** from `SessionList`.

**Problem:** Need to pass the project folder(s) each session belongs to when rendering `SessionItem`.

---

## Implementation Plan

### Fix 1: Wire Up ProjectFolderModal for Create Flow

**File:** `src/renderer/components/SessionList.tsx`

**Changes:**
1. Add state for modal visibility: `showProjectFolderModal`
2. Add state for editing folder: `editingProjectFolder`
3. Import `ProjectFolderModal`
4. Modify `handleCreateProjectFolder` to open modal instead of creating directly
5. Add handler `handleSaveProjectFolder` that calls `createFolder` or `updateFolder`
6. Render `ProjectFolderModal` conditionally

**Estimated Lines Changed:** ~30

### Fix 2: Wire Up ProjectFolderModal for Edit Flow

**File:** `src/renderer/components/SessionList.tsx`

**Changes:**
1. Add "Edit" option to project folder context menu (or double-click handler)
2. When "Edit" selected, set `editingProjectFolder` and show modal
3. Modal receives existing folder data and shows current color

**Estimated Lines Changed:** ~15

### Fix 3: Pass projectFolders to SessionItem

**File:** `src/renderer/components/SessionList.tsx`

**Changes:**
1. Create helper function to get project folders for a session:
   ```typescript
   const getSessionProjectFolders = (sessionId: string): ProjectFolder[] => {
       return projectFolders.filter(folder =>
           folderSessions[folder.id]?.includes(sessionId)
       );
   };
   ```

2. Pass `projectFolders` prop to all `SessionItem` renders (there are multiple render locations for different variants)

**Render Locations to Update:**
- Bookmark variant sessions
- Group variant sessions
- Flat variant sessions
- Ungrouped variant sessions

**Estimated Lines Changed:** ~20

---

## Detailed Implementation

### Fix 1: Modal State and Import

```typescript
// Add imports
import { ProjectFolderModal } from './modals/ProjectFolderModal';

// Add state (near other modal states ~line 1200)
const [showProjectFolderModal, setShowProjectFolderModal] = useState(false);
const [editingProjectFolder, setEditingProjectFolder] = useState<ProjectFolder | undefined>();
```

### Fix 2: Modify handleCreateProjectFolder

```typescript
// Replace existing implementation
const handleCreateProjectFolder = useCallback(() => {
    setEditingProjectFolder(undefined); // Create mode
    setShowProjectFolderModal(true);
}, []);
```

### Fix 3: Add Save Handler

```typescript
const handleSaveProjectFolder = useCallback(async (
    folderData: Omit<ProjectFolder, 'id' | 'createdAt' | 'updatedAt'>
) => {
    if (editingProjectFolder) {
        // Update existing folder
        await updateFolder(editingProjectFolder.id, folderData);
    } else {
        // Create new folder
        const newFolder = await createFolder({
            ...folderData,
            order: projectFolders.length,
        });
        // Start rename inline after creation
        setRenamingProjectFolderId(newFolder.id);
    }
    setShowProjectFolderModal(false);
    setEditingProjectFolder(undefined);
}, [editingProjectFolder, createFolder, updateFolder, projectFolders.length]);
```

### Fix 4: Add Edit Handler (Context Menu or Double-Click)

```typescript
const handleEditProjectFolder = useCallback((folder: ProjectFolder) => {
    setEditingProjectFolder(folder);
    setShowProjectFolderModal(true);
}, []);
```

### Fix 5: Render Modal

```tsx
{/* Near other modals in render */}
{showProjectFolderModal && (
    <ProjectFolderModal
        theme={theme}
        onClose={() => {
            setShowProjectFolderModal(false);
            setEditingProjectFolder(undefined);
        }}
        onSave={handleSaveProjectFolder}
        existingFolder={editingProjectFolder}
    />
)}
```

### Fix 6: Helper for Session Project Folders

```typescript
// Add helper function
const getSessionProjectFolders = useCallback((sessionId: string): ProjectFolder[] => {
    return projectFolders.filter(folder =>
        folderSessions[folder.id]?.includes(sessionId)
    );
}, [projectFolders, folderSessions]);
```

### Fix 7: Pass to SessionItem Renders

Find all `<SessionItem` renders and add:
```tsx
projectFolders={getSessionProjectFolders(session.id)}
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/renderer/components/SessionList.tsx` | All fixes (state, handlers, modal render, SessionItem props) |

## Dependencies

- `ProjectFolderModal` - Already exists, no changes needed
- `ColorPicker` - Already exists, no changes needed
- `ProjectColorBars` - Already exists, no changes needed
- `SessionItem` - Already accepts `projectFolders` prop, no changes needed

## Testing Checklist

- [ ] Create new project folder - modal opens with ColorPicker
- [ ] Select color in modal - color is saved
- [ ] Folder header shows color (left border expanded, bg tint collapsed)
- [ ] Edit existing folder - modal shows current color
- [ ] Change folder color - update persists
- [ ] Sessions in colored folder show color bar indicator
- [ ] Sessions in multiple folders show multiple color bars
- [ ] Color bar tooltip shows folder name(s)

## Risk Assessment

**Low Risk** - All UI components already exist and work. This is purely wiring them together:
- No new components needed
- No data model changes
- No backend/storage changes
- Color persistence already works via `updateFolder`

---

## Work Package Assignment

**Single Work Package (Frontend Only)**

All changes are in `SessionList.tsx`:
1. Add modal state and imports
2. Modify create/edit handlers
3. Add modal render
4. Pass projectFolders to SessionItem renders

Estimated effort: ~65 lines of code changes
