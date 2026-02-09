import React from 'react';
import {
	Search,
	ClipboardList,
	Zap,
	Terminal,
	Sparkles,
	Clock,
	MessageSquare,
	DollarSign,
	Play,
} from 'lucide-react';
import type { Theme } from '../types';
import type { SubagentInfo } from '../types';
import { formatRelativeTime, formatNumber } from '../utils/formatters';

interface SubagentListItemProps {
	subagent: SubagentInfo;
	theme: Theme;
	isSelected: boolean;
	onClick: () => void;
	onResume?: () => void;
	/** Whether this is a Max subscriber (affects cost display tooltip) */
	isMaxSubscriber?: boolean;
}

/**
 * Get the appropriate icon for a subagent type
 */
function getSubagentIcon(agentType: string): React.ReactNode {
	const iconProps = { size: 14, className: 'subagent-type-icon' };

	switch (agentType.toLowerCase()) {
		case 'explore':
			return <Search {...iconProps} />;
		case 'plan':
			return <ClipboardList {...iconProps} />;
		case 'general-purpose':
			return <Zap {...iconProps} />;
		case 'bash':
			return <Terminal {...iconProps} />;
		default:
			return <Sparkles {...iconProps} />;
	}
}

/**
 * Get a display-friendly label for the subagent type
 */
function getSubagentTypeLabel(agentType: string): string {
	switch (agentType.toLowerCase()) {
		case 'explore':
			return 'Explore';
		case 'plan':
			return 'Plan';
		case 'general-purpose':
			return 'Task';
		case 'bash':
			return 'Bash';
		case 'statusline-setup':
			return 'Statusline';
		case 'claude code guide':
			return 'Guide';
		case 'unknown':
			return 'Subagent';
		default:
			return agentType;
	}
}

export function SubagentListItem({
	subagent,
	theme,
	isSelected,
	onClick,
	onResume,
	isMaxSubscriber,
}: SubagentListItemProps) {
	const handleResumeClick = (e: React.MouseEvent) => {
		e.stopPropagation();
		onResume?.();
	};

	return (
		<button
			onClick={onClick}
			className="subagent-list-item"
			style={{
				display: 'flex',
				alignItems: 'center',
				width: '100%',
				padding: '8px 12px 8px 32px', // Extra left padding for indent
				border: 'none',
				borderLeft: `3px solid ${isSelected ? theme.colors.accent : 'transparent'}`,
				background: isSelected ? `${theme.colors.accent}15` : 'transparent',
				cursor: 'pointer',
				textAlign: 'left',
				gap: '8px',
				transition: 'background 0.15s ease',
			}}
			onMouseEnter={(e) => {
				if (!isSelected) {
					e.currentTarget.style.background = `${theme.colors.textMain}08`;
				}
			}}
			onMouseLeave={(e) => {
				if (!isSelected) {
					e.currentTarget.style.background = 'transparent';
				}
			}}
		>
			{/* Subagent type icon */}
			<span
				style={{
					color: theme.colors.accent,
					display: 'flex',
					alignItems: 'center',
					flexShrink: 0,
				}}
			>
				{getSubagentIcon(subagent.agentType)}
			</span>

			{/* Type label */}
			<span
				style={{
					color: theme.colors.accent,
					fontSize: '12px',
					fontWeight: 500,
					flexShrink: 0,
					minWidth: '50px',
				}}
			>
				{getSubagentTypeLabel(subagent.agentType)}:
			</span>

			{/* Preview text */}
			<span
				style={{
					color: theme.colors.textMain,
					fontSize: '12px',
					flex: 1,
					overflow: 'hidden',
					textOverflow: 'ellipsis',
					whiteSpace: 'nowrap',
					opacity: 0.8,
				}}
			>
				{subagent.firstMessage || '(No preview)'}
			</span>

			{/* Metadata */}
			<span
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: '12px',
					color: theme.colors.textDim,
					fontSize: '11px',
					flexShrink: 0,
				}}
			>
				{/* Time */}
				<span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
					<Clock size={11} />
					{formatRelativeTime(subagent.modifiedAt)}
				</span>

				{/* Messages */}
				<span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
					<MessageSquare size={11} />
					{formatNumber(subagent.messageCount)}
				</span>

				{/* Cost */}
				<span
					style={{ display: 'flex', alignItems: 'center', gap: '3px' }}
					title={isMaxSubscriber ? 'Included in Max subscription' : 'API charges'}
				>
					<DollarSign size={11} />
					{subagent.costUsd.toFixed(2)}
				</span>

				{/* Resume button */}
				{onResume && (
					<button
						onClick={handleResumeClick}
						title="Resume this subagent"
						style={{
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							padding: '4px',
							border: 'none',
							borderRadius: '4px',
							background: 'transparent',
							color: theme.colors.accent,
							cursor: 'pointer',
							transition: 'background 0.15s ease',
						}}
						onMouseEnter={(e) => {
							e.currentTarget.style.background = `${theme.colors.accent}20`;
						}}
						onMouseLeave={(e) => {
							e.currentTarget.style.background = 'transparent';
						}}
					>
						<Play size={12} />
					</button>
				)}
			</span>
		</button>
	);
}
