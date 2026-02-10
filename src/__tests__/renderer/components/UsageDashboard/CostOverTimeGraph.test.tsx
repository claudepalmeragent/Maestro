/**
 * Tests for CostOverTimeGraph component
 *
 * Verifies:
 * - Renders line chart correctly
 * - X-axis shows date labels
 * - Y-axis shows cost labels in USD
 * - DataSourceToggle switches between Local and Anthropic data
 * - Tooltip shows exact values on hover
 * - Shows savings when in Local mode
 * - Handles empty data gracefully
 * - Applies theme colors correctly
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import {
	CostOverTimeGraph,
	type DailyCostData,
} from '../../../../renderer/components/UsageDashboard/CostOverTimeGraph';
import { THEMES } from '../../../../shared/themes';

// Test theme
const theme = THEMES['dracula'];

// Sample data for testing
const mockData: DailyCostData[] = [
	{ date: '2024-12-20', localCost: 1.25, anthropicCost: 1.5, savings: 0.25 },
	{ date: '2024-12-21', localCost: 2.3, anthropicCost: 2.8, savings: 0.5 },
	{ date: '2024-12-22', localCost: 0.75, anthropicCost: 0.9, savings: 0.15 },
	{ date: '2024-12-23', localCost: 1.8, anthropicCost: 2.2, savings: 0.4 },
	{ date: '2024-12-24', localCost: 3.0, anthropicCost: 3.6, savings: 0.6 },
	{ date: '2024-12-25', localCost: 0.5, anthropicCost: 0.6, savings: 0.1 },
	{ date: '2024-12-26', localCost: 1.4, anthropicCost: 1.7, savings: 0.3 },
];

// Empty data for edge case testing
const emptyData: DailyCostData[] = [];

// Single data point
const singlePointData: DailyCostData[] = [
	{ date: '2024-12-27', localCost: 2.5, anthropicCost: 3.0, savings: 0.5 },
];

// Data with no savings (API mode user)
const noSavingsData: DailyCostData[] = [
	{ date: '2024-12-20', localCost: 1.5, anthropicCost: 1.5, savings: 0 },
	{ date: '2024-12-21', localCost: 2.8, anthropicCost: 2.8, savings: 0 },
	{ date: '2024-12-22', localCost: 0.9, anthropicCost: 0.9, savings: 0 },
];

// Data with zero costs
const zeroCostData: DailyCostData[] = [
	{ date: '2024-12-20', localCost: 0, anthropicCost: 0, savings: 0 },
	{ date: '2024-12-21', localCost: 0, anthropicCost: 0, savings: 0 },
	{ date: '2024-12-22', localCost: 0, anthropicCost: 0, savings: 0 },
];

describe('CostOverTimeGraph', () => {
	describe('Rendering', () => {
		it('renders the component with default title', () => {
			render(<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />);

			expect(screen.getByText('Cost Over Time')).toBeInTheDocument();
		});

		it('renders with custom title', () => {
			render(
				<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} title="Agent Costs" />
			);

			expect(screen.getByText('Agent Costs')).toBeInTheDocument();
		});

		it('renders DataSourceToggle', () => {
			render(<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />);

			expect(screen.getByTestId('data-source-toggle-local')).toBeInTheDocument();
			expect(screen.getByTestId('data-source-toggle-anthropic')).toBeInTheDocument();
		});

		it('renders SVG chart element', () => {
			const { container } = render(
				<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />
			);

			const svg = container.querySelector('svg');
			expect(svg).toBeInTheDocument();
		});

		it('renders data points as circles', () => {
			const { container } = render(
				<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />
			);

			const circles = container.querySelectorAll('circle');
			expect(circles.length).toBe(mockData.length);
		});

		it('renders line path', () => {
			const { container } = render(
				<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />
			);

			const paths = container.querySelectorAll('path');
			// Should have area path and line path
			expect(paths.length).toBeGreaterThanOrEqual(2);
		});

		it('renders Y-axis label', () => {
			render(<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />);

			expect(screen.getByText('Cost (USD)')).toBeInTheDocument();
		});

		it('renders legend', () => {
			render(<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />);

			expect(screen.getByText('Local Cost')).toBeInTheDocument();
		});
	});

	describe('Total Cost Display', () => {
		it('displays total cost', () => {
			render(<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />);

			// Total of local costs: 1.25 + 2.30 + 0.75 + 1.80 + 3.00 + 0.50 + 1.40 = 11.00
			expect(screen.getByText(/Total:/)).toBeInTheDocument();
			expect(screen.getByText(/\$11\.00/)).toBeInTheDocument();
		});

		it('displays savings when in Local mode', () => {
			render(<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />);

			// Total savings: 0.25 + 0.50 + 0.15 + 0.40 + 0.60 + 0.10 + 0.30 = 2.30
			expect(screen.getByText(/Saved \$2\.30/)).toBeInTheDocument();
		});

		it('does not display savings when no savings', () => {
			render(<CostOverTimeGraph data={noSavingsData} timeRange="week" theme={theme} />);

			expect(screen.queryByText(/Saved/)).not.toBeInTheDocument();
		});
	});

	describe('Empty State', () => {
		it('renders empty state message when no data', () => {
			render(<CostOverTimeGraph data={emptyData} timeRange="week" theme={theme} />);

			expect(screen.getByText('No cost data available')).toBeInTheDocument();
		});

		it('does not render SVG when no data', () => {
			const { container } = render(
				<CostOverTimeGraph data={emptyData} timeRange="week" theme={theme} />
			);

			const svg = container.querySelector('svg');
			expect(svg).not.toBeInTheDocument();
		});
	});

	describe('DataSource Toggle', () => {
		it('defaults to Local data source', () => {
			render(<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />);

			const localButton = screen.getByTestId('data-source-toggle-local');
			expect(localButton).toHaveAttribute('aria-pressed', 'true');

			const anthropicButton = screen.getByTestId('data-source-toggle-anthropic');
			expect(anthropicButton).toHaveAttribute('aria-pressed', 'false');
		});

		it('switches to Anthropic data when clicked', () => {
			render(<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />);

			const anthropicButton = screen.getByTestId('data-source-toggle-anthropic');
			fireEvent.click(anthropicButton);

			expect(anthropicButton).toHaveAttribute('aria-pressed', 'true');

			// Legend should now show "Anthropic Cost"
			expect(screen.getByText('Anthropic Cost')).toBeInTheDocument();
		});

		it('does not show savings when in Anthropic mode', () => {
			render(<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />);

			const anthropicButton = screen.getByTestId('data-source-toggle-anthropic');
			fireEvent.click(anthropicButton);

			// Should not show savings text in total area
			const totalArea = screen.getByText(/Total:/);
			expect(totalArea.parentElement?.textContent).not.toContain('Saved');
		});

		it('updates total when switching data source', () => {
			render(<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />);

			// Initially shows local total: $11.00
			expect(screen.getByText(/\$11\.00/)).toBeInTheDocument();

			const anthropicButton = screen.getByTestId('data-source-toggle-anthropic');
			fireEvent.click(anthropicButton);

			// Should now show anthropic total: 1.50 + 2.80 + 0.90 + 2.20 + 3.60 + 0.60 + 1.70 = 13.30
			expect(screen.getByText(/\$13\.30/)).toBeInTheDocument();
		});
	});

	describe('Time Range Handling', () => {
		it('renders for day time range', () => {
			render(<CostOverTimeGraph data={mockData} timeRange="day" theme={theme} />);

			expect(screen.getByText('Cost Over Time')).toBeInTheDocument();
		});

		it('renders for week time range', () => {
			render(<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />);

			expect(screen.getByText('Cost Over Time')).toBeInTheDocument();
		});

		it('renders for month time range', () => {
			render(<CostOverTimeGraph data={mockData} timeRange="month" theme={theme} />);

			expect(screen.getByText('Cost Over Time')).toBeInTheDocument();
		});

		it('renders for year time range', () => {
			render(<CostOverTimeGraph data={mockData} timeRange="year" theme={theme} />);

			expect(screen.getByText('Cost Over Time')).toBeInTheDocument();
		});

		it('renders for all time range', () => {
			render(<CostOverTimeGraph data={mockData} timeRange="all" theme={theme} />);

			expect(screen.getByText('Cost Over Time')).toBeInTheDocument();
		});
	});

	describe('Theme Support', () => {
		it('applies theme background color', () => {
			const { container } = render(
				<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />
			);

			const wrapper = container.firstChild as HTMLElement;
			expect(wrapper).toHaveStyle({
				backgroundColor: theme.colors.bgMain,
			});
		});

		it('applies theme text colors', () => {
			render(<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />);

			const title = screen.getByText('Cost Over Time');
			expect(title).toHaveStyle({
				color: theme.colors.textMain,
			});
		});

		it('uses theme accent color for line', () => {
			const { container } = render(
				<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />
			);

			// Find the main line path (has stroke and no fill)
			const paths = container.querySelectorAll('path');
			const linePath = Array.from(paths).find(
				(p) => p.getAttribute('fill') === 'none' && p.getAttribute('stroke')
			);

			expect(linePath).toHaveAttribute('stroke', theme.colors.accent);
		});

		it('works with light theme', () => {
			const lightTheme = THEMES['github-light'];

			render(<CostOverTimeGraph data={mockData} timeRange="week" theme={lightTheme} />);

			expect(screen.getByText('Cost Over Time')).toBeInTheDocument();
		});
	});

	describe('Tooltip Functionality', () => {
		it('shows tooltip on data point hover', () => {
			const { container } = render(
				<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />
			);

			const circles = container.querySelectorAll('circle');

			if (circles.length > 0) {
				fireEvent.mouseEnter(circles[0]);

				// Tooltip should appear in the document body (via portal)
				const tooltips = document.querySelectorAll('.fixed.z-\\[10000\\]');
				expect(tooltips.length).toBeGreaterThan(0);
			}
		});

		it('hides tooltip on mouse leave', () => {
			const { container } = render(
				<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />
			);

			const circles = container.querySelectorAll('circle');

			if (circles.length > 0) {
				fireEvent.mouseEnter(circles[0]);
				fireEvent.mouseLeave(circles[0]);

				const tooltips = document.querySelectorAll('.fixed.z-\\[10000\\]');
				expect(tooltips.length).toBe(0);
			}
		});

		it('tooltip shows cost value', () => {
			const { container } = render(
				<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />
			);

			const circles = container.querySelectorAll('circle');

			if (circles.length > 0) {
				fireEvent.mouseEnter(circles[0]);

				expect(screen.getByText('Cost:')).toBeInTheDocument();
			}
		});

		it('tooltip shows savings when in Local mode and savings exist', () => {
			const { container } = render(
				<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />
			);

			const circles = container.querySelectorAll('circle');

			if (circles.length > 0) {
				fireEvent.mouseEnter(circles[0]);

				expect(screen.getByText('Saved:')).toBeInTheDocument();
			}
		});

		it('tooltip does not show savings when in Anthropic mode', () => {
			const { container } = render(
				<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />
			);

			// Switch to Anthropic mode
			const anthropicButton = screen.getByTestId('data-source-toggle-anthropic');
			fireEvent.click(anthropicButton);

			const circles = container.querySelectorAll('circle');

			if (circles.length > 0) {
				fireEvent.mouseEnter(circles[0]);

				expect(screen.queryByText('Saved:')).not.toBeInTheDocument();
			}
		});
	});

	describe('Edge Cases', () => {
		it('handles single data point', () => {
			const { container } = render(
				<CostOverTimeGraph data={singlePointData} timeRange="week" theme={theme} />
			);

			const circles = container.querySelectorAll('circle');
			expect(circles.length).toBe(1);
		});

		it('handles zero cost days gracefully', () => {
			const { container } = render(
				<CostOverTimeGraph data={zeroCostData} timeRange="week" theme={theme} />
			);

			// Should render without errors
			expect(screen.getByText('Cost Over Time')).toBeInTheDocument();

			// Should have 3 data points even with zero costs
			const circles = container.querySelectorAll('circle');
			expect(circles.length).toBe(3);
		});
	});

	describe('Grid and Axes', () => {
		it('renders horizontal grid lines', () => {
			const { container } = render(
				<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />
			);

			const gridLines = container.querySelectorAll('line');
			expect(gridLines.length).toBeGreaterThan(0);
		});

		it('renders Y-axis tick labels with dollar sign', () => {
			const { container } = render(
				<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />
			);

			// Y-axis should have currency labels ($0.00, etc.)
			const textElements = container.querySelectorAll('text');
			const hasCurrencyLabel = Array.from(textElements).some((el) =>
				el.textContent?.match(/^\$\d+\.\d{2}$/)
			);
			expect(hasCurrencyLabel).toBe(true);
		});

		it('renders X-axis date labels', () => {
			const { container } = render(
				<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />
			);

			// Should have date labels (day abbreviations for week view)
			const textElements = container.querySelectorAll('text');
			const hasDateLabels = Array.from(textElements).some((el) =>
				el.textContent?.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/)
			);
			expect(hasDateLabels).toBe(true);
		});
	});

	describe('Area Fill', () => {
		it('renders gradient-filled area under line', () => {
			const { container } = render(
				<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />
			);

			// Should have a linearGradient defined
			const gradient = container.querySelector('linearGradient');
			expect(gradient).toBeInTheDocument();

			// Should have a path using the gradient
			const paths = container.querySelectorAll('path');
			const areaPath = Array.from(paths).find((p) =>
				p.getAttribute('fill')?.includes('url(#cost-gradient')
			);
			expect(areaPath).toBeInTheDocument();
		});
	});

	describe('Data Point Interaction', () => {
		it('enlarges data point on hover', () => {
			const { container } = render(
				<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />
			);

			const circles = container.querySelectorAll('circle');

			if (circles.length > 0) {
				const initialRadius = circles[0].getAttribute('r');
				fireEvent.mouseEnter(circles[0]);
				const hoveredRadius = circles[0].getAttribute('r');

				expect(parseInt(hoveredRadius || '0')).toBeGreaterThan(parseInt(initialRadius || '0'));
			}
		});
	});

	describe('Smooth Animations', () => {
		it('applies CSS transitions to line path for smooth updates', () => {
			const { container } = render(
				<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />
			);

			const paths = container.querySelectorAll('path');
			// Find the main line path (has stroke but no fill)
			const linePath = Array.from(paths).find(
				(p) => p.getAttribute('stroke') && p.getAttribute('fill') === 'none'
			);

			expect(linePath).toBeInTheDocument();
			const style = (linePath as HTMLElement).style;
			expect(style.transition).toContain('d');
			expect(style.transition).toContain('0.5s');
		});

		it('applies CSS transitions to area path for smooth updates', () => {
			const { container } = render(
				<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />
			);

			const paths = container.querySelectorAll('path');
			// Find the area path (has gradient fill)
			const areaPath = Array.from(paths).find((p) =>
				p.getAttribute('fill')?.includes('url(#cost-gradient')
			);

			expect(areaPath).toBeInTheDocument();
			const style = (areaPath as HTMLElement).style;
			expect(style.transition).toContain('d');
			expect(style.transition).toContain('0.5s');
		});

		it('applies CSS transitions to data points for smooth position updates', () => {
			const { container } = render(
				<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />
			);

			const circles = container.querySelectorAll('circle');
			expect(circles.length).toBeGreaterThan(0);

			const style = (circles[0] as unknown as HTMLElement).style;
			expect(style.transition).toContain('cx');
			expect(style.transition).toContain('cy');
			expect(style.transition).toContain('0.5s');
		});

		it('uses cubic-bezier easing for smooth animation curves', () => {
			const { container } = render(
				<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />
			);

			const paths = container.querySelectorAll('path');
			const linePath = Array.from(paths).find(
				(p) => p.getAttribute('stroke') && p.getAttribute('fill') === 'none'
			);

			const style = (linePath as HTMLElement).style;
			expect(style.transition).toContain('cubic-bezier');
		});
	});

	describe('Accessibility', () => {
		it('has proper role for chart container', () => {
			const { container } = render(
				<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />
			);

			const figure = container.querySelector('[role="figure"]');
			expect(figure).toBeInTheDocument();
		});

		it('has proper aria-label for chart container', () => {
			const { container } = render(
				<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />
			);

			const figure = container.querySelector('[role="figure"]');
			expect(figure).toHaveAttribute('aria-label');
			expect(figure?.getAttribute('aria-label')).toContain('Cost over time chart');
		});

		it('data points have aria labels', () => {
			const { container } = render(
				<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />
			);

			const circles = container.querySelectorAll('circle');

			if (circles.length > 0) {
				expect(circles[0]).toHaveAttribute('aria-label');
				expect(circles[0].getAttribute('aria-label')).toContain('Cost');
			}
		});

		it('data points are focusable', () => {
			const { container } = render(
				<CostOverTimeGraph data={mockData} timeRange="week" theme={theme} />
			);

			const circles = container.querySelectorAll('circle');

			if (circles.length > 0) {
				// SVG elements use lowercase tabindex
				expect(circles[0]).toHaveAttribute('tabindex', '0');
			}
		});
	});
});
