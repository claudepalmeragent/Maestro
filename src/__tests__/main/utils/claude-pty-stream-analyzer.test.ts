import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Mock @xterm/headless before importing the analyzer
vi.mock('@xterm/headless', () => {
	class MockTerminal {
		private _lines: string[] = [];
		readonly cols: number;

		constructor(opts?: { cols?: number; rows?: number }) {
			this.cols = opts?.cols ?? 120;
		}

		write(chunk: string): void {
			// Append lines from chunk for buffer simulation
			const lines = chunk.split('\n');
			for (const l of lines) {
				if (l) this._lines.push(l);
			}
		}

		get buffer() {
			const lines = this._lines;
			return {
				active: {
					get length() {
						return lines.length;
					},
					getLine: (i: number) => {
						const text = lines[i] ?? '';
						return {
							translateToString: (_trim?: boolean) => text,
						};
					},
				},
			};
		}
	}

	return { Terminal: MockTerminal };
});

import { ClaudePtyStreamAnalyzer } from '../../../main/utils/claude-pty-stream-analyzer';
import type { ParsedEvent } from '../../../main/parsers/agent-output-parser';

const FIXTURES_DIR = path.join(__dirname, '../../fixtures/claude-pty');

function loadFixture(name: string): string {
	return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf-8');
}

function makeAnalyzer(overrides?: {
	maestroSessionId?: string;
	claudeSessionId?: string;
	onEvent?: (e: ParsedEvent) => void;
	onTurnComplete?: () => void;
}) {
	const events: ParsedEvent[] = [];
	const turnCompletes: number[] = [];

	const analyzer = new ClaudePtyStreamAnalyzer(
		overrides?.maestroSessionId ?? 'maestro-session-1',
		overrides?.claudeSessionId ?? 'claude-session-1',
		{
			onEvent: overrides?.onEvent ?? ((e) => events.push(e)),
			onTurnComplete: overrides?.onTurnComplete ?? (() => turnCompletes.push(Date.now())),
		}
	);

	return { analyzer, events, turnCompletes };
}

describe('ClaudePtyStreamAnalyzer', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('init event', () => {
		it('fires init event with correct claudeSessionId on first ingest', () => {
			const { analyzer, events } = makeAnalyzer({ claudeSessionId: 'my-claude-session' });
			analyzer.ingest('Hello');

			expect(events).toHaveLength(2); // init + text
			expect(events[0].type).toBe('init');
			expect(events[0].sessionId).toBe('my-claude-session');
			expect(events[0].raw).toMatchObject({ source: 'claude-pty-runner' });
		});

		it('fires init event only once across multiple ingests', () => {
			const { analyzer, events } = makeAnalyzer();
			analyzer.ingest('chunk1');
			analyzer.ingest('chunk2');

			const initEvents = events.filter((e) => e.type === 'init');
			expect(initEvents).toHaveLength(1);
		});
	});

	describe('simple task fixture', () => {
		it('emits init → text events → result event → onTurnComplete', () => {
			const fixture = loadFixture('simple-task.txt');
			const { analyzer, events, turnCompletes } = makeAnalyzer();

			// Feed the fixture in chunks
			const lines = fixture.split('\n');
			for (const line of lines) {
				analyzer.ingest(line + '\n');
			}

			const initEvents = events.filter((e) => e.type === 'init');
			const textEvents = events.filter((e) => e.type === 'text');
			const resultEvents = events.filter((e) => e.type === 'result');

			expect(initEvents).toHaveLength(1);
			expect(textEvents.length).toBeGreaterThan(0);
			expect(resultEvents).toHaveLength(1);
			expect(turnCompletes).toHaveLength(1);
		});

		it('result event contains accumulated assistant text', () => {
			const fixture = loadFixture('simple-task.txt');
			const { analyzer, events } = makeAnalyzer();

			for (const line of fixture.split('\n')) {
				analyzer.ingest(line + '\n');
			}

			const resultEvent = events.find((e) => e.type === 'result');
			expect(resultEvent?.text).toBeTruthy();
			expect(typeof resultEvent?.text).toBe('string');
		});
	});

	describe('tool-using task fixture', () => {
		it('text events accumulate assistant content through tool calls', () => {
			const fixture = loadFixture('tool-using-task.txt');
			const { analyzer, events } = makeAnalyzer();

			for (const line of fixture.split('\n')) {
				analyzer.ingest(line + '\n');
			}

			const textEvents = events.filter((e) => e.type === 'text');
			const combined = textEvents.map((e) => e.text ?? '').join('');

			// Should contain some tool-related content from the fixture
			expect(combined).toContain('read that file');
		});
	});

	describe('error task fixture', () => {
		it('getExitReason returns AGENT_ERROR after error signature appears', () => {
			const fixture = loadFixture('error-task.txt');
			const { analyzer } = makeAnalyzer();

			for (const line of fixture.split('\n')) {
				analyzer.ingest(line + '\n');
			}

			expect(analyzer.getExitReason()).toBe('AGENT_ERROR');
		});
	});

	describe('echo cancellation', () => {
		it('suppresses the echoed prompt from text events', () => {
			const { analyzer, events } = makeAnalyzer();
			analyzer.expectEcho('what is 2+2?\n');
			analyzer.ingest('what is 2+2?\n4\n');

			const textEvents = events.filter((e) => e.type === 'text');
			const combined = textEvents.map((e) => e.text ?? '').join('');
			expect(combined).not.toContain('what is 2+2?');
			expect(combined).toContain('4');
		});

		it('does not emit text event at all when chunk is pure echo', () => {
			const { analyzer, events } = makeAnalyzer();
			analyzer.expectEcho('hello world\n');
			analyzer.ingest('hello world\n');

			const textEvents = events.filter((e) => e.type === 'text');
			expect(textEvents).toHaveLength(0);
		});

		it('echo cancellation with line-wrap: long prompt wrapped at 120 cols still cancelled', () => {
			const longPrompt = 'A'.repeat(130);
			const { analyzer, events } = makeAnalyzer();
			analyzer.expectEcho(longPrompt + '\n');

			// Simulate wrapped echo: first 120 chars on line 1, rest on line 2
			const wrapped = longPrompt.slice(0, 120) + '\n' + longPrompt.slice(120) + '\n';
			analyzer.ingest(wrapped + 'response text\n');

			const textEvents = events.filter((e) => e.type === 'text');
			const combined = textEvents.map((e) => e.text ?? '').join('');
			expect(combined).not.toContain('AAAAAA');
			expect(combined).toContain('response text');
		});
	});

	describe('idle prompt without completion phrase', () => {
		it('does NOT fire onTurnComplete when idle prompt seen but no completion phrase', () => {
			const { analyzer, turnCompletes } = makeAnalyzer();

			// Idle prompt marker without any completion phrase
			analyzer.ingest('Working on it...\n');
			analyzer.ingest('╰─ (claude) ❯ \n');

			expect(turnCompletes).toHaveLength(0);
		});
	});

	describe('completion phrase inside thinking block', () => {
		it('does NOT fire onTurnComplete when completion phrase is inside <thinking>', () => {
			const { analyzer, turnCompletes } = makeAnalyzer();

			analyzer.ingest('<thinking>Task complete</thinking>\n');
			analyzer.ingest('╰─ (claude) ❯ \n');

			expect(turnCompletes).toHaveLength(0);
		});
	});

	describe('reset()', () => {
		it('clears all internal state including hasInitFired', () => {
			const { analyzer, events } = makeAnalyzer();
			analyzer.ingest('some text');

			const initCountBefore = events.filter((e) => e.type === 'init').length;
			expect(initCountBefore).toBe(1);

			// After reset, should fire init again on next ingest
			analyzer.reset();
			analyzer.ingest('more text');

			const initCountAfter = events.filter((e) => e.type === 'init').length;
			expect(initCountAfter).toBe(2);
		});

		it('clears getExitReason back to SUCCESS after reset', () => {
			const { analyzer } = makeAnalyzer();
			analyzer.ingest('Error: something went wrong\n');
			expect(analyzer.getExitReason()).toBe('AGENT_ERROR');

			analyzer.reset();
			expect(analyzer.getExitReason()).toBe('SUCCESS');
		});
	});

	describe('thinking block detection', () => {
		it('emits thinking content with thinking-shaped raw', () => {
			const { analyzer, events } = makeAnalyzer();
			analyzer.ingest('<thinking>I am reasoning here</thinking>\nMy response.\n');

			const thinkingEvents = events.filter(
				(e) =>
					e.type === 'text' &&
					(e.raw as { message?: { content?: Array<{ type: string }> } })?.message?.content?.[0]
						?.type === 'thinking'
			);
			expect(thinkingEvents.length).toBeGreaterThan(0);
		});

		it('emits non-thinking text as plain text events', () => {
			const { analyzer, events } = makeAnalyzer();
			analyzer.ingest('<thinking>internal</thinking>public response\n');

			const plainTextEvents = events.filter(
				(e) => e.type === 'text' && !(e.raw as { message?: unknown })?.message
			);
			const combined = plainTextEvents.map((e) => e.text ?? '').join('');
			expect(combined).toContain('public response');
			expect(combined).not.toContain('internal');
		});
	});
});
