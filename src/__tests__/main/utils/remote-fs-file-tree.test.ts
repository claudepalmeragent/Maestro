import { describe, it, expect, vi } from 'vitest';
import { loadFileTreeRemote, type RemoteFsDeps } from '../../../main/utils/remote-fs';
import type { SshRemoteConfig } from '../../../shared/types';
import type { ExecResult } from '../../../main/utils/execFile';

// Mock ssh-socket-cleanup
vi.mock('../../../main/utils/ssh-socket-cleanup', () => ({
	validateSshSocket: vi.fn().mockResolvedValue(true),
}));

// Mock logger
vi.mock('../../../main/utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

// Mock ssh-remote-manager
vi.mock('../../../main/ssh-remote-manager', () => ({
	sshRemoteManager: {
		getRemoteStatus: vi.fn(),
	},
}));

// Mock cliDetection
vi.mock('../../../main/utils/cliDetection', () => ({
	resolveSshPath: vi.fn().mockResolvedValue('ssh'),
}));

describe('loadFileTreeRemote', () => {
	const baseConfig: SshRemoteConfig = {
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
			buildSshArgs: vi
				.fn()
				.mockReturnValue([
					'-i',
					'/home/user/.ssh/id_ed25519',
					'-p',
					'22',
					'testuser@dev.example.com',
				]),
		};
	}

	it('parses find output with directories and files', async () => {
		const output = [
			'd\tsrc',
			'f\tsrc/index.ts',
			'f\tsrc/app.ts',
			'd\tsrc/utils',
			'f\tsrc/utils/helper.ts',
			'f\tREADME.md',
			'f\tpackage.json',
		].join('\n');

		const deps = createMockDeps({ stdout: output, stderr: '', exitCode: 0 });
		const result = await loadFileTreeRemote('/home/user/project', baseConfig, 10, [], deps);

		expect(result.success).toBe(true);
		expect(result.data).toBeDefined();
		expect(result.data!.length).toBe(7);

		const dirs = result.data!.filter((e) => e.isDirectory);
		expect(dirs.length).toBe(2);
		expect(dirs.map((d) => d.relativePath)).toContain('src');
		expect(dirs.map((d) => d.relativePath)).toContain('src/utils');

		const files = result.data!.filter((e) => !e.isDirectory);
		expect(files.length).toBe(5);
	});

	it('handles empty directory', async () => {
		const deps = createMockDeps({ stdout: '', stderr: '', exitCode: 0 });
		const result = await loadFileTreeRemote('/home/user/empty', baseConfig, 10, [], deps);

		expect(result.success).toBe(true);
		expect(result.data).toEqual([]);
	});

	it('skips special file types but keeps symlinks', async () => {
		const output = [
			'd\tsrc',
			'f\tsrc/index.ts',
			'l\tsrc/link.ts',
			'p\tmy-pipe',
			's\tmy-socket',
		].join('\n');

		const deps = createMockDeps({ stdout: output, stderr: '', exitCode: 0 });
		const result = await loadFileTreeRemote('/home/user/project', baseConfig, 10, [], deps);

		expect(result.success).toBe(true);
		expect(result.data!.length).toBe(3);
	});

	it('includes ignore patterns in find command', async () => {
		const deps = createMockDeps({ stdout: '', stderr: '', exitCode: 0 });
		await loadFileTreeRemote(
			'/home/user/project',
			baseConfig,
			10,
			['node_modules', '__pycache__'],
			deps
		);

		const sshCall = (deps.execSsh as any).mock.calls[0];
		const command = sshCall[1][sshCall[1].length - 1];
		expect(command).toContain('node_modules');
		expect(command).toContain('__pycache__');
		expect(command).toContain('-prune');
	});

	it('returns error on complete failure', async () => {
		const deps = createMockDeps({ stdout: '', stderr: 'Permission denied', exitCode: 1 });
		const result = await loadFileTreeRemote('/root/restricted', baseConfig, 10, [], deps);

		expect(result.success).toBe(false);
		expect(result.error).toBeDefined();
	});
});
