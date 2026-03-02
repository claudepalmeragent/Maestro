/**
 * Tests for stats listener.
 * Handles query-complete events for usage statistics tracking.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupStatsListener } from '../../../main/process-listeners/stats-listener';
import type { ProcessManager } from '../../../main/process-manager';
import type { SafeSendFn } from '../../../main/utils/safe-send';
import type { QueryCompleteData } from '../../../main/process-manager/types';
import type { StatsDB } from '../../../main/stats';
import type { ProcessListenerDependencies } from '../../../main/process-listeners/types';

// Mock the pricing resolver to control billing mode resolution
vi.mock('../../../main/utils/pricing-resolver', () => ({
	resolveBillingMode: vi.fn(() => 'api'),
	resolveBillingModeAsync: vi.fn(() => Promise.resolve('api')),
	resolveModelForPricing: vi.fn(() => 'claude-sonnet-4-20250514'),
}));

// Mock the model registry store so claude-pricing functions can resolve aliases and pricing
vi.mock('../../../main/stores/getters', () => ({
	getModelRegistryStore: () => ({
		store: {
			models: {
				'claude-opus-4-6-20260115': {
					displayName: 'Claude Opus 4.6',
					family: 'opus',
					pricing: {
						INPUT_PER_MILLION: 5,
						OUTPUT_PER_MILLION: 25,
						CACHE_READ_PER_MILLION: 0.5,
						CACHE_CREATION_PER_MILLION: 6.25,
					},
				},
				'claude-sonnet-4-20250514': {
					displayName: 'Claude Sonnet 4',
					family: 'sonnet',
					pricing: {
						INPUT_PER_MILLION: 3,
						OUTPUT_PER_MILLION: 15,
						CACHE_READ_PER_MILLION: 0.3,
						CACHE_CREATION_PER_MILLION: 3.75,
					},
				},
			},
			aliases: {
				'claude-opus-4-6': 'claude-opus-4-6-20260115',
				opus: 'claude-opus-4-6-20260115',
				sonnet: 'claude-sonnet-4-20250514',
			},
			defaultModelId: 'claude-opus-4-6-20260115',
		},
	}),
	getSessionsStore: () => ({
		get: () => [],
	}),
}));

describe('Stats Listener', () => {
	let mockProcessManager: ProcessManager;
	let mockSafeSend: SafeSendFn;
	let mockStatsDB: StatsDB;
	let mockLogger: ProcessListenerDependencies['logger'];
	let eventHandlers: Map<string, (...args: unknown[]) => void>;

	beforeEach(() => {
		vi.clearAllMocks();
		eventHandlers = new Map();

		mockSafeSend = vi.fn();
		mockLogger = {
			info: vi.fn(),
			error: vi.fn(),
			warn: vi.fn(),
			debug: vi.fn(),
		};

		mockStatsDB = {
			isReady: vi.fn(() => true),
			insertQueryEvent: vi.fn(() => 'event-id-123'),
		} as unknown as StatsDB;

		mockProcessManager = {
			on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
				eventHandlers.set(event, handler);
			}),
		} as unknown as ProcessManager;
	});

	it('should register the query-complete event listener', () => {
		setupStatsListener(mockProcessManager, {
			safeSend: mockSafeSend,
			getStatsDB: () => mockStatsDB,
			logger: mockLogger,
		});

		expect(mockProcessManager.on).toHaveBeenCalledWith('query-complete', expect.any(Function));
	});

	it('should record query event to stats database when ready', async () => {
		setupStatsListener(mockProcessManager, {
			safeSend: mockSafeSend,
			getStatsDB: () => mockStatsDB,
			logger: mockLogger,
		});

		const handler = eventHandlers.get('query-complete');
		const testSessionId = 'test-session-123';
		const testQueryData: QueryCompleteData = {
			sessionId: testSessionId,
			agentType: 'claude-code',
			source: 'user',
			startTime: Date.now() - 5000,
			duration: 5000,
			projectPath: '/test/project',
			tabId: 'tab-123',
		};

		handler?.(testSessionId, testQueryData);

		// Wait for async processing
		await vi.waitFor(() => {
			expect(mockStatsDB.isReady).toHaveBeenCalled();
			// Use objectContaining to check core fields while allowing new dual-cost fields
			expect(mockStatsDB.insertQueryEvent).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId: testQueryData.sessionId,
					agentType: testQueryData.agentType,
					source: testQueryData.source,
					startTime: testQueryData.startTime,
					duration: testQueryData.duration,
					projectPath: testQueryData.projectPath,
					tabId: testQueryData.tabId,
					// Dual-source cost fields (Phase 2 of PRICING-DASHBOARD-COST-FIX)
					anthropicCostUsd: 0, // No cost reported in input data
					maestroCostUsd: 0, // Defaults to 0 for non-Claude models without detection
					maestroBillingMode: 'api', // Default billing mode
				})
			);
			expect(mockSafeSend).toHaveBeenCalledWith('stats:updated');
		});
	});

	it('should not record event when stats database is not ready', () => {
		vi.mocked(mockStatsDB.isReady).mockReturnValue(false);

		setupStatsListener(mockProcessManager, {
			safeSend: mockSafeSend,
			getStatsDB: () => mockStatsDB,
			logger: mockLogger,
		});

		const handler = eventHandlers.get('query-complete');
		const testQueryData: QueryCompleteData = {
			sessionId: 'session-456',
			agentType: 'codex',
			source: 'auto',
			startTime: Date.now(),
			duration: 1000,
			projectPath: '/test/project',
			tabId: 'tab-456',
		};

		handler?.('session-456', testQueryData);

		expect(mockStatsDB.isReady).toHaveBeenCalled();
		expect(mockStatsDB.insertQueryEvent).not.toHaveBeenCalled();
		expect(mockSafeSend).not.toHaveBeenCalled();
	});

	it('should log error when recording fails after retries', async () => {
		vi.mocked(mockStatsDB.insertQueryEvent).mockImplementation(() => {
			throw new Error('Database error');
		});

		setupStatsListener(mockProcessManager, {
			safeSend: mockSafeSend,
			getStatsDB: () => mockStatsDB,
			logger: mockLogger,
		});

		const handler = eventHandlers.get('query-complete');
		const testQueryData: QueryCompleteData = {
			sessionId: 'session-789',
			agentType: 'opencode',
			source: 'user',
			startTime: Date.now(),
			duration: 2000,
			projectPath: '/test/project',
			tabId: 'tab-789',
		};

		handler?.('session-789', testQueryData);

		// Wait for all retries to complete (100ms + 200ms + final attempt)
		await vi.waitFor(
			() => {
				expect(mockLogger.error).toHaveBeenCalledWith(
					expect.stringContaining('Failed to record query event after 3 attempts'),
					'[Stats]',
					expect.objectContaining({
						sessionId: 'session-789',
					})
				);
			},
			{ timeout: 1000 }
		);
		// Should have tried 3 times
		expect(mockStatsDB.insertQueryEvent).toHaveBeenCalledTimes(3);
		// Should not have broadcasted update on failure
		expect(mockSafeSend).not.toHaveBeenCalled();
	});

	it('should log debug info when recording succeeds', async () => {
		setupStatsListener(mockProcessManager, {
			safeSend: mockSafeSend,
			getStatsDB: () => mockStatsDB,
			logger: mockLogger,
		});

		const handler = eventHandlers.get('query-complete');
		const testQueryData: QueryCompleteData = {
			sessionId: 'session-abc',
			agentType: 'claude-code',
			source: 'user',
			startTime: Date.now(),
			duration: 3000,
			projectPath: '/test/project',
			tabId: 'tab-abc',
		};

		handler?.('session-abc', testQueryData);

		// Wait for async processing
		await vi.waitFor(() => {
			expect(mockLogger.debug).toHaveBeenCalledWith(
				expect.stringContaining('Recorded query event'),
				'[Stats]',
				expect.objectContaining({
					sessionId: 'session-abc',
					agentType: 'claude-code',
					source: 'user',
					duration: 3000,
				})
			);
		});
	});

	it('should retry on transient failure and succeed', async () => {
		// First call fails, second succeeds
		vi.mocked(mockStatsDB.insertQueryEvent)
			.mockImplementationOnce(() => {
				throw new Error('Transient error');
			})
			.mockImplementationOnce(() => 'event-id-456');

		setupStatsListener(mockProcessManager, {
			safeSend: mockSafeSend,
			getStatsDB: () => mockStatsDB,
			logger: mockLogger,
		});

		const handler = eventHandlers.get('query-complete');
		const testQueryData: QueryCompleteData = {
			sessionId: 'session-retry',
			agentType: 'claude-code',
			source: 'user',
			startTime: Date.now(),
			duration: 1000,
			projectPath: '/test/project',
			tabId: 'tab-retry',
		};

		handler?.('session-retry', testQueryData);

		// Wait for retry to complete
		await vi.waitFor(
			() => {
				expect(mockStatsDB.insertQueryEvent).toHaveBeenCalledTimes(2);
				expect(mockSafeSend).toHaveBeenCalledWith('stats:updated');
			},
			{ timeout: 500 }
		);
		// Should have logged warning for first failure
		expect(mockLogger.warn).toHaveBeenCalledWith(
			expect.stringContaining('Stats DB insert failed'),
			'[Stats]',
			expect.any(Object)
		);
	});

	describe('Dual-source cost storage', () => {
		it('should store both Anthropic and Maestro costs for Claude agents', async () => {
			setupStatsListener(mockProcessManager, {
				safeSend: mockSafeSend,
				getStatsDB: () => mockStatsDB,
				logger: mockLogger,
			});

			const handler = eventHandlers.get('query-complete');
			const testQueryData: QueryCompleteData = {
				sessionId: 'claude-session',
				agentId: 'agent-123',
				agentType: 'claude-code',
				source: 'user',
				startTime: Date.now(),
				duration: 2000,
				inputTokens: 1000,
				outputTokens: 500,
				cacheReadInputTokens: 200,
				cacheCreationInputTokens: 100,
				totalCostUsd: 0.05,
				detectedModel: 'claude-sonnet-4-20250514',
			};

			handler?.('claude-session', testQueryData);

			await vi.waitFor(() => {
				expect(mockStatsDB.insertQueryEvent).toHaveBeenCalledWith(
					expect.objectContaining({
						sessionId: 'claude-session',
						agentType: 'claude-code',
						// Anthropic values
						anthropicCostUsd: 0.05,
						anthropicModel: 'claude-sonnet-4-20250514',
						// Maestro values
						maestroBillingMode: 'api',
						maestroPricingModel: 'claude-sonnet-4-20250514',
					})
				);
			});
		});

		it('should set billingMode to free for non-Claude models', async () => {
			setupStatsListener(mockProcessManager, {
				safeSend: mockSafeSend,
				getStatsDB: () => mockStatsDB,
				logger: mockLogger,
			});

			const handler = eventHandlers.get('query-complete');
			const testQueryData: QueryCompleteData = {
				sessionId: 'ollama-session',
				agentType: 'claude-code', // Still using claude-code agent
				source: 'user',
				startTime: Date.now(),
				duration: 1000,
				totalCostUsd: 0, // Ollama reports 0 cost
				detectedModel: 'llama3:70b', // Non-Claude model
			};

			handler?.('ollama-session', testQueryData);

			await vi.waitFor(() => {
				expect(mockStatsDB.insertQueryEvent).toHaveBeenCalledWith(
					expect.objectContaining({
						maestroBillingMode: 'free', // Should be free for non-Claude models
						maestroCostUsd: 0,
						maestroPricingModel: 'llama3:70b',
					})
				);
			});
		});

		it('should pass through cost for non-Claude agent types', async () => {
			setupStatsListener(mockProcessManager, {
				safeSend: mockSafeSend,
				getStatsDB: () => mockStatsDB,
				logger: mockLogger,
			});

			const handler = eventHandlers.get('query-complete');
			const testQueryData: QueryCompleteData = {
				sessionId: 'codex-session',
				agentType: 'codex', // Non-Claude agent type
				source: 'auto',
				startTime: Date.now(),
				duration: 1500,
				totalCostUsd: 0.02,
				detectedModel: 'gpt-4',
			};

			handler?.('codex-session', testQueryData);

			await vi.waitFor(() => {
				expect(mockStatsDB.insertQueryEvent).toHaveBeenCalledWith(
					expect.objectContaining({
						// For non-Claude agents, both costs should be the same
						anthropicCostUsd: 0.02,
						maestroCostUsd: 0.02,
						maestroBillingMode: 'api', // Default
					})
				);
			});
		});

		it('should resolve billing mode for Claude agents even when model is not detected', async () => {
			// Mock resolveBillingModeAsync to return 'max' for this test
			const { resolveBillingModeAsync } = await import('../../../main/utils/pricing-resolver');
			vi.mocked(resolveBillingModeAsync).mockResolvedValue('max');

			setupStatsListener(mockProcessManager, {
				safeSend: mockSafeSend,
				getStatsDB: () => mockStatsDB,
				logger: mockLogger,
			});

			const handler = eventHandlers.get('query-complete');
			const testQueryData: QueryCompleteData = {
				sessionId: 'no-model-session',
				agentId: 'max-agent',
				agentType: 'claude-code',
				source: 'user',
				startTime: Date.now(),
				duration: 1000,
				totalCostUsd: 0.03,
				// No detectedModel - this is the bug scenario
			};

			handler?.('no-model-session', testQueryData);

			await vi.waitFor(() => {
				expect(mockStatsDB.insertQueryEvent).toHaveBeenCalledWith(
					expect.objectContaining({
						sessionId: 'no-model-session',
						agentType: 'claude-code',
						// Billing mode should still be resolved even without model detection
						maestroBillingMode: 'max', // Should NOT default to 'api'
					})
				);
			});
		});
	});

	describe('dual cost calculation with short-form model IDs', () => {
		it('should calculate non-zero maestro cost for short-form model ID', async () => {
			setupStatsListener(mockProcessManager, {
				safeSend: mockSafeSend,
				getStatsDB: () => mockStatsDB,
				logger: mockLogger,
			});

			const queryCompleteHandler = eventHandlers.get('query-complete');
			expect(queryCompleteHandler).toBeDefined();

			const queryData: QueryCompleteData = {
				sessionId: 'test-session',
				agentType: 'claude-code',
				source: 'user',
				startTime: Date.now() - 5000,
				duration: 5000,
				inputTokens: 1000,
				outputTokens: 500,
				cacheReadInputTokens: 200,
				cacheCreationInputTokens: 100,
				totalCostUsd: 0,
				detectedModel: 'claude-opus-4-6',
			};

			queryCompleteHandler!('test-session', queryData);

			// Wait for async processing
			await new Promise((resolve) => setTimeout(resolve, 200));

			expect(mockStatsDB.insertQueryEvent).toHaveBeenCalled();
			const insertedEvent = (mockStatsDB.insertQueryEvent as ReturnType<typeof vi.fn>).mock
				.calls[0][0];

			// maestro_cost_usd should be non-zero (calculated from tokens)
			expect(insertedEvent.maestroCostUsd).toBeGreaterThan(0);
			// maestro_billing_mode should NOT be 'free'
			expect(insertedEvent.maestroBillingMode).not.toBe('free');
			// maestro_pricing_model should be the resolved full model ID
			expect(insertedEvent.maestroPricingModel).toBe('claude-opus-4-6-20260115');
		});

		it('should calculate non-zero anthropic cost when reported cost is 0 but tokens exist', async () => {
			setupStatsListener(mockProcessManager, {
				safeSend: mockSafeSend,
				getStatsDB: () => mockStatsDB,
				logger: mockLogger,
			});

			const queryCompleteHandler = eventHandlers.get('query-complete');
			expect(queryCompleteHandler).toBeDefined();

			const queryData: QueryCompleteData = {
				sessionId: 'test-session-2',
				agentType: 'claude-code',
				source: 'user',
				startTime: Date.now() - 5000,
				duration: 5000,
				inputTokens: 10000,
				outputTokens: 5000,
				totalCostUsd: 0,
				detectedModel: 'claude-opus-4-6',
			};

			queryCompleteHandler!('test-session-2', queryData);

			await new Promise((resolve) => setTimeout(resolve, 200));

			expect(mockStatsDB.insertQueryEvent).toHaveBeenCalled();
			const insertedEvent = (mockStatsDB.insertQueryEvent as ReturnType<typeof vi.fn>).mock
				.calls[0][0];

			// anthropic_cost_usd should be non-zero (fallback calculated from tokens at API pricing)
			expect(insertedEvent.anthropicCostUsd).toBeGreaterThan(0);
		});

		it('should preserve non-zero anthropic cost when Claude Code reports it', async () => {
			setupStatsListener(mockProcessManager, {
				safeSend: mockSafeSend,
				getStatsDB: () => mockStatsDB,
				logger: mockLogger,
			});

			const queryCompleteHandler = eventHandlers.get('query-complete');
			expect(queryCompleteHandler).toBeDefined();

			const queryData: QueryCompleteData = {
				sessionId: 'test-session-3',
				agentType: 'claude-code',
				source: 'user',
				startTime: Date.now() - 5000,
				duration: 5000,
				inputTokens: 10000,
				outputTokens: 5000,
				totalCostUsd: 0.5,
				detectedModel: 'claude-opus-4-6',
			};

			queryCompleteHandler!('test-session-3', queryData);

			await new Promise((resolve) => setTimeout(resolve, 200));

			expect(mockStatsDB.insertQueryEvent).toHaveBeenCalled();
			const insertedEvent = (mockStatsDB.insertQueryEvent as ReturnType<typeof vi.fn>).mock
				.calls[0][0];

			// anthropic_cost_usd should be the original reported value (0.5), NOT overwritten
			expect(insertedEvent.anthropicCostUsd).toBe(0.5);
		});
	});
});
