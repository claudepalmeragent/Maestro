/**
 * DonutGauge
 *
 * Pure SVG donut/ring gauge component. Two modes:
 * - Single-value: one arc with green→yellow→red coloring based on value
 * - Multi-segment: multiple colored arc segments for different data series
 *
 * Uses stroke-dasharray/dashoffset on <circle> elements for arc rendering.
 */

import type { Theme } from '../types';

// ============================================================================
// Types
// ============================================================================

interface DonutGaugeBaseProps {
	/** Diameter of the gauge in pixels (default: 120) */
	size?: number;
	/** Thickness of the ring in pixels (default: 10) */
	thickness?: number;
	/** Label shown below the gauge */
	label: string;
	/** Theme for colors */
	theme: Theme;
}

interface SingleValueProps extends DonutGaugeBaseProps {
	variant: 'single';
	/** Value from 0-100 */
	value: number;
	/** Override color thresholds (default: green <50, yellow <80, red >=80) */
	thresholds?: { warning: number; error: number };
}

interface MultiSegmentProps extends DonutGaugeBaseProps {
	variant: 'multi';
	/** Segments with value (0-100 scale each, summed for total) */
	segments: Array<{ label: string; value: number; color: string }>;
	/** Total percentage to display in center */
	totalPercent: number;
}

type DonutGaugeProps = SingleValueProps | MultiSegmentProps;

// ============================================================================
// Constants
// ============================================================================

/** Fixed palette for model segments */
export const MODEL_COLORS = [
	'#6366f1', // indigo
	'#8b5cf6', // violet
	'#06b6d4', // cyan
	'#f59e0b', // amber
	'#ef4444', // red
	'#10b981', // emerald
	'#ec4899', // pink
	'#3b82f6', // blue
];

// ============================================================================
// Component
// ============================================================================

export function DonutGauge(props: DonutGaugeProps) {
	const { size = 120, thickness = 10, label, theme } = props;

	const radius = (size - thickness) / 2;
	const circumference = 2 * Math.PI * radius;
	const center = size / 2;

	// Determine what to show in center and what arcs to draw
	let centerText: string;
	let arcs: Array<{ offset: number; length: number; color: string }>;

	if (props.variant === 'single') {
		const value = Math.max(0, Math.min(100, props.value));
		const { warning = 50, error: errorThreshold = 80 } = props.thresholds ?? {};
		centerText = `${Math.round(value)}%`;

		const color =
			value >= errorThreshold
				? theme.colors.error
				: value >= warning
					? theme.colors.warning
					: theme.colors.success;

		const arcLength = (value / 100) * circumference;
		arcs = [{ offset: 0, length: arcLength, color }];
	} else {
		centerText = `${Math.round(props.totalPercent)}%`;
		arcs = [];
		let consumed = 0;
		for (const seg of props.segments) {
			const segLength = (seg.value / 100) * circumference;
			arcs.push({ offset: consumed, length: segLength, color: seg.color });
			consumed += segLength;
		}
	}

	// Start from 12 o'clock position (rotate -90deg)
	const rotateOffset = circumference * 0.25;

	return (
		<div className="flex flex-col items-center gap-1">
			<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
				{/* Background track */}
				<circle
					cx={center}
					cy={center}
					r={radius}
					fill="none"
					stroke={`${theme.colors.textDim}20`}
					strokeWidth={thickness}
				/>

				{/* Arc segments */}
				{arcs.map((arc, i) => (
					<circle
						key={i}
						cx={center}
						cy={center}
						r={radius}
						fill="none"
						stroke={arc.color}
						strokeWidth={thickness}
						strokeDasharray={`${arc.length} ${circumference - arc.length}`}
						strokeDashoffset={rotateOffset - arc.offset}
						strokeLinecap="round"
						style={{ transition: 'stroke-dasharray 0.5s ease, stroke-dashoffset 0.5s ease' }}
					/>
				))}

				{/* Center text */}
				<text
					x={center}
					y={center}
					textAnchor="middle"
					dominantBaseline="central"
					fill={theme.colors.textMain}
					fontSize={size * 0.18}
					fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
					fontWeight="600"
				>
					{centerText}
				</text>
			</svg>
			<span className="text-xs font-medium" style={{ color: theme.colors.textDim }}>
				{label}
			</span>
		</div>
	);
}
