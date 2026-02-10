/**
 * CostByModelGraph
 *
 * Horizontal bar chart showing cost breakdown by model with dual data source support.
 * Allows toggling between Local (Maestro calculated) and Anthropic (API pricing) data.
 *
 * Features:
 * - Horizontal bar chart sorted by cost (descending)
 * - X-axis: cost in USD
 * - Y-axis: model names (truncated for display)
 * - DataSourceToggle for switching between Local and Anthropic data
 * - Tooltip showing exact values on hover
 * - Theme-aware colors
 * - Distinct colors per model
 */

import React, { useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { Theme } from '../../types';
import type { StatsTimeRange } from '../../hooks/useStats';
import { DataSourceToggle, type DataSource } from '../ui/DataSourceToggle';

// Tooltip positioning constants
const TOOLTIP_OFFSET = 12; // pixels gap between tooltip and cursor

// Data point for the chart
export interface ModelCostData {
	model: string;
	localCost: number;
	anthropicCost: number;
	savings: number;
}

interface ChartDataPoint {
	model: string;
	displayModel: string;
	cost: number;
	savings: number;
	color: string;
}

interface CostByModelGraphProps {
	/** Model cost data from the API */
	data: ModelCostData[];
	/** Current time range selection */
	timeRange: StatsTimeRange;
	/** Current theme for styling */
	theme: Theme;
	/** Optional title override */
	title?: string;
	/** Optional height override */
	height?: number;
}

// Color palette for models (distinct, accessible colors)
const MODEL_COLORS = [
	'#3b82f6', // blue
	'#10b981', // emerald
	'#f59e0b', // amber
	'#ef4444', // red
	'#8b5cf6', // violet
	'#ec4899', // pink
	'#06b6d4', // cyan
	'#84cc16', // lime
];

/**
 * Format currency value
 */
function formatCurrency(value: number): string {
	return `$${value.toFixed(2)}`;
}

/**
 * Format model name for display (shorten long names)
 */
function formatModelName(model: string): string {
	return model
		.replace('claude-', '')
		.replace('-20251101', '')
		.replace('-20250929', '')
		.replace('-20251001', '')
		.replace('-20241022', '')
		.replace('-20240229', '');
}

export function CostByModelGraph({
	data,
	timeRange: _timeRange,
	theme,
	title = 'Cost by Model',
	height = 300,
}: CostByModelGraphProps): React.ReactElement {
	const [dataSource, setDataSource] = useState<DataSource>('local');
	const [hoveredModel, setHoveredModel] = useState<ChartDataPoint | null>(null);
	const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

	// Chart dimensions
	const chartWidth = 600;
	const chartHeight = height;
	const padding = { top: 20, right: 40, bottom: 40, left: 120 };
	const innerWidth = chartWidth - padding.left - padding.right;
	const innerHeight = chartHeight - padding.top - padding.bottom;

	// Process data for the chart
	const chartData = useMemo((): ChartDataPoint[] => {
		if (data.length === 0) return [];

		return data
			.map((d, index) => ({
				model: d.model,
				displayModel: formatModelName(d.model),
				cost: dataSource === 'local' ? d.localCost : d.anthropicCost,
				savings: d.savings,
				color: MODEL_COLORS[index % MODEL_COLORS.length],
			}))
			.sort((a, b) => b.cost - a.cost);
	}, [data, dataSource]);

	// Calculate max cost for bar width scaling
	const maxCost = useMemo(() => {
		if (chartData.length === 0) return 0;
		return Math.max(...chartData.map((d) => d.cost), 0.01);
	}, [chartData]);

	// Calculate total cost
	const totalCost = useMemo(() => {
		return chartData.reduce((sum, d) => sum + d.cost, 0);
	}, [chartData]);

	// Calculate scales
	const { xScale, yScale, xTicks } = useMemo(() => {
		const barHeight = Math.min(
			30,
			Math.max(15, (innerHeight - (chartData.length - 1) * 4) / Math.max(chartData.length, 1))
		);
		const totalBarHeight = chartData.length * barHeight + (chartData.length - 1) * 4;
		const yOffset = (innerHeight - totalBarHeight) / 2;

		// X scale - linear from 0 to max cost
		const xScaleFn = (value: number) => padding.left + (value / maxCost) * innerWidth;

		// Y scale - position for each bar
		const yScaleFn = (index: number) => padding.top + yOffset + index * (barHeight + 4);

		// Generate nice X-axis ticks
		const tickCount = 5;
		const xMax = maxCost * 1.1;
		const xTicksArr = Array.from({ length: tickCount }, (_, i) => (xMax / (tickCount - 1)) * i);

		return { xScale: xScaleFn, yScale: yScaleFn, xTicks: xTicksArr, barHeight };
	}, [chartData, maxCost, innerWidth, innerHeight, padding]);

	// Bar height calculated in scales
	const barHeight = useMemo(() => {
		if (chartData.length === 0) return 30;
		return Math.min(
			30,
			Math.max(15, (innerHeight - (chartData.length - 1) * 4) / Math.max(chartData.length, 1))
		);
	}, [chartData.length, innerHeight]);

	// Handle mouse events for tooltip
	const handleMouseEnter = useCallback(
		(point: ChartDataPoint, event: React.MouseEvent<SVGRectElement>) => {
			setHoveredModel(point);
			setTooltipPos({
				x: event.clientX,
				y: event.clientY,
			});
		},
		[]
	);

	const handleMouseLeave = useCallback(() => {
		setHoveredModel(null);
		setTooltipPos(null);
	}, []);

	return (
		<div
			className="p-4 rounded-lg"
			style={{ backgroundColor: theme.colors.bgMain }}
			role="figure"
			aria-label={`Cost by model chart showing ${dataSource === 'local' ? 'local (Maestro calculated)' : 'Anthropic API'} costs. ${chartData.length} models displayed.`}
		>
			{/* Header with title and data source toggle */}
			<div className="flex items-center justify-between mb-4">
				<div>
					<h3 className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
						{title}
					</h3>
					<div className="text-sm" style={{ color: theme.colors.textDim }}>
						Total: {formatCurrency(totalCost)}
					</div>
				</div>
				<DataSourceToggle theme={theme} value={dataSource} onChange={setDataSource} />
			</div>

			{/* Chart container */}
			<div className="relative">
				{chartData.length === 0 ? (
					<div
						className="flex items-center justify-center"
						style={{ height: chartHeight, color: theme.colors.textDim }}
					>
						<span className="text-sm">No cost data available</span>
					</div>
				) : (
					<svg
						width="100%"
						viewBox={`0 0 ${chartWidth} ${chartHeight}`}
						preserveAspectRatio="xMidYMid meet"
						role="img"
						aria-label={`Horizontal bar chart of costs by model. ${chartData.length > 0 ? `Range from ${formatCurrency(Math.min(...chartData.map((d) => d.cost)))} to ${formatCurrency(Math.max(...chartData.map((d) => d.cost)))}` : 'No data available'}`}
					>
						{/* Vertical grid lines */}
						{xTicks.map((tick, idx) => (
							<g key={`tick-${idx}`}>
								{/* Vertical grid line */}
								<line
									x1={xScale(tick)}
									y1={padding.top}
									x2={xScale(tick)}
									y2={chartHeight - padding.bottom}
									stroke={theme.colors.border}
									strokeOpacity={0.3}
									strokeDasharray="4,4"
								/>
								{/* X-axis label */}
								<text
									x={xScale(tick)}
									y={chartHeight - padding.bottom + 20}
									textAnchor="middle"
									fontSize={10}
									fill={theme.colors.textDim}
								>
									{formatCurrency(tick)}
								</text>
							</g>
						))}

						{/* Bars */}
						{chartData.map((point, idx) => {
							const barWidth = (point.cost / maxCost) * innerWidth;
							const y = yScale(idx);
							const isHovered = hoveredModel?.model === point.model;

							return (
								<g key={`bar-${point.model}`}>
									{/* Y-axis label (model name) */}
									<text
										x={padding.left - 8}
										y={y + barHeight / 2}
										textAnchor="end"
										dominantBaseline="middle"
										fontSize={11}
										fill={isHovered ? theme.colors.textMain : theme.colors.textDim}
										style={{ transition: 'fill 0.15s ease' }}
									>
										{point.displayModel}
									</text>

									{/* Bar */}
									<rect
										x={padding.left}
										y={y}
										width={Math.max(barWidth, 2)}
										height={barHeight}
										fill={point.color}
										rx={2}
										style={{
											cursor: 'pointer',
											opacity: isHovered ? 1 : 0.85,
											transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.15s ease',
										}}
										onMouseEnter={(e) => handleMouseEnter(point, e)}
										onMouseLeave={handleMouseLeave}
										role="graphics-symbol"
										aria-label={`${point.model}: Cost ${formatCurrency(point.cost)}${point.savings > 0 ? `, Saved ${formatCurrency(point.savings)}` : ''}`}
										tabIndex={0}
									/>

									{/* Cost label on bar (if bar is wide enough) */}
									{barWidth > 50 && (
										<text
											x={padding.left + barWidth - 8}
											y={y + barHeight / 2}
											textAnchor="end"
											dominantBaseline="middle"
											fontSize={10}
											fill="white"
											style={{
												textShadow: '0 1px 2px rgba(0,0,0,0.3)',
												pointerEvents: 'none',
												transition: 'x 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
											}}
										>
											{formatCurrency(point.cost)}
										</text>
									)}
								</g>
							);
						})}

						{/* X-axis label */}
						<text
							x={chartWidth / 2}
							y={chartHeight - 5}
							textAnchor="middle"
							fontSize={11}
							fill={theme.colors.textDim}
						>
							Cost (USD)
						</text>
					</svg>
				)}

				{/* Tooltip - rendered via portal to avoid stacking context issues */}
				{hoveredModel &&
					tooltipPos &&
					createPortal(
						<div
							className="fixed z-[10000] px-3 py-2 rounded text-xs whitespace-nowrap pointer-events-none shadow-lg"
							style={{
								left: tooltipPos.x,
								top: tooltipPos.y - TOOLTIP_OFFSET,
								transform: 'translate(-50%, -100%)',
								backgroundColor: theme.colors.bgActivity,
								color: theme.colors.textMain,
								border: `1px solid ${theme.colors.border}`,
							}}
						>
							<div className="font-medium mb-1 flex items-center gap-2">
								<div
									className="w-2 h-2 rounded-full"
									style={{ backgroundColor: hoveredModel.color }}
								/>
								{hoveredModel.model}
							</div>
							<div style={{ color: theme.colors.textDim }}>
								<div>
									Cost:{' '}
									<span style={{ color: theme.colors.textMain }}>
										{formatCurrency(hoveredModel.cost)}
									</span>
								</div>
								{dataSource === 'local' && hoveredModel.savings > 0 && (
									<div>
										Saved:{' '}
										<span style={{ color: '#10b981' }}>{formatCurrency(hoveredModel.savings)}</span>
									</div>
								)}
							</div>
						</div>,
						document.body
					)}
			</div>

			{/* Legend */}
			{chartData.length > 0 && (
				<div
					className="flex flex-wrap gap-3 mt-3 pt-3 border-t"
					style={{ borderColor: theme.colors.border }}
					role="list"
					aria-label="Chart legend"
				>
					{chartData.slice(0, 6).map((point) => (
						<div key={point.model} className="flex items-center gap-1.5" role="listitem">
							<div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: point.color }} />
							<span className="text-xs" style={{ color: theme.colors.textDim }}>
								{point.displayModel}
							</span>
						</div>
					))}
					{chartData.length > 6 && (
						<span className="text-xs" style={{ color: theme.colors.textDim }}>
							+{chartData.length - 6} more
						</span>
					)}
				</div>
			)}
		</div>
	);
}

export default CostByModelGraph;
