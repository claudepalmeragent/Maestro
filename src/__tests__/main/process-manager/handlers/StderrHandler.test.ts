/**
 * Tests for src/main/process-manager/handlers/StderrHandler.ts
 *
 * Verifies SSH error detection from stderr, including:
 * - Detection when sshRemoteId IS set (baseline)
 * - Detection when sshRemoteId is NOT set (the fix — gate removed)
 * - Suppression of known SSH informational messages
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { StderrHandler } from '../../../../main/process-manager/handlers/StderrHandler';
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

// Mock terminalFilter
vi.mock('../../../../main/utils/terminalFilter', () => ({
	stripAllAnsiCodes: vi.fn((s: string) => s),
}));

// Mock bufferUtils
vi.mock('../../../../main/process-manager/utils/bufferUtils', () => ({
	appendToBuffer: vi.fn((existing: string, data: string) => existing + data),
}));

describe('StderrHandler', () => {
	let processes: Map<string, ManagedProcess>;
	let emitter: EventEmitter;
	let stderrHandler: StderrHandler;
	let emittedErrors: Array<{ sessionId: string; error: AgentError }>;

	beforeEach(() => {
		vi.clearAllMocks();
		processes = new Map();
		emitter = new EventEmitter();
		stderrHandler = new StderrHandler({
			processes,
			emitter,
		});
		emittedErrors = [];
		emitter.on('agent-error', (sessionId: string, error: AgentError) => {
			emittedErrors.push({ sessionId, error });
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

	describe('SSH error detection with sshRemoteId set', () => {
		it('detects SSH errors from stderr when sshRemoteId is set (baseline)', async () => {
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

			const sessionId = 'test-session-ssh-with-id';
			const managedProcess = createManagedProcess({
				sessionId,
				sshRemoteId: 'remote-1',
			});
			processes.set(sessionId, managedProcess);

			stderrHandler.handleData(sessionId, 'bash: claude: command not found');

			expect(managedProcess.errorEmitted).toBe(true);
			expect(emittedErrors).toHaveLength(1);
			expect(emittedErrors[0].error.type).toBe('agent_crashed');
			expect(emittedErrors[0].error.message).toBe('Claude Code not found on remote host');
		});
	});

	describe('SSH error detection without sshRemoteId', () => {
		it('detects SSH errors from stderr even when sshRemoteId is NOT set (the fix)', async () => {
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

			const sessionId = 'test-session-ssh-no-id';
			const managedProcess = createManagedProcess({
				sessionId,
				sshRemoteId: undefined, // No SSH ID set — simulates flag loss
			});
			processes.set(sessionId, managedProcess);

			stderrHandler.handleData(sessionId, 'bash: claude: command not found');

			expect(managedProcess.errorEmitted).toBe(true);
			expect(emittedErrors).toHaveLength(1);
			expect(emittedErrors[0].error.type).toBe('agent_crashed');
		});
	});

	describe('SSH informational message suppression', () => {
		it('suppresses known SSH informational messages', () => {
			const sessionId = 'test-session-ssh-info';
			const managedProcess = createManagedProcess({ sessionId });
			processes.set(sessionId, managedProcess);

			const emittedStderr: string[] = [];
			emitter.on('stderr', (_sessionId: string, data: string) => {
				emittedStderr.push(data);
			});

			stderrHandler.handleData(
				sessionId,
				'Pseudo-terminal will not be allocated because stdin is not a terminal.'
			);

			// Should NOT emit to stderr channel (suppressed)
			expect(emittedStderr).toHaveLength(0);
			// Should NOT be treated as an error
			expect(managedProcess.errorEmitted).toBeUndefined();
		});

		it('suppresses "Permanently added to known hosts" messages', () => {
			const sessionId = 'test-session-ssh-known-hosts';
			const managedProcess = createManagedProcess({ sessionId });
			processes.set(sessionId, managedProcess);

			const emittedStderr: string[] = [];
			emitter.on('stderr', (_sessionId: string, data: string) => {
				emittedStderr.push(data);
			});

			stderrHandler.handleData(
				sessionId,
				"Warning: Permanently added '192.168.1.100' (ED25519) to the list of known hosts."
			);

			expect(emittedStderr).toHaveLength(0);
			expect(managedProcess.errorEmitted).toBeUndefined();
		});
	});

	describe('does not double-emit errors', () => {
		it('does not emit SSH error if parser error already emitted', async () => {
			const { matchSshErrorPattern } = vi.mocked(
				await import('../../../../main/parsers/error-patterns')
			);
			matchSshErrorPattern.mockReturnValueOnce({
				type: 'agent_crashed',
				message: 'SSH error detected',
				recoverable: true,
				matchedPattern: 'bash:.*claude.*command not found',
				matchedText: 'bash: claude: command not found',
			});

			const sessionId = 'test-session-already-errored';
			const managedProcess = createManagedProcess({
				sessionId,
				errorEmitted: true, // Already emitted an error
			});
			processes.set(sessionId, managedProcess);

			stderrHandler.handleData(sessionId, 'bash: claude: command not found');

			// Should not emit a second error
			expect(emittedErrors).toHaveLength(0);
		});
	});
});
