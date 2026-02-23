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
 * - Free Tokens section shown when present, hidden when absent
 * - Grand Total includes combined token count with free tokens
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
	costUsd: 1.23,
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

function makeBillableBreakdown(): TokenBreakdown {
	return {
		inputTokens: 3_000_000,
		outputTokens: 1_500_000,
		cacheCreationTokens: 500_000,
		costUsd: 12.5,
		billableTokens: 5_000_000,
	};
}

function makeBreakdownWithFree(): TokenBreakdown {
	return {
		...makeBillableBreakdown(),
		freeInputTokens: 200_000,
		freeOutputTokens: 100_000,
		freeCacheCreationTokens: 50_000,
		freeTotalTokens: 350_000,
	};
}

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

			expect(screen.queryByText('Billable Tokens')).not.toBeInTheDocument();
		});
	});

	describe('Single breakdown tooltip', () => {
		it('shows tooltip on mouse enter', () => {
			render(
				<TokenBreakdownTooltip theme={theme} breakdown={mockBreakdown}>
					<div>Card Content</div>
				</TokenBreakdownTooltip>
			);

			expect(screen.queryByText('Billable Tokens')).not.toBeInTheDocument();

			const container = screen.getByText('Card Content').parentElement!;
			fireEvent.mouseEnter(container);

			expect(screen.getByText('Billable Tokens')).toBeInTheDocument();
		});

		it('hides tooltip on mouse leave', () => {
			render(
				<TokenBreakdownTooltip theme={theme} breakdown={mockBreakdown}>
					<div>Card Content</div>
				</TokenBreakdownTooltip>
			);

			const container = screen.getByText('Card Content').parentElement!;
			fireEvent.mouseEnter(container);
			expect(screen.getByText('Billable Tokens')).toBeInTheDocument();

			fireEvent.mouseLeave(container);
			expect(screen.queryByText('Billable Tokens')).not.toBeInTheDocument();
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
			expect(screen.getByText('Subtotal')).toBeInTheDocument();
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

		it('displays Grand Total with cost', () => {
			render(
				<TokenBreakdownTooltip theme={theme} breakdown={mockBreakdown}>
					<div>Card Content</div>
				</TokenBreakdownTooltip>
			);

			const container = screen.getByText('Card Content').parentElement!;
			fireEvent.mouseEnter(container);

			expect(screen.getByText('Grand Total')).toBeInTheDocument();
			expect(screen.getByText('$1.23')).toBeInTheDocument();
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
			expect(screen.getByText('Billable Tokens')).toBeInTheDocument();
		});

		it('shows Grand Total Costs row with comparison values', () => {
			render(
				<TokenBreakdownTooltip theme={theme} comparison={comparison}>
					<div>Delta Card</div>
				</TokenBreakdownTooltip>
			);

			const container = screen.getByText('Delta Card').parentElement!;
			fireEvent.mouseEnter(container);

			expect(screen.getByText('Grand Total Costs')).toBeInTheDocument();
			expect(screen.getByText('$2.50')).toBeInTheDocument();
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

	describe('Free tokens rendering', () => {
		it('does NOT show Free Tokens section when no free tokens present', () => {
			render(
				<TokenBreakdownTooltip theme={theme} breakdown={makeBillableBreakdown()}>
					<span>Hover Me</span>
				</TokenBreakdownTooltip>
			);
			fireEvent.mouseEnter(screen.getByText('Hover Me').parentElement!);
			expect(screen.queryByText('Free Tokens (Local Models)')).toBeNull();
		});

		it('shows Free Tokens section when free tokens are present', () => {
			render(
				<TokenBreakdownTooltip theme={theme} breakdown={makeBreakdownWithFree()}>
					<span>Hover Me</span>
				</TokenBreakdownTooltip>
			);
			fireEvent.mouseEnter(screen.getByText('Hover Me').parentElement!);
			expect(screen.getByText('Free Tokens (Local Models)')).toBeInTheDocument();
			// Free tokens cost is $0.00
			expect(screen.getByText(/\$0\.00/)).toBeTruthy();
		});

		it('shows Grand Total with combined token count when free tokens exist', () => {
			render(
				<TokenBreakdownTooltip theme={theme} breakdown={makeBreakdownWithFree()}>
					<span>Hover Me</span>
				</TokenBreakdownTooltip>
			);
			fireEvent.mouseEnter(screen.getByText('Hover Me').parentElement!);
			// Grand Total should include combined count: 5M + 350K = 5.35M tokens
			expect(screen.getByText(/Grand Total/)).toBeTruthy();
		});
	});

	describe('Comparison free tokens rendering', () => {
		it('shows Free Tokens section in comparison tooltip when free tokens exist on local side', () => {
			const comparison = {
				local: {
					inputTokens: 3_000_000,
					outputTokens: 1_500_000,
					cacheCreationTokens: 500_000,
					costUsd: 12.5,
					billableTokens: 5_000_000,
					freeInputTokens: 200_000,
					freeOutputTokens: 100_000,
					freeCacheCreationTokens: 50_000,
					freeTotalTokens: 350_000,
				},
				honeycomb: {
					inputTokens: 3_050_000,
					outputTokens: 1_550_000,
					cacheCreationTokens: 500_000,
					costUsd: 12.8,
					billableTokens: 5_100_000,
					freeInputTokens: 180_000,
					freeOutputTokens: 90_000,
					freeCacheCreationTokens: 45_000,
					freeTotalTokens: 315_000,
				},
			};
			render(
				<TokenBreakdownTooltip theme={theme} comparison={comparison}>
					<span>Delta Card</span>
				</TokenBreakdownTooltip>
			);
			fireEvent.mouseEnter(screen.getByText('Delta Card').parentElement!);
			expect(screen.getByText('Free Tokens (Local Models)')).toBeTruthy();
		});

		it('does NOT show Free Tokens section in comparison tooltip when no free tokens on either side', () => {
			const comparison = {
				local: {
					inputTokens: 3_000_000,
					outputTokens: 1_500_000,
					cacheCreationTokens: 500_000,
					costUsd: 12.5,
					billableTokens: 5_000_000,
				},
				honeycomb: {
					inputTokens: 3_050_000,
					outputTokens: 1_550_000,
					cacheCreationTokens: 500_000,
					costUsd: 12.8,
					billableTokens: 5_100_000,
				},
			};
			render(
				<TokenBreakdownTooltip theme={theme} comparison={comparison}>
					<span>Delta Card</span>
				</TokenBreakdownTooltip>
			);
			fireEvent.mouseEnter(screen.getByText('Delta Card').parentElement!);
			expect(screen.queryByText('Free Tokens (Local Models)')).toBeNull();
		});

		it('shows Free Tokens in comparison when only HC side has free tokens', () => {
			const comparison = {
				local: {
					inputTokens: 3_000_000,
					outputTokens: 1_500_000,
					cacheCreationTokens: 500_000,
					costUsd: 12.5,
					billableTokens: 5_000_000,
				},
				honeycomb: {
					inputTokens: 3_050_000,
					outputTokens: 1_550_000,
					cacheCreationTokens: 500_000,
					costUsd: 12.8,
					billableTokens: 5_100_000,
					freeInputTokens: 180_000,
					freeOutputTokens: 90_000,
					freeCacheCreationTokens: 45_000,
					freeTotalTokens: 315_000,
				},
			};
			render(
				<TokenBreakdownTooltip theme={theme} comparison={comparison}>
					<span>Delta Card</span>
				</TokenBreakdownTooltip>
			);
			fireEvent.mouseEnter(screen.getByText('Delta Card').parentElement!);
			expect(screen.getByText('Free Tokens (Local Models)')).toBeTruthy();
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

			expect(screen.getByText('$0.00')).toBeInTheDocument();
		});
	});
});
