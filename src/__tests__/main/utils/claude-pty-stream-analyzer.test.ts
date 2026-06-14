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

// Default: JSONL reader returns null so tests don't hit the FS. Tests that specifically
// assert on the result event override this mock per-test via vi.mocked().mockResolvedValueOnce.
vi.mock('../../../main/utils/claude-session-jsonl-reader', () => ({
	readLatestAssistantTurn: vi.fn().mockResolvedValue(null),
}));

import { ClaudePtyStreamAnalyzer } from '../../../main/utils/claude-pty-stream-analyzer';
import type { ParsedEvent } from '../../../main/parsers/agent-output-parser';
import { resolveMarkers } from '../../../main/utils/claude-pty-markers';
import type { VersionMarkers } from '../../../main/utils/claude-pty-markers';
import { readLatestAssistantTurn } from '../../../main/utils/claude-session-jsonl-reader';

const FIXTURES_DIR = path.join(__dirname, '../../fixtures/claude-pty');

function loadFixture(name: string): string {
	return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf-8');
}

function makeAnalyzerWith(
	markers: VersionMarkers,
	overrides?: {
		onEvent?: (e: ParsedEvent) => void;
		onTurnComplete?: () => void;
	}
) {
	const events: ParsedEvent[] = [];
	const turnCompletes: number[] = [];

	const analyzer = new ClaudePtyStreamAnalyzer(
		'maestro-session-1',
		'claude-session-1',
		{
			onEvent: overrides?.onEvent ?? ((e) => events.push(e)),
			onTurnComplete: overrides?.onTurnComplete ?? (() => turnCompletes.push(Date.now())),
		},
		markers
	);
	// Simulate post-prompt-write state: completion signals are gated until beginTurn()
	// is called by the runner.  Tests in this helper expect completion to be active.
	analyzer.beginTurn();

	return { analyzer, events, turnCompletes };
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
	// Simulate post-prompt-write state (see makeAnalyzerWith above).
	analyzer.beginTurn();

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
		// The simple-task fixture ends with '╰─ (claude) ❯' which matches the '*' default
		// idlePromptMarkers. These tests use explicit '*' markers to exercise the fast-path.
		it('emits init → text events → result event → onTurnComplete', async () => {
			// result event is now async-sourced from JSONL reader; override mock to emit one.
			vi.mocked(readLatestAssistantTurn).mockResolvedValueOnce({
				text: 'fixture result text',
				contentBlocks: [{ type: 'text', text: 'fixture result text' }],
				timestamp: new Date().toISOString(),
				stopReason: 'end_turn',
			});

			const fixture = loadFixture('simple-task.txt');
			const { analyzer, events, turnCompletes } = makeAnalyzerWith(resolveMarkers('*'));

			// Feed the fixture in chunks
			const lines = fixture.split('\n');
			for (const line of lines) {
				analyzer.ingest(line + '\n');
			}

			// Flush the async JSONL read promise (two microtask ticks: mock resolution + .then)
			await Promise.resolve();
			await Promise.resolve();

			const initEvents = events.filter((e) => e.type === 'init');
			const textEvents = events.filter((e) => e.type === 'text');
			const resultEvents = events.filter((e) => e.type === 'result');

			expect(initEvents).toHaveLength(1);
			expect(textEvents.length).toBeGreaterThan(0);
			// Two result events expected: synchronous pty-buffer + async claude-session-jsonl-reader.
			const sources = resultEvents.map((e) => (e as { raw?: { source?: string } }).raw?.source);
			expect(sources).toContain('claude-session-jsonl-reader');
			expect(turnCompletes).toHaveLength(1);
		});

		it('result event text is sourced from JSONL reader', async () => {
			// Previously, result text was accumulated from PTY chunks; now it comes from JSONL.
			vi.mocked(readLatestAssistantTurn).mockResolvedValueOnce({
				text: 'response from jsonl',
				contentBlocks: [{ type: 'text', text: 'response from jsonl' }],
				timestamp: new Date().toISOString(),
				stopReason: 'end_turn',
			});

			const fixture = loadFixture('simple-task.txt');
			const { analyzer, events } = makeAnalyzerWith(resolveMarkers('*'));

			for (const line of fixture.split('\n')) {
				analyzer.ingest(line + '\n');
			}

			// Flush the async JSONL read promise
			await Promise.resolve();
			await Promise.resolve();

			const jsonlResult = events.find(
				(e) =>
					e.type === 'result' &&
					(e as { raw?: { source?: string } }).raw?.source === 'claude-session-jsonl-reader'
			);
			expect(jsonlResult?.text).toBeTruthy();
			expect(typeof jsonlResult?.text).toBe('string');
			expect(jsonlResult?.text).toBe('response from jsonl');
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
		// These tests use explicit '*' default markers since they exercise the S3 idle-prompt
		// fast-path. The '╰─' / '❯' patterns only appear in the '*' default idlePromptMarkers.
		it('does NOT fire onTurnComplete synchronously when idle prompt seen but no completion phrase', () => {
			const { analyzer, turnCompletes } = makeAnalyzerWith(resolveMarkers('*'));

			// Idle prompt marker without any completion phrase
			analyzer.ingest('Working on it...\n');
			analyzer.ingest('╰─ (claude) ❯ \n');

			expect(turnCompletes).toHaveLength(0);
		});

		it('DOES fire onTurnComplete after debounce window when idle prompt persists', () => {
			vi.useFakeTimers();
			try {
				const { analyzer, turnCompletes } = makeAnalyzerWith(resolveMarkers('*'));

				analyzer.ingest('Working on it...\n');
				analyzer.ingest('╰─ (claude) ❯ \n');
				expect(turnCompletes).toHaveLength(0);

				vi.advanceTimersByTime(1500);
				expect(turnCompletes).toHaveLength(1);
			} finally {
				vi.useRealTimers();
			}
		});

		it('debounce timer is NOT cancelled by subsequent non-prompt chunks (spinner cleanup tolerated)', () => {
			// Real claude v2.1.141 emits spinner/status frames AFTER the REPL prompt
			// returns. Those frames produce outsideText but do not mean Claude is still
			// responding. The analyzer must not let them defer turn-completion.
			vi.useFakeTimers();
			try {
				const { analyzer, turnCompletes } = makeAnalyzerWith(resolveMarkers('*'));

				analyzer.ingest('partial reply\n');
				analyzer.ingest('╰─ (claude) ❯ \n'); // timer armed, fires at +1500ms

				vi.advanceTimersByTime(500);
				analyzer.ingest('· spinner frame\n'); // simulates post-prompt spinner update

				vi.advanceTimersByTime(1000); // total 1500ms from initial arm
				expect(turnCompletes).toHaveLength(1);
			} finally {
				vi.useRealTimers();
			}
		});

		it('fires synchronously on the fast path when completion phrase + idle marker both present', () => {
			const { analyzer, turnCompletes } = makeAnalyzerWith(resolveMarkers('*'));

			analyzer.ingest('Done!\n');
			analyzer.ingest('╰─ (claude) ❯ \n');

			expect(turnCompletes).toHaveLength(1);
		});

		it('dispose() prevents a pending debounce timer from firing', () => {
			vi.useFakeTimers();
			try {
				const { analyzer, turnCompletes } = makeAnalyzer();

				analyzer.ingest('partial\n');
				analyzer.ingest('╰─ (claude) ❯ \n');

				analyzer.dispose();
				vi.advanceTimersByTime(3000);

				expect(turnCompletes).toHaveLength(0);
			} finally {
				vi.useRealTimers();
			}
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

	describe('multi-signal detector (version-aware markers)', () => {
		describe('S1: help-line marker fires immediately', () => {
			it('fires onTurnComplete synchronously for a version with helpLineMarkers', () => {
				// Use the '*' default which has "? for shortcuts" as a help-line marker.
				// v2.1.141 has helpLineMarkers: [] because that text renders continuously
				// in the REPL status bar (not a reliable idle indicator in that version).
				const { analyzer, turnCompletes } = makeAnalyzerWith(resolveMarkers('*'));
				analyzer.ingest('Some response text\n');
				expect(turnCompletes).toHaveLength(0);
				analyzer.ingest('? for shortcuts');
				expect(turnCompletes).toHaveLength(1);
			});

			it('does not require debounce — fires before any timer advancement', () => {
				vi.useFakeTimers();
				try {
					const { analyzer, turnCompletes } = makeAnalyzerWith(resolveMarkers('*'));
					analyzer.ingest('? for shortcuts');
					// synchronous — no vi.advanceTimersByTime needed
					expect(turnCompletes).toHaveLength(1);
				} finally {
					vi.useRealTimers();
				}
			});

			it('fires only once even if the marker appears in multiple chunks', () => {
				const { analyzer, turnCompletes } = makeAnalyzerWith(resolveMarkers('*'));
				analyzer.ingest('? for shortcuts');
				analyzer.ingest('? for shortcuts');
				expect(turnCompletes).toHaveLength(1);
			});

			it('v2.1.141 does NOT fire S1 on "? for shortcuts" (status bar renders it continuously)', () => {
				// v2.1.141 helpLineMarkers is intentionally empty — the status bar shows
				// "? for shortcuts" during response generation, not just at idle.
				const { analyzer, turnCompletes } = makeAnalyzerWith(resolveMarkers('2.1.141'));
				analyzer.ingest('? for shortcuts');
				expect(turnCompletes).toHaveLength(0);
			});
		});

		describe('S2: completion-stats marker fires immediately', () => {
			// v2.1.141 completionStatsMarkers is intentionally empty (ARD 1.4 option b):
			// mode-variant fixture analysis found no pattern that fires exclusively at
			// end-of-turn across all three config modes. Trough detector is primary for
			// this version. These tests verify that v2.1.141 does NOT fire on stats lines
			// and that the '*' default (older claude) still does.
			it('v2.1.141 does NOT fire on "✻ Cooked for 3s" (trough detector handles this version)', () => {
				vi.useFakeTimers();
				try {
					const { analyzer, turnCompletes } = makeAnalyzerWith(resolveMarkers('2.1.141'));
					analyzer.ingest('Some work done\n');
					analyzer.ingest('✻ Cooked for 3s');
					expect(turnCompletes).toHaveLength(0);
				} finally {
					vi.useRealTimers();
				}
			});

			it('v2.1.141 does NOT fire on "✓ Done in 4s" (trough detector handles this version)', () => {
				vi.useFakeTimers();
				try {
					const { analyzer, turnCompletes } = makeAnalyzerWith(resolveMarkers('2.1.141'));
					analyzer.ingest('Work text\n');
					analyzer.ingest('✓ Done in 4s');
					expect(turnCompletes).toHaveLength(0);
				} finally {
					vi.useRealTimers();
				}
			});

			it('"*" default fires synchronously on "✓ Done in 4s" (older claude versions)', () => {
				const { analyzer, turnCompletes } = makeAnalyzerWith(resolveMarkers('*'));
				analyzer.ingest('Work text\n');
				analyzer.ingest('✓ Done in 4s');
				expect(turnCompletes).toHaveLength(1);
			});

			it('does NOT fire on a bare spinner glyph without duration stats', () => {
				vi.useFakeTimers();
				try {
					const { analyzer, turnCompletes } = makeAnalyzerWith(resolveMarkers('2.1.141'));
					analyzer.ingest('✻ working...');
					expect(turnCompletes).toHaveLength(0);
				} finally {
					vi.useRealTimers();
				}
			});
		});

		describe('S3: idle-prompt + 1.5s debounce ("*" default markers)', () => {
			// v2.1.141 has idlePromptMarkers:[] because ❯ renders continuously during
			// response generation. These S3 tests use the "*" default which has ❯ / ╰─
			// as idle markers (valid for older claude versions where ❯ is idle-specific).
			it('fires after 1.5s when the idle prompt is detected', () => {
				vi.useFakeTimers();
				try {
					const { analyzer, turnCompletes } = makeAnalyzerWith(resolveMarkers('*'));
					analyzer.ingest('Some response\n');
					analyzer.ingest('❯ ');
					expect(turnCompletes).toHaveLength(0);
					vi.advanceTimersByTime(1500);
					expect(turnCompletes).toHaveLength(1);
				} finally {
					vi.useRealTimers();
				}
			});

			it('does NOT fire before the 1.5s window elapses', () => {
				vi.useFakeTimers();
				try {
					const { analyzer, turnCompletes } = makeAnalyzerWith(resolveMarkers('*'));
					analyzer.ingest('❯ ');
					vi.advanceTimersByTime(1499);
					expect(turnCompletes).toHaveLength(0);
				} finally {
					vi.useRealTimers();
				}
			});

			it('debounce fires once even if idle prompt appears in multiple chunks (timer is not re-armed)', () => {
				vi.useFakeTimers();
				try {
					const { analyzer, turnCompletes } = makeAnalyzerWith(resolveMarkers('*'));
					analyzer.ingest('❯ ');
					vi.advanceTimersByTime(500);
					analyzer.ingest('❯ '); // second observation — timer already armed, stays at original deadline
					vi.advanceTimersByTime(1000); // 1500ms total from first arm
					expect(turnCompletes).toHaveLength(1);
				} finally {
					vi.useRealTimers();
				}
			});
		});

		describe('S4: spinner-glyph cessation ("*" default markers, no grace period)', () => {
			// S4 unit tests use "*" default markers (postPromptGraceMs=undefined → 0ms grace)
			// so the timer arms immediately without needing to advance past a grace window.
			// v2.1.141-specific grace-period behavior is tested in the dedicated block below.
			it('fires after 1.5s of no spinner chunks following a spinner observation', () => {
				vi.useFakeTimers();
				try {
					const { analyzer, turnCompletes } = makeAnalyzerWith(resolveMarkers('*'));
					analyzer.ingest('✻ processing...'); // spinner glyph → seenSpinnerGlyph = true
					expect(turnCompletes).toHaveLength(0);
					analyzer.ingest('regular text'); // no spinner → timer starts
					vi.advanceTimersByTime(1500);
					expect(turnCompletes).toHaveLength(1);
				} finally {
					vi.useRealTimers();
				}
			});

			it('does NOT fire when a new spinner chunk arrives before the stop-timer expires', () => {
				vi.useFakeTimers();
				try {
					const { analyzer, turnCompletes } = makeAnalyzerWith(resolveMarkers('*'));
					analyzer.ingest('✻ processing...');
					analyzer.ingest('partial output'); // timer starts
					vi.advanceTimersByTime(500);
					analyzer.ingest('✻ still spinning'); // timer cleared
					vi.advanceTimersByTime(2000); // no new chunks — timer was cleared, nothing fires
					expect(turnCompletes).toHaveLength(0);
				} finally {
					vi.useRealTimers();
				}
			});

			it('does NOT fire when only spinner chunks arrive (S4 timer never starts without a non-spinner chunk)', () => {
				vi.useFakeTimers();
				try {
					const { analyzer, turnCompletes } = makeAnalyzerWith(resolveMarkers('*'));
					analyzer.ingest('✻ working');
					analyzer.ingest('✻ working');
					analyzer.ingest('✻ working');
					// Advance to 2999ms — well past S4 debounce (1500ms) but < SETUP_GRACE_MS
					// (3000ms). S4 never armed because no non-spinner chunk followed; trough
					// suppressed by grace window. Both mechanisms correctly produce no fire.
					vi.advanceTimersByTime(2999);
					expect(turnCompletes).toHaveLength(0);
				} finally {
					vi.useRealTimers();
				}
			});

			it('dispose() prevents spinner-stop timer from firing', () => {
				vi.useFakeTimers();
				try {
					const { analyzer, turnCompletes } = makeAnalyzerWith(resolveMarkers('*'));
					analyzer.ingest('✻ processing...');
					analyzer.ingest('regular text'); // timer starts
					analyzer.dispose();
					vi.advanceTimersByTime(3000);
					expect(turnCompletes).toHaveLength(0);
				} finally {
					vi.useRealTimers();
				}
			});
		});

		describe('v2.1.141 postPromptGraceMs: startup spinners do NOT arm S4', () => {
			// v2.1.141 has postPromptGraceMs=2000. Spinner chunks arriving within 2s of
			// beginTurn() (startup banner phase) must not arm the S4 cessation timer.
			it('does NOT arm S4 when spinner arrives within postPromptGraceMs window', () => {
				vi.useFakeTimers();
				try {
					const { analyzer, turnCompletes } = makeAnalyzerWith(resolveMarkers('2.1.141'));
					// Simulate startup banner arriving immediately (within 0ms of beginTurn)
					analyzer.ingest('✻ startup spinner');
					analyzer.ingest('no spinner — startup quiet');
					// Advance 2999ms — well past the 1500ms S4 debounce, and within both
					// postPromptGraceMs=2000ms AND SETUP_GRACE_MS=3000ms (trough suppressed).
					// S4 must not fire because spinner arrived before grace expired.
					vi.advanceTimersByTime(2999);
					expect(turnCompletes).toHaveLength(0);
				} finally {
					vi.useRealTimers();
				}
			});

			it('DOES arm S4 when spinner arrives after postPromptGraceMs has elapsed', () => {
				vi.useFakeTimers();
				try {
					const { analyzer, turnCompletes } = makeAnalyzerWith(resolveMarkers('2.1.141'));
					// Advance past the 2000ms grace period before any spinner arrives
					vi.advanceTimersByTime(2001);
					analyzer.ingest('◐ thinking spinner');
					analyzer.ingest('response text'); // no spinner → S4 armed
					vi.advanceTimersByTime(1500);
					expect(turnCompletes).toHaveLength(1);
				} finally {
					vi.useRealTimers();
				}
			});

			it('v2.1.141 S3 never fires because idlePromptMarkers is empty', () => {
				vi.useFakeTimers();
				try {
					const { analyzer, turnCompletes } = makeAnalyzerWith(resolveMarkers('2.1.141'));
					// ❯ present in every chunk — S3 must NOT fire since idlePromptMarkers=[]
					analyzer.ingest('❯ response text\n');
					analyzer.ingest('❯ more text\n');
					// Advance 2999ms — well past S3 debounce (1500ms) but < SETUP_GRACE_MS
					// (3000ms) so the trough poll timer is also suppressed. S3 never armed
					// because idlePromptMarkers=[] for v2.1.141.
					vi.advanceTimersByTime(2999);
					expect(turnCompletes).toHaveLength(0);
				} finally {
					vi.useRealTimers();
				}
			});
		});

		describe('S5: completion-phrase + idle-prompt legacy fast-path (back-compat with "*" markers)', () => {
			it('simple-task fixture still fires via the S5 fast-path with "*" default markers', async () => {
				// result event is now async-sourced from JSONL reader; override mock to emit one.
				vi.mocked(readLatestAssistantTurn).mockResolvedValueOnce({
					text: 's5-result',
					contentBlocks: [{ type: 'text', text: 's5-result' }],
					timestamp: new Date().toISOString(),
					stopReason: 'end_turn',
				});

				const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
				const markers = resolveMarkers('unknown-xyz');
				warnSpy.mockRestore();

				const { analyzer, events, turnCompletes } = makeAnalyzerWith(markers);

				const fixture = loadFixture('simple-task.txt');
				for (const line of fixture.split('\n')) {
					analyzer.ingest(line + '\n');
				}

				// Flush the async JSONL read promise
				await Promise.resolve();
				await Promise.resolve();

				// pty-buffer (sync) + claude-session-jsonl-reader (async)
				const sources = events
					.filter((e) => e.type === 'result')
					.map((e) => (e as { raw?: { source?: string } }).raw?.source);
				expect(sources).toContain('claude-session-jsonl-reader');
				expect(turnCompletes).toHaveLength(1);
			});

			it('fires immediately (no debounce) when completion phrase + idle prompt appear together', () => {
				const { analyzer, turnCompletes } = makeAnalyzerWith(resolveMarkers('*'));
				analyzer.ingest('Task complete\n');
				analyzer.ingest('╰─ (claude) ❯ \n');
				expect(turnCompletes).toHaveLength(1);
			});
		});
	});
});
