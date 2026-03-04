import { describe, it, expect, vi } from 'vitest';
import { batchDiscoverSessionFilesRemote } from '../../../main/utils/remote-fs';
import type { RemoteFsDeps } from '../../../main/utils/remote-fs';
import type { SshRemoteConfig } from '../../../shared/types';

// Mock validateSshSocket to prevent real socket checks
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

function createMockDeps(stdout: string, exitCode = 0, stderr = ''): RemoteFsDeps {
	return {
		execSsh: vi.fn().mockResolvedValue({ stdout, stderr, exitCode }),
		buildSshArgs: vi.fn().mockReturnValue(['-o', 'BatchMode=yes', 'testuser@test.example.com']),
	};
}

describe('batchDiscoverSessionFilesRemote', () => {
	it('should parse find output with -printf format (epoch.fraction)', async () => {
		const stdout = [
			'1709312345.1234567890 52430 /home/user/.claude/projects/-app/abc-123.jsonl',
			'1709312300.0000000000 12000 /home/user/.claude/projects/-app/def-456.jsonl',
			'1709312200.5000000000 8500 /home/user/.claude/projects/-home-user/ghi-789.jsonl',
		].join('\n');

		const deps = createMockDeps(stdout);
		const result = await batchDiscoverSessionFilesRemote('~/.claude/projects', mockSshConfig, deps);

		expect(result.success).toBe(true);
		expect(result.data).toHaveLength(3);
		expect(result.data![0]).toEqual({
			filePath: '/home/user/.claude/projects/-app/abc-123.jsonl',
			mtime: 1709312345123,
			size: 52430,
			projectDirName: '-app',
			filename: 'abc-123.jsonl',
		});
		expect(result.data![2].projectDirName).toBe('-home-user');
	});

	it('should parse stat -c format (integer epoch)', async () => {
		const stdout = [
			'1709312345 52430 /home/user/.claude/projects/-app/session1.jsonl',
			'1709312300 12000 /home/user/.claude/projects/-app/session2.jsonl',
		].join('\n');

		const deps = createMockDeps(stdout);
		const result = await batchDiscoverSessionFilesRemote('~/.claude/projects', mockSshConfig, deps);

		expect(result.success).toBe(true);
		expect(result.data).toHaveLength(2);
		expect(result.data![0].mtime).toBe(1709312345000);
	});

	it('should skip empty files (size 0)', async () => {
		const stdout = [
			'1709312345 0 /home/user/.claude/projects/-app/empty.jsonl',
			'1709312300 12000 /home/user/.claude/projects/-app/valid.jsonl',
		].join('\n');

		const deps = createMockDeps(stdout);
		const result = await batchDiscoverSessionFilesRemote('~/.claude/projects', mockSshConfig, deps);

		expect(result.success).toBe(true);
		expect(result.data).toHaveLength(1);
		expect(result.data![0].filename).toBe('valid.jsonl');
	});

	it('should handle empty result (no sessions)', async () => {
		const deps = createMockDeps('');
		const result = await batchDiscoverSessionFilesRemote('~/.claude/projects', mockSshConfig, deps);

		expect(result.success).toBe(true);
		expect(result.data).toHaveLength(0);
	});

	it('should handle SSH failure', async () => {
		const deps = createMockDeps('', 1, 'Connection refused');
		const result = await batchDiscoverSessionFilesRemote('~/.claude/projects', mockSshConfig, deps);

		expect(result.success).toBe(false);
		expect(result.error).toContain('Connection refused');
	});

	it('should handle multiple project directories', async () => {
		const stdout = [
			'1709312345 52430 /home/user/.claude/projects/-app/s1.jsonl',
			'1709312300 12000 /home/user/.claude/projects/-home-user-myproject/s2.jsonl',
			'1709312200 8500 /home/user/.claude/projects/-tmp-work/s3.jsonl',
		].join('\n');

		const deps = createMockDeps(stdout);
		const result = await batchDiscoverSessionFilesRemote('~/.claude/projects', mockSshConfig, deps);

		expect(result.success).toBe(true);
		expect(result.data).toHaveLength(3);

		const projectDirs = result.data!.map((f) => f.projectDirName);
		expect(projectDirs).toContain('-app');
		expect(projectDirs).toContain('-home-user-myproject');
		expect(projectDirs).toContain('-tmp-work');
	});

	it('should skip malformed lines', async () => {
		const stdout = [
			'1709312345 52430 /home/user/.claude/projects/-app/valid.jsonl',
			'malformed line with no numbers',
			'',
			'1709312300 12000 /home/user/.claude/projects/-app/also-valid.jsonl',
		].join('\n');

		const deps = createMockDeps(stdout);
		const result = await batchDiscoverSessionFilesRemote('~/.claude/projects', mockSshConfig, deps);

		expect(result.success).toBe(true);
		expect(result.data).toHaveLength(2);
	});

	it('should use the SSH concurrency limiter (calls execRemoteCommand path)', async () => {
		const deps = createMockDeps('1709312345 100 /home/user/.claude/projects/-app/s.jsonl');
		await batchDiscoverSessionFilesRemote('~/.claude/projects', mockSshConfig, deps);

		// Verify SSH was called exactly once (batch command)
		expect(deps.execSsh).toHaveBeenCalledTimes(1);
	});
});
