/**
 * Tests for claude-pty IPC handlers (ARD 2 stubs).
 *
 * These handlers are stubs until ARD 5 (03) wires the runner registry.
 * Tests verify:
 * - All three handlers are registered via ipcMain.handle.
 * - injectManualCommand returns false (stub).
 * - setUserControlled resolves without error (no-op stub).
 * - getState returns null (no runner registered).
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

// Mock logger
vi.mock('../../../../main/utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('registerClaudePtyHandlers (stubs)', () => {
	beforeEach(() => {
		// Clear registered handlers before each test
		Object.keys(registeredHandlers).forEach((k) => delete registeredHandlers[k]);
		vi.mocked(ipcMain.handle).mockClear();
	});

	it('registers all three handler channels', async () => {
		const { registerClaudePtyHandlers } = await import('../../../../main/ipc/handlers/claude-pty');
		registerClaudePtyHandlers();

		expect(registeredHandlers['claude-pty:injectManualCommand']).toBeDefined();
		expect(registeredHandlers['claude-pty:setUserControlled']).toBeDefined();
		expect(registeredHandlers['claude-pty:getState']).toBeDefined();
	});

	it('injectManualCommand stub returns false', async () => {
		const { registerClaudePtyHandlers } = await import('../../../../main/ipc/handlers/claude-pty');
		registerClaudePtyHandlers();

		const handler = registeredHandlers['claude-pty:injectManualCommand'];
		const result = await handler({}, 'sess-1', 'hello');
		expect(result).toBe(false);
	});

	it('setUserControlled stub resolves without throwing', async () => {
		const { registerClaudePtyHandlers } = await import('../../../../main/ipc/handlers/claude-pty');
		registerClaudePtyHandlers();

		const handler = registeredHandlers['claude-pty:setUserControlled'];
		await expect(handler({}, 'sess-1', true)).resolves.toBeUndefined();
	});

	it('getState stub returns null', async () => {
		const { registerClaudePtyHandlers } = await import('../../../../main/ipc/handlers/claude-pty');
		registerClaudePtyHandlers();

		const handler = registeredHandlers['claude-pty:getState'];
		const result = await handler({}, 'sess-1');
		expect(result).toBeNull();
	});
});
