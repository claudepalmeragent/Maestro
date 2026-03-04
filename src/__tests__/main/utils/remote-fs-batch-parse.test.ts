import { describe, it, expect, vi } from 'vitest';
import { batchParseSessionFilesRemote } from '../../../main/utils/remote-fs';
import type { RemoteFsDeps } from '../../../main/utils/remote-fs';
import type { SshRemoteConfig } from '../../../shared/types';

vi.mock('../../../main/utils/ssh-socket-cleanup', () => ({
	validateSshSocket: vi.fn().mockResolvedValue(undefined),
}));

const mockSshConfig: SshRemoteConfig = {
	id: 'test-remote',
	name: 'Test Remote',
	host: 'test.example.com',
	port: 22,
	username: 'testuser',
	privateKeyPath: '~/.ssh/id_ed25519',
	enabled: true,
};

function createMockDeps(stdout: string, exitCode = 0): RemoteFsDeps {
	return {
		execSsh: vi.fn().mockResolvedValue({ stdout, stderr: '', exitCode }),
		buildSshArgs: vi.fn().mockReturnValue(['-o', 'BatchMode=yes', 'testuser@test.example.com']),
	};
}

describe('batchParseSessionFilesRemote', () => {
	it('should parse structured output for multiple files', async () => {
		const stdout = [
			'===FILE:/path/to/session1.jsonl:150===',
			'{"type":"user","message":{"content":"Hello"},"timestamp":"2024-01-01T00:00:00Z"}',
			'{"type":"assistant","message":{"content":"Hi there"},"timestamp":"2024-01-01T00:01:00Z"}',
			'===TAIL===',
			'{"type":"result","timestamp":"2024-01-01T01:00:00Z"}',
			'===END===',
			'===FILE:/path/to/session2.jsonl:50===',
			'{"type":"user","message":{"content":"Question"},"timestamp":"2024-02-01T00:00:00Z"}',
			'===TAIL===',
			'{"type":"result","timestamp":"2024-02-01T00:30:00Z"}',
			'===END===',
		].join('\n');

		const deps = createMockDeps(stdout);
		const result = await batchParseSessionFilesRemote(
			['/path/to/session1.jsonl', '/path/to/session2.jsonl'],
			mockSshConfig,
			20,
			10,
			deps
		);

		expect(result.success).toBe(true);
		expect(result.data?.size).toBe(2);

		const s1 = result.data?.get('/path/to/session1.jsonl');
		expect(s1?.totalLines).toBe(150);
		expect(s1?.head).toContain('"type":"user"');
		expect(s1?.tail).toContain('"type":"result"');

		const s2 = result.data?.get('/path/to/session2.jsonl');
		expect(s2?.totalLines).toBe(50);
		expect(s2?.head).toContain('"type":"user"');
		expect(s2?.tail).toContain('"type":"result"');
	});

	it('should handle empty file list', async () => {
		const deps = createMockDeps('');
		const result = await batchParseSessionFilesRemote([], mockSshConfig, 20, 10, deps);

		expect(result.success).toBe(true);
		expect(result.data?.size).toBe(0);
		expect(deps.execSsh).not.toHaveBeenCalled();
	});

	it('should handle missing files gracefully', async () => {
		const stdout = '===FILE:/path/to/exists.jsonl:10===\nline1\n===TAIL===\nline10\n===END===';
		const deps = createMockDeps(stdout);

		const result = await batchParseSessionFilesRemote(
			['/path/to/exists.jsonl', '/path/to/missing.jsonl'],
			mockSshConfig,
			20,
			10,
			deps
		);

		expect(result.success).toBe(true);
		expect(result.data?.size).toBe(1);
		expect(result.data?.has('/path/to/exists.jsonl')).toBe(true);
		expect(result.data?.has('/path/to/missing.jsonl')).toBe(false);
	});

	it('should chunk large file lists to avoid ARG_MAX limits', async () => {
		// Create 60 file paths (exceeds CHUNK_SIZE of 50)
		const filePaths = Array.from({ length: 60 }, (_, i) => `/path/to/session${i}.jsonl`);

		// Build stdout for first chunk (50 files)
		const chunk1Output = Array.from(
			{ length: 50 },
			(_, i) =>
				`===FILE:/path/to/session${i}.jsonl:10===\nhead${i}\n===TAIL===\ntail${i}\n===END===`
		).join('\n');

		// Build stdout for second chunk (10 files)
		const chunk2Output = Array.from(
			{ length: 10 },
			(_, i) =>
				`===FILE:/path/to/session${50 + i}.jsonl:10===\nhead${50 + i}\n===TAIL===\ntail${50 + i}\n===END===`
		).join('\n');

		const execSsh = vi
			.fn()
			.mockResolvedValueOnce({ stdout: chunk1Output, stderr: '', exitCode: 0 })
			.mockResolvedValueOnce({ stdout: chunk2Output, stderr: '', exitCode: 0 });

		const deps: RemoteFsDeps = {
			execSsh,
			buildSshArgs: vi.fn().mockReturnValue(['-o', 'BatchMode=yes', 'testuser@test.example.com']),
		};

		const result = await batchParseSessionFilesRemote(filePaths, mockSshConfig, 20, 10, deps);

		expect(result.success).toBe(true);
		expect(result.data?.size).toBe(60);
		// Should have been called twice (2 chunks)
		expect(execSsh).toHaveBeenCalledTimes(2);
	});

	it('should continue processing if one chunk fails', async () => {
		const filePaths = Array.from({ length: 60 }, (_, i) => `/path/to/session${i}.jsonl`);

		const chunk2Output = Array.from(
			{ length: 10 },
			(_, i) => `===FILE:/path/to/session${50 + i}.jsonl:5===\nhead\n===TAIL===\ntail\n===END===`
		).join('\n');

		const execSsh = vi
			.fn()
			// First chunk fails
			.mockResolvedValueOnce({ stdout: '', stderr: 'connection error', exitCode: 1 })
			// Second chunk succeeds
			.mockResolvedValueOnce({ stdout: chunk2Output, stderr: '', exitCode: 0 });

		const deps: RemoteFsDeps = {
			execSsh,
			buildSshArgs: vi.fn().mockReturnValue(['-o', 'BatchMode=yes', 'testuser@test.example.com']),
		};

		const result = await batchParseSessionFilesRemote(filePaths, mockSshConfig, 20, 10, deps);

		expect(result.success).toBe(true);
		expect(result.data?.size).toBe(10); // Only second chunk results
	});

	it('should properly escape single quotes in file paths', async () => {
		const stdout = "===FILE:/path/to/it's-a-session.jsonl:5===\nhead\n===TAIL===\ntail\n===END===";
		const deps = createMockDeps(stdout);

		const result = await batchParseSessionFilesRemote(
			["/path/to/it's-a-session.jsonl"],
			mockSshConfig,
			20,
			10,
			deps
		);

		expect(result.success).toBe(true);
		// Verify the SSH command was called with escaped single quotes
		expect(deps.execSsh).toHaveBeenCalled();
		const sshCall = (deps.execSsh as ReturnType<typeof vi.fn>).mock.calls[0];
		const command = sshCall[1][sshCall[1].length - 1]; // Last arg is the remote command
		expect(command).toContain("'\\''"); // Escaped single quote
	});
});
