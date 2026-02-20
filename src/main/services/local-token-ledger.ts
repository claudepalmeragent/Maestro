/**
 * LocalTokenLedger
 *
 * In-memory token ledger that tracks local parser output vs. Honeycomb's
 * last-known totals to fill the OTEL flush gap.
 *
 * Provides bestAvailableEstimate() for capacity checks — the most
 * conservative usage estimate at any moment.
 *
 * In-memory only — no persistence. Session tokens are meaningless after
 * restart (sessions restart too). Honeycomb is the durable store.
 *
 * @see Investigation plan Sections 13.5 (Strategy D), 22.1–22.9
 */

import { BrowserWindow } from 'electron';
import { logger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface SessionLedgerEntry {
	sessionId: string;
	localBillableTokens: number;
	lastLocalUpdateAt: number;
	lastKnownHoneycombTokens: number;
	estimatedUnflushed: number;
	isActive: boolean;
}

export interface FlushStatus {
	state: 'synced' | 'pending' | 'stale';
	totalEstimatedUnflushed: number;
	totalEstimatedUnflushedUsd: number;
	pendingSessionCount: number;
	lastFlushAt: number;
	sinceLastFlushMs: number;
}

export interface UsageEstimate {
	billableTokens: number;
	estimatedUnflushed: number;
	safetyMargin: number;
	total: number;
	confidenceLevel: 'synced' | 'pending' | 'stale';
	asPercentOfBudget: number | null;
}

/** Token event from the parser (matches existing output shape) */
export interface TokenEvent {
	sessionId: string;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheCreationTokens: number;
	costUsd: number;
}

const LOG_CONTEXT = 'LocalTokenLedger';
const ACTIVE_TIMEOUT_MS = 60_000; // 60 seconds without events = idle
const UNFLUSHED_THRESHOLD_PCT = 0.01; // 1% of HC total = synced

// ============================================================================
// Singleton
// ============================================================================

let _instance: LocalTokenLedger | null = null;

export function getLocalTokenLedger(): LocalTokenLedger {
	if (!_instance) {
		_instance = new LocalTokenLedger();
	}
	return _instance;
}

export function closeLocalTokenLedger(): void {
	if (_instance) {
		_instance.dispose();
		_instance = null;
	}
}

// ============================================================================
// Implementation
// ============================================================================

export class LocalTokenLedger {
	private sessions: Map<string, SessionLedgerEntry> = new Map();
	private honeycombBillableTotal: number = 0;
	private lastReconciliationAt: number = 0;
	private lastFlushAt: number = 0;

	/**
	 * Record token usage from the local parser.
	 * Called on every parser 'result' or 'usage' event.
	 */
	recordTokens(event: TokenEvent): void {
		const billable = event.inputTokens + event.outputTokens + event.cacheCreationTokens;

		let entry = this.sessions.get(event.sessionId);
		if (!entry) {
			entry = {
				sessionId: event.sessionId,
				localBillableTokens: 0,
				lastLocalUpdateAt: 0,
				lastKnownHoneycombTokens: 0,
				estimatedUnflushed: 0,
				isActive: true,
			};
			this.sessions.set(event.sessionId, entry);
		}

		entry.localBillableTokens += billable;
		entry.lastLocalUpdateAt = Date.now();
		entry.isActive = true;
		entry.estimatedUnflushed = Math.max(
			0,
			entry.localBillableTokens - entry.lastKnownHoneycombTokens
		);

		// Broadcast flush status update
		this.broadcastFlushStatus();
	}

	/**
	 * Reconcile with Honeycomb usage data after a poll.
	 * Called by HoneycombUsageService on each successful poll.
	 */
	reconcile(honeycombData: { fiveHourBillableTokens: number; weeklyBillableTokens: number }): void {
		// Use the larger of 5hr and weekly as the HC total for comparison
		this.honeycombBillableTotal = Math.max(
			honeycombData.fiveHourBillableTokens,
			honeycombData.weeklyBillableTokens
		);
		this.lastReconciliationAt = Date.now();
		this.lastFlushAt = Date.now();

		// Update per-session unflushed estimates
		// Note: We don't have per-session HC data in the standard poll.
		// The aggregate comparison is sufficient for flush status.
		const localTotal = this.getLocalBillableTotal();
		const totalUnflushed = Math.max(0, localTotal - this.honeycombBillableTotal);

		// If total unflushed is small relative to HC total, sessions are mostly synced
		if (
			this.honeycombBillableTotal > 0 &&
			totalUnflushed / this.honeycombBillableTotal < UNFLUSHED_THRESHOLD_PCT
		) {
			// Mark all sessions as approximately synced
			for (const entry of this.sessions.values()) {
				entry.estimatedUnflushed = 0;
			}
		}

		this.broadcastFlushStatus();
		logger.debug(
			`Reconciled: local=${localTotal}, honeycomb=${this.honeycombBillableTotal}, ` +
				`unflushed=${totalUnflushed}, lastReconciliation=${this.lastReconciliationAt}`,
			LOG_CONTEXT
		);
	}

	/**
	 * Remove a session from tracking (session ended).
	 */
	removeSession(sessionId: string): void {
		this.sessions.delete(sessionId);
		this.broadcastFlushStatus();
	}

	/**
	 * Get the best available usage estimate for a given window.
	 * This is the core function consumed by capacity checks.
	 */
	bestAvailableEstimate(
		windowHoneycombTokens: number,
		calibratedBudget: number | null,
		safetyBufferPct: number = 0.2
	): UsageEstimate {
		const localTotal = this.getLocalBillableTotal();
		const flushStatus = this.getFlushStatus();

		// Safety margin scales with confidence
		const safetyMarginPct =
			flushStatus.state === 'synced' ? safetyBufferPct * 0.5 : safetyBufferPct;

		const billableTokens = Math.max(windowHoneycombTokens, localTotal);
		const estimatedUnflushed = Math.max(0, localTotal - windowHoneycombTokens);
		const safetyMargin = billableTokens * safetyMarginPct;

		return {
			billableTokens,
			estimatedUnflushed,
			safetyMargin,
			total: billableTokens + safetyMargin,
			confidenceLevel: flushStatus.state,
			asPercentOfBudget: calibratedBudget
				? ((billableTokens + safetyMargin) / calibratedBudget) * 100
				: null,
		};
	}

	/**
	 * Get current flush status.
	 */
	getFlushStatus(): FlushStatus {
		const now = Date.now();
		const localTotal = this.getLocalBillableTotal();
		const totalUnflushed = Math.max(0, localTotal - this.honeycombBillableTotal);
		const pendingSessions = Array.from(this.sessions.values()).filter(
			(s) => s.estimatedUnflushed > 0
		).length;

		// Determine state
		let state: FlushStatus['state'];
		if (
			this.honeycombBillableTotal > 0 &&
			totalUnflushed / this.honeycombBillableTotal < UNFLUSHED_THRESHOLD_PCT
		) {
			state = 'synced';
		} else if (now - this.lastFlushAt < 900_000) {
			// Within 15 minutes of last sync
			state = 'pending';
		} else {
			state = 'stale';
		}

		// Estimate USD value of unflushed (rough, using average cost per token)
		// Average cost per billable token ≈ $0.010/1K tokens (rough Opus average)
		const unflushedUsd = totalUnflushed * 0.00001;

		return {
			state,
			totalEstimatedUnflushed: totalUnflushed,
			totalEstimatedUnflushedUsd: unflushedUsd,
			pendingSessionCount: pendingSessions,
			lastFlushAt: this.lastFlushAt,
			sinceLastFlushMs: now - this.lastFlushAt,
		};
	}

	/**
	 * Get total local billable tokens across all sessions.
	 */
	getLocalBillableTotal(): number {
		let total = 0;
		const now = Date.now();
		for (const entry of this.sessions.values()) {
			total += entry.localBillableTokens;
			// Update active status
			entry.isActive = now - entry.lastLocalUpdateAt < ACTIVE_TIMEOUT_MS;
		}
		return total;
	}

	/**
	 * Get the number of tracked sessions.
	 */
	getSessionCount(): number {
		return this.sessions.size;
	}

	/**
	 * Dispose — clear all state.
	 */
	dispose(): void {
		this.sessions.clear();
		this.honeycombBillableTotal = 0;
		this.lastReconciliationAt = 0;
		this.lastFlushAt = 0;
	}

	// ============================================================================
	// Private Methods
	// ============================================================================

	/**
	 * Broadcast flush status to all renderer windows.
	 */
	private broadcastFlushStatus(): void {
		const status = this.getFlushStatus();
		const windows = BrowserWindow.getAllWindows();
		for (const win of windows) {
			if (!win.isDestroyed()) {
				win.webContents.send('honeycomb:flush-status', status);
			}
		}
	}
}
