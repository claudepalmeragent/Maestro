/**
 * Tests for src/main/process-manager/handlers/StdoutHandler.ts
 *
 * Covers the StdoutHandler class and its internal normalizeUsageToDelta logic.
 * normalizeUsageToDelta is a private module-level function, so it is tested
 * indirectly through the StdoutHandler's stream-JSON processing paths.
 *
 * normalizeUsageToDelta behavior:
 * - First call: stores totals in lastUsageTotals, returns stats as-is
 * - Subsequent calls (cumulative): computes delta from previous totals
 * - If values decrease (not monotonic): sets usageIsCumulative = false, returns raw stats
 * - If usageIsCumulative is already false: returns raw stats, stores totals
 *
 * Also verifies:
 * - lastUsageTotals is correctly set for both Codex and non-Codex agents
 * - SSH error detection on stdout (lifecycle-gated)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../../../main/utils/logger', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

vi.mock('../../../../main/process-manager/utils/bufferUtils', () => ({
	appendToBuffer: vi.fn((buf: string, data: string) => buf + data),
}));

vi.mock('../../../../main/parsers/usage-aggregator', () => ({
	aggregateModelUsage: vi.fn(() => ({
		inputTokens: 100,
		outputTokens: 50,
		cacheReadInputTokens: 0,
		cacheCreationInputTokens: 0,
		totalCostUsd: 0.01,
		contextWindow: 200000,
	})),
}));

vi.mock('../../../../main/parsers/error-patterns', () => ({
	matchSshErrorPattern: vi.fn(() => null),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────

import { StdoutHandler } from '../../../../main/process-manager/handlers/StdoutHandler';
import type { ManagedProcess, UsageStats, AgentError } from '../../../../main/process-manager/types';
import type { AgentOutputParser, ParsedEvent } from '../../../../main/parsers';

// ── Helpers ────────────────────────────────────────────────────────────────

function createMockProcess(overrides: Partial<ManagedProcess> = {}): ManagedProcess {
	return {
		sessionId: 'test-session',
		toolType: 'claude-code',
		cwd: '/tmp',
		pid: 1234,
		isTerminal: false,
		startTime: Date.now(),
		isStreamJsonMode: false,
		isBatchMode: false,
		jsonBuffer: '',
		stdoutBuffer: '',
		contextWindow: 200000,
		lastUsageTotals: undefined,
		usageIsCumulative: undefined,
		sessionIdEmitted: false,
		resultEmitted: false,
		errorEmitted: false,
		outputParser: undefined,
		sshRemoteId: undefined,
		sshRemoteHost: undefined,
		streamedText: '',
		...overrides,
	} as ManagedProcess;
}

function createMockBufferManager() {
	return {
		emitDataBuffered: vi.fn(),
		flushDataBuffer: vi.fn(),
	};
}

function createTestContext(processOverrides: Partial<ManagedProcess> = {}) {
	const processes = new Map<string, ManagedProcess>();
	const emitter = new EventEmitter();
	const bufferManager = createMockBufferManager();
	const sessionId = 'test-session';
	const proc = createMockProcess({ sessionId, ...processOverrides });
	processes.set(sessionId, proc);

	const handler = new StdoutHandler({ processes, emitter, bufferManager: bufferManager as any });

	return { processes, emitter, bufferManager, handler, sessionId, proc };
}

/**
 * Send a complete JSON line through stream-JSON mode.
 * Appends a newline so the handler parses it as a complete line.
 */
function sendJsonLine(handler: StdoutHandler, sessionId: string, obj: Record<string, unknown>) {
	handler.handleData(sessionId, JSON.stringify(obj) + '\n');
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('StdoutHandler', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// ── handleData dispatch routing ────────────────────────────────────────

	describe('handleData routing', () => {
		it('should silently return when sessionId is not found in processes map', () => {
			const { handler, bufferManager } = createTestContext();
			handler.handleData('nonexistent-session', 'some output');
			expect(bufferManager.emitDataBuffered).not.toHaveBeenCalled();
		});

		it('should emit via bufferManager in plain text mode', () => {
			const { handler, bufferManager, sessionId } = createTestContext({
				isStreamJsonMode: false,
				isBatchMode: false,
			});

			handler.handleData(sessionId, 'Hello, world!');
			expect(bufferManager.emitDataBuffered).toHaveBeenCalledWith(sessionId, 'Hello, world!');
		});

		it('should strip leaked terminal mode sequences in plain text mode', () => {
			const { handler, bufferManager, sessionId } = createTestContext({
				isStreamJsonMode: false,
				isBatchMode: false,
			});

			handler.handleData(sessionId, '\x1b[?1h\x1b=Hello, remote world!');
			expect(bufferManager.emitDataBuffered).toHaveBeenCalledWith(
				sessionId,
				'Hello, remote world!'
			);
		});

		it('should accumulate to jsonBuffer in batch mode', () => {
			const { handler, bufferManager, sessionId, proc } = createTestContext({
				isBatchMode: true,
				isStreamJsonMode: false,
			});

			handler.handleData(sessionId, '{"partial":');
			handler.handleData(sessionId, '"data"}');

			expect(proc.jsonBuffer).toBe('{"partial":"data"}');
			expect(bufferManager.emitDataBuffered).not.toHaveBeenCalled();
		});

		it('should process complete lines in stream JSON mode', () => {
			const { handler, bufferManager, sessionId, proc } = createTestContext({
				isStreamJsonMode: true,
			});

			// Send non-JSON text as a complete line -- it should fall through
			// to the catch block and be emitted via bufferManager
			handler.handleData(sessionId, 'plain text output\n');
			expect(bufferManager.emitDataBuffered).toHaveBeenCalledWith(sessionId, 'plain text output');
		});

		it('should strip terminal mode sequences before parsing stream JSON lines', () => {
			const { handler, bufferManager, sessionId } = createTestContext({
				isStreamJsonMode: true,
				outputParser: undefined,
			});

			handler.handleData(
				sessionId,
				'\x1b[?1h\x1b={"type":"result","result":"Recovered remote output"}\n'
			);

			expect(bufferManager.emitDataBuffered).toHaveBeenCalledWith(
				sessionId,
				'Recovered remote output'
			);
		});

		it('should buffer incomplete lines in stream JSON mode until newline arrives', () => {
			const { handler, bufferManager, sessionId, proc } = createTestContext({
				isStreamJsonMode: true,
			});

			// Send partial line (no newline)
			handler.handleData(sessionId, '{"incomplete":');
			expect(bufferManager.emitDataBuffered).not.toHaveBeenCalled();

			// jsonBuffer should hold the partial data
			expect(proc.jsonBuffer).toBe('{"incomplete":');
		});

		it('should skip empty lines in stream JSON mode', () => {
			const { handler, bufferManager, sessionId } = createTestContext({
				isStreamJsonMode: true,
			});

			handler.handleData(sessionId, '\n\n\n');
			expect(bufferManager.emitDataBuffered).not.toHaveBeenCalled();
		});
	});

	// ── Legacy message handling (no outputParser) ──────────────────────────

	describe('legacy message handling (no outputParser)', () => {
		it('should emit result data for type=result messages', () => {
			const { handler, bufferManager, sessionId, proc } = createTestContext({
				isStreamJsonMode: true,
				outputParser: undefined,
			});

			sendJsonLine(handler, sessionId, {
				type: 'result',
				result: 'Here is the answer.',
			});

			expect(proc.resultEmitted).toBe(true);
			expect(bufferManager.emitDataBuffered).toHaveBeenCalledWith(sessionId, 'Here is the answer.');
		});

		it('should only emit result once (first result wins)', () => {
			const { handler, bufferManager, sessionId } = createTestContext({
				isStreamJsonMode: true,
				outputParser: undefined,
			});

			sendJsonLine(handler, sessionId, {
				type: 'result',
				result: 'First answer.',
			});

			sendJsonLine(handler, sessionId, {
				type: 'result',
				result: 'Second answer.',
			});

			const resultCalls = (bufferManager.emitDataBuffered as any).mock.calls.filter(
				(call: any[]) => call[1] === 'First answer.' || call[1] === 'Second answer.'
			);
			expect(resultCalls).toHaveLength(1);
			expect(resultCalls[0][1]).toBe('First answer.');
		});

		it('should extract session_id and emit session-id event', () => {
			const { handler, emitter, sessionId, proc } = createTestContext({
				isStreamJsonMode: true,
				outputParser: undefined,
			});

			const sessionIdSpy = vi.fn();
			emitter.on('session-id', sessionIdSpy);

			sendJsonLine(handler, sessionId, {
				session_id: 'agent-session-xyz',
			});

			expect(proc.sessionIdEmitted).toBe(true);
			expect(sessionIdSpy).toHaveBeenCalledWith(sessionId, 'agent-session-xyz');
		});

		it('should only emit session-id once', () => {
			const { handler, emitter, sessionId } = createTestContext({
				isStreamJsonMode: true,
				outputParser: undefined,
			});

			const sessionIdSpy = vi.fn();
			emitter.on('session-id', sessionIdSpy);

			sendJsonLine(handler, sessionId, { session_id: 'first-id' });
			sendJsonLine(handler, sessionId, { session_id: 'second-id' });

			expect(sessionIdSpy).toHaveBeenCalledTimes(1);
			expect(sessionIdSpy).toHaveBeenCalledWith(sessionId, 'first-id');
		});

		it('should emit slash-commands for system init messages', () => {
			const { handler, emitter, sessionId } = createTestContext({
				isStreamJsonMode: true,
				outputParser: undefined,
			});

			const slashSpy = vi.fn();
			emitter.on('slash-commands', slashSpy);

			sendJsonLine(handler, sessionId, {
				type: 'system',
				subtype: 'init',
				slash_commands: ['/help', '/compact'],
			});

			expect(slashSpy).toHaveBeenCalledWith(sessionId, ['/help', '/compact']);
		});

		it('should skip error messages in legacy mode', () => {
			const { handler, bufferManager, sessionId } = createTestContext({
				isStreamJsonMode: true,
				outputParser: undefined,
			});

			sendJsonLine(handler, sessionId, {
				type: 'error',
				error: 'Something went wrong',
			});

			// Error messages should not be emitted via bufferManager
			expect(bufferManager.emitDataBuffered).not.toHaveBeenCalled();
		});

		it('should skip messages with error field in legacy mode', () => {
			const { handler, bufferManager, sessionId } = createTestContext({
				isStreamJsonMode: true,
				outputParser: undefined,
			});

			sendJsonLine(handler, sessionId, {
				error: 'auth failed',
			});

			expect(bufferManager.emitDataBuffered).not.toHaveBeenCalled();
		});

		it('should emit usage stats for messages with modelUsage', () => {
			const { handler, emitter, sessionId } = createTestContext({
				isStreamJsonMode: true,
				outputParser: undefined,
			});

			const usageSpy = vi.fn();
			emitter.on('usage', usageSpy);

			sendJsonLine(handler, sessionId, {
				modelUsage: {
					'claude-3-sonnet': {
						inputTokens: 1000,
						outputTokens: 500,
					},
				},
				total_cost_usd: 0.05,
			});

			expect(usageSpy).toHaveBeenCalledTimes(1);
			// The mock aggregateModelUsage always returns the fixed value
			expect(usageSpy).toHaveBeenCalledWith(sessionId, {
				inputTokens: 100,
				outputTokens: 50,
				cacheReadInputTokens: 0,
				cacheCreationInputTokens: 0,
				totalCostUsd: 0.01,
				contextWindow: 200000,
			});
		});

		it('should emit usage stats for messages with usage field', () => {
			const { handler, emitter, sessionId } = createTestContext({
				isStreamJsonMode: true,
				outputParser: undefined,
			});

			const usageSpy = vi.fn();
			emitter.on('usage', usageSpy);

			sendJsonLine(handler, sessionId, {
				usage: { input_tokens: 500, output_tokens: 200 },
			});

			expect(usageSpy).toHaveBeenCalledTimes(1);
		});

		it('should emit usage stats for messages with total_cost_usd only', () => {
			const { handler, emitter, sessionId } = createTestContext({
				isStreamJsonMode: true,
				outputParser: undefined,
			});

			const usageSpy = vi.fn();
			emitter.on('usage', usageSpy);

			sendJsonLine(handler, sessionId, {
				total_cost_usd: 0.03,
			});

			expect(usageSpy).toHaveBeenCalledTimes(1);
		});

		it('should handle combined result and session_id in one message', () => {
			const { handler, emitter, bufferManager, sessionId, proc } = createTestContext({
				isStreamJsonMode: true,
				outputParser: undefined,
			});

			const sessionIdSpy = vi.fn();
			emitter.on('session-id', sessionIdSpy);

			sendJsonLine(handler, sessionId, {
				type: 'result',
				result: 'The answer is 42.',
				session_id: 'sess-combined',
			});

			expect(proc.resultEmitted).toBe(true);
			expect(proc.sessionIdEmitted).toBe(true);
			expect(bufferManager.emitDataBuffered).toHaveBeenCalledWith(sessionId, 'The answer is 42.');
			expect(sessionIdSpy).toHaveBeenCalledWith(sessionId, 'sess-combined');
		});
	});

	describe('codex multi-message turn handling', () => {
		it('should emit only the final Codex result at turn completion', () => {
			const parser = {
				agentId: 'codex',
				parseJsonLine: vi.fn((line: string) => {
					const parsed = JSON.parse(line);
					if (parsed.type === 'agent') {
						return { type: 'result', text: parsed.text };
					}
					if (parsed.type === 'done') {
						return {
							type: 'usage',
							usage: {
								inputTokens: 100,
								outputTokens: 50,
								cacheReadTokens: 0,
								cacheCreationTokens: 0,
								contextWindow: 400000,
							},
						};
					}
					return { type: 'system' };
				}),
				parseJsonObject: vi.fn((parsed: any) => {
					if (parsed.type === 'agent') {
						return { type: 'result', text: parsed.text };
					}
					if (parsed.type === 'done') {
						return {
							type: 'usage',
							usage: {
								inputTokens: 100,
								outputTokens: 50,
								cacheReadTokens: 0,
								cacheCreationTokens: 0,
								contextWindow: 400000,
							},
						};
					}
					return { type: 'system' };
				}),
				extractUsage: vi.fn((event: any) => event.usage || null),
				extractSessionId: vi.fn(() => null),
				extractSlashCommands: vi.fn(() => null),
				isResultMessage: vi.fn((event: any) => event.type === 'result' && !!event.text),
				detectErrorFromLine: vi.fn(() => null),
				detectErrorFromParsed: vi.fn(() => null),
			};

			const { handler, bufferManager, sessionId, proc } = createTestContext({
				isStreamJsonMode: true,
				toolType: 'codex',
				outputParser: parser as any,
			});

			sendJsonLine(handler, sessionId, {
				type: 'agent',
				text: "I'm checking the project directory now.",
			});
			expect(bufferManager.emitDataBuffered).not.toHaveBeenCalled();
			expect(proc.resultEmitted).toBe(false);

			sendJsonLine(handler, sessionId, {
				type: 'agent',
				text: '{"confidence":55,"ready":false,"message":"README.md"}',
			});
			expect(bufferManager.emitDataBuffered).not.toHaveBeenCalled();
			expect(proc.resultEmitted).toBe(false);

			sendJsonLine(handler, sessionId, { type: 'done' });

			expect(proc.resultEmitted).toBe(true);
			expect(bufferManager.emitDataBuffered).toHaveBeenCalledTimes(1);
			expect(bufferManager.emitDataBuffered).toHaveBeenCalledWith(
				sessionId,
				'{"confidence":55,"ready":false,"message":"README.md"}'
			);
		});
	});

	// ── normalizeUsageToDelta (tested via outputParser path) ───────────────

	describe('normalizeUsageToDelta (via outputParser stream-JSON path)', () => {
		/**
		 * These tests exercise the normalizeUsageToDelta function indirectly
		 * through the StdoutHandler's handleParsedEvent -> buildUsageStats ->
		 * normalizeUsageToDelta pipeline. We create a minimal outputParser mock
		 * that returns usage data, allowing us to observe the normalized result
		 * via the 'usage' event emitter.
		 */

		function createOutputParserMock(
			usageReturn: {
				inputTokens: number;
				outputTokens: number;
				cacheReadTokens?: number;
				cacheCreationTokens?: number;
				costUsd?: number;
				contextWindow?: number;
				reasoningTokens?: number;
			} | null
		) {
			return {
				agentId: 'claude-code',
				parseJsonLine: vi.fn((line: string) => {
					try {
						const parsed = JSON.parse(line);
						return {
							type: parsed.type || 'message',
							text: parsed.text,
							isPartial: false,
						};
					} catch {
						return null;
					}
				}),
				parseJsonObject: vi.fn((parsed: any) => {
					return {
						type: parsed.type || 'message',
						text: parsed.text,
						isPartial: false,
					};
				}),
				extractUsage: vi.fn(() => usageReturn),
				extractSessionId: vi.fn(() => null),
				extractSlashCommands: vi.fn(() => null),
				isResultMessage: vi.fn(() => false),
				detectErrorFromLine: vi.fn(() => null),
				detectErrorFromParsed: vi.fn(() => null),
			};
		}

		it('should pass through usage stats on first call (no previous totals)', () => {
			const parser = createOutputParserMock({
				inputTokens: 1000,
				outputTokens: 500,
				cacheReadTokens: 200,
				cacheCreationTokens: 100,
				costUsd: 0.05,
				contextWindow: 200000,
			});

			const { handler, emitter, sessionId, proc } = createTestContext({
				isStreamJsonMode: true,
				toolType: 'claude-code',
				outputParser: parser as any,
			});

			const usageSpy = vi.fn();
			emitter.on('usage', usageSpy);

			sendJsonLine(handler, sessionId, { type: 'message', text: 'hello' });

			expect(usageSpy).toHaveBeenCalledTimes(1);
			const emittedUsage = usageSpy.mock.calls[0][1];
			expect(emittedUsage.inputTokens).toBe(1000);
			expect(emittedUsage.outputTokens).toBe(500);
			expect(emittedUsage.cacheReadInputTokens).toBe(200);
			expect(emittedUsage.cacheCreationInputTokens).toBe(100);
			expect(emittedUsage.totalCostUsd).toBe(0.05);
			expect(emittedUsage.contextWindow).toBe(200000);

			// Should have stored totals for next call
			expect(proc.lastUsageTotals).toEqual({
				inputTokens: 1000,
				outputTokens: 500,
				cacheReadInputTokens: 200,
				cacheCreationInputTokens: 100,
				reasoningTokens: 0,
			});
		});

		it('should compute delta on second cumulative call (monotonically increasing)', () => {
			// Start with a parser that returns increasing cumulative values
			let callCount = 0;
			const usageSequence = [
				{
					inputTokens: 1000,
					outputTokens: 500,
					cacheReadTokens: 200,
					cacheCreationTokens: 100,
					costUsd: 0.05,
					contextWindow: 200000,
				},
				{
					inputTokens: 1800,
					outputTokens: 900,
					cacheReadTokens: 350,
					cacheCreationTokens: 180,
					costUsd: 0.09,
					contextWindow: 200000,
				},
			];

			const parser = createOutputParserMock(null);
			parser.extractUsage.mockImplementation(() => {
				return usageSequence[callCount++] || null;
			});

			const { handler, emitter, sessionId, proc } = createTestContext({
				isStreamJsonMode: true,
				toolType: 'claude-code',
				outputParser: parser as any,
			});

			const usageSpy = vi.fn();
			emitter.on('usage', usageSpy);

			// First call: returns raw values
			sendJsonLine(handler, sessionId, { type: 'message', text: 'turn 1' });

			expect(usageSpy).toHaveBeenCalledTimes(1);
			expect(usageSpy.mock.calls[0][1].inputTokens).toBe(1000);
			expect(usageSpy.mock.calls[0][1].outputTokens).toBe(500);

			// Second call: should return delta
			sendJsonLine(handler, sessionId, { type: 'message', text: 'turn 2' });

			expect(usageSpy).toHaveBeenCalledTimes(2);
			const delta = usageSpy.mock.calls[1][1];
			expect(delta.inputTokens).toBe(800); // 1800 - 1000
			expect(delta.outputTokens).toBe(400); // 900 - 500
			expect(delta.cacheReadInputTokens).toBe(150); // 350 - 200
			expect(delta.cacheCreationInputTokens).toBe(80); // 180 - 100

			// Cost and contextWindow should still be passed through from the raw stats
			expect(delta.totalCostUsd).toBe(0.09);
			expect(delta.contextWindow).toBe(200000);

			// usageIsCumulative should be set to true
			expect(proc.usageIsCumulative).toBe(true);
		});

		it('should detect non-monotonic decrease and switch to raw mode', () => {
			let callCount = 0;
			const usageSequence = [
				{
					inputTokens: 1000,
					outputTokens: 500,
					cacheReadTokens: 200,
					cacheCreationTokens: 100,
					costUsd: 0.05,
					contextWindow: 200000,
				},
				{
					// inputTokens decreased: indicates per-turn reporting, not cumulative
					inputTokens: 300,
					outputTokens: 150,
					cacheReadTokens: 50,
					cacheCreationTokens: 20,
					costUsd: 0.02,
					contextWindow: 200000,
				},
			];

			const parser = createOutputParserMock(null);
			parser.extractUsage.mockImplementation(() => {
				return usageSequence[callCount++] || null;
			});

			const { handler, emitter, sessionId, proc } = createTestContext({
				isStreamJsonMode: true,
				toolType: 'claude-code',
				outputParser: parser as any,
			});

			const usageSpy = vi.fn();
			emitter.on('usage', usageSpy);

			// First call: raw values
			sendJsonLine(handler, sessionId, { type: 'message', text: 'turn 1' });
			expect(usageSpy.mock.calls[0][1].inputTokens).toBe(1000);

			// Second call: decrease detected, returns raw values (not negative deltas)
			sendJsonLine(handler, sessionId, { type: 'message', text: 'turn 2' });

			expect(usageSpy).toHaveBeenCalledTimes(2);
			const rawStats = usageSpy.mock.calls[1][1];
			expect(rawStats.inputTokens).toBe(300);
			expect(rawStats.outputTokens).toBe(150);
			expect(rawStats.cacheReadInputTokens).toBe(50);
			expect(rawStats.cacheCreationInputTokens).toBe(20);

			// Should have flagged as non-cumulative
			expect(proc.usageIsCumulative).toBe(false);
		});

		it('should continue returning raw stats once usageIsCumulative is false', () => {
			let callCount = 0;
			const usageSequence = [
				{
					inputTokens: 1000,
					outputTokens: 500,
					cacheReadTokens: 200,
					cacheCreationTokens: 100,
					costUsd: 0.05,
					contextWindow: 200000,
				},
				{
					// Decrease triggers non-cumulative detection
					inputTokens: 300,
					outputTokens: 150,
					cacheReadTokens: 50,
					cacheCreationTokens: 20,
					costUsd: 0.02,
					contextWindow: 200000,
				},
				{
					// Third call: even though this looks "cumulative" relative to 2nd,
					// usageIsCumulative is false so it returns raw
					inputTokens: 800,
					outputTokens: 400,
					cacheReadTokens: 100,
					cacheCreationTokens: 50,
					costUsd: 0.04,
					contextWindow: 200000,
				},
			];

			const parser = createOutputParserMock(null);
			parser.extractUsage.mockImplementation(() => {
				return usageSequence[callCount++] || null;
			});

			const { handler, emitter, sessionId, proc } = createTestContext({
				isStreamJsonMode: true,
				toolType: 'claude-code',
				outputParser: parser as any,
			});

			const usageSpy = vi.fn();
			emitter.on('usage', usageSpy);

			// Turn 1
			sendJsonLine(handler, sessionId, { type: 'message', text: 'turn 1' });
			// Turn 2: triggers non-cumulative
			sendJsonLine(handler, sessionId, { type: 'message', text: 'turn 2' });
			expect(proc.usageIsCumulative).toBe(false);

			// Turn 3: should still return raw since flag is false
			sendJsonLine(handler, sessionId, { type: 'message', text: 'turn 3' });

			expect(usageSpy).toHaveBeenCalledTimes(3);
			const thirdCallUsage = usageSpy.mock.calls[2][1];
			expect(thirdCallUsage.inputTokens).toBe(800);
			expect(thirdCallUsage.outputTokens).toBe(400);
			expect(thirdCallUsage.cacheReadInputTokens).toBe(100);
			expect(thirdCallUsage.cacheCreationInputTokens).toBe(50);

			// Flag should remain false
			expect(proc.usageIsCumulative).toBe(false);
		});

		it('should handle multiple consecutive cumulative turns correctly', () => {
			let callCount = 0;
			const usageSequence = [
				{
					inputTokens: 500,
					outputTokens: 200,
					cacheReadTokens: 100,
					cacheCreationTokens: 50,
					costUsd: 0.03,
					contextWindow: 200000,
				},
				{
					inputTokens: 1200,
					outputTokens: 600,
					cacheReadTokens: 300,
					cacheCreationTokens: 120,
					costUsd: 0.07,
					contextWindow: 200000,
				},
				{
					inputTokens: 2000,
					outputTokens: 1000,
					cacheReadTokens: 500,
					cacheCreationTokens: 200,
					costUsd: 0.12,
					contextWindow: 200000,
				},
			];

			const parser = createOutputParserMock(null);
			parser.extractUsage.mockImplementation(() => {
				return usageSequence[callCount++] || null;
			});

			const { handler, emitter, sessionId, proc } = createTestContext({
				isStreamJsonMode: true,
				toolType: 'claude-code',
				outputParser: parser as any,
			});

			const usageSpy = vi.fn();
			emitter.on('usage', usageSpy);

			// Turn 1: raw
			sendJsonLine(handler, sessionId, { type: 'message', text: 'turn 1' });
			expect(usageSpy.mock.calls[0][1].inputTokens).toBe(500);

			// Turn 2: delta from turn 1
			sendJsonLine(handler, sessionId, { type: 'message', text: 'turn 2' });
			expect(usageSpy.mock.calls[1][1].inputTokens).toBe(700); // 1200 - 500
			expect(usageSpy.mock.calls[1][1].outputTokens).toBe(400); // 600 - 200

			// Turn 3: delta from turn 2
			sendJsonLine(handler, sessionId, { type: 'message', text: 'turn 3' });
			expect(usageSpy.mock.calls[2][1].inputTokens).toBe(800); // 2000 - 1200
			expect(usageSpy.mock.calls[2][1].outputTokens).toBe(400); // 1000 - 600
			expect(usageSpy.mock.calls[2][1].cacheReadInputTokens).toBe(200); // 500 - 300
			expect(usageSpy.mock.calls[2][1].cacheCreationInputTokens).toBe(80); // 200 - 120

			expect(proc.usageIsCumulative).toBe(true);
		});

		it('should handle zero deltas correctly (same cumulative values)', () => {
			let callCount = 0;
			const usageSequence = [
				{
					inputTokens: 1000,
					outputTokens: 500,
					cacheReadTokens: 200,
					cacheCreationTokens: 100,
					costUsd: 0.05,
					contextWindow: 200000,
				},
				{
					// Identical to first (no new tokens consumed)
					inputTokens: 1000,
					outputTokens: 500,
					cacheReadTokens: 200,
					cacheCreationTokens: 100,
					costUsd: 0.05,
					contextWindow: 200000,
				},
			];

			const parser = createOutputParserMock(null);
			parser.extractUsage.mockImplementation(() => {
				return usageSequence[callCount++] || null;
			});

			const { handler, emitter, sessionId, proc } = createTestContext({
				isStreamJsonMode: true,
				toolType: 'claude-code',
				outputParser: parser as any,
			});

			const usageSpy = vi.fn();
			emitter.on('usage', usageSpy);

			sendJsonLine(handler, sessionId, { type: 'message', text: 'turn 1' });
			sendJsonLine(handler, sessionId, { type: 'message', text: 'turn 2' });

			expect(usageSpy).toHaveBeenCalledTimes(2);
			const delta = usageSpy.mock.calls[1][1];
			expect(delta.inputTokens).toBe(0);
			expect(delta.outputTokens).toBe(0);
			expect(delta.cacheReadInputTokens).toBe(0);
			expect(delta.cacheCreationInputTokens).toBe(0);

			// Zero delta is still monotonic, so cumulative stays true
			expect(proc.usageIsCumulative).toBe(true);
		});

		it('should handle reasoningTokens in cumulative delta calculations', () => {
			let callCount = 0;
			const usageSequence = [
				{
					inputTokens: 500,
					outputTokens: 200,
					cacheReadTokens: 0,
					cacheCreationTokens: 0,
					costUsd: 0.03,
					contextWindow: 200000,
					reasoningTokens: 100,
				},
				{
					inputTokens: 1000,
					outputTokens: 400,
					cacheReadTokens: 0,
					cacheCreationTokens: 0,
					costUsd: 0.06,
					contextWindow: 200000,
					reasoningTokens: 250,
				},
			];

			const parser = createOutputParserMock(null);
			parser.extractUsage.mockImplementation(() => {
				return usageSequence[callCount++] || null;
			});

			const { handler, emitter, sessionId } = createTestContext({
				isStreamJsonMode: true,
				toolType: 'codex',
				outputParser: parser as any,
			});

			const usageSpy = vi.fn();
			emitter.on('usage', usageSpy);

			sendJsonLine(handler, sessionId, { type: 'message', text: 'turn 1' });
			sendJsonLine(handler, sessionId, { type: 'message', text: 'turn 2' });

			expect(usageSpy).toHaveBeenCalledTimes(2);
			const delta = usageSpy.mock.calls[1][1];
			expect(delta.inputTokens).toBe(500); // 1000 - 500
			expect(delta.outputTokens).toBe(200); // 400 - 200
			expect(delta.reasoningTokens).toBe(150); // 250 - 100
		});

		it('should detect decrease in reasoningTokens as non-monotonic', () => {
			let callCount = 0;
			const usageSequence = [
				{
					inputTokens: 500,
					outputTokens: 200,
					cacheReadTokens: 0,
					cacheCreationTokens: 0,
					costUsd: 0.03,
					contextWindow: 200000,
					reasoningTokens: 300,
				},
				{
					// All fields increase except reasoningTokens decreases
					inputTokens: 1000,
					outputTokens: 400,
					cacheReadTokens: 50,
					cacheCreationTokens: 20,
					costUsd: 0.06,
					contextWindow: 200000,
					reasoningTokens: 100,
				},
			];

			const parser = createOutputParserMock(null);
			parser.extractUsage.mockImplementation(() => {
				return usageSequence[callCount++] || null;
			});

			const { handler, emitter, sessionId, proc } = createTestContext({
				isStreamJsonMode: true,
				toolType: 'codex',
				outputParser: parser as any,
			});

			const usageSpy = vi.fn();
			emitter.on('usage', usageSpy);

			sendJsonLine(handler, sessionId, { type: 'message', text: 'turn 1' });
			sendJsonLine(handler, sessionId, { type: 'message', text: 'turn 2' });

			expect(usageSpy).toHaveBeenCalledTimes(2);
			// Non-monotonic detected -- raw values returned
			const rawStats = usageSpy.mock.calls[1][1];
			expect(rawStats.inputTokens).toBe(1000);
			expect(rawStats.outputTokens).toBe(400);
			expect(rawStats.reasoningTokens).toBe(100);

			expect(proc.usageIsCumulative).toBe(false);
		});

		it('should NOT normalize usage for non-claude-code/codex toolTypes', () => {
			let callCount = 0;
			const usageSequence = [
				{
					inputTokens: 500,
					outputTokens: 200,
					cacheReadTokens: 0,
					cacheCreationTokens: 0,
					costUsd: 0.03,
					contextWindow: 200000,
				},
				{
					inputTokens: 1200,
					outputTokens: 600,
					cacheReadTokens: 0,
					cacheCreationTokens: 0,
					costUsd: 0.07,
					contextWindow: 200000,
				},
			];

			const parser = createOutputParserMock(null);
			parser.extractUsage.mockImplementation(() => {
				return usageSequence[callCount++] || null;
			});

			const { handler, emitter, sessionId, proc } = createTestContext({
				isStreamJsonMode: true,
				toolType: 'opencode',
				outputParser: parser as any,
			});

			const usageSpy = vi.fn();
			emitter.on('usage', usageSpy);

			sendJsonLine(handler, sessionId, { type: 'message', text: 'turn 1' });
			sendJsonLine(handler, sessionId, { type: 'message', text: 'turn 2' });

			expect(usageSpy).toHaveBeenCalledTimes(2);
			// opencode does NOT go through normalizeUsageToDelta, so raw values
			const second = usageSpy.mock.calls[1][1];
			expect(second.inputTokens).toBe(1200);
			expect(second.outputTokens).toBe(600);

			// lastUsageTotals should NOT be set since normalization was skipped
			expect(proc.lastUsageTotals).toBeUndefined();
		});

		it('should normalize usage for codex toolType (not just claude-code)', () => {
			let callCount = 0;
			const usageSequence = [
				{
					inputTokens: 500,
					outputTokens: 200,
					cacheReadTokens: 0,
					cacheCreationTokens: 0,
					costUsd: 0.03,
					contextWindow: 200000,
				},
				{
					inputTokens: 1200,
					outputTokens: 600,
					cacheReadTokens: 0,
					cacheCreationTokens: 0,
					costUsd: 0.07,
					contextWindow: 200000,
				},
			];

			const parser = createOutputParserMock(null);
			parser.extractUsage.mockImplementation(() => {
				return usageSequence[callCount++] || null;
			});

			const { handler, emitter, sessionId, proc } = createTestContext({
				isStreamJsonMode: true,
				toolType: 'codex',
				outputParser: parser as any,
			});

			const usageSpy = vi.fn();
			emitter.on('usage', usageSpy);

			sendJsonLine(handler, sessionId, { type: 'message', text: 'turn 1' });
			sendJsonLine(handler, sessionId, { type: 'message', text: 'turn 2' });

			expect(usageSpy).toHaveBeenCalledTimes(2);
			const delta = usageSpy.mock.calls[1][1];
			expect(delta.inputTokens).toBe(700); // 1200 - 500
			expect(delta.outputTokens).toBe(400); // 600 - 200

			expect(proc.usageIsCumulative).toBe(true);
		});

		it('should not emit usage when extractUsage returns null', () => {
			const parser = createOutputParserMock(null);
			// extractUsage always returns null (already the default from our null param)

			const { handler, emitter, sessionId } = createTestContext({
				isStreamJsonMode: true,
				toolType: 'claude-code',
				outputParser: parser as any,
			});

			const usageSpy = vi.fn();
			emitter.on('usage', usageSpy);

			sendJsonLine(handler, sessionId, { type: 'message', text: 'no usage' });

			expect(usageSpy).not.toHaveBeenCalled();
		});
	});

	// ── buildUsageStats (indirectly tested via defaults) ───────────────────

	describe('buildUsageStats defaults', () => {
		it('should default optional fields to 0 when not provided by parser', () => {
			const parser = createMinimalOutputParser({
				inputTokens: 100,
				outputTokens: 50,
				// No cacheReadTokens, cacheCreationTokens, costUsd, contextWindow
			});

			const { handler, emitter, sessionId, proc } = createTestContext({
				isStreamJsonMode: true,
				toolType: 'opencode', // avoid normalization
				outputParser: parser as any,
				contextWindow: 128000,
			});

			const usageSpy = vi.fn();
			emitter.on('usage', usageSpy);

			sendJsonLine(handler, sessionId, { type: 'message', text: 'hi' });

			expect(usageSpy).toHaveBeenCalledTimes(1);
			const stats = usageSpy.mock.calls[0][1];
			expect(stats.inputTokens).toBe(100);
			expect(stats.outputTokens).toBe(50);
			expect(stats.cacheReadInputTokens).toBe(0);
			expect(stats.cacheCreationInputTokens).toBe(0);
			expect(stats.totalCostUsd).toBe(0);
			// Falls back to managedProcess.contextWindow
			expect(stats.contextWindow).toBe(128000);
		});

		it('should use parser-reported contextWindow over managedProcess default', () => {
			const parser = createMinimalOutputParser({
				inputTokens: 100,
				outputTokens: 50,
				contextWindow: 1000000,
			});

			const { handler, emitter, sessionId } = createTestContext({
				isStreamJsonMode: true,
				toolType: 'opencode',
				outputParser: parser as any,
				contextWindow: 200000,
			});

			const usageSpy = vi.fn();
			emitter.on('usage', usageSpy);

			sendJsonLine(handler, sessionId, { type: 'message', text: 'hi' });

			expect(usageSpy.mock.calls[0][1].contextWindow).toBe(1000000);
		});

		it('should fall back to 200000 when neither parser nor process has contextWindow', () => {
			const parser = createMinimalOutputParser({
				inputTokens: 100,
				outputTokens: 50,
				// no contextWindow from parser
			});

			const { handler, emitter, sessionId } = createTestContext({
				isStreamJsonMode: true,
				toolType: 'opencode',
				outputParser: parser as any,
				contextWindow: undefined,
			});

			const usageSpy = vi.fn();
			emitter.on('usage', usageSpy);

			sendJsonLine(handler, sessionId, { type: 'message', text: 'hi' });

			expect(usageSpy.mock.calls[0][1].contextWindow).toBe(200000);
		});
	});

	// ── Stream JSON mode: multi-line handling ──────────────────────────────

	describe('stream JSON mode line splitting', () => {
		it('should process multiple complete JSON lines in a single chunk', () => {
			const { handler, emitter, bufferManager, sessionId, proc } = createTestContext({
				isStreamJsonMode: true,
				outputParser: undefined,
			});

			const sessionIdSpy = vi.fn();
			emitter.on('session-id', sessionIdSpy);

			const chunk =
				JSON.stringify({ session_id: 'abc' }) +
				'\n' +
				JSON.stringify({ type: 'result', result: 'done' }) +
				'\n';

			handler.handleData(sessionId, chunk);

			expect(proc.sessionIdEmitted).toBe(true);
			expect(proc.resultEmitted).toBe(true);
			expect(sessionIdSpy).toHaveBeenCalledWith(sessionId, 'abc');
			expect(bufferManager.emitDataBuffered).toHaveBeenCalledWith(sessionId, 'done');
		});

		it('should reassemble split JSON lines across multiple chunks', () => {
			const { handler, bufferManager, sessionId, proc } = createTestContext({
				isStreamJsonMode: true,
				outputParser: undefined,
			});

			const fullJson = JSON.stringify({ type: 'result', result: 'split-result' });
			const half1 = fullJson.substring(0, Math.floor(fullJson.length / 2));
			const half2 = fullJson.substring(Math.floor(fullJson.length / 2));

			// Send first half (no newline, so it stays in buffer)
			handler.handleData(sessionId, half1);
			expect(bufferManager.emitDataBuffered).not.toHaveBeenCalled();

			// Send second half with newline
			handler.handleData(sessionId, half2 + '\n');
			expect(proc.resultEmitted).toBe(true);
			expect(bufferManager.emitDataBuffered).toHaveBeenCalledWith(sessionId, 'split-result');
		});
	});

	// ── Edge cases ─────────────────────────────────────────────────────────

	describe('edge cases', () => {
		it('should emit non-JSON lines via bufferManager in stream JSON mode', () => {
			const { handler, bufferManager, sessionId } = createTestContext({
				isStreamJsonMode: true,
				outputParser: undefined,
			});

			handler.handleData(sessionId, 'This is not JSON\n');
			expect(bufferManager.emitDataBuffered).toHaveBeenCalledWith(sessionId, 'This is not JSON');
		});

		it('should append to stdoutBuffer for each processed line in stream JSON mode', () => {
			const { handler, sessionId, proc } = createTestContext({
				isStreamJsonMode: true,
				outputParser: undefined,
				stdoutBuffer: '',
			});

			sendJsonLine(handler, sessionId, { session_id: 'x' });

			// stdoutBuffer should contain the processed line
			expect(proc.stdoutBuffer).toContain('session_id');
		});

		it('should handle result with empty result string gracefully', () => {
			const { handler, bufferManager, sessionId, proc } = createTestContext({
				isStreamJsonMode: true,
				outputParser: undefined,
			});

			sendJsonLine(handler, sessionId, {
				type: 'result',
				result: '',
			});

			// Empty string is falsy in JS, so the legacy handler's
			// `msgRecord.result && ...` guard skips it entirely
			expect(proc.resultEmitted).toBe(false);
			expect(bufferManager.emitDataBuffered).not.toHaveBeenCalled();
		});

		it('should handle result with no result field gracefully', () => {
			const { handler, bufferManager, sessionId, proc } = createTestContext({
				isStreamJsonMode: true,
				outputParser: undefined,
			});

			sendJsonLine(handler, sessionId, {
				type: 'result',
				// no result field
			});

			// msgRecord.result is undefined which is falsy, so resultEmitted stays false
			expect(proc.resultEmitted).toBe(false);
			expect(bufferManager.emitDataBuffered).not.toHaveBeenCalled();
		});
	});

	// ── OpenCode multi-step result handling ────────────────────────────────

	describe('opencode multi-step result handling', () => {
		function createOpenCodeParser() {
			return {
				agentId: 'opencode',
				parseJsonLine: vi.fn((line: string) => {
					const parsed = JSON.parse(line);
					if (parsed.type === 'step_start') {
						return { type: 'init', sessionId: parsed.sessionID };
					}
					if (parsed.type === 'text') {
						return { type: 'result', text: parsed.part?.text, sessionId: parsed.sessionID };
					}
					if (parsed.type === 'tool_use') {
						return { type: 'tool_use', toolName: parsed.part?.tool, sessionId: parsed.sessionID };
					}
					if (parsed.type === 'step_finish') {
						return { type: 'system', sessionId: parsed.sessionID };
					}
					return { type: 'system' };
				}),
				parseJsonObject: vi.fn((parsed: any) => {
					if (parsed.type === 'step_start') {
						return { type: 'init', sessionId: parsed.sessionID };
					}
					if (parsed.type === 'text') {
						return { type: 'result', text: parsed.part?.text, sessionId: parsed.sessionID };
					}
					if (parsed.type === 'tool_use') {
						return { type: 'tool_use', toolName: parsed.part?.tool, sessionId: parsed.sessionID };
					}
					if (parsed.type === 'step_finish') {
						return { type: 'system', sessionId: parsed.sessionID };
					}
					return { type: 'system' };
				}),
				extractUsage: vi.fn(() => null),
				extractSessionId: vi.fn((event: any) => event.sessionId || null),
				extractSlashCommands: vi.fn(() => null),
				isResultMessage: vi.fn((event: any) => event.type === 'result'),
				detectErrorFromLine: vi.fn(() => null),
				detectErrorFromParsed: vi.fn(() => null),
			};
		}

		it('should emit the final text result (last step) not just the first', () => {
			const parser = createOpenCodeParser();
			const { handler, bufferManager, sessionId } = createTestContext({
				isStreamJsonMode: true,
				toolType: 'opencode',
				outputParser: parser as any,
			});

			// Step 1: tool call with no text before it
			sendJsonLine(handler, sessionId, { type: 'step_start', sessionID: 'ses_abc' });
			sendJsonLine(handler, sessionId, {
				type: 'tool_use',
				sessionID: 'ses_abc',
				part: { tool: 'glob' },
			});
			sendJsonLine(handler, sessionId, {
				type: 'step_finish',
				sessionID: 'ses_abc',
				part: { reason: 'tool-calls' },
			});

			// Step 2: intermediate thinking text + more tool calls
			sendJsonLine(handler, sessionId, { type: 'step_start', sessionID: 'ses_abc' });
			sendJsonLine(handler, sessionId, {
				type: 'text',
				sessionID: 'ses_abc',
				part: { text: 'Intermediate thinking...' },
			});
			sendJsonLine(handler, sessionId, {
				type: 'tool_use',
				sessionID: 'ses_abc',
				part: { tool: 'glob' },
			});
			sendJsonLine(handler, sessionId, {
				type: 'step_finish',
				sessionID: 'ses_abc',
				part: { reason: 'tool-calls' },
			});

			// Step 3: final answer
			sendJsonLine(handler, sessionId, { type: 'step_start', sessionID: 'ses_abc' });
			sendJsonLine(handler, sessionId, {
				type: 'text',
				sessionID: 'ses_abc',
				part: { text: 'Final summary answer.' },
			});
			sendJsonLine(handler, sessionId, {
				type: 'step_finish',
				sessionID: 'ses_abc',
				part: { reason: 'stop' },
			});

			const emittedTexts = (bufferManager.emitDataBuffered as any).mock.calls.map(
				(call: any[]) => call[1]
			);

			// Both the intermediate and final texts should be emitted
			expect(emittedTexts).toContain('Intermediate thinking...');
			expect(emittedTexts).toContain('Final summary answer.');
		});

		it('should reset resultEmitted on each new step_start for opencode', () => {
			const parser = createOpenCodeParser();
			const { handler, proc, sessionId } = createTestContext({
				isStreamJsonMode: true,
				toolType: 'opencode',
				outputParser: parser as any,
			});

			// After first step_start, resultEmitted should be false
			sendJsonLine(handler, sessionId, { type: 'step_start', sessionID: 'ses_abc' });
			expect(proc.resultEmitted).toBe(false);

			// After text (result), resultEmitted becomes true
			sendJsonLine(handler, sessionId, {
				type: 'text',
				sessionID: 'ses_abc',
				part: { text: 'Step 1 text.' },
			});
			expect(proc.resultEmitted).toBe(true);

			// New step_start resets it
			sendJsonLine(handler, sessionId, { type: 'step_start', sessionID: 'ses_abc' });
			expect(proc.resultEmitted).toBe(false);
		});

		it('should NOT reset resultEmitted on step_start for non-opencode agents', () => {
			const parser = {
				agentId: 'claude-code',
				parseJsonLine: vi.fn((line: string) => {
					const parsed = JSON.parse(line);
					if (parsed.type === 'step_start') return { type: 'init', sessionId: 'x' };
					if (parsed.type === 'text') return { type: 'result', text: parsed.text };
					return { type: 'system' };
				}),
				parseJsonObject: vi.fn((parsed: any) => {
					if (parsed.type === 'step_start') return { type: 'init', sessionId: 'x' };
					if (parsed.type === 'text') return { type: 'result', text: parsed.text };
					return { type: 'system' };
				}),
				extractUsage: vi.fn(() => null),
				extractSessionId: vi.fn(() => null),
				extractSlashCommands: vi.fn(() => null),
				isResultMessage: vi.fn((event: any) => event.type === 'result'),
				detectErrorFromLine: vi.fn(() => null),
				detectErrorFromParsed: vi.fn(() => null),
			};

			const { handler, proc, sessionId } = createTestContext({
				isStreamJsonMode: true,
				toolType: 'claude-code',
				outputParser: parser as any,
			});

			sendJsonLine(handler, sessionId, { type: 'step_start' });
			sendJsonLine(handler, sessionId, { type: 'text', text: 'First result.' });
			expect(proc.resultEmitted).toBe(true);

			// step_start should NOT reset for claude-code
			sendJsonLine(handler, sessionId, { type: 'step_start' });
			expect(proc.resultEmitted).toBe(true);
		});
	});

	// ── Fork-specific: lastUsageTotals and SSH error detection ─────────────

	describe('lastUsageTotals for non-Codex agents', () => {
		it('should set lastUsageTotals for Claude agent (non-Codex)', () => {
			const sessionId = 'test-session-claude';

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

			const processes = new Map<string, ManagedProcess>();
			const emitter = new EventEmitter();
			const bufferManager = createMockBufferManager();
			const stdoutHandler = new StdoutHandler({
				processes,
				emitter,
				bufferManager: bufferManager as any,
			});

			const managedProcess = createMockProcess({
				sessionId,
				toolType: 'claude-code',
				isStreamJsonMode: true,
				outputParser: mockParser as AgentOutputParser,
			});
			processes.set(sessionId, managedProcess);

			const usageJson = JSON.stringify({ type: 'system', subtype: 'usage' });
			stdoutHandler.handleData(sessionId, usageJson + '\n');

			expect(managedProcess.lastUsageTotals).toBeDefined();
			expect(managedProcess.lastUsageTotals?.inputTokens).toBe(1000);
			expect(managedProcess.lastUsageTotals?.outputTokens).toBe(500);
			expect(managedProcess.lastUsageTotals?.cacheReadInputTokens).toBe(200);
			expect(managedProcess.lastUsageTotals?.cacheCreationInputTokens).toBe(100);
		});

		it('should preserve cache tokens in lastUsageTotals for ExitHandler consumption', () => {
			const sessionId = 'test-session-cache';

			const mockParser: Partial<AgentOutputParser> = {
				agentId: 'claude-code',
				parseJsonLine: vi.fn().mockReturnValue({
					type: 'system',
					subtype: 'usage',
				} as ParsedEvent),
				extractUsage: vi.fn().mockReturnValue({
					inputTokens: 15000,
					outputTokens: 2500,
					cacheReadTokens: 12000,
					cacheCreationTokens: 1500,
					costUsd: 0.045,
					contextWindow: 200000,
					reasoningTokens: 0,
				}),
				extractSessionId: vi.fn().mockReturnValue(null),
				extractSlashCommands: vi.fn().mockReturnValue(null),
				isResultMessage: vi.fn().mockReturnValue(false),
				detectErrorFromLine: vi.fn().mockReturnValue(null),
			};

			const processes = new Map<string, ManagedProcess>();
			const emitter = new EventEmitter();
			const bufferManager = createMockBufferManager();
			const stdoutHandler = new StdoutHandler({
				processes,
				emitter,
				bufferManager: bufferManager as any,
			});

			const managedProcess = createMockProcess({
				sessionId,
				toolType: 'claude-code',
				isStreamJsonMode: true,
				outputParser: mockParser as AgentOutputParser,
			});
			processes.set(sessionId, managedProcess);

			const usageJson = JSON.stringify({ type: 'system', subtype: 'usage' });
			stdoutHandler.handleData(sessionId, usageJson + '\n');

			expect(managedProcess.lastUsageTotals?.cacheReadInputTokens).toBe(12000);
			expect(managedProcess.lastUsageTotals?.cacheCreationInputTokens).toBe(1500);
		});

		it('should preserve detectedModel in lastUsageTotals for ExitHandler consumption', () => {
			const sessionId = 'test-session-model-detection';

			const mockParser: Partial<AgentOutputParser> = {
				agentId: 'claude-code',
				parseJsonLine: vi.fn().mockReturnValue({
					type: 'result',
					detectedModel: 'claude-opus-4-5-20251101',
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

			const processes = new Map<string, ManagedProcess>();
			const emitter = new EventEmitter();
			const bufferManager = createMockBufferManager();
			const stdoutHandler = new StdoutHandler({
				processes,
				emitter,
				bufferManager: bufferManager as any,
			});

			const managedProcess = createMockProcess({
				sessionId,
				toolType: 'claude-code',
				isStreamJsonMode: true,
				outputParser: mockParser as AgentOutputParser,
			});
			processes.set(sessionId, managedProcess);

			const resultJson = JSON.stringify({
				type: 'result',
				result: 'Here is my response.',
				modelUsage: { 'claude-opus-4-5-20251101': { inputTokens: 5000, outputTokens: 1500 } },
			});
			stdoutHandler.handleData(sessionId, resultJson + '\n');

			expect(managedProcess.lastUsageTotals).toBeDefined();
			expect(managedProcess.lastUsageTotals?.detectedModel).toBe('claude-opus-4-5-20251101');
			expect(managedProcess.lastUsageTotals?.inputTokens).toBe(5000);
			expect(managedProcess.lastUsageTotals?.outputTokens).toBe(1500);
		});
	});

	describe('SSH error detection on stdout (lifecycle-gated)', () => {
		it('detects SSH errors during startup window (no output yet, within 15s)', async () => {
			const { matchSshErrorPattern } = vi.mocked(
				await import('../../../../main/parsers/error-patterns')
			);
			matchSshErrorPattern.mockReturnValueOnce({
				type: 'agent_crashed',
				message: 'Claude Code not found on remote host',
				recoverable: true,
				matchedPattern: 'bash:.*claude.*command not found',
				matchedText: 'bash: claude: command not found',
			});

			const processes = new Map<string, ManagedProcess>();
			const emitter = new EventEmitter();
			const bufferManager = createMockBufferManager();
			const stdoutHandler = new StdoutHandler({
				processes,
				emitter,
				bufferManager: bufferManager as any,
			});

			const sessionId = 'test-session-ssh-startup';
			const managedProcess = createMockProcess({
				sessionId,
				toolType: 'claude-code',
				isStreamJsonMode: true,
				startTime: Date.now(), // Just started — within startup window
				sshRemoteId: undefined,
			});
			processes.set(sessionId, managedProcess);

			stdoutHandler.handleData(sessionId, 'bash: claude: command not found\n');

			expect(managedProcess.errorEmitted).toBe(true);
		});

		it('SUPPRESSES SSH errors on stdout after startup window (process has produced output)', async () => {
			const { matchSshErrorPattern } = vi.mocked(
				await import('../../../../main/parsers/error-patterns')
			);
			matchSshErrorPattern.mockReturnValueOnce({
				type: 'network_error',
				message: 'SSH connection refused',
				recoverable: true,
				matchedPattern: 'ssh:.*connection refused',
				matchedText: 'ssh: connection refused',
			});

			const processes = new Map<string, ManagedProcess>();
			const emitter = new EventEmitter();
			const bufferManager = createMockBufferManager();
			const stdoutHandler = new StdoutHandler({
				processes,
				emitter,
				bufferManager: bufferManager as any,
			});

			const sessionId = 'test-session-ssh-after-startup';
			const managedProcess = createMockProcess({
				sessionId,
				toolType: 'claude-code',
				isStreamJsonMode: true,
				startTime: Date.now() - 30_000, // Started 30s ago — well past startup window
				streamedText: 'Some previous output', // Has produced output
				sshRemoteId: 'remote-1',
			});
			processes.set(sessionId, managedProcess);

			const emittedErrors: Array<{ sessionId: string; error: AgentError }> = [];
			emitter.on('agent-error', (sid: string, error: AgentError) => {
				emittedErrors.push({ sessionId: sid, error });
			});

			stdoutHandler.handleData(sessionId, 'ssh: connection refused in some AI response text\n');

			// Should NOT emit error — suppressed as likely false positive
			expect(managedProcess.errorEmitted).toBeUndefined();
			expect(emittedErrors).toHaveLength(0);
		});
	});
});

// ── Shared helper for minimal parser ───────────────────────────────────────

function createMinimalOutputParser(usageReturn: {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens?: number;
	cacheCreationTokens?: number;
	costUsd?: number;
	contextWindow?: number;
	reasoningTokens?: number;
}) {
	return {
		agentId: 'opencode',
		parseJsonLine: vi.fn((line: string) => {
			try {
				const parsed = JSON.parse(line);
				return { type: parsed.type || 'message', text: parsed.text, isPartial: false };
			} catch {
				return null;
			}
		}),
		parseJsonObject: vi.fn((parsed: any) => {
			return { type: parsed.type || 'message', text: parsed.text, isPartial: false };
		}),
		extractUsage: vi.fn(() => usageReturn),
		extractSessionId: vi.fn(() => null),
		extractSlashCommands: vi.fn(() => null),
		isResultMessage: vi.fn(() => false),
		detectErrorFromLine: vi.fn(() => null),
		detectErrorFromParsed: vi.fn(() => null),
	};
}

// ── Performance: single JSON.parse per NDJSON line ──────────────────────

describe('StdoutHandler — single JSON parse per line', () => {
	it('parses JSON exactly once per NDJSON line (output parser path)', () => {
		// Instrument JSON.parse to count calls
		const originalParse = JSON.parse;
		let parseCount = 0;
		const countingParse = vi.fn((...args: Parameters<typeof JSON.parse>) => {
			parseCount++;
			return originalParse.apply(JSON, args);
		});
		JSON.parse = countingParse;

		try {
			const mockParser = {
				agentId: 'claude-code',
				parseJsonLine: vi.fn(() => ({
					type: 'text' as const,
					text: 'hello',
					isPartial: true,
					raw: {},
				})),
				parseJsonObject: vi.fn((parsed: unknown) => ({
					type: 'text' as const,
					text: 'hello',
					isPartial: true,
					raw: parsed,
				})),
				isResultMessage: vi.fn(() => false),
				extractSessionId: vi.fn(() => null),
				extractUsage: vi.fn(() => null),
				extractSlashCommands: vi.fn(() => null),
				detectErrorFromLine: vi.fn(() => null),
				detectErrorFromParsed: vi.fn(() => null),
				detectErrorFromExit: vi.fn(() => null),
			};

			const { handler, sessionId } = createTestContext({
				isStreamJsonMode: true,
				toolType: 'claude-code',
				outputParser: mockParser as any,
			});

			// Send a valid JSON line
			const jsonLine = JSON.stringify({
				type: 'assistant',
				content: 'hi',
			});
			parseCount = 0; // reset after the stringify parse above

			handler.handleData(sessionId, jsonLine + '\n');

			// Should parse exactly once (in processLine), not 3x as before
			expect(parseCount).toBe(1);

			// parseJsonObject should be called with pre-parsed object (not parseJsonLine)
			expect(mockParser.parseJsonObject).toHaveBeenCalledTimes(1);
			expect(mockParser.parseJsonLine).not.toHaveBeenCalled();

			// detectErrorFromParsed should be called (not detectErrorFromLine)
			expect(mockParser.detectErrorFromParsed).toHaveBeenCalledTimes(1);
			expect(mockParser.detectErrorFromLine).not.toHaveBeenCalled();
		} finally {
			JSON.parse = originalParse;
		}
	});

	it('falls back to detectErrorFromLine for non-JSON lines', () => {
		const mockParser = {
			agentId: 'claude-code',
			parseJsonLine: vi.fn(() => null),
			parseJsonObject: vi.fn(() => null),
			isResultMessage: vi.fn(() => false),
			extractSessionId: vi.fn(() => null),
			extractUsage: vi.fn(() => null),
			extractSlashCommands: vi.fn(() => null),
			detectErrorFromLine: vi.fn(() => null),
			detectErrorFromParsed: vi.fn(() => null),
			detectErrorFromExit: vi.fn(() => null),
		};

		const { handler, sessionId } = createTestContext({
			isStreamJsonMode: true,
			toolType: 'claude-code',
			outputParser: mockParser as any,
		});

		// Send a non-JSON line (e.g., stderr with embedded JSON)
		handler.handleData(sessionId, 'Error streaming: 400 {"type":"error"}\n');

		// Should fall back to line-based detection since JSON.parse fails
		expect(mockParser.detectErrorFromLine).toHaveBeenCalledTimes(1);
		expect(mockParser.detectErrorFromParsed).not.toHaveBeenCalled();
	});
});
