/**
 * pinVariableResolver.ts
 *
 * Resolves {{PIN:N}} and {{PIN:"search term"}} variables in message text
 * by substituting them with the actual pinned message content.
 */

import type { PinnedItem } from '../types';

/** Regex to match pin variable syntax: {{PIN:N}} or {{PIN:"text"}} */
const PIN_VAR_REGEX = /\{\{PIN:(?:(\d+)|"([^"]*)")\}\}/g;

export interface PinResolutionResult {
	/** The expanded text with all pin variables resolved */
	resolvedText: string;
	/** Whether any variables were found and resolved */
	hadVariables: boolean;
	/** Any variables that could not be resolved (for user feedback) */
	unresolvedVars: string[];
}

/**
 * Resolve all {{PIN:...}} variables in a message text.
 * Pin indices are 1-based, matching the display in PinnedPanel.
 * Pins are sorted by pinnedAt ascending (oldest first = index 1).
 *
 * @param text - The raw message text potentially containing pin variables
 * @param pins - The sorted array of pinned items for the active tab
 * @returns Resolution result with expanded text and metadata
 */
export function resolvePinVariables(text: string, pins: PinnedItem[]): PinResolutionResult {
	const unresolvedVars: string[] = [];
	let hadVariables = false;

	// Sort pins by pinSortOrder ascending for stable indexing
	const sortedPins = [...pins].sort((a, b) => a.pinSortOrder - b.pinSortOrder);

	const resolvedText = text.replace(PIN_VAR_REGEX, (match, indexStr, searchTerm) => {
		hadVariables = true;

		if (indexStr) {
			// {{PIN:N}} — resolve by 1-based index
			const index = parseInt(indexStr, 10);
			if (index < 1 || index > sortedPins.length) {
				unresolvedVars.push(match);
				return match; // Leave unresolved
			}
			return sortedPins[index - 1].text;
		}

		if (searchTerm !== undefined) {
			// {{PIN:"search term"}} — resolve by content match (most recently pinned)
			const query = searchTerm.toLowerCase();
			// Search from end (most recently pinned) to beginning
			const matchingPins = [...sortedPins]
				.reverse()
				.filter((p) => p.text.toLowerCase().includes(query));

			if (matchingPins.length === 0) {
				unresolvedVars.push(match);
				return match; // Leave unresolved
			}
			return matchingPins[0].text; // Most recently pinned match
		}

		unresolvedVars.push(match);
		return match;
	});

	return { resolvedText, hadVariables, unresolvedVars };
}

/**
 * Check if text contains any pin variable syntax.
 * Used for quick pre-check before calling the full resolver.
 */
export function hasPinVariables(text: string): boolean {
	return /\{\{PIN:/.test(text);
}

/**
 * Extract the partial pin variable being typed at the cursor position.
 * Used for autocomplete triggering.
 *
 * @param text - Full input text
 * @param cursorPos - Current cursor position
 * @returns The partial variable text if cursor is inside a {{...}} block, null otherwise
 */
export function getPartialPinVariable(
	text: string,
	cursorPos: number
): { start: number; partial: string } | null {
	// Look backwards from cursor for {{
	const before = text.slice(0, cursorPos);
	const lastOpen = before.lastIndexOf('{{');
	if (lastOpen === -1) return null;

	// Make sure there's no }} between the {{ and cursor
	const between = before.slice(lastOpen);
	if (between.includes('}}')) return null;

	return {
		start: lastOpen,
		partial: between.slice(2), // Strip the {{
	};
}
