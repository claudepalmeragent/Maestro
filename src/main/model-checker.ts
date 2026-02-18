/**
 * Model checker for Maestro
 *
 * Fetches the Anthropic pricing page and compares listed models against
 * the local pricing registry to detect new Claude models that don't yet
 * have pricing configured in Maestro.
 *
 * @module model-checker
 */

import { getAllKnownModelDisplayNames } from './utils/claude-pricing';
import { logger } from './utils/logger';

const LOG_CONTEXT = '[ModelChecker]';
const PRICING_PAGE_URL = 'https://docs.anthropic.com/en/about-claude/pricing';

// Module-level guard: only check once per app session
let sessionChecked = false;

/**
 * Information about a newly detected model
 */
export interface NewModelInfo {
	/** Human-readable model name (e.g., 'Claude Sonnet 5') */
	name: string;
	/** Input price per million tokens, if parsed */
	inputPricePerMillion?: number;
	/** Output price per million tokens, if parsed */
	outputPricePerMillion?: number;
}

/**
 * Result of a model check
 */
export interface ModelCheckResult {
	/** List of models found on the pricing page but not in the local registry */
	newModels: NewModelInfo[];
	/** Error message if the check failed */
	error?: string;
	/** True if the check was skipped (e.g., already checked this session) */
	skipped?: boolean;
}

/**
 * Parse model names and pricing from the Anthropic pricing page HTML.
 *
 * The pricing page is a Next.js app that renders HTML tables with rows like:
 *   <td ...>Claude Opus 4.6</td><td ...>$5 / MTok</td>...<td ...>$25 / MTok</td>
 *
 * Deprecated models may have an <a> tag inside:
 *   <td ...>Claude Sonnet 3.7 (<a ...>deprecated</a>)</td>
 *
 * We also support markdown pipe-delimited tables as a fallback (for testing).
 *
 * @param html - The raw HTML/text of the pricing page
 * @returns Array of objects with model name and optional pricing
 */
export function parseModelsFromPricingPage(html: string): Array<{
	name: string;
	inputPricePerMillion?: number;
	outputPricePerMillion?: number;
}> {
	const models: Array<{
		name: string;
		inputPricePerMillion?: number;
		outputPricePerMillion?: number;
	}> = [];
	const seen = new Set<string>();

	// Strategy 1: HTML <td> tags (actual pricing page format)
	// Match a <td> containing a Claude model name, then capture subsequent <td> cells in the same row
	const tdRowPattern =
		/<td[^>]*>(Claude\s+(?:Opus|Sonnet|Haiku)\s+[\d.]+)(?:\s*\(?<a[^>]*>[^<]*<\/a>\)?)?\s*<\/td>((?:<td[^>]*>[^<]*<\/td>)*)/gi;

	let match;
	while ((match = tdRowPattern.exec(html)) !== null) {
		const name = match[1].trim();
		if (seen.has(name)) continue;
		seen.add(name);

		const model: { name: string; inputPricePerMillion?: number; outputPricePerMillion?: number } = {
			name,
		};

		// Extract all subsequent <td> cell values
		const cellsHtml = match[2] || '';
		const cellValues: string[] = [];
		const cellPattern = /<td[^>]*>([^<]*)<\/td>/gi;
		let cellMatch;
		while ((cellMatch = cellPattern.exec(cellsHtml)) !== null) {
			cellValues.push(cellMatch[1]);
		}

		// First cell after model name = Base Input Tokens (e.g., "$5 / MTok")
		if (cellValues.length > 0) {
			const inputMatch = cellValues[0].match(/\$(\d+(?:\.\d+)?)/);
			if (inputMatch) {
				model.inputPricePerMillion = parseFloat(inputMatch[1]);
			}
		}

		// Last cell = Output Tokens (e.g., "$25 / MTok")
		if (cellValues.length > 1) {
			const outputMatch = cellValues[cellValues.length - 1].match(/\$(\d+(?:\.\d+)?)/);
			if (outputMatch) {
				model.outputPricePerMillion = parseFloat(outputMatch[1]);
			}
		}

		models.push(model);
	}

	// Strategy 2: Markdown pipe tables (fallback, used in tests)
	if (models.length === 0) {
		const rowPattern =
			/\|\s*(Claude\s+(?:Opus|Sonnet|Haiku)\s+[\d.]+)(?:\s*\([^)]*\))?\s*\|([^|]*)\|[^|]*\|[^|]*\|[^|]*\|([^|]*)\|/gi;

		while ((match = rowPattern.exec(html)) !== null) {
			const name = match[1].trim();
			if (seen.has(name)) continue;
			seen.add(name);

			const model: { name: string; inputPricePerMillion?: number; outputPricePerMillion?: number } =
				{ name };

			const inputMatch = match[2]?.match(/\$(\d+(?:\.\d+)?)/);
			if (inputMatch) {
				model.inputPricePerMillion = parseFloat(inputMatch[1]);
			}

			const outputMatch = match[3]?.match(/\$(\d+(?:\.\d+)?)/);
			if (outputMatch) {
				model.outputPricePerMillion = parseFloat(outputMatch[1]);
			}

			models.push(model);
		}
	}

	return models;
}

/**
 * Fetch the Anthropic pricing page HTML.
 * Returns null on any failure (network, non-200 status).
 *
 * @returns The page text content, or null on failure
 */
async function fetchPricingPage(): Promise<string | null> {
	try {
		const response = await fetch(PRICING_PAGE_URL, {
			headers: {
				'User-Agent': 'Maestro-Model-Checker',
				Accept: 'text/html,application/xhtml+xml,*/*',
			},
			redirect: 'follow',
		});

		if (!response.ok) {
			logger.warn(
				`${LOG_CONTEXT} Pricing page returned ${response.status} ${response.statusText}`,
				LOG_CONTEXT
			);
			return null;
		}

		return await response.text();
	} catch (error) {
		logger.warn(
			`${LOG_CONTEXT} Failed to fetch pricing page: ${error instanceof Error ? error.message : String(error)}`,
			LOG_CONTEXT
		);
		return null;
	}
}

/**
 * Check for new Claude models not present in the local pricing registry.
 *
 * Fetches the Anthropic pricing page (public, no auth needed), parses
 * model names from the table, and compares against all known models
 * in CLAUDE_MODEL_PRICING.
 *
 * This function is guarded to only run once per app session. Subsequent
 * calls return { skipped: true }.
 *
 * @returns ModelCheckResult with list of unknown models
 */
export async function checkForNewModels(): Promise<ModelCheckResult> {
	// Guard: skip if already checked this session
	if (sessionChecked) {
		logger.debug(`${LOG_CONTEXT} Already checked this session, skipping`, LOG_CONTEXT);
		return { newModels: [], skipped: true };
	}

	// Mark as checked before the call (prevents duplicate calls from racing)
	sessionChecked = true;

	const html = await fetchPricingPage();
	if (!html) {
		return { newModels: [], error: 'Failed to fetch Anthropic pricing page' };
	}

	const pageModels = parseModelsFromPricingPage(html);
	if (pageModels.length === 0) {
		logger.warn(
			`${LOG_CONTEXT} No models parsed from pricing page — page format may have changed`,
			LOG_CONTEXT
		);
		return { newModels: [] };
	}

	const knownNames = getAllKnownModelDisplayNames();

	const newModels: NewModelInfo[] = pageModels
		.filter((m) => !knownNames.has(m.name))
		.map((m) => ({
			name: m.name,
			inputPricePerMillion: m.inputPricePerMillion,
			outputPricePerMillion: m.outputPricePerMillion,
		}));

	if (newModels.length > 0) {
		logger.info(
			`${LOG_CONTEXT} Found ${newModels.length} new model(s): ${newModels.map((m) => m.name).join(', ')}`,
			LOG_CONTEXT
		);
	} else {
		logger.debug(
			`${LOG_CONTEXT} No new models detected (${pageModels.length} models checked)`,
			LOG_CONTEXT
		);
	}

	return { newModels };
}

/**
 * Reset the session-check guard. For testing purposes only.
 */
export function resetModelCheckerState(): void {
	sessionChecked = false;
}
