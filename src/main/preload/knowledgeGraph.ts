/**
 * Preload API for Knowledge Graph operations
 *
 * Provides the window.maestro.knowledgeGraph namespace for:
 * - Saving session learnings to markdown files
 * - Listing and reading saved entries
 * - Deleting entries
 */

import { ipcRenderer } from 'electron';
import type { KnowledgeGraphEntry } from '../../renderer/types';

/**
 * Type for the knowledge graph API
 */
export type KnowledgeGraphApi = ReturnType<typeof createKnowledgeGraphApi>;

/**
 * Creates the knowledge graph API object for preload exposure
 */
export function createKnowledgeGraphApi() {
	return {
		/**
		 * Save a knowledge graph entry
		 */
		save: (entry: KnowledgeGraphEntry): Promise<string> =>
			ipcRenderer.invoke('knowledgeGraph:save', entry),

		/**
		 * List all knowledge graph entries
		 */
		list: (): Promise<string[]> => ipcRenderer.invoke('knowledgeGraph:list'),

		/**
		 * Read a knowledge graph entry by filename
		 */
		read: (filename: string): Promise<string> =>
			ipcRenderer.invoke('knowledgeGraph:read', filename),

		/**
		 * Delete a knowledge graph entry by filename
		 */
		delete: (filename: string): Promise<boolean> =>
			ipcRenderer.invoke('knowledgeGraph:delete', filename),
	};
}
