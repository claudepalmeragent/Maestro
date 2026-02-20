/**
 * Usage statistics listener.
 * Handles usage stats from AI responses, including group chat participant/moderator updates.
 */

import type { ProcessManager } from '../process-manager';
import { GROUP_CHAT_PREFIX, type ProcessListenerDependencies, type UsageStats } from './types';
import { getLocalTokenLedger } from '../services/local-token-ledger';

/**
 * Sets up the usage listener for token/cost statistics.
 * Handles:
 * - Group chat participant usage updates
 * - Group chat moderator usage updates
 * - Regular process usage forwarding to renderer
 */
export function setupUsageListener(
	processManager: ProcessManager,
	deps: Pick<
		ProcessListenerDependencies,
		| 'safeSend'
		| 'outputParser'
		| 'groupChatEmitters'
		| 'groupChatStorage'
		| 'usageAggregator'
		| 'logger'
		| 'patterns'
	>
): void {
	const {
		safeSend,
		outputParser,
		groupChatEmitters,
		groupChatStorage,
		usageAggregator,
		logger,
		patterns,
	} = deps;
	const { REGEX_MODERATOR_SESSION } = patterns;

	// Handle usage statistics from AI responses
	processManager.on('usage', (sessionId: string, usageStats: UsageStats) => {
		// Record token usage in LocalTokenLedger for OTEL flush gap mitigation
		try {
			const ledger = getLocalTokenLedger();
			ledger.recordTokens({
				sessionId,
				inputTokens: usageStats.inputTokens || 0,
				outputTokens: usageStats.outputTokens || 0,
				cacheReadTokens: usageStats.cacheReadInputTokens || 0,
				cacheCreationTokens: usageStats.cacheCreationInputTokens || 0,
				costUsd: usageStats.totalCostUsd || 0,
			});
		} catch {
			// Ledger recording is non-critical — don't break the usage pipeline
		}

		// Fast path: skip regex for non-group-chat sessions (performance optimization)
		const isGroupChatSession = sessionId.startsWith(GROUP_CHAT_PREFIX);

		// Handle group chat participant usage - update participant stats
		const participantUsageInfo = isGroupChatSession
			? outputParser.parseParticipantSessionId(sessionId)
			: null;
		if (participantUsageInfo) {
			const { groupChatId, participantName } = participantUsageInfo;

			// Calculate context usage percentage using agent-specific logic
			// Note: For group chat, we don't have agent type here, defaults to Claude behavior
			const totalContextTokens = usageAggregator.calculateContextTokens(usageStats);
			const contextUsage =
				usageStats.contextWindow > 0
					? Math.round((totalContextTokens / usageStats.contextWindow) * 100)
					: 0;

			// Update participant with usage stats
			groupChatStorage
				.updateParticipant(groupChatId, participantName, {
					contextUsage,
					tokenCount: totalContextTokens,
					totalCost: usageStats.totalCostUsd,
				})
				.then((updatedChat) => {
					// Emit participants changed so UI updates
					// Note: updateParticipant returns the updated chat, avoiding extra DB read
					groupChatEmitters.emitParticipantsChanged?.(groupChatId, updatedChat.participants);
				})
				.catch((err) => {
					logger.error('[GroupChat] Failed to update participant usage', 'ProcessListener', {
						error: String(err),
						participant: participantName,
					});
				});
			// Still send to renderer for consistency
		}

		// Handle group chat moderator usage - emit for UI
		const moderatorUsageMatch = isGroupChatSession
			? sessionId.match(REGEX_MODERATOR_SESSION)
			: null;
		if (moderatorUsageMatch) {
			const groupChatId = moderatorUsageMatch[1];
			// Calculate context usage percentage using agent-specific logic
			// Note: Moderator is typically Claude, defaults to Claude behavior
			const totalContextTokens = usageAggregator.calculateContextTokens(usageStats);
			const contextUsage =
				usageStats.contextWindow > 0
					? Math.round((totalContextTokens / usageStats.contextWindow) * 100)
					: 0;

			// Emit moderator usage for the moderator card
			groupChatEmitters.emitModeratorUsage?.(groupChatId, {
				contextUsage,
				totalCost: usageStats.totalCostUsd,
				tokenCount: totalContextTokens,
			});
		}

		safeSend('process:usage', sessionId, usageStats);
	});
}
