/**
 * Preload API for Prompt Library operations
 *
 * Provides the window.maestro.promptLibrary namespace for:
 * - CRUD operations for saved prompts
 * - Search functionality
 * - Usage tracking
 * - Library statistics
 */

import { ipcRenderer } from 'electron';

/**
 * Prompt Library entry (mirrors main process type)
 */
export interface PromptLibraryEntry {
	id: string;
	title: string;
	prompt: string;
	description?: string;
	projectName: string;
	projectPath: string;
	projectFolderColor?: string;
	agentId: string;
	agentName: string;
	agentSessionId?: string;
	createdAt: number;
	updatedAt: number;
	lastUsedAt?: number;
	useCount: number;
	tags?: string[];
}

/**
 * Type for the prompt library API
 */
export type PromptLibraryApi = ReturnType<typeof createPromptLibraryApi>;

/**
 * Creates the prompt library API object for preload exposure
 */
export function createPromptLibraryApi() {
	return {
		/**
		 * Get all prompts (sorted by most recently used)
		 */
		getAll: (): Promise<PromptLibraryEntry[]> => ipcRenderer.invoke('promptLibrary:getAll'),

		/**
		 * Get a single prompt by ID
		 */
		getById: (id: string): Promise<PromptLibraryEntry | null> =>
			ipcRenderer.invoke('promptLibrary:getById', id),

		/**
		 * Search prompts by query (searches title, content, tags)
		 */
		search: (query: string): Promise<PromptLibraryEntry[]> =>
			ipcRenderer.invoke('promptLibrary:search', query),

		/**
		 * Add a new prompt to the library
		 */
		add: (
			entry: Omit<PromptLibraryEntry, 'id' | 'createdAt' | 'updatedAt' | 'useCount'>
		): Promise<PromptLibraryEntry> => ipcRenderer.invoke('promptLibrary:add', entry),

		/**
		 * Update an existing prompt
		 */
		update: (
			id: string,
			updates: Partial<Omit<PromptLibraryEntry, 'id' | 'createdAt'>>
		): Promise<PromptLibraryEntry | null> =>
			ipcRenderer.invoke('promptLibrary:update', id, updates),

		/**
		 * Delete a prompt
		 */
		delete: (id: string): Promise<boolean> => ipcRenderer.invoke('promptLibrary:delete', id),

		/**
		 * Record usage of a prompt (increments use count, updates lastUsedAt)
		 */
		recordUsage: (id: string): Promise<boolean> =>
			ipcRenderer.invoke('promptLibrary:recordUsage', id),

		/**
		 * Get prompts for a specific project
		 */
		getByProject: (projectPath: string): Promise<PromptLibraryEntry[]> =>
			ipcRenderer.invoke('promptLibrary:getByProject', projectPath),

		/**
		 * Get library statistics
		 */
		getStats: (): Promise<{
			totalPrompts: number;
			uniqueProjects: number;
			mostUsedPrompt: PromptLibraryEntry | null;
		}> => ipcRenderer.invoke('promptLibrary:getStats'),
	};
}
