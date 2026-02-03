# Feature Request: Prompt Library for Prompt Composer

## Overview

This document outlines the comprehensive implementation plan for adding a **Prompt Library** feature to Maestro's Prompt Composer. The Prompt Library allows users to save, search, edit, and reuse prompts across projects with full AI variable support (similar to AI Commands functionality).

## Feature Requirements Summary

1. **Prompt Library Button** - Add to all Input Areas and Prompt Composer
2. **Search Bar** - Auto-complete searchable dropdown below Prompt Composer title bar
3. **Persistent Storage** - Store prompts in local filesystem with project/agent metadata
4. **Cross-Project Access** - Prompts available across all projects
5. **Metadata Pills** - Show Project origin and Agent name (with hover info)
6. **Auto-Save** - Automatically store prompts entered in Prompt Composer on submission
7. **CRUD Operations** - Delete/Edit/Save prompts from the library interface
8. **AI Variables Support** - Full template variable support like AI Commands

---

## Architecture Design

### Data Model

#### PromptLibraryEntry Interface

```typescript
// Location: src/renderer/types/index.ts

export interface PromptLibraryEntry {
  id: string;                    // Unique ID: `prompt-{timestamp}-{random}`
  title: string;                 // User-defined or auto-generated from first line
  prompt: string;                // The full prompt text
  description?: string;          // Optional short description

  // Origin metadata
  projectName: string;           // Project name where prompt was first created
  projectPath: string;           // Full path to project
  agentId: string;               // Agent ID (e.g., 'claude-code')
  agentName: string;             // Agent display name
  agentSessionId?: string;       // Original session ID (for pill hover)

  // Timestamps
  createdAt: number;             // Unix timestamp of creation
  updatedAt: number;             // Unix timestamp of last modification
  lastUsedAt?: number;           // Unix timestamp of last use

  // Usage tracking
  useCount: number;              // Number of times used

  // Tags for future categorization
  tags?: string[];
}

export interface PromptLibraryMetadata {
  version: number;               // Schema version for migrations
  lastModified: number;          // File last modified timestamp
  totalPrompts: number;          // Quick count without loading all
}
```

### Storage Strategy

**Location:** `~/.maestro/prompt-library/`

```
~/.maestro/prompt-library/
├── metadata.json          # PromptLibraryMetadata
├── prompts.json           # PromptLibraryEntry[]
└── backups/               # Auto-backup on schema changes
    └── prompts-{timestamp}.json
```

**Rationale:**
- Separate from settings store for cleaner organization
- Cross-project by default (not tied to any workspace)
- Easy backup/restore capability
- JSON format for human readability and debugging

---

## Component Architecture

### 1. Main Process Components

#### PromptLibraryManager (`src/main/prompt-library-manager.ts`)

Core manager class for file-based prompt storage:

```typescript
class PromptLibraryManager {
  private prompts: PromptLibraryEntry[] = [];
  private metadata: PromptLibraryMetadata;
  private libraryPath: string;

  // CRUD operations
  async getAll(): Promise<PromptLibraryEntry[]>
  async getById(id: string): Promise<PromptLibraryEntry | null>
  async add(entry: Omit<PromptLibraryEntry, 'id' | 'createdAt' | 'updatedAt' | 'useCount'>): Promise<PromptLibraryEntry>
  async update(id: string, updates: Partial<PromptLibraryEntry>): Promise<PromptLibraryEntry | null>
  async delete(id: string): Promise<boolean>

  // Search
  async search(query: string): Promise<PromptLibraryEntry[]>

  // Usage tracking
  async recordUsage(id: string): Promise<void>

  // Initialization
  async initialize(): Promise<void>
  private async loadFromDisk(): Promise<void>
  private async saveToDisk(): Promise<void>
  private async migrateIfNeeded(): Promise<void>
}
```

#### IPC Handlers (`src/main/ipc/handlers/prompt-library.ts`)

```typescript
// Handler registrations
ipcMain.handle('promptLibrary:getAll', async () => {...})
ipcMain.handle('promptLibrary:search', async (_, query: string) => {...})
ipcMain.handle('promptLibrary:add', async (_, entry: Partial<PromptLibraryEntry>) => {...})
ipcMain.handle('promptLibrary:update', async (_, id: string, updates: Partial<PromptLibraryEntry>) => {...})
ipcMain.handle('promptLibrary:delete', async (_, id: string) => {...})
ipcMain.handle('promptLibrary:recordUsage', async (_, id: string) => {...})
```

#### Preload Bridge (`src/main/preload/prompt-library.ts`)

```typescript
export const promptLibraryAPI = {
  getAll: () => ipcRenderer.invoke('promptLibrary:getAll'),
  search: (query: string) => ipcRenderer.invoke('promptLibrary:search', query),
  add: (entry: Partial<PromptLibraryEntry>) => ipcRenderer.invoke('promptLibrary:add', entry),
  update: (id: string, updates: Partial<PromptLibraryEntry>) => ipcRenderer.invoke('promptLibrary:update', id, updates),
  delete: (id: string) => ipcRenderer.invoke('promptLibrary:delete', id),
  recordUsage: (id: string) => ipcRenderer.invoke('promptLibrary:recordUsage', id),
};
```

### 2. Renderer Components

#### PromptLibrarySearchBar (`src/renderer/components/PromptLibrarySearchBar.tsx`)

A searchable dropdown component that appears below the Prompt Composer title bar:

**Props:**
```typescript
interface PromptLibrarySearchBarProps {
  theme: Theme;
  isOpen: boolean;
  onClose: () => void;
  onSelectPrompt: (prompt: PromptLibraryEntry) => void;
  onDeletePrompt: (id: string) => void;
  onEditPrompt: (prompt: PromptLibraryEntry) => void;
  currentProjectName?: string;
  currentAgentName?: string;
}
```

**Features:**
- Text input with live filtering
- Debounced search (150ms)
- Keyboard navigation (Arrow Up/Down, Enter, Escape)
- Row hover shows delete/edit icons
- Project and Agent pills on right side of each row
- Pill hover shows full details
- Click row to select and populate Prompt Composer

**Visual Layout:**
```
┌─────────────────────────────────────────────────────────────────┐
│ [Search icon] Search prompts...                              [X]│
├─────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Fix TypeScript errors                 [Project A] [Claude] │ │
│ │ Review PR and provide feedback        [Project B] [Claude] │ │
│ │ Write unit tests for component        [Project A] [Codex]  │ │
│ │ Refactor to use hooks                 [Project C] [Claude] │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

#### Updated PromptComposerModal (`src/renderer/components/PromptComposerModal.tsx`)

Add search bar integration:

**New Props:**
```typescript
// Add to PromptComposerModalProps
promptLibraryOpen?: boolean;
onTogglePromptLibrary?: () => void;
onSaveToLibrary?: (title: string, prompt: string) => void;
currentProjectName?: string;
currentAgentId?: string;
currentAgentName?: string;
currentAgentSessionId?: string;
```

**Changes:**
1. Add "Library" button in header (BookOpen icon)
2. When Library open, show PromptLibrarySearchBar below header
3. Add "Save to Library" button in footer
4. Auto-save toggle option

#### Updated InputArea (`src/renderer/components/InputArea.tsx`)

Add Prompt Library button alongside Prompt Composer button:

**New Props:**
```typescript
// Add to InputAreaProps
onOpenPromptLibrary?: () => void;
```

**Changes:**
1. Add Library icon button (BookOpen) next to PenLine button
2. Button opens Prompt Composer with Library search active

### 3. Hook Integration

#### usePromptLibrary (`src/renderer/hooks/prompt-library/usePromptLibrary.ts`)

```typescript
export function usePromptLibrary() {
  const [prompts, setPrompts] = useState<PromptLibraryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchResults, setSearchResults] = useState<PromptLibraryEntry[]>([]);

  const loadPrompts = useCallback(async () => {...}, []);
  const searchPrompts = useCallback(async (query: string) => {...}, []);
  const addPrompt = useCallback(async (entry: Partial<PromptLibraryEntry>) => {...}, []);
  const updatePrompt = useCallback(async (id: string, updates: Partial<PromptLibraryEntry>) => {...}, []);
  const deletePrompt = useCallback(async (id: string) => {...}, []);
  const usePrompt = useCallback(async (id: string) => {...}, []);

  return {
    prompts,
    isLoading,
    searchResults,
    loadPrompts,
    searchPrompts,
    addPrompt,
    updatePrompt,
    deletePrompt,
    usePrompt,
  };
}
```

---

## Implementation Phases

### Phase 1: Data Layer (Main Process)

**Files to create:**
- `src/main/prompt-library-manager.ts`
- `src/main/ipc/handlers/prompt-library.ts`
- `src/main/preload/prompt-library.ts`

**Files to modify:**
- `src/main/index.ts` - Register handlers
- `src/main/preload/index.ts` - Export API
- `src/renderer/types/index.ts` - Add interfaces

### Phase 2: Search Bar Component

**Files to create:**
- `src/renderer/components/PromptLibrarySearchBar.tsx`
- `src/renderer/hooks/prompt-library/usePromptLibrary.ts`
- `src/renderer/hooks/prompt-library/index.ts`

### Phase 3: Prompt Composer Integration

**Files to modify:**
- `src/renderer/components/PromptComposerModal.tsx` - Add search bar, save button
- `src/renderer/App.tsx` - Add state management for prompt library

### Phase 4: InputArea Integration

**Files to modify:**
- `src/renderer/components/InputArea.tsx` - Add Library button

### Phase 5: Auto-Save Implementation

**Files to modify:**
- `src/renderer/App.tsx` - Hook into prompt submission flow

---

## Detailed Implementation Steps

### Step 1: Define Types (`src/renderer/types/index.ts`)

Add after `CustomAICommand` interface (~line 730):

```typescript
// Prompt Library entry for saved prompts
export interface PromptLibraryEntry {
  id: string;
  title: string;
  prompt: string;
  description?: string;
  projectName: string;
  projectPath: string;
  agentId: string;
  agentName: string;
  agentSessionId?: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
  useCount: number;
  tags?: string[];
}

export interface PromptLibraryMetadata {
  version: number;
  lastModified: number;
  totalPrompts: number;
}
```

### Step 2: Create PromptLibraryManager

Create `src/main/prompt-library-manager.ts`:

- Initialize library directory in `~/.maestro/prompt-library/`
- Load/save prompts.json with metadata
- Implement CRUD operations with file persistence
- Add fuzzy search using simple includes() for title/prompt/tags
- Handle schema migrations for future versions

### Step 3: Create IPC Handlers

Create `src/main/ipc/handlers/prompt-library.ts`:

- Wrap PromptLibraryManager methods
- Handle errors gracefully
- Broadcast changes to web clients (if web server running)

### Step 4: Update Preload

Modify `src/main/preload/index.ts`:

- Add promptLibrary namespace to window.maestro
- Expose all IPC methods

### Step 5: Create usePromptLibrary Hook

Create `src/renderer/hooks/prompt-library/usePromptLibrary.ts`:

- Cache loaded prompts in state
- Debounce search queries
- Optimistic updates for better UX
- Error handling with toast notifications

### Step 6: Create PromptLibrarySearchBar Component

Create `src/renderer/components/PromptLibrarySearchBar.tsx`:

- Search input with magnifying glass icon
- Scrollable results list with fixed height
- Keyboard navigation (similar to QuickActionsModal)
- Row structure: Title | Project Pill | Agent Pill | Actions (hover)
- Pills show full info on hover via title attribute
- Delete confirmation before removing

### Step 7: Update PromptComposerModal

Modify `src/renderer/components/PromptComposerModal.tsx`:

- Add Library button in header (between title and close button)
- Conditionally render PromptLibrarySearchBar below header when open
- Add Save to Library option in footer
- Handle prompt selection from library
- Wire up auto-save on submission if enabled

### Step 8: Update InputArea

Modify `src/renderer/components/InputArea.tsx`:

- Add BookOpen button next to PenLine button (~line 950-958)
- Pass callback to open Prompt Composer with library mode

### Step 9: Update App.tsx

Modify `src/renderer/App.tsx`:

- Add promptLibraryOpen state
- Add handleSaveToPromptLibrary function
- Connect to submission flow for auto-save
- Pass necessary props to PromptComposerModal

---

## UI/UX Specifications

### Search Bar Behavior

1. **Opening:**
   - Click Library button in Prompt Composer header
   - Click Library button in InputArea (opens Composer with Library active)

2. **Searching:**
   - Type to filter prompts by title, content, tags
   - Results update with 150ms debounce
   - Empty state: "No prompts found" or "Start typing to search..."

3. **Selection:**
   - Click row or press Enter on highlighted row
   - Prompt text replaces Composer content
   - Search bar closes
   - Focus returns to textarea

4. **Keyboard Navigation:**
   - Arrow Up/Down: Navigate results
   - Enter: Select highlighted prompt
   - Escape: Close search bar
   - Tab: Cycle through interactive elements

### Pills Design

**Project Pill:**
- Background: `theme.colors.bgSidebar`
- Text: `theme.colors.textDim`
- Border: `theme.colors.border`
- Hover title: Full project path

**Agent Pill:**
- Background: `theme.colors.accent + '20'`
- Text: `theme.colors.accent`
- Hover title: `Agent ID: {agentId}\nSession: {agentSessionId}` (session only if available)

### Row Interaction

1. **Hover:** Show delete (Trash2) and edit (Edit2) icons on far right
2. **Click row:** Select prompt
3. **Click delete:** Show confirmation, then remove
4. **Click edit:** Open inline edit mode or populate form

---

## Error Handling

1. **Storage Errors:**
   - Create directory if missing
   - Show toast on write failures
   - Fall back to empty state on read failures

2. **Search Errors:**
   - Gracefully degrade to empty results
   - Log errors for debugging

3. **Concurrent Access:**
   - Use file locking or atomic writes
   - Handle conflicts by last-write-wins

---

## Testing Strategy

### Unit Tests

- PromptLibraryManager CRUD operations
- Search algorithm accuracy
- Type validation

### Integration Tests

- IPC handler round-trips
- Component state management
- Keyboard navigation

### E2E Tests

- Full flow: Add prompt → Search → Select → Submit
- Edit and delete operations
- Cross-project prompt access

---

## Migration Considerations

- Version 1 schema as defined above
- Future migrations handled by version check in metadata
- Backup created before any schema changes

---

## Dependencies

No new npm dependencies required. Uses existing:
- Lucide icons (BookOpen, Library icons)
- React hooks patterns
- IPC bridge patterns
- Theme system

---

## Estimated Files Changed

**New Files (6):**
1. `src/main/prompt-library-manager.ts`
2. `src/main/ipc/handlers/prompt-library.ts`
3. `src/main/preload/prompt-library.ts`
4. `src/renderer/components/PromptLibrarySearchBar.tsx`
5. `src/renderer/hooks/prompt-library/usePromptLibrary.ts`
6. `src/renderer/hooks/prompt-library/index.ts`

**Modified Files (5):**
1. `src/renderer/types/index.ts` - Add interfaces
2. `src/main/index.ts` - Register handlers
3. `src/main/preload/index.ts` - Export API
4. `src/renderer/components/PromptComposerModal.tsx` - Add search integration
5. `src/renderer/components/InputArea.tsx` - Add Library button
6. `src/renderer/App.tsx` - State management

---

## Summary

This implementation adds a full-featured Prompt Library to Maestro that:
- Stores prompts persistently across sessions and projects
- Provides fast, keyboard-friendly search
- Shows useful metadata (project origin, agent used)
- Integrates seamlessly with existing Prompt Composer workflow
- Follows existing codebase patterns for consistency
