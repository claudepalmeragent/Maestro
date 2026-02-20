/**
 * FlushStatusIndicator
 *
 * Shows OTEL flush state across all known sessions.
 * Displays sync status and prompts for calibration when appropriate.
 *
 * @see Investigation plan Section 21.3.2
 */

import type { Theme } from '../../types';

export interface FlushStatusData {
	state: 'synced' | 'pending' | 'stale';
	totalEstimatedUnflushed: number;
	pendingSessionCount: number;
	lastFlushAt: string;
	sinceLastFlushMs: number;
}

export interface FlushStatusIndicatorProps {
	theme: Theme;
	flushStatus: FlushStatusData | null;
	lastCalibratedAt: string;
	onCalibrateClick?: () => void;
}

function formatDuration(ms: number): string {
	if (ms < 60000) return `${Math.round(ms / 1000)}s`;
	if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
	return `${(ms / 3600000).toFixed(1)}h`;
}

export function FlushStatusIndicator({
	theme,
	flushStatus,
	lastCalibratedAt,
	onCalibrateClick,
}: FlushStatusIndicatorProps) {
	if (!flushStatus) {
		return (
			<div className="text-xs py-2" style={{ color: theme.colors.textDim }}>
				Flush status unavailable
			</div>
		);
	}

	const stateColors: Record<string, string> = {
		synced: '#22c55e',
		pending: '#eab308',
		stale: '#ef4444',
	};

	const stateIcons: Record<string, string> = {
		synced: '●',
		pending: '◐',
		stale: '○',
	};

	const stateColor = stateColors[flushStatus.state] || theme.colors.textDim;
	const icon = stateIcons[flushStatus.state] || '?';

	// Show calibration prompt if synced and >24h since last calibration
	const lastCalMs = lastCalibratedAt ? Date.now() - new Date(lastCalibratedAt).getTime() : Infinity;
	const showCalibrationPrompt = flushStatus.state === 'synced' && lastCalMs > 24 * 3600000;

	return (
		<div className="py-2 space-y-1">
			<div className="flex items-center gap-2 text-xs">
				<span style={{ color: stateColor }}>{icon}</span>
				{flushStatus.state === 'synced' && (
					<span style={{ color: theme.colors.textMain }}>
						All sessions synced (last flush: {formatDuration(flushStatus.sinceLastFlushMs)} ago)
					</span>
				)}
				{flushStatus.state === 'pending' && (
					<span style={{ color: theme.colors.textMain }}>
						{flushStatus.pendingSessionCount} session
						{flushStatus.pendingSessionCount !== 1 ? 's' : ''} pending flush (~$
						{flushStatus.totalEstimatedUnflushed.toFixed(2)} estimated unflushed)
					</span>
				)}
				{flushStatus.state === 'stale' && (
					<span style={{ color: theme.colors.textMain }}>
						Honeycomb data stale (last sync: {formatDuration(flushStatus.sinceLastFlushMs)} ago —
						polling paused?)
					</span>
				)}
			</div>

			{showCalibrationPrompt && onCalibrateClick && (
				<div className="text-xs flex items-center gap-2" style={{ color: theme.colors.textDim }}>
					Good time to calibrate!
					<button
						onClick={onCalibrateClick}
						className="text-xs underline hover:opacity-80"
						style={{ color: theme.colors.accent }}
					>
						Calibrate Now...
					</button>
				</div>
			)}
		</div>
	);
}
