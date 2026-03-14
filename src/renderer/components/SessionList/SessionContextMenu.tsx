import { useState, useEffect, useRef } from 'react';
import {
	ChevronRight,
	Settings,
	Copy,
	Bookmark,
	FolderInput,
	FolderPlus,
	Folder,
	GitBranch,
	GitPullRequest,
	Trash2,
	Edit3,
} from 'lucide-react';
import type { Group, Session, Theme } from '../../types';
import { useClickOutside } from '../../hooks';

interface SessionContextMenuProps {
	x: number;
	y: number;
	theme: Theme;
	session: Session;
	groups: Group[];
	hasWorktreeChildren: boolean; // Whether this parent has worktree sub-agents
	onRename: () => void;
	onEdit: () => void;
	onDuplicate: () => void; // Opens New Agent dialog with pre-filled config
	onToggleBookmark: () => void;
	onMoveToGroup: (groupId: string) => void;
	onDelete: () => void;
	onDismiss: () => void;
	onCreatePR?: () => void; // For worktree child sessions
	onQuickCreateWorktree?: () => void; // Opens small modal for quick worktree creation
	onConfigureWorktrees?: () => void; // Opens full worktree config modal
	onDeleteWorktree?: () => void; // For worktree child sessions to delete
	onCreateGroup?: () => void; // Creates a new group from the Move to Group submenu
}

export function SessionContextMenu({
	x,
	y,
	theme,
	session,
	groups,
	hasWorktreeChildren,
	onRename,
	onEdit,
	onDuplicate,
	onToggleBookmark,
	onMoveToGroup,
	onDelete,
	onDismiss,
	onCreatePR,
	onQuickCreateWorktree,
	onConfigureWorktrees,
	onDeleteWorktree,
	onCreateGroup,
}: SessionContextMenuProps) {
	const menuRef = useRef<HTMLDivElement>(null);
	const moveToGroupRef = useRef<HTMLDivElement>(null);
	const submenuTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [showMoveSubmenu, setShowMoveSubmenu] = useState(false);
	const [submenuPosition, setSubmenuPosition] = useState<{
		vertical: 'below' | 'above';
		horizontal: 'right' | 'left';
	}>({ vertical: 'below', horizontal: 'right' });

	// Use ref to avoid re-registering listener when onDismiss changes
	const onDismissRef = useRef(onDismiss);
	onDismissRef.current = onDismiss;

	// Close on click outside
	useClickOutside(menuRef, onDismiss);

	// Close on Escape - stable listener that never re-registers
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				onDismissRef.current();
			}
		};
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, []);

	// Adjust menu position to stay within viewport
	const adjustedPosition = {
		left: Math.min(x, window.innerWidth - 200),
		top: Math.min(y, window.innerHeight - 250),
	};

	// Calculate submenu position when showing
	const handleMoveToGroupHover = () => {
		// Clear any pending close timeout
		if (submenuTimeoutRef.current) {
			clearTimeout(submenuTimeoutRef.current);
			submenuTimeoutRef.current = null;
		}
		setShowMoveSubmenu(true);

		if (moveToGroupRef.current) {
			const rect = moveToGroupRef.current.getBoundingClientRect();
			// Estimate submenu height: ~28px per item + 8px padding + divider
			const itemHeight = 28;
			const submenuHeight = (groups.length + 1) * itemHeight + 16 + (groups.length > 0 ? 8 : 0);
			const submenuWidth = 160; // minWidth + some padding
			const spaceBelow = window.innerHeight - rect.top;
			const spaceRight = window.innerWidth - rect.right;

			// Determine vertical position
			const vertical = spaceBelow < submenuHeight && rect.top > submenuHeight ? 'above' : 'below';

			// Determine horizontal position
			const horizontal = spaceRight < submenuWidth && rect.left > submenuWidth ? 'left' : 'right';

			setSubmenuPosition({ vertical, horizontal });
		}
	};

	// Delayed close for submenu to allow mouse to travel to it
	const handleMoveToGroupLeave = () => {
		submenuTimeoutRef.current = setTimeout(() => {
			setShowMoveSubmenu(false);
		}, 300); // 300ms delay to move mouse to submenu
	};

	return (
		<div
			ref={menuRef}
			className="fixed z-50 py-1 rounded-md shadow-xl border"
			style={{
				left: adjustedPosition.left,
				top: adjustedPosition.top,
				backgroundColor: theme.colors.bgSidebar,
				borderColor: theme.colors.border,
				minWidth: '160px',
			}}
		>
			{/* Rename */}
			<button
				onClick={() => {
					onRename();
					onDismiss();
				}}
				className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 transition-colors flex items-center gap-2"
				style={{ color: theme.colors.textMain }}
			>
				<Edit3 className="w-3.5 h-3.5" />
				Rename
			</button>

			{/* Edit Agent */}
			<button
				onClick={() => {
					onEdit();
					onDismiss();
				}}
				className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 transition-colors flex items-center gap-2"
				style={{ color: theme.colors.textMain }}
			>
				<Settings className="w-3.5 h-3.5" />
				Edit Agent...
			</button>

			{/* Duplicate */}
			<button
				onClick={() => {
					onDuplicate();
					onDismiss();
				}}
				className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 transition-colors flex items-center gap-2"
				style={{ color: theme.colors.textMain }}
			>
				<Copy className="w-3.5 h-3.5" />
				Duplicate...
			</button>

			{/* Toggle Bookmark - only for non-worktree sessions */}
			{!session.parentSessionId && (
				<button
					onClick={() => {
						onToggleBookmark();
						onDismiss();
					}}
					className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 transition-colors flex items-center gap-2"
					style={{ color: theme.colors.textMain }}
				>
					<Bookmark className="w-3.5 h-3.5" fill={session.bookmarked ? 'currentColor' : 'none'} />
					{session.bookmarked ? 'Remove Bookmark' : 'Add Bookmark'}
				</button>
			)}

			{/* Move to Group - only for non-worktree sessions, no separator */}
			{!session.parentSessionId && (
				<div
					ref={moveToGroupRef}
					className="relative"
					onMouseEnter={handleMoveToGroupHover}
					onMouseLeave={handleMoveToGroupLeave}
				>
					<button
						className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 transition-colors flex items-center justify-between"
						style={{ color: theme.colors.textMain }}
					>
						<span className="flex items-center gap-2">
							<FolderInput className="w-3.5 h-3.5" />
							Move to Group
						</span>
						<ChevronRight className="w-3 h-3" />
					</button>

					{/* Submenu */}
					{showMoveSubmenu && (
						<div
							className="absolute py-1 rounded-md shadow-xl border"
							style={{
								backgroundColor: theme.colors.bgSidebar,
								borderColor: theme.colors.border,
								minWidth: '140px',
								...(submenuPosition.vertical === 'above' ? { bottom: 0 } : { top: 0 }),
								...(submenuPosition.horizontal === 'left'
									? { right: '100%', marginRight: 4 }
									: { left: '100%', marginLeft: 4 }),
							}}
						>
							{/* No Group option */}
							<button
								onClick={() => {
									onMoveToGroup('');
									onDismiss();
								}}
								className={`w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 transition-colors flex items-center gap-2 ${!session.groupId ? 'opacity-50' : ''}`}
								style={{ color: theme.colors.textMain }}
								disabled={!session.groupId}
							>
								<Folder className="w-3.5 h-3.5" />
								Ungrouped
								{!session.groupId && <span className="text-[10px] opacity-50">(current)</span>}
							</button>

							{/* Divider if there are groups */}
							{groups.length > 0 && (
								<div className="my-1 border-t" style={{ borderColor: theme.colors.border }} />
							)}

							{/* Group options */}
							{groups.map((group) => (
								<button
									key={group.id}
									onClick={() => {
										onMoveToGroup(group.id);
										onDismiss();
									}}
									className={`w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 transition-colors flex items-center gap-2 ${session.groupId === group.id ? 'opacity-50' : ''}`}
									style={{ color: theme.colors.textMain }}
									disabled={session.groupId === group.id}
								>
									<span>{group.emoji}</span>
									<span className="truncate">{group.name}</span>
									{session.groupId === group.id && (
										<span className="text-[10px] opacity-50">(current)</span>
									)}
								</button>
							))}

							{/* Divider before Create New Group */}
							{onCreateGroup && (
								<div className="my-1 border-t" style={{ borderColor: theme.colors.border }} />
							)}

							{/* Create New Group option */}
							{onCreateGroup && (
								<button
									onClick={() => {
										onCreateGroup();
										onDismiss();
									}}
									className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 transition-colors flex items-center gap-2"
									style={{ color: theme.colors.accent }}
								>
									<FolderPlus className="w-3.5 h-3.5" />
									Create New Group
								</button>
							)}
						</div>
					)}
				</div>
			)}

			{/* Worktree section - for parent sessions */}
			{(hasWorktreeChildren || session.isGitRepo) &&
				!session.parentSessionId &&
				(onQuickCreateWorktree || onConfigureWorktrees) && (
					<>
						<div className="my-1 border-t" style={{ borderColor: theme.colors.border }} />
						{/* Only show Create Worktree if worktrees have been configured */}
						{onQuickCreateWorktree && session.worktreeConfig && (
							<button
								onClick={() => {
									onQuickCreateWorktree();
									onDismiss();
								}}
								className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 transition-colors flex items-center gap-2"
								style={{ color: theme.colors.accent }}
							>
								<GitBranch className="w-3.5 h-3.5" />
								Create Worktree
							</button>
						)}
						{onConfigureWorktrees && (
							<button
								onClick={() => {
									onConfigureWorktrees();
									onDismiss();
								}}
								className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 transition-colors flex items-center gap-2"
								style={{ color: theme.colors.accent }}
							>
								<Settings className="w-3.5 h-3.5" />
								Configure Worktrees
							</button>
						)}
					</>
				)}

			{/* Worktree child session actions */}
			{session.parentSessionId && session.worktreeBranch && (
				<>
					<div className="my-1 border-t" style={{ borderColor: theme.colors.border }} />
					{onCreatePR && (
						<button
							onClick={() => {
								onCreatePR();
								onDismiss();
							}}
							className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 transition-colors flex items-center gap-2"
							style={{ color: theme.colors.accent }}
						>
							<GitPullRequest className="w-3.5 h-3.5" />
							Create Pull Request
						</button>
					)}
					{onDeleteWorktree && (
						<button
							onClick={() => {
								onDeleteWorktree();
								onDismiss();
							}}
							className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 transition-colors flex items-center gap-2"
							style={{ color: theme.colors.error }}
						>
							<Trash2 className="w-3.5 h-3.5" />
							Remove Worktree
						</button>
					)}
				</>
			)}

			{/* Remove Agent - only for non-worktree sessions */}
			{!session.parentSessionId && (
				<>
					<div className="my-1 border-t" style={{ borderColor: theme.colors.border }} />
					<button
						onClick={() => {
							onDelete();
							onDismiss();
						}}
						className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 transition-colors flex items-center gap-2"
						style={{ color: theme.colors.error }}
					>
						<Trash2 className="w-3.5 h-3.5" />
						Remove Agent
					</button>
				</>
			)}
		</div>
	);
}
