/**
 * PinPreviewPopover.tsx
 *
 * Hover popover for pin cards in PinnedPanel.
 * Shows full message content rendered as markdown to the left of the sidebar.
 * Links within the content are clickable via MarkdownRenderer.
 *
 * Uses createPortal to render at document body level, avoiding overflow clipping
 * from the RightPanel's overflow-x-hidden container.
 *
 * The popover is fully interactive — user can hover over it and scroll its content.
 * A short leave-delay allows the mouse to "bridge" the gap between card and popover.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { MarkdownRenderer } from './MarkdownRenderer';
import type { Theme, PinnedItem } from '../types';

interface PinPreviewPopoverProps {
	theme: Theme;
	pin: PinnedItem;
	children: React.ReactNode;
	/** Whether the popover is enabled (disabled during unpin confirmation) */
	enabled?: boolean;
}

const POPOVER_WIDTH = 420;
const POPOVER_MAX_HEIGHT = 360;
const POPOVER_GAP = 8;
const ENTER_DELAY = 300;
const LEAVE_DELAY = 150;

export function PinPreviewPopover({
	theme,
	pin,
	children,
	enabled = true,
}: PinPreviewPopoverProps): JSX.Element {
	const [isVisible, setIsVisible] = useState(false);
	const [popoverPos, setPopoverPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
	const containerRef = useRef<HTMLDivElement>(null);
	const popoverRef = useRef<HTMLDivElement>(null);
	const enterTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const leaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const cancelEnter = useCallback(() => {
		if (enterTimeoutRef.current) {
			clearTimeout(enterTimeoutRef.current);
			enterTimeoutRef.current = null;
		}
	}, []);

	const cancelLeave = useCallback(() => {
		if (leaveTimeoutRef.current) {
			clearTimeout(leaveTimeoutRef.current);
			leaveTimeoutRef.current = null;
		}
	}, []);

	const scheduleShow = useCallback(() => {
		if (!enabled) return;
		cancelLeave();
		if (isVisible) return; // Already showing
		enterTimeoutRef.current = setTimeout(() => {
			setIsVisible(true);
		}, ENTER_DELAY);
	}, [enabled, isVisible, cancelLeave]);

	const scheduleHide = useCallback(() => {
		cancelEnter();
		leaveTimeoutRef.current = setTimeout(() => {
			setIsVisible(false);
		}, LEAVE_DELAY);
	}, [cancelEnter]);

	// Card hover handlers
	const handleCardEnter = useCallback(() => {
		scheduleShow();
	}, [scheduleShow]);

	const handleCardLeave = useCallback(() => {
		scheduleHide();
	}, [scheduleHide]);

	// Popover hover handlers — entering the popover cancels the hide
	const handlePopoverEnter = useCallback(() => {
		cancelLeave();
	}, [cancelLeave]);

	const handlePopoverLeave = useCallback(() => {
		scheduleHide();
	}, [scheduleHide]);

	// Clean up timeouts on unmount
	useEffect(() => {
		return () => {
			cancelEnter();
			cancelLeave();
		};
	}, [cancelEnter, cancelLeave]);

	// Calculate position based on the pin card's screen coordinates
	useEffect(() => {
		if (isVisible && containerRef.current) {
			const rect = containerRef.current.getBoundingClientRect();

			// Position to the left of the pin card
			let left = rect.left - POPOVER_WIDTH - POPOVER_GAP;

			// If not enough space to the left, position to overlap slightly
			if (left < 8) {
				left = 8;
			}

			// Vertical: align top of popover with top of pin card
			let top = rect.top;

			// If popover would go off the bottom of the screen, adjust
			if (top + POPOVER_MAX_HEIGHT > window.innerHeight - 16) {
				top = window.innerHeight - POPOVER_MAX_HEIGHT - 16;
			}

			// Don't go above the viewport
			if (top < 8) {
				top = 8;
			}

			setPopoverPos({ top, left });
		}
	}, [isVisible]);

	const copyToClipboard = useCallback((text: string) => {
		navigator.clipboard.writeText(text);
	}, []);

	// Only show popover for messages longer than what the card shows (roughly > 150 chars)
	const shouldShowPopover = pin.text.length > 150;

	return (
		<div ref={containerRef} onMouseEnter={handleCardEnter} onMouseLeave={handleCardLeave}>
			{children}
			{isVisible &&
				shouldShowPopover &&
				createPortal(
					<div
						ref={popoverRef}
						className="rounded-lg shadow-xl border flex flex-col"
						style={{
							position: 'fixed',
							top: popoverPos.top,
							left: popoverPos.left,
							width: POPOVER_WIDTH,
							maxHeight: POPOVER_MAX_HEIGHT,
							zIndex: 9999,
							backgroundColor: theme.colors.bgMain,
							borderColor: theme.colors.border,
						}}
						onMouseEnter={handlePopoverEnter}
						onMouseLeave={handlePopoverLeave}
					>
						{/* Header */}
						<div
							className="px-3 py-2 text-xs font-medium border-b flex items-center gap-2 shrink-0"
							style={{
								borderColor: theme.colors.border,
								backgroundColor: theme.colors.bgSidebar,
								color: theme.colors.textDim,
							}}
						>
							<span className="uppercase">
								{pin.source === 'user' ? 'Your Message' : 'AI Response'}
							</span>
							<span className="ml-auto">
								{new Date(pin.messageTimestamp).toLocaleTimeString([], {
									hour: '2-digit',
									minute: '2-digit',
								})}
							</span>
						</div>

						{/* Scrollable content */}
						<div
							className="overflow-y-auto p-3 prose-sm scrollbar-thin"
							style={{
								maxHeight: POPOVER_MAX_HEIGHT - 50,
								color: theme.colors.textMain,
							}}
						>
							<MarkdownRenderer content={pin.text} theme={theme} onCopy={copyToClipboard} />
						</div>
					</div>,
					document.body
				)}
		</div>
	);
}
