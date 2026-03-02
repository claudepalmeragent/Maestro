import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PinnedPanel } from '../../../renderer/components/PinnedPanel';
import type { PinnedItem, Theme } from '../../../renderer/types';
const mockTheme: Theme = {
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

const makePins = (count: number): PinnedItem[] =>
	Array.from({ length: count }, (_, i) => ({
		logId: `log-${i}`,
		tabId: 'tab-1',
		text: `Pinned message ${i}`,
		source: i % 2 === 0 ? ('ai' as const) : ('user' as const),
		messageTimestamp: Date.now() - (count - i) * 60000,
		pinnedAt: Date.now() - (count - i) * 30000,
		pinSortOrder: i,
	}));

describe('PinnedPanel', () => {
	it('renders empty state when no pins', () => {
		render(
			<PinnedPanel
				theme={mockTheme}
				pinnedItems={[]}
				onUnpinMessage={vi.fn()}
				onScrollToMessage={vi.fn()}
				onReorderPins={vi.fn()}
				pinCount={0}
				pinLimit={20}
			/>
		);
		expect(screen.getByText('No pinned messages')).toBeInTheDocument();
	});

	it('renders pinned items with correct count', () => {
		const pins = makePins(3);
		render(
			<PinnedPanel
				theme={mockTheme}
				pinnedItems={pins}
				onUnpinMessage={vi.fn()}
				onScrollToMessage={vi.fn()}
				onReorderPins={vi.fn()}
				pinCount={3}
				pinLimit={20}
			/>
		);
		expect(screen.getByText('3/20')).toBeInTheDocument();
		expect(screen.getByText(/Pinned message 0/)).toBeInTheDocument();
	});

	it('shows warning when pin limit is reached', () => {
		const pins = makePins(20);
		render(
			<PinnedPanel
				theme={mockTheme}
				pinnedItems={pins}
				onUnpinMessage={vi.fn()}
				onScrollToMessage={vi.fn()}
				onReorderPins={vi.fn()}
				pinCount={20}
				pinLimit={20}
			/>
		);
		expect(screen.getByText(/Pin limit reached/)).toBeInTheDocument();
	});

	it('calls onScrollToMessage when pin card is clicked', () => {
		const onScroll = vi.fn();
		const pins = makePins(1);
		render(
			<PinnedPanel
				theme={mockTheme}
				pinnedItems={pins}
				onUnpinMessage={vi.fn()}
				onScrollToMessage={onScroll}
				onReorderPins={vi.fn()}
				pinCount={1}
				pinLimit={20}
			/>
		);
		fireEvent.click(screen.getByText(/Pinned message 0/));
		expect(onScroll).toHaveBeenCalledWith(pins[0].messageTimestamp);
	});

	it('requires double-click on X to unpin', () => {
		const onUnpin = vi.fn();
		const pins = makePins(1);
		const { container } = render(
			<PinnedPanel
				theme={mockTheme}
				pinnedItems={pins}
				onUnpinMessage={onUnpin}
				onScrollToMessage={vi.fn()}
				onReorderPins={vi.fn()}
				pinCount={1}
				pinLimit={20}
			/>
		);
		// Find the X button
		const xButton = container.querySelector('button[title="Unpin message"]');
		expect(xButton).toBeTruthy();

		// First click — should NOT unpin, just show confirmation
		fireEvent.click(xButton!);
		expect(onUnpin).not.toHaveBeenCalled();

		// Second click — should unpin
		fireEvent.click(xButton!);
		expect(onUnpin).toHaveBeenCalledWith('log-0');
	});

	it('sorts pins by pinSortOrder ascending', () => {
		const pins: PinnedItem[] = [
			{
				logId: 'b',
				tabId: 't',
				text: 'Second',
				source: 'ai',
				messageTimestamp: 100,
				pinnedAt: 200,
				pinSortOrder: 1,
			},
			{
				logId: 'a',
				tabId: 't',
				text: 'First',
				source: 'user',
				messageTimestamp: 50,
				pinnedAt: 100,
				pinSortOrder: 0,
			},
		];
		render(
			<PinnedPanel
				theme={mockTheme}
				pinnedItems={pins}
				onUnpinMessage={vi.fn()}
				onScrollToMessage={vi.fn()}
				onReorderPins={vi.fn()}
				pinCount={2}
				pinLimit={20}
			/>
		);
		const items = screen.getAllByText(/First|Second/);
		expect(items[0].textContent).toContain('First');
		expect(items[1].textContent).toContain('Second');
	});
});

describe('Pin button memo reactivity', () => {
	it('should include pinned field in memo comparison description', () => {
		// This is a documentation test to ensure the memo comparator is correct.
		// The actual memo behavior is tested via integration, but we verify
		// that the PinnedPanel correctly reflects pin state changes.
		const pinnedItem: PinnedItem = {
			logId: 'log-1',
			tabId: 'tab-1',
			text: 'Test message',
			source: 'ai' as const,
			messageTimestamp: Date.now(),
			pinnedAt: Date.now(),
			pinSortOrder: 0,
		};

		const { rerender } = render(
			<PinnedPanel
				theme={mockTheme}
				pinnedItems={[pinnedItem]}
				onUnpinMessage={vi.fn()}
				onScrollToMessage={vi.fn()}
				onReorderPins={vi.fn()}
				pinCount={1}
				pinLimit={20}
			/>
		);

		// Should show the pin
		expect(screen.getByText(/Test message/)).toBeInTheDocument();

		// Re-render with empty pins (simulates unpin)
		rerender(
			<PinnedPanel
				theme={mockTheme}
				pinnedItems={[]}
				onUnpinMessage={vi.fn()}
				onScrollToMessage={vi.fn()}
				onReorderPins={vi.fn()}
				pinCount={0}
				pinLimit={20}
			/>
		);

		// Should show empty state
		expect(screen.getByText('No pinned messages')).toBeInTheDocument();
	});
});

describe('Pin card date display', () => {
	it('should show date and time on pin cards', () => {
		const pin: PinnedItem = {
			logId: 'log-1',
			tabId: 'tab-1',
			text: 'Test message',
			source: 'ai' as const,
			messageTimestamp: new Date('2025-03-15T14:30:00').getTime(),
			pinnedAt: Date.now(),
			pinSortOrder: 0,
		};

		render(
			<PinnedPanel
				theme={mockTheme}
				pinnedItems={[pin]}
				onUnpinMessage={vi.fn()}
				onScrollToMessage={vi.fn()}
				onReorderPins={vi.fn()}
				pinCount={1}
				pinLimit={20}
			/>
		);

		// Should contain both date and time portions (month abbreviation indicates date is present)
		const timeSpans = document.querySelectorAll('.text-\\[10px\\]');
		const timestamps = Array.from(timeSpans).map((el) => el.textContent);
		const hasDateAndTime = timestamps.some(
			(t) => t && /\w{3}\s+\d/.test(t) && /\d{1,2}:\d{2}/.test(t)
		);
		expect(hasDateAndTime).toBe(true);
	});
});

describe('Pin card copy button', () => {
	it('should have a copy button on each pin card', () => {
		const pin: PinnedItem = {
			logId: 'log-1',
			tabId: 'tab-1',
			text: 'Copy me',
			source: 'ai' as const,
			messageTimestamp: Date.now(),
			pinnedAt: Date.now(),
			pinSortOrder: 0,
		};

		render(
			<PinnedPanel
				theme={mockTheme}
				pinnedItems={[pin]}
				onUnpinMessage={vi.fn()}
				onScrollToMessage={vi.fn()}
				onReorderPins={vi.fn()}
				pinCount={1}
				pinLimit={20}
			/>
		);

		const copyButton = screen.getByTitle('Copy pin content');
		expect(copyButton).toBeInTheDocument();
	});
});

describe('Pin card drag reorder', () => {
	it('should render drag handles on pin cards', () => {
		const pins: PinnedItem[] = [
			{
				logId: 'log-1',
				tabId: 'tab-1',
				text: 'First pin',
				source: 'ai' as const,
				messageTimestamp: Date.now() - 2000,
				pinnedAt: Date.now() - 2000,
				pinSortOrder: 0,
			},
			{
				logId: 'log-2',
				tabId: 'tab-1',
				text: 'Second pin',
				source: 'user' as const,
				messageTimestamp: Date.now() - 1000,
				pinnedAt: Date.now() - 1000,
				pinSortOrder: 1,
			},
		];

		render(
			<PinnedPanel
				theme={mockTheme}
				pinnedItems={pins}
				onUnpinMessage={vi.fn()}
				onScrollToMessage={vi.fn()}
				onReorderPins={vi.fn()}
				pinCount={2}
				pinLimit={20}
			/>
		);

		// Should have drag handles (title="Drag to reorder")
		const dragHandles = screen.getAllByTitle('Drag to reorder');
		expect(dragHandles).toHaveLength(2);
	});

	it('should have draggable attribute on pin cards', () => {
		const pin: PinnedItem = {
			logId: 'log-1',
			tabId: 'tab-1',
			text: 'Draggable pin',
			source: 'ai' as const,
			messageTimestamp: Date.now(),
			pinnedAt: Date.now(),
			pinSortOrder: 0,
		};

		render(
			<PinnedPanel
				theme={mockTheme}
				pinnedItems={[pin]}
				onUnpinMessage={vi.fn()}
				onScrollToMessage={vi.fn()}
				onReorderPins={vi.fn()}
				pinCount={1}
				pinLimit={20}
			/>
		);

		// The pin card div should have draggable attribute
		const pinCard = screen.getByTitle('Click to scroll to message');
		expect(pinCard).toHaveAttribute('draggable');
	});
});
