/**
 * Hook for managing the Prompt Library
 *
 * Provides state management and operations for the prompt library,
 * including loading, searching, adding, updating, and deleting prompts.
 */

import { useState, useCallback, useEffect } from 'react';
import type { PromptLibraryEntry } from '../../types';

interface UsePromptLibraryOptions {
	/** Whether to load prompts immediately on mount */
	loadOnMount?: boolean;
}

interface UsePromptLibraryReturn {
	/** All loaded prompts */
	prompts: PromptLibraryEntry[];
	/** Search results when searching */
	searchResults: PromptLibraryEntry[];
	/** Whether prompts are being loaded */
	isLoading: boolean;
	/** Error message if any operation failed */
	error: string | null;
	/** Load all prompts from the library */
	loadPrompts: () => Promise<void>;
	/** Search prompts by query */
	searchPrompts: (query: string) => Promise<void>;
	/** Add a new prompt to the library */
	addPrompt: (
		entry: Omit<PromptLibraryEntry, 'id' | 'createdAt' | 'updatedAt' | 'useCount'>
	) => Promise<PromptLibraryEntry | null>;
	/** Update an existing prompt */
	updatePrompt: (
		id: string,
		updates: Partial<Omit<PromptLibraryEntry, 'id' | 'createdAt'>>
	) => Promise<PromptLibraryEntry | null>;
	/** Delete a prompt */
	deletePrompt: (id: string) => Promise<boolean>;
	/** Record usage of a prompt */
	recordUsage: (id: string) => Promise<void>;
	/** Clear the current error */
	clearError: () => void;
}

export function usePromptLibrary(options: UsePromptLibraryOptions = {}): UsePromptLibraryReturn {
	const { loadOnMount = false } = options;

	const [prompts, setPrompts] = useState<PromptLibraryEntry[]>([]);
	const [searchResults, setSearchResults] = useState<PromptLibraryEntry[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const clearError = useCallback(() => {
		setError(null);
	}, []);

	const loadPrompts = useCallback(async () => {
		setIsLoading(true);
		setError(null);
		try {
			const allPrompts = await window.maestro.promptLibrary.getAll();
			setPrompts(allPrompts);
			setSearchResults(allPrompts);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to load prompts';
			setError(message);
			console.error('Failed to load prompts:', err);
		} finally {
			setIsLoading(false);
		}
	}, []);

	const searchPrompts = useCallback(
		async (query: string) => {
			if (!query.trim()) {
				setSearchResults(prompts);
				return;
			}

			try {
				const results = await window.maestro.promptLibrary.search(query);
				setSearchResults(results);
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Failed to search prompts';
				setError(message);
				console.error('Failed to search prompts:', err);
			}
		},
		[prompts]
	);

	const addPrompt = useCallback(
		async (
			entry: Omit<PromptLibraryEntry, 'id' | 'createdAt' | 'updatedAt' | 'useCount'>
		): Promise<PromptLibraryEntry | null> => {
			try {
				const newPrompt = await window.maestro.promptLibrary.add(entry);
				// Update local state
				setPrompts((prev) => [newPrompt, ...prev]);
				setSearchResults((prev) => [newPrompt, ...prev]);
				return newPrompt;
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Failed to add prompt';
				setError(message);
				console.error('Failed to add prompt:', err);
				return null;
			}
		},
		[]
	);

	const updatePrompt = useCallback(
		async (
			id: string,
			updates: Partial<Omit<PromptLibraryEntry, 'id' | 'createdAt'>>
		): Promise<PromptLibraryEntry | null> => {
			try {
				const updated = await window.maestro.promptLibrary.update(id, updates);
				if (updated) {
					// Update local state
					setPrompts((prev) => prev.map((p) => (p.id === id ? updated : p)));
					setSearchResults((prev) => prev.map((p) => (p.id === id ? updated : p)));
				}
				return updated;
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Failed to update prompt';
				setError(message);
				console.error('Failed to update prompt:', err);
				return null;
			}
		},
		[]
	);

	const deletePrompt = useCallback(async (id: string): Promise<boolean> => {
		try {
			const deleted = await window.maestro.promptLibrary.delete(id);
			if (deleted) {
				// Update local state
				setPrompts((prev) => prev.filter((p) => p.id !== id));
				setSearchResults((prev) => prev.filter((p) => p.id !== id));
			}
			return deleted;
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to delete prompt';
			setError(message);
			console.error('Failed to delete prompt:', err);
			return false;
		}
	}, []);

	const recordUsage = useCallback(async (id: string): Promise<void> => {
		try {
			await window.maestro.promptLibrary.recordUsage(id);
			// Update local state to reflect usage
			const now = Date.now();
			setPrompts((prev) =>
				prev.map((p) => (p.id === id ? { ...p, useCount: p.useCount + 1, lastUsedAt: now } : p))
			);
			setSearchResults((prev) =>
				prev.map((p) => (p.id === id ? { ...p, useCount: p.useCount + 1, lastUsedAt: now } : p))
			);
		} catch (err) {
			console.error('Failed to record prompt usage:', err);
			// Don't set error for usage tracking failures
		}
	}, []);

	// Load prompts on mount if requested
	useEffect(() => {
		if (loadOnMount) {
			loadPrompts();
		}
	}, [loadOnMount, loadPrompts]);

	return {
		prompts,
		searchResults,
		isLoading,
		error,
		loadPrompts,
		searchPrompts,
		addPrompt,
		updatePrompt,
		deletePrompt,
		recordUsage,
		clearError,
	};
}
