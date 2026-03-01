/**
 * Git operations service
 * Wraps IPC calls to main process for git operations
 */

import {
	remoteUrlToBrowserUrl,
	parseGitStatusPorcelain,
	parseGitNumstat,
} from '../../shared/gitUtils';
import { createIpcMethod } from './ipcWrapper';

/** Race a promise against a timeout. Returns fallback on timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
	let timer: ReturnType<typeof setTimeout>;
	return Promise.race([
		promise,
		new Promise<T>((resolve) => {
			timer = setTimeout(() => resolve(fallback), ms);
		}),
	]).finally(() => clearTimeout(timer));
}

export interface GitStatus {
	files: Array<{
		path: string;
		status: string;
	}>;
	branch?: string;
}

export interface GitDiff {
	diff: string;
}

export interface GitNumstat {
	files: Array<{
		path: string;
		additions: number;
		deletions: number;
	}>;
}

/**
 * All git service methods support SSH remote execution via optional sshRemoteId parameter.
 * When sshRemoteId is provided, operations execute on the remote host via SSH.
 */
export const gitService = {
	/**
	 * Check if a directory is a git repository
	 * @param cwd Working directory path
	 * @param sshRemoteId Optional SSH remote ID for remote execution
	 */
	async isRepo(cwd: string, sshRemoteId?: string): Promise<boolean> {
		return createIpcMethod({
			call: () => window.maestro.git.isRepo(cwd, sshRemoteId),
			errorContext: 'Git isRepo',
			defaultValue: false,
		});
	},

	/**
	 * Get git status (porcelain format) and current branch
	 * @param cwd Working directory path
	 * @param sshRemoteId Optional SSH remote ID for remote execution
	 */
	async getStatus(cwd: string, sshRemoteId?: string): Promise<GitStatus> {
		return createIpcMethod({
			call: async () => {
				const [statusResult, branchResult] = await Promise.all([
					window.maestro.git.status(cwd, sshRemoteId),
					window.maestro.git.branch(cwd, sshRemoteId),
				]);

				const files = parseGitStatusPorcelain(statusResult.stdout || '');
				const branch = branchResult.stdout?.trim() || undefined;

				return { files, branch };
			},
			errorContext: 'Git status',
			defaultValue: { files: [], branch: undefined },
		});
	},

	/**
	 * Get git diff for specific files or all changes
	 * @param cwd Working directory path
	 * @param files Optional list of files to get diff for
	 * @param sshRemoteId Optional SSH remote ID for remote execution
	 */
	async getDiff(cwd: string, files?: string[], sshRemoteId?: string): Promise<GitDiff> {
		return createIpcMethod({
			call: async () => {
				// If no files specified, get full diff
				if (!files || files.length === 0) {
					const result = await window.maestro.git.diff(cwd, undefined, sshRemoteId);
					return { diff: result.stdout };
				}
				// Otherwise get diff for specific files
				const results = await Promise.all(
					files.map((file) => window.maestro.git.diff(cwd, file, sshRemoteId))
				);
				return { diff: results.map((result) => result.stdout).join('\n') };
			},
			errorContext: 'Git diff',
			defaultValue: { diff: '' },
		});
	},

	/**
	 * Get line-level statistics for all changes
	 * @param cwd Working directory path
	 * @param sshRemoteId Optional SSH remote ID for remote execution
	 */
	async getNumstat(cwd: string, sshRemoteId?: string): Promise<GitNumstat> {
		return createIpcMethod({
			call: async () => {
				const result = await window.maestro.git.numstat(cwd, sshRemoteId);
				const files = parseGitNumstat(result.stdout || '');
				return { files };
			},
			errorContext: 'Git numstat',
			defaultValue: { files: [] },
		});
	},

	/**
	 * Get the browser-friendly URL for the remote repository
	 * Returns null if no remote or URL cannot be parsed
	 * @param cwd Working directory path
	 * @param sshRemoteId Optional SSH remote ID for remote execution
	 */
	async getRemoteBrowserUrl(cwd: string, sshRemoteId?: string): Promise<string | null> {
		return createIpcMethod({
			call: async () => {
				const result = await window.maestro.git.remote(cwd, sshRemoteId);
				return result.stdout ? remoteUrlToBrowserUrl(result.stdout) : null;
			},
			errorContext: 'Git remote',
			defaultValue: null,
		});
	},

	/**
	 * Get all branches (local and remote, deduplicated)
	 * @param cwd Working directory path
	 * @param sshRemoteId Optional SSH remote ID for remote execution
	 */
	async getBranches(cwd: string, sshRemoteId?: string): Promise<string[]> {
		return createIpcMethod({
			call: async () => {
				const result = await window.maestro.git.branches(cwd, sshRemoteId);
				return result.branches || [];
			},
			errorContext: 'Git branches',
			defaultValue: [],
		});
	},

	/**
	 * Get all tags
	 * @param cwd Working directory path
	 * @param sshRemoteId Optional SSH remote ID for remote execution
	 */
	async getTags(cwd: string, sshRemoteId?: string): Promise<string[]> {
		return createIpcMethod({
			call: async () => {
				const result = await window.maestro.git.tags(cwd, sshRemoteId);
				return result.tags || [];
			},
			errorContext: 'Git tags',
			defaultValue: [],
		});
	},

	/**
	 * Get the root directory of a git repository
	 * Returns null if not a git repo or on error
	 * @param cwd Working directory path (can be any subdirectory within a repo)
	 * @param sshRemoteId Optional SSH remote ID for remote execution
	 */
	async getRepoRoot(cwd: string, sshRemoteId?: string): Promise<string | null> {
		return createIpcMethod({
			call: async () => {
				const result = await window.maestro.git.getRepoRoot(cwd, sshRemoteId);
				return result?.root || null;
			},
			errorContext: 'Git getRepoRoot',
			defaultValue: null,
		});
	},

	/**
	 * Scan a directory for immediate subdirectories that are git repositories or worktrees
	 * Returns an empty array if no git repos found or on error
	 * @param parentPath Parent directory to scan (depth 1 only)
	 * @param sshRemoteId Optional SSH remote ID for remote execution
	 */
	async scanWorktreeDirectory(
		parentPath: string,
		sshRemoteId?: string
	): Promise<
		Array<{
			path: string;
			name: string;
			isWorktree: boolean;
			branch: string | null;
			repoRoot: string | null;
		}>
	> {
		return createIpcMethod({
			call: async () => {
				const result = await window.maestro.git.scanWorktreeDirectory(parentPath, sshRemoteId);
				return result?.gitSubdirs || [];
			},
			errorContext: 'Git scanWorktreeDirectory',
			defaultValue: [],
		});
	},
};

/**
 * Result of git repository detection.
 */
export interface GitDetectionResult {
	isGitRepo: boolean;
	isBareRepo?: boolean;
	gitRoot?: string;
	gitBranches?: string[];
	gitTags?: string[];
	gitRefsCacheTime?: number;
}

// In-flight dedup cache: concurrent calls for the same (cwd, sshRemoteId) share one Promise.
// Prevents thundering herd when multiple detection paths fire simultaneously.
const inflightDetections = new Map<string, Promise<GitDetectionResult>>();

/**
 * Detect git repository at cwd, with optional subdirectory fallback.
 * Used by all git detection paths in App.tsx for consistent behavior.
 *
 * Includes in-flight dedup: if a detection is already running for the same
 * (cwd, sshRemoteId, enableSubdirScan) key, the existing Promise is returned
 * instead of spawning another batch of SSH commands.
 *
 * Flow:
 * 1. isRepo(cwd) — check if cwd itself is a git repo
 * 2. If true: getRepoRoot + getBranches + getTags → return full result
 * 3. If false AND enableSubdirScan: scanWorktreeDirectory(cwd)
 *    - Scans subdirs alphabetically, one at a time, stops at first git repo
 *    - 0 found → { isGitRepo: false }
 *    - 1 found → auto-select: getRepoRoot + getBranches + getTags
 *
 * @param cwd Working directory to check
 * @param sshRemoteId Optional SSH remote ID for remote execution
 * @param options.enableSubdirScan Whether to scan subdirectories if cwd is not a repo
 */
export async function detectGitRepo(
	cwd: string,
	sshRemoteId: string | undefined,
	options?: { enableSubdirScan?: boolean }
): Promise<GitDetectionResult> {
	const enableSubdirScan = options?.enableSubdirScan ?? false;
	const dedupKey = `${cwd}::${sshRemoteId ?? 'local'}::${enableSubdirScan}`;

	// Return existing in-flight promise if one exists for this key
	const inflight = inflightDetections.get(dedupKey);
	if (inflight) {
		return inflight;
	}

	const promise = detectGitRepoImpl(cwd, sshRemoteId, enableSubdirScan);
	inflightDetections.set(dedupKey, promise);

	try {
		return await promise;
	} finally {
		inflightDetections.delete(dedupKey);
	}
}

async function detectGitRepoImpl(
	cwd: string,
	sshRemoteId: string | undefined,
	enableSubdirScan: boolean
): Promise<GitDetectionResult> {
	// Step 1: Check if cwd itself is a git repo
	const isRepo = await gitService.isRepo(cwd, sshRemoteId);

	if (isRepo) {
		const gitRoot = (await gitService.getRepoRoot(cwd, sshRemoteId)) || cwd;
		// Timeout prevents hanging when SSH ControlMaster socket is congested
		const [gitBranches, gitTags] = await withTimeout(
			Promise.all([
				gitService.getBranches(gitRoot, sshRemoteId),
				gitService.getTags(gitRoot, sshRemoteId),
			]),
			10_000,
			[[] as string[], [] as string[]]
		);
		return {
			isGitRepo: true,
			isBareRepo: false,
			gitRoot,
			gitBranches,
			gitTags,
			gitRefsCacheTime: Date.now(),
		};
	}

	// Step 2: Subdirectory scan fallback (only if enabled)
	if (!enableSubdirScan) {
		return { isGitRepo: false };
	}

	// scanWorktreeDirectory iterates alphabetically and stops at the first git repo.
	// It returns 0 or 1 results — never 2+.
	const subdirs = await gitService.scanWorktreeDirectory(cwd, sshRemoteId);

	if (subdirs.length === 0) {
		return { isGitRepo: false };
	}

	// Auto-select the single result
	const subdir = subdirs[0];
	const gitRoot = (await gitService.getRepoRoot(subdir.path, sshRemoteId)) || subdir.path;

	// Timeout prevents hanging when SSH ControlMaster socket is congested
	const [gitBranches, gitTags] = await withTimeout(
		Promise.all([
			gitService.getBranches(gitRoot, sshRemoteId),
			gitService.getTags(gitRoot, sshRemoteId),
		]),
		10_000,
		[[] as string[], [] as string[]]
	);

	return {
		isGitRepo: true,
		isBareRepo: subdir.isBare,
		gitRoot,
		gitBranches,
		gitTags,
		gitRefsCacheTime: Date.now(),
	};
}
