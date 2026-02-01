import React, { memo } from 'react';
import { Check, FolderPlus, Folder } from 'lucide-react';
import type { ProjectFolder } from '../../../shared/types';
import type { Theme } from '../../types';

export interface MoveToProjectMenuProps {
	/** Theme for styling */
	theme: Theme;
	/** All available project folders */
	projectFolders: ProjectFolder[];
	/** IDs of folders this item currently belongs to */
	currentFolderIds: string[];
	/** Callback when a folder is toggled (add/remove) */
	onToggleFolder: (folderId: string) => void;
	/** Callback to create a new folder */
	onCreateFolder?: () => void;
	/** Whether to show checkboxes (for multi-select mode, e.g., sessions) */
	multiSelect?: boolean;
	/** Label for the menu header */
	headerLabel?: string;
}

/**
 * MoveToProjectMenu - Context menu submenu for assigning items to project folders.
 *
 * Two modes:
 * 1. Multi-select (for sessions/agents): Shows checkboxes, allows multiple folders
 * 2. Single-select (for groups/chats): Shows radio-style, exclusive to one folder
 *
 * Used within context menus for Sessions, Groups, and Group Chats.
 */
export const MoveToProjectMenu = memo(function MoveToProjectMenu({
	theme,
	projectFolders,
	currentFolderIds,
	onToggleFolder,
	onCreateFolder,
	multiSelect = false,
	headerLabel = 'Add to Project',
}: MoveToProjectMenuProps) {
	const sortedFolders = [...projectFolders].sort((a, b) => a.order - b.order);

	return (
		<div
			className="min-w-[200px] py-1 rounded-lg border shadow-xl"
			style={{
				backgroundColor: theme.colors.bgSidebar,
				borderColor: theme.colors.border,
			}}
		>
			{/* Header */}
			<div
				className="px-3 py-2 text-xs font-semibold uppercase tracking-wide border-b"
				style={{
					color: theme.colors.textDim,
					borderColor: theme.colors.border,
				}}
			>
				{headerLabel}
			</div>

			{/* Folder list */}
			{sortedFolders.length > 0 ? (
				<div className="py-1">
					{sortedFolders.map((folder) => {
						const isSelected = currentFolderIds.includes(folder.id);

						return (
							<button
								key={folder.id}
								onClick={() => onToggleFolder(folder.id)}
								className="w-full px-3 py-2 flex items-center gap-2 hover:bg-white/5 transition-colors text-left"
							>
								{/* Checkbox/Radio indicator */}
								<div
									className={`w-4 h-4 rounded ${multiSelect ? '' : 'rounded-full'} border flex items-center justify-center shrink-0`}
									style={{
										borderColor: isSelected ? theme.colors.accent : theme.colors.border,
										backgroundColor: isSelected ? theme.colors.accent : 'transparent',
									}}
								>
									{isSelected && <Check className="w-3 h-3" style={{ color: '#fff' }} />}
								</div>

								{/* Color indicator */}
								{folder.highlightColor && (
									<div
										className="w-3 h-3 rounded-full shrink-0"
										style={{ backgroundColor: folder.highlightColor }}
									/>
								)}

								{/* Emoji */}
								{folder.emoji && <span className="shrink-0">{folder.emoji}</span>}

								{/* Folder name */}
								<span className="text-sm truncate flex-1" style={{ color: theme.colors.textMain }}>
									{folder.name}
								</span>
							</button>
						);
					})}
				</div>
			) : (
				<div className="px-3 py-4 text-sm text-center" style={{ color: theme.colors.textDim }}>
					No project folders yet
				</div>
			)}

			{/* Create new folder option */}
			{onCreateFolder && (
				<>
					<div className="border-t mx-2 my-1" style={{ borderColor: theme.colors.border }} />
					<button
						onClick={onCreateFolder}
						className="w-full px-3 py-2 flex items-center gap-2 hover:bg-white/5 transition-colors text-left"
					>
						<FolderPlus className="w-4 h-4" style={{ color: theme.colors.accent }} />
						<span className="text-sm" style={{ color: theme.colors.accent }}>
							Create New Folder...
						</span>
					</button>
				</>
			)}
		</div>
	);
});

/**
 * MoveToProjectMenuItem - Single menu item for use in existing context menus.
 * Shows a folder icon with the current folder assignment status.
 */
export interface MoveToProjectMenuItemProps {
	theme: Theme;
	label: string;
	folderCount: number;
	onClick: () => void;
}

export const MoveToProjectMenuItem = memo(function MoveToProjectMenuItem({
	theme,
	label,
	folderCount,
	onClick,
}: MoveToProjectMenuItemProps) {
	return (
		<button
			onClick={onClick}
			className="w-full px-3 py-2 flex items-center gap-2 hover:bg-white/5 transition-colors text-left"
		>
			<Folder className="w-4 h-4" style={{ color: theme.colors.textDim }} />
			<span className="text-sm flex-1" style={{ color: theme.colors.textMain }}>
				{label}
			</span>
			{folderCount > 0 && (
				<span
					className="text-xs px-1.5 py-0.5 rounded"
					style={{
						backgroundColor: theme.colors.accent + '20',
						color: theme.colors.accent,
					}}
				>
					{folderCount}
				</span>
			)}
			<span style={{ color: theme.colors.textDim }}>▸</span>
		</button>
	);
});

export default MoveToProjectMenu;
