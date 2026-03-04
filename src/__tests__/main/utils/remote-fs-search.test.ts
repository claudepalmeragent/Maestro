import { describe, it, expect, vi } from 'vitest';
import { searchSessionFilesRemote } from '../../../main/utils/remote-fs';
import type { RemoteFsDeps } from '../../../main/utils/remote-fs';
import type { SshRemoteConfig } from '../../../shared/types';

vi.mock('../../../main/utils/ssh-socket-cleanup', () => ({
	validateSshSocket: vi.fn().mockResolvedValue(undefined),
}));

const mockSshConfig: SshRemoteConfig = {
	id: 'test',
	name: 'Test',
	host: 'test.com',
	port: 22,
	username: 'user',
	privateKeyPath: '~/.ssh/key',
	enabled: true,
};

describe('searchSessionFilesRemote', () => {
	it('should find matching files and extract previews', async () => {
		const grepOutput = '/path/session1.jsonl\n/path/session2.jsonl';
		const detailOutput = [
			'===MATCH:/path/session1.jsonl:session1.jsonl:5:3===',
			'{"type":"user","message":{"content":"hello world test query here"}}',
			'===END===',
			'===MATCH:/path/session2.jsonl:session2.jsonl:0:2===',
			'{"type":"assistant","message":{"content":"response with test query"}}',
			'===END===',
		].join('\n');

		const deps: RemoteFsDeps = {
			execSsh: vi
				.fn()
				.mockResolvedValueOnce({ stdout: grepOutput, stderr: '', exitCode: 0 })
				.mockResolvedValueOnce({ stdout: detailOutput, stderr: '', exitCode: 0 }),
			buildSshArgs: vi.fn().mockReturnValue([]),
		};

		const result = await searchSessionFilesRemote('/path', 'test query', mockSshConfig, deps);

		expect(result.success).toBe(true);
		expect(result.data).toHaveLength(2);
		expect(result.data![0].hasUserMatch).toBe(true);
		expect(result.data![0].userMatchCount).toBe(5);
		expect(result.data![1].hasAssistantMatch).toBe(true);
	});

	it('should return empty array when no files match', async () => {
		const deps: RemoteFsDeps = {
			execSsh: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
			buildSshArgs: vi.fn().mockReturnValue([]),
		};

		const result = await searchSessionFilesRemote('/path', 'nonexistent', mockSshConfig, deps);

		expect(result.success).toBe(true);
		expect(result.data).toHaveLength(0);
	});

	it('should make exactly 2 SSH calls (find + detail)', async () => {
		const deps: RemoteFsDeps = {
			execSsh: vi
				.fn()
				.mockResolvedValueOnce({ stdout: '/path/s.jsonl', stderr: '', exitCode: 0 })
				.mockResolvedValueOnce({
					stdout: '===MATCH:/path/s.jsonl:s.jsonl:1:0===\nline\n===END===',
					stderr: '',
					exitCode: 0,
				}),
			buildSshArgs: vi.fn().mockReturnValue([]),
		};

		await searchSessionFilesRemote('/path', 'query', mockSshConfig, deps);
		expect(deps.execSsh).toHaveBeenCalledTimes(2);
	});
});
