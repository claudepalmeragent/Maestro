/**
 * Tests for CallbackRegistry
 *
 * Verifies:
 * - Callback registration and retrieval
 * - Default return values when callbacks not set
 * - Proper delegation to registered callbacks
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CallbackRegistry } from '../../../../main/web-server/managers/CallbackRegistry';

// Mock the logger
vi.mock('../../../../main/utils/logger', () => ({
	logger: {
		info: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

describe('CallbackRegistry', () => {
	let registry: CallbackRegistry;

	beforeEach(() => {
		vi.clearAllMocks();
		registry = new CallbackRegistry();
	});

	describe('Default Return Values', () => {
		it('should return empty array for getSessions when no callback set', () => {
			const result = registry.getSessions();
			expect(result).toEqual([]);
		});

		it('should return null for getSessionDetail when no callback set', () => {
			const result = registry.getSessionDetail('session-123');
			expect(result).toBeNull();
		});

		it('should return null for getTheme when no callback set', () => {
			const result = registry.getTheme();
			expect(result).toBeNull();
		});

		it('should return empty array for getCustomCommands when no callback set', () => {
			const result = registry.getCustomCommands();
			expect(result).toEqual([]);
		});

		it('should return false for writeToSession when no callback set', () => {
			const result = registry.writeToSession('session-123', 'data');
			expect(result).toBe(false);
		});

		it('should return false for executeCommand when no callback set', async () => {
			const result = await registry.executeCommand('session-123', 'ls -la');
			expect(result).toBe(false);
		});

		it('should return false for interruptSession when no callback set', async () => {
			const result = await registry.interruptSession('session-123');
			expect(result).toBe(false);
		});

		it('should return false for switchMode when no callback set', async () => {
			const result = await registry.switchMode('session-123', 'ai');
			expect(result).toBe(false);
		});

		it('should return false for selectSession when no callback set', async () => {
			const result = await registry.selectSession('session-123');
			expect(result).toBe(false);
		});

		it('should return false for selectTab when no callback set', async () => {
			const result = await registry.selectTab('session-123', 'tab-1');
			expect(result).toBe(false);
		});

		it('should return null for newTab when no callback set', async () => {
			const result = await registry.newTab('session-123');
			expect(result).toBeNull();
		});

		it('should return false for closeTab when no callback set', async () => {
			const result = await registry.closeTab('session-123', 'tab-1');
			expect(result).toBe(false);
		});

		it('should return false for renameTab when no callback set', async () => {
			const result = await registry.renameTab('session-123', 'tab-1', 'New Name');
			expect(result).toBe(false);
		});

		it('should return empty array for getHistory when no callback set', () => {
			const result = registry.getHistory();
			expect(result).toEqual([]);
		});
	});

	describe('Callback Registration and Execution', () => {
		it('should call registered getSessions callback', () => {
			const mockCallback = vi.fn().mockReturnValue([
				{ id: 'session-1', name: 'Session 1' },
				{ id: 'session-2', name: 'Session 2' },
			]);
			registry.setGetSessionsCallback(mockCallback);

			const result = registry.getSessions();

			expect(mockCallback).toHaveBeenCalled();
			expect(result).toHaveLength(2);
			expect(result[0].id).toBe('session-1');
		});

		it('should call registered getSessionDetail callback with arguments', () => {
			const mockCallback = vi.fn().mockReturnValue({
				id: 'session-123',
				tabs: [{ id: 'tab-1' }],
			});
			registry.setGetSessionDetailCallback(mockCallback);

			const result = registry.getSessionDetail('session-123', 'tab-1');

			expect(mockCallback).toHaveBeenCalledWith('session-123', 'tab-1');
			expect(result?.id).toBe('session-123');
		});

		it('should call registered getTheme callback', () => {
			const mockCallback = vi.fn().mockReturnValue({ name: 'dark', colors: {} });
			registry.setGetThemeCallback(mockCallback);

			const result = registry.getTheme();

			expect(mockCallback).toHaveBeenCalled();
			expect(result?.name).toBe('dark');
		});

		it('should call registered getCustomCommands callback', () => {
			const mockCallback = vi.fn().mockReturnValue([{ name: 'cmd1', command: 'echo 1' }]);
			registry.setGetCustomCommandsCallback(mockCallback);

			const result = registry.getCustomCommands();

			expect(mockCallback).toHaveBeenCalled();
			expect(result).toHaveLength(1);
		});

		it('should call registered writeToSession callback', () => {
			const mockCallback = vi.fn().mockReturnValue(true);
			registry.setWriteToSessionCallback(mockCallback);

			const result = registry.writeToSession('session-123', 'test data');

			expect(mockCallback).toHaveBeenCalledWith('session-123', 'test data');
			expect(result).toBe(true);
		});

		it('should call registered executeCommand callback', async () => {
			const mockCallback = vi.fn().mockResolvedValue(true);
			registry.setExecuteCommandCallback(mockCallback);

			const result = await registry.executeCommand('session-123', 'ls -la', 'ai');

			expect(mockCallback).toHaveBeenCalledWith('session-123', 'ls -la', 'ai');
			expect(result).toBe(true);
		});

		it('should call registered interruptSession callback', async () => {
			const mockCallback = vi.fn().mockResolvedValue(true);
			registry.setInterruptSessionCallback(mockCallback);

			const result = await registry.interruptSession('session-123');

			expect(mockCallback).toHaveBeenCalledWith('session-123');
			expect(result).toBe(true);
		});

		it('should call registered switchMode callback', async () => {
			const mockCallback = vi.fn().mockResolvedValue(true);
			registry.setSwitchModeCallback(mockCallback);

			const result = await registry.switchMode('session-123', 'terminal');

			expect(mockCallback).toHaveBeenCalledWith('session-123', 'terminal');
			expect(result).toBe(true);
		});

		it('should call registered selectSession callback', async () => {
			const mockCallback = vi.fn().mockResolvedValue(true);
			registry.setSelectSessionCallback(mockCallback);

			const result = await registry.selectSession('session-123', 'tab-1');

			expect(mockCallback).toHaveBeenCalledWith('session-123', 'tab-1');
			expect(result).toBe(true);
		});

		it('should call registered selectTab callback', async () => {
			const mockCallback = vi.fn().mockResolvedValue(true);
			registry.setSelectTabCallback(mockCallback);

			const result = await registry.selectTab('session-123', 'tab-1');

			expect(mockCallback).toHaveBeenCalledWith('session-123', 'tab-1');
			expect(result).toBe(true);
		});

		it('should call registered newTab callback', async () => {
			const mockCallback = vi.fn().mockResolvedValue({ tabId: 'new-tab-123' });
			registry.setNewTabCallback(mockCallback);

			const result = await registry.newTab('session-123');

			expect(mockCallback).toHaveBeenCalledWith('session-123');
			expect(result?.tabId).toBe('new-tab-123');
		});

		it('should call registered closeTab callback', async () => {
			const mockCallback = vi.fn().mockResolvedValue(true);
			registry.setCloseTabCallback(mockCallback);

			const result = await registry.closeTab('session-123', 'tab-1');

			expect(mockCallback).toHaveBeenCalledWith('session-123', 'tab-1');
			expect(result).toBe(true);
		});

		it('should call registered renameTab callback', async () => {
			const mockCallback = vi.fn().mockResolvedValue(true);
			registry.setRenameTabCallback(mockCallback);

			const result = await registry.renameTab('session-123', 'tab-1', 'New Name');

			expect(mockCallback).toHaveBeenCalledWith('session-123', 'tab-1', 'New Name');
			expect(result).toBe(true);
		});

		it('should call registered getHistory callback with optional parameters', () => {
			const mockCallback = vi.fn().mockReturnValue([{ command: 'ls', timestamp: 123 }]);
			registry.setGetHistoryCallback(mockCallback);

			const result = registry.getHistory('/project', 'session-123');

			expect(mockCallback).toHaveBeenCalledWith('/project', 'session-123');
			expect(result).toHaveLength(1);
		});
	});

	describe('hasCallback', () => {
		it('should return false for unset callbacks', () => {
			expect(registry.hasCallback('getSessions')).toBe(false);
			expect(registry.hasCallback('getTheme')).toBe(false);
			expect(registry.hasCallback('executeCommand')).toBe(false);
		});

		it('should return true for set callbacks', () => {
			registry.setGetSessionsCallback(vi.fn());
			registry.setGetThemeCallback(vi.fn());
			registry.setExecuteCommandCallback(vi.fn());

			expect(registry.hasCallback('getSessions')).toBe(true);
			expect(registry.hasCallback('getTheme')).toBe(true);
			expect(registry.hasCallback('executeCommand')).toBe(true);
		});

		it('should check all callback types', () => {
			// Initially all should be false
			const callbackTypes = [
				'getSessions',
				'getSessionDetail',
				'getTheme',
				'getCustomCommands',
				'writeToSession',
				'executeCommand',
				'interruptSession',
				'switchMode',
				'selectSession',
				'selectTab',
				'newTab',
				'closeTab',
				'renameTab',
				'getHistory',
			] as const;

			for (const type of callbackTypes) {
				expect(registry.hasCallback(type)).toBe(false);
			}
		});
	});

	describe('Callback Replacement', () => {
		it('should replace existing callback with new one', () => {
			const firstCallback = vi.fn().mockReturnValue([{ id: '1' }]);
			const secondCallback = vi.fn().mockReturnValue([{ id: '2' }]);

			registry.setGetSessionsCallback(firstCallback);
			expect(registry.getSessions()[0].id).toBe('1');

			registry.setGetSessionsCallback(secondCallback);
			expect(registry.getSessions()[0].id).toBe('2');

			expect(firstCallback).toHaveBeenCalledTimes(1);
			expect(secondCallback).toHaveBeenCalledTimes(1);
		});
	});

	describe('Async Callback Handling', () => {
		it('should handle async executeCommand callback returning false', async () => {
			const mockCallback = vi.fn().mockResolvedValue(false);
			registry.setExecuteCommandCallback(mockCallback);

			const result = await registry.executeCommand('session-123', 'command');

			expect(result).toBe(false);
		});

		it('should handle async switchMode callback rejection gracefully', async () => {
			const mockCallback = vi.fn().mockRejectedValue(new Error('Switch failed'));
			registry.setSwitchModeCallback(mockCallback);

			await expect(registry.switchMode('session-123', 'ai')).rejects.toThrow('Switch failed');
		});
	});
});
