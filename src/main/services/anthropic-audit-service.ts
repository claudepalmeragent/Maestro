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
	const args = ['--json'];
	if (since) args.push('--since', since);
	if (until) args.push('--until', until);

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

		const result = JSON.parse(stdout);

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
	const sshManager = new SshRemoteManager();
	const sshArgs = sshManager.buildSshArgs(sshConfig);

	// Build the ccusage command for remote execution
	let ccusageCmd = `npx ccusage@latest ${period} --json`;
	if (since) ccusageCmd += ` --since ${since}`;
	if (until) ccusageCmd += ` --until ${until}`;

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

		const result = JSON.parse(stdout);
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
 * Query Maestro's recorded usage data by date range.
 *
 * @param startDate - Start date (YYYY-MM-DD)
 * @param endDate - End date (YYYY-MM-DD)
 * @returns Map of date to usage data
 */
export async function queryMaestroUsageByDate(
	startDate: string,
	endDate: string
): Promise<Map<string, { tokens: TokenCounts; anthropicCost: number; maestroCost: number }>> {
	const db = getStatsDB();
	const database = db.database;

	const sql = `
		SELECT
			date(start_time / 1000, 'unixepoch') as date,
			SUM(input_tokens) as input_tokens,
			SUM(output_tokens) as output_tokens,
			SUM(cache_read_input_tokens) as cache_read_tokens,
			SUM(cache_creation_input_tokens) as cache_write_tokens,
			COALESCE(SUM(anthropic_cost_usd), SUM(total_cost_usd)) as anthropic_cost,
			COALESCE(SUM(maestro_cost_usd), SUM(total_cost_usd)) as maestro_cost
		FROM query_events
		WHERE date(start_time / 1000, 'unixepoch') >= ?
			AND date(start_time / 1000, 'unixepoch') <= ?
		GROUP BY date(start_time / 1000, 'unixepoch')
	`;

	const rows = database.prepare(sql).all(startDate, endDate) as Array<{
		date: string;
		input_tokens: number | null;
		output_tokens: number | null;
		cache_read_tokens: number | null;
		cache_write_tokens: number | null;
		anthropic_cost: number | null;
		maestro_cost: number | null;
	}>;

	const result = new Map<
		string,
		{ tokens: TokenCounts; anthropicCost: number; maestroCost: number }
	>();

	for (const row of rows) {
		result.set(row.date, {
			tokens: {
				inputTokens: row.input_tokens || 0,
				outputTokens: row.output_tokens || 0,
				cacheReadTokens: row.cache_read_tokens || 0,
				cacheWriteTokens: row.cache_write_tokens || 0,
			},
			anthropicCost: row.anthropic_cost || 0,
			maestroCost: row.maestro_cost || 0,
		});
	}

	logger.debug(`Queried Maestro usage: ${result.size} days with data`, LOG_CONTEXT);
	return result;
}

// ============================================================================
// Audit Comparison Logic
// ============================================================================

/**
 * Perform a full audit comparing Anthropic and Maestro usage data.
 *
 * @param startDate - Start date (YYYY-MM-DD)
 * @param endDate - End date (YYYY-MM-DD)
 * @param options - Additional options
 * @returns Audit result with comparison data and anomalies
 */
export async function performAudit(
	startDate: string,
	endDate: string,
	options?: {
		includeRemotes?: boolean;
		remoteConfigs?: SshRemoteConfig[];
	}
): Promise<AuditResult> {
	logger.info(`Starting audit for ${startDate} to ${endDate}`, LOG_CONTEXT);

	// 1. Fetch Anthropic usage (local)
	const anthropicData = await fetchAnthropicUsage('daily', startDate, endDate);

	// 2. Optionally fetch from SSH remotes
	if (options?.includeRemotes && options?.remoteConfigs) {
		for (const config of options.remoteConfigs) {
			try {
				const remoteData = await fetchRemoteAnthropicUsage(config, 'daily', startDate, endDate);
				anthropicData.push(...remoteData);
			} catch (error) {
				const err = error as Error;
				logger.warn(`Failed to fetch from ${config.host}: ${err.message}`, LOG_CONTEXT);
			}
		}
	}

	// 3. Fetch Maestro usage for same period
	const maestroData = await queryMaestroUsageByDate(startDate, endDate);

	// 4. Compare and generate report
	return compareUsage(anthropicData, maestroData, startDate, endDate);
}

/**
 * Compare Anthropic and Maestro usage data.
 */
function compareUsage(
	anthropicData: AnthropicDailyUsage[],
	maestroData: Map<string, { tokens: TokenCounts; anthropicCost: number; maestroCost: number }>,
	startDate: string,
	endDate: string
): AuditResult {
	const anomalies: AuditResult['anomalies'] = [];

	// Aggregate Anthropic totals
	const anthropicTotals: TokenCounts = {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
	};
	let anthropicCostTotal = 0;

	for (const day of anthropicData) {
		anthropicTotals.inputTokens += day.inputTokens || 0;
		anthropicTotals.outputTokens += day.outputTokens || 0;
		anthropicTotals.cacheReadTokens += day.cacheReadTokens || 0;
		anthropicTotals.cacheWriteTokens += day.cacheCreationTokens || 0;
		anthropicCostTotal += day.totalCost || 0;
	}

	// Aggregate Maestro totals
	const maestroTotals: TokenCounts = {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
	};
	let maestroAnthropicCost = 0;
	let maestroCalculatedCost = 0;

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

	const totalAnthropicTokens =
		anthropicTotals.inputTokens +
		anthropicTotals.outputTokens +
		anthropicTotals.cacheReadTokens +
		anthropicTotals.cacheWriteTokens;
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
		`Audit completed: ${anomalies.length} anomalies, savings: $${(anthropicCostTotal - maestroCalculatedCost).toFixed(2)}`,
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
		modelBreakdown: [], // TODO: Implement per-model breakdown if needed
		anomalies,
	};
}

// ============================================================================
// Audit Snapshot Storage
// ============================================================================

/**
 * Save an audit result as a snapshot for historical reference.
 *
 * @param result - The audit result to save
 * @param auditType - The type of audit (daily, weekly, monthly, manual)
 * @returns The ID of the saved snapshot
 */
export async function saveAuditSnapshot(
	result: AuditResult,
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
 * @returns Array of audit results
 */
export async function getAuditHistory(limit: number = 10): Promise<AuditResult[]> {
	const db = getStatsDB();
	const database = db.database;

	const sql = `
		SELECT audit_result_json
		FROM audit_snapshots
		ORDER BY created_at DESC
		LIMIT ?
	`;

	const rows = database.prepare(sql).all(limit) as Array<{ audit_result_json: string }>;
	return rows.map((row) => JSON.parse(row.audit_result_json) as AuditResult);
}

/**
 * Get audit snapshots within a date range.
 *
 * @param startDate - Start date (YYYY-MM-DD)
 * @param endDate - End date (YYYY-MM-DD)
 * @returns Array of audit results
 */
export async function getAuditSnapshotsByRange(
	startDate: string,
	endDate: string
): Promise<AuditResult[]> {
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
	return rows.map((row) => JSON.parse(row.audit_result_json) as AuditResult);
}
