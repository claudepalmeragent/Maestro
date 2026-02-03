import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Trash2, Edit2, X, Library, Clock, Hash } from 'lucide-react';
import type { Theme, PromptLibraryEntry } from '../types';
import { useListNavigation } from '../hooks';

interface PromptLibrarySearchBarProps {
	theme: Theme;
	isOpen: boolean;
	onClose: () => void;
	onSelectPrompt: (prompt: PromptLibraryEntry) => void;
	onDeletePrompt: (id: string) => void;
	onEditPrompt?: (prompt: PromptLibraryEntry) => void;
	currentProjectName?: string;
	currentAgentName?: string;
}

export function PromptLibrarySearchBar({
	theme,
	isOpen,
	onClose,
	onSelectPrompt,
	onDeletePrompt,
	onEditPrompt,
	currentProjectName,
	currentAgentName,
}: PromptLibrarySearchBarProps) {
	const [searchQuery, setSearchQuery] = useState('');
	const [prompts, setPrompts] = useState<PromptLibraryEntry[]>([]);
	const [filteredPrompts, setFilteredPrompts] = useState<PromptLibraryEntry[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [hoveredId, setHoveredId] = useState<string | null>(null);
	const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	// Load prompts on mount
	useEffect(() => {
		if (isOpen) {
			loadPrompts();
		}
	}, [isOpen]);

	// Focus input when opened
	useEffect(() => {
		if (isOpen && inputRef.current) {
			inputRef.current.focus();
		}
	}, [isOpen]);

	const loadPrompts = async () => {
		setIsLoading(true);
		try {
			const allPrompts = await window.maestro.promptLibrary.getAll();
			setPrompts(allPrompts);
			setFilteredPrompts(allPrompts);
		} catch (error) {
			console.error('Failed to load prompts:', error);
		} finally {
			setIsLoading(false);
		}
	};

	// Search prompts with debounce
	useEffect(() => {
		const timer = setTimeout(async () => {
			if (searchQuery.trim()) {
				try {
					const results = await window.maestro.promptLibrary.search(searchQuery);
					setFilteredPrompts(results);
				} catch (error) {
					console.error('Failed to search prompts:', error);
				}
			} else {
				setFilteredPrompts(prompts);
			}
		}, 150);

		return () => clearTimeout(timer);
	}, [searchQuery, prompts]);

	// List navigation hook
	const {
		selectedIndex,
		setSelectedIndex,
		handleKeyDown: handleListKeyDown,
	} = useListNavigation({
		listLength: filteredPrompts.length,
		onSelect: (index) => {
			if (filteredPrompts[index]) {
				handleSelectPrompt(filteredPrompts[index]);
			}
		},
		wrap: true,
	});

	// Reset selection when filtered prompts change
	useEffect(() => {
		setSelectedIndex(0);
	}, [filteredPrompts.length, setSelectedIndex]);

	// Scroll selected item into view
	useEffect(() => {
		if (listRef.current && selectedIndex >= 0) {
			const items = listRef.current.querySelectorAll('[data-prompt-item]');
			if (items[selectedIndex]) {
				items[selectedIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
			}
		}
	}, [selectedIndex]);

	const handleSelectPrompt = useCallback(
		async (prompt: PromptLibraryEntry) => {
			// Record usage
			try {
				await window.maestro.promptLibrary.recordUsage(prompt.id);
			} catch (error) {
				console.error('Failed to record usage:', error);
			}
			onSelectPrompt(prompt);
			onClose();
		},
		[onSelectPrompt, onClose]
	);

	const handleDelete = useCallback(
		async (id: string, e: React.MouseEvent) => {
			e.stopPropagation();
			if (deleteConfirmId === id) {
				try {
					await window.maestro.promptLibrary.delete(id);
					setPrompts((prev) => prev.filter((p) => p.id !== id));
					setFilteredPrompts((prev) => prev.filter((p) => p.id !== id));
					onDeletePrompt(id);
				} catch (error) {
					console.error('Failed to delete prompt:', error);
				}
				setDeleteConfirmId(null);
			} else {
				setDeleteConfirmId(id);
				// Auto-cancel confirmation after 3 seconds
				setTimeout(() => setDeleteConfirmId(null), 3000);
			}
		},
		[deleteConfirmId, onDeletePrompt]
	);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				onClose();
				return;
			}
			handleListKeyDown(e);
		},
		[handleListKeyDown, onClose]
	);

	const formatTimeAgo = (timestamp: number) => {
		const now = Date.now();
		const diff = now - timestamp;
		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(diff / 3600000);
		const days = Math.floor(diff / 86400000);

		if (minutes < 1) return 'just now';
		if (minutes < 60) return `${minutes}m ago`;
		if (hours < 24) return `${hours}h ago`;
		if (days < 30) return `${days}d ago`;
		return new Date(timestamp).toLocaleDateString();
	};

	const truncateText = (text: string, maxLength: number) => {
		if (text.length <= maxLength) return text;
		return text.substring(0, maxLength - 3) + '...';
	};

	if (!isOpen) return null;

	return (
		<div
			className="border-b"
			style={{
				borderColor: theme.colors.border,
				backgroundColor: theme.colors.bgMain,
			}}
		>
			{/* Search Input */}
			<div
				className="flex items-center gap-2 px-4 py-2"
				style={{ borderColor: theme.colors.border }}
			>
				<Search className="w-4 h-4 shrink-0" style={{ color: theme.colors.textDim }} />
				<input
					ref={inputRef}
					type="text"
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder="Search prompts by title, content, or tags..."
					className="flex-1 bg-transparent outline-none text-sm"
					style={{ color: theme.colors.textMain }}
				/>
				{searchQuery && (
					<button
						onClick={() => setSearchQuery('')}
						className="p-1 rounded hover:bg-white/10"
						title="Clear search"
					>
						<X className="w-3 h-3" style={{ color: theme.colors.textDim }} />
					</button>
				)}
				<button onClick={onClose} className="p-1 rounded hover:bg-white/10" title="Close (Escape)">
					<X className="w-4 h-4" style={{ color: theme.colors.textDim }} />
				</button>
			</div>

			{/* Results List */}
			<div
				ref={listRef}
				className="max-h-64 overflow-y-auto scrollbar-thin"
				style={{ borderColor: theme.colors.border }}
			>
				{isLoading ? (
					<div className="px-4 py-6 text-center text-sm" style={{ color: theme.colors.textDim }}>
						Loading prompts...
					</div>
				) : filteredPrompts.length === 0 ? (
					<div className="px-4 py-6 text-center text-sm" style={{ color: theme.colors.textDim }}>
						{searchQuery ? 'No prompts found' : 'No saved prompts yet'}
					</div>
				) : (
					filteredPrompts.map((prompt, index) => (
						<div
							key={prompt.id}
							data-prompt-item
							onClick={() => handleSelectPrompt(prompt)}
							onMouseEnter={() => {
								setHoveredId(prompt.id);
								setSelectedIndex(index);
							}}
							onMouseLeave={() => setHoveredId(null)}
							className="flex items-center gap-3 px-4 py-2 cursor-pointer transition-colors"
							style={{
								backgroundColor:
									selectedIndex === index ? `${theme.colors.accent}15` : 'transparent',
							}}
						>
							{/* Title and Preview */}
							<div className="flex-1 min-w-0">
								<div
									className="text-sm font-medium truncate"
									style={{ color: theme.colors.textMain }}
								>
									{prompt.title}
								</div>
								<div className="text-xs truncate" style={{ color: theme.colors.textDim }}>
									{truncateText(prompt.prompt, 80)}
								</div>
							</div>

							{/* Metadata Pills */}
							<div className="flex items-center gap-2 shrink-0">
								{/* Project Pill */}
								<span
									className="text-[10px] px-2 py-0.5 rounded-full border"
									style={{
										backgroundColor: theme.colors.bgSidebar,
										borderColor: theme.colors.border,
										color: theme.colors.textDim,
									}}
									title={`Project: ${prompt.projectPath}`}
								>
									{truncateText(prompt.projectName, 12)}
								</span>

								{/* Agent Pill */}
								<span
									className="text-[10px] px-2 py-0.5 rounded-full"
									style={{
										backgroundColor: `${theme.colors.accent}20`,
										color: theme.colors.accent,
									}}
									title={`Agent: ${prompt.agentId}${prompt.agentSessionId ? `\nSession: ${prompt.agentSessionId}` : ''}`}
								>
									{truncateText(prompt.agentName, 10)}
								</span>

								{/* Use count badge */}
								{prompt.useCount > 0 && (
									<span
										className="text-[9px] px-1.5 py-0.5 rounded"
										style={{
											backgroundColor: `${theme.colors.success}20`,
											color: theme.colors.success,
										}}
										title={`Used ${prompt.useCount} times`}
									>
										<Hash className="w-2.5 h-2.5 inline mr-0.5" />
										{prompt.useCount}
									</span>
								)}

								{/* Last used time */}
								{prompt.lastUsedAt && (
									<span
										className="text-[9px] flex items-center gap-0.5"
										style={{ color: theme.colors.textDim }}
										title={`Last used: ${new Date(prompt.lastUsedAt).toLocaleString()}`}
									>
										<Clock className="w-2.5 h-2.5" />
										{formatTimeAgo(prompt.lastUsedAt)}
									</span>
								)}
							</div>

							{/* Action Buttons (show on hover) */}
							{(hoveredId === prompt.id || selectedIndex === index) && (
								<div className="flex items-center gap-1 shrink-0">
									{onEditPrompt && (
										<button
											onClick={(e) => {
												e.stopPropagation();
												onEditPrompt(prompt);
											}}
											className="p-1 rounded hover:bg-white/10"
											title="Edit prompt"
										>
											<Edit2 className="w-3.5 h-3.5" style={{ color: theme.colors.textDim }} />
										</button>
									)}
									<button
										onClick={(e) => handleDelete(prompt.id, e)}
										className="p-1 rounded hover:bg-white/10"
										title={
											deleteConfirmId === prompt.id ? 'Click again to confirm' : 'Delete prompt'
										}
									>
										<Trash2
											className="w-3.5 h-3.5"
											style={{
												color:
													deleteConfirmId === prompt.id ? theme.colors.error : theme.colors.textDim,
											}}
										/>
									</button>
								</div>
							)}
						</div>
					))
				)}
			</div>

			{/* Footer with stats */}
			<div
				className="flex items-center justify-between px-4 py-1.5 text-[10px] border-t"
				style={{
					borderColor: theme.colors.border,
					color: theme.colors.textDim,
					backgroundColor: theme.colors.bgSidebar,
				}}
			>
				<div className="flex items-center gap-1">
					<Library className="w-3 h-3" />
					<span>{filteredPrompts.length} prompts</span>
					{searchQuery && prompts.length !== filteredPrompts.length && (
						<span>(of {prompts.length})</span>
					)}
				</div>
				<div>
					<kbd className="px-1 py-0.5 rounded bg-white/10 mx-0.5">↑</kbd>
					<kbd className="px-1 py-0.5 rounded bg-white/10 mx-0.5">↓</kbd>
					navigate
					<kbd className="px-1 py-0.5 rounded bg-white/10 mx-1">Enter</kbd>
					select
					<kbd className="px-1 py-0.5 rounded bg-white/10 mx-1">Esc</kbd>
					close
				</div>
			</div>
		</div>
	);
}
