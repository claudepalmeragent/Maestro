import { describe, it, expect } from 'vitest';
import {
	stripPrintArgs,
	deriveStableClaudeSessionId,
	cleanTerminalChunk,
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
