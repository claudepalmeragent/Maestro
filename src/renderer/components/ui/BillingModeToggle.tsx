/**
 * BillingModeToggle.tsx
 *
 * Toggle component for selecting Claude billing mode (Auto/Max/API).
 * Shows detected mode indicator when in Auto mode.
 *
 * Used in AgentConfigPanel for Claude agents only.
 */

import { memo } from 'react';
import type { Theme } from '../../types';
import type { ClaudeBillingMode } from '../../../shared/types';

export type BillingModeValue = 'auto' | ClaudeBillingMode;

export interface BillingModeToggleProps {
	/** Theme for styling */
	theme: Theme;
	/** Current selected value */
	value: BillingModeValue;
	/** Detected billing mode from credentials (shown when Auto is selected) */
	detectedMode?: ClaudeBillingMode;
	/** Callback when selection changes */
	onChange: (mode: BillingModeValue) => void;
	/** Whether the toggle is disabled */
	disabled?: boolean;
	/** Whether to show the detected mode indicator */
	showDetected?: boolean;
	/** Whether the billing mode is being loaded */
	loading?: boolean;
}

interface ToggleOption {
	value: BillingModeValue;
	label: string;
	description: string;
}

const BILLING_MODE_OPTIONS: ToggleOption[] = [
	{
		value: 'auto',
		label: 'Auto',
		description: 'Uses detected/inherited value',
	},
	{
		value: 'max',
		label: 'Max',
		description: 'Claude Max subscription (cache free)',
	},
	{
		value: 'api',
		label: 'API',
		description: 'Per-token API pricing',
	},
];

function BillingModeToggleInner({
	theme,
	value,
	detectedMode,
	onChange,
	disabled = false,
	showDetected = false,
	loading = false,
}: BillingModeToggleProps): JSX.Element {
	const isDisabled = disabled || loading;

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-2">
				<div
					className="flex rounded border overflow-hidden"
					style={{ borderColor: theme.colors.border }}
				>
					{BILLING_MODE_OPTIONS.map((option) => {
						const isActive = value === option.value;
						return (
							<button
								key={option.value}
								onClick={() => !isDisabled && onChange(option.value)}
								disabled={isDisabled}
								className={`px-3 py-1.5 text-xs font-medium transition-all ${
									isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
								}`}
								style={{
									backgroundColor: isActive ? theme.colors.accentDim : 'transparent',
									color: isActive ? theme.colors.textMain : theme.colors.textDim,
									borderRight:
										option.value !== 'api' ? `1px solid ${theme.colors.border}` : undefined,
								}}
								title={option.description}
							>
								{option.label}
							</button>
						);
					})}
				</div>
				{/* Loading indicator */}
				{loading && (
					<span
						className="text-xs px-2 py-0.5 rounded animate-pulse"
						style={{
							color: theme.colors.textDim,
							backgroundColor: theme.colors.bgActivity,
						}}
					>
						Loading...
					</span>
				)}
				{/* Detected mode indicator */}
				{!loading && showDetected && value === 'auto' && detectedMode && (
					<span
						className="text-xs px-2 py-0.5 rounded"
						style={{
							color: theme.colors.textDim,
							backgroundColor: theme.colors.bgActivity,
						}}
					>
						Detected: {detectedMode === 'max' ? 'Max' : 'API'}
					</span>
				)}
			</div>
		</div>
	);
}

export const BillingModeToggle = memo(BillingModeToggleInner);
