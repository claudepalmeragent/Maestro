/**
 * Shared SSH Options
 *
 * Single source of truth for default SSH options used across ALL Maestro SSH code paths.
 * Every module that builds SSH arguments MUST import from here to ensure consistent
 * ControlMaster connection pooling, keep-alives, and security settings.
 *
 * There are three option sets:
 * - BASE_SSH_OPTIONS: Core options shared by all operations
 * - COMMAND_SSH_OPTIONS: For non-interactive commands (file ops, git, terminal, stats)
 * - AGENT_SSH_OPTIONS: For agent spawning (requires TTY for --print mode)
 *
 * IMPORTANT: If you need to add or change SSH options, do it HERE so all paths stay in sync.
 */

/**
 * Base SSH options shared by ALL operations.
 * Includes connection pooling (ControlMaster) and keep-alives (ServerAliveInterval).
 */
export const BASE_SSH_OPTIONS: Record<string, string> = {
	BatchMode: 'yes', // Disable password prompts (key-only auth)
	StrictHostKeyChecking: 'accept-new', // Auto-accept new host keys
	ConnectTimeout: '10', // Connection timeout in seconds
	ClearAllForwardings: 'yes', // Disable port forwarding from SSH config (avoids "Address already in use")
	// Connection multiplexing - share a single TCP connection per host
	// Uses %C (hash of connection params) to create unique socket per user@host:port
	ControlMaster: 'auto', // Automatically create/reuse master connection
	ControlPath: '/tmp/maestro-ssh-%C', // Socket path (%C = hash for uniqueness)
	ControlPersist: '300', // Keep connection alive 5 minutes after last use
	// Keep-alive settings to detect dead connections proactively
	ServerAliveInterval: '30', // Send keep-alive every 30 seconds
	ServerAliveCountMax: '3', // Disconnect after 3 missed responses (90s total)
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
