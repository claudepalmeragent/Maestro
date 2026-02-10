/**
 * JSONL Parser Utility
 *
 * Parses Claude Code's JSONL journal files to extract usage data for historical reconstruction.
 * Claude Code stores per-message usage data in JSONL files at:
 * - Local: ~/.claude/projects/<encoded-project-path>/<session-id>.jsonl
 * - SSH Remotes: Same path on remote machines
 */

import * as fs from 'fs';
import * as readline from 'readline';

/**
 * Represents a single entry in a Claude Code journal file.
 */
export interface JournalEntry {
	type: 'assistant' | 'user' | 'result' | 'summary';
	sessionId: string;
	timestamp: string;
	uuid: string;
	message?: {
		model?: string;
		id?: string;
		usage?: {
			input_tokens?: number;
			output_tokens?: number;
			cache_creation_input_tokens?: number;
			cache_read_input_tokens?: number;
		};
	};
}

/**
 * Represents extracted usage data from a journal entry.
 */
export interface UsageEntry {
	sessionId: string;
	timestamp: number;
	uuid: string;
	messageId: string | null;
	model: string;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
}

/**
 * Parse a JSONL file and return all entries.
 *
 * @param filePath - The path to the JSONL file
 * @returns Array of parsed journal entries
 *
 * @example
 * ```typescript
 * const entries = await parseJsonlFile('/path/to/session.jsonl');
 * console.log(`Found ${entries.length} entries`);
 * ```
 */
export async function parseJsonlFile(filePath: string): Promise<JournalEntry[]> {
	const entries: JournalEntry[] = [];

	const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
	const rl = readline.createInterface({
		input: fileStream,
		crlfDelay: Infinity,
	});

	for await (const line of rl) {
		if (!line.trim()) continue;

		try {
			const entry = JSON.parse(line) as JournalEntry;
			entries.push(entry);
		} catch (error) {
			console.warn(`[jsonl-parser] Failed to parse line in ${filePath}:`, line.substring(0, 100));
		}
	}

	return entries;
}

/**
 * Extract usage entries from journal entries.
 * Filters for assistant messages that contain usage data.
 *
 * @param entries - Array of journal entries
 * @returns Array of usage entries with normalized token counts
 *
 * @example
 * ```typescript
 * const entries = await parseJsonlFile('/path/to/session.jsonl');
 * const usageEntries = extractUsageEntries(entries);
 * console.log(`Found ${usageEntries.length} usage records`);
 * ```
 */
export function extractUsageEntries(entries: JournalEntry[]): UsageEntry[] {
	return entries
		.filter(
			(e) =>
				e.type === 'assistant' &&
				e.message?.usage &&
				(e.message.usage.input_tokens || e.message.usage.output_tokens)
		)
		.map((e) => ({
			sessionId: e.sessionId,
			timestamp: new Date(e.timestamp).getTime(),
			uuid: e.uuid,
			messageId: e.message?.id || null,
			model: e.message?.model || 'unknown',
			inputTokens: e.message?.usage?.input_tokens || 0,
			outputTokens: e.message?.usage?.output_tokens || 0,
			cacheReadTokens: e.message?.usage?.cache_read_input_tokens || 0,
			cacheWriteTokens: e.message?.usage?.cache_creation_input_tokens || 0,
		}));
}

/**
 * Find all JSONL files under a base path.
 * Recursively walks the directory tree to find all .jsonl files.
 *
 * @param basePath - The base directory to search in
 * @returns Array of absolute file paths to JSONL files
 *
 * @example
 * ```typescript
 * const files = await findJsonlFiles('~/.claude/projects');
 * console.log(`Found ${files.length} JSONL files`);
 * ```
 */
export async function findJsonlFiles(basePath: string): Promise<string[]> {
	const path = await import('path');
	const results: string[] = [];

	async function walkDir(dir: string): Promise<void> {
		let entries: fs.Dirent[];
		try {
			entries = await fs.promises.readdir(dir, { withFileTypes: true });
		} catch {
			// Directory doesn't exist or not accessible
			return;
		}

		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				await walkDir(fullPath);
			} else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
				results.push(fullPath);
			}
		}
	}

	await walkDir(basePath);
	return results;
}
