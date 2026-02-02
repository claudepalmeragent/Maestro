/**
 * GroupChatThinkingBubble.tsx
 *
 * A collapsible bubble that displays streaming thinking/reasoning content
 * from the moderator or agents in a group chat. The header shows who is
 * thinking/working and can be clicked to expand/collapse the content.
 */

import { ChevronDown, ChevronUp } from 'lucide-react';
import type { Theme, GroupChatState } from '../types';

interface GroupChatThinkingBubbleProps {
	theme: Theme;
	participantName: string;
	participantColor: string;
	thinkingContent: string;
	isCollapsed: boolean;
	onToggleCollapse: () => void;
	state: GroupChatState;
}

export function GroupChatThinkingBubble({
	theme,
	participantName,
	participantColor,
	thinkingContent,
	isCollapsed,
	onToggleCollapse,
	state,
}: GroupChatThinkingBubbleProps) {
	// Determine the header text based on state and participant
	const headerText =
		state === 'moderator-thinking'
			? 'Moderator is thinking...'
			: `${participantName} is working...`;

	return (
		<div className="flex gap-4 px-6 py-2">
			{/* Timestamp placeholder - same width as regular messages */}
			<div className="w-20 shrink-0" />

			{/* Thinking bubble container */}
			<div
				className="flex-1 min-w-0 rounded-xl border rounded-tl-none overflow-hidden"
				style={{
					backgroundColor: theme.colors.bgActivity,
					borderColor: theme.colors.border,
					borderLeftWidth: '3px',
					borderLeftColor: participantColor,
				}}
			>
				{/* Clickable header to toggle collapse */}
				<button
					onClick={onToggleCollapse}
					className="w-full flex items-center gap-2 p-3 text-left hover:bg-white/5 transition-colors"
					style={{ color: participantColor }}
				>
					{/* Pulsing indicator */}
					<div
						className="w-2 h-2 rounded-full animate-pulse shrink-0"
						style={{ backgroundColor: theme.colors.warning }}
					/>
					<span className="text-sm font-medium">{headerText}</span>
					{/* Chevron indicator */}
					{isCollapsed ? (
						<ChevronDown className="w-4 h-4 ml-auto opacity-50 shrink-0" />
					) : (
						<ChevronUp className="w-4 h-4 ml-auto opacity-50 shrink-0" />
					)}
				</button>

				{/* Collapsible thinking content */}
				{!isCollapsed && thinkingContent && (
					<div
						className="px-3 pb-3 max-h-64 overflow-y-auto scrollbar-thin"
						style={{ backgroundColor: `${theme.colors.bgMain}80` }}
					>
						{/* Inner bubble for thinking content */}
						<div
							className="p-2 rounded text-xs font-mono border-l-2"
							style={{
								color: theme.colors.textDim,
								borderColor: theme.colors.accent,
								backgroundColor: `${theme.colors.bgActivity}50`,
							}}
						>
							<div className="flex items-center gap-2 mb-1">
								<span
									className="text-[9px] px-1.5 py-0.5 rounded"
									style={{
										backgroundColor: `${theme.colors.accent}30`,
										color: theme.colors.accent,
									}}
								>
									thinking
								</span>
							</div>
							<div className="whitespace-pre-wrap" style={{ opacity: 0.7 }}>
								{thinkingContent}
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
