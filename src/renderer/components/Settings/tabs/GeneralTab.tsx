/**
 * GeneralTab - General settings tab extracted from the monolithic SettingsModal.
 *
 * Self-sources all settings via useSettings() hook.
 * Receives only theme and isOpen as props.
 */

import React, { useState, useEffect } from 'react';
import {
	X,
	Check,
	Terminal,
	Keyboard,
	History,
	Download,
	Bug,
	Cpu,
	FolderSync,
	RotateCcw,
	Folder,
	ChevronDown,
	Brain,
	AlertTriangle,
	FlaskConical,
	Database,
	Battery,
	Monitor,
	PartyPopper,
	MessageSquare,
	Cloud,
	Trash2,
} from 'lucide-react';
import { useSettings } from '../../../hooks';
import type { Theme, ShellInfo } from '../../../types';
import { ToggleButtonGroup } from '../../ToggleButtonGroup';
import { SettingCheckbox } from '../../SettingCheckbox';
import { EnvVarsEditor } from '../EnvVarsEditor';

export interface GeneralTabProps {
	theme: Theme;
	isOpen: boolean;
}

export function GeneralTab({ theme, isOpen }: GeneralTabProps) {
	const {
		// Shell settings
		defaultShell,
		setDefaultShell,
		customShellPath,
		setCustomShellPath,
		shellArgs,
		setShellArgs,
		shellEnvVars,
		setShellEnvVars,
		// GitHub CLI settings
		ghPath,
		setGhPath,
		// Input behavior settings
		enterToSendAI,
		setEnterToSendAI,
		enterToSendTerminal,
		setEnterToSendTerminal,
		// History toggle
		defaultSaveToHistory,
		setDefaultSaveToHistory,
		// Thinking toggles
		defaultShowThinking,
		setDefaultShowThinking,
		groupChatDefaultShowThinking,
		setGroupChatDefaultShowThinking,
		// Synopsis settings
		synopsisEnabled,
		setSynopsisEnabled,
		// Power management settings
		preventSleepEnabled,
		setPreventSleepEnabled,
		// Rendering settings
		disableGpuAcceleration,
		setDisableGpuAcceleration,
		disableConfetti,
		setDisableConfetti,
		// Update settings
		checkForUpdatesOnStartup,
		setCheckForUpdatesOnStartup,
		enableBetaUpdates,
		setEnableBetaUpdates,
		// Model detection settings
		checkForNewModelsOnStartup,
		setCheckForNewModelsOnStartup,
		// Crash reporting settings
		crashReportingEnabled,
		setCrashReportingEnabled,
		// Context Management settings
		contextManagementSettings,
		updateContextManagementSettings,
		// Stats settings
		statsCollectionEnabled,
		setStatsCollectionEnabled,
		defaultStatsTimeRange,
		setDefaultStatsTimeRange,
		// SSH Stats timeout
		sshStatsTimeoutMs,
		setSshStatsTimeoutMs,
		// Global Stats auto-refresh interval
		globalStatsRefreshIntervalMs,
		setGlobalStatsRefreshIntervalMs,
	} = useSettings();

	// Shell detection state
	const [shells, setShells] = useState<ShellInfo[]>([]);
	const [shellsLoading, setShellsLoading] = useState(false);
	const [shellsLoaded, setShellsLoaded] = useState(false);
	const [shellConfigExpanded, setShellConfigExpanded] = useState(false);

	// Sync/storage location state
	const [defaultStoragePath, setDefaultStoragePath] = useState<string>('');
	const [_currentStoragePath, setCurrentStoragePath] = useState<string>('');
	const [customSyncPath, setCustomSyncPath] = useState<string | undefined>(undefined);
	const [syncRestartRequired, setSyncRestartRequired] = useState(false);
	const [syncMigrating, setSyncMigrating] = useState(false);
	const [syncError, setSyncError] = useState<string | null>(null);
	const [syncMigratedCount, setSyncMigratedCount] = useState<number | null>(null);

	// Stats data management state
	const [statsDbSize, setStatsDbSize] = useState<number | null>(null);
	const [statsClearing, setStatsClearing] = useState(false);
	const [statsClearResult, setStatsClearResult] = useState<{
		success: boolean;
		deletedQueryEvents: number;
		deletedAutoRunSessions: number;
		deletedAutoRunTasks: number;
		error?: string;
	} | null>(null);

	// Load sync settings and stats DB size on open
	useEffect(() => {
		if (isOpen) {
			// Load sync settings
			Promise.all([
				window.maestro.sync.getDefaultPath(),
				window.maestro.sync.getSettings(),
				window.maestro.sync.getCurrentStoragePath(),
			])
				.then(([defaultPath, settings, currentPath]) => {
					setDefaultStoragePath(defaultPath);
					setCustomSyncPath(settings.customSyncPath);
					setCurrentStoragePath(currentPath);
					setSyncRestartRequired(false);
					setSyncError(null);
					setSyncMigratedCount(null);
				})
				.catch((err) => {
					console.error('Failed to load sync settings:', err);
					setSyncError('Failed to load storage settings');
				});

			// Load stats database size
			window.maestro.stats
				.getDatabaseSize()
				.then((size) => {
					setStatsDbSize(size);
				})
				.catch((err) => {
					console.error('Failed to load stats database size:', err);
				});

			// Reset stats clear state
			setStatsClearResult(null);
		}
	}, [isOpen]);

	const loadShells = async () => {
		if (shellsLoaded) return; // Don't reload if already loaded

		setShellsLoading(true);
		try {
			const detected = await window.maestro.shells.detect();
			setShells(detected);
			setShellsLoaded(true);
		} catch (error) {
			console.error('Failed to load shells:', error);
		} finally {
			setShellsLoading(false);
		}
	};

	const handleShellInteraction = () => {
		if (!shellsLoaded && !shellsLoading) {
			loadShells();
		}
	};

	return (
		<div className="space-y-5">
			{/* Default Shell */}
			<div>
				<label className="block text-xs font-bold opacity-70 uppercase mb-1 flex items-center gap-2">
					<Terminal className="w-3 h-3" />
					Default Terminal Shell
				</label>
				<p className="text-xs opacity-50 mb-2">
					Choose which shell to use for terminal sessions. Select any shell and configure a custom
					path if needed.
				</p>
				{shellsLoading ? (
					<div className="text-sm opacity-50 p-2">Loading shells...</div>
				) : (
					<div className="space-y-2">
						{shellsLoaded && shells.length > 0 ? (
							shells.map((shell) => (
								<button
									key={shell.id}
									onClick={() => {
										setDefaultShell(shell.id);
										// Auto-expand shell config when selecting an unavailable shell
										if (!shell.available) {
											setShellConfigExpanded(true);
										}
									}}
									onMouseEnter={handleShellInteraction}
									onFocus={handleShellInteraction}
									className={`w-full text-left p-3 rounded border transition-all ${
										defaultShell === shell.id ? 'ring-2' : ''
									} hover:bg-opacity-10`}
									style={
										{
											borderColor: theme.colors.border,
											backgroundColor:
												defaultShell === shell.id ? theme.colors.accentDim : theme.colors.bgMain,
											'--tw-ring-color': theme.colors.accent,
											color: theme.colors.textMain,
										} as React.CSSProperties
									}
								>
									<div className="flex items-center justify-between">
										<div>
											<div className="font-medium">{shell.name}</div>
											{shell.path && (
												<div className="text-xs opacity-50 font-mono mt-1">{shell.path}</div>
											)}
										</div>
										{shell.available ? (
											defaultShell === shell.id ? (
												<Check className="w-4 h-4" style={{ color: theme.colors.accent }} />
											) : (
												<span
													className="text-xs px-2 py-0.5 rounded"
													style={{
														backgroundColor: theme.colors.success + '20',
														color: theme.colors.success,
													}}
												>
													Available
												</span>
											)
										) : defaultShell === shell.id ? (
											<div className="flex items-center gap-2">
												<span
													className="text-xs px-2 py-0.5 rounded"
													style={{
														backgroundColor: theme.colors.warning + '20',
														color: theme.colors.warning,
													}}
												>
													Custom Path Required
												</span>
												<Check className="w-4 h-4" style={{ color: theme.colors.accent }} />
											</div>
										) : (
											<span
												className="text-xs px-2 py-0.5 rounded"
												style={{
													backgroundColor: theme.colors.warning + '20',
													color: theme.colors.warning,
												}}
											>
												Not Found
											</span>
										)}
									</div>
								</button>
							))
						) : (
							/* Show current default shell before detection runs */
							<div className="space-y-2">
								<button
									className="w-full text-left p-3 rounded border ring-2"
									style={
										{
											borderColor: theme.colors.border,
											backgroundColor: theme.colors.accentDim,
											'--tw-ring-color': theme.colors.accent,
											color: theme.colors.textMain,
										} as React.CSSProperties
									}
								>
									<div className="flex items-center justify-between">
										<div>
											<div className="font-medium">
												{defaultShell.charAt(0).toUpperCase() + defaultShell.slice(1)}
											</div>
											<div className="text-xs opacity-50 font-mono mt-1">Current default</div>
										</div>
										<Check className="w-4 h-4" style={{ color: theme.colors.accent }} />
									</div>
								</button>
								<button
									onClick={handleShellInteraction}
									className="w-full text-left p-3 rounded border hover:bg-white/5 transition-colors"
									style={{
										borderColor: theme.colors.border,
										backgroundColor: theme.colors.bgMain,
										color: theme.colors.textDim,
									}}
								>
									<div className="flex items-center gap-2">
										<Terminal className="w-4 h-4" />
										<span>Detect other available shells...</span>
									</div>
								</button>
							</div>
						)}
					</div>
				)}

				{/* Shell Configuration Expandable Section */}
				<button
					onClick={() => setShellConfigExpanded(!shellConfigExpanded)}
					className="w-full flex items-center justify-between p-3 rounded border mt-3 hover:bg-white/5 transition-colors"
					style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
				>
					<span className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
						Shell Configuration
					</span>
					<ChevronDown
						className={`w-4 h-4 transition-transform ${shellConfigExpanded ? 'rotate-180' : ''}`}
						style={{ color: theme.colors.textDim }}
					/>
				</button>

				{shellConfigExpanded && (
					<div
						className="mt-2 space-y-3 p-3 rounded border"
						style={{
							borderColor: theme.colors.border,
							backgroundColor: theme.colors.bgActivity,
						}}
					>
						{/* Custom Shell Path */}
						<div>
							<label className="block text-xs opacity-60 mb-1">Custom Path (optional)</label>
							<div className="flex gap-2">
								<input
									type="text"
									value={customShellPath}
									onChange={(e) => setCustomShellPath(e.target.value)}
									placeholder="/path/to/shell"
									className="flex-1 p-2 rounded border bg-transparent outline-none text-sm font-mono"
									style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
								/>
								{customShellPath && (
									<button
										onClick={() => setCustomShellPath('')}
										className="px-2 py-1.5 rounded text-xs"
										style={{
											backgroundColor: theme.colors.bgMain,
											color: theme.colors.textDim,
										}}
									>
										Clear
									</button>
								)}
							</div>
							<p className="text-xs opacity-50 mt-1">
								Override the auto-detected shell path. Leave empty to use the detected path.
							</p>
						</div>

						{/* Shell Arguments */}
						<div>
							<label className="block text-xs opacity-60 mb-1">
								Additional Arguments (optional)
							</label>
							<div className="flex gap-2">
								<input
									type="text"
									value={shellArgs}
									onChange={(e) => setShellArgs(e.target.value)}
									placeholder="--flag value"
									className="flex-1 p-2 rounded border bg-transparent outline-none text-sm font-mono"
									style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
								/>
								{shellArgs && (
									<button
										onClick={() => setShellArgs('')}
										className="px-2 py-1.5 rounded text-xs"
										style={{
											backgroundColor: theme.colors.bgMain,
											color: theme.colors.textDim,
										}}
									>
										Clear
									</button>
								)}
							</div>
							<p className="text-xs opacity-50 mt-1">
								Additional CLI arguments passed to every shell session (e.g., --login, -c).
							</p>
						</div>

						{/* Shell Environment Variables */}
						<EnvVarsEditor envVars={shellEnvVars} setEnvVars={setShellEnvVars} theme={theme} />
					</div>
				)}
			</div>

			{/* GitHub CLI Path */}
			<div>
				<label className="block text-xs font-bold opacity-70 uppercase mb-2 flex items-center gap-2">
					<Terminal className="w-3 h-3" />
					GitHub CLI (gh) Path
				</label>
				<div
					className="p-3 rounded border"
					style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
				>
					<label className="block text-xs opacity-60 mb-1">Custom Path (optional)</label>
					<div className="flex gap-2">
						<input
							type="text"
							value={ghPath}
							onChange={(e) => setGhPath(e.target.value)}
							placeholder="/opt/homebrew/bin/gh"
							className="flex-1 p-1.5 rounded border bg-transparent outline-none text-xs font-mono"
							style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
						/>
						{ghPath && (
							<button
								onClick={() => setGhPath('')}
								className="px-2 py-1 rounded text-xs"
								style={{
									backgroundColor: theme.colors.bgActivity,
									color: theme.colors.textDim,
								}}
							>
								Clear
							</button>
						)}
					</div>
					<p className="text-xs opacity-40 mt-2">
						Specify the full path to the{' '}
						<code
							className="px-1 py-0.5 rounded"
							style={{ backgroundColor: theme.colors.bgActivity }}
						>
							gh
						</code>{' '}
						binary if it's not in your PATH. Used for Auto Run worktree features.
					</p>
				</div>
			</div>

			{/* Input Behavior Settings */}
			<div>
				<label className="block text-xs font-bold opacity-70 uppercase mb-2 flex items-center gap-2">
					<Keyboard className="w-3 h-3" />
					Input Send Behavior
				</label>
				<p className="text-xs opacity-50 mb-3">
					Configure how to send messages in each mode. Choose between Enter or Command+Enter for
					each input type.
				</p>

				{/* AI Mode Setting */}
				<div
					className="mb-4 p-3 rounded border"
					style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
				>
					<div className="flex items-center justify-between mb-2">
						<label className="text-sm font-medium">AI Interaction Mode</label>
						<button
							onClick={() => setEnterToSendAI(!enterToSendAI)}
							className="px-3 py-1.5 rounded text-xs font-mono transition-all"
							style={{
								backgroundColor: enterToSendAI ? theme.colors.accentDim : theme.colors.bgActivity,
								color: theme.colors.textMain,
								border: `1px solid ${theme.colors.border}`,
							}}
						>
							{enterToSendAI ? 'Enter' : '\u2318 + Enter'}
						</button>
					</div>
					<p className="text-xs opacity-50">
						{enterToSendAI
							? 'Press Enter to send. Use Shift+Enter for new line.'
							: 'Press Command+Enter to send. Enter creates new line.'}
					</p>
				</div>

				{/* Terminal Mode Setting */}
				<div
					className="p-3 rounded border"
					style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
				>
					<div className="flex items-center justify-between mb-2">
						<label className="text-sm font-medium">Terminal Mode</label>
						<button
							onClick={() => setEnterToSendTerminal(!enterToSendTerminal)}
							className="px-3 py-1.5 rounded text-xs font-mono transition-all"
							style={{
								backgroundColor: enterToSendTerminal
									? theme.colors.accentDim
									: theme.colors.bgActivity,
								color: theme.colors.textMain,
								border: `1px solid ${theme.colors.border}`,
							}}
						>
							{enterToSendTerminal ? 'Enter' : '\u2318 + Enter'}
						</button>
					</div>
					<p className="text-xs opacity-50">
						{enterToSendTerminal
							? 'Press Enter to send. Use Shift+Enter for new line.'
							: 'Press Command+Enter to send. Enter creates new line.'}
					</p>
				</div>
			</div>

			{/* Default History Toggle */}
			<SettingCheckbox
				icon={History}
				sectionLabel="Default History Toggle"
				title='Enable "History" by default for new tabs'
				description='When enabled, new AI tabs will have the "History" toggle on by default, saving a synopsis after each completion'
				checked={defaultSaveToHistory}
				onChange={setDefaultSaveToHistory}
				theme={theme}
			/>

			{/* Default Thinking Toggle */}
			<SettingCheckbox
				icon={Brain}
				sectionLabel="Default Thinking Toggle"
				title='Enable "Thinking" by default for new tabs'
				description="When enabled, new AI tabs will show streaming thinking/reasoning content as the AI works, instead of waiting for the final result"
				checked={defaultShowThinking}
				onChange={setDefaultShowThinking}
				theme={theme}
			/>

			{/* Group Chat Thinking Default - SEPARATE from AI tab thinking above */}
			<SettingCheckbox
				icon={Brain}
				sectionLabel="Group Chat Thinking"
				title="Show Thinking in Group Chats"
				description="Start group chats with thinking bubbles visible by default"
				checked={groupChatDefaultShowThinking}
				onChange={setGroupChatDefaultShowThinking}
				theme={theme}
			/>

			{/* Synopsis Toast Notifications */}
			<SettingCheckbox
				icon={MessageSquare}
				sectionLabel="Synopsis"
				title="Enable toast synopses for completed queries"
				description="When enabled, a toast notification with a synopsis will appear when interactive AI queries complete"
				checked={synopsisEnabled}
				onChange={setSynopsisEnabled}
				theme={theme}
			/>

			{/* Sleep Prevention */}
			<div>
				<label className="block text-xs font-bold opacity-70 uppercase mb-2 flex items-center gap-2">
					<Battery className="w-3 h-3" />
					Power
				</label>
				<div
					className="p-3 rounded border space-y-3"
					style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
				>
					<div
						className="flex items-center justify-between cursor-pointer"
						onClick={() => setPreventSleepEnabled(!preventSleepEnabled)}
						role="button"
						tabIndex={0}
						onKeyDown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								setPreventSleepEnabled(!preventSleepEnabled);
							}
						}}
					>
						<div className="flex-1 pr-3">
							<div className="font-medium" style={{ color: theme.colors.textMain }}>
								Prevent sleep while working
							</div>
							<div className="text-xs opacity-50 mt-0.5" style={{ color: theme.colors.textDim }}>
								Keeps your computer awake when AI agents are busy or Auto Run is active
							</div>
						</div>
						<button
							onClick={(e) => {
								e.stopPropagation();
								setPreventSleepEnabled(!preventSleepEnabled);
							}}
							className="relative w-10 h-5 rounded-full transition-colors flex-shrink-0"
							style={{
								backgroundColor: preventSleepEnabled
									? theme.colors.accent
									: theme.colors.bgActivity,
							}}
							role="switch"
							aria-checked={preventSleepEnabled}
						>
							<span
								className={`absolute left-0 top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
									preventSleepEnabled ? 'translate-x-5' : 'translate-x-0.5'
								}`}
							/>
						</button>
					</div>

					{/* Linux note */}
					{navigator.platform.toLowerCase().includes('linux') && (
						<div
							className="text-xs p-2 rounded"
							style={{
								backgroundColor: theme.colors.warning + '15',
								color: theme.colors.warning,
							}}
						>
							Note: May have limited support on some Linux desktop environments.
						</div>
					)}
				</div>
			</div>

			{/* Rendering Options */}
			<div>
				<label className="block text-xs font-bold opacity-70 uppercase mb-2 flex items-center gap-2">
					<Monitor className="w-3 h-3" />
					Rendering Options
				</label>
				<div
					className="p-3 rounded border space-y-3"
					style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
				>
					{/* GPU Acceleration Toggle */}
					<div
						className="flex items-center justify-between cursor-pointer"
						onClick={() => setDisableGpuAcceleration(!disableGpuAcceleration)}
						role="button"
						tabIndex={0}
						onKeyDown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								setDisableGpuAcceleration(!disableGpuAcceleration);
							}
						}}
					>
						<div className="flex-1 pr-3">
							<div className="font-medium" style={{ color: theme.colors.textMain }}>
								Disable GPU acceleration
							</div>
							<div className="text-xs opacity-50 mt-0.5" style={{ color: theme.colors.textDim }}>
								Use software rendering instead of GPU. Requires restart to take effect.
							</div>
						</div>
						<button
							onClick={(e) => {
								e.stopPropagation();
								setDisableGpuAcceleration(!disableGpuAcceleration);
							}}
							className="relative w-10 h-5 rounded-full transition-colors flex-shrink-0"
							style={{
								backgroundColor: disableGpuAcceleration
									? theme.colors.accent
									: theme.colors.bgActivity,
							}}
							role="switch"
							aria-checked={disableGpuAcceleration}
						>
							<span
								className={`absolute left-0 top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
									disableGpuAcceleration ? 'translate-x-5' : 'translate-x-0.5'
								}`}
							/>
						</button>
					</div>

					{/* Confetti Toggle */}
					<div
						className="flex items-center justify-between cursor-pointer pt-3 border-t"
						style={{ borderColor: theme.colors.border }}
						onClick={() => setDisableConfetti(!disableConfetti)}
						role="button"
						tabIndex={0}
						onKeyDown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								setDisableConfetti(!disableConfetti);
							}
						}}
					>
						<div className="flex-1 pr-3">
							<div
								className="font-medium flex items-center gap-2"
								style={{ color: theme.colors.textMain }}
							>
								<PartyPopper className="w-4 h-4" />
								Disable confetti animations
							</div>
							<div className="text-xs opacity-50 mt-0.5" style={{ color: theme.colors.textDim }}>
								Skip celebratory confetti effects on achievements and milestones
							</div>
						</div>
						<button
							onClick={(e) => {
								e.stopPropagation();
								setDisableConfetti(!disableConfetti);
							}}
							className="relative w-10 h-5 rounded-full transition-colors flex-shrink-0"
							style={{
								backgroundColor: disableConfetti ? theme.colors.accent : theme.colors.bgActivity,
							}}
							role="switch"
							aria-checked={disableConfetti}
						>
							<span
								className={`absolute left-0 top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
									disableConfetti ? 'translate-x-5' : 'translate-x-0.5'
								}`}
							/>
						</button>
					</div>
				</div>
			</div>

			{/* Check for Updates on Startup */}
			<SettingCheckbox
				icon={Download}
				sectionLabel="Updates"
				title="Check for updates on startup"
				description="Automatically check for new Maestro versions when the app starts"
				checked={checkForUpdatesOnStartup}
				onChange={setCheckForUpdatesOnStartup}
				theme={theme}
			/>

			{/* Beta Updates */}
			<SettingCheckbox
				icon={FlaskConical}
				sectionLabel="Pre-release Channel"
				title="Include beta and release candidate updates"
				description="Opt-in to receive pre-release versions (e.g., v0.11.1-rc, v0.12.0-beta). These may contain experimental features and bugs."
				checked={enableBetaUpdates}
				onChange={setEnableBetaUpdates}
				theme={theme}
			/>

			{/* New Model Detection */}
			<SettingCheckbox
				icon={Cpu}
				sectionLabel="Model Detection"
				title="Check for new Claude models on startup"
				description="Notify when Anthropic releases a Claude model not yet in Maestro's pricing registry. New models will show $0 costs until a Maestro update adds support."
				checked={checkForNewModelsOnStartup}
				onChange={setCheckForNewModelsOnStartup}
				theme={theme}
			/>

			{/* Crash Reporting */}
			<SettingCheckbox
				icon={Bug}
				sectionLabel="Privacy"
				title="Send anonymous crash reports"
				description="Help improve Maestro by automatically sending crash reports. No personal data is collected. Changes take effect after restart."
				checked={crashReportingEnabled}
				onChange={setCrashReportingEnabled}
				theme={theme}
			/>

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

			{/* Stats Data Management */}
			<div>
				<label className="block text-xs font-bold opacity-70 uppercase mb-2 flex items-center gap-2">
					<Database className="w-3 h-3" />
					Usage & Stats
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
					{/* Enable/Disable Stats Collection */}
					<div className="flex items-center justify-between">
						<div>
							<p className="text-sm" style={{ color: theme.colors.textMain }}>
								Enable stats collection
							</p>
							<p className="text-xs opacity-50 mt-0.5">
								Track queries and Auto Run sessions for the dashboard.
							</p>
						</div>
						<button
							onClick={() => setStatsCollectionEnabled(!statsCollectionEnabled)}
							className={`relative w-10 h-5 rounded-full transition-colors ${
								statsCollectionEnabled ? '' : ''
							}`}
							style={{
								backgroundColor: statsCollectionEnabled
									? theme.colors.accent
									: theme.colors.bgActivity,
							}}
							role="switch"
							aria-checked={statsCollectionEnabled}
						>
							<span
								className={`absolute left-0 top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
									statsCollectionEnabled ? 'translate-x-5' : 'translate-x-0.5'
								}`}
							/>
						</button>
					</div>

					{/* Default Time Range */}
					<div>
						<label className="block text-xs opacity-60 mb-2">Default dashboard time range</label>
						<select
							value={defaultStatsTimeRange}
							onChange={(e) =>
								setDefaultStatsTimeRange(
									e.target.value as 'day' | 'week' | 'month' | 'year' | 'all'
								)
							}
							className="w-full p-2 rounded border bg-transparent outline-none text-sm"
							style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
						>
							<option value="day">Last 24 hours</option>
							<option value="week">Last 7 days</option>
							<option value="month">Last 30 days</option>
							<option value="year">Last 365 days</option>
							<option value="all">All time</option>
						</select>
						<p className="text-xs opacity-50 mt-1">
							Time range shown when opening the Usage Dashboard.
						</p>
					</div>

					{/* SSH Stats Timeout */}
					<div>
						<label className="block text-xs opacity-60 mb-2">SSH remote stats timeout</label>
						<select
							value={sshStatsTimeoutMs}
							onChange={(e) => setSshStatsTimeoutMs(parseInt(e.target.value))}
							className="w-full p-2 rounded border bg-transparent outline-none text-sm"
							style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
						>
							<option value="10000">10 seconds</option>
							<option value="20000">20 seconds</option>
							<option value="30000">30 seconds</option>
							<option value="45000">45 seconds</option>
							<option value="60000">60 seconds</option>
							<option value="90000">90 seconds</option>
						</select>
						<p className="text-xs opacity-50 mt-1">
							Timeout for fetching statistics from SSH remotes.
						</p>
					</div>

					{/* Global Stats Auto-Refresh Interval */}
					<div>
						<label className="block text-xs opacity-60 mb-2">Auto-refresh interval</label>
						<select
							value={globalStatsRefreshIntervalMs}
							onChange={(e) => setGlobalStatsRefreshIntervalMs(parseInt(e.target.value))}
							className="w-full p-2 rounded border bg-transparent outline-none text-sm"
							style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
						>
							<option value="300000">5 minutes</option>
							<option value="900000">15 minutes</option>
							<option value="1800000">30 minutes</option>
							<option value="3600000">1 hour</option>
							<option value="14400000">4 hours</option>
							<option value="86400000">1 day</option>
						</select>
						<p className="text-xs opacity-50 mt-1">
							How often to auto-refresh Global Statistics in the About modal.
						</p>
					</div>

					{/* Divider */}
					<div className="border-t" style={{ borderColor: theme.colors.border }} />

					{/* Database Size Display */}
					<div className="flex items-center justify-between">
						<span className="text-sm" style={{ color: theme.colors.textDim }}>
							Database size
						</span>
						<span className="text-sm font-mono" style={{ color: theme.colors.textMain }}>
							{statsDbSize !== null ? (statsDbSize / 1024 / 1024).toFixed(2) + ' MB' : 'Loading...'}
						</span>
					</div>

					{/* Clear Old Data Dropdown */}
					<div>
						<label className="block text-xs opacity-60 mb-2">Clear stats older than...</label>
						<div className="flex items-center gap-2">
							<select
								id="clear-stats-period"
								className="flex-1 p-2 rounded border bg-transparent outline-none text-sm"
								style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
								defaultValue=""
								disabled={statsClearing}
							>
								<option value="" disabled>
									Select a time period
								</option>
								<option value="7">7 days</option>
								<option value="30">30 days</option>
								<option value="90">90 days</option>
								<option value="180">6 months</option>
								<option value="365">1 year</option>
							</select>
							<button
								onClick={async () => {
									const select = document.getElementById('clear-stats-period') as HTMLSelectElement;
									const days = parseInt(select.value, 10);
									if (!days || isNaN(days)) {
										return; // No selection
									}
									setStatsClearing(true);
									setStatsClearResult(null);
									try {
										const result = await window.maestro.stats.clearOldData(days);
										setStatsClearResult(result);
										if (result.success) {
											// Refresh database size
											const newSize = await window.maestro.stats.getDatabaseSize();
											setStatsDbSize(newSize);
										}
									} catch (err) {
										console.error('Failed to clear old stats:', err);
										setStatsClearResult({
											success: false,
											deletedQueryEvents: 0,
											deletedAutoRunSessions: 0,
											deletedAutoRunTasks: 0,
											error: err instanceof Error ? err.message : 'Unknown error',
										});
									} finally {
										setStatsClearing(false);
									}
								}}
								disabled={statsClearing}
								className="px-3 py-2 rounded text-xs font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
								style={{
									backgroundColor: theme.colors.error + '20',
									color: theme.colors.error,
									border: `1px solid ${theme.colors.error}40`,
								}}
							>
								<Trash2 className="w-3 h-3" />
								{statsClearing ? 'Clearing...' : 'Clear'}
							</button>
						</div>
						<p className="text-xs opacity-50 mt-2">
							Remove old query events, Auto Run sessions, and tasks from the stats database.
						</p>
					</div>

					{/* Clear Result Feedback */}
					{statsClearResult && (
						<div
							className="p-2 rounded text-xs flex items-start gap-2"
							style={{
								backgroundColor: statsClearResult.success
									? theme.colors.success + '20'
									: theme.colors.error + '20',
								color: statsClearResult.success ? theme.colors.success : theme.colors.error,
							}}
						>
							{statsClearResult.success ? (
								<>
									<Check className="w-3 h-3 flex-shrink-0 mt-0.5" />
									<span>
										Cleared{' '}
										{statsClearResult.deletedQueryEvents +
											statsClearResult.deletedAutoRunSessions +
											statsClearResult.deletedAutoRunTasks}{' '}
										records ({statsClearResult.deletedQueryEvents} queries,{' '}
										{statsClearResult.deletedAutoRunSessions} sessions,{' '}
										{statsClearResult.deletedAutoRunTasks} tasks)
									</span>
								</>
							) : (
								<>
									<X className="w-3 h-3 flex-shrink-0 mt-0.5" />
									<span>{statsClearResult.error || 'Failed to clear stats data'}</span>
								</>
							)}
						</div>
					)}
				</div>
			</div>

			{/* Settings Storage Location */}
			<div>
				<label className="block text-xs font-bold opacity-70 uppercase mb-2 flex items-center gap-2">
					<FolderSync className="w-3 h-3" />
					Storage Location
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
					{/* Settings folder header */}
					<div>
						<p className="text-sm font-semibold" style={{ color: theme.colors.textMain }}>
							Settings folder
						</p>
						<p className="text-xs opacity-60 mt-0.5">
							Choose where Maestro stores settings, sessions, and groups. Use a synced folder
							(iCloud Drive, Dropbox, OneDrive) to share across devices.
						</p>
						<p className="text-xs opacity-50 mt-1 italic">
							Note: Only run Maestro on one device at a time to avoid sync conflicts.
						</p>
					</div>

					{/* Default Location */}
					<div>
						<label className="block text-xs opacity-60 mb-1">Default Location</label>
						<div
							className="text-xs p-2 rounded font-mono truncate"
							style={{ backgroundColor: theme.colors.bgActivity }}
							title={defaultStoragePath}
						>
							{defaultStoragePath || 'Loading...'}
						</div>
					</div>

					{/* Current Location (if different) */}
					{customSyncPath && (
						<div>
							<label className="block text-xs opacity-60 mb-1">Current Location (Custom)</label>
							<div
								className="text-xs p-2 rounded font-mono truncate flex items-center gap-2"
								style={{
									backgroundColor: theme.colors.accent + '15',
									border: `1px solid ${theme.colors.accent}40`,
								}}
								title={customSyncPath}
							>
								<Cloud className="w-3 h-3 flex-shrink-0" style={{ color: theme.colors.accent }} />
								<span className="truncate">{customSyncPath}</span>
							</div>
						</div>
					)}

					{/* Action Buttons */}
					<div className="flex items-center gap-2 flex-wrap">
						<button
							onClick={async () => {
								const folder = await window.maestro.sync.selectSyncFolder();
								if (folder) {
									setSyncMigrating(true);
									setSyncError(null);
									setSyncMigratedCount(null);
									try {
										const result = await window.maestro.sync.setCustomPath(folder);
										if (result.success) {
											setCustomSyncPath(folder);
											setCurrentStoragePath(folder);
											setSyncRestartRequired(true);
											if (result.migrated !== undefined) {
												setSyncMigratedCount(result.migrated);
											}
										} else {
											setSyncError(result.error || 'Failed to change storage location');
										}
										if (result.errors && result.errors.length > 0) {
											setSyncError(result.errors.join(', '));
										}
									} finally {
										setSyncMigrating(false);
									}
								}
							}}
							disabled={syncMigrating}
							className="flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-50"
							style={{
								backgroundColor: theme.colors.accent,
								color: theme.colors.bgMain,
							}}
						>
							<Folder className="w-3 h-3" />
							{syncMigrating
								? 'Migrating...'
								: customSyncPath
									? 'Change Folder...'
									: 'Choose Folder...'}
						</button>

						{customSyncPath && (
							<button
								onClick={async () => {
									setSyncMigrating(true);
									setSyncError(null);
									setSyncMigratedCount(null);
									try {
										const result = await window.maestro.sync.setCustomPath(null);
										if (result.success) {
											setCustomSyncPath(undefined);
											setCurrentStoragePath(defaultStoragePath);
											setSyncRestartRequired(true);
											if (result.migrated !== undefined) {
												setSyncMigratedCount(result.migrated);
											}
										} else {
											setSyncError(result.error || 'Failed to reset storage location');
										}
									} finally {
										setSyncMigrating(false);
									}
								}}
								disabled={syncMigrating}
								className="flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-50"
								style={{
									backgroundColor: theme.colors.border,
									color: theme.colors.textMain,
								}}
								title="Reset to default location"
							>
								<RotateCcw className="w-3 h-3" />
								Use Default
							</button>
						)}
					</div>

					{/* Success Message */}
					{syncMigratedCount !== null && syncMigratedCount > 0 && !syncError && (
						<div
							className="p-2 rounded text-xs flex items-center gap-2"
							style={{
								backgroundColor: theme.colors.success + '20',
								color: theme.colors.success,
							}}
						>
							<Check className="w-3 h-3" />
							Migrated {syncMigratedCount} settings file{syncMigratedCount !== 1 ? 's' : ''}
						</div>
					)}

					{/* Error Message */}
					{syncError && (
						<div
							className="p-2 rounded text-xs flex items-start gap-2"
							style={{
								backgroundColor: theme.colors.error + '20',
								color: theme.colors.error,
							}}
						>
							<X className="w-3 h-3 flex-shrink-0 mt-0.5" />
							<span>{syncError}</span>
						</div>
					)}

					{/* Restart Required Warning */}
					{syncRestartRequired && !syncError && (
						<div
							className="p-2 rounded text-xs flex items-center gap-2"
							style={{
								backgroundColor: theme.colors.warning + '20',
								color: theme.colors.warning,
							}}
						>
							<RotateCcw className="w-3 h-3" />
							Restart Maestro for changes to take effect
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
