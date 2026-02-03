import { useState, useCallback, useRef } from 'react';
import type { SubagentInfo } from '../../types';

interface SessionMessage {
	type: string;
	role?: string;
	content: string;
	timestamp: string;
	uuid: string;
	toolUse?: any;
}

interface UseSubagentViewerOptions {
	agentId: string;
	projectPath: string | undefined;
	sshRemoteId?: string;
}

interface UseSubagentViewerReturn {
	/** Currently viewing subagent */
	viewingSubagent: SubagentInfo | null;
	/** Messages for the viewing subagent */
	messages: SessionMessage[];
	/** Loading state */
	messagesLoading: boolean;
	/** Has more messages to load */
	hasMoreMessages: boolean;
	/** Total message count */
	totalMessages: number;
	/** View a subagent's messages */
	viewSubagent: (subagent: SubagentInfo) => Promise<void>;
	/** Load more messages (pagination) */
	loadMoreMessages: () => Promise<void>;
	/** Clear the viewing state */
	clearViewing: () => void;
}

const MESSAGES_PAGE_SIZE = 20;

/**
 * Hook for viewing subagent messages with pagination support.
 */
export function useSubagentViewer({
	agentId,
	projectPath,
	sshRemoteId,
}: UseSubagentViewerOptions): UseSubagentViewerReturn {
	const [viewingSubagent, setViewingSubagent] = useState<SubagentInfo | null>(null);
	const [messages, setMessages] = useState<SessionMessage[]>([]);
	const [messagesLoading, setMessagesLoading] = useState(false);
	const [hasMoreMessages, setHasMoreMessages] = useState(false);
	const [totalMessages, setTotalMessages] = useState(0);

	const offsetRef = useRef(0);

	const viewSubagent = useCallback(
		async (subagent: SubagentInfo) => {
			if (!projectPath) return;

			setViewingSubagent(subagent);
			setMessages([]);
			setMessagesLoading(true);
			offsetRef.current = 0;

			try {
				const result = await window.maestro.agentSessions.getSubagentMessages(
					agentId,
					projectPath,
					subagent.agentId,
					{ offset: 0, limit: MESSAGES_PAGE_SIZE },
					sshRemoteId
				);

				setMessages(result.messages);
				setTotalMessages(result.total);
				setHasMoreMessages(result.hasMore);
				offsetRef.current = result.messages.length;
			} catch (error) {
				console.error('Failed to load subagent messages:', error);
				setMessages([]);
				setTotalMessages(0);
				setHasMoreMessages(false);
			} finally {
				setMessagesLoading(false);
			}
		},
		[agentId, projectPath, sshRemoteId]
	);

	const loadMoreMessages = useCallback(async () => {
		if (!viewingSubagent || !projectPath || messagesLoading || !hasMoreMessages) {
			return;
		}

		setMessagesLoading(true);

		try {
			const result = await window.maestro.agentSessions.getSubagentMessages(
				agentId,
				projectPath,
				viewingSubagent.agentId,
				{ offset: offsetRef.current, limit: MESSAGES_PAGE_SIZE },
				sshRemoteId
			);

			// Prepend older messages
			setMessages((prev) => [...result.messages, ...prev]);
			setHasMoreMessages(result.hasMore);
			offsetRef.current += result.messages.length;
		} catch (error) {
			console.error('Failed to load more subagent messages:', error);
		} finally {
			setMessagesLoading(false);
		}
	}, [agentId, projectPath, sshRemoteId, viewingSubagent, messagesLoading, hasMoreMessages]);

	const clearViewing = useCallback(() => {
		setViewingSubagent(null);
		setMessages([]);
		setTotalMessages(0);
		setHasMoreMessages(false);
		offsetRef.current = 0;
	}, []);

	return {
		viewingSubagent,
		messages,
		messagesLoading,
		hasMoreMessages,
		totalMessages,
		viewSubagent,
		loadMoreMessages,
		clearViewing,
	};
}
