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
 * Result of a reconstruction operation
 */
export interface ReconstructionResult {
	queriesFound: number;
	queriesInserted: number;
	queriesUpdated: number;
	queriesSkipped: number;
	dateRangeCovered: { start: string; end: string } | null;
	errors: Array<{ file: string; error: string }>;
	duration: number;
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

	// 3. Handle SSH remotes if configured
	if (options.includeSshRemotes && options.sshConfigs) {
		for (const sshConfig of options.sshConfigs) {
			try {
				const remoteResult = await reconstructFromSshRemote(sshConfig, options);
				result.queriesFound += remoteResult.queriesFound;
				result.queriesInserted += remoteResult.queriesInserted;
				result.queriesUpdated += remoteResult.queriesUpdated;
				result.queriesSkipped += remoteResult.queriesSkipped;
				result.errors.push(...remoteResult.errors);

				// Update date range from remote data
				if (remoteResult.dateRangeCovered) {
					const remoteStart = new Date(remoteResult.dateRangeCovered.start).getTime();
					const remoteEnd = new Date(remoteResult.dateRangeCovered.end).getTime();
					if (minDate === null || remoteStart < minDate) minDate = remoteStart;
					if (maxDate === null || remoteEnd > maxDate) maxDate = remoteEnd;
				}
			} catch (error) {
				result.errors.push({ file: `ssh://${sshConfig.host}`, error: String(error) });
			}
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
// SSH Remote Reconstruction
// ============================================================================

/**
 * Reconstruct data from a remote SSH host.
 *
 * @param sshConfig - SSH configuration
 * @param options - Reconstruction options
 * @returns Reconstruction result for the remote
 */
async function reconstructFromSshRemote(
	sshConfig: { host: string; user: string; identityFile?: string },
	options: ReconstructionOptions
): Promise<ReconstructionResult> {
	const result: ReconstructionResult = {
		queriesFound: 0,
		queriesInserted: 0,
		queriesUpdated: 0,
		queriesSkipped: 0,
		dateRangeCovered: null,
		errors: [],
		duration: 0,
	};

	const startTime = Date.now();
	let minDate: number | null = null;
	let maxDate: number | null = null;

	try {
		// Build SSH command
		let sshCmd = `ssh ${sshConfig.user}@${sshConfig.host}`;
		if (sshConfig.identityFile) {
			sshCmd += ` -i ${sshConfig.identityFile}`;
		}

		// Run JSONL extraction script remotely
		const extractCmd = `${sshCmd} "cat ~/.claude/projects/*/*.jsonl 2>/dev/null || true"`;

		logger.info(`Fetching JSONL data from ${sshConfig.host}`, LOG_CONTEXT);
		const output = execSync(extractCmd, {
			encoding: 'utf8',
			maxBuffer: 100 * 1024 * 1024, // 100MB
			timeout: 300000, // 5 minutes
		});

		// Parse the concatenated JSONL output
		const lines = output.split('\n').filter((line) => line.trim());
		const entries: UsageEntry[] = [];

		for (const line of lines) {
			try {
				const entry = JSON.parse(line);
				if (entry.type === 'assistant' && entry.message?.usage) {
					entries.push({
						sessionId: entry.sessionId,
						timestamp: new Date(entry.timestamp).getTime(),
						uuid: entry.uuid,
						messageId: entry.message?.id || null,
						model: entry.message?.model || 'unknown',
						inputTokens: entry.message?.usage?.input_tokens || 0,
						outputTokens: entry.message?.usage?.output_tokens || 0,
						cacheReadTokens: entry.message?.usage?.cache_read_input_tokens || 0,
						cacheWriteTokens: entry.message?.usage?.cache_creation_input_tokens || 0,
					});
				}
			} catch {
				// Skip unparseable lines
			}
		}

		result.queriesFound = entries.length;
		logger.info(`Found ${entries.length} usage entries from ${sshConfig.host}`, LOG_CONTEXT);

		// Process entries
		for (const entry of entries) {
			// Track date range
			if (minDate === null || entry.timestamp < minDate) minDate = entry.timestamp;
			if (maxDate === null || entry.timestamp > maxDate) maxDate = entry.timestamp;

			// Apply date filter
			if (options.dateRange) {
				const entryDate = new Date(entry.timestamp).toISOString().split('T')[0];
				if (options.dateRange.start && entryDate < options.dateRange.start) continue;
				if (options.dateRange.end && entryDate > options.dateRange.end) continue;
			}

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

		// Set date range
		if (minDate && maxDate) {
			result.dateRangeCovered = {
				start: new Date(minDate).toISOString().split('T')[0],
				end: new Date(maxDate).toISOString().split('T')[0],
			};
		}
	} catch (error) {
		result.errors.push({
			file: `ssh://${sshConfig.host}`,
			error: String(error),
		});
	}

	result.duration = Date.now() - startTime;
	return result;
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
