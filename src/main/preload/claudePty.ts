/**
 * Preload API for ClaudePtyRunner channels
 *
 * Exposes window.maestro.claudePty with:
 * - onRawData:            subscribe to raw PTY stream from main process (push event)
 * - injectManualCommand:  send keystrokes to runner PTY stdin
 * - setUserControlled:    toggle user vs orchestration control of the runner
 * - getState:             query runner busy/control/alive state
 */

import { ipcRenderer } from 'electron';

export interface ClaudePtyState {
	isBusy: boolean;
	userControlled: boolean;
	alive: boolean;
}

export function createClaudePtyApi() {
	return {
		/**
		 * Subscribe to raw PTY data chunks pushed from the main process.
		 * Returns an unsubscribe function; call it on component unmount.
		 */
		onRawData: (sessionId: string, callback: (chunk: string) => void): (() => void) => {
			const handler = (_: unknown, sid: string, chunk: string) => {
				if (sid === sessionId) callback(chunk);
			};
			ipcRenderer.on('claude-pty:rawData', handler);
			return () => ipcRenderer.removeListener('claude-pty:rawData', handler);
		},

		/**
		 * Send raw input data to the runner's PTY stdin.
		 * Only has effect when the runner is in user-controlled mode.
		 */
		injectManualCommand: (sessionId: string, data: string): Promise<boolean> =>
			ipcRenderer.invoke('claude-pty:injectManualCommand', sessionId, data),

		/**
		 * Toggle user-controlled mode on the runner.
		 * When enabled=true the orchestration loop pauses and keystrokes go to PTY directly.
		 */
		setUserControlled: (sessionId: string, enabled: boolean): Promise<void> =>
			ipcRenderer.invoke('claude-pty:setUserControlled', sessionId, enabled),

		/**
		 * Query current runner state: busy, userControlled, alive.
		 * Returns null when no runner is registered for this session (until ARD 5).
		 */
		getState: (sessionId: string): Promise<ClaudePtyState | null> =>
			ipcRenderer.invoke('claude-pty:getState', sessionId),
	};
}

export type ClaudePtyApi = ReturnType<typeof createClaudePtyApi>;
