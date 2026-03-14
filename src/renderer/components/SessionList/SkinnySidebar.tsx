import React from 'react';
import type { Session, Group, Theme } from '../../types';
import { getStatusColor } from '../../utils/theme';
import { SessionTooltipContent } from './SessionTooltipContent';

interface SkinnySidebarProps {
	theme: Theme;
	sortedSessions: Session[];
	activeSessionId: string;
	groups: Group[];
	activeBatchSessionIds: string[];
	getFileCount: (sessionId: string) => number;
	setActiveSessionId: (id: string) => void;
	handleContextMenu: (e: React.MouseEvent, sessionId: string) => void;
	resolvedBillingMode?: 'api' | 'max';
	isMaxSubscriber?: boolean;
}

export function SkinnySidebar({
	theme,
	sortedSessions,
	activeSessionId,
	groups,
	activeBatchSessionIds,
	getFileCount,
	setActiveSessionId,
	handleContextMenu,
	resolvedBillingMode,
	isMaxSubscriber = false,
}: SkinnySidebarProps) {
	return (
		<div className="flex-1 flex flex-col items-center py-4 gap-2 overflow-y-auto overflow-x-visible no-scrollbar">
			{sortedSessions.map((session) => {
				const isInBatch = activeBatchSessionIds.includes(session.id);
				const hasUnreadTabs = session.aiTabs?.some((tab) => tab.hasUnread);
				// Sessions in Auto Run mode should show yellow/warning color
				const effectiveStatusColor = isInBatch
					? theme.colors.warning
					: session.toolType === 'claude' && !session.agentSessionId
						? undefined // Will use border style instead
						: getStatusColor(session.state, theme);
				const shouldPulse = session.state === 'busy' || isInBatch;

				return (
					<div
						key={session.id}
						onClick={() => setActiveSessionId(session.id)}
						onContextMenu={(e) => handleContextMenu(e, session.id)}
						className={`group relative w-8 h-8 rounded-full flex items-center justify-center cursor-pointer transition-all ${activeSessionId === session.id ? 'ring-2' : 'hover:bg-white/10'}`}
						style={{ '--tw-ring-color': theme.colors.accent } as React.CSSProperties}
					>
						<div className="relative">
							<div
								className={`w-3 h-3 rounded-full ${shouldPulse ? 'animate-pulse' : ''}`}
								style={
									session.toolType === 'claude' && !session.agentSessionId && !isInBatch
										? {
												border: `1.5px solid ${theme.colors.textDim}`,
												backgroundColor: 'transparent',
											}
										: { backgroundColor: effectiveStatusColor }
								}
								title={
									session.toolType === 'claude' && !session.agentSessionId
										? 'No active Claude session'
										: undefined
								}
							/>
							{/* Unread Notification Badge */}
							{activeSessionId !== session.id && hasUnreadTabs && (
								<div
									className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full"
									style={{ backgroundColor: theme.colors.error }}
									title="Unread messages"
								/>
							)}
						</div>

						{/* Hover Tooltip for Skinny Mode */}
						<div
							className="fixed rounded px-3 py-2 z-[100] opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity shadow-xl"
							style={{
								minWidth: '240px',
								left: '80px',
								backgroundColor: theme.colors.bgSidebar,
								border: `1px solid ${theme.colors.border}`,
							}}
						>
							<SessionTooltipContent
								session={session}
								theme={theme}
								gitFileCount={getFileCount(session.id)}
								groupName={groups.find((g) => g.id === session.groupId)?.name}
								isInBatch={isInBatch}
								resolvedBillingMode={
									session.toolType === 'claude-code' || session.toolType === 'claude'
										? resolvedBillingMode
										: 'api'
								}
								isMaxSubscriber={
									(session.toolType === 'claude-code' || session.toolType === 'claude') &&
									isMaxSubscriber
								}
							/>
						</div>
					</div>
				);
			})}
		</div>
	);
}
