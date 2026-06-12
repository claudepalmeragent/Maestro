/**
 * Per-version marker sets for end-of-turn detection in `ClaudePtyStreamAnalyzer`.
 *
 * Maintained as a registry rather than hard-coded constants so the analyzer can:
 *   (a) match against the actual `claude` version it's wrapping, not a fixed assumption;
 *   (b) degrade to a documented `*` default when the version is unknown, with a logged warning;
 *   (c) be extended over time as `claude` evolves, without touching analyzer code.
 */

export interface VersionMarkers {
	/** Semver string or '*' for the catch-all default */
	version: string;

	/**
	 * High-confidence: appears ONLY when claude has returned to wait-for-input state.
	 * Example v2.1.141: '? for shortcuts' in the help line.
	 */
	helpLineMarkers: RegExp[];

	/**
	 * High-confidence: appears once at end-of-turn with completion stats.
	 * Example v2.1.141: '✻ Sautéed for 2s', '✓ Done in 4s · 250 tokens'.
	 */
	completionStatsMarkers: RegExp[];

	/**
	 * Medium-confidence: REPL prompt return. In some versions this is unique to idle
	 * state; in others (v2.1.141+) the prompt is rendered continuously. Used with a
	 * debounce window so a stable prompt observation (1.5s of no new output) fires.
	 * Set to [] when the prompt glyph renders during response generation too (v2.1.141+).
	 */
	idlePromptMarkers: RegExp[];

	/**
	 * Weak signal: spinner glyphs. The analyzer treats "no spinner-glyph chunk arrives
	 * for N ms" as a turn-complete heuristic. Empty set disables spinner-stop detection.
	 */
	spinnerGlyphs: ReadonlySet<string>;

	/**
	 * Narrative completion phrases ('Done!', 'Task complete', etc.). Kept for back-compat
	 * but no longer required as a gate — they're an OR signal alongside the others.
	 */
	completionPhrases: ReadonlyArray<string>;

	/**
	 * Grace period (ms) after beginTurn() during which S3 (idle-prompt debounce) and
	 * S4 (spinner-cessation) signals are suppressed. Prevents startup animation glyphs
	 * from arming the debounce timers before the actual response phase begins.
	 *
	 * In v2.1.141 the startup banner emits spinner glyphs within ~1s of spawn; the REPL
	 * then goes quiet briefly before the API call begins. Without a grace window, S4
	 * would fire ~1.5s after the STARTUP spinners stop — well before the response.
	 *
	 * Default: 0 (disabled). Set for versions whose startup overlaps the prompt phase.
	 */
	postPromptGraceMs?: number;
}

const DEFAULTS: Omit<VersionMarkers, 'version'> = {
	helpLineMarkers: [/\? for shortcuts/],
	completionStatsMarkers: [/[✓✻●][^\n]*\b\d+\s*(?:tokens|s)\b/],
	idlePromptMarkers: [/╰─/, /(\(claude\)|❯|\$)\s*$/m],
	spinnerGlyphs: new Set(['·', '✶', '✻', '✽', '✢', '●', '*', '⠐', '⠂', '✳', '⠁', '⠉']),
	completionPhrases: ['Done!', 'Task complete', 'I have finished', 'Task completed'],
};

export const MARKER_REGISTRY: VersionMarkers[] = [
	{
		version: '2.1.141',
		// Text-pattern markers emptied per ARD 1.4 option (b): mode-variant fixture
		// analysis found no pattern that fires exclusively at end-of-turn across all
		// three config combinations (effortMedium/thinkingOff, effortMedium/thinkingOn,
		// effortHigh/thinkingOn). The trough detector is the primary signal for this
		// version. SpinnerGlyphs retained as a fast-path hint for S4.
		helpLineMarkers: [],
		completionStatsMarkers: [],
		idlePromptMarkers: [],
		// v2.1.141 uses ◐ ◑ ◒ ◓ as half-circle progress arcs during response generation
		// in addition to the base spinner glyphs (✻ ✳ etc.).
		spinnerGlyphs: new Set([...DEFAULTS.spinnerGlyphs, '◐', '◑', '◒', '◓']),
		completionPhrases: [],
		// v2.1.141 startup banner emits spinner glyphs within ~1s of spawn. Without a
		// grace window, S4 fires ~1.5s after STARTUP spinners stop — before any response.
		// 2000ms gives enough runway for the startup phase to clear before S4 can arm.
		postPromptGraceMs: 2000,
	},
	// v2.1.x (covers 2.1.173+ until a newer exact entry is added).
	// Text-pattern markers emptied: same reasoning as 2.1.141 — status bar renders
	// markers continuously during both generation and idle, making them ambiguous.
	// Trough detector is the primary signal. SpinnerGlyphs kept for S4 fast-path.
	{
		version: '2.1.*',
		helpLineMarkers: [],
		completionStatsMarkers: [],
		idlePromptMarkers: [],
		spinnerGlyphs: new Set([...DEFAULTS.spinnerGlyphs, '◐', '◑', '◒', '◓']),
		completionPhrases: [],
		postPromptGraceMs: 2000,
	},
	// v2.0.x and earlier — TBD when captures available
	{
		version: '*',
		...DEFAULTS,
	},
];

/**
 * Resolve markers for the given claude version string. Exact match first, then
 * prefix-match on major.minor (e.g. '2.1.141' falls back to '2.1.*' if present),
 * then '*' default. Logs a warning to stderr when the default is used.
 */
export function resolveMarkers(claudeVersion: string): VersionMarkers {
	const exact = MARKER_REGISTRY.find((m) => m.version === claudeVersion);
	if (exact) return exact;

	const [major, minor] = claudeVersion.split('.');
	const minorWild = MARKER_REGISTRY.find((m) => m.version === `${major}.${minor}.*`);
	if (minorWild) return minorWild;

	const majorWild = MARKER_REGISTRY.find((m) => m.version === `${major}.*`);
	if (majorWild) return majorWild;

	console.warn(
		`[claude-pty-markers] no registry entry for v${claudeVersion}; using '*' default. Capture a fixture and extend MARKER_REGISTRY.`
	);
	return MARKER_REGISTRY.find((m) => m.version === '*')!;
}
