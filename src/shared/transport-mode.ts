import type { TransportMode } from './types';

/** Identifies which level forced the mode, for "Inherited from <source>" UI labels. */
export type CascadeSource = 'tab' | 'agent' | 'project' | 'app' | 'default';

/**
 * Returns the resolved mode and the cascade source that determined it.
 * The most specific (narrowest) scope that forces 'interactive-pty' is reported.
 *
 * Cascade rule: any level set to 'interactive-pty' wins for everything below it
 * (strict ratchet — narrower scopes cannot demote broader scopes' opt-in).
 * undefined at any level is treated as 'legacy-print'.
 */
export function describeCascadeSource(
	tab: { transportMode?: TransportMode } | undefined,
	agent: { transportMode?: TransportMode } | undefined,
	project: { transportMode?: TransportMode } | undefined,
	app: { claudeCodeDefaultTransportMode: TransportMode }
): { mode: TransportMode; source: CascadeSource } {
	if (tab?.transportMode === 'interactive-pty') return { mode: 'interactive-pty', source: 'tab' };
	if (agent?.transportMode === 'interactive-pty')
		return { mode: 'interactive-pty', source: 'agent' };
	if (project?.transportMode === 'interactive-pty')
		return { mode: 'interactive-pty', source: 'project' };
	if (app.claudeCodeDefaultTransportMode === 'interactive-pty')
		return { mode: 'interactive-pty', source: 'app' };
	return { mode: 'legacy-print', source: 'default' };
}
