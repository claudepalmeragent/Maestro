/**
 * Historical Reconstruction Service
 *
 * Reconstructs complete query-level historical data from Claude Code's JSONL files.
 * This fills in missing records and corrects existing ones with proper dual-source cost values.
 *
 * Claude Code stores per-message usage data in JSONL files at:
 * - Local: ~/.claude/projects/<encoded-project-path>/<session-id>.jsonl
 * - SSH Remotes: Same path on remote machines
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { getStatsDB } from '../stats';
import { logger } from '../utils/logger';
import {
	parseJsonlFile,
	extractUsageEntries,
	findJsonlFiles,
	UsageEntry,
} from '../utils/jsonl-parser';
import { calculateClaudeCostWithModel } from '../utils/pricing';
import { getPricingForModel } from '../utils/claude-pricing';
import { TOKENS_PER_MILLION } from '../constants';

const LOG_CONTEXT = '[HistoricalReconstruction]';

// ============================================================================
// Types
// ============================================================================

/**
 * Verification data comparing reconstructed totals against external sources
 */
export interface VerificationData {
	ccusageTotals?: CcusageAggregatedTotals;
	ccusageSessions?: CcusageSessionResult['sessions'];
	statsCacheTotals?: { totalTokens: number; hostCount: number };
	reconstructedTotals: {
		inputTokens: number;
		outputTokens: number;
		cacheReadTokens: number;
		cacheCreationTokens: number;
	};
	bashScriptExpected: {
		inputTokens: number;
		outputTokens: number;
		cacheReadTokens: number;
		cacheCreationTokens: number;
	};
}

/**
 * Result of a reconstruction operation
 */
export interface ReconstructionResult {
	queriesFound: number;
	queriesInserted: number;
	queriesUpdated: number;
	queriesSkipped: number;
	queriesBackfilled: number;
	dateRangeCovered: { start: string; end: string } | null;
	errors: Array<{ file: string; error: string }>;
	duration: number;
	verification?: VerificationData;
}

/**
 * Options for the reconstruction process
 */
export interface ReconstructionOptions {
	/** Include local agent data (default: true) */
	includeLocalAgents?: boolean;
	/** Include SSH remote agent data (default: false) */
	includeSshRemotes?: boolean;
	/** SSH remote configurations for fetching remote data */
	sshConfigs?: Array<{
		id: string;
		host: string;
		user: string;
		identityFile?: string;
	}>;
	/** Optional date range filter */
	dateRange?: {
		start?: string;
		end?: string;
	};
	/** Dry run mode - don't modify database */
	dryRun?: boolean;
	/** Custom base path for JSONL files (defaults to ~/.claude/projects) */
	basePath?: string;
}

// ============================================================================
// Main Reconstruction Function
// ============================================================================

/**
 * Reconstruct historical data from Claude Code's JSONL files.
 *
 * This function:
 * 1. Scans for all JSONL files in ~/.claude/projects/
 * 2. Extracts usage entries from each file
 * 3. For each entry, either inserts a new record or updates an existing one
 * 4. Optionally fetches data from SSH remotes
 *
 * @param options - Reconstruction options
 * @returns Result with statistics about the reconstruction
 *
 * @example
 * ```typescript
 * // Preview what would be reconstructed
 * const preview = await reconstructHistoricalData({ dryRun: true });
 * console.log(`Would process ${preview.queriesFound} queries`);
 *
 * // Run actual reconstruction
 * const result = await reconstructHistoricalData();
 * console.log(`Inserted ${result.queriesInserted}, updated ${result.queriesUpdated}`);
 * ```
 */
export async function reconstructHistoricalData(
	options: ReconstructionOptions = {}
): Promise<ReconstructionResult> {
	const startTime = Date.now();
	const result: ReconstructionResult = {
		queriesFound: 0,
		queriesInserted: 0,
		queriesUpdated: 0,
		queriesSkipped: 0,
		queriesBackfilled: 0,
		dateRangeCovered: null,
		errors: [],
		duration: 0,
	};

	let minDate: number | null = null;
	let maxDate: number | null = null;

	// 1. Find all JSONL files
	const projectsPath = options.basePath || path.join(os.homedir(), '.claude', 'projects');
	logger.info(`Scanning ${projectsPath} for JSONL files`, LOG_CONTEXT);

	let jsonlFiles: string[] = [];

	if (options.includeLocalAgents !== false) {
		try {
			jsonlFiles = await findJsonlFiles(projectsPath);
			logger.info(`Found ${jsonlFiles.length} local JSONL files`, LOG_CONTEXT);
		} catch (error) {
			result.errors.push({ file: projectsPath, error: String(error) });
		}
	}

	// 2. Process each file
	for (const file of jsonlFiles) {
		try {
			logger.debug(`Processing ${file}`, LOG_CONTEXT);
			const entries = await parseJsonlFile(file);
			const usageEntries = extractUsageEntries(entries);

			for (const entry of usageEntries) {
				result.queriesFound++;

				// Track date range
				if (minDate === null || entry.timestamp < minDate) minDate = entry.timestamp;
				if (maxDate === null || entry.timestamp > maxDate) maxDate = entry.timestamp;

				// Apply date filter if specified
				if (options.dateRange) {
					const entryDate = new Date(entry.timestamp).toISOString().split('T')[0];
					if (options.dateRange.start && entryDate < options.dateRange.start) continue;
					if (options.dateRange.end && entryDate > options.dateRange.end) continue;
				}

				// Process entry
				const processResult = await processUsageEntry(entry, options.dryRun);

				switch (processResult) {
					case 'inserted':
						result.queriesInserted++;
						break;
					case 'updated':
						result.queriesUpdated++;
						break;
					case 'skipped':
						result.queriesSkipped++;
						break;
				}
			}
		} catch (error) {
			result.errors.push({ file, error: String(error) });
			logger.error(`Error processing ${file}: ${error}`, LOG_CONTEXT);
		}
	}

	// 3. Handle SSH remotes if configured - use single-pass processing
	if (options.includeSshRemotes && options.sshConfigs && options.sshConfigs.length > 0) {
		try {
			const remoteResult = await reconstructFromAllSshRemotes(options.sshConfigs, options);
			result.queriesFound += remoteResult.queriesFound;
			result.queriesInserted += remoteResult.queriesInserted;
			result.queriesUpdated += remoteResult.queriesUpdated;
			result.queriesSkipped += remoteResult.queriesSkipped;
			result.errors.push(...remoteResult.errors);
			if (remoteResult.dateRangeCovered) {
				result.dateRangeCovered = remoteResult.dateRangeCovered;
			}
		} catch (error) {
			result.errors.push({ file: 'ssh-remotes', error: String(error) });
		}
	}

	// Set date range
	if (minDate && maxDate) {
		result.dateRangeCovered = {
			start: new Date(minDate).toISOString().split('T')[0],
			end: new Date(maxDate).toISOString().split('T')[0],
		};
	}

	result.duration = Date.now() - startTime;
	logger.info(
		`Reconstruction completed in ${result.duration}ms: found=${result.queriesFound}, inserted=${result.queriesInserted}, updated=${result.queriesUpdated}, skipped=${result.queriesSkipped}`,
		LOG_CONTEXT
	);

	return result;
}

// ============================================================================
// Entry Processing
// ============================================================================

/**
 * Process a single usage entry - insert, update, or skip.
 *
 * @param entry - The usage entry to process
 * @param dryRun - If true, don't modify the database
 * @returns 'inserted' | 'updated' | 'skipped'
 */
async function processUsageEntry(
	entry: UsageEntry,
	dryRun: boolean = false
): Promise<'inserted' | 'updated' | 'skipped'> {
	const db = getStatsDB();
	const database = db.database;

	// Check if we already have this entry
	const existing = database
		.prepare('SELECT id, anthropic_cost_usd, maestro_cost_usd FROM query_events WHERE uuid = ?')
		.get(entry.uuid) as
		| { id: string; anthropic_cost_usd: number | null; maestro_cost_usd: number | null }
		| undefined;

	// Calculate costs
	const anthropicCost = calculateApiCost(entry);
	const maestroCost = calculateMaestroCost(entry);

	if (existing) {
		// Already has complete dual-source data?
		if (existing.anthropic_cost_usd !== null && existing.maestro_cost_usd !== null) {
			return 'skipped';
		}

		// Update with missing values
		if (!dryRun) {
			database
				.prepare(
					`UPDATE query_events SET
						anthropic_cost_usd = COALESCE(anthropic_cost_usd, ?),
						anthropic_model = COALESCE(anthropic_model, ?),
						maestro_cost_usd = COALESCE(maestro_cost_usd, ?),
						maestro_pricing_model = COALESCE(maestro_pricing_model, ?),
						maestro_billing_mode = COALESCE(maestro_billing_mode, 'max'),
						maestro_calculated_at = ?
					WHERE id = ?`
				)
				.run(anthropicCost, entry.model, maestroCost, entry.model, Date.now(), existing.id);
		}
		return 'updated';
	}

	// Insert new record
	if (!dryRun) {
		const id = generateId();
		database
			.prepare(
				`INSERT INTO query_events (
					id, session_id, agent_type, source, start_time, duration,
					input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens,
					total_cost_usd,
					anthropic_cost_usd, anthropic_model,
					maestro_cost_usd, maestro_billing_mode, maestro_pricing_model, maestro_calculated_at,
					uuid, anthropic_message_id,
					is_reconstructed, reconstructed_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				id,
				entry.sessionId,
				'claude-code',
				'user', // Default source for reconstructed data
				entry.timestamp,
				0, // Duration unknown for reconstructed data
				entry.inputTokens,
				entry.outputTokens,
				entry.cacheReadTokens,
				entry.cacheWriteTokens,
				maestroCost, // Use Maestro cost as display value
				anthropicCost,
				entry.model,
				maestroCost,
				'max', // Default to max for historical data
				entry.model,
				Date.now(),
				entry.uuid,
				entry.messageId,
				1, // is_reconstructed = true
				Date.now()
			);
	}

	return 'inserted';
}

// ============================================================================
// Cost Calculation
// ============================================================================

/**
 * Calculate API cost for a usage entry using model-specific pricing.
 *
 * @param entry - The usage entry
 * @returns Cost in USD
 */
function calculateApiCost(entry: UsageEntry): number {
	const pricing = getPricingForModel(entry.model);

	if (!pricing) {
		// Fall back to default Sonnet pricing if model not found
		logger.warn(`Unknown model ${entry.model}, using default pricing`, LOG_CONTEXT);
		return calculateDefaultCost(entry);
	}

	const inputCost = (entry.inputTokens / TOKENS_PER_MILLION) * pricing.INPUT_PER_MILLION;
	const outputCost = (entry.outputTokens / TOKENS_PER_MILLION) * pricing.OUTPUT_PER_MILLION;
	const cacheReadCost =
		(entry.cacheReadTokens / TOKENS_PER_MILLION) * pricing.CACHE_READ_PER_MILLION;
	const cacheWriteCost =
		(entry.cacheWriteTokens / TOKENS_PER_MILLION) * pricing.CACHE_CREATION_PER_MILLION;

	return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}

/**
 * Calculate cost using default Sonnet 4 pricing.
 */
function calculateDefaultCost(entry: UsageEntry): number {
	const inputCost = (entry.inputTokens / TOKENS_PER_MILLION) * 3;
	const outputCost = (entry.outputTokens / TOKENS_PER_MILLION) * 15;
	const cacheReadCost = (entry.cacheReadTokens / TOKENS_PER_MILLION) * 0.3;
	const cacheWriteCost = (entry.cacheWriteTokens / TOKENS_PER_MILLION) * 3.75;

	return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}

/**
 * Calculate Maestro cost for a usage entry.
 * For historical reconstruction, assumes Max billing mode.
 *
 * @param entry - The usage entry
 * @returns Cost in USD
 */
function calculateMaestroCost(entry: UsageEntry): number {
	// For historical reconstruction, assume Max billing mode
	// (can be enhanced to lookup actual billing mode from session/agent config)
	return calculateClaudeCostWithModel(
		{
			inputTokens: entry.inputTokens,
			outputTokens: entry.outputTokens,
			cacheReadTokens: entry.cacheReadTokens,
			cacheCreationTokens: entry.cacheWriteTokens,
		},
		entry.model,
		'max' // Default to Max for reconstruction
	);
}

// ============================================================================
// JSONL File Download
// ============================================================================

/**
 * Download all JSONL files from SSH remote to local temp directory.
 * Preserves filenames so we can look up by Claude Session ID.
 *
 * @param sshCmd - SSH command prefix (e.g., "ssh user@host -i key")
 * @param host - Hostname for temp directory naming
 * @returns Object with tempDir path and Map of claudeSessionId -> local file path
 */
async function downloadJsonlFilesFromRemote(
	sshCmd: string,
	host: string
): Promise<{ tempDir: string; files: Map<string, string> }> {
	const tempDir = path.join(os.tmpdir(), 'maestro-reconstruction', host);
	const files = new Map<string, string>();

	// Create temp directory
	fs.mkdirSync(tempDir, { recursive: true });

	try {
		// Step 1: List all JSONL files on the remote (recursive search across all project directories)
		const listCmd = `${sshCmd} "find ~/.claude/projects -name '*.jsonl' 2>/dev/null || true"`;
		const listOutput = execSync(listCmd, { encoding: 'utf8', timeout: 60000 });
		const remoteFiles = listOutput.split('\n').filter((f) => f.trim());

		logger.info(`Found ${remoteFiles.length} JSONL files on remote ${host}`, LOG_CONTEXT);

		// Step 2: Download each file individually
		for (const remoteFile of remoteFiles) {
			const fileName = path.basename(remoteFile);
			const claudeSessionId = path.basename(remoteFile, '.jsonl');
			const localPath = path.join(tempDir, fileName);

			try {
				const catCmd = `${sshCmd} "cat '${remoteFile}'"`;
				const content = execSync(catCmd, {
					encoding: 'utf8',
					maxBuffer: 50 * 1024 * 1024,
					timeout: 120000,
				});

				fs.writeFileSync(localPath, content);
				files.set(claudeSessionId, localPath);

				logger.debug(`Downloaded: ${claudeSessionId}`, LOG_CONTEXT);
			} catch (error) {
				logger.warn(`Failed to download ${remoteFile}: ${error}`, LOG_CONTEXT);
			}
		}

		logger.info(`Downloaded ${files.size} JSONL files to ${tempDir}`, LOG_CONTEXT);
	} catch (error) {
		logger.error(`Failed to list/download JSONL files from ${host}`, LOG_CONTEXT, { error });
	}

	return { tempDir, files };
}

// ============================================================================
// History File Mapping (DEPRECATED - replaced by date-based matching in Task 25.3)
// ============================================================================
// NOTE: The functions buildMaestroToClaudeSessionMappingFromHistory and
// findClaudeSessionForQueryFromHistory have been removed as they are no longer
// needed. Date-based matching using buildJsonlDateIndex() and findFilesForDate()
// is now used instead, which is simpler and more reliable.

/**
 * Parse JSONL content and sum all usage entries within a time window.
 *
 * A single query can trigger many API calls (tool uses, subagents, etc.).
 * Each API call creates a JSONL entry. We need to SUM all tokens within
 * the query's time window, not just find one entry.
 *
 * @param content - JSONL file content
 * @param windowStart - Start of time window (query.start_time)
 * @param windowEnd - End of time window (next query.start_time - 1, or Infinity for last query)
 * @returns UsageEntry with summed tokens, or null if no entries found
 */
function parseJsonlAndFindUsage(
	content: string,
	windowStart: number,
	windowEnd: number
): UsageEntry | null {
	const lines = content.split('\n').filter((line) => line.trim());

	let totalInputTokens = 0;
	let totalOutputTokens = 0;
	let totalCacheReadTokens = 0;
	let totalCacheWriteTokens = 0;
	let entriesFound = 0;
	let model = 'unknown';
	let lastMessageId: string | null = null;
	let lastUuid: string | null = null;
	let lastSessionId: string | null = null;
	let lastTimestamp: number = windowStart;

	logger.info(
		`[JSONL-PARSE] windowStart=${windowStart}, windowEnd=${windowEnd}, totalLines=${lines.length}`,
		LOG_CONTEXT
	);

	for (const line of lines) {
		try {
			const entry = JSON.parse(line);

			// Only consider assistant messages with usage data
			if (entry.type !== 'assistant' || !entry.message?.usage) {
				continue;
			}

			const entryTimestamp = new Date(entry.timestamp).getTime();

			// Check if entry falls within our time window
			if (entryTimestamp >= windowStart && entryTimestamp <= windowEnd) {
				// Sum the tokens
				totalInputTokens += entry.message.usage.input_tokens || 0;
				totalOutputTokens += entry.message.usage.output_tokens || 0;
				totalCacheReadTokens += entry.message.usage.cache_read_input_tokens || 0;
				totalCacheWriteTokens += entry.message.usage.cache_creation_input_tokens || 0;

				entriesFound++;

				// Track the last entry's metadata
				if (entryTimestamp > lastTimestamp) {
					lastTimestamp = entryTimestamp;
					lastMessageId = entry.message?.id || null;
					lastUuid = entry.uuid || null;
					lastSessionId = entry.sessionId || null;
					if (entry.message?.model && entry.message.model !== 'unknown') {
						model = entry.message.model;
					}
				}
			}
		} catch {
			// Skip unparseable lines
		}
	}

	logger.info(
		`[JSONL-RESULT] entriesFound=${entriesFound}, totalInput=${totalInputTokens}, totalOutput=${totalOutputTokens}`,
		LOG_CONTEXT
	);

	if (entriesFound === 0) {
		return null;
	}

	return {
		sessionId: lastSessionId || '',
		timestamp: lastTimestamp,
		uuid: lastUuid || '',
		messageId: lastMessageId,
		model,
		inputTokens: totalInputTokens,
		outputTokens: totalOutputTokens,
		cacheReadTokens: totalCacheReadTokens,
		cacheWriteTokens: totalCacheWriteTokens,
	};
}

/**
 * Build an index of which dates each JSONL file has entries for.
 * Returns Map<claudeSessionId, Set<dateString>> where dateString is "YYYY-MM-DD"
 */
export function buildJsonlDateIndex(localFiles: Map<string, string>): Map<string, Set<string>> {
	const dateIndex = new Map<string, Set<string>>();

	for (const [claudeSessionId, filePath] of localFiles) {
		const dates = new Set<string>();

		try {
			const content = fs.readFileSync(filePath, 'utf8');
			const lines = content.split('\n').filter((line) => line.trim());

			for (const line of lines) {
				try {
					const entry = JSON.parse(line);
					if (entry.type === 'assistant' && entry.message?.usage && entry.timestamp) {
						// Extract date from timestamp (ISO string like "2026-02-03T05:47:06.425Z")
						const dateStr = entry.timestamp.substring(0, 10); // "YYYY-MM-DD"
						dates.add(dateStr);
					}
				} catch {
					// Skip unparseable lines
				}
			}
		} catch {
			// Skip unreadable files
		}

		if (dates.size > 0) {
			dateIndex.set(claudeSessionId, dates);
		}
	}

	logger.info(`[DATE-INDEX] Built index for ${dateIndex.size} files`, LOG_CONTEXT);
	return dateIndex;
}

/**
 * Find all Claude session IDs that have JSONL entries on the given date.
 */
export function findFilesForDate(
	queryDate: string, // "YYYY-MM-DD"
	dateIndex: Map<string, Set<string>>
): string[] {
	const matches: string[] = [];

	for (const [claudeSessionId, dates] of dateIndex) {
		if (dates.has(queryDate)) {
			matches.push(claudeSessionId);
		}
	}

	return matches;
}

// ============================================================================
// SSH Remote Reconstruction
// ============================================================================

/**
 * Reconstruct data from ALL SSH remotes using single-pass processing.
 *
 * Algorithm:
 * Phase 1: Download ALL JSONL files from ALL remotes (combined into one map)
 * Phase 2: Build history mapping for ALL Maestro Sessions
 * Phase 3: Get ALL queries
 * Phase 4: Process EACH query ONCE (using its session_id to find correct files)
 *
 * @param sshConfigs - Array of SSH configurations for all remotes
 * @param options - Reconstruction options
 * @returns Reconstruction result
 */
async function reconstructFromAllSshRemotes(
	sshConfigs: Array<{ id: string; host: string; user: string; identityFile?: string }>,
	options: ReconstructionOptions
): Promise<ReconstructionResult> {
	const result: ReconstructionResult = {
		queriesFound: 0,
		queriesInserted: 0,
		queriesUpdated: 0,
		queriesSkipped: 0,
		queriesBackfilled: 0,
		dateRangeCovered: null,
		errors: [],
		duration: 0,
	};

	const startTime = Date.now();
	let minDate: number | null = null;
	let maxDate: number | null = null;

	try {
		// Phase 1: Download ALL JSONL files from ALL remotes
		logger.info(
			`Phase 1: Downloading JSONL files from ${sshConfigs.length} SSH remotes...`,
			LOG_CONTEXT
		);

		const allLocalFiles = new Map<string, string>(); // claudeSessionId -> localFilePath

		for (const sshConfig of sshConfigs) {
			let sshCmd = `ssh ${sshConfig.user}@${sshConfig.host}`;
			if (sshConfig.identityFile) {
				sshCmd += ` -i ${sshConfig.identityFile}`;
			}

			const { files: remoteFiles } = await downloadJsonlFilesFromRemote(sshCmd, sshConfig.host);

			// Merge into combined map
			for (const [claudeSessionId, localPath] of remoteFiles) {
				allLocalFiles.set(claudeSessionId, localPath);
			}
		}

		logger.info(`Downloaded ${allLocalFiles.size} total JSONL files from all remotes`, LOG_CONTEXT);

		if (allLocalFiles.size === 0) {
			logger.warn('No JSONL files downloaded from any remote', LOG_CONTEXT);
			result.duration = Date.now() - startTime;
			return result;
		}

		// Build date index for efficient matching
		logger.info('Building JSONL date index...', LOG_CONTEXT);
		const jsonlDateIndex = buildJsonlDateIndex(allLocalFiles);

		// Phase 2: Get database and queries (history mapping no longer needed with date-based matching)
		const db = getStatsDB();
		const database = db.database;

		// Phase 3: Get ALL queries ONCE
		logger.info('Phase 3: Getting all queries...', LOG_CONTEXT);

		const queryEvents = database
			.prepare(
				`SELECT id, session_id, start_time, duration
				 FROM query_events
				 ORDER BY start_time ASC`
			)
			.all() as Array<{
			id: string;
			session_id: string;
			start_time: number;
			duration: number | null;
		}>;

		result.queriesFound = queryEvents.length;
		logger.info(`Found ${queryEvents.length} total queries to process`, LOG_CONTEXT);

		// Phase 4: Process EACH query ONCE
		logger.info('Phase 4: Processing queries (single pass)...', LOG_CONTEXT);

		// Cache file contents to avoid re-reading
		const fileContentCache = new Map<string, string>();

		function getCachedFileContent(claudeSessionId: string): string | null {
			if (fileContentCache.has(claudeSessionId)) {
				return fileContentCache.get(claudeSessionId)!;
			}
			const filePath = allLocalFiles.get(claudeSessionId);
			if (!filePath) return null;
			try {
				const content = fs.readFileSync(filePath, 'utf8');
				fileContentCache.set(claudeSessionId, content);
				return content;
			} catch {
				return null;
			}
		}

		for (const query of queryEvents) {
			// Apply date filter if specified
			if (options.dateRange) {
				const queryDate = new Date(query.start_time).toISOString().split('T')[0];
				if (options.dateRange.start && queryDate < options.dateRange.start) continue;
				if (options.dateRange.end && queryDate > options.dateRange.end) continue;
			}

			// Track date range
			if (minDate === null || query.start_time < minDate) minDate = query.start_time;
			if (maxDate === null || query.start_time > maxDate) maxDate = query.start_time;

			// Get the query date
			const queryDate = new Date(query.start_time).toISOString().substring(0, 10);

			// Find JSONL files that have entries on this date
			const candidateFiles = findFilesForDate(queryDate, jsonlDateIndex);

			if (candidateFiles.length === 0) {
				logger.info(
					`[SKIP-NO-FILES] query=${query.id}, date=${queryDate}, no files have entries for this date`,
					LOG_CONTEXT
				);
				result.queriesSkipped++;
				continue;
			}

			// Sum tokens from ALL files that have entries in the query's time window
			// Calculate time window for this query
			const currentIndex = queryEvents.indexOf(query);
			const nextQuery = queryEvents[currentIndex + 1];
			const windowEnd = nextQuery ? nextQuery.start_time - 1 : Number.MAX_SAFE_INTEGER;

			// Accumulate totals across all matching files
			let totalInputTokens = 0;
			let totalOutputTokens = 0;
			let totalCacheReadTokens = 0;
			let totalCacheWriteTokens = 0;
			let matchedFiles = 0;
			let model = 'unknown';
			let lastMessageId: string | null = null;

			for (const claudeSessionId of candidateFiles) {
				const fileContent = getCachedFileContent(claudeSessionId);
				if (!fileContent) {
					continue;
				}

				const fileUsageData = parseJsonlAndFindUsage(fileContent, query.start_time, windowEnd);
				if (
					fileUsageData &&
					(fileUsageData.inputTokens + fileUsageData.outputTokens > 0 ||
						fileUsageData.cacheReadTokens > 0 ||
						fileUsageData.cacheWriteTokens > 0)
				) {
					totalInputTokens += fileUsageData.inputTokens;
					totalOutputTokens += fileUsageData.outputTokens;
					totalCacheReadTokens += fileUsageData.cacheReadTokens;
					totalCacheWriteTokens += fileUsageData.cacheWriteTokens;
					matchedFiles++;

					// Keep track of model and message ID from the last entry
					if (fileUsageData.model && fileUsageData.model !== 'unknown') {
						model = fileUsageData.model;
					}
					if (fileUsageData.messageId) {
						lastMessageId = fileUsageData.messageId;
					}
				}
			}

			if (matchedFiles === 0) {
				logger.info(
					`[SKIP-NO-USAGE] query=${query.id}, date=${queryDate}, checked ${candidateFiles.length} files, none had entries in time window`,
					LOG_CONTEXT
				);
				result.queriesSkipped++;
				continue;
			}

			// Build combined usage data
			const usageData: UsageEntry = {
				sessionId: query.session_id,
				timestamp: query.start_time,
				uuid: '',
				messageId: lastMessageId,
				model,
				inputTokens: totalInputTokens,
				outputTokens: totalOutputTokens,
				cacheReadTokens: totalCacheReadTokens,
				cacheWriteTokens: totalCacheWriteTokens,
			};

			logger.info(
				`[MATCH-COMBINED] query=${query.id}, files=${matchedFiles}, input=${totalInputTokens}, output=${totalOutputTokens}, cacheRead=${totalCacheReadTokens}`,
				LOG_CONTEXT
			);

			// Calculate costs
			const anthropicCost = calculateApiCost(usageData);
			const maestroCost = calculateMaestroCost(usageData);
			const tokensPerSecond =
				query.duration && query.duration > 0
					? usageData.outputTokens / (query.duration / 1000)
					: null;

			// Update query_events row with ALL fields
			if (!options.dryRun) {
				database
					.prepare(
						`UPDATE query_events SET
						   input_tokens = ?,
						   output_tokens = ?,
						   tokens_per_second = ?,
						   cache_read_input_tokens = ?,
						   cache_creation_input_tokens = ?,
						   total_cost_usd = ?,
						   anthropic_cost_usd = ?,
						   anthropic_model = ?,
						   maestro_cost_usd = ?,
						   maestro_billing_mode = ?,
						   maestro_pricing_model = ?,
						   maestro_calculated_at = ?,
						   anthropic_message_id = ?,
						   is_reconstructed = 1,
						   reconstructed_at = ?,
						   claude_session_id = NULL
						 WHERE id = ?`
					)
					.run(
						usageData.inputTokens,
						usageData.outputTokens,
						tokensPerSecond,
						usageData.cacheReadTokens,
						usageData.cacheWriteTokens,
						maestroCost,
						anthropicCost,
						usageData.model,
						maestroCost,
						'max',
						usageData.model,
						Date.now(),
						usageData.messageId,
						Date.now(),
						query.id
					);
			}

			logger.info(
				`[UPDATE-SUCCESS] query=${query.id}, input=${usageData.inputTokens}, output=${usageData.outputTokens}, cacheRead=${usageData.cacheReadTokens}, files=${matchedFiles}`,
				LOG_CONTEXT
			);
			result.queriesUpdated++;
		}

		// Set date range
		if (minDate && maxDate) {
			result.dateRangeCovered = {
				start: new Date(minDate).toISOString().split('T')[0],
				end: new Date(maxDate).toISOString().split('T')[0],
			};
		}

		// Phase 5: Collect verification data
		logger.info('Phase 5: Collecting verification data...', LOG_CONTEXT);

		// Sum reconstructed totals from the updated database
		const reconstructedTotals = database
			.prepare(
				`SELECT
				   SUM(input_tokens) as inputTokens,
				   SUM(output_tokens) as outputTokens,
				   SUM(cache_read_input_tokens) as cacheReadTokens,
				   SUM(cache_creation_input_tokens) as cacheCreationTokens
				 FROM query_events
				 WHERE is_reconstructed = 1`
			)
			.get() as
			| {
					inputTokens: number | null;
					outputTokens: number | null;
					cacheReadTokens: number | null;
					cacheCreationTokens: number | null;
			  }
			| undefined;

		// Build verification data
		const bashScriptExpected = {
			inputTokens: 1034260,
			outputTokens: 345028,
			cacheReadTokens: 1659890022,
			cacheCreationTokens: 95297169,
		};

		result.verification = {
			reconstructedTotals: {
				inputTokens: reconstructedTotals?.inputTokens || 0,
				outputTokens: reconstructedTotals?.outputTokens || 0,
				cacheReadTokens: reconstructedTotals?.cacheReadTokens || 0,
				cacheCreationTokens: reconstructedTotals?.cacheCreationTokens || 0,
			},
			bashScriptExpected,
		};

		// Log comparison
		logger.info(
			`[VERIFICATION] Reconstructed vs bash script expected:
  Input:        ${result.verification.reconstructedTotals.inputTokens.toLocaleString()} vs ${bashScriptExpected.inputTokens.toLocaleString()} (${((result.verification.reconstructedTotals.inputTokens / bashScriptExpected.inputTokens) * 100).toFixed(1)}%)
  Output:       ${result.verification.reconstructedTotals.outputTokens.toLocaleString()} vs ${bashScriptExpected.outputTokens.toLocaleString()} (${((result.verification.reconstructedTotals.outputTokens / bashScriptExpected.outputTokens) * 100).toFixed(1)}%)
  Cache Read:   ${result.verification.reconstructedTotals.cacheReadTokens.toLocaleString()} vs ${bashScriptExpected.cacheReadTokens.toLocaleString()} (${((result.verification.reconstructedTotals.cacheReadTokens / bashScriptExpected.cacheReadTokens) * 100).toFixed(1)}%)
  Cache Create: ${result.verification.reconstructedTotals.cacheCreationTokens.toLocaleString()} vs ${bashScriptExpected.cacheCreationTokens.toLocaleString()} (${((result.verification.reconstructedTotals.cacheCreationTokens / bashScriptExpected.cacheCreationTokens) * 100).toFixed(1)}%)
`,
			LOG_CONTEXT
		);
	} catch (error) {
		logger.error('SSH remote reconstruction failed', LOG_CONTEXT, { error });
		result.errors.push({ file: 'ssh-reconstruction', error: String(error) });
	}

	result.duration = Date.now() - startTime;
	logger.info(
		`Reconstruction completed: found=${result.queriesFound}, updated=${result.queriesUpdated}, skipped=${result.queriesSkipped}`,
		LOG_CONTEXT
	);

	return result;
}

// ============================================================================
// Stats Cache Functions (Task 27.5.1)
// ============================================================================

/**
 * Structure of stats-cache.json from Claude Code
 */
export interface StatsCacheData {
	version: number;
	lastComputedDate: string;
	dailyModelTokens: Array<{
		date: string;
		tokensByModel: Record<string, number>;
	}>;
}

/**
 * Download stats-cache.json from all SSH hosts.
 * This file contains daily token aggregates that can be used for cross-reference verification.
 *
 * @param sshConfigs - Array of SSH configurations
 * @param tempDir - Directory to store downloaded files
 * @returns Map of hostname to parsed stats cache data
 */
export async function downloadStatsCacheFromAllHosts(
	sshConfigs: Array<{ id: string; host: string; user: string; identityFile?: string }>,
	tempDir: string
): Promise<Map<string, StatsCacheData>> {
	const results = new Map<string, StatsCacheData>();

	// Create temp directory
	fs.mkdirSync(tempDir, { recursive: true });

	for (const sshConfig of sshConfigs) {
		try {
			let sshCmd = `ssh ${sshConfig.user}@${sshConfig.host}`;
			if (sshConfig.identityFile) {
				sshCmd += ` -i ${sshConfig.identityFile}`;
			}

			const remotePath = '~/.claude/stats-cache.json';
			const localPath = path.join(tempDir, `${sshConfig.host}-stats-cache.json`);

			// Download file using cat command (consistent with existing pattern)
			const catCmd = `${sshCmd} "cat '${remotePath}'" 2>/dev/null`;
			const content = execSync(catCmd, {
				encoding: 'utf8',
				maxBuffer: 10 * 1024 * 1024,
				timeout: 30000,
			});

			fs.writeFileSync(localPath, content);
			const data = JSON.parse(content) as StatsCacheData;
			results.set(sshConfig.host, data);
			logger.info(
				`[STATS-CACHE] Downloaded from ${sshConfig.host}: version=${data.version}, lastDate=${data.lastComputedDate}`,
				LOG_CONTEXT
			);
		} catch (error) {
			logger.warn(`[STATS-CACHE] Failed to download from ${sshConfig.host}: ${error}`, LOG_CONTEXT);
		}
	}

	return results;
}

/**
 * Aggregate stats-cache data across all hosts.
 * Returns totals for all token types by date.
 *
 * @param statsCacheMap - Map of hostname to stats cache data
 * @returns Aggregated totals
 */
export function aggregateStatsCacheTotals(statsCacheMap: Map<string, StatsCacheData>): {
	totalTokens: number;
	hostCount: number;
	byDate: Map<string, number>;
} {
	let totalTokens = 0;
	const byDate = new Map<string, number>();

	for (const [_host, data] of statsCacheMap) {
		if (data.dailyModelTokens) {
			for (const day of data.dailyModelTokens) {
				let dayTotal = 0;
				for (const modelTokens of Object.values(day.tokensByModel)) {
					dayTotal += modelTokens;
					totalTokens += modelTokens;
				}
				byDate.set(day.date, (byDate.get(day.date) || 0) + dayTotal);
			}
		}
	}

	return { totalTokens, hostCount: statsCacheMap.size, byDate };
}

// ============================================================================
// ccusage Session Functions (Task 27.5.2, 27.5.3)
// ============================================================================

/**
 * Result structure from ccusage session command
 */
export interface CcusageSessionResult {
	sessions: Array<{
		sessionId: string;
		projectPath: string; // Contains Maestro session UUID
		inputTokens: number;
		outputTokens: number;
		cacheCreationTokens: number;
		cacheReadTokens: number;
		totalCost: number;
		lastActivity: string;
		modelsUsed: string[];
	}>;
}

/**
 * Aggregated totals from ccusage across all hosts
 */
export interface CcusageAggregatedTotals {
	inputTokens: number;
	outputTokens: number;
	cacheCreationTokens: number;
	cacheReadTokens: number;
	totalCost: number;
	sessionCount: number;
}

/**
 * Execute a command on a remote host via SSH.
 * Uses execSync for simplicity and consistency with existing patterns.
 *
 * @param host - SSH host
 * @param user - SSH user
 * @param command - Command to execute
 * @param identityFile - Optional SSH identity file
 * @returns Object with stdout, stderr, and exitCode
 */
export function sshExecCommand(
	host: string,
	user: string,
	command: string,
	identityFile?: string
): { stdout: string; stderr: string; exitCode: number } {
	let sshCmd = `ssh ${user}@${host}`;
	if (identityFile) {
		sshCmd += ` -i ${identityFile}`;
	}

	// Use bash -lc to get a login shell environment (loads .profile, nvm, etc.)
	// Escape the command for proper shell handling
	const escapedCommand = command.replace(/'/g, "'\\''");
	const fullCmd = `${sshCmd} "bash -lc '${escapedCommand}'" 2>&1`;

	try {
		const stdout = execSync(fullCmd, {
			encoding: 'utf8',
			maxBuffer: 50 * 1024 * 1024, // 50MB for large session outputs
			timeout: 120000, // 2 minute timeout for ccusage
		});
		return { stdout, stderr: '', exitCode: 0 };
	} catch (error: unknown) {
		const execError = error as {
			status?: number;
			stdout?: string;
			stderr?: string;
			message?: string;
		};
		return {
			stdout: execError.stdout || '',
			stderr: execError.stderr || execError.message || String(error),
			exitCode: execError.status || 1,
		};
	}
}

/**
 * Run ccusage session command on a single host and parse results.
 *
 * @param sshConfig - SSH configuration for the host
 * @param sinceDate - Date string in format YYYYMMDD
 * @returns Parsed ccusage session result or null on failure
 */
export function runCcusageSessionOnHost(
	sshConfig: { id: string; host: string; user: string; identityFile?: string },
	sinceDate: string
): CcusageSessionResult | null {
	try {
		// Use npx to run ccusage with session mode
		const command = `npx ccusage@latest session --since ${sinceDate} --json`;
		const result = sshExecCommand(sshConfig.host, sshConfig.user, command, sshConfig.identityFile);

		if (result.exitCode !== 0) {
			logger.warn(`[CCUSAGE] Command failed on ${sshConfig.host}: ${result.stderr}`, LOG_CONTEXT);
			return null;
		}

		if (!result.stdout || result.stdout.trim() === '') {
			logger.warn(`[CCUSAGE] Empty output from ${sshConfig.host}`, LOG_CONTEXT);
			return null;
		}

		// Parse JSON output - ccusage outputs JSON when --json flag is used
		const parsed = JSON.parse(result.stdout) as CcusageSessionResult;
		logger.info(
			`[CCUSAGE] Got ${parsed.sessions?.length || 0} sessions from ${sshConfig.host}`,
			LOG_CONTEXT
		);
		return parsed;
	} catch (error) {
		logger.warn(`[CCUSAGE] Failed on ${sshConfig.host}: ${error}`, LOG_CONTEXT);
		return null;
	}
}

/**
 * Run ccusage on all SSH hosts and aggregate results.
 *
 * @param sshConfigs - Array of SSH configurations
 * @param sinceDate - Date string in format YYYYMMDD
 * @returns Aggregated totals and all session data
 */
export function aggregateCcusageSessionsFromAllHosts(
	sshConfigs: Array<{ id: string; host: string; user: string; identityFile?: string }>,
	sinceDate: string
): {
	totals: CcusageAggregatedTotals;
	allSessions: CcusageSessionResult['sessions'];
	byHost: Map<string, CcusageSessionResult>;
} {
	const allSessions: CcusageSessionResult['sessions'] = [];
	const byHost = new Map<string, CcusageSessionResult>();

	for (const sshConfig of sshConfigs) {
		const result = runCcusageSessionOnHost(sshConfig, sinceDate);
		if (result?.sessions) {
			byHost.set(sshConfig.host, result);
			allSessions.push(...result.sessions);
		}
	}

	const totals: CcusageAggregatedTotals = {
		inputTokens: allSessions.reduce((sum, s) => sum + (s.inputTokens || 0), 0),
		outputTokens: allSessions.reduce((sum, s) => sum + (s.outputTokens || 0), 0),
		cacheCreationTokens: allSessions.reduce((sum, s) => sum + (s.cacheCreationTokens || 0), 0),
		cacheReadTokens: allSessions.reduce((sum, s) => sum + (s.cacheReadTokens || 0), 0),
		totalCost: allSessions.reduce((sum, s) => sum + (s.totalCost || 0), 0),
		sessionCount: allSessions.length,
	};

	logger.info(
		`[CCUSAGE] Aggregated ${allSessions.length} sessions from ${byHost.size} hosts`,
		LOG_CONTEXT
	);
	logger.info(
		`[CCUSAGE] Totals: input=${totals.inputTokens}, output=${totals.outputTokens}, cacheRead=${totals.cacheReadTokens}, cacheCreate=${totals.cacheCreationTokens}`,
		LOG_CONTEXT
	);

	return { totals, allSessions, byHost };
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Generate a unique ID for database records.
 * Uses a combination of timestamp and random bytes.
 */
function generateId(): string {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).substring(2, 8);
	return `${timestamp}-${random}`;
}
