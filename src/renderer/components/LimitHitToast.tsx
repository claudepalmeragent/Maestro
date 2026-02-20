/**
 * LimitHitToast
 *
 * Toast notification shown when a running task receives a rate-limit
 * error from Anthropic. Displays current usage and window reset time.
 *
 * Shows in the synopsis/notification area.
 *
 * @see Investigation plan Section 23.4
 */

import { useState, useEffect } from 'react';
import { AlertTriangle, X, Clock } from 'lucide-react';
import type { Theme } from '../types';

export interface LimitHitToastData {
	fiveHourPct: number;
	weeklyPct: number;
	userOverrodeWarning: boolean;
	resetInMs: number;
}

export interface LimitHitToastProps {
	theme: Theme;
	data: LimitHitToastData | null;
	onDismiss: () => void;
}

function formatCountdown(ms: number): string {
	if (ms <= 0) return 'now';
	const totalMinutes = Math.ceil(ms / 60000);
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}

export function LimitHitToast({ theme, data, onDismiss }: LimitHitToastProps) {
	const [countdown, setCountdown] = useState(data?.resetInMs || 0);

	useEffect(() => {
		if (!data) return;
		setCountdown(data.resetInMs);
		const interval = setInterval(() => {
			setCountdown((prev) => Math.max(0, prev - 60000));
		}, 60000);
		return () => clearInterval(interval);
	}, [data]);

	if (!data) return null;

	return (
		<div
			role="alert"
			className="rounded-lg shadow-lg overflow-hidden"
			style={{
				backgroundColor: 'rgba(239,68,68,0.12)',
				border: '1px solid rgba(239,68,68,0.3)',
				maxWidth: '450px',
			}}
		>
			<div className="px-3 py-2 flex items-start gap-2">
				<AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#ef4444' }} />

				<div className="flex-1 space-y-1">
					<div className="text-xs font-medium" style={{ color: theme.colors.textMain }}>
						Run stopped: usage limit reached
					</div>

					<div
						className="flex items-center gap-3 text-[10px]"
						style={{ color: theme.colors.textDim }}
					>
						<span>5-hr: {data.fiveHourPct.toFixed(0)}% used</span>
						<span>|</span>
						<span>Weekly: {data.weeklyPct.toFixed(0)}% used</span>
					</div>

					<div className="text-[10px]" style={{ color: theme.colors.textDim }}>
						Remaining tasks can be resumed when the window resets.
					</div>

					<div
						className="flex items-center gap-1 text-[10px]"
						style={{ color: theme.colors.textDim }}
					>
						<Clock className="w-3 h-3" />
						<span>5-hr window resets in: {formatCountdown(countdown)}</span>
					</div>

					{!data.userOverrodeWarning && (
						<div className="text-[10px] mt-1" style={{ color: '#eab308' }}>
							Unexpected limit reached — consider calibrating for better estimates.
						</div>
					)}
				</div>

				<button
					onClick={onDismiss}
					className="p-0.5 rounded hover:bg-white/10 flex-shrink-0"
					style={{ color: theme.colors.textDim }}
					aria-label="Dismiss"
				>
					<X className="w-3.5 h-3.5" />
				</button>
			</div>
		</div>
	);
}
