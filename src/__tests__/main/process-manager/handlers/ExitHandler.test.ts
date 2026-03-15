/**
 * Tests for src/main/process-manager/handlers/ExitHandler.ts
 *
 * Covers the ExitHandler class, specifically:
 * - Processing remaining jsonBuffer in stream-json mode at exit
 * - Final data buffer flush before emitting exit event
 * - Emitting accumulated streamedText when no result was emitted
 * - SSH error detection at exit, including:
 *   - Detection when sshRemoteId IS set (baseline)
 *   - Detection when sshRemoteId is NOT set (the fix — gate removed)
 *   - Exit code 0 with no stderr does NOT trigger SSH error detection
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

vi.mock('../../../../main/parsers/error-patterns', () => ({
	matchSshErrorPattern: vi.fn(() => null),
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

vi.mock('../../../../main/process-manager/utils/imageUtils', () => ({
	cleanupTempFiles: vi.fn(),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────

import { ExitHandler } from '../../../../main/process-manager/handlers/ExitHandler';
import { DataBufferManager } from '../../../../main/process-manager/handlers/DataBufferManager';
import type { ManagedProcess, AgentError } from '../../../../main/process-manager/types';
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
		stderrBuffer: '',
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

function createMockOutputParser(overrides: Partial<AgentOutputParser> = {}): AgentOutputParser {
	return {
		agentId: 'claude-code',
		parseJsonLine: vi.fn(() => null),
		extractUsage: vi.fn(() => null),
		extractSessionId: vi.fn(() => null),
		extractSlashCommands: vi.fn(() => null),
		isResultMessage: vi.fn(() => false),
		detectErrorFromLine: vi.fn(() => null),
		detectErrorFromExit: vi.fn(() => null),
		...overrides,
	} as unknown as AgentOutputParser;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ExitHandler', () => {
	let processes: Map<string, ManagedProcess>;
	let emitter: EventEmitter;
	let bufferManager: DataBufferManager;
	let exitHandler: ExitHandler;

	beforeEach(() => {
		vi.clearAllMocks();
		processes = new Map();
		emitter = new EventEmitter();
		bufferManager = new DataBufferManager(processes, emitter);
		exitHandler = new ExitHandler({ processes, emitter, bufferManager });
	});

	describe('stream-json jsonBuffer processing at exit', () => {
		it('should process remaining jsonBuffer content as a result message', () => {
			const resultJson = '{"type":"result","result":"Auth Bug Fix","session_id":"abc"}';
			const mockParser = createMockOutputParser({
				parseJsonLine: vi.fn(() => ({
					type: 'result',
					text: 'Auth Bug Fix',
					sessionId: 'abc',
				})) as unknown as AgentOutputParser['parseJsonLine'],
				isResultMessage: vi.fn(() => true) as unknown as AgentOutputParser['isResultMessage'],
			});

			const proc = createMockProcess({
				isStreamJsonMode: true,
				isBatchMode: true,
				jsonBuffer: resultJson,
				outputParser: mockParser,
			});
			processes.set('test-session', proc);

			const dataEvents: string[] = [];
			emitter.on('data', (_sid: string, data: string) => dataEvents.push(data));

			exitHandler.handleExit('test-session', 0);

			expect(mockParser.parseJsonLine).toHaveBeenCalledWith(resultJson);
			expect(mockParser.isResultMessage).toHaveBeenCalled();
			expect(dataEvents).toContain('Auth Bug Fix');
		});

		it('should not process jsonBuffer if already empty', () => {
			const mockParser = createMockOutputParser();

			const proc = createMockProcess({
				isStreamJsonMode: true,
				isBatchMode: true,
				jsonBuffer: '',
				outputParser: mockParser,
			});
			processes.set('test-session', proc);

			exitHandler.handleExit('test-session', 0);

			expect(mockParser.parseJsonLine).not.toHaveBeenCalled();
		});

		it('should not process jsonBuffer if resultEmitted is already true', () => {
			const resultJson = '{"type":"result","result":"Tab Name"}';
			const mockParser = createMockOutputParser({
				parseJsonLine: vi.fn(() => ({
					type: 'result',
					text: 'Tab Name',
				})) as unknown as AgentOutputParser['parseJsonLine'],
				isResultMessage: vi.fn(() => true) as unknown as AgentOutputParser['isResultMessage'],
			});

			const proc = createMockProcess({
				isStreamJsonMode: true,
				isBatchMode: true,
				jsonBuffer: resultJson,
				outputParser: mockParser,
				resultEmitted: true, // Already emitted during stdout processing
			});
			processes.set('test-session', proc);

			const dataEvents: string[] = [];
			emitter.on('data', (_sid: string, data: string) => dataEvents.push(data));

			exitHandler.handleExit('test-session', 0);

			// parseJsonLine is called, but data should NOT be emitted again
			expect(dataEvents).not.toContain('Tab Name');
		});

		it('should emit raw line as data when JSON parsing fails', () => {
			const invalidJson = 'not valid json at all';
			const mockParser = createMockOutputParser({
				parseJsonLine: vi.fn(() => {
					throw new Error('JSON parse error');
				}) as unknown as AgentOutputParser['parseJsonLine'],
			});

			const proc = createMockProcess({
				isStreamJsonMode: true,
				isBatchMode: true,
				jsonBuffer: invalidJson,
				outputParser: mockParser,
			});
			processes.set('test-session', proc);

			const dataEvents: string[] = [];
			emitter.on('data', (_sid: string, data: string) => dataEvents.push(data));

			exitHandler.handleExit('test-session', 0);

			expect(dataEvents).toContain(invalidJson);
		});

		it('should use streamedText as fallback when result event has no text', () => {
			const resultJson = '{"type":"result"}';
			const mockParser = createMockOutputParser({
				parseJsonLine: vi.fn(() => ({
					type: 'result',
					text: '', // Empty text
				})) as unknown as AgentOutputParser['parseJsonLine'],
				isResultMessage: vi.fn(() => true) as unknown as AgentOutputParser['isResultMessage'],
			});

			const proc = createMockProcess({
				isStreamJsonMode: true,
				isBatchMode: true,
				jsonBuffer: resultJson,
				outputParser: mockParser,
				streamedText: 'Accumulated streaming text',
			});
			processes.set('test-session', proc);

			const dataEvents: string[] = [];
			emitter.on('data', (_sid: string, data: string) => dataEvents.push(data));

			exitHandler.handleExit('test-session', 0);

			expect(dataEvents).toContain('Accumulated streaming text');
		});
	});

	describe('final data buffer flush', () => {
		it('should flush data buffer before emitting exit event', () => {
			const proc = createMockProcess({
				isStreamJsonMode: true,
				isBatchMode: true,
				// Simulate data that was buffered during exit processing
				dataBuffer: 'buffered data',
			});
			processes.set('test-session', proc);

			const events: string[] = [];
			emitter.on('data', () => events.push('data'));
			emitter.on('exit', () => events.push('exit'));

			exitHandler.handleExit('test-session', 0);

			// Data should come before exit
			const dataIdx = events.indexOf('data');
			const exitIdx = events.indexOf('exit');
			expect(dataIdx).toBeLessThan(exitIdx);
		});

		it('should emit exit event even with no buffered data', () => {
			const proc = createMockProcess();
			processes.set('test-session', proc);

			const exitEvents: Array<{ sessionId: string; code: number }> = [];
			emitter.on('exit', (sid: string, code: number) => exitEvents.push({ sessionId: sid, code }));

			exitHandler.handleExit('test-session', 0);

			expect(exitEvents).toEqual([{ sessionId: 'test-session', code: 0 }]);
		});
	});

	describe('streamedText fallback', () => {
		it('should emit streamedText when no result was emitted in stream-json mode', () => {
			const proc = createMockProcess({
				isStreamJsonMode: true,
				isBatchMode: true,
				resultEmitted: false,
				streamedText: 'Partial response text',
			});
			processes.set('test-session', proc);

			const dataEvents: string[] = [];
			emitter.on('data', (_sid: string, data: string) => dataEvents.push(data));

			exitHandler.handleExit('test-session', 0);

			expect(dataEvents).toContain('Partial response text');
		});

		it('should not emit streamedText when result was already emitted', () => {
			const proc = createMockProcess({
				isStreamJsonMode: true,
				isBatchMode: true,
				resultEmitted: true,
				streamedText: 'Should not be emitted',
			});
			processes.set('test-session', proc);

			const dataEvents: string[] = [];
			emitter.on('data', (_sid: string, data: string) => dataEvents.push(data));

			exitHandler.handleExit('test-session', 0);

			expect(dataEvents).not.toContain('Should not be emitted');
		});
	});

	describe('process cleanup', () => {
		it('should remove process from map after exit', () => {
			const proc = createMockProcess();
			processes.set('test-session', proc);

			exitHandler.handleExit('test-session', 0);

			expect(processes.has('test-session')).toBe(false);
		});

		it('should emit exit event for unknown sessions', () => {
			const exitEvents: Array<{ sessionId: string; code: number }> = [];
			emitter.on('exit', (sid: string, code: number) => exitEvents.push({ sessionId: sid, code }));

			exitHandler.handleExit('unknown-session', 1);

			expect(exitEvents).toEqual([{ sessionId: 'unknown-session', code: 1 }]);
		});
	});

	describe('SSH error detection at exit with sshRemoteId set', () => {
		it('detects SSH errors at exit when sshRemoteId IS set (baseline)', async () => {
			const { matchSshErrorPattern } = vi.mocked(
				await import('../../../../main/parsers/error-patterns')
			);
			matchSshErrorPattern.mockReturnValueOnce({
				type: 'agent_crashed',
				message: 'SSH connection refused',
				recoverable: true,
				matchedPattern: 'ssh:.*connection refused',
				matchedText: 'ssh: connect to host example.com port 22: Connection refused',
			});

			const emittedErrors: Array<{ sessionId: string; error: AgentError }> = [];
			emitter.on('agent-error', (sessionId: string, error: AgentError) => {
				emittedErrors.push({ sessionId, error });
			});

			const sessionId = 'test-session-ssh-exit-with-id';
			const managedProcess = createMockProcess({
				sessionId,
				sshRemoteId: 'remote-1',
				stderrBuffer: 'ssh: connect to host example.com port 22: Connection refused',
			});
			processes.set(sessionId, managedProcess);

			exitHandler.handleExit(sessionId, 255);

			expect(managedProcess.errorEmitted).toBe(true);
			expect(emittedErrors).toHaveLength(1);
			expect(emittedErrors[0].error.type).toBe('agent_crashed');
			expect(emittedErrors[0].error.message).toBe('SSH connection refused');
		});
	});

	describe('SSH error detection at exit without sshRemoteId', () => {
		it('detects SSH errors at exit when sshRemoteId is NOT set (the fix)', async () => {
			const { matchSshErrorPattern } = vi.mocked(
				await import('../../../../main/parsers/error-patterns')
			);
			matchSshErrorPattern.mockReturnValueOnce({
				type: 'agent_crashed',
				message: 'SSH connection refused',
				recoverable: true,
				matchedPattern: 'ssh:.*connection refused',
				matchedText: 'ssh: connect to host example.com port 22: Connection refused',
			});

			const emittedErrors: Array<{ sessionId: string; error: AgentError }> = [];
			emitter.on('agent-error', (sessionId: string, error: AgentError) => {
				emittedErrors.push({ sessionId, error });
			});

			const sessionId = 'test-session-ssh-exit-no-id';
			const managedProcess = createMockProcess({
				sessionId,
				sshRemoteId: undefined, // No SSH ID set — simulates flag loss
				stderrBuffer: 'ssh: connect to host example.com port 22: Connection refused',
			});
			processes.set(sessionId, managedProcess);

			exitHandler.handleExit(sessionId, 255);

			expect(managedProcess.errorEmitted).toBe(true);
			expect(emittedErrors).toHaveLength(1);
			expect(emittedErrors[0].error.type).toBe('agent_crashed');
		});
	});

	describe('exit code 0 with no stderr', () => {
		it('does NOT trigger SSH error detection on clean exit', async () => {
			const { matchSshErrorPattern } = vi.mocked(
				await import('../../../../main/parsers/error-patterns')
			);

			const emittedErrors: Array<{ sessionId: string; error: AgentError }> = [];
			const emittedExits: Array<{ sessionId: string; code: number }> = [];
			emitter.on('agent-error', (sessionId: string, error: AgentError) => {
				emittedErrors.push({ sessionId, error });
			});
			emitter.on('exit', (sessionId: string, code: number) => {
				emittedExits.push({ sessionId, code });
			});

			const sessionId = 'test-session-clean-exit';
			const managedProcess = createMockProcess({
				sessionId,
				// No stderrBuffer, clean exit
			});
			processes.set(sessionId, managedProcess);

			exitHandler.handleExit(sessionId, 0);

			// matchSshErrorPattern should not be called for clean exit with no stderr
			expect(matchSshErrorPattern).not.toHaveBeenCalled();
			expect(managedProcess.errorEmitted).toBe(false);
			expect(emittedErrors).toHaveLength(0);
			// Should still emit normal exit event
			expect(emittedExits).toHaveLength(1);
			expect(emittedExits[0].code).toBe(0);
		});
	});

	describe('exit with non-zero code but no SSH error', () => {
		it('checks for SSH errors on non-zero exit even without stderr', async () => {
			const { matchSshErrorPattern } = vi.mocked(
				await import('../../../../main/parsers/error-patterns')
			);
			// Returns null — no SSH error pattern matched
			matchSshErrorPattern.mockReturnValueOnce(null);

			const emittedErrors: Array<{ sessionId: string; error: AgentError }> = [];
			emitter.on('agent-error', (sessionId: string, error: AgentError) => {
				emittedErrors.push({ sessionId, error });
			});

			const sessionId = 'test-session-non-zero';
			const managedProcess = createMockProcess({
				sessionId,
			});
			processes.set(sessionId, managedProcess);

			exitHandler.handleExit(sessionId, 1);

			// Should have checked for SSH errors (non-zero exit)
			expect(matchSshErrorPattern).toHaveBeenCalled();
			// But no error emitted since pattern didn't match
			expect(emittedErrors).toHaveLength(0);
		});
	});
});
