/**
 * ThroughputTrendsChart
 *
 * Dual-axis line chart showing throughput (tok/s) and total tokens over time.
 * Left Y-axis: Average throughput in tokens per second
 * Right Y-axis: Total output tokens
 *
 * Features:
 * - Dual Y-axes for different scales
 * - X-axis: time (grouped by day)
 * - Smoothing/moving average toggle
 * - Tooltip showing exact values on hover
 * - Theme-aware styling with colorblind support
 */

import React, { useState, useMemo, useCallback } from 'react';
import { format, parseISO } from 'date-fns';
import type { Theme } from '../../types';
import type { StatsTimeRange, StatsAggregation } from '../../hooks/useStats';
import { COLORBLIND_LINE_COLORS } from '../../constants/colorblindPalettes';

// Data point for the chart
interface DataPoint {
	date: string;
	formattedDate: string;
	rawThroughput: number; // Raw avg tokens/second
	smoothedThroughput: number; // Smoothed tokens/second
	displayThroughput: number; // Currently displayed (raw or smoothed)
	rawTokens: number; // Raw total tokens
	smoothedTokens: number; // Smoothed tokens
	displayTokens: number; // Currently displayed (raw or smoothed)
	count: number; // Query count for this period
}

interface ThroughputTrendsChartProps {
	/** Aggregated stats data from the API */
	data: StatsAggregation;
	/** Current time range selection */
	timeRange: StatsTimeRange;
	/** Current theme for styling */
	theme: Theme;
	/** Enable colorblind-friendly colors */
	colorBlindMode?: boolean;
}

/**
 * Calculate moving average for smoothing
 */
function calculateMovingAverage(values: number[], windowSize: number): number[] {
	const result: number[] = [];

	for (let i = 0; i < values.length; i++) {
		const start = Math.max(0, i - Math.floor(windowSize / 2));
		const end = Math.min(values.length, i + Math.floor(windowSize / 2) + 1);
		const window = values.slice(start, end);
		const avg = window.reduce((sum, val) => sum + val, 0) / window.length;
		result.push(avg);
	}

	return result;
}

/**
 * Format tokens with K/M suffixes
 */
function formatTokens(tokens: number): string {
	if (tokens >= 1000000) {
		return `${(tokens / 1000000).toFixed(1)}M`;
	}
	if (tokens >= 1000) {
		return `${(tokens / 1000).toFixed(1)}K`;
	}
	return tokens.toFixed(0);
}

/**
 * Format throughput (tokens per second)
 */
function formatThroughput(tokPerSec: number): string {
	if (tokPerSec >= 100) {
		return `${tokPerSec.toFixed(0)}`;
	}
	return `${tokPerSec.toFixed(1)}`;
}

/**
 * Get the moving average window size based on time range
 */
function getWindowSize(timeRange: StatsTimeRange): number {
	switch (timeRange) {
		case 'day':
			return 3;
		case 'week':
			return 3;
		case 'month':
			return 5;
		case 'year':
			return 7;
		case 'all':
			return 7;
		default:
			return 5;
	}
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

export function ThroughputTrendsChart({
	data,
	timeRange,
	theme,
	colorBlindMode = false,
}: ThroughputTrendsChartProps) {
	const [showSmoothed, setShowSmoothed] = useState(false);
	const [hoveredPoint, setHoveredPoint] = useState<DataPoint | null>(null);
	const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

	// Chart dimensions
	const chartWidth = 600;
	const chartHeight = 220;
	const padding = { top: 20, right: 60, bottom: 40, left: 60 };
	const innerWidth = chartWidth - padding.left - padding.right;
	const innerHeight = chartHeight - padding.top - padding.bottom;

	// Process data for the chart
	const chartData = useMemo((): DataPoint[] => {
		if (data.byDay.length === 0) return [];

		// Extract throughput and token values
		const rawThroughputs = data.byDay.map((day) => day.avgTokensPerSecond ?? 0);
		const rawTokens = data.byDay.map((day) => day.outputTokens ?? 0);

		// Calculate smoothed values
		const windowSize = getWindowSize(timeRange);
		const smoothedThroughputs = calculateMovingAverage(rawThroughputs, windowSize);
		const smoothedTokens = calculateMovingAverage(rawTokens, windowSize);

		return data.byDay.map((day, idx) => ({
			date: day.date,
			formattedDate: format(parseISO(day.date), 'EEEE, MMM d, yyyy'),
			rawThroughput: rawThroughputs[idx],
			smoothedThroughput: smoothedThroughputs[idx],
			displayThroughput: showSmoothed ? smoothedThroughputs[idx] : rawThroughputs[idx],
			rawTokens: rawTokens[idx],
			smoothedTokens: smoothedTokens[idx],
			displayTokens: showSmoothed ? smoothedTokens[idx] : rawTokens[idx],
			count: day.count,
		}));
	}, [data.byDay, timeRange, showSmoothed]);

	// Check if we have any throughput data
	const hasThroughputData = useMemo(() => {
		return chartData.some((d) => d.displayThroughput > 0 || d.displayTokens > 0);
	}, [chartData]);

	// Calculate scales for both Y-axes
	const { xScale, yScaleLeft, yScaleRight, yTicksLeft, yTicksRight } = useMemo(() => {
		if (chartData.length === 0) {
			return {
				xScale: (_: number) => padding.left,
				yScaleLeft: (_: number) => chartHeight - padding.bottom,
				yScaleRight: (_: number) => chartHeight - padding.bottom,
				yTicksLeft: [0],
				yTicksRight: [0],
			};
		}

		// Left Y-axis: throughput (tok/s)
		const maxThroughput = Math.max(...chartData.map((d) => d.displayThroughput), 1);
		const yMaxLeft = maxThroughput * 1.1;

		// Right Y-axis: tokens
		const maxTokens = Math.max(...chartData.map((d) => d.displayTokens), 1);
		const yMaxRight = maxTokens * 1.1;

		// X scale - linear across data points
		const xScaleFn = (index: number) =>
			padding.left + (index / Math.max(chartData.length - 1, 1)) * innerWidth;

		// Left Y scale (throughput)
		const yScaleLeftFn = (value: number) =>
			chartHeight - padding.bottom - (value / yMaxLeft) * innerHeight;

		// Right Y scale (tokens)
		const yScaleRightFn = (value: number) =>
			chartHeight - padding.bottom - (value / yMaxRight) * innerHeight;

		// Generate Y-axis ticks
		const tickCount = 5;
		const yTicksLeftArr = Array.from(
			{ length: tickCount },
			(_, i) => (yMaxLeft / (tickCount - 1)) * i
		);
		const yTicksRightArr = Array.from(
			{ length: tickCount },
			(_, i) => (yMaxRight / (tickCount - 1)) * i
		);

		return {
			xScale: xScaleFn,
			yScaleLeft: yScaleLeftFn,
			yScaleRight: yScaleRightFn,
			yTicksLeft: yTicksLeftArr,
			yTicksRight: yTicksRightArr,
		};
	}, [chartData, chartHeight, innerWidth, innerHeight, padding]);

	// Generate line paths
	const throughputPath = useMemo(() => {
		if (chartData.length === 0) return '';
		return chartData
			.map((point, idx) => {
				const x = xScale(idx);
				const y = yScaleLeft(point.displayThroughput);
				return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
			})
			.join(' ');
	}, [chartData, xScale, yScaleLeft]);

	const tokensPath = useMemo(() => {
		if (chartData.length === 0) return '';
		return chartData
			.map((point, idx) => {
				const x = xScale(idx);
				const y = yScaleRight(point.displayTokens);
				return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
			})
			.join(' ');
	}, [chartData, xScale, yScaleRight]);

	// Generate area paths
	const throughputAreaPath = useMemo(() => {
		if (chartData.length === 0) return '';
		const pathStart = chartData
			.map((point, idx) => {
				const x = xScale(idx);
				const y = yScaleLeft(point.displayThroughput);
				return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
			})
			.join(' ');
		const lastX = xScale(chartData.length - 1);
		const firstX = xScale(0);
		const baseline = chartHeight - padding.bottom;
		return `${pathStart} L ${lastX} ${baseline} L ${firstX} ${baseline} Z`;
	}, [chartData, xScale, yScaleLeft, chartHeight, padding.bottom]);

	const tokensAreaPath = useMemo(() => {
		if (chartData.length === 0) return '';
		const pathStart = chartData
			.map((point, idx) => {
				const x = xScale(idx);
				const y = yScaleRight(point.displayTokens);
				return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
			})
			.join(' ');
		const lastX = xScale(chartData.length - 1);
		const firstX = xScale(0);
		const baseline = chartHeight - padding.bottom;
		return `${pathStart} L ${lastX} ${baseline} L ${firstX} ${baseline} Z`;
	}, [chartData, xScale, yScaleRight, chartHeight, padding.bottom]);

	// Handle mouse events
	const handleMouseEnter = useCallback(
		(point: DataPoint, event: React.MouseEvent<SVGCircleElement>) => {
			setHoveredPoint(point);
			const rect = event.currentTarget.getBoundingClientRect();
			setTooltipPos({
				x: rect.left + rect.width / 2,
				y: rect.top,
			});
		},
		[]
	);

	const handleMouseLeave = useCallback(() => {
		setHoveredPoint(null);
		setTooltipPos(null);
	}, []);

	// Get colors (colorblind-safe or theme)
	const primaryColor = colorBlindMode ? COLORBLIND_LINE_COLORS.primary : theme.colors.accent;
	const secondaryColor = colorBlindMode ? COLORBLIND_LINE_COLORS.secondary : theme.colors.warning;

	// Parse colors for gradients
	const parseColor = (color: string) => {
		if (color.startsWith('#')) {
			const hex = color.slice(1);
			return {
				r: parseInt(hex.slice(0, 2), 16),
				g: parseInt(hex.slice(2, 4), 16),
				b: parseInt(hex.slice(4, 6), 16),
			};
		}
		if (color.startsWith('rgb')) {
			const match = color.match(/\d+/g);
			if (match && match.length >= 3) {
				return {
					r: parseInt(match[0]),
					g: parseInt(match[1]),
					b: parseInt(match[2]),
				};
			}
		}
		return { r: 100, g: 149, b: 237 };
	};

	const primaryRgb = useMemo(() => parseColor(primaryColor), [primaryColor]);
	const secondaryRgb = useMemo(() => parseColor(secondaryColor), [secondaryColor]);

	// Unique IDs for gradients
	const gradientId1 = useMemo(
		() => `throughput-gradient-${Math.random().toString(36).slice(2, 9)}`,
		[]
	);
	const gradientId2 = useMemo(
		() => `tokens-gradient-${Math.random().toString(36).slice(2, 9)}`,
		[]
	);

	return (
		<div
			className="p-4 rounded-lg"
			style={{ backgroundColor: theme.colors.bgMain }}
			role="figure"
			aria-label={`Throughput trends chart showing tokens per second and total tokens over time. ${chartData.length} data points displayed.`}
		>
			{/* Header with title and smoothing toggle */}
			<div className="flex items-center justify-between mb-4">
				<h3 className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
					Throughput Trends
				</h3>
				<div className="flex items-center gap-2">
					<label
						className="flex items-center gap-2 cursor-pointer"
						style={{ color: theme.colors.textDim }}
					>
						<span className="text-xs">Smoothing:</span>
						<button
							onClick={() => setShowSmoothed((prev) => !prev)}
							className="relative w-9 h-5 rounded-full transition-colors"
							style={{
								backgroundColor: showSmoothed ? primaryColor : `${theme.colors.border}80`,
							}}
							aria-label={showSmoothed ? 'Disable smoothing' : 'Enable smoothing'}
						>
							<span
								className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow-sm"
								style={{
									transform: showSmoothed ? 'translateX(16px)' : 'translateX(0)',
								}}
							/>
						</button>
					</label>
				</div>
			</div>

			{/* Chart container */}
			<div className="relative">
				{chartData.length === 0 || !hasThroughputData ? (
					<div
						className="flex items-center justify-center"
						style={{ height: chartHeight, color: theme.colors.textDim }}
					>
						<span className="text-sm">No throughput data available</span>
					</div>
				) : (
					<svg
						width="100%"
						viewBox={`0 0 ${chartWidth} ${chartHeight}`}
						preserveAspectRatio="xMidYMid meet"
						role="img"
						aria-label="Dual-axis line chart of throughput and token trends"
					>
						{/* Gradient definitions */}
						<defs>
							<linearGradient id={gradientId1} x1="0" y1="0" x2="0" y2="1">
								<stop
									offset="0%"
									stopColor={`rgba(${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}, 0.2)`}
								/>
								<stop
									offset="100%"
									stopColor={`rgba(${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}, 0)`}
								/>
							</linearGradient>
							<linearGradient id={gradientId2} x1="0" y1="0" x2="0" y2="1">
								<stop
									offset="0%"
									stopColor={`rgba(${secondaryRgb.r}, ${secondaryRgb.g}, ${secondaryRgb.b}, 0.2)`}
								/>
								<stop
									offset="100%"
									stopColor={`rgba(${secondaryRgb.r}, ${secondaryRgb.g}, ${secondaryRgb.b}, 0)`}
								/>
							</linearGradient>
						</defs>

						{/* Grid lines */}
						{yTicksLeft.map((tick, idx) => (
							<line
								key={`grid-${idx}`}
								x1={padding.left}
								y1={yScaleLeft(tick)}
								x2={chartWidth - padding.right}
								y2={yScaleLeft(tick)}
								stroke={theme.colors.border}
								strokeOpacity={0.3}
								strokeDasharray="4,4"
							/>
						))}

						{/* Left Y-axis labels (throughput) */}
						{yTicksLeft.map((tick, idx) => (
							<text
								key={`y-left-${idx}`}
								x={padding.left - 8}
								y={yScaleLeft(tick)}
								textAnchor="end"
								dominantBaseline="middle"
								fontSize={10}
								fill={primaryColor}
							>
								{formatThroughput(tick)}
							</text>
						))}

						{/* Right Y-axis labels (tokens) */}
						{yTicksRight.map((tick, idx) => (
							<text
								key={`y-right-${idx}`}
								x={chartWidth - padding.right + 8}
								y={yScaleRight(tick)}
								textAnchor="start"
								dominantBaseline="middle"
								fontSize={10}
								fill={secondaryColor}
							>
								{formatTokens(tick)}
							</text>
						))}

						{/* X-axis labels */}
						{chartData.map((point, idx) => {
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

						{/* Area fills (render tokens first so throughput is on top) */}
						<path
							d={tokensAreaPath}
							fill={`url(#${gradientId2})`}
							style={{ transition: 'd 0.5s cubic-bezier(0.4, 0, 0.2, 1)' }}
						/>
						<path
							d={throughputAreaPath}
							fill={`url(#${gradientId1})`}
							style={{ transition: 'd 0.5s cubic-bezier(0.4, 0, 0.2, 1)' }}
						/>

						{/* Lines (tokens first, throughput on top) */}
						<path
							d={tokensPath}
							fill="none"
							stroke={secondaryColor}
							strokeWidth={2}
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeDasharray="6,3"
							style={{ transition: 'd 0.5s cubic-bezier(0.4, 0, 0.2, 1)' }}
						/>
						<path
							d={throughputPath}
							fill="none"
							stroke={primaryColor}
							strokeWidth={2}
							strokeLinecap="round"
							strokeLinejoin="round"
							style={{ transition: 'd 0.5s cubic-bezier(0.4, 0, 0.2, 1)' }}
						/>

						{/* Data points for throughput (interactive) */}
						{chartData.map((point, idx) => {
							const x = xScale(idx);
							const y = yScaleLeft(point.displayThroughput);
							const isHovered = hoveredPoint?.date === point.date;

							return (
								<circle
									key={`throughput-point-${idx}`}
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
									aria-label={`${point.formattedDate}: ${formatThroughput(point.displayThroughput)} tok/s, ${formatTokens(point.displayTokens)} tokens`}
									tabIndex={0}
								/>
							);
						})}

						{/* Left Y-axis label */}
						<text
							x={15}
							y={chartHeight / 2}
							textAnchor="middle"
							dominantBaseline="middle"
							fontSize={11}
							fill={primaryColor}
							transform={`rotate(-90, 15, ${chartHeight / 2})`}
						>
							tok/s
						</text>

						{/* Right Y-axis label */}
						<text
							x={chartWidth - 15}
							y={chartHeight / 2}
							textAnchor="middle"
							dominantBaseline="middle"
							fontSize={11}
							fill={secondaryColor}
							transform={`rotate(90, ${chartWidth - 15}, ${chartHeight / 2})`}
						>
							Tokens
						</text>
					</svg>
				)}

				{/* Tooltip */}
				{hoveredPoint && tooltipPos && (
					<div
						className="fixed z-50 px-3 py-2 rounded text-xs whitespace-nowrap pointer-events-none shadow-lg"
						style={{
							left: tooltipPos.x,
							top: tooltipPos.y - 8,
							transform: 'translate(-50%, -100%)',
							backgroundColor: theme.colors.bgActivity,
							color: theme.colors.textMain,
							border: `1px solid ${theme.colors.border}`,
						}}
					>
						<div className="font-medium mb-1">{hoveredPoint.formattedDate}</div>
						<div style={{ color: theme.colors.textDim }}>
							<div>
								<span style={{ color: primaryColor }}>Throughput:</span>{' '}
								<span style={{ color: theme.colors.textMain }}>
									{formatThroughput(hoveredPoint.displayThroughput)} tok/s
								</span>
							</div>
							<div>
								<span style={{ color: secondaryColor }}>Tokens:</span>{' '}
								<span style={{ color: theme.colors.textMain }}>
									{formatTokens(hoveredPoint.displayTokens)}
								</span>
							</div>
							<div>
								Queries:{' '}
								<span style={{ color: theme.colors.textMain }}>{hoveredPoint.count}</span>
							</div>
						</div>
					</div>
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
						{showSmoothed ? 'Avg Throughput (smoothed)' : 'Avg Throughput'}
					</span>
				</div>
				<div className="flex items-center gap-1.5">
					<div
						className="w-4 h-0.5 rounded"
						style={{ backgroundColor: secondaryColor, opacity: 0.8 }}
					/>
					<span className="text-xs" style={{ color: theme.colors.textDim }}>
						{showSmoothed ? 'Total Tokens (smoothed)' : 'Total Tokens'}
					</span>
				</div>
				{showSmoothed && (
					<span className="text-xs" style={{ color: theme.colors.textDim }}>
						Window: {getWindowSize(timeRange)} periods
					</span>
				)}
			</div>
		</div>
	);
}

export default ThroughputTrendsChart;
