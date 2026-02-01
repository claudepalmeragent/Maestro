/**
 * AgentThroughputChart
 *
 * Line chart showing average throughput (tok/s) per agent type over time.
 * One line per agent type, showing how throughput varies across days.
 *
 * Features:
 * - One line per agent type (e.g., claude-code, cursor, aider)
 * - Y-axis: Average throughput in tokens per second
 * - X-axis: Date (grouped by day)
 * - Hover tooltips with exact values
 * - Theme-aware styling with colorblind support
 * - Limits display to top 10 agents by average throughput
 */

import React, { useState, useMemo, useCallback } from 'react';
import { format, parseISO } from 'date-fns';
import type { Theme } from '../../types';
import type { StatsTimeRange, StatsAggregation } from '../../hooks/useStats';
import { COLORBLIND_AGENT_PALETTE } from '../../constants/colorblindPalettes';

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

// Data point for a single agent on a single day
interface AgentDayData {
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
}

/**
 * Format agent type display name
 */
function formatAgentName(agentType: string): string {
	const names: Record<string, string> = {
		'claude-code': 'Claude Code',
		opencode: 'OpenCode',
		'openai-codex': 'OpenAI Codex',
		'gemini-cli': 'Gemini CLI',
		'qwen3-coder': 'Qwen3 Coder',
		aider: 'Aider',
		cursor: 'Cursor',
		terminal: 'Terminal',
	};
	return names[agentType] || agentType;
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

export function AgentThroughputChart({
	data,
	timeRange,
	theme,
	colorBlindMode = false,
}: AgentThroughputChartProps) {
	const [hoveredDay, setHoveredDay] = useState<{ dayIndex: number; agent?: string } | null>(null);
	const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

	// Chart dimensions
	const chartWidth = 600;
	const chartHeight = 220;
	const padding = { top: 20, right: 50, bottom: 40, left: 60 };
	const innerWidth = chartWidth - padding.left - padding.right;
	const innerHeight = chartHeight - padding.top - padding.bottom;

	// Process byAgentByDay data for the chart
	const { agents, chartData, allDates, agentDisplayNames } = useMemo(() => {
		const byAgentByDay = data.byAgentByDay || {};

		// Calculate average throughput per agent to rank them
		const agentTotals: Array<{ agentType: string; avgThroughput: number; totalQueries: number }> = [];
		for (const agentType of Object.keys(byAgentByDay)) {
			const days = byAgentByDay[agentType];
			// Calculate weighted average throughput (by query count per day)
			let totalWeightedThroughput = 0;
			let totalQueries = 0;
			for (const day of days) {
				if (day.avgTokensPerSecond > 0) {
					totalWeightedThroughput += day.avgTokensPerSecond * day.count;
					totalQueries += day.count;
				}
			}
			const avgThroughput = totalQueries > 0 ? totalWeightedThroughput / totalQueries : 0;
			agentTotals.push({ agentType, avgThroughput, totalQueries });
		}

		// Sort by average throughput descending and take top 10 with data
		agentTotals.sort((a, b) => b.avgThroughput - a.avgThroughput);
		const topAgents = agentTotals
			.filter((a) => a.avgThroughput > 0)
			.slice(0, 10);
		const agentList = topAgents.map((a) => a.agentType);

		// Build display name map
		const displayNames: Record<string, string> = {};
		for (const agentType of agentList) {
			displayNames[agentType] = formatAgentName(agentType);
		}

		// Collect all unique dates from selected agents
		const dateSet = new Set<string>();
		for (const agentType of agentList) {
			for (const day of byAgentByDay[agentType]) {
				dateSet.add(day.date);
			}
		}
		const sortedDates = Array.from(dateSet).sort();

		// Build per-agent arrays aligned to all dates
		const agentData: Record<string, AgentDayData[]> = {};
		for (const agentType of agentList) {
			const dayMap = new Map<string, { avgTokensPerSecond: number; outputTokens: number; count: number }>();
			for (const day of byAgentByDay[agentType]) {
				dayMap.set(day.date, {
					avgTokensPerSecond: day.avgTokensPerSecond || 0,
					outputTokens: day.outputTokens || 0,
					count: day.count,
				});
			}

			agentData[agentType] = sortedDates.map((date) => ({
				date,
				formattedDate: format(parseISO(date), 'EEEE, MMM d, yyyy'),
				avgTokensPerSecond: dayMap.get(date)?.avgTokensPerSecond || 0,
				outputTokens: dayMap.get(date)?.outputTokens || 0,
				count: dayMap.get(date)?.count || 0,
			}));
		}

		// Build combined day data for tooltips
		interface CombinedDayData {
			date: string;
			formattedDate: string;
			agents: Record<string, { avgTokensPerSecond: number; outputTokens: number; count: number }>;
		}
		const combinedData: CombinedDayData[] = sortedDates.map((date) => {
			const agentsOnDay: Record<string, { avgTokensPerSecond: number; outputTokens: number; count: number }> = {};
			for (const agentType of agentList) {
				const dayData = agentData[agentType].find((d) => d.date === date);
				if (dayData && dayData.avgTokensPerSecond > 0) {
					agentsOnDay[agentType] = {
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
			agents: agentList,
			chartData: agentData,
			allDates: combinedData,
			agentDisplayNames: displayNames,
		};
	}, [data.byAgentByDay]);

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
		for (const agent of agents) {
			const agentMax = Math.max(...chartData[agent].map((d) => d.avgTokensPerSecond));
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
	}, [allDates, agents, chartData, chartHeight, innerWidth, innerHeight, padding]);

	// Generate line paths for each agent
	const linePaths = useMemo(() => {
		const paths: Record<string, string> = {};
		for (const agent of agents) {
			const agentDays = chartData[agent];
			if (agentDays.length === 0) continue;

			// Only draw lines through points with data (skip zeros)
			const pointsWithData = agentDays
				.map((day, idx) => ({ day, idx }))
				.filter((p) => p.day.avgTokensPerSecond > 0);

			if (pointsWithData.length === 0) continue;

			paths[agent] = pointsWithData
				.map((p, i) => {
					const x = xScale(p.idx);
					const y = yScale(p.day.avgTokensPerSecond);
					return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
				})
				.join(' ');
		}
		return paths;
	}, [agents, chartData, xScale, yScale]);

	// Handle mouse events
	const handleMouseEnter = useCallback(
		(dayIndex: number, agent: string, event: React.MouseEvent<SVGCircleElement>) => {
			setHoveredDay({ dayIndex, agent });
			const rect = event.currentTarget.getBoundingClientRect();
			setTooltipPos({
				x: rect.left + rect.width / 2,
				y: rect.top,
			});
		},
		[]
	);

	const handleMouseLeave = useCallback(() => {
		setHoveredDay(null);
		setTooltipPos(null);
	}, []);

	// Check if there's any throughput data
	const hasThroughputData = agents.length > 0;

	return (
		<div
			className="p-4 rounded-lg"
			style={{ backgroundColor: theme.colors.bgMain }}
			role="figure"
			aria-label={`Agent throughput chart showing tokens per second over time. ${agents.length} agents displayed.`}
		>
			{/* Header */}
			<div className="flex items-center justify-between mb-4">
				<h3 className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
					Agent Throughput Over Time
				</h3>
				<span className="text-xs" style={{ color: theme.colors.textDim }}>
					tok/s by agent type
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
						{agents.map((agent, agentIdx) => (
							<path
								key={`line-${agent}`}
								d={linePaths[agent] || ''}
								fill="none"
								stroke={getAgentColor(agentIdx, colorBlindMode)}
								strokeWidth={2}
								strokeLinecap="round"
								strokeLinejoin="round"
								opacity={hoveredDay && hoveredDay.agent !== agent ? 0.3 : 1}
							/>
						))}

						{/* Data points */}
						{agents.map((agent, agentIdx) =>
							chartData[agent].map((day, dayIdx) => {
								if (day.avgTokensPerSecond === 0) return null;

								const isHovered =
									hoveredDay?.dayIndex === dayIdx && hoveredDay?.agent === agent;

								return (
									<circle
										key={`point-${agent}-${dayIdx}`}
										cx={xScale(dayIdx)}
										cy={yScale(day.avgTokensPerSecond)}
										r={isHovered ? 6 : 4}
										fill={getAgentColor(agentIdx, colorBlindMode)}
										stroke={theme.colors.bgMain}
										strokeWidth={2}
										style={{ cursor: 'pointer', transition: 'r 0.15s ease' }}
										onMouseEnter={(e) => handleMouseEnter(dayIdx, agent, e)}
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
							top: tooltipPos.y - 10,
							transform: 'translate(-50%, -100%)',
						}}
					>
						<div className="font-medium mb-1">{allDates[hoveredDay.dayIndex].formattedDate}</div>
						{hoveredDay.agent && chartData[hoveredDay.agent] && (
							<div className="flex items-center gap-2">
								<div
									className="w-2 h-2 rounded-full"
									style={{
										backgroundColor: getAgentColor(
											agents.indexOf(hoveredDay.agent),
											colorBlindMode
										),
									}}
								/>
								<span style={{ color: theme.colors.textDim }}>
									{agentDisplayNames[hoveredDay.agent]}:
								</span>
								<span className="font-medium">
									{formatThroughput(chartData[hoveredDay.agent][hoveredDay.dayIndex].avgTokensPerSecond)}
								</span>
							</div>
						)}
					</div>
				)}
			</div>

			{/* Legend */}
			{hasThroughputData && (
				<div className="flex flex-wrap gap-x-4 gap-y-1 mt-4 justify-center">
					{agents.map((agent, idx) => (
						<div key={agent} className="flex items-center gap-1.5">
							<div
								className="w-3 h-3 rounded-sm"
								style={{ backgroundColor: getAgentColor(idx, colorBlindMode) }}
							/>
							<span className="text-xs" style={{ color: theme.colors.textDim }}>
								{agentDisplayNames[agent]}
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

export default AgentThroughputChart;
