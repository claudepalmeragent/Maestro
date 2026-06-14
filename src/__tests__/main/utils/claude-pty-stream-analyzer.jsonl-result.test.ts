import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock @xterm/headless before importing the analyzer
vi.mock('@xterm/headless', () => {
	class MockTerminal {
		readonly cols: number;

		constructor(opts?: { cols?: number; rows?: number }) {
			this.cols = opts?.cols ?? 120;
		}

		write(_chunk: string): void {}

		get buffer() {
			return {
				active: {
					get length() {
						return 0;
					},
					getLine: (_i: number) => ({ translateToString: () => '' }),
				},
			};
		}
	}

	return { Terminal: MockTerminal };
});

// Mock readLatestAssistantTurn so no actual JSONL reads happen
const mockReadLatestAssistantTurn = vi.fn();
vi.mock('../../../main/utils/claude-session-jsonl-reader', () => ({
	readLatestAssistantTurn: (...args: unknown[]) => mockReadLatestAssistantTurn(...args),
}));

import { ClaudePtyStreamAnalyzer } from '../../../main/utils/claude-pty-stream-analyzer';
import type { ParsedEvent } from '../../../main/parsers/agent-output-parser';
import type { SshRemoteConfig } from '../../../shared/types';

// Trough detector constants — must match ClaudePtyStreamAnalyzer private statics
const SETUP_GRACE_MS = 3000;
const TROUGH_WINDOW_MS = 2500;

function makeSshRemote(): SshRemoteConfig {
	return {
		enabled: true,
		host: 'planner-vm',
		username: 'maestro',
		port: 22,
		privateKeyPath: '/home/maestro/.ssh/id_rsa',
	} as SshRemoteConfig;
}

/**
 * Build an analyzer and trigger the trough detector so _fireTurnComplete() is called.
 * Uses fake timers — caller must have vi.useFakeTimers() active.
 */
function makeAnalyzerAndFireTrough(opts: {
	cwd?: string;
	sshRemote?: SshRemoteConfig;
	homeDirRemote?: string;
}) {
	const events: ParsedEvent[] = [];
	const turnCompletes: number[] = [];

	const analyzer = new ClaudePtyStreamAnalyzer(
		'test-maestro-session',
		'test-claude-session-uuid',
		{
			onEvent: (e) => events.push(e),
			onTurnComplete: () => turnCompletes.push(Date.now()),
		},
		undefined, // no fast-path markers
		opts.cwd ?? '/app/test-cwd',
		opts.sshRemote,
		opts.homeDirRemote
	);

	analyzer.beginTurn();

	// Advance past SETUP_GRACE_MS
	vi.advanceTimersByTime(SETUP_GRACE_MS + 1);

	// Ingest one chunk so the byte window is seeded
	analyzer.ingest('hello from claude');

	// Advance TROUGH_WINDOW_MS so the trough detector fires on the next probe
	vi.advanceTimersByTime(TROUGH_WINDOW_MS);

	// Ingest a 1-byte trigger to close the window below the threshold
	analyzer.ingest('x');

	return { analyzer, events, turnCompletes };
}

describe('ClaudePtyStreamAnalyzer → JSONL result event integration', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		mockReadLatestAssistantTurn.mockReset();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	// ── Scenario 1: local path ─────────────────────────────────────────────────
	it('calls readLatestAssistantTurn with sshRemote=undefined for local session', async () => {
		mockReadLatestAssistantTurn.mockResolvedValue(null);

		makeAnalyzerAndFireTrough({ sshRemote: undefined });

		// Flush microtask queue so the void-promise resolves
		await Promise.resolve();

		expect(mockReadLatestAssistantTurn).toHaveBeenCalledOnce();
		const callArgs = mockReadLatestAssistantTurn.mock.calls[0];
		expect(callArgs[2]).toMatchObject({ sshRemote: undefined });
	});

	// ── Scenario 2: SSH path ───────────────────────────────────────────────────
	it('calls readLatestAssistantTurn with the provided sshRemote for SSH session', async () => {
		mockReadLatestAssistantTurn.mockResolvedValue(null);
		const sshRemote = makeSshRemote();

		makeAnalyzerAndFireTrough({ sshRemote });

		await Promise.resolve();

		expect(mockReadLatestAssistantTurn).toHaveBeenCalledOnce();
		const callArgs = mockReadLatestAssistantTurn.mock.calls[0];
		expect(callArgs[2]).toMatchObject({ sshRemote });
	});

	// ── Scenario 3: result event fires ────────────────────────────────────────
	it('emits a type:result event whose text matches the mocked turn', async () => {
		const fakeTurn = {
			text: 'The answer is 42.',
			contentBlocks: [{ type: 'text', text: 'The answer is 42.' }],
			timestamp: new Date().toISOString(),
			stopReason: 'end_turn',
		};
		mockReadLatestAssistantTurn.mockResolvedValue(fakeTurn);

		const { events } = makeAnalyzerAndFireTrough({});

		await Promise.resolve();

		const resultEvents = events.filter((e) => e.type === 'result');
		expect(resultEvents).toHaveLength(1);
		expect(resultEvents[0].text).toBe('The answer is 42.');
		expect(resultEvents[0].sessionId).toBe('test-claude-session-uuid');
		expect((resultEvents[0] as { raw?: { source?: string } }).raw?.source).toBe(
			'claude-session-jsonl-reader'
		);
	});

	// ── Scenario 4: onTurnComplete fires synchronously before async result ────
	it('onTurnComplete fires before the async result event arrives', async () => {
		const order: string[] = [];

		const analyzer = new ClaudePtyStreamAnalyzer(
			'test-maestro',
			'test-claude',
			{
				onEvent: (e) => {
					if (e.type === 'result') order.push('result');
				},
				onTurnComplete: () => order.push('turnComplete'),
			},
			undefined,
			'/app/test'
		);

		// Return a resolved promise (microtask) so both callbacks run in this turn
		mockReadLatestAssistantTurn.mockResolvedValue({
			text: 'hi',
			contentBlocks: [{ type: 'text', text: 'hi' }],
			timestamp: new Date().toISOString(),
			stopReason: 'end_turn',
		});

		analyzer.beginTurn();

		vi.advanceTimersByTime(SETUP_GRACE_MS + 1);
		analyzer.ingest('some content');
		vi.advanceTimersByTime(TROUGH_WINDOW_MS);
		analyzer.ingest('x');

		// At this point onTurnComplete has fired synchronously; result event is pending
		expect(order).toEqual(['turnComplete']);

		// Flush microtask queue
		await Promise.resolve();

		expect(order).toEqual(['turnComplete', 'result']);
	});

	// ── Scenario 5: streaming text events are preserved ───────────────────────
	it('emits streaming text events during ingest AND result event at trough-fire', async () => {
		mockReadLatestAssistantTurn.mockResolvedValue({
			text: 'final',
			contentBlocks: [{ type: 'text', text: 'final' }],
			timestamp: new Date().toISOString(),
			stopReason: 'end_turn',
		});

		const { events } = makeAnalyzerAndFireTrough({});

		await Promise.resolve();

		const textEvents = events.filter((e) => e.type === 'text');
		const resultEvents = events.filter((e) => e.type === 'result');

		// At least the two ingest() chunks emitted text events
		expect(textEvents.length).toBeGreaterThanOrEqual(1);
		expect(resultEvents).toHaveLength(1);
	});

	// ── Scenario 6: graceful degradation when reader returns null ─────────────
	it('does NOT emit a result event when readLatestAssistantTurn returns null', async () => {
		mockReadLatestAssistantTurn.mockResolvedValue(null);

		const { events, turnCompletes } = makeAnalyzerAndFireTrough({});

		await Promise.resolve();

		expect(events.filter((e) => e.type === 'result')).toHaveLength(0);
		// onTurnComplete still fires
		expect(turnCompletes).toHaveLength(1);
	});

	// ── Scenario 7: notBeforeTs argument ──────────────────────────────────────
	it('passes notBeforeTs >= the turnStart wall-clock time captured in beginTurn()', async () => {
		mockReadLatestAssistantTurn.mockResolvedValue(null);

		const beforeBeginTurn = Date.now();

		makeAnalyzerAndFireTrough({});

		await Promise.resolve();

		expect(mockReadLatestAssistantTurn).toHaveBeenCalledOnce();
		const callArgs = mockReadLatestAssistantTurn.mock.calls[0];
		const { notBeforeTs } = callArgs[2] as { notBeforeTs: number };
		expect(notBeforeTs).toBeGreaterThanOrEqual(beforeBeginTurn);
		// notBeforeTs should be around turnStart, not far into the future
		expect(notBeforeTs).toBeLessThanOrEqual(Date.now());
	});
});
