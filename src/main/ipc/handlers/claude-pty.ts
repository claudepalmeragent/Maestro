/**
 * IPC Handlers for ClaudePtyRunner channels
 *
 * Wires the renderer ↔ main IPC contract to the external runner registry on ProcessManager.
 *
 * Channels:
 * - claude-pty:rawData        (main → renderer push, sessionId, chunk) — pushed by process:spawn
 * - claude-pty:injectManualCommand (renderer → main, sessionId, data → boolean)
 * - claude-pty:setUserControlled   (renderer → main, sessionId, enabled → void)
 * - claude-pty:getState            (renderer → main, sessionId → RunnerState | null)
 */

import { ipcMain } from 'electron';
import type { ProcessManager } from '../../process-manager/ProcessManager';

export interface ClaudePtyRunnerState {
	isBusy: boolean;
	userControlled: boolean;
	alive: boolean;
}

/**
 * Register all claude-pty IPC handlers, wired to the ProcessManager's external runner registry.
 */
export function registerClaudePtyHandlers(processManager: ProcessManager): void {
	// Inject a manual command into the runner's PTY stdin.
	// Returns false if no runner is registered or the runner's mutex rejects the write.
	ipcMain.handle(
		'claude-pty:injectManualCommand',
		(_event, sessionId: string, data: string): boolean => {
			const runner = processManager.getExternalRunner(sessionId);
			return runner?.injectManualCommand(data) ?? false;
		}
	);

	// Toggle user-controlled mode on the runner.
	ipcMain.handle(
		'claude-pty:setUserControlled',
		(_event, sessionId: string, enabled: boolean): void => {
			const runner = processManager.getExternalRunner(sessionId);
			runner?.setUserControlled(enabled);
		}
	);

	// Query runner state: isBusy, userControlled, alive.
	// Returns null if no runner is registered for the session.
	ipcMain.handle(
		'claude-pty:getState',
		(_event, sessionId: string): ClaudePtyRunnerState | null => {
			const runner = processManager.getExternalRunner(sessionId);
			return runner?.getState() ?? null;
		}
	);
}
