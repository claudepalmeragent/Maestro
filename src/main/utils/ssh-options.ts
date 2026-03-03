/**
 * Shared SSH Options
 *
 * Single source of truth for default SSH options used across ALL Maestro SSH code paths.
 * Every module that builds SSH arguments MUST import from here to ensure consistent
 * ControlMaster connection pooling, keep-alives, and security settings.
 *
 * There are four option sets:
 * - MASTER_SSH_OPTIONS: For establishing the dedicated ControlMaster connection (one per host)
 * - BASE_SSH_OPTIONS: Core options shared by all operational commands (uses existing master)
 * - COMMAND_SSH_OPTIONS: For non-interactive commands (file ops, git, terminal, stats)
 * - AGENT_SSH_OPTIONS: For agent spawning (requires TTY for --print mode)
 *
 * IMPORTANT: If you need to add or change SSH options, do it HERE so all paths stay in sync.
 */

/**
 * SSH options for the DEDICATED ControlMaster connection.
 *
 * Used exclusively by the health monitor and pre-flight validation to establish
 * exactly ONE master connection per host. The master runs as a background process
 * (ssh -fN) and all operational commands multiplex over it.
 *
 * ControlMaster=yes means "ALWAYS become master" — if a socket already exists,
 * the command will fail rather than silently creating a duplicate connection.
 * This is intentional: only one master should exist per host.
 *
 * ControlPersist=600 keeps the master alive for 10 minutes after the last
 * multiplexed connection closes, avoiding unnecessary reconnections.
 */
export const MASTER_SSH_OPTIONS: Record<string, string> = {
	BatchMode: 'yes',
	StrictHostKeyChecking: 'accept-new',
	ConnectTimeout: '10',
	ClearAllForwardings: 'yes',
	RequestTTY: 'no',
	ControlMaster: 'yes',
	ControlPath: '/tmp/maestro-ssh-%C',
	ControlPersist: '600',
	ServerAliveInterval: '15',
	ServerAliveCountMax: '6',
};

/**
 * Base SSH options for ALL operational commands (file ops, agent spawning, git, terminal).
 *
 * ControlMaster=no means "use an existing master socket if available, but NEVER
 * try to become master yourself." This eliminates the race condition where multiple
 * concurrent SSH processes with ControlMaster=auto compete to create the socket.
 *
 * The master connection is established separately by the health monitor or
 * pre-flight validation using MASTER_SSH_OPTIONS above.
 *
 * ControlPath is still required so SSH knows WHERE to find the master socket.
 * ControlPersist is NOT needed here — it only applies to the master process.
 */
export const BASE_SSH_OPTIONS: Record<string, string> = {
	BatchMode: 'yes',
	StrictHostKeyChecking: 'accept-new',
	ConnectTimeout: '10',
	ClearAllForwardings: 'yes',
	ControlMaster: 'no',
	ControlPath: '/tmp/maestro-ssh-%C',
	ServerAliveInterval: '15',
	ServerAliveCountMax: '6',
};

/**
 * SSH options for non-interactive command execution.
 * Used by: remote-fs.ts (file explorer, stats), SshCommandRunner.ts (terminal commands),
 *          ssh-remote-manager.ts (connection test)
 */
export const COMMAND_SSH_OPTIONS: Record<string, string> = {
	...BASE_SSH_OPTIONS,
	RequestTTY: 'no', // Don't request a TTY for command execution
};

/**
 * SSH options for agent spawning.
 * Used by: ssh-command-builder.ts (agent execution, git operations, agent detection)
 * Note: RequestTTY='force' is required for Claude Code's --print mode to produce output.
 */
export const AGENT_SSH_OPTIONS: Record<string, string> = {
	...BASE_SSH_OPTIONS,
	RequestTTY: 'force', // Force TTY allocation - required for Claude Code --print mode
	LogLevel: 'ERROR', // Suppress SSH warnings like "Pseudo-terminal will not be allocated..."
};
