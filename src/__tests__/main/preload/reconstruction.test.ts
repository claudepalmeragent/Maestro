/**
 * Tests for reconstruction preload API
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron ipcRenderer
const mockInvoke = vi.fn();
const mockOn = vi.fn();
const mockRemoveListener = vi.fn();

vi.mock('electron', () => ({
	ipcRenderer: {
		invoke: (...args: unknown[]) => mockInvoke(...args),
		on: (...args: unknown[]) => mockOn(...args),
		removeListener: (...args: unknown[]) => mockRemoveListener(...args),
	},
}));

import { createReconstructionApi } from '../../../main/preload/reconstruction';

describe('Reconstruction Preload API', () => {
	let api: ReturnType<typeof createReconstructionApi>;

	const mockResult = {
		queriesFound: 100,
		queriesInserted: 50,
		queriesUpdated: 30,
		queriesSkipped: 20,
		dateRangeCovered: { start: '2024-01-01', end: '2024-01-31' },
		errors: [],
		duration: 5000,
	};

	beforeEach(() => {
		vi.clearAllMocks();
		api = createReconstructionApi();
	});

	describe('start', () => {
		it('should invoke reconstruction:start with no options', async () => {
			mockInvoke.mockResolvedValue(mockResult);

			const result = await api.start();

			expect(mockInvoke).toHaveBeenCalledWith('reconstruction:start', {});
			expect(result).toEqual(mockResult);
		});

		it('should invoke reconstruction:start with options', async () => {
			mockInvoke.mockResolvedValue(mockResult);
			const options = {
				includeLocalAgents: true,
				includeSshRemotes: false,
			};

			const result = await api.start(options);

			expect(mockInvoke).toHaveBeenCalledWith('reconstruction:start', options);
			expect(result).toEqual(mockResult);
		});

		it('should pass date range options', async () => {
			mockInvoke.mockResolvedValue(mockResult);
			const options = {
				dateRange: {
					start: '2024-01-01',
					end: '2024-01-31',
				},
			};

			await api.start(options);

			expect(mockInvoke).toHaveBeenCalledWith('reconstruction:start', options);
		});

		it('should pass SSH remote options', async () => {
			mockInvoke.mockResolvedValue(mockResult);
			const options = {
				includeSshRemotes: true,
				sshConfigs: [
					{ host: 'remote.example.com', user: 'admin' },
					{ host: 'server2.example.com', user: 'root', identityFile: '~/.ssh/id_rsa' },
				],
			};

			await api.start(options);

			expect(mockInvoke).toHaveBeenCalledWith('reconstruction:start', options);
		});
	});

	describe('preview', () => {
		it('should invoke reconstruction:preview with no options', async () => {
			mockInvoke.mockResolvedValue(mockResult);

			const result = await api.preview();

			expect(mockInvoke).toHaveBeenCalledWith('reconstruction:preview', {});
			expect(result).toEqual(mockResult);
		});

		it('should invoke reconstruction:preview with options', async () => {
			mockInvoke.mockResolvedValue(mockResult);
			const options = {
				includeLocalAgents: false,
				includeSshRemotes: true,
			};

			const result = await api.preview(options);

			expect(mockInvoke).toHaveBeenCalledWith('reconstruction:preview', options);
			expect(result).toEqual(mockResult);
		});
	});

	describe('onReconstructionUpdate', () => {
		it('should register event listener and return cleanup function', () => {
			const callback = vi.fn();

			const cleanup = api.onReconstructionUpdate(callback);

			expect(mockOn).toHaveBeenCalledWith('reconstruction:updated', expect.any(Function));
			expect(typeof cleanup).toBe('function');
		});

		it('should call callback when event is received', () => {
			const callback = vi.fn();
			let registeredHandler: () => void;

			mockOn.mockImplementation((_channel: string, handler: () => void) => {
				registeredHandler = handler;
			});

			api.onReconstructionUpdate(callback);
			registeredHandler!();

			expect(callback).toHaveBeenCalled();
		});

		it('should remove listener when cleanup is called', () => {
			const callback = vi.fn();
			let registeredHandler: () => void;

			mockOn.mockImplementation((_channel: string, handler: () => void) => {
				registeredHandler = handler;
			});

			const cleanup = api.onReconstructionUpdate(callback);
			cleanup();

			expect(mockRemoveListener).toHaveBeenCalledWith('reconstruction:updated', registeredHandler!);
		});
	});

	describe('error handling', () => {
		it('should handle errors from reconstruction:start', async () => {
			const error = new Error('Reconstruction failed');
			mockInvoke.mockRejectedValue(error);

			await expect(api.start()).rejects.toThrow('Reconstruction failed');
		});

		it('should handle errors from reconstruction:preview', async () => {
			const error = new Error('Preview failed');
			mockInvoke.mockRejectedValue(error);

			await expect(api.preview()).rejects.toThrow('Preview failed');
		});

		it('should return result with errors array', async () => {
			const resultWithErrors = {
				...mockResult,
				errors: [{ file: '/path/to/file.jsonl', error: 'Parse error' }],
			};
			mockInvoke.mockResolvedValue(resultWithErrors);

			const result = await api.start();

			expect(result.errors).toHaveLength(1);
			expect(result.errors[0].file).toBe('/path/to/file.jsonl');
		});
	});
});
