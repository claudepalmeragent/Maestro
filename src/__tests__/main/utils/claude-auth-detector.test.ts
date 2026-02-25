/**
 * Tests for Claude Authentication Detection Utility
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { homedir } from 'os';
import { join } from 'path';

// Create mock functions using vi.hoisted (allows access in vi.mock factories)
const { mockReadFile, mockSpawn } = vi.hoisted(() => ({
	mockReadFile: vi.fn(),
	mockSpawn: vi.fn(),
}));

// Mock fs module with promises
vi.mock('fs', () => ({
	default: {
		promises: {
			readFile: mockReadFile,
		},
	},
	promises: {
		readFile: mockReadFile,
	},
}));

// Mock child_process for SSH spawn testing
vi.mock('child_process', () => ({
	default: { spawn: mockSpawn },
	spawn: mockSpawn,
}));

// Mock logger to avoid console output in tests
vi.mock('../../../main/utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import {
	getLocalClaudeCredentialsPath,
	parseCredentialsFile,
	detectAuthFromCredentials,
	detectLocalAuth,
	detectRemoteAuth,
	invalidateRemoteAuthCache,
	type ClaudeCredentials,
} from '../../../main/utils/claude-auth-detector';
import { COMMAND_SSH_OPTIONS } from '../../../main/utils/ssh-options';
import { EventEmitter } from 'events';

describe('claude-auth-detector', () => {
	describe('getLocalClaudeCredentialsPath', () => {
		it('should return the correct credentials path', () => {
			const expectedPath = join(homedir(), '.claude', '.credentials.json');
			expect(getLocalClaudeCredentialsPath()).toBe(expectedPath);
		});
	});

	describe('parseCredentialsFile', () => {
		it('should parse valid JSON credentials', () => {
			const content = JSON.stringify({
				claudeAiOauth: {
					accessToken: 'test-token',
					subscriptionType: 'max',
				},
			});

			const result = parseCredentialsFile(content);

			expect(result).not.toBeNull();
			expect(result?.claudeAiOauth?.accessToken).toBe('test-token');
			expect(result?.claudeAiOauth?.subscriptionType).toBe('max');
		});

		it('should parse credentials with API key', () => {
			const content = JSON.stringify({
				apiKey: 'sk-ant-test-key',
			});

			const result = parseCredentialsFile(content);

			expect(result).not.toBeNull();
			expect(result?.apiKey).toBe('sk-ant-test-key');
		});

		it('should return null for malformed JSON', () => {
			const result = parseCredentialsFile('{ invalid json }');
			expect(result).toBeNull();
		});

		it('should return null for empty string', () => {
			const result = parseCredentialsFile('');
			expect(result).toBeNull();
		});

		it('should return null for non-object JSON', () => {
			const result = parseCredentialsFile('"just a string"');
			expect(result).toBeNull();
		});

		it('should return null for null JSON value', () => {
			const result = parseCredentialsFile('null');
			expect(result).toBeNull();
		});

		it('should return null for array JSON', () => {
			const result = parseCredentialsFile('[1, 2, 3]');
			expect(result).toBeNull();
		});
	});

	describe('detectAuthFromCredentials', () => {
		beforeEach(() => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it('should detect Max subscriber from OAuth credentials', () => {
			const creds: ClaudeCredentials = {
				claudeAiOauth: {
					accessToken: 'test-token',
					subscriptionType: 'max',
					rateLimitTier: 'tier1',
				},
			};

			const result = detectAuthFromCredentials(creds);

			expect(result.billingMode).toBe('max');
			expect(result.source).toBe('oauth');
			expect(result.subscriptionType).toBe('max');
			expect(result.rateLimitTier).toBe('tier1');
			expect(result.detectedAt).toBe(Date.now());
		});

		it('should detect Pro subscriber as API billing', () => {
			const creds: ClaudeCredentials = {
				claudeAiOauth: {
					accessToken: 'test-token',
					subscriptionType: 'pro',
				},
			};

			const result = detectAuthFromCredentials(creds);

			expect(result.billingMode).toBe('api');
			expect(result.source).toBe('oauth');
			expect(result.subscriptionType).toBe('pro');
		});

		it('should detect Free subscriber as API billing', () => {
			const creds: ClaudeCredentials = {
				claudeAiOauth: {
					accessToken: 'test-token',
					subscriptionType: 'free',
				},
			};

			const result = detectAuthFromCredentials(creds);

			expect(result.billingMode).toBe('api');
			expect(result.source).toBe('oauth');
			expect(result.subscriptionType).toBe('free');
		});

		it('should detect OAuth without subscriptionType as API billing', () => {
			const creds: ClaudeCredentials = {
				claudeAiOauth: {
					accessToken: 'test-token',
				},
			};

			const result = detectAuthFromCredentials(creds);

			expect(result.billingMode).toBe('api');
			expect(result.source).toBe('oauth');
			expect(result.subscriptionType).toBeUndefined();
		});

		it('should detect API key as API billing', () => {
			const creds: ClaudeCredentials = {
				apiKey: 'sk-ant-test-key',
			};

			const result = detectAuthFromCredentials(creds);

			expect(result.billingMode).toBe('api');
			expect(result.source).toBe('api_key');
			expect(result.subscriptionType).toBeUndefined();
		});

		it('should return default when no credentials present', () => {
			const creds: ClaudeCredentials = {};

			const result = detectAuthFromCredentials(creds);

			expect(result.billingMode).toBe('api');
			expect(result.source).toBe('default');
		});

		it('should prefer OAuth over API key when both present', () => {
			const creds: ClaudeCredentials = {
				claudeAiOauth: {
					accessToken: 'test-token',
					subscriptionType: 'max',
				},
				apiKey: 'sk-ant-test-key',
			};

			const result = detectAuthFromCredentials(creds);

			expect(result.billingMode).toBe('max');
			expect(result.source).toBe('oauth');
		});
	});

	describe('detectLocalAuth', () => {
		beforeEach(() => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
			mockReadFile.mockReset();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it('should detect Max subscription from credentials file', async () => {
			const mockCredentials = {
				claudeAiOauth: {
					accessToken: 'test-token',
					subscriptionType: 'max',
				},
			};
			mockReadFile.mockResolvedValue(JSON.stringify(mockCredentials));

			const result = await detectLocalAuth();

			expect(result.billingMode).toBe('max');
			expect(result.source).toBe('oauth');
			expect(result.subscriptionType).toBe('max');
		});

		it('should detect API key from credentials file', async () => {
			const mockCredentials = {
				apiKey: 'sk-ant-test-key',
			};
			mockReadFile.mockResolvedValue(JSON.stringify(mockCredentials));

			const result = await detectLocalAuth();

			expect(result.billingMode).toBe('api');
			expect(result.source).toBe('api_key');
		});

		it('should return default when credentials file not found', async () => {
			const error = new Error('ENOENT') as NodeJS.ErrnoException;
			error.code = 'ENOENT';
			mockReadFile.mockRejectedValue(error);

			const result = await detectLocalAuth();

			expect(result.billingMode).toBe('api');
			expect(result.source).toBe('default');
		});

		it('should return default when credentials file has malformed JSON', async () => {
			mockReadFile.mockResolvedValue('{ invalid json }');

			const result = await detectLocalAuth();

			expect(result.billingMode).toBe('api');
			expect(result.source).toBe('default');
		});

		it('should return default on file read error', async () => {
			const error = new Error('Permission denied') as NodeJS.ErrnoException;
			error.code = 'EACCES';
			mockReadFile.mockRejectedValue(error);

			const result = await detectLocalAuth();

			expect(result.billingMode).toBe('api');
			expect(result.source).toBe('default');
		});

		it('should include correct timestamp', async () => {
			const mockCredentials = {
				claudeAiOauth: {
					accessToken: 'test-token',
					subscriptionType: 'max',
				},
			};
			mockReadFile.mockResolvedValue(JSON.stringify(mockCredentials));

			const result = await detectLocalAuth();

			expect(result.detectedAt).toBe(Date.now());
		});
	});

	describe('invalidateRemoteAuthCache', () => {
		it('should not throw when called with no arguments', () => {
			expect(() => invalidateRemoteAuthCache()).not.toThrow();
		});

		it('should not throw when called with specific remote ID', () => {
			expect(() => invalidateRemoteAuthCache('test-remote')).not.toThrow();
		});
	});

	describe('detectRemoteAuth - SSH options', () => {
		/** Helper to create a mock child process that emits events */
		function createMockProcess(stdout: string, exitCode: number) {
			const proc = new EventEmitter() as EventEmitter & {
				stdout: EventEmitter;
				stderr: EventEmitter;
			};
			proc.stdout = new EventEmitter();
			proc.stderr = new EventEmitter();

			// Emit data and close asynchronously
			setTimeout(() => {
				if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
				proc.emit('close', exitCode);
			}, 0);

			return proc;
		}

		beforeEach(() => {
			mockSpawn.mockReset();
			// Invalidate cache so each test triggers a fresh SSH call
			invalidateRemoteAuthCache();
		});

		it('should pass COMMAND_SSH_OPTIONS with ConnectTimeout=5 override to SSH', async () => {
			const mockCreds = JSON.stringify({ apiKey: 'sk-test' });
			mockSpawn.mockReturnValue(createMockProcess(mockCreds, 0));

			await detectRemoteAuth({
				id: 'test',
				host: 'example.com',
				username: 'user',
				port: 22,
				useSshConfig: false,
			});

			expect(mockSpawn).toHaveBeenCalledWith('ssh', expect.any(Array));

			const args: string[] = mockSpawn.mock.calls[0][1];

			// Verify all COMMAND_SSH_OPTIONS are present
			for (const [key, value] of Object.entries(COMMAND_SSH_OPTIONS)) {
				if (key === 'ConnectTimeout') {
					// ConnectTimeout should be overridden to 5
					expect(args).toContain(`ConnectTimeout=5`);
				} else {
					expect(args).toContain(`${key}=${value}`);
				}
			}

			// Verify the old inline args pattern is NOT used
			// (i.e., there's no standalone 'BatchMode=yes' without the rest of the shared options)
			expect(args).toContain('ControlMaster=no');
			expect(args).toContain('ControlPath=/tmp/maestro-ssh-%C');
		});

		it('should NOT contain the old standalone BatchMode/ConnectTimeout pattern', async () => {
			const mockCreds = JSON.stringify({ apiKey: 'sk-test' });
			mockSpawn.mockReturnValue(createMockProcess(mockCreds, 0));

			await detectRemoteAuth({
				id: 'test',
				host: 'example.com',
				username: 'user',
				port: 22,
				useSshConfig: false,
			});

			const args: string[] = mockSpawn.mock.calls[0][1];

			// The shared options should include ControlMaster, ServerAliveInterval, etc.
			// If these are missing, it means the old inline pattern is still in use
			expect(args).toContain('ServerAliveInterval=30');
			expect(args).toContain('ServerAliveCountMax=3');
		});
	});
});
