import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PinPreviewPopover } from '../../../renderer/components/PinPreviewPopover';
import type { PinnedItem, Theme } from '../../../renderer/types';

// Mock MarkdownRenderer
vi.mock('../../../renderer/components/MarkdownRenderer', () => ({
	MarkdownRenderer: ({ content }: { content: string }) => (
		<div data-testid="markdown-renderer">{content}</div>
	),
}));

const mockTheme: Theme = {
	id: 'test-dark',
	name: 'Test Dark',
	colors: {
		bgMain: '#1a1a2e',
		bgSidebar: '#16213e',
		bgActivity: '#0f3460',
		textMain: '#e0e0e0',
		textDim: '#888888',
		accent: '#00adb5',
		border: '#333333',
		error: '#e74c3c',
		success: '#2ecc71',
		warning: '#f39c12',
		info: '#3498db',
	},
} as Theme;

const longPin: PinnedItem = {
	logId: 'log-1',
	tabId: 'tab-1',
	text:
		'A'.repeat(200) +
		' This is a very long message that should trigger the hover preview because it exceeds the 150 character threshold for showing the popover.',
	source: 'ai' as const,
	messageTimestamp: Date.now(),
	pinnedAt: Date.now(),
};

const shortPin: PinnedItem = {
	logId: 'log-2',
	tabId: 'tab-1',
	text: 'Short message',
	source: 'user' as const,
	messageTimestamp: Date.now(),
	pinnedAt: Date.now(),
};

describe('PinPreviewPopover', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	it('renders children without popover initially', () => {
		render(
			<PinPreviewPopover theme={mockTheme} pin={longPin}>
				<div data-testid="child">Pin card content</div>
			</PinPreviewPopover>
		);

		expect(screen.getByTestId('child')).toBeInTheDocument();
		expect(screen.queryByTestId('markdown-renderer')).not.toBeInTheDocument();
	});

	it('shows popover after hover delay for long messages', async () => {
		render(
			<PinPreviewPopover theme={mockTheme} pin={longPin}>
				<div data-testid="child">Pin card content</div>
			</PinPreviewPopover>
		);

		// Hover over the container
		fireEvent.mouseEnter(screen.getByTestId('child').parentElement!);

		// Should not show immediately (300ms delay)
		expect(screen.queryByTestId('markdown-renderer')).not.toBeInTheDocument();

		// Advance past the delay
		act(() => {
			vi.advanceTimersByTime(350);
		});

		// Now should show
		expect(screen.getByTestId('markdown-renderer')).toBeInTheDocument();
	});

	it('does not show popover for short messages', () => {
		render(
			<PinPreviewPopover theme={mockTheme} pin={shortPin}>
				<div data-testid="child">Pin card content</div>
			</PinPreviewPopover>
		);

		fireEvent.mouseEnter(screen.getByTestId('child').parentElement!);

		act(() => {
			vi.advanceTimersByTime(350);
		});

		// Short message should not trigger popover
		expect(screen.queryByTestId('markdown-renderer')).not.toBeInTheDocument();
	});

	it('hides popover on mouse leave', () => {
		render(
			<PinPreviewPopover theme={mockTheme} pin={longPin}>
				<div data-testid="child">Pin card content</div>
			</PinPreviewPopover>
		);

		const container = screen.getByTestId('child').parentElement!;

		// Show popover
		fireEvent.mouseEnter(container);
		act(() => {
			vi.advanceTimersByTime(350);
		});
		expect(screen.getByTestId('markdown-renderer')).toBeInTheDocument();

		// Hide popover (scheduleHide uses a 150ms leave delay)
		fireEvent.mouseLeave(container);
		act(() => {
			vi.advanceTimersByTime(200);
		});
		expect(screen.queryByTestId('markdown-renderer')).not.toBeInTheDocument();
	});

	it('does not show popover when disabled', () => {
		render(
			<PinPreviewPopover theme={mockTheme} pin={longPin} enabled={false}>
				<div data-testid="child">Pin card content</div>
			</PinPreviewPopover>
		);

		fireEvent.mouseEnter(screen.getByTestId('child').parentElement!);

		act(() => {
			vi.advanceTimersByTime(350);
		});

		expect(screen.queryByTestId('markdown-renderer')).not.toBeInTheDocument();
	});

	it('cancels popover if mouse leaves before delay', () => {
		render(
			<PinPreviewPopover theme={mockTheme} pin={longPin}>
				<div data-testid="child">Pin card content</div>
			</PinPreviewPopover>
		);

		const container = screen.getByTestId('child').parentElement!;

		// Quick hover + leave
		fireEvent.mouseEnter(container);
		act(() => {
			vi.advanceTimersByTime(100); // Before the 300ms threshold
		});
		fireEvent.mouseLeave(container);

		// Advance past the delay
		act(() => {
			vi.advanceTimersByTime(300);
		});

		// Should NOT have shown
		expect(screen.queryByTestId('markdown-renderer')).not.toBeInTheDocument();
	});
});
