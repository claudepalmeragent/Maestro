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
import { format, parseISO } from 'date-fns';
import type { Theme, Session } from '../../types';
import type { StatsTimeRange, StatsAggregation } from '../../hooks/useStats';
import { COLORBLIND_AGENT_PALETTE } from '../../constants/colorblindPalettes';

// Tooltip positioning constants
const TOOLTIP_FLIP_THRESHOLD = 80; // pixels from top of viewport to trigger flip
const TOOLTIP_OFFSET = 10; // pixels gap between tooltip and data point

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
 * Extract a display name from a session ID
 * Session IDs are in format: "sessionId-ai-tabId" or similar
 * Returns the session name if found, or first 8 chars of the UUID
 */
function getSessionDisplayName(sessionId: string, sessions?: Session[]): string {
	// Try to find the session by ID to get its name
	if (sessions) {
		// Session IDs in stats may include tab suffixes like "-ai-tabId"
		// Try to match the base session ID
		const session = sessions.find((s) => sessionId.startsWith(s.id));
		if (session?.name) {
			return session.name;
		}
	}

	// Fallback: extract the UUID part and show first 8 chars
	// Format is typically "uuid-ai-tabId" or just "uuid"
	const parts = sessionId.split('-');
	if (parts.length >= 5) {
		// UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
		// Take first segment
		return parts[0].substring(0, 8).toUpperCase();
	}
	return sessionId.substring(0, 8).toUpperCase();
}

export function AgentThroughputChart({
	data,
	timeRange,
	theme,
	colorBlindMode = false,
	sessions,
}: AgentThroughputChartProps) {
	const [hoveredDay, setHoveredDay] = useState<{ dayIndex: number; sessionId?: string } | null>(
		null
	);
	const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

	// Chart dimensions
	const chartWidth = 600;
	const chartHeight = 220;
	const padding = { top: 20, right: 50, bottom: 40, left: 60 };
	const innerWidth = chartWidth - padding.left - padding.right;
	const innerHeight = chartHeight - padding.top - padding.bottom;

	// Process bySessionByDay data for the chart
	const { sessionIds, chartData, allDates, sessionDisplayNames } = useMemo(() => {
		const bySessionByDay = data.bySessionByDay || {};

		// Calculate total queries per session to rank them (include all sessions, even without throughput data)
		const sessionTotals: Array<{ sessionId: string; avgThroughput: number; totalQueries: number }> =
			[];
		for (const sessionId of Object.keys(bySessionByDay)) {
			const days = bySessionByDay[sessionId];
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
			sessionTotals.push({ sessionId, avgThroughput, totalQueries });
		}

		// Sort by total queries descending and take top 10 (include ALL sessions, even without throughput data)
		sessionTotals.sort((a, b) => b.totalQueries - a.totalQueries);
		const topSessions = sessionTotals.slice(0, 10);
		const sessionIdList = topSessions.map((s) => s.sessionId);

		// Build display name map
		const displayNames: Record<string, string> = {};
		for (const sessionId of sessionIdList) {
			displayNames[sessionId] = getSessionDisplayName(sessionId, sessions);
		}

		// Collect all unique dates from selected sessions
		const dateSet = new Set<string>();
		for (const sessionId of sessionIdList) {
			for (const day of bySessionByDay[sessionId]) {
				dateSet.add(day.date);
			}
		}
		const sortedDates = Array.from(dateSet).sort();

		// Build per-session arrays aligned to all dates
		const sessionData: Record<string, SessionDayData[]> = {};
		for (const sessionId of sessionIdList) {
			const dayMap = new Map<
				string,
				{ avgTokensPerSecond: number; outputTokens: number; count: number }
			>();
			for (const day of bySessionByDay[sessionId]) {
				dayMap.set(day.date, {
					avgTokensPerSecond: day.avgTokensPerSecond || 0,
					outputTokens: day.outputTokens || 0,
					count: day.count,
				});
			}

			sessionData[sessionId] = sortedDates.map((date) => ({
				date,
				formattedDate: format(parseISO(date), 'EEEE, MMM d, yyyy'),
				avgTokensPerSecond: dayMap.get(date)?.avgTokensPerSecond || 0,
				outputTokens: dayMap.get(date)?.outputTokens || 0,
				count: dayMap.get(date)?.count || 0,
			}));
		}

		// Build combined day data for tooltips (include all sessions, even with zero throughput)
		interface CombinedDayData {
			date: string;
			formattedDate: string;
			sessions: Record<string, { avgTokensPerSecond: number; outputTokens: number; count: number }>;
		}
		const combinedData: CombinedDayData[] = sortedDates.map((date) => {
			const sessionsOnDay: Record<
				string,
				{ avgTokensPerSecond: number; outputTokens: number; count: number }
			> = {};
			for (const sessionId of sessionIdList) {
				const dayData = sessionData[sessionId].find((d) => d.date === date);
				if (dayData) {
					sessionsOnDay[sessionId] = {
						avgTokensPerSecond: dayData.avgTokensPerSecond,
						outputTokens: dayData.outputTokens,
						count: dayData.count,
					};
				}
			}
			return {
				date,
				formattedDate: format(parseISO(date), 'EEEE, MMM d, yyyy'),
				sessions: sessionsOnDay,
			};
		});

		return {
			sessionIds: sessionIdList,
			chartData: sessionData,
			allDates: combinedData,
			sessionDisplayNames: displayNames,
		};
	}, [data.bySessionByDay, sessions]);

	// Calculate scales
	const { xScale, yScale, yTicks } = useMemo(() => {
		if (allDates.length === 0) {
			return {
				xScale: (_: number) => padding.left,
				yScale: (_: number) => chartHeight - padding.bottom,
				yTicks: [0],
			};
		}

		// Find max throughput across all sessions
		let maxValue = 1;
		for (const sessionId of sessionIds) {
			const sessionMax = Math.max(...chartData[sessionId].map((d) => d.avgTokensPerSecond));
			maxValue = Math.max(maxValue, sessionMax);
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
	}, [allDates, sessionIds, chartData, chartHeight, innerWidth, innerHeight, padding]);

	// Generate line paths for each session (include all points, even zeros)
	const linePaths = useMemo(() => {
		const paths: Record<string, string> = {};
		for (const sessionId of sessionIds) {
			const sessionDays = chartData[sessionId];
			if (sessionDays.length === 0) continue;

			// Include all points in the line path (zeros will appear at y=0)
			paths[sessionId] = sessionDays
				.map((day, idx) => {
					const x = xScale(idx);
					const y = yScale(day.avgTokensPerSecond);
					return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
				})
				.join(' ');
		}
		return paths;
	}, [sessionIds, chartData, xScale, yScale]);

	// Handle mouse events
	const handleMouseEnter = useCallback(
		(dayIndex: number, sessionId: string, event: React.MouseEvent<SVGCircleElement>) => {
			setHoveredDay({ dayIndex, sessionId });
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
	const hasThroughputData = sessionIds.length > 0;

	return (
		<div
			className="p-4 rounded-lg"
			style={{ backgroundColor: theme.colors.bgMain }}
			role="figure"
			aria-label={`Agent throughput chart showing tokens per second over time. ${sessionIds.length} agents displayed.`}
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

						{/* Session lines */}
						{sessionIds.map((sessionId, sessionIdx) => (
							<path
								key={`line-${sessionId}`}
								d={linePaths[sessionId] || ''}
								fill="none"
								stroke={getAgentColor(sessionIdx, colorBlindMode)}
								strokeWidth={2}
								strokeLinecap="round"
								strokeLinejoin="round"
								opacity={hoveredDay && hoveredDay.sessionId !== sessionId ? 0.3 : 1}
							/>
						))}

						{/* Data points (show all points, smaller for zero values) */}
						{sessionIds.map((sessionId, sessionIdx) =>
							chartData[sessionId].map((day, dayIdx) => {
								const isHovered =
									hoveredDay?.dayIndex === dayIdx && hoveredDay?.sessionId === sessionId;
								const isZero = day.avgTokensPerSecond === 0;

								return (
									<circle
										key={`point-${sessionId}-${dayIdx}`}
										cx={xScale(dayIdx)}
										cy={yScale(day.avgTokensPerSecond)}
										r={isHovered ? 6 : isZero ? 2 : 4}
										fill={getAgentColor(sessionIdx, colorBlindMode)}
										stroke={theme.colors.bgMain}
										strokeWidth={isZero ? 1 : 2}
										opacity={isZero ? 0.5 : 1}
										style={{ cursor: 'pointer', transition: 'r 0.15s ease' }}
										onMouseEnter={(e) => handleMouseEnter(dayIdx, sessionId, e)}
										onMouseLeave={handleMouseLeave}
									/>
								);
							})
						)}
					</svg>
				)}

				{/* Tooltip */}
				{hoveredDay && tooltipPos && allDates[hoveredDay.dayIndex] && (
					<div
						className="fixed z-50 px-3 py-2 rounded-lg shadow-lg text-xs pointer-events-none"
						style={{
							backgroundColor: theme.colors.bgSidebar,
							border: `1px solid ${theme.colors.border}`,
							color: theme.colors.textMain,
							left: tooltipPos.x,
							// Flip tooltip below data point if it would overflow viewport top
							top:
								tooltipPos.y < TOOLTIP_FLIP_THRESHOLD
									? tooltipPos.y + TOOLTIP_OFFSET
									: tooltipPos.y - TOOLTIP_OFFSET,
							transform:
								tooltipPos.y < TOOLTIP_FLIP_THRESHOLD
									? 'translateX(-50%)'
									: 'translate(-50%, -100%)',
						}}
					>
						<div className="font-medium mb-1">{allDates[hoveredDay.dayIndex].formattedDate}</div>
						{hoveredDay.sessionId && chartData[hoveredDay.sessionId] && (
							<div className="flex items-center gap-2">
								<div
									className="w-2 h-2 rounded-full"
									style={{
										backgroundColor: getAgentColor(
											sessionIds.indexOf(hoveredDay.sessionId),
											colorBlindMode
										),
									}}
								/>
								<span style={{ color: theme.colors.textDim }}>
									{sessionDisplayNames[hoveredDay.sessionId]}:
								</span>
								<span className="font-medium">
									{formatThroughput(
										chartData[hoveredDay.sessionId][hoveredDay.dayIndex].avgTokensPerSecond
									)}
								</span>
							</div>
						)}
					</div>
				)}
			</div>

			{/* Legend */}
			{hasThroughputData && (
				<div className="flex flex-wrap gap-x-4 gap-y-1 mt-4 justify-center">
					{sessionIds.map((sessionId, idx) => (
						<div key={sessionId} className="flex items-center gap-1.5">
							<div
								className="w-3 h-3 rounded-sm"
								style={{ backgroundColor: getAgentColor(idx, colorBlindMode) }}
							/>
							<span className="text-xs" style={{ color: theme.colors.textDim }}>
								{sessionDisplayNames[sessionId]}
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

export default AgentThroughputChart;
