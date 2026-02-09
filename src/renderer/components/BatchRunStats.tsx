import React from 'react';
import type { Theme, BatchRunState } from '../types';
import { formatTokensCompact } from '../utils/formatters';

/**
 * Calculate cost breakdown for token display
 * Uses Claude Sonnet 4 pricing: $3/MTok input, $15/MTok output, $0.30/MTok cache read, $3.75/MTok cache write
 */
function calculateTokenCost(
	inputTokens: number,
	outputTokens: number,
	cacheReadTokens: number,
	cacheWriteTokens: number
): { totalCost: number; cacheCost: number } {
	// Claude pricing per million tokens
	const INPUT_COST = 3.0;
	const OUTPUT_COST = 15.0;
	const CACHE_READ_COST = 0.3;
	const CACHE_WRITE_COST = 3.75;

	const inputCost = (inputTokens / 1_000_000) * INPUT_COST;
	const outputCost = (outputTokens / 1_000_000) * OUTPUT_COST;
	const cacheReadCost = (cacheReadTokens / 1_000_000) * CACHE_READ_COST;
	const cacheWriteCost = (cacheWriteTokens / 1_000_000) * CACHE_WRITE_COST;

	return {
		totalCost: inputCost + outputCost + cacheReadCost + cacheWriteCost,
		cacheCost: cacheReadCost + cacheWriteCost,
	};
}

interface BatchRunStatsProps {
	batchRunState: BatchRunState;
	theme: Theme;
	/** Compact mode for modal footer */
	compact?: boolean;
}

export function BatchRunStats({ batchRunState, theme, compact = false }: BatchRunStatsProps) {
	// Calculate token totals
	const agentInput = batchRunState.cumulativeInputTokens ?? 0;
	const agentOutput = batchRunState.cumulativeOutputTokens ?? 0;
	const agentCacheRead = batchRunState.cumulativeCacheReadTokens ?? 0;
	const agentCacheWrite = batchRunState.cumulativeCacheCreationTokens ?? 0;
	const agentInputOutput = agentInput + agentOutput;
	const agentCache = agentCacheRead + agentCacheWrite;

	const subagentInput = batchRunState.subagentInputTokens ?? 0;
	const subagentOutput = batchRunState.subagentOutputTokens ?? 0;
	const subagentCacheRead = batchRunState.subagentCacheReadTokens ?? 0;
	const subagentCacheWrite = batchRunState.subagentCacheCreationTokens ?? 0;
	const subagentInputOutput = subagentInput + subagentOutput;
	const subagentCache = subagentCacheRead + subagentCacheWrite;

	const totalInputOutput = agentInputOutput + subagentInputOutput;
	const totalCache = agentCache + subagentCache;

	// Calculate costs
	const agentCosts = calculateTokenCost(agentInput, agentOutput, agentCacheRead, agentCacheWrite);
	const subagentCosts = calculateTokenCost(
		subagentInput,
		subagentOutput,
		subagentCacheRead,
		subagentCacheWrite
	);
	const totalCost = agentCosts.totalCost + subagentCosts.totalCost;
	const totalCacheCost = agentCosts.cacheCost + subagentCosts.cacheCost;

	// Don't show anything if no tokens used
	if (totalInputOutput === 0) return null;

	// Compact mode: single line summary
	if (compact) {
		return (
			<div className="flex items-center gap-4 text-xs" style={{ color: theme.colors.textDim }}>
				<span>
					<span style={{ color: theme.colors.textMain }}>
						Tokens: {formatTokensCompact(totalInputOutput)}
					</span>
					{totalCost > 0 && <span> (${totalCost.toFixed(2)})</span>}
				</span>
				{totalCache > 0 && (
					<span className="opacity-80">Cache: {formatTokensCompact(totalCache)}</span>
				)}
				{subagentInputOutput > 0 && (
					<span className="opacity-80">Subagent: {formatTokensCompact(subagentInputOutput)}</span>
				)}
			</div>
		);
	}

	// Full mode: detailed breakdown
	return (
		<div className="text-[10px]" style={{ color: theme.colors.textDim }}>
			{/* Total */}
			<div>
				<span style={{ color: theme.colors.textMain }}>
					Total Tokens used: {formatTokensCompact(totalInputOutput)}
				</span>
				{totalCost > 0 && <span> (${totalCost.toFixed(2)})</span>}
			</div>
			{totalCache > 0 && (
				<div className="ml-2 opacity-80">
					↳ Cache Read + Write: {formatTokensCompact(totalCache)}
					{totalCacheCost > 0 && <span> (${totalCacheCost.toFixed(2)})</span>}
				</div>
			)}

			{/* Agent breakdown - only show if there are agent tokens */}
			{agentInputOutput > 0 && (
				<>
					<div className="mt-1">
						Agent Tokens: {formatTokensCompact(agentInputOutput)}
						{agentCosts.totalCost > 0 && <span> (${agentCosts.totalCost.toFixed(2)})</span>}
					</div>
					{agentCache > 0 && (
						<div className="ml-2 opacity-80">
							↳ Cache Read + Write: {formatTokensCompact(agentCache)}
							{agentCosts.cacheCost > 0 && <span> (${agentCosts.cacheCost.toFixed(2)})</span>}
						</div>
					)}
				</>
			)}

			{/* Subagent breakdown - only show if there are subagent tokens */}
			{subagentInputOutput > 0 && (
				<>
					<div className="mt-1">
						Subagent Tokens: {formatTokensCompact(subagentInputOutput)}
						{subagentCosts.totalCost > 0 && <span> (${subagentCosts.totalCost.toFixed(2)})</span>}
					</div>
					{subagentCache > 0 && (
						<div className="ml-2 opacity-80">
							↳ Cache Read + Write: {formatTokensCompact(subagentCache)}
							{subagentCosts.cacheCost > 0 && <span> (${subagentCosts.cacheCost.toFixed(2)})</span>}
						</div>
					)}
				</>
			)}
		</div>
	);
}

export default BatchRunStats;
