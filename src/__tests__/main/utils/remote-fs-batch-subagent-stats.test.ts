import { describe, it, expect, vi } from 'vitest';
import { batchSubagentStatsRemote } from '../../../main/utils/remote-fs';
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
	identityFile: '~/.ssh/id_ed25519',
	enabled: true,
};

function createMockDeps(stdout: string, exitCode = 0, stderr = ''): RemoteFsDeps {
	return {
		execSsh: vi.fn().mockResolvedValue({ stdout, stderr, exitCode }),
		buildSshArgs: vi.fn().mockReturnValue(['-o', 'BatchMode=yes', 'testuser@test.example.com']),
	};
}

describe('batchSubagentStatsRemote', () => {
	it('should parse stats from batch command output', async () => {
		const stdout = [
			'COUNT:3',
			'INPUT:15000',
			'OUTPUT:5000',
			'CACHE_READ:3000',
			'CACHE_CREATE:1000',
			'MESSAGES:42',
		].join('\n');

		const deps = createMockDeps(stdout);
		const result = await batchSubagentStatsRemote('/path/to/subagents', mockSshConfig, deps);

		expect(result.success).toBe(true);
		expect(result.data).toEqual({
			subagentCount: 3,
			inputTokens: 15000,
			outputTokens: 5000,
			cacheReadTokens: 3000,
			cacheCreationTokens: 1000,
			messageCount: 42,
		});
	});

	it('should return null when directory does not exist', async () => {
		const deps = createMockDeps('NO_DIR');
		const result = await batchSubagentStatsRemote('/path/to/subagents', mockSshConfig, deps);

		expect(result.success).toBe(true);
		expect(result.data).toBeNull();
	});

	it('should return null when no subagent files exist', async () => {
		const deps = createMockDeps('NO_FILES');
		const result = await batchSubagentStatsRemote('/path/to/subagents', mockSshConfig, deps);

		expect(result.success).toBe(true);
		expect(result.data).toBeNull();
	});

	it('should handle SSH errors', async () => {
		const deps = createMockDeps('', 1, 'Connection refused');
		const result = await batchSubagentStatsRemote('/path/to/subagents', mockSshConfig, deps);

		expect(result.success).toBe(false);
	});

	it('should handle zero values correctly', async () => {
		const stdout = [
			'COUNT:1',
			'INPUT:0',
			'OUTPUT:0',
			'CACHE_READ:0',
			'CACHE_CREATE:0',
			'MESSAGES:0',
		].join('\n');

		const deps = createMockDeps(stdout);
		const result = await batchSubagentStatsRemote('/path/to/subagents', mockSshConfig, deps);

		expect(result.success).toBe(true);
		expect(result.data?.subagentCount).toBe(1);
		expect(result.data?.inputTokens).toBe(0);
	});

	it('should make exactly one SSH call', async () => {
		const deps = createMockDeps('NO_DIR');
		await batchSubagentStatsRemote('/path/to/subagents', mockSshConfig, deps);
		expect(deps.execSsh).toHaveBeenCalledTimes(1);
	});
});
