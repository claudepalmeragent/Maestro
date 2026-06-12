import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveMarkers, MARKER_REGISTRY } from '../../../main/utils/claude-pty-markers';

describe('claude-pty-markers', () => {
	describe('resolveMarkers', () => {
		afterEach(() => {
			vi.restoreAllMocks();
		});

		it('returns the exact registry entry for version "2.1.141"', () => {
			const markers = resolveMarkers('2.1.141');
			expect(markers.version).toBe('2.1.141');
			const registryEntry = MARKER_REGISTRY.find((m) => m.version === '2.1.141');
			expect(markers).toBe(registryEntry);
		});

		it('returns "*" default for a completely unknown version and emits console.warn', () => {
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			const markers = resolveMarkers('completely-unknown');
			expect(markers.version).toBe('*');
			expect(warnSpy).toHaveBeenCalledOnce();
			expect(warnSpy.mock.calls[0][0]).toContain('completely-unknown');
		});

		it('resolves 2.1.999 to the "2.1.*" wildcard entry (no warn emitted)', () => {
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			const markers = resolveMarkers('2.1.999');
			expect(markers.version).toBe('2.1.*');
			expect(warnSpy).not.toHaveBeenCalled();
		});

		it('does NOT emit console.warn for exact registry matches', () => {
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			resolveMarkers('2.1.141');
			expect(warnSpy).not.toHaveBeenCalled();
		});

		it('returns the "*" entry when the default is requested directly', () => {
			const markers = resolveMarkers('*');
			expect(markers.version).toBe('*');
		});
	});

	describe('MARKER_REGISTRY integrity', () => {
		it('contains exactly one "*" default entry', () => {
			const defaults = MARKER_REGISTRY.filter((m) => m.version === '*');
			expect(defaults).toHaveLength(1);
		});

		it('all entries have well-formed helpLineMarkers (RegExp[])', () => {
			for (const entry of MARKER_REGISTRY) {
				expect(
					Array.isArray(entry.helpLineMarkers),
					`${entry.version}: helpLineMarkers must be array`
				).toBe(true);
				for (const re of entry.helpLineMarkers) {
					expect(re, `${entry.version}: each helpLineMarker must be RegExp`).toBeInstanceOf(RegExp);
				}
			}
		});

		it('all entries have well-formed completionStatsMarkers (RegExp[])', () => {
			for (const entry of MARKER_REGISTRY) {
				expect(
					Array.isArray(entry.completionStatsMarkers),
					`${entry.version}: completionStatsMarkers must be array`
				).toBe(true);
				for (const re of entry.completionStatsMarkers) {
					expect(re, `${entry.version}: each completionStatsMarker must be RegExp`).toBeInstanceOf(
						RegExp
					);
				}
			}
		});

		it('all entries have well-formed idlePromptMarkers (RegExp[])', () => {
			for (const entry of MARKER_REGISTRY) {
				expect(
					Array.isArray(entry.idlePromptMarkers),
					`${entry.version}: idlePromptMarkers must be array`
				).toBe(true);
				for (const re of entry.idlePromptMarkers) {
					expect(re, `${entry.version}: each idlePromptMarker must be RegExp`).toBeInstanceOf(
						RegExp
					);
				}
			}
		});

		it('all entries have a spinnerGlyphs Set', () => {
			for (const entry of MARKER_REGISTRY) {
				expect(entry.spinnerGlyphs, `${entry.version}: spinnerGlyphs must be Set`).toBeInstanceOf(
					Set
				);
			}
		});

		it('all entries have a completionPhrases array', () => {
			for (const entry of MARKER_REGISTRY) {
				expect(
					Array.isArray(entry.completionPhrases),
					`${entry.version}: completionPhrases must be array`
				).toBe(true);
			}
		});
	});

	describe('v2.1.141 marker semantics', () => {
		const markers = resolveMarkers('2.1.141');

		it('helpLineMarkers is empty for v2.1.141 ("? for shortcuts" renders continuously in status bar)', () => {
			// v2.1.141 shows "? for shortcuts" in its persistent REPL status bar at all
			// times — during response generation AND at idle — so it cannot serve as an
			// S1 (immediate-fire) idle signal.  The array must be empty.
			expect(markers.helpLineMarkers).toHaveLength(0);
		});

		it('helpLineMarkers do NOT match "? for shortcuts" or plain text', () => {
			expect(markers.helpLineMarkers.some((re) => re.test('? for shortcuts'))).toBe(false);
			expect(markers.helpLineMarkers.some((re) => re.test('hello world'))).toBe(false);
		});

		it('idlePromptMarkers is empty for v2.1.141 ("❯" renders continuously in status bar)', () => {
			// v2.1.141 shows ❯ in its persistent REPL status bar during response
			// generation AND at idle. Using it as an S3 idle signal would fire the
			// debounce timer prematurely. The array must be empty for this version.
			expect(markers.idlePromptMarkers).toHaveLength(0);
		});

		it('idlePromptMarkers do NOT match "❯" for v2.1.141', () => {
			expect(markers.idlePromptMarkers.some((re) => re.test('❯'))).toBe(false);
		});

		it('completionStatsMarkers is empty for v2.1.141 (status lines render continuously, not only at completion)', () => {
			// ARD 1.4 option (b): mode-variant fixture analysis found no completion-stats
			// pattern that fires exclusively at end-of-turn across all config modes
			// (effortMedium/thinkingOff, effortMedium/thinkingOn, effortHigh/thinkingOn).
			// Trough detector is the primary signal for this version.
			expect(markers.completionStatsMarkers).toHaveLength(0);
		});

		it('completionStatsMarkers do NOT match plain spinner glyphs without duration', () => {
			expect(markers.completionStatsMarkers.some((re) => re.test('✻ working...'))).toBe(false);
		});

		it('spinnerGlyphs includes "✻"', () => {
			expect(markers.spinnerGlyphs.has('✻')).toBe(true);
		});

		it('spinnerGlyphs includes half-circle arcs ◐ ◑ ◒ ◓ (v2.1.141 progress arcs)', () => {
			expect(markers.spinnerGlyphs.has('◐')).toBe(true);
			expect(markers.spinnerGlyphs.has('◑')).toBe(true);
			expect(markers.spinnerGlyphs.has('◒')).toBe(true);
			expect(markers.spinnerGlyphs.has('◓')).toBe(true);
		});

		it('postPromptGraceMs is 2000 for v2.1.141 (prevents startup-spinner arming of S4)', () => {
			expect(markers.postPromptGraceMs).toBe(2000);
		});

		it('completionStatsMarkers do NOT include "esc to interrupt" (appears during thinking, not only at completion)', () => {
			expect(markers.completionStatsMarkers.some((re) => re.test('esc to interrupt'))).toBe(false);
		});
	});
});
