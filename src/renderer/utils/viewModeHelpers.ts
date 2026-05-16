import type { ViewMode } from '../types';

/**
 * Compute the next view mode for the Cmd+J 3-way cycle.
 * When interactiveAvailable is false (until ARDs 4+5 land), behaves as a 2-way AI ↔ Shell toggle.
 */
export function computeNextViewMode(current: ViewMode, interactiveAvailable: boolean): ViewMode {
	if (current === 'ai') return 'shell';
	if (current === 'shell') return interactiveAvailable ? 'interactive' : 'ai';
	if (current === 'interactive') return 'ai';
	return 'ai';
}
