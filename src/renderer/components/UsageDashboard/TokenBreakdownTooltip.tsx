/**
 * TokenBreakdownTooltip
 *
 * Hover tooltip for Summary Cards showing token breakdown by type
 * (input, output, cache creation) and cost. The Delta card variant
 * shows a side-by-side source comparison.
 *
 * @see Auto Run Document 53
 */

import { useState, useRef, useEffect } from 'react';
import type { Theme } from '../../types';

export interface TokenBreakdown {
	inputTokens: number;
	outputTokens: number;
	cacheCreationTokens: number;
	costUsd: number;
	billableTokens: number;
	// Free tokens from local models (optional — only shown when present)
	freeInputTokens?: number;
	freeOutputTokens?: number;
	freeCacheCreationTokens?: number;
	freeTotalTokens?: number;
}

interface TokenBreakdownTooltipProps {
	theme: Theme;
	children: React.ReactNode;
	/** Single-source tooltip */
	breakdown?: TokenBreakdown;
	/** Comparison tooltip (for Delta card) */
	comparison?: {
		local: TokenBreakdown;
		honeycomb: TokenBreakdown;
	};
}

function formatTokens(tokens: number): string {
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
	if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
	return tokens.toLocaleString();
}

function SingleBreakdown({ theme, data }: { theme: Theme; data: TokenBreakdown }) {
	const tokenRows = [
		{ label: 'Input', value: data.inputTokens },
		{ label: 'Output', value: data.outputTokens },
		{ label: 'Cache Creation', value: data.cacheCreationTokens },
	];

	const hasFreeTokens =
		(data.freeInputTokens ?? 0) > 0 ||
		(data.freeOutputTokens ?? 0) > 0 ||
		(data.freeCacheCreationTokens ?? 0) > 0;

	const freeTokenRows = hasFreeTokens
		? [
				{ label: 'Input', value: data.freeInputTokens ?? 0 },
				{ label: 'Output', value: data.freeOutputTokens ?? 0 },
				{ label: 'Cache Creation', value: data.freeCacheCreationTokens ?? 0 },
			]
		: [];

	const grandTotalTokens = data.billableTokens + (data.freeTotalTokens ?? 0);

	return (
		<div className="space-y-1">
			{/* Billable Tokens header */}
			<div className="text-xs font-medium mb-2" style={{ color: theme.colors.textMain }}>
				Billable Tokens
			</div>
			{tokenRows.map((row) => (
				<div key={row.label} className="flex justify-between text-xs gap-4">
					<span style={{ color: theme.colors.textDim }}>{row.label}</span>
					<span className="font-mono" style={{ color: theme.colors.textMain }}>
						{formatTokens(row.value)}
					</span>
				</div>
			))}
			{/* Billable Tokens subtotal */}
			<div
				className="flex justify-between text-xs pt-1 mt-1"
				style={{ borderTop: `1px solid ${theme.colors.border}` }}
			>
				<span style={{ color: theme.colors.textDim }}>Subtotal</span>
				<span className="font-mono font-medium" style={{ color: theme.colors.textMain }}>
					{formatTokens(data.billableTokens)}
				</span>
			</div>

			{/* Free Tokens section (only if present) */}
			{hasFreeTokens && (
				<>
					<div
						className="text-xs font-medium mt-3 mb-2 pt-2"
						style={{
							color: '#22c55e',
							borderTop: `1px dashed ${theme.colors.border}`,
						}}
					>
						Free Tokens (Local Models)
					</div>
					{freeTokenRows.map((row) => (
						<div key={`free-${row.label}`} className="flex justify-between text-xs gap-4">
							<span style={{ color: theme.colors.textDim }}>{row.label}</span>
							<span className="font-mono" style={{ color: '#22c55e' }}>
								{formatTokens(row.value)}
							</span>
						</div>
					))}
					<div
						className="flex justify-between text-xs pt-1 mt-1"
						style={{ borderTop: `1px solid ${theme.colors.border}` }}
					>
						<span style={{ color: theme.colors.textDim }}>Subtotal</span>
						<span className="font-mono font-medium" style={{ color: '#22c55e' }}>
							{formatTokens(data.freeTotalTokens ?? 0)} ($0.00)
						</span>
					</div>
				</>
			)}

			{/* Grand Total Costs */}
			<div
				className="flex justify-between text-xs pt-1 mt-1"
				style={{ borderTop: `2px solid ${theme.colors.border}` }}
			>
				<span className="font-medium" style={{ color: theme.colors.textDim }}>
					Grand Total{hasFreeTokens ? ` (${formatTokens(grandTotalTokens)} tokens)` : ''}
				</span>
				<span className="font-mono font-medium" style={{ color: theme.colors.textMain }}>
					${data.costUsd.toFixed(2)}
				</span>
			</div>
		</div>
	);
}

function ComparisonBreakdown({
	theme,
	data,
}: {
	theme: Theme;
	data: { local: TokenBreakdown; honeycomb: TokenBreakdown };
}) {
	const tokenRows = [
		{ label: 'Input', localVal: data.local.inputTokens, hcVal: data.honeycomb.inputTokens },
		{ label: 'Output', localVal: data.local.outputTokens, hcVal: data.honeycomb.outputTokens },
		{
			label: 'Cache Create',
			localVal: data.local.cacheCreationTokens,
			hcVal: data.honeycomb.cacheCreationTokens,
		},
	];

	const billableRow = {
		label: 'Billable Tokens',
		localVal: data.local.billableTokens,
		hcVal: data.honeycomb.billableTokens,
	};

	const hasFreeTokens =
		(data.local.freeInputTokens ?? 0) > 0 ||
		(data.local.freeOutputTokens ?? 0) > 0 ||
		(data.local.freeCacheCreationTokens ?? 0) > 0 ||
		(data.honeycomb.freeInputTokens ?? 0) > 0 ||
		(data.honeycomb.freeOutputTokens ?? 0) > 0 ||
		(data.honeycomb.freeCacheCreationTokens ?? 0) > 0;

	const freeTokenRows = hasFreeTokens
		? [
				{
					label: 'Input',
					localVal: data.local.freeInputTokens ?? 0,
					hcVal: data.honeycomb.freeInputTokens ?? 0,
				},
				{
					label: 'Output',
					localVal: data.local.freeOutputTokens ?? 0,
					hcVal: data.honeycomb.freeOutputTokens ?? 0,
				},
				{
					label: 'Cache Create',
					localVal: data.local.freeCacheCreationTokens ?? 0,
					hcVal: data.honeycomb.freeCacheCreationTokens ?? 0,
				},
			]
		: [];

	const freeSubtotalRow = hasFreeTokens
		? {
				label: 'Free Tokens',
				localVal: data.local.freeTotalTokens ?? 0,
				hcVal: data.honeycomb.freeTotalTokens ?? 0,
			}
		: null;

	const renderRow = (
		row: { label: string; localVal: number; hcVal: number },
		extraClass?: string,
		extraStyle?: React.CSSProperties
	) => {
		const delta = row.localVal - row.hcVal;
		const deltaColor = delta > 0 ? '#22c55e' : delta < 0 ? '#ef4444' : theme.colors.textDim;
		return (
			<div key={row.label} className={`flex text-xs gap-2 ${extraClass || ''}`} style={extraStyle}>
				<span className="flex-1" style={{ color: theme.colors.textDim }}>
					{row.label}
				</span>
				<span className="w-20 text-right font-mono" style={{ color: theme.colors.textMain }}>
					{formatTokens(row.localVal)}
				</span>
				<span className="w-20 text-right font-mono" style={{ color: theme.colors.textMain }}>
					{formatTokens(row.hcVal)}
				</span>
				<span className="w-20 text-right font-mono" style={{ color: deltaColor }}>
					{delta >= 0 ? '+' : ''}
					{formatTokens(delta)}
				</span>
			</div>
		);
	};

	const renderFreeRow = (
		row: { label: string; localVal: number; hcVal: number },
		extraClass?: string,
		extraStyle?: React.CSSProperties
	) => {
		const delta = row.localVal - row.hcVal;
		const deltaColor = delta > 0 ? '#22c55e' : delta < 0 ? '#ef4444' : theme.colors.textDim;
		return (
			<div
				key={`free-${row.label}`}
				className={`flex text-xs gap-2 ${extraClass || ''}`}
				style={extraStyle}
			>
				<span className="flex-1" style={{ color: theme.colors.textDim }}>
					{row.label}
				</span>
				<span className="w-20 text-right font-mono" style={{ color: '#22c55e' }}>
					{formatTokens(row.localVal)}
				</span>
				<span className="w-20 text-right font-mono" style={{ color: '#22c55e' }}>
					{formatTokens(row.hcVal)}
				</span>
				<span className="w-20 text-right font-mono" style={{ color: deltaColor }}>
					{delta >= 0 ? '+' : ''}
					{formatTokens(delta)}
				</span>
			</div>
		);
	};

	return (
		<div className="space-y-1">
			{/* Header row */}
			<div className="flex text-xs font-medium gap-2 mb-2">
				<span className="flex-1" style={{ color: theme.colors.textDim }}></span>
				<span className="w-20 text-right" style={{ color: theme.colors.textMain }}>
					Local
				</span>
				<span className="w-20 text-right" style={{ color: theme.colors.textMain }}>
					HC
				</span>
				<span className="w-20 text-right" style={{ color: theme.colors.textMain }}>
					Delta
				</span>
			</div>
			{tokenRows.map((row) => renderRow(row))}
			{/* Separator + Billable Tokens subtotal */}
			{renderRow(billableRow, 'pt-1 mt-1', { borderTop: `1px solid ${theme.colors.border}` })}
			{/* Free Tokens comparison section (only if present on either side) */}
			{hasFreeTokens && (
				<>
					<div
						className="text-xs font-medium mt-3 mb-2 pt-2"
						style={{
							color: '#22c55e',
							borderTop: `1px dashed ${theme.colors.border}`,
						}}
					>
						Free Tokens (Local Models)
					</div>
					{freeTokenRows.map((row) => renderFreeRow(row))}
					{freeSubtotalRow &&
						renderFreeRow(freeSubtotalRow, 'pt-1 mt-1 font-medium', {
							borderTop: `1px solid ${theme.colors.border}`,
						})}
				</>
			)}
			{/* Thicker separator + Grand Total Costs */}
			<div
				className="flex text-xs gap-2 pt-1 mt-1"
				style={{ borderTop: `2px solid ${theme.colors.border}` }}
			>
				<span className="flex-1 font-medium" style={{ color: theme.colors.textDim }}>
					Grand Total Costs
				</span>
				<span className="w-20 text-right font-mono" style={{ color: theme.colors.textMain }}>
					${data.local.costUsd.toFixed(2)}
				</span>
				<span className="w-20 text-right font-mono" style={{ color: theme.colors.textMain }}>
					${data.honeycomb.costUsd.toFixed(2)}
				</span>
				{(() => {
					const delta = data.local.costUsd - data.honeycomb.costUsd;
					const color = delta > 0 ? '#22c55e' : delta < 0 ? '#ef4444' : theme.colors.textDim;
					return (
						<span className="w-20 text-right font-mono" style={{ color }}>
							{delta >= 0 ? '+' : ''}${Math.abs(delta).toFixed(2)}
						</span>
					);
				})()}
			</div>
		</div>
	);
}

export function TokenBreakdownTooltip({
	theme,
	children,
	breakdown,
	comparison,
}: TokenBreakdownTooltipProps) {
	const [isVisible, setIsVisible] = useState(false);
	const [position, setPosition] = useState<'below' | 'above'>('below');
	const containerRef = useRef<HTMLDivElement>(null);
	const tooltipRef = useRef<HTMLDivElement>(null);

	// Determine if tooltip should appear above or below
	useEffect(() => {
		if (isVisible && containerRef.current && tooltipRef.current) {
			const containerRect = containerRef.current.getBoundingClientRect();
			const tooltipHeight = tooltipRef.current.offsetHeight;
			const spaceBelow = window.innerHeight - containerRect.bottom;
			if (spaceBelow < tooltipHeight + 8) {
				setPosition('above');
			} else {
				setPosition('below');
			}
		}
	}, [isVisible]);

	if (!breakdown && !comparison) {
		return <>{children}</>;
	}

	return (
		<div
			ref={containerRef}
			className="relative"
			onMouseEnter={() => setIsVisible(true)}
			onMouseLeave={() => setIsVisible(false)}
		>
			{children}
			{isVisible && (
				<div
					ref={tooltipRef}
					className="absolute left-0 z-50 rounded-lg shadow-lg border p-3 w-full"
					style={{
						backgroundColor: theme.colors.bgMain,
						borderColor: theme.colors.border,
						...(position === 'below'
							? { top: '100%', marginTop: '4px' }
							: { bottom: '100%', marginBottom: '4px' }),
					}}
				>
					{breakdown && <SingleBreakdown theme={theme} data={breakdown} />}
					{comparison && <ComparisonBreakdown theme={theme} data={comparison} />}
				</div>
			)}
		</div>
	);
}
