/**
 * AgentCostGraph
 *
 * Vertical bar chart showing cost breakdown by agent with dual data source support.
 * Allows toggling between Local (Maestro calculated) and Anthropic (API pricing) data.
 *
 * Features:
 * - Vertical bar chart sorted by cost (descending)
 * - X-axis: agent names (truncated)
 * - Y-axis: cost in USD
 * - DataSourceToggle for switching between Local and Anthropic data
 * - Tooltip showing exact values on hover
 * - Theme-aware colors
 * - Distinct colors per billing mode (green=Max, blue=API, gray=Free)
 * - Shows top 10 agents to prevent overcrowding
 */

import React, { useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { Theme, Session } from '../../types';
import type { StatsTimeRange } from '../../hooks/useStats';
import { DataSourceToggle, type DataSource } from '../ui/DataSourceToggle';

// Tooltip positioning constants
const TOOLTIP_OFFSET = 12; // pixels gap between tooltip and cursor

// Maximum number of agents to display
const MAX_AGENTS = 10;

// Billing mode type
export type BillingMode = 'api' | 'max' | 'free';

// Data point for the chart
export interface AgentCostData {
	agentId: string;
	agentName: string;
	localCost: number;
	anthropicCost: number;
	savings: number;
	billingMode: BillingMode;
}

interface ChartDataPoint {
	agentId: string;
	agentName: string;
	displayName: string;
	cost: number;
	savings: number;
	billingMode: BillingMode;
	color: string;
}

interface AgentCostGraphProps {
	/** Agent cost data from the API */
	data: AgentCostData[];
	/** Current time range selection */
	timeRange: StatsTimeRange;
	/** Current theme for styling */
	theme: Theme;
	/** Optional title override */
	title?: string;
	/** Optional height override */
	height?: number;
	/** Current sessions for mapping IDs to names */
	sessions?: Session[];
}

// Billing mode colors (accessible and distinct)
const BILLING_MODE_COLORS: Record<BillingMode, string> = {
	max: '#10b981', // emerald/green
	api: '#3b82f6', // blue
	free: '#9ca3af', // gray
};

// Billing mode labels for display
const BILLING_MODE_LABELS: Record<BillingMode, string> = {
	max: 'Max',
	api: 'API',
	free: 'Free',
};

/**
 * Format currency value
 */
function formatCurrency(value: number): string {
	return `$${value.toFixed(2)}`;
}

/**
 * Truncate agent name for display
 */
function truncateName(name: string, maxLength: number = 12): string {
	if (name.length <= maxLength) return name;
	return name.substring(0, maxLength - 1) + '…';
}

/**
 * Get the display name for an agent, using session name if available
 */
function getAgentDisplayName(agentId: string, originalName: string, sessions?: Session[]): string {
	if (sessions) {
		const session = sessions.find((s) => s.id === agentId);
		if (session?.name) {
			return session.name;
		}
	}

	// Fallback: use the original name from the data, or truncate ID if unavailable
	if (originalName && originalName !== agentId) {
		return originalName;
	}
	return agentId.length > 20 ? `${agentId.substring(0, 17)}...` : agentId;
}

export function AgentCostGraph({
	data,
	timeRange: _timeRange,
	theme,
	title = 'Cost by Agent',
	height = 300,
	sessions,
}: AgentCostGraphProps): React.ReactElement {
	const [dataSource, setDataSource] = useState<DataSource>('local');
	const [hoveredAgent, setHoveredAgent] = useState<ChartDataPoint | null>(null);
	const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

	// Chart dimensions
	const chartWidth = 600;
	const chartHeight = height;
	const padding = { top: 20, right: 40, bottom: 70, left: 60 }; // Extra bottom padding for rotated labels
	const innerWidth = chartWidth - padding.left - padding.right;
	const innerHeight = chartHeight - padding.top - padding.bottom;

	// Process data for the chart (sort by cost, take top N)
	const chartData = useMemo((): ChartDataPoint[] => {
		if (data.length === 0) return [];

		return data
			.map((d) => {
				const resolvedName = getAgentDisplayName(d.agentId, d.agentName, sessions);
				return {
					agentId: d.agentId,
					agentName: resolvedName,
					displayName: truncateName(resolvedName),
					cost: dataSource === 'local' ? d.localCost : d.anthropicCost,
					savings: d.savings,
					billingMode: d.billingMode,
					color: BILLING_MODE_COLORS[d.billingMode] || BILLING_MODE_COLORS.api,
				};
			})
			.sort((a, b) => b.cost - a.cost)
			.slice(0, MAX_AGENTS);
	}, [data, dataSource, sessions]);

	// Calculate max cost for bar height scaling
	const maxCost = useMemo(() => {
		if (chartData.length === 0) return 0;
		return Math.max(...chartData.map((d) => d.cost), 0.01);
	}, [chartData]);

	// Calculate total cost
	const totalCost = useMemo(() => {
		return chartData.reduce((sum, d) => sum + d.cost, 0);
	}, [chartData]);

	// Calculate total savings
	const totalSavings = useMemo(() => {
		return chartData.reduce((sum, d) => sum + d.savings, 0);
	}, [chartData]);

	// Calculate scales
	const { xScale, yScale, yTicks, barWidth } = useMemo(() => {
		// Calculate bar width with spacing
		const numBars = Math.max(chartData.length, 1);
		const barSpacing = 8;
		const calculatedBarWidth = Math.min(40, (innerWidth - (numBars - 1) * barSpacing) / numBars);

		// X scale - position for each bar
		const xScaleFn = (index: number) => {
			const totalBarSpace = numBars * calculatedBarWidth + (numBars - 1) * barSpacing;
			const startOffset = (innerWidth - totalBarSpace) / 2;
			return padding.left + startOffset + index * (calculatedBarWidth + barSpacing);
		};

		// Y scale - linear from 0 to max cost (inverted for SVG coordinates)
		const yMax = maxCost * 1.1; // Add 10% padding
		const yScaleFn = (value: number) => chartHeight - padding.bottom - (value / yMax) * innerHeight;

		// Generate nice Y-axis ticks
		const tickCount = 5;
		const yTicksArr = Array.from({ length: tickCount }, (_, i) => (yMax / (tickCount - 1)) * i);

		return { xScale: xScaleFn, yScale: yScaleFn, yTicks: yTicksArr, barWidth: calculatedBarWidth };
	}, [chartData, maxCost, innerWidth, innerHeight, chartHeight, padding]);

	// Handle mouse events for tooltip
	const handleMouseEnter = useCallback(
		(point: ChartDataPoint, event: React.MouseEvent<SVGRectElement>) => {
			setHoveredAgent(point);
			setTooltipPos({
				x: event.clientX,
				y: event.clientY,
			});
		},
		[]
	);

	const handleMouseLeave = useCallback(() => {
		setHoveredAgent(null);
		setTooltipPos(null);
	}, []);

	return (
		<div
			className="p-4 rounded-lg"
			style={{ backgroundColor: theme.colors.bgMain }}
			role="figure"
			aria-label={`Cost by agent chart showing ${dataSource === 'local' ? 'local (Maestro calculated)' : 'Anthropic API'} costs. ${chartData.length} agents displayed.`}
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
					{/* Billing mode legend */}
					<div className="flex items-center gap-3 mt-1">
						{(['max', 'api', 'free'] as BillingMode[]).map((mode) => (
							<span
								key={mode}
								className="flex items-center gap-1 text-xs"
								style={{ color: theme.colors.textDim }}
							>
								<span
									className="w-2 h-2 rounded-full"
									style={{ backgroundColor: BILLING_MODE_COLORS[mode] }}
								/>
								{BILLING_MODE_LABELS[mode]}
							</span>
						))}
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
						<span className="text-sm">No agent cost data available</span>
					</div>
				) : (
					<svg
						width="100%"
						viewBox={`0 0 ${chartWidth} ${chartHeight}`}
						preserveAspectRatio="xMidYMid meet"
						role="img"
						aria-label={`Vertical bar chart of costs by agent. ${chartData.length > 0 ? `Range from ${formatCurrency(Math.min(...chartData.map((d) => d.cost)))} to ${formatCurrency(Math.max(...chartData.map((d) => d.cost)))}` : 'No data available'}`}
					>
						{/* Horizontal grid lines */}
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

						{/* Bars */}
						{chartData.map((point, idx) => {
							const x = xScale(idx);
							const barHeight = (point.cost / maxCost) * innerHeight || 0;
							const y = chartHeight - padding.bottom - barHeight;
							const isHovered = hoveredAgent?.agentId === point.agentId;

							return (
								<g key={`bar-${point.agentId}`}>
									{/* Bar */}
									<rect
										x={x}
										y={y}
										width={barWidth}
										height={Math.max(barHeight, 2)}
										fill={point.color}
										rx={2}
										style={{
											cursor: 'pointer',
											opacity: isHovered ? 1 : 0.85,
											transition:
												'height 0.5s cubic-bezier(0.4, 0, 0.2, 1), y 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.15s ease',
										}}
										onMouseEnter={(e) => handleMouseEnter(point, e)}
										onMouseLeave={handleMouseLeave}
										role="graphics-symbol"
										aria-label={`${point.agentName}: Cost ${formatCurrency(point.cost)}, Mode ${point.billingMode}${point.savings > 0 ? `, Saved ${formatCurrency(point.savings)}` : ''}`}
										tabIndex={0}
									/>

									{/* X-axis label (agent name) - rotated */}
									<text
										x={x + barWidth / 2}
										y={chartHeight - padding.bottom + 10}
										textAnchor="end"
										dominantBaseline="hanging"
										fontSize={10}
										fill={isHovered ? theme.colors.textMain : theme.colors.textDim}
										transform={`rotate(-45, ${x + barWidth / 2}, ${chartHeight - padding.bottom + 10})`}
										style={{ transition: 'fill 0.15s ease' }}
									>
										{point.displayName}
									</text>
								</g>
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
				{hoveredAgent &&
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
									style={{ backgroundColor: hoveredAgent.color }}
								/>
								{hoveredAgent.agentName}
							</div>
							<div style={{ color: theme.colors.textDim }}>
								<div>
									Cost:{' '}
									<span style={{ color: theme.colors.textMain }}>
										{formatCurrency(hoveredAgent.cost)}
									</span>
								</div>
								<div>
									Mode:{' '}
									<span style={{ color: theme.colors.textMain }}>
										{BILLING_MODE_LABELS[hoveredAgent.billingMode]}
									</span>
								</div>
								{dataSource === 'local' && hoveredAgent.savings > 0 && (
									<div>
										Saved:{' '}
										<span style={{ color: '#10b981' }}>{formatCurrency(hoveredAgent.savings)}</span>
									</div>
								)}
							</div>
						</div>,
						document.body
					)}
			</div>

			{/* Agent count indicator when more than MAX_AGENTS */}
			{data.length > MAX_AGENTS && (
				<div
					className="text-center text-xs mt-2 pt-2 border-t"
					style={{ borderColor: theme.colors.border, color: theme.colors.textDim }}
				>
					Showing top {MAX_AGENTS} of {data.length} agents
				</div>
			)}
		</div>
	);
}

export default AgentCostGraph;
