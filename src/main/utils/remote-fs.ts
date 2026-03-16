/**
 * Remote File System utilities for SSH remote execution.
 *
 * Provides functions to perform file system operations on remote hosts via SSH.
 * These utilities enable File Explorer, Auto Run, and other features to work
 * when a session is running on a remote host.
 *
 * All functions accept a SshRemoteConfig and execute the corresponding
 * Unix commands (ls, cat, stat, du) via SSH, parsing their output.
 */

import pLimit from 'p-limit';
import { SshRemoteConfig } from '../../shared/types';
import { execFileNoThrow, ExecResult } from './execFile';
import { shellEscape } from './shell-escape';
import { sshRemoteManager } from '../ssh-remote-manager';
import { logger } from './logger';
import { validateSshSocket } from './ssh-socket-cleanup';
import { resolveSshPath } from './cliDetection';

/**
 * File or directory entry returned from readDir operations.
 */
export interface RemoteDirEntry {
	/** File or directory name */
	name: string;
	/** Whether this entry is a directory */
	isDirectory: boolean;
	/** Whether this entry is a symbolic link */
	isSymlink: boolean;
}

/**
 * File stat information returned from stat operations.
 */
export interface RemoteStatResult {
	/** File size in bytes */
	size: number;
	/** Whether this is a directory */
	isDirectory: boolean;
	/** Modification time as Unix timestamp (milliseconds) */
	mtime: number;
}

/**
 * Result wrapper for remote fs operations.
 * Includes success/failure status and optional error message.
 */
export interface RemoteFsResult<T> {
	/** Whether the operation succeeded */
	success: boolean;
	/** The result data (if success is true) */
	data?: T;
	/** Error message (if success is false) */
	error?: string;
}

/**
 * Dependencies that can be injected for testing.
 */
export interface RemoteFsDeps {
	/** Function to execute SSH commands */
	execSsh: (command: string, args: string[]) => Promise<ExecResult>;
	/** Function to build SSH args from config */
	buildSshArgs: (config: SshRemoteConfig) => string[];
}

/**
 * Default dependencies using real implementations.
 */
const defaultDeps: RemoteFsDeps = {
	execSsh: (command: string, args: string[]): Promise<ExecResult> => {
		return execFileNoThrow(command, args, undefined, { timeout: SSH_COMMAND_TIMEOUT_MS });
	},
	buildSshArgs: (config: SshRemoteConfig): string[] => {
		return sshRemoteManager.buildSshArgs(config);
	},
};

/**
 * Escape a path for remote shell execution, handling home directory expansion.
 *
 * Shell escaping with single quotes prevents ~ and $HOME from expanding.
 * This function handles paths that start with ~ or $HOME by:
 * 1. Keeping the home dir reference unquoted so the shell expands it
 * 2. Properly escaping the rest of the path
 *
 * @param dirPath The path to escape
 * @returns A shell-safe string that allows home directory expansion
 */
function escapeRemotePath(dirPath: string): string {
	// Handle ~ at start - expand via shell
	if (dirPath.startsWith('~/')) {
		const rest = dirPath.slice(2);
		// Use $HOME concatenation: $HOME'/rest/of/path'
		return `"$HOME"${shellEscape('/' + rest)}`;
	}
	if (dirPath === '~') {
		return '"$HOME"';
	}

	// Handle $HOME at start - expand via shell
	if (dirPath.startsWith('$HOME/')) {
		const rest = dirPath.slice(6);
		return `"$HOME"${shellEscape('/' + rest)}`;
	}
	if (dirPath === '$HOME') {
		return '"$HOME"';
	}

	// Regular path - just escape normally
	return shellEscape(dirPath);
}

/**
 * Default maximum concurrent SSH channels per host.
 * Matches OpenSSH's default MaxSessions (10).
 * Reserved channels: 2 (for the agent process + overhead).
 */
const DEFAULT_MAX_SSH_SESSIONS = 10;
const RESERVED_SSH_CHANNELS = 2;

/**
 * Per-host SSH concurrency limiters.
 * Caps simultaneous SSH exec calls to prevent exceeding the remote server's MaxSessions limit.
 * When the limit is reached, additional calls are queued (FIFO) — never dropped or errored.
 */
const hostLimiters = new Map<string, pLimit.Limit>();

/**
 * Get or create a concurrency limiter for the given SSH remote.
 * The limit is derived from the remote's maxSessions setting (default: 10),
 * minus a reserved channel budget for the agent process and overhead.
 */
function getHostLimiter(config: SshRemoteConfig): pLimit.Limit {
	const key = `${config.username || ''}@${config.host}:${config.port || 22}`;
	let limiter = hostLimiters.get(key);
	if (!limiter) {
		const maxSessions = config.maxSessions ?? DEFAULT_MAX_SSH_SESSIONS;
		const concurrencyLimit = Math.max(1, maxSessions - RESERVED_SSH_CHANNELS);
		limiter = pLimit(concurrencyLimit);
		hostLimiters.set(key, limiter);
		logger.debug(
			`[remote-fs] Created SSH concurrency limiter for ${key}: limit=${concurrencyLimit} (maxSessions=${maxSessions})`
		);
	}
	return limiter;
}

/**
 * Update or reset the concurrency limiter for a host when settings change.
 * Called when the user modifies maxSessions for a remote.
 */
export function resetHostLimiter(config: SshRemoteConfig): void {
	const key = `${config.username || ''}@${config.host}:${config.port || 22}`;
	hostLimiters.delete(key);
}

/**
 * Patterns indicating transient SSH errors that should be retried.
 * These are network/connection issues that may resolve on retry.
 */
const RECOVERABLE_SSH_ERRORS = [
	/connection closed/i,
	/connection reset/i,
	/connection refused/i, // Transient MaxSessions overflow — sshd rejected new channel
	/broken pipe/i,
	/network is unreachable/i,
	/connection timed out/i,
	/client_loop:\s*send disconnect/i,
	/packet corrupt/i,
	/protocol error/i,
	/ssh_exchange_identification/i,
	/connection unexpectedly closed/i,
	/kex_exchange_identification/i,
	/read: Connection reset by peer/i,
	/banner exchange/i, // SSH handshake failed - often due to stale ControlMaster sockets
	/socket is not connected/i, // Connection dropped before handshake
	/ETIMEDOUT/i, // Command timed out - SSH connection may be stale
];

/**
 * Check if an SSH error is recoverable (transient network issue).
 */
function isRecoverableSshError(stderr: string): boolean {
	return RECOVERABLE_SSH_ERRORS.some((pattern) => pattern.test(stderr));
}

/**
 * Default retry configuration for SSH operations.
 */
const DEFAULT_RETRY_CONFIG = {
	maxRetries: 3,
	baseDelayMs: 500,
	maxDelayMs: 5000,
};

/**
 * Timeout for individual SSH commands in milliseconds.
 * Prevents hung SSH connections (e.g., stale ControlMaster sockets)
 * from blocking the file tree load indefinitely.
 */
const SSH_COMMAND_TIMEOUT_MS = 30000;

/**
 * Sleep for a specified duration with jitter.
 */
function sleep(ms: number): Promise<void> {
	// Add 0-20% jitter to prevent thundering herd
	const jitter = ms * (Math.random() * 0.2);
	return new Promise((resolve) => setTimeout(resolve, ms + jitter));
}

/**
 * Calculate exponential backoff delay.
 */
function getBackoffDelay(attempt: number, baseDelay: number, maxDelay: number): number {
	const delay = baseDelay * Math.pow(2, attempt);
	return Math.min(delay, maxDelay);
}

/**
 * Execute a command on a remote host via SSH with automatic retry for transient errors.
 *
 * Implements exponential backoff with jitter for recoverable SSH errors like
 * connection closed, connection reset, broken pipe, etc.
 *
 * @param config SSH remote configuration
 * @param remoteCommand The shell command to execute on the remote
 * @param deps Optional dependencies for testing
 * @returns ExecResult with stdout, stderr, and exitCode
 */
export async function execRemoteCommand(
	config: SshRemoteConfig,
	remoteCommand: string,
	deps: RemoteFsDeps = defaultDeps
): Promise<ExecResult> {
	const limiter = getHostLimiter(config);
	return limiter(() => execRemoteCommandInner(config, remoteCommand, deps));
}

async function execRemoteCommandInner(
	config: SshRemoteConfig,
	remoteCommand: string,
	deps: RemoteFsDeps = defaultDeps
): Promise<ExecResult> {
	const { maxRetries, baseDelayMs, maxDelayMs } = DEFAULT_RETRY_CONFIG;
	let lastResult: ExecResult | null = null;

	// Pre-flight: validate ControlMaster socket is alive (~1ms, local only)
	await validateSshSocket(config.host, config.port, config.username);

	// Resolve SSH binary path (critical for Windows where spawn() doesn't search PATH)
	const sshPath = await resolveSshPath();

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		const sshArgs = deps.buildSshArgs(config);
		sshArgs.push(remoteCommand);

		const result = await deps.execSsh(sshPath, sshArgs);
		lastResult = result;

		// Success - return immediately
		if (result.exitCode === 0) {
			return result;
		}

		// Check if this is a recoverable error
		const combinedOutput = `${result.stderr} ${result.stdout}`;
		const isNodeTimeout = result.exitCode === 'ETIMEDOUT';
		if ((isRecoverableSshError(combinedOutput) || isNodeTimeout) && attempt < maxRetries) {
			// If error looks like a stale socket, clean it up before retry
			if (/banner exchange|socket is not connected|connection reset/i.test(combinedOutput)) {
				await validateSshSocket(config.host, config.port, config.username);
			}
			const delay = getBackoffDelay(attempt, baseDelayMs, maxDelayMs);
			logger.debug(
				`[remote-fs] SSH transient error (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms: ${result.stderr.slice(0, 100)}`
			);
			await sleep(delay);
			continue;
		}

		// Non-recoverable error or max retries reached - return the result
		return result;
	}

	// Should never reach here, but return last result as fallback
	return lastResult!;
}

/**
 * Read directory contents from a remote host via SSH.
 *
 * Executes `ls -la` on the remote and parses the output to extract
 * file names, types (directory, file, symlink), and other metadata.
 *
 * @param dirPath Path to the directory on the remote host
 * @param sshRemote SSH remote configuration
 * @param deps Optional dependencies for testing
 * @returns Array of directory entries
 *
 * @example
 * const entries = await readDirRemote('/home/user/project', sshConfig);
 * // => [{ name: 'src', isDirectory: true, isSymlink: false }, ...]
 */
export async function readDirRemote(
	dirPath: string,
	sshRemote: SshRemoteConfig,
	deps: RemoteFsDeps = defaultDeps
): Promise<RemoteFsResult<RemoteDirEntry[]>> {
	// Use ls with specific options:
	// -1: One entry per line
	// -A: Show hidden files except . and ..
	// -F: Append indicator (/ for dirs, @ for symlinks, * for executables)
	// --color=never: Disable color codes in output
	// We avoid -l because parsing long format is complex and locale-dependent
	const escapedPath = escapeRemotePath(dirPath);
	const remoteCommand = `ls -1AF --color=never ${escapedPath} 2>/dev/null || echo "__LS_ERROR__"`;

	const result = await execRemoteCommand(sshRemote, remoteCommand, deps);

	if (result.exitCode !== 0 && !result.stdout.includes('__LS_ERROR__')) {
		return {
			success: false,
			error: result.stderr || `ls failed with exit code ${result.exitCode}`,
		};
	}

	// Check for our error marker
	if (result.stdout.trim() === '__LS_ERROR__') {
		return {
			success: false,
			error: `Directory not found or not accessible: ${dirPath}`,
		};
	}

	const entries: RemoteDirEntry[] = [];
	const lines = result.stdout.trim().split('\n').filter(Boolean);

	for (const line of lines) {
		if (!line || line === '__LS_ERROR__') continue;

		let name = line;
		let isDirectory = false;
		let isSymlink = false;

		// Parse the indicator suffix from -F flag
		if (name.endsWith('/')) {
			name = name.slice(0, -1);
			isDirectory = true;
		} else if (name.endsWith('@')) {
			name = name.slice(0, -1);
			isSymlink = true;
		} else if (name.endsWith('*')) {
			// Executable file - remove the indicator
			name = name.slice(0, -1);
		} else if (name.endsWith('|')) {
			// Named pipe - remove the indicator
			name = name.slice(0, -1);
		} else if (name.endsWith('=')) {
			// Socket - remove the indicator
			name = name.slice(0, -1);
		}

		// Skip empty names (shouldn't happen, but be safe)
		if (!name) continue;

		entries.push({ name, isDirectory, isSymlink });
	}

	return {
		success: true,
		data: entries,
	};
}

/**
 * Read file contents from a remote host via SSH.
 *
 * Executes `cat` on the remote to read the file contents.
 * For binary files or very large files, consider using different approaches.
 *
 * @param filePath Path to the file on the remote host
 * @param sshRemote SSH remote configuration
 * @param deps Optional dependencies for testing
 * @returns File contents as a string
 *
 * @example
 * const content = await readFileRemote('/home/user/project/README.md', sshConfig);
 * // => '# My Project\n...'
 */
export async function readFileRemote(
	filePath: string,
	sshRemote: SshRemoteConfig,
	deps: RemoteFsDeps = defaultDeps
): Promise<RemoteFsResult<string>> {
	const escapedPath = escapeRemotePath(filePath);
	// Use cat with explicit error handling
	const remoteCommand = `cat ${escapedPath}`;

	const result = await execRemoteCommand(sshRemote, remoteCommand, deps);

	if (result.exitCode !== 0) {
		const error = result.stderr || `Failed to read file: ${filePath}`;
		return {
			success: false,
			error: error.includes('No such file')
				? `File not found: ${filePath}`
				: error.includes('Is a directory')
					? `Path is a directory: ${filePath}`
					: error.includes('Permission denied')
						? `Permission denied: ${filePath}`
						: error.includes('maxBuffer')
							? `File too large to read via SSH: ${filePath}`
							: error,
		};
	}

	return {
		success: true,
		data: result.stdout,
	};
}

/**
 * Read partial file contents from a remote host via SSH.
 *
 * Reads the first N lines and last M lines of a file, which is useful for
 * extracting metadata from large files without loading the entire content.
 *
 * @param filePath Path to the file on the remote host
 * @param sshRemote SSH remote configuration
 * @param headLines Number of lines to read from the beginning (default: 100)
 * @param tailLines Number of lines to read from the end (default: 50)
 * @param deps Optional dependencies for testing
 * @returns Partial file contents with head and tail sections
 */
export async function readFileRemotePartial(
	filePath: string,
	sshRemote: SshRemoteConfig,
	headLines: number = 100,
	tailLines: number = 50,
	deps: RemoteFsDeps = defaultDeps
): Promise<RemoteFsResult<{ head: string; tail: string; totalLines: number }>> {
	const escapedPath = escapeRemotePath(filePath);

	// Get total line count, head, and tail in one SSH command to minimize round trips
	// Use a separator that's unlikely to appear in JSONL content
	const separator = '___MAESTRO_SECTION_SEP___';
	const remoteCommand = `wc -l < ${escapedPath} && echo "${separator}" && head -n ${headLines} ${escapedPath} && echo "${separator}" && tail -n ${tailLines} ${escapedPath}`;

	const result = await execRemoteCommand(sshRemote, remoteCommand, deps);

	if (result.exitCode !== 0) {
		const error = result.stderr || `Failed to read file: ${filePath}`;
		return {
			success: false,
			error: error.includes('No such file')
				? `File not found: ${filePath}`
				: error.includes('Is a directory')
					? `Path is a directory: ${filePath}`
					: error.includes('Permission denied')
						? `Permission denied: ${filePath}`
						: error,
		};
	}

	// Parse the output sections
	const sections = result.stdout.split(separator);
	if (sections.length < 3) {
		return {
			success: false,
			error: `Failed to parse partial file output for: ${filePath}`,
		};
	}

	const totalLines = parseInt(sections[0].trim(), 10) || 0;
	const head = sections[1].trim();
	const tail = sections[2].trim();

	return {
		success: true,
		data: { head, tail, totalLines },
	};
}

/**
 * Result of reading a page of messages from a remote session file.
 */
export interface RemoteMessagePage {
	/** The extracted JSONL lines for this page */
	lines: string[];
	/** Total number of lines in the file */
	totalLines: number;
	/** Whether there are more lines before this page */
	hasMore: boolean;
}

/**
 * Read a page of messages from a remote session file using remote-side extraction.
 * Instead of transferring the entire file, counts total lines and extracts only
 * the lines needed for the requested page.
 *
 * Messages are paginated from the END of the file (most recent first).
 * offset=0, limit=20 returns the last 20 lines.
 * offset=20, limit=20 returns lines 20-40 from the end.
 *
 * @param filePath Full path to the .jsonl file on the remote
 * @param offset Number of lines to skip from the end (0 = start from most recent)
 * @param limit Number of lines to return
 * @param sshRemote SSH remote configuration
 * @param deps Optional dependencies for testing
 * @returns The extracted lines and total line count
 */
export async function readSessionMessagesRemote(
	filePath: string,
	offset: number,
	limit: number,
	sshRemote: SshRemoteConfig,
	deps: RemoteFsDeps = defaultDeps
): Promise<RemoteFsResult<RemoteMessagePage>> {
	const escapedPath = escapeRemotePath(filePath);

	// Single SSH command that:
	// 1. Counts total lines (wc -l)
	// 2. Extracts only the needed range using tail + head
	//
	// To get lines from the END with offset:
	//   tail -n (offset + limit) | head -n limit
	// This gives us `limit` lines starting at `offset` from the end.
	const separator = '___MAESTRO_MSG_SEP___';
	const tailCount = offset + limit;

	const remoteCommand = `TOTAL=$(wc -l < ${escapedPath} 2>/dev/null) && echo "$TOTAL" && echo "${separator}" && tail -n ${tailCount} ${escapedPath} | head -n ${limit}`;

	const result = await execRemoteCommand(sshRemote, remoteCommand, deps);

	if (result.exitCode !== 0) {
		const error = result.stderr || `Failed to read messages: ${filePath}`;
		return {
			success: false,
			error: error.includes('No such file') ? `File not found: ${filePath}` : error,
		};
	}

	// Parse output: first section is total count, second is the extracted lines
	const sepIdx = result.stdout.indexOf(separator);
	if (sepIdx === -1) {
		return {
			success: false,
			error: `Failed to parse message page output for: ${filePath}`,
		};
	}

	const totalLines = parseInt(result.stdout.slice(0, sepIdx).trim(), 10) || 0;
	const linesSection = result.stdout.slice(sepIdx + separator.length).trim();
	const lines = linesSection ? linesSection.split('\n') : [];

	// hasMore = there are lines before this page
	const hasMore = offset + limit < totalLines;

	return {
		success: true,
		data: {
			lines,
			totalLines,
			hasMore,
		},
	};
}

/**
 * Get file/directory stat information from a remote host via SSH.
 *
 * Executes `stat` on the remote with a specific format string to get
 * size, type, and modification time.
 *
 * @param filePath Path to the file or directory on the remote host
 * @param sshRemote SSH remote configuration
 * @param deps Optional dependencies for testing
 * @returns Stat information (size, isDirectory, mtime)
 *
 * @example
 * const stats = await statRemote('/home/user/project/package.json', sshConfig);
 * // => { size: 1234, isDirectory: false, mtime: 1703836800000 }
 */
export async function statRemote(
	filePath: string,
	sshRemote: SshRemoteConfig,
	deps: RemoteFsDeps = defaultDeps
): Promise<RemoteFsResult<RemoteStatResult>> {
	const escapedPath = escapeRemotePath(filePath);
	// Use stat with format string:
	// %s = size in bytes
	// %F = file type (regular file, directory, symbolic link, etc.)
	// %Y = modification time as Unix timestamp (seconds)
	// Note: GNU stat vs BSD stat have different format specifiers
	// We try GNU format first (Linux), then BSD format (macOS)
	// BSD stat requires $'...' ANSI-C quoting to interpret \n as newlines
	const remoteCommand = `stat --printf='%s\\n%F\\n%Y' ${escapedPath} 2>/dev/null || stat -f $'%z\\n%HT\\n%m' ${escapedPath}`;

	const result = await execRemoteCommand(sshRemote, remoteCommand, deps);

	if (result.exitCode !== 0) {
		const error = result.stderr || `Failed to stat: ${filePath}`;
		return {
			success: false,
			error: error.includes('No such file')
				? `Path not found: ${filePath}`
				: error.includes('Permission denied')
					? `Permission denied: ${filePath}`
					: error,
		};
	}

	const lines = result.stdout.trim().split('\n');
	if (lines.length < 3) {
		return {
			success: false,
			error: `Invalid stat output for: ${filePath}`,
		};
	}

	const size = parseInt(lines[0], 10);
	const fileType = lines[1].toLowerCase();
	const mtimeSeconds = parseInt(lines[2], 10);

	if (isNaN(size) || isNaN(mtimeSeconds)) {
		return {
			success: false,
			error: `Failed to parse stat output for: ${filePath}`,
		};
	}

	// Determine if it's a directory from the file type string
	// GNU stat returns: "regular file", "directory", "symbolic link"
	// BSD stat returns: "Regular File", "Directory", "Symbolic Link"
	const isDirectory = fileType.includes('directory');

	return {
		success: true,
		data: {
			size,
			isDirectory,
			mtime: mtimeSeconds * 1000, // Convert to milliseconds
		},
	};
}

/**
 * Get total size of a directory from a remote host via SSH.
 *
 * Executes `du -sb` on the remote to calculate the total size
 * of all files in the directory.
 *
 * @param dirPath Path to the directory on the remote host
 * @param sshRemote SSH remote configuration
 * @param deps Optional dependencies for testing
 * @returns Total size in bytes
 *
 * @example
 * const size = await directorySizeRemote('/home/user/project', sshConfig);
 * // => 1234567890
 */
export async function directorySizeRemote(
	dirPath: string,
	sshRemote: SshRemoteConfig,
	deps: RemoteFsDeps = defaultDeps
): Promise<RemoteFsResult<number>> {
	const escapedPath = shellEscape(dirPath);
	// Use du with:
	// -s: summarize (total only)
	// -b: apparent size in bytes (GNU)
	// If -b not available (BSD), use -k and multiply by 1024
	const remoteCommand = `du -sb ${escapedPath} 2>/dev/null || du -sk ${escapedPath} 2>/dev/null | awk '{print $1 * 1024}'`;

	const result = await execRemoteCommand(sshRemote, remoteCommand, deps);

	if (result.exitCode !== 0) {
		const error = result.stderr || `Failed to get directory size: ${dirPath}`;
		return {
			success: false,
			error: error.includes('No such file')
				? `Directory not found: ${dirPath}`
				: error.includes('Permission denied')
					? `Permission denied: ${dirPath}`
					: error,
		};
	}

	// Parse the size from the output (first field)
	const output = result.stdout.trim();
	const match = output.match(/^(\d+)/);

	if (!match) {
		return {
			success: false,
			error: `Failed to parse du output for: ${dirPath}`,
		};
	}

	const size = parseInt(match[1], 10);

	if (isNaN(size)) {
		return {
			success: false,
			error: `Invalid size value for: ${dirPath}`,
		};
	}

	return {
		success: true,
		data: size,
	};
}

/**
 * Write file contents to a remote host via SSH.
 *
 * Uses cat with a heredoc to safely write content to a file on the remote.
 * This is safe for text content but not recommended for binary files.
 *
 * @param filePath Path to the file on the remote host
 * @param content Content to write
 * @param sshRemote SSH remote configuration
 * @param deps Optional dependencies for testing
 * @returns Success/failure result
 *
 * @example
 * const result = await writeFileRemote('/home/user/project/output.txt', 'Hello!', sshConfig);
 * // => { success: true }
 */
export async function writeFileRemote(
	filePath: string,
	content: string | Buffer,
	sshRemote: SshRemoteConfig,
	deps: RemoteFsDeps = defaultDeps
): Promise<RemoteFsResult<void>> {
	const escapedPath = shellEscape(filePath);

	// Use base64 encoding to safely transfer the content
	// This avoids issues with special characters, quotes, and newlines
	// Accept both string and Buffer for binary file support
	const base64Content = Buffer.isBuffer(content)
		? content.toString('base64')
		: Buffer.from(content, 'utf-8').toString('base64');

	// Decode base64 on remote and write to file
	const remoteCommand = `echo '${base64Content}' | base64 -d > ${escapedPath}`;

	const result = await execRemoteCommand(sshRemote, remoteCommand, deps);

	if (result.exitCode !== 0) {
		const error = result.stderr || `Failed to write file: ${filePath}`;
		return {
			success: false,
			error: error.includes('Permission denied')
				? `Permission denied: ${filePath}`
				: error.includes('No such file')
					? `Parent directory not found: ${filePath}`
					: error,
		};
	}

	return { success: true };
}

/**
 * Check if a path exists on a remote host via SSH.
 *
 * @param remotePath Path to check
 * @param sshRemote SSH remote configuration
 * @param deps Optional dependencies for testing
 * @returns Whether the path exists
 */
export async function existsRemote(
	remotePath: string,
	sshRemote: SshRemoteConfig,
	deps: RemoteFsDeps = defaultDeps
): Promise<RemoteFsResult<boolean>> {
	const escapedPath = shellEscape(remotePath);
	const remoteCommand = `test -e ${escapedPath} && echo "EXISTS" || echo "NOT_EXISTS"`;

	const result = await execRemoteCommand(sshRemote, remoteCommand, deps);

	if (result.exitCode !== 0) {
		return {
			success: false,
			error: result.stderr || 'Failed to check path existence',
		};
	}

	return {
		success: true,
		data: result.stdout.trim() === 'EXISTS',
	};
}

/**
 * Create a directory on a remote host via SSH.
 *
 * @param dirPath Directory path to create
 * @param sshRemote SSH remote configuration
 * @param recursive Whether to create parent directories (mkdir -p)
 * @param deps Optional dependencies for testing
 * @returns Success/failure result
 */
export async function mkdirRemote(
	dirPath: string,
	sshRemote: SshRemoteConfig,
	recursive: boolean = true,
	deps: RemoteFsDeps = defaultDeps
): Promise<RemoteFsResult<void>> {
	const escapedPath = shellEscape(dirPath);
	const mkdirFlag = recursive ? '-p' : '';
	const remoteCommand = `mkdir ${mkdirFlag} ${escapedPath}`;

	const result = await execRemoteCommand(sshRemote, remoteCommand, deps);

	if (result.exitCode !== 0) {
		const error = result.stderr || `Failed to create directory: ${dirPath}`;
		return {
			success: false,
			error: error.includes('Permission denied')
				? `Permission denied: ${dirPath}`
				: error.includes('File exists')
					? `Directory already exists: ${dirPath}`
					: error,
		};
	}

	return { success: true };
}

/**
 * Rename a file or directory on a remote host via SSH.
 *
 * @param oldPath Current path of the file/directory
 * @param newPath New path for the file/directory
 * @param sshRemote SSH remote configuration
 * @param deps Optional dependencies for testing
 * @returns Success/failure result
 */
export async function renameRemote(
	oldPath: string,
	newPath: string,
	sshRemote: SshRemoteConfig,
	deps: RemoteFsDeps = defaultDeps
): Promise<RemoteFsResult<void>> {
	const escapedOldPath = shellEscape(oldPath);
	const escapedNewPath = shellEscape(newPath);
	const remoteCommand = `mv ${escapedOldPath} ${escapedNewPath}`;

	const result = await execRemoteCommand(sshRemote, remoteCommand, deps);

	if (result.exitCode !== 0) {
		const error = result.stderr || `Failed to rename: ${oldPath}`;
		return {
			success: false,
			error: error.includes('Permission denied')
				? `Permission denied: ${oldPath}`
				: error.includes('No such file')
					? `Path not found: ${oldPath}`
					: error,
		};
	}

	return { success: true };
}

/**
 * Delete a file or directory on a remote host via SSH.
 *
 * @param targetPath Path to delete
 * @param sshRemote SSH remote configuration
 * @param recursive Whether to recursively delete directories (default: true)
 * @param deps Optional dependencies for testing
 * @returns Success/failure result
 */
export async function deleteRemote(
	targetPath: string,
	sshRemote: SshRemoteConfig,
	recursive: boolean = true,
	deps: RemoteFsDeps = defaultDeps
): Promise<RemoteFsResult<void>> {
	const escapedPath = shellEscape(targetPath);
	// Use rm -rf for recursive delete (directories), rm -f for files
	// The -f flag prevents errors if file doesn't exist
	const rmFlags = recursive ? '-rf' : '-f';
	const remoteCommand = `rm ${rmFlags} ${escapedPath}`;

	const result = await execRemoteCommand(sshRemote, remoteCommand, deps);

	if (result.exitCode !== 0) {
		const error = result.stderr || `Failed to delete: ${targetPath}`;
		return {
			success: false,
			error: error.includes('Permission denied')
				? `Permission denied: ${targetPath}`
				: error.includes('No such file')
					? `Path not found: ${targetPath}`
					: error,
		};
	}

	return { success: true };
}

/**
 * Count files and folders in a directory on a remote host via SSH.
 *
 * @param dirPath Directory path to count items in
 * @param sshRemote SSH remote configuration
 * @param deps Optional dependencies for testing
 * @returns File and folder counts
 */
export async function countItemsRemote(
	dirPath: string,
	sshRemote: SshRemoteConfig,
	deps: RemoteFsDeps = defaultDeps
): Promise<RemoteFsResult<{ fileCount: number; folderCount: number }>> {
	const escapedPath = shellEscape(dirPath);
	// Use find to count files and directories separately
	// -type f for files, -type d for directories (excluding the root dir itself)
	const remoteCommand = `echo "FILES:$(find ${escapedPath} -type f 2>/dev/null | wc -l)" && echo "DIRS:$(find ${escapedPath} -mindepth 1 -type d 2>/dev/null | wc -l)"`;

	const result = await execRemoteCommand(sshRemote, remoteCommand, deps);

	if (result.exitCode !== 0) {
		const error = result.stderr || `Failed to count items: ${dirPath}`;
		return {
			success: false,
			error: error.includes('Permission denied')
				? `Permission denied: ${dirPath}`
				: error.includes('No such file')
					? `Directory not found: ${dirPath}`
					: error,
		};
	}

	// Parse output like:
	// FILES:123
	// DIRS:45
	const output = result.stdout.trim();
	const filesMatch = output.match(/FILES:\s*(\d+)/);
	const dirsMatch = output.match(/DIRS:\s*(\d+)/);

	const fileCount = filesMatch ? parseInt(filesMatch[1], 10) : 0;
	const folderCount = dirsMatch ? parseInt(dirsMatch[1], 10) : 0;

	return {
		success: true,
		data: { fileCount, folderCount },
	};
}

/**
 * Result of a find-based file tree load from a remote host.
 * Each entry is a relative path with its type indicator.
 */
export interface RemoteFileTreeEntry {
	/** Path relative to the root directory */
	relativePath: string;
	/** Whether this entry is a directory */
	isDirectory: boolean;
}

/**
 * Load complete file tree from a remote host using a single `find` command.
 *
 * This replaces the recursive readDir approach (N SSH calls for N directory levels)
 * with a single SSH round-trip. The `find` command runs entirely on the remote host
 * and returns all paths at once.
 *
 * Output format: One line per entry, prefixed with 'd' for directories or 'f' for files,
 * followed by a tab and the relative path.
 *
 * @param dirPath Root directory to scan
 * @param sshRemote SSH remote configuration
 * @param maxDepth Maximum depth to scan (default: 10)
 * @param ignorePatterns Glob patterns to exclude (e.g., ['node_modules', '__pycache__'])
 * @param deps Optional dependencies for testing
 * @returns Array of file tree entries with relative paths and type information
 */
export async function loadFileTreeRemote(
	dirPath: string,
	sshRemote: SshRemoteConfig,
	maxDepth: number = 10,
	ignorePatterns: string[] = [],
	deps: RemoteFsDeps = defaultDeps
): Promise<RemoteFsResult<RemoteFileTreeEntry[]>> {
	const escapedPath = escapeRemotePath(dirPath);

	// Build -name exclusion predicates for ignore patterns
	// Each pattern becomes: -not -name 'pattern'
	// For directory-only patterns, we also prune them to prevent descending
	const pruneArgs = ignorePatterns
		.map((pattern) => {
			// Escape single quotes in the pattern for shell safety
			const safePattern = pattern.replace(/'/g, "'\\''");
			return `-name '${safePattern}' -prune`;
		})
		.join(' -o ');

	// Build the find command:
	// 1. Use -maxdepth for depth limiting
	// 2. Prune ignored directories (prevents descending into them)
	// 3. Print type indicator (d/f) + tab + relative path
	// 4. Use -mindepth 1 to exclude the root directory itself
	//
	// The printf format uses %y (type: d=directory, f=regular file, l=symlink)
	// and %P (path relative to the starting point)
	//
	// We use a two-pass approach:
	// - First, exclude pruned directories
	// - Then, print remaining entries
	let remoteCommand: string;

	if (pruneArgs) {
		remoteCommand = `find ${escapedPath} -maxdepth ${maxDepth} -mindepth 1 \\( ${pruneArgs} \\) -o -printf '%y\\t%P\\n' 2>/dev/null; true`;
	} else {
		remoteCommand = `find ${escapedPath} -maxdepth ${maxDepth} -mindepth 1 -printf '%y\\t%P\\n' 2>/dev/null; true`;
	}

	const result = await execRemoteCommand(sshRemote, remoteCommand, deps);

	// find with -printf may not be available on all systems (e.g., macOS/BSD)
	// Check if we got valid output; if not, fall back to stat-based find
	if (result.exitCode !== 0 && !result.stdout.trim()) {
		// Fallback: use find with -exec stat (works on macOS/BSD)
		const fallbackCommand = pruneArgs
			? `find ${escapedPath} -maxdepth ${maxDepth} -mindepth 1 \\( ${pruneArgs} \\) -o -exec stat -c '%F	%n' {} + 2>/dev/null | sed "s|^\\(.*\\)\\t${dirPath.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&')}/||" ; true`
			: `cd ${escapedPath} && find . -maxdepth ${maxDepth} -mindepth 1 -exec test -d {} \\; -printf 'd\\t' -print -o -printf 'f\\t' -print 2>/dev/null; true`;

		const fallbackResult = await execRemoteCommand(sshRemote, fallbackCommand, deps);

		if (fallbackResult.exitCode !== 0 && !fallbackResult.stdout.trim()) {
			return {
				success: false,
				error: `Failed to load file tree: ${fallbackResult.stderr || 'find command not available'}`,
			};
		}

		return parseFileTreeOutput(fallbackResult.stdout);
	}

	return parseFileTreeOutput(result.stdout);
}

/**
 * Parse the output of the find-based file tree command.
 * Format: "type\trelativePath\n" where type is 'd' (directory), 'f' (file), or 'l' (symlink).
 */
function parseFileTreeOutput(output: string): RemoteFsResult<RemoteFileTreeEntry[]> {
	const entries: RemoteFileTreeEntry[] = [];
	const lines = output.trim().split('\n').filter(Boolean);

	for (const line of lines) {
		const tabIdx = line.indexOf('\t');
		if (tabIdx === -1) continue;

		const typeChar = line.substring(0, tabIdx);
		const relativePath = line.substring(tabIdx + 1);

		if (!relativePath) continue;

		// Skip entries that start with . in the relative path's last component
		// (these are hidden files - handled by the renderer's showHiddenFiles toggle)

		const isDirectory = typeChar === 'd';
		// Accept files (f) and symlinks (l) as non-directory entries
		// Skip other types (sockets, pipes, etc.)
		if (typeChar !== 'd' && typeChar !== 'f' && typeChar !== 'l') continue;

		entries.push({ relativePath, isDirectory });
	}

	return { success: true, data: entries };
}

/**
 * Result of an incremental file scan showing changes since last check.
 */
export interface IncrementalScanResult {
	/** Files added or modified since the reference time */
	added: string[];
	/** Files deleted since the reference time (requires full paths from previous scan) */
	deleted: string[];
	/** Whether any changes were detected */
	hasChanges: boolean;
	/** Timestamp of this scan (use for next incremental scan) */
	scanTime: number;
}

/**
 * Perform an incremental scan to find files changed since a reference time.
 * Uses `find -newer` with a temporary marker file for efficient delta detection.
 *
 * This is much faster than a full directory walk for large remote filesystems,
 * especially over slow SSH connections. On subsequent refreshes, only files
 * modified since the last scan are returned.
 *
 * Note: This cannot detect deletions directly. For deletion detection, the caller
 * should compare the returned paths against the previous file list.
 *
 * @param dirPath Directory to scan
 * @param sshRemote SSH remote configuration
 * @param sinceTimestamp Unix timestamp (seconds) to find changes after
 * @param deps Optional dependencies for testing
 * @returns List of changed file paths (relative to dirPath)
 */
export async function incrementalScanRemote(
	dirPath: string,
	sshRemote: SshRemoteConfig,
	sinceTimestamp: number,
	deps: RemoteFsDeps = defaultDeps
): Promise<RemoteFsResult<IncrementalScanResult>> {
	const escapedPath = shellEscape(dirPath);
	const scanTime = Math.floor(Date.now() / 1000);

	// Use find with -newermt to find files modified after the given timestamp
	// -newermt accepts a date string in ISO format
	// We exclude common patterns like node_modules and __pycache__
	const isoDate = new Date(sinceTimestamp * 1000).toISOString();
	const remoteCommand = `find ${escapedPath} -newermt "${isoDate}" -type f \\( ! -path "*/node_modules/*" ! -path "*/__pycache__/*" \\) 2>/dev/null || true`;

	const result = await execRemoteCommand(sshRemote, remoteCommand, deps);

	// find returns exit code 0 even with no matches, errors go to stderr
	if (result.exitCode !== 0 && result.stderr) {
		return {
			success: false,
			error: result.stderr,
		};
	}

	// Parse the output - each line is a full path
	const lines = result.stdout.trim().split('\n').filter(Boolean);

	// Convert to paths relative to dirPath
	const added = lines
		.map((line) => {
			// Remove the dirPath prefix to get relative path
			if (line.startsWith(dirPath)) {
				return line.substring(dirPath.length).replace(/^\//, '');
			}
			return line;
		})
		.filter(Boolean);

	return {
		success: true,
		data: {
			added,
			deleted: [], // Caller must detect deletions by comparing with previous state
			hasChanges: added.length > 0,
			scanTime,
		},
	};
}

/**
 * Get all file paths in a directory (for establishing baseline for incremental scans).
 * Uses find to list all files, which is faster than recursive readDir for large trees.
 *
 * @param dirPath Directory to scan
 * @param sshRemote SSH remote configuration
 * @param maxDepth Maximum depth to scan (default: 10)
 * @param deps Optional dependencies for testing
 * @returns List of all file paths (relative to dirPath)
 */
export async function listAllFilesRemote(
	dirPath: string,
	sshRemote: SshRemoteConfig,
	maxDepth: number = 10,
	deps: RemoteFsDeps = defaultDeps
): Promise<RemoteFsResult<string[]>> {
	const escapedPath = shellEscape(dirPath);

	// Use find with -maxdepth to list all files
	// Exclude node_modules and __pycache__
	const remoteCommand = `find ${escapedPath} -maxdepth ${maxDepth} -type f \\( ! -path "*/node_modules/*" ! -path "*/__pycache__/*" \\) 2>/dev/null || true`;

	const result = await execRemoteCommand(sshRemote, remoteCommand, deps);

	if (result.exitCode !== 0 && result.stderr) {
		return {
			success: false,
			error: result.stderr,
		};
	}

	const lines = result.stdout.trim().split('\n').filter(Boolean);

	// Convert to paths relative to dirPath
	const files = lines
		.map((line) => {
			if (line.startsWith(dirPath)) {
				return line.substring(dirPath.length).replace(/^\//, '');
			}
			return line;
		})
		.filter(Boolean);

	return {
		success: true,
		data: files,
	};
}

/**
 * Parse Claude session stats remotely using shell commands.
 *
 * Instead of transferring the entire file, this runs grep/awk on the remote
 * to extract and sum token counts, returning only the aggregated numbers.
 * Works for files of any size since only ~50 bytes are transferred back.
 *
 * @param filePath Path to the session file on the remote host
 * @param sshRemote SSH remote configuration
 * @param deps Optional dependencies for testing
 * @returns Parsed stats or error
 */
export async function parseRemoteClaudeStatsViaShell(
	filePath: string,
	sshRemote: SshRemoteConfig,
	deps: RemoteFsDeps = defaultDeps
): Promise<
	RemoteFsResult<{
		sizeBytes: number;
		messageCount: number;
		inputTokens: number;
		outputTokens: number;
		cacheReadTokens: number;
		cacheCreationTokens: number;
	}>
> {
	const escapedPath = escapeRemotePath(filePath);

	// POSIX-compatible shell script that works on Linux and macOS
	// Each line outputs one number, parsed in order
	// Note: We sum ALL input_tokens matches, then subtract cache tokens in the caller
	// This avoids needing Perl regex negative lookbehind
	const remoteScript = `
FILE=${escapedPath}
# File size (Linux stat vs macOS stat)
stat -c'%s' "$FILE" 2>/dev/null || stat -f'%z' "$FILE"
# Message count (user + assistant)
grep -cE '"type"[[:space:]]*:[[:space:]]*"(user|assistant)"' "$FILE" 2>/dev/null || echo 0
# Total input_tokens (includes cache tokens - we'll subtract later)
grep -oE '"input_tokens"[[:space:]]*:[[:space:]]*[0-9]+' "$FILE" 2>/dev/null | grep -oE '[0-9]+$' | awk '{s+=$1}END{print s+0}'
# Output tokens
grep -oE '"output_tokens"[[:space:]]*:[[:space:]]*[0-9]+' "$FILE" 2>/dev/null | grep -oE '[0-9]+$' | awk '{s+=$1}END{print s+0}'
# Cache read tokens
grep -oE '"cache_read_input_tokens"[[:space:]]*:[[:space:]]*[0-9]+' "$FILE" 2>/dev/null | grep -oE '[0-9]+$' | awk '{s+=$1}END{print s+0}'
# Cache creation tokens
grep -oE '"cache_creation_input_tokens"[[:space:]]*:[[:space:]]*[0-9]+' "$FILE" 2>/dev/null | grep -oE '[0-9]+$' | awk '{s+=$1}END{print s+0}'
`.trim();

	const result = await execRemoteCommand(sshRemote, remoteScript, deps);

	if (result.exitCode !== 0) {
		return {
			success: false,
			error: result.stderr || `Failed to parse remote stats: ${filePath}`,
		};
	}

	// Parse the 6 lines of output
	const lines = result.stdout.trim().split('\n');
	if (lines.length < 6) {
		return {
			success: false,
			error: `Unexpected output format from remote stats parsing: got ${lines.length} lines, expected 6`,
		};
	}

	const sizeBytes = parseInt(lines[0], 10) || 0;
	const messageCount = parseInt(lines[1], 10) || 0;
	const totalInputTokens = parseInt(lines[2], 10) || 0;
	const outputTokens = parseInt(lines[3], 10) || 0;
	const cacheReadTokens = parseInt(lines[4], 10) || 0;
	const cacheCreationTokens = parseInt(lines[5], 10) || 0;

	// input_tokens in Claude JSONL already represents non-cached input only
	// Cache tokens are tracked separately, so no subtraction needed
	const inputTokens = totalInputTokens;

	return {
		success: true,
		data: {
			sizeBytes,
			messageCount,
			inputTokens: Math.max(0, inputTokens), // Ensure non-negative
			outputTokens,
			cacheReadTokens,
			cacheCreationTokens,
		},
	};
}

/**
 * Count user and assistant messages in a Claude session file remotely.
 * Uses grep to count "type": "user" and "type": "assistant" entries.
 *
 * @param filePath Path to the session file on the remote host
 * @param sshRemote SSH remote configuration
 * @param deps Optional dependencies for testing
 * @returns Message count or error
 */
export async function countRemoteClaudeMessages(
	filePath: string,
	sshRemote: SshRemoteConfig,
	deps: RemoteFsDeps = defaultDeps
): Promise<RemoteFsResult<number>> {
	const escapedPath = escapeRemotePath(filePath);

	// Count user and assistant messages via grep
	const remoteScript = `
FILE=${escapedPath}
grep -cE '"type"[[:space:]]*:[[:space:]]*"(user|assistant)"' "$FILE" 2>/dev/null || echo 0
`.trim();

	const result = await execRemoteCommand(sshRemote, remoteScript, deps);

	if (result.exitCode !== 0) {
		return {
			success: false,
			error: result.stderr || `Failed to count messages: ${filePath}`,
		};
	}

	const count = parseInt(result.stdout.trim(), 10) || 0;

	return {
		success: true,
		data: count,
	};
}

/**
 * Batch-compute aggregated subagent stats for a session via a single SSH command.
 * Finds all agent-*.jsonl files in the subagents directory and extracts token counts
 * using remote-side grep/awk, avoiding individual file transfers.
 *
 * @param subagentsDir Path to the subagents directory (e.g., '~/.claude/projects/enc/sessId/subagents')
 * @param sshRemote SSH remote configuration
 * @param deps Optional dependencies for testing
 * @returns Aggregated stats from all subagent files, or null if no subagents exist
 */
export interface BatchSubagentStats {
	subagentCount: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheCreationTokens: number;
	messageCount: number;
}

export async function batchSubagentStatsRemote(
	subagentsDir: string,
	sshRemote: SshRemoteConfig,
	deps: RemoteFsDeps = defaultDeps
): Promise<RemoteFsResult<BatchSubagentStats | null>> {
	const escapedPath = escapeRemotePath(subagentsDir);

	// Single command that:
	// 1. Checks if the directory exists and has agent-*.jsonl files
	// 2. Counts the number of subagent files
	// 3. Extracts all token stats across all files using grep/awk
	// 4. Counts user+assistant messages across all files
	const remoteScript = `
DIR=${escapedPath}
if [ ! -d "$DIR" ]; then echo "NO_DIR"; exit 0; fi
FILES=$(ls "$DIR"/agent-*.jsonl 2>/dev/null)
if [ -z "$FILES" ]; then echo "NO_FILES"; exit 0; fi
COUNT=$(echo "$FILES" | wc -l | tr -d ' ')
echo "COUNT:$COUNT"
# Input tokens (exclude cache variants using grep -v to filter lines)
grep -ohE '"input_tokens"[[:space:]]*:[[:space:]]*[0-9]+' $FILES 2>/dev/null | grep -v cache | grep -oE '[0-9]+$' | awk '{s+=$1}END{print "INPUT:"s+0}'
# Output tokens
grep -ohE '"output_tokens"[[:space:]]*:[[:space:]]*[0-9]+' $FILES 2>/dev/null | grep -oE '[0-9]+$' | awk '{s+=$1}END{print "OUTPUT:"s+0}'
# Cache read tokens
grep -ohE '"cache_read_input_tokens"[[:space:]]*:[[:space:]]*[0-9]+' $FILES 2>/dev/null | grep -oE '[0-9]+$' | awk '{s+=$1}END{print "CACHE_READ:"s+0}'
# Cache creation tokens
grep -ohE '"cache_creation_input_tokens"[[:space:]]*:[[:space:]]*[0-9]+' $FILES 2>/dev/null | grep -oE '[0-9]+$' | awk '{s+=$1}END{print "CACHE_CREATE:"s+0}'
# Message count (user + assistant)
grep -chE '"type"[[:space:]]*:[[:space:]]*"(user|assistant)"' $FILES 2>/dev/null | awk '{s+=$1}END{print "MESSAGES:"s+0}'
`.trim();

	const result = await execRemoteCommand(sshRemote, remoteScript, deps);

	const stdout = result.stdout.trim();

	// Handle no-subagents cases
	if (stdout === 'NO_DIR' || stdout === 'NO_FILES') {
		return { success: true, data: null };
	}

	if (result.exitCode !== 0 && !stdout) {
		return {
			success: false,
			error: result.stderr || 'Failed to compute subagent stats',
		};
	}

	// Parse structured output
	const lines = stdout.split('\n');
	let subagentCount = 0;
	let inputTokens = 0;
	let outputTokens = 0;
	let cacheReadTokens = 0;
	let cacheCreationTokens = 0;
	let messageCount = 0;

	for (const line of lines) {
		const [key, value] = line.split(':');
		const num = parseInt(value, 10) || 0;
		switch (key) {
			case 'COUNT':
				subagentCount = num;
				break;
			case 'INPUT':
				inputTokens = num;
				break;
			case 'OUTPUT':
				outputTokens = num;
				break;
			case 'CACHE_READ':
				cacheReadTokens = num;
				break;
			case 'CACHE_CREATE':
				cacheCreationTokens = num;
				break;
			case 'MESSAGES':
				messageCount = num;
				break;
		}
	}

	return {
		success: true,
		data: {
			subagentCount,
			inputTokens,
			outputTokens,
			cacheReadTokens,
			cacheCreationTokens,
			messageCount,
		},
	};
}

/**
 * Structured content returned for each file from batch parse.
 */
export interface BatchParsedFileContent {
	head: string;
	tail: string;
	totalLines: number;
}

/**
 * Lightweight preview data extracted from a remote session file.
 * Contains only what's needed for the session list display.
 * Token counts and cost are NOT included — they are loaded on demand.
 */
export interface BatchSessionPreview {
	/** First ~200 chars of the first user or assistant message text */
	firstMessage: string;
	/** ISO timestamp from the first entry in the file */
	firstTimestamp: string;
	/** ISO timestamp from the last entry in the file */
	lastTimestamp: string;
	/** Total number of lines in the file */
	totalLines: number;
}

/**
 * Batch-extract lightweight preview data from remote session files.
 * Instead of transferring raw JSONL lines (which can be enormous),
 * this runs a remote awk script that extracts ONLY:
 * - The text content of the first user/assistant message (truncated to ~200 chars)
 * - The timestamp from the first entry
 * - The timestamp from the last entry
 * - The total line count
 *
 * Output per file is ~300 bytes max, making buffer overflow impossible
 * even for 1000+ sessions.
 *
 * @param filePaths Array of full remote paths to .jsonl files
 * @param sshRemote SSH remote configuration
 * @param deps Optional dependencies for testing
 * @returns Map of filePath -> preview data
 */
export async function batchExtractSessionPreviewsRemote(
	filePaths: string[],
	sshRemote: SshRemoteConfig,
	deps: RemoteFsDeps = defaultDeps
): Promise<RemoteFsResult<Map<string, BatchSessionPreview>>> {
	if (filePaths.length === 0) {
		return { success: true, data: new Map() };
	}

	const CHUNK_SIZE = 100; // Safe to chunk larger since output is tiny per file
	const allResults = new Map<string, BatchSessionPreview>();

	for (let i = 0; i < filePaths.length; i += CHUNK_SIZE) {
		const chunk = filePaths.slice(i, i + CHUNK_SIZE);
		const fileListStr = chunk.map((p) => `'${p.replace(/'/g, "'\\''")}'`).join(' ');

		// Remote script that extracts minimal preview data per file:
		// 1. wc -l for total line count
		// 2. First timestamp from first line with a "timestamp" field
		// 3. Last timestamp from last line with a "timestamp" field
		// 4. First message text from first user/assistant entry (truncated)
		//
		// Uses grep + head/tail + sed to extract just the needed fields
		// without transferring full JSONL lines.
		const remoteScript = `
for f in ${fileListStr}; do
  if [ -f "$f" ]; then
    TOTAL=$(wc -l < "$f" 2>/dev/null | tr -d ' ')
    # Extract first timestamp (from first 5 lines)
    FIRST_TS=$(head -n 5 "$f" 2>/dev/null | grep -o '"timestamp":"[^"]*"' | head -1 | sed 's/"timestamp":"//;s/"//')
    # Extract last timestamp (from last 5 lines)
    LAST_TS=$(tail -n 5 "$f" 2>/dev/null | grep -o '"timestamp":"[^"]*"' | tail -1 | sed 's/"timestamp":"//;s/"//')
    # Extract first message text, preferring assistant over user (first 20 lines, truncated to 200 chars)
    # User messages often contain system prompts, so assistant responses make better previews
    # Try assistant first (preferred)
    FIRST_MSG=$(head -n 20 "$f" 2>/dev/null | grep -m 1 '"type":"assistant"' | grep -o '"text":"[^"]*"' | head -1 | sed 's/"text":"//;s/"$//' | cut -c1-200)
    # Fallback: assistant with "content":"..." format
    if [ -z "$FIRST_MSG" ]; then
      FIRST_MSG=$(head -n 20 "$f" 2>/dev/null | grep -m 1 '"type":"assistant"' | grep -o '"content":"[^"]*"' | head -1 | sed 's/"content":"//;s/"$//' | cut -c1-200)
    fi
    # Fallback: user message with "text":"..." format
    if [ -z "$FIRST_MSG" ]; then
      FIRST_MSG=$(head -n 20 "$f" 2>/dev/null | grep -m 1 '"type":"user"' | grep -o '"text":"[^"]*"' | head -1 | sed 's/"text":"//;s/"$//' | cut -c1-200)
    fi
    # Fallback: user message with "content":"..." format
    if [ -z "$FIRST_MSG" ]; then
      FIRST_MSG=$(head -n 20 "$f" 2>/dev/null | grep -m 1 '"type":"user"' | grep -o '"content":"[^"]*"' | head -1 | sed 's/"content":"//;s/"$//' | cut -c1-200)
    fi
    echo "===PREVIEW:$f==="
    echo "LINES:$TOTAL"
    echo "FIRST_TS:$FIRST_TS"
    echo "LAST_TS:$LAST_TS"
    echo "MSG:$FIRST_MSG"
    echo "===END_PREVIEW==="
  fi
done
`.trim();

		const result = await execRemoteCommand(sshRemote, remoteScript, deps);

		if (result.exitCode !== 0 && !result.stdout.trim()) {
			// If this chunk failed, continue with other chunks
			continue;
		}

		// Parse structured output
		const output = result.stdout;
		const previewRegex = /===PREVIEW:(.+?)===([\s\S]*?)===END_PREVIEW===/g;
		let match;

		while ((match = previewRegex.exec(output)) !== null) {
			const filePath = match[1];
			const block = match[2];

			const linesMatch = block.match(/LINES:(\d*)/);
			const firstTsMatch = block.match(/FIRST_TS:(.*)/);
			const lastTsMatch = block.match(/LAST_TS:(.*)/);
			const msgMatch = block.match(/MSG:(.*)/);

			allResults.set(filePath, {
				firstMessage: (msgMatch?.[1] || '').trim(),
				firstTimestamp: (firstTsMatch?.[1] || '').trim(),
				lastTimestamp: (lastTsMatch?.[1] || '').trim(),
				totalLines: parseInt(linesMatch?.[1] || '0', 10) || 0,
			});
		}
	}

	return {
		success: true,
		data: allResults,
	};
}

/**
 * Batch-read head and tail lines from multiple session files in a single SSH command.
 * Returns structured output with head (first N lines) and tail (last M lines) for each file.
 *
 * @param filePaths Array of remote file paths to read
 * @param sshRemote SSH remote configuration
 * @param headLines Number of lines to read from the start of each file (default: 20)
 * @param tailLines Number of lines to read from the end of each file (default: 10)
 * @param deps Optional dependencies for testing
 * @returns Map of filePath -> { head, tail, totalLines }
 */
export async function batchParseSessionFilesRemote(
	filePaths: string[],
	sshRemote: SshRemoteConfig,
	headLines: number = 20,
	tailLines: number = 10,
	deps: RemoteFsDeps = defaultDeps
): Promise<RemoteFsResult<Map<string, BatchParsedFileContent>>> {
	if (filePaths.length === 0) {
		return { success: true, data: new Map() };
	}

	// Build file list for the remote script, properly escaped
	// Batch in chunks to avoid ARG_MAX limits (~128KB on most systems)
	const CHUNK_SIZE = 50;
	const allResults = new Map<string, BatchParsedFileContent>();

	for (let i = 0; i < filePaths.length; i += CHUNK_SIZE) {
		const chunk = filePaths.slice(i, i + CHUNK_SIZE);
		const fileListStr = chunk.map((p) => `'${p.replace(/'/g, "'\\''")}'`).join(' ');

		const remoteScript = `
for f in ${fileListStr}; do
  if [ -f "$f" ]; then
    TOTAL=$(wc -l < "$f" 2>/dev/null | tr -d ' ')
    echo "===FILE:$f:$TOTAL==="
    head -n ${headLines} "$f" 2>/dev/null
    echo "===TAIL==="
    tail -n ${tailLines} "$f" 2>/dev/null
    echo "===END==="
  fi
done
`.trim();

		const result = await execRemoteCommand(sshRemote, remoteScript, deps);

		if (result.exitCode !== 0 && !result.stdout.trim()) {
			// If this chunk failed, continue with other chunks
			continue;
		}

		// Parse structured output
		const output = result.stdout;
		const fileRegex = /===FILE:(.+?):(\d+)===([\s\S]*?)===TAIL===([\s\S]*?)===END===/g;
		let match;

		while ((match = fileRegex.exec(output)) !== null) {
			const filePath = match[1];
			const totalLines = parseInt(match[2], 10) || 0;
			const head = match[3].trim();
			const tail = match[4].trim();

			allResults.set(filePath, { head, tail, totalLines });
		}
	}

	return {
		success: true,
		data: allResults,
	};
}

/**
 * Batch-discover all session JSONL files across all project directories on a remote host.
 * Replaces N+1 individual readDirRemote + statRemote calls with a single SSH command.
 *
 * Uses `find` to locate all .jsonl files (excluding subagent files) and outputs
 * their modification time (epoch seconds), size (bytes), and full path.
 *
 * @param projectsDir Base projects directory (e.g., '~/.claude/projects')
 * @param sshRemote SSH remote configuration
 * @param deps Optional dependencies for testing
 * @returns Array of discovered session files with metadata, sorted by mtime descending
 */
export interface BatchDiscoveredFile {
	/** Full remote path to the file */
	filePath: string;
	/** Modification time as Unix timestamp in milliseconds */
	mtime: number;
	/** File size in bytes */
	size: number;
	/** The project directory name (encoded project path) */
	projectDirName: string;
	/** The session filename (e.g., 'uuid.jsonl') */
	filename: string;
}

export async function batchDiscoverSessionFilesRemote(
	projectsDir: string,
	sshRemote: SshRemoteConfig,
	deps: RemoteFsDeps = defaultDeps
): Promise<RemoteFsResult<BatchDiscoveredFile[]>> {
	const escapedPath = escapeRemotePath(projectsDir);

	// Single find command that:
	// 1. Searches for .jsonl files directly under project directories (maxdepth 2 from projects/)
	// 2. Excludes subagent directories (not -path "*/subagents/*")
	// 3. Outputs epoch mtime, size in bytes, and full path
	// 4. Uses -printf for precise formatting (no locale issues)
	// 5. Falls back to stat-based approach if -printf is not available (macOS)
	const remoteScript = `
if find ${escapedPath} -maxdepth 2 -name '*.jsonl' -not -path '*/subagents/*' -printf '%T@ %s %p\\n' 2>/dev/null | head -1 | grep -q '^[0-9]'; then
  find ${escapedPath} -maxdepth 2 -name '*.jsonl' -not -path '*/subagents/*' -printf '%T@ %s %p\\n' 2>/dev/null | sort -rn
else
  find ${escapedPath} -maxdepth 2 -name '*.jsonl' -not -path '*/subagents/*' -exec stat -c '%Y %s %n' {} + 2>/dev/null | sort -rn
fi
`.trim();

	const result = await execRemoteCommand(sshRemote, remoteScript, deps);

	if (result.exitCode !== 0 && !result.stdout.trim()) {
		return {
			success: false,
			error: result.stderr || 'Failed to discover session files on remote',
		};
	}

	const files: BatchDiscoveredFile[] = [];
	const lines = result.stdout.trim().split('\n').filter(Boolean);

	for (const line of lines) {
		// Format: "1709312345.1234567890 12345 /home/user/.claude/projects/encoded-path/session-id.jsonl"
		// or:     "1709312345 12345 /path/to/file.jsonl" (stat -c format)
		const match = line.match(/^(\d+(?:\.\d+)?)\s+(\d+)\s+(.+)$/);
		if (!match) continue;

		const mtime = Math.floor(parseFloat(match[1]) * 1000); // Convert epoch seconds to ms
		const size = parseInt(match[2], 10);
		const filePath = match[3];

		// Skip empty files
		if (size === 0) continue;

		// Extract project dir name and filename from the path
		// Path format: <projectsDir>/<encodedProjectPath>/<sessionId>.jsonl
		// We need the segment after projectsDir and before the filename
		const pathAfterProjects = filePath.substring(
			filePath.indexOf('/.claude/projects/') + '/.claude/projects/'.length
		);
		const segments = pathAfterProjects.split('/');
		if (segments.length < 2) continue; // Need at least projectDir/filename

		const projectDirName = segments[0];
		const filename = segments[segments.length - 1];

		if (!filename.endsWith('.jsonl')) continue;

		files.push({
			filePath,
			mtime,
			size,
			projectDirName,
			filename,
		});
	}

	return {
		success: true,
		data: files,
	};
}

/**
 * Search session files on a remote host using remote-side grep.
 * First finds matching files, then extracts match context.
 *
 * @param projectDir The encoded project directory on the remote
 * @param query The search query string
 * @param sshRemote SSH remote configuration
 * @param deps Optional dependencies for testing
 * @returns Array of matching file paths with match previews
 */
export interface RemoteSearchMatch {
	/** Full path to the matching file */
	filePath: string;
	/** The filename (e.g., 'session-id.jsonl') */
	filename: string;
	/** Preview context around the first match */
	matchPreview: string;
	/** Whether a user message matched */
	hasUserMatch: boolean;
	/** Whether an assistant message matched */
	hasAssistantMatch: boolean;
	/** Count of user message matches */
	userMatchCount: number;
	/** Count of assistant message matches */
	assistantMatchCount: number;
}

export async function searchSessionFilesRemote(
	projectDir: string,
	query: string,
	sshRemote: SshRemoteConfig,
	deps: RemoteFsDeps = defaultDeps
): Promise<RemoteFsResult<RemoteSearchMatch[]>> {
	const escapedPath = escapeRemotePath(projectDir);
	// Escape the query for use in grep (escape special regex chars)
	const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	// Also escape single quotes for the shell
	const shellQuery = safeQuery.replace(/'/g, "'\\''");

	// Phase 1: Find files that contain the query string (case-insensitive)
	// Only search .jsonl files, exclude subagent directories
	const findScript = `
grep -rli '${shellQuery}' ${escapedPath}/*.jsonl 2>/dev/null || true
`.trim();

	const findResult = await execRemoteCommand(sshRemote, findScript, deps);

	if (findResult.exitCode !== 0 && !findResult.stdout.trim()) {
		return { success: true, data: [] };
	}

	const matchingFiles = findResult.stdout.trim().split('\n').filter(Boolean);
	if (matchingFiles.length === 0) {
		return { success: true, data: [] };
	}

	// Phase 2: For each matching file, get match details
	// Count user vs assistant matches and extract a preview
	const fileListStr = matchingFiles.map((p) => `'${p.replace(/'/g, "'\\''")}'`).join(' ');

	const detailScript = `
for f in ${fileListStr}; do
  FN=$(basename "$f")
  # Count matches in user messages
  UC=$(grep -ci '"type"[[:space:]]*:[[:space:]]*"user"' "$f" 2>/dev/null | head -1)
  AC=$(grep -ci '"type"[[:space:]]*:[[:space:]]*"assistant"' "$f" 2>/dev/null | head -1)
  # Get the first matching line containing the query for preview
  PREVIEW=$(grep -im1 '${shellQuery}' "$f" 2>/dev/null | head -c 200)
  echo "===MATCH:$f:$FN:$UC:$AC==="
  echo "$PREVIEW"
  echo "===END==="
done
`.trim();

	const detailResult = await execRemoteCommand(sshRemote, detailScript, deps);

	const matches: RemoteSearchMatch[] = [];
	const matchRegex = /===MATCH:(.+?):(.+?):(\d+):(\d+)===([\s\S]*?)===END===/g;
	let match;

	while ((match = matchRegex.exec(detailResult.stdout)) !== null) {
		const filePath = match[1];
		const filename = match[2];
		const userLineCount = parseInt(match[3], 10) || 0;
		const assistantLineCount = parseInt(match[4], 10) || 0;
		const previewLine = match[5].trim();

		// Extract a meaningful preview from the matching line
		let matchPreview = '';
		if (previewLine) {
			// Try to extract text content from the JSON line
			try {
				const entry = JSON.parse(previewLine);
				let textContent = '';
				if (entry.message?.content) {
					if (typeof entry.message.content === 'string') {
						textContent = entry.message.content;
					} else if (Array.isArray(entry.message.content)) {
						textContent = entry.message.content
							.filter((b: { type?: string }) => b.type === 'text')
							.map((b: { text?: string }) => b.text || '')
							.join(' ');
					}
				}
				if (textContent) {
					const lowerText = textContent.toLowerCase();
					const lowerQuery = query.toLowerCase();
					const idx = lowerText.indexOf(lowerQuery);
					if (idx >= 0) {
						const start = Math.max(0, idx - 60);
						const end = Math.min(textContent.length, idx + query.length + 60);
						matchPreview =
							(start > 0 ? '...' : '') +
							textContent.slice(start, end) +
							(end < textContent.length ? '...' : '');
					} else {
						matchPreview = textContent.slice(0, 120);
					}
				}
			} catch {
				// If JSON parsing fails, use raw preview
				matchPreview = previewLine.slice(0, 120);
			}
		}

		matches.push({
			filePath,
			filename,
			matchPreview,
			hasUserMatch: userLineCount > 0,
			hasAssistantMatch: assistantLineCount > 0,
			userMatchCount: userLineCount,
			assistantMatchCount: assistantLineCount,
		});
	}

	return { success: true, data: matches };
}
