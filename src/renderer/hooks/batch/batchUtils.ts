/**
 * Utility functions for batch processing of markdown task documents.
 * Extracted from useBatchProcessor.ts for reusability.
 */

// Regex to count unchecked markdown checkboxes: - [ ] task (also * [ ])
const UNCHECKED_TASK_REGEX = /^[\s]*[-*]\s*\[\s*\]\s*.+$/gm;

// Regex to count checked markdown checkboxes: - [x] task (also * [x])
const CHECKED_TASK_COUNT_REGEX = /^[\s]*[-*]\s*\[[xX✓✔]\]\s*.+$/gm;

// Regex to match checked markdown checkboxes for reset-on-completion
// Matches both [x] and [X] with various checkbox formats (standard and GitHub-style)
const CHECKED_TASK_REGEX = /^(\s*[-*]\s*)\[[xX✓✔]\]/gm;

// Regex to match fenced code blocks (``` or ~~~, with optional language identifier)
const FENCED_CODE_BLOCK_REGEX = /^(```|~~~).*\n[\s\S]*?\n\1\s*$/gm;

/**
 * Remove fenced code blocks from markdown content.
 * This prevents checkboxes inside code examples from being counted as tasks.
 */
function stripFencedCodeBlocks(content: string): string {
	return content.replace(FENCED_CODE_BLOCK_REGEX, '');
}

/**
 * Count unchecked tasks in markdown content
 * Matches lines like: - [ ] task description
 * Excludes checkboxes inside fenced code blocks.
 */
export function countUnfinishedTasks(content: string): number {
	const strippedContent = stripFencedCodeBlocks(content);
	const matches = strippedContent.match(UNCHECKED_TASK_REGEX);
	return matches ? matches.length : 0;
}

/**
 * Count checked tasks in markdown content
 * Matches lines like: - [x] task description
 * Excludes checkboxes inside fenced code blocks.
 */
export function countCheckedTasks(content: string): number {
	const strippedContent = stripFencedCodeBlocks(content);
	const matches = strippedContent.match(CHECKED_TASK_COUNT_REGEX);
	return matches ? matches.length : 0;
}

/**
 * Uncheck all markdown checkboxes in content (for reset-on-completion)
 * Converts all - [x] to - [ ] (case insensitive)
 */
export function uncheckAllTasks(content: string): string {
	return content.replace(CHECKED_TASK_REGEX, '$1[ ]');
}
