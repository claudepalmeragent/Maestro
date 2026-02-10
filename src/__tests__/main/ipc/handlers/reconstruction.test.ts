/**
 * Tests for the Reconstruction IPC handlers
 *
 * These tests verify that the reconstruction handlers work correctly for
 * historical data reconstruction operations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ipcMain, BrowserWindow } from 'electron';
import { registerReconstructionHandlers } from '../../../../main/ipc/handlers/reconstruction';
import * as reconstructionServiceModule from '../../../../main/services/historical-reconstruction-service';
import type { ReconstructionResult } from '../../../../main/services/historical-reconstruction-service';

// Mock electron's ipcMain and BrowserWindow
vi.mock('electron', () => ({
	ipcMain: {
		handle: vi.fn(),
		removeHandler: vi.fn(),
	},
	BrowserWindow: vi.fn(),
}));

// Mock the historical-reconstruction-service module
vi.mock('../../../../main/services/historical-reconstruction-service', () => ({
	reconstructHistoricalData: vi.fn(),
}));

// Mock the logger
vi.mock('../../../../main/utils/logger', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

describe('reconstruction IPC handlers', () => {
	let handlers: Map<string, Function>;
	let mockMainWindow: {
		webContents: { send: ReturnType<typeof vi.fn> };
		isDestroyed: ReturnType<typeof vi.fn>;
	};
	let getMainWindow: () => typeof mockMainWindow | null;

	const mockReconstructionResult: ReconstructionResult = {
		queriesFound: 100,
		queriesInserted: 50,
		queriesUpdated: 30,
		queriesSkipped: 20,
		dateRangeCovered: { start: '2024-01-01', end: '2024-01-31' },
		errors: [],
		duration: 5000,
	};

	beforeEach(() => {
		// Clear mocks
		vi.clearAllMocks();

		// Create mock main window with webContents.send
		mockMainWindow = {
			webContents: {
				send: vi.fn(),
			},
			isDestroyed: vi.fn().mockReturnValue(false),
		};

		getMainWindow = () => mockMainWindow;

		// Default mock for reconstructHistoricalData
		vi.mocked(reconstructionServiceModule.reconstructHistoricalData).mockResolvedValue(
			mockReconstructionResult
		);

		// Capture all registered handlers
		handlers = new Map();
		vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
			handlers.set(channel, handler);
		});

		// Register handlers with our mock getMainWindow
		registerReconstructionHandlers({ getMainWindow });
	});

	afterEach(() => {
		handlers.clear();
	});

	describe('registration', () => {
		it('should register all reconstruction handlers', () => {
			const expectedChannels = ['reconstruction:start', 'reconstruction:preview'];

			for (const channel of expectedChannels) {
				expect(handlers.has(channel)).toBe(true);
			}
		});
	});

	describe('reconstruction:start', () => {
		it('should call reconstructHistoricalData with dryRun=false', async () => {
			const handler = handlers.get('reconstruction:start');
			const options = {
				includeLocalAgents: true,
				includeSshRemotes: false,
			};

			const result = await handler!({} as any, options);

			expect(reconstructionServiceModule.reconstructHistoricalData).toHaveBeenCalledWith({
				...options,
				dryRun: false,
			});
			expect(result).toEqual(mockReconstructionResult);
		});

		it('should broadcast reconstruction:updated after successful reconstruction', async () => {
			const handler = handlers.get('reconstruction:start');

			await handler!({} as any, {});

			expect(mockMainWindow.webContents.send).toHaveBeenCalledWith('reconstruction:updated');
			expect(mockMainWindow.webContents.send).toHaveBeenCalledTimes(1);
		});

		it('should not broadcast when main window is null', async () => {
			const nullWindowGetMainWindow = () => null;
			handlers.clear();
			vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
				handlers.set(channel, handler);
			});
			registerReconstructionHandlers({ getMainWindow: nullWindowGetMainWindow });

			const handler = handlers.get('reconstruction:start');
			await handler!({} as any, {});

			expect(reconstructionServiceModule.reconstructHistoricalData).toHaveBeenCalled();
			expect(mockMainWindow.webContents.send).not.toHaveBeenCalled();
		});

		it('should not broadcast when main window is destroyed', async () => {
			mockMainWindow.isDestroyed.mockReturnValue(true);

			const handler = handlers.get('reconstruction:start');
			await handler!({} as any, {});

			expect(reconstructionServiceModule.reconstructHistoricalData).toHaveBeenCalled();
			expect(mockMainWindow.webContents.send).not.toHaveBeenCalled();
		});

		it('should pass date range options correctly', async () => {
			const handler = handlers.get('reconstruction:start');
			const options = {
				includeLocalAgents: true,
				dateRange: {
					start: '2024-01-01',
					end: '2024-01-31',
				},
			};

			await handler!({} as any, options);

			expect(reconstructionServiceModule.reconstructHistoricalData).toHaveBeenCalledWith({
				...options,
				dryRun: false,
			});
		});

		it('should pass SSH remote options correctly', async () => {
			const handler = handlers.get('reconstruction:start');
			const options = {
				includeLocalAgents: false,
				includeSshRemotes: true,
				sshConfigs: [
					{ host: 'remote1.example.com', user: 'admin' },
					{ host: 'remote2.example.com', user: 'root', identityFile: '/home/user/.ssh/id_rsa' },
				],
			};

			await handler!({} as any, options);

			expect(reconstructionServiceModule.reconstructHistoricalData).toHaveBeenCalledWith({
				...options,
				dryRun: false,
			});
		});
	});

	describe('reconstruction:preview', () => {
		it('should call reconstructHistoricalData with dryRun=true', async () => {
			const handler = handlers.get('reconstruction:preview');
			const options = {
				includeLocalAgents: true,
			};

			const result = await handler!({} as any, options);

			expect(reconstructionServiceModule.reconstructHistoricalData).toHaveBeenCalledWith({
				...options,
				dryRun: true,
			});
			expect(result).toEqual(mockReconstructionResult);
		});

		it('should NOT broadcast reconstruction:updated for preview (dry run)', async () => {
			const handler = handlers.get('reconstruction:preview');

			await handler!({} as any, {});

			// Preview mode should NOT broadcast since no actual changes are made
			expect(mockMainWindow.webContents.send).not.toHaveBeenCalled();
		});

		it('should force dryRun=true even if options specify dryRun=false', async () => {
			const handler = handlers.get('reconstruction:preview');
			const options = {
				dryRun: false, // This should be overridden
			};

			await handler!({} as any, options);

			expect(reconstructionServiceModule.reconstructHistoricalData).toHaveBeenCalledWith({
				dryRun: true,
			});
		});
	});

	describe('error handling', () => {
		it('should propagate errors from reconstructHistoricalData', async () => {
			const error = new Error('Reconstruction failed');
			vi.mocked(reconstructionServiceModule.reconstructHistoricalData).mockRejectedValue(error);

			const handler = handlers.get('reconstruction:start');

			await expect(handler!({} as any, {})).rejects.toThrow('Reconstruction failed');
		});

		it('should return result with errors array if processing has errors', async () => {
			const resultWithErrors: ReconstructionResult = {
				...mockReconstructionResult,
				errors: [
					{ file: '/path/to/file1.jsonl', error: 'Failed to parse' },
					{ file: '/path/to/file2.jsonl', error: 'Permission denied' },
				],
			};
			vi.mocked(reconstructionServiceModule.reconstructHistoricalData).mockResolvedValue(
				resultWithErrors
			);

			const handler = handlers.get('reconstruction:start');
			const result = await handler!({} as any, {});

			expect(result.errors).toHaveLength(2);
			expect(result.errors[0].file).toBe('/path/to/file1.jsonl');
		});
	});

	describe('broadcast timing', () => {
		it('should broadcast after reconstruction completes', async () => {
			const executionOrder: string[] = [];

			vi.mocked(reconstructionServiceModule.reconstructHistoricalData).mockImplementation(
				async () => {
					executionOrder.push('reconstruction');
					return mockReconstructionResult;
				}
			);

			mockMainWindow.webContents.send = vi.fn().mockImplementation(() => {
				executionOrder.push('broadcast');
			});

			const handler = handlers.get('reconstruction:start');
			await handler!({} as any, {});

			expect(executionOrder).toEqual(['reconstruction', 'broadcast']);
		});
	});
});
