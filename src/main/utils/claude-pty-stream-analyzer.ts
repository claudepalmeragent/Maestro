import { Terminal } from '@xterm/headless';
import type { ParsedEvent } from '../parsers/agent-output-parser';
import { ERROR_SIGNATURES, type RunnerExitReason } from './claude-pty-helpers';
import { type VersionMarkers } from './claude-pty-markers';
import { readLatestAssistantTurn } from './claude-session-jsonl-reader';
import type { SshRemoteConfig } from '../../shared/types';

interface ByteSample {
	ts: number;
	bytes: number;
}

export interface ClaudePtyAnalyzerCallbacks {
	/** Emit a ParsedEvent identical to what claude-output-parser would emit. */
	onEvent: (event: ParsedEvent) => void;
	/** Fired exactly once when the analyzer is confident the turn has completed. */
	onTurnComplete: () => void;
}

export class ClaudePtyStreamAnalyzer {
	/**
	 * Debounce window (ms) for idle-prompt and spinner-stop detection paths.
	 * A stable 1.5s observation window with no new non-spinner output → turn complete.
	 */
	private static readonly IDLE_DEBOUNCE_MS = 1500;
	private static readonly SPINNER_STOP_DEBOUNCE_MS = 1500;

	/** Trough detector: rolling window length for byte-rate measurement. */
	private static readonly TROUGH_WINDOW_MS = 2500;
	/** Trough detector: byte/sec threshold below which the PTY is considered idle. */
	private static readonly TROUGH_THRESHOLD_BPS = 50;
	/**
	 * Trough detector: ignore the trough detector for this long after spawn, so the
	 * startup banner (which has natural low-rate periods) doesn't fire turn-complete
	 * before the prompt is even sent.
	 */
	private static readonly SETUP_GRACE_MS = 3000;
	/**
	 * Trough detector: polling interval for the background timer. The timer calls
	 * _checkTrough() even when no PTY data arrives, so the detector fires on true
	 * PTY idle (no chunks at all) rather than only on ingest().
	 */
	private static readonly TROUGH_POLL_MS = 250;

	/** Fast-path marker set. undefined = no fast-path (trough detector handles everything). */
	private readonly markers: VersionMarkers | undefined;
	private term: Terminal;
	private currentExitReason: RunnerExitReason = 'SUCCESS';
	private hasInitFired = false;
	private byteWindow: ByteSample[] = [];
	/**
	 * Timestamp of the last chunk that arrived AFTER SETUP_GRACE_MS has elapsed AND
	 * after beginTurn().  Used by the empty-window path so the trough can fire 2.5s
	 * after the last response chunk even when the byteWindow eviction boundary falls
	 * between two timer ticks (which would cause the non-empty-window path to miss).
	 */
	private lastChunkAfterGrace: number | null = null;
	private troughPollTimer: ReturnType<typeof setInterval> | null = null;
	private readonly analyzerStartTime: number = Date.now();
	private inThinkingBlock = false;
	private accumulatedAssistantText = '';
	private accumulatedThinkingText = '';
	private expectedEcho = '';
	private turnCompleteEmitted = false;
	private seenCompletionPhrase = false;
	private seenSpinnerGlyph = false;
	private spinnerStopTimer: ReturnType<typeof setTimeout> | null = null;
	private idleDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	private disposed = false;
	/** Unix ms timestamp captured at the start of each turn (beginTurn call). Used as notBeforeTs for JSONL flush-race guard. */
	private turnStartTs: number | null = null;
	/**
	 * Gate: completion signals are suppressed until beginTurn() is called.
	 * This prevents startup output (e.g. "? for shortcuts" in the Claude REPL
	 * status bar rendered BEFORE the prompt is written) from triggering a
	 * false-positive turn-complete that races the actual response.
	 * The runner calls beginTurn() immediately after writing the prompt to the PTY.
	 */
	private turnStarted = false;
	/**
	 * Wall-clock timestamp of the last beginTurn() call. Used with
	 * markers.postPromptGraceMs to suppress S3/S4 arming for a configurable
	 * period after the prompt is written, preventing startup-banner spinners
	 * (which arrive after beginTurn() in versions with slow startup) from
	 * triggering a premature spinner-cessation detection.
	 */
	private turnStartedAt: number | null = null;

	constructor(
		_maestroSessionId: string,
		private readonly claudeSessionId: string,
		private readonly callbacks: ClaudePtyAnalyzerCallbacks,
		markers?: VersionMarkers,
		private readonly cwd: string = '',
		private readonly sshRemote?: SshRemoteConfig,
		private readonly homeDirRemote?: string
	) {
		this.markers = markers;
		this.term = new Terminal({ cols: 120, rows: 40, scrollback: 5000, allowProposedApi: true });
	}

	/**
	 * Unlock completion-signal detection. Must be called after the prompt has been
	 * written to the PTY. Until this is called, S1–S5 signals are accumulated but
	 * onTurnComplete is never fired, preventing startup output from triggering a
	 * false positive.
	 *
	 * Also records the wall-clock time for the postPromptGraceMs window (S3/S4
	 * suppression during the startup phase — see VersionMarkers.postPromptGraceMs).
	 */
	beginTurn(): void {
		this.turnStarted = true;
		this.turnStartedAt = Date.now();
		this.turnStartTs = Date.now();
		// Start polling timer — fires _checkTrough() even when no PTY chunks arrive,
		// ensuring the trough detector fires on true PTY idle (PTY stops emitting entirely).
		if (this.troughPollTimer === null) {
			this.troughPollTimer = setInterval(() => {
				this._checkTrough();
			}, ClaudePtyStreamAnalyzer.TROUGH_POLL_MS);
		}
	}

	/** Tell the analyzer the runner is about to write this text — echo of it should be suppressed. */
	expectEcho(promptText: string): void {
		this.expectedEcho = promptText;
	}

	/** Feed a CLEANED text chunk (caller has already run cleanTerminalChunk). */
	ingest(chunk: string): void {
		// 1. Echo cancellation
		chunk = this._cancelEcho(chunk);
		if (chunk === '') return;

		// Trough detector — sample push (runs on every non-empty chunk)
		const troughNow = Date.now();
		this.byteWindow.push({ ts: troughNow, bytes: chunk.length });
		if (
			this.turnStarted &&
			troughNow - this.analyzerStartTime >= ClaudePtyStreamAnalyzer.SETUP_GRACE_MS
		) {
			this.lastChunkAfterGrace = troughNow;
		}

		// 2. Feed into headless xterm
		this.term.write(chunk);

		// 3. First-ingest init event
		if (!this.hasInitFired) {
			this.callbacks.onEvent({
				type: 'init',
				sessionId: this.claudeSessionId,
				raw: { source: 'claude-pty-runner' },
			});
			this.hasInitFired = true;
		}

		// 4. Thinking-block tracking + accumulation + 5. Per-chunk text emission
		const { outsideText, insideText } = this._splitThinkingContent(chunk);

		if (outsideText) {
			this.accumulatedAssistantText += outsideText;
			this.callbacks.onEvent({
				type: 'text',
				text: outsideText,
				sessionId: this.claudeSessionId,
				isPartial: true,
				raw: { source: 'claude-pty-runner' },
			});
		}

		if (insideText) {
			this.accumulatedThinkingText += insideText;
			this.callbacks.onEvent({
				type: 'text',
				text: insideText,
				sessionId: this.claudeSessionId,
				isPartial: true,
				raw: {
					source: 'claude-pty-runner',
					message: { content: [{ type: 'thinking', thinking: insideText }] },
				},
			});
		}

		// Check for completion phrases in the outside text (fast-path only)
		if (outsideText && this.markers) {
			for (const phrase of this.markers.completionPhrases) {
				if (outsideText.includes(phrase)) {
					this.seenCompletionPhrase = true;
					break;
				}
			}
		}

		// 6. Error-signature detection
		for (const sig of ERROR_SIGNATURES) {
			if (sig.test(chunk)) {
				this.currentExitReason = 'AGENT_ERROR';
				break;
			}
		}

		// 7. Multi-signal turn-completion detector (fast-path optimization).
		//
		// Only active when a VersionMarkers object was provided — this is an EARLY-EXIT
		// optimization that fires turn-complete immediately when a known-good marker is
		// seen, bypassing the TROUGH_WINDOW_MS wait. If markers is undefined, this block
		// is a no-op and the trough detector (below) handles everything.
		//
		// Signal priority (first match wins):
		//   S1. Help-line marker in chunk       → fire immediately (highest confidence)
		//   S2. Completion-stats marker          → fire immediately (high confidence)
		//   S3. Idle-prompt marker + 1.5s debounce → fire (medium confidence)
		//   S4. Spinner-glyph cessation          → fire after SPINNER_STOP_DEBOUNCE_MS
		//   S5. Completion-phrase + idle-prompt  → fire immediately (legacy back-compat)
		//
		// NOTE: gated on this.turnStarted — beginTurn() must be called (by the runner,
		// after writing the prompt) before any signal can fire.  This prevents startup
		// PTY output (e.g. the "? for shortcuts" status bar rendered at REPL idle before
		// the prompt is submitted) from triggering a premature turn-complete.
		if (this.markers && !this.turnCompleteEmitted && !this.inThinkingBlock && this.turnStarted) {
			// S1: Help-line marker — strongest signal, appears only at idle.
			if (this.markers.helpLineMarkers.some((m) => m.test(chunk))) {
				this._fireTurnComplete();
				return;
			}

			// S2: Completion-stats line (✻ Sautéed for 2s, ✓ Done in 4s, etc.)
			if (this.markers.completionStatsMarkers.some((m) => m.test(chunk))) {
				this._fireTurnComplete();
				return;
			}

			// Grace-period check for S3/S4: suppress debounce-timer arming for
			// postPromptGraceMs after beginTurn(). This prevents startup animation
			// glyphs (which arrive after beginTurn() in versions with slow startup,
			// e.g. v2.1.141) from arming the spinner-cessation or idle-prompt timers
			// before the actual response phase begins.
			const graceMs = this.markers.postPromptGraceMs ?? 0;
			const graceExpired =
				graceMs === 0 || this.turnStartedAt === null || Date.now() - this.turnStartedAt >= graceMs;

			// Spinner-glyph tracking for S4: arm/re-arm the spinner-stop timer on
			// every chunk that contains at least one glyph.
			const hasSpinner = [...this.markers.spinnerGlyphs].some((g) => chunk.includes(g));
			if (hasSpinner) {
				this.seenSpinnerGlyph = true;
				// Clear any pending stop-timer when a new spinner chunk arrives.
				if (this.spinnerStopTimer !== null) {
					clearTimeout(this.spinnerStopTimer);
					this.spinnerStopTimer = null;
				}
			} else if (this.seenSpinnerGlyph && this.spinnerStopTimer === null && graceExpired) {
				// S4: We've seen spinners before, this chunk has none, and we're past
				// the startup grace window — start the cessation debounce timer.
				this.spinnerStopTimer = setTimeout(() => {
					this.spinnerStopTimer = null;
					if (this.disposed || this.turnCompleteEmitted) return;
					this._fireTurnComplete();
				}, ClaudePtyStreamAnalyzer.SPINNER_STOP_DEBOUNCE_MS);
			}

			// S3 + S5: Idle-prompt detection via cleaned chunk and rendered tail.
			// Check both surfaces: the headless xterm buffer may mangle prompt position
			// under heavy cursor-manipulation output (CSI sequences from v2.1.141 spinners).
			// Also gated on graceExpired so that idle markers appearing during startup
			// (e.g. a continuously-present ❯ cursor in v2.1.141) don't arm the timer.
			const renderedTail = this._getRenderedTail();
			const idleDetected =
				this.markers.idlePromptMarkers.some((m) => m.test(renderedTail)) ||
				this.markers.idlePromptMarkers.some((m) => m.test(chunk));

			if (idleDetected && graceExpired) {
				// S5: Legacy fast path — completion phrase already seen → fire immediately.
				if (this.seenCompletionPhrase) {
					this._fireTurnComplete();
					return;
				}

				// S3: Debounce path — arm the idle timer once (do not re-arm on each chunk
				// so the window starts from first prompt observation, not last).
				if (this.idleDebounceTimer === null) {
					this.idleDebounceTimer = setTimeout(() => {
						this.idleDebounceTimer = null;
						if (this.disposed || this.turnCompleteEmitted) return;
						this._fireTurnComplete();
					}, ClaudePtyStreamAnalyzer.IDLE_DEBOUNCE_MS);
				}
			}
		}

		// Trough check — runs inline on every ingest AND via the poll timer.
		this._checkTrough(troughNow);
	}

	/**
	 * Primary mode-agnostic end-of-turn signal.
	 *
	 * Called from both `ingest()` (on every incoming chunk) and from the poll timer
	 * (every TROUGH_POLL_MS) so it fires even when the PTY stops emitting entirely.
	 *
	 * Fires when the byte rate in the rolling TROUGH_WINDOW_MS window drops below
	 * TROUGH_THRESHOLD_BPS — meaning the PTY has returned to idle.
	 *
	 * Two paths:
	 *
	 * Non-empty-window path (normal): bps = totalBytes * 1000 / windowSpan < THRESHOLD.
	 *
	 * Empty-window path (all samples evicted): fires when TROUGH_WINDOW_MS has elapsed
	 * since `lastChunkAfterGrace` — the last chunk that arrived after SETUP_GRACE_MS.
	 * This handles the case where the timer-boundary falls AFTER the last sample is
	 * evicted (the non-empty-window path can never fire then), which happens with TERM=dumb
	 * when Claude's thinking-phase spinner is suppressed and the last response chunk
	 * doesn't align with a 250ms timer tick.  Safe because `lastChunkAfterGrace` is only
	 * set after SETUP_GRACE_MS (banner silent periods cannot trigger it).
	 */
	private _checkTrough(now?: number): void {
		if (this.turnCompleteEmitted || this.disposed) return;
		if (!this.turnStarted) return;
		const ts = now ?? Date.now();
		if (ts - this.analyzerStartTime < ClaudePtyStreamAnalyzer.SETUP_GRACE_MS) return;

		// Evict stale samples
		const cutoff = ts - ClaudePtyStreamAnalyzer.TROUGH_WINDOW_MS;
		while (this.byteWindow.length > 0 && this.byteWindow[0].ts < cutoff) {
			this.byteWindow.shift();
		}

		if (this.byteWindow.length === 0) {
			// Empty-window path: fire if lastChunkAfterGrace is set and TROUGH_WINDOW_MS
			// has elapsed since then.  Prevents premature fire during startup silence
			// (before any response chunk arrives) while ensuring reliable detection after
			// the last response chunk is evicted by the rolling window.
			if (
				this.lastChunkAfterGrace !== null &&
				ts - this.lastChunkAfterGrace >= ClaudePtyStreamAnalyzer.TROUGH_WINDOW_MS
			) {
				this._fireTurnComplete();
			}
			return;
		}

		const windowSpan = ts - this.byteWindow[0].ts;
		if (windowSpan < ClaudePtyStreamAnalyzer.TROUGH_WINDOW_MS) return;

		const bytesInWindow = this.byteWindow.reduce((s, x) => s + x.bytes, 0);
		const bps = (bytesInWindow * 1000) / windowSpan;
		if (bps < ClaudePtyStreamAnalyzer.TROUGH_THRESHOLD_BPS) {
			this._fireTurnComplete();
		}
	}

	private _stopTroughPollTimer(): void {
		if (this.troughPollTimer !== null) {
			clearInterval(this.troughPollTimer);
			this.troughPollTimer = null;
		}
	}

	private _fireTurnComplete(): void {
		this.turnCompleteEmitted = true;
		this._stopTroughPollTimer();
		if (this.idleDebounceTimer !== null) {
			clearTimeout(this.idleDebounceTimer);
			this.idleDebounceTimer = null;
		}
		if (this.spinnerStopTimer !== null) {
			clearTimeout(this.spinnerStopTimer);
			this.spinnerStopTimer = null;
		}

		// Synchronously emit a buffer-sourced result event from the headless terminal.
		// This is the fast path: zero SSH round-trips, available immediately at trough-fire.
		// The JSONL-sourced event below arrives shortly after with structured/authoritative data.
		const bufferText = this.getVisibleBuffer();
		if (bufferText.trim().length > 0) {
			const bufferResultEvent: ParsedEvent = {
				type: 'result',
				sessionId: this.claudeSessionId,
				text: bufferText,
				raw: { source: 'pty-buffer' },
			};
			this.callbacks.onEvent(bufferResultEvent);
		}

		// Asynchronously read the authoritative JSONL turn and emit a clean result event.
		// onTurnComplete() fires synchronously below so watchdog/exit ordering is preserved;
		// the JSONL-sourced result event arrives on a microtask shortly after.
		void readLatestAssistantTurn(this.cwd, this.claudeSessionId, {
			sshRemote: this.sshRemote,
			homeDirRemote: this.homeDirRemote,
			notBeforeTs: this.turnStartTs ?? undefined,
		})
			.then((turn) => {
				if (!turn) return; // graceful degradation — streaming text remains in UI
				const resultEvent: ParsedEvent = {
					type: 'result',
					sessionId: this.claudeSessionId,
					text: turn.text,
					raw: {
						source: 'claude-session-jsonl-reader',
						stopReason: turn.stopReason,
						timestamp: turn.timestamp,
						contentBlocks: turn.contentBlocks,
					},
				};
				this.callbacks.onEvent(resultEvent);
			})
			.catch(() => {
				// swallow — readLatestAssistantTurn returns null on its own errors
			});

		this.callbacks.onTurnComplete();
	}

	/**
	 * Tear-down hook for the runner: cancel all pending timers and suppress further
	 * completion callbacks. Idempotent. Call when the PTY exits (success, kill, timeout)
	 * to prevent pending debounce timers from firing post-exit and triggering phantom
	 * onTurnComplete callbacks after the runner has already wound down.
	 */
	dispose(): void {
		this.disposed = true;
		this._stopTroughPollTimer();
		if (this.idleDebounceTimer !== null) {
			clearTimeout(this.idleDebounceTimer);
			this.idleDebounceTimer = null;
		}
		if (this.spinnerStopTimer !== null) {
			clearTimeout(this.spinnerStopTimer);
			this.spinnerStopTimer = null;
		}
	}

	/** Get current exit reason, possibly upgraded from analyzer-detected error signatures. */
	getExitReason(): RunnerExitReason {
		return this.currentExitReason;
	}

	/** Reset state for a new turn (rare in per-turn-spawn lifecycle; useful for tests). */
	reset(): void {
		this.term = new Terminal({ cols: 120, rows: 40, scrollback: 5000, allowProposedApi: true });
		this.currentExitReason = 'SUCCESS';
		this.hasInitFired = false;
		this.inThinkingBlock = false;
		this.accumulatedAssistantText = '';
		this.accumulatedThinkingText = '';
		this.expectedEcho = '';
		this.turnCompleteEmitted = false;
		this.seenCompletionPhrase = false;
		this.seenSpinnerGlyph = false;
		this.byteWindow = [];
		this.lastChunkAfterGrace = null;
		this._stopTroughPollTimer();
		this.turnStarted = false;
		this.turnStartedAt = null;
		this.turnStartTs = null;
		if (this.idleDebounceTimer !== null) {
			clearTimeout(this.idleDebounceTimer);
			this.idleDebounceTimer = null;
		}
		if (this.spinnerStopTimer !== null) {
			clearTimeout(this.spinnerStopTimer);
			this.spinnerStopTimer = null;
		}
		this.disposed = false;
	}

	private _cancelEcho(chunk: string): string {
		if (!this.expectedEcho) return chunk;

		// Normalize: remove all CR/LF (line-wrap artifacts) and collapse multiple spaces.
		// This handles PTY line-wrapping at col 120: the echo appears broken across lines
		// but the actual prompt text has no newline at that position.
		const normalize = (s: string) =>
			s
				.replace(/[\r\n]/g, '')
				.replace(/\s{2,}/g, ' ')
				.trim();

		const normChunk = normalize(chunk);
		const normEcho = normalize(this.expectedEcho);

		if (!normEcho) {
			this.expectedEcho = '';
			return chunk;
		}

		// If the normalized chunk starts with the full echo, strip the echo portion
		if (normChunk.startsWith(normEcho)) {
			const savedEcho = this.expectedEcho;
			this.expectedEcho = '';
			return this._stripEchoFromRaw(chunk, savedEcho);
		}

		// Partial match: the chunk is a prefix of the remaining echo
		if (normEcho.startsWith(normChunk)) {
			// Consume this chunk entirely from the echo buffer
			// Rebuild remaining echo: strip normChunk-length chars from the front of normEcho
			const newNormEcho = normEcho.slice(normChunk.length).trim();
			this.expectedEcho = newNormEcho;
			return '';
		}

		// No match — echo cancellation done or mismatched; pass through
		this.expectedEcho = '';
		return chunk;
	}

	private _stripEchoFromRaw(rawChunk: string, echo: string): string {
		// Walk the raw chunk character by character, skipping characters that match
		// the echo text (ignoring newline/CR line-wrap artifacts in the raw chunk).
		const echoNorm = echo
			.replace(/[\r\n]/g, '')
			.replace(/\s{2,}/g, ' ')
			.trim();
		let echoIdx = 0;
		let rawIdx = 0;

		while (rawIdx < rawChunk.length && echoIdx < echoNorm.length) {
			const rc = rawChunk[rawIdx];

			// Skip newlines/CR in the raw chunk (they are line-wrap artifacts)
			if (rc === '\r' || rc === '\n') {
				rawIdx++;
				continue;
			}

			const ec = echoNorm[echoIdx];

			// Normalize whitespace runs: treat any run of spaces as a single space
			if (rc === ' ' && ec === ' ') {
				while (rawIdx < rawChunk.length && rawChunk[rawIdx] === ' ') rawIdx++;
				echoIdx++;
				continue;
			}

			if (rc === ec) {
				rawIdx++;
				echoIdx++;
			} else {
				// Mismatch — stop stripping
				break;
			}
		}

		// After matching all echo characters, also consume trailing newlines that were
		// part of the original echo string (stripped during normalization).
		const echoTrailingNewlines = (echo.match(/[\r\n]+$/) ?? [''])[0];
		if (echoTrailingNewlines) {
			let newlineCount = (echoTrailingNewlines.match(/\n/g) ?? []).length;
			while (rawIdx < rawChunk.length && newlineCount > 0) {
				if (rawChunk[rawIdx] === '\r') {
					rawIdx++;
				} else if (rawChunk[rawIdx] === '\n') {
					rawIdx++;
					newlineCount--;
				} else {
					break;
				}
			}
		}

		return rawChunk.slice(rawIdx);
	}

	private _splitThinkingContent(chunk: string): { outsideText: string; insideText: string } {
		let outsideText = '';
		let insideText = '';
		let pos = 0;
		const text = chunk;

		while (pos < text.length) {
			if (!this.inThinkingBlock) {
				const openTag = text.indexOf('<thinking>', pos);
				if (openTag === -1) {
					outsideText += text.slice(pos);
					break;
				}
				outsideText += text.slice(pos, openTag);
				this.inThinkingBlock = true;
				pos = openTag + '<thinking>'.length;
			} else {
				const closeTag = text.indexOf('</thinking>', pos);
				if (closeTag === -1) {
					insideText += text.slice(pos);
					break;
				}
				insideText += text.slice(pos, closeTag);
				this.inThinkingBlock = false;
				pos = closeTag + '</thinking>'.length;
			}
		}

		return { outsideText, insideText };
	}

	/**
	 * Snapshot the headless terminal's visible buffer as plain text. Used at trough-fire
	 * to emit a synchronous `result` event from observed PTY output. Trailing blank
	 * lines are trimmed.
	 */
	public getVisibleBuffer(): string {
		const buf = this.term.buffer.active;
		const lines: string[] = [];
		for (let y = 0; y < buf.length; y++) {
			const line = buf.getLine(y);
			if (!line) continue;
			lines.push(line.translateToString(true));
		}
		while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
			lines.pop();
		}
		return lines.join('\n');
	}

	private _getRenderedTail(): string {
		const buf = this.term.buffer.active;
		const totalRows = buf.length;
		const scanRows = Math.min(10, totalRows);
		const lines: string[] = [];

		for (let i = totalRows - scanRows; i < totalRows; i++) {
			const line = buf.getLine(i);
			if (line) {
				lines.push(line.translateToString(true));
			}
		}

		return lines.join('\n');
	}
}
