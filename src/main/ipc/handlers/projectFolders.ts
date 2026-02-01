/**
 * Project Folders IPC Handlers
 *
 * This module handles IPC calls for:
 * - Project Folders: CRUD operations
 * - Session assignments: adding/removing sessions from folders
 * - Group assignments: assigning groups to folders
 * - GroupChat assignments: assigning group chats to folders
 */

import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger';
import { getProjectFoldersStore, getGroupsStore, getSessionsStore } from '../../stores/getters';
import type { ProjectFolder } from '../../../shared/types';

/**
 * Register all project folder-related IPC handlers.
 */
export function registerProjectFoldersHandlers(): void {
	// ============================================================================
	// Project Folder CRUD Operations
	// ============================================================================

	/**
	 * Get all project folders, sorted by order
	 */
	ipcMain.handle('projectFolders:getAll', async () => {
		const store = getProjectFoldersStore();
		const folders = store.get('folders', []);
		logger.debug(`Retrieved ${folders.length} project folders`, 'ProjectFolders');
		// Return sorted by order
		return [...folders].sort((a, b) => a.order - b.order);
	});

	/**
	 * Save all project folders (bulk update)
	 */
	ipcMain.handle('projectFolders:saveAll', async (_, folders: ProjectFolder[]) => {
		const store = getProjectFoldersStore();
		store.set('folders', folders);
		logger.info(`Saved ${folders.length} project folders`, 'ProjectFolders');
		return true;
	});

	/**
	 * Create a new project folder
	 */
	ipcMain.handle(
		'projectFolders:create',
		async (_, folder: Omit<ProjectFolder, 'id' | 'createdAt' | 'updatedAt'>) => {
			const store = getProjectFoldersStore();
			const folders = store.get('folders', []);

			const now = Date.now();
			const newFolder: ProjectFolder = {
				...folder,
				id: uuidv4(),
				createdAt: now,
				updatedAt: now,
			};

			folders.push(newFolder);
			store.set('folders', folders);

			logger.info(`Created project folder: ${newFolder.name}`, 'ProjectFolders', {
				folderId: newFolder.id,
			});

			return newFolder;
		}
	);

	/**
	 * Update an existing project folder
	 */
	ipcMain.handle(
		'projectFolders:update',
		async (_, id: string, updates: Partial<Omit<ProjectFolder, 'id' | 'createdAt'>>) => {
			const store = getProjectFoldersStore();
			const folders = store.get('folders', []);

			const index = folders.findIndex((f) => f.id === id);
			if (index === -1) {
				logger.warn(`Project folder not found for update: ${id}`, 'ProjectFolders');
				return null;
			}

			folders[index] = {
				...folders[index],
				...updates,
				updatedAt: Date.now(),
			};

			store.set('folders', folders);

			logger.info(`Updated project folder: ${folders[index].name}`, 'ProjectFolders', {
				folderId: id,
			});

			return folders[index];
		}
	);

	/**
	 * Delete a project folder
	 * Also removes projectFolderId from any groups and sessions assigned to it
	 */
	ipcMain.handle('projectFolders:delete', async (_, id: string) => {
		const foldersStore = getProjectFoldersStore();
		const groupsStore = getGroupsStore();
		const sessionsStore = getSessionsStore();

		// Remove the folder
		const folders = foldersStore.get('folders', []);
		const folderToDelete = folders.find((f) => f.id === id);
		if (!folderToDelete) {
			logger.warn(`Project folder not found for deletion: ${id}`, 'ProjectFolders');
			return false;
		}

		const newFolders = folders.filter((f) => f.id !== id);
		foldersStore.set('folders', newFolders);

		// Remove projectFolderId from groups
		const groups = groupsStore.get('groups', []);
		let groupsUpdated = false;
		const updatedGroups = groups.map((g) => {
			if (g.projectFolderId === id) {
				groupsUpdated = true;
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				const { projectFolderId, ...rest } = g;
				return rest;
			}
			return g;
		});
		if (groupsUpdated) {
			groupsStore.set('groups', updatedGroups);
		}

		// Remove projectFolderIds from sessions
		const sessions = sessionsStore.get('sessions', []);
		let sessionsUpdated = false;
		const updatedSessions = sessions.map((s) => {
			if (s.projectFolderIds && s.projectFolderIds.includes(id)) {
				sessionsUpdated = true;
				return {
					...s,
					projectFolderIds: s.projectFolderIds.filter((fId: string) => fId !== id),
				};
			}
			return s;
		});
		if (sessionsUpdated) {
			sessionsStore.set('sessions', updatedSessions);
		}

		logger.info(`Deleted project folder: ${folderToDelete.name}`, 'ProjectFolders', {
			folderId: id,
			groupsUpdated,
			sessionsUpdated,
		});

		return true;
	});

	// ============================================================================
	// Session Assignment Operations
	// ============================================================================

	/**
	 * Add a session to a project folder
	 * Sessions can belong to multiple folders (one-to-many)
	 */
	ipcMain.handle('projectFolders:addSession', async (_, folderId: string, sessionId: string) => {
		const sessionsStore = getSessionsStore();
		const sessions = sessionsStore.get('sessions', []);

		const index = sessions.findIndex((s) => s.id === sessionId);
		if (index === -1) {
			logger.warn(`Session not found for folder assignment: ${sessionId}`, 'ProjectFolders');
			return false;
		}

		const currentFolderIds = sessions[index].projectFolderIds || [];
		if (!currentFolderIds.includes(folderId)) {
			sessions[index].projectFolderIds = [...currentFolderIds, folderId];
			sessionsStore.set('sessions', sessions);

			logger.debug(`Added session ${sessionId} to folder ${folderId}`, 'ProjectFolders');
		}

		return true;
	});

	/**
	 * Remove a session from a project folder
	 */
	ipcMain.handle('projectFolders:removeSession', async (_, folderId: string, sessionId: string) => {
		const sessionsStore = getSessionsStore();
		const sessions = sessionsStore.get('sessions', []);

		const index = sessions.findIndex((s) => s.id === sessionId);
		if (index === -1) {
			logger.warn(`Session not found for folder removal: ${sessionId}`, 'ProjectFolders');
			return false;
		}

		const currentFolderIds = sessions[index].projectFolderIds || [];
		sessions[index].projectFolderIds = currentFolderIds.filter((id: string) => id !== folderId);
		sessionsStore.set('sessions', sessions);

		logger.debug(`Removed session ${sessionId} from folder ${folderId}`, 'ProjectFolders');

		return true;
	});

	// ============================================================================
	// Group Assignment Operations
	// ============================================================================

	/**
	 * Assign a group to a project folder
	 * Groups have a 1:1 relationship with folders
	 */
	ipcMain.handle(
		'projectFolders:assignGroup',
		async (_, folderId: string | null, groupId: string) => {
			const groupsStore = getGroupsStore();
			const groups = groupsStore.get('groups', []);

			const index = groups.findIndex((g) => g.id === groupId);
			if (index === -1) {
				logger.warn(`Group not found for folder assignment: ${groupId}`, 'ProjectFolders');
				return false;
			}

			if (folderId === null) {
				// Remove from folder (unassign)
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				const { projectFolderId, ...rest } = groups[index];
				groups[index] = rest;
			} else {
				groups[index] = { ...groups[index], projectFolderId: folderId };
			}

			groupsStore.set('groups', groups);

			logger.debug(`Assigned group ${groupId} to folder ${folderId ?? 'none'}`, 'ProjectFolders');

			return true;
		}
	);

	// ============================================================================
	// Reorder Operations
	// ============================================================================

	/**
	 * Reorder project folders (after drag-and-drop)
	 * Takes an array of folder IDs in the new order
	 */
	ipcMain.handle('projectFolders:reorder', async (_, orderedIds: string[]) => {
		const store = getProjectFoldersStore();
		const folders = store.get('folders', []);

		// Create a map for quick lookup
		const folderMap = new Map(folders.map((f) => [f.id, f]));

		// Update order based on position in orderedIds
		const now = Date.now();
		const updatedFolders = orderedIds
			.map((id, index) => {
				const folder = folderMap.get(id);
				if (!folder) return null;
				return { ...folder, order: index, updatedAt: now };
			})
			.filter((f): f is ProjectFolder => f !== null);

		// Add any folders that weren't in orderedIds (shouldn't happen, but be safe)
		const orderedIdSet = new Set(orderedIds);
		for (const folder of folders) {
			if (!orderedIdSet.has(folder.id)) {
				updatedFolders.push({ ...folder, order: updatedFolders.length, updatedAt: now });
			}
		}

		store.set('folders', updatedFolders);

		logger.debug(`Reordered ${orderedIds.length} project folders`, 'ProjectFolders');

		return true;
	});
}
