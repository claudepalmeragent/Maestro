import { describe, it, expect, test } from 'vitest';
import {
	stripPrintArgs,
	deriveStableClaudeSessionId,
	cleanTerminalChunk,
	resolveClaudeTransportMode,
	describeCascadeSource,
} from '../../../main/utils/claude-pty-helpers';

describe('stripPrintArgs', () => {
	it('removes --print flag', () => {
		expect(stripPrintArgs(['--print', 'hello'])).toEqual(['hello']);
	});

	it('removes -p flag', () => {
		expect(stripPrintArgs(['-p', 'hello'])).toEqual(['hello']);
	});

	it('removes --verbose flag', () => {
		expect(stripPrintArgs(['--verbose', 'hello'])).toEqual(['hello']);
	});

	it('removes --output-format stream-json pair', () => {
		expect(stripPrintArgs(['--output-format', 'stream-json', 'hello'])).toEqual(['hello']);
	});

	it('preserves --output-format with non-stream-json value', () => {
		expect(stripPrintArgs(['--output-format', 'text'])).toEqual(['--output-format', 'text']);
	});

	it('preserves --dangerously-skip-permissions', () => {
		expect(stripPrintArgs(['--dangerously-skip-permissions'])).toEqual([
			'--dangerously-skip-permissions',
		]);
	});

	it('preserves --model opus', () => {
		expect(stripPrintArgs(['--model', 'opus'])).toEqual(['--model', 'opus']);
	});

	it('preserves --resume <id>', () => {
		expect(stripPrintArgs(['--resume', 'abc-123'])).toEqual(['--resume', 'abc-123']);
	});

	it('preserves order of remaining args', () => {
		const input = [
			'--model',
			'opus',
			'--print',
			'--dangerously-skip-permissions',
			'--output-format',
			'stream-json',
			'--resume',
			'abc-123',
		];
		expect(stripPrintArgs(input)).toEqual([
			'--model',
			'opus',
			'--dangerously-skip-permissions',
			'--resume',
			'abc-123',
		]);
	});

	it('returns empty array when all args are stripped', () => {
		expect(stripPrintArgs(['--print', '--verbose', '-p'])).toEqual([]);
	});

	it('handles empty array', () => {
		expect(stripPrintArgs([])).toEqual([]);
	});
});

describe('deriveStableClaudeSessionId', () => {
	it('is deterministic for the same input', () => {
		const id = 'maestro-tab-abc123';
		expect(deriveStableClaudeSessionId(id)).toBe(deriveStableClaudeSessionId(id));
	});

	it('produces distinct IDs for distinct inputs', () => {
		const id1 = deriveStableClaudeSessionId('session-a');
		const id2 = deriveStableClaudeSessionId('session-b');
		expect(id1).not.toBe(id2);
	});

	it('matches UUID shape [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', () => {
		const id = deriveStableClaudeSessionId('any-session-id');
		expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
	});

	it('produces 36-character output', () => {
		const id = deriveStableClaudeSessionId('test');
		expect(id.length).toBe(36);
	});
});

describe('cleanTerminalChunk', () => {
	it('normalizes \\r\\n to \\n', () => {
		expect(cleanTerminalChunk('foo\r\nbar')).toBe('foo\nbar');
		const result = cleanTerminalChunk('line1\r\nline2');
		expect(result).toBe('line1\nline2');
		expect(result).not.toContain('\r');
	});

	it('normalizes bare \\r to \\n', () => {
		const result = cleanTerminalChunk('line1\rline2');
		expect(result).not.toContain('\r');
	});

	it('strips CSI clear-screen sequence \\x1b[2J', () => {
		const result = cleanTerminalChunk('\x1b[2Jhello');
		expect(result).not.toContain('\x1b');
		expect(result).toContain('hello');
	});

	it('strips CSI color sequences \\x1b[31mfoo\\x1b[0m', () => {
		const result = cleanTerminalChunk('\x1b[31mfoo\x1b[0m');
		expect(result).not.toContain('\x1b');
		expect(result).toContain('foo');
	});

	it('strips cursor movement sequences', () => {
		// \x1b[H moves cursor to home position
		const result = cleanTerminalChunk('\x1b[Hhello world');
		expect(result).not.toContain('\x1b[H');
		expect(result).toContain('hello world');
	});

	it('strips OSC title-set sequence', () => {
		// OSC sequences start with ESC ] and end with BEL or ST
		const result = cleanTerminalChunk('\x1b]0;Terminal Title\x07hello');
		expect(result).not.toContain('Terminal Title');
		expect(result).toContain('hello');
	});

	it('passes through plain text unchanged (modulo escape removal)', () => {
		expect(cleanTerminalChunk('plain text')).toBe('plain text');
	});
});

const APP_DEFAULT = { claudeCodeDefaultTransportMode: 'legacy-print' as const };
const APP_PTY = { claudeCodeDefaultTransportMode: 'interactive-pty' as const };

describe('resolveClaudeTransportMode', () => {
	test('all undefined → legacy-print', () => {
		expect(resolveClaudeTransportMode(undefined, undefined, undefined, APP_DEFAULT)).toBe(
			'legacy-print'
		);
	});

	test('only app set to interactive-pty → interactive-pty', () => {
		expect(resolveClaudeTransportMode(undefined, undefined, undefined, APP_PTY)).toBe(
			'interactive-pty'
		);
	});

	test('only project set to interactive-pty → interactive-pty', () => {
		expect(
			resolveClaudeTransportMode(
				undefined,
				undefined,
				{ transportMode: 'interactive-pty' },
				APP_DEFAULT
			)
		).toBe('interactive-pty');
	});

	test('only agent set to interactive-pty → interactive-pty', () => {
		expect(
			resolveClaudeTransportMode(
				undefined,
				{ transportMode: 'interactive-pty' },
				undefined,
				APP_DEFAULT
			)
		).toBe('interactive-pty');
	});

	test('only tab set to interactive-pty → interactive-pty', () => {
		expect(
			resolveClaudeTransportMode(
				{ transportMode: 'interactive-pty' },
				undefined,
				undefined,
				APP_DEFAULT
			)
		).toBe('interactive-pty');
	});

	test('strict ratchet: tab legacy-print cannot demote project interactive-pty', () => {
		expect(
			resolveClaudeTransportMode(
				{ transportMode: 'legacy-print' },
				undefined,
				{ transportMode: 'interactive-pty' },
				APP_DEFAULT
			)
		).toBe('interactive-pty');
	});

	test('tab interactive-pty while everything else is default → interactive-pty', () => {
		expect(
			resolveClaudeTransportMode(
				{ transportMode: 'interactive-pty' },
				{ transportMode: 'legacy-print' },
				{ transportMode: 'legacy-print' },
				APP_DEFAULT
			)
		).toBe('interactive-pty');
	});
});

describe('describeCascadeSource', () => {
	test('all undefined → legacy-print, source default', () => {
		expect(describeCascadeSource(undefined, undefined, undefined, APP_DEFAULT)).toEqual({
			mode: 'legacy-print',
			source: 'default',
		});
	});

	test('only app set to interactive-pty → source app', () => {
		expect(describeCascadeSource(undefined, undefined, undefined, APP_PTY)).toEqual({
			mode: 'interactive-pty',
			source: 'app',
		});
	});

	test('project + app both interactive-pty → source project (more specific)', () => {
		expect(
			describeCascadeSource(undefined, undefined, { transportMode: 'interactive-pty' }, APP_PTY)
		).toEqual({
			mode: 'interactive-pty',
			source: 'project',
		});
	});

	test('tab interactive-pty over legacy-print defaults → source tab', () => {
		expect(
			describeCascadeSource({ transportMode: 'interactive-pty' }, undefined, undefined, APP_DEFAULT)
		).toEqual({ mode: 'interactive-pty', source: 'tab' });
	});

	test('strict ratchet: tab legacy-print + project interactive-pty → source project', () => {
		expect(
			describeCascadeSource(
				{ transportMode: 'legacy-print' },
				undefined,
				{ transportMode: 'interactive-pty' },
				APP_DEFAULT
			)
		).toEqual({ mode: 'interactive-pty', source: 'project' });
	});

	test('tab interactive-pty while everything else is default → source tab', () => {
		expect(
			describeCascadeSource({ transportMode: 'interactive-pty' }, undefined, undefined, APP_DEFAULT)
		).toEqual({ mode: 'interactive-pty', source: 'tab' });
	});
});
