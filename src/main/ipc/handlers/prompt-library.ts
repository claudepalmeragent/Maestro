/**
 * Prompt Library IPC Handlers
 *
 * These handlers provide prompt library persistence operations for storing,
 * searching, and managing saved prompts across projects.
 *
 * Features:
 * - CRUD operations for prompts
 * - Full-text search by title, content, tags
 * - Usage tracking
 * - Project and agent metadata
 */

import { ipcMain } from 'electron';
import { logger } from '../../utils/logger';
import { getPromptLibraryManager, PromptLibraryEntry } from '../../prompt-library-manager';
import { withIpcErrorLogging, CreateHandlerOptions } from '../../utils/ipcHandler';

const LOG_CONTEXT = '[PromptLibrary]';

// Helper to create handler options with consistent context
const handlerOpts = (operation: string): Pick<CreateHandlerOptions, 'context' | 'operation'> => ({
	context: LOG_CONTEXT,
	operation,
});

/**
 * Register all Prompt Library-related IPC handlers.
 *
 * These handlers provide prompt library operations:
 * - Get all prompts
 * - Search prompts
 * - Add new prompt
 * - Update existing prompt
 * - Delete prompt
 * - Record prompt usage
 * - Get library statistics
 */
export function registerPromptLibraryHandlers(): void {
	const promptLibraryManager = getPromptLibraryManager();

	// Initialize the manager
	promptLibraryManager.initialize().catch((error) => {
		logger.error(`Failed to initialize prompt library: ${error}`, LOG_CONTEXT);
	});

	// Get all prompts
	ipcMain.handle(
		'promptLibrary:getAll',
		withIpcErrorLogging(handlerOpts('getAll'), async () => {
			return promptLibraryManager.getAll();
		})
	);

	// Get a single prompt by ID
	ipcMain.handle(
		'promptLibrary:getById',
		withIpcErrorLogging(handlerOpts('getById'), async (id: string) => {
			return promptLibraryManager.getById(id);
		})
	);

	// Search prompts
	ipcMain.handle(
		'promptLibrary:search',
		withIpcErrorLogging(handlerOpts('search'), async (query: string) => {
			return promptLibraryManager.search(query);
		})
	);

	// Add a new prompt
	ipcMain.handle(
		'promptLibrary:add',
		withIpcErrorLogging(
			handlerOpts('add'),
			async (entry: Omit<PromptLibraryEntry, 'id' | 'createdAt' | 'updatedAt' | 'useCount'>) => {
				const newEntry = await promptLibraryManager.add(entry);
				logger.info(`Added prompt: ${newEntry.title}`, LOG_CONTEXT);
				return newEntry;
			}
		)
	);

	// Update an existing prompt
	ipcMain.handle(
		'promptLibrary:update',
		withIpcErrorLogging(
			handlerOpts('update'),
			async (id: string, updates: Partial<Omit<PromptLibraryEntry, 'id' | 'createdAt'>>) => {
				const updated = await promptLibraryManager.update(id, updates);
				if (updated) {
					logger.info(`Updated prompt: ${id}`, LOG_CONTEXT);
				}
				return updated;
			}
		)
	);

	// Delete a prompt
	ipcMain.handle(
		'promptLibrary:delete',
		withIpcErrorLogging(handlerOpts('delete'), async (id: string) => {
			const deleted = await promptLibraryManager.delete(id);
			if (deleted) {
				logger.info(`Deleted prompt: ${id}`, LOG_CONTEXT);
			}
			return deleted;
		})
	);

	// Record usage of a prompt
	ipcMain.handle(
		'promptLibrary:recordUsage',
		withIpcErrorLogging(handlerOpts('recordUsage'), async (id: string) => {
			await promptLibraryManager.recordUsage(id);
			return true;
		})
	);

	// Get prompts for a specific project
	ipcMain.handle(
		'promptLibrary:getByProject',
		withIpcErrorLogging(handlerOpts('getByProject'), async (projectPath: string) => {
			return promptLibraryManager.getByProject(projectPath);
		})
	);

	// Get library statistics
	ipcMain.handle(
		'promptLibrary:getStats',
		withIpcErrorLogging(handlerOpts('getStats'), async () => {
			return promptLibraryManager.getStats();
		})
	);

	logger.info('Prompt library handlers registered', LOG_CONTEXT);
}
