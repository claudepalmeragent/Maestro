import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PinnedPanel } from '../../../renderer/components/PinnedPanel';
import type { PinnedItem, Theme } from '../../../renderer/types';

// Mock lucide-react icons (must include Search for the new feature)
vi.mock('lucide-react', () => ({
	Pin: ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
		<span data-testid="pin-icon" className={className} style={style}>
			📌
		</span>
	),
	X: ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
		<span data-testid="x-icon" className={className} style={style}>
			×
		</span>
	),
	User: ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
		<span data-testid="user-icon" className={className} style={style}>
			👤
		</span>
	),
	Bot: ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
		<span data-testid="bot-icon" className={className} style={style}>
			🤖
		</span>
	),
	Search: ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
		<span data-testid="search-icon" className={className} style={style}>
			🔍
		</span>
	),
}));

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

const testPins: PinnedItem[] = [
	{
		logId: '1',
		tabId: 't',
		text: 'Fix the authentication bug',
		source: 'user',
		messageTimestamp: 100,
		pinnedAt: 100,
	},
	{
		logId: '2',
		tabId: 't',
		text: 'The error is in the login handler',
		source: 'ai',
		messageTimestamp: 200,
		pinnedAt: 200,
	},
	{
		logId: '3',
		tabId: 't',
		text: 'Deploy to production',
		source: 'user',
		messageTimestamp: 300,
		pinnedAt: 300,
	},
];

describe('PinnedPanel search/filter', () => {
	it('shows search input when pins exist', () => {
		render(
			<PinnedPanel
				theme={mockTheme}
				pinnedItems={testPins}
				onUnpinMessage={vi.fn()}
				onScrollToMessage={vi.fn()}
				pinCount={3}
				pinLimit={20}
			/>
		);
		expect(screen.getByPlaceholderText('Search pins...')).toBeInTheDocument();
	});

	it('does not show search input when no pins', () => {
		render(
			<PinnedPanel
				theme={mockTheme}
				pinnedItems={[]}
				onUnpinMessage={vi.fn()}
				onScrollToMessage={vi.fn()}
				pinCount={0}
				pinLimit={20}
			/>
		);
		expect(screen.queryByPlaceholderText('Search pins...')).not.toBeInTheDocument();
	});

	it('filters pins by search query', () => {
		render(
			<PinnedPanel
				theme={mockTheme}
				pinnedItems={testPins}
				onUnpinMessage={vi.fn()}
				onScrollToMessage={vi.fn()}
				pinCount={3}
				pinLimit={20}
			/>
		);
		const input = screen.getByPlaceholderText('Search pins...');
		fireEvent.change(input, { target: { value: 'authentication' } });

		expect(screen.getByText(/Fix the authentication bug/)).toBeInTheDocument();
		expect(screen.queryByText(/Deploy to production/)).not.toBeInTheDocument();
	});

	it('shows no-results state when search matches nothing', () => {
		render(
			<PinnedPanel
				theme={mockTheme}
				pinnedItems={testPins}
				onUnpinMessage={vi.fn()}
				onScrollToMessage={vi.fn()}
				pinCount={3}
				pinLimit={20}
			/>
		);
		const input = screen.getByPlaceholderText('Search pins...');
		fireEvent.change(input, { target: { value: 'zzzznonexistent' } });

		expect(screen.getByText(/No pins match/)).toBeInTheDocument();
		expect(screen.getByText('Clear search')).toBeInTheDocument();
	});

	it('displays stable index numbers on pins', () => {
		render(
			<PinnedPanel
				theme={mockTheme}
				pinnedItems={testPins}
				onUnpinMessage={vi.fn()}
				onScrollToMessage={vi.fn()}
				pinCount={3}
				pinLimit={20}
			/>
		);
		expect(screen.getByText('#1')).toBeInTheDocument();
		expect(screen.getByText('#2')).toBeInTheDocument();
		expect(screen.getByText('#3')).toBeInTheDocument();
	});
});
