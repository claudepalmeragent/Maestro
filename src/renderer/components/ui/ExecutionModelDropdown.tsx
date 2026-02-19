/**
 * ExecutionModelDropdown.tsx
 *
 * Dropdown component for selecting Claude Code execution model.
 * Mirrors the styling, grouping, and ordering of PricingModelDropdown.
 * Shows forward-looking "Active" model indicator when in default mode.
 *
 * Used in AgentConfigPanel and InputArea for Claude Code agents.
 */

import { useState, useEffect, memo, useMemo } from 'react';
import type { Theme } from '../../types';

export interface ExecutionModelDropdownProps {
	/** Theme for styling */
	theme: Theme;
	/** Current selected value (empty string = default/auto) */
	value: string;
	/** Forward-looking active model that will be used for the next query */
	activeModel?: string;
	/** Callback when selection changes */
	onChange: (model: string) => void;
	/** Whether the dropdown is disabled */
	disabled?: boolean;
	/** Compact mode for InputArea (smaller padding) */
	compact?: boolean;
}

interface ModelOption {
	value: string;
	label: string;
	family?: string;
}

// Module-level cache for model options (fetched once from main process)
let cachedModelOptions: ModelOption[] | null = null;

/**
 * Hook to fetch model options from the main process model registry.
 * Uses the same getModelOptions() IPC call as PricingModelDropdown.
 * Results are cached at the module level so they're only fetched once.
 */
function useModelOptions(): ModelOption[] {
	const [options, setOptions] = useState<ModelOption[]>(cachedModelOptions || []);

	useEffect(() => {
		if (cachedModelOptions) return;

		window.maestro.updates
			.getModelOptions()
			.then((fetched) => {
				const modelOptions: ModelOption[] = fetched.map((opt) => ({
					value: opt.value,
					label: opt.label,
					family: opt.family,
				}));
				cachedModelOptions = modelOptions;
				setOptions(modelOptions);
			})
			.catch((err) => {
				console.error('Failed to fetch execution model options:', err);
			});
	}, []);

	return options;
}

function ExecutionModelDropdownInner({
	theme,
	value,
	activeModel,
	onChange,
	disabled = false,
	compact = false,
}: ExecutionModelDropdownProps): JSX.Element {
	const MODEL_OPTIONS = useModelOptions();

	function formatModelName(modelId: string): string {
		// Exact match on full model ID
		const exact = MODEL_OPTIONS.find((opt) => opt.value === modelId);
		if (exact) return exact.label;
		// Prefix match: handles short-form IDs without date suffix (e.g., 'claude-opus-4-6')
		const prefixMatch = MODEL_OPTIONS.find((opt) => opt.value.startsWith(modelId));
		if (prefixMatch) return prefixMatch.label;
		return modelId;
	}

	// Group models by family for optgroup rendering (same as PricingModelDropdown)
	const groupedOptions = useMemo(() => {
		const opus = MODEL_OPTIONS.filter((opt) => opt.family === 'opus');
		const sonnet = MODEL_OPTIONS.filter((opt) => opt.family === 'sonnet');
		const haiku = MODEL_OPTIONS.filter((opt) => opt.family === 'haiku');
		return { opus, sonnet, haiku };
	}, [MODEL_OPTIONS]);

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-2">
				<select
					value={value}
					onChange={(e) => !disabled && onChange(e.target.value)}
					disabled={disabled}
					className={`flex-1 ${compact ? 'p-1' : 'p-2'} rounded border bg-transparent outline-none text-xs ${
						disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
					}`}
					style={{
						borderColor: theme.colors.border,
						color: theme.colors.textMain,
						backgroundColor: compact ? 'transparent' : theme.colors.bgMain,
					}}
				>
					{/* Default option */}
					<option value="">Default</option>
					{/* Opus family */}
					{groupedOptions.opus.length > 0 && (
						<optgroup label="Opus">
							{groupedOptions.opus.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</optgroup>
					)}
					{/* Sonnet family */}
					{groupedOptions.sonnet.length > 0 && (
						<optgroup label="Sonnet">
							{groupedOptions.sonnet.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</optgroup>
					)}
					{/* Haiku family */}
					{groupedOptions.haiku.length > 0 && (
						<optgroup label="Haiku">
							{groupedOptions.haiku.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</optgroup>
					)}
				</select>
				{/* Active model indicator */}
				{activeModel && (
					<span
						className="text-xs px-2 py-0.5 rounded whitespace-nowrap"
						style={{
							color: theme.colors.textDim,
							backgroundColor: theme.colors.bgActivity,
						}}
					>
						Active: {formatModelName(activeModel)}
					</span>
				)}
			</div>
		</div>
	);
}

export const ExecutionModelDropdown = memo(ExecutionModelDropdownInner);
