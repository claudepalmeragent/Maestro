import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mutable fake-buffer state so individual tests can shape the headless terminal's
// visible buffer before triggering the trough.
const fakeBuffer: { lines: string[] } = { lines: [] };

vi.mock('@xterm/headless', () => {
	class MockTerminal {
		readonly cols: number;

		constructor(opts?: { cols?: number; rows?: number; scrollback?: number }) {
			this.cols = opts?.cols ?? 120;
		}

		write(_chunk: string): void {}

		get buffer() {
			return {
				active: {
					get length() {
						return fakeBuffer.lines.length;
					},
					getLine: (i: number) => {
						const text = fakeBuffer.lines[i] ?? '';
						return { translateToString: (_trimRight?: boolean) => text };
					},
				},
			};
		}
	}

	return { Terminal: MockTerminal };
});

const mockReadLatestAssistantTurn = vi.fn();
vi.mock('../../../main/utils/claude-session-jsonl-reader', () => ({
	readLatestAssistantTurn: (...args: unknown[]) => mockReadLatestAssistantTurn(...args),
}));

import { ClaudePtyStreamAnalyzer } from '../../../main/utils/claude-pty-stream-analyzer';
import type { ParsedEvent } from '../../../main/parsers/agent-output-parser';

const SETUP_GRACE_MS = 3000;
const TROUGH_WINDOW_MS = 2500;

function makeAnalyzerAndFireTrough() {
	const events: ParsedEvent[] = [];
	const order: string[] = [];
	const analyzer = new ClaudePtyStreamAnalyzer(
		'test-maestro-session',
		'test-claude-session-uuid',
		{
			onEvent: (e) => {
				events.push(e);
				if (e.type === 'result') {
					const src = (e as { raw?: { source?: string } }).raw?.source ?? 'unknown';
					order.push(`result:${src}`);
				}
			},
			onTurnComplete: () => order.push('turnComplete'),
		},
		undefined,
		'/app/test-cwd'
	);

	analyzer.beginTurn();
	vi.advanceTimersByTime(SETUP_GRACE_MS + 1);
	analyzer.ingest('initial content');
	vi.advanceTimersByTime(TROUGH_WINDOW_MS);
	analyzer.ingest('x');

	return { analyzer, events, order };
}

describe('ClaudePtyStreamAnalyzer → buffer-extraction result event', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		mockReadLatestAssistantTurn.mockReset();
		mockReadLatestAssistantTurn.mockResolvedValue(null);
		fakeBuffer.lines = [];
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('emits a synchronous result event sourced from pty-buffer when the buffer is non-empty', () => {
		fakeBuffer.lines = ['● Claude:', 'Here is the answer.', ''];

		const { events, order } = makeAnalyzerAndFireTrough();

		const bufferResults = events.filter(
			(e) =>
				e.type === 'result' && (e as { raw?: { source?: string } }).raw?.source === 'pty-buffer'
		);
		expect(bufferResults).toHaveLength(1);
		expect(bufferResults[0].text).toBe('● Claude:\nHere is the answer.');
		expect(bufferResults[0].sessionId).toBe('test-claude-session-uuid');

		// Buffer-sourced event fires synchronously, BEFORE onTurnComplete().
		expect(order[0]).toBe('result:pty-buffer');
		expect(order).toContain('turnComplete');
	});

	it('does not emit a buffer result when the visible buffer is empty / whitespace-only', () => {
		fakeBuffer.lines = ['', '   ', ''];

		const { events } = makeAnalyzerAndFireTrough();

		const bufferResults = events.filter(
			(e) =>
				e.type === 'result' && (e as { raw?: { source?: string } }).raw?.source === 'pty-buffer'
		);
		expect(bufferResults).toHaveLength(0);
	});

	it('emits both pty-buffer (sync) and claude-session-jsonl-reader (async) result events on the same turn', async () => {
		fakeBuffer.lines = ['rendered text'];
		mockReadLatestAssistantTurn.mockResolvedValue({
			text: 'authoritative text',
			contentBlocks: [{ type: 'text', text: 'authoritative text' }],
			timestamp: new Date().toISOString(),
			stopReason: 'end_turn',
		});

		const { events, order } = makeAnalyzerAndFireTrough();

		// Sync: pty-buffer + turnComplete already happened.
		expect(order).toEqual(['result:pty-buffer', 'turnComplete']);

		// Flush microtasks so the async JSONL event lands.
		await Promise.resolve();
		await Promise.resolve();

		const sources = events
			.filter((e) => e.type === 'result')
			.map((e) => (e as { raw?: { source?: string } }).raw?.source);
		expect(sources).toEqual(['pty-buffer', 'claude-session-jsonl-reader']);
	});

	it('getVisibleBuffer() trims trailing blank lines but preserves internal blanks', () => {
		fakeBuffer.lines = ['line one', '', 'line two', '', '   ', ''];

		const analyzer = new ClaudePtyStreamAnalyzer(
			'm',
			'c',
			{ onEvent: () => {}, onTurnComplete: () => {} },
			undefined,
			'/app/test'
		);

		expect(analyzer.getVisibleBuffer()).toBe('line one\n\nline two');
	});
});
