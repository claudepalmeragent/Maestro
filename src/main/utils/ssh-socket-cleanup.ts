/**
 * SSH Socket Cleanup Utility
 *
 * Manages cleanup of SSH ControlMaster sockets used for connection multiplexing.
 * Sockets are created at /tmp/maestro-ssh-* and need cleanup on:
 * - Application startup (remove stale sockets from previous runs)
 * - Application shutdown (graceful cleanup)
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';

const LOG_CONTEXT = '[ssh-socket-cleanup]';
const SOCKET_PREFIX = 'maestro-ssh-';
const SOCKET_DIR = '/tmp';

/**
 * Clean up stale Maestro SSH ControlMaster sockets.
 *
 * Called on application startup to remove any sockets left over from
 * previous Maestro sessions that may have crashed or been killed.
 *
 * @returns Number of sockets cleaned up
 */
export function cleanupStaleSshSockets(): number {
	let cleanedCount = 0;

	try {
		const files = fs.readdirSync(SOCKET_DIR);
		const maestroSockets = files.filter((f) => f.startsWith(SOCKET_PREFIX));

		for (const socketFile of maestroSockets) {
			const socketPath = path.join(SOCKET_DIR, socketFile);

			try {
				// Check if it's a socket file
				const stats = fs.statSync(socketPath);
				if (stats.isSocket()) {
					fs.unlinkSync(socketPath);
					cleanedCount++;
					logger.debug(`Removed stale SSH socket: ${socketPath}`, LOG_CONTEXT);
				}
			} catch (err) {
				// Socket may be in use or already removed - ignore
				logger.debug(`Could not remove socket ${socketPath}: ${err}`, LOG_CONTEXT);
			}
		}

		if (cleanedCount > 0) {
			logger.info(`Cleaned up ${cleanedCount} stale SSH socket(s)`, LOG_CONTEXT);
		}
	} catch (err) {
		// Directory read failed - not critical, just log
		logger.warn(`Failed to scan for stale SSH sockets: ${err}`, LOG_CONTEXT);
	}

	return cleanedCount;
}

/**
 * Gracefully close all active Maestro SSH ControlMaster connections.
 *
 * Called on application shutdown to cleanly terminate SSH connections
 * rather than leaving them to timeout.
 *
 * Note: This uses `ssh -O exit` to signal the master connection to close.
 * If the socket is already gone, this is a no-op.
 */
export async function closeSshConnections(): Promise<void> {
	try {
		const files = fs.readdirSync(SOCKET_DIR);
		const maestroSockets = files.filter((f) => f.startsWith(SOCKET_PREFIX));

		for (const socketFile of maestroSockets) {
			const socketPath = path.join(SOCKET_DIR, socketFile);

			try {
				// Check if socket exists and is a socket
				const stats = fs.statSync(socketPath);
				if (!stats.isSocket()) continue;

				// Try to gracefully close the connection
				// We use spawn to avoid blocking the shutdown
				const { spawn } = await import('child_process');
				const ssh = spawn('ssh', ['-O', 'exit', '-o', `ControlPath=${socketPath}`, 'dummy'], {
					stdio: 'ignore',
					detached: true,
				});
				ssh.unref();

				logger.debug(`Sent exit signal to SSH socket: ${socketPath}`, LOG_CONTEXT);
			} catch {
				// Socket cleanup is best-effort
			}
		}
	} catch {
		// Not critical - sockets will timeout eventually
	}
}
