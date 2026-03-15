/**
 * Utility functions for batch processing of markdown task documents.
 * Extracted from useBatchProcessor.ts for reusability.
 */

import { autorunDefaultPrompt } from '../../../prompts';

// Default batch processing prompt (exported for use by BatchRunnerModal and playbook management)
export const DEFAULT_BATCH_PROMPT = autorunDefaultPrompt;

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

/**
 * Validates that an agent prompt contains references to Markdown tasks.
 * Uses regex heuristics to check for common patterns indicating the prompt
 * instructs the agent to process checkbox-style Markdown tasks.
 *
 * Returns true if the prompt is valid (contains task references).
 */
export function validateAgentPromptHasTaskReference(prompt: string): boolean {
	if (!prompt || !prompt.trim()) return false;

	const patterns = [
		/markdown\s+task/i, // "markdown task", "Markdown Tasks", etc.
		/- \[ \]/, // literal checkbox syntax
		/- \[x\]/i, // checked checkbox syntax
		/unchecked\s+task/i, // "unchecked task"
		/checkbox/i, // "checkbox"
		/check\s*off\s+task/i, // "check off task"
		/task.*\bcompleted?\b.*\[/i, // "task completed [" or "task complete ["
		/\btask.*- \[/i, // "task ... - [" (task followed by checkbox)
	];

	return patterns.some((pattern) => pattern.test(prompt));
}
