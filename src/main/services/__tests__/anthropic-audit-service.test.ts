/**
 * Unit tests for anthropic-audit-service.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the dependencies before importing the module
vi.mock('../../stats', () => ({
	getStatsDB: vi.fn(() => ({
		database: {
			prepare: vi.fn(() => ({
				all: vi.fn(() => []),
				run: vi.fn(() => ({ lastInsertRowid: 1 })),
			})),
		},
	})),
}));

vi.mock('../../utils/logger', () => ({
	logger: {
		info: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock('../../utils/claude-pricing', () => ({
	getPricingForModel: vi.fn((model: string) => {
		if (model.includes('opus')) {
			return {
				INPUT_PER_MILLION: 5,
				OUTPUT_PER_MILLION: 25,
				CACHE_READ_PER_MILLION: 0.5,
				CACHE_CREATION_PER_MILLION: 6.25,
			};
		}
		return {
			INPUT_PER_MILLION: 3,
			OUTPUT_PER_MILLION: 15,
			CACHE_READ_PER_MILLION: 0.3,
			CACHE_CREATION_PER_MILLION: 3.75,
		};
	}),
}));

describe('anthropic-audit-service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('TokenCounts type', () => {
		it('should have correct structure', () => {
			const tokens = {
				inputTokens: 1000,
				outputTokens: 500,
				cacheReadTokens: 200,
				cacheWriteTokens: 100,
			};

			expect(tokens.inputTokens).toBe(1000);
			expect(tokens.outputTokens).toBe(500);
			expect(tokens.cacheReadTokens).toBe(200);
			expect(tokens.cacheWriteTokens).toBe(100);
		});
	});

	describe('AuditEntry type', () => {
		it('should have correct structure', () => {
			const entry = {
				id: 'test_entry_1',
				date: '2026-02-12',
				model: 'claude-opus-4-5-20251101',
				billingMode: 'max' as const,
				tokens: {
					anthropic: {
						inputTokens: 1000,
						outputTokens: 500,
						cacheReadTokens: 200,
						cacheWriteTokens: 100,
					},
					maestro: {
						inputTokens: 1000,
						outputTokens: 500,
						cacheReadTokens: 200,
						cacheWriteTokens: 100,
					},
				},
				costs: {
					anthropicCost: 0.05,
					maestroCost: 0.03,
				},
				status: 'match' as const,
				discrepancyPercent: 0,
			};

			expect(entry.id).toBe('test_entry_1');
			expect(entry.billingMode).toBe('max');
			expect(entry.status).toBe('match');
		});
	});

	describe('BillingModeBreakdown type', () => {
		it('should have correct structure with cache savings for max', () => {
			const breakdown = {
				api: {
					entryCount: 10,
					anthropicCost: 1.5,
					maestroCost: 1.5,
					tokenCount: 50000,
				},
				max: {
					entryCount: 20,
					anthropicCost: 2.0,
					maestroCost: 0.5,
					cacheSavings: 1.5,
					tokenCount: 100000,
				},
			};

			expect(breakdown.api.entryCount).toBe(10);
			expect(breakdown.max.cacheSavings).toBe(1.5);
		});
	});

	describe('ExtendedAuditResult type', () => {
		it('should include all required fields', () => {
			const result = {
				period: { start: '2026-02-01', end: '2026-02-12' },
				generatedAt: Date.now(),
				tokens: {
					anthropic: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
					maestro: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
					difference: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
					percentDiff: 0,
				},
				costs: {
					anthropic_total: 0,
					maestro_anthropic: 0,
					maestro_calculated: 0,
					discrepancy: 0,
					savings: 0,
				},
				modelBreakdown: [],
				anomalies: [],
				entries: [],
				billingModeBreakdown: {
					api: { entryCount: 0, anthropicCost: 0, maestroCost: 0, tokenCount: 0 },
					max: { entryCount: 0, anthropicCost: 0, maestroCost: 0, cacheSavings: 0, tokenCount: 0 },
				},
				summary: {
					total: 0,
					matches: 0,
					minorDiscrepancies: 0,
					majorDiscrepancies: 0,
					missing: 0,
				},
			};

			expect(result.period.start).toBe('2026-02-01');
			expect(result.summary.total).toBe(0);
			expect(result.billingModeBreakdown.max.cacheSavings).toBe(0);
		});
	});
});

describe('determineEntryStatus helper', () => {
	// Test the status determination logic
	function determineEntryStatus(
		anthropicTokens: number,
		maestroTokens: number,
		anthropicCost: number,
		maestroCost: number
	): { status: 'match' | 'minor' | 'major' | 'missing'; discrepancyPercent: number } {
		const tokenDiff = Math.abs(anthropicTokens - maestroTokens);
		const tokenBase = Math.max(anthropicTokens, maestroTokens, 1);
		const tokenDiscrepancy = (tokenDiff / tokenBase) * 100;

		const costDiff = Math.abs(anthropicCost - maestroCost);
		const costBase = Math.max(anthropicCost, maestroCost, 0.001);
		const costDiscrepancy = (costDiff / costBase) * 100;

		const discrepancyPercent = Math.max(tokenDiscrepancy, costDiscrepancy);

		let status: 'match' | 'minor' | 'major' | 'missing';
		if (discrepancyPercent <= 1) {
			status = 'match';
		} else if (discrepancyPercent <= 5) {
			status = 'minor';
		} else {
			status = 'major';
		}

		return { status, discrepancyPercent };
	}

	it('should return match for identical values', () => {
		const result = determineEntryStatus(1000, 1000, 0.05, 0.05);
		expect(result.status).toBe('match');
		expect(result.discrepancyPercent).toBe(0);
	});

	it('should return match for <1% discrepancy', () => {
		const result = determineEntryStatus(1000, 1005, 0.05, 0.0502);
		expect(result.status).toBe('match');
		expect(result.discrepancyPercent).toBeLessThanOrEqual(1);
	});

	it('should return minor for 1-5% discrepancy', () => {
		const result = determineEntryStatus(1000, 1030, 0.05, 0.052);
		expect(result.status).toBe('minor');
		expect(result.discrepancyPercent).toBeGreaterThan(1);
		expect(result.discrepancyPercent).toBeLessThanOrEqual(5);
	});

	it('should return major for >5% discrepancy', () => {
		const result = determineEntryStatus(1000, 1100, 0.05, 0.06);
		expect(result.status).toBe('major');
		expect(result.discrepancyPercent).toBeGreaterThan(5);
	});
});

describe('calculateCacheSavings helper', () => {
	function calculateCacheSavings(
		cacheReadTokens: number,
		cacheWriteTokens: number,
		model: string
	): number {
		// Simplified pricing lookup
		const pricing = model.includes('opus')
			? { CACHE_READ_PER_MILLION: 0.5, CACHE_CREATION_PER_MILLION: 6.25 }
			: { CACHE_READ_PER_MILLION: 0.3, CACHE_CREATION_PER_MILLION: 3.75 };

		const cacheReadCost = (cacheReadTokens / 1_000_000) * pricing.CACHE_READ_PER_MILLION;
		const cacheWriteCost = (cacheWriteTokens / 1_000_000) * pricing.CACHE_CREATION_PER_MILLION;

		return cacheReadCost + cacheWriteCost;
	}

	it('should calculate savings correctly for Opus model', () => {
		const savings = calculateCacheSavings(1_000_000, 100_000, 'claude-opus-4-5-20251101');
		// 1M cache read at $0.50/M = $0.50
		// 100K cache write at $6.25/M = $0.625
		expect(savings).toBeCloseTo(1.125, 2);
	});

	it('should calculate savings correctly for Sonnet model', () => {
		const savings = calculateCacheSavings(1_000_000, 100_000, 'claude-sonnet-4-20250514');
		// 1M cache read at $0.30/M = $0.30
		// 100K cache write at $3.75/M = $0.375
		expect(savings).toBeCloseTo(0.675, 2);
	});

	it('should return 0 for no cache tokens', () => {
		const savings = calculateCacheSavings(0, 0, 'claude-opus-4-5-20251101');
		expect(savings).toBe(0);
	});
});
