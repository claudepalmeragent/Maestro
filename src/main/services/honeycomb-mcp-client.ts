/**
 * HoneycombMcpClient
 *
 * On-demand lazy singleton MCP client for querying Honeycomb
 * via their public MCP server. Uses Management API Key auth.
 *
 * The client is created on first use, reused for subsequent calls,
 * and discarded/recreated if the API key or region changes.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { getSettingsStore } from '../stores';
import type { HoneycombQuerySpec, HoneycombQueryResult } from './honeycomb-query-client';
import { logger } from '../utils/logger';

const LOG_CONTEXT = 'HoneycombMcpClient';

const MCP_ENDPOINTS = {
	us: 'https://mcp.honeycomb.io/mcp',
	eu: 'https://mcp.eu1.honeycomb.io/mcp',
} as const;

// ============================================================================
// Singleton State
// ============================================================================

let _client: Client | null = null;
let _currentConfigKey: string = '';
let _connectingPromise: Promise<Client> | null = null;

// ============================================================================
// Public API
// ============================================================================

/**
 * Get or create the on-demand MCP client.
 * Discards and recreates if API key or region has changed.
 * Uses a connection promise guard to prevent concurrent connection races.
 * Throws if Management API key is not configured.
 */
export async function getHoneycombMcpClient(): Promise<Client> {
	const store = getSettingsStore();
	const apiKey = store.get('honeycombMcpApiKey', '') as string;
	const region = store.get('honeycombMcpRegion', 'us') as 'us' | 'eu';
	const configKey = `${apiKey}:${region}`;

	// Discard if config changed
	if (_client && _currentConfigKey !== configKey) {
		logger.info('MCP config changed, reconnecting...', LOG_CONTEXT);
		closeHoneycombMcpClient();
	}

	// If already connecting, wait for that to finish
	if (_connectingPromise) {
		return _connectingPromise;
	}

	if (!_client) {
		if (!apiKey) {
			throw new Error('Honeycomb Management API key not configured');
		}

		// Create a connection promise so concurrent callers share the same connection
		_connectingPromise = (async () => {
			logger.info(`Connecting to Honeycomb MCP (${region})...`, LOG_CONTEXT);
			const client = new Client({ name: 'maestro', version: '1.0.0' });
			const transport = new StreamableHTTPClientTransport(new URL(MCP_ENDPOINTS[region]), {
				requestInit: {
					headers: { Authorization: `Bearer ${apiKey}` },
				},
			});
			await client.connect(transport);
			_client = client;
			_currentConfigKey = configKey;
			logger.info('Connected to Honeycomb MCP server', LOG_CONTEXT);
			return client;
		})();

		try {
			return await _connectingPromise;
		} finally {
			_connectingPromise = null;
		}
	}

	return _client;
}

/**
 * Close the MCP client and clear singleton state.
 */
export function closeHoneycombMcpClient(): void {
	if (_client) {
		_client.close().catch((err) => {
			logger.warn(`Error closing MCP client: ${err}`, LOG_CONTEXT);
		});
		_client = null;
		_currentConfigKey = '';
	}
	_connectingPromise = null;
}

/**
 * Execute a run_query tool call via MCP.
 * Returns the query result in HoneycombQueryResult format.
 */
export async function mcpRunQuery(
	environmentSlug: string,
	datasetSlug: string,
	querySpec: HoneycombQuerySpec
): Promise<HoneycombQueryResult> {
	const client = await getHoneycombMcpClient();
	const result = await client.callTool({
		name: 'run_query',
		arguments: {
			environment_slug: environmentSlug,
			dataset_slug: datasetSlug,
			query_spec: querySpec,
		},
	});
	return transformMcpResult(result);
}

/**
 * Test MCP connection by running a simple COUNT query.
 */
export async function mcpTestConnection(
	environmentSlug: string,
	datasetSlug: string
): Promise<{ success: boolean; error?: string }> {
	try {
		const client = await getHoneycombMcpClient();
		await client.callTool({
			name: 'run_query',
			arguments: {
				environment_slug: environmentSlug,
				dataset_slug: datasetSlug,
				query_spec: {
					calculations: [{ op: 'COUNT' }],
					time_range: '1h',
				},
			},
		});
		return { success: true };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error(`MCP test connection failed: ${message}`, LOG_CONTEXT);
		return { success: false, error: message };
	}
}

/**
 * Auto-discover environment slug via get_workspace_context MCP tool.
 * Returns the first environment slug found, or null if discovery fails.
 */
export async function mcpDiscoverEnvironment(): Promise<string | null> {
	try {
		const client = await getHoneycombMcpClient();
		const result = await client.callTool({
			name: 'get_workspace_context',
			arguments: {},
		});
		return extractEnvironmentSlug(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error(`MCP environment discovery failed: ${message}`, LOG_CONTEXT);
		return null;
	}
}

// ============================================================================
// Private Helpers
// ============================================================================

/**
 * Transform MCP callTool result into HoneycombQueryResult format.
 *
 * MCP tools return markdown text (tables + ASCII charts), not JSON.
 * The metadata includes a query_result_json URL, but it's session-scoped
 * to the MCP server and returns 403 when fetched externally.
 *
 * Strategy: Parse the markdown table from the text response.
 * Table format: | col1 | col2 |\n| --- | --- |\n| val1 | val2 |
 * Row 0 = aggregated results, Row 1 = "other" bucket, Row 2 = totals.
 */
function transformMcpResult(mcpResult: unknown): HoneycombQueryResult {
	const result = mcpResult as { content?: Array<{ type: string; text?: string }> };
	if (!result?.content?.length) {
		return { data: { results: [] } };
	}

	// Concatenate all text content blocks
	const textContent = result.content
		.filter((c) => c.type === 'text' && c.text)
		.map((c) => c.text)
		.join('\n');

	if (!textContent) {
		return { data: { results: [] } };
	}

	return parseMarkdownTable(textContent);
}

/**
 * Fallback parser: extract data from markdown table in MCP text response.
 * Handles format: | col1 | col2 |\n| --- | --- |\n| val1 | val2 |
 */
function parseMarkdownTable(text: string): HoneycombQueryResult {
	const lines = text.split('\n');
	let headerLine = -1;

	// Find the markdown table header (line before the separator line)
	for (let i = 0; i < lines.length - 1; i++) {
		if (lines[i].includes('|') && lines[i + 1]?.match(/^\|[\s-|]+\|$/)) {
			headerLine = i;
			break;
		}
	}

	if (headerLine === -1) {
		logger.warn('No markdown table found in MCP response', LOG_CONTEXT);
		return { data: { results: [] } };
	}

	// Parse headers
	const headers = lines[headerLine]
		.split('|')
		.map((h) => h.trim())
		.filter((h) => h.length > 0);

	// Parse data rows (skip header + separator)
	const results: Array<Record<string, unknown>> = [];
	for (let i = headerLine + 2; i < lines.length; i++) {
		const line = lines[i];
		if (!line.includes('|') || line.match(/^\|[\s-|]+\|$/)) break; // stop at next separator or non-table line

		const cells = line
			.split('|')
			.map((c) => c.trim())
			.filter((c) => c.length > 0);

		if (cells.length === headers.length) {
			const row: Record<string, unknown> = {};
			headers.forEach((h, idx) => {
				const val = cells[idx];
				// Try to parse as number
				const num = Number(val);
				row[h] = isNaN(num) ? val : num;
			});
			results.push(row);
		}
	}

	return { data: { results } };
}

/**
 * Extract the first environment slug from get_workspace_context result.
 * The MCP response is formatted text, not JSON.
 */
function extractEnvironmentSlug(mcpResult: unknown): string | null {
	const result = mcpResult as { content?: Array<{ type: string; text?: string }> };
	if (!result?.content?.length) {
		return null;
	}

	const textContent = result.content
		.filter((c) => c.type === 'text' && c.text)
		.map((c) => c.text)
		.join('\n');

	if (!textContent) {
		return null;
	}

	// Try JSON parse first (in case MCP changes format in the future)
	try {
		const parsed = JSON.parse(textContent);
		if (parsed?.default_environment?.slug) {
			return parsed.default_environment.slug;
		}
		if (parsed?.environments?.[0]?.slug) {
			return parsed.environments[0].slug;
		}
		if (typeof parsed?.environment_slug === 'string') {
			return parsed.environment_slug;
		}
	} catch {
		// Expected — MCP returns formatted text, not JSON
	}

	// Parse the structured text format from get_workspace_context
	// Look for <env> blocks with Slug: field
	const envBlocks = textContent.match(/<env>([\s\S]*?)<\/env>/g);
	if (envBlocks) {
		for (const block of envBlocks) {
			const slugMatch = block.match(/Slug:\s*(\S+)/);
			if (slugMatch) {
				return slugMatch[1];
			}
		}
	}

	// Fallback: look for "Slug: value" pattern anywhere
	const slugMatch = textContent.match(/(?:environment[_\s]?)?[Ss]lug:\s*(\S+)/);
	if (slugMatch) {
		return slugMatch[1];
	}

	logger.warn('Could not extract environment slug from workspace context', LOG_CONTEXT);
	return null;
}
