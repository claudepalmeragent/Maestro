import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GlobalAutoRunStatus } from '../../../renderer/components/GlobalAutoRunStatus';
import type { Session, BatchRunState, Theme } from '../../../renderer/types';

const mockTheme = {
	colors: {
		accent: '#7c3aed',
		accentForeground: '#ffffff',
		bgMain: '#1a1a2e',
		bgSidebar: '#16213e',
		bgActivity: '#1a1a2e',
		textMain: '#e0e0e0',
		textDim: '#888888',
		border: '#333333',
		error: '#ef4444',
		success: '#22c55e',
		warning: '#f59e0b',
	},
} as Theme;

const DEFAULT_BATCH: BatchRunState = {
	isRunning: false,
	isStopping: false,
	documents: [],
	lockedDocuments: [],
	currentDocumentIndex: 0,
	currentDocTasksTotal: 0,
	currentDocTasksCompleted: 0,
	totalTasksAcrossAllDocs: 0,
	completedTasksAcrossAllDocs: 0,
	loopEnabled: false,
	loopIteration: 0,
	folderPath: '',
	worktreeActive: false,
	totalTasks: 0,
	completedTasks: 0,
	currentTaskIndex: 0,
	originalContent: '',
	sessionIds: [],
};

const makeSessions = (names: string[]): Session[] =>
	names.map((name, i) => ({
		id: `session-${i}`,
		name,
		cwd: '/tmp',
		state: 'idle',
		aiTabs: [],
		activeTabId: 'tab-0',
	})) as unknown as Session[];

describe('GlobalAutoRunStatus', () => {
	it('renders nothing when no batches are active', () => {
		const sessions = makeSessions(['Agent A', 'Agent B']);
		const { container } = render(
			<GlobalAutoRunStatus
				theme={mockTheme}
				sessions={sessions}
				getBatchState={() => DEFAULT_BATCH}
				activeSessionId="session-0"
				onSwitchToSession={vi.fn()}
			/>
		);
		expect(container.firstChild).toBeNull();
	});

	it('renders nothing when only the current session has an active batch', () => {
		const sessions = makeSessions(['Agent A']);
		const getBatchState = (id: string) =>
			id === 'session-0'
				? {
						...DEFAULT_BATCH,
						isRunning: true,
						totalTasks: 5,
						completedTasks: 2,
						startTime: Date.now() - 60000,
					}
				: DEFAULT_BATCH;

		const { container } = render(
			<GlobalAutoRunStatus
				theme={mockTheme}
				sessions={sessions}
				getBatchState={getBatchState}
				activeSessionId="session-0"
				onSwitchToSession={vi.fn()}
			/>
		);
		expect(container.firstChild).toBeNull();
	});

	it('renders when another session has an active batch', () => {
		const sessions = makeSessions(['Agent A', 'Agent B']);
		const getBatchState = (id: string) =>
			id === 'session-1'
				? {
						...DEFAULT_BATCH,
						isRunning: true,
						totalTasks: 10,
						completedTasks: 3,
						startTime: Date.now() - 120000,
					}
				: DEFAULT_BATCH;

		render(
			<GlobalAutoRunStatus
				theme={mockTheme}
				sessions={sessions}
				getBatchState={getBatchState}
				activeSessionId="session-0"
				onSwitchToSession={vi.fn()}
			/>
		);
		expect(screen.getByText(/1 Auto Run active/)).toBeInTheDocument();
	});

	it('shows count for multiple active batches', () => {
		const sessions = makeSessions(['Agent A', 'Agent B', 'Agent C']);
		const getBatchState = (id: string) =>
			id !== 'session-0'
				? {
						...DEFAULT_BATCH,
						isRunning: true,
						totalTasks: 5,
						completedTasks: 1,
						startTime: Date.now() - 60000,
					}
				: DEFAULT_BATCH;

		render(
			<GlobalAutoRunStatus
				theme={mockTheme}
				sessions={sessions}
				getBatchState={getBatchState}
				activeSessionId="session-0"
				onSwitchToSession={vi.fn()}
			/>
		);
		expect(screen.getByText(/2 Auto Runs active/)).toBeInTheDocument();
	});

	it('calls onSwitchToSession when clicking an expanded entry', () => {
		const onSwitch = vi.fn();
		const sessions = makeSessions(['Agent A', 'Agent B']);
		const getBatchState = (id: string) =>
			id === 'session-1'
				? {
						...DEFAULT_BATCH,
						isRunning: true,
						totalTasks: 5,
						completedTasks: 2,
						startTime: Date.now(),
					}
				: DEFAULT_BATCH;

		render(
			<GlobalAutoRunStatus
				theme={mockTheme}
				sessions={sessions}
				getBatchState={getBatchState}
				activeSessionId="session-0"
				onSwitchToSession={onSwitch}
			/>
		);

		// Expand the list
		fireEvent.click(screen.getByText(/1 Auto Run active/));

		// Click Agent B entry
		fireEvent.click(screen.getByText('Agent B'));
		expect(onSwitch).toHaveBeenCalledWith('session-1');
	});
});
