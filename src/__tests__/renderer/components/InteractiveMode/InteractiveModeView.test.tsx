/**
 * Tests for InteractiveModeView component.
 *
 * Covers:
 * - Subscribes to claude-pty:rawData on mount; unsubscribes on unmount.
 * - Renders Take Control button initially.
 * - Clicking Take Control (when runner is idle) enables user-controlled state
 *   and renders Resume Orchestration + visual indicator.
 * - Clicking Take Control when runner is busy shows a confirmation modal first.
 * - Resume Orchestration returns to orchestration state without confirmation.
 * - Keystrokes are forwarded to injectManualCommand only when user-controlled.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { InteractiveModeView } from '../../../../renderer/components/InteractiveMode/InteractiveModeView';
import type { Theme } from '../../../../renderer/types';

// ---------------------------------------------------------------------------
// Minimal theme
// ---------------------------------------------------------------------------

const theme: Theme = {
	id: 'test',
	name: 'Test',
	mode: 'dark',
	colors: {
		bgMain: '#1e1e1e',
		bgSidebar: '#252526',
		bgActivity: '#333',
		textMain: '#d4d4d4',
		textDim: '#888',
		accent: '#0e7afe',
		accentForeground: '#fff',
		border: '#3c3c3c',
		success: '#4ec94e',
		warning: '#f59e0b',
		error: '#f44747',
		info: '#9cdcfe',
	},
} as Theme;

// ---------------------------------------------------------------------------
// Mock window.maestro.claudePty
// ---------------------------------------------------------------------------

let rawDataListeners: Map<string, (chunk: string) => void> = new Map();

const mockOnRawData = vi.fn((sessionId: string, cb: (chunk: string) => void) => {
	rawDataListeners.set(sessionId, cb);
	return () => rawDataListeners.delete(sessionId);
});

const mockInjectManualCommand = vi.fn().mockResolvedValue(true);
const mockSetUserControlled = vi.fn().mockResolvedValue(undefined);
const mockGetState = vi
	.fn()
	.mockResolvedValue({ isBusy: false, userControlled: false, alive: true });

beforeEach(() => {
	rawDataListeners = new Map();
	mockOnRawData.mockClear();
	mockInjectManualCommand.mockClear();
	mockSetUserControlled.mockClear();
	mockGetState.mockClear();

	// @ts-expect-error - global window mock in test environment
	window.maestro = {
		claudePty: {
			onRawData: mockOnRawData,
			injectManualCommand: mockInjectManualCommand,
			setUserControlled: mockSetUserControlled,
			getState: mockGetState,
		},
	};
});

afterEach(() => {
	vi.clearAllTimers();
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function renderView(sessionId = 'sess-1') {
	return render(<InteractiveModeView sessionId={sessionId} theme={theme} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InteractiveModeView', () => {
	describe('subscription lifecycle', () => {
		it('subscribes to rawData on mount with the correct sessionId', () => {
			renderView('sess-abc');
			expect(mockOnRawData).toHaveBeenCalledWith('sess-abc', expect.any(Function));
		});

		it('unsubscribes on unmount', () => {
			const { unmount } = renderView('sess-abc');
			expect(rawDataListeners.has('sess-abc')).toBe(true);
			unmount();
			expect(rawDataListeners.has('sess-abc')).toBe(false);
		});
	});

	describe('initial render', () => {
		it('shows the "Take Control" button initially', () => {
			renderView();
			expect(screen.getByRole('button', { name: /take control/i })).toBeInTheDocument();
		});

		it('does not show the "Resume Orchestration" button initially', () => {
			renderView();
			expect(screen.queryByRole('button', { name: /resume orchestration/i })).toBeNull();
		});

		it('does not show the "Manual Control Active" banner initially', () => {
			renderView();
			expect(screen.queryByText(/manual control active/i)).toBeNull();
		});
	});

	describe('Take Control (idle runner)', () => {
		it('shows Resume Orchestration button after clicking Take Control', async () => {
			// getState returns isBusy: false → no confirmation dialog
			mockGetState.mockResolvedValue({ isBusy: false, userControlled: false, alive: true });
			renderView();

			await act(async () => {
				fireEvent.click(screen.getByRole('button', { name: /take control/i }));
			});

			await waitFor(() => {
				expect(screen.getByRole('button', { name: /resume orchestration/i })).toBeInTheDocument();
			});
		});

		it('shows the Manual Control Active banner after taking control', async () => {
			mockGetState.mockResolvedValue({ isBusy: false, userControlled: false, alive: true });
			renderView();

			await act(async () => {
				fireEvent.click(screen.getByRole('button', { name: /take control/i }));
			});

			await waitFor(() => {
				expect(screen.getByText(/manual control active/i)).toBeInTheDocument();
			});
		});

		it('calls setUserControlled(sessionId, true) when taking control', async () => {
			mockGetState.mockResolvedValue({ isBusy: false, userControlled: false, alive: true });
			renderView('my-session');

			await act(async () => {
				fireEvent.click(screen.getByRole('button', { name: /take control/i }));
			});

			await waitFor(() => {
				expect(mockSetUserControlled).toHaveBeenCalledWith('my-session', true);
			});
		});
	});

	describe('Take Control (busy runner)', () => {
		it('shows confirmation modal when runner is busy', async () => {
			mockGetState.mockResolvedValue({ isBusy: true, userControlled: false, alive: true });
			renderView();

			// Wait for getState to resolve on mount
			await act(async () => {});

			await act(async () => {
				fireEvent.click(screen.getByRole('button', { name: /take control/i }));
			});

			// The confirmation dialog should appear
			expect(screen.getByText(/take control will interrupt/i)).toBeInTheDocument();
		});

		it('cancels confirmation modal without taking control', async () => {
			mockGetState.mockResolvedValue({ isBusy: true, userControlled: false, alive: true });
			renderView();

			await act(async () => {});
			await act(async () => {
				fireEvent.click(screen.getByRole('button', { name: /take control/i }));
			});

			// Click Cancel
			await act(async () => {
				fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
			});

			expect(screen.queryByText(/manual control active/i)).toBeNull();
			expect(mockSetUserControlled).not.toHaveBeenCalled();
		});

		it('takes control after confirming when busy', async () => {
			mockGetState.mockResolvedValue({ isBusy: true, userControlled: false, alive: true });
			renderView('sess-busy');

			await act(async () => {});
			await act(async () => {
				fireEvent.click(screen.getByRole('button', { name: /take control/i }));
			});

			// Confirm in the modal
			await act(async () => {
				// Get "Take Control" button inside the modal (second one with matching text)
				const buttons = screen.getAllByRole('button', { name: /take control/i });
				fireEvent.click(buttons[buttons.length - 1]);
			});

			await waitFor(() => {
				expect(mockSetUserControlled).toHaveBeenCalledWith('sess-busy', true);
				expect(screen.getByText(/manual control active/i)).toBeInTheDocument();
			});
		});
	});

	describe('Resume Orchestration', () => {
		it('returns to orchestration state without confirmation', async () => {
			mockGetState.mockResolvedValue({ isBusy: false, userControlled: false, alive: true });
			renderView('sess-resume');

			// Take control first
			await act(async () => {
				fireEvent.click(screen.getByRole('button', { name: /take control/i }));
			});
			await waitFor(() => screen.getByRole('button', { name: /resume orchestration/i }));

			// Resume
			await act(async () => {
				fireEvent.click(screen.getByRole('button', { name: /resume orchestration/i }));
			});

			await waitFor(() => {
				expect(mockSetUserControlled).toHaveBeenCalledWith('sess-resume', false);
				expect(screen.getByRole('button', { name: /take control/i })).toBeInTheDocument();
				expect(screen.queryByText(/manual control active/i)).toBeNull();
			});
		});
	});

	describe('keyboard passthrough', () => {
		it('does NOT forward keystrokes when NOT user-controlled', async () => {
			renderView('sess-keys');
			const container = screen
				.getByRole('button', { name: /take control/i })
				.closest('div[tabindex]');
			// Dispatch keydown without taking control first
			await act(async () => {
				fireEvent.keyDown(container!, { key: 'a' });
			});
			expect(mockInjectManualCommand).not.toHaveBeenCalled();
		});

		it('forwards printable keystrokes when user-controlled', async () => {
			mockGetState.mockResolvedValue({ isBusy: false, userControlled: false, alive: true });
			renderView('sess-keys');

			// Take control
			await act(async () => {
				fireEvent.click(screen.getByRole('button', { name: /take control/i }));
			});
			await waitFor(() => screen.getByRole('button', { name: /resume orchestration/i }));

			const container = screen
				.getByRole('button', { name: /resume orchestration/i })
				.closest('div[tabindex]');
			await act(async () => {
				fireEvent.keyDown(container!, { key: 'x' });
			});

			expect(mockInjectManualCommand).toHaveBeenCalledWith('sess-keys', 'x');
		});

		it('converts Enter keydown to \\r when user-controlled', async () => {
			mockGetState.mockResolvedValue({ isBusy: false, userControlled: false, alive: true });
			renderView('sess-enter');

			await act(async () => {
				fireEvent.click(screen.getByRole('button', { name: /take control/i }));
			});
			await waitFor(() => screen.getByRole('button', { name: /resume orchestration/i }));

			const container = screen
				.getByRole('button', { name: /resume orchestration/i })
				.closest('div[tabindex]');
			await act(async () => {
				fireEvent.keyDown(container!, { key: 'Enter' });
			});

			expect(mockInjectManualCommand).toHaveBeenCalledWith('sess-enter', '\r');
		});
	});
});
