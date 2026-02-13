/**
 * Anthropic Audit Service
 *
 * Integrates with ccusage to fetch Anthropic's usage data and compare it
 * against Maestro's recorded data. Supports both local and SSH remote agents.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { getStatsDB } from '../stats';
import { logger } from '../utils/logger';
import { SshRemoteConfig } from '../../shared/types';
import { SshRemoteManager } from '../ssh-remote-manager';
import { getPricingForModel } from '../utils/claude-pricing';
import { getSettingsStore } from '../stores/getters';

const execAsync = promisify(exec);
const LOG_CONTEXT = '[AnthropicAudit]';

// ============================================================================
// Types
// ============================================================================

/**
 * Daily usage data from Anthropic (via ccusage)
 */
export interface AnthropicDailyUsage {
	date: string;
	inputTokens: number;
	outputTokens: number;
	cacheCreationTokens: number;
	cacheReadTokens: number;
	totalTokens: number;
	totalCost: number;
	modelsUsed: string[];
	modelBreakdowns: Array<{
		modelName: string;
		inputTokens: number;
		outputTokens: number;
		cacheCreationTokens: number;
		cacheReadTokens: number;
		cost: number;
	}>;
}

/**
 * Token count breakdown
 */
export interface TokenCounts {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
}

/**
 * Audit result comparing Anthropic and Maestro data
 */
export interface AuditResult {
	period: { start: string; end: string };
	generatedAt: number;

	tokens: {
		anthropic: TokenCounts;
		maestro: TokenCounts;
		difference: TokenCounts;
		percentDiff: number;
	};

	costs: {
		anthropic_total: number;
		maestro_anthropic: number;
		maestro_calculated: number;
		discrepancy: number;
		savings: number;
	};

	modelBreakdown: Array<{
		model: string;
		anthropic: { tokens: TokenCounts; cost: number };
		maestro: { tokens: TokenCounts; cost: number };
		match: boolean;
	}>;

	anomalies: Array<{
		type: 'missing_query' | 'token_mismatch' | 'cost_mismatch' | 'model_mismatch';
		severity: 'info' | 'warning' | 'error';
		description: string;
		details: unknown;
	}>;
}

/**
 * Audit configuration settings
 */
export interface AuditConfig {
	dailyEnabled: boolean;
	dailyTime: string; // HH:MM format
	weeklyEnabled: boolean;
	weeklyDay: number; // 0-6 (Sunday-Saturday)
	monthlyEnabled: boolean;
}

/**
 * Individual audit entry comparing a single day/model/billing combination
 */
export interface AuditEntry {
	id: string;
	date: string;
	model: string;
	billingMode: 'api' | 'max' | 'unknown';
	tokens: {
		anthropic: TokenCounts;
		maestro: TokenCounts;
	};
	costs: {
		anthropicCost: number;
		maestroCost: number;
	};
	status: 'match' | 'minor' | 'major' | 'missing';
	discrepancyPercent: number;
}

/**
 * Billing mode breakdown for audit summary
 */
export interface BillingModeBreakdown {
	api: {
		entryCount: number;
		anthropicCost: number;
		maestroCost: number;
		tokenCount: number;
	};
	max: {
		entryCount: number;
		anthropicCost: number;
		maestroCost: number;
		cacheSavings: number;
		tokenCount: number;
	};
}

/**
 * Model breakdown for audit summary
 */
export interface ModelBreakdownEntry {
	model: string;
	anthropic: { tokens: TokenCounts; cost: number };
	maestro: { tokens: TokenCounts; cost: number };
	entryCount: number;
	discrepancyPercent: number;
	match: boolean;
}

/**
 * Extended audit result with entry-level data
 */
export interface ExtendedAuditResult extends AuditResult {
	entries: AuditEntry[];
	billingModeBreakdown: BillingModeBreakdown;
	summary: {
		total: number;
		matches: number;
		minorDiscrepancies: number;
		majorDiscrepancies: number;
		missing: number;
	};
}

// ============================================================================
// ccusage Integration
// ============================================================================

/**
 * Fetch Anthropic usage data via ccusage CLI tool.
 *
 * @param period - Time period to fetch ('daily', 'weekly', 'monthly')
 * @param since - Start date (YYYY-MM-DD)
 * @param until - End date (YYYY-MM-DD)
 * @returns Array of daily usage records
 */
export async function fetchAnthropicUsage(
	period: 'daily' | 'weekly' | 'monthly',
	since?: string,
	until?: string
): Promise<AnthropicDailyUsage[]> {
	// Convert YYYY-MM-DD to YYYYMMDD format required by ccusage
	const formatDate = (date: string): string => date.replace(/-/g, '');

	const args = ['--json'];
	if (since) args.push('--since', formatDate(since));
	if (until) args.push('--until', formatDate(until));

	try {
		logger.info(
			`Fetching Anthropic usage: period=${period}, since=${since}, until=${until}`,
			LOG_CONTEXT
		);

		const { stdout } = await execAsync(`npx ccusage@latest ${period} ${args.join(' ')}`, {
			encoding: 'utf8',
			timeout: 60000,
			maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large outputs
		});

		// Validate that stdout is JSON before parsing
		const trimmed = stdout.trim();
		if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
			// ccusage returned an error message instead of JSON
			throw new Error(`ccusage error: ${trimmed.substring(0, 200)}`);
		}

		const result = JSON.parse(trimmed);

		// Handle different response structures from ccusage
		const usageData = result[period] || result.daily || result.data || [];

		logger.info(`Fetched ${usageData.length} usage records from Anthropic`, LOG_CONTEXT);
		return normalizeAnthropicData(usageData);
	} catch (error) {
		const err = error as Error & { message?: string };
		logger.error(`Error fetching Anthropic usage: ${err.message}`, LOG_CONTEXT);

		if (err.message?.includes('ENOENT')) {
			throw new Error('npx not found. Please ensure Node.js is installed.');
		}
		if (err.message?.includes('timeout')) {
			throw new Error('ccusage timed out. The data set may be too large.');
		}
		throw error;
	}
}

/**
 * Fetch Anthropic usage data from a remote host via SSH.
 *
 * @param sshConfig - SSH remote configuration
 * @param period - Time period to fetch
 * @param since - Start date
 * @param until - End date
 * @returns Array of daily usage records from the remote
 */
export async function fetchRemoteAnthropicUsage(
	sshConfig: SshRemoteConfig,
	period: 'daily' | 'weekly' | 'monthly',
	since?: string,
	until?: string
): Promise<AnthropicDailyUsage[]> {
	// Convert YYYY-MM-DD to YYYYMMDD format required by ccusage
	const formatDate = (date: string): string => date.replace(/-/g, '');

	const sshManager = new SshRemoteManager();
	const sshArgs = sshManager.buildSshArgs(sshConfig);

	// Build the ccusage command for remote execution
	let ccusageCmd = `npx ccusage@latest ${period} --json`;
	if (since) ccusageCmd += ` --since ${formatDate(since)}`;
	if (until) ccusageCmd += ` --until ${formatDate(until)}`;

	// Wrap in double quotes for SSH command execution
	sshArgs.push(ccusageCmd);

	try {
		logger.info(
			`Fetching remote Anthropic usage from ${sshConfig.host}: period=${period}`,
			LOG_CONTEXT
		);

		const { stdout } = await execAsync(`ssh ${sshArgs.join(' ')}`, {
			encoding: 'utf8',
			timeout: 120000, // Longer timeout for SSH
			maxBuffer: 10 * 1024 * 1024,
		});

		// Validate that stdout is JSON before parsing
		const trimmed = stdout.trim();
		if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
			// ccusage returned an error message instead of JSON
			throw new Error(`ccusage error: ${trimmed.substring(0, 200)}`);
		}

		const result = JSON.parse(trimmed);
		const usageData = result[period] || result.daily || result.data || [];

		logger.info(
			`Fetched ${usageData.length} usage records from remote ${sshConfig.host}`,
			LOG_CONTEXT
		);
		return normalizeAnthropicData(usageData);
	} catch (error) {
		const err = error as Error;
		logger.error(`Error fetching remote usage from ${sshConfig.host}: ${err.message}`, LOG_CONTEXT);
		throw new Error(`Failed to fetch usage from ${sshConfig.host}: ${err.message}`);
	}
}

/**
 * Normalize ccusage data to our internal format.
 * Handles variations in field names from different ccusage versions.
 */
function normalizeAnthropicData(data: unknown[]): AnthropicDailyUsage[] {
	return data.map((item: unknown) => {
		const record = item as Record<string, unknown>;
		return {
			date: (record.date || record.day) as string,
			inputTokens: (record.inputTokens || record.input_tokens || 0) as number,
			outputTokens: (record.outputTokens || record.output_tokens || 0) as number,
			cacheCreationTokens: (record.cacheCreationTokens ||
				record.cache_creation_tokens ||
				0) as number,
			cacheReadTokens: (record.cacheReadTokens || record.cache_read_tokens || 0) as number,
			totalTokens: (record.totalTokens || record.total_tokens || 0) as number,
			totalCost: (record.totalCost || record.total_cost || record.cost || 0) as number,
			modelsUsed: (record.modelsUsed || record.models_used || []) as string[],
			modelBreakdowns: normalizeModelBreakdowns(
				(record.modelBreakdowns || record.model_breakdowns || []) as unknown[]
			),
		};
	});
}

/**
 * Normalize model breakdown data from ccusage.
 */
function normalizeModelBreakdowns(breakdowns: unknown[]): AnthropicDailyUsage['modelBreakdowns'] {
	return breakdowns.map((item: unknown) => {
		const b = item as Record<string, unknown>;
		return {
			modelName: (b.modelName || b.model_name || b.model || 'unknown') as string,
			inputTokens: (b.inputTokens || b.input_tokens || 0) as number,
			outputTokens: (b.outputTokens || b.output_tokens || 0) as number,
			cacheCreationTokens: (b.cacheCreationTokens || b.cache_creation_tokens || 0) as number,
			cacheReadTokens: (b.cacheReadTokens || b.cache_read_tokens || 0) as number,
			cost: (b.cost || 0) as number,
		};
	});
}

// ============================================================================
// Maestro Usage Query
// ============================================================================

/**
 * Query Maestro's recorded usage data by date range with billing mode and model breakdown.
 *
 * @param startDate - Start date (YYYY-MM-DD)
 * @param endDate - End date (YYYY-MM-DD)
 * @returns Map of composite key (date|model|billingMode) to usage data
 */
export async function queryMaestroUsageByDate(
	startDate: string,
	endDate: string
): Promise<
	Map<
		string,
		{
			date: string;
			model: string;
			billingMode: 'api' | 'max' | 'unknown';
			tokens: TokenCounts;
			anthropicCost: number;
			maestroCost: number;
			entryCount: number;
		}
	>
> {
	const db = getStatsDB();
	const database = db.database;

	const sql = `
		SELECT
			date(start_time / 1000, 'unixepoch') as date,
			COALESCE(anthropic_model, detected_model, 'unknown') as model,
			COALESCE(maestro_billing_mode, 'unknown') as billing_mode,
			SUM(input_tokens) as input_tokens,
			SUM(output_tokens) as output_tokens,
			SUM(cache_read_input_tokens) as cache_read_tokens,
			SUM(cache_creation_input_tokens) as cache_write_tokens,
			COALESCE(SUM(anthropic_cost_usd), SUM(total_cost_usd)) as anthropic_cost,
			COALESCE(SUM(maestro_cost_usd), SUM(total_cost_usd)) as maestro_cost,
			COUNT(*) as entry_count
		FROM query_events
		WHERE date(start_time / 1000, 'unixepoch') >= ?
			AND date(start_time / 1000, 'unixepoch') <= ?
		GROUP BY date(start_time / 1000, 'unixepoch'),
			COALESCE(anthropic_model, detected_model, 'unknown'),
			COALESCE(maestro_billing_mode, 'unknown')
		ORDER BY date, model, billing_mode
	`;

	const rows = database.prepare(sql).all(startDate, endDate) as Array<{
		date: string;
		model: string;
		billing_mode: string;
		input_tokens: number | null;
		output_tokens: number | null;
		cache_read_tokens: number | null;
		cache_write_tokens: number | null;
		anthropic_cost: number | null;
		maestro_cost: number | null;
		entry_count: number;
	}>;

	const result = new Map<
		string,
		{
			date: string;
			model: string;
			billingMode: 'api' | 'max' | 'unknown';
			tokens: TokenCounts;
			anthropicCost: number;
			maestroCost: number;
			entryCount: number;
		}
	>();

	for (const row of rows) {
		const billingMode =
			row.billing_mode === 'api' || row.billing_mode === 'max' ? row.billing_mode : 'unknown';
		const key = `${row.date}|${row.model}|${billingMode}`;

		result.set(key, {
			date: row.date,
			model: row.model,
			billingMode,
			tokens: {
				inputTokens: row.input_tokens || 0,
				outputTokens: row.output_tokens || 0,
				cacheReadTokens: row.cache_read_tokens || 0,
				cacheWriteTokens: row.cache_write_tokens || 0,
			},
			anthropicCost: row.anthropic_cost || 0,
			maestroCost: row.maestro_cost || 0,
			entryCount: row.entry_count,
		});
	}

	logger.debug(`Queried Maestro usage: ${result.size} groups with data`, LOG_CONTEXT);
	return result;
}

// ============================================================================
// Helper Functions for Audit Entry Processing
// ============================================================================

/**
 * Determine the status of an audit entry based on token/cost discrepancy.
 *
 * @param anthropicTokens - Total tokens from Anthropic
 * @param maestroTokens - Total tokens from Maestro
 * @param anthropicCost - Cost from Anthropic
 * @param maestroCost - Cost from Maestro
 * @returns Status and discrepancy percentage
 */
function determineEntryStatus(
	anthropicTokens: number,
	maestroTokens: number,
	anthropicCost: number,
	maestroCost: number
): { status: AuditEntry['status']; discrepancyPercent: number } {
	// Calculate token discrepancy
	const tokenDiff = Math.abs(anthropicTokens - maestroTokens);
	const tokenBase = Math.max(anthropicTokens, maestroTokens, 1);
	const tokenDiscrepancy = (tokenDiff / tokenBase) * 100;

	// Calculate cost discrepancy
	const costDiff = Math.abs(anthropicCost - maestroCost);
	const costBase = Math.max(anthropicCost, maestroCost, 0.001);
	const costDiscrepancy = (costDiff / costBase) * 100;

	// Use the larger of the two discrepancies
	const discrepancyPercent = Math.max(tokenDiscrepancy, costDiscrepancy);

	// Determine status based on thresholds
	let status: AuditEntry['status'];
	if (discrepancyPercent <= 1) {
		status = 'match';
	} else if (discrepancyPercent <= 5) {
		status = 'minor';
	} else {
		status = 'major';
	}

	return { status, discrepancyPercent };
}

/**
 * Calculate total tokens from a TokenCounts object.
 */
function totalTokens(tokens: TokenCounts): number {
	return (
		tokens.inputTokens + tokens.outputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens
	);
}

/**
 * Generate a unique ID for an audit entry.
 */
function generateEntryId(date: string, model: string, billingMode: string): string {
	return `${date}_${model}_${billingMode}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Calculate cache savings for Max billing mode.
 * Cache tokens are free for Max users, so savings = what they would have paid at API rates.
 */
function calculateCacheSavings(tokens: TokenCounts, model: string): number {
	const pricing = getPricingForModel(model);

	if (!pricing) {
		return 0;
	}

	const cacheReadCost = (tokens.cacheReadTokens / 1_000_000) * pricing.CACHE_READ_PER_MILLION;
	const cacheWriteCost = (tokens.cacheWriteTokens / 1_000_000) * pricing.CACHE_CREATION_PER_MILLION;

	return cacheReadCost + cacheWriteCost;
}

// ============================================================================
// Audit Comparison Logic
// ============================================================================

/**
 * Get enabled SSH remote configurations from settings store.
 */
function getEnabledSshRemotes(): SshRemoteConfig[] {
	try {
		const store = getSettingsStore();
		const remotes = store.get('sshRemotes', []) as SshRemoteConfig[];
		return remotes.filter((r) => r.enabled);
	} catch {
		return [];
	}
}

/**
 * Perform a full audit comparing Anthropic and Maestro usage data.
 *
 * @param startDate - Start date (YYYY-MM-DD)
 * @param endDate - End date (YYYY-MM-DD)
 * @param options - Additional options
 * @returns Extended audit result with comparison data, entries, and breakdowns
 */
export async function performAudit(
	startDate: string,
	endDate: string,
	options?: {
		includeRemotes?: boolean;
		remoteConfigs?: SshRemoteConfig[];
	}
): Promise<ExtendedAuditResult> {
	logger.info(`Starting audit for ${startDate} to ${endDate}`, LOG_CONTEXT);

	const anthropicData: AnthropicDailyUsage[] = [];
	let localFetchFailed = false;

	// 1. Try to fetch Anthropic usage locally first
	try {
		const localData = await fetchAnthropicUsage('daily', startDate, endDate);
		anthropicData.push(...localData);
	} catch (error) {
		const err = error as Error;
		// Check if this is a "no Claude directories" error - fallback to remotes
		if (err.message?.includes('No valid Claude data directories')) {
			logger.info('No local Claude data found, will try SSH remotes', LOG_CONTEXT);
			localFetchFailed = true;
		} else {
			throw error;
		}
	}

	// 2. Fetch from SSH remotes (either explicitly requested or as fallback)
	const remoteConfigs = options?.remoteConfigs || (localFetchFailed ? getEnabledSshRemotes() : []);
	const shouldFetchRemotes = options?.includeRemotes || localFetchFailed;

	if (shouldFetchRemotes && remoteConfigs.length > 0) {
		for (const config of remoteConfigs) {
			try {
				logger.info(`Fetching usage from SSH remote: ${config.host}`, LOG_CONTEXT);
				const remoteData = await fetchRemoteAnthropicUsage(config, 'daily', startDate, endDate);
				anthropicData.push(...remoteData);
				logger.info(`Fetched ${remoteData.length} records from ${config.host}`, LOG_CONTEXT);
			} catch (error) {
				const err = error as Error;
				logger.warn(`Failed to fetch from ${config.host}: ${err.message}`, LOG_CONTEXT);
			}
		}
	}

	// 3. If we still have no data and local failed, provide a helpful error
	if (anthropicData.length === 0 && localFetchFailed) {
		const remoteCount = remoteConfigs.length;
		if (remoteCount === 0) {
			throw new Error(
				'No Claude data directories found locally and no SSH remotes configured. ' +
					'Configure an SSH remote in Settings to fetch usage data from a remote host.'
			);
		} else {
			throw new Error(
				`No Claude data found locally or from ${remoteCount} SSH remote(s). ` +
					'Ensure Claude Code is installed and has usage data on the remote host(s).'
			);
		}
	}

	// 4. Fetch Maestro usage for same period
	const maestroData = await queryMaestroUsageByDate(startDate, endDate);

	// 5. Compare and generate report
	return compareUsage(anthropicData, maestroData, startDate, endDate);
}

/**
 * Compare Anthropic and Maestro usage data with full breakdown.
 */
function compareUsage(
	anthropicData: AnthropicDailyUsage[],
	maestroData: Map<
		string,
		{
			date: string;
			model: string;
			billingMode: 'api' | 'max' | 'unknown';
			tokens: TokenCounts;
			anthropicCost: number;
			maestroCost: number;
			entryCount: number;
		}
	>,
	startDate: string,
	endDate: string
): ExtendedAuditResult {
	const anomalies: AuditResult['anomalies'] = [];
	const entries: AuditEntry[] = [];

	// Initialize billing mode breakdown
	const billingModeBreakdown: BillingModeBreakdown = {
		api: { entryCount: 0, anthropicCost: 0, maestroCost: 0, tokenCount: 0 },
		max: { entryCount: 0, anthropicCost: 0, maestroCost: 0, cacheSavings: 0, tokenCount: 0 },
	};

	// Initialize model breakdown map
	const modelBreakdownMap = new Map<string, ModelBreakdownEntry>();

	// Summary counters
	let totalEntries = 0;
	let matches = 0;
	let minorDiscrepancies = 0;
	let majorDiscrepancies = 0;
	let missing = 0;

	// Aggregate Anthropic totals by date (for comparison)
	const anthropicByDate = new Map<string, AnthropicDailyUsage>();
	for (const day of anthropicData) {
		anthropicByDate.set(day.date, day);
	}

	// Process Maestro data and create entries
	for (const [_key, maestroEntry] of maestroData.entries()) {
		totalEntries++;

		const {
			date,
			model,
			billingMode,
			tokens,
			anthropicCost: _anthropicCost,
			maestroCost,
			entryCount,
		} = maestroEntry;

		// Try to find matching Anthropic data for this date
		const anthropicDay = anthropicByDate.get(date);

		// Create estimated Anthropic tokens for this entry (proportional if multiple models/billing modes)
		// This is an approximation since ccusage doesn't break down by billing mode
		const anthropicTokens: TokenCounts = anthropicDay
			? {
					inputTokens: anthropicDay.inputTokens,
					outputTokens: anthropicDay.outputTokens,
					cacheReadTokens: anthropicDay.cacheReadTokens,
					cacheWriteTokens: anthropicDay.cacheCreationTokens,
				}
			: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

		const anthropicCostForEntry = anthropicDay?.totalCost || 0;

		// Determine entry status
		const { status, discrepancyPercent } = determineEntryStatus(
			totalTokens(anthropicTokens),
			totalTokens(tokens),
			anthropicCostForEntry,
			maestroCost
		);

		// Update summary counters
		switch (status) {
			case 'match':
				matches++;
				break;
			case 'minor':
				minorDiscrepancies++;
				break;
			case 'major':
				majorDiscrepancies++;
				break;
			case 'missing':
				missing++;
				break;
		}

		// Create entry
		const entry: AuditEntry = {
			id: generateEntryId(date, model, billingMode),
			date,
			model,
			billingMode,
			tokens: {
				anthropic: anthropicTokens,
				maestro: tokens,
			},
			costs: {
				anthropicCost: anthropicCostForEntry,
				maestroCost,
			},
			status,
			discrepancyPercent,
		};
		entries.push(entry);

		// Update billing mode breakdown
		if (billingMode === 'api') {
			billingModeBreakdown.api.entryCount += entryCount;
			billingModeBreakdown.api.anthropicCost += anthropicCostForEntry;
			billingModeBreakdown.api.maestroCost += maestroCost;
			billingModeBreakdown.api.tokenCount += totalTokens(tokens);
		} else if (billingMode === 'max') {
			billingModeBreakdown.max.entryCount += entryCount;
			billingModeBreakdown.max.anthropicCost += anthropicCostForEntry;
			billingModeBreakdown.max.maestroCost += maestroCost;
			billingModeBreakdown.max.cacheSavings += calculateCacheSavings(tokens, model);
			billingModeBreakdown.max.tokenCount += totalTokens(tokens);
		}

		// Update model breakdown
		if (!modelBreakdownMap.has(model)) {
			modelBreakdownMap.set(model, {
				model,
				anthropic: {
					tokens: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
					cost: 0,
				},
				maestro: {
					tokens: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
					cost: 0,
				},
				entryCount: 0,
				discrepancyPercent: 0,
				match: true,
			});
		}
		const modelEntry = modelBreakdownMap.get(model)!;
		modelEntry.maestro.tokens.inputTokens += tokens.inputTokens;
		modelEntry.maestro.tokens.outputTokens += tokens.outputTokens;
		modelEntry.maestro.tokens.cacheReadTokens += tokens.cacheReadTokens;
		modelEntry.maestro.tokens.cacheWriteTokens += tokens.cacheWriteTokens;
		modelEntry.maestro.cost += maestroCost;
		modelEntry.entryCount += entryCount;
		if (status !== 'match') {
			modelEntry.match = false;
			modelEntry.discrepancyPercent = Math.max(modelEntry.discrepancyPercent, discrepancyPercent);
		}
	}

	// Process Anthropic data for model breakdown (aggregate)
	for (const day of anthropicData) {
		for (const breakdown of day.modelBreakdowns) {
			const model = breakdown.modelName;
			if (!modelBreakdownMap.has(model)) {
				modelBreakdownMap.set(model, {
					model,
					anthropic: {
						tokens: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
						cost: 0,
					},
					maestro: {
						tokens: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
						cost: 0,
					},
					entryCount: 0,
					discrepancyPercent: 0,
					match: true,
				});
			}
			const modelEntry = modelBreakdownMap.get(model)!;
			modelEntry.anthropic.tokens.inputTokens += breakdown.inputTokens;
			modelEntry.anthropic.tokens.outputTokens += breakdown.outputTokens;
			modelEntry.anthropic.tokens.cacheReadTokens += breakdown.cacheReadTokens;
			modelEntry.anthropic.tokens.cacheWriteTokens += breakdown.cacheCreationTokens;
			modelEntry.anthropic.cost += breakdown.cost;
		}
	}

	// Calculate aggregate totals for backward compatibility
	const anthropicTotals: TokenCounts = {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
	};
	const maestroTotals: TokenCounts = {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
	};
	let anthropicCostTotal = 0;
	let maestroAnthropicCost = 0;
	let maestroCalculatedCost = 0;

	for (const day of anthropicData) {
		anthropicTotals.inputTokens += day.inputTokens || 0;
		anthropicTotals.outputTokens += day.outputTokens || 0;
		anthropicTotals.cacheReadTokens += day.cacheReadTokens || 0;
		anthropicTotals.cacheWriteTokens += day.cacheCreationTokens || 0;
		anthropicCostTotal += day.totalCost || 0;
	}

	for (const [, data] of maestroData.entries()) {
		maestroTotals.inputTokens += data.tokens.inputTokens;
		maestroTotals.outputTokens += data.tokens.outputTokens;
		maestroTotals.cacheReadTokens += data.tokens.cacheReadTokens;
		maestroTotals.cacheWriteTokens += data.tokens.cacheWriteTokens;
		maestroAnthropicCost += data.anthropicCost;
		maestroCalculatedCost += data.maestroCost;
	}

	// Calculate differences
	const tokenDiff: TokenCounts = {
		inputTokens: anthropicTotals.inputTokens - maestroTotals.inputTokens,
		outputTokens: anthropicTotals.outputTokens - maestroTotals.outputTokens,
		cacheReadTokens: anthropicTotals.cacheReadTokens - maestroTotals.cacheReadTokens,
		cacheWriteTokens: anthropicTotals.cacheWriteTokens - maestroTotals.cacheWriteTokens,
	};

	const totalAnthropicTokens = totalTokens(anthropicTotals);
	const totalDiff =
		Math.abs(tokenDiff.inputTokens) +
		Math.abs(tokenDiff.outputTokens) +
		Math.abs(tokenDiff.cacheReadTokens) +
		Math.abs(tokenDiff.cacheWriteTokens);
	const percentDiff = totalAnthropicTokens > 0 ? (totalDiff / totalAnthropicTokens) * 100 : 0;

	// Detect anomalies
	if (percentDiff > 1) {
		anomalies.push({
			type: 'token_mismatch',
			severity: percentDiff > 5 ? 'error' : 'warning',
			description: `Token count differs by ${percentDiff.toFixed(2)}%`,
			details: { anthropic: anthropicTotals, maestro: maestroTotals, diff: tokenDiff },
		});
	}

	const costDiscrepancy = Math.abs(anthropicCostTotal - maestroAnthropicCost);
	if (costDiscrepancy > 0.01) {
		anomalies.push({
			type: 'cost_mismatch',
			severity: costDiscrepancy > 1 ? 'error' : 'warning',
			description: `Cost discrepancy of $${costDiscrepancy.toFixed(2)}`,
			details: { anthropic: anthropicCostTotal, maestro: maestroAnthropicCost },
		});
	}

	logger.info(
		`Audit completed: ${entries.length} entries, ${anomalies.length} anomalies, savings: $${(anthropicCostTotal - maestroCalculatedCost).toFixed(2)}`,
		LOG_CONTEXT
	);

	return {
		period: { start: startDate, end: endDate },
		generatedAt: Date.now(),
		tokens: {
			anthropic: anthropicTotals,
			maestro: maestroTotals,
			difference: tokenDiff,
			percentDiff,
		},
		costs: {
			anthropic_total: anthropicCostTotal,
			maestro_anthropic: maestroAnthropicCost,
			maestro_calculated: maestroCalculatedCost,
			discrepancy: costDiscrepancy,
			savings: anthropicCostTotal - maestroCalculatedCost,
		},
		modelBreakdown: Array.from(modelBreakdownMap.values()),
		anomalies,
		// New extended fields
		entries,
		billingModeBreakdown,
		summary: {
			total: totalEntries,
			matches,
			minorDiscrepancies,
			majorDiscrepancies,
			missing,
		},
	};
}

// ============================================================================
// Audit Snapshot Storage
// ============================================================================

/**
 * Save an audit result as a snapshot for historical reference.
 *
 * @param result - The extended audit result to save
 * @param auditType - The type of audit (daily, weekly, monthly, manual)
 * @returns The ID of the saved snapshot
 */
export async function saveAuditSnapshot(
	result: ExtendedAuditResult,
	auditType: 'daily' | 'weekly' | 'monthly' | 'manual' = 'manual'
): Promise<number> {
	const db = getStatsDB();
	const database = db.database;

	const sql = `
		INSERT INTO audit_snapshots (
			created_at, period_start, period_end, audit_type,
			anthropic_input_tokens, anthropic_output_tokens,
			anthropic_cache_read_tokens, anthropic_cache_write_tokens,
			anthropic_total_cost,
			maestro_input_tokens, maestro_output_tokens,
			maestro_cache_read_tokens, maestro_cache_write_tokens,
			maestro_anthropic_cost, maestro_calculated_cost,
			token_match_percent, cost_discrepancy_usd,
			anomaly_count, audit_result_json, status
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`;

	const dbResult = database.prepare(sql).run(
		Date.now(),
		result.period.start,
		result.period.end,
		auditType,
		result.tokens.anthropic.inputTokens,
		result.tokens.anthropic.outputTokens,
		result.tokens.anthropic.cacheReadTokens,
		result.tokens.anthropic.cacheWriteTokens,
		result.costs.anthropic_total,
		result.tokens.maestro.inputTokens,
		result.tokens.maestro.outputTokens,
		result.tokens.maestro.cacheReadTokens,
		result.tokens.maestro.cacheWriteTokens,
		result.costs.maestro_anthropic,
		result.costs.maestro_calculated,
		100 - result.tokens.percentDiff, // token_match_percent
		result.costs.discrepancy,
		result.anomalies.length,
		JSON.stringify(result),
		'completed'
	);

	logger.info(`Saved audit snapshot with ID ${dbResult.lastInsertRowid}`, LOG_CONTEXT);
	return dbResult.lastInsertRowid as number;
}

/**
 * Get historical audit snapshots.
 *
 * @param limit - Maximum number of snapshots to return
 * @returns Array of extended audit results
 */
export async function getAuditHistory(limit: number = 10): Promise<ExtendedAuditResult[]> {
	const db = getStatsDB();
	const database = db.database;

	const sql = `
		SELECT audit_result_json
		FROM audit_snapshots
		ORDER BY created_at DESC
		LIMIT ?
	`;

	const rows = database.prepare(sql).all(limit) as Array<{ audit_result_json: string }>;
	return rows.map((row) => JSON.parse(row.audit_result_json) as ExtendedAuditResult);
}

/**
 * Get audit snapshots within a date range.
 *
 * @param startDate - Start date (YYYY-MM-DD)
 * @param endDate - End date (YYYY-MM-DD)
 * @returns Array of extended audit results
 */
export async function getAuditSnapshotsByRange(
	startDate: string,
	endDate: string
): Promise<ExtendedAuditResult[]> {
	const db = getStatsDB();
	const database = db.database;

	const sql = `
		SELECT audit_result_json
		FROM audit_snapshots
		WHERE period_start >= ? AND period_end <= ?
		ORDER BY created_at DESC
	`;

	const rows = database.prepare(sql).all(startDate, endDate) as Array<{
		audit_result_json: string;
	}>;
	return rows.map((row) => JSON.parse(row.audit_result_json) as ExtendedAuditResult);
}
