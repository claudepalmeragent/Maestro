/**
 * Tests for the detectGitRepo shared helper function.
 * This function consolidates git detection logic across all 6 detection paths.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectGitRepo } from '../../../renderer/services/git';

// Mock window.maestro.git at the IPC level (same pattern as git.test.ts)
const mockGit = {
	isRepo: vi.fn(),
	getRepoRoot: vi.fn(),
	branches: vi.fn(),
	tags: vi.fn(),
	scanWorktreeDirectory: vi.fn(),
};

beforeEach(() => {
	vi.clearAllMocks();

	(window as any).maestro = {
		...(window as any).maestro,
		git: mockGit,
	};

	// Suppress console.error from createIpcMethod error paths
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('detectGitRepo', () => {
	it('should detect when cwd is a git repo', async () => {
		mockGit.isRepo.mockResolvedValue(true);
		mockGit.getRepoRoot.mockResolvedValue({ root: '/home/user/project' });
		mockGit.branches.mockResolvedValue({ branches: ['main', 'dev'] });
		mockGit.tags.mockResolvedValue({ tags: ['v1.0'] });

		const result = await detectGitRepo('/home/user/project', undefined);

		expect(result.isGitRepo).toBe(true);
		expect(result.gitRoot).toBe('/home/user/project');
		expect(result.gitBranches).toEqual(['main', 'dev']);
		expect(result.gitTags).toEqual(['v1.0']);
		expect(result.gitRefsCacheTime).toBeGreaterThan(0);
		expect(result.gitSubdirScanResults).toBeUndefined();
	});

	it('should return false when cwd is not a repo and subdir scan is disabled', async () => {
		mockGit.isRepo.mockResolvedValue(false);

		const result = await detectGitRepo('/home/user/projects', undefined);

		expect(result.isGitRepo).toBe(false);
		expect(result.gitRoot).toBeUndefined();
		expect(result.gitSubdirScanResults).toBeUndefined();
		// Should NOT call scanWorktreeDirectory
		expect(mockGit.scanWorktreeDirectory).not.toHaveBeenCalled();
	});

	it('should return false when cwd is not a repo and subdir scan is explicitly disabled', async () => {
		mockGit.isRepo.mockResolvedValue(false);

		const result = await detectGitRepo('/home/user/projects', undefined, {
			enableSubdirScan: false,
		});

		expect(result.isGitRepo).toBe(false);
		expect(mockGit.scanWorktreeDirectory).not.toHaveBeenCalled();
	});

	it('should scan subdirectories when enabled and cwd is not a repo', async () => {
		mockGit.isRepo.mockResolvedValue(false);
		mockGit.scanWorktreeDirectory.mockResolvedValue({ gitSubdirs: [] });

		const result = await detectGitRepo('/home/user/projects', undefined, {
			enableSubdirScan: true,
		});

		expect(result.isGitRepo).toBe(false);
		expect(mockGit.scanWorktreeDirectory).toHaveBeenCalledWith('/home/user/projects', undefined);
	});

	it('should auto-select when exactly 1 subdir found', async () => {
		mockGit.isRepo.mockResolvedValue(false);
		mockGit.scanWorktreeDirectory.mockResolvedValue({
			gitSubdirs: [
				{
					path: '/home/user/projects/my-app',
					name: 'my-app',
					isWorktree: false,
					branch: 'main',
					repoRoot: '/home/user/projects/my-app',
				},
			],
		});
		mockGit.getRepoRoot.mockResolvedValue({ root: '/home/user/projects/my-app' });
		mockGit.branches.mockResolvedValue({ branches: ['main', 'develop'] });
		mockGit.tags.mockResolvedValue({ tags: [] });

		const result = await detectGitRepo('/home/user/projects', undefined, {
			enableSubdirScan: true,
		});

		expect(result.isGitRepo).toBe(true);
		expect(result.gitRoot).toBe('/home/user/projects/my-app');
		expect(result.gitBranches).toEqual(['main', 'develop']);
		expect(result.gitSubdirScanResults).toBeUndefined();
	});

	it('should return scan results when 2+ subdirs found', async () => {
		mockGit.isRepo.mockResolvedValue(false);
		const subdirs = [
			{
				path: '/home/user/projects/app-a',
				name: 'app-a',
				isWorktree: false,
				branch: 'main',
				repoRoot: null,
			},
			{
				path: '/home/user/projects/app-b',
				name: 'app-b',
				isWorktree: true,
				branch: 'feature',
				repoRoot: null,
			},
		];
		mockGit.scanWorktreeDirectory.mockResolvedValue({ gitSubdirs: subdirs });

		const result = await detectGitRepo('/home/user/projects', undefined, {
			enableSubdirScan: true,
		});

		expect(result.isGitRepo).toBe(false);
		expect(result.gitSubdirScanResults).toEqual(subdirs);
		expect(result.gitRoot).toBeUndefined();
		// Should NOT call getRepoRoot/branches/tags for multi-subdir case
		expect(mockGit.getRepoRoot).not.toHaveBeenCalled();
		expect(mockGit.branches).not.toHaveBeenCalled();
	});

	it('should pass sshRemoteId through to all gitService calls', async () => {
		mockGit.isRepo.mockResolvedValue(true);
		mockGit.getRepoRoot.mockResolvedValue({ root: '/remote/project' });
		mockGit.branches.mockResolvedValue({ branches: ['main'] });
		mockGit.tags.mockResolvedValue({ tags: [] });

		await detectGitRepo('/remote/project', 'ssh-remote-123');

		expect(mockGit.isRepo).toHaveBeenCalledWith('/remote/project', 'ssh-remote-123');
		expect(mockGit.getRepoRoot).toHaveBeenCalledWith('/remote/project', 'ssh-remote-123');
		expect(mockGit.branches).toHaveBeenCalledWith('/remote/project', 'ssh-remote-123');
		expect(mockGit.tags).toHaveBeenCalledWith('/remote/project', 'ssh-remote-123');
	});

	it('should pass sshRemoteId through subdir scan path', async () => {
		mockGit.isRepo.mockResolvedValue(false);
		mockGit.scanWorktreeDirectory.mockResolvedValue({
			gitSubdirs: [
				{
					path: '/remote/project/repo',
					name: 'repo',
					isWorktree: false,
					branch: 'main',
					repoRoot: null,
				},
			],
		});
		mockGit.getRepoRoot.mockResolvedValue({ root: '/remote/project/repo' });
		mockGit.branches.mockResolvedValue({ branches: ['main'] });
		mockGit.tags.mockResolvedValue({ tags: [] });

		await detectGitRepo('/remote/project', 'ssh-remote-456', { enableSubdirScan: true });

		expect(mockGit.scanWorktreeDirectory).toHaveBeenCalledWith('/remote/project', 'ssh-remote-456');
		expect(mockGit.getRepoRoot).toHaveBeenCalledWith('/remote/project/repo', 'ssh-remote-456');
	});

	it('should fall back to cwd when getRepoRoot returns null', async () => {
		mockGit.isRepo.mockResolvedValue(true);
		mockGit.getRepoRoot.mockResolvedValue({ root: null });
		mockGit.branches.mockResolvedValue({ branches: [] });
		mockGit.tags.mockResolvedValue({ tags: [] });

		const result = await detectGitRepo('/some/path', undefined);

		expect(result.isGitRepo).toBe(true);
		expect(result.gitRoot).toBe('/some/path');
	});

	it('should fall back to subdir path when getRepoRoot returns null in auto-select', async () => {
		mockGit.isRepo.mockResolvedValue(false);
		mockGit.scanWorktreeDirectory.mockResolvedValue({
			gitSubdirs: [
				{
					path: '/projects/my-repo',
					name: 'my-repo',
					isWorktree: false,
					branch: 'main',
					repoRoot: null,
				},
			],
		});
		mockGit.getRepoRoot.mockResolvedValue({ root: null });
		mockGit.branches.mockResolvedValue({ branches: [] });
		mockGit.tags.mockResolvedValue({ tags: [] });

		const result = await detectGitRepo('/projects', undefined, { enableSubdirScan: true });

		expect(result.isGitRepo).toBe(true);
		expect(result.gitRoot).toBe('/projects/my-repo');
	});
});
