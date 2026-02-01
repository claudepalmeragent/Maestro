import React, { memo } from 'react';
import type { ProjectFolder } from '../../../shared/types';

export interface ProjectColorBarsProps {
	/** Array of project folders this item belongs to */
	projectFolders: ProjectFolder[];
	/** Optional: height class override (default: full height via absolute positioning) */
	heightClass?: string;
	/** Optional: whether to show tooltip on hover */
	showTooltip?: boolean;
}

/**
 * ProjectColorBars - Visual indicator showing project folder membership.
 *
 * Displays multiple thin vertical color bars at the left edge of a session item,
 * one bar per project folder the session belongs to.
 *
 * Usage:
 * - Place as an absolutely positioned child within a relative container
 * - Bars are 2px wide each, stacked horizontally
 * - Only shows bars for folders that have a highlightColor set
 */
export const ProjectColorBars = memo(function ProjectColorBars({
	projectFolders,
	heightClass,
	showTooltip = true,
}: ProjectColorBarsProps) {
	// Filter to only folders with highlight colors
	const coloredFolders = projectFolders.filter((f) => f.highlightColor);

	if (coloredFolders.length === 0) {
		return null;
	}

	// Build tooltip text
	const tooltipText = showTooltip ? coloredFolders.map((f) => f.name).join(', ') : undefined;

	return (
		<div className={`absolute left-0 top-0 bottom-0 flex ${heightClass || ''}`} title={tooltipText}>
			{coloredFolders.map((folder) => (
				<div
					key={folder.id}
					className="w-0.5 h-full"
					style={{ backgroundColor: folder.highlightColor }}
				/>
			))}
		</div>
	);
});

/**
 * ProjectColorBar - Single color bar for use in other contexts.
 * E.g., group headers, group chat items.
 */
export interface ProjectColorBarProps {
	/** The highlight color (hex string) */
	color: string | undefined;
	/** Width of the bar in pixels (default: 3) */
	width?: number;
}

export const ProjectColorBar = memo(function ProjectColorBar({
	color,
	width = 3,
}: ProjectColorBarProps) {
	if (!color) {
		return null;
	}

	return (
		<div
			className="absolute left-0 top-0 bottom-0"
			style={{
				width: `${width}px`,
				backgroundColor: color,
			}}
		/>
	);
});

export default ProjectColorBars;
