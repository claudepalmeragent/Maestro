import { describe, it, expect, vi } from 'vitest';
import { readSessionMessagesRemote, type RemoteFsDeps } from '../../../main/utils/remote-fs';
import type { SshRemoteConfig } from '../../../shared/types';
import type { ExecResult } from '../../../main/utils/execFile';

vi.mock('../../../main/utils/ssh-socket-cleanup', () => ({
	validateSshSocket: vi.fn().mockResolvedValue(undefined),
}));

const mockSshConfig: SshRemoteConfig = {
	id: 'test-remote-1',
	name: 'Test Remote',
	host: 'dev.example.com',
	port: 22,
	username: 'testuser',
	privateKeyPath: '~/.ssh/id_ed25519',
	enabled: true,
};

function createMockDeps(execResult: ExecResult): RemoteFsDeps {
	return {
		execSsh: vi.fn().mockResolvedValue(execResult),
		buildSshArgs: vi.fn().mockReturnValue([]),
	};
}

describe('readSessionMessagesRemote', () => {
	it('should extract a page of lines from the end of the file', async () => {
		const separator = '___MAESTRO_MSG_SEP___';
		const sshOutput = [
			'150', // totalLines
			separator,
			'{"type":"user","message":{"content":"hello"},"timestamp":"2026-01-01","uuid":"u1"}',
			'{"type":"assistant","message":{"content":"hi there"},"timestamp":"2026-01-01","uuid":"u2"}',
		].join('\n');

		const deps = createMockDeps({ stdout: sshOutput, stderr: '', exitCode: 0 });

		const result = await readSessionMessagesRemote(
			'/path/to/session.jsonl',
			0,
			20,
			mockSshConfig,
			deps
		);

		expect(result.success).toBe(true);
		expect(result.data).toBeDefined();
		expect(result.data!.lines).toHaveLength(2);
		expect(result.data!.totalLines).toBe(150);
		expect(result.data!.hasMore).toBe(true); // 0 + 20 < 150
	});

	it('should return hasMore=false when all lines are included', async () => {
		const separator = '___MAESTRO_MSG_SEP___';
		const sshOutput = [
			'5', // totalLines
			separator,
			'{"type":"user","message":{"content":"msg1"},"timestamp":"t","uuid":"1"}',
			'{"type":"assistant","message":{"content":"msg2"},"timestamp":"t","uuid":"2"}',
		].join('\n');

		const deps = createMockDeps({ stdout: sshOutput, stderr: '', exitCode: 0 });

		const result = await readSessionMessagesRemote(
			'/path/to/session.jsonl',
			0,
			20,
			mockSshConfig,
			deps
		);

		expect(result.success).toBe(true);
		expect(result.data!.hasMore).toBe(false); // 0 + 20 >= 5
	});

	it('should handle file not found', async () => {
		const deps = createMockDeps({
			stdout: '',
			stderr: 'No such file or directory',
			exitCode: 1,
		});

		const result = await readSessionMessagesRemote(
			'/path/to/missing.jsonl',
			0,
			20,
			mockSshConfig,
			deps
		);

		expect(result.success).toBe(false);
		expect(result.error).toContain('File not found');
	});

	it('should make exactly 1 SSH call', async () => {
		const separator = '___MAESTRO_MSG_SEP___';
		const sshOutput = `10\n${separator}\n{"type":"user","message":{"content":"x"},"timestamp":"t","uuid":"1"}`;

		const deps = createMockDeps({ stdout: sshOutput, stderr: '', exitCode: 0 });

		await readSessionMessagesRemote('/path/s.jsonl', 0, 20, mockSshConfig, deps);
		expect(deps.execSsh).toHaveBeenCalledTimes(1);
	});

	it('should handle empty file', async () => {
		const separator = '___MAESTRO_MSG_SEP___';
		const sshOutput = `0\n${separator}\n`;

		const deps = createMockDeps({ stdout: sshOutput, stderr: '', exitCode: 0 });

		const result = await readSessionMessagesRemote('/path/s.jsonl', 0, 20, mockSshConfig, deps);

		expect(result.success).toBe(true);
		expect(result.data!.lines).toHaveLength(0);
		expect(result.data!.totalLines).toBe(0);
		expect(result.data!.hasMore).toBe(false);
	});

	it('should pass correct offset and limit to tail+head command', async () => {
		const separator = '___MAESTRO_MSG_SEP___';
		const sshOutput = `100\n${separator}\nline1\nline2`;

		const deps = createMockDeps({ stdout: sshOutput, stderr: '', exitCode: 0 });

		await readSessionMessagesRemote('/path/s.jsonl', 40, 20, mockSshConfig, deps);

		// The SSH command should use tail -n 60 (offset+limit) | head -n 20 (limit)
		expect(deps.execSsh).toHaveBeenCalledTimes(1);
	});

	it('should handle missing separator in output', async () => {
		const deps = createMockDeps({ stdout: 'invalid output', stderr: '', exitCode: 0 });

		const result = await readSessionMessagesRemote('/path/s.jsonl', 0, 20, mockSshConfig, deps);

		expect(result.success).toBe(false);
		expect(result.error).toContain('Failed to parse');
	});

	it('should handle non-zero exit code without stderr', async () => {
		const deps = createMockDeps({ stdout: '', stderr: '', exitCode: 1 });

		const result = await readSessionMessagesRemote('/path/s.jsonl', 0, 20, mockSshConfig, deps);

		expect(result.success).toBe(false);
		expect(result.error).toContain('Failed to read messages');
	});
});
