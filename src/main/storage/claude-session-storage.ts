/**
 * Claude Code Session Storage Implementation
 *
 * This module implements the AgentSessionStorage interface for Claude Code.
 * Claude Code stores sessions as JSONL files in ~/.claude/projects/<encoded-path>/
 *
 * File structure:
 * - Each session is a .jsonl file named <session-id>.jsonl
 * - Each line is a JSON object with type, timestamp, message, etc.
 * - User and assistant messages contain the actual conversation
 * - Result messages contain token usage and cost information
 */

import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import Store from 'electron-store';
import { logger } from '../utils/logger';
import { captureException } from '../utils/sentry';
import { CLAUDE_SESSION_PARSE_LIMITS } from '../constants';
import { calculateClaudeCost } from '../utils/pricing';
import { encodeClaudeProjectPath } from '../utils/statsCache';
import pLimit from 'p-limit';
import {
	readDirRemote,
	readFileRemote,
	readFileRemotePartial,
	readSessionMessagesRemote,
	statRemote,
	batchDiscoverSessionFilesRemote,
	batchExtractSessionPreviewsRemote,
	batchSubagentStatsRemote,
	searchSessionFilesRemote,
} from '../utils/remote-fs';
import type {
	AgentSessionInfo,
	PaginatedSessionsResult,
	SessionMessagesResult,
	SessionListOptions,
	SessionReadOptions,
	AgentSessionOrigin,
	SessionOriginInfo,
	SessionMessage,
	SubagentInfo,
} from '../agents';
import type { ToolType, SshRemoteConfig } from '../../shared/types';
import { BaseSessionStorage } from './base-session-storage';
import type { SearchableMessage } from './base-session-storage';

const LOG_CONTEXT = '[ClaudeSessionStorage]';

/**
 * Origin data structure stored in electron-store
 */
type StoredOriginData =
	| AgentSessionOrigin
	| {
			origin: AgentSessionOrigin;
			sessionName?: string;
			starred?: boolean;
			contextUsage?: number;
	  };

export interface ClaudeSessionOriginsData {
	origins: Record<string, Record<string, StoredOriginData>>;
}

/**
 * Extract semantic text from message content.
 * Skips images, tool_use, and tool_result - only returns actual text content.
 */
function extractTextFromContent(content: unknown): string {
	if (typeof content === 'string') {
		return content;
	}
	if (Array.isArray(content)) {
		const textParts = content
			.filter((part: { type?: string }) => part.type === 'text')
			.map((part: { type?: string; text?: string }) => part.text || '')
			.filter((text: string) => text.trim());
		return textParts.join(' ');
	}
	return '';
}

/**
 * Parse session content and extract metadata
 */
function parseSessionContent(
	content: string,
	sessionId: string,
	projectPath: string,
	stats: { size: number; mtimeMs: number }
): AgentSessionInfo | null {
	try {
		const lines = content.split('\n').filter((l) => l.trim());

		let firstAssistantMessage = '';
		let firstUserMessage = '';
		let timestamp = new Date(stats.mtimeMs).toISOString();

		// Fast regex-based extraction for message counts
		const userMessageCount = (content.match(/"type"\s*:\s*"user"/g) || []).length;
		const assistantMessageCount = (content.match(/"type"\s*:\s*"assistant"/g) || []).length;
		const messageCount = userMessageCount + assistantMessageCount;

		// Extract first meaningful message content
		// Prefer first assistant response as preview (more meaningful than system context)
		// Fall back to first user message if no assistant response exists
		for (
			let i = 0;
			i < Math.min(lines.length, CLAUDE_SESSION_PARSE_LIMITS.FIRST_MESSAGE_SCAN_LINES);
			i++
		) {
			try {
				const entry = JSON.parse(lines[i]);
				// Capture first user message as fallback
				if (!firstUserMessage && entry.type === 'user' && entry.message?.content) {
					const textContent = extractTextFromContent(entry.message.content);
					if (textContent.trim()) {
						firstUserMessage = textContent;
						timestamp = entry.timestamp || timestamp;
					}
				}
				// Capture first assistant message as preferred preview
				if (!firstAssistantMessage && entry.type === 'assistant' && entry.message?.content) {
					const textContent = extractTextFromContent(entry.message.content);
					if (textContent.trim()) {
						firstAssistantMessage = textContent;
						// Once we have assistant message, we can stop scanning
						break;
					}
				}
			} catch {
				// Skip malformed lines
			}
		}

		// Use assistant response as preview if available, otherwise fall back to user message
		const previewMessage = firstAssistantMessage || firstUserMessage;

		// Fast regex-based token extraction
		// IMPORTANT: Use negative lookbehind to avoid double-counting cache tokens
		let totalInputTokens = 0;
		let totalOutputTokens = 0;
		let totalCacheReadTokens = 0;
		let totalCacheCreationTokens = 0;

		const inputMatches = content.matchAll(
			/(?<!cache_read_|cache_creation_)"input_tokens"\s*:\s*(\d+)/g
		);
		for (const m of inputMatches) totalInputTokens += parseInt(m[1], 10);

		const outputMatches = content.matchAll(/"output_tokens"\s*:\s*(\d+)/g);
		for (const m of outputMatches) totalOutputTokens += parseInt(m[1], 10);

		const cacheReadMatches = content.matchAll(/"cache_read_input_tokens"\s*:\s*(\d+)/g);
		for (const m of cacheReadMatches) totalCacheReadTokens += parseInt(m[1], 10);

		const cacheCreationMatches = content.matchAll(/"cache_creation_input_tokens"\s*:\s*(\d+)/g);
		for (const m of cacheCreationMatches) totalCacheCreationTokens += parseInt(m[1], 10);

		const costUsd = calculateClaudeCost(
			totalInputTokens,
			totalOutputTokens,
			totalCacheReadTokens,
			totalCacheCreationTokens
		);

		// Extract last timestamp for duration
		let lastTimestamp = timestamp;
		for (
			let i = lines.length - 1;
			i >= Math.max(0, lines.length - CLAUDE_SESSION_PARSE_LIMITS.LAST_TIMESTAMP_SCAN_LINES);
			i--
		) {
			try {
				const entry = JSON.parse(lines[i]);
				if (entry.timestamp) {
					lastTimestamp = entry.timestamp;
					break;
				}
			} catch {
				// Skip malformed lines
			}
		}

		const startTime = new Date(timestamp).getTime();
		const endTime = new Date(lastTimestamp).getTime();
		const durationSeconds = Math.max(0, Math.floor((endTime - startTime) / 1000));

		return {
			sessionId,
			projectPath,
			timestamp,
			modifiedAt: new Date(stats.mtimeMs).toISOString(),
			firstMessage: previewMessage.slice(
				0,
				CLAUDE_SESSION_PARSE_LIMITS.FIRST_MESSAGE_PREVIEW_LENGTH
			),
			messageCount,
			sizeBytes: stats.size,
			costUsd,
			inputTokens: totalInputTokens,
			outputTokens: totalOutputTokens,
			cacheReadTokens: totalCacheReadTokens,
			cacheCreationTokens: totalCacheCreationTokens,
			durationSeconds,
		};
	} catch (error) {
		logger.error(`Error parsing session content for session: ${sessionId}`, LOG_CONTEXT, error);
		captureException(error, { operation: 'claudeStorage:parseSession', sessionId });
		return null;
	}
}

/**
 * Parse a session file and extract metadata (local filesystem)
 */
async function parseSessionFile(
	filePath: string,
	sessionId: string,
	projectPath: string,
	stats: { size: number; mtimeMs: number }
): Promise<AgentSessionInfo | null> {
	try {
		const content = await fs.readFile(filePath, 'utf-8');
		return parseSessionContent(content, sessionId, projectPath, stats);
	} catch (error) {
		logger.error(`Error reading session file: ${filePath}`, LOG_CONTEXT, error);
		captureException(error, { operation: 'claudeStorage:readSessionFile', filePath });
		return null;
	}
}

/**
 * Compute aggregated stats for a session including its subagents.
 * This pre-computes stats at listing time for efficient display.
 */
async function computeAggregatedStats(
	session: AgentSessionInfo,
	subagentsDir: string,
	isRemote: boolean,
	sshConfig?: SshRemoteConfig
): Promise<AgentSessionInfo> {
	try {
		// For remote sessions, use batch SSH command to get all stats in one call
		if (isRemote && sshConfig) {
			const batchResult = await batchSubagentStatsRemote(subagentsDir, sshConfig);
			if (!batchResult.success || !batchResult.data) {
				// No subagents or error — return session's own stats
				return {
					...session,
					hasSubagents: false,
					subagentCount: 0,
					aggregatedInputTokens: session.inputTokens,
					aggregatedOutputTokens: session.outputTokens,
					aggregatedCacheReadTokens: session.cacheReadTokens,
					aggregatedCacheCreationTokens: session.cacheCreationTokens,
					aggregatedCostUsd: session.costUsd,
					aggregatedMessageCount: session.messageCount,
				};
			}

			const stats = batchResult.data;
			const aggregatedInputTokens = session.inputTokens + stats.inputTokens;
			const aggregatedOutputTokens = session.outputTokens + stats.outputTokens;
			const aggregatedCacheReadTokens = (session.cacheReadTokens || 0) + stats.cacheReadTokens;
			const aggregatedCacheCreationTokens =
				(session.cacheCreationTokens || 0) + stats.cacheCreationTokens;
			const aggregatedCostUsd = calculateClaudeCost(
				aggregatedInputTokens,
				aggregatedOutputTokens,
				aggregatedCacheReadTokens,
				aggregatedCacheCreationTokens
			);

			return {
				...session,
				hasSubagents: stats.subagentCount > 0,
				subagentCount: stats.subagentCount,
				aggregatedInputTokens,
				aggregatedOutputTokens,
				aggregatedCacheReadTokens,
				aggregatedCacheCreationTokens,
				aggregatedCostUsd,
				aggregatedMessageCount: session.messageCount + stats.messageCount,
			};
		}

		// Local path: use filesystem directly (unchanged)
		let subagentFiles: string[] = [];
		try {
			const files = await fs.readdir(subagentsDir);
			subagentFiles = files.filter((f) => f.endsWith('.jsonl') && f.startsWith('agent-'));
		} catch {
			// No subagents folder
		}

		if (subagentFiles.length === 0) {
			return {
				...session,
				hasSubagents: false,
				subagentCount: 0,
				aggregatedInputTokens: session.inputTokens,
				aggregatedOutputTokens: session.outputTokens,
				aggregatedCacheReadTokens: session.cacheReadTokens,
				aggregatedCacheCreationTokens: session.cacheCreationTokens,
				aggregatedCostUsd: session.costUsd,
				aggregatedMessageCount: session.messageCount,
			};
		}

		// Aggregate subagent stats
		let subagentInputTokens = 0;
		let subagentOutputTokens = 0;
		let subagentCacheReadTokens = 0;
		let subagentCacheCreationTokens = 0;
		let subagentMessageCount = 0;

		for (const filename of subagentFiles) {
			try {
				const filePath = path.join(subagentsDir, filename);
				const content = await fs.readFile(filePath, 'utf-8');

				// Fast regex-based extraction
				// IMPORTANT: Use negative lookbehind to avoid double-counting cache tokens
				const inputMatches = content.matchAll(
					/(?<!cache_read_|cache_creation_)"input_tokens"\s*:\s*(\d+)/g
				);
				for (const m of inputMatches) subagentInputTokens += parseInt(m[1], 10);

				const outputMatches = content.matchAll(/"output_tokens"\s*:\s*(\d+)/g);
				for (const m of outputMatches) subagentOutputTokens += parseInt(m[1], 10);

				const cacheReadMatches = content.matchAll(/"cache_read_input_tokens"\s*:\s*(\d+)/g);
				for (const m of cacheReadMatches) subagentCacheReadTokens += parseInt(m[1], 10);

				const cacheCreationMatches = content.matchAll(/"cache_creation_input_tokens"\s*:\s*(\d+)/g);
				for (const m of cacheCreationMatches) subagentCacheCreationTokens += parseInt(m[1], 10);

				// Count messages
				const userCount = (content.match(/"type"\s*:\s*"user"/g) || []).length;
				const assistantCount = (content.match(/"type"\s*:\s*"assistant"/g) || []).length;
				subagentMessageCount += userCount + assistantCount;
			} catch {
				// Skip files that can't be read
			}
		}

		const aggregatedInputTokens = session.inputTokens + subagentInputTokens;
		const aggregatedOutputTokens = session.outputTokens + subagentOutputTokens;
		const aggregatedCacheReadTokens = (session.cacheReadTokens || 0) + subagentCacheReadTokens;
		const aggregatedCacheCreationTokens =
			(session.cacheCreationTokens || 0) + subagentCacheCreationTokens;
		const aggregatedCostUsd = calculateClaudeCost(
			aggregatedInputTokens,
			aggregatedOutputTokens,
			aggregatedCacheReadTokens,
			aggregatedCacheCreationTokens
		);

		return {
			...session,
			hasSubagents: true,
			subagentCount: subagentFiles.length,
			aggregatedInputTokens,
			aggregatedOutputTokens,
			aggregatedCacheReadTokens,
			aggregatedCacheCreationTokens,
			aggregatedCostUsd,
			aggregatedMessageCount: session.messageCount + subagentMessageCount,
		};
	} catch (error) {
		logger.error(
			`Error computing aggregated stats for session: ${session.sessionId}`,
			LOG_CONTEXT,
			error
		);
		// Return session with original stats if aggregation fails
		return {
			...session,
			hasSubagents: false,
			subagentCount: 0,
			aggregatedInputTokens: session.inputTokens,
			aggregatedOutputTokens: session.outputTokens,
			aggregatedCacheReadTokens: session.cacheReadTokens,
			aggregatedCacheCreationTokens: session.cacheCreationTokens,
			aggregatedCostUsd: session.costUsd,
			aggregatedMessageCount: session.messageCount,
		};
	}
}

/**
 * Parse partial session content to extract metadata for listing.
 * This is used for large remote files where reading the entire content
 * would exceed buffer limits. We extract what we can from head/tail.
 *
 * Note: Message count and token totals will be approximate for large files.
 */
function parsePartialSessionContent(
	head: string,
	tail: string,
	totalLines: number,
	sessionId: string,
	projectPath: string,
	stats: { size: number; mtimeMs: number }
): AgentSessionInfo | null {
	try {
		const headLines = head.split('\n').filter((l) => l.trim());
		const tailLines = tail.split('\n').filter((l) => l.trim());

		let firstAssistantMessage = '';
		let firstUserMessage = '';
		let timestamp = new Date(stats.mtimeMs).toISOString();

		// Estimate message count from total lines (rough approximation)
		// Most JSONL entries are single-line messages
		const estimatedMessageCount = Math.max(1, Math.floor(totalLines * 0.4));

		// Extract first meaningful message content from head
		for (
			let i = 0;
			i < Math.min(headLines.length, CLAUDE_SESSION_PARSE_LIMITS.FIRST_MESSAGE_SCAN_LINES);
			i++
		) {
			try {
				const entry = JSON.parse(headLines[i]);
				if (!firstUserMessage && entry.type === 'user' && entry.message?.content) {
					const textContent = extractTextFromContent(entry.message.content);
					if (textContent.trim()) {
						firstUserMessage = textContent;
						timestamp = entry.timestamp || timestamp;
					}
				}
				if (!firstAssistantMessage && entry.type === 'assistant' && entry.message?.content) {
					const textContent = extractTextFromContent(entry.message.content);
					if (textContent.trim()) {
						firstAssistantMessage = textContent;
						break;
					}
				}
			} catch {
				// Skip malformed lines
			}
		}

		const previewMessage = firstAssistantMessage || firstUserMessage;

		// Extract token counts from head (partial - won't have full totals for large files)
		// IMPORTANT: Use negative lookbehind to avoid double-counting cache tokens
		let totalInputTokens = 0;
		let totalOutputTokens = 0;
		let totalCacheReadTokens = 0;
		let totalCacheCreationTokens = 0;

		const combinedContent = head + '\n' + tail;
		const inputMatches = combinedContent.matchAll(
			/(?<!cache_read_|cache_creation_)"input_tokens"\s*:\s*(\d+)/g
		);
		for (const m of inputMatches) totalInputTokens += parseInt(m[1], 10);

		const outputMatches = combinedContent.matchAll(/"output_tokens"\s*:\s*(\d+)/g);
		for (const m of outputMatches) totalOutputTokens += parseInt(m[1], 10);

		const cacheReadMatches = combinedContent.matchAll(/"cache_read_input_tokens"\s*:\s*(\d+)/g);
		for (const m of cacheReadMatches) totalCacheReadTokens += parseInt(m[1], 10);

		const cacheCreationMatches = combinedContent.matchAll(
			/"cache_creation_input_tokens"\s*:\s*(\d+)/g
		);
		for (const m of cacheCreationMatches) totalCacheCreationTokens += parseInt(m[1], 10);

		const costUsd = calculateClaudeCost(
			totalInputTokens,
			totalOutputTokens,
			totalCacheReadTokens,
			totalCacheCreationTokens
		);

		// Extract last timestamp from tail for duration
		let lastTimestamp = timestamp;
		for (let i = tailLines.length - 1; i >= 0; i--) {
			try {
				const entry = JSON.parse(tailLines[i]);
				if (entry.timestamp) {
					lastTimestamp = entry.timestamp;
					break;
				}
			} catch {
				// Skip malformed lines
			}
		}

		const startTime = new Date(timestamp).getTime();
		const endTime = new Date(lastTimestamp).getTime();
		const durationSeconds = Math.max(0, Math.floor((endTime - startTime) / 1000));

		return {
			sessionId,
			projectPath,
			timestamp,
			modifiedAt: new Date(stats.mtimeMs).toISOString(),
			firstMessage: previewMessage.slice(
				0,
				CLAUDE_SESSION_PARSE_LIMITS.FIRST_MESSAGE_PREVIEW_LENGTH
			),
			messageCount: estimatedMessageCount,
			sizeBytes: stats.size,
			costUsd,
			inputTokens: totalInputTokens,
			outputTokens: totalOutputTokens,
			cacheReadTokens: totalCacheReadTokens,
			cacheCreationTokens: totalCacheCreationTokens,
			durationSeconds,
		};
	} catch (error) {
		logger.error(
			`Error parsing partial session content for session: ${sessionId}`,
			LOG_CONTEXT,
			error
		);
		return null;
	}
}

/**
 * Create a lightweight AgentSessionInfo from preview data.
 * Token counts and cost are set to 0 — they are loaded on demand
 * when the user clicks into the session detail view.
 */
function parseLightweightPreview(
	preview: {
		firstMessage: string;
		firstTimestamp: string;
		lastTimestamp: string;
		totalLines: number;
	},
	sessionId: string,
	projectPath: string,
	stats: { size: number; mtimeMs: number }
): AgentSessionInfo {
	const timestamp = preview.firstTimestamp || new Date(stats.mtimeMs).toISOString();
	const lastTimestamp = preview.lastTimestamp || timestamp;

	const startTime = new Date(timestamp).getTime();
	const endTime = new Date(lastTimestamp).getTime();
	const durationSeconds = Math.max(0, Math.floor((endTime - startTime) / 1000));

	// Estimate message count from total lines (same approximation as parsePartialSessionContent)
	const estimatedMessageCount = Math.max(1, Math.floor(preview.totalLines * 0.4));

	return {
		sessionId,
		projectPath,
		timestamp,
		modifiedAt: new Date(stats.mtimeMs).toISOString(),
		firstMessage: preview.firstMessage.slice(
			0,
			CLAUDE_SESSION_PARSE_LIMITS.FIRST_MESSAGE_PREVIEW_LENGTH
		),
		messageCount: estimatedMessageCount,
		sizeBytes: stats.size,
		costUsd: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheCreationTokens: 0,
		durationSeconds,
	};
}

/**
 * Parse a session file and extract metadata (remote via SSH)
 * Uses partial reading for large files to avoid buffer overflow
 */
async function parseSessionFileRemote(
	filePath: string,
	sessionId: string,
	projectPath: string,
	stats: { size: number; mtimeMs: number },
	sshConfig: SshRemoteConfig
): Promise<AgentSessionInfo | null> {
	try {
		// For large files (> 5MB), use partial reading to avoid buffer overflow
		const LARGE_FILE_THRESHOLD = 5 * 1024 * 1024;

		if (stats.size > LARGE_FILE_THRESHOLD) {
			logger.debug(
				`Using partial read for large session file: ${filePath} (${stats.size} bytes)`,
				LOG_CONTEXT
			);
			const result = await readFileRemotePartial(filePath, sshConfig, 100, 50);
			if (!result.success || !result.data) {
				logger.error(
					`Failed to read remote session file (partial): ${filePath} - ${result.error}`,
					LOG_CONTEXT
				);
				return null;
			}
			return parsePartialSessionContent(
				result.data.head,
				result.data.tail,
				result.data.totalLines,
				sessionId,
				projectPath,
				stats
			);
		}

		// For smaller files, read the entire content
		const result = await readFileRemote(filePath, sshConfig);
		if (!result.success || !result.data) {
			logger.error(
				`Failed to read remote session file: ${filePath} - ${result.error}`,
				LOG_CONTEXT
			);
			return null;
		}
		return parseSessionContent(result.data, sessionId, projectPath, stats);
	} catch (error) {
		logger.error(`Error reading remote session file: ${filePath}`, LOG_CONTEXT, error);
		captureException(error, { operation: 'claudeStorage:readRemoteSessionFile', filePath });
		return null;
	}
}

/**
 * Known subagent types in Claude Code
 */
const KNOWN_SUBAGENT_TYPES = [
	'Explore',
	'Plan',
	'general-purpose',
	'Bash',
	'statusline-setup',
	'Claude Code Guide',
];

/**
 * Extract the subagent type from transcript content.
 * Looks for subagent_type or agentType fields in the first few lines,
 * or tries to infer from the system prompt content.
 */
function extractSubagentType(content: string): string {
	const lines = content.split('\n').slice(0, 20);

	for (const line of lines) {
		if (!line.trim()) continue;
		try {
			const entry = JSON.parse(line);

			// Check for explicit subagent_type field
			if (entry.subagent_type) {
				return entry.subagent_type;
			}

			// Check for agentType in system entries
			if (entry.type === 'system' && entry.agentType) {
				return entry.agentType;
			}

			// Check for Task tool invocation that names the subagent
			if (entry.type === 'user' && entry.message?.content) {
				const contentStr =
					typeof entry.message.content === 'string'
						? entry.message.content
						: JSON.stringify(entry.message.content);

				// Look for known subagent type mentions
				for (const knownType of KNOWN_SUBAGENT_TYPES) {
					if (contentStr.toLowerCase().includes(knownType.toLowerCase())) {
						return knownType;
					}
				}
			}
		} catch {
			// Skip malformed lines
		}
	}

	return 'unknown';
}

/**
 * Parse subagent transcript content and extract metadata.
 * Uses the same parsing logic as main sessions but extracts subagent-specific info.
 */
function parseSubagentContent(
	content: string,
	agentId: string,
	parentSessionId: string,
	filePath: string,
	stats: { size: number; mtimeMs: number }
): SubagentInfo | null {
	try {
		const lines = content.split('\n').filter((l) => l.trim());

		if (lines.length === 0) {
			return null;
		}

		// Extract subagent type
		const agentType = extractSubagentType(content);

		let firstUserMessage = '';
		let firstAssistantMessage = '';
		let timestamp = new Date(stats.mtimeMs).toISOString();

		// Count messages using regex (fast)
		const userMessageCount = (content.match(/"type"\s*:\s*"user"/g) || []).length;
		const assistantMessageCount = (content.match(/"type"\s*:\s*"assistant"/g) || []).length;
		const messageCount = userMessageCount + assistantMessageCount;

		// Extract first meaningful message content
		for (
			let i = 0;
			i < Math.min(lines.length, CLAUDE_SESSION_PARSE_LIMITS.FIRST_MESSAGE_SCAN_LINES);
			i++
		) {
			try {
				const entry = JSON.parse(lines[i]);

				if (!firstUserMessage && entry.type === 'user' && entry.message?.content) {
					const textContent = extractTextFromContent(entry.message.content);
					if (textContent.trim()) {
						firstUserMessage = textContent;
						timestamp = entry.timestamp || timestamp;
					}
				}

				if (!firstAssistantMessage && entry.type === 'assistant' && entry.message?.content) {
					const textContent = extractTextFromContent(entry.message.content);
					if (textContent.trim()) {
						firstAssistantMessage = textContent;
						break;
					}
				}
			} catch {
				// Skip malformed lines
			}
		}

		const previewMessage = firstAssistantMessage || firstUserMessage;

		// Extract token counts using regex (fast)
		// IMPORTANT: Use negative lookbehind to avoid double-counting cache tokens
		// e.g., "cache_read_input_tokens" should NOT match the "input_tokens" regex
		let totalInputTokens = 0;
		let totalOutputTokens = 0;
		let totalCacheReadTokens = 0;
		let totalCacheCreationTokens = 0;

		// Match "input_tokens" but NOT "cache_read_input_tokens" or "cache_creation_input_tokens"
		const inputMatches = content.matchAll(
			/(?<!cache_read_|cache_creation_)"input_tokens"\s*:\s*(\d+)/g
		);
		for (const m of inputMatches) totalInputTokens += parseInt(m[1], 10);

		const outputMatches = content.matchAll(/"output_tokens"\s*:\s*(\d+)/g);
		for (const m of outputMatches) totalOutputTokens += parseInt(m[1], 10);

		const cacheReadMatches = content.matchAll(/"cache_read_input_tokens"\s*:\s*(\d+)/g);
		for (const m of cacheReadMatches) totalCacheReadTokens += parseInt(m[1], 10);

		const cacheCreationMatches = content.matchAll(/"cache_creation_input_tokens"\s*:\s*(\d+)/g);
		for (const m of cacheCreationMatches) totalCacheCreationTokens += parseInt(m[1], 10);

		const costUsd = calculateClaudeCost(
			totalInputTokens,
			totalOutputTokens,
			totalCacheReadTokens,
			totalCacheCreationTokens
		);

		// Extract last timestamp for duration
		let lastTimestamp = timestamp;
		for (
			let i = lines.length - 1;
			i >= Math.max(0, lines.length - CLAUDE_SESSION_PARSE_LIMITS.LAST_TIMESTAMP_SCAN_LINES);
			i--
		) {
			try {
				const entry = JSON.parse(lines[i]);
				if (entry.timestamp) {
					lastTimestamp = entry.timestamp;
					break;
				}
			} catch {
				// Skip malformed lines
			}
		}

		const startTime = new Date(timestamp).getTime();
		const endTime = new Date(lastTimestamp).getTime();
		const durationSeconds = Math.max(0, Math.floor((endTime - startTime) / 1000));

		return {
			agentId,
			agentType,
			parentSessionId,
			filePath,
			timestamp,
			modifiedAt: new Date(stats.mtimeMs).toISOString(),
			messageCount,
			sizeBytes: stats.size,
			inputTokens: totalInputTokens,
			outputTokens: totalOutputTokens,
			cacheReadTokens: totalCacheReadTokens,
			cacheCreationTokens: totalCacheCreationTokens,
			costUsd,
			firstMessage: previewMessage.slice(
				0,
				CLAUDE_SESSION_PARSE_LIMITS.FIRST_MESSAGE_PREVIEW_LENGTH
			),
			durationSeconds,
		};
	} catch (error) {
		logger.error(`Error parsing subagent content for agentId: ${agentId}`, LOG_CONTEXT, error);
		return null;
	}
}

/**
 * Claude Code Session Storage Implementation
 *
 * Provides access to Claude Code's local session storage at ~/.claude/projects/
 * Supports both local filesystem access and remote access via SSH.
 */
export class ClaudeSessionStorage extends BaseSessionStorage {
	readonly agentId: ToolType = 'claude-code';

	private originsStore: Store<ClaudeSessionOriginsData>;

	constructor(originsStore?: Store<ClaudeSessionOriginsData>) {
		super();
		// Use provided store or create a new one
		this.originsStore =
			originsStore ||
			new Store<ClaudeSessionOriginsData>({
				name: 'claude-session-origins',
				defaults: { origins: {} },
			});
	}

	/**
	 * Get the Claude projects directory path (local)
	 */
	private getProjectsDir(): string {
		return path.join(os.homedir(), '.claude', 'projects');
	}

	/**
	 * Get the Claude projects directory path (remote via SSH)
	 * Uses ~ which expands via escapeRemotePath in remote-fs.ts
	 */
	private getRemoteProjectsDir(): string {
		return '~/.claude/projects';
	}

	/**
	 * Get the encoded project directory path (local)
	 */
	private getEncodedProjectDir(projectPath: string): string {
		const encodedPath = encodeClaudeProjectPath(projectPath);
		return path.join(this.getProjectsDir(), encodedPath);
	}

	/**
	 * Get the encoded project directory path (remote)
	 * Uses POSIX-style paths for remote Linux hosts
	 */
	private getRemoteEncodedProjectDir(projectPath: string): string {
		const encodedPath = encodeClaudeProjectPath(projectPath);
		return `${this.getRemoteProjectsDir()}/${encodedPath}`;
	}

	/**
	 * Get the subagents folder path for a specific session (local)
	 * Claude Code stores subagents in: <encoded-project>/<session-id>/subagents/
	 */
	private getSubagentsFolderPath(projectPath: string, sessionId: string): string {
		const encodedPath = encodeClaudeProjectPath(projectPath);
		return path.join(this.getProjectsDir(), encodedPath, sessionId, 'subagents');
	}

	/**
	 * Get the subagents folder path for a specific session (remote via SSH)
	 * Claude Code stores subagents in: <encoded-project>/<session-id>/subagents/
	 */
	private getRemoteSubagentsFolderPath(projectPath: string, sessionId: string): string {
		const encodedPath = encodeClaudeProjectPath(projectPath);
		return `${this.getRemoteProjectsDir()}/${encodedPath}/${sessionId}/subagents`;
	}

	/**
	 * Get origin info for sessions in a project
	 */
	private getProjectOrigins(projectPath: string): Record<string, StoredOriginData> {
		const origins = this.originsStore.get('origins', {});
		return origins[projectPath] || {};
	}

	/**
	 * Attach origin info to session metadata
	 */
	private attachOriginInfo(
		session: AgentSessionInfo,
		projectOrigins: Record<string, StoredOriginData>
	): AgentSessionInfo {
		const originData = projectOrigins[session.sessionId];
		const origin = typeof originData === 'string' ? originData : originData?.origin;
		const sessionName = typeof originData === 'object' ? originData?.sessionName : undefined;
		const starred = typeof originData === 'object' ? originData?.starred : undefined;
		return {
			...session,
			origin: origin as AgentSessionOrigin | undefined,
			sessionName,
			starred,
		};
	}

	async listSessions(
		projectPath: string,
		sshConfig?: SshRemoteConfig
	): Promise<AgentSessionInfo[]> {
		// Use SSH remote access if config provided
		if (sshConfig) {
			return this.listSessionsRemote(projectPath, sshConfig);
		}

		const projectDir = this.getEncodedProjectDir(projectPath);

		// Check if the directory exists
		try {
			await fs.access(projectDir);
		} catch {
			logger.info(`No Claude sessions directory found for project: ${projectPath}`, LOG_CONTEXT);
			return [];
		}

		// List all .jsonl files in the directory
		const files = await fs.readdir(projectDir);
		const sessionFiles = files.filter((f) => f.endsWith('.jsonl'));

		// Get metadata for each session
		const sessions = await Promise.all(
			sessionFiles.map(async (filename) => {
				const sessionId = filename.replace('.jsonl', '');
				const filePath = path.join(projectDir, filename);

				try {
					const stats = await fs.stat(filePath);
					return await parseSessionFile(filePath, sessionId, projectPath, {
						size: stats.size,
						mtimeMs: stats.mtimeMs,
					});
				} catch (error) {
					logger.error(`Error processing session file: ${filename}`, LOG_CONTEXT, error);
					captureException(error, { operation: 'claudeStorage:processSessionFile', filename });
					return null;
				}
			})
		);

		// Filter out nulls, 0-byte sessions, and sort by modified date
		const validSessions = sessions
			.filter((s): s is NonNullable<typeof s> => s !== null)
			// Filter out 0-byte sessions (created but abandoned before any content was written)
			.filter((s) => s.sizeBytes > 0)
			.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());

		// Attach origin info
		const projectOrigins = this.getProjectOrigins(projectPath);
		const sessionsWithOrigins = validSessions.map((session) =>
			this.attachOriginInfo(session, projectOrigins)
		);

		logger.info(
			`Found ${validSessions.length} Claude sessions for project: ${projectPath}`,
			LOG_CONTEXT
		);
		return sessionsWithOrigins;
	}

	/**
	 * List sessions from remote host via SSH
	 */
	private async listSessionsRemote(
		projectPath: string,
		sshConfig: SshRemoteConfig
	): Promise<AgentSessionInfo[]> {
		const projectDir = this.getRemoteEncodedProjectDir(projectPath);

		// List directory via SSH
		const dirResult = await readDirRemote(projectDir, sshConfig);
		if (!dirResult.success || !dirResult.data) {
			logger.info(
				`No Claude sessions directory found on remote for project: ${projectPath}`,
				LOG_CONTEXT
			);
			return [];
		}

		// Filter for .jsonl files
		const sessionFiles = dirResult.data.filter(
			(entry) => !entry.isDirectory && entry.name.endsWith('.jsonl')
		);

		// Get metadata for each session
		const sessions = await Promise.all(
			sessionFiles.map(async (entry) => {
				const sessionId = entry.name.replace('.jsonl', '');
				const filePath = `${projectDir}/${entry.name}`;

				try {
					// Get file stats via SSH
					const statResult = await statRemote(filePath, sshConfig);
					if (!statResult.success || !statResult.data) {
						logger.error(`Failed to stat remote file: ${filePath}`, LOG_CONTEXT);
						return null;
					}

					return await parseSessionFileRemote(
						filePath,
						sessionId,
						projectPath,
						{
							size: statResult.data.size,
							mtimeMs: statResult.data.mtime,
						},
						sshConfig
					);
				} catch (error) {
					logger.error(`Error processing remote session file: ${entry.name}`, LOG_CONTEXT, error);
					captureException(error, {
						operation: 'claudeStorage:processRemoteSessionFile',
						filename: entry.name,
					});
					return null;
				}
			})
		);

		// Filter out nulls, 0-byte sessions, and sort by modified date
		const validSessions = sessions
			.filter((s): s is NonNullable<typeof s> => s !== null)
			.filter((s) => s.sizeBytes > 0)
			.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());

		// Attach origin info (origins are stored locally, not on remote)
		const projectOrigins = this.getProjectOrigins(projectPath);
		const sessionsWithOrigins = validSessions.map((session) =>
			this.attachOriginInfo(session, projectOrigins)
		);

		logger.info(
			`Found ${validSessions.length} Claude sessions for project: ${projectPath} (remote via SSH)`,
			LOG_CONTEXT
		);
		return sessionsWithOrigins;
	}

	async listSessionsPaginated(
		projectPath: string,
		options?: SessionListOptions,
		sshConfig?: SshRemoteConfig
	): Promise<PaginatedSessionsResult> {
		// Use SSH remote access if config provided
		if (sshConfig) {
			return this.listSessionsPaginatedRemote(projectPath, options, sshConfig);
		}

		const { cursor, limit = 100 } = options || {};
		const projectDir = this.getEncodedProjectDir(projectPath);

		// Check if the directory exists
		try {
			await fs.access(projectDir);
		} catch {
			return { sessions: [], hasMore: false, totalCount: 0, nextCursor: null };
		}

		// List all .jsonl files and get their stats
		const files = await fs.readdir(projectDir);
		const sessionFiles = files.filter((f) => f.endsWith('.jsonl'));

		const fileStats = await Promise.all(
			sessionFiles.map(async (filename) => {
				const sessionId = filename.replace('.jsonl', '');
				const filePath = path.join(projectDir, filename);
				try {
					const stats = await fs.stat(filePath);
					return {
						sessionId,
						filename,
						filePath,
						modifiedAt: stats.mtime.getTime(),
						sizeBytes: stats.size,
					};
				} catch {
					return null;
				}
			})
		);

		const sortedFiles = fileStats
			.filter((s): s is NonNullable<typeof s> => s !== null)
			// Filter out 0-byte sessions (created but abandoned before any content was written)
			.filter((s) => s.sizeBytes > 0)
			.sort((a, b) => b.modifiedAt - a.modifiedAt);

		const totalCount = sortedFiles.length;

		// Find cursor position
		let startIndex = 0;
		if (cursor) {
			const cursorIndex = sortedFiles.findIndex((f) => f.sessionId === cursor);
			startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
		}

		const pageFiles = sortedFiles.slice(startIndex, startIndex + limit);
		const hasMore = startIndex + limit < totalCount;
		const nextCursor = hasMore ? pageFiles[pageFiles.length - 1]?.sessionId : null;

		// Get project origins
		const projectOrigins = this.getProjectOrigins(projectPath);

		// Read full content for sessions in this page
		const sessions = await Promise.all(
			pageFiles.map(async (fileInfo) => {
				const session = await parseSessionFile(fileInfo.filePath, fileInfo.sessionId, projectPath, {
					size: fileInfo.sizeBytes,
					mtimeMs: fileInfo.modifiedAt,
				});
				if (session) {
					return this.attachOriginInfo(session, projectOrigins);
				}
				return null;
			})
		);

		const validSessions = sessions.filter((s): s is NonNullable<typeof s> => s !== null);

		// Compute aggregated stats for each session (includes subagent stats)
		const sessionsWithAggregatedStats = await Promise.all(
			validSessions.map(async (session) => {
				const subagentsDir = path.join(projectDir, session.sessionId, 'subagents');
				return computeAggregatedStats(session, subagentsDir, false);
			})
		);

		logger.info(
			`Paginated Claude sessions - returned ${sessionsWithAggregatedStats.length} of ${totalCount} total (cursor: ${cursor || 'null'}, startIndex: ${startIndex}, hasMore: ${hasMore}, nextCursor: ${nextCursor || 'null'})`,
			LOG_CONTEXT
		);

		return {
			sessions: sessionsWithAggregatedStats,
			hasMore,
			totalCount,
			nextCursor,
		};
	}

	/**
	 * List sessions with pagination from remote host via SSH.
	 * Unlike local listing, this scans ALL project folders on the remote host
	 * since users typically work on one remote machine across multiple directories.
	 *
	 * @param _projectPath - Not used for remote listing (scans all projects), kept for API consistency
	 */
	private async listSessionsPaginatedRemote(
		_projectPath: string,
		options: SessionListOptions | undefined,
		sshConfig: SshRemoteConfig
	): Promise<PaginatedSessionsResult> {
		const { cursor, limit = 100 } = options || {};
		const projectsDir = this.getRemoteProjectsDir();

		logger.info(
			`Listing ALL remote sessions from: ${projectsDir}, sshHost=${sshConfig.host}`,
			LOG_CONTEXT
		);

		// Batch-discover all session files in a single SSH command
		// Replaces individual readDirRemote + statRemote calls (was N+1 SSH commands)
		const discoveryResult = await batchDiscoverSessionFilesRemote(projectsDir, sshConfig);
		if (!discoveryResult.success || !discoveryResult.data) {
			logger.warn(
				`Failed to batch-discover remote sessions: ${projectsDir} - ${discoveryResult.error || 'unknown error'}`,
				LOG_CONTEXT
			);
			return { sessions: [], hasMore: false, totalCount: 0, nextCursor: null };
		}

		logger.info(
			`Batch-discovered ${discoveryResult.data.length} session files on remote`,
			LOG_CONTEXT
		);

		// Collect session files from all project directories
		interface RemoteFileInfo {
			sessionId: string;
			filename: string;
			filePath: string;
			projectDir: string;
			decodedProjectPath: string;
			modifiedAt: number;
			sizeBytes: number;
		}

		// Convert BatchDiscoveredFile[] to RemoteFileInfo[]
		const allFileStats: RemoteFileInfo[] = discoveryResult.data.map((file) => ({
			sessionId: file.filename.replace('.jsonl', ''),
			filename: file.filename,
			filePath: file.filePath,
			projectDir: file.projectDirName,
			decodedProjectPath: this.decodeProjectPath(file.projectDirName),
			modifiedAt: file.mtime,
			sizeBytes: file.size,
		}));

		// Sort all sessions by modification date (most recent first)
		const sortedFiles = allFileStats.sort((a, b) => b.modifiedAt - a.modifiedAt);

		const totalCount = sortedFiles.length;

		logger.info(
			`Found ${totalCount} total sessions across all remote project folders`,
			LOG_CONTEXT
		);

		// Find cursor position
		let startIndex = 0;
		if (cursor) {
			const cursorIndex = sortedFiles.findIndex((f) => f.sessionId === cursor);
			startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
		}

		const pageFiles = sortedFiles.slice(startIndex, startIndex + limit);
		const hasMore = startIndex + limit < totalCount;
		const nextCursor = hasMore ? pageFiles[pageFiles.length - 1]?.sessionId : null;

		// Lightweight batch extract: only pull preview text + timestamps (not full JSONL lines)
		// Token counts and cost are loaded on-demand when user clicks into session detail
		const batchPreviews = await batchExtractSessionPreviewsRemote(
			pageFiles.map((f) => f.filePath),
			sshConfig
		);

		// Pre-load ALL origins flattened by session ID for efficient lookup.
		// Session IDs are globally unique UUIDs — project path scoping is unnecessary
		// and the lossy decodeProjectPath would cause mismatches for paths with dashes/dots.
		const allOrigins = this.originsStore.get('origins', {});
		const flatOrigins: Record<string, StoredOriginData> = {};
		for (const sessions of Object.values(allOrigins)) {
			for (const [sessionId, data] of Object.entries(sessions)) {
				flatOrigins[sessionId] = data;
			}
		}

		const sessions = pageFiles.map((fileInfo) => {
			const preview = batchPreviews.data?.get(fileInfo.filePath);
			const session = parseLightweightPreview(
				preview || { firstMessage: '', firstTimestamp: '', lastTimestamp: '', totalLines: 0 },
				fileInfo.sessionId,
				fileInfo.decodedProjectPath,
				{ size: fileInfo.sizeBytes, mtimeMs: fileInfo.modifiedAt }
			);
			// Look up origin info directly by session ID from flat map
			const originData = flatOrigins[fileInfo.sessionId];
			if (originData) {
				const origin = typeof originData === 'string' ? originData : originData?.origin;
				const sessionName = typeof originData === 'object' ? originData?.sessionName : undefined;
				const starred = typeof originData === 'object' ? originData?.starred : undefined;
				return {
					...session,
					origin: origin as AgentSessionOrigin | undefined,
					sessionName,
					starred,
				};
			}
			return session;
		});

		const validSessions = sessions.filter((s): s is NonNullable<typeof s> => s !== null);

		// For remote sessions, skip eager subagent stats aggregation to avoid S×(1+A) SSH commands.
		// Stats will be computed lazily when the user expands a session (via getSubagentStats IPC).
		// Set aggregated fields to match the session's own stats (no subagent contribution yet).
		const sessionsWithAggregatedStats = validSessions.map((session) => ({
			...session,
			hasSubagents: undefined, // Unknown until expanded — will be resolved by useSubagentLoader
			subagentCount: undefined,
			aggregatedInputTokens: session.inputTokens,
			aggregatedOutputTokens: session.outputTokens,
			aggregatedCacheReadTokens: session.cacheReadTokens,
			aggregatedCacheCreationTokens: session.cacheCreationTokens,
			aggregatedCostUsd: session.costUsd,
			aggregatedMessageCount: session.messageCount,
		}));

		logger.info(
			`Paginated Claude sessions (remote) - returned ${sessionsWithAggregatedStats.length} of ${totalCount} total (cursor: ${cursor || 'null'}, startIndex: ${startIndex}, hasMore: ${hasMore}, nextCursor: ${nextCursor || 'null'})`,
			LOG_CONTEXT
		);

		return {
			sessions: sessionsWithAggregatedStats,
			hasMore,
			totalCount,
			nextCursor,
		};
	}

	/**
	 * Decode an encoded project directory name back to the original path.
	 * This is the reverse of encodeClaudeProjectPath.
	 * Note: This is a best-effort decode since the encoding is lossy
	 * (both / and . become -, so we can't distinguish them perfectly).
	 * We assume the most common case: leading dash means root path.
	 */
	private decodeProjectPath(encodedName: string): string {
		// If it starts with a dash, it's likely a root-relative path
		// e.g., "-app" -> "/app", "-home-maestro" -> "/home/maestro"
		if (encodedName.startsWith('-')) {
			// Replace dashes with slashes (best guess for path separators)
			return encodedName.replace(/-/g, '/');
		}
		// Otherwise treat the whole thing as a path with dashes as separators
		return '/' + encodedName.replace(/-/g, '/');
	}

	async readSessionMessages(
		projectPath: string,
		sessionId: string,
		options?: SessionReadOptions,
		sshConfig?: SshRemoteConfig
	): Promise<SessionMessagesResult> {
		if (sshConfig) {
			// Remote path: extract only the needed page of lines on the remote side
			const projectDir = this.getRemoteEncodedProjectDir(projectPath);
			const sessionFile = `${projectDir}/${sessionId}.jsonl`;
			const offset = options?.offset ?? 0;
			const limit = options?.limit ?? 20;

			const pageResult = await readSessionMessagesRemote(sessionFile, offset, limit, sshConfig);

			if (!pageResult.success || !pageResult.data) {
				logger.error(
					`Failed to read remote session messages: ${sessionFile} - ${pageResult.error}`,
					LOG_CONTEXT
				);
				return { messages: [], total: 0, hasMore: false };
			}

			const { lines: rawLines, totalLines, hasMore } = pageResult.data;

			// Parse only the extracted lines (not the entire file)
			const messages: SessionMessage[] = [];
			for (const line of rawLines) {
				try {
					const entry = JSON.parse(line);
					if (entry.type === 'user' || entry.type === 'assistant') {
						let msgContent = '';
						let toolUse = undefined;

						if (entry.message?.content) {
							if (typeof entry.message.content === 'string') {
								msgContent = entry.message.content;
							} else if (Array.isArray(entry.message.content)) {
								const textBlocks = entry.message.content.filter(
									(b: { type?: string }) => b.type === 'text'
								);
								const toolBlocks = entry.message.content.filter(
									(b: { type?: string }) => b.type === 'tool_use'
								);

								msgContent = textBlocks.map((b: { text?: string }) => b.text).join('\n');
								if (toolBlocks.length > 0) {
									toolUse = toolBlocks;
								}
							}
						}

						if (msgContent && msgContent.trim()) {
							messages.push({
								type: entry.type,
								role: entry.message?.role,
								content: msgContent,
								timestamp: entry.timestamp,
								uuid: entry.uuid,
								toolUse,
							});
						}
					}
				} catch {
					// Skip malformed lines
				}
			}

			return {
				messages,
				total: totalLines, // Approximate — total lines, not total messages
				hasMore,
			};
		}

		// Local path: read full file and paginate locally
		const projectDir = this.getEncodedProjectDir(projectPath);
		const sessionFile = path.join(projectDir, `${sessionId}.jsonl`);
		const content = await fs.readFile(sessionFile, 'utf-8');

		const lines = content.split('\n').filter((l) => l.trim());

		const messages: SessionMessage[] = [];

		for (const line of lines) {
			try {
				const entry = JSON.parse(line);
				if (entry.type === 'user' || entry.type === 'assistant') {
					let msgContent = '';
					let toolUse = undefined;

					if (entry.message?.content) {
						if (typeof entry.message.content === 'string') {
							msgContent = entry.message.content;
						} else if (Array.isArray(entry.message.content)) {
							const textBlocks = entry.message.content.filter(
								(b: { type?: string }) => b.type === 'text'
							);
							const toolBlocks = entry.message.content.filter(
								(b: { type?: string }) => b.type === 'tool_use'
							);

							msgContent = textBlocks.map((b: { text?: string }) => b.text).join('\n');
							if (toolBlocks.length > 0) {
								toolUse = toolBlocks;
							}
						}
					}

					if (msgContent && msgContent.trim()) {
						messages.push({
							type: entry.type,
							role: entry.message?.role,
							content: msgContent,
							timestamp: entry.timestamp,
							uuid: entry.uuid,
							toolUse,
						});
					}
				}
			} catch {
				// Skip malformed lines
			}
		}

		return BaseSessionStorage.applyMessagePagination(messages, options);
	}

	protected async getSearchableMessages(
		sessionId: string,
		projectPath: string,
		sshConfig?: SshRemoteConfig
	): Promise<SearchableMessage[]> {
		let content: string;

		try {
			if (sshConfig) {
				const projectDir = this.getRemoteEncodedProjectDir(projectPath);
				const sessionFile = `${projectDir}/${sessionId}.jsonl`;
				const result = await readFileRemote(sessionFile, sshConfig);
				if (!result.success || !result.data) return [];
				content = result.data;
			} else {
				const projectDir = this.getEncodedProjectDir(projectPath);
				const sessionFile = path.join(projectDir, `${sessionId}.jsonl`);
				content = await fs.readFile(sessionFile, 'utf-8');
			}
		} catch {
			return [];
		}

		const lines = content.split('\n').filter((l) => l.trim());
		const searchableMessages: SearchableMessage[] = [];

		for (const line of lines) {
			try {
				const entry = JSON.parse(line);
				if (entry.type === 'user' || entry.type === 'assistant') {
					const textContent = extractTextFromContent(entry.message?.content);
					if (textContent.trim()) {
						searchableMessages.push({
							role: entry.type as 'user' | 'assistant',
							textContent,
						});
					}
				}
			} catch {
				// Skip malformed lines
			}
		}

		return searchableMessages;
	}

	/**
	 * List all subagent transcripts for a given session.
	 * Scans the subagents/ folder within the project directory.
	 *
	 * @param projectPath - The project path (used to locate session storage)
	 * @param sessionId - The parent session ID (used for linking, not filtering)
	 * @param sshConfig - Optional SSH config for remote access
	 * @returns Array of SubagentInfo objects sorted by timestamp (newest first)
	 */
	async listSubagentsForSession(
		projectPath: string,
		sessionId: string,
		sshConfig?: SshRemoteConfig
	): Promise<SubagentInfo[]> {
		// Use SSH remote access if config provided
		if (sshConfig) {
			return this.listSubagentsForSessionRemote(projectPath, sessionId, sshConfig);
		}

		const subagentsDir = this.getSubagentsFolderPath(projectPath, sessionId);

		// Check if subagents folder exists
		try {
			await fs.access(subagentsDir);
		} catch {
			logger.debug(
				`No subagents folder found for session ${sessionId} in project: ${projectPath}`,
				LOG_CONTEXT
			);
			return [];
		}

		// List all agent-*.jsonl files
		const files = await fs.readdir(subagentsDir);
		const agentFiles = files.filter((f) => f.endsWith('.jsonl') && f.startsWith('agent-'));

		if (agentFiles.length === 0) {
			return [];
		}

		// Parse each subagent file
		const subagents = await Promise.all(
			agentFiles.map(async (filename) => {
				// Extract agentId from filename: agent-{agentId}.jsonl
				const agentId = filename.replace('agent-', '').replace('.jsonl', '');
				const filePath = path.join(subagentsDir, filename);

				try {
					const stats = await fs.stat(filePath);

					// Skip empty files
					if (stats.size === 0) {
						return null;
					}

					const content = await fs.readFile(filePath, 'utf-8');
					return parseSubagentContent(content, agentId, sessionId, filePath, {
						size: stats.size,
						mtimeMs: stats.mtimeMs,
					});
				} catch (error) {
					logger.error(`Error processing subagent file: ${filename}`, LOG_CONTEXT, error);
					return null;
				}
			})
		);

		// Filter out nulls and sort by timestamp (newest first)
		const validSubagents = subagents
			.filter((s): s is SubagentInfo => s !== null)
			.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());

		logger.info(
			`Found ${validSubagents.length} subagents for session in project: ${projectPath}`,
			LOG_CONTEXT
		);

		return validSubagents;
	}

	/**
	 * List subagents for a session from remote host via SSH.
	 */
	private async listSubagentsForSessionRemote(
		projectPath: string,
		sessionId: string,
		sshConfig: SshRemoteConfig
	): Promise<SubagentInfo[]> {
		const subagentsDir = this.getRemoteSubagentsFolderPath(projectPath, sessionId);

		// Check if subagents folder exists on remote
		const dirResult = await readDirRemote(subagentsDir, sshConfig);
		if (!dirResult.success || !dirResult.data) {
			logger.debug(
				`No subagents folder found on remote for session ${sessionId} in project: ${projectPath}`,
				LOG_CONTEXT
			);
			return [];
		}

		// Filter for agent-*.jsonl files
		const agentFiles = dirResult.data.filter(
			(entry) =>
				!entry.isDirectory && entry.name.endsWith('.jsonl') && entry.name.startsWith('agent-')
		);

		if (agentFiles.length === 0) {
			return [];
		}

		// Parse each subagent file (concurrency-limited to prevent SSH MaxSessions overflow)
		const maxSessions = sshConfig.maxSessions ?? 10;
		const fileLimit = pLimit(Math.max(1, maxSessions - 2));
		const subagents = await Promise.all(
			agentFiles.map((entry) =>
				fileLimit(async () => {
					const agentId = entry.name.replace('agent-', '').replace('.jsonl', '');
					const filePath = `${subagentsDir}/${entry.name}`;

					try {
						// Get file stats
						const statResult = await statRemote(filePath, sshConfig);
						if (!statResult.success || !statResult.data) {
							logger.error(`Failed to stat remote subagent file: ${filePath}`, LOG_CONTEXT);
							return null;
						}

						// Skip empty files
						if (statResult.data.size === 0) {
							return null;
						}

						// Read file content (use partial for large files)
						const LARGE_FILE_THRESHOLD = 5 * 1024 * 1024;
						let content: string;

						if (statResult.data.size > LARGE_FILE_THRESHOLD) {
							// For large files, use partial reading
							const partialResult = await readFileRemotePartial(filePath, sshConfig, 100, 50);
							if (!partialResult.success || !partialResult.data) {
								return null;
							}
							content = partialResult.data.head + '\n' + partialResult.data.tail;
						} else {
							const readResult = await readFileRemote(filePath, sshConfig);
							if (!readResult.success || !readResult.data) {
								return null;
							}
							content = readResult.data;
						}

						return parseSubagentContent(content, agentId, sessionId, filePath, {
							size: statResult.data.size,
							mtimeMs: statResult.data.mtime,
						});
					} catch (error) {
						logger.error(
							`Error processing remote subagent file: ${entry.name}`,
							LOG_CONTEXT,
							error
						);
						return null;
					}
				})
			)
		);

		// Filter out nulls and sort by timestamp (newest first)
		const validSubagents = subagents
			.filter((s): s is SubagentInfo => s !== null)
			.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());

		logger.info(
			`Found ${validSubagents.length} subagents for session on remote: ${projectPath}`,
			LOG_CONTEXT
		);

		return validSubagents;
	}

	/**
	 * Read messages from a subagent transcript file.
	 * Supports pagination for lazy loading.
	 *
	 * @param projectPath - The project path
	 * @param agentId - The subagent ID (from filename)
	 * @param options - Pagination options (offset, limit)
	 * @param sshConfig - Optional SSH config for remote access
	 * @returns Paginated messages result
	 */
	async getSubagentMessages(
		projectPath: string,
		sessionId: string,
		agentId: string,
		options?: SessionReadOptions,
		sshConfig?: SshRemoteConfig
	): Promise<SessionMessagesResult> {
		const subagentsDir = sshConfig
			? this.getRemoteSubagentsFolderPath(projectPath, sessionId)
			: this.getSubagentsFolderPath(projectPath, sessionId);

		const filePath = sshConfig
			? `${subagentsDir}/agent-${agentId}.jsonl`
			: path.join(subagentsDir, `agent-${agentId}.jsonl`);

		// Get content either locally or via SSH
		let content: string;

		if (sshConfig) {
			const result = await readFileRemote(filePath, sshConfig);
			if (!result.success || !result.data) {
				logger.error(
					`Failed to read remote subagent messages: ${filePath} - ${result.error}`,
					LOG_CONTEXT
				);
				return { messages: [], total: 0, hasMore: false };
			}
			content = result.data;
		} else {
			try {
				content = await fs.readFile(filePath, 'utf-8');
			} catch (error) {
				logger.error(`Failed to read subagent file: ${filePath}`, LOG_CONTEXT, error);
				return { messages: [], total: 0, hasMore: false };
			}
		}

		const lines = content.split('\n').filter((l) => l.trim());
		const messages: SessionMessage[] = [];

		for (const line of lines) {
			try {
				const entry = JSON.parse(line);
				if (entry.type === 'user' || entry.type === 'assistant') {
					let msgContent = '';
					let toolUse = undefined;

					if (entry.message?.content) {
						if (typeof entry.message.content === 'string') {
							msgContent = entry.message.content;
						} else if (Array.isArray(entry.message.content)) {
							const textBlocks = entry.message.content.filter(
								(b: { type?: string }) => b.type === 'text'
							);
							const toolBlocks = entry.message.content.filter(
								(b: { type?: string }) => b.type === 'tool_use'
							);

							msgContent = textBlocks.map((b: { text?: string }) => b.text).join('\n');
							if (toolBlocks.length > 0) {
								toolUse = toolBlocks;
							}
						}
					}

					if (msgContent && msgContent.trim()) {
						messages.push({
							type: entry.type,
							role: entry.message?.role,
							content: msgContent,
							timestamp: entry.timestamp,
							uuid: entry.uuid,
							toolUse,
						});
					}
				}
			} catch {
				// Skip malformed lines
			}
		}

		// Apply offset and limit for lazy loading
		const offset = options?.offset ?? 0;
		const limit = options?.limit ?? 20;

		const startIndex = Math.max(0, messages.length - offset - limit);
		const endIndex = messages.length - offset;
		const slice = messages.slice(startIndex, endIndex);

		return {
			messages: slice,
			total: messages.length,
			hasMore: startIndex > 0,
		};
	}

	getSessionPath(
		projectPath: string,
		sessionId: string,
		sshConfig?: SshRemoteConfig
	): string | null {
		if (sshConfig) {
			const projectDir = this.getRemoteEncodedProjectDir(projectPath);
			return `${projectDir}/${sessionId}.jsonl`;
		}
		const projectDir = this.getEncodedProjectDir(projectPath);
		return path.join(projectDir, `${sessionId}.jsonl`);
	}

	async deleteMessagePair(
		projectPath: string,
		sessionId: string,
		userMessageUuid: string,
		fallbackContent?: string,
		sshConfig?: SshRemoteConfig
	): Promise<{ success: boolean; error?: string; linesRemoved?: number }> {
		// Note: Delete operations on remote sessions are not supported yet
		// This would require implementing writeFileRemote
		if (sshConfig) {
			logger.warn('Delete message pair not supported for SSH remote sessions', LOG_CONTEXT);
			return { success: false, error: 'Delete not supported for remote sessions' };
		}

		const projectDir = this.getEncodedProjectDir(projectPath);
		const sessionFile = path.join(projectDir, `${sessionId}.jsonl`);

		try {
			const content = await fs.readFile(sessionFile, 'utf-8');
			const lines = content.split('\n').filter((l) => l.trim());

			const parsedLines: Array<{ line: string; entry: unknown }> = [];
			let userMessageIndex = -1;

			for (let i = 0; i < lines.length; i++) {
				try {
					const entry = JSON.parse(lines[i]);
					parsedLines.push({ line: lines[i], entry });

					if (entry.uuid === userMessageUuid && entry.type === 'user') {
						userMessageIndex = parsedLines.length - 1;
					}
				} catch {
					parsedLines.push({ line: lines[i], entry: null });
				}
			}

			// If UUID match failed, try content match
			if (userMessageIndex === -1 && fallbackContent) {
				const normalizedFallback = fallbackContent.trim();

				for (let i = parsedLines.length - 1; i >= 0; i--) {
					const entry = parsedLines[i].entry as {
						type?: string;
						message?: { content?: unknown };
					} | null;
					if (entry?.type === 'user') {
						let messageText = '';
						if (entry.message?.content) {
							if (typeof entry.message.content === 'string') {
								messageText = entry.message.content;
							} else if (Array.isArray(entry.message.content)) {
								const textBlocks = (
									entry.message.content as Array<{ type?: string; text?: string }>
								).filter((b) => b.type === 'text');
								messageText = textBlocks.map((b) => b.text).join('\n');
							}
						}

						if (messageText.trim() === normalizedFallback) {
							userMessageIndex = i;
							logger.info('Found message by content match', LOG_CONTEXT, { sessionId, index: i });
							break;
						}
					}
				}
			}

			if (userMessageIndex === -1) {
				logger.warn('User message not found for deletion', LOG_CONTEXT, {
					sessionId,
					userMessageUuid,
					hasFallback: !!fallbackContent,
				});
				return { success: false, error: 'User message not found' };
			}

			// Find the end of the response and collect tool_use IDs being deleted
			let endIndex = parsedLines.length;
			const deletedToolUseIds = new Set<string>();

			for (let i = userMessageIndex + 1; i < parsedLines.length; i++) {
				const entry = parsedLines[i].entry as {
					type?: string;
					message?: { content?: unknown };
				} | null;

				if (entry?.type === 'user') {
					endIndex = i;
					break;
				}

				// Collect tool_use IDs from assistant messages being deleted
				if (entry?.type === 'assistant' && entry.message?.content) {
					const content = entry.message.content;
					if (Array.isArray(content)) {
						for (const block of content as Array<{ type?: string; id?: string }>) {
							if (block.type === 'tool_use' && block.id) {
								deletedToolUseIds.add(block.id);
							}
						}
					}
				}
			}

			// Remove the message pair
			let linesToKeep = [...parsedLines.slice(0, userMessageIndex), ...parsedLines.slice(endIndex)];

			// If we deleted any tool_use blocks, clean up orphaned tool_result blocks
			if (deletedToolUseIds.size > 0) {
				linesToKeep = linesToKeep
					.map((item) => {
						const entry = item.entry as {
							type?: string;
							message?: { content?: unknown };
						} | null;

						// Only process user messages (tool_result blocks are in user messages)
						if (entry?.type !== 'user' || !entry.message?.content) {
							return item;
						}

						const content = entry.message.content;
						if (!Array.isArray(content)) {
							return item;
						}

						// Filter out tool_result blocks that reference deleted tool_use IDs
						const filteredContent = (
							content as Array<{ type?: string; tool_use_id?: string }>
						).filter((block) => {
							if (block.type === 'tool_result' && block.tool_use_id) {
								return !deletedToolUseIds.has(block.tool_use_id);
							}
							return true;
						});

						// If we removed all content blocks, mark this line for removal
						if (filteredContent.length === 0) {
							return { line: '', entry: null, remove: true };
						}

						// If content changed, update the line
						if (filteredContent.length !== content.length) {
							const updatedEntry = {
								...entry,
								message: {
									...entry.message,
									content: filteredContent,
								},
							};
							return { line: JSON.stringify(updatedEntry), entry: updatedEntry };
						}

						return item;
					})
					.filter((item) => !(item as { remove?: boolean }).remove);

				logger.info(`Cleaned up orphaned tool_result blocks`, LOG_CONTEXT, {
					sessionId,
					deletedToolUseIds: Array.from(deletedToolUseIds),
				});
			}

			const newContent = linesToKeep.map((p) => p.line).join('\n') + '\n';
			await fs.writeFile(sessionFile, newContent, 'utf-8');

			logger.info(`Deleted message pair from Claude session`, LOG_CONTEXT, {
				sessionId,
				userMessageUuid,
				linesRemoved: endIndex - userMessageIndex,
			});

			return { success: true, linesRemoved: endIndex - userMessageIndex };
		} catch (error) {
			logger.error(`Error deleting message pair: ${sessionId}`, LOG_CONTEXT, error);
			captureException(error, { operation: 'claudeStorage:deleteMessagePair', sessionId });
			return { success: false, error: String(error) };
		}
	}

	// ============ Origin Management Methods ============
	// These are additional methods specific to Claude session management

	/**
	 * Register the origin of a session (user or auto)
	 */
	registerSessionOrigin(
		projectPath: string,
		agentSessionId: string,
		origin: AgentSessionOrigin,
		sessionName?: string
	): void {
		const origins = this.originsStore.get('origins', {});
		if (!origins[projectPath]) {
			origins[projectPath] = {};
		}
		origins[projectPath][agentSessionId] = sessionName ? { origin, sessionName } : origin;
		this.originsStore.set('origins', origins);
		logger.debug(
			`Registered Claude session origin: ${agentSessionId} = ${origin}${sessionName ? ` (name: ${sessionName})` : ''}`,
			LOG_CONTEXT
		);
	}

	/**
	 * Update the name of a session
	 */
	updateSessionName(projectPath: string, agentSessionId: string, sessionName: string): void {
		const origins = this.originsStore.get('origins', {});
		if (!origins[projectPath]) {
			origins[projectPath] = {};
		}
		const existing = origins[projectPath][agentSessionId];
		if (typeof existing === 'string') {
			origins[projectPath][agentSessionId] = { origin: existing, sessionName };
		} else if (existing) {
			origins[projectPath][agentSessionId] = { ...existing, sessionName };
		} else {
			origins[projectPath][agentSessionId] = { origin: 'user', sessionName };
		}
		this.originsStore.set('origins', origins);
		logger.debug(`Updated Claude session name: ${agentSessionId} = ${sessionName}`, LOG_CONTEXT);
	}

	/**
	 * Update the starred status of a session
	 */
	updateSessionStarred(projectPath: string, agentSessionId: string, starred: boolean): void {
		const origins = this.originsStore.get('origins', {});
		if (!origins[projectPath]) {
			origins[projectPath] = {};
		}
		const existing = origins[projectPath][agentSessionId];
		if (typeof existing === 'string') {
			origins[projectPath][agentSessionId] = { origin: existing, starred };
		} else if (existing) {
			origins[projectPath][agentSessionId] = { ...existing, starred };
		} else {
			origins[projectPath][agentSessionId] = { origin: 'user', starred };
		}
		this.originsStore.set('origins', origins);
		logger.debug(`Updated Claude session starred: ${agentSessionId} = ${starred}`, LOG_CONTEXT);
	}

	/**
	 * Update the context usage percentage of a session
	 * This persists the last known context window usage so it can be restored on resume
	 */
	updateSessionContextUsage(
		projectPath: string,
		agentSessionId: string,
		contextUsage: number
	): void {
		const origins = this.originsStore.get('origins', {});
		if (!origins[projectPath]) {
			origins[projectPath] = {};
		}
		const existing = origins[projectPath][agentSessionId];
		if (typeof existing === 'string') {
			origins[projectPath][agentSessionId] = { origin: existing, contextUsage };
		} else if (existing) {
			origins[projectPath][agentSessionId] = { ...existing, contextUsage };
		} else {
			origins[projectPath][agentSessionId] = { origin: 'user', contextUsage };
		}
		this.originsStore.set('origins', origins);
		// Don't log this - it updates frequently and would spam logs
	}

	/**
	 * Get all origin info for a project
	 */
	getSessionOrigins(projectPath: string): Record<string, SessionOriginInfo> {
		const origins = this.originsStore.get('origins', {});
		const projectOrigins = origins[projectPath] || {};

		// Normalize to SessionOriginInfo format
		const result: Record<string, SessionOriginInfo> = {};
		for (const [sessionId, data] of Object.entries(projectOrigins)) {
			if (typeof data === 'string') {
				result[sessionId] = { origin: data };
			} else {
				result[sessionId] = {
					origin: data.origin,
					sessionName: data.sessionName,
					starred: data.starred,
					contextUsage: data.contextUsage,
				};
			}
		}
		return result;
	}

	/**
	 * Get all named sessions across all projects
	 */
	async getAllNamedSessions(): Promise<
		Array<{
			agentSessionId: string;
			projectPath: string;
			sessionName: string;
			starred?: boolean;
			lastActivityAt?: number;
		}>
	> {
		const allOrigins = this.originsStore.get('origins', {});
		const namedSessions: Array<{
			agentSessionId: string;
			projectPath: string;
			sessionName: string;
			starred?: boolean;
			lastActivityAt?: number;
		}> = [];

		for (const [projectPath, sessions] of Object.entries(allOrigins)) {
			for (const [agentSessionId, info] of Object.entries(sessions)) {
				if (typeof info === 'object' && info.sessionName) {
					let lastActivityAt: number | undefined;
					try {
						const sessionFile = this.getSessionPath(projectPath, agentSessionId);
						if (sessionFile) {
							const stats = await fs.stat(sessionFile);
							lastActivityAt = stats.mtime.getTime();
						} else {
							// No session file path found, skip this stale entry
							continue;
						}
					} catch {
						// Session file doesn't exist or is inaccessible, skip stale entry
						continue;
					}

					namedSessions.push({
						agentSessionId,
						projectPath,
						sessionName: info.sessionName,
						starred: info.starred,
						lastActivityAt,
					});
				}
			}
		}

		return namedSessions;
	}
}
