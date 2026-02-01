/**
 * SSH Spawn Helper - Utility for wrapping spawn commands with SSH.
 *
 * Provides a function to wrap process spawn configuration with SSH command
 * when needed for remote execution. This is used by both the process IPC
 * handlers and the group chat router to consistently handle SSH remote agents.
 */

import type { SshRemoteConfig, AgentSshRemoteConfig } from '../../shared/types';
import { buildSshCommand } from './ssh-command-builder';
import { getSshRemoteConfig, createSshRemoteStoreAdapter } from './ssh-remote-resolver';
import { logger } from './logger';
import * as os from 'os';

/**
 * Configuration for SSH spawn wrapping.
 */
export interface SshSpawnConfig {
	/** The command to execute (local path to binary) */
	command: string;
	/** Command line arguments (not including prompt) */
	args: string[];
	/** Working directory for the command */
	cwd: string;
	/** Prompt to send to the agent (if any) */
	prompt?: string;
	/** Custom environment variables to pass to the command */
	customEnvVars?: Record<string, string>;
	/** SSH remote configuration from the session/moderator config */
	sshRemoteConfig?: AgentSshRemoteConfig;
	/** Binary name for the agent (e.g., 'claude', 'codex') - used for remote execution */
	binaryName?: string;
	/** Custom path override for the session */
	customPath?: string;
	/** Function to build prompt args (e.g., ['-p', prompt] for OpenCode) */
	promptArgs?: (prompt: string) => string[];
	/** Whether the agent doesn't support '--' before prompt */
	noPromptSeparator?: boolean;
}

/**
 * Result of SSH spawn wrapping.
 */
export interface SshSpawnResult {
	/** The command to spawn (SSH or original) */
	command: string;
	/** Arguments for the spawn command */
	args: string[];
	/** Working directory for the spawn (local when using SSH) */
	cwd: string;
	/** The SSH config used, if any */
	sshConfig?: SshRemoteConfig;
	/** Whether SSH wrapping was applied */
	usedSsh: boolean;
}

/**
 * Wrap a spawn configuration with SSH if SSH remote config is provided.
 *
 * This function takes a spawn configuration and, if SSH remote is enabled,
 * wraps the command with SSH for remote execution. If no SSH remote is
 * configured, the original command and args are returned unchanged.
 *
 * @param config Spawn configuration including command, args, and SSH config
 * @param settingsStore The settings store to look up SSH remote configurations
 * @returns Wrapped spawn configuration with SSH or original configuration
 *
 * @example
 * const result = await wrapSpawnWithSsh({
 *   command: '/usr/local/bin/claude',
 *   args: ['--print', '--allowedTools', 'Read,Write'],
 *   cwd: '/home/user/project',
 *   prompt: 'Hello world',
 *   sshRemoteConfig: { enabled: true, remoteId: 'remote-1' },
 *   binaryName: 'claude',
 * }, settingsStore);
 *
 * // result.command = 'ssh'
 * // result.args = [...ssh args...]
 * // result.usedSsh = true
 */
export async function wrapSpawnWithSsh<
	T extends {
		get(key: 'sshRemotes', defaultValue: SshRemoteConfig[]): SshRemoteConfig[];
	},
>(config: SshSpawnConfig, settingsStore: T): Promise<SshSpawnResult> {
	// If no SSH config or not enabled, return original config
	if (!config.sshRemoteConfig?.enabled || !config.sshRemoteConfig.remoteId) {
		return {
			command: config.command,
			args: config.args,
			cwd: config.cwd,
			usedSsh: false,
		};
	}

	// Resolve SSH remote configuration from settings store
	const sshStoreAdapter = createSshRemoteStoreAdapter(settingsStore);
	const sshResult = getSshRemoteConfig(sshStoreAdapter, {
		sessionSshConfig: config.sshRemoteConfig,
	});

	// If SSH config not found or disabled, return original config
	if (!sshResult.config) {
		logger.debug('SSH config not found or disabled, using local execution', '[ssh-spawn-helper]', {
			remoteId: config.sshRemoteConfig.remoteId,
			source: sshResult.source,
		});
		return {
			command: config.command,
			args: config.args,
			cwd: config.cwd,
			usedSsh: false,
		};
	}

	// Build args with prompt included (SSH command needs all args in one command string)
	let sshArgs = [...config.args];
	if (config.prompt) {
		if (config.promptArgs) {
			sshArgs = [...sshArgs, ...config.promptArgs(config.prompt)];
		} else if (config.noPromptSeparator) {
			sshArgs = [...sshArgs, config.prompt];
		} else {
			sshArgs = [...sshArgs, '--', config.prompt];
		}
	}

	// Determine the command to run on the remote host:
	// 1. If user set a session-specific custom path, use that
	// 2. Otherwise, use the agent's binaryName and let the remote shell's PATH resolve it
	const remoteCommand = config.customPath || config.binaryName || config.command;

	// Build the SSH command that wraps the agent execution
	// IMPORTANT: Only use workingDirOverride if explicitly set.
	// Don't fall back to local cwd - that path likely doesn't exist on the remote.
	// If no workingDirOverride, let the remote start in its default home directory.
	const sshCommand = await buildSshCommand(sshResult.config, {
		command: remoteCommand,
		args: sshArgs,
		// Only set cwd if workingDirOverride is explicitly configured
		cwd: config.sshRemoteConfig.workingDirOverride || undefined,
		// Pass custom environment variables to the remote command
		env: config.customEnvVars,
	});

	logger.info('SSH spawn wrapping applied', '[ssh-spawn-helper]', {
		localCommand: config.command,
		remoteCommand,
		remoteName: sshResult.config.name,
		remoteHost: sshResult.config.host,
		hasPrompt: !!config.prompt,
		promptLength: config.prompt?.length,
	});

	return {
		command: sshCommand.command,
		args: sshCommand.args,
		// When using SSH, use local home directory as cwd
		// The remote working directory is embedded in the SSH command itself
		cwd: os.homedir(),
		sshConfig: sshResult.config,
		usedSsh: true,
	};
}
