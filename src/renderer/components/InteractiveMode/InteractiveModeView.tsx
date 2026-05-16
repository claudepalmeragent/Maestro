/**
 * Interactive Mode View
 *
 * Renders the raw PTY stream from a ClaudePtyRunner as a scrollable ANSI terminal.
 * Uses ansi-to-html (same approach as TerminalOutput) rather than a true xterm.js DOM instance,
 * since @xterm/xterm is not installed in this project.
 *
 * Features:
 * - Live raw PTY output from claude-pty:rawData IPC events
 * - Take Control / Resume Orchestration toggle
 * - Keyboard passthrough to injectManualCommand when user-controlled
 * - Confirmation modal when taking control while runner is busy
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Convert from 'ansi-to-html';
import type { Theme } from '../../types';

interface InteractiveModeViewProps {
	sessionId: string;
	theme: Theme;
}

interface RunnerState {
	isBusy: boolean;
	userControlled: boolean;
	alive: boolean;
}

/** Max number of PTY chunks retained in memory to keep the view responsive. */
const MAX_CHUNKS = 2000;

export function InteractiveModeView({ sessionId, theme }: InteractiveModeViewProps) {
	const [chunks, setChunks] = useState<string[]>([]);
	const [userControlled, setUserControlled] = useState(false);
	const [showConfirmModal, setShowConfirmModal] = useState(false);
	const [runnerState, setRunnerState] = useState<RunnerState>({
		isBusy: false,
		userControlled: false,
		alive: false,
	});

	const scrollRef = useRef<HTMLDivElement>(null);
	const atBottomRef = useRef(true);

	const ansiConverter = useMemo(
		() =>
			new Convert({
				fg: theme.colors.textMain,
				bg: theme.colors.bgMain,
				newline: true,
				escapeXML: true,
			}),
		[theme]
	);

	// Refresh runner state periodically so the button label and busy flag stay current.
	const refreshRunnerState = useCallback(async () => {
		try {
			const state = await window.maestro.claudePty.getState(sessionId);
			if (state) setRunnerState(state);
		} catch {
			// stub returns null until ARD 5 wires the runner registry
		}
	}, [sessionId]);

	useEffect(() => {
		refreshRunnerState();
		const interval = setInterval(refreshRunnerState, 2000);
		return () => clearInterval(interval);
	}, [refreshRunnerState]);

	// Subscribe to raw PTY data from main process.
	useEffect(() => {
		const unsub = window.maestro.claudePty.onRawData(sessionId, (chunk: string) => {
			setChunks((prev) => {
				const next = [...prev, chunk];
				return next.length > MAX_CHUNKS ? next.slice(next.length - MAX_CHUNKS) : next;
			});
		});
		return unsub;
	}, [sessionId]);

	// Auto-scroll to bottom when new data arrives, unless the user has scrolled up.
	useEffect(() => {
		if (atBottomRef.current && scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [chunks]);

	const handleScroll = useCallback(() => {
		if (!scrollRef.current) return;
		const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
		atBottomRef.current = scrollTop + clientHeight >= scrollHeight - 8;
	}, []);

	// Forward keystrokes to the runner when in user-controlled state.
	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLDivElement>) => {
			if (!userControlled) return;
			// Build a simple character string from the key event.
			let data: string | null = null;
			if (e.key === 'Enter') data = '\r';
			else if (e.key === 'Backspace') data = '\x7f';
			else if (e.ctrlKey && e.key.length === 1)
				data = String.fromCharCode(e.key.charCodeAt(0) - 64);
			else if (e.key.length === 1) data = e.key;

			if (data) {
				e.preventDefault();
				e.stopPropagation();
				window.maestro.claudePty.injectManualCommand(sessionId, data);
			}
		},
		[userControlled, sessionId]
	);

	// ---- Take Control / Resume Orchestration logic ----

	const activateTakeControl = useCallback(async () => {
		setUserControlled(true);
		await window.maestro.claudePty.setUserControlled(sessionId, true);
		await refreshRunnerState();
	}, [sessionId, refreshRunnerState]);

	const handleTakeControlClick = useCallback(async () => {
		if (runnerState.isBusy) {
			setShowConfirmModal(true);
		} else {
			await activateTakeControl();
		}
	}, [runnerState.isBusy, activateTakeControl]);

	const handleConfirmTakeControl = useCallback(async () => {
		setShowConfirmModal(false);
		await activateTakeControl();
	}, [activateTakeControl]);

	const handleResumeOrchestration = useCallback(async () => {
		setUserControlled(false);
		await window.maestro.claudePty.setUserControlled(sessionId, false);
		await refreshRunnerState();
	}, [sessionId, refreshRunnerState]);

	// ---- Render ----

	const renderedHtml = useMemo(() => {
		try {
			return ansiConverter.toHtml(chunks.join(''));
		} catch {
			return chunks
				.join('')
				.replace(/[<>&"]/g, (c) =>
					c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;'
				);
		}
	}, [chunks, ansiConverter]);

	return (
		<div
			className="flex flex-col w-full h-full outline-none"
			style={{ backgroundColor: theme.colors.bgMain }}
			tabIndex={0}
			onKeyDown={handleKeyDown}
		>
			{/* Top bar */}
			<div
				className="flex items-center justify-between px-3 py-2 shrink-0 border-b"
				style={{
					borderColor: userControlled ? (theme.colors.warning ?? '#f59e0b') : theme.colors.border,
					backgroundColor: userControlled
						? `${theme.colors.warning ?? '#f59e0b'}18`
						: theme.colors.bgActivity,
				}}
			>
				<div className="flex items-center gap-2">
					<span
						className="text-xs font-semibold uppercase tracking-wider"
						style={{ color: theme.colors.textDim }}
					>
						Interactive Mode
					</span>
					{userControlled && (
						<span
							className="text-xs font-medium px-2 py-0.5 rounded"
							style={{
								backgroundColor: theme.colors.warning ?? '#f59e0b',
								color: '#000',
							}}
						>
							Manual Control Active — orchestration paused
						</span>
					)}
				</div>

				{userControlled ? (
					<button
						onClick={handleResumeOrchestration}
						className="text-xs px-3 py-1 rounded font-medium transition-opacity hover:opacity-80"
						style={{
							backgroundColor: theme.colors.accent,
							color: '#fff',
						}}
					>
						Resume Orchestration
					</button>
				) : (
					<button
						onClick={handleTakeControlClick}
						className="text-xs px-3 py-1 rounded font-medium transition-opacity hover:opacity-80"
						style={{
							backgroundColor: theme.colors.bgActivity,
							color: theme.colors.textMain,
							border: `1px solid ${theme.colors.border}`,
						}}
					>
						Take Control
					</button>
				)}
			</div>

			{/* PTY output area */}
			<div
				ref={scrollRef}
				className="flex-1 overflow-y-auto p-3 font-mono text-sm leading-relaxed"
				style={{
					backgroundColor: theme.colors.bgMain,
					color: theme.colors.textMain,
					outline: userControlled ? `2px solid ${theme.colors.warning ?? '#f59e0b'}` : 'none',
					outlineOffset: '-2px',
				}}
				onScroll={handleScroll}
				dangerouslySetInnerHTML={{ __html: renderedHtml }}
			/>

			{/* Confirmation modal — shown when taking control while busy */}
			{showConfirmModal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center">
					<div
						className="absolute inset-0"
						style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
						onClick={() => setShowConfirmModal(false)}
					/>
					<div
						className="relative z-10 rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl"
						style={{
							backgroundColor: theme.colors.bgActivity,
							border: `1px solid ${theme.colors.border}`,
						}}
					>
						<h3 className="text-base font-semibold mb-2" style={{ color: theme.colors.textMain }}>
							Take Control
						</h3>
						<p className="text-sm mb-4" style={{ color: theme.colors.textDim }}>
							Take Control will interrupt the active orchestrated turn. Continue?
						</p>
						<div className="flex gap-3 justify-end">
							<button
								onClick={() => setShowConfirmModal(false)}
								className="text-sm px-4 py-2 rounded transition-opacity hover:opacity-80"
								style={{
									backgroundColor: theme.colors.border,
									color: theme.colors.textMain,
								}}
							>
								Cancel
							</button>
							<button
								onClick={handleConfirmTakeControl}
								className="text-sm px-4 py-2 rounded font-medium transition-opacity hover:opacity-80"
								style={{
									backgroundColor: theme.colors.warning ?? '#f59e0b',
									color: '#000',
								}}
							>
								Take Control
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
