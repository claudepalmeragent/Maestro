/**
 * ThinkingStatusPill - Displays status when AI is actively processing/thinking.
 * Shows session name, bytes received, elapsed time, and Claude session ID.
 * Appears centered above the input area when the AI is busy.
 *
 * When AutoRun is active, shows a special AutoRun pill with total elapsed time instead.
 */
import { memo, useState, useEffect } from 'react';
import { GitBranch } from 'lucide-react';
import type { Session, Theme, AITab, BatchRunState } from '../types';
import { formatTokensCompact } from '../utils/formatters';

// Estimated bytes per token for Claude responses (UTF-8 English text averages ~3.5 bytes/token)
const BYTES_PER_TOKEN_ESTIMATE = 3.5;

// Helper to get the write-mode (busy) tab from a session
function getWriteModeTab(session: Session): AITab | undefined {
	return session.aiTabs?.find((tab) => tab.state === 'busy');
}

interface ThinkingStatusPillProps {
	/** Pre-filtered array of sessions that are currently thinking (state === 'busy' && busySource === 'ai').
	 * PERF: Caller should memoize this to avoid O(n) filter on every render. */
	thinkingSessions: Session[];
	theme: Theme;
	onSessionClick?: (sessionId: string, tabId?: string) => void;
	namedSessions?: Record<string, string>; // Claude session ID -> custom name
	// AutoRun state for the active session - when provided and running, shows AutoRun pill instead
	autoRunState?: BatchRunState;
	activeSessionId?: string;
	// Callback to stop auto-run (shows stop button in AutoRunPill when provided)
	onStopAutoRun?: () => void;
	// Callback to interrupt the current AI session
	onInterrupt?: () => void;
}

// ElapsedTimeDisplay - shows time since thinking started
const ElapsedTimeDisplay = memo(
	({ startTime, textColor }: { startTime: number; textColor: string }) => {
		const [elapsedSeconds, setElapsedSeconds] = useState(
			Math.floor((Date.now() - startTime) / 1000)
		);

		useEffect(() => {
			const interval = setInterval(() => {
				setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
			}, 1000);
			return () => clearInterval(interval);
		}, [startTime]);

		const formatTime = (seconds: number): string => {
			const days = Math.floor(seconds / 86400);
			const hours = Math.floor((seconds % 86400) / 3600);
			const mins = Math.floor((seconds % 3600) / 60);
			const secs = seconds % 60;

			if (days > 0) {
				return `${days}d ${hours}h ${mins}m ${secs}s`;
			} else if (hours > 0) {
				return `${hours}h ${mins}m ${secs}s`;
			} else {
				return `${mins}m ${secs}s`;
			}
		};

		return (
			<span className="font-mono text-xs" style={{ color: textColor }}>
				{formatTime(elapsedSeconds)}
			</span>
		);
	}
);

ElapsedTimeDisplay.displayName = 'ElapsedTimeDisplay';

// ThroughputDisplay - shows live tokens/second during streaming
const ThroughputDisplay = memo(
	({
		tokens,
		startTime,
		textColor,
		accentColor,
		showPlaceholder = false,
	}: {
		tokens: number;
		startTime: number;
		textColor: string;
		accentColor: string;
		showPlaceholder?: boolean;
	}) => {
		const [throughput, setThroughput] = useState<number>(0);

		useEffect(() => {
			// Update throughput every 500ms for smooth display
			const updateThroughput = () => {
				const elapsedMs = Date.now() - startTime;
				if (elapsedMs > 0 && tokens > 0) {
					const tokPerSec = tokens / (elapsedMs / 1000);
					setThroughput(tokPerSec);
				}
			};

			updateThroughput();
			const interval = setInterval(updateThroughput, 500);
			return () => clearInterval(interval);
		}, [tokens, startTime]);

		// Show placeholder if requested and no throughput yet
		if (showPlaceholder && throughput === 0) {
			return (
				<span className="font-mono text-xs" style={{ color: textColor, opacity: 0.4 }}>
					— tok/s
				</span>
			);
		}

		if (throughput === 0) return null;

		return (
			<span className="font-mono text-xs font-medium" style={{ color: accentColor }}>
				{throughput.toFixed(1)} tok/s
			</span>
		);
	}
);

ThroughputDisplay.displayName = 'ThroughputDisplay';

// Helper to get display name for a session (used in thinking dropdown)
// Priority: 1. namedSessions lookup, 2. tab name, 3. UUID octet
function getSessionDisplayName(session: Session, namedSessions?: Record<string, string>): string {
	// Get the write-mode (busy) tab for this session
	const writeModeTab = getWriteModeTab(session);

	// Use tab's agentSessionId if available, fallback to session's (legacy)
	const agentSessionId = writeModeTab?.agentSessionId || session.agentSessionId;

	// Priority 1: Named session from namedSessions lookup
	if (agentSessionId) {
		const customName = namedSessions?.[agentSessionId];
		if (customName) return customName;
	}

	// Priority 2: Tab name if available
	if (writeModeTab?.name) {
		return writeModeTab.name;
	}

	// Priority 3: UUID octet (first 8 chars uppercase)
	if (agentSessionId) {
		return agentSessionId.substring(0, 8).toUpperCase();
	}

	// Fall back to Maestro session name
	return session.name;
}

// formatTokensCompact imported from ../utils/formatters

// Single session row for the expanded dropdown (Thinking Pill dropdown)
const SessionRow = memo(
	({
		session,
		theme,
		namedSessions,
		onSessionClick,
	}: {
		session: Session;
		theme: Theme;
		namedSessions?: Record<string, string>;
		onSessionClick?: (sessionId: string, tabId?: string) => void;
	}) => {
		const tabDisplayName = getSessionDisplayName(session, namedSessions);
		const maestroName = session.name; // The name from the left sidebar
		const tokens = session.currentCycleTokens || 0;
		const bytes = session.currentCycleBytes || 0;
		// Estimate tokens from bytes when actual count isn't available
		const estimatedTokens = bytes > 0 ? Math.floor(bytes / BYTES_PER_TOKEN_ESTIMATE) : 0;
		const displayTokens = tokens > 0 ? tokens : estimatedTokens;
		const busyTab = getWriteModeTab(session);
		const thinkingStart = busyTab?.thinkingStartTime || session.thinkingStartTime;

		return (
			<button
				onClick={() => onSessionClick?.(session.id, busyTab?.id)}
				className="flex items-center justify-between gap-3 w-full px-3 py-2 text-left hover:bg-white/5 transition-colors"
				style={{ color: theme.colors.textMain }}
			>
				<div className="flex items-center gap-2 min-w-0">
					{/* Pulsing yellow circle indicator */}
					<div
						className="w-2 h-2 rounded-full shrink-0 animate-pulse"
						style={{ backgroundColor: theme.colors.warning }}
					/>
					{/* Maestro session name (from left bar) + Tab name */}
					<span className="text-xs truncate">
						<span className="font-medium">{maestroName}</span>
						<span style={{ color: theme.colors.textDim }}> / </span>
						<span className="font-mono" style={{ color: theme.colors.textDim }}>
							{tabDisplayName}
						</span>
					</span>
				</div>
				<div
					className="flex items-center gap-2 shrink-0 text-xs"
					style={{ color: theme.colors.textDim }}
				>
					{displayTokens > 0 && thinkingStart && (
						<ThroughputDisplay
							tokens={displayTokens}
							startTime={thinkingStart}
							textColor={theme.colors.textDim}
							accentColor={theme.colors.accent}
						/>
					)}
					{displayTokens > 0 && <span>{formatTokensCompact(displayTokens)}</span>}
					{thinkingStart && (
						<ElapsedTimeDisplay startTime={thinkingStart} textColor={theme.colors.textDim} />
					)}
				</div>
			</button>
		);
	}
);

SessionRow.displayName = 'SessionRow';

/**
 * AutoRunPill - Shows when AutoRun is active
 * Displays total elapsed time since AutoRun started, with task progress.
 * Includes a stop button when onStop callback is provided.
 */
const AutoRunPill = memo(
	({
		theme,
		autoRunState,
		onStop,
	}: {
		theme: Theme;
		autoRunState: BatchRunState;
		onStop?: () => void;
	}) => {
		const startTime = autoRunState.startTime || Date.now();
		const { completedTasks, totalTasks, isStopping } = autoRunState;

		// Token statistics for current task (Throughput Status Pill)
		const currentBytes = autoRunState.currentTaskBytes || 0;
		const currentTokens = autoRunState.currentTaskTokens || 0;
		const taskStartTime = autoRunState.currentTaskStartTime || startTime;

		// Estimate tokens from bytes when actual count unavailable
		const estimatedTokens =
			currentBytes > 0 ? Math.floor(currentBytes / BYTES_PER_TOKEN_ESTIMATE) : 0;
		const displayTokens = currentTokens > 0 ? currentTokens : estimatedTokens;
		const isEstimated = currentTokens === 0 && displayTokens > 0;
		const isWaiting = displayTokens === 0;

		// Calculate all token totals for comprehensive display (Phase 4)
		// Agent tokens
		const agentInputOutput =
			(autoRunState.cumulativeInputTokens ?? 0) + (autoRunState.cumulativeOutputTokens ?? 0);
		const agentCache =
			(autoRunState.cumulativeCacheReadTokens ?? 0) +
			(autoRunState.cumulativeCacheCreationTokens ?? 0);

		// Subagent tokens
		const subagentInputOutput =
			(autoRunState.subagentInputTokens ?? 0) + (autoRunState.subagentOutputTokens ?? 0);
		const subagentCache =
			(autoRunState.subagentCacheReadTokens ?? 0) + (autoRunState.subagentCacheCreationTokens ?? 0);

		// Combined totals
		const totalInputOutput = agentInputOutput + subagentInputOutput;
		const totalCache = agentCache + subagentCache;

		// Show cumulative section when any tokens have been accumulated
		const showCumulative = agentInputOutput > 0;

		return (
			<div className="relative flex justify-center pb-2 -mt-2">
				<div
					className="flex items-center gap-2 px-4 py-1.5 rounded-full"
					style={{
						backgroundColor: theme.colors.accent + '20',
						border: `1px solid ${theme.colors.accent}50`,
					}}
				>
					{/* Pulsing accent circle indicator */}
					<div
						className="w-2.5 h-2.5 rounded-full shrink-0 animate-pulse"
						style={{ backgroundColor: theme.colors.accent }}
					/>

					{/* AutoRun label */}
					<span
						className="text-xs font-semibold shrink-0"
						style={{ color: isStopping ? theme.colors.warning : theme.colors.accent }}
					>
						{isStopping ? 'AutoRun Stopping...' : 'AutoRun'}
					</span>

					{/* Worktree indicator */}
					{autoRunState.worktreeActive && (
						<span title={`Worktree: ${autoRunState.worktreeBranch || 'active'}`}>
							<GitBranch className="w-3.5 h-3.5 shrink-0" style={{ color: theme.colors.accent }} />
						</span>
					)}

					{/* Divider */}
					<div className="w-px h-4 shrink-0" style={{ backgroundColor: theme.colors.border }} />

					{/* Task progress */}
					<div
						className="flex items-center gap-1 shrink-0 text-xs"
						style={{ color: theme.colors.textDim }}
					>
						<span>Tasks:</span>
						<span className="font-medium" style={{ color: theme.colors.textMain }}>
							{completedTasks}/{totalTasks}
						</span>
					</div>

					{/* Divider */}
					<div className="w-px h-4 shrink-0" style={{ backgroundColor: theme.colors.border }} />

					{/* Token statistics for current task */}
					<div
						className="flex items-center gap-1 shrink-0 text-xs"
						style={{
							color: isWaiting ? theme.colors.textDim : theme.colors.textMain,
							opacity: isWaiting ? 0.4 : 1,
						}}
						title={isWaiting ? 'Token statistics will appear when data arrives' : undefined}
					>
						<span style={{ color: theme.colors.textDim }}>Current{isEstimated ? '~' : ''}:</span>
						<span className="font-medium">
							{isWaiting ? '—' : `${formatTokensCompact(displayTokens)} tokens`}
						</span>
						<span style={{ color: theme.colors.border }}>|</span>
						<ThroughputDisplay
							tokens={displayTokens}
							startTime={taskStartTime}
							textColor={theme.colors.textDim}
							accentColor={theme.colors.accent}
							showPlaceholder={isWaiting}
						/>
					</div>

					{/* Cumulative tokens - comprehensive format (Phase 4) */}
					{showCumulative && (
						<>
							<div className="w-px h-4 shrink-0" style={{ backgroundColor: theme.colors.border }} />
							<div
								className="flex items-center gap-1 shrink-0 text-xs"
								style={{ color: theme.colors.textDim }}
								title={`Total: ${formatTokensCompact(totalInputOutput)} input+output / ${formatTokensCompact(totalCache)} cache\nAgents: ${formatTokensCompact(agentInputOutput)} / ${formatTokensCompact(agentCache)}\nSubagents: ${formatTokensCompact(subagentInputOutput)} / ${formatTokensCompact(subagentCache)}`}
							>
								<span>Tokens:</span>
								<span className="font-medium" style={{ color: theme.colors.textMain }}>
									{formatTokensCompact(totalInputOutput + displayTokens)}
								</span>
								{totalCache > 0 && (
									<span
										className="font-medium"
										style={{ color: theme.colors.textMain, opacity: 0.7 }}
									>
										/{formatTokensCompact(totalCache)}
									</span>
								)}
								{/* Agent breakdown */}
								{agentInputOutput > 0 && (
									<span style={{ opacity: 0.8 }}>
										(Agents: {formatTokensCompact(agentInputOutput + displayTokens)}
										{agentCache > 0 && (
											<span style={{ opacity: 0.7 }}>/{formatTokensCompact(agentCache)}</span>
										)}
										)
									</span>
								)}
								{/* Subagent breakdown */}
								{subagentInputOutput > 0 && (
									<span style={{ opacity: 0.8 }}>
										(Subagents: {formatTokensCompact(subagentInputOutput)}
										{subagentCache > 0 && (
											<span style={{ opacity: 0.7 }}>/{formatTokensCompact(subagentCache)}</span>
										)}
										)
									</span>
								)}
							</div>
						</>
					)}

					{/* Subagent indicator - shows when a subagent is working */}
					{autoRunState.subagentActive && (
						<>
							<div className="w-px h-4 shrink-0" style={{ backgroundColor: theme.colors.border }} />
							<div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 text-xs">
								<span className="animate-pulse">●</span>
								<span>Subagent: {autoRunState.subagentType || 'unknown'}</span>
								{autoRunState.subagentStartTime && (
									<ElapsedTimeDisplay
										startTime={autoRunState.subagentStartTime}
										textColor="inherit"
									/>
								)}
							</div>
						</>
					)}

					{/* Divider */}
					<div className="w-px h-4 shrink-0" style={{ backgroundColor: theme.colors.border }} />

					{/* Total elapsed time */}
					<div
						className="flex items-center gap-1 shrink-0 text-xs"
						style={{ color: theme.colors.textDim }}
					>
						<span>Elapsed:</span>
						<ElapsedTimeDisplay startTime={startTime} textColor={theme.colors.textMain} />
					</div>

					{/* Stop button - only show when callback provided and not already stopping */}
					{onStop && (
						<>
							<div className="w-px h-4 shrink-0" style={{ backgroundColor: theme.colors.border }} />
							<button
								onClick={() => !isStopping && onStop()}
								disabled={isStopping}
								className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
									isStopping ? 'cursor-not-allowed' : 'hover:opacity-80'
								}`}
								style={{
									backgroundColor: isStopping ? theme.colors.warning : theme.colors.error,
									color: isStopping ? theme.colors.bgMain : 'white',
									pointerEvents: isStopping ? 'none' : 'auto',
								}}
								title={
									isStopping ? 'Stopping after current task...' : 'Stop auto-run after current task'
								}
							>
								{isStopping ? (
									<svg
										className="w-3 h-3 animate-spin"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
									>
										<circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
										<path d="M12 2a10 10 0 0 1 10 10" />
									</svg>
								) : (
									<svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
										<rect x="6" y="6" width="12" height="12" rx="1" />
									</svg>
								)}
								{isStopping ? 'Stopping' : 'Stop'}
							</button>
						</>
					)}
				</div>
			</div>
		);
	}
);

AutoRunPill.displayName = 'AutoRunPill';

/**
 * ThinkingStatusPill Inner Component
 * Shows the primary thinking session with an expandable list when multiple sessions are thinking.
 * Features: pulsing indicator, session name, bytes/tokens, elapsed time, Claude session UUID.
 *
 * When AutoRun is active for the active session, shows AutoRunPill instead.
 */
function ThinkingStatusPillInner({
	thinkingSessions,
	theme,
	onSessionClick,
	namedSessions,
	autoRunState,
	activeSessionId,
	onStopAutoRun,
	onInterrupt,
}: ThinkingStatusPillProps) {
	const [isExpanded, setIsExpanded] = useState(false);

	// If AutoRun is active for the current session, show the AutoRun pill instead
	if (autoRunState?.isRunning) {
		return <AutoRunPill theme={theme} autoRunState={autoRunState} onStop={onStopAutoRun} />;
	}

	// thinkingSessions is pre-filtered by caller (PERF optimization)
	if (thinkingSessions.length === 0) {
		return null;
	}

	// Primary session: prioritize the active session if it's thinking,
	// otherwise fall back to first thinking session.
	// This ensures Stop button stops the session the user is currently viewing.
	const activeThinkingSession = thinkingSessions.find((s) => s.id === activeSessionId);
	const primarySession = activeThinkingSession || thinkingSessions[0];
	const additionalSessions = thinkingSessions.filter((s) => s.id !== primarySession.id);
	const hasMultiple = additionalSessions.length > 0;

	// Get tokens for current thinking cycle only (not cumulative context)
	const primaryTokens = primarySession.currentCycleTokens || 0;
	const primaryBytes = primarySession.currentCycleBytes || 0;

	// Estimate tokens from bytes when actual token count isn't available yet
	// (Claude Code only reports token counts in the final 'result' message, not during streaming)
	const estimatedTokens =
		primaryBytes > 0 ? Math.floor(primaryBytes / BYTES_PER_TOKEN_ESTIMATE) : 0;
	const displayTokens = primaryTokens > 0 ? primaryTokens : estimatedTokens;
	const isEstimated = primaryTokens === 0 && displayTokens > 0;

	// Get display components - show more on larger screens
	const maestroSessionName = primarySession.name;

	// Get the write-mode tab to display its info (for tabified sessions)
	const writeModeTab = getWriteModeTab(primarySession);

	// Use tab's agentSessionId if available, fallback to session's (legacy)
	const agentSessionId = writeModeTab?.agentSessionId || primarySession.agentSessionId;

	// Priority: 1. namedSessions lookup, 2. tab's name, 3. UUID octet
	const customName = agentSessionId ? namedSessions?.[agentSessionId] : undefined;
	const tabName = writeModeTab?.name;

	// Display name for the tab slot (to the left of Stop button):
	// prefer namedSessions, then tab name, then UUID octet (NOT session name - that's already shown)
	const displayClaudeId =
		customName || tabName || (agentSessionId ? agentSessionId.substring(0, 8).toUpperCase() : null);

	// For tooltip, show all available info
	const tooltipParts = [maestroSessionName];
	if (agentSessionId) tooltipParts.push(`Claude: ${agentSessionId}`);
	if (tabName) tooltipParts.push(`Tab: ${tabName}`);
	if (customName) tooltipParts.push(`Named: ${customName}`);
	const fullTooltip = tooltipParts.join(' | ');

	return (
		// Thinking Pill - centered container with negative top margin to offset parent padding
		<div className="relative flex justify-center pb-2 -mt-2">
			{/* Thinking Pill - shrinks to fit content */}
			<div
				className="flex items-center gap-2 px-4 py-1.5 rounded-full"
				style={{
					backgroundColor: theme.colors.warning + '20',
					border: `1px solid ${theme.colors.border}`,
				}}
			>
				{/* Thinking Pill - Pulsing yellow circle indicator */}
				<div
					className="w-2.5 h-2.5 rounded-full shrink-0 animate-pulse"
					style={{ backgroundColor: theme.colors.warning }}
				/>

				{/* Maestro session name - always visible, not clickable */}
				<span
					className="text-xs font-medium shrink-0"
					style={{ color: theme.colors.textMain }}
					title={fullTooltip}
				>
					{maestroSessionName}
				</span>

				{/* Divider */}
				<div className="w-px h-4 shrink-0" style={{ backgroundColor: theme.colors.border }} />

				{/* Token info for this thought cycle - shows estimated during streaming, actual after completion */}
				{displayTokens > 0 && (
					<div
						className="flex items-center gap-1 shrink-0 text-xs"
						style={{ color: theme.colors.textDim }}
					>
						<span>Tokens{isEstimated ? '~' : ''}:</span>
						<span className="font-medium" style={{ color: theme.colors.textMain }}>
							{formatTokensCompact(displayTokens)}
						</span>
						{/* Real-time throughput display */}
						{(writeModeTab?.thinkingStartTime || primarySession.thinkingStartTime) && (
							<>
								<span style={{ color: theme.colors.border }}>|</span>
								<ThroughputDisplay
									tokens={displayTokens}
									startTime={writeModeTab?.thinkingStartTime || primarySession.thinkingStartTime!}
									textColor={theme.colors.textDim}
									accentColor={theme.colors.accent}
								/>
							</>
						)}
					</div>
				)}

				{/* Placeholder when no data yet (before first chunk arrives) */}
				{displayTokens === 0 && (
					<div
						className="flex items-center gap-1 shrink-0 text-xs"
						style={{ color: theme.colors.textDim }}
					>
						<span>Thinking...</span>
					</div>
				)}

				{/* Elapsed time - prefer write-mode tab's time for accurate parallel tracking */}
				{(writeModeTab?.thinkingStartTime || primarySession.thinkingStartTime) && (
					<>
						<div className="w-px h-4 shrink-0" style={{ backgroundColor: theme.colors.border }} />
						<div
							className="flex items-center gap-1 shrink-0 text-xs"
							style={{ color: theme.colors.textDim }}
						>
							<span>Elapsed:</span>
							<ElapsedTimeDisplay
								startTime={writeModeTab?.thinkingStartTime || primarySession.thinkingStartTime!}
								textColor={theme.colors.textMain}
							/>
						</div>
					</>
				)}

				{/* Thinking Pill - Claude session ID / tab name */}
				{displayClaudeId && (
					<>
						<div className="w-px h-4 shrink-0" style={{ backgroundColor: theme.colors.border }} />
						<button
							onClick={() => onSessionClick?.(primarySession.id, writeModeTab?.id)}
							className="text-xs font-mono hover:underline cursor-pointer"
							style={{ color: theme.colors.accent }}
							title={agentSessionId ? `Claude Session: ${agentSessionId}` : 'Claude Session'}
						>
							{displayClaudeId}
						</button>
					</>
				)}

				{/* Additional sessions indicator dot */}
				{hasMultiple && (
					<div
						className="relative"
						onMouseEnter={() => setIsExpanded(true)}
						onMouseLeave={() => setIsExpanded(false)}
					>
						<div
							className="w-5 h-5 rounded-full flex items-center justify-center cursor-pointer hover:scale-110 transition-transform"
							style={{
								backgroundColor: theme.colors.warning + '40',
								border: `1px solid ${theme.colors.warning}60`,
							}}
							title={`+${additionalSessions.length} more thinking`}
						>
							<span className="text-[10px] font-bold" style={{ color: theme.colors.warning }}>
								+{additionalSessions.length}
							</span>
						</div>

						{/* Expanded dropdown - positioned above to avoid going off-screen */}
						{isExpanded && (
							<div className="absolute right-0 bottom-full pb-1 z-50">
								<div
									className="min-w-[320px] rounded-lg shadow-xl overflow-hidden"
									style={{
										backgroundColor: theme.colors.bgSidebar,
										border: `1px solid ${theme.colors.border}`,
									}}
								>
									<div
										className="px-3 py-1.5 text-[10px] uppercase tracking-wide font-semibold"
										style={{
											color: theme.colors.textDim,
											backgroundColor: theme.colors.bgActivity,
										}}
									>
										All Thinking Sessions
									</div>
									{thinkingSessions.map((session) => (
										<SessionRow
											key={session.id}
											session={session}
											theme={theme}
											namedSessions={namedSessions}
											onSessionClick={onSessionClick}
										/>
									))}
								</div>
							</div>
						)}
					</div>
				)}

				{/* Stop/Interrupt button */}
				{onInterrupt && (
					<>
						<div className="w-px h-4 shrink-0" style={{ backgroundColor: theme.colors.border }} />
						<button
							type="button"
							onClick={onInterrupt}
							className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors hover:opacity-80"
							style={{
								backgroundColor: theme.colors.error,
								color: 'white',
							}}
							title="Interrupt Claude (Ctrl+C)"
						>
							<svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
								<rect x="6" y="6" width="12" height="12" rx="1" />
							</svg>
							Stop
						</button>
					</>
				)}
			</div>
			{/* End Thinking Pill */}
		</div>
	);
}

// Memoized export
// PERF: thinkingSessions is pre-filtered by caller, so comparator is O(n) on thinking sessions only,
// not O(n) on ALL sessions. This avoids the expensive filter on every keystroke.
export const ThinkingStatusPill = memo(ThinkingStatusPillInner, (prevProps, nextProps) => {
	// Check autoRunState changes first (highest priority)
	const prevAutoRun = prevProps.autoRunState;
	const nextAutoRun = nextProps.autoRunState;

	if (prevAutoRun?.isRunning !== nextAutoRun?.isRunning) return false;
	if (nextAutoRun?.isRunning) {
		// When AutoRun is active, check its properties
		if (
			prevAutoRun?.completedTasks !== nextAutoRun?.completedTasks ||
			prevAutoRun?.totalTasks !== nextAutoRun?.totalTasks ||
			prevAutoRun?.isStopping !== nextAutoRun?.isStopping ||
			prevAutoRun?.startTime !== nextAutoRun?.startTime ||
			// Subagent tracking state
			prevAutoRun?.subagentActive !== nextAutoRun?.subagentActive ||
			prevAutoRun?.subagentType !== nextAutoRun?.subagentType ||
			prevAutoRun?.subagentStartTime !== nextAutoRun?.subagentStartTime ||
			// Token tracking state (Throughput Status Pill)
			prevAutoRun?.currentTaskBytes !== nextAutoRun?.currentTaskBytes ||
			prevAutoRun?.currentTaskTokens !== nextAutoRun?.currentTaskTokens ||
			prevAutoRun?.currentTaskStartTime !== nextAutoRun?.currentTaskStartTime ||
			prevAutoRun?.cumulativeInputTokens !== nextAutoRun?.cumulativeInputTokens ||
			prevAutoRun?.cumulativeOutputTokens !== nextAutoRun?.cumulativeOutputTokens ||
			prevAutoRun?.cumulativeCacheReadTokens !== nextAutoRun?.cumulativeCacheReadTokens ||
			prevAutoRun?.cumulativeCacheCreationTokens !== nextAutoRun?.cumulativeCacheCreationTokens ||
			prevAutoRun?.cumulativeCost !== nextAutoRun?.cumulativeCost ||
			// Phase 3: Subagent token tracking
			prevAutoRun?.subagentInputTokens !== nextAutoRun?.subagentInputTokens ||
			prevAutoRun?.subagentOutputTokens !== nextAutoRun?.subagentOutputTokens ||
			prevAutoRun?.subagentCacheReadTokens !== nextAutoRun?.subagentCacheReadTokens ||
			prevAutoRun?.subagentCacheCreationTokens !== nextAutoRun?.subagentCacheCreationTokens
		) {
			return false;
		}
		// Don't need to check thinking sessions when AutoRun is active
		return prevProps.theme === nextProps.theme;
	}

	// Check if activeSessionId changed - this affects which session shows as primary
	if (prevProps.activeSessionId !== nextProps.activeSessionId) return false;

	// thinkingSessions is pre-filtered by caller - just compare directly
	const prevThinking = prevProps.thinkingSessions;
	const nextThinking = nextProps.thinkingSessions;

	if (prevThinking.length !== nextThinking.length) return false;

	// Compare each thinking session's relevant properties
	for (let i = 0; i < prevThinking.length; i++) {
		const prev = prevThinking[i];
		const next = nextThinking[i];
		if (
			prev.id !== next.id ||
			prev.name !== next.name ||
			prev.agentSessionId !== next.agentSessionId ||
			prev.state !== next.state ||
			prev.thinkingStartTime !== next.thinkingStartTime ||
			prev.currentCycleTokens !== next.currentCycleTokens ||
			prev.currentCycleBytes !== next.currentCycleBytes
		) {
			return false;
		}

		// Also check write-mode tab's name, agentSessionId, and thinkingStartTime (for tabified sessions)
		const prevWriteTab = getWriteModeTab(prev);
		const nextWriteTab = getWriteModeTab(next);
		if (
			prevWriteTab?.id !== nextWriteTab?.id ||
			prevWriteTab?.name !== nextWriteTab?.name ||
			prevWriteTab?.agentSessionId !== nextWriteTab?.agentSessionId ||
			prevWriteTab?.thinkingStartTime !== nextWriteTab?.thinkingStartTime
		) {
			return false;
		}
	}

	// Check if namedSessions changed for any thinking session
	if (prevProps.namedSessions !== nextProps.namedSessions) {
		for (const session of nextThinking) {
			// Check both session's and write-mode tab's agentSessionId
			const writeTab = getWriteModeTab(session);
			const claudeId = writeTab?.agentSessionId || session.agentSessionId;
			if (claudeId) {
				const prevName = prevProps.namedSessions?.[claudeId];
				const nextName = nextProps.namedSessions?.[claudeId];
				if (prevName !== nextName) return false;
			}
		}
	}

	// Note: We intentionally don't compare onInterrupt/onStopAutoRun callbacks
	// because they may change reference on parent re-renders but are semantically
	// the same. The component will use the latest callback from props anyway.

	return prevProps.theme === nextProps.theme;
});

ThinkingStatusPill.displayName = 'ThinkingStatusPill';
