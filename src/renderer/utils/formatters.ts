/**
 * Shared formatting utilities re-exported from the shared module.
 * This file exists for backwards compatibility - import directly from
 * '../../shared/formatters' for new code.
 */
export {
	formatSize,
	formatNumber,
	formatTokens,
	formatTokensCompact,
	formatRelativeTime,
	formatActiveTime,
	formatElapsedTime,
	formatCost,
	getCostTooltip,
} from '../../shared/formatters';
export type { BillingModeDisplay } from '../../shared/formatters';

/**
 * Sanitize preview text for display in session/subagent list items.
 * Strips literal JSON escape sequences (\n, \r, \t) from remote shell extraction
 * and real newline/carriage-return characters from local JSON.parse paths.
 * Collapses multiple spaces into single space and trims.
 */
export function sanitizePreviewText(text: string): string {
	return text
		.replace(/\\n/g, ' ') // Literal \n from JSON (remote shell path)
		.replace(/\\r/g, ' ') // Literal \r from JSON (remote shell path)
		.replace(/\\t/g, ' ') // Literal \t from JSON (remote shell path)
		.replace(/[\n\r\t]/g, ' ') // Real newline/CR/tab chars (local JSON.parse path)
		.replace(/\s{2,}/g, ' ') // Collapse multiple spaces
		.trim();
}
