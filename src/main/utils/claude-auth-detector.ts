/**
 * Claude Authentication Detection Utility
 *
 * Detects Claude authentication type from credentials files to determine
 * billing mode (OAuth for Max subscribers vs API key for standard billing).
 *
 * Supports both local and SSH remote detection.
 *
 * @module claude-auth-detector
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { logger } from './logger';
import type { SshRemoteConfig } from '../../shared/types';

const LOG_CONTEXT = '[ClaudeAuthDetector]';

/**
 * Claude credentials file structure
 */
export interface ClaudeCredentials {
	claudeAiOauth?: {
		accessToken: string;
		refreshToken?: string;
		expiresAt?: number;
		scopes?: string[];
		subscriptionType?: 'max' | 'pro' | 'free';
		rateLimitTier?: string;
	};
	apiKey?: string;
}

/**
 * Detected authentication information
 */
export interface DetectedAuth {
	/** Billing mode: 'max' for Max subscribers (cache tokens free), 'api' for standard billing */
	billingMode: 'max' | 'api';
	/** Subscription type from OAuth credentials */
	subscriptionType?: 'max' | 'pro' | 'free';
	/** Rate limit tier from OAuth credentials */
	rateLimitTier?: string;
	/** Source of the detection */
	source: 'oauth' | 'api_key' | 'default';
	/** Timestamp when detection was performed */
	detectedAt: number;
}

/**
 * Get the path to the local Claude credentials file.
 *
 * @returns The full path to ~/.claude/.credentials.json
 *
 * @example
 * ```typescript
 * const path = getLocalClaudeCredentialsPath();
 * // Returns: '/home/user/.claude/.credentials.json' (Linux)
 * // Returns: '/Users/user/.claude/.credentials.json' (macOS)
 * // Returns: 'C:\\Users\\user\\.claude\\.credentials.json' (Windows)
 * ```
 */
export function getLocalClaudeCredentialsPath(): string {
	return join(homedir(), '.claude', '.credentials.json');
}

/**
 * Parse credentials file content safely.
 *
 * @param content - The raw file content to parse
 * @returns Parsed credentials or null if parsing fails
 *
 * @example
 * ```typescript
 * const creds = parseCredentialsFile('{"claudeAiOauth": {...}}');
 * if (creds) {
 *   console.log(creds.claudeAiOauth?.subscriptionType);
 * }
 * ```
 */
export function parseCredentialsFile(content: string): ClaudeCredentials | null {
	try {
		const parsed = JSON.parse(content);

		// Validate the structure has expected shape (must be an object, not array or null)
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
			logger.debug(`${LOG_CONTEXT} Parsed credentials is not a valid object`, LOG_CONTEXT);
			return null;
		}

		// Return the parsed object - TypeScript will handle type safety
		return parsed as ClaudeCredentials;
	} catch (error) {
		logger.debug(
			`${LOG_CONTEXT} Failed to parse credentials file: ${error instanceof Error ? error.message : String(error)}`,
			LOG_CONTEXT
		);
		return null;
	}
}

/**
 * Detect authentication type from parsed credentials.
 *
 * Logic:
 * 1. If OAuth credentials with subscriptionType === 'max', return billingMode: 'max'
 * 2. If API key present, return billingMode: 'api'
 * 3. Default to billingMode: 'api' with source: 'default'
 *
 * @param creds - Parsed credentials object
 * @returns Detected authentication information
 *
 * @example
 * ```typescript
 * // Max subscriber
 * const maxAuth = detectAuthFromCredentials({
 *   claudeAiOauth: { accessToken: '...', subscriptionType: 'max' }
 * });
 * // { billingMode: 'max', source: 'oauth', ... }
 *
 * // API key user
 * const apiAuth = detectAuthFromCredentials({
 *   apiKey: 'sk-...'
 * });
 * // { billingMode: 'api', source: 'api_key', ... }
 * ```
 */
export function detectAuthFromCredentials(creds: ClaudeCredentials): DetectedAuth {
	const now = Date.now();

	// Check for Max OAuth subscription first
	if (creds.claudeAiOauth?.subscriptionType === 'max') {
		logger.debug(`${LOG_CONTEXT} Detected Max subscription via OAuth`, LOG_CONTEXT);
		return {
			billingMode: 'max',
			subscriptionType: 'max',
			rateLimitTier: creds.claudeAiOauth.rateLimitTier,
			source: 'oauth',
			detectedAt: now,
		};
	}

	// Check for other OAuth subscriptions (pro, free) - these still use API billing
	if (creds.claudeAiOauth) {
		logger.debug(
			`${LOG_CONTEXT} Detected OAuth with subscriptionType: ${creds.claudeAiOauth.subscriptionType || 'unknown'}`,
			LOG_CONTEXT
		);
		return {
			billingMode: 'api',
			subscriptionType: creds.claudeAiOauth.subscriptionType,
			rateLimitTier: creds.claudeAiOauth.rateLimitTier,
			source: 'oauth',
			detectedAt: now,
		};
	}

	// Check for API key
	if (creds.apiKey) {
		logger.debug(`${LOG_CONTEXT} Detected API key authentication`, LOG_CONTEXT);
		return {
			billingMode: 'api',
			source: 'api_key',
			detectedAt: now,
		};
	}

	// Default fallback
	logger.debug(`${LOG_CONTEXT} No credentials found, using default`, LOG_CONTEXT);
	return {
		billingMode: 'api',
		source: 'default',
		detectedAt: now,
	};
}

/**
 * Detect Claude authentication from the local credentials file.
 *
 * This is the main entry point for local authentication detection.
 * It reads the credentials file, parses it, and determines the billing mode.
 *
 * @returns Promise resolving to detected authentication information
 *
 * @example
 * ```typescript
 * const auth = await detectLocalAuth();
 * if (auth.billingMode === 'max') {
 *   console.log('Using Max billing - cache tokens are free!');
 * }
 * ```
 */
export async function detectLocalAuth(): Promise<DetectedAuth> {
	const credentialsPath = getLocalClaudeCredentialsPath();
	const now = Date.now();

	try {
		const content = await fs.readFile(credentialsPath, 'utf-8');
		const creds = parseCredentialsFile(content);

		if (!creds) {
			logger.info(`${LOG_CONTEXT} Credentials file found but could not be parsed`, LOG_CONTEXT);
			return {
				billingMode: 'api',
				source: 'default',
				detectedAt: now,
			};
		}

		return detectAuthFromCredentials(creds);
	} catch (error) {
		// Handle file not found gracefully
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			logger.debug(`${LOG_CONTEXT} Credentials file not found at ${credentialsPath}`, LOG_CONTEXT);
		} else {
			logger.warn(
				`${LOG_CONTEXT} Error reading credentials file: ${error instanceof Error ? error.message : String(error)}`,
				LOG_CONTEXT
			);
		}

		return {
			billingMode: 'api',
			source: 'default',
			detectedAt: now,
		};
	}
}

// ============================================================================
// SSH Remote Auth Detection
// ============================================================================

/**
 * Execute a command on a remote SSH host.
 *
 * Uses BatchMode=yes to prevent password prompts (requires key-based auth)
 * and ConnectTimeout=5 to fail fast if the host is unreachable.
 *
 * @param remote SSH remote configuration
 * @param command The command to execute on the remote host
 * @returns Promise resolving to stdout content or null on failure
 *
 * @example
 * ```typescript
 * const content = await executeRemoteCommand(remote, 'cat ~/.claude/.credentials.json');
 * if (content) {
 *   const creds = parseCredentialsFile(content);
 * }
 * ```
 */
async function executeRemoteCommand(
	remote: SshRemoteConfig,
	command: string
): Promise<string | null> {
	return new Promise((resolve) => {
		const args: string[] = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5'];

		// Add port if non-standard
		if (remote.port && remote.port !== 22) {
			args.push('-p', String(remote.port));
		}

		// Build destination string based on SSH config mode
		if (remote.useSshConfig) {
			// When using SSH config, just pass the Host pattern
			// Optionally override with username if provided
			if (remote.username && remote.username.trim()) {
				args.push(`${remote.username}@${remote.host}`);
			} else {
				args.push(remote.host);
			}
		} else {
			// Direct connection: username@host
			args.push(`${remote.username}@${remote.host}`);
		}

		// Add the command to execute
		args.push(command);

		logger.debug(`${LOG_CONTEXT} Executing remote command: ssh ${args.join(' ')}`, LOG_CONTEXT);

		const proc = spawn('ssh', args);
		let stdout = '';
		let stderr = '';

		proc.stdout.on('data', (data: Buffer) => {
			stdout += data.toString();
		});

		proc.stderr.on('data', (data: Buffer) => {
			stderr += data.toString();
		});

		proc.on('close', (code: number | null) => {
			if (code === 0) {
				const result = stdout.trim();
				resolve(result || null);
			} else {
				logger.debug(`${LOG_CONTEXT} SSH command failed with code ${code}: ${stderr}`, LOG_CONTEXT);
				resolve(null);
			}
		});

		proc.on('error', (err: Error) => {
			logger.error(`${LOG_CONTEXT} SSH spawn error: ${err.message}`, LOG_CONTEXT);
			resolve(null);
		});
	});
}

/**
 * Detect Claude authentication from a remote SSH host's credentials file.
 *
 * Reads ~/.claude/.credentials.json from the remote host via SSH.
 * Falls back to 'api' billing mode with 'default' source on any failure.
 *
 * @param sshRemote SSH remote configuration
 * @returns Promise resolving to detected authentication information
 *
 * @example
 * ```typescript
 * const sshRemote = { id: 'dev-server', host: '192.168.1.100', ... };
 * const auth = await detectRemoteAuth(sshRemote);
 * if (auth.billingMode === 'max') {
 *   console.log('Remote has Max subscription - cache tokens free!');
 * }
 * ```
 */
export async function detectRemoteAuth(sshRemote: SshRemoteConfig): Promise<DetectedAuth> {
	const now = Date.now();

	try {
		// Execute SSH command to read credentials
		// 2>/dev/null suppresses "file not found" errors
		const credentialsContent = await executeRemoteCommand(
			sshRemote,
			'cat ~/.claude/.credentials.json 2>/dev/null'
		);

		if (!credentialsContent) {
			logger.debug(`${LOG_CONTEXT} No credentials found on remote ${sshRemote.host}`, LOG_CONTEXT);
			return { billingMode: 'api', source: 'default', detectedAt: now };
		}

		const credentials = parseCredentialsFile(credentialsContent);
		if (!credentials) {
			logger.debug(
				`${LOG_CONTEXT} Failed to parse credentials from remote ${sshRemote.host}`,
				LOG_CONTEXT
			);
			return { billingMode: 'api', source: 'default', detectedAt: now };
		}

		const auth = detectAuthFromCredentials(credentials);
		logger.info(
			`${LOG_CONTEXT} Detected ${auth.billingMode} billing mode from remote ${sshRemote.host}`,
			LOG_CONTEXT
		);
		return auth;
	} catch (error) {
		logger.warn(
			`${LOG_CONTEXT} Failed to detect remote auth for ${sshRemote.host}: ${error instanceof Error ? error.message : String(error)}`,
			LOG_CONTEXT
		);
		return { billingMode: 'api', source: 'default', detectedAt: now };
	}
}

// ============================================================================
// Remote Auth Cache
// ============================================================================

/**
 * Cached remote authentication result
 */
interface CachedRemoteAuth {
	auth: DetectedAuth;
	cachedAt: number;
}

/**
 * Cache for remote authentication results, keyed by SSH remote ID.
 * Avoids repeated SSH operations for the same remote.
 */
const remoteAuthCache = new Map<string, CachedRemoteAuth>();

/** Cache TTL: 30 minutes */
const REMOTE_AUTH_CACHE_TTL = 30 * 60 * 1000;

/**
 * Detect Claude authentication from a remote SSH host with caching.
 *
 * Returns cached result if available and not expired (30 minute TTL).
 * Otherwise executes SSH detection and caches the result.
 *
 * @param sshRemoteId The SSH remote ID (for cache lookup)
 * @param sshRemote SSH remote configuration
 * @returns Promise resolving to detected authentication information
 *
 * @example
 * ```typescript
 * // First call executes SSH
 * const auth1 = await detectRemoteAuthCached('dev-server', sshRemote);
 *
 * // Subsequent calls (within 30 min) return cached result
 * const auth2 = await detectRemoteAuthCached('dev-server', sshRemote);
 * ```
 */
export async function detectRemoteAuthCached(
	sshRemoteId: string,
	sshRemote: SshRemoteConfig
): Promise<DetectedAuth> {
	const cached = remoteAuthCache.get(sshRemoteId);
	if (cached && Date.now() - cached.cachedAt < REMOTE_AUTH_CACHE_TTL) {
		logger.debug(`${LOG_CONTEXT} Using cached auth for remote ${sshRemoteId}`, LOG_CONTEXT);
		return cached.auth;
	}

	const auth = await detectRemoteAuth(sshRemote);
	remoteAuthCache.set(sshRemoteId, { auth, cachedAt: Date.now() });
	return auth;
}

/**
 * Invalidate cached remote authentication.
 *
 * @param sshRemoteId Optional SSH remote ID. If provided, only that remote's
 *                    cache is cleared. If not provided, all cached results are cleared.
 *
 * @example
 * ```typescript
 * // Invalidate specific remote
 * invalidateRemoteAuthCache('dev-server');
 *
 * // Invalidate all remotes
 * invalidateRemoteAuthCache();
 * ```
 */
export function invalidateRemoteAuthCache(sshRemoteId?: string): void {
	if (sshRemoteId) {
		remoteAuthCache.delete(sshRemoteId);
		logger.debug(`${LOG_CONTEXT} Invalidated auth cache for remote ${sshRemoteId}`, LOG_CONTEXT);
	} else {
		remoteAuthCache.clear();
		logger.debug(`${LOG_CONTEXT} Invalidated all remote auth cache`, LOG_CONTEXT);
	}
}
