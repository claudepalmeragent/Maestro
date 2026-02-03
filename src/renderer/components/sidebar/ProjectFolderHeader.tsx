import React, { memo, useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronRight, GripVertical, MoreHorizontal, FolderOpen } from 'lucide-react';
import type { ProjectFolder } from '../../../shared/types';
import type { Theme } from '../../types';

export interface ProjectFolderHeaderProps {
	/** The project folder data */
	folder: ProjectFolder;
	/** Theme for styling */
	theme: Theme;
	/** Whether the folder is collapsed */
	isCollapsed: boolean;
	/** Whether the folder name is being edited inline */
	isEditing: boolean;
	/** Count of items in this folder (for badge) */
	itemCount: number;
	/** Whether this folder is currently being dragged */
	isDragging: boolean;
	/** Whether another folder is being dragged over this one */
	isDragOver: boolean;

	// Handlers
	onToggleCollapse: () => void;
	onStartRename: () => void;
	onFinishRename: (newName: string) => void;
	onContextMenu: (e: React.MouseEvent) => void;
	onDragStart: (e: React.DragEvent) => void;
	onDragOver: (e: React.DragEvent) => void;
	onDragLeave: (e: React.DragEvent) => void;
	onDrop: (e: React.DragEvent) => void;
	onDragEnd: (e: React.DragEvent) => void;
}

/**
 * ProjectFolderHeader - Collapsible header for a project folder in the sidebar.
 *
 * Features:
 * - Drag handle for reordering folders
 * - Collapse/expand toggle
 * - Color indicator (left bar when expanded, full background when collapsed)
 * - Emoji and name display with inline editing
 * - Item count badge
 * - Context menu trigger
 */
export const ProjectFolderHeader = memo(function ProjectFolderHeader({
	folder,
	theme,
	isCollapsed,
	isEditing,
	itemCount,
	isDragging,
	isDragOver,
	onToggleCollapse,
	onStartRename,
	onFinishRename,
	onContextMenu,
	onDragStart,
	onDragOver,
	onDragLeave,
	onDrop,
	onDragEnd,
}: ProjectFolderHeaderProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [editValue, setEditValue] = useState(folder.name);

	// Focus input when entering edit mode
	useEffect(() => {
		if (isEditing && inputRef.current) {
			inputRef.current.focus();
			inputRef.current.select();
		}
	}, [isEditing]);

	// Reset edit value when folder name changes externally
	useEffect(() => {
		setEditValue(folder.name);
	}, [folder.name]);

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		e.stopPropagation();
		if (e.key === 'Enter') {
			onFinishRename(editValue.trim() || folder.name);
		} else if (e.key === 'Escape') {
			setEditValue(folder.name);
			onFinishRename(folder.name);
		}
	};

	const handleBlur = () => {
		onFinishRename(editValue.trim() || folder.name);
	};

	// Build dynamic styles based on collapsed state and highlight color
	const hasColor = !!folder.highlightColor;

	const headerStyle: React.CSSProperties = {
		backgroundColor: hasColor
			? folder.highlightColor + '20' // 20 = ~12% opacity, always visible when color is set
			: isDragOver
				? theme.colors.bgActivity
				: 'transparent',
		borderLeftColor: !isCollapsed && hasColor ? folder.highlightColor : 'transparent',
		borderLeftWidth: !isCollapsed && hasColor ? '3px' : '0px',
		opacity: isDragging ? 0.5 : 1,
	};

	return (
		<div
			className={`flex items-center gap-1 px-2 py-2 cursor-pointer transition-all hover:bg-opacity-50 ${
				isDragOver ? 'ring-2 ring-inset' : ''
			}`}
			style={{
				...headerStyle,
				['--tw-ring-color' as string]: theme.colors.accent,
			}}
			draggable
			onDragStart={onDragStart}
			onDragOver={onDragOver}
			onDragLeave={onDragLeave}
			onDrop={onDrop}
			onDragEnd={onDragEnd}
			onContextMenu={onContextMenu}
			onClick={onToggleCollapse}
		>
			{/* Drag handle */}
			<div
				className="cursor-grab opacity-40 hover:opacity-100 transition-opacity"
				onClick={(e) => e.stopPropagation()}
			>
				<GripVertical className="w-4 h-4" style={{ color: theme.colors.textDim }} />
			</div>

			{/* Collapse/expand toggle */}
			<div className="shrink-0">
				{isCollapsed ? (
					<ChevronRight className="w-4 h-4" style={{ color: theme.colors.textDim }} />
				) : (
					<ChevronDown className="w-4 h-4" style={{ color: theme.colors.textDim }} />
				)}
			</div>

			{/* Emoji or folder icon */}
			<span className="shrink-0 text-base">
				{folder.emoji || (
					<FolderOpen
						className="w-4 h-4"
						style={{ color: hasColor ? folder.highlightColor : theme.colors.textDim }}
					/>
				)}
			</span>

			{/* Folder name (editable) */}
			<div className="flex-1 min-w-0">
				{isEditing ? (
					<input
						ref={inputRef}
						type="text"
						value={editValue}
						onChange={(e) => setEditValue(e.target.value)}
						onKeyDown={handleKeyDown}
						onBlur={handleBlur}
						onClick={(e) => e.stopPropagation()}
						className="w-full bg-transparent text-sm font-semibold uppercase tracking-wide outline-none border-b"
						style={{
							color: theme.colors.textMain,
							borderColor: theme.colors.accent,
						}}
					/>
				) : (
					<span
						className="text-sm font-semibold uppercase tracking-wide truncate block"
						style={{ color: theme.colors.textMain }}
						onDoubleClick={(e) => {
							e.stopPropagation();
							onStartRename();
						}}
					>
						{folder.name}
					</span>
				)}
			</div>

			{/* Item count badge */}
			{itemCount > 0 && (
				<span
					className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
					style={{
						backgroundColor: hasColor ? folder.highlightColor + '30' : theme.colors.bgActivity,
						color: hasColor ? folder.highlightColor : theme.colors.textDim,
					}}
				>
					{itemCount}
				</span>
			)}

			{/* Context menu button */}
			<button
				onClick={(e) => {
					e.stopPropagation();
					onContextMenu(e);
				}}
				className="p-1 rounded opacity-40 hover:opacity-100 hover:bg-white/10 transition-all"
			>
				<MoreHorizontal className="w-4 h-4" style={{ color: theme.colors.textDim }} />
			</button>
		</div>
	);
});

export default ProjectFolderHeader;
