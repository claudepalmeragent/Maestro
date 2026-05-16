/**
 * IPC Handlers for ClaudePtyRunner channels
 *
 * Stubs for ARD 2 (01b). The actual runner registry and live wiring come in ARD 5 (03).
 * These handlers establish the IPC contract so the renderer InteractiveModeView can be
 * built and tested without requiring a live runner.
 *
 * Channels:
 * - claude-pty:rawData        (main → renderer push, sessionId, chunk)
 * - claude-pty:injectManualCommand (renderer → main, sessionId, data → boolean)
 * - claude-pty:setUserControlled   (renderer → main, sessionId, enabled → void)
 * - claude-pty:getState            (renderer → main, sessionId → RunnerState | null)
 */

import { ipcMain } from 'electron';
import { logger } from '../../utils/logger';

export interface ClaudePtyRunnerState {
	isBusy: boolean;
	userControlled: boolean;
	alive: boolean;
}

/**
 * Register all claude-pty IPC handlers.
 * Handlers are stubs until ARD 5 (03) wires the runner registry.
 */
export function registerClaudePtyHandlers(): void {
	// Inject a manual command into the runner's PTY stdin.
	// Stub: always returns false (no runner registered yet).
	ipcMain.handle(
		'claude-pty:injectManualCommand',
		async (_event, sessionId: string, data: string): Promise<boolean> => {
			logger.debug('claude-pty:injectManualCommand (stub)', 'ClaudePty', {
				sessionId,
				dataLen: data.length,
			});
			return false;
		}
	);

	// Toggle user-controlled mode on the runner.
	// Stub: no-op until runner registry is wired.
	ipcMain.handle(
		'claude-pty:setUserControlled',
		async (_event, sessionId: string, enabled: boolean): Promise<void> => {
			logger.debug('claude-pty:setUserControlled (stub)', 'ClaudePty', { sessionId, enabled });
		}
	);

	// Query runner state: isBusy, userControlled, alive.
	// Stub: returns null (no runner registered).
	ipcMain.handle(
		'claude-pty:getState',
		async (_event, sessionId: string): Promise<ClaudePtyRunnerState | null> => {
			logger.debug('claude-pty:getState (stub)', 'ClaudePty', { sessionId });
			return null;
		}
	);
}
