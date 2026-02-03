/**
 * Prompt Library Manager for persistent prompt storage
 *
 * Stores saved prompts in a dedicated `prompt-library/` directory for
 * cross-project access with full metadata tracking.
 *
 * Features:
 * - Cross-project prompt storage
 * - Full-text search by title, content, tags
 * - Usage tracking and timestamps
 * - AI variable support ({{variables}})
 * - Project and agent origin metadata
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { logger } from './utils/logger';

const LOG_CONTEXT = '[PromptLibraryManager]';

// Schema version for migrations
const PROMPT_LIBRARY_VERSION = 1;

// Maximum prompts to store
const MAX_PROMPTS = 1000;

// Types (mirrored from renderer/types for main process use)
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

interface PromptLibraryFileData {
	metadata: PromptLibraryMetadata;
	prompts: PromptLibraryEntry[];
}

/**
 * Generate a unique ID for a new prompt entry
 */
function generatePromptId(): string {
	const timestamp = Date.now();
	const random = Math.random().toString(36).substring(2, 8);
	return `prompt-${timestamp}-${random}`;
}

/**
 * Generate a title from prompt content if not provided
 */
function generateTitleFromPrompt(prompt: string): string {
	// Take first line, trim, and truncate to 50 chars
	const firstLine = prompt.split('\n')[0].trim();
	if (firstLine.length <= 50) {
		return firstLine;
	}
	return firstLine.substring(0, 47) + '...';
}

/**
 * PromptLibraryManager handles persistent prompt storage with search capabilities
 */
export class PromptLibraryManager {
	private libraryDir: string;
	private promptsFilePath: string;
	private configDir: string;
	private prompts: PromptLibraryEntry[] = [];
	private metadata: PromptLibraryMetadata = {
		version: PROMPT_LIBRARY_VERSION,
		lastModified: Date.now(),
		totalPrompts: 0,
	};
	private initialized = false;

	constructor() {
		this.configDir = app.getPath('userData');
		this.libraryDir = path.join(this.configDir, 'prompt-library');
		this.promptsFilePath = path.join(this.libraryDir, 'prompts.json');
	}

	/**
	 * Initialize prompt library - create directory and load existing prompts
	 */
	async initialize(): Promise<void> {
		if (this.initialized) {
			return;
		}

		// Ensure prompt library directory exists
		if (!fs.existsSync(this.libraryDir)) {
			fs.mkdirSync(this.libraryDir, { recursive: true });
			logger.debug('Created prompt library directory', LOG_CONTEXT);
		}

		// Load existing prompts
		await this.loadFromDisk();
		this.initialized = true;
		logger.info(`Prompt library initialized with ${this.prompts.length} prompts`, LOG_CONTEXT);
	}

	/**
	 * Load prompts from disk
	 */
	private async loadFromDisk(): Promise<void> {
		if (!fs.existsSync(this.promptsFilePath)) {
			// Initialize with empty data
			this.prompts = [];
			this.metadata = {
				version: PROMPT_LIBRARY_VERSION,
				lastModified: Date.now(),
				totalPrompts: 0,
			};
			await this.saveToDisk();
			return;
		}

		try {
			const data = fs.readFileSync(this.promptsFilePath, 'utf-8');
			const fileData: PromptLibraryFileData = JSON.parse(data);

			// Handle version migrations if needed
			if (fileData.metadata.version < PROMPT_LIBRARY_VERSION) {
				await this.migrateIfNeeded(fileData);
			}

			this.metadata = fileData.metadata;
			this.prompts = fileData.prompts || [];
		} catch (error) {
			logger.error(`Failed to load prompt library: ${error}`, LOG_CONTEXT);
			// Initialize with empty data on error
			this.prompts = [];
			this.metadata = {
				version: PROMPT_LIBRARY_VERSION,
				lastModified: Date.now(),
				totalPrompts: 0,
			};
		}
	}

	/**
	 * Save prompts to disk
	 */
	private async saveToDisk(): Promise<void> {
		const fileData: PromptLibraryFileData = {
			metadata: {
				...this.metadata,
				lastModified: Date.now(),
				totalPrompts: this.prompts.length,
			},
			prompts: this.prompts,
		};

		try {
			fs.writeFileSync(this.promptsFilePath, JSON.stringify(fileData, null, 2), 'utf-8');
			this.metadata = fileData.metadata;
		} catch (error) {
			logger.error(`Failed to save prompt library: ${error}`, LOG_CONTEXT);
			throw error;
		}
	}

	/**
	 * Handle schema migrations
	 */
	private async migrateIfNeeded(fileData: PromptLibraryFileData): Promise<void> {
		const currentVersion = fileData.metadata.version;
		logger.info(
			`Migrating prompt library from version ${currentVersion} to ${PROMPT_LIBRARY_VERSION}`,
			LOG_CONTEXT
		);

		// Create backup before migration
		const backupDir = path.join(this.libraryDir, 'backups');
		if (!fs.existsSync(backupDir)) {
			fs.mkdirSync(backupDir, { recursive: true });
		}
		const backupPath = path.join(backupDir, `prompts-v${currentVersion}-${Date.now()}.json`);
		fs.writeFileSync(backupPath, JSON.stringify(fileData, null, 2), 'utf-8');
		logger.info(`Created backup at ${backupPath}`, LOG_CONTEXT);

		// Add migration logic here for future versions
		// Example:
		// if (currentVersion < 2) {
		//   fileData.prompts = fileData.prompts.map(p => ({ ...p, newField: 'default' }));
		// }

		fileData.metadata.version = PROMPT_LIBRARY_VERSION;
	}

	/**
	 * Get all prompts
	 */
	async getAll(): Promise<PromptLibraryEntry[]> {
		await this.initialize();
		// Return sorted by most recently used, then by creation date
		return [...this.prompts].sort((a, b) => {
			const aTime = a.lastUsedAt || a.createdAt;
			const bTime = b.lastUsedAt || b.createdAt;
			return bTime - aTime;
		});
	}

	/**
	 * Get a prompt by ID
	 */
	async getById(id: string): Promise<PromptLibraryEntry | null> {
		await this.initialize();
		return this.prompts.find((p) => p.id === id) || null;
	}

	/**
	 * Add a new prompt to the library
	 */
	async add(
		entry: Omit<PromptLibraryEntry, 'id' | 'createdAt' | 'updatedAt' | 'useCount'>
	): Promise<PromptLibraryEntry> {
		await this.initialize();

		const now = Date.now();
		const newEntry: PromptLibraryEntry = {
			...entry,
			id: generatePromptId(),
			title: entry.title || generateTitleFromPrompt(entry.prompt),
			createdAt: now,
			updatedAt: now,
			useCount: 0,
		};

		// Add to beginning of array (most recent first)
		this.prompts.unshift(newEntry);

		// Enforce max limit
		if (this.prompts.length > MAX_PROMPTS) {
			// Remove least used/oldest prompts
			this.prompts.sort((a, b) => {
				// Sort by use count (desc), then by last used (desc), then by created (desc)
				if (b.useCount !== a.useCount) return b.useCount - a.useCount;
				const aTime = a.lastUsedAt || a.createdAt;
				const bTime = b.lastUsedAt || b.createdAt;
				return bTime - aTime;
			});
			this.prompts = this.prompts.slice(0, MAX_PROMPTS);
		}

		await this.saveToDisk();
		logger.info(`Added prompt: ${newEntry.id} - ${newEntry.title}`, LOG_CONTEXT);
		return newEntry;
	}

	/**
	 * Update an existing prompt
	 */
	async update(
		id: string,
		updates: Partial<Omit<PromptLibraryEntry, 'id' | 'createdAt'>>
	): Promise<PromptLibraryEntry | null> {
		await this.initialize();

		const index = this.prompts.findIndex((p) => p.id === id);
		if (index === -1) {
			logger.warn(`Prompt not found for update: ${id}`, LOG_CONTEXT);
			return null;
		}

		const updatedEntry: PromptLibraryEntry = {
			...this.prompts[index],
			...updates,
			id: this.prompts[index].id, // Preserve original ID
			createdAt: this.prompts[index].createdAt, // Preserve creation time
			updatedAt: Date.now(),
		};

		this.prompts[index] = updatedEntry;
		await this.saveToDisk();
		logger.info(`Updated prompt: ${id}`, LOG_CONTEXT);
		return updatedEntry;
	}

	/**
	 * Delete a prompt
	 */
	async delete(id: string): Promise<boolean> {
		await this.initialize();

		const initialLength = this.prompts.length;
		this.prompts = this.prompts.filter((p) => p.id !== id);

		if (this.prompts.length < initialLength) {
			await this.saveToDisk();
			logger.info(`Deleted prompt: ${id}`, LOG_CONTEXT);
			return true;
		}

		logger.warn(`Prompt not found for deletion: ${id}`, LOG_CONTEXT);
		return false;
	}

	/**
	 * Search prompts by query string
	 * Searches title, prompt content, description, and tags
	 */
	async search(query: string): Promise<PromptLibraryEntry[]> {
		await this.initialize();

		if (!query.trim()) {
			return this.getAll();
		}

		const lowerQuery = query.toLowerCase().trim();
		const terms = lowerQuery.split(/\s+/);

		return this.prompts
			.filter((prompt) => {
				const searchableText = [
					prompt.title,
					prompt.prompt,
					prompt.description || '',
					prompt.projectName,
					prompt.agentName,
					...(prompt.tags || []),
				]
					.join(' ')
					.toLowerCase();

				// All terms must match
				return terms.every((term) => searchableText.includes(term));
			})
			.sort((a, b) => {
				// Sort by relevance (title matches first), then by usage
				const aInTitle = a.title.toLowerCase().includes(lowerQuery);
				const bInTitle = b.title.toLowerCase().includes(lowerQuery);
				if (aInTitle && !bInTitle) return -1;
				if (!aInTitle && bInTitle) return 1;

				// Then by use count
				if (b.useCount !== a.useCount) return b.useCount - a.useCount;

				// Then by recency
				const aTime = a.lastUsedAt || a.createdAt;
				const bTime = b.lastUsedAt || b.createdAt;
				return bTime - aTime;
			});
	}

	/**
	 * Record usage of a prompt
	 */
	async recordUsage(id: string): Promise<void> {
		await this.initialize();

		const prompt = this.prompts.find((p) => p.id === id);
		if (prompt) {
			prompt.useCount += 1;
			prompt.lastUsedAt = Date.now();
			await this.saveToDisk();
			logger.debug(`Recorded usage for prompt: ${id}`, LOG_CONTEXT);
		}
	}

	/**
	 * Get prompts by project
	 */
	async getByProject(projectPath: string): Promise<PromptLibraryEntry[]> {
		await this.initialize();
		return this.prompts.filter((p) => p.projectPath === projectPath);
	}

	/**
	 * Get library statistics
	 */
	async getStats(): Promise<{
		totalPrompts: number;
		uniqueProjects: number;
		mostUsedPrompt: PromptLibraryEntry | null;
	}> {
		await this.initialize();

		const uniqueProjects = new Set(this.prompts.map((p) => p.projectPath)).size;
		const mostUsed = this.prompts.reduce(
			(max, p) => (p.useCount > (max?.useCount || 0) ? p : max),
			null as PromptLibraryEntry | null
		);

		return {
			totalPrompts: this.prompts.length,
			uniqueProjects,
			mostUsedPrompt: mostUsed,
		};
	}
}

// Singleton instance
let promptLibraryManager: PromptLibraryManager | null = null;

/**
 * Get the singleton PromptLibraryManager instance
 */
export function getPromptLibraryManager(): PromptLibraryManager {
	if (!promptLibraryManager) {
		promptLibraryManager = new PromptLibraryManager();
	}
	return promptLibraryManager;
}
