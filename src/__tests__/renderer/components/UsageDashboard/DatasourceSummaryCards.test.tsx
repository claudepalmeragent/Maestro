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
			// effective = 80 * min(1, 2/5) = 80 * 0.4 = 32 ≤ 50 → LOW with old values
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
			// Old formula would show LOW due to high divergence; new formula ignores divergence
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

			// Find the Local card text and hover over its wrapper
			const localLabel = screen.getByText('Local');
			const cardWrapper = localLabel.closest('.relative');
			expect(cardWrapper).not.toBeNull();

			fireEvent.mouseEnter(cardWrapper!);

			expect(screen.getByText('Token Breakdown')).toBeInTheDocument();
			expect(screen.getByText('Input')).toBeInTheDocument();
			expect(screen.getByText('Output')).toBeInTheDocument();
			expect(screen.getByText('Cache Creation')).toBeInTheDocument();
			expect(screen.getByText('Billable Total')).toBeInTheDocument();
		});

		it('shows token values in Local card tooltip', () => {
			render(<DatasourceSummaryCards theme={theme} data={mockData} />);

			const localLabel = screen.getByText('Local');
			const cardWrapper = localLabel.closest('.relative');
			fireEvent.mouseEnter(cardWrapper!);

			// 200000 -> 200.0K
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

			expect(screen.getByText('Token Breakdown')).toBeInTheDocument();
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
			// Confidence card has no .relative wrapper since no breakdown/comparison
			const cardDiv = confLabel.closest('div');
			fireEvent.mouseEnter(cardDiv!);

			// No tooltip content should appear
			expect(screen.queryByText('Token Breakdown')).not.toBeInTheDocument();
			expect(screen.queryByText('HC')).not.toBeInTheDocument();
		});

		it('hides tooltip on mouse leave', () => {
			render(<DatasourceSummaryCards theme={theme} data={mockData} />);

			const localLabel = screen.getByText('Local');
			const cardWrapper = localLabel.closest('.relative');

			fireEvent.mouseEnter(cardWrapper!);
			expect(screen.getByText('Token Breakdown')).toBeInTheDocument();

			fireEvent.mouseLeave(cardWrapper!);
			expect(screen.queryByText('Token Breakdown')).not.toBeInTheDocument();
		});

		it('does not render tooltips when breakdown data is unavailable', () => {
			render(<DatasourceSummaryCards theme={theme} data={mockDataNoBreakdown} />);

			// Cards should still render
			expect(screen.getByText('Local')).toBeInTheDocument();
			expect(screen.getByText('Honeycomb')).toBeInTheDocument();

			// No .relative wrappers since no tooltips (TokenBreakdownTooltip renders children directly)
			const localLabel = screen.getByText('Local');
			const relativeWrapper = localLabel.closest('.relative');
			// When no breakdown, TokenBreakdownTooltip renders children directly without .relative wrapper
			expect(relativeWrapper).toBeNull();
		});
	});
});
