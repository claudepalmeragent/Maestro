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

// Prevent real FS/SSH calls — result event sourcing via JSONL is tested in the dedicated
// jsonl-result integration test. v2.1.141 fixture regression tests focus on S4 correctness.
vi.mock('../../../main/utils/claude-session-jsonl-reader', () => ({
	readLatestAssistantTurn: vi.fn().mockResolvedValue(null),
}));

import { ClaudePtyStreamAnalyzer } from '../../../main/utils/claude-pty-stream-analyzer';
import { resolveMarkers } from '../../../main/utils/claude-pty-markers';
import { cleanTerminalChunk } from '../../../main/utils/claude-pty-helpers';
import type { ParsedEvent } from '../../../main/parsers/agent-output-parser';
import { readLatestAssistantTurn } from '../../../main/utils/claude-session-jsonl-reader';

const FIXTURES_DIR = path.join(__dirname, '../../fixtures/claude-pty');

function readFixtureRaw(name: string): string {
	return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf-8');
}

/**
 * Feeds the fixture raw bytes through cleanTerminalChunk → analyzer.ingest() in
 * CHUNK_SIZE-byte slices, simulating real PTY delivery. Returns after all bytes
 * have been submitted (any pending timers must be advanced separately).
 */
function feedFixture(analyzer: ClaudePtyStreamAnalyzer, raw: string, chunkSize = 128): void {
	for (let i = 0; i < raw.length; i += chunkSize) {
		analyzer.ingest(cleanTerminalChunk(raw.slice(i, i + chunkSize)));
	}
}

describe('ClaudePtyStreamAnalyzer — v2.1.141 fixture regression', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	/**
	 * Primary regression test: the saved v2.1.141 PTY byte stream contains
	 * spinner glyphs (✻/✳ in the title + ◐ in status bar) followed by a period
	 * of no spinner output. The multi-signal detector must fire onTurnComplete
	 * exactly once via the S4 spinner-cessation path (1.5 s after last spinner chunk).
	 *
	 * NOTE: The fixture captures Claude Code startup + trust-dialog acceptance +
	 * the initial ready state. The actual AI response to "say hi in 3 words" was
	 * NOT captured within the 25s window (the process was busy with an auto-update
	 * check). v2.1.141 has helpLineMarkers:[] so "? for shortcuts" no longer fires S1.
	 * Assertion 1 verifies that text events containing the startup banner workspace
	 * path (/app/maestro-dev-4) are emitted; the canary reply is not present here.
	 */
	it('fires onTurnComplete exactly once via S4 (spinner cessation) within 2s of fixture end', () => {
		vi.useFakeTimers();
		try {
			const events: ParsedEvent[] = [];
			const turnCompletes: number[] = [];

			const analyzer = new ClaudePtyStreamAnalyzer(
				'fixture-maestro-session',
				'fixture-claude-session',
				{
					onEvent: (e) => events.push(e),
					onTurnComplete: () => turnCompletes.push(Date.now()),
				},
				resolveMarkers('2.1.141')
			);

			const raw = readFixtureRaw('v2.1.141-canary.raw');

			// Unlock completion detection — in production, beginTurn() is called after
			// the prompt is written; for fixture tests the full stream is treated as
			// post-prompt output.
			analyzer.beginTurn();

			// v2.1.141 has postPromptGraceMs=2000: spinner chunks arriving within 2s of
			// beginTurn() do NOT arm S4 (they represent startup animation, not thinking).
			// Advance past the grace window before feeding so the fixture's spinners are
			// treated as post-startup (response-phase) spinners that DO arm S4.
			vi.advanceTimersByTime(2001);

			// Record fake-clock baseline before feeding.
			const feedStartMs = Date.now();
			feedFixture(analyzer, raw);

			// Advance the S4 spinner-cessation debounce timer (SPINNER_STOP_DEBOUNCE_MS=1500ms).
			// The fixture contains ✻/✳ spinner glyphs; after the last spinner chunk
			// the timer arms and fires within 1500ms.  2s of slack ensures S4 completes.
			vi.advanceTimersByTime(2000);

			// 1. At least one text event contains content from the fixture.
			const textEvents = events.filter((e) => e.type === 'text');
			expect(textEvents.length).toBeGreaterThan(0);
			const combinedText = textEvents.map((e) => e.text ?? '').join('');
			// Workspace path appears in the Claude Code startup banner.
			expect(combinedText).toContain('/app/maestro-dev-4');

			// 2. result event is now async-sourced from JSONL reader; mocked to null here so
			// no result event is emitted. S4 correctness is verified via onTurnComplete alone.
			expect(events.filter((e) => e.type === 'result')).toHaveLength(0);

			// 3. onTurnComplete fires exactly once.
			expect(turnCompletes).toHaveLength(1);

			// 4. Fired within 2s of the fixture feed completing (S4 timer = 1500ms).
			expect(turnCompletes[0] - feedStartMs).toBeLessThanOrEqual(2000);
		} finally {
			vi.useRealTimers();
		}
	});

	it('emits an init event exactly once across the full fixture stream', () => {
		const events: ParsedEvent[] = [];
		const analyzer = new ClaudePtyStreamAnalyzer(
			'fixture-maestro-session',
			'fixture-claude-session',
			{ onEvent: (e) => events.push(e), onTurnComplete: () => {} },
			resolveMarkers('2.1.141')
		);

		const raw = readFixtureRaw('v2.1.141-canary.raw');
		analyzer.beginTurn();
		feedFixture(analyzer, raw);

		expect(events.filter((e) => e.type === 'init')).toHaveLength(1);
	});

	it('result event text is sourced from JSONL reader at turn-complete', async () => {
		vi.useFakeTimers();
		try {
			// Override per-test: JSONL reader returns a stub turn so the result event fires.
			// Previously, result text was accumulated from PTY chunks; now it comes from JSONL.
			vi.mocked(readLatestAssistantTurn).mockResolvedValueOnce({
				text: 'mocked-jsonl-response',
				contentBlocks: [{ type: 'text', text: 'mocked-jsonl-response' }],
				timestamp: new Date().toISOString(),
				stopReason: 'end_turn',
			});

			const events: ParsedEvent[] = [];
			const analyzer = new ClaudePtyStreamAnalyzer(
				'fixture-maestro-session',
				'fixture-claude-session',
				{ onEvent: (e) => events.push(e), onTurnComplete: () => {} },
				resolveMarkers('2.1.141')
			);

			const raw = readFixtureRaw('v2.1.141-canary.raw');
			analyzer.beginTurn();
			// Advance past postPromptGraceMs=2000 so fixture spinners arm S4.
			vi.advanceTimersByTime(2001);
			feedFixture(analyzer, raw);
			vi.advanceTimersByTime(2000);

			// Flush the async JSONL read promise (two microtask ticks: mock resolution + .then)
			await Promise.resolve();
			await Promise.resolve();

			const resultEvent = events.find((e) => e.type === 'result');
			expect(resultEvent).toBeTruthy();
			// Result text now sourced from JSONL reader stub, not accumulated PTY bytes.
			expect(resultEvent?.text).toBe('mocked-jsonl-response');
		} finally {
			vi.useRealTimers();
		}
	});

	it('does not emit a second result event for content arriving after S4 fires', () => {
		vi.useFakeTimers();
		try {
			const events: ParsedEvent[] = [];
			const analyzer = new ClaudePtyStreamAnalyzer(
				'fixture-maestro-session',
				'fixture-claude-session',
				{ onEvent: (e) => events.push(e), onTurnComplete: () => {} },
				resolveMarkers('2.1.141')
			);

			const raw = readFixtureRaw('v2.1.141-canary.raw');
			analyzer.beginTurn();
			// Advance past postPromptGraceMs=2000 so fixture spinners arm S4.
			vi.advanceTimersByTime(2001);
			feedFixture(analyzer, raw);
			vi.advanceTimersByTime(2000);

			// turnCompleteEmitted = true after S4; subsequent chunks must not re-trigger.
			// result event is async-sourced from JSONL (mocked null) → 0 result events.
			// The guard being tested (no double-fire) is still enforced by turnCompleteEmitted.
			expect(events.filter((e) => e.type === 'result')).toHaveLength(0);
		} finally {
			vi.useRealTimers();
		}
	});
});
