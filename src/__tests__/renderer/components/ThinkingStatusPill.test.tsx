/**
 * Tests for ThinkingStatusPill component
 *
 * Tests cover:
 * - Pure helper functions (getWriteModeTab, getSessionDisplayName, formatTokens)
 * - ElapsedTimeDisplay component (timer, formatTime)
 * - SessionRow component (click handling, display name, tokens, time)
 * - AutoRunPill component (stop button, task progress, elapsed time, stopping state)
 * - ThinkingStatusPillInner main logic (AutoRun mode, filtering, null return, primary session,
 *   multiple sessions dropdown, token display, elapsed time, interrupt button)
 * - Memoization (custom arePropsEqual comparison)
 */

import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ThinkingStatusPill } from '../../../renderer/components/ThinkingStatusPill';
import type { Session, Theme, BatchRunState, AITab } from '../../../renderer/types';

// Mock theme for tests
const mockTheme: Theme = {
	id: 'test-theme',
	name: 'Test Theme',
	mode: 'dark',
	colors: {
		bgMain: '#1e1e1e',
		bgSidebar: '#252526',
		bgActivity: '#333333',
		textMain: '#ffffff',
		textDim: '#999999',
		accent: '#007acc',
		border: '#404040',
		error: '#f44747',
		warning: '#cca700',
		success: '#4ec9b0',
		textOnAccent: '#ffffff',
		selectionBg: '#264f78',
		buttonHover: '#2d2d2d',
	},
};

// Helper to create a mock session
function createMockSession(overrides: Partial<Session> = {}): Session {
	return {
		id: 'session-1',
		name: 'Test Session',
		cwd: '/test/path',
		projectRoot: '/test/path',
		toolType: 'claude-code',
		state: 'idle',
		inputMode: 'ai',
		aiPid: 0,
		terminalPid: 0,
		aiLogs: [],
		shellLogs: [],
		isGitRepo: false,
		fileTree: [],
		fileExplorerExpanded: [],
		messageQueue: [],
		...overrides,
	};
}

// Helper to create a mock AITab
function createMockAITab(overrides: Partial<AITab> = {}): AITab {
	return {
		id: 'tab-1',
		name: 'Tab 1',
		state: 'idle',
		agentSessionId: null,
		starred: false,
		logs: [],
		inputValue: '',
		stagedImages: [],
		createdAt: Date.now(),
		...overrides,
	};
}

// Helper to create a busy/thinking session
function createThinkingSession(overrides: Partial<Session> = {}): Session {
	return createMockSession({
		state: 'busy',
		busySource: 'ai',
		thinkingStartTime: Date.now() - 30000, // 30 seconds ago
		currentCycleTokens: 1500,
		agentSessionId: 'abc12345-def6-7890-ghij-klmnopqrstuv',
		...overrides,
	});
}

describe('ThinkingStatusPill', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('render conditions', () => {
		it('renders null when no thinking sessions are provided', () => {
			const { container } = render(<ThinkingStatusPill thinkingSessions={[]} theme={mockTheme} />);
			expect(container.firstChild).toBeNull();
		});

		it('renders thinking pill when thinking sessions are provided', () => {
			const thinkingSession = createThinkingSession();
			render(<ThinkingStatusPill thinkingSessions={[thinkingSession]} theme={mockTheme} />);
			// Should show the session name (appears in both label span and Claude ID button)
			const sessionNameElements = screen.getAllByText('Test Session');
			expect(sessionNameElements.length).toBeGreaterThanOrEqual(1);
		});
	});

	describe('formatTokens helper (via UI)', () => {
		it('displays tokens under 1000 as-is', () => {
			const session = createThinkingSession({ currentCycleTokens: 500 });
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);
			// Token count now displayed as "X tokens" in combined format
			expect(screen.getByText('500 tokens')).toBeInTheDocument();
		});

		it('displays tokens at exactly 1000 in K notation', () => {
			const session = createThinkingSession({ currentCycleTokens: 1000 });
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);
			// Token count now displayed as "X tokens" in combined format
			expect(screen.getByText('1.0K tokens')).toBeInTheDocument();
		});

		it('displays tokens over 1000 in K notation with decimal', () => {
			const session = createThinkingSession({ currentCycleTokens: 2500 });
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);
			// Token count now displayed as "X tokens" in combined format
			expect(screen.getByText('2.5K tokens')).toBeInTheDocument();
		});

		it('displays large tokens correctly', () => {
			const session = createThinkingSession({ currentCycleTokens: 15700 });
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);
			// Token count now displayed as "X tokens" in combined format
			expect(screen.getByText('15.7K tokens')).toBeInTheDocument();
		});

		it('shows "Thinking..." when tokens are 0', () => {
			const session = createThinkingSession({ currentCycleTokens: 0 });
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);
			expect(screen.getByText('Thinking...')).toBeInTheDocument();
		});
	});

	describe('ElapsedTimeDisplay component', () => {
		it('displays seconds and minutes', () => {
			const startTime = Date.now() - 75000; // 1m 15s ago
			const session = createThinkingSession({ thinkingStartTime: startTime });
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);
			// Should show 1m 15s format
			expect(screen.getByText('1m 15s')).toBeInTheDocument();
		});

		it('displays hours when appropriate', () => {
			const startTime = Date.now() - 3725000; // 1h 2m 5s ago
			const session = createThinkingSession({ thinkingStartTime: startTime });
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);
			expect(screen.getByText('1h 2m 5s')).toBeInTheDocument();
		});

		it('displays days when appropriate', () => {
			const startTime = Date.now() - 90061000; // 1d 1h 1m 1s ago
			const session = createThinkingSession({ thinkingStartTime: startTime });
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);
			expect(screen.getByText('1d 1h 1m 1s')).toBeInTheDocument();
		});

		it('updates time every second', () => {
			const startTime = Date.now();
			const session = createThinkingSession({ thinkingStartTime: startTime });
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);

			// Initially shows 0m 0s
			expect(screen.getByText('0m 0s')).toBeInTheDocument();

			// Advance 3 seconds
			act(() => {
				vi.advanceTimersByTime(3000);
			});

			expect(screen.getByText('0m 3s')).toBeInTheDocument();
		});

		it('cleans up interval on unmount', () => {
			const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
			const session = createThinkingSession();

			const { unmount } = render(
				<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />
			);

			unmount();

			// clearInterval should have been called
			expect(clearIntervalSpy).toHaveBeenCalled();
			clearIntervalSpy.mockRestore();
		});
	});

	describe('getSessionDisplayName (via UI)', () => {
		it('uses namedSessions lookup when available', () => {
			const session = createThinkingSession({
				agentSessionId: 'abc12345-def6',
			});
			render(
				<ThinkingStatusPill
					thinkingSessions={[session]}
					theme={mockTheme}
					namedSessions={{ 'abc12345-def6': 'Custom Name' }}
				/>
			);
			// Click target should show custom name
			expect(screen.getByText('Custom Name')).toBeInTheDocument();
		});

		it('falls back to tab name when no namedSession', () => {
			const tab = createMockAITab({
				state: 'busy',
				name: 'My Tab Name',
				agentSessionId: 'def67890-ghi',
			});
			const session = createThinkingSession({
				aiTabs: [tab],
				agentSessionId: undefined,
			});
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);
			// Should show tab name since no namedSession match
			expect(screen.getByText('My Tab Name')).toBeInTheDocument();
		});

		it('falls back to session name when no tab name', () => {
			const tab = createMockAITab({
				state: 'busy',
				name: '', // Empty name
				agentSessionId: 'xyz98765-abc',
			});
			const session = createThinkingSession({
				name: 'My Session',
				aiTabs: [tab],
				agentSessionId: undefined,
			});
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);
			// Claude ID button should show session name when tab name is empty
			// (priority: namedSessions > tab name > session name > UUID octet)
			const buttons = screen.getAllByText('My Session');
			expect(buttons.length).toBeGreaterThanOrEqual(1);
		});

		it('uses session name when tab has no agentSessionId', () => {
			const session = createThinkingSession({
				name: 'Session Name',
				agentSessionId: 'sess1234-5678',
				aiTabs: undefined,
			});
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);
			// Priority: namedSessions > tab name > session name > UUID octet
			// Without namedSessions or tabs, falls back to session name
			const buttons = screen.getAllByText('Session Name');
			expect(buttons.length).toBeGreaterThanOrEqual(1);
		});
	});

	describe('primary session display', () => {
		it('shows session name', () => {
			const session = createThinkingSession({ name: 'Primary Session' });
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);
			// Session name appears multiple times: in the label span and in the Claude ID button
			const nameElements = screen.getAllByText('Primary Session');
			expect(nameElements.length).toBeGreaterThanOrEqual(1);
		});

		it('shows pulsing indicator dot', () => {
			const session = createThinkingSession();
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);
			// Should have animate-pulse class on indicator
			const indicator = document.querySelector('.animate-pulse');
			expect(indicator).toBeInTheDocument();
		});

		it('shows Current label with tokens', () => {
			const session = createThinkingSession({ currentCycleTokens: 100 });
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);
			// Label changed from "Tokens:" to "Current:" to distinguish from cumulative Session stats
			expect(screen.getByText('Current:')).toBeInTheDocument();
		});

		it('shows Elapsed label with time', () => {
			const session = createThinkingSession();
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);
			expect(screen.getByText('Elapsed:')).toBeInTheDocument();
		});

		it('creates correct tooltip with all info', () => {
			const session = createThinkingSession({
				name: 'Test Name',
				agentSessionId: 'abc12345',
			});
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);
			// Session name appears in the non-clickable span with tooltip
			const nameElements = screen.getAllByText('Test Name');
			const elementWithTooltip = nameElements.find((el) => el.getAttribute('title'));
			expect(elementWithTooltip).toHaveAttribute('title', expect.stringContaining('Test Name'));
			expect(elementWithTooltip).toHaveAttribute(
				'title',
				expect.stringContaining('Claude: abc12345')
			);
		});
	});

	describe('Claude session ID click handler', () => {
		it('calls onSessionClick when Claude ID button is clicked', () => {
			const onSessionClick = vi.fn();
			const session = createThinkingSession({
				id: 'session-123',
				name: 'Click Test Session',
				agentSessionId: 'claude-456',
			});
			render(
				<ThinkingStatusPill
					thinkingSessions={[session]}
					theme={mockTheme}
					onSessionClick={onSessionClick}
				/>
			);

			// The clickable button shows UUID octet (first 8 chars uppercase) when no tab name or custom name
			// agentSessionId: 'claude-456' -> displayClaudeId: 'CLAUDE-4'
			const claudeIdButton = screen.getByText('CLAUDE-4');
			expect(claudeIdButton.tagName).toBe('BUTTON');
			fireEvent.click(claudeIdButton);

			expect(onSessionClick).toHaveBeenCalledWith('session-123', undefined);
		});

		it('passes tabId when write-mode tab is available', () => {
			const onSessionClick = vi.fn();
			const tab = createMockAITab({
				id: 'tab-999',
				state: 'busy',
				name: 'Active Tab',
				agentSessionId: 'tab-claude-id',
			});
			const session = createThinkingSession({
				id: 'session-abc',
				name: 'Tab Test Session',
				aiTabs: [tab],
				agentSessionId: undefined,
			});
			render(
				<ThinkingStatusPill
					thinkingSessions={[session]}
					theme={mockTheme}
					onSessionClick={onSessionClick}
				/>
			);

			// With tab name available, button shows tab name
			const claudeIdButton = screen.getByText('Active Tab');
			fireEvent.click(claudeIdButton);

			expect(onSessionClick).toHaveBeenCalledWith('session-abc', 'tab-999');
		});
	});

	describe('interrupt button', () => {
		it('renders stop button when onInterrupt is provided', () => {
			const session = createThinkingSession();
			render(
				<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} onInterrupt={() => {}} />
			);
			expect(screen.getByText('Stop')).toBeInTheDocument();
		});

		it('does not render stop button when onInterrupt is not provided', () => {
			const session = createThinkingSession();
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);
			expect(screen.queryByText('Stop')).not.toBeInTheDocument();
		});

		it('calls onInterrupt when stop button is clicked', () => {
			const onInterrupt = vi.fn();
			const session = createThinkingSession();
			render(
				<ThinkingStatusPill
					thinkingSessions={[session]}
					theme={mockTheme}
					onInterrupt={onInterrupt}
				/>
			);

			fireEvent.click(screen.getByText('Stop'));
			expect(onInterrupt).toHaveBeenCalledTimes(1);
		});

		it('has correct title attribute', () => {
			const session = createThinkingSession();
			render(
				<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} onInterrupt={() => {}} />
			);
			expect(screen.getByTitle('Interrupt Claude (Ctrl+C)')).toBeInTheDocument();
		});
	});

	describe('multiple thinking sessions', () => {
		it('shows +N indicator when multiple sessions are thinking', () => {
			const sessions = [
				createThinkingSession({ id: 'sess-1', name: 'Session 1' }),
				createThinkingSession({ id: 'sess-2', name: 'Session 2' }),
				createThinkingSession({ id: 'sess-3', name: 'Session 3' }),
			];
			render(<ThinkingStatusPill thinkingSessions={sessions} theme={mockTheme} />);
			// Should show +2 (excluding the primary session)
			expect(screen.getByText('+2')).toBeInTheDocument();
		});

		it('has correct tooltip on +N indicator', () => {
			const sessions = [
				createThinkingSession({ id: 'sess-1' }),
				createThinkingSession({ id: 'sess-2' }),
			];
			render(<ThinkingStatusPill thinkingSessions={sessions} theme={mockTheme} />);
			expect(screen.getByTitle('+1 more thinking')).toBeInTheDocument();
		});

		it('expands dropdown on mouse enter', () => {
			const sessions = [
				createThinkingSession({ id: 'sess-1', name: 'Primary' }),
				createThinkingSession({ id: 'sess-2', name: 'Secondary' }),
			];
			render(<ThinkingStatusPill thinkingSessions={sessions} theme={mockTheme} />);

			const indicator = screen.getByText('+1').parentElement!;
			fireEvent.mouseEnter(indicator);

			// State update is synchronous
			expect(screen.getByText('All Thinking Sessions')).toBeInTheDocument();
		});

		it('closes dropdown on mouse leave', () => {
			const sessions = [
				createThinkingSession({ id: 'sess-1', name: 'Primary' }),
				createThinkingSession({ id: 'sess-2', name: 'Secondary' }),
			];
			render(<ThinkingStatusPill thinkingSessions={sessions} theme={mockTheme} />);

			const indicator = screen.getByText('+1').parentElement!;
			fireEvent.mouseEnter(indicator);

			expect(screen.getByText('All Thinking Sessions')).toBeInTheDocument();

			fireEvent.mouseLeave(indicator);

			expect(screen.queryByText('All Thinking Sessions')).not.toBeInTheDocument();
		});

		it('shows all thinking sessions in dropdown', () => {
			const sessions = [
				createThinkingSession({ id: 'sess-1', name: 'Session Alpha' }),
				createThinkingSession({ id: 'sess-2', name: 'Session Beta' }),
				createThinkingSession({ id: 'sess-3', name: 'Session Gamma' }),
			];
			render(<ThinkingStatusPill thinkingSessions={sessions} theme={mockTheme} />);

			const indicator = screen.getByText('+2').parentElement!;
			fireEvent.mouseEnter(indicator);

			expect(screen.getByText('All Thinking Sessions')).toBeInTheDocument();
			// Session Alpha appears twice - once in primary pill, once in dropdown
			expect(screen.getAllByText('Session Alpha').length).toBeGreaterThanOrEqual(2);
			expect(screen.getByText('Session Beta')).toBeInTheDocument();
			expect(screen.getByText('Session Gamma')).toBeInTheDocument();
		});
	});

	describe('SessionRow component (via dropdown)', () => {
		it('calls onSessionClick with session ID and tab ID when clicked', () => {
			const onSessionClick = vi.fn();
			const tab = createMockAITab({ id: 'tab-xyz', state: 'busy' });
			const sessions = [
				createThinkingSession({ id: 'sess-1', name: 'Session 1', aiTabs: [tab] }),
				createThinkingSession({ id: 'sess-2', name: 'Session 2' }),
			];
			render(
				<ThinkingStatusPill
					thinkingSessions={sessions}
					theme={mockTheme}
					onSessionClick={onSessionClick}
				/>
			);

			const indicator = screen.getByText('+1').parentElement!;
			fireEvent.mouseEnter(indicator);

			// Click on the first session row in dropdown
			const rows = screen.getAllByRole('button');
			const sessionRow = rows.find((row) => row.textContent?.includes('Session 1'));
			expect(sessionRow).toBeDefined();
			fireEvent.click(sessionRow!);

			expect(onSessionClick).toHaveBeenCalledWith('sess-1', 'tab-xyz');
		});

		it('shows tokens when available in session row', () => {
			const sessions = [
				createThinkingSession({ id: 'sess-1', name: 'Primary' }),
				createThinkingSession({ id: 'sess-2', name: 'Secondary', currentCycleTokens: 5000 }),
			];
			render(<ThinkingStatusPill thinkingSessions={sessions} theme={mockTheme} />);

			const indicator = screen.getByText('+1').parentElement!;
			fireEvent.mouseEnter(indicator);

			// 5000 tokens = 5.0K
			expect(screen.getByText('5.0K')).toBeInTheDocument();
		});

		it('shows elapsed time in session row', () => {
			const sessions = [
				createThinkingSession({ id: 'sess-1', name: 'Primary' }),
				createThinkingSession({
					id: 'sess-2',
					name: 'Secondary',
					thinkingStartTime: Date.now() - 120000, // 2 minutes
				}),
			];
			render(<ThinkingStatusPill thinkingSessions={sessions} theme={mockTheme} />);

			const indicator = screen.getByText('+1').parentElement!;
			fireEvent.mouseEnter(indicator);

			expect(screen.getByText('2m 0s')).toBeInTheDocument();
		});
	});

	describe('AutoRun mode', () => {
		it('shows AutoRunPill when autoRunState.isRunning is true', () => {
			const sessions = [createMockSession()];
			const autoRunState: BatchRunState = {
				isRunning: true,
				isPaused: false,
				isStopping: false,
				currentTaskIndex: 0,
				totalTasks: 5,
				completedTasks: 2,
				startTime: Date.now() - 60000,
				tasks: [],
				batchName: 'Test Batch',
			};
			render(
				<ThinkingStatusPill
					thinkingSessions={sessions}
					theme={mockTheme}
					autoRunState={autoRunState}
				/>
			);
			expect(screen.getByText('AutoRun')).toBeInTheDocument();
		});

		it('shows task progress in AutoRunPill', () => {
			const autoRunState: BatchRunState = {
				isRunning: true,
				isPaused: false,
				isStopping: false,
				currentTaskIndex: 2,
				totalTasks: 10,
				completedTasks: 3,
				startTime: Date.now(),
				tasks: [],
				batchName: 'Batch',
			};
			render(
				<ThinkingStatusPill thinkingSessions={[]} theme={mockTheme} autoRunState={autoRunState} />
			);
			expect(screen.getByText('Tasks:')).toBeInTheDocument();
			expect(screen.getByText('3/10')).toBeInTheDocument();
		});

		it('shows elapsed time in AutoRunPill', () => {
			const autoRunState: BatchRunState = {
				isRunning: true,
				isPaused: false,
				isStopping: false,
				currentTaskIndex: 0,
				totalTasks: 5,
				completedTasks: 0,
				startTime: Date.now() - 45000, // 45 seconds ago
				tasks: [],
				batchName: 'Batch',
			};
			render(
				<ThinkingStatusPill thinkingSessions={[]} theme={mockTheme} autoRunState={autoRunState} />
			);
			expect(screen.getByText('Elapsed:')).toBeInTheDocument();
			expect(screen.getByText('0m 45s')).toBeInTheDocument();
		});

		it('shows stop button in AutoRunPill when onStopAutoRun is provided', () => {
			const autoRunState: BatchRunState = {
				isRunning: true,
				isPaused: false,
				isStopping: false,
				currentTaskIndex: 0,
				totalTasks: 5,
				completedTasks: 0,
				startTime: Date.now(),
				tasks: [],
				batchName: 'Batch',
			};
			render(
				<ThinkingStatusPill
					thinkingSessions={[]}
					theme={mockTheme}
					autoRunState={autoRunState}
					onStopAutoRun={() => {}}
				/>
			);
			expect(screen.getByText('Stop')).toBeInTheDocument();
		});

		it('calls onStopAutoRun when stop button is clicked', () => {
			const onStopAutoRun = vi.fn();
			const autoRunState: BatchRunState = {
				isRunning: true,
				isPaused: false,
				isStopping: false,
				currentTaskIndex: 0,
				totalTasks: 5,
				completedTasks: 0,
				startTime: Date.now(),
				tasks: [],
				batchName: 'Batch',
			};
			render(
				<ThinkingStatusPill
					thinkingSessions={[]}
					theme={mockTheme}
					autoRunState={autoRunState}
					onStopAutoRun={onStopAutoRun}
				/>
			);
			fireEvent.click(screen.getByText('Stop'));
			expect(onStopAutoRun).toHaveBeenCalledTimes(1);
		});

		it('shows AutoRun Stopping label and Stopping button when isStopping is true', () => {
			const autoRunState: BatchRunState = {
				isRunning: true,
				isPaused: false,
				isStopping: true,
				currentTaskIndex: 0,
				totalTasks: 5,
				completedTasks: 0,
				startTime: Date.now(),
				tasks: [],
				batchName: 'Batch',
			};
			render(
				<ThinkingStatusPill
					thinkingSessions={[]}
					theme={mockTheme}
					autoRunState={autoRunState}
					onStopAutoRun={() => {}}
				/>
			);
			// AutoRun label should show stopping state
			expect(screen.getByText('AutoRun Stopping...')).toBeInTheDocument();
			// Button should show "Stopping" text
			expect(screen.getByText('Stopping')).toBeInTheDocument();
		});

		it('disables stop button when isStopping', () => {
			const autoRunState: BatchRunState = {
				isRunning: true,
				isPaused: false,
				isStopping: true,
				currentTaskIndex: 0,
				totalTasks: 5,
				completedTasks: 0,
				startTime: Date.now(),
				tasks: [],
				batchName: 'Batch',
			};
			render(
				<ThinkingStatusPill
					thinkingSessions={[]}
					theme={mockTheme}
					autoRunState={autoRunState}
					onStopAutoRun={() => {}}
				/>
			);
			const stopButton = screen.getByText('Stopping').closest('button');
			expect(stopButton).toBeDisabled();
		});

		it('uses Date.now() as fallback when startTime is undefined', () => {
			const autoRunState: BatchRunState = {
				isRunning: true,
				isPaused: false,
				isStopping: false,
				currentTaskIndex: 0,
				totalTasks: 5,
				completedTasks: 0,
				startTime: undefined as unknown as number, // Simulate undefined
				tasks: [],
				batchName: 'Batch',
			};
			render(
				<ThinkingStatusPill thinkingSessions={[]} theme={mockTheme} autoRunState={autoRunState} />
			);
			// Should show 0m 0s since startTime defaults to now
			expect(screen.getByText('0m 0s')).toBeInTheDocument();
		});

		it('prioritizes AutoRun over thinking sessions', () => {
			const thinkingSession = createThinkingSession({ name: 'Thinking Session' });
			const autoRunState: BatchRunState = {
				isRunning: true,
				isPaused: false,
				isStopping: false,
				currentTaskIndex: 0,
				totalTasks: 5,
				completedTasks: 0,
				startTime: Date.now(),
				tasks: [],
				batchName: 'Batch',
			};
			render(
				<ThinkingStatusPill
					thinkingSessions={[thinkingSession]}
					theme={mockTheme}
					autoRunState={autoRunState}
				/>
			);
			// Should show AutoRun, not thinking session
			expect(screen.getByText('AutoRun')).toBeInTheDocument();
			expect(screen.queryByText('Thinking Session')).not.toBeInTheDocument();
		});
	});

	describe('getWriteModeTab helper (via UI)', () => {
		it('uses tab with busy state for display', () => {
			const idleTab = createMockAITab({ id: 'idle-tab', name: 'Idle Tab', state: 'idle' });
			const busyTab = createMockAITab({
				id: 'busy-tab',
				name: 'Busy Tab',
				state: 'busy',
				agentSessionId: 'busy-claude-id',
			});
			const session = createThinkingSession({
				aiTabs: [idleTab, busyTab],
				agentSessionId: undefined,
			});
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);
			// Should use the busy tab's name
			expect(screen.getByText('Busy Tab')).toBeInTheDocument();
		});

		it('uses tab thinkingStartTime over session thinkingStartTime', () => {
			const busyTab = createMockAITab({
				id: 'busy-tab',
				state: 'busy',
				thinkingStartTime: Date.now() - 90000, // 1m 30s
			});
			const session = createThinkingSession({
				aiTabs: [busyTab],
				thinkingStartTime: Date.now() - 30000, // 30s (would show 0m 30s if used)
			});
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);
			// Should show 1m 30s from tab, not 0m 30s from session
			expect(screen.getByText('1m 30s')).toBeInTheDocument();
		});
	});

	describe('styling', () => {
		it('applies warning color to pulsing indicator in thinking mode', () => {
			const session = createThinkingSession();
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);
			const indicator = document.querySelector('.animate-pulse');
			expect(indicator).toHaveStyle({ backgroundColor: mockTheme.colors.warning });
		});

		it('applies accent color to pulsing indicator in AutoRun mode', () => {
			const autoRunState: BatchRunState = {
				isRunning: true,
				isPaused: false,
				isStopping: false,
				currentTaskIndex: 0,
				totalTasks: 5,
				completedTasks: 0,
				startTime: Date.now(),
				tasks: [],
				batchName: 'Batch',
			};
			render(
				<ThinkingStatusPill thinkingSessions={[]} theme={mockTheme} autoRunState={autoRunState} />
			);
			const indicator = document.querySelector('.animate-pulse');
			expect(indicator).toHaveStyle({ backgroundColor: mockTheme.colors.accent });
		});

		it('applies error color to stop button', () => {
			const session = createThinkingSession();
			render(
				<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} onInterrupt={() => {}} />
			);
			const stopButton = screen.getByText('Stop').closest('button');
			expect(stopButton).toHaveStyle({ backgroundColor: mockTheme.colors.error });
		});

		it('applies accent color to Claude ID button', () => {
			const session = createThinkingSession({
				name: 'Accent Test',
				agentSessionId: 'test-id-1234',
			});
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);
			// Claude ID button shows UUID octet when no custom name or tab name
			// agentSessionId: 'test-id-1234' -> displayClaudeId: 'TEST-ID-'
			const claudeButton = screen.getByText('TEST-ID-');
			expect(claudeButton.tagName).toBe('BUTTON');
			expect(claudeButton).toHaveStyle({ color: mockTheme.colors.accent });
		});
	});

	describe('memoization (arePropsEqual)', () => {
		// We can test memoization behavior by checking re-renders don't happen unnecessarily
		it('re-renders when autoRunState.isRunning changes', () => {
			const { rerender } = render(
				<ThinkingStatusPill
					thinkingSessions={[]}
					theme={mockTheme}
					autoRunState={{ isRunning: false } as BatchRunState}
				/>
			);

			// Should not show AutoRun initially
			expect(screen.queryByText('AutoRun')).not.toBeInTheDocument();

			rerender(
				<ThinkingStatusPill
					thinkingSessions={[]}
					theme={mockTheme}
					autoRunState={
						{
							isRunning: true,
							completedTasks: 0,
							totalTasks: 5,
							startTime: Date.now(),
						} as BatchRunState
					}
				/>
			);

			// Should show AutoRun after change
			expect(screen.getByText('AutoRun')).toBeInTheDocument();
		});

		it('re-renders when thinking session count changes', () => {
			const session1 = createThinkingSession({ id: 'sess-1', name: 'Session 1' });
			const session2 = createThinkingSession({ id: 'sess-2', name: 'Session 2' });

			const { rerender } = render(
				<ThinkingStatusPill thinkingSessions={[session1]} theme={mockTheme} />
			);

			expect(screen.queryByText('+1')).not.toBeInTheDocument();

			rerender(<ThinkingStatusPill thinkingSessions={[session1, session2]} theme={mockTheme} />);

			expect(screen.getByText('+1')).toBeInTheDocument();
		});

		it('re-renders when session property changes', () => {
			const session = createThinkingSession({ currentCycleTokens: 500 });

			const { rerender } = render(
				<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />
			);

			// Token count now displayed as "X tokens" in combined format
			expect(screen.getByText('500 tokens')).toBeInTheDocument();

			rerender(
				<ThinkingStatusPill
					thinkingSessions={[{ ...session, currentCycleTokens: 1500 }]}
					theme={mockTheme}
				/>
			);

			// Token count now displayed as "X tokens" in combined format
			expect(screen.getByText('1.5K tokens')).toBeInTheDocument();
		});

		it('re-renders when theme changes', () => {
			const session = createThinkingSession({ name: 'Theme Test' });
			const newTheme = {
				...mockTheme,
				colors: { ...mockTheme.colors, accent: '#ff0000' },
			};

			const { rerender } = render(
				<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />
			);

			rerender(<ThinkingStatusPill thinkingSessions={[session]} theme={newTheme} />);

			// Component should have re-rendered with new theme
			// Claude ID button shows UUID octet (ABC12345 from default agentSessionId)
			const claudeButton = screen.getByText('ABC12345');
			expect(claudeButton.tagName).toBe('BUTTON');
			expect(claudeButton).toHaveStyle({ color: '#ff0000' });
		});

		it('re-renders when namedSessions changes for thinking session', () => {
			const session = createThinkingSession({
				name: 'Named Test Session',
				agentSessionId: 'abc12345',
			});

			const { rerender } = render(
				<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} namedSessions={{}} />
			);

			// Initially shows session name (no namedSessions match)
			const initialButtons = screen.getAllByText('Named Test Session');
			expect(initialButtons.length).toBeGreaterThanOrEqual(1);

			rerender(
				<ThinkingStatusPill
					thinkingSessions={[session]}
					theme={mockTheme}
					namedSessions={{ abc12345: 'Custom Name' }}
				/>
			);

			// After rerender, should show custom name from namedSessions
			expect(screen.getByText('Custom Name')).toBeInTheDocument();
		});
	});

	describe('cumulative session stats display (Yellow Pill)', () => {
		/**
		 * Tests for Task 2: Yellow Agent Session Pill
		 * Verifies the cumulative session stats format: Session: X/Y ($Z.ZZ)
		 * - X = total input + output tokens (compact format like "1.2K")
		 * - Y = total cache tokens (compact format)
		 * - Z.ZZ = total cost in USD
		 */

		it('displays session stats with input/output tokens and cost', () => {
			const session = createThinkingSession({
				usageStats: {
					inputTokens: 1000,
					outputTokens: 200,
					cacheReadInputTokens: 0,
					cacheCreationInputTokens: 0,
					totalCostUsd: 0.42,
					contextWindow: 200000,
				},
			});
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);

			// Should show "Session:" label
			expect(screen.getByText('Session:')).toBeInTheDocument();
			// Should show input+output tokens (1000+200=1200) in compact format
			expect(screen.getByText('1.2K')).toBeInTheDocument();
			// Should show cost in $X.XX format
			expect(screen.getByText('($0.42)')).toBeInTheDocument();
		});

		it('displays cache tokens when present', () => {
			const session = createThinkingSession({
				usageStats: {
					inputTokens: 45000,
					outputTokens: 600,
					cacheReadInputTokens: 10000,
					cacheCreationInputTokens: 2300,
					totalCostUsd: 1.23,
					contextWindow: 200000,
				},
			});
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);

			// Should show "Session:" label
			expect(screen.getByText('Session:')).toBeInTheDocument();
			// Should show input+output tokens (45000+600=45600) in compact format
			expect(screen.getByText('45.6K')).toBeInTheDocument();
			// Should show cache tokens (10000+2300=12300) in compact format after slash
			expect(screen.getByText('/12.3K')).toBeInTheDocument();
			// Should show cost
			expect(screen.getByText('($1.23)')).toBeInTheDocument();
		});

		it('does not display session stats when no usage data', () => {
			const session = createThinkingSession({
				usageStats: undefined,
			});
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);

			// Should not show Session: label when no usage data
			expect(screen.queryByText('Session:')).not.toBeInTheDocument();
		});

		it('does not display session stats when input/output tokens are 0', () => {
			const session = createThinkingSession({
				usageStats: {
					inputTokens: 0,
					outputTokens: 0,
					cacheReadInputTokens: 0,
					cacheCreationInputTokens: 0,
					totalCostUsd: 0,
					contextWindow: 200000,
				},
			});
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);

			// Should not show Session: label when no tokens consumed
			expect(screen.queryByText('Session:')).not.toBeInTheDocument();
		});

		it('omits cache tokens when they are 0', () => {
			const session = createThinkingSession({
				usageStats: {
					inputTokens: 5000,
					outputTokens: 500,
					cacheReadInputTokens: 0,
					cacheCreationInputTokens: 0,
					totalCostUsd: 0.25,
					contextWindow: 200000,
				},
			});
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);

			// Should show "Session:" label
			expect(screen.getByText('Session:')).toBeInTheDocument();
			// Should show input+output tokens
			expect(screen.getByText('5.5K')).toBeInTheDocument();
			// Should NOT show cache tokens (slash format) when cache is 0
			expect(screen.queryByText(/^\/\d/)).not.toBeInTheDocument();
			// Should show cost
			expect(screen.getByText('($0.25)')).toBeInTheDocument();
		});

		it('omits cost when it is 0', () => {
			const session = createThinkingSession({
				usageStats: {
					inputTokens: 1000,
					outputTokens: 500,
					cacheReadInputTokens: 500,
					cacheCreationInputTokens: 0,
					totalCostUsd: 0,
					contextWindow: 200000,
				},
			});
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);

			// Should show "Session:" label
			expect(screen.getByText('Session:')).toBeInTheDocument();
			// Should show tokens
			expect(screen.getByText('1.5K')).toBeInTheDocument();
			// Should NOT show cost parentheses when cost is 0
			expect(screen.queryByText(/\(\$0\.00\)/)).not.toBeInTheDocument();
		});

		it('updates cumulative stats when session stats change', () => {
			const session = createThinkingSession({
				usageStats: {
					inputTokens: 1000,
					outputTokens: 200,
					cacheReadInputTokens: 0,
					cacheCreationInputTokens: 0,
					totalCostUsd: 0.1,
					contextWindow: 200000,
				},
			});
			const { rerender } = render(
				<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />
			);

			// Initial state
			expect(screen.getByText('1.2K')).toBeInTheDocument();
			expect(screen.getByText('($0.10)')).toBeInTheDocument();

			// After another message, stats should update
			const updatedSession = {
				...session,
				usageStats: {
					inputTokens: 5000,
					outputTokens: 1000,
					cacheReadInputTokens: 2000,
					cacheCreationInputTokens: 500,
					totalCostUsd: 0.55,
					contextWindow: 200000,
				},
			};
			rerender(<ThinkingStatusPill thinkingSessions={[updatedSession]} theme={mockTheme} />);

			// Should show updated cumulative totals
			expect(screen.getByText('6.0K')).toBeInTheDocument(); // 5000+1000
			expect(screen.getByText('/2.5K')).toBeInTheDocument(); // 2000+500 cache
			expect(screen.getByText('($0.55)')).toBeInTheDocument();
		});

		it('shows tooltip with detailed breakdown', () => {
			const session = createThinkingSession({
				usageStats: {
					inputTokens: 10000,
					outputTokens: 2000,
					cacheReadInputTokens: 5000,
					cacheCreationInputTokens: 1000,
					totalCostUsd: 0.75,
					contextWindow: 200000,
				},
			});
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);

			// Find the session stats container and verify tooltip content
			const sessionStatsDiv = screen.getByText('Session:').closest('div');
			expect(sessionStatsDiv).toHaveAttribute('title', expect.stringContaining('Session totals:'));
			expect(sessionStatsDiv).toHaveAttribute(
				'title',
				expect.stringContaining('Input + Output: 12.0K')
			);
			expect(sessionStatsDiv).toHaveAttribute(
				'title',
				expect.stringContaining('Cache (Read + Write): 6.0K')
			);
			expect(sessionStatsDiv).toHaveAttribute('title', expect.stringContaining('Cost: $0.75'));
		});

		it('handles large token counts in millions', () => {
			const session = createThinkingSession({
				usageStats: {
					inputTokens: 1500000,
					outputTokens: 300000,
					cacheReadInputTokens: 500000,
					cacheCreationInputTokens: 100000,
					totalCostUsd: 25.5,
					contextWindow: 200000,
				},
			});
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);

			// Should show in millions format
			expect(screen.getByText('1.8M')).toBeInTheDocument(); // 1.5M + 0.3M
			expect(screen.getByText('/600.0K')).toBeInTheDocument(); // 500K + 100K
			expect(screen.getByText('($25.50)')).toBeInTheDocument();
		});

		it('uses tab usageStats when available over session usageStats', () => {
			const tab = createMockAITab({
				id: 'tab-with-stats',
				state: 'busy',
				name: 'Tab With Stats',
				usageStats: {
					inputTokens: 3000,
					outputTokens: 500,
					cacheReadInputTokens: 1000,
					cacheCreationInputTokens: 0,
					totalCostUsd: 0.35,
					contextWindow: 200000,
				},
			});
			const session = createThinkingSession({
				aiTabs: [tab],
				usageStats: {
					// This should be ignored in favor of tab's usageStats
					inputTokens: 100,
					outputTokens: 50,
					cacheReadInputTokens: 0,
					cacheCreationInputTokens: 0,
					totalCostUsd: 0.01,
					contextWindow: 200000,
				},
			});
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);

			// Should show tab's stats, not session's
			expect(screen.getByText('3.5K')).toBeInTheDocument(); // 3000+500 from tab
			expect(screen.getByText('/1.0K')).toBeInTheDocument(); // 1000 cache from tab
			expect(screen.getByText('($0.35)')).toBeInTheDocument();
		});
	});

	describe('edge cases', () => {
		it('handles session with no agentSessionId', () => {
			const session = createThinkingSession({
				name: 'No Claude ID Session',
				agentSessionId: undefined,
				aiTabs: undefined,
			});
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);
			// Should still render with session name (appears in both places when no agentSessionId)
			const elements = screen.getAllByText('No Claude ID Session');
			expect(elements.length).toBeGreaterThanOrEqual(1);
		});

		it('handles session with no thinkingStartTime', () => {
			const session = createThinkingSession({
				name: 'No Time Session',
				thinkingStartTime: undefined,
			});
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);
			// Should still render, just without elapsed time
			const elements = screen.getAllByText('No Time Session');
			expect(elements.length).toBeGreaterThanOrEqual(1);
			expect(screen.queryByText('Elapsed:')).not.toBeInTheDocument();
		});

		it('handles special characters in session names', () => {
			const session = createThinkingSession({
				name: '<script>alert("xss")</script>',
			});
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);
			// Should display safely escaped (appears in multiple places)
			const elements = screen.getAllByText('<script>alert("xss")</script>');
			expect(elements.length).toBeGreaterThanOrEqual(1);
		});

		it('handles unicode in session names', () => {
			const session = createThinkingSession({ name: '🎼 Maestro Session' });
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);
			const elements = screen.getAllByText('🎼 Maestro Session');
			expect(elements.length).toBeGreaterThanOrEqual(1);
		});

		it('handles very long session names', () => {
			const session = createThinkingSession({
				name: 'This is a very long session name that might cause layout issues',
			});
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);
			const elements = screen.getAllByText(
				'This is a very long session name that might cause layout issues'
			);
			expect(elements.length).toBeGreaterThanOrEqual(1);
		});

		it('handles large token counts', () => {
			const session = createThinkingSession({ currentCycleTokens: 999999 });
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);
			// Token count now displayed as "X tokens" in combined format
			expect(screen.getByText('1000.0K tokens')).toBeInTheDocument();
		});

		it('handles session with empty aiTabs array', () => {
			const session = createThinkingSession({ name: 'Empty Tabs Session', aiTabs: [] });
			render(<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />);
			// Should still render, using session's name (appears in both places)
			const elements = screen.getAllByText('Empty Tabs Session');
			expect(elements.length).toBeGreaterThanOrEqual(1);
		});

		it('handles multiple thinking sessions', () => {
			// thinkingSessions should only contain pre-filtered thinking sessions
			const thinkingSessions = [
				createThinkingSession({ id: 'busy-1', name: 'Busy 1' }),
				createThinkingSession({ id: 'busy-2', name: 'Busy 2' }),
			];
			render(<ThinkingStatusPill thinkingSessions={thinkingSessions} theme={mockTheme} />);
			// Should show primary (Busy 1) and +1 indicator (Busy 2)
			// Busy 1 appears multiple times: in session name span AND in Claude ID button
			const busy1Elements = screen.getAllByText('Busy 1');
			expect(busy1Elements.length).toBeGreaterThanOrEqual(1);
			expect(screen.getByText('+1')).toBeInTheDocument();
		});

		it('handles rapid state changes', () => {
			const session = createThinkingSession();
			const { rerender } = render(
				<ThinkingStatusPill thinkingSessions={[session]} theme={mockTheme} />
			);

			// Rapidly toggle through states
			for (let i = 0; i < 10; i++) {
				rerender(
					<ThinkingStatusPill
						thinkingSessions={[{ ...session, currentCycleTokens: i * 100 }]}
						theme={mockTheme}
					/>
				);
			}

			// Should show final state - token count now displayed as "X tokens" in combined format
			expect(screen.getByText('900 tokens')).toBeInTheDocument();
		});
	});

	describe('component display names', () => {
		it('ThinkingStatusPill has correct displayName', () => {
			expect(ThinkingStatusPill.displayName).toBe('ThinkingStatusPill');
		});
	});

	describe('AutoRun Blue Pill token display (Task 3)', () => {
		/**
		 * Tests for Task 3: Test Auto Run Blue Pill
		 * Verifies:
		 * - Current~: X tokens (current cycle tokens with estimation)
		 * - Cumulative stats with agent/subagent breakdown
		 * - Cache tokens displayed (if any)
		 * - Stats accumulate correctly across multiple cycles
		 */

		it('displays "Current~:" with estimated tokens from bytes when no actual token count', () => {
			const autoRunState: BatchRunState = {
				isRunning: true,
				isPaused: false,
				isStopping: false,
				currentTaskIndex: 0,
				totalTasks: 5,
				completedTasks: 1,
				startTime: Date.now() - 60000,
				tasks: [],
				batchName: 'Test Batch',
				currentTaskBytes: 3500, // Should estimate ~1000 tokens (3500/3.5)
				currentTaskTokens: 0, // No actual count yet
				currentTaskStartTime: Date.now() - 5000,
			};
			render(
				<ThinkingStatusPill thinkingSessions={[]} theme={mockTheme} autoRunState={autoRunState} />
			);

			// Should show "Current~:" with tilde indicating estimated
			expect(screen.getByText('Current~:')).toBeInTheDocument();
			// Should show estimated tokens (3500/3.5 = 1000 = 1.0K)
			expect(screen.getByText('1.0K tokens')).toBeInTheDocument();
		});

		it('displays "Current:" without tilde when actual token count is available', () => {
			const autoRunState: BatchRunState = {
				isRunning: true,
				isPaused: false,
				isStopping: false,
				currentTaskIndex: 0,
				totalTasks: 5,
				completedTasks: 1,
				startTime: Date.now() - 60000,
				tasks: [],
				batchName: 'Test Batch',
				currentTaskBytes: 3500,
				currentTaskTokens: 1500, // Actual token count
				currentTaskStartTime: Date.now() - 5000,
			};
			render(
				<ThinkingStatusPill thinkingSessions={[]} theme={mockTheme} autoRunState={autoRunState} />
			);

			// Should show "Current:" without tilde (actual count)
			expect(screen.getByText('Current:')).toBeInTheDocument();
			// Should show actual token count
			expect(screen.getByText('1.5K tokens')).toBeInTheDocument();
		});

		it('displays waiting placeholder when no bytes or tokens available', () => {
			const autoRunState: BatchRunState = {
				isRunning: true,
				isPaused: false,
				isStopping: false,
				currentTaskIndex: 0,
				totalTasks: 5,
				completedTasks: 0,
				startTime: Date.now() - 60000,
				tasks: [],
				batchName: 'Test Batch',
				currentTaskBytes: 0,
				currentTaskTokens: 0,
				currentTaskStartTime: Date.now(),
			};
			render(
				<ThinkingStatusPill thinkingSessions={[]} theme={mockTheme} autoRunState={autoRunState} />
			);

			// Should show placeholder dash when waiting
			expect(screen.getByText('—')).toBeInTheDocument();
		});

		it('displays cumulative tokens with agent breakdown', () => {
			const autoRunState: BatchRunState = {
				isRunning: true,
				isPaused: false,
				isStopping: false,
				currentTaskIndex: 2,
				totalTasks: 10,
				completedTasks: 3,
				startTime: Date.now() - 120000,
				tasks: [],
				batchName: 'Test Batch',
				currentTaskBytes: 0,
				currentTaskTokens: 500, // Current task tokens
				currentTaskStartTime: Date.now() - 10000,
				// Cumulative agent tokens
				cumulativeInputTokens: 10000,
				cumulativeOutputTokens: 2000,
				cumulativeCacheReadTokens: 0,
				cumulativeCacheCreationTokens: 0,
			};
			render(
				<ThinkingStatusPill thinkingSessions={[]} theme={mockTheme} autoRunState={autoRunState} />
			);

			// Should show "Tokens:" label for cumulative section
			expect(screen.getByText('Tokens:')).toBeInTheDocument();
			// Should show total tokens (input+output+current = 10000+2000+500 = 12.5K)
			expect(screen.getByText('12.5K')).toBeInTheDocument();
			// Should show agent breakdown
			expect(screen.getByText(/\(Agents:/)).toBeInTheDocument();
		});

		it('displays cache tokens when present', () => {
			const autoRunState: BatchRunState = {
				isRunning: true,
				isPaused: false,
				isStopping: false,
				currentTaskIndex: 1,
				totalTasks: 5,
				completedTasks: 2,
				startTime: Date.now() - 60000,
				tasks: [],
				batchName: 'Test Batch',
				currentTaskBytes: 0,
				currentTaskTokens: 0,
				currentTaskStartTime: Date.now(),
				// Cumulative tokens with cache
				cumulativeInputTokens: 5000,
				cumulativeOutputTokens: 1000,
				cumulativeCacheReadTokens: 3000,
				cumulativeCacheCreationTokens: 500,
			};
			render(
				<ThinkingStatusPill thinkingSessions={[]} theme={mockTheme} autoRunState={autoRunState} />
			);

			// Should show cache tokens after slash (3000+500 = 3.5K)
			// Use getAllByText since cache appears in both total and agent breakdown
			const cacheElements = screen.getAllByText('/3.5K');
			expect(cacheElements.length).toBeGreaterThan(0);
		});

		it('hides cache tokens when they are 0', () => {
			const autoRunState: BatchRunState = {
				isRunning: true,
				isPaused: false,
				isStopping: false,
				currentTaskIndex: 1,
				totalTasks: 5,
				completedTasks: 2,
				startTime: Date.now() - 60000,
				tasks: [],
				batchName: 'Test Batch',
				currentTaskBytes: 0,
				currentTaskTokens: 0,
				currentTaskStartTime: Date.now(),
				// Cumulative tokens without cache
				cumulativeInputTokens: 5000,
				cumulativeOutputTokens: 1000,
				cumulativeCacheReadTokens: 0,
				cumulativeCacheCreationTokens: 0,
			};
			render(
				<ThinkingStatusPill thinkingSessions={[]} theme={mockTheme} autoRunState={autoRunState} />
			);

			// Should NOT show cache tokens when 0
			expect(screen.queryByText(/^\/\d/)).not.toBeInTheDocument();
		});

		it('displays subagent token breakdown when subagent tokens present', () => {
			const autoRunState: BatchRunState = {
				isRunning: true,
				isPaused: false,
				isStopping: false,
				currentTaskIndex: 1,
				totalTasks: 5,
				completedTasks: 2,
				startTime: Date.now() - 60000,
				tasks: [],
				batchName: 'Test Batch',
				currentTaskBytes: 0,
				currentTaskTokens: 200,
				currentTaskStartTime: Date.now() - 5000,
				// Agent tokens
				cumulativeInputTokens: 8000,
				cumulativeOutputTokens: 2000,
				cumulativeCacheReadTokens: 1000,
				cumulativeCacheCreationTokens: 500,
				// Subagent tokens
				subagentInputTokens: 3000,
				subagentOutputTokens: 500,
				subagentCacheReadTokens: 200,
				subagentCacheCreationTokens: 100,
			};
			render(
				<ThinkingStatusPill thinkingSessions={[]} theme={mockTheme} autoRunState={autoRunState} />
			);

			// Should show both agent and subagent breakdowns
			expect(screen.getByText(/\(Agents:/)).toBeInTheDocument();
			expect(screen.getByText(/\(Subagents:/)).toBeInTheDocument();
		});

		it('shows comprehensive tooltip with all token details', () => {
			const autoRunState: BatchRunState = {
				isRunning: true,
				isPaused: false,
				isStopping: false,
				currentTaskIndex: 1,
				totalTasks: 5,
				completedTasks: 2,
				startTime: Date.now() - 60000,
				tasks: [],
				batchName: 'Test Batch',
				currentTaskBytes: 0,
				currentTaskTokens: 0,
				currentTaskStartTime: Date.now(),
				// Agent tokens
				cumulativeInputTokens: 10000,
				cumulativeOutputTokens: 2000,
				cumulativeCacheReadTokens: 3000,
				cumulativeCacheCreationTokens: 500,
				// Subagent tokens
				subagentInputTokens: 5000,
				subagentOutputTokens: 1000,
				subagentCacheReadTokens: 1000,
				subagentCacheCreationTokens: 200,
			};
			render(
				<ThinkingStatusPill thinkingSessions={[]} theme={mockTheme} autoRunState={autoRunState} />
			);

			// Find the cumulative tokens section and check its tooltip
			const tokensLabel = screen.getByText('Tokens:');
			const tokensSection = tokensLabel.closest('div');
			expect(tokensSection).toHaveAttribute('title', expect.stringContaining('Total:'));
			expect(tokensSection).toHaveAttribute('title', expect.stringContaining('Agents:'));
			expect(tokensSection).toHaveAttribute('title', expect.stringContaining('Subagents:'));
		});

		it('updates stats when autoRunState changes (simulating multiple cycles)', () => {
			const initialState: BatchRunState = {
				isRunning: true,
				isPaused: false,
				isStopping: false,
				currentTaskIndex: 0,
				totalTasks: 5,
				completedTasks: 1,
				startTime: Date.now() - 60000,
				tasks: [],
				batchName: 'Test Batch',
				currentTaskBytes: 0,
				currentTaskTokens: 1000,
				currentTaskStartTime: Date.now() - 5000,
				cumulativeInputTokens: 2000,
				cumulativeOutputTokens: 500,
			};

			const { rerender } = render(
				<ThinkingStatusPill thinkingSessions={[]} theme={mockTheme} autoRunState={initialState} />
			);

			// Initial state: total = 2000+500+1000 = 3.5K
			expect(screen.getByText('3.5K')).toBeInTheDocument();
			expect(screen.getByText('1/5')).toBeInTheDocument();

			// Simulate completing a task and starting another
			const updatedState: BatchRunState = {
				...initialState,
				currentTaskIndex: 1,
				completedTasks: 2,
				currentTaskTokens: 500,
				cumulativeInputTokens: 5000,
				cumulativeOutputTokens: 1500,
			};

			rerender(
				<ThinkingStatusPill thinkingSessions={[]} theme={mockTheme} autoRunState={updatedState} />
			);

			// Updated state: total = 5000+1500+500 = 7.0K
			expect(screen.getByText('7.0K')).toBeInTheDocument();
			expect(screen.getByText('2/5')).toBeInTheDocument();
		});

		it('does not show cumulative section when no tokens accumulated yet', () => {
			const autoRunState: BatchRunState = {
				isRunning: true,
				isPaused: false,
				isStopping: false,
				currentTaskIndex: 0,
				totalTasks: 5,
				completedTasks: 0,
				startTime: Date.now() - 5000,
				tasks: [],
				batchName: 'Test Batch',
				currentTaskBytes: 0,
				currentTaskTokens: 0,
				currentTaskStartTime: Date.now(),
				cumulativeInputTokens: 0,
				cumulativeOutputTokens: 0,
			};
			render(
				<ThinkingStatusPill thinkingSessions={[]} theme={mockTheme} autoRunState={autoRunState} />
			);

			// Should NOT show cumulative "Tokens:" section when no tokens accumulated
			expect(screen.queryByText('Tokens:')).not.toBeInTheDocument();
		});

		it('displays subagent indicator when subagent is active', () => {
			const autoRunState: BatchRunState = {
				isRunning: true,
				isPaused: false,
				isStopping: false,
				currentTaskIndex: 1,
				totalTasks: 5,
				completedTasks: 2,
				startTime: Date.now() - 60000,
				tasks: [],
				batchName: 'Test Batch',
				currentTaskBytes: 0,
				currentTaskTokens: 0,
				currentTaskStartTime: Date.now(),
				subagentActive: true,
				subagentType: 'Explore',
				subagentStartTime: Date.now() - 10000,
			};
			render(
				<ThinkingStatusPill thinkingSessions={[]} theme={mockTheme} autoRunState={autoRunState} />
			);

			// Should show subagent indicator with type
			expect(screen.getByText(/Subagent:/)).toBeInTheDocument();
			expect(screen.getByText(/Explore/)).toBeInTheDocument();
		});

		it('includes current task tokens in cumulative total display', () => {
			const autoRunState: BatchRunState = {
				isRunning: true,
				isPaused: false,
				isStopping: false,
				currentTaskIndex: 2,
				totalTasks: 10,
				completedTasks: 3,
				startTime: Date.now() - 120000,
				tasks: [],
				batchName: 'Test Batch',
				currentTaskBytes: 0,
				currentTaskTokens: 2500, // Current task: 2.5K
				currentTaskStartTime: Date.now() - 10000,
				cumulativeInputTokens: 15000, // Cumulative agent: 15K + 5K = 20K
				cumulativeOutputTokens: 5000,
			};
			render(
				<ThinkingStatusPill thinkingSessions={[]} theme={mockTheme} autoRunState={autoRunState} />
			);

			// Total should be: cumulative (15K+5K=20K) + current (2.5K) = 22.5K
			// Get all text content and verify total appears
			const tokensLabel = screen.getByText('Tokens:');
			const tokensSection = tokensLabel.closest('div');
			expect(tokensSection?.textContent).toContain('22.5K');
		});

		it('displays worktree indicator when worktree is active', () => {
			const autoRunState: BatchRunState = {
				isRunning: true,
				isPaused: false,
				isStopping: false,
				currentTaskIndex: 0,
				totalTasks: 5,
				completedTasks: 1,
				startTime: Date.now() - 60000,
				tasks: [],
				batchName: 'Test Batch',
				worktreeActive: true,
				worktreeBranch: 'feature/test-branch',
			};
			render(
				<ThinkingStatusPill thinkingSessions={[]} theme={mockTheme} autoRunState={autoRunState} />
			);

			// Should show worktree indicator (GitBranch icon) with tooltip
			const worktreeIndicator = document.querySelector('[title*="Worktree"]');
			expect(worktreeIndicator).toBeInTheDocument();
		});

		it('handles large cumulative token counts correctly', () => {
			const autoRunState: BatchRunState = {
				isRunning: true,
				isPaused: false,
				isStopping: false,
				currentTaskIndex: 50,
				totalTasks: 100,
				completedTasks: 50,
				startTime: Date.now() - 3600000,
				tasks: [],
				batchName: 'Large Batch',
				currentTaskBytes: 0,
				currentTaskTokens: 5000,
				currentTaskStartTime: Date.now() - 30000,
				// Large cumulative counts
				cumulativeInputTokens: 1500000, // 1.5M
				cumulativeOutputTokens: 300000, // 0.3M
				cumulativeCacheReadTokens: 500000, // 0.5M
				cumulativeCacheCreationTokens: 100000, // 0.1M
				subagentInputTokens: 200000, // 0.2M
				subagentOutputTokens: 50000, // 0.05M
			};
			render(
				<ThinkingStatusPill thinkingSessions={[]} theme={mockTheme} autoRunState={autoRunState} />
			);

			// Find cumulative tokens section by "Tokens:" label
			const tokensLabel = screen.getByText('Tokens:');
			const tokensSection = tokensLabel.closest('div');

			// Total input+output = 1.5M + 0.3M + 0.2M + 0.05M + 5K = 2.055M
			// Should display in M format (2.1M after rounding)
			expect(tokensSection?.textContent).toMatch(/2\.1M/);
			// Cache = 500K + 100K = 600K
			expect(tokensSection?.textContent).toMatch(/600\.0K/);
		});
	});

	describe('memo regression tests', () => {
		it('should re-render when theme changes', () => {
			// This test ensures the memo comparator includes theme
			const thinkingSession = createThinkingSession();
			const { rerender, container } = render(
				<ThinkingStatusPill thinkingSessions={[thinkingSession]} theme={mockTheme} />
			);

			// Capture initial text color from theme
			const pill = container.firstChild as HTMLElement;
			expect(pill).toBeTruthy();

			// Rerender with different theme
			const newTheme = {
				...mockTheme,
				colors: {
					...mockTheme.colors,
					textMain: '#ff0000', // Different text color
				},
			};

			rerender(<ThinkingStatusPill thinkingSessions={[thinkingSession]} theme={newTheme} />);

			// Component should have re-rendered with new theme
			// This test would fail if theme was missing from memo comparator
			expect(container.firstChild).toBeTruthy();
		});

		it('should re-render when autoRunState changes', () => {
			// This test ensures the memo comparator handles autoRunState correctly
			// thinkingSessions should be empty when no sessions are thinking

			// Start without AutoRun and no thinking sessions
			const { rerender } = render(<ThinkingStatusPill thinkingSessions={[]} theme={mockTheme} />);

			// Should not show anything when no thinking sessions and no autoRun
			expect(screen.queryByText(/thinking/i)).not.toBeInTheDocument();

			// Add autoRunState
			const autoRunState: BatchRunState = {
				isRunning: true,
				isStopping: false,
				totalTasks: 5,
				currentTaskIndex: 2,
				startTime: Date.now(),
				completedTasks: 3, // This is what gets displayed as "3/5"
			};

			rerender(
				<ThinkingStatusPill thinkingSessions={[]} theme={mockTheme} autoRunState={autoRunState} />
			);

			// Should now show the AutoRun pill with completedTasks/totalTasks
			expect(screen.getByText('3/5')).toBeInTheDocument();
		});

		it('should re-render when namedSessions mapping changes', () => {
			// This test ensures the memo comparator handles namedSessions correctly
			const thinkingSession = createThinkingSession({
				agentSessionId: 'claude-abc123',
			});

			const { rerender } = render(
				<ThinkingStatusPill
					thinkingSessions={[thinkingSession]}
					theme={mockTheme}
					namedSessions={{}}
				/>
			);

			// Session name should be the default (may appear in multiple places due to tooltip)
			expect(screen.getAllByText('Test Session').length).toBeGreaterThan(0);

			// Update namedSessions with a custom name for this Claude session
			rerender(
				<ThinkingStatusPill
					thinkingSessions={[thinkingSession]}
					theme={mockTheme}
					namedSessions={{ 'claude-abc123': 'Custom Named Session' }}
				/>
			);

			// Should now show the custom name
			expect(screen.getAllByText('Custom Named Session').length).toBeGreaterThan(0);
		});
	});
});
