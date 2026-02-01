/**
 * Preload API for Project Folders
 *
 * Provides the window.maestro.projectFolders namespace for:
 * - CRUD operations on project folders
 * - Session assignment operations
 * - Group assignment operations
 * - Reordering operations
 */

import { ipcRenderer } from 'electron';
import type { ProjectFolder } from '../../shared/types';

/**
 * Creates the Project Folders API object
 */
export function createProjectFoldersApi() {
	return {
		/**
		 * Get all project folders, sorted by order
		 */
		getAll: (): Promise<ProjectFolder[]> => ipcRenderer.invoke('projectFolders:getAll'),

		/**
		 * Save all project folders (bulk update)
		 */
		saveAll: (folders: ProjectFolder[]): Promise<boolean> =>
			ipcRenderer.invoke('projectFolders:saveAll', folders),

		/**
		 * Create a new project folder
		 */
		create: (
			folder: Omit<ProjectFolder, 'id' | 'createdAt' | 'updatedAt'>
		): Promise<ProjectFolder> => ipcRenderer.invoke('projectFolders:create', folder),

		/**
		 * Update an existing project folder
		 */
		update: (
			id: string,
			updates: Partial<Omit<ProjectFolder, 'id' | 'createdAt'>>
		): Promise<ProjectFolder | null> => ipcRenderer.invoke('projectFolders:update', id, updates),

		/**
		 * Delete a project folder
		 * Also removes projectFolderId from any groups and sessions assigned to it
		 */
		delete: (id: string): Promise<boolean> => ipcRenderer.invoke('projectFolders:delete', id),

		/**
		 * Add a session to a project folder
		 * Sessions can belong to multiple folders (one-to-many)
		 */
		addSession: (folderId: string, sessionId: string): Promise<boolean> =>
			ipcRenderer.invoke('projectFolders:addSession', folderId, sessionId),

		/**
		 * Remove a session from a project folder
		 */
		removeSession: (folderId: string, sessionId: string): Promise<boolean> =>
			ipcRenderer.invoke('projectFolders:removeSession', folderId, sessionId),

		/**
		 * Assign a group to a project folder
		 * Groups have a 1:1 relationship with folders
		 * Pass null to unassign
		 */
		assignGroup: (folderId: string | null, groupId: string): Promise<boolean> =>
			ipcRenderer.invoke('projectFolders:assignGroup', folderId, groupId),

		/**
		 * Reorder project folders (after drag-and-drop)
		 * Takes an array of folder IDs in the new order
		 */
		reorder: (orderedIds: string[]): Promise<boolean> =>
			ipcRenderer.invoke('projectFolders:reorder', orderedIds),
	};
}

export type ProjectFoldersApi = ReturnType<typeof createProjectFoldersApi>;
