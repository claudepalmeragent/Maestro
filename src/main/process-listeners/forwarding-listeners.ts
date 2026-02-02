/**
 * Simple IPC forwarding listeners.
 * These listeners just forward events from ProcessManager to the renderer.
 */

import type { ProcessManager } from '../process-manager';
import type { ProcessListenerDependencies, ToolExecution } from './types';
import { groupChatEmitters } from '../ipc/handlers/groupChat';

/**
 * Extracts group chat ID and participant name from a group chat session ID.
 * Group chat sessions use format: group-chat-{chatId}-{participant}
 * where participant is "moderator" or the participant name.
 *
 * @returns null if not a group chat session, otherwise { groupChatId, participantName }
 */
function parseGroupChatSessionId(
	sessionId: string
): { groupChatId: string; participantName: string } | null {
	// Match format: group-chat-{uuid}-{participant}
	// UUID is typically 8+ hex chars, participant is everything after the last dash
	const match = sessionId.match(/^group-chat-([a-f0-9-]+)-(.+)$/i);
	if (!match) return null;

	const groupChatId = match[1];
	const participantSlug = match[2];

	// Convert "moderator" to "Moderator", otherwise use as-is
	const participantName = participantSlug === 'moderator' ? 'Moderator' : participantSlug;

	return { groupChatId, participantName };
}

/**
 * Sets up simple forwarding listeners that pass events directly to renderer.
 * These are lightweight handlers that don't require any processing logic.
 */
export function setupForwardingListeners(
	processManager: ProcessManager,
	deps: Pick<ProcessListenerDependencies, 'safeSend'>
): void {
	const { safeSend } = deps;

	// Handle slash commands from Claude Code init message
	processManager.on('slash-commands', (sessionId: string, slashCommands: string[]) => {
		safeSend('process:slash-commands', sessionId, slashCommands);
	});

	// Handle thinking/streaming content chunks from AI agents
	// Emitted when agents produce partial text events (isPartial: true)
	// Renderer decides whether to display based on tab's showThinking setting
	processManager.on('thinking-chunk', (sessionId: string, content: string) => {
		safeSend('process:thinking-chunk', sessionId, content);

		// Also emit to group chat if this is a group chat session
		const groupChatInfo = parseGroupChatSessionId(sessionId);
		if (groupChatInfo) {
			groupChatEmitters.emitThinkingContent?.(
				groupChatInfo.groupChatId,
				groupChatInfo.participantName,
				content
			);
		}
	});

	// Handle tool execution events (OpenCode, Codex)
	processManager.on('tool-execution', (sessionId: string, toolEvent: ToolExecution) => {
		safeSend('process:tool-execution', sessionId, toolEvent);
	});

	// Handle stderr separately from runCommand (for clean command execution)
	processManager.on('stderr', (sessionId: string, data: string) => {
		safeSend('process:stderr', sessionId, data);
	});

	// Handle command exit (from runCommand - separate from PTY exit)
	processManager.on('command-exit', (sessionId: string, code: number) => {
		safeSend('process:command-exit', sessionId, code);
	});
}
