/**
 * Tests for DatasourceSummaryCards component
 *
 * Verifies:
 * - Renders all four summary cards (Local, Honeycomb, Divergence, Confidence)
 * - Displays formatted cost and token values
 * - Shows token breakdown tooltips on hover for Local and Honeycomb cards
 * - Shows comparison breakdown tooltip on hover for Divergence card
 * - No tooltip appears for Confidence card
 * - Confidence level computed correctly (HIGH/MEDIUM/LOW)
 * - Loading skeleton shown when data is null
 * - Honeycomb free token fields flow through correctly
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import {
	DatasourceSummaryCards,
	type DatasourceSummaryData,
} from '../../../../renderer/components/UsageDashboard/DatasourceSummaryCards';
import { THEMES } from '../../../../shared/themes';

const theme = THEMES['dracula'];

const mockData: DatasourceSummaryData = {
	localCostUsd: 2.5,
	localBillableTokens: 315000,
	honeycombCostUsd: 2.1,
	honeycombBillableTokens: 282000,
	calibrationPointCount: 5,
	calibrationConfidencePct: 95,
	localInputTokens: 200000,
	localOutputTokens: 100000,
	localCacheCreationTokens: 15000,
	honeycombInputTokens: 180000,
	honeycombOutputTokens: 90000,
	honeycombCacheCreationTokens: 12000,
};

const mockDataNoBreakdown: DatasourceSummaryData = {
	localCostUsd: 2.5,
	localBillableTokens: 315000,
	honeycombCostUsd: 2.1,
	honeycombBillableTokens: 282000,
	calibrationPointCount: 5,
	calibrationConfidencePct: 95,
};

describe('DatasourceSummaryCards', () => {
	describe('Loading state', () => {
		it('renders skeleton cards when data is null', () => {
			const { container } = render(<DatasourceSummaryCards theme={theme} data={null} />);

			const skeletons = container.querySelectorAll('.animate-pulse');
			expect(skeletons).toHaveLength(4);
		});
	});

	describe('Card rendering', () => {
		it('renders all four card labels', () => {
			render(<DatasourceSummaryCards theme={theme} data={mockData} />);

			expect(screen.getByText('Local')).toBeInTheDocument();
			expect(screen.getByText('Honeycomb')).toBeInTheDocument();
			expect(screen.getByText('Δ Divergence')).toBeInTheDocument();
			expect(screen.getByText('Confidence')).toBeInTheDocument();
		});

		it('displays formatted cost values for Local and Honeycomb', () => {
			render(<DatasourceSummaryCards theme={theme} data={mockData} />);

			expect(screen.getByText('$2.50')).toBeInTheDocument();
			expect(screen.getByText('$2.10')).toBeInTheDocument();
		});

		it('displays token counts with formatting', () => {
			render(<DatasourceSummaryCards theme={theme} data={mockData} />);

			expect(screen.getByText('315.0K tokens')).toBeInTheDocument();
			expect(screen.getByText('282.0K tokens')).toBeInTheDocument();
		});

		it('displays divergence values', () => {
			render(<DatasourceSummaryCards theme={theme} data={mockData} />);

			// Divergence = |2.5 - 2.1| = $0.40
			expect(screen.getByText('$0.40 (19.0%)')).toBeInTheDocument();
		});
	});

	describe('Confidence levels', () => {
		it('shows HIGH confidence when effective confidence > 85 (high convergence + enough points)', () => {
			// effective = 95 * min(1, 5/5) = 95 * 1 = 95 > 85 → HIGH
			const highConfData: DatasourceSummaryData = {
				localCostUsd: 2.0,
				localBillableTokens: 100000,
				honeycombCostUsd: 2.0,
				honeycombBillableTokens: 100000,
				calibrationPointCount: 5,
				calibrationConfidencePct: 95,
			};
			render(<DatasourceSummaryCards theme={theme} data={highConfData} />);

			expect(screen.getByText('HIGH')).toBeInTheDocument();
		});

		it('shows LOW confidence when calibration count is 0', () => {
			// effective = 0 * min(1, 0/5) = 0 → LOW
			const lowConfData: DatasourceSummaryData = {
				localCostUsd: 2.0,
				localBillableTokens: 100000,
				honeycombCostUsd: 2.0,
				honeycombBillableTokens: 100000,
				calibrationPointCount: 0,
				calibrationConfidencePct: 0,
			};
			render(<DatasourceSummaryCards theme={theme} data={lowConfData} />);

			expect(screen.getByText('LOW')).toBeInTheDocument();
		});

		it('shows MEDIUM confidence for intermediate cases', () => {
			// Use values that produce MEDIUM: effective = 75 * min(1, 5/5) = 75 > 50 → MEDIUM
			const medConfData: DatasourceSummaryData = {
				localCostUsd: 2.0,
				localBillableTokens: 100000,
				honeycombCostUsd: 2.0,
				honeycombBillableTokens: 100000,
				calibrationPointCount: 5,
				calibrationConfidencePct: 75,
			};
			render(<DatasourceSummaryCards theme={theme} data={medConfData} />);

			expect(screen.getByText('MEDIUM')).toBeInTheDocument();
		});

		it('shows LOW confidence when few points even with high convergence', () => {
			// effective = 95 * min(1, 1/5) = 95 * 0.2 = 19 ≤ 50 → LOW
			const lowConfFewPoints: DatasourceSummaryData = {
				localCostUsd: 2.0,
				localBillableTokens: 100000,
				honeycombCostUsd: 2.0,
				honeycombBillableTokens: 100000,
				calibrationPointCount: 1,
				calibrationConfidencePct: 95,
			};
			render(<DatasourceSummaryCards theme={theme} data={lowConfFewPoints} />);

			expect(screen.getByText('LOW')).toBeInTheDocument();
		});

		it('shows HIGH confidence regardless of divergence between local and HC costs', () => {
			// effective = 99 * min(1, 10/5) = 99 * 1 = 99 > 85 → HIGH
			const highDivergenceData: DatasourceSummaryData = {
				localCostUsd: 10.0,
				localBillableTokens: 500000,
				honeycombCostUsd: 2.0,
				honeycombBillableTokens: 100000,
				calibrationPointCount: 10,
				calibrationConfidencePct: 99,
			};
			render(<DatasourceSummaryCards theme={theme} data={highDivergenceData} />);

			expect(screen.getByText('HIGH')).toBeInTheDocument();
		});

		it('displays calibration count in subtitle', () => {
			render(<DatasourceSummaryCards theme={theme} data={mockData} />);

			expect(screen.getByText('5 calibrations')).toBeInTheDocument();
		});

		it('uses singular calibration for count of 1', () => {
			const singleCalData: DatasourceSummaryData = {
				...mockData,
				calibrationPointCount: 1,
			};
			render(<DatasourceSummaryCards theme={theme} data={singleCalData} />);

			expect(screen.getByText('1 calibration')).toBeInTheDocument();
		});
	});

	describe('Token breakdown tooltips', () => {
		it('shows single breakdown tooltip on hover over Local card', () => {
			render(<DatasourceSummaryCards theme={theme} data={mockData} />);

			const localLabel = screen.getByText('Local');
			const cardWrapper = localLabel.closest('.relative');
			expect(cardWrapper).not.toBeNull();

			fireEvent.mouseEnter(cardWrapper!);

			// Component renders "Billable Tokens" as the header
			expect(screen.getByText('Billable Tokens')).toBeInTheDocument();
			expect(screen.getByText('Input')).toBeInTheDocument();
			expect(screen.getByText('Output')).toBeInTheDocument();
			expect(screen.getByText('Cache Creation')).toBeInTheDocument();
			expect(screen.getByText('Subtotal')).toBeInTheDocument();
		});

		it('shows token values in Local card tooltip', () => {
			render(<DatasourceSummaryCards theme={theme} data={mockData} />);

			const localLabel = screen.getByText('Local');
			const cardWrapper = localLabel.closest('.relative');
			fireEvent.mouseEnter(cardWrapper!);

			// 200000 -> 200.0K (uses 1 decimal in K range)
			expect(screen.getByText('200.0K')).toBeInTheDocument();
			// 100000 -> 100.0K
			expect(screen.getByText('100.0K')).toBeInTheDocument();
			// 15000 -> 15.0K
			expect(screen.getByText('15.0K')).toBeInTheDocument();
		});

		it('shows single breakdown tooltip on hover over Honeycomb card', () => {
			render(<DatasourceSummaryCards theme={theme} data={mockData} />);

			const hcLabel = screen.getByText('Honeycomb');
			const cardWrapper = hcLabel.closest('.relative');
			expect(cardWrapper).not.toBeNull();

			fireEvent.mouseEnter(cardWrapper!);

			expect(screen.getByText('Billable Tokens')).toBeInTheDocument();
		});

		it('shows comparison breakdown tooltip on hover over Divergence card', () => {
			render(<DatasourceSummaryCards theme={theme} data={mockData} />);

			const divLabel = screen.getByText('Δ Divergence');
			const cardWrapper = divLabel.closest('.relative');
			expect(cardWrapper).not.toBeNull();

			fireEvent.mouseEnter(cardWrapper!);

			// Comparison tooltip shows column headers
			// "Local" appears both as a card label and as a comparison column header
			const localElements = screen.getAllByText('Local');
			expect(localElements.length).toBeGreaterThanOrEqual(2);
			expect(screen.getByText('HC')).toBeInTheDocument();
			expect(screen.getByText('Delta')).toBeInTheDocument();
		});

		it('does not show tooltip on hover over Confidence card', () => {
			render(<DatasourceSummaryCards theme={theme} data={mockData} />);

			const confLabel = screen.getByText('Confidence');
			const cardDiv = confLabel.closest('div');
			fireEvent.mouseEnter(cardDiv!);

			expect(screen.queryByText('Billable Tokens')).not.toBeInTheDocument();
			expect(screen.queryByText('HC')).not.toBeInTheDocument();
		});

		it('hides tooltip on mouse leave', () => {
			render(<DatasourceSummaryCards theme={theme} data={mockData} />);

			const localLabel = screen.getByText('Local');
			const cardWrapper = localLabel.closest('.relative');

			fireEvent.mouseEnter(cardWrapper!);
			expect(screen.getByText('Billable Tokens')).toBeInTheDocument();

			fireEvent.mouseLeave(cardWrapper!);
			expect(screen.queryByText('Billable Tokens')).not.toBeInTheDocument();
		});

		it('does not render tooltips when breakdown data is unavailable', () => {
			render(<DatasourceSummaryCards theme={theme} data={mockDataNoBreakdown} />);

			expect(screen.getByText('Local')).toBeInTheDocument();
			expect(screen.getByText('Honeycomb')).toBeInTheDocument();

			const localLabel = screen.getByText('Local');
			const relativeWrapper = localLabel.closest('.relative');
			expect(relativeWrapper).toBeNull();
		});
	});

	describe('Honeycomb free token fields', () => {
		it('includes honeycomb free token fields in hcBreakdown when present', () => {
			const data: DatasourceSummaryData = {
				...mockData,
				honeycombFreeInputTokens: 200_000,
				honeycombFreeOutputTokens: 100_000,
				honeycombFreeCacheCreationTokens: 50_000,
				honeycombFreeTotalTokens: 350_000,
			};
			// Renders without errors when HC free token fields are populated
			const { container } = render(<DatasourceSummaryCards theme={theme} data={data} />);
			const cards = container.querySelectorAll('.rounded-lg');
			expect(cards.length).toBe(4);
		});

		it('shows Free Tokens section in HC card tooltip when free tokens are present', () => {
			const data: DatasourceSummaryData = {
				...mockData,
				honeycombFreeInputTokens: 200_000,
				honeycombFreeOutputTokens: 100_000,
				honeycombFreeCacheCreationTokens: 50_000,
				honeycombFreeTotalTokens: 350_000,
			};
			render(<DatasourceSummaryCards theme={theme} data={data} />);

			const hcLabel = screen.getByText('Honeycomb');
			const cardWrapper = hcLabel.closest('.relative');
			fireEvent.mouseEnter(cardWrapper!);

			expect(screen.getByText('Free Tokens (Local Models)')).toBeInTheDocument();
		});

		it('does NOT show Free Tokens section in HC card when free tokens are zero', () => {
			const data: DatasourceSummaryData = {
				...mockData,
				honeycombFreeInputTokens: 0,
				honeycombFreeOutputTokens: 0,
				honeycombFreeCacheCreationTokens: 0,
				honeycombFreeTotalTokens: 0,
			};
			render(<DatasourceSummaryCards theme={theme} data={data} />);

			const hcLabel = screen.getByText('Honeycomb');
			const cardWrapper = hcLabel.closest('.relative');
			fireEvent.mouseEnter(cardWrapper!);

			expect(screen.queryByText('Free Tokens (Local Models)')).not.toBeInTheDocument();
		});

		it('includes local free token fields in localBreakdown when present', () => {
			const data: DatasourceSummaryData = {
				...mockData,
				localFreeInputTokens: 500_000,
				localFreeOutputTokens: 200_000,
				localFreeCacheCreationTokens: 100_000,
				localFreeTotalTokens: 800_000,
			};
			const { container } = render(<DatasourceSummaryCards theme={theme} data={data} />);
			const cards = container.querySelectorAll('.rounded-lg');
			expect(cards.length).toBe(4);
		});
	});
});
