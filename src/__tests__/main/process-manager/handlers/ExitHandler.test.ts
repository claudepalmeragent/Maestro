/**
 * Tests for src/main/process-manager/handlers/ExitHandler.ts
 *
 * Verifies SSH error detection at exit, including:
 * - Detection when sshRemoteId IS set (baseline)
 * - Detection when sshRemoteId is NOT set (the fix — gate removed)
 * - Exit code 0 with no stderr does NOT trigger SSH error detection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { ExitHandler } from '../../../../main/process-manager/handlers/ExitHandler';
import { DataBufferManager } from '../../../../main/process-manager/handlers/DataBufferManager';
import type { ManagedProcess, AgentError } from '../../../../main/process-manager/types';

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

// Mock usage aggregator
vi.mock('../../../../main/parsers/usage-aggregator', () => ({
	aggregateModelUsage: vi.fn(),
}));

// Mock image utils
vi.mock('../../../../main/process-manager/utils/imageUtils', () => ({
	cleanupTempFiles: vi.fn(),
}));

describe('ExitHandler', () => {
	let processes: Map<string, ManagedProcess>;
	let emitter: EventEmitter;
	let bufferManager: DataBufferManager;
	let exitHandler: ExitHandler;
	let emittedErrors: Array<{ sessionId: string; error: AgentError }>;
	let emittedExits: Array<{ sessionId: string; code: number; resultEmitted: boolean }>;

	beforeEach(() => {
		vi.clearAllMocks();
		processes = new Map();
		emitter = new EventEmitter();
		bufferManager = new DataBufferManager(processes, emitter);
		exitHandler = new ExitHandler({
			processes,
			emitter,
			bufferManager,
		});
		emittedErrors = [];
		emittedExits = [];
		emitter.on('agent-error', (sessionId: string, error: AgentError) => {
			emittedErrors.push({ sessionId, error });
		});
		emitter.on('exit', (sessionId: string, code: number, resultEmitted: boolean) => {
			emittedExits.push({ sessionId, code, resultEmitted });
		});
	});

	function createManagedProcess(overrides: Partial<ManagedProcess> = {}): ManagedProcess {
		return {
			sessionId: 'test-session',
			toolType: 'claude-code',
			cwd: '/test',
			pid: 1234,
			isTerminal: false,
			isStreamJsonMode: true,
			jsonBuffer: '',
			startTime: Date.now(),
			...overrides,
		};
	}

	describe('SSH error detection at exit with sshRemoteId set', () => {
		it('detects SSH errors at exit when sshRemoteId IS set (baseline)', async () => {
			const { matchSshErrorPattern } = vi.mocked(
				await import('../../../../main/parsers/error-patterns')
			);
			matchSshErrorPattern.mockReturnValueOnce({
				type: 'agent_crashed',
				message: 'SSH connection refused',
				recoverable: true,
			});

			const sessionId = 'test-session-ssh-exit-with-id';
			const managedProcess = createManagedProcess({
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
			});

			const sessionId = 'test-session-ssh-exit-no-id';
			const managedProcess = createManagedProcess({
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

			const sessionId = 'test-session-clean-exit';
			const managedProcess = createManagedProcess({
				sessionId,
				// No stderrBuffer, clean exit
			});
			processes.set(sessionId, managedProcess);

			exitHandler.handleExit(sessionId, 0);

			// matchSshErrorPattern should not be called for clean exit with no stderr
			expect(matchSshErrorPattern).not.toHaveBeenCalled();
			expect(managedProcess.errorEmitted).toBeUndefined();
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

			const sessionId = 'test-session-non-zero';
			const managedProcess = createManagedProcess({
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
