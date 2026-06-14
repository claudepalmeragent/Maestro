import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

// Prevent real FS/SSH calls from the JSONL reader — result event is tested in the dedicated
// jsonl-result integration test. Trough tests only care about onTurnComplete firing.
vi.mock('../../../main/utils/claude-session-jsonl-reader', () => ({
	readLatestAssistantTurn: vi.fn().mockResolvedValue(null),
}));

import { ClaudePtyStreamAnalyzer } from '../../../main/utils/claude-pty-stream-analyzer';
import type { ParsedEvent } from '../../../main/parsers/agent-output-parser';

/**
 * Create an analyzer with NO markers (undefined), exercising the pure trough detector path.
 * beginTurn() is called immediately since all tests focus on the detection logic, not the
 * startup-gate behaviour (which is tested in the main analyzer test suite).
 */
function makeTroughAnalyzer() {
	const events: ParsedEvent[] = [];
	const turnCompletes: number[] = [];

	const analyzer = new ClaudePtyStreamAnalyzer(
		'trough-maestro',
		'trough-claude',
		{
			onEvent: (e) => events.push(e),
			onTurnComplete: () => turnCompletes.push(Date.now()),
		}
		// undefined markers — no fast-path, trough detector handles everything
	);
	analyzer.beginTurn();

	return { analyzer, events, turnCompletes };
}

// Trough detector constants (must match ClaudePtyStreamAnalyzer private statics)
const SETUP_GRACE_MS = 3000;
const TROUGH_WINDOW_MS = 2500;

describe('Trough detector unit tests (pure trough path, undefined markers)', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('does NOT fire when SETUP_GRACE_MS elapses with zero ingests', () => {
		// With no ingest calls the byteWindow stays empty. The poll timer fires but
		// the empty-window branch returns early (no data → nothing to detect).
		const { turnCompletes } = makeTroughAnalyzer();

		vi.advanceTimersByTime(SETUP_GRACE_MS + 2000);

		expect(turnCompletes).toHaveLength(0);
	});

	it('fires after SETUP_GRACE_MS when idle probes span TROUGH_WINDOW_MS', () => {
		// Test case 2: one small ingest immediately after grace, then TROUGH_WINDOW_MS of
		// silence, then a 1-byte "trigger" probe.  Window: [(3001, 5), (5501, 1)]
		// → windowSpan=2500ms, bps=6*1000/2500=2.4 < 50 → fires.
		const { analyzer, turnCompletes } = makeTroughAnalyzer();

		vi.advanceTimersByTime(SETUP_GRACE_MS + 1); // t=3001 — past grace
		analyzer.ingest('hello'); // 5 bytes at t=3001

		vi.advanceTimersByTime(TROUGH_WINDOW_MS); // t=5501
		analyzer.ingest('x'); // 1 byte — closes the 2500ms window at low rate

		expect(turnCompletes).toHaveLength(1);
	});

	it('does NOT fire during sustained high-rate ingest (5 KB/sec)', () => {
		// 500 bytes every 100ms = 5000 bytes/sec — well above the 50 bps threshold.
		// The window always contains recent high-volume chunks.
		const { analyzer, turnCompletes } = makeTroughAnalyzer();

		vi.advanceTimersByTime(SETUP_GRACE_MS + 1);

		for (let i = 0; i < 50; i++) {
			vi.advanceTimersByTime(100);
			analyzer.ingest('x'.repeat(500)); // 500 chars / 100ms = 5000 bps
		}

		expect(turnCompletes).toHaveLength(0);
	});

	it('does NOT fire at spinner rate (50 bytes / 250ms = 200 bps, above 50-bps threshold)', () => {
		// A Claude thinking/spinner animation emits small chunks at moderate frequency.
		// 200 bps is comfortably above the 50-bps threshold; the detector must not fire.
		const { analyzer, turnCompletes } = makeTroughAnalyzer();

		vi.advanceTimersByTime(SETUP_GRACE_MS + 1);

		for (let i = 0; i < 30; i++) {
			vi.advanceTimersByTime(250);
			analyzer.ingest('x'.repeat(50)); // 50 bytes / 250ms = 200 bps
		}

		expect(turnCompletes).toHaveLength(0);
	});

	it('fires after spinner stops: last spinner chunk + 2.5s idle + 1-byte trigger', () => {
		// Simulate: spinner active for 10 × 250ms, then stops.
		// Last spinner chunk at t = 3001 + 10*250 = 5501ms.
		// Advance 2500ms to t=8001ms and send trigger.
		// Window: [(5501, 50), (8001, 1)] → windowSpan=2500, bps=51*1000/2500=20.4 < 50 → fires.
		const { analyzer, turnCompletes } = makeTroughAnalyzer();

		vi.advanceTimersByTime(SETUP_GRACE_MS + 1);

		for (let i = 0; i < 10; i++) {
			vi.advanceTimersByTime(250);
			analyzer.ingest('x'.repeat(50)); // spinner at 200 bps
		}
		// Last spinner chunk at t = 3001 + 10*250 = 5501ms

		vi.advanceTimersByTime(TROUGH_WINDOW_MS); // t=8001ms
		analyzer.ingest('x'); // 1-byte trigger closes the idle window

		expect(turnCompletes).toHaveLength(1);
	});

	it('does NOT fire when content pauses briefly then resumes (window retains recent data)', () => {
		// High-rate burst (10 chunks × 500 bytes × 100ms) followed by a 1.5s pause.
		// When content resumes, the burst samples are still within the 2500ms window,
		// keeping the effective byte rate high → no spurious completion.
		const { analyzer, turnCompletes } = makeTroughAnalyzer();

		vi.advanceTimersByTime(SETUP_GRACE_MS + 1); // t=3001

		// High-rate burst: 10 × (100ms, 500 bytes) → last at t=4001ms
		for (let i = 0; i < 10; i++) {
			vi.advanceTimersByTime(100);
			analyzer.ingest('x'.repeat(500)); // 5000 bps burst
		}

		// 1.5s pause, then more content — burst samples from t=3101..4001 are still in
		// the 2500ms window at t=5501ms (cutoff=3001, burst samples at t≥3101 > 3001).
		vi.advanceTimersByTime(1500); // t=5501ms
		analyzer.ingest('x'.repeat(500)); // resumed content

		expect(turnCompletes).toHaveLength(0);
	});

	it('does NOT fire before SETUP_GRACE_MS regardless of byte rate', () => {
		// Two probes that would trigger the trough detector if grace were disabled:
		// [(0, 5), (2500, 1)] → windowSpan=2500, bps=2.4 < 50 → would fire.
		// But t=2500 < SETUP_GRACE_MS=3000 → grace suppresses the check.
		const { analyzer, turnCompletes } = makeTroughAnalyzer();

		// No advance — both probes are within the SETUP_GRACE_MS window
		analyzer.ingest('hello'); // 5 bytes at t=0

		vi.advanceTimersByTime(TROUGH_WINDOW_MS); // t=2500 < SETUP_GRACE_MS=3000
		analyzer.ingest('x'); // would fire without grace check

		expect(turnCompletes).toHaveLength(0);
	});
});
