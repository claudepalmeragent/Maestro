/**
 * Tests for prepareSessionForPersistence — verifies that git detection fields
 * and other runtime-only fields are properly stripped before persistence.
 */
import { describe, it, expect } from 'vitest';
import { prepareSessionForPersistence } from '../../../../renderer/hooks/utils/useDebouncedPersistence';
import type { Session } from '../../../../renderer/types';

/**
 * Helper to create a minimal valid Session object for testing.
 * Only includes required fields needed for prepareSessionForPersistence to run.
 */
function createTestSession(overrides: Partial<Session> = {}): Session {
	return {
		id: 'test-session-1',
		name: 'Test Session',
		cwd: '/home/user/project',
		projectRoot: '/home/user/project',
		state: 'busy',
		aiPid: 1234,
		terminalPid: 0,
		port: 0,
		isLive: false,
		changedFiles: [],
		isGitRepo: false,
		aiTabs: [
			{
				id: 'tab-1',
				agentSessionId: null,
				name: null,
				starred: false,
				logs: [],
				inputValue: '',
				stagedImages: [],
				createdAt: Date.now(),
				state: 'idle',
			},
		],
		activeTabId: 'tab-1',
		shellLogs: [],
		executionQueue: [],
		activeTimeMs: 0,
		...overrides,
	} as Session;
}

describe('prepareSessionForPersistence', () => {
	describe('git detection fields are stripped', () => {
		it('should reset isGitRepo to false', () => {
			const session = createTestSession({ isGitRepo: true });
			const result = prepareSessionForPersistence(session);
			expect(result.isGitRepo).toBe(false);
		});

		it('should clear gitRoot', () => {
			const session = createTestSession({
				isGitRepo: true,
				gitRoot: '/home/user/project/my-repo',
			});
			const result = prepareSessionForPersistence(session);
			expect(result.gitRoot).toBeUndefined();
		});

		it('should clear gitBranches', () => {
			const session = createTestSession({
				isGitRepo: true,
				gitBranches: ['main', 'develop', 'feature/x'],
			});
			const result = prepareSessionForPersistence(session);
			expect(result.gitBranches).toBeUndefined();
		});

		it('should clear gitTags', () => {
			const session = createTestSession({
				isGitRepo: true,
				gitTags: ['v1.0.0', 'v2.0.0'],
			});
			const result = prepareSessionForPersistence(session);
			expect(result.gitTags).toBeUndefined();
		});

		it('should clear gitRefsCacheTime', () => {
			const session = createTestSession({
				isGitRepo: true,
				gitRefsCacheTime: Date.now(),
			});
			const result = prepareSessionForPersistence(session);
			expect(result.gitRefsCacheTime).toBeUndefined();
		});

		it('should clear gitSubdirScanResults', () => {
			const session = createTestSession({
				gitSubdirScanResults: [
					{
						path: '/home/user/project/repo-a',
						name: 'repo-a',
						isWorktree: false,
						branch: 'main',
						repoRoot: null,
					},
					{
						path: '/home/user/project/repo-b',
						name: 'repo-b',
						isWorktree: false,
						branch: 'dev',
						repoRoot: null,
					},
				],
			});
			const result = prepareSessionForPersistence(session);
			expect(result.gitSubdirScanResults).toBeUndefined();
		});

		it('should clear ALL git fields together on a fully populated session', () => {
			const session = createTestSession({
				isGitRepo: true,
				gitRoot: '/home/user/project/my-repo',
				gitBranches: ['main', 'develop'],
				gitTags: ['v1.0'],
				gitRefsCacheTime: 1700000000000,
				gitSubdirScanResults: [
					{ path: '/p/a', name: 'a', isWorktree: false, branch: 'main', repoRoot: null },
				],
			});
			const result = prepareSessionForPersistence(session);
			expect(result.isGitRepo).toBe(false);
			expect(result.gitRoot).toBeUndefined();
			expect(result.gitBranches).toBeUndefined();
			expect(result.gitTags).toBeUndefined();
			expect(result.gitRefsCacheTime).toBeUndefined();
			expect(result.gitSubdirScanResults).toBeUndefined();
		});
	});

	describe('SSH runtime fields are stripped', () => {
		it('should clear sshRemote, sshRemoteId, and remoteCwd', () => {
			const session = createTestSession({
				sshRemote: { id: 'remote-1', host: 'server', user: 'admin' } as any,
				sshRemoteId: 'remote-1',
				remoteCwd: '/remote/path',
			});
			const result = prepareSessionForPersistence(session);
			expect(result.sshRemote).toBeUndefined();
			expect(result.sshRemoteId).toBeUndefined();
			expect(result.remoteCwd).toBeUndefined();
		});
	});

	describe('other runtime fields are stripped', () => {
		it('should reset state to idle', () => {
			const session = createTestSession({ state: 'busy' as any });
			const result = prepareSessionForPersistence(session);
			expect(result.state).toBe('idle');
		});

		it('should exclude agentError, sshConnectionFailed but persist closedTabHistory', () => {
			const session = createTestSession({
				closedTabHistory: [
					{ tab: { id: 'tab-old', logs: [] }, closedAt: Date.now(), originalIndex: 0 },
				] as any,
				agentError: 'some error' as any,
				agentErrorPaused: true,
				agentErrorTabId: 'tab-1',
				sshConnectionFailed: true,
			});
			const result = prepareSessionForPersistence(session);
			// agentError and sshConnectionFailed are destructured out — they should not exist on the result
			expect((result as any).agentError).toBeUndefined();
			expect((result as any).sshConnectionFailed).toBeUndefined();
			// closedTabHistory is now persisted with truncated logs
			expect(result.closedTabHistory).toEqual([
				{ tab: { id: 'tab-old', logs: [] }, closedAt: expect.any(Number), originalIndex: 0 },
			]);
		});
	});

	describe('non-runtime fields are preserved', () => {
		it('should preserve session identity fields', () => {
			const session = createTestSession({
				id: 'my-session-id',
				name: 'My Session',
				cwd: '/home/user/project',
				projectRoot: '/home/user/project',
			});
			const result = prepareSessionForPersistence(session);
			expect(result.id).toBe('my-session-id');
			expect(result.name).toBe('My Session');
			expect(result.cwd).toBe('/home/user/project');
			expect(result.projectRoot).toBe('/home/user/project');
		});

		it('should preserve sessionSshRemoteConfig (configuration, not runtime)', () => {
			const config = {
				remoteId: 'remote-1',
				host: 'server.example.com',
				user: 'admin',
				workingDirOverride: '/remote/project',
			};
			const session = createTestSession({
				sessionSshRemoteConfig: config as any,
			});
			const result = prepareSessionForPersistence(session);
			expect(result.sessionSshRemoteConfig).toEqual(config);
		});
	});

	describe('wizard tab filtering', () => {
		it('should filter out active wizard tabs', () => {
			const session = createTestSession({
				aiTabs: [
					{
						id: 'tab-normal',
						agentSessionId: null,
						name: null,
						starred: false,
						logs: [],
						inputValue: '',
						stagedImages: [],
						createdAt: Date.now(),
						state: 'idle',
					},
					{
						id: 'tab-wizard',
						agentSessionId: null,
						name: null,
						starred: false,
						logs: [],
						inputValue: '',
						stagedImages: [],
						createdAt: Date.now(),
						state: 'idle',
						wizardState: { isActive: true } as any,
					},
				],
				activeTabId: 'tab-normal',
			});
			const result = prepareSessionForPersistence(session);
			expect(result.aiTabs).toHaveLength(1);
			expect(result.aiTabs[0].id).toBe('tab-normal');
		});
	});
});
