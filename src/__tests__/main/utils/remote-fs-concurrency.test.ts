import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to test the concurrency limiting behavior of execRemoteCommand.
// Since execRemoteCommand is not directly exported, we test through the public API
// (readDirRemote, readFileRemote, etc.) which call execRemoteCommand internally.

import {
	readDirRemote,
	readFileRemote,
	statRemote,
	resetHostLimiter,
	type RemoteFsDeps,
} from '../../../main/utils/remote-fs';
import type { SshRemoteConfig } from '../../../shared/types';
import type { ExecResult } from '../../../main/utils/execFile';

// Mock ssh-socket-cleanup to prevent actual socket validation
vi.mock('../../../main/utils/ssh-socket-cleanup', () => ({
	validateSshSocket: vi.fn().mockResolvedValue(true),
}));

// Mock logger to prevent noise
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

describe('remote-fs SSH concurrency limiting', () => {
	const baseConfig: SshRemoteConfig = {
		id: 'test-remote-1',
		name: 'Test Remote',
		host: 'test.example.com',
		port: 22,
		username: 'testuser',
		privateKeyPath: '~/.ssh/id_ed25519',
		enabled: true,
		maxSessions: 5, // Low limit for testing
	};

	beforeEach(() => {
		// Reset limiters between tests to ensure clean state
		resetHostLimiter(baseConfig);
	});

	function createSlowMockDeps(delayMs: number): RemoteFsDeps & {
		callCount: () => number;
		concurrentCount: () => number;
		maxConcurrent: () => number;
	} {
		let concurrent = 0;
		let maxConcurrentSeen = 0;
		let totalCalls = 0;

		const execSsh = vi.fn().mockImplementation(async () => {
			concurrent++;
			totalCalls++;
			if (concurrent > maxConcurrentSeen) {
				maxConcurrentSeen = concurrent;
			}
			await new Promise((resolve) => setTimeout(resolve, delayMs));
			concurrent--;
			return { stdout: '{}', stderr: '', exitCode: 0 } as ExecResult;
		});

		return {
			execSsh,
			buildSshArgs: vi.fn().mockReturnValue(['-o', 'BatchMode=yes', 'testuser@test.example.com']),
			callCount: () => totalCalls,
			concurrentCount: () => concurrent,
			maxConcurrent: () => maxConcurrentSeen,
		};
	}

	it('limits concurrent SSH calls to maxSessions - 2', async () => {
		const deps = createSlowMockDeps(100); // 100ms per call

		// Fire 10 concurrent readDirRemote calls (maxSessions=5, so limit=3)
		const promises = Array.from({ length: 10 }, (_, i) =>
			readDirRemote(`/path/${i}`, baseConfig, deps)
		);

		await Promise.all(promises);

		// All 10 calls should complete
		expect(deps.callCount()).toBe(10);
		// Max concurrent should not exceed maxSessions - 2 = 3
		expect(deps.maxConcurrent()).toBeLessThanOrEqual(3);
	});

	it('uses default maxSessions=10 when not configured', async () => {
		const configWithoutMax: SshRemoteConfig = {
			...baseConfig,
			maxSessions: undefined,
		};
		resetHostLimiter(configWithoutMax);

		const deps = createSlowMockDeps(50);

		// Fire 15 concurrent calls (default maxSessions=10, so limit=8)
		const promises = Array.from({ length: 15 }, (_, i) =>
			readDirRemote(`/path/${i}`, configWithoutMax, deps)
		);

		await Promise.all(promises);

		expect(deps.callCount()).toBe(15);
		expect(deps.maxConcurrent()).toBeLessThanOrEqual(8);
	});

	it('queues excess requests without dropping them', async () => {
		const deps = createSlowMockDeps(50);

		// Fire more requests than the limit
		const results = await Promise.all(
			Array.from({ length: 8 }, (_, i) => readDirRemote(`/path/${i}`, baseConfig, deps))
		);

		// All results should be returned (none dropped)
		expect(results.length).toBe(8);
		results.forEach((result) => {
			expect(result).toBeDefined();
		});
	});

	it('creates separate limiters for different hosts', async () => {
		const config2: SshRemoteConfig = {
			...baseConfig,
			id: 'test-remote-2',
			host: 'other.example.com',
			maxSessions: 3,
		};
		resetHostLimiter(config2);

		const deps1 = createSlowMockDeps(100);
		const deps2 = createSlowMockDeps(100);

		// Fire calls to both hosts concurrently
		const promises = [
			...Array.from({ length: 5 }, (_, i) => readDirRemote(`/path/${i}`, baseConfig, deps1)),
			...Array.from({ length: 5 }, (_, i) => readDirRemote(`/path/${i}`, config2, deps2)),
		];

		await Promise.all(promises);

		// Both sets should complete independently
		expect(deps1.callCount()).toBe(5);
		expect(deps2.callCount()).toBe(5);
	});
});
