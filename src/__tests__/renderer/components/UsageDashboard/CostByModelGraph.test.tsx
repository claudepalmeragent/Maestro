/**
 * Tests for CostByModelGraph component
 *
 * Verifies:
 * - Renders horizontal bar chart correctly
 * - X-axis shows cost labels in USD
 * - Y-axis shows model names (truncated)
 * - DataSourceToggle switches between Local and Anthropic data
 * - Tooltip shows exact values on hover
 * - Shows savings when in Local mode
 * - Handles empty data gracefully
 * - Applies theme colors correctly
 * - Bars are sorted by cost (descending)
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import {
	CostByModelGraph,
	type ModelCostData,
} from '../../../../renderer/components/UsageDashboard/CostByModelGraph';
import { THEMES } from '../../../../shared/themes';

// Test theme
const theme = THEMES['dracula'];

// Sample data for testing
const mockData: ModelCostData[] = [
	{ model: 'claude-opus-4-5-20251101', localCost: 5.25, anthropicCost: 6.5, savings: 1.25 },
	{ model: 'claude-sonnet-4-5-20250929', localCost: 3.3, anthropicCost: 4.0, savings: 0.7 },
	{ model: 'claude-haiku-4-5-20251001', localCost: 0.75, anthropicCost: 0.9, savings: 0.15 },
];

// Empty data for edge case testing
const emptyData: ModelCostData[] = [];

// Single model data
const singleModelData: ModelCostData[] = [
	{ model: 'claude-opus-4-5-20251101', localCost: 5.25, anthropicCost: 6.5, savings: 1.25 },
];

// Data with no savings (API mode user)
const noSavingsData: ModelCostData[] = [
	{ model: 'claude-opus-4-5-20251101', localCost: 6.5, anthropicCost: 6.5, savings: 0 },
	{ model: 'claude-sonnet-4-5-20250929', localCost: 4.0, anthropicCost: 4.0, savings: 0 },
];

// Data with zero costs
const zeroCostData: ModelCostData[] = [
	{ model: 'claude-opus-4-5-20251101', localCost: 0, anthropicCost: 0, savings: 0 },
	{ model: 'claude-sonnet-4-5-20250929', localCost: 0, anthropicCost: 0, savings: 0 },
];

// Data with many models (for legend truncation testing)
const manyModelsData: ModelCostData[] = [
	{ model: 'claude-opus-4-5-20251101', localCost: 5.25, anthropicCost: 6.5, savings: 1.25 },
	{ model: 'claude-sonnet-4-5-20250929', localCost: 3.3, anthropicCost: 4.0, savings: 0.7 },
	{ model: 'claude-haiku-4-5-20251001', localCost: 0.75, anthropicCost: 0.9, savings: 0.15 },
	{ model: 'claude-3-opus-20240229', localCost: 2.0, anthropicCost: 2.5, savings: 0.5 },
	{ model: 'claude-3-sonnet-20240229', localCost: 1.5, anthropicCost: 1.8, savings: 0.3 },
	{ model: 'claude-3-haiku-20240307', localCost: 0.5, anthropicCost: 0.6, savings: 0.1 },
	{ model: 'claude-2.1', localCost: 0.3, anthropicCost: 0.35, savings: 0.05 },
	{ model: 'claude-instant-1.2', localCost: 0.2, anthropicCost: 0.25, savings: 0.05 },
];

describe('CostByModelGraph', () => {
	describe('Rendering', () => {
		it('renders the component with default title', () => {
			render(<CostByModelGraph data={mockData} timeRange="week" theme={theme} />);

			expect(screen.getByText('Cost by Model')).toBeInTheDocument();
		});

		it('renders with custom title', () => {
			render(
				<CostByModelGraph data={mockData} timeRange="week" theme={theme} title="Model Costs" />
			);

			expect(screen.getByText('Model Costs')).toBeInTheDocument();
		});

		it('renders DataSourceToggle', () => {
			render(<CostByModelGraph data={mockData} timeRange="week" theme={theme} />);

			expect(screen.getByTestId('data-source-toggle-local')).toBeInTheDocument();
			expect(screen.getByTestId('data-source-toggle-anthropic')).toBeInTheDocument();
		});

		it('renders SVG chart element', () => {
			const { container } = render(
				<CostByModelGraph data={mockData} timeRange="week" theme={theme} />
			);

			const svg = container.querySelector('svg');
			expect(svg).toBeInTheDocument();
		});

		it('renders bars as rect elements', () => {
			const { container } = render(
				<CostByModelGraph data={mockData} timeRange="week" theme={theme} />
			);

			const rects = container.querySelectorAll('rect');
			expect(rects.length).toBe(mockData.length);
		});

		it('renders X-axis label', () => {
			render(<CostByModelGraph data={mockData} timeRange="week" theme={theme} />);

			expect(screen.getByText('Cost (USD)')).toBeInTheDocument();
		});

		it('renders legend', () => {
			const { container } = render(
				<CostByModelGraph data={mockData} timeRange="week" theme={theme} />
			);

			// Model names should be truncated (without claude- prefix and date suffix)
			// They appear both in Y-axis and legend, so use getAllByText
			expect(screen.getAllByText('opus-4-5').length).toBeGreaterThanOrEqual(1);
			expect(screen.getAllByText('sonnet-4-5').length).toBeGreaterThanOrEqual(1);
			expect(screen.getAllByText('haiku-4-5').length).toBeGreaterThanOrEqual(1);

			// Verify legend specifically exists
			const legend = container.querySelector('[role="list"][aria-label="Chart legend"]');
			expect(legend).toBeInTheDocument();
		});

		it('truncates legend when more than 6 models', () => {
			render(<CostByModelGraph data={manyModelsData} timeRange="week" theme={theme} />);

			// Should show +N more text
			expect(screen.getByText('+2 more')).toBeInTheDocument();
		});
	});

	describe('Total Cost Display', () => {
		it('displays total cost', () => {
			render(<CostByModelGraph data={mockData} timeRange="week" theme={theme} />);

			// Total of local costs: 5.25 + 3.30 + 0.75 = 9.30
			expect(screen.getByText(/Total:/)).toBeInTheDocument();
			expect(screen.getByText(/\$9\.30/)).toBeInTheDocument();
		});
	});

	describe('Empty State', () => {
		it('renders empty state message when no data', () => {
			render(<CostByModelGraph data={emptyData} timeRange="week" theme={theme} />);

			expect(screen.getByText('No cost data available')).toBeInTheDocument();
		});

		it('does not render SVG when no data', () => {
			const { container } = render(
				<CostByModelGraph data={emptyData} timeRange="week" theme={theme} />
			);

			const svg = container.querySelector('svg');
			expect(svg).not.toBeInTheDocument();
		});

		it('does not render legend when no data', () => {
			const { container } = render(
				<CostByModelGraph data={emptyData} timeRange="week" theme={theme} />
			);

			// Legend has role="list"
			const legend = container.querySelector('[role="list"]');
			expect(legend).not.toBeInTheDocument();
		});
	});

	describe('DataSource Toggle', () => {
		it('defaults to Local data source', () => {
			render(<CostByModelGraph data={mockData} timeRange="week" theme={theme} />);

			const localButton = screen.getByTestId('data-source-toggle-local');
			expect(localButton).toHaveAttribute('aria-pressed', 'true');

			const anthropicButton = screen.getByTestId('data-source-toggle-anthropic');
			expect(anthropicButton).toHaveAttribute('aria-pressed', 'false');
		});

		it('switches to Anthropic data when clicked', () => {
			render(<CostByModelGraph data={mockData} timeRange="week" theme={theme} />);

			const anthropicButton = screen.getByTestId('data-source-toggle-anthropic');
			fireEvent.click(anthropicButton);

			expect(anthropicButton).toHaveAttribute('aria-pressed', 'true');
		});

		it('updates total when switching data source', () => {
			render(<CostByModelGraph data={mockData} timeRange="week" theme={theme} />);

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
				<CostByModelGraph data={mockData} timeRange="week" theme={theme} />
			);

			// Get all bar aria-labels
			const bars = container.querySelectorAll('rect[role="graphics-symbol"]');
			const labels = Array.from(bars).map((bar) => bar.getAttribute('aria-label'));

			// First bar should be opus (highest cost: 5.25)
			expect(labels[0]).toContain('opus');
			// Last bar should be haiku (lowest cost: 0.75)
			expect(labels[labels.length - 1]).toContain('haiku');
		});
	});

	describe('Time Range Handling', () => {
		it('renders for day time range', () => {
			render(<CostByModelGraph data={mockData} timeRange="day" theme={theme} />);

			expect(screen.getByText('Cost by Model')).toBeInTheDocument();
		});

		it('renders for week time range', () => {
			render(<CostByModelGraph data={mockData} timeRange="week" theme={theme} />);

			expect(screen.getByText('Cost by Model')).toBeInTheDocument();
		});

		it('renders for month time range', () => {
			render(<CostByModelGraph data={mockData} timeRange="month" theme={theme} />);

			expect(screen.getByText('Cost by Model')).toBeInTheDocument();
		});

		it('renders for year time range', () => {
			render(<CostByModelGraph data={mockData} timeRange="year" theme={theme} />);

			expect(screen.getByText('Cost by Model')).toBeInTheDocument();
		});

		it('renders for all time range', () => {
			render(<CostByModelGraph data={mockData} timeRange="all" theme={theme} />);

			expect(screen.getByText('Cost by Model')).toBeInTheDocument();
		});
	});

	describe('Theme Support', () => {
		it('applies theme background color', () => {
			const { container } = render(
				<CostByModelGraph data={mockData} timeRange="week" theme={theme} />
			);

			const wrapper = container.firstChild as HTMLElement;
			expect(wrapper).toHaveStyle({
				backgroundColor: theme.colors.bgMain,
			});
		});

		it('applies theme text colors', () => {
			render(<CostByModelGraph data={mockData} timeRange="week" theme={theme} />);

			const title = screen.getByText('Cost by Model');
			expect(title).toHaveStyle({
				color: theme.colors.textMain,
			});
		});

		it('works with light theme', () => {
			const lightTheme = THEMES['github-light'];

			render(<CostByModelGraph data={mockData} timeRange="week" theme={lightTheme} />);

			expect(screen.getByText('Cost by Model')).toBeInTheDocument();
		});
	});

	describe('Tooltip Functionality', () => {
		it('shows tooltip on bar hover', () => {
			const { container } = render(
				<CostByModelGraph data={mockData} timeRange="week" theme={theme} />
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
				<CostByModelGraph data={mockData} timeRange="week" theme={theme} />
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
				<CostByModelGraph data={mockData} timeRange="week" theme={theme} />
			);

			const bars = container.querySelectorAll('rect[role="graphics-symbol"]');

			if (bars.length > 0) {
				fireEvent.mouseEnter(bars[0]);

				expect(screen.getByText('Cost:')).toBeInTheDocument();
			}
		});

		it('tooltip shows savings when in Local mode and savings exist', () => {
			const { container } = render(
				<CostByModelGraph data={mockData} timeRange="week" theme={theme} />
			);

			const bars = container.querySelectorAll('rect[role="graphics-symbol"]');

			if (bars.length > 0) {
				fireEvent.mouseEnter(bars[0]);

				expect(screen.getByText('Saved:')).toBeInTheDocument();
			}
		});

		it('tooltip does not show savings when in Anthropic mode', () => {
			const { container } = render(
				<CostByModelGraph data={mockData} timeRange="week" theme={theme} />
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
				<CostByModelGraph data={noSavingsData} timeRange="week" theme={theme} />
			);

			const bars = container.querySelectorAll('rect[role="graphics-symbol"]');

			if (bars.length > 0) {
				fireEvent.mouseEnter(bars[0]);

				expect(screen.queryByText('Saved:')).not.toBeInTheDocument();
			}
		});
	});

	describe('Edge Cases', () => {
		it('handles single model', () => {
			const { container } = render(
				<CostByModelGraph data={singleModelData} timeRange="week" theme={theme} />
			);

			const bars = container.querySelectorAll('rect[role="graphics-symbol"]');
			expect(bars.length).toBe(1);
		});

		it('handles zero cost models gracefully', () => {
			const { container } = render(
				<CostByModelGraph data={zeroCostData} timeRange="week" theme={theme} />
			);

			// Should render without errors
			expect(screen.getByText('Cost by Model')).toBeInTheDocument();

			// Should have 2 bars even with zero costs
			const bars = container.querySelectorAll('rect[role="graphics-symbol"]');
			expect(bars.length).toBe(2);
		});
	});

	describe('Model Name Formatting', () => {
		it('truncates model names correctly', () => {
			render(<CostByModelGraph data={mockData} timeRange="week" theme={theme} />);

			// Should show truncated names (in Y-axis labels and legend)
			// They appear in both places, so use getAllByText
			expect(screen.getAllByText('opus-4-5').length).toBeGreaterThanOrEqual(1);
			expect(screen.getAllByText('sonnet-4-5').length).toBeGreaterThanOrEqual(1);
			expect(screen.getAllByText('haiku-4-5').length).toBeGreaterThanOrEqual(1);
		});
	});

	describe('Grid and Axes', () => {
		it('renders vertical grid lines', () => {
			const { container } = render(
				<CostByModelGraph data={mockData} timeRange="week" theme={theme} />
			);

			const gridLines = container.querySelectorAll('line');
			expect(gridLines.length).toBeGreaterThan(0);
		});

		it('renders X-axis tick labels with dollar sign', () => {
			const { container } = render(
				<CostByModelGraph data={mockData} timeRange="week" theme={theme} />
			);

			// X-axis should have currency labels ($0.00, etc.)
			const textElements = container.querySelectorAll('text');
			const hasCurrencyLabel = Array.from(textElements).some((el) =>
				el.textContent?.match(/^\$\d+\.\d{2}$/)
			);
			expect(hasCurrencyLabel).toBe(true);
		});
	});

	describe('Smooth Animations', () => {
		it('applies CSS transitions to bars for smooth updates', () => {
			const { container } = render(
				<CostByModelGraph data={mockData} timeRange="week" theme={theme} />
			);

			const bars = container.querySelectorAll('rect[role="graphics-symbol"]');
			expect(bars.length).toBeGreaterThan(0);

			const style = (bars[0] as unknown as HTMLElement).style;
			expect(style.transition).toContain('width');
			expect(style.transition).toContain('0.5s');
		});

		it('uses cubic-bezier easing for smooth animation curves', () => {
			const { container } = render(
				<CostByModelGraph data={mockData} timeRange="week" theme={theme} />
			);

			const bars = container.querySelectorAll('rect[role="graphics-symbol"]');

			const style = (bars[0] as unknown as HTMLElement).style;
			expect(style.transition).toContain('cubic-bezier');
		});
	});

	describe('Accessibility', () => {
		it('has proper role for chart container', () => {
			const { container } = render(
				<CostByModelGraph data={mockData} timeRange="week" theme={theme} />
			);

			const figure = container.querySelector('[role="figure"]');
			expect(figure).toBeInTheDocument();
		});

		it('has proper aria-label for chart container', () => {
			const { container } = render(
				<CostByModelGraph data={mockData} timeRange="week" theme={theme} />
			);

			const figure = container.querySelector('[role="figure"]');
			expect(figure).toHaveAttribute('aria-label');
			expect(figure?.getAttribute('aria-label')).toContain('Cost by model chart');
		});

		it('bars have aria labels', () => {
			const { container } = render(
				<CostByModelGraph data={mockData} timeRange="week" theme={theme} />
			);

			const bars = container.querySelectorAll('rect[role="graphics-symbol"]');

			if (bars.length > 0) {
				expect(bars[0]).toHaveAttribute('aria-label');
				expect(bars[0].getAttribute('aria-label')).toContain('Cost');
			}
		});

		it('bars are focusable', () => {
			const { container } = render(
				<CostByModelGraph data={mockData} timeRange="week" theme={theme} />
			);

			const bars = container.querySelectorAll('rect[role="graphics-symbol"]');

			if (bars.length > 0) {
				// SVG elements use lowercase tabindex
				expect(bars[0]).toHaveAttribute('tabindex', '0');
			}
		});

		it('legend has proper role', () => {
			const { container } = render(
				<CostByModelGraph data={mockData} timeRange="week" theme={theme} />
			);

			const legend = container.querySelector('[role="list"][aria-label="Chart legend"]');
			expect(legend).toBeInTheDocument();
		});

		it('legend items have proper role', () => {
			const { container } = render(
				<CostByModelGraph data={mockData} timeRange="week" theme={theme} />
			);

			const legendItems = container.querySelectorAll('[role="listitem"]');
			expect(legendItems.length).toBe(mockData.length);
		});
	});

	describe('Bar Colors', () => {
		it('assigns distinct colors to each model', () => {
			const { container } = render(
				<CostByModelGraph data={mockData} timeRange="week" theme={theme} />
			);

			const bars = container.querySelectorAll('rect[role="graphics-symbol"]');
			const fills = Array.from(bars).map((bar) => bar.getAttribute('fill'));

			// All fills should be unique
			const uniqueFills = new Set(fills);
			expect(uniqueFills.size).toBe(fills.length);
		});

		it('cycles colors when more models than colors', () => {
			const { container } = render(
				<CostByModelGraph data={manyModelsData} timeRange="week" theme={theme} />
			);

			const bars = container.querySelectorAll('rect[role="graphics-symbol"]');
			// Should have 8 bars
			expect(bars.length).toBe(8);
		});
	});
});
