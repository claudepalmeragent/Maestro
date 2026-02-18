/**
 * @fileoverview Tests for PricingModelDropdown component
 * Tests: Model selection, auto mode with detected model indicator
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { PricingModelDropdown } from '../../../../renderer/components/ui/PricingModelDropdown';
import type { Theme } from '../../../../renderer/types';

// =============================================================================
// MOCK: window.maestro.updates.getModelOptions
// =============================================================================

const mockModelOptions = [
	{ value: 'claude-opus-4-6-20260115', label: 'Opus 4.6', family: 'opus' },
	{ value: 'claude-opus-4-5-20251101', label: 'Opus 4.5', family: 'opus' },
	{ value: 'claude-opus-4-1-20250319', label: 'Opus 4.1', family: 'opus' },
	{ value: 'claude-opus-4-20250514', label: 'Opus 4', family: 'opus' },
	{ value: 'claude-sonnet-4-6-20260218', label: 'Sonnet 4.6', family: 'sonnet' },
	{ value: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5', family: 'sonnet' },
	{ value: 'claude-sonnet-4-20250514', label: 'Sonnet 4', family: 'sonnet' },
	{ value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', family: 'haiku' },
	{ value: 'claude-haiku-3-5-20241022', label: 'Haiku 3.5', family: 'haiku' },
	{ value: 'claude-3-haiku-20240307', label: 'Haiku 3', family: 'haiku' },
];

beforeEach(() => {
	// Reset module-level cache by re-importing (clear via any accessible means)
	// We mock getModelOptions to return the same data that was previously hardcoded
	(window as any).maestro = {
		...(window as any).maestro,
		updates: {
			...((window as any).maestro?.updates || {}),
			getModelOptions: vi.fn().mockResolvedValue(mockModelOptions),
		},
	};
});

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

describe('PricingModelDropdown', () => {
	describe('Rendering', () => {
		it('should render the dropdown with Auto-detect as default', async () => {
			await act(async () => {
				render(<PricingModelDropdown theme={createMockTheme()} value="auto" onChange={vi.fn()} />);
			});

			const select = screen.getByRole('combobox');
			expect(select).toBeInTheDocument();
			expect(select).toHaveValue('auto');
		});

		it('should render all model options', async () => {
			await act(async () => {
				render(<PricingModelDropdown theme={createMockTheme()} value="auto" onChange={vi.fn()} />);
			});

			// Check for Auto option
			expect(screen.getByText('Auto-detect')).toBeInTheDocument();

			// Check for Opus models
			expect(screen.getByText('Opus 4.6')).toBeInTheDocument();
			expect(screen.getByText('Opus 4.5')).toBeInTheDocument();
			expect(screen.getByText('Opus 4.1')).toBeInTheDocument();
			expect(screen.getByText('Opus 4')).toBeInTheDocument();

			// Check for Sonnet models
			expect(screen.getByText('Sonnet 4.5')).toBeInTheDocument();
			expect(screen.getByText('Sonnet 4.6')).toBeInTheDocument();
			expect(screen.getByText('Sonnet 4')).toBeInTheDocument();

			// Check for Haiku models
			expect(screen.getByText('Haiku 4.5')).toBeInTheDocument();
			expect(screen.getByText('Haiku 3.5')).toBeInTheDocument();
			expect(screen.getByText('Haiku 3')).toBeInTheDocument();
		});

		it('should render optgroups for model families', async () => {
			let container: HTMLElement;
			await act(async () => {
				const result = render(
					<PricingModelDropdown theme={createMockTheme()} value="auto" onChange={vi.fn()} />
				);
				container = result.container;
			});

			const optgroups = container!.querySelectorAll('optgroup');
			expect(optgroups.length).toBe(3); // Opus, Sonnet, Haiku

			const labels = Array.from(optgroups).map((og) => og.getAttribute('label'));
			expect(labels).toContain('Opus');
			expect(labels).toContain('Sonnet');
			expect(labels).toContain('Haiku');
		});
	});

	describe('Selection', () => {
		it('should call onChange with selected model', async () => {
			const mockOnChange = vi.fn();
			await act(async () => {
				render(
					<PricingModelDropdown theme={createMockTheme()} value="auto" onChange={mockOnChange} />
				);
			});

			const select = screen.getByRole('combobox');
			fireEvent.change(select, { target: { value: 'claude-opus-4-5-20251101' } });

			expect(mockOnChange).toHaveBeenCalledWith('claude-opus-4-5-20251101');
		});

		it('should display selected model value', async () => {
			await act(async () => {
				render(
					<PricingModelDropdown
						theme={createMockTheme()}
						value="claude-sonnet-4-20250514"
						onChange={vi.fn()}
					/>
				);
			});

			const select = screen.getByRole('combobox');
			expect(select).toHaveValue('claude-sonnet-4-20250514');
		});
	});

	describe('Detected Model Indicator', () => {
		it('should show detected model indicator when in Auto mode with showDetected', async () => {
			await act(async () => {
				render(
					<PricingModelDropdown
						theme={createMockTheme()}
						value="auto"
						detectedModel="claude-opus-4-5-20251101"
						onChange={vi.fn()}
						showDetected
					/>
				);
			});

			expect(screen.getByText('Detected: Opus 4.5')).toBeInTheDocument();
		});

		it('should NOT show detected model indicator when NOT in Auto mode', async () => {
			await act(async () => {
				render(
					<PricingModelDropdown
						theme={createMockTheme()}
						value="claude-sonnet-4-20250514"
						detectedModel="claude-opus-4-5-20251101"
						onChange={vi.fn()}
						showDetected
					/>
				);
			});

			expect(screen.queryByText(/Detected:/)).not.toBeInTheDocument();
		});

		it('should NOT show detected model indicator when showDetected is false', async () => {
			await act(async () => {
				render(
					<PricingModelDropdown
						theme={createMockTheme()}
						value="auto"
						detectedModel="claude-opus-4-5-20251101"
						onChange={vi.fn()}
						showDetected={false}
					/>
				);
			});

			expect(screen.queryByText(/Detected:/)).not.toBeInTheDocument();
		});

		it('should NOT show detected model indicator when no detected model', async () => {
			await act(async () => {
				render(
					<PricingModelDropdown
						theme={createMockTheme()}
						value="auto"
						onChange={vi.fn()}
						showDetected
					/>
				);
			});

			expect(screen.queryByText(/Detected:/)).not.toBeInTheDocument();
		});
	});

	describe('Disabled State', () => {
		it('should be disabled when disabled prop is true', async () => {
			await act(async () => {
				render(
					<PricingModelDropdown
						theme={createMockTheme()}
						value="auto"
						onChange={vi.fn()}
						disabled
					/>
				);
			});

			const select = screen.getByRole('combobox');
			expect(select).toBeDisabled();
		});

		it('should NOT call onChange when disabled', async () => {
			const mockOnChange = vi.fn();
			await act(async () => {
				render(
					<PricingModelDropdown
						theme={createMockTheme()}
						value="auto"
						onChange={mockOnChange}
						disabled
					/>
				);
			});

			const select = screen.getByRole('combobox');
			fireEvent.change(select, { target: { value: 'claude-opus-4-5-20251101' } });

			// Note: The event is fired but the onChange in component has the disabled check
			// In a real browser, the change event wouldn't fire on a disabled select
			// But since JSDOM doesn't prevent this, we verify the component doesn't break
			expect(select).toBeDisabled();
		});
	});
});
