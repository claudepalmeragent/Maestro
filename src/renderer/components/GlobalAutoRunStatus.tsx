/**
 * GlobalAutoRunStatus.tsx
 *
 * Shows a compact status bar for ALL agents running Auto Run tasks,
 * visible regardless of which agent tab is currently active.
 * Clicking an entry switches to that agent.
 */

import { memo, useMemo, useState, useEffect } from 'react';
import { Bot, ChevronDown, ChevronUp } from 'lucide-react';
import type { Theme, BatchRunState, Session } from '../types';

interface ActiveBatchInfo {
	sessionId: string;
	sessionName: string;
	batchState: BatchRunState;
}

interface GlobalAutoRunStatusProps {
	theme: Theme;
	/** All sessions */
	sessions: Session[];
	/** Function to get batch state for a session */
	getBatchState: (sessionId: string) => BatchRunState;
	/** Currently active session ID */
	activeSessionId: string;
	/** Callback to switch to a session */
	onSwitchToSession: (sessionId: string) => void;
}

/** Format elapsed time from start timestamp */
function formatElapsed(startTime: number | undefined): string {
	if (!startTime) return '';
	const seconds = Math.floor((Date.now() - startTime) / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const secs = seconds % 60;
	if (minutes < 60) return `${minutes}m ${secs}s`;
	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;
	return `${hours}h ${mins}m`;
}

export const GlobalAutoRunStatus = memo(function GlobalAutoRunStatus({
	theme,
	sessions,
	getBatchState,
	activeSessionId,
	onSwitchToSession,
}: GlobalAutoRunStatusProps) {
	const [expanded, setExpanded] = useState(false);
	const [, setTick] = useState(0); // Force re-render for elapsed time

	// Collect all active batch sessions
	const activeBatches: ActiveBatchInfo[] = useMemo(() => {
		return sessions
			.map((s) => ({
				sessionId: s.id,
				sessionName: s.name,
				batchState: getBatchState(s.id),
			}))
			.filter((info) => info.batchState.isRunning);
	}, [sessions, getBatchState]);

	// Tick every 5 seconds to update elapsed times
	useEffect(() => {
		if (activeBatches.length === 0) return;
		const interval = setInterval(() => setTick((t) => t + 1), 5000);
		return () => clearInterval(interval);
	}, [activeBatches.length]);

	// Don't render if no active batches, or if the ONLY active batch is the current session
	// (the regular AutoRunPill already handles that case)
	if (activeBatches.length === 0) return null;
	const onlyCurrentSession =
		activeBatches.length === 1 && activeBatches[0].sessionId === activeSessionId;
	if (onlyCurrentSession) return null;

	// Separate current session from others
	const otherBatches = activeBatches.filter((b) => b.sessionId !== activeSessionId);

	return (
		<div
			className="mx-4 mb-1 rounded-lg border overflow-hidden"
			style={{
				backgroundColor: theme.colors.warning + '08',
				borderColor: theme.colors.warning + '30',
			}}
		>
			{/* Summary bar - always visible */}
			<button
				onClick={() => setExpanded((prev) => !prev)}
				className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:brightness-110 transition-colors"
				style={{ color: theme.colors.warning }}
			>
				<Bot className="w-3.5 h-3.5 animate-pulse" />
				<span className="font-medium">
					{activeBatches.length} Auto Run{activeBatches.length !== 1 ? 's' : ''} active
				</span>
				{!expanded && otherBatches.length > 0 && (
					<span className="opacity-70 truncate">
						{'· '}
						{otherBatches.map((b) => b.sessionName).join(', ')}
					</span>
				)}
				<span className="ml-auto shrink-0">
					{expanded ? (
						<ChevronUp className="w-3.5 h-3.5" />
					) : (
						<ChevronDown className="w-3.5 h-3.5" />
					)}
				</span>
			</button>

			{/* Expanded list */}
			{expanded && (
				<div
					className="border-t px-2 py-1 space-y-1"
					style={{ borderColor: theme.colors.warning + '20' }}
				>
					{activeBatches.map((batch) => {
						const bs = batch.batchState;
						const isActive = batch.sessionId === activeSessionId;
						const progress =
							bs.totalTasksAcrossAllDocs > 0
								? `${bs.completedTasksAcrossAllDocs}/${bs.totalTasksAcrossAllDocs}`
								: `${bs.completedTasks}/${bs.totalTasks}`;

						return (
							<button
								key={batch.sessionId}
								onClick={() => onSwitchToSession(batch.sessionId)}
								className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:brightness-110 transition-colors"
								style={{
									backgroundColor: isActive ? theme.colors.accent + '15' : 'transparent',
									color: theme.colors.textMain,
								}}
							>
								<span
									className="w-1.5 h-1.5 rounded-full shrink-0 animate-pulse"
									style={{
										backgroundColor: bs.isStopping
											? theme.colors.error
											: bs.errorPaused
												? theme.colors.warning
												: theme.colors.success,
									}}
								/>
								<span className="font-medium truncate max-w-[120px]">{batch.sessionName}</span>
								{isActive && (
									<span
										className="text-[9px] px-1 rounded"
										style={{
											backgroundColor: theme.colors.accent + '20',
											color: theme.colors.accent,
										}}
									>
										viewing
									</span>
								)}
								<span className="opacity-70">Tasks: {progress}</span>
								{bs.worktreeActive && bs.worktreeBranch && (
									<span className="opacity-50 truncate max-w-[80px]">{bs.worktreeBranch}</span>
								)}
								<span className="ml-auto opacity-50 font-mono">{formatElapsed(bs.startTime)}</span>
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
});
