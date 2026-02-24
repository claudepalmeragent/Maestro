/**
 * PinAutocomplete.tsx
 *
 * Dropdown that appears when user types {{ in the chat input.
 * Shows available pins with previews, allowing selection by arrow keys + Tab/Enter.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Pin } from 'lucide-react';
import type { Theme, PinnedItem } from '../types';

interface PinAutocompleteProps {
	theme: Theme;
	pins: PinnedItem[];
	/** The partial text after {{ (e.g., "PIN:" or "PIN:err" or just "") */
	partial: string;
	/** Called when user selects a pin — inserts the full variable syntax */
	onSelect: (variableSyntax: string) => void;
	/** Called when autocomplete should close */
	onClose: () => void;
	/** Position relative to the input area */
	position: { bottom: number; left: number };
}

export function PinAutocomplete({
	theme,
	pins,
	partial,
	onSelect,
	onClose,
	position,
}: PinAutocompleteProps): JSX.Element | null {
	const [selectedIndex, setSelectedIndex] = useState(0);
	const listRef = useRef<HTMLDivElement>(null);

	// Sort pins by pinnedAt ascending (same as PinnedPanel) for stable indices
	const sortedPins = useMemo(() => [...pins].sort((a, b) => a.pinnedAt - b.pinnedAt), [pins]);

	// Filter pins based on partial input
	const filteredPins = useMemo(() => {
		if (!partial || partial === 'PIN:' || partial === 'PIN') {
			return sortedPins; // Show all pins
		}

		const afterPrefix = partial.replace(/^PIN:/, '').replace(/^"/, '').replace(/"$/, '');
		if (!afterPrefix) return sortedPins;

		const query = afterPrefix.toLowerCase();

		// Filter by index or text content
		return sortedPins.filter((pin, i) => {
			const index = i + 1;
			if (String(index).startsWith(query)) return true;
			return pin.text.toLowerCase().includes(query);
		});
	}, [sortedPins, partial]);

	// Reset selection when filtered list changes
	useEffect(() => {
		setSelectedIndex(0);
	}, [filteredPins.length]);

	// Handle keyboard navigation
	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			switch (e.key) {
				case 'ArrowDown':
					e.preventDefault();
					setSelectedIndex((prev) => Math.min(prev + 1, filteredPins.length - 1));
					break;
				case 'ArrowUp':
					e.preventDefault();
					setSelectedIndex((prev) => Math.max(prev - 1, 0));
					break;
				case 'Tab':
				case 'Enter':
					e.preventDefault();
					if (filteredPins[selectedIndex]) {
						const pin = filteredPins[selectedIndex];
						const pinIndex = sortedPins.indexOf(pin) + 1;
						onSelect(`PIN:${pinIndex}}}`);
					}
					break;
				case 'Escape':
					e.preventDefault();
					onClose();
					break;
			}
		},
		[filteredPins, selectedIndex, sortedPins, onSelect, onClose]
	);

	useEffect(() => {
		window.addEventListener('keydown', handleKeyDown, true);
		return () => window.removeEventListener('keydown', handleKeyDown, true);
	}, [handleKeyDown]);

	// Scroll selected item into view
	useEffect(() => {
		const selected = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
		selected?.scrollIntoView({ block: 'nearest' });
	}, [selectedIndex]);

	if (filteredPins.length === 0) {
		return (
			<div
				className="absolute z-50 w-80 rounded-lg border shadow-xl overflow-hidden"
				style={{
					bottom: position.bottom,
					left: position.left,
					backgroundColor: theme.colors.bgSidebar,
					borderColor: theme.colors.border,
				}}
			>
				<div className="p-3 text-xs text-center" style={{ color: theme.colors.textDim }}>
					No pins available. Pin messages first using the pin button.
				</div>
			</div>
		);
	}

	const truncate = (text: string, max: number) =>
		text.length > max ? text.slice(0, max).trimEnd() + '\u2026' : text;

	return (
		<div
			className="absolute z-50 w-96 rounded-lg border shadow-xl overflow-hidden"
			style={{
				bottom: position.bottom,
				left: position.left,
				backgroundColor: theme.colors.bgSidebar,
				borderColor: theme.colors.border,
			}}
		>
			{/* Header */}
			<div
				className="px-3 py-2 text-xs font-medium border-b flex items-center gap-2"
				style={{ borderColor: theme.colors.border, color: theme.colors.textDim }}
			>
				<Pin className="w-3 h-3" />
				Insert Pin Reference
				<span className="ml-auto opacity-60">
					{'\u2191\u2193'} navigate {'·'} Tab/Enter select {'·'} Esc close
				</span>
			</div>

			{/* Pin list */}
			<div ref={listRef} className="max-h-60 overflow-y-auto scrollbar-thin">
				{filteredPins.map((pin, displayIdx) => {
					const stableIndex = sortedPins.indexOf(pin) + 1;
					const isSelected = displayIdx === selectedIndex;
					return (
						<div
							key={pin.logId}
							data-index={displayIdx}
							className="px-3 py-2 cursor-pointer transition-colors"
							style={{
								backgroundColor: isSelected ? theme.colors.accent + '20' : 'transparent',
							}}
							onClick={() => onSelect(`PIN:${stableIndex}}}`)}
							onMouseEnter={() => setSelectedIndex(displayIdx)}
						>
							<div className="flex items-center gap-2">
								<span
									className="text-[10px] font-mono font-bold px-1 rounded shrink-0"
									style={{
										backgroundColor: theme.colors.accent + '20',
										color: theme.colors.accent,
									}}
								>
									#{stableIndex}
								</span>
								<span
									className="text-[10px] uppercase shrink-0"
									style={{ color: theme.colors.textDim }}
								>
									{pin.source === 'user' ? 'You' : 'AI'}
								</span>
								<span
									className="text-xs truncate"
									style={{ color: isSelected ? theme.colors.textMain : theme.colors.textDim }}
								>
									{truncate(pin.text, 80)}
								</span>
							</div>
							{/* Preview when selected */}
							{isSelected && (
								<div
									className="mt-1 ml-6 text-[10px] font-mono p-2 rounded border max-h-20 overflow-y-auto"
									style={{
										backgroundColor: theme.colors.bgMain,
										borderColor: theme.colors.border,
										color: theme.colors.textMain,
									}}
								>
									{truncate(pin.text, 300)}
								</div>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
