/**
 * Tests for remote-git.ts — specifically the execGit() dispatch function
 * and its remoteCwd fallback behavior for SSH sessions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execGit, execGitRemote } from '../../../main/utils/remote-git';
import type { SshRemoteConfig } from '../../../shared/types';

// Mock execFile module — intercepts all actual process spawning
vi.mock('../../../main/utils/execFile', () => ({
	execFileNoThrow: vi.fn().mockResolvedValue({
		stdout: 'true\n',
		stderr: '',
		exitCode: 0,
	}),
}));

// Mock ssh-command-builder — prevents real SSH connections
vi.mock('../../../main/utils/ssh-command-builder', () => ({
	buildSshCommand: vi.fn().mockResolvedValue({
		command: 'ssh',
		args: ['-tt', 'user@host', 'git rev-parse --is-inside-work-tree'],
	}),
	AGENT_SSH_OPTIONS: {},
	validateSshSocket: vi.fn().mockResolvedValue(undefined),
}));

// Mock logger
vi.mock('../../../main/utils/logger', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

// Import mocked modules for assertion access
import { execFileNoThrow } from '../../../main/utils/execFile';
import { buildSshCommand } from '../../../main/utils/ssh-command-builder';

describe('remote-git', () => {
	// Standard SSH config fixture
	const sshConfig: SshRemoteConfig = {
		id: 'test-ssh-1',
		name: 'Test SSH Remote',
		host: 'dev.example.com',
		port: 22,
		username: 'testuser',
		privateKeyPath: '~/.ssh/id_ed25519',
		enabled: true,
	};

	beforeEach(() => {
		vi.clearAllMocks();
		// Reset default mock behavior
		vi.mocked(execFileNoThrow).mockResolvedValue({
			stdout: 'true\n',
			stderr: '',
			exitCode: 0,
		});
		vi.mocked(buildSshCommand).mockResolvedValue({
			command: 'ssh',
			args: ['-tt', 'testuser@dev.example.com', 'git rev-parse --is-inside-work-tree'],
		});
	});

	describe('execGit — local execution (no SSH)', () => {
		it('should call execFileNoThrow with git, args, and localCwd', async () => {
			const result = await execGit(['rev-parse', '--is-inside-work-tree'], '/home/user/project');

			expect(execFileNoThrow).toHaveBeenCalledWith(
				'git',
				['rev-parse', '--is-inside-work-tree'],
				'/home/user/project'
			);
			expect(result.exitCode).toBe(0);
		});

		it('should pass localCwd correctly for different paths', async () => {
			await execGit(['status', '--porcelain'], '/var/repos/my-app');

			expect(execFileNoThrow).toHaveBeenCalledWith(
				'git',
				['status', '--porcelain'],
				'/var/repos/my-app'
			);
		});

		it('should not invoke buildSshCommand for local execution', async () => {
			await execGit(['branch', '-a'], '/home/user/project');

			expect(buildSshCommand).not.toHaveBeenCalled();
		});

		it('should not invoke buildSshCommand when sshRemote is null', async () => {
			await execGit(['branch', '-a'], '/home/user/project', null);

			expect(buildSshCommand).not.toHaveBeenCalled();
			expect(execFileNoThrow).toHaveBeenCalledWith('git', ['branch', '-a'], '/home/user/project');
		});

		it('should not invoke buildSshCommand when sshRemote is undefined', async () => {
			await execGit(['branch', '-a'], '/home/user/project', undefined);

			expect(buildSshCommand).not.toHaveBeenCalled();
			expect(execFileNoThrow).toHaveBeenCalledWith('git', ['branch', '-a'], '/home/user/project');
		});
	});

	describe('execGit — SSH execution with explicit remoteCwd', () => {
		it('should use explicitly provided remoteCwd over localCwd', async () => {
			await execGit(
				['rev-parse', '--is-inside-work-tree'],
				'/local/path',
				sshConfig,
				'/remote/explicit/path'
			);

			// buildSshCommand should be called with remoteOptions containing the explicit remoteCwd
			expect(buildSshCommand).toHaveBeenCalledWith(
				sshConfig,
				expect.objectContaining({
					command: 'git',
					args: ['rev-parse', '--is-inside-work-tree'],
					cwd: '/remote/explicit/path',
				})
			);
		});

		it('should NOT use localCwd when remoteCwd is explicitly provided', async () => {
			await execGit(['status'], '/should/be/ignored', sshConfig, '/remote/used/path');

			expect(buildSshCommand).toHaveBeenCalledWith(
				sshConfig,
				expect.objectContaining({
					cwd: '/remote/used/path',
				})
			);
		});
	});

	describe('execGit — SSH execution WITHOUT remoteCwd (the bug fix)', () => {
		it('should fall back to localCwd when remoteCwd is undefined', async () => {
			await execGit(
				['rev-parse', '--is-inside-work-tree'],
				'/home/user/remote-project',
				sshConfig
				// remoteCwd omitted — this is the bug scenario
			);

			// The fix: localCwd should be used as the effective remoteCwd
			expect(buildSshCommand).toHaveBeenCalledWith(
				sshConfig,
				expect.objectContaining({
					command: 'git',
					args: ['rev-parse', '--is-inside-work-tree'],
					cwd: '/home/user/remote-project',
				})
			);
		});

		it('should fall back to localCwd when remoteCwd is empty string', async () => {
			await execGit(
				['rev-parse', '--is-inside-work-tree'],
				'/home/user/remote-project',
				sshConfig,
				'' // empty string is falsy
			);

			expect(buildSshCommand).toHaveBeenCalledWith(
				sshConfig,
				expect.objectContaining({
					cwd: '/home/user/remote-project',
				})
			);
		});

		it('should use the correct path for git isRepo check over SSH', async () => {
			// This simulates what happens when the Wizard calls gitService.isRepo(path, sshRemoteId)
			// The path is a remote directory like /home/user/my-project
			await execGit(['rev-parse', '--is-inside-work-tree'], '/home/user/my-project', sshConfig);

			expect(buildSshCommand).toHaveBeenCalledWith(
				sshConfig,
				expect.objectContaining({
					cwd: '/home/user/my-project',
				})
			);
		});

		it('should use the correct path for git status over SSH', async () => {
			await execGit(['status', '--porcelain'], '/home/user/my-project', sshConfig);

			expect(buildSshCommand).toHaveBeenCalledWith(
				sshConfig,
				expect.objectContaining({
					command: 'git',
					args: ['status', '--porcelain'],
					cwd: '/home/user/my-project',
				})
			);
		});

		it('should use the correct path for git branch over SSH', async () => {
			await execGit(['rev-parse', '--abbrev-ref', 'HEAD'], '/home/user/my-project', sshConfig);

			expect(buildSshCommand).toHaveBeenCalledWith(
				sshConfig,
				expect.objectContaining({
					command: 'git',
					args: ['rev-parse', '--abbrev-ref', 'HEAD'],
					cwd: '/home/user/my-project',
				})
			);
		});
	});

	describe('execGit — return value passthrough', () => {
		it('should return exitCode 0 for successful local git command', async () => {
			vi.mocked(execFileNoThrow).mockResolvedValue({
				stdout: 'true\n',
				stderr: '',
				exitCode: 0,
			});

			const result = await execGit(['rev-parse', '--is-inside-work-tree'], '/home/user/repo');
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe('true\n');
		});

		it('should return exitCode 128 for non-git-repo local path', async () => {
			vi.mocked(execFileNoThrow).mockResolvedValue({
				stdout: '',
				stderr: 'fatal: not a git repository',
				exitCode: 128,
			});

			const result = await execGit(['rev-parse', '--is-inside-work-tree'], '/tmp/not-a-repo');
			expect(result.exitCode).toBe(128);
			expect(result.stderr).toContain('not a git repository');
		});

		it('should return exitCode 0 for successful SSH git command', async () => {
			vi.mocked(execFileNoThrow).mockResolvedValue({
				stdout: 'true\n',
				stderr: '',
				exitCode: 0,
			});

			const result = await execGit(
				['rev-parse', '--is-inside-work-tree'],
				'/home/user/repo',
				sshConfig
			);
			expect(result.exitCode).toBe(0);
		});

		it('should return exitCode 128 for non-git-repo remote path', async () => {
			vi.mocked(execFileNoThrow).mockResolvedValue({
				stdout: '',
				stderr: 'fatal: not a git repository',
				exitCode: 128,
			});

			const result = await execGit(
				['rev-parse', '--is-inside-work-tree'],
				'/home/user/not-a-repo',
				sshConfig
			);
			expect(result.exitCode).toBe(128);
		});
	});

	describe('execGitRemote — direct invocation', () => {
		it('should call buildSshCommand with correct structure', async () => {
			await execGitRemote(['log', '--oneline', '-5'], {
				sshRemote: sshConfig,
				remoteCwd: '/home/user/project',
			});

			expect(buildSshCommand).toHaveBeenCalledWith(
				sshConfig,
				expect.objectContaining({
					command: 'git',
					args: ['log', '--oneline', '-5'],
					cwd: '/home/user/project',
				})
			);
		});

		it('should pass undefined cwd when remoteCwd is not provided', async () => {
			await execGitRemote(['log'], {
				sshRemote: sshConfig,
			});

			expect(buildSshCommand).toHaveBeenCalledWith(
				sshConfig,
				expect.objectContaining({
					command: 'git',
					args: ['log'],
					cwd: undefined,
				})
			);
		});
	});
});
