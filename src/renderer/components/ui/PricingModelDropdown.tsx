/**
 * PricingModelDropdown.tsx
 *
 * Dropdown component for selecting Claude pricing model override.
 * Shows detected model indicator when in auto mode.
 *
 * Used in AgentConfigPanel for Claude agents only.
 */

import { memo, useMemo } from 'react';
import type { Theme } from '../../types';
import type { ClaudeModelId } from '../../../shared/types';

export type PricingModelValue = 'auto' | ClaudeModelId;

export interface PricingModelDropdownProps {
	/** Theme for styling */
	theme: Theme;
	/** Current selected value */
	value: PricingModelValue;
	/** Detected model from agent output (shown when Auto is selected) */
	detectedModel?: ClaudeModelId;
	/** Callback when selection changes */
	onChange: (model: PricingModelValue) => void;
	/** Whether the dropdown is disabled */
	disabled?: boolean;
	/** Whether to show the detected model indicator */
	showDetected?: boolean;
}

interface ModelOption {
	value: PricingModelValue;
	label: string;
	family?: 'opus' | 'sonnet' | 'haiku';
}

/**
 * Available Claude models for pricing selection.
 * Grouped by family: Opus (most capable), Sonnet (balanced), Haiku (fastest).
 */
const MODEL_OPTIONS: ModelOption[] = [
	{ value: 'auto', label: 'Auto-detect' },
	// Opus family
	{ value: 'claude-opus-4-6-20260115', label: 'Opus 4.6', family: 'opus' },
	{ value: 'claude-opus-4-5-20251101', label: 'Opus 4.5', family: 'opus' },
	{ value: 'claude-opus-4-1-20250319', label: 'Opus 4.1', family: 'opus' },
	{ value: 'claude-opus-4-20250514', label: 'Opus 4', family: 'opus' },
	// Sonnet family
	{ value: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5', family: 'sonnet' },
	{ value: 'claude-sonnet-4-20250514', label: 'Sonnet 4', family: 'sonnet' },
	// Haiku family
	{ value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', family: 'haiku' },
	{ value: 'claude-haiku-3-5-20241022', label: 'Haiku 3.5', family: 'haiku' },
	{ value: 'claude-3-haiku-20240307', label: 'Haiku 3', family: 'haiku' },
];

/**
 * Get human-readable display name for a model ID.
 */
function formatModelName(modelId: ClaudeModelId): string {
	const option = MODEL_OPTIONS.find((opt) => opt.value === modelId);
	return option?.label || modelId;
}

function PricingModelDropdownInner({
	theme,
	value,
	detectedModel,
	onChange,
	disabled = false,
	showDetected = false,
}: PricingModelDropdownProps): JSX.Element {
	// Group models by family for optgroup rendering
	const groupedOptions = useMemo(() => {
		const auto = MODEL_OPTIONS.filter((opt) => opt.value === 'auto');
		const opus = MODEL_OPTIONS.filter((opt) => opt.family === 'opus');
		const sonnet = MODEL_OPTIONS.filter((opt) => opt.family === 'sonnet');
		const haiku = MODEL_OPTIONS.filter((opt) => opt.family === 'haiku');
		return { auto, opus, sonnet, haiku };
	}, []);

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-2">
				<select
					value={value}
					onChange={(e) => !disabled && onChange(e.target.value as PricingModelValue)}
					disabled={disabled}
					className={`flex-1 p-2 rounded border bg-transparent outline-none text-xs ${
						disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
					}`}
					style={{
						borderColor: theme.colors.border,
						color: theme.colors.textMain,
						backgroundColor: theme.colors.bgMain,
					}}
				>
					{/* Auto option */}
					{groupedOptions.auto.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
					{/* Opus family */}
					<optgroup label="Opus">
						{groupedOptions.opus.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</optgroup>
					{/* Sonnet family */}
					<optgroup label="Sonnet">
						{groupedOptions.sonnet.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</optgroup>
					{/* Haiku family */}
					<optgroup label="Haiku">
						{groupedOptions.haiku.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</optgroup>
				</select>
				{/* Detected model indicator */}
				{showDetected && value === 'auto' && detectedModel && (
					<span
						className="text-xs px-2 py-0.5 rounded whitespace-nowrap"
						style={{
							color: theme.colors.textDim,
							backgroundColor: theme.colors.bgActivity,
						}}
					>
						Detected: {formatModelName(detectedModel)}
					</span>
				)}
			</div>
		</div>
	);
}

export const PricingModelDropdown = memo(PricingModelDropdownInner);
