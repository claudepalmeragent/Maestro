/**
 * Tests for Toast.tsx
 *
 * Tests the ToastContainer and ToastItem components' core behavior:
 * - Rendering toasts with content
 * - Toast type icons
 * - Metadata display (group, project, tab)
 * - Close button functionality
 * - Session navigation clicks
 * - Animation states
 * - Duration formatting
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastContainer } from '../../../renderer/components/Toast';
import type { Theme } from '../../../renderer/types';
import * as NotificationStore from '../../../renderer/stores/notificationStore';

// Mock the notificationStore
vi.mock('../../../renderer/stores/notificationStore', () => ({
	useNotificationStore: vi.fn(),
	notifyToast: vi.fn(),
}));

const mockTheme: Theme = {
	id: 'dracula',
	name: 'Dracula',
	mode: 'dark',
	colors: {
		bgMain: '#282a36',
		bgSidebar: '#21222c',
		bgActivity: '#343746',
		border: '#44475a',
		textMain: '#f8f8f2',
		textDim: '#6272a4',
		accent: '#bd93f9',
		accentDim: '#bd93f920',
		accentText: '#f8f8f2',
		success: '#50fa7b',
		warning: '#ffb86c',
		error: '#ff5555',
	},
};

const createMockToast = (overrides = {}): NotificationStore.Toast => ({
	id: 'toast-1',
	type: 'info',
	title: 'Test Toast',
	message: 'This is a test message',
	timestamp: Date.now(),
	duration: 5000,
	...overrides,
});

describe('Toast', () => {
	let mockUseNotificationStore: ReturnType<typeof vi.fn>;
	let mockRemoveToast: ReturnType<typeof vi.fn>;
	let mockStoreState: Record<string, any>;

	function setMockStoreState(overrides: Record<string, any>) {
		Object.assign(mockStoreState, overrides);
		mockUseNotificationStore.mockImplementation((selector?: any) => {
			return selector ? selector(mockStoreState) : mockStoreState;
		});
	}

	beforeEach(() => {
		vi.useFakeTimers();
		mockRemoveToast = vi.fn();
		mockStoreState = {
			toasts: [],
			removeToast: mockRemoveToast,
		};
		mockUseNotificationStore = vi.mocked(NotificationStore.useNotificationStore);
		mockUseNotificationStore.mockImplementation((selector?: any) => {
			return selector ? selector(mockStoreState) : mockStoreState;
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	describe('empty state', () => {
		it('returns null when no toasts', () => {
			const { container } = render(<ToastContainer theme={mockTheme} />);
			expect(container.firstChild).toBeNull();
		});
	});

	describe('rendering toasts', () => {
		it('renders toast with title and message', () => {
			setMockStoreState({
				toasts: [createMockToast()],
			});

			render(<ToastContainer theme={mockTheme} />);
			expect(screen.getByText('Test Toast')).toBeInTheDocument();
			expect(screen.getByText('This is a test message')).toBeInTheDocument();
		});

		it('renders multiple toasts', () => {
			setMockStoreState({
				toasts: [
					createMockToast({ id: 'toast-1', title: 'First' }),
					createMockToast({ id: 'toast-2', title: 'Second' }),
				],
			});

			render(<ToastContainer theme={mockTheme} />);
			expect(screen.getByText('First')).toBeInTheDocument();
			expect(screen.getByText('Second')).toBeInTheDocument();
		});
	});

	describe('toast types', () => {
		it('renders all toast types without error', () => {
			const types = ['success', 'error', 'warning', 'info'] as const;
			types.forEach((type) => {
				setMockStoreState({
					toasts: [createMockToast({ type, title: `${type} toast` })],
				});

				const { unmount } = render(<ToastContainer theme={mockTheme} />);
				expect(screen.getByText(`${type} toast`)).toBeInTheDocument();
				unmount();
			});
		});
	});

	describe('metadata display', () => {
		it('displays group, project, and tab when provided', () => {
			setMockStoreState({
				toasts: [
					createMockToast({
						group: 'Test Group',
						project: 'My Project',
						tabName: 'Tab 1',
					}),
				],
			});

			render(<ToastContainer theme={mockTheme} />);
			expect(screen.getByText('Test Group')).toBeInTheDocument();
			expect(screen.getByText('My Project')).toBeInTheDocument();
			expect(screen.getByText('Tab 1')).toBeInTheDocument();
		});

		it('shows agentSessionId as title attribute on tab name', () => {
			setMockStoreState({
				toasts: [
					createMockToast({
						tabName: 'Tab 1',
						agentSessionId: 'abc-123',
					}),
				],
			});

			render(<ToastContainer theme={mockTheme} />);
			expect(screen.getByText('Tab 1')).toHaveAttribute('title', 'Claude Session: abc-123');
		});
	});

	describe('duration badge', () => {
		it('formats duration correctly', () => {
			const testCases = [
				{ duration: 500, expected: '500ms' },
				{ duration: 5000, expected: '5s' },
				{ duration: 125000, expected: '2m 5s' },
				{ duration: 120000, expected: '2m' },
			];

			testCases.forEach(({ duration, expected }) => {
				setMockStoreState({
					toasts: [createMockToast({ taskDuration: duration })],
				});

				const { unmount } = render(<ToastContainer theme={mockTheme} />);
				expect(screen.getByText(new RegExp(`Completed in ${expected}`))).toBeInTheDocument();
				unmount();
			});
		});

		it('does not display when taskDuration is 0 or undefined', () => {
			setMockStoreState({
				toasts: [createMockToast({ taskDuration: 0 })],
			});

			render(<ToastContainer theme={mockTheme} />);
			expect(screen.queryByText(/Completed in/)).not.toBeInTheDocument();
		});
	});

	describe('close button', () => {
		it('calls removeToast when clicked', async () => {
			setMockStoreState({
				toasts: [createMockToast()],
			});

			render(<ToastContainer theme={mockTheme} />);
			const closeButton = screen.getAllByRole('button')[0];
			fireEvent.click(closeButton);

			act(() => {
				vi.advanceTimersByTime(300);
			});

			expect(mockRemoveToast).toHaveBeenCalledWith('toast-1');
		});
	});

	describe('session navigation', () => {
		it('calls onSessionClick with sessionId when toast is clicked', () => {
			const onSessionClick = vi.fn();
			setMockStoreState({
				toasts: [createMockToast({ sessionId: 'session-1' })],
			});

			const { container } = render(
				<ToastContainer theme={mockTheme} onSessionClick={onSessionClick} />
			);
			const clickableToast = container.querySelector('.cursor-pointer');
			fireEvent.click(clickableToast!);

			expect(onSessionClick).toHaveBeenCalledWith('session-1', undefined);
		});

		it('includes tabId when provided', () => {
			const onSessionClick = vi.fn();
			setMockStoreState({
				toasts: [createMockToast({ sessionId: 'session-1', tabId: 'tab-1' })],
			});

			const { container } = render(
				<ToastContainer theme={mockTheme} onSessionClick={onSessionClick} />
			);
			const clickableToast = container.querySelector('.cursor-pointer');
			fireEvent.click(clickableToast!);

			expect(onSessionClick).toHaveBeenCalledWith('session-1', 'tab-1');
		});

		it('is not clickable without sessionId', () => {
			const onSessionClick = vi.fn();
			setMockStoreState({
				toasts: [createMockToast()],
			});

			const { container } = render(
				<ToastContainer theme={mockTheme} onSessionClick={onSessionClick} />
			);
			expect(container.querySelector('.cursor-pointer')).not.toBeInTheDocument();
		});
	});

	describe('animation states', () => {
		it('starts with entering animation then transitions to normal', () => {
			setMockStoreState({
				toasts: [createMockToast()],
			});

			const { container } = render(<ToastContainer theme={mockTheme} />);
			const toastOuter = container.querySelector('.relative.overflow-hidden');

			// Initially entering
			expect(toastOuter).toHaveStyle({ transform: 'translateX(100%)' });

			// After enter animation
			act(() => {
				vi.advanceTimersByTime(50);
			});
			expect(toastOuter).toHaveStyle({ transform: 'translateX(0)' });
		});
	});

	describe('progress bar', () => {
		it('renders when duration is provided', () => {
			setMockStoreState({
				toasts: [createMockToast({ duration: 5000 })],
			});

			const { container } = render(<ToastContainer theme={mockTheme} />);
			expect(container.querySelector('.h-1.rounded-b-lg')).toBeInTheDocument();
		});

		it('does not render when duration is 0', () => {
			setMockStoreState({
				toasts: [createMockToast({ duration: 0 })],
			});

			const { container } = render(<ToastContainer theme={mockTheme} />);
			expect(container.querySelector('.h-1.rounded-b-lg')).not.toBeInTheDocument();
		});
	});
});
