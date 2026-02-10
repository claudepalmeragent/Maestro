/**
 * CostOverTimeGraph
 *
 * Line chart showing daily costs over time with dual data source support.
 * Allows toggling between Local (Maestro calculated) and Anthropic (API pricing) data.
 *
 * Features:
 * - X-axis: dates
 * - Y-axis: cost in USD
 * - DataSourceToggle for switching between Local and Anthropic data
 * - Tooltip showing exact values on hover
 * - Theme-aware line color and grid
 * - Shows savings when in Local mode
 */

import React, { useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { format, parseISO } from 'date-fns';
import type { Theme } from '../../types';
import type { StatsTimeRange } from '../../hooks/useStats';
import { DataSourceToggle, type DataSource } from '../ui/DataSourceToggle';

// Tooltip positioning constants
const TOOLTIP_OFFSET = 12; // pixels gap between tooltip and cursor

// Data point for the chart
export interface DailyCostData {
	date: string;
	localCost: number;
	anthropicCost: number;
	savings: number;
}

interface ChartDataPoint {
	date: string;
	formattedDate: string;
	cost: number;
	savings: number;
}

interface CostOverTimeGraphProps {
	/** Daily cost data from the API */
	data: DailyCostData[];
	/** Current time range selection */
	timeRange: StatsTimeRange;
	/** Current theme for styling */
	theme: Theme;
	/** Optional title override */
	title?: string;
	/** Optional height override */
	height?: number;
}

/**
 * Format currency value
 */
function formatCurrency(value: number): string {
	return `$${value.toFixed(2)}`;
}

/**
 * Format date for X-axis based on time range
 */
function formatXAxisDate(dateStr: string, timeRange: StatsTimeRange): string {
	const date = parseISO(dateStr);

	switch (timeRange) {
		case 'day':
			return format(date, 'HH:mm');
		case 'week':
			return format(date, 'EEE');
		case 'month':
			return format(date, 'MMM d');
		case 'year':
			return format(date, 'MMM');
		case 'all':
			return format(date, 'MMM yyyy');
		default:
			return format(date, 'MMM d');
	}
}

export function CostOverTimeGraph({
	data,
	timeRange,
	theme,
	title = 'Cost Over Time',
	height = 300,
}: CostOverTimeGraphProps): React.ReactElement {
	const [dataSource, setDataSource] = useState<DataSource>('local');
	const [hoveredPoint, setHoveredPoint] = useState<ChartDataPoint | null>(null);
	const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

	// Chart dimensions
	const chartWidth = 600;
	const chartHeight = height;
	const padding = { top: 20, right: 40, bottom: 40, left: 60 };
	const innerWidth = chartWidth - padding.left - padding.right;
	const innerHeight = chartHeight - padding.top - padding.bottom;

	// Process data for the chart
	const chartData = useMemo((): ChartDataPoint[] => {
		if (data.length === 0) return [];

		return data.map((d) => ({
			date: d.date,
			formattedDate: format(parseISO(d.date), 'EEEE, MMM d, yyyy'),
			cost: dataSource === 'local' ? d.localCost : d.anthropicCost,
			savings: d.savings,
		}));
	}, [data, dataSource]);

	// Calculate totals
	const totalCost = useMemo(() => {
		return chartData.reduce((sum, d) => sum + d.cost, 0);
	}, [chartData]);

	const totalSavings = useMemo(() => {
		return data.reduce((sum, d) => sum + d.savings, 0);
	}, [data]);

	// Calculate scales
	const { xScale, yScale, yTicks } = useMemo(() => {
		if (chartData.length === 0) {
			return {
				xScale: (_: number) => padding.left,
				yScale: (_: number) => chartHeight - padding.bottom,
				yTicks: [0],
			};
		}

		const maxCost = Math.max(
			...chartData.map((d) => d.cost),
			0.01 // Ensure we have at least some range
		);

		// Add 10% padding to max
		const yMax = maxCost * 1.1;

		// X scale - linear across data points
		const xScaleFn = (index: number) =>
			padding.left + (index / Math.max(chartData.length - 1, 1)) * innerWidth;

		// Y scale - inverted for SVG coordinates
		const yScaleFn = (value: number) => chartHeight - padding.bottom - (value / yMax) * innerHeight;

		// Generate nice Y-axis ticks
		const tickCount = 5;
		const yTicksArr = Array.from({ length: tickCount }, (_, i) => (yMax / (tickCount - 1)) * i);

		return { xScale: xScaleFn, yScale: yScaleFn, yTicks: yTicksArr };
	}, [chartData, chartHeight, innerWidth, innerHeight, padding]);

	// Generate line path
	const linePath = useMemo(() => {
		if (chartData.length === 0) return '';

		return chartData
			.map((point, idx) => {
				const x = xScale(idx);
				const y = yScale(point.cost);
				return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
			})
			.join(' ');
	}, [chartData, xScale, yScale]);

	// Generate area path (for gradient fill)
	const areaPath = useMemo(() => {
		if (chartData.length === 0) return '';

		const pathStart = chartData
			.map((point, idx) => {
				const x = xScale(idx);
				const y = yScale(point.cost);
				return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
			})
			.join(' ');

		// Close the path back to the baseline
		const lastX = xScale(chartData.length - 1);
		const firstX = xScale(0);
		const baseline = chartHeight - padding.bottom;

		return `${pathStart} L ${lastX} ${baseline} L ${firstX} ${baseline} Z`;
	}, [chartData, xScale, yScale, chartHeight, padding.bottom]);

	// Handle mouse events for tooltip
	const handleMouseEnter = useCallback(
		(point: ChartDataPoint, event: React.MouseEvent<SVGCircleElement>) => {
			setHoveredPoint(point);
			setTooltipPos({
				x: event.clientX,
				y: event.clientY,
			});
		},
		[]
	);

	const handleMouseLeave = useCallback(() => {
		setHoveredPoint(null);
		setTooltipPos(null);
	}, []);

	// Primary chart color
	const primaryColor = theme.colors.accent;

	// Parse primary color for gradient
	const accentRgb = useMemo(() => {
		const accent = primaryColor;
		if (accent.startsWith('#')) {
			const hex = accent.slice(1);
			return {
				r: parseInt(hex.slice(0, 2), 16),
				g: parseInt(hex.slice(2, 4), 16),
				b: parseInt(hex.slice(4, 6), 16),
			};
		}
		if (accent.startsWith('rgb')) {
			const match = accent.match(/\d+/g);
			if (match && match.length >= 3) {
				return {
					r: parseInt(match[0]),
					g: parseInt(match[1]),
					b: parseInt(match[2]),
				};
			}
		}
		return { r: 59, g: 130, b: 246 }; // Default blue
	}, [primaryColor]);

	// Generate unique ID for gradient
	const gradientId = useMemo(() => `cost-gradient-${Math.random().toString(36).slice(2, 9)}`, []);

	return (
		<div
			className="p-4 rounded-lg"
			style={{ backgroundColor: theme.colors.bgMain }}
			role="figure"
			aria-label={`Cost over time chart showing ${dataSource === 'local' ? 'local (Maestro calculated)' : 'Anthropic API'} costs. ${chartData.length} data points displayed.`}
		>
			{/* Header with title, totals, and data source toggle */}
			<div className="flex items-center justify-between mb-4">
				<div>
					<h3 className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
						{title}
					</h3>
					<div className="text-sm" style={{ color: theme.colors.textDim }}>
						Total: {formatCurrency(totalCost)}
						{dataSource === 'local' && totalSavings > 0 && (
							<span className="ml-2" style={{ color: '#10b981' }}>
								(Saved {formatCurrency(totalSavings)})
							</span>
						)}
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
						aria-label={`Line chart of costs over time. ${chartData.length > 0 ? `Range from ${formatCurrency(Math.min(...chartData.map((d) => d.cost)))} to ${formatCurrency(Math.max(...chartData.map((d) => d.cost)))}` : 'No data available'}`}
					>
						{/* Gradient definition */}
						<defs>
							<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
								<stop
									offset="0%"
									stopColor={`rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.3)`}
								/>
								<stop
									offset="100%"
									stopColor={`rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0)`}
								/>
							</linearGradient>
						</defs>

						{/* Grid lines */}
						{yTicks.map((tick, idx) => (
							<g key={`tick-${idx}`}>
								{/* Horizontal grid line */}
								<line
									x1={padding.left}
									y1={yScale(tick)}
									x2={chartWidth - padding.right}
									y2={yScale(tick)}
									stroke={theme.colors.border}
									strokeOpacity={0.3}
									strokeDasharray="4,4"
								/>
								{/* Y-axis label */}
								<text
									x={padding.left - 8}
									y={yScale(tick)}
									textAnchor="end"
									dominantBaseline="middle"
									fontSize={10}
									fill={theme.colors.textDim}
								>
									{formatCurrency(tick)}
								</text>
							</g>
						))}

						{/* X-axis labels */}
						{chartData.map((point, idx) => {
							// Show fewer labels for longer time ranges
							const labelInterval =
								chartData.length > 14
									? Math.ceil(chartData.length / 7)
									: chartData.length > 7
										? 2
										: 1;

							if (idx % labelInterval !== 0 && idx !== chartData.length - 1) {
								return null;
							}

							return (
								<text
									key={`x-label-${idx}`}
									x={xScale(idx)}
									y={chartHeight - padding.bottom + 20}
									textAnchor="middle"
									fontSize={10}
									fill={theme.colors.textDim}
								>
									{formatXAxisDate(point.date, timeRange)}
								</text>
							);
						})}

						{/* Area fill under the line */}
						<path
							d={areaPath}
							fill={`url(#${gradientId})`}
							style={{
								transition: 'd 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
							}}
						/>

						{/* Main line */}
						<path
							d={linePath}
							fill="none"
							stroke={primaryColor}
							strokeWidth={2}
							strokeLinecap="round"
							strokeLinejoin="round"
							style={{
								transition: 'd 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
							}}
						/>

						{/* Data points */}
						{chartData.map((point, idx) => {
							const x = xScale(idx);
							const y = yScale(point.cost);
							const isHovered = hoveredPoint?.date === point.date;

							return (
								<circle
									key={`point-${idx}`}
									cx={x}
									cy={y}
									r={isHovered ? 6 : 4}
									fill={isHovered ? primaryColor : theme.colors.bgMain}
									stroke={primaryColor}
									strokeWidth={2}
									style={{
										cursor: 'pointer',
										transition:
											'cx 0.5s cubic-bezier(0.4, 0, 0.2, 1), cy 0.5s cubic-bezier(0.4, 0, 0.2, 1), r 0.15s ease',
									}}
									onMouseEnter={(e) => handleMouseEnter(point, e)}
									onMouseLeave={handleMouseLeave}
									role="graphics-symbol"
									aria-label={`${point.formattedDate}: Cost ${formatCurrency(point.cost)}${point.savings > 0 ? `, Saved ${formatCurrency(point.savings)}` : ''}`}
									tabIndex={0}
								/>
							);
						})}

						{/* Y-axis label */}
						<text
							x={15}
							y={chartHeight / 2}
							textAnchor="middle"
							dominantBaseline="middle"
							fontSize={11}
							fill={theme.colors.textDim}
							transform={`rotate(-90, 15, ${chartHeight / 2})`}
						>
							Cost (USD)
						</text>
					</svg>
				)}

				{/* Tooltip - rendered via portal to avoid stacking context issues */}
				{hoveredPoint &&
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
							<div className="font-medium mb-1">{hoveredPoint.formattedDate}</div>
							<div style={{ color: theme.colors.textDim }}>
								<div>
									Cost:{' '}
									<span style={{ color: theme.colors.textMain }}>
										{formatCurrency(hoveredPoint.cost)}
									</span>
								</div>
								{dataSource === 'local' && hoveredPoint.savings > 0 && (
									<div>
										Saved:{' '}
										<span style={{ color: '#10b981' }}>{formatCurrency(hoveredPoint.savings)}</span>
									</div>
								)}
							</div>
						</div>,
						document.body
					)}
			</div>

			{/* Legend */}
			<div
				className="flex items-center justify-end gap-4 mt-3 pt-3 border-t"
				style={{ borderColor: theme.colors.border }}
			>
				<div className="flex items-center gap-1.5">
					<div className="w-4 h-0.5 rounded" style={{ backgroundColor: primaryColor }} />
					<span className="text-xs" style={{ color: theme.colors.textDim }}>
						{dataSource === 'local' ? 'Local Cost' : 'Anthropic Cost'}
					</span>
				</div>
			</div>
		</div>
	);
}

export default CostOverTimeGraph;
