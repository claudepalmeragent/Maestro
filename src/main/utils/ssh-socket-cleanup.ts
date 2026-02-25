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
import { sshHealthMonitor } from '../services/ssh-health-monitor';

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
 * Validate that the ControlMaster socket for a given SSH config is alive.
 *
 * This is a pre-flight check designed to be called before SSH operations.
 * It talks to the LOCAL ControlMaster process via unix socket (~1ms, no network).
 *
 * If no master socket exists, or if it exists but is stale/dead, this function
 * triggers master re-establishment via the health monitor. Since operational
 * commands use ControlMaster=no, they NEED a master to be running — this
 * function ensures one exists before operations proceed.
 *
 * @param host - The SSH host (used to compute the socket path hash)
 * @param port - The SSH port (used to compute the socket path hash)
 * @param username - The SSH username (used to compute the socket path hash)
 * @returns true if socket is healthy, false if it was stale (cleanup + re-establish triggered)
 */
export async function validateSshSocket(
	host: string,
	port: number = 22,
	username: string = ''
): Promise<boolean> {
	// Find matching socket files for this host
	// ControlPath uses %C which is a hash - we can't predict it exactly,
	// so we check all maestro sockets and use ssh -O check to validate
	try {
		const files = fs.readdirSync(SOCKET_DIR);
		const maestroSockets = files.filter((f) => f.startsWith(SOCKET_PREFIX));

		if (maestroSockets.length === 0) {
			// No master socket exists — trigger establishment
			logger.debug(`No SSH master socket found, triggering establishment for ${host}`, LOG_CONTEXT);
			triggerMasterReestablishment(host, port, username);
			return true; // Return true — let the operation proceed (may use fallback direct connection)
		}

		// Use ssh -O check to verify the master connection is alive
		// This is a LOCAL operation - it talks to the ControlMaster unix socket, not the network
		const { execFileSync } = await import('child_process');
		const destination = username ? `${username}@${host}` : host;

		try {
			execFileSync(
				'ssh',
				[
					'-O',
					'check',
					'-o',
					`ControlPath=${path.join(SOCKET_DIR, SOCKET_PREFIX)}%C`,
					'-p',
					port.toString(),
					destination,
				],
				{
					timeout: 3000, // 3 second timeout (should be <100ms for local check)
					stdio: 'pipe',
				}
			);
			// Socket is alive
			return true;
		} catch (checkError: unknown) {
			// ssh -O check failed - socket is stale or no master exists
			// This is expected when no master connection exists yet (not an error)
			const errorMsg = checkError instanceof Error ? checkError.message : String(checkError);

			// "No ControlMaster" or "No such file" means no master for THIS host — trigger establishment
			if (errorMsg.includes('No ControlMaster') || errorMsg.includes('No such file')) {
				triggerMasterReestablishment(host, port, username);
				return true;
			}

			// Socket exists but is stale - clean it up and re-establish
			logger.info(
				`Stale SSH socket detected for ${destination}, cleaning up and re-establishing`,
				LOG_CONTEXT
			);
			for (const socketFile of maestroSockets) {
				const socketPath = path.join(SOCKET_DIR, socketFile);
				try {
					const stats = fs.statSync(socketPath);
					if (stats.isSocket()) {
						fs.unlinkSync(socketPath);
						logger.debug(`Removed stale socket: ${socketPath}`, LOG_CONTEXT);
					}
				} catch {
					// Already removed or in use - ignore
				}
			}
			// Trigger master re-establishment (async, non-blocking)
			triggerMasterReestablishment(host, port, username);
			return false;
		}
	} catch (err) {
		// File system error reading /tmp - not critical, proceed with operation
		logger.debug(`Socket validation skipped: ${err}`, LOG_CONTEXT);
		return true;
	}
}

/**
 * Trigger master connection re-establishment via the health monitor.
 *
 * Looks up the remote by host/port/username in the health monitor's tracked remotes
 * and calls establishMaster(). This is fire-and-forget — the operation that triggered
 * the pre-flight check will either succeed (if the master comes up fast enough)
 * or fail and be retried by the retry logic in remote-fs.ts / other callers.
 */
function triggerMasterReestablishment(host: string, port: number, username: string): void {
	try {
		const statuses = sshHealthMonitor.getHealthStatuses();
		const matching = statuses.find(
			(s) => s.host === host && s.port === port && (s.username === username || !username)
		);

		if (matching) {
			const remotes = sshHealthMonitor.getMonitoredRemotes();
			const remote = remotes.find((r) => r.remoteId === matching.remoteId);
			if (remote) {
				logger.debug(`Triggering master re-establishment for ${host}`, LOG_CONTEXT);
				sshHealthMonitor.establishMaster(remote).catch((err) => {
					logger.debug(`Master re-establishment failed for ${host}: ${err}`, LOG_CONTEXT);
				});
			}
		} else {
			logger.debug(
				`No monitored remote found for ${host}:${port}, cannot re-establish master`,
				LOG_CONTEXT
			);
		}
	} catch (err) {
		logger.debug(`Error triggering master re-establishment: ${err}`, LOG_CONTEXT);
	}
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
