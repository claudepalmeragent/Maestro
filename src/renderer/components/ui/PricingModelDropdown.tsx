/**
 * PricingModelDropdown.tsx
 *
 * Dropdown component for selecting Claude pricing model override.
 * Shows detected model indicator when in auto mode.
 *
 * Used in AgentConfigPanel for Claude agents only.
 */

import { useState, useEffect, memo, useMemo } from 'react';
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

// Module-level cache for model options (fetched once from main process)
let cachedModelOptions: ModelOption[] | null = null;

/**
 * Hook to fetch model options from the main process model registry.
 * Results are cached at the module level so they're only fetched once.
 */
function useModelOptions(): ModelOption[] {
	const [options, setOptions] = useState<ModelOption[]>(cachedModelOptions || []);

	useEffect(() => {
		if (cachedModelOptions) return;

		window.maestro.updates
			.getModelOptions()
			.then((fetched) => {
				const modelOptions: ModelOption[] = [
					{ value: 'auto', label: 'Auto-detect' },
					...fetched.map((opt) => ({
						value: opt.value as PricingModelValue,
						label: opt.label,
						family: opt.family as 'opus' | 'sonnet' | 'haiku',
					})),
				];
				cachedModelOptions = modelOptions;
				setOptions(modelOptions);
			})
			.catch((err) => {
				console.error('Failed to fetch model options:', err);
			});
	}, []);

	return options;
}

function PricingModelDropdownInner({
	theme,
	value,
	detectedModel,
	onChange,
	disabled = false,
	showDetected = false,
}: PricingModelDropdownProps): JSX.Element {
	const MODEL_OPTIONS = useModelOptions();

	function formatModelName(modelId: ClaudeModelId): string {
		const option = MODEL_OPTIONS.find((opt) => opt.value === modelId);
		return option?.label || modelId;
	}

	// Group models by family for optgroup rendering
	const groupedOptions = useMemo(() => {
		const auto = MODEL_OPTIONS.filter((opt) => opt.value === 'auto');
		const opus = MODEL_OPTIONS.filter((opt) => opt.family === 'opus');
		const sonnet = MODEL_OPTIONS.filter((opt) => opt.family === 'sonnet');
		const haiku = MODEL_OPTIONS.filter((opt) => opt.family === 'haiku');
		return { auto, opus, sonnet, haiku };
	}, [MODEL_OPTIONS]);

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
