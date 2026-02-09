/**
 * Tests for AgentCostGraph component
 *
 * Verifies:
 * - Renders vertical bar chart correctly
 * - X-axis shows agent names (truncated and rotated)
 * - Y-axis shows cost labels in USD
 * - DataSourceToggle switches between Local and Anthropic data
 * - Tooltip shows exact values on hover
 * - Shows savings when in Local mode
 * - Handles empty data gracefully
 * - Applies theme colors correctly
 * - Bars are sorted by cost (descending)
 * - Shows top 10 agents only
 * - Billing mode colors: green=Max, blue=API, gray=Free
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import {
	AgentCostGraph,
	type AgentCostData,
	type BillingMode,
} from '../../../../renderer/components/UsageDashboard/AgentCostGraph';
import { THEMES } from '../../../../shared/themes';

// Test theme
const theme = THEMES['dracula'];

// Sample data for testing
const mockData: AgentCostData[] = [
	{
		agentId: 'agent-1',
		agentName: 'MyProject',
		localCost: 5.25,
		anthropicCost: 6.5,
		savings: 1.25,
		billingMode: 'max',
	},
	{
		agentId: 'agent-2',
		agentName: 'Backend API',
		localCost: 3.3,
		anthropicCost: 4.0,
		savings: 0.7,
		billingMode: 'api',
	},
	{
		agentId: 'agent-3',
		agentName: 'Testing Suite',
		localCost: 0.75,
		anthropicCost: 0.9,
		savings: 0.15,
		billingMode: 'free',
	},
];

// Empty data for edge case testing
const emptyData: AgentCostData[] = [];

// Single agent data
const singleAgentData: AgentCostData[] = [
	{
		agentId: 'agent-1',
		agentName: 'MyProject',
		localCost: 5.25,
		anthropicCost: 6.5,
		savings: 1.25,
		billingMode: 'max',
	},
];

// Data with no savings (API mode user)
const noSavingsData: AgentCostData[] = [
	{
		agentId: 'agent-1',
		agentName: 'MyProject',
		localCost: 6.5,
		anthropicCost: 6.5,
		savings: 0,
		billingMode: 'api',
	},
	{
		agentId: 'agent-2',
		agentName: 'Backend API',
		localCost: 4.0,
		anthropicCost: 4.0,
		savings: 0,
		billingMode: 'api',
	},
];

// Data with zero costs
const zeroCostData: AgentCostData[] = [
	{
		agentId: 'agent-1',
		agentName: 'MyProject',
		localCost: 0,
		anthropicCost: 0,
		savings: 0,
		billingMode: 'free',
	},
	{
		agentId: 'agent-2',
		agentName: 'Backend API',
		localCost: 0,
		anthropicCost: 0,
		savings: 0,
		billingMode: 'free',
	},
];

// Data with many agents (for top 10 testing)
const manyAgentsData: AgentCostData[] = Array.from({ length: 15 }, (_, i) => ({
	agentId: `agent-${i + 1}`,
	agentName: `Agent ${i + 1}`,
	localCost: (15 - i) * 0.5, // Descending costs
	anthropicCost: (15 - i) * 0.6,
	savings: (15 - i) * 0.1,
	billingMode: (['max', 'api', 'free'] as BillingMode[])[i % 3],
}));

// Data with long agent names
const longNameData: AgentCostData[] = [
	{
		agentId: 'agent-1',
		agentName: 'VeryLongProjectNameThatShouldBeTruncated',
		localCost: 5.25,
		anthropicCost: 6.5,
		savings: 1.25,
		billingMode: 'max',
	},
];

describe('AgentCostGraph', () => {
	describe('Rendering', () => {
		it('renders the component with default title', () => {
			render(<AgentCostGraph data={mockData} timeRange="week" theme={theme} />);

			expect(screen.getByText('Cost by Agent')).toBeInTheDocument();
		});

		it('renders with custom title', () => {
			render(<AgentCostGraph data={mockData} timeRange="week" theme={theme} title="Agent Costs" />);

			expect(screen.getByText('Agent Costs')).toBeInTheDocument();
		});

		it('renders DataSourceToggle', () => {
			render(<AgentCostGraph data={mockData} timeRange="week" theme={theme} />);

			expect(screen.getByTestId('data-source-toggle-local')).toBeInTheDocument();
			expect(screen.getByTestId('data-source-toggle-anthropic')).toBeInTheDocument();
		});

		it('renders SVG chart element', () => {
			const { container } = render(
				<AgentCostGraph data={mockData} timeRange="week" theme={theme} />
			);

			const svg = container.querySelector('svg');
			expect(svg).toBeInTheDocument();
		});

		it('renders bars as rect elements', () => {
			const { container } = render(
				<AgentCostGraph data={mockData} timeRange="week" theme={theme} />
			);

			const rects = container.querySelectorAll('rect[role="graphics-symbol"]');
			expect(rects.length).toBe(mockData.length);
		});

		it('renders Y-axis label', () => {
			render(<AgentCostGraph data={mockData} timeRange="week" theme={theme} />);

			expect(screen.getByText('Cost (USD)')).toBeInTheDocument();
		});

		it('renders billing mode legend', () => {
			render(<AgentCostGraph data={mockData} timeRange="week" theme={theme} />);

			expect(screen.getByText('Max')).toBeInTheDocument();
			expect(screen.getByText('API')).toBeInTheDocument();
			expect(screen.getByText('Free')).toBeInTheDocument();
		});
	});

	describe('Total Cost Display', () => {
		it('displays total cost', () => {
			render(<AgentCostGraph data={mockData} timeRange="week" theme={theme} />);

			// Total of local costs: 5.25 + 3.30 + 0.75 = 9.30
			expect(screen.getByText(/Total:/)).toBeInTheDocument();
			expect(screen.getByText(/\$9\.30/)).toBeInTheDocument();
		});

		it('displays savings in Local mode', () => {
			render(<AgentCostGraph data={mockData} timeRange="week" theme={theme} />);

			// Total savings: 1.25 + 0.70 + 0.15 = 2.10
			expect(screen.getByText(/Saved \$2\.10/)).toBeInTheDocument();
		});

		it('does not display savings when switching to Anthropic mode', () => {
			render(<AgentCostGraph data={mockData} timeRange="week" theme={theme} />);

			const anthropicButton = screen.getByTestId('data-source-toggle-anthropic');
			fireEvent.click(anthropicButton);

			expect(screen.queryByText(/Saved/)).not.toBeInTheDocument();
		});
	});

	describe('Empty State', () => {
		it('renders empty state message when no data', () => {
			render(<AgentCostGraph data={emptyData} timeRange="week" theme={theme} />);

			expect(screen.getByText('No agent cost data available')).toBeInTheDocument();
		});

		it('does not render SVG when no data', () => {
			const { container } = render(
				<AgentCostGraph data={emptyData} timeRange="week" theme={theme} />
			);

			const svg = container.querySelector('svg');
			expect(svg).not.toBeInTheDocument();
		});
	});

	describe('DataSource Toggle', () => {
		it('defaults to Local data source', () => {
			render(<AgentCostGraph data={mockData} timeRange="week" theme={theme} />);

			const localButton = screen.getByTestId('data-source-toggle-local');
			expect(localButton).toHaveAttribute('aria-pressed', 'true');

			const anthropicButton = screen.getByTestId('data-source-toggle-anthropic');
			expect(anthropicButton).toHaveAttribute('aria-pressed', 'false');
		});

		it('switches to Anthropic data when clicked', () => {
			render(<AgentCostGraph data={mockData} timeRange="week" theme={theme} />);

			const anthropicButton = screen.getByTestId('data-source-toggle-anthropic');
			fireEvent.click(anthropicButton);

			expect(anthropicButton).toHaveAttribute('aria-pressed', 'true');
		});

		it('updates total when switching data source', () => {
			render(<AgentCostGraph data={mockData} timeRange="week" theme={theme} />);

			// Initially shows local total: $9.30
			expect(screen.getByText(/\$9\.30/)).toBeInTheDocument();

			const anthropicButton = screen.getByTestId('data-source-toggle-anthropic');
			fireEvent.click(anthropicButton);

			// Should now show anthropic total: 6.50 + 4.00 + 0.90 = 11.40
			expect(screen.getByText(/\$11\.40/)).toBeInTheDocument();
		});
	});

	describe('Bar Sorting', () => {
		it('sorts bars by cost in descending order', () => {
			const { container } = render(
				<AgentCostGraph data={mockData} timeRange="week" theme={theme} />
			);

			// Get all bar aria-labels
			const bars = container.querySelectorAll('rect[role="graphics-symbol"]');
			const labels = Array.from(bars).map((bar) => bar.getAttribute('aria-label'));

			// First bar should be MyProject (highest cost: 5.25)
			expect(labels[0]).toContain('MyProject');
			// Last bar should be Testing Suite (lowest cost: 0.75)
			expect(labels[labels.length - 1]).toContain('Testing Suite');
		});
	});

	describe('Top N Agents', () => {
		it('shows only top 10 agents when more data is provided', () => {
			const { container } = render(
				<AgentCostGraph data={manyAgentsData} timeRange="week" theme={theme} />
			);

			const bars = container.querySelectorAll('rect[role="graphics-symbol"]');
			expect(bars.length).toBe(10);
		});

		it('shows indicator when there are more than 10 agents', () => {
			render(<AgentCostGraph data={manyAgentsData} timeRange="week" theme={theme} />);

			expect(screen.getByText('Showing top 10 of 15 agents')).toBeInTheDocument();
		});

		it('does not show indicator when 10 or fewer agents', () => {
			render(<AgentCostGraph data={mockData} timeRange="week" theme={theme} />);

			expect(screen.queryByText(/Showing top/)).not.toBeInTheDocument();
		});
	});

	describe('Time Range Handling', () => {
		it('renders for day time range', () => {
			render(<AgentCostGraph data={mockData} timeRange="day" theme={theme} />);

			expect(screen.getByText('Cost by Agent')).toBeInTheDocument();
		});

		it('renders for week time range', () => {
			render(<AgentCostGraph data={mockData} timeRange="week" theme={theme} />);

			expect(screen.getByText('Cost by Agent')).toBeInTheDocument();
		});

		it('renders for month time range', () => {
			render(<AgentCostGraph data={mockData} timeRange="month" theme={theme} />);

			expect(screen.getByText('Cost by Agent')).toBeInTheDocument();
		});

		it('renders for year time range', () => {
			render(<AgentCostGraph data={mockData} timeRange="year" theme={theme} />);

			expect(screen.getByText('Cost by Agent')).toBeInTheDocument();
		});

		it('renders for all time range', () => {
			render(<AgentCostGraph data={mockData} timeRange="all" theme={theme} />);

			expect(screen.getByText('Cost by Agent')).toBeInTheDocument();
		});
	});

	describe('Theme Support', () => {
		it('applies theme background color', () => {
			const { container } = render(
				<AgentCostGraph data={mockData} timeRange="week" theme={theme} />
			);

			const wrapper = container.firstChild as HTMLElement;
			expect(wrapper).toHaveStyle({
				backgroundColor: theme.colors.bgMain,
			});
		});

		it('applies theme text colors', () => {
			render(<AgentCostGraph data={mockData} timeRange="week" theme={theme} />);

			const title = screen.getByText('Cost by Agent');
			expect(title).toHaveStyle({
				color: theme.colors.textMain,
			});
		});

		it('works with light theme', () => {
			const lightTheme = THEMES['github-light'];

			render(<AgentCostGraph data={mockData} timeRange="week" theme={lightTheme} />);

			expect(screen.getByText('Cost by Agent')).toBeInTheDocument();
		});
	});

	describe('Tooltip Functionality', () => {
		it('shows tooltip on bar hover', () => {
			const { container } = render(
				<AgentCostGraph data={mockData} timeRange="week" theme={theme} />
			);

			const bars = container.querySelectorAll('rect[role="graphics-symbol"]');

			if (bars.length > 0) {
				fireEvent.mouseEnter(bars[0]);

				// Tooltip should appear in the document body (via portal)
				const tooltips = document.querySelectorAll('.fixed.z-\\[10000\\]');
				expect(tooltips.length).toBeGreaterThan(0);
			}
		});

		it('hides tooltip on mouse leave', () => {
			const { container } = render(
				<AgentCostGraph data={mockData} timeRange="week" theme={theme} />
			);

			const bars = container.querySelectorAll('rect[role="graphics-symbol"]');

			if (bars.length > 0) {
				fireEvent.mouseEnter(bars[0]);
				fireEvent.mouseLeave(bars[0]);

				const tooltips = document.querySelectorAll('.fixed.z-\\[10000\\]');
				expect(tooltips.length).toBe(0);
			}
		});

		it('tooltip shows cost value', () => {
			const { container } = render(
				<AgentCostGraph data={mockData} timeRange="week" theme={theme} />
			);

			const bars = container.querySelectorAll('rect[role="graphics-symbol"]');

			if (bars.length > 0) {
				fireEvent.mouseEnter(bars[0]);

				expect(screen.getByText('Cost:')).toBeInTheDocument();
			}
		});

		it('tooltip shows billing mode', () => {
			const { container } = render(
				<AgentCostGraph data={mockData} timeRange="week" theme={theme} />
			);

			const bars = container.querySelectorAll('rect[role="graphics-symbol"]');

			if (bars.length > 0) {
				fireEvent.mouseEnter(bars[0]);

				expect(screen.getByText('Mode:')).toBeInTheDocument();
			}
		});

		it('tooltip shows savings when in Local mode and savings exist', () => {
			const { container } = render(
				<AgentCostGraph data={mockData} timeRange="week" theme={theme} />
			);

			const bars = container.querySelectorAll('rect[role="graphics-symbol"]');

			if (bars.length > 0) {
				fireEvent.mouseEnter(bars[0]);

				expect(screen.getByText('Saved:')).toBeInTheDocument();
			}
		});

		it('tooltip does not show savings when in Anthropic mode', () => {
			const { container } = render(
				<AgentCostGraph data={mockData} timeRange="week" theme={theme} />
			);

			// Switch to Anthropic mode
			const anthropicButton = screen.getByTestId('data-source-toggle-anthropic');
			fireEvent.click(anthropicButton);

			const bars = container.querySelectorAll('rect[role="graphics-symbol"]');

			if (bars.length > 0) {
				fireEvent.mouseEnter(bars[0]);

				expect(screen.queryByText('Saved:')).not.toBeInTheDocument();
			}
		});

		it('tooltip does not show savings when no savings', () => {
			const { container } = render(
				<AgentCostGraph data={noSavingsData} timeRange="week" theme={theme} />
			);

			const bars = container.querySelectorAll('rect[role="graphics-symbol"]');

			if (bars.length > 0) {
				fireEvent.mouseEnter(bars[0]);

				expect(screen.queryByText('Saved:')).not.toBeInTheDocument();
			}
		});
	});

	describe('Edge Cases', () => {
		it('handles single agent', () => {
			const { container } = render(
				<AgentCostGraph data={singleAgentData} timeRange="week" theme={theme} />
			);

			const bars = container.querySelectorAll('rect[role="graphics-symbol"]');
			expect(bars.length).toBe(1);
		});

		it('handles zero cost agents gracefully', () => {
			const { container } = render(
				<AgentCostGraph data={zeroCostData} timeRange="week" theme={theme} />
			);

			// Should render without errors
			expect(screen.getByText('Cost by Agent')).toBeInTheDocument();

			// Should have 2 bars even with zero costs
			const bars = container.querySelectorAll('rect[role="graphics-symbol"]');
			expect(bars.length).toBe(2);
		});
	});

	describe('Agent Name Truncation', () => {
		it('truncates long agent names', () => {
			const { container } = render(
				<AgentCostGraph data={longNameData} timeRange="week" theme={theme} />
			);

			// Should not show the full name
			expect(
				screen.queryByText('VeryLongProjectNameThatShouldBeTruncated')
			).not.toBeInTheDocument();

			// But should show truncated version (in the SVG text)
			const textElements = container.querySelectorAll('svg text');
			const hasEllipsis = Array.from(textElements).some((el) => el.textContent?.includes('…'));
			expect(hasEllipsis).toBe(true);
		});

		it('tooltip shows full agent name', () => {
			const { container } = render(
				<AgentCostGraph data={longNameData} timeRange="week" theme={theme} />
			);

			const bars = container.querySelectorAll('rect[role="graphics-symbol"]');

			if (bars.length > 0) {
				fireEvent.mouseEnter(bars[0]);

				// Tooltip should show full name
				expect(screen.getByText('VeryLongProjectNameThatShouldBeTruncated')).toBeInTheDocument();
			}
		});
	});

	describe('Billing Mode Colors', () => {
		it('applies green color for Max billing mode', () => {
			const { container } = render(
				<AgentCostGraph data={singleAgentData} timeRange="week" theme={theme} />
			);

			const bars = container.querySelectorAll('rect[role="graphics-symbol"]');
			expect(bars[0]).toHaveAttribute('fill', '#10b981');
		});

		it('applies blue color for API billing mode', () => {
			const apiData: AgentCostData[] = [
				{
					agentId: 'agent-1',
					agentName: 'MyProject',
					localCost: 5.25,
					anthropicCost: 6.5,
					savings: 0,
					billingMode: 'api',
				},
			];

			const { container } = render(
				<AgentCostGraph data={apiData} timeRange="week" theme={theme} />
			);

			const bars = container.querySelectorAll('rect[role="graphics-symbol"]');
			expect(bars[0]).toHaveAttribute('fill', '#3b82f6');
		});

		it('applies gray color for Free billing mode', () => {
			const freeData: AgentCostData[] = [
				{
					agentId: 'agent-1',
					agentName: 'MyProject',
					localCost: 0,
					anthropicCost: 0,
					savings: 0,
					billingMode: 'free',
				},
			];

			const { container } = render(
				<AgentCostGraph data={freeData} timeRange="week" theme={theme} />
			);

			const bars = container.querySelectorAll('rect[role="graphics-symbol"]');
			expect(bars[0]).toHaveAttribute('fill', '#9ca3af');
		});
	});

	describe('Grid and Axes', () => {
		it('renders horizontal grid lines', () => {
			const { container } = render(
				<AgentCostGraph data={mockData} timeRange="week" theme={theme} />
			);

			const gridLines = container.querySelectorAll('line');
			expect(gridLines.length).toBeGreaterThan(0);
		});

		it('renders Y-axis tick labels with dollar sign', () => {
			const { container } = render(
				<AgentCostGraph data={mockData} timeRange="week" theme={theme} />
			);

			// Y-axis should have currency labels ($0.00, etc.)
			const textElements = container.querySelectorAll('svg text');
			const hasCurrencyLabel = Array.from(textElements).some((el) =>
				el.textContent?.match(/^\$\d+\.\d{2}$/)
			);
			expect(hasCurrencyLabel).toBe(true);
		});
	});

	describe('Smooth Animations', () => {
		it('applies CSS transitions to bars for smooth updates', () => {
			const { container } = render(
				<AgentCostGraph data={mockData} timeRange="week" theme={theme} />
			);

			const bars = container.querySelectorAll('rect[role="graphics-symbol"]');
			expect(bars.length).toBeGreaterThan(0);

			const style = (bars[0] as unknown as HTMLElement).style;
			expect(style.transition).toContain('height');
			expect(style.transition).toContain('0.5s');
		});

		it('uses cubic-bezier easing for smooth animation curves', () => {
			const { container } = render(
				<AgentCostGraph data={mockData} timeRange="week" theme={theme} />
			);

			const bars = container.querySelectorAll('rect[role="graphics-symbol"]');

			const style = (bars[0] as unknown as HTMLElement).style;
			expect(style.transition).toContain('cubic-bezier');
		});
	});

	describe('Accessibility', () => {
		it('has proper role for chart container', () => {
			const { container } = render(
				<AgentCostGraph data={mockData} timeRange="week" theme={theme} />
			);

			const figure = container.querySelector('[role="figure"]');
			expect(figure).toBeInTheDocument();
		});

		it('has proper aria-label for chart container', () => {
			const { container } = render(
				<AgentCostGraph data={mockData} timeRange="week" theme={theme} />
			);

			const figure = container.querySelector('[role="figure"]');
			expect(figure).toHaveAttribute('aria-label');
			expect(figure?.getAttribute('aria-label')).toContain('Cost by agent chart');
		});

		it('bars have aria labels', () => {
			const { container } = render(
				<AgentCostGraph data={mockData} timeRange="week" theme={theme} />
			);

			const bars = container.querySelectorAll('rect[role="graphics-symbol"]');

			if (bars.length > 0) {
				expect(bars[0]).toHaveAttribute('aria-label');
				expect(bars[0].getAttribute('aria-label')).toContain('Cost');
				expect(bars[0].getAttribute('aria-label')).toContain('Mode');
			}
		});

		it('bars are focusable', () => {
			const { container } = render(
				<AgentCostGraph data={mockData} timeRange="week" theme={theme} />
			);

			const bars = container.querySelectorAll('rect[role="graphics-symbol"]');

			if (bars.length > 0) {
				// SVG elements use lowercase tabindex
				expect(bars[0]).toHaveAttribute('tabindex', '0');
			}
		});
	});
});
