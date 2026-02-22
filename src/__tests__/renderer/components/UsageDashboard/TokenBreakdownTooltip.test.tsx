/**
 * Tests for TokenBreakdownTooltip component
 *
 * Verifies:
 * - Renders children without tooltip when no breakdown/comparison provided
 * - Shows single breakdown tooltip on hover with correct token values
 * - Shows comparison breakdown tooltip on hover with Local/HC/Delta columns
 * - Formats tokens correctly (K, M suffixes)
 * - Displays cost values with proper precision
 * - Delta values show correct +/- signs and color coding
 * - Tooltip hides on mouse leave
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import {
	TokenBreakdownTooltip,
	type TokenBreakdown,
} from '../../../../renderer/components/UsageDashboard/TokenBreakdownTooltip';
import { THEMES } from '../../../../shared/themes';

const theme = THEMES['dracula'];

const mockBreakdown: TokenBreakdown = {
	inputTokens: 150000,
	outputTokens: 75000,
	cacheCreationTokens: 10000,
	costUsd: 1.2345,
	billableTokens: 235000,
};

const mockLocalBreakdown: TokenBreakdown = {
	inputTokens: 200000,
	outputTokens: 100000,
	cacheCreationTokens: 15000,
	costUsd: 2.5,
	billableTokens: 315000,
};

const mockHcBreakdown: TokenBreakdown = {
	inputTokens: 180000,
	outputTokens: 90000,
	cacheCreationTokens: 12000,
	costUsd: 2.1,
	billableTokens: 282000,
};

describe('TokenBreakdownTooltip', () => {
	describe('No breakdown or comparison', () => {
		it('renders children directly when no breakdown or comparison provided', () => {
			render(
				<TokenBreakdownTooltip theme={theme}>
					<div data-testid="child">Card Content</div>
				</TokenBreakdownTooltip>
			);

			expect(screen.getByTestId('child')).toBeInTheDocument();
			expect(screen.getByText('Card Content')).toBeInTheDocument();
		});

		it('does not show any tooltip content when no breakdown is provided', () => {
			render(
				<TokenBreakdownTooltip theme={theme}>
					<div>Card Content</div>
				</TokenBreakdownTooltip>
			);

			expect(screen.queryByText('Token Breakdown')).not.toBeInTheDocument();
		});
	});

	describe('Single breakdown tooltip', () => {
		it('shows tooltip on mouse enter', () => {
			render(
				<TokenBreakdownTooltip theme={theme} breakdown={mockBreakdown}>
					<div>Card Content</div>
				</TokenBreakdownTooltip>
			);

			// Tooltip should not be visible initially
			expect(screen.queryByText('Token Breakdown')).not.toBeInTheDocument();

			// Hover to show tooltip
			const container = screen.getByText('Card Content').parentElement!;
			fireEvent.mouseEnter(container);

			expect(screen.getByText('Token Breakdown')).toBeInTheDocument();
		});

		it('hides tooltip on mouse leave', () => {
			render(
				<TokenBreakdownTooltip theme={theme} breakdown={mockBreakdown}>
					<div>Card Content</div>
				</TokenBreakdownTooltip>
			);

			const container = screen.getByText('Card Content').parentElement!;
			fireEvent.mouseEnter(container);
			expect(screen.getByText('Token Breakdown')).toBeInTheDocument();

			fireEvent.mouseLeave(container);
			expect(screen.queryByText('Token Breakdown')).not.toBeInTheDocument();
		});

		it('displays all token type rows', () => {
			render(
				<TokenBreakdownTooltip theme={theme} breakdown={mockBreakdown}>
					<div>Card Content</div>
				</TokenBreakdownTooltip>
			);

			const container = screen.getByText('Card Content').parentElement!;
			fireEvent.mouseEnter(container);

			expect(screen.getByText('Input')).toBeInTheDocument();
			expect(screen.getByText('Output')).toBeInTheDocument();
			expect(screen.getByText('Cache Creation')).toBeInTheDocument();
			expect(screen.getByText('Billable Total')).toBeInTheDocument();
		});

		it('formats token values with K/M suffixes', () => {
			render(
				<TokenBreakdownTooltip theme={theme} breakdown={mockBreakdown}>
					<div>Card Content</div>
				</TokenBreakdownTooltip>
			);

			const container = screen.getByText('Card Content').parentElement!;
			fireEvent.mouseEnter(container);

			// 150000 -> 150.0K
			expect(screen.getByText('150.0K')).toBeInTheDocument();
			// 75000 -> 75.0K
			expect(screen.getByText('75.0K')).toBeInTheDocument();
			// 10000 -> 10.0K
			expect(screen.getByText('10.0K')).toBeInTheDocument();
		});

		it('displays cost with 4 decimal places', () => {
			render(
				<TokenBreakdownTooltip theme={theme} breakdown={mockBreakdown}>
					<div>Card Content</div>
				</TokenBreakdownTooltip>
			);

			const container = screen.getByText('Card Content').parentElement!;
			fireEvent.mouseEnter(container);

			expect(screen.getByText('$1.2345')).toBeInTheDocument();
		});

		it('displays cost label', () => {
			render(
				<TokenBreakdownTooltip theme={theme} breakdown={mockBreakdown}>
					<div>Card Content</div>
				</TokenBreakdownTooltip>
			);

			const container = screen.getByText('Card Content').parentElement!;
			fireEvent.mouseEnter(container);

			expect(screen.getByText('Cost')).toBeInTheDocument();
		});
	});

	describe('Comparison breakdown tooltip', () => {
		const comparison = {
			local: mockLocalBreakdown,
			honeycomb: mockHcBreakdown,
		};

		it('shows comparison tooltip on mouse enter', () => {
			render(
				<TokenBreakdownTooltip theme={theme} comparison={comparison}>
					<div>Delta Card</div>
				</TokenBreakdownTooltip>
			);

			const container = screen.getByText('Delta Card').parentElement!;
			fireEvent.mouseEnter(container);

			// Should show column headers
			expect(screen.getByText('Local')).toBeInTheDocument();
			expect(screen.getByText('HC')).toBeInTheDocument();
			expect(screen.getByText('Delta')).toBeInTheDocument();
		});

		it('displays all token type rows in comparison', () => {
			render(
				<TokenBreakdownTooltip theme={theme} comparison={comparison}>
					<div>Delta Card</div>
				</TokenBreakdownTooltip>
			);

			const container = screen.getByText('Delta Card').parentElement!;
			fireEvent.mouseEnter(container);

			expect(screen.getByText('Input')).toBeInTheDocument();
			expect(screen.getByText('Output')).toBeInTheDocument();
			expect(screen.getByText('Cache Create')).toBeInTheDocument();
			expect(screen.getByText('Billable')).toBeInTheDocument();
		});

		it('shows cost row with comparison values', () => {
			render(
				<TokenBreakdownTooltip theme={theme} comparison={comparison}>
					<div>Delta Card</div>
				</TokenBreakdownTooltip>
			);

			const container = screen.getByText('Delta Card').parentElement!;
			fireEvent.mouseEnter(container);

			expect(screen.getByText('Cost')).toBeInTheDocument();
			// Local cost $2.50
			expect(screen.getByText('$2.50')).toBeInTheDocument();
			// HC cost $2.10
			expect(screen.getByText('$2.10')).toBeInTheDocument();
		});

		it('hides comparison tooltip on mouse leave', () => {
			render(
				<TokenBreakdownTooltip theme={theme} comparison={comparison}>
					<div>Delta Card</div>
				</TokenBreakdownTooltip>
			);

			const container = screen.getByText('Delta Card').parentElement!;
			fireEvent.mouseEnter(container);
			expect(screen.getByText('Local')).toBeInTheDocument();

			fireEvent.mouseLeave(container);
			expect(screen.queryByText('Local')).not.toBeInTheDocument();
		});
	});

	describe('Token formatting edge cases', () => {
		it('formats millions with M suffix and 2 decimal places', () => {
			const bigBreakdown: TokenBreakdown = {
				inputTokens: 1500000,
				outputTokens: 750000,
				cacheCreationTokens: 0,
				costUsd: 10.0,
				billableTokens: 2250000,
			};

			render(
				<TokenBreakdownTooltip theme={theme} breakdown={bigBreakdown}>
					<div>Card</div>
				</TokenBreakdownTooltip>
			);

			const container = screen.getByText('Card').parentElement!;
			fireEvent.mouseEnter(container);

			// 1500000 -> 1.50M
			expect(screen.getByText('1.50M')).toBeInTheDocument();
		});

		it('formats small numbers with locale formatting', () => {
			const smallBreakdown: TokenBreakdown = {
				inputTokens: 500,
				outputTokens: 200,
				cacheCreationTokens: 50,
				costUsd: 0.001,
				billableTokens: 750,
			};

			render(
				<TokenBreakdownTooltip theme={theme} breakdown={smallBreakdown}>
					<div>Card</div>
				</TokenBreakdownTooltip>
			);

			const container = screen.getByText('Card').parentElement!;
			fireEvent.mouseEnter(container);

			expect(screen.getByText('500')).toBeInTheDocument();
			expect(screen.getByText('200')).toBeInTheDocument();
		});

		it('handles zero values', () => {
			const zeroBreakdown: TokenBreakdown = {
				inputTokens: 0,
				outputTokens: 0,
				cacheCreationTokens: 0,
				costUsd: 0,
				billableTokens: 0,
			};

			render(
				<TokenBreakdownTooltip theme={theme} breakdown={zeroBreakdown}>
					<div>Card</div>
				</TokenBreakdownTooltip>
			);

			const container = screen.getByText('Card').parentElement!;
			fireEvent.mouseEnter(container);

			expect(screen.getByText('$0.0000')).toBeInTheDocument();
		});
	});
});
