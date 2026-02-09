/**
 * @fileoverview Tests for AgentConfigPanel component
 * Tests: Built-in environment variables display, custom env vars, agent configuration
 *
 * Regression test for: MAESTRO_SESSION_RESUMED env var display in group chat moderator customization
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentConfigPanel } from '../../../../renderer/components/shared/AgentConfigPanel';
import type { Theme, AgentConfig } from '../../../../renderer/types';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
	RefreshCw: ({ className }: { className?: string }) => (
		<span data-testid="refresh-icon" className={className}>
			🔄
		</span>
	),
	Plus: ({ className }: { className?: string }) => (
		<span data-testid="plus-icon" className={className}>
			+
		</span>
	),
	Trash2: ({ className }: { className?: string }) => (
		<span data-testid="trash-icon" className={className}>
			🗑
		</span>
	),
	HelpCircle: ({ className }: { className?: string }) => (
		<span data-testid="help-circle-icon" className={className}>
			?
		</span>
	),
	ChevronDown: ({ className }: { className?: string }) => (
		<span data-testid="chevron-down-icon" className={className}>
			▼
		</span>
	),
	AlertTriangle: ({ className }: { className?: string }) => (
		<span data-testid="alert-triangle-icon" className={className}>
			⚠
		</span>
	),
}));

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

function createMockAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		id: 'claude-code',
		name: 'Claude Code',
		available: true,
		path: '/usr/local/bin/claude',
		binaryName: 'claude',
		hidden: false,
		...overrides,
	};
}

function createDefaultProps(overrides: Partial<Parameters<typeof AgentConfigPanel>[0]> = {}) {
	return {
		theme: createMockTheme(),
		agent: createMockAgent(),
		customPath: '',
		onCustomPathChange: vi.fn(),
		onCustomPathBlur: vi.fn(),
		onCustomPathClear: vi.fn(),
		customArgs: '',
		onCustomArgsChange: vi.fn(),
		onCustomArgsBlur: vi.fn(),
		onCustomArgsClear: vi.fn(),
		customEnvVars: {},
		onEnvVarKeyChange: vi.fn(),
		onEnvVarValueChange: vi.fn(),
		onEnvVarRemove: vi.fn(),
		onEnvVarAdd: vi.fn(),
		onEnvVarsBlur: vi.fn(),
		agentConfig: {},
		onConfigChange: vi.fn(),
		onConfigBlur: vi.fn(),
		...overrides,
	};
}

// =============================================================================
// BUILT-IN ENVIRONMENT VARIABLES TESTS
// =============================================================================

describe('AgentConfigPanel', () => {
	describe('Built-in environment variables (MAESTRO_SESSION_RESUMED)', () => {
		it('should NOT display MAESTRO_SESSION_RESUMED when showBuiltInEnvVars is false (default)', () => {
			render(<AgentConfigPanel {...createDefaultProps()} />);

			// MAESTRO_SESSION_RESUMED should NOT be visible
			expect(screen.queryByText('MAESTRO_SESSION_RESUMED')).not.toBeInTheDocument();
		});

		it('should NOT display MAESTRO_SESSION_RESUMED when showBuiltInEnvVars is explicitly false', () => {
			render(<AgentConfigPanel {...createDefaultProps({ showBuiltInEnvVars: false })} />);

			// MAESTRO_SESSION_RESUMED should NOT be visible
			expect(screen.queryByText('MAESTRO_SESSION_RESUMED')).not.toBeInTheDocument();
		});

		it('should display MAESTRO_SESSION_RESUMED when showBuiltInEnvVars is true', () => {
			render(<AgentConfigPanel {...createDefaultProps({ showBuiltInEnvVars: true })} />);

			// MAESTRO_SESSION_RESUMED should be visible
			expect(screen.getByText('MAESTRO_SESSION_RESUMED')).toBeInTheDocument();
		});

		it('should display the value hint for MAESTRO_SESSION_RESUMED', () => {
			render(<AgentConfigPanel {...createDefaultProps({ showBuiltInEnvVars: true })} />);

			// Value hint should be displayed
			expect(screen.getByText('1 (when resuming)')).toBeInTheDocument();
		});

		it('should display a help icon for MAESTRO_SESSION_RESUMED tooltip', () => {
			render(<AgentConfigPanel {...createDefaultProps({ showBuiltInEnvVars: true })} />);

			// Help icon should be present
			expect(screen.getByTestId('help-circle-icon')).toBeInTheDocument();
		});
	});

	describe('Custom environment variables', () => {
		it('should render custom env vars', () => {
			const customEnvVars = {
				MY_VAR: 'my_value',
				ANOTHER_VAR: 'another_value',
			};

			render(<AgentConfigPanel {...createDefaultProps({ customEnvVars })} />);

			// Input fields for custom env vars should be present
			// The key inputs should have the var names as values
			const inputs = screen.getAllByRole('textbox');
			const keyInputs = inputs.filter(
				(input) =>
					(input as HTMLInputElement).value === 'MY_VAR' ||
					(input as HTMLInputElement).value === 'ANOTHER_VAR'
			);
			expect(keyInputs.length).toBe(2);
		});

		it('should show Add Variable button', () => {
			render(<AgentConfigPanel {...createDefaultProps()} />);

			expect(screen.getByText('Add Variable')).toBeInTheDocument();
		});

		it('should display both built-in and custom env vars when showBuiltInEnvVars is true', () => {
			const customEnvVars = {
				CUSTOM_VAR: 'custom_value',
			};

			render(
				<AgentConfigPanel {...createDefaultProps({ showBuiltInEnvVars: true, customEnvVars })} />
			);

			// Built-in should be visible
			expect(screen.getByText('MAESTRO_SESSION_RESUMED')).toBeInTheDocument();

			// Custom var should also be in an input
			const inputs = screen.getAllByRole('textbox');
			const customKeyInput = inputs.find(
				(input) => (input as HTMLInputElement).value === 'CUSTOM_VAR'
			);
			expect(customKeyInput).toBeDefined();
		});
	});

	describe('Agent configuration sections', () => {
		it('should render path input pre-filled with detected path', () => {
			render(<AgentConfigPanel {...createDefaultProps()} />);

			expect(screen.getByText('Path')).toBeInTheDocument();
			// The input should be pre-filled with the detected path
			const pathInput = screen.getByDisplayValue('/usr/local/bin/claude');
			expect(pathInput).toBeInTheDocument();
		});

		it('should show custom path when provided, not detected path', () => {
			render(
				<AgentConfigPanel {...createDefaultProps({ customPath: '/custom/path/to/claude' })} />
			);

			// The input should show the custom path
			const pathInput = screen.getByDisplayValue('/custom/path/to/claude');
			expect(pathInput).toBeInTheDocument();
		});

		it('should show Reset button when custom path differs from detected path', () => {
			render(
				<AgentConfigPanel {...createDefaultProps({ customPath: '/custom/path/to/claude' })} />
			);

			expect(screen.getByText('Reset')).toBeInTheDocument();
		});

		it('should NOT show Reset button when custom path matches detected path', () => {
			render(<AgentConfigPanel {...createDefaultProps({ customPath: '/usr/local/bin/claude' })} />);

			expect(screen.queryByText('Reset')).not.toBeInTheDocument();
		});

		it('should NOT show Reset button when no custom path is set', () => {
			render(<AgentConfigPanel {...createDefaultProps({ customPath: '' })} />);

			expect(screen.queryByText('Reset')).not.toBeInTheDocument();
		});

		it('should render custom arguments input section', () => {
			render(<AgentConfigPanel {...createDefaultProps()} />);

			expect(screen.getByText('Custom Arguments (optional)')).toBeInTheDocument();
		});

		it('should render environment variables section', () => {
			render(<AgentConfigPanel {...createDefaultProps()} />);

			expect(screen.getByText('Environment Variables (optional)')).toBeInTheDocument();
		});
	});

	describe('Billing mode section (Claude agents only)', () => {
		it('should show billing mode section for Claude Code agent with onBillingModeChange', () => {
			render(
				<AgentConfigPanel
					{...createDefaultProps({
						agent: createMockAgent({ id: 'claude-code' }),
						onBillingModeChange: vi.fn(),
					})}
				/>
			);

			expect(screen.getByText('Billing Mode')).toBeInTheDocument();
			expect(screen.getByText('Auto')).toBeInTheDocument();
			expect(screen.getByText('Max')).toBeInTheDocument();
			expect(screen.getByText('API')).toBeInTheDocument();
		});

		it('should NOT show billing mode section for non-Claude agents', () => {
			render(
				<AgentConfigPanel
					{...createDefaultProps({
						agent: createMockAgent({ id: 'opencode' }),
						onBillingModeChange: vi.fn(),
					})}
				/>
			);

			expect(screen.queryByText('Billing Mode')).not.toBeInTheDocument();
		});

		it('should NOT show billing mode section without onBillingModeChange handler', () => {
			render(
				<AgentConfigPanel
					{...createDefaultProps({
						agent: createMockAgent({ id: 'claude-code' }),
						// No onBillingModeChange
					})}
				/>
			);

			expect(screen.queryByText('Billing Mode')).not.toBeInTheDocument();
		});

		it('should show detected mode indicator when in Auto mode', () => {
			render(
				<AgentConfigPanel
					{...createDefaultProps({
						agent: createMockAgent({ id: 'claude-code' }),
						onBillingModeChange: vi.fn(),
						pricingConfig: { billingMode: 'auto', pricingModel: 'auto' },
						detectedAuth: { billingMode: 'max', source: 'oauth', detectedAt: Date.now() },
					})}
				/>
			);

			expect(screen.getByText('Detected: Max')).toBeInTheDocument();
		});

		it('should show folder inheritance indicator when Auto mode and folder has config', () => {
			render(
				<AgentConfigPanel
					{...createDefaultProps({
						agent: createMockAgent({ id: 'claude-code' }),
						onBillingModeChange: vi.fn(),
						pricingConfig: { billingMode: 'auto', pricingModel: 'auto' },
						folderPricingConfig: { billingMode: 'max' },
					})}
				/>
			);

			expect(screen.getByText(/Inheriting.*Max.*from project folder/)).toBeInTheDocument();
		});

		it('should NOT show folder inheritance indicator when not in Auto mode', () => {
			render(
				<AgentConfigPanel
					{...createDefaultProps({
						agent: createMockAgent({ id: 'claude-code' }),
						onBillingModeChange: vi.fn(),
						pricingConfig: { billingMode: 'api', pricingModel: 'auto' },
						folderPricingConfig: { billingMode: 'max' },
					})}
				/>
			);

			expect(screen.queryByText(/Inheriting/)).not.toBeInTheDocument();
		});

		it('should show mismatch warning when selection differs from detected', () => {
			render(
				<AgentConfigPanel
					{...createDefaultProps({
						agent: createMockAgent({ id: 'claude-code' }),
						onBillingModeChange: vi.fn(),
						pricingConfig: { billingMode: 'api', pricingModel: 'auto' },
						detectedAuth: { billingMode: 'max', source: 'oauth', detectedAt: Date.now() },
					})}
				/>
			);

			expect(
				screen.getByText(/logged in with Claude Max but selected API pricing/)
			).toBeInTheDocument();
			expect(screen.getByTestId('alert-triangle-icon')).toBeInTheDocument();
		});

		it('should show correct warning when Max is selected but API key is used', () => {
			render(
				<AgentConfigPanel
					{...createDefaultProps({
						agent: createMockAgent({ id: 'claude-code' }),
						onBillingModeChange: vi.fn(),
						pricingConfig: { billingMode: 'max', pricingModel: 'auto' },
						detectedAuth: { billingMode: 'api', source: 'api_key', detectedAt: Date.now() },
					})}
				/>
			);

			expect(screen.getByText(/using an API key but selected Max pricing/)).toBeInTheDocument();
		});

		it('should NOT show mismatch warning when in Auto mode', () => {
			render(
				<AgentConfigPanel
					{...createDefaultProps({
						agent: createMockAgent({ id: 'claude-code' }),
						onBillingModeChange: vi.fn(),
						pricingConfig: { billingMode: 'auto', pricingModel: 'auto' },
						detectedAuth: { billingMode: 'max', source: 'oauth', detectedAt: Date.now() },
					})}
				/>
			);

			expect(screen.queryByText(/logged in with Claude Max/)).not.toBeInTheDocument();
			expect(screen.queryByText(/using an API key/)).not.toBeInTheDocument();
		});

		it('should NOT show mismatch warning when selection matches detected', () => {
			render(
				<AgentConfigPanel
					{...createDefaultProps({
						agent: createMockAgent({ id: 'claude-code' }),
						onBillingModeChange: vi.fn(),
						pricingConfig: { billingMode: 'max', pricingModel: 'auto' },
						detectedAuth: { billingMode: 'max', source: 'oauth', detectedAt: Date.now() },
					})}
				/>
			);

			expect(screen.queryByText(/logged in with Claude Max/)).not.toBeInTheDocument();
			expect(screen.queryByText(/using an API key/)).not.toBeInTheDocument();
		});

		it('should show help text for billing modes', () => {
			render(
				<AgentConfigPanel
					{...createDefaultProps({
						agent: createMockAgent({ id: 'claude-code' }),
						onBillingModeChange: vi.fn(),
					})}
				/>
			);

			expect(screen.getByText(/Max: Cache tokens are free/)).toBeInTheDocument();
			expect(screen.getByText(/API: All tokens charged at model rates/)).toBeInTheDocument();
		});
	});

	describe('Pricing model section (Claude agents only)', () => {
		it('should show pricing model section for Claude Code agent with onPricingModelChange', () => {
			render(
				<AgentConfigPanel
					{...createDefaultProps({
						agent: createMockAgent({ id: 'claude-code' }),
						onPricingModelChange: vi.fn(),
					})}
				/>
			);

			expect(screen.getByText('Pricing Model')).toBeInTheDocument();
			expect(screen.getByText('Auto-detect')).toBeInTheDocument();
		});

		it('should NOT show pricing model section for non-Claude agents', () => {
			render(
				<AgentConfigPanel
					{...createDefaultProps({
						agent: createMockAgent({ id: 'opencode' }),
						onPricingModelChange: vi.fn(),
					})}
				/>
			);

			expect(screen.queryByText('Pricing Model')).not.toBeInTheDocument();
		});

		it('should NOT show pricing model section without onPricingModelChange handler', () => {
			render(
				<AgentConfigPanel
					{...createDefaultProps({
						agent: createMockAgent({ id: 'claude-code' }),
						// No onPricingModelChange
					})}
				/>
			);

			expect(screen.queryByText('Pricing Model')).not.toBeInTheDocument();
		});

		it('should show detected model indicator when in Auto mode', () => {
			render(
				<AgentConfigPanel
					{...createDefaultProps({
						agent: createMockAgent({ id: 'claude-code' }),
						onPricingModelChange: vi.fn(),
						pricingConfig: {
							billingMode: 'auto',
							pricingModel: 'auto',
							detectedModel: 'claude-opus-4-5-20251101',
						},
					})}
				/>
			);

			expect(screen.getByText('Detected: Opus 4.5')).toBeInTheDocument();
		});

		it('should NOT show detected model indicator when model is manually set', () => {
			render(
				<AgentConfigPanel
					{...createDefaultProps({
						agent: createMockAgent({ id: 'claude-code' }),
						onPricingModelChange: vi.fn(),
						pricingConfig: {
							billingMode: 'auto',
							pricingModel: 'claude-sonnet-4-20250514',
							detectedModel: 'claude-opus-4-5-20251101',
						},
					})}
				/>
			);

			expect(screen.queryByText(/Detected:/)).not.toBeInTheDocument();
		});

		it('should show help text for pricing model', () => {
			render(
				<AgentConfigPanel
					{...createDefaultProps({
						agent: createMockAgent({ id: 'claude-code' }),
						onPricingModelChange: vi.fn(),
					})}
				/>
			);

			expect(
				screen.getByText(/Override the detected model for cost calculations/)
			).toBeInTheDocument();
		});
	});
});
