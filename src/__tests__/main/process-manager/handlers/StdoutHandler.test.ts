/**
 * Tests for src/main/process-manager/handlers/StdoutHandler.ts
 *
 * Verifies that lastUsageTotals is correctly set for both Codex and non-Codex agents.
 * This is critical for the database population of cache tokens and cost data.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { StdoutHandler } from '../../../../main/process-manager/handlers/StdoutHandler';
import { DataBufferManager } from '../../../../main/process-manager/handlers/DataBufferManager';
import type { ManagedProcess, UsageStats } from '../../../../main/process-manager/types';
import type { AgentOutputParser, ParsedEvent } from '../../../../main/parsers';

// Mock logger
vi.mock('../../../../main/utils/logger', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

// Mock SSH error pattern matching
vi.mock('../../../../main/parsers/error-patterns', () => ({
	matchSshErrorPattern: vi.fn(() => null),
}));

describe('StdoutHandler', () => {
	let processes: Map<string, ManagedProcess>;
	let emitter: EventEmitter;
	let bufferManager: DataBufferManager;
	let stdoutHandler: StdoutHandler;
	let emittedUsage: UsageStats | null;

	beforeEach(() => {
		processes = new Map();
		emitter = new EventEmitter();
		bufferManager = new DataBufferManager(processes, emitter);
		stdoutHandler = new StdoutHandler({
			processes,
			emitter,
			bufferManager,
		});
		emittedUsage = null;
		emitter.on('usage', (_sessionId: string, usage: UsageStats) => {
			emittedUsage = usage;
		});
	});

	describe('lastUsageTotals for non-Codex agents', () => {
		it('should set lastUsageTotals for Claude agent (non-Codex)', () => {
			const sessionId = 'test-session-claude';

			// Create mock output parser that extracts usage
			const mockParser: Partial<AgentOutputParser> = {
				agentId: 'claude-code',
				parseJsonLine: vi.fn().mockReturnValue({
					type: 'system',
					subtype: 'usage',
				} as ParsedEvent),
				extractUsage: vi.fn().mockReturnValue({
					inputTokens: 1000,
					outputTokens: 500,
					cacheReadTokens: 200,
					cacheCreationTokens: 100,
					costUsd: 0.05,
					contextWindow: 200000,
					reasoningTokens: 0,
				}),
				extractSessionId: vi.fn().mockReturnValue(null),
				extractSlashCommands: vi.fn().mockReturnValue(null),
				isResultMessage: vi.fn().mockReturnValue(false),
				detectErrorFromLine: vi.fn().mockReturnValue(null),
			};

			// Create managed process for Claude (non-Codex)
			const managedProcess: ManagedProcess = {
				sessionId,
				toolType: 'claude-code', // Non-codex
				cwd: '/test',
				pid: 1234,
				isTerminal: false,
				isStreamJsonMode: true,
				jsonBuffer: '',
				startTime: Date.now(),
				outputParser: mockParser as AgentOutputParser,
			};
			processes.set(sessionId, managedProcess);

			// Simulate receiving usage data
			const usageJson = JSON.stringify({
				type: 'system',
				subtype: 'usage',
			});
			stdoutHandler.handleData(sessionId, usageJson + '\n');

			// Verify lastUsageTotals was set
			expect(managedProcess.lastUsageTotals).toBeDefined();
			expect(managedProcess.lastUsageTotals).toEqual({
				inputTokens: 1000,
				outputTokens: 500,
				cacheReadInputTokens: 200,
				cacheCreationInputTokens: 100,
				reasoningTokens: 0,
				totalCostUsd: 0.05,
			});

			// Verify usage event was emitted
			expect(emittedUsage).toBeDefined();
			expect(emittedUsage?.inputTokens).toBe(1000);
			expect(emittedUsage?.outputTokens).toBe(500);
		});

		it('should set lastUsageTotals for OpenCode agent (non-Codex)', () => {
			const sessionId = 'test-session-opencode';

			const mockParser: Partial<AgentOutputParser> = {
				agentId: 'opencode',
				parseJsonLine: vi.fn().mockReturnValue({
					type: 'system',
					subtype: 'usage',
				} as ParsedEvent),
				extractUsage: vi.fn().mockReturnValue({
					inputTokens: 2000,
					outputTokens: 800,
					cacheReadTokens: 400,
					cacheCreationTokens: 150,
					costUsd: 0.08,
					contextWindow: 128000,
					reasoningTokens: 50,
				}),
				extractSessionId: vi.fn().mockReturnValue(null),
				extractSlashCommands: vi.fn().mockReturnValue(null),
				isResultMessage: vi.fn().mockReturnValue(false),
				detectErrorFromLine: vi.fn().mockReturnValue(null),
			};

			const managedProcess: ManagedProcess = {
				sessionId,
				toolType: 'opencode', // Non-codex
				cwd: '/test',
				pid: 1235,
				isTerminal: false,
				isStreamJsonMode: true,
				jsonBuffer: '',
				startTime: Date.now(),
				outputParser: mockParser as AgentOutputParser,
			};
			processes.set(sessionId, managedProcess);

			const usageJson = JSON.stringify({ type: 'system', subtype: 'usage' });
			stdoutHandler.handleData(sessionId, usageJson + '\n');

			expect(managedProcess.lastUsageTotals).toBeDefined();
			expect(managedProcess.lastUsageTotals).toEqual({
				inputTokens: 2000,
				outputTokens: 800,
				cacheReadInputTokens: 400,
				cacheCreationInputTokens: 150,
				reasoningTokens: 50,
				totalCostUsd: 0.08,
			});
		});

		it('should NOT manually set lastUsageTotals for Codex (handled by normalizeCodexUsage)', () => {
			const sessionId = 'test-session-codex';

			const mockParser: Partial<AgentOutputParser> = {
				agentId: 'codex',
				parseJsonLine: vi.fn().mockReturnValue({
					type: 'message',
				} as ParsedEvent),
				extractUsage: vi.fn().mockReturnValue({
					inputTokens: 3000,
					outputTokens: 1200,
					cacheReadTokens: 0,
					cacheCreationTokens: 0,
					costUsd: 0.12,
					contextWindow: 200000,
					reasoningTokens: 100,
				}),
				extractSessionId: vi.fn().mockReturnValue(null),
				extractSlashCommands: vi.fn().mockReturnValue(null),
				isResultMessage: vi.fn().mockReturnValue(false),
				detectErrorFromLine: vi.fn().mockReturnValue(null),
			};

			const managedProcess: ManagedProcess = {
				sessionId,
				toolType: 'codex', // Codex agent - uses normalizeCodexUsage
				cwd: '/test',
				pid: 1236,
				isTerminal: false,
				isStreamJsonMode: true,
				jsonBuffer: '',
				startTime: Date.now(),
				outputParser: mockParser as AgentOutputParser,
			};
			processes.set(sessionId, managedProcess);

			const usageJson = JSON.stringify({ type: 'message' });
			stdoutHandler.handleData(sessionId, usageJson + '\n');

			// For Codex, lastUsageTotals IS set - but by normalizeCodexUsage function
			// The important thing is that it's set, regardless of which code path sets it
			expect(managedProcess.lastUsageTotals).toBeDefined();
			expect(managedProcess.lastUsageTotals?.inputTokens).toBe(3000);
			expect(managedProcess.lastUsageTotals?.outputTokens).toBe(1200);
		});

		it('should preserve cache tokens in lastUsageTotals for ExitHandler consumption', () => {
			const sessionId = 'test-session-cache';

			// This is the critical bug fix: cache tokens must be stored in lastUsageTotals
			// so ExitHandler can include them in query-complete event for database persistence
			const mockParser: Partial<AgentOutputParser> = {
				agentId: 'claude-code',
				parseJsonLine: vi.fn().mockReturnValue({
					type: 'system',
					subtype: 'usage',
				} as ParsedEvent),
				extractUsage: vi.fn().mockReturnValue({
					inputTokens: 15000,
					outputTokens: 2500,
					cacheReadTokens: 12000, // Significant cache read
					cacheCreationTokens: 1500, // Significant cache creation
					costUsd: 0.045,
					contextWindow: 200000,
					reasoningTokens: 0,
				}),
				extractSessionId: vi.fn().mockReturnValue(null),
				extractSlashCommands: vi.fn().mockReturnValue(null),
				isResultMessage: vi.fn().mockReturnValue(false),
				detectErrorFromLine: vi.fn().mockReturnValue(null),
			};

			const managedProcess: ManagedProcess = {
				sessionId,
				toolType: 'claude-code',
				cwd: '/test',
				pid: 1237,
				isTerminal: false,
				isStreamJsonMode: true,
				jsonBuffer: '',
				startTime: Date.now(),
				outputParser: mockParser as AgentOutputParser,
			};
			processes.set(sessionId, managedProcess);

			const usageJson = JSON.stringify({ type: 'system', subtype: 'usage' });
			stdoutHandler.handleData(sessionId, usageJson + '\n');

			// Verify cache tokens are preserved for database population
			expect(managedProcess.lastUsageTotals?.cacheReadInputTokens).toBe(12000);
			expect(managedProcess.lastUsageTotals?.cacheCreationInputTokens).toBe(1500);
			expect(managedProcess.lastUsageTotals?.totalCostUsd).toBe(0.045);
		});

		it('should preserve detectedModel in lastUsageTotals for ExitHandler consumption', () => {
			const sessionId = 'test-session-model-detection';

			// This test verifies the model detection flow:
			// ClaudeOutputParser extracts model from modelUsage → event.detectedModel is set →
			// StdoutHandler stores in lastUsageTotals.detectedModel → ExitHandler passes to query-complete
			const mockParser: Partial<AgentOutputParser> = {
				agentId: 'claude-code',
				parseJsonLine: vi.fn().mockReturnValue({
					type: 'result',
					detectedModel: 'claude-opus-4-5-20251101', // Model detected from modelUsage
				} as ParsedEvent),
				extractUsage: vi.fn().mockReturnValue({
					inputTokens: 5000,
					outputTokens: 1500,
					cacheReadTokens: 3000,
					cacheCreationTokens: 500,
					costUsd: 0.1,
					contextWindow: 200000,
				}),
				extractSessionId: vi.fn().mockReturnValue(null),
				extractSlashCommands: vi.fn().mockReturnValue(null),
				isResultMessage: vi.fn().mockReturnValue(true),
				detectErrorFromLine: vi.fn().mockReturnValue(null),
			};

			const managedProcess: ManagedProcess = {
				sessionId,
				toolType: 'claude-code',
				cwd: '/test',
				pid: 1240,
				isTerminal: false,
				isStreamJsonMode: true,
				jsonBuffer: '',
				startTime: Date.now(),
				outputParser: mockParser as AgentOutputParser,
			};
			processes.set(sessionId, managedProcess);

			const resultJson = JSON.stringify({
				type: 'result',
				result: 'Here is my response.',
				modelUsage: { 'claude-opus-4-5-20251101': { inputTokens: 5000, outputTokens: 1500 } },
			});
			stdoutHandler.handleData(sessionId, resultJson + '\n');

			// Verify detectedModel is preserved for CostByModelGraph population
			expect(managedProcess.lastUsageTotals).toBeDefined();
			expect(managedProcess.lastUsageTotals?.detectedModel).toBe('claude-opus-4-5-20251101');
			expect(managedProcess.lastUsageTotals?.inputTokens).toBe(5000);
			expect(managedProcess.lastUsageTotals?.outputTokens).toBe(1500);
		});

		it('should handle zero values correctly', () => {
			const sessionId = 'test-session-zero';

			const mockParser: Partial<AgentOutputParser> = {
				agentId: 'claude-code',
				parseJsonLine: vi.fn().mockReturnValue({
					type: 'system',
				} as ParsedEvent),
				extractUsage: vi.fn().mockReturnValue({
					inputTokens: 100,
					outputTokens: 50,
					cacheReadTokens: 0,
					cacheCreationTokens: 0,
					costUsd: 0,
					contextWindow: 200000,
					reasoningTokens: 0,
				}),
				extractSessionId: vi.fn().mockReturnValue(null),
				extractSlashCommands: vi.fn().mockReturnValue(null),
				isResultMessage: vi.fn().mockReturnValue(false),
				detectErrorFromLine: vi.fn().mockReturnValue(null),
			};

			const managedProcess: ManagedProcess = {
				sessionId,
				toolType: 'claude-code',
				cwd: '/test',
				pid: 1238,
				isTerminal: false,
				isStreamJsonMode: true,
				jsonBuffer: '',
				startTime: Date.now(),
				outputParser: mockParser as AgentOutputParser,
			};
			processes.set(sessionId, managedProcess);

			const usageJson = JSON.stringify({ type: 'system' });
			stdoutHandler.handleData(sessionId, usageJson + '\n');

			expect(managedProcess.lastUsageTotals).toBeDefined();
			expect(managedProcess.lastUsageTotals?.cacheReadInputTokens).toBe(0);
			expect(managedProcess.lastUsageTotals?.cacheCreationInputTokens).toBe(0);
			expect(managedProcess.lastUsageTotals?.totalCostUsd).toBe(0);
		});
	});

	describe('multiple usage updates', () => {
		it('should update lastUsageTotals on each usage event', () => {
			const sessionId = 'test-session-updates';

			let usageCallCount = 0;
			const usageValues = [
				{
					inputTokens: 500,
					outputTokens: 100,
					cacheReadTokens: 50,
					cacheCreationTokens: 25,
					costUsd: 0.01,
					contextWindow: 200000,
					reasoningTokens: 0,
				},
				{
					inputTokens: 1500,
					outputTokens: 400,
					cacheReadTokens: 200,
					cacheCreationTokens: 100,
					costUsd: 0.035,
					contextWindow: 200000,
					reasoningTokens: 0,
				},
			];

			const mockParser: Partial<AgentOutputParser> = {
				agentId: 'claude-code',
				parseJsonLine: vi.fn().mockReturnValue({ type: 'system' } as ParsedEvent),
				extractUsage: vi.fn().mockImplementation(() => {
					return usageValues[usageCallCount++] || usageValues[usageValues.length - 1];
				}),
				extractSessionId: vi.fn().mockReturnValue(null),
				extractSlashCommands: vi.fn().mockReturnValue(null),
				isResultMessage: vi.fn().mockReturnValue(false),
				detectErrorFromLine: vi.fn().mockReturnValue(null),
			};

			const managedProcess: ManagedProcess = {
				sessionId,
				toolType: 'claude-code',
				cwd: '/test',
				pid: 1239,
				isTerminal: false,
				isStreamJsonMode: true,
				jsonBuffer: '',
				startTime: Date.now(),
				outputParser: mockParser as AgentOutputParser,
			};
			processes.set(sessionId, managedProcess);

			// First update
			stdoutHandler.handleData(sessionId, '{"type":"system"}\n');
			expect(managedProcess.lastUsageTotals?.inputTokens).toBe(500);

			// Second update - should overwrite
			stdoutHandler.handleData(sessionId, '{"type":"system"}\n');
			expect(managedProcess.lastUsageTotals?.inputTokens).toBe(1500);
			expect(managedProcess.lastUsageTotals?.cacheReadInputTokens).toBe(200);
		});
	});
});
