/**
 * Agent Sessions IPC Handlers
 *
 * This module provides generic IPC handlers for agent session management
 * that work with any agent supporting the AgentSessionStorage interface.
 *
 * This is the preferred API for new code. The window.maestro.claude.* API
 * remains for backwards compatibility but logs deprecation warnings.
 *
 * Usage:
 * - window.maestro.agentSessions.list(agentId, projectPath)
 * - window.maestro.agentSessions.read(agentId, projectPath, sessionId)
 * - window.maestro.agentSessions.search(agentId, projectPath, query, mode)
 * - window.maestro.agentSessions.getGlobalStats() - aggregates from all providers
 */

import { ipcMain, BrowserWindow } from 'electron';
import Store from 'electron-store';
import { logger } from '../../utils/logger';
import { withIpcErrorLogging } from '../../utils/ipcHandler';
import { getSessionStorage, hasSessionStorage, getAllSessionStorages } from '../../agents';
import { getStatsDB } from '../../stats';
import type {
	AgentSessionInfo,
	PaginatedSessionsResult,
	SessionMessagesResult,
	SessionSearchResult,
	SessionSearchMode,
	SessionListOptions,
	SessionReadOptions,
} from '../../agents';
import type { GlobalAgentStats, ProviderStats, SshRemoteConfig } from '../../../shared/types';
import type { MaestroSettings } from './persistence';

// Imports for local message counting (Task 17.4)
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
// Import for remote message counting (Task 17.5)
import {
	countRemoteClaudeMessages as countRemoteClaudeMessagesViaShell,
	readDirRemote,
} from '../../utils/remote-fs';

// DEPRECATED: The following imports were used by the file-based stats scanning code.
// They are kept here commented out alongside the deprecated code below for potential future use.
// import { calculateClaudeCost } from '../../utils/pricing';
// import {
// 	loadGlobalStatsCache,
// 	saveGlobalStatsCache,
// 	GlobalStatsCache,
// 	CachedSessionStats,
// 	GLOBAL_STATS_CACHE_VERSION,
// } from '../../utils/statsCache';
// import {
//   statRemote,
//   parseRemoteClaudeStatsViaShell,
// } from '../../utils/remote-fs';

// Re-export for backwards compatibility
export type { GlobalAgentStats, ProviderStats };

const LOG_CONTEXT = '[AgentSessions]';

/**
 * Generic agent session origins data structure
 * Structure: { [agentId]: { [projectPath]: { [sessionId]: { origin, sessionName, starred } } } }
 */
export interface AgentSessionOriginsData {
	origins: Record<
		string,
		Record<
			string,
			Record<string, { origin?: 'user' | 'auto'; sessionName?: string; starred?: boolean }>
		>
	>;
}

/**
 * Dependencies required for agent sessions handlers
 */
export interface AgentSessionsHandlerDependencies {
	getMainWindow: () => BrowserWindow | null;
	agentSessionOriginsStore?: Store<AgentSessionOriginsData>;
	/** Settings store for SSH remote configuration lookup */
	settingsStore?: Store<MaestroSettings>;
}

// Module-level reference to settings store (set during registration)
let agentSessionsSettingsStore: Store<MaestroSettings> | undefined;

/**
 * Get SSH remote configuration by ID from the settings store.
 * Returns undefined if not found or store not provided.
 */
function getSshRemoteById(sshRemoteId: string): SshRemoteConfig | undefined {
	if (!agentSessionsSettingsStore) {
		logger.warn(`${LOG_CONTEXT} Settings store not available for SSH remote lookup`, LOG_CONTEXT);
		return undefined;
	}
	const sshRemotes = agentSessionsSettingsStore.get('sshRemotes', []) as SshRemoteConfig[];
	return sshRemotes.find((r) => r.id === sshRemoteId && r.enabled);
}

/**
 * Helper function to create consistent handler options
 */
function handlerOpts(operation: string) {
	return { context: LOG_CONTEXT, operation, logSuccess: false };
}

/**
 * Get global stats from Usage Dashboard (StatsDB).
 * This is the authoritative source for token and cost data.
 */
async function getStatsFromUsageDashboard(): Promise<{
	totalQueries: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCacheReadTokens: number;
	totalCacheCreationTokens: number;
	maestroCostUsd: number;
	anthropicCostUsd: number;
	savingsUsd: number;
}> {
	try {
		const db = getStatsDB();
		const aggregation = db.getAggregatedStats('all');

		return {
			totalQueries: aggregation.totalQueries,
			totalInputTokens: aggregation.totalInputTokens ?? 0,
			totalOutputTokens: aggregation.totalOutputTokens ?? 0,
			totalCacheReadTokens: aggregation.totalCacheReadInputTokens ?? 0,
			totalCacheCreationTokens: aggregation.totalCacheCreationInputTokens ?? 0,
			maestroCostUsd: aggregation.totalCostUsd ?? 0,
			anthropicCostUsd: aggregation.anthropicCostUsd ?? 0,
			savingsUsd: aggregation.savingsUsd ?? 0,
		};
	} catch (error) {
		logger.warn('Failed to get stats from Usage Dashboard', LOG_CONTEXT, { error });
		return {
			totalQueries: 0,
			totalInputTokens: 0,
			totalOutputTokens: 0,
			totalCacheReadTokens: 0,
			totalCacheCreationTokens: 0,
			maestroCostUsd: 0,
			anthropicCostUsd: 0,
			savingsUsd: 0,
		};
	}
}

/**
 * Count total messages from all local Claude session files.
 * Counts "type": "user" and "type": "assistant" entries.
 */
async function countLocalClaudeMessages(): Promise<number> {
	const homeDir = os.homedir();
	const claudeProjectsDir = path.join(homeDir, '.claude', 'projects');
	let totalMessages = 0;

	try {
		await fs.access(claudeProjectsDir);
	} catch {
		return 0;
	}

	const projectDirs = await fs.readdir(claudeProjectsDir);

	for (const projectDir of projectDirs) {
		const projectPath = path.join(claudeProjectsDir, projectDir);
		try {
			const stat = await fs.stat(projectPath);
			if (!stat.isDirectory()) continue;

			const entries = await fs.readdir(projectPath, { withFileTypes: true });

			for (const entry of entries) {
				// Count messages in main session files
				if (entry.isFile() && entry.name.endsWith('.jsonl')) {
					const filePath = path.join(projectPath, entry.name);
					try {
						const content = await fs.readFile(filePath, 'utf-8');
						const userCount = (content.match(/"type"\s*:\s*"user"/g) || []).length;
						const assistantCount = (content.match(/"type"\s*:\s*"assistant"/g) || []).length;
						totalMessages += userCount + assistantCount;
					} catch {
						// Skip files we can't read
					}
				}

				// Count messages in subagent files
				if (entry.isDirectory()) {
					const subagentsDir = path.join(projectPath, entry.name, 'subagents');
					try {
						const subFiles = await fs.readdir(subagentsDir);
						for (const subFile of subFiles) {
							if (!subFile.startsWith('agent-') || !subFile.endsWith('.jsonl')) continue;
							const subFilePath = path.join(subagentsDir, subFile);
							try {
								const content = await fs.readFile(subFilePath, 'utf-8');
								const userCount = (content.match(/"type"\s*:\s*"user"/g) || []).length;
								const assistantCount = (content.match(/"type"\s*:\s*"assistant"/g) || []).length;
								totalMessages += userCount + assistantCount;
							} catch {
								// Skip files we can't read
							}
						}
					} catch {
						// No subagents directory
					}
				}
			}
		} catch {
			continue;
		}
	}

	return totalMessages;
}

/**
 * Count total messages from all Claude session files on an SSH remote.
 */
async function countRemoteClaudeMessagesForHost(
	sshConfig: SshRemoteConfig,
	_timeoutMs: number = 60000
): Promise<number> {
	let totalMessages = 0;

	try {
		// List all project directories
		const projectsResult = await readDirRemote('~/.claude/projects', sshConfig);
		if (!projectsResult.success || !projectsResult.data) {
			return 0;
		}

		const projectDirs = projectsResult.data.filter((e) => e.isDirectory);

		for (const projectDir of projectDirs) {
			const projectPath = `~/.claude/projects/${projectDir.name}`;

			try {
				const entriesResult = await readDirRemote(projectPath, sshConfig);
				if (!entriesResult.success || !entriesResult.data) continue;

				for (const entry of entriesResult.data) {
					// Count messages in main session files
					if (!entry.isDirectory && entry.name.endsWith('.jsonl')) {
						const filePath = `${projectPath}/${entry.name}`;
						const countResult = await countRemoteClaudeMessagesViaShell(filePath, sshConfig);
						if (countResult.success && countResult.data) {
							totalMessages += countResult.data;
						}
					}

					// Count messages in subagent files
					if (entry.isDirectory) {
						const subagentsPath = `${projectPath}/${entry.name}/subagents`;
						try {
							const subResult = await readDirRemote(subagentsPath, sshConfig);
							if (!subResult.success || !subResult.data) continue;

							for (const subEntry of subResult.data) {
								if (subEntry.isDirectory) continue;
								if (!subEntry.name.startsWith('agent-') || !subEntry.name.endsWith('.jsonl'))
									continue;

								const subFilePath = `${subagentsPath}/${subEntry.name}`;
								const countResult = await countRemoteClaudeMessagesViaShell(subFilePath, sshConfig);
								if (countResult.success && countResult.data) {
									totalMessages += countResult.data;
								}
							}
						} catch {
							// No subagents directory
						}
					}
				}
			} catch {
				continue;
			}
		}
	} catch (error) {
		logger.warn(`Failed to count messages on remote ${sshConfig.name}`, LOG_CONTEXT, { error });
	}

	return totalMessages;
}

// DEPRECATED: Global Stats now uses Usage Dashboard data
// The following code (SessionFileInfo, parse functions, discover functions, aggregate functions)
// is kept commented out in case we need file-based stats in the future

/*
interface SessionFileInfo {
	filePath: string;
	sessionKey: string;
	mtimeMs: number;
}

function parseClaudeSessionContent(
	content: string,
	sizeBytes: number
): Omit<CachedSessionStats, 'fileMtimeMs'> {
	const userMessageCount = (content.match(/"type"\s*:\s*"user"/g) || []).length;
	const assistantMessageCount = (content.match(/"type"\s*:\s*"assistant"/g) || []).length;

	let inputTokens = 0;
	let outputTokens = 0;
	let cacheReadTokens = 0;
	let cacheCreationTokens = 0;

	const inputMatches = content.matchAll(
		/(?<!cache_read_|cache_creation_)"input_tokens"\s*:\s*(\d+)/g
	);
	for (const m of inputMatches) inputTokens += parseInt(m[1], 10);

	const outputMatches = content.matchAll(/"output_tokens"\s*:\s*(\d+)/g);
	for (const m of outputMatches) outputTokens += parseInt(m[1], 10);

	const cacheReadMatches = content.matchAll(/"cache_read_input_tokens"\s*:\s*(\d+)/g);
	for (const m of cacheReadMatches) cacheReadTokens += parseInt(m[1], 10);

	const cacheCreationMatches = content.matchAll(/"cache_creation_input_tokens"\s*:\s*(\d+)/g);
	for (const m of cacheCreationMatches) cacheCreationTokens += parseInt(m[1], 10);

	return {
		messages: userMessageCount + assistantMessageCount,
		inputTokens,
		outputTokens,
		cacheReadTokens,
		cacheCreationTokens,
		cachedInputTokens: 0,
		sizeBytes,
	};
}

function parseCodexSessionContent(
	content: string,
	sizeBytes: number
): Omit<CachedSessionStats, 'fileMtimeMs'> {
	const lines = content.split('\n').filter((l) => l.trim());

	let messageCount = 0;
	let inputTokens = 0;
	let outputTokens = 0;
	let cachedTokens = 0;

	for (const line of lines) {
		try {
			const entry = JSON.parse(line);

			if (entry.type === 'response_item' && entry.payload?.type === 'message') {
				const role = entry.payload.role;
				if (role === 'user' || role === 'assistant') {
					messageCount++;
				}
			}

			if (entry.type === 'event_msg' && entry.payload?.type === 'token_count') {
				const usage = entry.payload.info?.total_token_usage;
				if (usage) {
					inputTokens += usage.input_tokens || 0;
					outputTokens += usage.output_tokens || 0;
					outputTokens += usage.reasoning_output_tokens || 0;
					cachedTokens += usage.cached_input_tokens || 0;
				}
			}
		} catch {
			// Skip malformed lines
		}
	}

	return {
		messages: messageCount,
		inputTokens,
		outputTokens,
		cacheReadTokens: 0,
		cacheCreationTokens: 0,
		cachedInputTokens: cachedTokens,
		sizeBytes,
	};
}

async function discoverClaudeSessionFiles(): Promise<SessionFileInfo[]> {
	const homeDir = os.homedir();
	const claudeProjectsDir = path.join(homeDir, '.claude', 'projects');
	const files: SessionFileInfo[] = [];

	try {
		await fs.access(claudeProjectsDir);
	} catch {
		return files;
	}

	const projectDirs = await fs.readdir(claudeProjectsDir);

	for (const projectDir of projectDirs) {
		const projectPath = path.join(claudeProjectsDir, projectDir);
		try {
			const stat = await fs.stat(projectPath);
			if (!stat.isDirectory()) continue;

			const dirEntries = await fs.readdir(projectPath, { withFileTypes: true });

			for (const entry of dirEntries) {
				if (entry.isFile() && entry.name.endsWith('.jsonl')) {
					const filePath = path.join(projectPath, entry.name);
					try {
						const fileStat = await fs.stat(filePath);
						if (fileStat.size === 0) continue;
						const sessionKey = `${projectDir}/${entry.name.replace('.jsonl', '')}`;
						files.push({ filePath, sessionKey, mtimeMs: fileStat.mtimeMs });
					} catch {
						// Skip files we can't stat
					}
				}

				if (entry.isDirectory()) {
					const sessionDir = path.join(projectPath, entry.name);
					const subagentsDir = path.join(sessionDir, 'subagents');

					try {
						await fs.access(subagentsDir);
						const subagentFiles = await fs.readdir(subagentsDir);

						for (const subFile of subagentFiles) {
							if (!subFile.startsWith('agent-') || !subFile.endsWith('.jsonl')) continue;

							const subFilePath = path.join(subagentsDir, subFile);
							try {
								const subFileStat = await fs.stat(subFilePath);
								if (subFileStat.size === 0) continue;
								const subSessionKey = `${projectDir}/${entry.name}/subagents/${subFile.replace('.jsonl', '')}`;
								files.push({ filePath: subFilePath, sessionKey: subSessionKey, mtimeMs: subFileStat.mtimeMs });
							} catch {
								// Skip files we can't stat
							}
						}
					} catch {
						// No subagents directory
					}
				}
			}
		} catch {
			continue;
		}
	}

	return files;
}

async function discoverRemoteClaudeSessionFiles(
	sshConfig: SshRemoteConfig,
	_timeoutMs: number = 30000
): Promise<{ filePath: string; sessionKey: string; mtimeMs: number }[]> {
	const files: { filePath: string; sessionKey: string; mtimeMs: number }[] = [];

	try {
		const projectsResult = await readDirRemote('~/.claude/projects', sshConfig);
		if (!projectsResult.success || !projectsResult.data) {
			return files;
		}

		const projectDirs = projectsResult.data.filter((e) => e.isDirectory);

		for (const projectDir of projectDirs) {
			const projectPath = `~/.claude/projects/${projectDir.name}`;

			try {
				const entriesResult = await readDirRemote(projectPath, sshConfig);
				if (!entriesResult.success || !entriesResult.data) continue;

				for (const entry of entriesResult.data) {
					if (!entry.isDirectory && entry.name.endsWith('.jsonl')) {
						const filePath = `${projectPath}/${entry.name}`;
						const statResult = await statRemote(filePath, sshConfig);
						if (!statResult.success || !statResult.data) continue;
						if (statResult.data.size === 0) continue;

						const sessionKey = `${projectDir.name}/${entry.name.replace('.jsonl', '')}`;
						files.push({
							filePath,
							sessionKey,
							mtimeMs: statResult.data.mtime,
						});
					}

					if (entry.isDirectory) {
						const subagentsPath = `${projectPath}/${entry.name}/subagents`;

						try {
							const subagentsResult = await readDirRemote(subagentsPath, sshConfig);
							if (!subagentsResult.success || !subagentsResult.data) continue;

							for (const subEntry of subagentsResult.data) {
								if (subEntry.isDirectory) continue;
								if (!subEntry.name.startsWith('agent-') || !subEntry.name.endsWith('.jsonl')) continue;

								const subFilePath = `${subagentsPath}/${subEntry.name}`;
								const subStatResult = await statRemote(subFilePath, sshConfig);
								if (!subStatResult.success || !subStatResult.data) continue;
								if (subStatResult.data.size === 0) continue;

								const subSessionKey = `${projectDir.name}/${entry.name}/subagents/${subEntry.name.replace('.jsonl', '')}`;
								files.push({
									filePath: subFilePath,
									sessionKey: subSessionKey,
									mtimeMs: subStatResult.data.mtime,
								});
							}
						} catch {
							// No subagents directory
						}
					}
				}
			} catch {
				continue;
			}
		}
	} catch (error) {
		logger.warn(`Failed to discover remote Claude sessions on ${sshConfig.name}`, LOG_CONTEXT, {
			error,
		});
	}

	return files;
}

async function parseRemoteClaudeSession(
	filePath: string,
	sshConfig: SshRemoteConfig,
	timeoutMs: number = 10000
): Promise<Omit<CachedSessionStats, 'fileMtimeMs' | 'archived'> | null> {
	try {
		const timeoutPromise = new Promise<never>((_, reject) => {
			setTimeout(() => reject(new Error(`SSH parse timeout after ${timeoutMs}ms`)), timeoutMs);
		});

		const parsePromise = (async () => {
			const result = await parseRemoteClaudeStatsViaShell(filePath, sshConfig);
			if (!result.success || !result.data) {
				logger.warn(
					`Failed to parse remote Claude session: ${filePath} on ${sshConfig.name}`,
					LOG_CONTEXT,
					{ error: result.error }
				);
				return null;
			}

			const stats = result.data;
			return {
				messages: stats.messageCount,
				inputTokens: stats.inputTokens,
				outputTokens: stats.outputTokens,
				cacheReadTokens: stats.cacheReadTokens,
				cacheCreationTokens: stats.cacheCreationTokens,
				cachedInputTokens: 0,
				sizeBytes: stats.sizeBytes,
			};
		})();

		return await Promise.race([parsePromise, timeoutPromise]);
	} catch (error) {
		logger.warn(
			`Failed to parse remote Claude session: ${filePath} on ${sshConfig.name}`,
			LOG_CONTEXT,
			{ error }
		);
		return null;
	}
}

async function discoverCodexSessionFiles(): Promise<SessionFileInfo[]> {
	const homeDir = os.homedir();
	const codexSessionsDir = path.join(homeDir, '.codex', 'sessions');
	const files: SessionFileInfo[] = [];

	try {
		await fs.access(codexSessionsDir);
	} catch {
		return files;
	}

	const years = await fs.readdir(codexSessionsDir);
	for (const year of years) {
		if (!/^\d{4}$/.test(year)) continue;
		const yearDir = path.join(codexSessionsDir, year);

		try {
			const yearStat = await fs.stat(yearDir);
			if (!yearStat.isDirectory()) continue;

			const months = await fs.readdir(yearDir);
			for (const month of months) {
				if (!/^\d{2}$/.test(month)) continue;
				const monthDir = path.join(yearDir, month);

				try {
					const monthStat = await fs.stat(monthDir);
					if (!monthStat.isDirectory()) continue;

					const days = await fs.readdir(monthDir);
					for (const day of days) {
						if (!/^\d{2}$/.test(day)) continue;
						const dayDir = path.join(monthDir, day);

						try {
							const dayStat = await fs.stat(dayDir);
							if (!dayStat.isDirectory()) continue;

							const dirFiles = await fs.readdir(dayDir);
							for (const file of dirFiles) {
								if (!file.endsWith('.jsonl')) continue;
								const filePath = path.join(dayDir, file);

								try {
									const fileStat = await fs.stat(filePath);
									if (fileStat.size === 0) continue;
									const sessionKey = `${year}/${month}/${day}/${file.replace('.jsonl', '')}`;
									files.push({ filePath, sessionKey, mtimeMs: fileStat.mtimeMs });
								} catch {
									// Skip files we can't stat
								}
							}
						} catch {
							continue;
						}
					}
				} catch {
					continue;
				}
			}
		} catch {
			continue;
		}
	}

	return files;
}

function aggregateProviderStats(
	sessions: Record<string, CachedSessionStats>,
	hasCostData: boolean
): {
	sessions: number;
	messages: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheCreationTokens: number;
	cachedInputTokens: number;
	sizeBytes: number;
	costUsd: number;
	hasCostData: boolean;
} {
	let totalMessages = 0;
	let totalInputTokens = 0;
	let totalOutputTokens = 0;
	let totalCacheReadTokens = 0;
	let totalCacheCreationTokens = 0;
	let totalCachedInputTokens = 0;
	let totalSizeBytes = 0;

	for (const stats of Object.values(sessions)) {
		totalMessages += stats.messages;
		totalInputTokens += stats.inputTokens;
		totalOutputTokens += stats.outputTokens;
		totalCacheReadTokens += stats.cacheReadTokens;
		totalCacheCreationTokens += stats.cacheCreationTokens;
		totalCachedInputTokens += stats.cachedInputTokens;
		totalSizeBytes += stats.sizeBytes;
	}

	const costUsd = hasCostData
		? calculateClaudeCost(
				totalInputTokens,
				totalOutputTokens,
				totalCacheReadTokens,
				totalCacheCreationTokens
			)
		: 0;

	return {
		sessions: Object.keys(sessions).length,
		messages: totalMessages,
		inputTokens: totalInputTokens,
		outputTokens: totalOutputTokens,
		cacheReadTokens: totalCacheReadTokens,
		cacheCreationTokens: totalCacheCreationTokens,
		cachedInputTokens: totalCachedInputTokens,
		sizeBytes: totalSizeBytes,
		costUsd,
		hasCostData,
	};
}

function aggregateRemoteIntoResult(
	result: GlobalAgentStats,
	remoteId: string,
	remoteName: string,
	remoteHost: string,
	sessions: Record<string, CachedSessionStats>,
	fetchedAt: number,
	fetchError?: string
): void {
	const agg = aggregateProviderStats(sessions, true);

	if (!result.byRemote) {
		result.byRemote = {};
	}

	result.byRemote[remoteId] = {
		remoteName,
		remoteHost,
		stats: {
			sessions: agg.sessions,
			messages: agg.messages,
			inputTokens: agg.inputTokens,
			outputTokens: agg.outputTokens,
			costUsd: agg.costUsd,
			hasCostData: agg.sessions > 0,
		},
		lastFetchedAt: fetchedAt,
		fetchError,
	};

	if (agg.sessions > 0) {
		result.totalSessions += agg.sessions;
		result.totalMessages += agg.messages;
		result.totalInputTokens += agg.inputTokens;
		result.totalOutputTokens += agg.outputTokens;
		result.totalCacheReadTokens += agg.cacheReadTokens;
		result.totalCacheCreationTokens += agg.cacheCreationTokens;
		result.totalCostUsd += agg.costUsd;
		result.totalSizeBytes += agg.sizeBytes;
		result.hasCostData = true;
	}
}
// End of deprecated code */

/**
 * Register all agent sessions IPC handlers.
 */
export function registerAgentSessionsHandlers(deps?: AgentSessionsHandlerDependencies): void {
	const getMainWindow = deps?.getMainWindow;

	// Store settings reference for SSH remote lookups
	agentSessionsSettingsStore = deps?.settingsStore;

	// ============ List Sessions ============

	ipcMain.handle(
		'agentSessions:list',
		withIpcErrorLogging(
			handlerOpts('list'),
			async (
				agentId: string,
				projectPath: string,
				sshRemoteId?: string
			): Promise<AgentSessionInfo[]> => {
				const storage = getSessionStorage(agentId);
				if (!storage) {
					logger.warn(`No session storage available for agent: ${agentId}`, LOG_CONTEXT);
					return [];
				}

				// Get SSH config if provided
				const sshConfig = sshRemoteId ? getSshRemoteById(sshRemoteId) : undefined;

				const sessions = await storage.listSessions(projectPath, sshConfig);
				logger.info(
					`Listed ${sessions.length} sessions for agent ${agentId} at ${projectPath}${sshRemoteId ? ' (remote via SSH)' : ''}`,
					LOG_CONTEXT
				);
				return sessions;
			}
		)
	);

	// ============ List Sessions Paginated ============

	ipcMain.handle(
		'agentSessions:listPaginated',
		withIpcErrorLogging(
			handlerOpts('listPaginated'),
			async (
				agentId: string,
				projectPath: string,
				options?: SessionListOptions,
				sshRemoteId?: string
			): Promise<PaginatedSessionsResult> => {
				const storage = getSessionStorage(agentId);
				if (!storage) {
					logger.warn(`No session storage available for agent: ${agentId}`, LOG_CONTEXT);
					return { sessions: [], hasMore: false, totalCount: 0, nextCursor: null };
				}

				// Get SSH config if provided
				const sshConfig = sshRemoteId ? getSshRemoteById(sshRemoteId) : undefined;

				const result = await storage.listSessionsPaginated(projectPath, options, sshConfig);
				logger.info(
					`Listed paginated sessions for agent ${agentId}: ${result.sessions.length} of ${result.totalCount}${sshRemoteId ? ' (remote via SSH)' : ''}`,
					LOG_CONTEXT
				);
				return result;
			}
		)
	);

	// ============ Read Session Messages ============

	ipcMain.handle(
		'agentSessions:read',
		withIpcErrorLogging(
			handlerOpts('read'),
			async (
				agentId: string,
				projectPath: string,
				sessionId: string,
				options?: SessionReadOptions,
				sshRemoteId?: string
			): Promise<SessionMessagesResult> => {
				const storage = getSessionStorage(agentId);
				if (!storage) {
					logger.warn(`No session storage available for agent: ${agentId}`, LOG_CONTEXT);
					return { messages: [], total: 0, hasMore: false };
				}

				// Get SSH config if provided
				const sshConfig = sshRemoteId ? getSshRemoteById(sshRemoteId) : undefined;

				const result = await storage.readSessionMessages(
					projectPath,
					sessionId,
					options,
					sshConfig
				);
				logger.info(
					`Read ${result.messages.length} messages for session ${sessionId} (agent: ${agentId})${sshRemoteId ? ' (remote via SSH)' : ''}`,
					LOG_CONTEXT
				);
				return result;
			}
		)
	);

	// ============ Search Sessions ============

	ipcMain.handle(
		'agentSessions:search',
		withIpcErrorLogging(
			handlerOpts('search'),
			async (
				agentId: string,
				projectPath: string,
				query: string,
				searchMode: SessionSearchMode,
				sshRemoteId?: string
			): Promise<SessionSearchResult[]> => {
				const storage = getSessionStorage(agentId);
				if (!storage) {
					logger.warn(`No session storage available for agent: ${agentId}`, LOG_CONTEXT);
					return [];
				}

				// Get SSH config if provided
				const sshConfig = sshRemoteId ? getSshRemoteById(sshRemoteId) : undefined;

				const results = await storage.searchSessions(projectPath, query, searchMode, sshConfig);
				logger.info(
					`Found ${results.length} matching sessions for query "${query}" (agent: ${agentId})${sshRemoteId ? ' (remote via SSH)' : ''}`,
					LOG_CONTEXT
				);
				return results;
			}
		)
	);

	// ============ List Subagents for Session ============

	ipcMain.handle(
		'agentSessions:listSubagents',
		withIpcErrorLogging(
			handlerOpts('listSubagents'),
			async (
				agentId: string,
				projectPath: string,
				sessionId: string,
				sshRemoteId?: string
			): Promise<import('../../agents').SubagentInfo[]> => {
				const storage = getSessionStorage(agentId);
				if (!storage) {
					logger.warn(`No session storage available for agent: ${agentId}`, LOG_CONTEXT);
					return [];
				}

				// Check if storage supports subagent listing
				if (typeof (storage as any).listSubagentsForSession !== 'function') {
					logger.debug(`Storage for ${agentId} does not support subagent listing`, LOG_CONTEXT);
					return [];
				}

				// Get SSH config if provided
				const sshConfig = sshRemoteId ? getSshRemoteById(sshRemoteId) : undefined;

				const subagents = await (storage as any).listSubagentsForSession(
					projectPath,
					sessionId,
					sshConfig
				);
				logger.info(
					`Listed ${subagents.length} subagents for session ${sessionId} (agent: ${agentId})${sshRemoteId ? ' (remote via SSH)' : ''}`,
					LOG_CONTEXT
				);
				return subagents;
			}
		)
	);

	// ============ Get Subagent Stats ============
	// Returns aggregated token statistics from all subagents for a session
	// Used by useSubagentStatsPoller for real-time throughput display (Phase 3)

	ipcMain.handle(
		'agentSessions:getSubagentStats',
		withIpcErrorLogging(
			handlerOpts('getSubagentStats'),
			async (
				agentId: string,
				projectPath: string,
				sessionId: string,
				sshRemoteId?: string
			): Promise<{
				inputTokens: number;
				outputTokens: number;
				cacheReadTokens: number;
				cacheCreationTokens: number;
				cost: number;
				subagentCount: number;
			}> => {
				const storage = getSessionStorage(agentId);
				if (!storage) {
					logger.debug(`No session storage available for agent: ${agentId}`, LOG_CONTEXT);
					return {
						inputTokens: 0,
						outputTokens: 0,
						cacheReadTokens: 0,
						cacheCreationTokens: 0,
						cost: 0,
						subagentCount: 0,
					};
				}

				// Check if storage supports subagent listing
				if (typeof (storage as any).listSubagentsForSession !== 'function') {
					logger.debug(`Storage for ${agentId} does not support subagent listing`, LOG_CONTEXT);
					return {
						inputTokens: 0,
						outputTokens: 0,
						cacheReadTokens: 0,
						cacheCreationTokens: 0,
						cost: 0,
						subagentCount: 0,
					};
				}

				// Get SSH config if provided
				const sshConfig = sshRemoteId ? getSshRemoteById(sshRemoteId) : undefined;

				const subagents = await (storage as any).listSubagentsForSession(
					projectPath,
					sessionId,
					sshConfig
				);

				// Aggregate stats from all subagents (include ALL token types for accurate totals)
				const result = {
					inputTokens: subagents.reduce(
						(sum: number, s: { inputTokens?: number }) => sum + (s.inputTokens || 0),
						0
					),
					outputTokens: subagents.reduce(
						(sum: number, s: { outputTokens?: number }) => sum + (s.outputTokens || 0),
						0
					),
					cacheReadTokens: subagents.reduce(
						(sum: number, s: { cacheReadTokens?: number }) => sum + (s.cacheReadTokens || 0),
						0
					),
					cacheCreationTokens: subagents.reduce(
						(sum: number, s: { cacheCreationTokens?: number }) =>
							sum + (s.cacheCreationTokens || 0),
						0
					),
					cost: subagents.reduce(
						(sum: number, s: { costUsd?: number }) => sum + (s.costUsd || 0),
						0
					),
					subagentCount: subagents.length,
				};

				logger.debug(
					`Got subagent stats for session ${sessionId}: ${result.subagentCount} subagents, ${result.inputTokens + result.outputTokens + result.cacheReadTokens + result.cacheCreationTokens} total tokens`,
					LOG_CONTEXT
				);

				return result;
			}
		)
	);

	// ============ Get Subagent Messages ============

	ipcMain.handle(
		'agentSessions:getSubagentMessages',
		withIpcErrorLogging(
			handlerOpts('getSubagentMessages'),
			async (
				agentId: string,
				projectPath: string,
				sessionId: string,
				agentSubId: string,
				options?: { offset?: number; limit?: number },
				sshRemoteId?: string
			): Promise<SessionMessagesResult> => {
				const storage = getSessionStorage(agentId);
				if (!storage) {
					logger.warn(`No session storage available for agent: ${agentId}`, LOG_CONTEXT);
					return { messages: [], total: 0, hasMore: false };
				}

				// Check if storage supports subagent messages
				if (typeof (storage as any).getSubagentMessages !== 'function') {
					logger.debug(`Storage for ${agentId} does not support subagent messages`, LOG_CONTEXT);
					return { messages: [], total: 0, hasMore: false };
				}

				// Get SSH config if provided
				const sshConfig = sshRemoteId ? getSshRemoteById(sshRemoteId) : undefined;

				const result = await (storage as any).getSubagentMessages(
					projectPath,
					sessionId,
					agentSubId,
					options,
					sshConfig
				);
				logger.info(
					`Read ${result.messages.length} messages for subagent ${agentSubId} in session ${sessionId} (agent: ${agentId})${sshRemoteId ? ' (remote via SSH)' : ''}`,
					LOG_CONTEXT
				);
				return result;
			}
		)
	);

	// ============ Get Session Path ============

	ipcMain.handle(
		'agentSessions:getPath',
		withIpcErrorLogging(
			handlerOpts('getPath'),
			async (agentId: string, projectPath: string, sessionId: string): Promise<string | null> => {
				const storage = getSessionStorage(agentId);
				if (!storage) {
					logger.warn(`No session storage available for agent: ${agentId}`, LOG_CONTEXT);
					return null;
				}

				return storage.getSessionPath(projectPath, sessionId);
			}
		)
	);

	// ============ Delete Message Pair ============

	ipcMain.handle(
		'agentSessions:deleteMessagePair',
		withIpcErrorLogging(
			handlerOpts('deleteMessagePair'),
			async (
				agentId: string,
				projectPath: string,
				sessionId: string,
				userMessageUuid: string,
				fallbackContent?: string
			): Promise<{ success: boolean; error?: string; linesRemoved?: number }> => {
				const storage = getSessionStorage(agentId);
				if (!storage) {
					logger.warn(`No session storage available for agent: ${agentId}`, LOG_CONTEXT);
					return { success: false, error: `No session storage available for agent: ${agentId}` };
				}

				return storage.deleteMessagePair(projectPath, sessionId, userMessageUuid, fallbackContent);
			}
		)
	);

	// ============ Check Storage Availability ============

	ipcMain.handle(
		'agentSessions:hasStorage',
		withIpcErrorLogging(handlerOpts('hasStorage'), async (agentId: string): Promise<boolean> => {
			return hasSessionStorage(agentId);
		})
	);

	// ============ Get Available Storages ============

	ipcMain.handle(
		'agentSessions:getAvailableStorages',
		withIpcErrorLogging(handlerOpts('getAvailableStorages'), async (): Promise<string[]> => {
			const storages = getAllSessionStorages();
			return storages.map((s) => s.agentId);
		})
	);

	// ============ Get All Named Sessions ============

	ipcMain.handle(
		'agentSessions:getAllNamedSessions',
		withIpcErrorLogging(
			handlerOpts('getAllNamedSessions'),
			async (): Promise<
				Array<{
					agentId: string;
					agentSessionId: string;
					projectPath: string;
					sessionName: string;
					starred?: boolean;
					lastActivityAt?: number;
				}>
			> => {
				// Aggregate named sessions from all providers that support it
				const allNamedSessions: Array<{
					agentId: string;
					agentSessionId: string;
					projectPath: string;
					sessionName: string;
					starred?: boolean;
					lastActivityAt?: number;
				}> = [];

				const storages = getAllSessionStorages();
				for (const storage of storages) {
					if (
						'getAllNamedSessions' in storage &&
						typeof storage.getAllNamedSessions === 'function'
					) {
						try {
							const sessions = await storage.getAllNamedSessions();
							allNamedSessions.push(
								...sessions.map(
									(session: {
										agentSessionId: string;
										projectPath: string;
										sessionName: string;
										starred?: boolean;
										lastActivityAt?: number;
									}) => ({
										agentId: storage.agentId,
										...session,
									})
								)
							);
						} catch (error) {
							logger.warn(
								`Failed to get named sessions from ${storage.agentId}: ${error}`,
								LOG_CONTEXT
							);
						}
					}
				}

				logger.info(
					`Found ${allNamedSessions.length} named sessions across all providers`,
					LOG_CONTEXT
				);
				return allNamedSessions;
			}
		)
	);

	// ============ Session Origins (Generic - for non-Claude agents) ============
	// These handlers manage session metadata like names and starred status for all agents

	const originsStore = deps?.agentSessionOriginsStore;

	ipcMain.handle(
		'agentSessions:getOrigins',
		withIpcErrorLogging(
			handlerOpts('getOrigins'),
			async (
				agentId: string,
				projectPath: string
			): Promise<
				Record<string, { origin?: 'user' | 'auto'; sessionName?: string; starred?: boolean }>
			> => {
				if (!originsStore) {
					logger.warn('Origins store not available for getOrigins', LOG_CONTEXT);
					return {};
				}
				const allOrigins = originsStore.get('origins', {});
				const agentOrigins = allOrigins[agentId] || {};
				const result = agentOrigins[projectPath] || {};
				logger.info(
					`getOrigins(${agentId}, ${projectPath}): found ${Object.keys(result).length} entries`,
					LOG_CONTEXT
				);
				return result;
			}
		)
	);

	ipcMain.handle(
		'agentSessions:setSessionName',
		withIpcErrorLogging(
			handlerOpts('setSessionName'),
			async (
				agentId: string,
				projectPath: string,
				sessionId: string,
				sessionName: string | null
			): Promise<void> => {
				if (!originsStore) {
					logger.warn('Origins store not available', LOG_CONTEXT);
					return;
				}
				const allOrigins = originsStore.get('origins', {});
				if (!allOrigins[agentId]) allOrigins[agentId] = {};
				if (!allOrigins[agentId][projectPath]) allOrigins[agentId][projectPath] = {};

				if (sessionName) {
					allOrigins[agentId][projectPath][sessionId] = {
						...allOrigins[agentId][projectPath][sessionId],
						sessionName,
					};
				} else {
					// Remove sessionName
					const existing = allOrigins[agentId][projectPath][sessionId];
					if (existing) {
						delete existing.sessionName;
						// Clean up if empty
						if (!existing.starred && !existing.origin) {
							delete allOrigins[agentId][projectPath][sessionId];
						}
					}
				}
				originsStore.set('origins', allOrigins);
				logger.info(`Set session name for ${agentId}/${sessionId}: ${sessionName}`, LOG_CONTEXT);
			}
		)
	);

	ipcMain.handle(
		'agentSessions:setSessionStarred',
		withIpcErrorLogging(
			handlerOpts('setSessionStarred'),
			async (
				agentId: string,
				projectPath: string,
				sessionId: string,
				starred: boolean
			): Promise<void> => {
				if (!originsStore) {
					logger.warn('Origins store not available', LOG_CONTEXT);
					return;
				}
				const allOrigins = originsStore.get('origins', {});
				if (!allOrigins[agentId]) allOrigins[agentId] = {};
				if (!allOrigins[agentId][projectPath]) allOrigins[agentId][projectPath] = {};

				if (starred) {
					allOrigins[agentId][projectPath][sessionId] = {
						...allOrigins[agentId][projectPath][sessionId],
						starred: true,
					};
				} else {
					// Remove starred
					const existing = allOrigins[agentId][projectPath][sessionId];
					if (existing) {
						delete existing.starred;
						// Clean up if empty
						if (!existing.sessionName && !existing.origin) {
							delete allOrigins[agentId][projectPath][sessionId];
						}
					}
				}
				originsStore.set('origins', allOrigins);
				logger.info(`Set session starred for ${agentId}/${sessionId}: ${starred}`, LOG_CONTEXT);
			}
		)
	);

	// ============ Get Global Stats (All Providers) ============

	ipcMain.handle('agentSessions:getGlobalStats', async (): Promise<GlobalAgentStats> => {
		logger.info('Getting global stats from Usage Dashboard + message count', LOG_CONTEXT);

		const mainWindow = getMainWindow?.();

		// Get authoritative stats from Usage Dashboard (StatsDB)
		const udStats = await getStatsFromUsageDashboard();

		// Start with UD data, messages will be updated async
		const result: GlobalAgentStats = {
			totalSessions: udStats.totalQueries, // Use queries as "sessions"
			totalMessages: 0, // Will be updated by message counting
			totalInputTokens: udStats.totalInputTokens,
			totalOutputTokens: udStats.totalOutputTokens,
			totalCacheReadTokens: udStats.totalCacheReadTokens,
			totalCacheCreationTokens: udStats.totalCacheCreationTokens,
			totalCostUsd: udStats.maestroCostUsd,
			anthropicCostUsd: udStats.anthropicCostUsd,
			savingsUsd: udStats.savingsUsd,
			hasCostData: udStats.maestroCostUsd > 0,
			totalSizeBytes: 0,
			isComplete: false,
			messagesFetchInProgress: true,
			byProvider: {
				'claude-code': {
					sessions: udStats.totalQueries,
					messages: 0,
					inputTokens: udStats.totalInputTokens,
					outputTokens: udStats.totalOutputTokens,
					costUsd: udStats.maestroCostUsd,
					hasCostData: udStats.maestroCostUsd > 0,
				},
			},
			byRemote: undefined,
			remoteFetchInProgress: false,
		};

		// Send initial update with UD data
		if (mainWindow && !mainWindow.isDestroyed()) {
			mainWindow.webContents.send('agentSessions:globalStatsUpdate', result);
		}

		// Count messages async (local + remote)
		(async () => {
			try {
				// Count local messages first
				const localMessages = await countLocalClaudeMessages();
				result.totalMessages = localMessages;
				result.byProvider['claude-code'].messages = localMessages;

				// Send update with local messages
				if (mainWindow && !mainWindow.isDestroyed()) {
					mainWindow.webContents.send('agentSessions:globalStatsUpdate', { ...result });
				}

				// Count messages on SSH remotes
				const settingsStore = agentSessionsSettingsStore;
				const sshRemotes = (settingsStore?.get('sshRemotes', []) as SshRemoteConfig[]) || [];
				const enabledRemotes = sshRemotes.filter((r) => r.enabled);

				if (enabledRemotes.length > 0) {
					const sshStatsTimeoutMs = settingsStore?.get('sshStatsTimeoutMs', 60000) ?? 60000;

					for (const remote of enabledRemotes) {
						try {
							logger.info(`Counting messages on SSH remote: ${remote.name}`, LOG_CONTEXT);
							const remoteMessages = await countRemoteClaudeMessagesForHost(
								remote,
								sshStatsTimeoutMs
							);
							result.totalMessages += remoteMessages;
							result.byProvider['claude-code'].messages = result.totalMessages;

							// Send streaming update after each remote
							if (mainWindow && !mainWindow.isDestroyed()) {
								mainWindow.webContents.send('agentSessions:globalStatsUpdate', { ...result });
							}
						} catch (error) {
							logger.warn(`Failed to count messages on ${remote.name}`, LOG_CONTEXT, { error });
						}
					}
				}

				// Mark as complete
				result.isComplete = true;
				result.messagesFetchInProgress = false;

				logger.info(
					`Global stats complete: ${result.totalSessions} queries, ${result.totalMessages} messages, $${result.totalCostUsd.toFixed(2)}`,
					LOG_CONTEXT
				);

				// Send final update
				if (mainWindow && !mainWindow.isDestroyed()) {
					mainWindow.webContents.send('agentSessions:globalStatsUpdate', result);
				}
			} catch (error) {
				logger.error('Failed to count messages', LOG_CONTEXT, { error });
				result.isComplete = true;
				result.messagesFetchInProgress = false;
				if (mainWindow && !mainWindow.isDestroyed()) {
					mainWindow.webContents.send('agentSessions:globalStatsUpdate', result);
				}
			}
		})();

		return result;
	});
}
