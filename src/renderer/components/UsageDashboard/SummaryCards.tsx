/**
 * SummaryCards
 *
 * Displays key metrics in card format at the top of the Usage Dashboard.
 *
 * Metrics displayed:
 * - Total queries
 * - Total time (formatted: "12h 34m")
 * - Average duration
 * - Most active agent
 * - Interactive vs Auto ratio
 *
 * Features:
 * - Theme-aware styling with inline styles
 * - Subtle icons for each metric
 * - Responsive horizontal card layout
 * - Formatted values for readability
 */

import React, { memo, useMemo } from 'react';
import {
	MessageSquare,
	Clock,
	Timer,
	Bot,
	Users,
	Layers,
	Sunrise,
	Globe,
	Zap,
	PanelTop,
	FileText,
	DollarSign,
} from 'lucide-react';
import type { Theme, Session } from '../../types';
import type { StatsAggregation } from '../../hooks/stats/useStats';
import { formatTokensCompact } from '../../utils/formatters';

interface SummaryCardsProps {
	/** Aggregated stats data from the API */
	data: StatsAggregation;
	/** Current theme for styling */
	theme: Theme;
	/** Number of columns for responsive layout (default: 4 for 2 rows × 4 cols) */
	columns?: number;
	/** Sessions array for accurate agent count (filters terminal sessions) */
	sessions?: Session[];
}

/**
 * Format duration in milliseconds to human-readable string
 * Examples: "12h 34m", "5m 30s", "45s"
 */
function formatDuration(ms: number): string {
	if (ms === 0) return '0s';

	const totalSeconds = Math.floor(ms / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	if (hours > 0) {
		return `${hours}h ${minutes}m`;
	}
	if (minutes > 0) {
		return `${minutes}m ${seconds}s`;
	}
	return `${seconds}s`;
}

/**
 * Format large numbers with K/M suffixes for readability
 * Examples: "1.2K", "3.5M", "42"
 */
function formatNumber(num: number): string {
	if (num >= 1000000) {
		return `${(num / 1000000).toFixed(1)}M`;
	}
	if (num >= 1000) {
		return `${(num / 1000).toFixed(1)}K`;
	}
	return num.toString();
}

/**
 * Single metric card component
 */
interface MetricCardProps {
	icon: React.ReactNode;
	label: string;
	value: string;
	theme: Theme;
	/** Animation delay index for staggered entrance (0-based) */
	animationIndex?: number;
	/** Optional subtitle displayed below the value */
	subtitle?: React.ReactNode;
	/** Optional tooltip shown on hover (supports newlines) */
	tooltip?: string;
}

const MetricCard = memo(function MetricCard({
	icon,
	label,
	value,
	theme,
	animationIndex = 0,
	subtitle,
	tooltip,
}: MetricCardProps) {
	return (
		<div
			className="p-4 rounded-lg flex items-start gap-3 dashboard-card-enter"
			style={{
				backgroundColor: theme.colors.bgMain,
				animationDelay: `${animationIndex * 50}ms`,
			}}
			data-testid="metric-card"
			role="group"
			aria-label={`${label}: ${value}`}
			title={tooltip}
		>
			<div
				className="flex-shrink-0 p-2 rounded-md"
				style={{
					backgroundColor: `${theme.colors.accent}15`,
					color: theme.colors.textMain,
				}}
			>
				{icon}
			</div>
			<div className="min-w-0 flex-1">
				<div
					className="text-xs uppercase tracking-wide mb-1"
					style={{ color: theme.colors.textDim }}
				>
					{label}
				</div>
				<div className="text-2xl font-bold" style={{ color: theme.colors.textMain }}>
					{value}
				</div>
				{subtitle && (
					<div className="text-xs mt-1" style={{ color: theme.colors.textDim }}>
						{subtitle}
					</div>
				)}
			</div>
		</div>
	);
});

/**
 * Format hour number (0-23) to human-readable time
 * Examples: 0 → "12 AM", 13 → "1 PM", 9 → "9 AM"
 */
function formatHour(hour: number): string {
	const suffix = hour >= 12 ? 'PM' : 'AM';
	const displayHour = hour % 12 || 12;
	return `${displayHour} ${suffix}`;
}

export const SummaryCards = memo(function SummaryCards({
	data,
	theme,
	columns = 4,
	sessions,
}: SummaryCardsProps) {
	// Count agent sessions (exclude terminal-only sessions) for accurate total
	const agentCount = useMemo(() => {
		if (sessions) {
			return sessions.filter((s) => s.toolType !== 'terminal').length;
		}
		// Fallback to stats-based count if sessions not provided
		return data.totalSessions;
	}, [sessions, data.totalSessions]);

	// Count open tabs across all sessions (AI + file preview)
	const openTabCount = useMemo(() => {
		if (!sessions) return 0;
		return sessions.reduce((total, s) => {
			const aiCount = s.aiTabs?.length ?? 0;
			const fileCount = s.filePreviewTabs?.length ?? 0;
			return total + aiCount + fileCount;
		}, 0);
	}, [sessions]);

	// Calculate derived metrics
	const {
		mostActiveAgent,
		interactiveRatio,
		peakHour,
		localVsRemote,
		queriesPerSession,
		throughputDisplay,
		totalTokensDisplay,
		totalTokensSubtitle,
		totalTokensTooltip,
		totalCostDisplay,
		totalCostSubtitle,
		totalCostTooltip,
	} = useMemo(() => {
		// Find most active agent by query count
		const agents = Object.entries(data.byAgent);
		const topAgent = agents.length > 0 ? agents.sort((a, b) => b[1].count - a[1].count)[0] : null;

		// Calculate interactive percentage
		const totalBySource = data.bySource.user + data.bySource.auto;
		const ratio =
			totalBySource > 0 ? `${Math.round((data.bySource.user / totalBySource) * 100)}%` : 'N/A';

		// Find peak usage hour (hour with most queries)
		const hourWithMostQueries = data.byHour.reduce(
			(max, curr) => (curr.count > max.count ? curr : max),
			{ hour: 0, count: 0, duration: 0 }
		);
		const peak = hourWithMostQueries.count > 0 ? formatHour(hourWithMostQueries.hour) : 'N/A';

		// Calculate local vs remote percentage
		const totalByLocation = data.byLocation.local + data.byLocation.remote;
		const localPercent =
			totalByLocation > 0
				? `${Math.round((data.byLocation.local / totalByLocation) * 100)}%`
				: 'N/A';

		// Calculate queries per session using agent count for consistency
		const qps = agentCount > 0 ? (data.totalQueries / agentCount).toFixed(1) : 'N/A';

		// Format throughput (tokens per second)
		const throughput =
			data.avgTokensPerSecond && data.avgTokensPerSecond > 0
				? `${data.avgTokensPerSecond.toFixed(1)} tok/s`
				: 'N/A';

		// Format total tokens (input + output)
		const totalInputOutput = (data.totalInputTokens || 0) + (data.totalOutputTokens || 0);
		const totalTokens = totalInputOutput > 0 ? formatTokensCompact(totalInputOutput) : 'N/A';

		// Cache tokens for inline composition
		const cacheRead = data.totalCacheReadInputTokens || 0;
		const cacheWrite = data.totalCacheCreationInputTokens || 0;
		const totalCache = cacheRead + cacheWrite;
		const inputTokens = data.totalInputTokens || 0;
		const outputTokens = data.totalOutputTokens || 0;
		const tokenSubtitle =
			totalInputOutput > 0 ? (
				<div className="flex gap-2" style={{ fontSize: '10px' }}>
					<span>In: {formatTokensCompact(inputTokens)}</span>
					<span>Out: {formatTokensCompact(outputTokens)}</span>
					{totalCache > 0 && <span>Cache: {formatTokensCompact(totalCache)}</span>}
				</div>
			) : undefined;

		// Detailed tooltip for tokens
		const tokenTooltip = `Input: ${formatTokensCompact(inputTokens)}\nOutput: ${formatTokensCompact(outputTokens)}\nCache Read: ${formatTokensCompact(cacheRead)}\nCache Write: ${formatTokensCompact(cacheWrite)}`;

		// Format total cost with dual display
		const maestroCost = data.totalCostUsd || 0;
		const anthropicCost = data.anthropicCostUsd || 0;
		const savings = data.savingsUsd || 0;
		const costDisplay = `$${maestroCost.toFixed(2)}`;

		// Cost subtitle: show savings if positive (indicates Max billing mode savings)
		const costSubtitle = savings > 0 ? `Saved $${savings.toFixed(2)} vs API pricing` : undefined;

		// Cost tooltip: show both costs and savings breakdown
		let costTooltipText = 'Total API cost across all queries in the selected time range';
		if (anthropicCost > 0 || savings > 0) {
			costTooltipText = `Maestro Cost: $${maestroCost.toFixed(2)}\nAPI Pricing: $${anthropicCost.toFixed(2)}`;
			if (savings > 0) {
				costTooltipText += `\nMax Savings: $${savings.toFixed(2)}`;
			}
		}

		return {
			mostActiveAgent: topAgent ? topAgent[0] : 'N/A',
			interactiveRatio: ratio,
			peakHour: peak,
			localVsRemote: localPercent,
			queriesPerSession: qps,
			throughputDisplay: throughput,
			totalTokensDisplay: totalTokens,
			totalTokensSubtitle: tokenSubtitle,
			totalTokensTooltip: tokenTooltip,
			totalCostDisplay: costDisplay,
			totalCostSubtitle: costSubtitle,
			totalCostTooltip: costTooltipText,
		};
	}, [
		data.byAgent,
		data.bySource,
		data.byHour,
		data.byLocation,
		agentCount,
		data.totalQueries,
		data.avgTokensPerSecond,
		data.totalOutputTokens,
		data.totalInputTokens,
		data.totalCacheReadInputTokens,
		data.totalCacheCreationInputTokens,
		data.totalCostUsd,
		data.anthropicCostUsd,
		data.savingsUsd,
	]);

	const metrics = [
		{
			icon: <Layers className="w-4 h-4" />,
			label: 'Agents',
			value: formatNumber(agentCount),
		},
		{
			icon: <PanelTop className="w-4 h-4" />,
			label: 'Open Tabs',
			value: formatNumber(openTabCount),
		},
		{
			icon: <MessageSquare className="w-4 h-4" />,
			label: 'Total Queries',
			value: formatNumber(data.totalQueries),
		},
		{
			icon: <Zap className="w-4 h-4" />,
			label: 'Queries/Session',
			value: queriesPerSession,
		},
		{
			icon: <Clock className="w-4 h-4" />,
			label: 'Total Time',
			value: formatDuration(data.totalDuration),
		},
		{
			icon: <Timer className="w-4 h-4" />,
			label: 'Avg Duration',
			value: formatDuration(data.avgDuration),
		},
		{
			icon: <Sunrise className="w-4 h-4" />,
			label: 'Peak Hour',
			value: peakHour,
		},
		{
			icon: <Bot className="w-4 h-4" />,
			label: 'Top Agent',
			value: mostActiveAgent,
		},
		{
			icon: <Users className="w-4 h-4" />,
			label: 'Interactive %',
			value: interactiveRatio,
		},
		{
			icon: <Globe className="w-4 h-4" />,
			label: 'Local %',
			value: localVsRemote,
		},
		{
			icon: <Zap className="w-4 h-4" />,
			label: 'Avg Throughput',
			value: throughputDisplay,
		},
		{
			icon: <FileText className="w-4 h-4" />,
			label: 'Total Tokens',
			value: totalTokensDisplay,
			subtitle: totalTokensSubtitle,
			tooltip: totalTokensTooltip,
		},
		{
			icon: <DollarSign className="w-4 h-4" />,
			label: 'Total Cost',
			value: totalCostDisplay,
			subtitle: totalCostSubtitle,
			tooltip: totalCostTooltip,
		},
	];

	return (
		<div
			className="grid gap-4"
			style={{
				gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
			}}
			data-testid="summary-cards"
			role="region"
			aria-label="Usage summary metrics"
		>
			{metrics.map((metric, index) => (
				<MetricCard
					key={metric.label}
					icon={metric.icon}
					label={metric.label}
					value={metric.value}
					theme={theme}
					animationIndex={index}
					subtitle={metric.subtitle}
					tooltip={metric.tooltip}
				/>
			))}
		</div>
	);
});

export default SummaryCards;
