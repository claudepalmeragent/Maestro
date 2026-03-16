import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	validateSshSocket,
	clearSocketValidationCache,
} from '../../../main/utils/ssh-socket-cleanup';

// Mock child_process
const mockExecFileSync = vi.fn();
vi.mock('child_process', () => ({
	execFileSync: (...args: any[]) => mockExecFileSync(...args),
}));

// Mock fs to control socket file discovery
vi.mock('fs', () => ({
	readdirSync: vi.fn(() => ['maestro-ssh-abc123']),
	statSync: vi.fn(() => ({ isSocket: () => true })),
	unlinkSync: vi.fn(),
}));

// Mock ssh-health-monitor
vi.mock('../../../main/services/ssh-health-monitor', () => ({
	sshHealthMonitor: {
		getHealthStatuses: vi.fn(() => []),
		getMonitoredRemotes: vi.fn(() => []),
		establishMaster: vi.fn(),
	},
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

describe('SSH socket validation cache', () => {
	beforeEach(() => {
		clearSocketValidationCache();
		mockExecFileSync.mockReset();
	});

	it('calls ssh -O check on first validation', async () => {
		mockExecFileSync.mockReturnValue('');
		await validateSshSocket('test-host', 22, 'user');
		expect(mockExecFileSync).toHaveBeenCalledTimes(1);
	});

	it('skips ssh -O check on second call within TTL', async () => {
		mockExecFileSync.mockReturnValue('');
		await validateSshSocket('test-host', 22, 'user');
		await validateSshSocket('test-host', 22, 'user');
		// Should only have been called once — second call used cache
		expect(mockExecFileSync).toHaveBeenCalledTimes(1);
	});

	it('validates different hosts independently', async () => {
		mockExecFileSync.mockReturnValue('');
		await validateSshSocket('host-a', 22, 'user');
		await validateSshSocket('host-b', 22, 'user');
		expect(mockExecFileSync).toHaveBeenCalledTimes(2);
	});

	it('re-validates after cache is cleared', async () => {
		mockExecFileSync.mockReturnValue('');
		await validateSshSocket('test-host', 22, 'user');
		clearSocketValidationCache();
		await validateSshSocket('test-host', 22, 'user');
		expect(mockExecFileSync).toHaveBeenCalledTimes(2);
	});
});
