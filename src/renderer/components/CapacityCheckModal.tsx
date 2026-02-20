/**
 * CapacityCheckModal
 *
 * Confirm/cancel modal shown when a pre-run capacity check
 * detects that starting a task may exceed plan limits.
 *
 * Features:
 * - Progress bars for 5-hour and weekly windows
 * - Task complexity estimate
 * - Red [Run Anyway] button
 * - Not dismissable by clicking outside or pressing Escape
 *
 * @see Investigation plan Section 23.3
 */

import { AlertTriangle } from 'lucide-react';
import type { Theme } from '../types';

export interface CapacityCheckModalData {
	reason: 'burst_limit' | 'weekly_limit' | 'both';
	fiveHourPct: number;
	weeklyPct: number;
	taskComplexity: 'SMALL' | 'MEDIUM' | 'LARGE';
	estimatedTaskPct: number;
	safetyBufferPct: number;
	// Optional context for complexity detail line
	complexityDetail?: string;
}

export interface CapacityCheckModalProps {
	theme: Theme;
	data: CapacityCheckModalData;
	isOpen: boolean;
	onCancel: () => void;
	onRunAnyway: () => void;
}

function ProgressBar({
	theme,
	label,
	pct,
	bufferPct,
	isTriggered,
}: {
	theme: Theme;
	label: string;
	pct: number;
	bufferPct: number;
	isTriggered: boolean;
}) {
	const remaining = Math.max(0, 100 - pct - bufferPct);
	const barColor = isTriggered ? '#ef4444' : pct >= 60 ? '#eab308' : theme.colors.accent;

	return (
		<div className="space-y-1">
			<div className="flex items-center justify-between">
				<span className="text-xs font-medium" style={{ color: theme.colors.textMain }}>
					{label}
				</span>
				<span className="text-xs font-mono" style={{ color: barColor }}>
					{pct.toFixed(0)}% used
				</span>
			</div>
			<div
				className="h-3 rounded-full overflow-hidden"
				style={{ backgroundColor: theme.colors.bgActivity }}
			>
				<div
					className="h-full rounded-full transition-all"
					style={{ width: `${Math.min(100, pct)}%`, backgroundColor: barColor }}
				/>
			</div>
			<div
				className="flex items-center justify-between text-[10px]"
				style={{ color: theme.colors.textDim }}
			>
				<span>Safety buffer: {bufferPct}%</span>
				<span>
					{remaining > 0
						? `${remaining.toFixed(0)}% remaining — ${isTriggered ? 'WARNING' : 'OK'}`
						: 'No headroom remaining'}
				</span>
			</div>
		</div>
	);
}

export function CapacityCheckModal({
	theme,
	data,
	isOpen,
	onCancel,
	onRunAnyway,
}: CapacityCheckModalProps) {
	if (!isOpen) return null;

	const burstTriggered = data.reason === 'burst_limit' || data.reason === 'both';
	const weeklyTriggered = data.reason === 'weekly_limit' || data.reason === 'both';

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center"
			style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
			// Intentionally no onClick dismiss — requires explicit choice
		>
			<div
				className="rounded-lg shadow-xl overflow-hidden"
				style={{
					backgroundColor: theme.colors.bgMain,
					border: `1px solid ${theme.colors.border}`,
					width: '500px',
				}}
			>
				{/* Header */}
				<div
					className="flex items-center gap-2 px-4 py-3 border-b"
					style={{
						borderColor: theme.colors.border,
						backgroundColor: 'rgba(239,68,68,0.08)',
					}}
				>
					<AlertTriangle className="w-4 h-4" style={{ color: '#ef4444' }} />
					<span className="text-sm font-semibold" style={{ color: theme.colors.textMain }}>
						Usage Limit Warning
					</span>
				</div>

				{/* Content */}
				<div className="p-4 space-y-4">
					<div className="text-xs" style={{ color: theme.colors.textMain }}>
						Starting this task may exceed your plan limits.
					</div>

					{/* Progress bars */}
					<ProgressBar
						theme={theme}
						label="5-Hour Window"
						pct={data.fiveHourPct}
						bufferPct={data.safetyBufferPct}
						isTriggered={burstTriggered}
					/>

					<ProgressBar
						theme={theme}
						label="Weekly Limit"
						pct={data.weeklyPct}
						bufferPct={data.safetyBufferPct}
						isTriggered={weeklyTriggered}
					/>

					{/* Complexity detail */}
					<div
						className="text-xs px-3 py-2 rounded"
						style={{
							backgroundColor: theme.colors.bgActivity,
							color: theme.colors.textDim,
						}}
					>
						This task is estimated to incur a <strong>{data.taskComplexity}</strong> token cost
						{data.complexityDetail ? `, based on ${data.complexityDetail}` : ''} (~
						{data.estimatedTaskPct}% of 5-hr window).
					</div>
				</div>

				{/* Actions */}
				<div
					className="flex items-center justify-between px-4 py-3 border-t"
					style={{ borderColor: theme.colors.border }}
				>
					<button
						onClick={onCancel}
						className="px-4 py-2 text-xs rounded border transition-colors hover:opacity-80"
						style={{
							borderColor: theme.colors.border,
							color: theme.colors.textMain,
							backgroundColor: 'transparent',
						}}
					>
						Cancel
					</button>
					<button
						onClick={onRunAnyway}
						className="px-4 py-2 text-xs font-medium rounded transition-colors hover:opacity-90"
						style={{
							backgroundColor: '#ef4444',
							color: '#ffffff',
						}}
					>
						Run Anyway
					</button>
				</div>
			</div>
		</div>
	);
}
