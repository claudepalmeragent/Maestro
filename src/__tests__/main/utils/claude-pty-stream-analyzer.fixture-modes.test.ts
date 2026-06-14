import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
// jsonl-result integration test. Fixture-mode tests focus on trough detector correctness.
vi.mock('../../../main/utils/claude-session-jsonl-reader', () => ({
	readLatestAssistantTurn: vi.fn().mockResolvedValue(null),
}));

import { ClaudePtyStreamAnalyzer } from '../../../main/utils/claude-pty-stream-analyzer';
import { cleanTerminalChunk } from '../../../main/utils/claude-pty-helpers';
import type { ParsedEvent } from '../../../main/parsers/agent-output-parser';

const FIXTURES_DIR = path.join(__dirname, '../../fixtures/claude-pty');

// Trough detector constants (must match ClaudePtyStreamAnalyzer private statics)
const TROUGH_WINDOW_MS = 2500;

// Slice size (JS chars) for splitting raw fixture bytes into simulated PTY chunks.
// 64 chars ensures the last chunk is small enough (< 124 chars) that its cleaned text
// combined with the 1-byte idle trigger stays below the 50-bps trough threshold.
const CHUNK_SIZE = 64;

interface FixtureMeta {
	version: string;
	durationMs: number;
	byteCount: number;
	chunkCount: number;
	effortLevel: string;
	thinkingEnabled: boolean;
	canaryPrompt: string;
}

function loadFixturePair(name: string): { raw: string; meta: FixtureMeta } {
	const raw = fs.readFileSync(path.join(FIXTURES_DIR, `${name}.raw`), 'utf-8');
	const meta = JSON.parse(
		fs.readFileSync(path.join(FIXTURES_DIR, `${name}.meta.json`), 'utf-8')
	) as FixtureMeta;
	return { raw, meta };
}

function makeFixtureAnalyzer() {
	const events: ParsedEvent[] = [];
	const turnCompletes: number[] = [];

	const analyzer = new ClaudePtyStreamAnalyzer(
		'fixture-modes-maestro',
		'fixture-modes-claude',
		{
			onEvent: (e) => events.push(e),
			onTurnComplete: () => turnCompletes.push(Date.now()),
		}
		// undefined markers — fixture tests exercise the pure trough detector path
	);
	analyzer.beginTurn();

	return { analyzer, events, turnCompletes };
}

/**
 * Feeds raw fixture bytes through `cleanTerminalChunk` → `analyzer.ingest()` in
 * CHUNK_SIZE-char slices, advancing fake timers uniformly across the fixture's
 * captured `durationMs` so the byte-rate window reflects realistic pacing.
 *
 * Returns the fake-clock time (ms) after the last chunk is fed.
 */
function feedFixtureWithTiming(
	analyzer: ClaudePtyStreamAnalyzer,
	raw: string,
	meta: FixtureMeta
): number {
	const numChunks = Math.ceil(raw.length / CHUNK_SIZE);
	const intervalMs = Math.round(meta.durationMs / numChunks);

	for (let i = 0; i < numChunks; i++) {
		vi.advanceTimersByTime(intervalMs);
		const start = i * CHUNK_SIZE;
		const end = Math.min(start + CHUNK_SIZE, raw.length);
		analyzer.ingest(cleanTerminalChunk(raw.slice(start, end)));
	}

	return Date.now();
}

/**
 * Simulates idle PTY behaviour after the fixture ends: advance TROUGH_WINDOW_MS and
 * send a single 1-byte "trigger" chunk.  At this point:
 *   – Only the last CHUNK_SIZE-char fixture slice (≤64 chars → cleaned ≤64 chars) plus
 *     the 1-byte trigger remain in the 2500ms byte window.
 *   – bps = (last_chunk_len + 1) * 1000 / 2500 ≤ 65*1000/2500 = 26 bps < 50 threshold.
 *   → The trough detector fires.
 */
function triggerIdle(analyzer: ClaudePtyStreamAnalyzer): number {
	vi.advanceTimersByTime(TROUGH_WINDOW_MS);
	analyzer.ingest('x'); // 1-byte trigger
	return Date.now();
}

const FIXTURE_SPECS: Array<{ name: string; description: string }> = [
	{
		name: 'v2.1.141-effortMedium-thinkingOff',
		description: 'v2.1.141 effort=medium, thinking disabled',
	},
	{
		name: 'v2.1.141-effortMedium-thinkingOn',
		description: 'v2.1.141 effort=medium, thinking enabled',
	},
	{
		name: 'v2.1.141-effortHigh-thinkingOn',
		description: 'v2.1.141 effort=high, thinking enabled',
	},
];

describe('ClaudePtyStreamAnalyzer — fixture-mode integration (trough detector, all 3 config variants)', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	for (const spec of FIXTURE_SPECS) {
		describe(`fixture: ${spec.description}`, () => {
			it('fires onTurnComplete exactly once via trough detector', () => {
				const { raw, meta } = loadFixturePair(spec.name);
				const { analyzer, events, turnCompletes } = makeFixtureAnalyzer();

				feedFixtureWithTiming(analyzer, raw, meta);
				triggerIdle(analyzer);

				// JSONL-sourced result event is mocked to null; the synchronous pty-buffer
				// result event still fires from the headless terminal snapshot at trough.
				const jsonlResults = events.filter(
					(e) =>
						e.type === 'result' &&
						(e as { raw?: { source?: string } }).raw?.source === 'claude-session-jsonl-reader'
				);
				expect(jsonlResults).toHaveLength(0);
				expect(turnCompletes).toHaveLength(1);
			});

			it('emits at least one text event and accumulated text contains canary response', () => {
				const { raw, meta } = loadFixturePair(spec.name);
				const { analyzer, events } = makeFixtureAnalyzer();

				feedFixtureWithTiming(analyzer, raw, meta);
				triggerIdle(analyzer);

				const textEvents = events.filter((e) => e.type === 'text');
				expect(textEvents.length).toBeGreaterThan(0);

				const combined = textEvents.map((e) => e.text ?? '').join('');
				expect(combined.length).toBeGreaterThan(0);
				// Canary response "ready" must appear somewhere in the accumulated text
				expect(combined).toContain('ready');
			});

			it('fires onTurnComplete within TROUGH_WINDOW_MS + 500ms of last fixture chunk', () => {
				const { raw, meta } = loadFixturePair(spec.name);
				const { analyzer, turnCompletes } = makeFixtureAnalyzer();

				const feedEndTime = feedFixtureWithTiming(analyzer, raw, meta);
				triggerIdle(analyzer);

				expect(turnCompletes).toHaveLength(1);
				// The trigger is sent at feedEndTime + TROUGH_WINDOW_MS, so the difference
				// is always exactly TROUGH_WINDOW_MS (2500ms) ≤ TROUGH_WINDOW_MS + 500ms.
				expect(turnCompletes[0] - feedEndTime).toBeLessThanOrEqual(TROUGH_WINDOW_MS + 500);
			});

			it('emits exactly one init event across the full fixture stream', () => {
				const { raw, meta } = loadFixturePair(spec.name);
				const { analyzer, events } = makeFixtureAnalyzer();

				feedFixtureWithTiming(analyzer, raw, meta);
				triggerIdle(analyzer);

				expect(events.filter((e) => e.type === 'init')).toHaveLength(1);
			});

			it('does NOT fire during the fixture replay (response-phase byte rate is above threshold)', () => {
				// Feed the fixture without the idle trigger — the trough detector must not
				// fire mid-fixture because the byte rate in the window is well above 50 bps
				// during the response-generation phase.
				const { raw, meta } = loadFixturePair(spec.name);
				const { analyzer, turnCompletes } = makeFixtureAnalyzer();

				feedFixtureWithTiming(analyzer, raw, meta);

				expect(turnCompletes).toHaveLength(0);
			});
		});
	}
});
