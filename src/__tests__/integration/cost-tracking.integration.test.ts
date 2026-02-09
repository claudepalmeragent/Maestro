/**
 * Cost Tracking Integration Tests
 *
 * These tests verify the end-to-end cost calculation flow including:
 * - Model-specific pricing (Opus vs Sonnet vs Haiku)
 * - Billing mode adjustments (API vs Max)
 * - Token usage aggregation
 * - Cost updates when model changes mid-session
 *
 * @module cost-tracking.integration.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	calculateCost,
	calculateClaudeCostWithModel,
	type TokenCounts,
} from '../../main/utils/pricing';
import {
	getPricingForModel,
	DEFAULT_MODEL_ID,
	CLAUDE_MODEL_PRICING,
	type ClaudeModelId,
} from '../../main/utils/claude-pricing';
import {
	resolveBillingMode,
	resolvePricingConfig,
	getAgentPricingConfig,
} from '../../main/utils/pricing-resolver';

// Mock the store getters module for resolver tests
vi.mock('../../main/stores/getters', () => ({
	getAgentConfigsStore: vi.fn(),
	getProjectFoldersStore: vi.fn(),
	getSessionsStore: vi.fn(),
}));

import {
	getAgentConfigsStore,
	getProjectFoldersStore,
	getSessionsStore,
} from '../../main/stores/getters';

const mockedGetAgentConfigsStore = vi.mocked(getAgentConfigsStore);
const mockedGetProjectFoldersStore = vi.mocked(getProjectFoldersStore);
const mockedGetSessionsStore = vi.mocked(getSessionsStore);

describe('Cost Tracking Integration', () => {
	// Mock store instances
	const mockAgentConfigsStore = { get: vi.fn(), set: vi.fn() };
	const mockProjectFoldersStore = { get: vi.fn(), set: vi.fn() };
	const mockSessionsStore = { get: vi.fn(), set: vi.fn() };

	beforeEach(() => {
		vi.clearAllMocks();
		mockedGetAgentConfigsStore.mockReturnValue(mockAgentConfigsStore as any);
		mockedGetProjectFoldersStore.mockReturnValue(mockProjectFoldersStore as any);
		mockedGetSessionsStore.mockReturnValue(mockSessionsStore as any);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('End-to-End Cost Calculation', () => {
		it('calculates correct cost for Opus 4.5 with Max billing', () => {
			// Configure agent with billingMode: 'max'
			mockAgentConfigsStore.get.mockReturnValue({
				'test-agent': {
					pricingConfig: {
						billingMode: 'max',
						pricingModel: 'claude-opus-4-5-20251101',
					},
				},
			});
			mockSessionsStore.get.mockReturnValue([]);

			// Simulate token usage from a session
			const tokens: TokenCounts = {
				inputTokens: 1_000_000, // 1M input tokens
				outputTokens: 500_000, // 500K output tokens
				cacheReadTokens: 200_000, // 200K cache read tokens
				cacheCreationTokens: 100_000, // 100K cache creation tokens
			};

			// Get the resolved pricing config
			const pricingConfig = resolvePricingConfig('test-agent');
			expect(pricingConfig.billingMode).toBe('max');
			expect(pricingConfig.modelId).toBe('claude-opus-4-5-20251101');

			// Calculate cost with Max billing (cache tokens should be free)
			const cost = calculateClaudeCostWithModel(
				tokens,
				pricingConfig.modelId,
				pricingConfig.billingMode
			);

			// Opus 4.5 pricing:
			// Input: 1M * $5/M = $5.00
			// Output: 0.5M * $25/M = $12.50
			// Cache Read: 0.2M * $0.50/M = $0 (free for Max!)
			// Cache Write: 0.1M * $6.25/M = $0 (free for Max!)
			// Total: $5.00 + $12.50 = $17.50
			expect(cost).toBeCloseTo(17.5, 2);

			// Compare with API billing (cache tokens should be charged)
			const apiCost = calculateClaudeCostWithModel(tokens, pricingConfig.modelId, 'api');

			// API pricing:
			// Input: 1M * $5/M = $5.00
			// Output: 0.5M * $25/M = $12.50
			// Cache Read: 0.2M * $0.50/M = $0.10
			// Cache Write: 0.1M * $6.25/M = $0.625
			// Total: $5.00 + $12.50 + $0.10 + $0.625 = $18.225
			expect(apiCost).toBeCloseTo(18.225, 3);

			// Max should always be cheaper due to free cache tokens
			expect(cost).toBeLessThan(apiCost);
		});

		it('calculates correct cost for Sonnet 4 with API billing', () => {
			// Configure agent with default API billing
			mockAgentConfigsStore.get.mockReturnValue({
				'test-agent': {
					pricingConfig: {
						billingMode: 'api',
						pricingModel: 'claude-sonnet-4-20250514',
					},
				},
			});
			mockSessionsStore.get.mockReturnValue([]);

			const tokens: TokenCounts = {
				inputTokens: 2_000_000,
				outputTokens: 1_000_000,
				cacheReadTokens: 500_000,
				cacheCreationTokens: 250_000,
			};

			const pricingConfig = resolvePricingConfig('test-agent');
			const cost = calculateClaudeCostWithModel(
				tokens,
				pricingConfig.modelId,
				pricingConfig.billingMode
			);

			// Sonnet 4 pricing:
			// Input: 2M * $3/M = $6.00
			// Output: 1M * $15/M = $15.00
			// Cache Read: 0.5M * $0.30/M = $0.15
			// Cache Write: 0.25M * $3.75/M = $0.9375
			// Total: $6.00 + $15.00 + $0.15 + $0.9375 = $22.0875
			expect(cost).toBeCloseTo(22.0875, 3);
		});

		it('calculates correct cost for Haiku 4.5 with minimal tokens', () => {
			mockAgentConfigsStore.get.mockReturnValue({
				'test-agent': {
					pricingConfig: {
						billingMode: 'api',
						pricingModel: 'claude-haiku-4-5-20251001',
					},
				},
			});
			mockSessionsStore.get.mockReturnValue([]);

			const tokens: TokenCounts = {
				inputTokens: 100_000, // Small session
				outputTokens: 50_000,
			};

			const pricingConfig = resolvePricingConfig('test-agent');
			const cost = calculateClaudeCostWithModel(
				tokens,
				pricingConfig.modelId,
				pricingConfig.billingMode
			);

			// Haiku 4.5 pricing:
			// Input: 0.1M * $1/M = $0.10
			// Output: 0.05M * $5/M = $0.25
			// Total: $0.35
			expect(cost).toBeCloseTo(0.35, 2);
		});
	});

	describe('Model Detection Mid-Session', () => {
		it('updates cost when model is detected mid-session', () => {
			// Start with auto detection (no model detected yet)
			mockAgentConfigsStore.get.mockReturnValue({
				'test-agent': {
					pricingConfig: {
						billingMode: 'auto',
						pricingModel: 'auto',
					},
				},
			});
			mockSessionsStore.get.mockReturnValue([]);

			// Initial cost calculation uses default model (Sonnet 4)
			const tokens: TokenCounts = {
				inputTokens: 1_000_000,
				outputTokens: 500_000,
			};

			let pricingConfig = resolvePricingConfig('test-agent');
			expect(pricingConfig.modelId).toBe(DEFAULT_MODEL_ID); // Should default to Sonnet 4
			expect(pricingConfig.modelSource).toBe('default');

			const initialCost = calculateClaudeCostWithModel(
				tokens,
				pricingConfig.modelId,
				pricingConfig.billingMode
			);

			// Sonnet 4: 1M * $3 + 0.5M * $15 = $3 + $7.50 = $10.50
			expect(initialCost).toBeCloseTo(10.5, 2);

			// Now model is detected from agent output as Opus 4.5
			mockAgentConfigsStore.get.mockReturnValue({
				'test-agent': {
					pricingConfig: {
						billingMode: 'auto',
						pricingModel: 'auto',
						detectedModel: 'claude-opus-4-5-20251101',
					},
				},
			});

			// Recalculate with detected model
			pricingConfig = resolvePricingConfig('test-agent');
			expect(pricingConfig.modelId).toBe('claude-opus-4-5-20251101');
			expect(pricingConfig.modelSource).toBe('detected');

			const updatedCost = calculateClaudeCostWithModel(
				tokens,
				pricingConfig.modelId,
				pricingConfig.billingMode
			);

			// Opus 4.5: 1M * $5 + 0.5M * $25 = $5 + $12.50 = $17.50
			expect(updatedCost).toBeCloseTo(17.5, 2);

			// Opus is more expensive than Sonnet
			expect(updatedCost).toBeGreaterThan(initialCost);
		});

		it('updates billing mode when detected from credentials', () => {
			// Start with auto detection (no billing mode detected)
			mockAgentConfigsStore.get.mockReturnValue({
				'test-agent': {
					pricingConfig: {
						billingMode: 'auto',
						pricingModel: 'claude-sonnet-4-20250514',
					},
				},
			});
			mockSessionsStore.get.mockReturnValue([]);

			const tokens: TokenCounts = {
				inputTokens: 1_000_000,
				outputTokens: 500_000,
				cacheReadTokens: 500_000,
				cacheCreationTokens: 250_000,
			};

			// Default to API billing
			let billingMode = resolveBillingMode('test-agent');
			expect(billingMode).toBe('api');

			const apiCost = calculateClaudeCostWithModel(tokens, 'claude-sonnet-4-20250514', billingMode);

			// Now Max subscription is detected from credentials
			mockAgentConfigsStore.get.mockReturnValue({
				'test-agent': {
					pricingConfig: {
						billingMode: 'auto',
						pricingModel: 'claude-sonnet-4-20250514',
						detectedBillingMode: 'max',
					},
				},
			});

			billingMode = resolveBillingMode('test-agent');
			expect(billingMode).toBe('max');

			const maxCost = calculateClaudeCostWithModel(tokens, 'claude-sonnet-4-20250514', billingMode);

			// Max should be cheaper due to free cache tokens
			expect(maxCost).toBeLessThan(apiCost);
		});
	});

	describe('Project Folder Cascade', () => {
		it('applies project billing mode to all agents', () => {
			const folderId = 'folder-1';
			const agentIds = ['agent-1', 'agent-2', 'agent-3'];

			// Configure project folder with max billing
			mockProjectFoldersStore.get.mockReturnValue([
				{
					id: folderId,
					name: 'Test Project',
					collapsed: false,
					order: 0,
					createdAt: Date.now(),
					updatedAt: Date.now(),
					pricingConfig: { billingMode: 'max' },
				},
			]);

			// All agents have auto billing (inherit from folder)
			mockAgentConfigsStore.get.mockReturnValue(
				Object.fromEntries(
					agentIds.map((id) => [
						id,
						{
							pricingConfig: {
								billingMode: 'auto',
								pricingModel: 'auto',
							},
						},
					])
				)
			);

			// Configure sessions to be in the folder
			mockSessionsStore.get.mockReturnValue(
				agentIds.map((id) => ({
					id,
					name: `Agent ${id}`,
					toolType: 'claude',
					cwd: '/test',
					projectRoot: '/test',
					projectFolderIds: [folderId],
				}))
			);

			// Verify all agents inherit max billing from folder
			for (const agentId of agentIds) {
				const config = resolvePricingConfig(agentId);
				expect(config.billingMode).toBe('max');
				expect(config.billingModeSource).toBe('folder');
			}
		});

		it('shows mixed state when agents differ', () => {
			const folderId = 'folder-1';

			// Configure project folder (no specific billing)
			mockProjectFoldersStore.get.mockReturnValue([
				{
					id: folderId,
					name: 'Test Project',
					collapsed: false,
					order: 0,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				},
			]);

			// Agent-1 has max, Agent-2 has api
			mockAgentConfigsStore.get.mockReturnValue({
				'agent-1': {
					pricingConfig: {
						billingMode: 'max',
						pricingModel: 'auto',
					},
				},
				'agent-2': {
					pricingConfig: {
						billingMode: 'api',
						pricingModel: 'auto',
					},
				},
			});

			mockSessionsStore.get.mockReturnValue([
				{
					id: 'agent-1',
					name: 'Agent 1',
					toolType: 'claude',
					cwd: '/test',
					projectRoot: '/test',
					projectFolderIds: [folderId],
				},
				{
					id: 'agent-2',
					name: 'Agent 2',
					toolType: 'claude',
					cwd: '/test',
					projectRoot: '/test',
					projectFolderIds: [folderId],
				},
			]);

			// Verify agents have different billing modes
			const config1 = resolvePricingConfig('agent-1');
			const config2 = resolvePricingConfig('agent-2');

			expect(config1.billingMode).toBe('max');
			expect(config1.billingModeSource).toBe('agent');
			expect(config2.billingMode).toBe('api');
			expect(config2.billingModeSource).toBe('agent');

			// When agents have explicit settings, they override folder
			expect(config1.billingMode).not.toBe(config2.billingMode);
		});

		it('syncs changes between modals', () => {
			const folderId = 'folder-1';

			// Initial state: agent-1 has max billing
			mockAgentConfigsStore.get.mockReturnValue({
				'agent-1': {
					pricingConfig: {
						billingMode: 'max',
						pricingModel: 'auto',
					},
				},
			});

			mockProjectFoldersStore.get.mockReturnValue([
				{
					id: folderId,
					name: 'Test Project',
					collapsed: false,
					order: 0,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				},
			]);

			mockSessionsStore.get.mockReturnValue([
				{
					id: 'agent-1',
					name: 'Agent 1',
					toolType: 'claude',
					cwd: '/test',
					projectRoot: '/test',
					projectFolderIds: [folderId],
				},
			]);

			// Verify initial state
			let config = resolvePricingConfig('agent-1');
			expect(config.billingMode).toBe('max');

			// Simulate change from Project Folder Settings modal
			mockAgentConfigsStore.get.mockReturnValue({
				'agent-1': {
					pricingConfig: {
						billingMode: 'api', // Changed from max to api
						pricingModel: 'auto',
					},
				},
			});

			// Verify change is reflected when Edit Agent modal opens
			config = resolvePricingConfig('agent-1');
			expect(config.billingMode).toBe('api');
			expect(config.billingModeSource).toBe('agent');
		});
	});

	describe('Cost Precision', () => {
		it('handles very small token counts accurately', () => {
			const tokens: TokenCounts = {
				inputTokens: 100, // 100 tokens
				outputTokens: 50,
			};

			const cost = calculateClaudeCostWithModel(tokens, 'claude-sonnet-4-20250514', 'api');

			// Sonnet 4: 100 * $3/1M + 50 * $15/1M
			// = $0.0003 + $0.00075 = $0.00105
			expect(cost).toBeCloseTo(0.00105, 5);
		});

		it('handles very large token counts accurately', () => {
			const tokens: TokenCounts = {
				inputTokens: 100_000_000, // 100M tokens
				outputTokens: 50_000_000,
			};

			const cost = calculateClaudeCostWithModel(tokens, 'claude-opus-4-5-20251101', 'api');

			// Opus 4.5: 100M * $5/1M + 50M * $25/1M
			// = $500 + $1250 = $1750
			expect(cost).toBeCloseTo(1750, 2);
		});

		it('handles zero tokens', () => {
			const tokens: TokenCounts = {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheCreationTokens: 0,
			};

			const cost = calculateClaudeCostWithModel(tokens, 'claude-opus-4-5-20251101', 'api');
			expect(cost).toBe(0);
		});
	});

	describe('Model Family Comparisons', () => {
		it('Opus is more expensive than Sonnet', () => {
			const tokens: TokenCounts = {
				inputTokens: 1_000_000,
				outputTokens: 500_000,
			};

			const opusCost = calculateClaudeCostWithModel(tokens, 'claude-opus-4-5-20251101', 'api');
			const sonnetCost = calculateClaudeCostWithModel(tokens, 'claude-sonnet-4-20250514', 'api');

			expect(opusCost).toBeGreaterThan(sonnetCost);
		});

		it('Sonnet is more expensive than Haiku', () => {
			const tokens: TokenCounts = {
				inputTokens: 1_000_000,
				outputTokens: 500_000,
			};

			const sonnetCost = calculateClaudeCostWithModel(tokens, 'claude-sonnet-4-20250514', 'api');
			const haikuCost = calculateClaudeCostWithModel(tokens, 'claude-haiku-4-5-20251001', 'api');

			expect(sonnetCost).toBeGreaterThan(haikuCost);
		});

		it('older Haiku versions are cheaper', () => {
			const tokens: TokenCounts = {
				inputTokens: 1_000_000,
				outputTokens: 500_000,
			};

			const haiku45Cost = calculateClaudeCostWithModel(tokens, 'claude-haiku-4-5-20251001', 'api');
			const haiku35Cost = calculateClaudeCostWithModel(tokens, 'claude-haiku-3-5-20241022', 'api');
			const haiku3Cost = calculateClaudeCostWithModel(tokens, 'claude-3-haiku-20240307', 'api');

			expect(haiku45Cost).toBeGreaterThan(haiku35Cost);
			expect(haiku35Cost).toBeGreaterThan(haiku3Cost);
		});
	});

	describe('Cache Token Billing Mode Differences', () => {
		it('Max subscribers save significantly on cache-heavy workloads', () => {
			// Simulate a session with heavy caching
			const tokens: TokenCounts = {
				inputTokens: 500_000,
				outputTokens: 100_000,
				cacheReadTokens: 5_000_000, // 5M cache reads (e.g., large context)
				cacheCreationTokens: 1_000_000, // 1M cache writes
			};

			const apiCost = calculateClaudeCostWithModel(tokens, 'claude-opus-4-5-20251101', 'api');
			const maxCost = calculateClaudeCostWithModel(tokens, 'claude-opus-4-5-20251101', 'max');

			// API cost includes cache tokens
			// Input: 0.5M * $5 = $2.50
			// Output: 0.1M * $25 = $2.50
			// Cache Read: 5M * $0.50 = $2.50
			// Cache Write: 1M * $6.25 = $6.25
			// Total: $13.75
			expect(apiCost).toBeCloseTo(13.75, 2);

			// Max cost excludes cache tokens
			// Input: 0.5M * $5 = $2.50
			// Output: 0.1M * $25 = $2.50
			// Cache Read: $0 (free)
			// Cache Write: $0 (free)
			// Total: $5.00
			expect(maxCost).toBeCloseTo(5.0, 2);

			// Max saves $8.75 (63% savings on this workload)
			const savings = apiCost - maxCost;
			expect(savings).toBeCloseTo(8.75, 2);
			expect(savings / apiCost).toBeCloseTo(0.636, 2); // ~64% savings
		});
	});
});
