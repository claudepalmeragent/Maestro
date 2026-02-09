/**
 * @fileoverview Tests for useBillingMode hook utilities
 * Tests: resolveBillingModeSync function (hook tests require complex setup)
 */

import { describe, it, expect } from 'vitest';
import { resolveBillingModeSync } from '../../../../renderer/hooks/agent/useBillingMode';

// =============================================================================
// TESTS FOR resolveBillingModeSync
// =============================================================================

describe('resolveBillingModeSync', () => {
	describe('auto mode resolution', () => {
		it('should return detected mode when set to auto with max detected', () => {
			expect(resolveBillingModeSync('auto', 'max')).toBe('max');
		});

		it('should return detected mode when set to auto with api detected', () => {
			expect(resolveBillingModeSync('auto', 'api')).toBe('api');
		});

		it('should return api when auto and no detected mode', () => {
			expect(resolveBillingModeSync('auto', undefined)).toBe('api');
		});
	});

	describe('explicit mode', () => {
		it('should return max when configured as max, regardless of detected', () => {
			expect(resolveBillingModeSync('max', 'api')).toBe('max');
			expect(resolveBillingModeSync('max', undefined)).toBe('max');
		});

		it('should return api when configured as api, regardless of detected', () => {
			expect(resolveBillingModeSync('api', 'max')).toBe('api');
			expect(resolveBillingModeSync('api', undefined)).toBe('api');
		});
	});
});
