/**
 * SSH Connection Health Monitor
 *
 * Background service that proactively manages SSH ControlMaster connections.
 * Runs periodic health checks to:
 * 1. Detect and remove stale sockets
 * 2. Pre-warm connections for recently active remotes
 * 3. Log health status for diagnostics
 *
 * Design principles:
 * - Invisible to the user during normal operation (no toasts, no modals)
 * - Non-blocking: if a check fails, it logs and moves on
 * - Lightweight: local socket checks only (~1ms each, no network unless pre-warming)
 */

import * as fs from 'fs';
import { spawn } from 'child_process';
import { logger } from '../utils/logger';
import { validateSshSocket } from '../utils/ssh-socket-cleanup';
import { resolveSshPath } from '../utils/cliDetection';
import { MASTER_SSH_OPTIONS } from '../utils/ssh-options';

const LOG_CONTEXT = '[ssh-health-monitor]';
const SOCKET_PREFIX = 'maestro-ssh-';
const SOCKET_DIR = '/tmp';

/** Health check interval in milliseconds (60 seconds) */
const HEALTH_CHECK_INTERVAL_MS = 60_000;

/** Back-off interval after consecutive failures (5 minutes) */
const BACKOFF_INTERVAL_MS = 300_000;

/** Max consecutive failures before backing off */
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Health status for a single SSH remote.
 */
export interface RemoteHealthStatus {
	remoteId: string;
	host: string;
	port: number;
	username: string;
	status: 'healthy' | 'degraded' | 'disconnected' | 'unknown';
	lastChecked: number;
	lastSuccessful: number;
	consecutiveFailures: number;
}

/**
 * Configuration for a remote to monitor.
 */
export interface MonitoredRemote {
	remoteId: string;
	host: string;
	port: number;
	username: string;
	privateKeyPath?: string;
	useSshConfig?: boolean;
}

/**
 * SSH Connection Health Monitor.
 * Singleton service — create once, start on app ready, stop on shutdown.
 */
export class SshHealthMonitor {
	private intervalId: ReturnType<typeof setInterval> | null = null;
	private healthStatuses: Map<string, RemoteHealthStatus> = new Map();
	private monitoredRemotes: Map<string, MonitoredRemote> = new Map();
	private running = false;

	/**
	 * Start the health monitor.
	 * Begins periodic health checks at the configured interval.
	 */
	start(): void {
		if (this.running) {
			logger.debug('Health monitor already running', LOG_CONTEXT);
			return;
		}

		this.running = true;
		logger.info('SSH health monitor started', LOG_CONTEXT);

		// Run first check after a short delay (let app finish startup)
		setTimeout(() => {
			if (this.running) {
				this.runHealthCheck();
			}
		}, 5000);

		// Schedule periodic checks
		this.intervalId = setInterval(() => {
			if (this.running) {
				this.runHealthCheck();
			}
		}, HEALTH_CHECK_INTERVAL_MS);
	}

	/**
	 * Stop the health monitor.
	 * Call on app shutdown before closeSshConnections().
	 */
	stop(): void {
		this.running = false;
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
		logger.info('SSH health monitor stopped', LOG_CONTEXT);
	}

	/**
	 * Register a remote for health monitoring.
	 * Call when an SSH remote is used for the first time in a session.
	 */
	addRemote(remote: MonitoredRemote): void {
		this.monitoredRemotes.set(remote.remoteId, remote);
		this.healthStatuses.set(remote.remoteId, {
			remoteId: remote.remoteId,
			host: remote.host,
			port: remote.port,
			username: remote.username,
			status: 'unknown',
			lastChecked: 0,
			lastSuccessful: 0,
			consecutiveFailures: 0,
		});
		logger.debug(`Added remote to health monitor: ${remote.host}`, LOG_CONTEXT);
	}

	/**
	 * Remove a remote from health monitoring.
	 * Call when an SSH remote is deleted or disabled.
	 */
	removeRemote(remoteId: string): void {
		this.monitoredRemotes.delete(remoteId);
		this.healthStatuses.delete(remoteId);
	}

	/**
	 * Get health status for all monitored remotes.
	 */
	getHealthStatuses(): RemoteHealthStatus[] {
		return Array.from(this.healthStatuses.values());
	}

	/**
	 * Get health status for a specific remote.
	 */
	getHealthStatus(remoteId: string): RemoteHealthStatus | undefined {
		return this.healthStatuses.get(remoteId);
	}

	/**
	 * Get all monitored remote configurations.
	 * Used by pre-flight validation to find remote config for master re-establishment.
	 */
	getMonitoredRemotes(): MonitoredRemote[] {
		return Array.from(this.monitoredRemotes.values());
	}

	/**
	 * Run a health check cycle for all monitored remotes.
	 */
	private async runHealthCheck(): Promise<void> {
		if (this.monitoredRemotes.size === 0) {
			return; // Nothing to monitor
		}

		for (const [remoteId, remote] of this.monitoredRemotes) {
			const status = this.healthStatuses.get(remoteId);
			if (!status) continue;

			// Back off if too many consecutive failures
			if (status.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
				const timeSinceLastCheck = Date.now() - status.lastChecked;
				if (timeSinceLastCheck < BACKOFF_INTERVAL_MS) {
					continue; // Skip this remote until backoff expires
				}
			}

			try {
				const isHealthy = await validateSshSocket(remote.host, remote.port, remote.username);

				const now = Date.now();
				if (isHealthy) {
					// Check if we have any active sockets for this host
					const hasActiveSockets = this.hasActiveSocketsForHost();

					if (hasActiveSockets) {
						// Socket exists and is healthy
						if (status.status !== 'healthy') {
							logger.info(`SSH connection restored: ${remote.host}`, LOG_CONTEXT);
						}
						status.status = 'healthy';
						status.lastSuccessful = now;
						status.consecutiveFailures = 0;
					} else {
						// No socket exists — this is normal after ControlPersist timeout
						// Pre-warm the connection
						status.status = 'degraded';
						await this.establishMaster(remote);
					}
				} else {
					// Socket was stale and got cleaned up
					// Pre-warm a fresh connection
					status.status = 'degraded';
					status.consecutiveFailures++;
					await this.establishMaster(remote);
				}

				status.lastChecked = now;
			} catch (err) {
				status.status = 'disconnected';
				status.consecutiveFailures++;
				status.lastChecked = Date.now();
				logger.debug(`Health check failed for ${remote.host}: ${err}`, LOG_CONTEXT);
			}
		}
	}

	/**
	 * Check if any Maestro SSH sockets exist.
	 */
	private hasActiveSocketsForHost(): boolean {
		try {
			const files = fs.readdirSync(SOCKET_DIR);
			return files.some((f) => f.startsWith(SOCKET_PREFIX));
		} catch {
			return false;
		}
	}

	/**
	 * Establish a dedicated ControlMaster connection to a remote host.
	 *
	 * Uses ControlMaster=yes with -fN to create a background master process.
	 * - -f: Go to background after authentication
	 * - -N: No remote command (just establish the TCP connection)
	 * - ControlMaster=yes: ALWAYS become master (fail if socket already exists)
	 *
	 * This is the ONLY code path that should ever create a ControlMaster socket.
	 * All operational SSH commands use ControlMaster=no to multiplex over it.
	 *
	 * If a master socket already exists (the ssh command exits with non-zero),
	 * this is not an error — it means a master is already running.
	 */
	public async establishMaster(remote: MonitoredRemote): Promise<void> {
		try {
			const sshPath = await resolveSshPath();
			const destination = remote.username ? `${remote.username}@${remote.host}` : remote.host;

			const args: string[] = [];

			// Add identity file if needed
			if (!remote.useSshConfig && remote.privateKeyPath) {
				args.push('-i', remote.privateKeyPath);
			} else if (remote.useSshConfig && remote.privateKeyPath?.trim()) {
				args.push('-i', remote.privateKeyPath);
			}

			// Add master SSH options (ControlMaster=yes)
			for (const [key, value] of Object.entries(MASTER_SSH_OPTIONS)) {
				args.push('-o', `${key}=${value}`);
			}

			// Port
			if (!remote.useSshConfig || remote.port !== 22) {
				args.push('-p', remote.port.toString());
			}

			// -fN: background after auth, no remote command
			args.push('-f', '-N');

			// Destination (must be last)
			args.push(destination);

			logger.debug(`Establishing SSH master connection to ${remote.host}`, LOG_CONTEXT);

			const sshProcess = spawn(sshPath, args, {
				stdio: 'pipe',
				timeout: 15000,
			});

			// Collect stderr for diagnostics
			let stderrOutput = '';
			sshProcess.stderr.on('data', (data: Buffer) => {
				stderrOutput += data.toString();
			});

			sshProcess.on('exit', (code) => {
				const status = this.healthStatuses.get(remote.remoteId);
				if (status) {
					if (code === 0) {
						status.status = 'healthy';
						status.lastSuccessful = Date.now();
						status.consecutiveFailures = 0;
						logger.info(`SSH master established for ${remote.host}`, LOG_CONTEXT);
					} else {
						// ControlMaster=yes fails if socket already exists — that's OK
						if (stderrOutput.includes('ControlSocket') && stderrOutput.includes('already exists')) {
							logger.debug(`Master already exists for ${remote.host}, reusing`, LOG_CONTEXT);
							status.status = 'healthy';
							status.consecutiveFailures = 0;
						} else {
							status.consecutiveFailures++;
							logger.debug(
								`Master establishment failed (exit ${code}) for ${remote.host}: ${stderrOutput.trim()}`,
								LOG_CONTEXT
							);
							if (status.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
								status.status = 'disconnected';
								logger.warn(
									`SSH remote unreachable after ${MAX_CONSECUTIVE_FAILURES} failures: ${remote.host}`,
									LOG_CONTEXT
								);
							}
						}
					}
				}
			});

			sshProcess.on('error', (err) => {
				logger.debug(`Master establishment error for ${remote.host}: ${err.message}`, LOG_CONTEXT);
			});

			// Don't block — let it run in the background
			sshProcess.unref();
		} catch (err) {
			logger.debug(`Failed to start master establishment for ${remote.host}: ${err}`, LOG_CONTEXT);
		}
	}
}

/**
 * Singleton instance of the SSH health monitor.
 */
export const sshHealthMonitor = new SshHealthMonitor();
