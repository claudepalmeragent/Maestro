/**
 * Tests for Claude Authentication Detection Utility
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { homedir } from 'os';
import { join } from 'path';

// Create mock functions using vi.hoisted (allows access in vi.mock factories)
const { mockReadFile } = vi.hoisted(() => ({
	mockReadFile: vi.fn(),
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
	invalidateRemoteAuthCache,
	type ClaudeCredentials,
} from '../../../main/utils/claude-auth-detector';

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
});
