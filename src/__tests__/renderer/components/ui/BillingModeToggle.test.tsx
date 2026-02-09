/**
 * @fileoverview Tests for BillingModeToggle component
 * Tests: Toggle button group rendering, selection, detected mode display
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BillingModeToggle } from '../../../../renderer/components/ui/BillingModeToggle';
import type { Theme } from '../../../../renderer/types';

// =============================================================================
// TEST HELPERS
// =============================================================================

function createMockTheme(): Theme {
	return {
		id: 'test-theme',
		name: 'Test Theme',
		colors: {
			bgMain: '#1a1a1a',
			bgSidebar: '#252525',
			bgActivity: '#333333',
			textMain: '#ffffff',
			textDim: '#888888',
			accent: '#6366f1',
			accentDim: '#4f46e5',
			border: '#333333',
			success: '#22c55e',
			error: '#ef4444',
			warning: '#f59e0b',
			contextFree: '#22c55e',
			contextMedium: '#f59e0b',
			contextHigh: '#ef4444',
		},
	};
}

// =============================================================================
// TESTS
// =============================================================================

describe('BillingModeToggle', () => {
	describe('Rendering', () => {
		it('should render all three toggle options', () => {
			render(<BillingModeToggle theme={createMockTheme()} value="auto" onChange={vi.fn()} />);

			expect(screen.getByText('Auto')).toBeInTheDocument();
			expect(screen.getByText('Max')).toBeInTheDocument();
			expect(screen.getByText('API')).toBeInTheDocument();
		});

		it('should highlight the selected option', () => {
			const theme = createMockTheme();
			render(<BillingModeToggle theme={theme} value="max" onChange={vi.fn()} />);

			const maxButton = screen.getByText('Max');
			// Check that the button has the active background color
			expect(maxButton).toHaveStyle({ backgroundColor: theme.colors.accentDim });
		});
	});

	describe('Selection', () => {
		it('should call onChange when a different option is clicked', () => {
			const onChange = vi.fn();
			render(<BillingModeToggle theme={createMockTheme()} value="auto" onChange={onChange} />);

			fireEvent.click(screen.getByText('Max'));
			expect(onChange).toHaveBeenCalledWith('max');
		});

		it('should call onChange when clicking API', () => {
			const onChange = vi.fn();
			render(<BillingModeToggle theme={createMockTheme()} value="auto" onChange={onChange} />);

			fireEvent.click(screen.getByText('API'));
			expect(onChange).toHaveBeenCalledWith('api');
		});

		it('should not call onChange when disabled', () => {
			const onChange = vi.fn();
			render(
				<BillingModeToggle theme={createMockTheme()} value="auto" onChange={onChange} disabled />
			);

			fireEvent.click(screen.getByText('Max'));
			expect(onChange).not.toHaveBeenCalled();
		});
	});

	describe('Detected mode indicator', () => {
		it('should show detected mode when Auto is selected and showDetected is true', () => {
			render(
				<BillingModeToggle
					theme={createMockTheme()}
					value="auto"
					detectedMode="max"
					onChange={vi.fn()}
					showDetected
				/>
			);

			expect(screen.getByText('Detected: Max')).toBeInTheDocument();
		});

		it('should show detected API mode', () => {
			render(
				<BillingModeToggle
					theme={createMockTheme()}
					value="auto"
					detectedMode="api"
					onChange={vi.fn()}
					showDetected
				/>
			);

			expect(screen.getByText('Detected: API')).toBeInTheDocument();
		});

		it('should NOT show detected mode when showDetected is false', () => {
			render(
				<BillingModeToggle
					theme={createMockTheme()}
					value="auto"
					detectedMode="max"
					onChange={vi.fn()}
					showDetected={false}
				/>
			);

			expect(screen.queryByText('Detected: Max')).not.toBeInTheDocument();
		});

		it('should NOT show detected mode when not in Auto mode', () => {
			render(
				<BillingModeToggle
					theme={createMockTheme()}
					value="max"
					detectedMode="api"
					onChange={vi.fn()}
					showDetected
				/>
			);

			expect(screen.queryByText('Detected: API')).not.toBeInTheDocument();
		});

		it('should NOT show detected mode when detectedMode is undefined', () => {
			render(
				<BillingModeToggle theme={createMockTheme()} value="auto" onChange={vi.fn()} showDetected />
			);

			expect(screen.queryByText(/Detected:/)).not.toBeInTheDocument();
		});
	});

	describe('Disabled state', () => {
		it('should apply disabled styling when disabled', () => {
			render(
				<BillingModeToggle theme={createMockTheme()} value="auto" onChange={vi.fn()} disabled />
			);

			const autoButton = screen.getByText('Auto');
			expect(autoButton).toHaveClass('opacity-50');
			expect(autoButton).toHaveClass('cursor-not-allowed');
		});
	});

	describe('Loading state', () => {
		it('should show loading indicator when loading is true', () => {
			render(
				<BillingModeToggle theme={createMockTheme()} value="auto" onChange={vi.fn()} loading />
			);

			expect(screen.getByText('Loading...')).toBeInTheDocument();
		});

		it('should not show detected mode when loading', () => {
			render(
				<BillingModeToggle
					theme={createMockTheme()}
					value="auto"
					detectedMode="max"
					onChange={vi.fn()}
					showDetected
					loading
				/>
			);

			expect(screen.queryByText('Detected: Max')).not.toBeInTheDocument();
			expect(screen.getByText('Loading...')).toBeInTheDocument();
		});

		it('should apply disabled styling when loading', () => {
			render(
				<BillingModeToggle theme={createMockTheme()} value="auto" onChange={vi.fn()} loading />
			);

			const autoButton = screen.getByText('Auto');
			expect(autoButton).toHaveClass('opacity-50');
			expect(autoButton).toHaveClass('cursor-not-allowed');
		});

		it('should not call onChange when loading', () => {
			const onChange = vi.fn();
			render(
				<BillingModeToggle theme={createMockTheme()} value="auto" onChange={onChange} loading />
			);

			fireEvent.click(screen.getByText('Max'));
			expect(onChange).not.toHaveBeenCalled();
		});
	});
});
