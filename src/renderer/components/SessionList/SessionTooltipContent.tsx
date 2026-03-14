import { memo } from 'react';
import { Folder, GitBranch, Bot, Clock, Server } from 'lucide-react';
import type { Session, Theme } from '../../types';
import { getStatusColor, getContextColor, formatActiveTime } from '../../utils/theme';
import { getDisplayCost, formatCost, getCostTooltip } from '../../utils/costCalculation';

interface SessionTooltipContentProps {
	session: Session;
	theme: Theme;
	gitFileCount?: number;
	groupName?: string; // Optional group name (for skinny mode)
	isInBatch?: boolean; // Whether session is running in auto mode
	resolvedBillingMode?: 'api' | 'max'; // Resolved billing mode for cost display
	isMaxSubscriber?: boolean; // Whether agent uses Max subscription pricing
}

export const SessionTooltipContent = memo(function SessionTooltipContent({
	session,
	theme,
	gitFileCount,
	groupName,
	isInBatch = false,
	resolvedBillingMode,
	isMaxSubscriber = false,
}: SessionTooltipContentProps) {
	return (
		<>
			{groupName && (
				<div
					className="text-[10px] font-bold uppercase mb-1"
					style={{ color: theme.colors.textDim }}
				>
					{groupName}
				</div>
			)}
			<div className="flex items-center gap-2 mb-2">
				<span className="text-xs font-bold" style={{ color: theme.colors.textMain }}>
					{session.name}
				</span>
				{/* Location Indicator Pills */}
				{session.toolType !== 'terminal' && (
					<>
						{/* SSH connection failure badge - red server icon (shown for any remote session with failed connection) */}
						{/* For git repos, this shows alongside GIT badge; for non-git, this replaces REMOTE badge */}
						{session.sessionSshRemoteConfig?.enabled && session.sshConnectionFailed && (
							<span
								className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold"
								style={{
									backgroundColor: theme.colors.error + '30',
									color: theme.colors.error,
								}}
								title="SSH connection failed"
							>
								<Server className="w-3 h-3" />
								{/* Show REMOTE text only for non-git sessions (git sessions show GIT badge separately) */}
								{!(session.isGitRepo || session.worktreeBranch) && (
									<span className="uppercase">REMOTE</span>
								)}
							</span>
						)}
						{/* Worktree children are always git repos; also check isGitRepo for regular sessions */}
						{session.isGitRepo || session.worktreeBranch ? (
							/* Git repo: Show server icon pill (if remote & connected) + GIT pill */
							<>
								{/* Server icon for remote git repos - only when connected (failure shows red server above) */}
								{session.sessionSshRemoteConfig?.enabled && !session.sshConnectionFailed && (
									<span
										className="flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold"
										style={{
											backgroundColor: theme.colors.success + '30',
											color: theme.colors.success,
										}}
										title="Remote SSH"
									>
										<Server className="w-3 h-3" />
									</span>
								)}
								<span
									className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase"
									style={{
										backgroundColor: theme.colors.accent + '30',
										color: theme.colors.accent,
									}}
									title={
										session.gitRoot && session.gitRoot !== session.cwd
											? `Git root: ${session.gitRoot}`
											: 'Git repository'
									}
								>
									GIT
									{session.gitRoot && session.gitRoot !== session.cwd && (
										<span
											style={{
												fontSize: '0.55rem',
												opacity: 0.7,
												marginLeft: '3px',
												textTransform: 'none',
											}}
										>
											{session.gitRoot.split('/').pop()}
										</span>
									)}
								</span>
							</>
						) : /* Plain directory: Show REMOTE (with server icon if failed) or LOCAL */
						session.sessionSshRemoteConfig?.enabled ? (
							/* Remote non-git: show REMOTE badge (red if failed, orange if connected) */
							/* Note: failure server icon already shown above */
							!session.sshConnectionFailed && (
								<span
									className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase"
									style={{
										backgroundColor: theme.colors.warning + '30',
										color: theme.colors.warning,
									}}
								>
									REMOTE
								</span>
							)
						) : (
							/* Local non-git: show LOCAL badge */
							<span
								className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase"
								style={{
									backgroundColor: theme.colors.textDim + '20',
									color: theme.colors.textDim,
								}}
							>
								LOCAL
							</span>
						)}
					</>
				)}
				{/* AUTO Mode Indicator */}
				{isInBatch && (
					<span
						className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase animate-pulse"
						style={{
							backgroundColor: theme.colors.warning + '30',
							color: theme.colors.warning,
						}}
					>
						<Bot className="w-2.5 h-2.5" />
						AUTO
					</span>
				)}
			</div>
			<div className="text-[10px] capitalize mb-2" style={{ color: theme.colors.textDim }}>
				{session.state} • {session.toolType}
				{session.sessionSshRemoteConfig?.enabled ? ' (SSH)' : ''}
			</div>

			<div
				className="pt-2 mt-2 space-y-1.5"
				style={{ borderTop: `1px solid ${theme.colors.border}` }}
			>
				<div className="flex items-center justify-between text-[10px]">
					<span style={{ color: theme.colors.textDim }}>Context Window</span>
					<span style={{ color: theme.colors.textMain }}>{session.contextUsage}%</span>
				</div>
				<div
					className="w-full h-1 rounded-full overflow-hidden"
					style={{ backgroundColor: theme.colors.border }}
				>
					<div
						className="h-full transition-all"
						style={{
							width: `${session.contextUsage}%`,
							backgroundColor: getContextColor(session.contextUsage, theme),
						}}
					/>
				</div>

				{/* Git Status */}
				{session.isGitRepo &&
					!session.isBareRepo &&
					gitFileCount !== undefined &&
					gitFileCount > 0 && (
						<div className="flex items-center justify-between text-[10px] pt-1">
							<span className="flex items-center gap-1" style={{ color: theme.colors.textDim }}>
								<GitBranch className="w-3 h-3" />
								Git Changes
							</span>
							<span style={{ color: theme.colors.warning }}>{gitFileCount} files</span>
						</div>
					)}

				{/* Session Cost */}
				{session.usageStats && getDisplayCost(session.usageStats) > 0 && (
					<div className="flex items-center justify-between text-[10px] pt-1">
						<span style={{ color: theme.colors.textDim }}>Session Cost</span>
						<span
							className="font-mono font-bold"
							style={{ color: theme.colors.success }}
							title={getCostTooltip(resolvedBillingMode) || undefined}
						>
							{formatCost(getDisplayCost(session.usageStats), resolvedBillingMode, isMaxSubscriber)}
						</span>
					</div>
				)}

				{/* Active Time */}
				{session.activeTimeMs > 0 && (
					<div className="flex items-center justify-between text-[10px] pt-1">
						<span className="flex items-center gap-1" style={{ color: theme.colors.textDim }}>
							<Clock className="w-3 h-3" />
							Active Time
						</span>
						<span className="font-mono font-bold" style={{ color: theme.colors.accent }}>
							{formatActiveTime(session.activeTimeMs)}
						</span>
					</div>
				)}

				<div
					className="flex items-center gap-1.5 text-[10px] font-mono pt-1"
					style={{ color: theme.colors.textDim }}
				>
					<Folder className="w-3 h-3 shrink-0" />
					<span className="truncate">{session.cwd}</span>
				</div>
			</div>
		</>
	);
});
