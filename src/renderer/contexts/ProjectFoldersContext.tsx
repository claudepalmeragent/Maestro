/**
 * ProjectFoldersContext - Centralized project folder state management
 *
 * This context manages:
 * - Project folders list and CRUD operations
 * - Loading state for initialization
 * - Refs for accessing current state in callbacks
 */

import React, {
	createContext,
	useContext,
	useState,
	useCallback,
	useRef,
	useEffect,
	ReactNode,
} from 'react';
import type { ProjectFolder } from '../../shared/types';

/**
 * Project folders context value - all folder states and operations
 */
export interface ProjectFoldersContextValue {
	// Core State
	projectFolders: ProjectFolder[];
	setProjectFolders: React.Dispatch<React.SetStateAction<ProjectFolder[]>>;

	// Initialization State
	projectFoldersLoaded: boolean;
	setProjectFoldersLoaded: React.Dispatch<React.SetStateAction<boolean>>;

	// Refs for accessing current state in callbacks (avoids stale closures)
	projectFoldersRef: React.MutableRefObject<ProjectFolder[]>;

	// CRUD Operations
	createFolder: (
		folder: Omit<ProjectFolder, 'id' | 'createdAt' | 'updatedAt'>
	) => Promise<ProjectFolder>;
	updateFolder: (
		id: string,
		updates: Partial<Omit<ProjectFolder, 'id' | 'createdAt'>>
	) => Promise<ProjectFolder | null>;
	deleteFolder: (id: string) => Promise<boolean>;

	// Session Assignment Operations
	addSessionToFolder: (folderId: string, sessionId: string) => Promise<boolean>;
	removeSessionFromFolder: (folderId: string, sessionId: string) => Promise<boolean>;

	// Group Assignment Operations
	assignGroupToFolder: (folderId: string | null, groupId: string) => Promise<boolean>;

	// Reorder Operations
	reorderFolders: (orderedIds: string[]) => Promise<boolean>;

	// Computed Values
	getFolderById: (id: string) => ProjectFolder | undefined;
	getSortedFolders: () => ProjectFolder[];
}

// Create context with null as default (will throw if used outside provider)
const ProjectFoldersContext = createContext<ProjectFoldersContextValue | null>(null);

interface ProjectFoldersProviderProps {
	children: ReactNode;
}

/**
 * ProjectFoldersProvider - Provides centralized project folder state management
 *
 * This provider manages project folders with persistence via IPC.
 * It loads folders on mount and provides CRUD operations.
 *
 * Usage:
 * Wrap App with this provider (after SessionProvider):
 * <SessionProvider>
 *   <ProjectFoldersProvider>
 *     <AutoRunProvider>
 *       ...
 *     </AutoRunProvider>
 *   </ProjectFoldersProvider>
 * </SessionProvider>
 */
export function ProjectFoldersProvider({ children }: ProjectFoldersProviderProps): JSX.Element {
	// Core state
	const [projectFolders, setProjectFolders] = useState<ProjectFolder[]>([]);
	const [projectFoldersLoaded, setProjectFoldersLoaded] = useState(false);

	// Refs for accessing current state in callbacks
	const projectFoldersRef = useRef<ProjectFolder[]>(projectFolders);

	// Keep ref in sync with state
	useEffect(() => {
		projectFoldersRef.current = projectFolders;
	}, [projectFolders]);

	// Load project folders on mount
	useEffect(() => {
		const loadFolders = async () => {
			try {
				const folders = await window.maestro.projectFolders.getAll();
				setProjectFolders(folders);
				setProjectFoldersLoaded(true);
			} catch (error) {
				console.error('Failed to load project folders:', error);
				setProjectFoldersLoaded(true); // Mark as loaded even on error to unblock UI
			}
		};

		loadFolders();
	}, []);

	// Persist folders when they change (after initial load)
	useEffect(() => {
		if (projectFoldersLoaded && projectFolders.length > 0) {
			window.maestro.projectFolders.saveAll(projectFolders).catch((error) => {
				console.error('Failed to save project folders:', error);
			});
		}
	}, [projectFolders, projectFoldersLoaded]);

	// CRUD Operations
	const createFolder = useCallback(
		async (
			folder: Omit<ProjectFolder, 'id' | 'createdAt' | 'updatedAt'>
		): Promise<ProjectFolder> => {
			const newFolder = await window.maestro.projectFolders.create(folder);
			setProjectFolders((prev) => [...prev, newFolder]);
			return newFolder;
		},
		[]
	);

	const updateFolder = useCallback(
		async (
			id: string,
			updates: Partial<Omit<ProjectFolder, 'id' | 'createdAt'>>
		): Promise<ProjectFolder | null> => {
			const updatedFolder = await window.maestro.projectFolders.update(id, updates);
			if (updatedFolder) {
				setProjectFolders((prev) => prev.map((f) => (f.id === id ? updatedFolder : f)));
			}
			return updatedFolder;
		},
		[]
	);

	const deleteFolder = useCallback(async (id: string): Promise<boolean> => {
		const success = await window.maestro.projectFolders.delete(id);
		if (success) {
			setProjectFolders((prev) => prev.filter((f) => f.id !== id));
		}
		return success;
	}, []);

	// Session Assignment Operations
	const addSessionToFolder = useCallback(
		async (folderId: string, sessionId: string): Promise<boolean> => {
			return window.maestro.projectFolders.addSession(folderId, sessionId);
		},
		[]
	);

	const removeSessionFromFolder = useCallback(
		async (folderId: string, sessionId: string): Promise<boolean> => {
			return window.maestro.projectFolders.removeSession(folderId, sessionId);
		},
		[]
	);

	// Group Assignment Operations
	const assignGroupToFolder = useCallback(
		async (folderId: string | null, groupId: string): Promise<boolean> => {
			return window.maestro.projectFolders.assignGroup(folderId, groupId);
		},
		[]
	);

	// Reorder Operations
	const reorderFolders = useCallback(async (orderedIds: string[]): Promise<boolean> => {
		const success = await window.maestro.projectFolders.reorder(orderedIds);
		if (success) {
			// Update local state to reflect new order
			setProjectFolders((prev) => {
				const folderMap = new Map(prev.map((f) => [f.id, f]));
				return orderedIds
					.map((id, index) => {
						const folder = folderMap.get(id);
						return folder ? { ...folder, order: index } : null;
					})
					.filter((f): f is ProjectFolder => f !== null);
			});
		}
		return success;
	}, []);

	// Computed Values
	const getFolderById = useCallback(
		(id: string): ProjectFolder | undefined => {
			return projectFolders.find((f) => f.id === id);
		},
		[projectFolders]
	);

	const getSortedFolders = useCallback((): ProjectFolder[] => {
		return [...projectFolders].sort((a, b) => a.order - b.order);
	}, [projectFolders]);

	// Build context value
	const contextValue: ProjectFoldersContextValue = {
		// Core state
		projectFolders,
		setProjectFolders,
		projectFoldersLoaded,
		setProjectFoldersLoaded,
		projectFoldersRef,
		// CRUD Operations
		createFolder,
		updateFolder,
		deleteFolder,
		// Session Assignment
		addSessionToFolder,
		removeSessionFromFolder,
		// Group Assignment
		assignGroupToFolder,
		// Reorder
		reorderFolders,
		// Computed
		getFolderById,
		getSortedFolders,
	};

	return (
		<ProjectFoldersContext.Provider value={contextValue}>{children}</ProjectFoldersContext.Provider>
	);
}

/**
 * Hook to access project folders context
 * @throws Error if used outside ProjectFoldersProvider
 */
export function useProjectFoldersContext(): ProjectFoldersContextValue {
	const context = useContext(ProjectFoldersContext);
	if (!context) {
		throw new Error('useProjectFoldersContext must be used within ProjectFoldersProvider');
	}
	return context;
}

// Re-export the context for edge cases where direct access is needed
export { ProjectFoldersContext };
