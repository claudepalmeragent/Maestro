/**
 * @fileoverview Tests for SubagentListItem component
 *
 * SubagentListItem displays a single subagent in the session browser:
 * - Type icon (Explore, Plan, Task, Bash, etc.)
 * - Type label
 * - Preview text from first message
 * - Metadata (time, messages, cost)
 * - Optional resume button
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SubagentListItem } from '../../../renderer/components/SubagentListItem';
import type { SubagentInfo, Theme } from '../../../renderer/types';

// Mock theme matching the actual Theme interface
const mockTheme: Theme = {
	id: 'dracula',
	name: 'Dracula',
	mode: 'dark',
	colors: {
		bgMain: '#282a36',
		bgSidebar: '#21222c',
		bgActivity: '#343746',
		textMain: '#f8f8f2',
		textDim: '#6272a4',
		accent: '#bd93f9',
		accentDim: '#bd93f980',
		accentText: '#bd93f9',
		accentForeground: '#f8f8f2',
		border: '#44475a',
		success: '#50fa7b',
		warning: '#ffb86c',
		error: '#ff5555',
	},
};

const createMockSubagent = (overrides: Partial<SubagentInfo> = {}): SubagentInfo => ({
	agentId: 'test-agent-123',
	agentType: 'Explore',
	parentSessionId: 'parent-session-456',
	filePath: '/path/to/agent-test-agent-123.jsonl',
	timestamp: '2026-02-03T10:00:00.000Z',
	modifiedAt: '2026-02-03T10:05:00.000Z',
	messageCount: 15,
	sizeBytes: 5000,
	inputTokens: 1500,
	outputTokens: 500,
	cacheReadTokens: 100,
	cacheCreationTokens: 50,
	costUsd: 0.05,
	firstMessage: 'Search for authentication files in the codebase',
	durationSeconds: 120,
	...overrides,
});

describe('SubagentListItem', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Reset Date.now for consistent relative time tests
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-02-03T10:10:00.000Z'));
	});

	it('renders subagent information correctly', () => {
		const subagent = createMockSubagent();

		render(
			<SubagentListItem
				subagent={subagent}
				theme={mockTheme}
				isSelected={false}
				onClick={() => {}}
			/>
		);

		// Check type label is rendered (Explore:)
		expect(screen.getByText('Explore:')).toBeInTheDocument();

		// Check preview text
		expect(screen.getByText('Search for authentication files in the codebase')).toBeInTheDocument();

		// Check message count is displayed (formatNumber returns "15.0" for 15)
		expect(screen.getByText('15.0')).toBeInTheDocument();

		// Check cost is displayed (costUsd.toFixed(2) = "0.05")
		expect(screen.getByText('0.05')).toBeInTheDocument();
	});

	it('displays correct icon for different subagent types', () => {
		const types = ['Explore', 'Plan', 'general-purpose', 'Bash', 'unknown'];

		for (const agentType of types) {
			const subagent = createMockSubagent({ agentType });
			const { container, unmount } = render(
				<SubagentListItem
					subagent={subagent}
					theme={mockTheme}
					isSelected={false}
					onClick={() => {}}
				/>
			);

			// Verify an icon is rendered (SVG element with class 'subagent-type-icon')
			const icon = container.querySelector('.subagent-type-icon');
			expect(icon).toBeTruthy();

			unmount();
		}
	});

	it('displays correct label for different subagent types', () => {
		// Test mapping from agentType to display label
		const typeLabels: Record<string, string> = {
			Explore: 'Explore:',
			Plan: 'Plan:',
			'general-purpose': 'Task:',
			Bash: 'Bash:',
			'statusline-setup': 'Statusline:',
			'claude code guide': 'Guide:',
			unknown: 'Subagent:',
			'custom-type': 'custom-type:', // Fallback to agentType itself
		};

		for (const [agentType, expectedLabel] of Object.entries(typeLabels)) {
			const subagent = createMockSubagent({ agentType });
			const { unmount } = render(
				<SubagentListItem
					subagent={subagent}
					theme={mockTheme}
					isSelected={false}
					onClick={() => {}}
				/>
			);

			expect(screen.getByText(expectedLabel)).toBeInTheDocument();
			unmount();
		}
	});

	it('calls onClick when clicked', () => {
		const onClick = vi.fn();
		const subagent = createMockSubagent();

		render(
			<SubagentListItem
				subagent={subagent}
				theme={mockTheme}
				isSelected={false}
				onClick={onClick}
			/>
		);

		fireEvent.click(screen.getByRole('button'));
		expect(onClick).toHaveBeenCalledTimes(1);
	});

	it('calls onResume when resume button is clicked', () => {
		const onClick = vi.fn();
		const onResume = vi.fn();
		const subagent = createMockSubagent();

		render(
			<SubagentListItem
				subagent={subagent}
				theme={mockTheme}
				isSelected={false}
				onClick={onClick}
				onResume={onResume}
			/>
		);

		// Find and click the resume button (Play icon)
		const resumeButton = screen.getByTitle('Resume this subagent');
		fireEvent.click(resumeButton);

		expect(onResume).toHaveBeenCalledTimes(1);
		expect(onClick).not.toHaveBeenCalled(); // Should not trigger main onClick
	});

	it('applies selected styling when isSelected is true', () => {
		const subagent = createMockSubagent();

		const { container } = render(
			<SubagentListItem
				subagent={subagent}
				theme={mockTheme}
				isSelected={true}
				onClick={() => {}}
			/>
		);

		const button = container.querySelector('button');
		// When selected, borderLeft should include the accent color (may be hex or rgb format)
		// #bd93f9 = rgb(189, 147, 249)
		const borderLeft = button?.style.borderLeft || '';
		expect(
			borderLeft.includes(mockTheme.colors.accent) || borderLeft.includes('rgb(189, 147, 249)')
		).toBe(true);
	});

	it('does not apply selected styling when isSelected is false', () => {
		const subagent = createMockSubagent();

		const { container } = render(
			<SubagentListItem
				subagent={subagent}
				theme={mockTheme}
				isSelected={false}
				onClick={() => {}}
			/>
		);

		const button = container.querySelector('button');
		// When not selected, borderLeft should be transparent
		expect(button?.style.borderLeft).toContain('transparent');
	});

	it('shows "(No preview)" when firstMessage is empty', () => {
		const subagent = createMockSubagent({ firstMessage: '' });

		render(
			<SubagentListItem
				subagent={subagent}
				theme={mockTheme}
				isSelected={false}
				onClick={() => {}}
			/>
		);

		expect(screen.getByText('(No preview)')).toBeInTheDocument();
	});

	it('shows "(No preview)" when firstMessage is undefined', () => {
		const subagent = createMockSubagent({ firstMessage: undefined as unknown as string });

		render(
			<SubagentListItem
				subagent={subagent}
				theme={mockTheme}
				isSelected={false}
				onClick={() => {}}
			/>
		);

		expect(screen.getByText('(No preview)')).toBeInTheDocument();
	});

	it('formats relative time correctly', () => {
		// modifiedAt is 5 minutes ago (2026-02-03T10:05:00 vs current time 2026-02-03T10:10:00)
		const subagent = createMockSubagent({ modifiedAt: '2026-02-03T10:05:00.000Z' });

		render(
			<SubagentListItem
				subagent={subagent}
				theme={mockTheme}
				isSelected={false}
				onClick={() => {}}
			/>
		);

		// Should show "5m ago" based on formatRelativeTime
		expect(screen.getByText('5m ago')).toBeInTheDocument();
	});

	it('formats relative time for just now', () => {
		// modifiedAt is very recent (same time as current)
		const subagent = createMockSubagent({ modifiedAt: '2026-02-03T10:10:00.000Z' });

		render(
			<SubagentListItem
				subagent={subagent}
				theme={mockTheme}
				isSelected={false}
				onClick={() => {}}
			/>
		);

		// Should show "just now" based on formatRelativeTime
		expect(screen.getByText('just now')).toBeInTheDocument();
	});

	it('formats relative time for hours ago', () => {
		// modifiedAt is 2 hours ago
		const subagent = createMockSubagent({ modifiedAt: '2026-02-03T08:10:00.000Z' });

		render(
			<SubagentListItem
				subagent={subagent}
				theme={mockTheme}
				isSelected={false}
				onClick={() => {}}
			/>
		);

		// Should show "2h ago" based on formatRelativeTime
		expect(screen.getByText('2h ago')).toBeInTheDocument();
	});

	it('does not render resume button when onResume is not provided', () => {
		const subagent = createMockSubagent();

		render(
			<SubagentListItem
				subagent={subagent}
				theme={mockTheme}
				isSelected={false}
				onClick={() => {}}
				// No onResume prop
			/>
		);

		// Resume button should not be present
		expect(screen.queryByTitle('Resume this subagent')).not.toBeInTheDocument();
	});

	it('renders resume button when onResume is provided', () => {
		const subagent = createMockSubagent();

		render(
			<SubagentListItem
				subagent={subagent}
				theme={mockTheme}
				isSelected={false}
				onClick={() => {}}
				onResume={() => {}}
			/>
		);

		// Resume button should be present
		expect(screen.getByTitle('Resume this subagent')).toBeInTheDocument();
	});

	it('formats large message counts correctly', () => {
		// formatNumber for 1500 returns "1.5k"
		const subagent = createMockSubagent({ messageCount: 1500 });

		render(
			<SubagentListItem
				subagent={subagent}
				theme={mockTheme}
				isSelected={false}
				onClick={() => {}}
			/>
		);

		expect(screen.getByText('1.5k')).toBeInTheDocument();
	});

	it('formats cost with two decimal places', () => {
		const subagent = createMockSubagent({ costUsd: 1.5 });

		render(
			<SubagentListItem
				subagent={subagent}
				theme={mockTheme}
				isSelected={false}
				onClick={() => {}}
			/>
		);

		// costUsd.toFixed(2) = "1.50"
		expect(screen.getByText('1.50')).toBeInTheDocument();
	});

	it('stops event propagation when clicking resume button', () => {
		const onClick = vi.fn();
		const onResume = vi.fn();
		const subagent = createMockSubagent();

		render(
			<SubagentListItem
				subagent={subagent}
				theme={mockTheme}
				isSelected={false}
				onClick={onClick}
				onResume={onResume}
			/>
		);

		const resumeButton = screen.getByTitle('Resume this subagent');
		fireEvent.click(resumeButton);

		// Only onResume should be called, not onClick
		expect(onResume).toHaveBeenCalledTimes(1);
		expect(onClick).not.toHaveBeenCalled();
	});

	it('applies hover effect on mouse enter', () => {
		const subagent = createMockSubagent();

		const { container } = render(
			<SubagentListItem
				subagent={subagent}
				theme={mockTheme}
				isSelected={false}
				onClick={() => {}}
			/>
		);

		const button = container.querySelector('button')!;

		// Initial background should be transparent
		expect(button.style.background).toBe('transparent');

		// Trigger mouse enter
		fireEvent.mouseEnter(button);

		// Background should change to hover effect
		expect(button.style.background).not.toBe('transparent');

		// Trigger mouse leave
		fireEvent.mouseLeave(button);

		// Background should return to transparent
		expect(button.style.background).toBe('transparent');
	});

	it('does not apply hover effect when already selected', () => {
		const subagent = createMockSubagent();

		const { container } = render(
			<SubagentListItem
				subagent={subagent}
				theme={mockTheme}
				isSelected={true}
				onClick={() => {}}
			/>
		);

		const button = container.querySelector('button')!;
		const initialBackground = button.style.background;

		// Trigger mouse enter
		fireEvent.mouseEnter(button);

		// Background should not change from selected state
		// (it stays the same because of isSelected check in handlers)
		expect(button.style.background).toBe(initialBackground);
	});
});
