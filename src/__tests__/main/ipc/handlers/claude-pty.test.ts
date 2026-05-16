/**
 * Tests for claude-pty IPC handlers (ARD 5 — wired to ProcessManager runner registry).
 *
 * Tests verify:
 * - All three handlers are registered via ipcMain.handle.
 * - injectManualCommand returns false when no runner is registered.
 * - setUserControlled resolves without error when no runner is registered.
 * - getState returns null when no runner is registered.
 * - When a runner IS registered, handlers delegate to it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';

// ---------------------------------------------------------------------------
// Mock electron
// ---------------------------------------------------------------------------

const registeredHandlers: Record<string, Function> = {};

vi.mock('electron', () => ({
	ipcMain: {
		handle: vi.fn((channel: string, handler: Function) => {
			registeredHandlers[channel] = handler;
		}),
	},
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function buildMockProcessManager(runner?: Record<string, unknown>) {
	return {
		getExternalRunner: vi.fn().mockReturnValue(runner),
	};
}

describe('registerClaudePtyHandlers (ARD 5)', () => {
	beforeEach(() => {
		Object.keys(registeredHandlers).forEach((k) => delete registeredHandlers[k]);
		vi.mocked(ipcMain.handle).mockClear();
	});

	it('registers all three handler channels', async () => {
		const { registerClaudePtyHandlers } = await import('../../../../main/ipc/handlers/claude-pty');
		registerClaudePtyHandlers(buildMockProcessManager() as never);

		expect(registeredHandlers['claude-pty:injectManualCommand']).toBeDefined();
		expect(registeredHandlers['claude-pty:setUserControlled']).toBeDefined();
		expect(registeredHandlers['claude-pty:getState']).toBeDefined();
	});

	it('injectManualCommand returns false when no runner registered', async () => {
		const { registerClaudePtyHandlers } = await import('../../../../main/ipc/handlers/claude-pty');
		registerClaudePtyHandlers(buildMockProcessManager() as never);

		const handler = registeredHandlers['claude-pty:injectManualCommand'];
		const result = await handler({}, 'sess-1', 'hello');
		expect(result).toBe(false);
	});

	it('setUserControlled does not throw when no runner registered', async () => {
		const { registerClaudePtyHandlers } = await import('../../../../main/ipc/handlers/claude-pty');
		registerClaudePtyHandlers(buildMockProcessManager() as never);

		const handler = registeredHandlers['claude-pty:setUserControlled'];
		expect(() => handler({}, 'sess-1', true)).not.toThrow();
	});

	it('getState returns null when no runner registered', async () => {
		const { registerClaudePtyHandlers } = await import('../../../../main/ipc/handlers/claude-pty');
		registerClaudePtyHandlers(buildMockProcessManager() as never);

		const handler = registeredHandlers['claude-pty:getState'];
		const result = await handler({}, 'sess-1');
		expect(result).toBeNull();
	});

	it('injectManualCommand delegates to runner when registered', async () => {
		const mockRunner = { injectManualCommand: vi.fn().mockReturnValue(true) };
		const { registerClaudePtyHandlers } = await import('../../../../main/ipc/handlers/claude-pty');
		registerClaudePtyHandlers(buildMockProcessManager(mockRunner as never) as never);

		const handler = registeredHandlers['claude-pty:injectManualCommand'];
		const result = await handler({}, 'sess-1', 'my cmd');
		expect(mockRunner.injectManualCommand).toHaveBeenCalledWith('my cmd');
		expect(result).toBe(true);
	});

	it('getState delegates to runner when registered', async () => {
		const mockState = { isBusy: true, userControlled: false, alive: true };
		const mockRunner = { getState: vi.fn().mockReturnValue(mockState) };
		const { registerClaudePtyHandlers } = await import('../../../../main/ipc/handlers/claude-pty');
		registerClaudePtyHandlers(buildMockProcessManager(mockRunner as never) as never);

		const handler = registeredHandlers['claude-pty:getState'];
		const result = await handler({}, 'sess-1');
		expect(result).toEqual(mockState);
	});
});
