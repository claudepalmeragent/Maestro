/**
 * Unit tests for the computeNextViewMode helper.
 *
 * Tests both 2-way AI ↔ Shell behavior (interactiveAvailable=false)
 * and full 3-way AI → Shell → Interactive → AI cycle (interactiveAvailable=true).
 *
 * The function is isolated in src/renderer/utils/viewModeHelpers.ts so it can
 * be tested without the heavy import chain (settingsStore → prompts → generated).
 */

import { describe, it, expect } from 'vitest';
import { computeNextViewMode } from '../../../../renderer/utils/viewModeHelpers';

describe('computeNextViewMode', () => {
	describe('when interactiveAvailable is false (default 2-way cycle)', () => {
		it('advances from ai to shell', () => {
			expect(computeNextViewMode('ai', false)).toBe('shell');
		});

		it('wraps from shell back to ai (skips interactive)', () => {
			expect(computeNextViewMode('shell', false)).toBe('ai');
		});

		it('falls back to ai from interactive when interactive is unavailable', () => {
			expect(computeNextViewMode('interactive', false)).toBe('ai');
		});
	});

	describe('when interactiveAvailable is true (3-way cycle)', () => {
		it('advances from ai to shell', () => {
			expect(computeNextViewMode('ai', true)).toBe('shell');
		});

		it('advances from shell to interactive', () => {
			expect(computeNextViewMode('shell', true)).toBe('interactive');
		});

		it('wraps from interactive back to ai', () => {
			expect(computeNextViewMode('interactive', true)).toBe('ai');
		});
	});

	describe('unknown / unexpected current value', () => {
		it('defaults to ai for an unknown mode', () => {
			// Cast to ViewMode to simulate unexpected persisted value
			expect(computeNextViewMode('unknown' as 'ai', false)).toBe('ai');
		});
	});
});
