import { Terminal } from '@xterm/headless';
import type { ParsedEvent } from '../parsers/agent-output-parser';
import {
	ERROR_SIGNATURES,
	IDLE_PROMPT_MARKERS,
	COMPLETION_PHRASES,
	type RunnerExitReason,
} from './claude-pty-helpers';

export interface ClaudePtyAnalyzerCallbacks {
	/** Emit a ParsedEvent identical to what claude-output-parser would emit. */
	onEvent: (event: ParsedEvent) => void;
	/** Fired exactly once when the analyzer is confident the turn has completed. */
	onTurnComplete: () => void;
}

export class ClaudePtyStreamAnalyzer {
	/**
	 * Debounce window for the idle-prompt-only completion path: if Claude's REPL prompt
	 * (╰─ / ❯ / $ / (claude)) appears in the rendered tail AND no new assistant output
	 * arrives for this many ms, treat the turn as complete. The completion-phrase fast
	 * path (Done!, Task complete, …) fires synchronously without waiting for this window.
	 */
	private static readonly IDLE_DEBOUNCE_MS = 1500;

	private term: Terminal;
	private currentExitReason: RunnerExitReason = 'SUCCESS';
	private hasInitFired = false;
	private inThinkingBlock = false;
	private accumulatedAssistantText = '';
	private accumulatedThinkingText = '';
	private expectedEcho = '';
	private turnCompleteEmitted = false;
	private seenCompletionPhrase = false;
	private idleDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	private disposed = false;

	constructor(
		_maestroSessionId: string,
		private readonly claudeSessionId: string,
		private readonly callbacks: ClaudePtyAnalyzerCallbacks
	) {
		this.term = new Terminal({ cols: 120, rows: 40, allowProposedApi: true });
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

		// Check for completion phrases in the outside text
		if (outsideText) {
			for (const phrase of COMPLETION_PHRASES) {
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

		// 7. Idle-prompt + completion detection.
		//
		// Once we see the REPL prompt marker (❯ / ╰─ / (claude) / $) in the cleaned
		// stream, Claude has handed control back to the REPL. Subsequent chunks from
		// claude v2.1.141 are spinner cleanup + status frames ("Sautéed for 2s",
		// "? for shortcuts") that emit outsideText but do NOT mean Claude is still
		// responding. So we deliberately do NOT cancel the debounce timer on new
		// outsideText — the window simply elapses and we fire complete.
		//
		// The theoretical risk is Claude emitting ❯ as a literal character mid-response
		// and then continuing. In practice this doesn't happen with v2.1.141 prompts;
		// if it ever does, the 1.5s window is short enough that it'd at worst fire
		// complete one debounce-window earlier than ideal, not catastrophically wrong.
		if (!this.turnCompleteEmitted && !this.inThinkingBlock) {
			// Check both the xterm-rendered tail AND the raw cleaned chunk. Under heavy
			// cursor-manipulation output (real claude v2.1.141 under TERM=dumb still emits
			// CSI sequences for animations/spinners), the headless xterm buffer can mangle
			// the prompt marker's position. The cleaned chunk is the most reliable signal
			// for the REPL prompt's appearance; debounce protects against false-positives
			// when ❯ shows up as literal content mid-turn.
			const renderedTail = this._getRenderedTail();
			const idleDetected =
				IDLE_PROMPT_MARKERS.some((marker) => marker.test(renderedTail)) ||
				IDLE_PROMPT_MARKERS.some((marker) => marker.test(chunk));
			if (idleDetected) {
				if (this.seenCompletionPhrase) {
					// Fast path: explicit completion phrase + REPL prompt return → fire now.
					this._fireTurnComplete();
				} else if (this.idleDebounceTimer === null) {
					// Slow path: prompt return alone. Most prompts (code edits, short Q&A)
					// don't elicit a narrative completion phrase, so the REPL return is the
					// only reliable end-of-turn signal. Debounce to avoid false-positives
					// from transient buffer states.
					this.idleDebounceTimer = setTimeout(() => {
						this.idleDebounceTimer = null;
						if (this.disposed || this.turnCompleteEmitted) return;
						this._fireTurnComplete();
					}, ClaudePtyStreamAnalyzer.IDLE_DEBOUNCE_MS);
				}
			}
		}
	}

	private _fireTurnComplete(): void {
		this.turnCompleteEmitted = true;
		if (this.idleDebounceTimer !== null) {
			clearTimeout(this.idleDebounceTimer);
			this.idleDebounceTimer = null;
		}
		this.callbacks.onEvent({
			type: 'result',
			text: this.accumulatedAssistantText,
			sessionId: this.claudeSessionId,
			raw: { source: 'claude-pty-runner' },
		});
		this.callbacks.onTurnComplete();
	}

	/**
	 * Tear-down hook for the runner: cancel any pending idle-debounce timer and
	 * suppress further completion callbacks. Idempotent. Call when the PTY exits
	 * (success, kill, timeout) to prevent a pending debounce from firing post-end
	 * and triggering a phantom onTurnComplete after the runner has already wound down.
	 */
	dispose(): void {
		this.disposed = true;
		if (this.idleDebounceTimer !== null) {
			clearTimeout(this.idleDebounceTimer);
			this.idleDebounceTimer = null;
		}
	}

	/** Get current exit reason, possibly upgraded from analyzer-detected error signatures. */
	getExitReason(): RunnerExitReason {
		return this.currentExitReason;
	}

	/** Reset state for a new turn (rare in per-turn-spawn lifecycle; useful for tests). */
	reset(): void {
		this.term = new Terminal({ cols: 120, rows: 40, allowProposedApi: true });
		this.currentExitReason = 'SUCCESS';
		this.hasInitFired = false;
		this.inThinkingBlock = false;
		this.accumulatedAssistantText = '';
		this.accumulatedThinkingText = '';
		this.expectedEcho = '';
		this.turnCompleteEmitted = false;
		this.seenCompletionPhrase = false;
		if (this.idleDebounceTimer !== null) {
			clearTimeout(this.idleDebounceTimer);
			this.idleDebounceTimer = null;
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
