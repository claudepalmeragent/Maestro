import React, { useState, useCallback } from 'react';
import { AlertTriangle, Sparkles } from 'lucide-react';
import { useSettings } from '../../../hooks';
import type { Theme } from '../../../types';
import { FontConfigurationPanel } from '../../FontConfigurationPanel';
import { ToggleButtonGroup } from '../../ToggleButtonGroup';

export interface DisplayTabProps {
	theme: Theme;
}

export function DisplayTab({ theme }: DisplayTabProps) {
	const {
		fontFamily,
		setFontFamily,
		fontSize,
		setFontSize,
		terminalWidth,
		setTerminalWidth,
		logLevel,
		setLogLevel,
		maxLogBuffer,
		setMaxLogBuffer,
		maxOutputLines,
		setMaxOutputLines,
		contextManagementSettings,
		updateContextManagementSettings,
		documentGraphShowExternalLinks,
		setDocumentGraphShowExternalLinks,
		documentGraphMaxNodes,
		setDocumentGraphMaxNodes,
	} = useSettings();

	// Font loading state (local to this component)
	const [systemFonts, setSystemFonts] = useState<string[]>([]);
	const [customFonts, setCustomFonts] = useState<string[]>([]);
	const [fontLoading, setFontLoading] = useState(false);
	const [fontsLoaded, setFontsLoaded] = useState(false);

	const loadFonts = useCallback(async () => {
		if (fontsLoaded) return; // Don't reload if already loaded

		setFontLoading(true);
		try {
			const detected = await window.maestro.fonts.detect();
			setSystemFonts(detected);

			const savedCustomFonts = (await window.maestro.settings.get('customFonts')) as
				| string[]
				| undefined;
			if (savedCustomFonts && Array.isArray(savedCustomFonts)) {
				setCustomFonts(savedCustomFonts);
			}
			setFontsLoaded(true);
		} catch (error) {
			console.error('Failed to load fonts:', error);
		} finally {
			setFontLoading(false);
		}
	}, [fontsLoaded]);

	const handleFontInteraction = useCallback(() => {
		if (!fontsLoaded && !fontLoading) {
			loadFonts();
		}
	}, [fontsLoaded, fontLoading, loadFonts]);

	const addCustomFont = useCallback(
		(font: string) => {
			if (font && !customFonts.includes(font)) {
				const newCustomFonts = [...customFonts, font];
				setCustomFonts(newCustomFonts);
				window.maestro.settings.set('customFonts', newCustomFonts);
			}
		},
		[customFonts]
	);

	const removeCustomFont = useCallback(
		(font: string) => {
			const newCustomFonts = customFonts.filter((f) => f !== font);
			setCustomFonts(newCustomFonts);
			window.maestro.settings.set('customFonts', newCustomFonts);
		},
		[customFonts]
	);

	return (
		<div className="space-y-5">
			{/* Font Family */}
			<FontConfigurationPanel
				fontFamily={fontFamily}
				setFontFamily={setFontFamily}
				systemFonts={systemFonts}
				fontsLoaded={fontsLoaded}
				fontLoading={fontLoading}
				customFonts={customFonts}
				onAddCustomFont={addCustomFont}
				onRemoveCustomFont={removeCustomFont}
				onFontInteraction={handleFontInteraction}
				theme={theme}
			/>

			{/* Font Size */}
			<div>
				<label className="block text-xs font-bold opacity-70 uppercase mb-2">Font Size</label>
				<ToggleButtonGroup
					options={[
						{ value: 12, label: 'Small' },
						{ value: 14, label: 'Medium' },
						{ value: 16, label: 'Large' },
						{ value: 18, label: 'X-Large' },
					]}
					value={fontSize}
					onChange={setFontSize}
					theme={theme}
				/>
			</div>

			{/* Terminal Width */}
			<div>
				<label className="block text-xs font-bold opacity-70 uppercase mb-2">
					Terminal Width (Columns)
				</label>
				<ToggleButtonGroup
					options={[80, 100, 120, 160]}
					value={terminalWidth}
					onChange={setTerminalWidth}
					theme={theme}
				/>
			</div>

			{/* Log Level */}
			<div>
				<label className="block text-xs font-bold opacity-70 uppercase mb-2">
					System Log Level
				</label>
				<ToggleButtonGroup
					options={[
						{ value: 'debug', label: 'Debug', activeColor: '#6366f1' },
						{ value: 'info', label: 'Info', activeColor: '#3b82f6' },
						{ value: 'warn', label: 'Warn', activeColor: '#f59e0b' },
						{ value: 'error', label: 'Error', activeColor: '#ef4444' },
					]}
					value={logLevel}
					onChange={setLogLevel}
					theme={theme}
				/>
				<p className="text-xs opacity-50 mt-2">
					Higher levels show fewer logs. Debug shows all logs, Error shows only errors.
				</p>
			</div>

			{/* Max Log Buffer */}
			<div>
				<label className="block text-xs font-bold opacity-70 uppercase mb-2">
					Maximum Log Buffer
				</label>
				<ToggleButtonGroup
					options={[1000, 5000, 10000, 25000]}
					value={maxLogBuffer}
					onChange={setMaxLogBuffer}
					theme={theme}
				/>
				<p className="text-xs opacity-50 mt-2">
					Maximum number of log messages to keep in memory. Older logs are automatically removed.
				</p>
			</div>

			{/* Max Output Lines */}
			<div>
				<label className="block text-xs font-bold opacity-70 uppercase mb-2">
					Max Output Lines per Response
				</label>
				<ToggleButtonGroup
					options={[
						{ value: 15 },
						{ value: 25 },
						{ value: 50 },
						{ value: 100 },
						{ value: Infinity, label: 'All' },
					]}
					value={maxOutputLines}
					onChange={setMaxOutputLines}
					theme={theme}
				/>
				<p className="text-xs opacity-50 mt-2">
					Long outputs will be collapsed into a scrollable window. Set to "All" to always show full
					output.
				</p>
			</div>

			{/* Context Window Warnings */}
			<div>
				<label className="block text-xs font-bold opacity-70 uppercase mb-2 flex items-center gap-2">
					<AlertTriangle className="w-3 h-3" />
					Context Window Warnings
				</label>
				<div
					className="p-3 rounded border space-y-3"
					style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
				>
					{/* Enable/Disable Toggle */}
					<div
						className="flex items-center justify-between cursor-pointer"
						onClick={() =>
							updateContextManagementSettings({
								contextWarningsEnabled: !contextManagementSettings.contextWarningsEnabled,
							})
						}
						role="button"
						tabIndex={0}
						onKeyDown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								updateContextManagementSettings({
									contextWarningsEnabled: !contextManagementSettings.contextWarningsEnabled,
								});
							}
						}}
					>
						<div className="flex-1 pr-3">
							<div className="font-medium" style={{ color: theme.colors.textMain }}>
								Show context consumption warnings
							</div>
							<div className="text-xs opacity-50 mt-0.5" style={{ color: theme.colors.textDim }}>
								Display warning banners when context window usage reaches configurable thresholds
							</div>
						</div>
						<button
							onClick={(e) => {
								e.stopPropagation();
								updateContextManagementSettings({
									contextWarningsEnabled: !contextManagementSettings.contextWarningsEnabled,
								});
							}}
							className="relative w-10 h-5 rounded-full transition-colors flex-shrink-0"
							style={{
								backgroundColor: contextManagementSettings.contextWarningsEnabled
									? theme.colors.accent
									: theme.colors.bgActivity,
							}}
							role="switch"
							aria-checked={contextManagementSettings.contextWarningsEnabled}
						>
							<span
								className={`absolute left-0 top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
									contextManagementSettings.contextWarningsEnabled
										? 'translate-x-5'
										: 'translate-x-0.5'
								}`}
							/>
						</button>
					</div>

					{/* Threshold Sliders (ghosted when disabled) */}
					<div
						className="space-y-4 pt-3 border-t"
						style={{
							borderColor: theme.colors.border,
							opacity: contextManagementSettings.contextWarningsEnabled ? 1 : 0.4,
							pointerEvents: contextManagementSettings.contextWarningsEnabled ? 'auto' : 'none',
						}}
					>
						{/* Yellow Warning Threshold */}
						<div>
							<div className="flex items-center justify-between mb-2">
								<label
									className="text-xs font-medium flex items-center gap-2"
									style={{ color: theme.colors.textMain }}
								>
									<div
										className="w-2.5 h-2.5 rounded-full"
										style={{ backgroundColor: '#eab308' }}
									/>
									Yellow warning threshold
								</label>
								<span
									className="text-xs font-mono px-2 py-0.5 rounded"
									style={{ backgroundColor: 'rgba(234, 179, 8, 0.2)', color: '#fde047' }}
								>
									{contextManagementSettings.contextWarningYellowThreshold}%
								</span>
							</div>
							<input
								type="range"
								min={30}
								max={90}
								step={5}
								value={contextManagementSettings.contextWarningYellowThreshold}
								onChange={(e) => {
									const newYellow = Number(e.target.value);
									// Validation: ensure yellow < red by at least 10%
									if (newYellow >= contextManagementSettings.contextWarningRedThreshold) {
										// Bump red threshold up
										updateContextManagementSettings({
											contextWarningYellowThreshold: newYellow,
											contextWarningRedThreshold: Math.min(95, newYellow + 10),
										});
									} else {
										updateContextManagementSettings({
											contextWarningYellowThreshold: newYellow,
										});
									}
								}}
								className="w-full h-2 rounded-lg appearance-none cursor-pointer"
								style={{
									background: `linear-gradient(to right, #eab308 0%, #eab308 ${((contextManagementSettings.contextWarningYellowThreshold - 30) / 60) * 100}%, ${theme.colors.bgActivity} ${((contextManagementSettings.contextWarningYellowThreshold - 30) / 60) * 100}%, ${theme.colors.bgActivity} 100%)`,
								}}
							/>
						</div>

						{/* Red Warning Threshold */}
						<div>
							<div className="flex items-center justify-between mb-2">
								<label
									className="text-xs font-medium flex items-center gap-2"
									style={{ color: theme.colors.textMain }}
								>
									<div
										className="w-2.5 h-2.5 rounded-full"
										style={{ backgroundColor: '#ef4444' }}
									/>
									Red warning threshold
								</label>
								<span
									className="text-xs font-mono px-2 py-0.5 rounded"
									style={{ backgroundColor: 'rgba(239, 68, 68, 0.2)', color: '#fca5a5' }}
								>
									{contextManagementSettings.contextWarningRedThreshold}%
								</span>
							</div>
							<input
								type="range"
								min={50}
								max={95}
								step={5}
								value={contextManagementSettings.contextWarningRedThreshold}
								onChange={(e) => {
									const newRed = Number(e.target.value);
									// Validation: ensure red > yellow by at least 10%
									if (newRed <= contextManagementSettings.contextWarningYellowThreshold) {
										// Bump yellow threshold down
										updateContextManagementSettings({
											contextWarningRedThreshold: newRed,
											contextWarningYellowThreshold: Math.max(30, newRed - 10),
										});
									} else {
										updateContextManagementSettings({ contextWarningRedThreshold: newRed });
									}
								}}
								className="w-full h-2 rounded-lg appearance-none cursor-pointer"
								style={{
									background: `linear-gradient(to right, #ef4444 0%, #ef4444 ${((contextManagementSettings.contextWarningRedThreshold - 50) / 45) * 100}%, ${theme.colors.bgActivity} ${((contextManagementSettings.contextWarningRedThreshold - 50) / 45) * 100}%, ${theme.colors.bgActivity} 100%)`,
								}}
							/>
						</div>
					</div>
				</div>
			</div>

			{/* Document Graph Settings */}
			<div>
				<label className="block text-xs font-bold opacity-70 uppercase mb-2 flex items-center gap-2">
					<Sparkles className="w-3 h-3" />
					Document Graph
					<span
						className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase"
						style={{
							backgroundColor: theme.colors.warning + '30',
							color: theme.colors.warning,
						}}
					>
						Beta
					</span>
				</label>
				<div
					className="p-3 rounded border space-y-3"
					style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
				>
					{/* Show External Links */}
					<div className="flex items-center justify-between">
						<div>
							<p className="text-sm" style={{ color: theme.colors.textMain }}>
								Show external links by default
							</p>
							<p className="text-xs opacity-50 mt-0.5">
								Display external website links as nodes. Can be toggled in the graph view.
							</p>
						</div>
						<button
							onClick={() => setDocumentGraphShowExternalLinks(!documentGraphShowExternalLinks)}
							className="relative w-10 h-5 rounded-full transition-colors"
							style={{
								backgroundColor: documentGraphShowExternalLinks
									? theme.colors.accent
									: theme.colors.bgActivity,
							}}
							role="switch"
							aria-checked={documentGraphShowExternalLinks}
						>
							<span
								className={`absolute left-0 top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
									documentGraphShowExternalLinks ? 'translate-x-5' : 'translate-x-0.5'
								}`}
							/>
						</button>
					</div>

					{/* Max Nodes */}
					<div>
						<label className="block text-xs opacity-60 mb-2">Maximum nodes to display</label>
						<div className="flex items-center gap-3">
							<input
								type="range"
								min={50}
								max={1000}
								step={50}
								value={documentGraphMaxNodes}
								onChange={(e) => setDocumentGraphMaxNodes(Number(e.target.value))}
								className="flex-1 h-2 rounded-lg appearance-none cursor-pointer"
								style={{
									background: `linear-gradient(to right, ${theme.colors.accent} 0%, ${theme.colors.accent} ${((documentGraphMaxNodes - 50) / 950) * 100}%, ${theme.colors.bgActivity} ${((documentGraphMaxNodes - 50) / 950) * 100}%, ${theme.colors.bgActivity} 100%)`,
								}}
							/>
							<span
								className="text-sm font-mono w-12 text-right"
								style={{ color: theme.colors.textMain }}
							>
								{documentGraphMaxNodes}
							</span>
						</div>
						<p className="text-xs opacity-50 mt-1">
							Limits initial graph size for performance. Use &quot;Load more&quot; to show
							additional nodes.
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}
