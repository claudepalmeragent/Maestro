import { describe, it, expect } from 'vitest';
import {
	MASTER_SSH_OPTIONS,
	BASE_SSH_OPTIONS,
	COMMAND_SSH_OPTIONS,
	AGENT_SSH_OPTIONS,
} from '../../../main/utils/ssh-options';

describe('ssh-options', () => {
	describe('MASTER_SSH_OPTIONS', () => {
		it('uses ControlMaster=yes to always become master', () => {
			expect(MASTER_SSH_OPTIONS.ControlMaster).toBe('yes');
		});

		it('includes ControlPath for socket location', () => {
			expect(MASTER_SSH_OPTIONS.ControlPath).toBe('/tmp/maestro-ssh-%C');
		});

		it('includes ControlPersist for connection keepalive', () => {
			expect(MASTER_SSH_OPTIONS.ControlPersist).toBe('600');
		});

		it('uses RequestTTY=no since master has no command', () => {
			expect(MASTER_SSH_OPTIONS.RequestTTY).toBe('no');
		});

		it('includes keep-alive settings', () => {
			expect(MASTER_SSH_OPTIONS.ServerAliveInterval).toBe('15');
			expect(MASTER_SSH_OPTIONS.ServerAliveCountMax).toBe('6');
		});
	});

	describe('BASE_SSH_OPTIONS', () => {
		it('uses ControlMaster=no to never race for master', () => {
			expect(BASE_SSH_OPTIONS.ControlMaster).toBe('no');
		});

		it('includes ControlPath to find existing master socket', () => {
			expect(BASE_SSH_OPTIONS.ControlPath).toBe('/tmp/maestro-ssh-%C');
		});

		it('does NOT include ControlPersist (only applies to master)', () => {
			expect(BASE_SSH_OPTIONS.ControlPersist).toBeUndefined();
		});

		it('includes keep-alive settings', () => {
			expect(BASE_SSH_OPTIONS.ServerAliveInterval).toBe('15');
			expect(BASE_SSH_OPTIONS.ServerAliveCountMax).toBe('6');
		});
	});

	describe('COMMAND_SSH_OPTIONS', () => {
		it('inherits ControlMaster=no from BASE', () => {
			expect(COMMAND_SSH_OPTIONS.ControlMaster).toBe('no');
		});

		it('uses RequestTTY=no for non-interactive commands', () => {
			expect(COMMAND_SSH_OPTIONS.RequestTTY).toBe('no');
		});
	});

	describe('AGENT_SSH_OPTIONS', () => {
		it('inherits ControlMaster=no from BASE', () => {
			expect(AGENT_SSH_OPTIONS.ControlMaster).toBe('no');
		});

		it('uses RequestTTY=force for agent TTY requirement', () => {
			expect(AGENT_SSH_OPTIONS.RequestTTY).toBe('force');
		});

		it('uses LogLevel=ERROR to suppress SSH warnings', () => {
			expect(AGENT_SSH_OPTIONS.LogLevel).toBe('ERROR');
		});
	});

	describe('cross-option consistency', () => {
		it('all option sets share the same ControlPath', () => {
			const controlPath = '/tmp/maestro-ssh-%C';
			expect(MASTER_SSH_OPTIONS.ControlPath).toBe(controlPath);
			expect(BASE_SSH_OPTIONS.ControlPath).toBe(controlPath);
			expect(COMMAND_SSH_OPTIONS.ControlPath).toBe(controlPath);
			expect(AGENT_SSH_OPTIONS.ControlPath).toBe(controlPath);
		});

		it('only MASTER uses ControlMaster=yes', () => {
			expect(MASTER_SSH_OPTIONS.ControlMaster).toBe('yes');
			expect(BASE_SSH_OPTIONS.ControlMaster).toBe('no');
			expect(COMMAND_SSH_OPTIONS.ControlMaster).toBe('no');
			expect(AGENT_SSH_OPTIONS.ControlMaster).toBe('no');
		});

		it('only MASTER has ControlPersist', () => {
			expect(MASTER_SSH_OPTIONS.ControlPersist).toBeDefined();
			expect(BASE_SSH_OPTIONS.ControlPersist).toBeUndefined();
			expect(COMMAND_SSH_OPTIONS.ControlPersist).toBeUndefined();
			expect(AGENT_SSH_OPTIONS.ControlPersist).toBeUndefined();
		});
	});
});
