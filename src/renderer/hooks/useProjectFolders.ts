/**
 * useProjectFolders - Convenience hooks for project folder operations
 *
 * These hooks provide easy access to project folder functionality.
 */

import { useCallback, useMemo } from 'react';
import { useProjectFoldersContext } from '../contexts/ProjectFoldersContext';
import type { ProjectFolder } from '../../shared/types';

/**
 * Hook to get all project folders sorted by order
 */
export function useProjectFolders(): ProjectFolder[] {
	const { getSortedFolders } = useProjectFoldersContext();
	return getSortedFolders();
}

/**
 * Hook to get a specific project folder by ID
 */
export function useProjectFolder(folderId: string | undefined): ProjectFolder | undefined {
	const { getFolderById } = useProjectFoldersContext();
	return folderId ? getFolderById(folderId) : undefined;
}

/**
 * Hook to get project folders loading state
 */
export function useProjectFoldersLoaded(): boolean {
	const { projectFoldersLoaded } = useProjectFoldersContext();
	return projectFoldersLoaded;
}

/**
 * Hook for project folder CRUD operations
 */
export function useProjectFolderOperations() {
	const {
		createFolder,
		updateFolder,
		deleteFolder,
		reorderFolders,
		addSessionToFolder,
		removeSessionFromFolder,
		assignGroupToFolder,
	} = useProjectFoldersContext();

	return {
		createFolder,
		updateFolder,
		deleteFolder,
		reorderFolders,
		addSessionToFolder,
		removeSessionFromFolder,
		assignGroupToFolder,
	};
}

/**
 * Hook to get folders that a session belongs to
 */
export function useSessionFolders(sessionProjectFolderIds: string[] | undefined): ProjectFolder[] {
	const { getFolderById } = useProjectFoldersContext();

	return useMemo(() => {
		if (!sessionProjectFolderIds || sessionProjectFolderIds.length === 0) {
			return [];
		}
		return sessionProjectFolderIds
			.map((id) => getFolderById(id))
			.filter((f): f is ProjectFolder => f !== undefined);
	}, [sessionProjectFolderIds, getFolderById]);
}

/**
 * Hook to toggle a session's membership in a folder
 */
export function useToggleSessionFolder() {
	const { addSessionToFolder, removeSessionFromFolder } = useProjectFoldersContext();

	return useCallback(
		async (
			sessionId: string,
			folderId: string,
			currentFolderIds: string[] | undefined
		): Promise<boolean> => {
			const isInFolder = currentFolderIds?.includes(folderId) ?? false;

			if (isInFolder) {
				return removeSessionFromFolder(folderId, sessionId);
			} else {
				return addSessionToFolder(folderId, sessionId);
			}
		},
		[addSessionToFolder, removeSessionFromFolder]
	);
}

/**
 * Hook to get the highlight colors for a session's project folders
 */
export function useSessionFolderColors(sessionProjectFolderIds: string[] | undefined): string[] {
	const { getFolderById } = useProjectFoldersContext();

	return useMemo(() => {
		if (!sessionProjectFolderIds || sessionProjectFolderIds.length === 0) {
			return [];
		}
		return sessionProjectFolderIds
			.map((id) => getFolderById(id)?.highlightColor)
			.filter((color): color is string => !!color);
	}, [sessionProjectFolderIds, getFolderById]);
}
