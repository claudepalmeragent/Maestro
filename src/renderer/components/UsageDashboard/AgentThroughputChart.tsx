/**
 * AgentThroughputChart
 *
 * Line chart showing average throughput (tok/s) per Maestro session (agent) over time.
 * One line per session, showing how throughput varies across days.
 *
 * Features:
 * - One line per Maestro session (named agent from left panel)
 * - Y-axis: Average throughput in tokens per second
 * - X-axis: Date (grouped by day)
 * - Session ID to name mapping when names are available
 * - Hover tooltips with exact values
 * - Theme-aware styling with colorblind support
 * - Limits display to top 10 sessions by average throughput
 */

import React, { useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { format, parseISO } from 'date-fns';
import type { Theme, Session } from '../../types';
import type { StatsTimeRange, StatsAggregation } from '../../hooks/useStats';
import { COLORBLIND_AGENT_PALETTE } from '../../constants/colorblindPalettes';

// Tooltip positioning constants
const TOOLTIP_OFFSET = 12; // pixels gap between tooltip and cursor

// 10 distinct colors for agents
const AGENT_COLORS = [
	'#a78bfa', // violet
	'#34d399', // emerald
	'#60a5fa', // blue
	'#f472b6', // pink
	'#fbbf24', // amber
	'#fb923c', // orange
	'#4ade80', // green
	'#38bdf8', // sky
	'#c084fc', // purple
	'#f87171', // red
];

// Data point for a single session on a single day
interface SessionDayData {
	date: string;
	formattedDate: string;
	avgTokensPerSecond: number;
	outputTokens: number;
	count: number;
}

interface AgentThroughputChartProps {
	/** Aggregated stats data from the API */
	data: StatsAggregation;
	/** Current time range selection */
	timeRange: StatsTimeRange;
	/** Current theme for styling */
	theme: Theme;
	/** Enable colorblind-friendly colors */
	colorBlindMode?: boolean;
	/** Current sessions for mapping IDs to names */
	sessions?: Session[];
}

/**
 * Format throughput for display
 */
function formatThroughput(tokPerSec: number): string {
	if (tokPerSec >= 100) {
		return `${tokPerSec.toFixed(0)} tok/s`;
	}
	return `${tokPerSec.toFixed(1)} tok/s`;
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

/**
 * Get agent color based on index, with colorblind mode support
 */
function getAgentColor(index: number, colorBlindMode: boolean): string {
	if (colorBlindMode) {
		return COLORBLIND_AGENT_PALETTE[index % COLORBLIND_AGENT_PALETTE.length];
	}
	return AGENT_COLORS[index % AGENT_COLORS.length];
}

/**
 * Extract a display name from an agent ID
 * Uses exact matching to find sessions - no more startsWith() which caused false positives
 * Returns the session name if found, or first 8 chars of the UUID as fallback
 */
function getAgentDisplayName(agentId: string, sessions?: Session[]): string {
	if (sessions) {
		// Exact match - no more startsWith() which caused false positives
		const session = sessions.find((s) => s.id === agentId);
		if (session?.name) {
			return session.name;
		}
	}

	// Fallback to truncated UUID
	return agentId.substring(0, 8).toUpperCase();
}

export function AgentThroughputChart({
	data,
	timeRange,
	theme,
	colorBlindMode = false,
	sessions,
}: AgentThroughputChartProps) {
	const [hoveredDay, setHoveredDay] = useState<{ dayIndex: number; agentId?: string } | null>(null);
	const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

	// Chart dimensions
	const chartWidth = 600;
	const chartHeight = 220;
	const padding = { top: 20, right: 50, bottom: 40, left: 60 };
	const innerWidth = chartWidth - padding.left - padding.right;
	const innerHeight = chartHeight - padding.top - padding.bottom;

	// Process byAgentIdByDay data for the chart
	const { agentIds, chartData, allDates, agentDisplayNames } = useMemo(() => {
		const byAgentIdByDay = data.byAgentIdByDay || {};

		// Calculate total queries per agent to rank them (include all agents, even without throughput data)
		const agentTotals: Array<{ agentId: string; avgThroughput: number; totalQueries: number }> = [];
		for (const agentId of Object.keys(byAgentIdByDay)) {
			const days = byAgentIdByDay[agentId];
			// Calculate weighted average throughput (by query count per day)
			let totalWeightedThroughput = 0;
			let totalQueries = 0;
			let queriesWithThroughput = 0;
			for (const day of days) {
				totalQueries += day.count;
				if (day.avgTokensPerSecond > 0) {
					totalWeightedThroughput += day.avgTokensPerSecond * day.count;
					queriesWithThroughput += day.count;
				}
			}
			const avgThroughput =
				queriesWithThroughput > 0 ? totalWeightedThroughput / queriesWithThroughput : 0;
			agentTotals.push({ agentId, avgThroughput, totalQueries });
		}

		// Sort by total queries descending and take top 10 (include ALL agents, even without throughput data)
		agentTotals.sort((a, b) => b.totalQueries - a.totalQueries);
		const topAgents = agentTotals.slice(0, 10);
		const agentIdList = topAgents.map((s) => s.agentId);

		// Build display name map
		const displayNames: Record<string, string> = {};
		for (const agentId of agentIdList) {
			displayNames[agentId] = getAgentDisplayName(agentId, sessions);
		}

		// Collect all unique dates from selected agents
		const dateSet = new Set<string>();
		for (const agentId of agentIdList) {
			for (const day of byAgentIdByDay[agentId]) {
				dateSet.add(day.date);
			}
		}
		const sortedDates = Array.from(dateSet).sort();

		// Build per-agent arrays aligned to all dates
		const agentData: Record<string, SessionDayData[]> = {};
		for (const agentId of agentIdList) {
			const dayMap = new Map<
				string,
				{ avgTokensPerSecond: number; outputTokens: number; count: number }
			>();
			for (const day of byAgentIdByDay[agentId]) {
				dayMap.set(day.date, {
					avgTokensPerSecond: day.avgTokensPerSecond || 0,
					outputTokens: day.outputTokens || 0,
					count: day.count,
				});
			}

			agentData[agentId] = sortedDates.map((date) => ({
				date,
				formattedDate: format(parseISO(date), 'EEEE, MMM d, yyyy'),
				avgTokensPerSecond: dayMap.get(date)?.avgTokensPerSecond || 0,
				outputTokens: dayMap.get(date)?.outputTokens || 0,
				count: dayMap.get(date)?.count || 0,
			}));
		}

		// Build combined day data for tooltips (include all agents, even with zero throughput)
		interface CombinedDayData {
			date: string;
			formattedDate: string;
			agents: Record<string, { avgTokensPerSecond: number; outputTokens: number; count: number }>;
		}
		const combinedData: CombinedDayData[] = sortedDates.map((date) => {
			const agentsOnDay: Record<
				string,
				{ avgTokensPerSecond: number; outputTokens: number; count: number }
			> = {};
			for (const agentId of agentIdList) {
				const dayData = agentData[agentId].find((d) => d.date === date);
				if (dayData) {
					agentsOnDay[agentId] = {
						avgTokensPerSecond: dayData.avgTokensPerSecond,
						outputTokens: dayData.outputTokens,
						count: dayData.count,
					};
				}
			}
			return {
				date,
				formattedDate: format(parseISO(date), 'EEEE, MMM d, yyyy'),
				agents: agentsOnDay,
			};
		});

		return {
			agentIds: agentIdList,
			chartData: agentData,
			allDates: combinedData,
			agentDisplayNames: displayNames,
		};
	}, [data.byAgentIdByDay, sessions]);

	// Calculate scales
	const { xScale, yScale, yTicks } = useMemo(() => {
		if (allDates.length === 0) {
			return {
				xScale: (_: number) => padding.left,
				yScale: (_: number) => chartHeight - padding.bottom,
				yTicks: [0],
			};
		}

		// Find max throughput across all agents
		let maxValue = 1;
		for (const agentId of agentIds) {
			const agentMax = Math.max(...chartData[agentId].map((d) => d.avgTokensPerSecond));
			maxValue = Math.max(maxValue, agentMax);
		}

		// Add 10% padding
		const yMax = Math.ceil(maxValue * 1.1);

		// X scale
		const xScaleFn = (index: number) =>
			padding.left + (index / Math.max(allDates.length - 1, 1)) * innerWidth;

		// Y scale
		const yScaleFn = (value: number) => chartHeight - padding.bottom - (value / yMax) * innerHeight;

		// Y ticks (5 evenly spaced values)
		const tickCount = 5;
		const yTicksArr = Array.from({ length: tickCount }, (_, i) =>
			Math.round((yMax / (tickCount - 1)) * i)
		);

		return { xScale: xScaleFn, yScale: yScaleFn, yTicks: yTicksArr };
	}, [allDates, agentIds, chartData, chartHeight, innerWidth, innerHeight, padding]);

	// Generate line paths for each agent (include all points, even zeros)
	const linePaths = useMemo(() => {
		const paths: Record<string, string> = {};
		for (const agentId of agentIds) {
			const agentDays = chartData[agentId];
			if (agentDays.length === 0) continue;

			// Include all points in the line path (zeros will appear at y=0)
			paths[agentId] = agentDays
				.map((day, idx) => {
					const x = xScale(idx);
					const y = yScale(day.avgTokensPerSecond);
					return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
				})
				.join(' ');
		}
		return paths;
	}, [agentIds, chartData, xScale, yScale]);

	// Handle mouse events
	const handleMouseEnter = useCallback(
		(dayIndex: number, agentId: string, event: React.MouseEvent<SVGCircleElement>) => {
			setHoveredDay({ dayIndex, agentId });
			// Use mouse position directly - more reliable than getBoundingClientRect on SVG elements
			setTooltipPos({
				x: event.clientX,
				y: event.clientY,
			});
		},
		[]
	);

	const handleMouseLeave = useCallback(() => {
		setHoveredDay(null);
		setTooltipPos(null);
	}, []);

	// Check if there's any throughput data
	const hasThroughputData = agentIds.length > 0;

	return (
		<div
			className="p-4 rounded-lg"
			style={{ backgroundColor: theme.colors.bgMain }}
			role="figure"
			aria-label={`Agent throughput chart showing tokens per second over time. ${agentIds.length} agents displayed.`}
		>
			{/* Header */}
			<div className="flex items-center justify-between mb-4">
				<h3 className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
					Agent Throughput Over Time
				</h3>
				<span className="text-xs" style={{ color: theme.colors.textDim }}>
					tok/s by agent
				</span>
			</div>

			{/* Chart container */}
			<div className="relative">
				{!hasThroughputData ? (
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
						aria-label="Line chart showing tokens per second per agent over time"
					>
						{/* Grid lines */}
						{yTicks.map((tick, idx) => (
							<line
								key={`grid-${idx}`}
								x1={padding.left}
								y1={yScale(tick)}
								x2={chartWidth - padding.right}
								y2={yScale(tick)}
								stroke={theme.colors.border}
								strokeOpacity={0.3}
								strokeDasharray="4,4"
							/>
						))}

						{/* Y-axis labels */}
						{yTicks.map((tick, idx) => (
							<text
								key={`y-label-${idx}`}
								x={padding.left - 8}
								y={yScale(tick)}
								textAnchor="end"
								dominantBaseline="middle"
								fill={theme.colors.textDim}
								fontSize={10}
							>
								{tick}
							</text>
						))}

						{/* Y-axis title */}
						<text
							x={15}
							y={chartHeight / 2}
							textAnchor="middle"
							dominantBaseline="middle"
							fill={theme.colors.textDim}
							fontSize={10}
							transform={`rotate(-90, 15, ${chartHeight / 2})`}
						>
							tok/s
						</text>

						{/* X-axis labels */}
						{allDates.map((day, idx) => {
							// Only show every Nth label based on data density
							const showEvery = allDates.length > 14 ? Math.ceil(allDates.length / 7) : 1;
							if (idx % showEvery !== 0 && idx !== allDates.length - 1) return null;

							return (
								<text
									key={`x-label-${idx}`}
									x={xScale(idx)}
									y={chartHeight - padding.bottom + 20}
									textAnchor="middle"
									fill={theme.colors.textDim}
									fontSize={10}
								>
									{formatXAxisDate(day.date, timeRange)}
								</text>
							);
						})}

						{/* Agent lines */}
						{agentIds.map((agentId, agentIdx) => (
							<path
								key={`line-${agentId}`}
								d={linePaths[agentId] || ''}
								fill="none"
								stroke={getAgentColor(agentIdx, colorBlindMode)}
								strokeWidth={2}
								strokeLinecap="round"
								strokeLinejoin="round"
								opacity={hoveredDay && hoveredDay.agentId !== agentId ? 0.3 : 1}
							/>
						))}

						{/* Data points (show all points, smaller for zero values) */}
						{agentIds.map((agentId, agentIdx) =>
							chartData[agentId].map((day, dayIdx) => {
								const isHovered =
									hoveredDay?.dayIndex === dayIdx && hoveredDay?.agentId === agentId;
								const isZero = day.avgTokensPerSecond === 0;

								return (
									<circle
										key={`point-${agentId}-${dayIdx}`}
										cx={xScale(dayIdx)}
										cy={yScale(day.avgTokensPerSecond)}
										r={isHovered ? 6 : isZero ? 2 : 4}
										fill={getAgentColor(agentIdx, colorBlindMode)}
										stroke={theme.colors.bgMain}
										strokeWidth={isZero ? 1 : 2}
										opacity={isZero ? 0.5 : 1}
										style={{ cursor: 'pointer', transition: 'r 0.15s ease' }}
										onMouseEnter={(e) => handleMouseEnter(dayIdx, agentId, e)}
										onMouseLeave={handleMouseLeave}
									/>
								);
							})
						)}
					</svg>
				)}

				{/* Tooltip - rendered via portal to avoid stacking context issues */}
				{hoveredDay &&
					tooltipPos &&
					allDates[hoveredDay.dayIndex] &&
					createPortal(
						<div
							className="fixed z-[10000] px-3 py-2 rounded-lg shadow-lg text-xs pointer-events-none"
							style={{
								backgroundColor: theme.colors.bgSidebar,
								border: `1px solid ${theme.colors.border}`,
								color: theme.colors.textMain,
								left: tooltipPos.x,
								top: tooltipPos.y - TOOLTIP_OFFSET,
								transform: 'translate(-50%, -100%)',
							}}
						>
							<div className="font-medium mb-1">{allDates[hoveredDay.dayIndex].formattedDate}</div>
							{hoveredDay.agentId && chartData[hoveredDay.agentId] && (
								<div className="flex items-center gap-2">
									<div
										className="w-2 h-2 rounded-full"
										style={{
											backgroundColor: getAgentColor(
												agentIds.indexOf(hoveredDay.agentId),
												colorBlindMode
											),
										}}
									/>
									<span style={{ color: theme.colors.textDim }}>
										{agentDisplayNames[hoveredDay.agentId]}:
									</span>
									<span className="font-medium">
										{formatThroughput(
											chartData[hoveredDay.agentId][hoveredDay.dayIndex].avgTokensPerSecond
										)}
									</span>
								</div>
							)}
						</div>,
						document.body
					)}
			</div>

			{/* Legend */}
			{hasThroughputData && (
				<div className="flex flex-wrap gap-x-4 gap-y-1 mt-4 justify-center">
					{agentIds.map((agentId, idx) => (
						<div key={agentId} className="flex items-center gap-1.5">
							<div
								className="w-3 h-3 rounded-sm"
								style={{ backgroundColor: getAgentColor(idx, colorBlindMode) }}
							/>
							<span className="text-xs" style={{ color: theme.colors.textDim }}>
								{agentDisplayNames[agentId]}
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

export default AgentThroughputChart;
