/**
 * DataSourceToggle.tsx
 *
 * Toggle component for switching between Local (Maestro calculated) and
 * Anthropic (API pricing) data sources in cost graphs.
 *
 * Used in cost visualization components to show different pricing perspectives:
 * - Local: Shows billing-mode adjusted costs (Max subscribers see cache savings)
 * - Anthropic: Shows Anthropic's reported API pricing (no billing mode adjustments)
 */

import { memo } from 'react';
import type { Theme } from '../../types';

export type DataSource = 'local' | 'anthropic';

export interface DataSourceToggleProps {
	/** Theme for styling */
	theme: Theme;
	/** Current selected value */
	value: DataSource;
	/** Callback when selection changes */
	onChange: (value: DataSource) => void;
	/** Optional CSS class name */
	className?: string;
	/** Whether the toggle is disabled */
	disabled?: boolean;
}

interface ToggleOption {
	value: DataSource;
	label: string;
	description: string;
}

const DATA_SOURCE_OPTIONS: ToggleOption[] = [
	{
		value: 'local',
		label: 'Local',
		description: 'Shows billing-mode adjusted costs (Max subscribers see cache savings)',
	},
	{
		value: 'anthropic',
		label: 'Anthropic',
		description: "Shows Anthropic's reported API pricing (no billing mode adjustments)",
	},
];

function DataSourceToggleInner({
	theme,
	value,
	onChange,
	className = '',
	disabled = false,
}: DataSourceToggleProps): JSX.Element {
	return (
		<div className={`flex items-center ${className}`}>
			<div
				className="flex rounded border overflow-hidden"
				style={{ borderColor: theme.colors.border }}
			>
				{DATA_SOURCE_OPTIONS.map((option) => {
					const isActive = value === option.value;
					return (
						<button
							key={option.value}
							onClick={() => !disabled && onChange(option.value)}
							disabled={disabled}
							className={`px-3 py-1 text-xs font-medium transition-all ${
								disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
							}`}
							style={{
								backgroundColor: isActive ? theme.colors.accentDim : 'transparent',
								color: isActive ? theme.colors.textMain : theme.colors.textDim,
								borderRight:
									option.value !== 'anthropic' ? `1px solid ${theme.colors.border}` : undefined,
							}}
							title={option.description}
							aria-pressed={isActive}
							data-testid={`data-source-toggle-${option.value}`}
						>
							{option.label}
						</button>
					);
				})}
			</div>
		</div>
	);
}

export const DataSourceToggle = memo(DataSourceToggleInner);
