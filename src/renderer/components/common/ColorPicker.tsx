import React, { memo } from 'react';
import { Check, X } from 'lucide-react';
import { PROJECT_FOLDER_COLORS } from '../../../shared/types';
import type { Theme } from '../../types';

export interface ColorPickerProps {
	/** Currently selected color (hex string or undefined for no color) */
	selectedColor: string | undefined;
	/** Callback when a color is selected */
	onColorSelect: (color: string | undefined) => void;
	/** Theme for styling */
	theme: Theme;
	/** Optional: show "No Color" option (default: true) */
	showNoColor?: boolean;
	/** Optional: size variant */
	size?: 'sm' | 'md';
}

/**
 * ColorPicker - Color selection widget using PROJECT_FOLDER_COLORS palette.
 * Used for selecting highlight colors for project folders.
 */
export const ColorPicker = memo(function ColorPicker({
	selectedColor,
	onColorSelect,
	theme,
	showNoColor = true,
	size = 'md',
}: ColorPickerProps) {
	const swatchSize = size === 'sm' ? 'w-6 h-6' : 'w-8 h-8';
	const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';

	return (
		<div className="flex flex-wrap gap-2">
			{/* No color option */}
			{showNoColor && (
				<button
					type="button"
					onClick={() => onColorSelect(undefined)}
					className={`${swatchSize} rounded-full border-2 flex items-center justify-center transition-all hover:scale-110`}
					style={{
						borderColor: selectedColor === undefined ? theme.colors.accent : theme.colors.border,
						backgroundColor: theme.colors.bgActivity,
					}}
					title="No color"
				>
					{selectedColor === undefined ? (
						<Check className={iconSize} style={{ color: theme.colors.accent }} />
					) : (
						<X className={iconSize} style={{ color: theme.colors.textDim }} />
					)}
				</button>
			)}

			{/* Color swatches */}
			{PROJECT_FOLDER_COLORS.map((color) => (
				<button
					key={color.id}
					type="button"
					onClick={() => onColorSelect(color.hex)}
					className={`${swatchSize} rounded-full border-2 flex items-center justify-center transition-all hover:scale-110`}
					style={{
						backgroundColor: color.hex,
						borderColor: selectedColor === color.hex ? theme.colors.textMain : 'transparent',
					}}
					title={color.name}
				>
					{selectedColor === color.hex && <Check className={iconSize} style={{ color: '#fff' }} />}
				</button>
			))}
		</div>
	);
});

export default ColorPicker;
