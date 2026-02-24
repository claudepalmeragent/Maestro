/**
 * PinnedPanel.tsx
 *
 * Right sidebar panel that displays pinned chat messages for the active AI tab.
 * Supports click-to-scroll-to-message and double-click-X to unpin.
 */

import { useState, useMemo, useCallback } from 'react';
import { Pin, X, User, Bot, Search } from 'lucide-react';
import type { Theme, PinnedItem } from '../types';

interface PinnedPanelProps {
	theme: Theme;
	pinnedItems: PinnedItem[];
	onUnpinMessage: (logId: string) => void;
	onScrollToMessage: (timestamp: number) => void;
	pinCount: number;
	pinLimit: number;
}

export function PinnedPanel({
	theme,
	pinnedItems,
	onUnpinMessage,
	onScrollToMessage,
	pinCount,
	pinLimit,
}: PinnedPanelProps): JSX.Element {
	const [unpinConfirmId, setUnpinConfirmId] = useState<string | null>(null);
	const [searchQuery, setSearchQuery] = useState('');

	// Sort by pinnedAt ascending (oldest first) and optionally filter by search
	const sortedPins = useMemo(() => {
		const sorted = [...pinnedItems].sort((a, b) => a.pinnedAt - b.pinnedAt);
		if (!searchQuery.trim()) return sorted;
		const query = searchQuery.toLowerCase().trim();
		return sorted.filter((pin) => pin.text.toLowerCase().includes(query));
	}, [pinnedItems, searchQuery]);

	// Full sorted list (without search filter) for stable index numbers
	const allSortedPins = useMemo(
		() => [...pinnedItems].sort((a, b) => a.pinnedAt - b.pinnedAt),
		[pinnedItems]
	);

	const handleUnpinClick = useCallback(
		(logId: string) => {
			if (unpinConfirmId === logId) {
				// Second click — actually unpin
				onUnpinMessage(logId);
				setUnpinConfirmId(null);
			} else {
				// First click — show confirmation state
				setUnpinConfirmId(logId);
				// Auto-dismiss after 3 seconds
				setTimeout(() => setUnpinConfirmId((prev) => (prev === logId ? null : prev)), 3000);
			}
		},
		[unpinConfirmId, onUnpinMessage]
	);

	const handleScrollTo = useCallback(
		(timestamp: number) => {
			onScrollToMessage(timestamp);
		},
		[onScrollToMessage]
	);

	const truncateText = (text: string, maxLen: number): string => {
		if (text.length <= maxLen) return text;
		return text.slice(0, maxLen).trimEnd() + '\u2026';
	};

	return (
		<div className="flex flex-col h-full">
			{/* Header with count */}
			<div
				className="flex items-center justify-between py-3 mb-2"
				style={{ color: theme.colors.textMain }}
			>
				<div className="flex items-center gap-2">
					<Pin className="w-4 h-4" style={{ color: theme.colors.accent }} />
					<span className="text-sm font-semibold">Pinned Messages</span>
				</div>
				<span
					className="text-xs px-2 py-0.5 rounded-full"
					style={{
						backgroundColor:
							pinCount >= pinLimit ? theme.colors.warning + '30' : theme.colors.accent + '20',
						color: pinCount >= pinLimit ? theme.colors.warning : theme.colors.accent,
					}}
				>
					{pinCount}/{pinLimit}
				</span>
			</div>

			{/* Search input */}
			{pinnedItems.length > 0 && (
				<div className="relative mb-2">
					<Search
						className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5"
						style={{ color: theme.colors.textDim }}
					/>
					<input
						type="text"
						placeholder="Search pins..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						className="w-full pl-8 pr-3 py-1.5 text-xs rounded border outline-none focus:ring-1"
						style={{
							backgroundColor: theme.colors.bgMain,
							borderColor: theme.colors.border,
							color: theme.colors.textMain,
						}}
					/>
				</div>
			)}

			{/* Pin limit warning */}
			{pinCount >= pinLimit && (
				<div
					className="text-xs px-3 py-2 mb-2 rounded border"
					style={{
						backgroundColor: theme.colors.warning + '10',
						borderColor: theme.colors.warning + '30',
						color: theme.colors.warning,
					}}
				>
					Pin limit reached ({pinLimit}). Unpin items to add more.
				</div>
			)}

			{/* Empty state */}
			{sortedPins.length === 0 && !searchQuery && (
				<div
					className="flex flex-col items-center justify-center py-12 text-center"
					style={{ color: theme.colors.textDim }}
				>
					<Pin className="w-8 h-8 mb-3 opacity-30" />
					<p className="text-sm">No pinned messages</p>
					<p className="text-xs mt-1 opacity-70">
						Click the pin icon on any message to pin it here
					</p>
				</div>
			)}

			{/* Search no-results state */}
			{sortedPins.length === 0 && searchQuery && (
				<div
					className="flex flex-col items-center justify-center py-8 text-center"
					style={{ color: theme.colors.textDim }}
				>
					<Search className="w-6 h-6 mb-2 opacity-30" />
					<p className="text-sm">No pins match &ldquo;{searchQuery}&rdquo;</p>
					<button
						onClick={() => setSearchQuery('')}
						className="text-xs mt-2 underline hover:opacity-80"
						style={{ color: theme.colors.accent }}
					>
						Clear search
					</button>
				</div>
			)}

			{/* Pin list */}
			<div className="flex-1 overflow-y-auto space-y-2 scrollbar-thin">
				{sortedPins.map((pin) => {
					// Stable index from the full (unfiltered) sorted list
					const pinIndex = allSortedPins.findIndex((p) => p.logId === pin.logId) + 1;
					return (
						<div
							key={pin.logId}
							className="group relative p-3 rounded-lg border cursor-pointer hover:brightness-110 transition-all"
							style={{
								backgroundColor: theme.colors.bgActivity,
								borderColor:
									unpinConfirmId === pin.logId ? theme.colors.warning : theme.colors.border,
							}}
							onClick={() => handleScrollTo(pin.messageTimestamp)}
							title="Click to scroll to message"
						>
							{/* Source indicator with pin index */}
							<div className="flex items-center gap-1.5 mb-1">
								<span
									className="text-[10px] font-mono font-bold px-1 rounded"
									style={{
										backgroundColor: theme.colors.accent + '20',
										color: theme.colors.accent,
									}}
									title={`Pin #${pinIndex} — use {{PIN:${pinIndex}}} to reference`}
								>
									#{pinIndex}
								</span>
								{pin.source === 'user' ? (
									<User className="w-3 h-3" style={{ color: theme.colors.accent }} />
								) : (
									<Bot className="w-3 h-3" style={{ color: theme.colors.textDim }} />
								)}
								<span
									className="text-[10px] font-medium uppercase"
									style={{ color: theme.colors.textDim }}
								>
									{pin.source === 'user' ? 'You' : 'AI'}
								</span>
								<span className="text-[10px] ml-auto" style={{ color: theme.colors.textDim }}>
									{new Date(pin.messageTimestamp).toLocaleTimeString([], {
										hour: '2-digit',
										minute: '2-digit',
									})}
								</span>
							</div>

							{/* Message preview */}
							<p
								className="text-xs leading-relaxed line-clamp-3"
								style={{ color: theme.colors.textMain }}
							>
								{truncateText(pin.text, 200)}
							</p>

							{/* Unpin button (X with double-click confirmation) */}
							<button
								onClick={(e) => {
									e.stopPropagation();
									handleUnpinClick(pin.logId);
								}}
								className={`absolute top-2 right-2 p-1 rounded transition-all ${
									unpinConfirmId === pin.logId
										? 'opacity-100'
										: 'opacity-0 group-hover:opacity-50 hover:!opacity-100'
								}`}
								style={{
									color: unpinConfirmId === pin.logId ? theme.colors.warning : theme.colors.textDim,
									backgroundColor:
										unpinConfirmId === pin.logId ? theme.colors.warning + '20' : 'transparent',
								}}
								title={unpinConfirmId === pin.logId ? 'Click again to unpin' : 'Unpin message'}
							>
								<X className="w-3.5 h-3.5" />
							</button>
						</div>
					);
				})}
			</div>
		</div>
	);
}
