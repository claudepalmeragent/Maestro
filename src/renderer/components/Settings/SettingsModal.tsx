/**
 * SettingsModal - Tab orchestrator
 *
 * Manages tab selection state, modal chrome, layer stack registration,
 * and delegates rendering to tab components.
 *
 * Extracted from the monolithic SettingsModal.tsx.
 */

import React, { useState, useEffect, useRef, memo, useCallback } from 'react';
import {
	X,
	Key,
	Keyboard,
	Bell,
	Cpu,
	Settings,
	Palette,
	Server,
	ClipboardCheck,
	Activity,
	Monitor,
} from 'lucide-react';
import { useSettings } from '../../hooks';
import type {
	Theme,
	ThemeColors,
	ThemeId,
	Shortcut,
	CustomAICommand,
	LLMProvider,
} from '../../types';
import { useLayerStack } from '../../contexts/LayerStackContext';
import { MODAL_PRIORITIES } from '../../constants/modalPriorities';
import { AICommandsPanel } from '../AICommandsPanel';
import { SpecKitCommandsPanel } from '../SpecKitCommandsPanel';
import { OpenSpecCommandsPanel } from '../OpenSpecCommandsPanel';
import { NotificationsPanel } from '../NotificationsPanel';
import { SshRemotesSection } from './SshRemotesSection';
import { AuditsSettingsTab } from './AuditsSettingsTab';
import { HoneycombSettingsSection } from '../HoneycombSettingsSection';
import { useHoneycombUsage } from '../../hooks/useHoneycombUsage';
import { PlanCalibrationSettings } from '../PlanCalibrationSettings';
import { CalibrationHistoryModal } from '../CalibrationHistoryModal';
import { GeneralTab, DisplayTab, ShortcutsTab, ThemeTab } from './tabs';

// Feature flags - set to true to enable dormant features
const FEATURE_FLAGS = {
	LLM_SETTINGS: false, // LLM provider configuration (OpenRouter, Anthropic, Ollama)
};

type SettingsTabId =
	| 'general'
	| 'display'
	| 'llm'
	| 'shortcuts'
	| 'theme'
	| 'notifications'
	| 'aicommands'
	| 'ssh'
	| 'audits'
	| 'honeycomb';

interface SettingsModalProps {
	isOpen: boolean;
	onClose: () => void;
	theme: Theme;
	themes: Record<string, Theme>;
	activeThemeId: ThemeId;
	setActiveThemeId: (id: ThemeId) => void;
	customThemeColors: ThemeColors;
	setCustomThemeColors: (colors: ThemeColors) => void;
	customThemeBaseId: ThemeId;
	setCustomThemeBaseId: (id: ThemeId) => void;
	llmProvider: LLMProvider;
	setLlmProvider: (provider: LLMProvider) => void;
	modelSlug: string;
	setModelSlug: (slug: string) => void;
	apiKey: string;
	setApiKey: (key: string) => void;
	shortcuts: Record<string, Shortcut>;
	setShortcuts: (shortcuts: Record<string, Shortcut>) => void;
	tabShortcuts: Record<string, Shortcut>;
	setTabShortcuts: (shortcuts: Record<string, Shortcut>) => void;
	fontFamily: string;
	setFontFamily: (font: string) => void;
	fontSize: number;
	setFontSize: (size: number) => void;
	terminalWidth: number;
	setTerminalWidth: (width: number) => void;
	logLevel: string;
	setLogLevel: (level: string) => void;
	maxLogBuffer: number;
	setMaxLogBuffer: (buffer: number) => void;
	maxOutputLines: number;
	setMaxOutputLines: (lines: number) => void;
	defaultShell: string;
	setDefaultShell: (shell: string) => void;
	customShellPath: string;
	setCustomShellPath: (path: string) => void;
	shellArgs: string;
	setShellArgs: (args: string) => void;
	shellEnvVars: Record<string, string>;
	setShellEnvVars: (vars: Record<string, string>) => void;
	ghPath: string;
	setGhPath: (path: string) => void;
	enterToSendAI: boolean;
	setEnterToSendAI: (value: boolean) => void;
	enterToSendTerminal: boolean;
	setEnterToSendTerminal: (value: boolean) => void;
	defaultSaveToHistory: boolean;
	setDefaultSaveToHistory: (value: boolean) => void;
	defaultShowThinking: boolean;
	setDefaultShowThinking: (value: boolean) => void;
	groupChatDefaultShowThinking: boolean;
	setGroupChatDefaultShowThinking: (value: boolean) => void;
	osNotificationsEnabled: boolean;
	setOsNotificationsEnabled: (value: boolean) => void;
	audioFeedbackEnabled: boolean;
	setAudioFeedbackEnabled: (value: boolean) => void;
	audioFeedbackCommand: string;
	setAudioFeedbackCommand: (value: string) => void;
	toastDuration: number;
	setToastDuration: (value: number) => void;
	checkForUpdatesOnStartup: boolean;
	setCheckForUpdatesOnStartup: (value: boolean) => void;
	enableBetaUpdates: boolean;
	setEnableBetaUpdates: (value: boolean) => void;
	checkForNewModelsOnStartup: boolean;
	setCheckForNewModelsOnStartup: (value: boolean) => void;
	crashReportingEnabled: boolean;
	setCrashReportingEnabled: (value: boolean) => void;
	customAICommands: CustomAICommand[];
	setCustomAICommands: (commands: CustomAICommand[]) => void;
	initialTab?: SettingsTabId;
	hasNoAgents?: boolean;
	onThemeImportError?: (message: string) => void;
	onThemeImportSuccess?: (message: string) => void;
	themeMode: 'manual' | 'system';
	onThemeModeChange: (mode: 'manual' | 'system') => void;
	lightThemeId: ThemeId;
	onLightThemeIdChange: (id: ThemeId) => void;
	darkThemeId: ThemeId;
	onDarkThemeIdChange: (id: ThemeId) => void;
}

export const SettingsModal = memo(function SettingsModal(props: SettingsModalProps) {
	const {
		isOpen,
		onClose,
		theme,
		themes,
		initialTab,
		themeMode,
		onThemeModeChange,
		lightThemeId,
		onLightThemeIdChange,
		darkThemeId,
		onDarkThemeIdChange,
	} = props;

	// Honeycomb & calibration settings from useSettings hook
	const {
		honeycombWarningSettings,
		updateHoneycombWarningSettings,
		honeycombDataSource,
		setHoneycombDataSource,
		honeycombMcpApiKey,
		setHoneycombMcpApiKey,
		honeycombEnvironmentSlug,
		setHoneycombEnvironmentSlug,
		honeycombMcpRegion,
		setHoneycombMcpRegion,
		honeycombApiKey,
		setHoneycombApiKey,
		honeycombDatasetSlug,
		setHoneycombDatasetSlug,
		planCalibration,
		setPlanCalibration,
	} = useSettings();

	const [activeTab, setActiveTab] = useState<SettingsTabId>('general');

	// LLM test state (only used when FEATURE_FLAGS.LLM_SETTINGS is true)
	const [testingLLM, setTestingLLM] = useState(false);
	const [testResult, setTestResult] = useState<{
		status: 'success' | 'error' | null;
		message: string;
	}>({ status: null, message: '' });

	// Calibration history modal state
	const [showCalibrationHistory, setShowCalibrationHistory] = useState(false);

	// Honeycomb usage data for calibration
	const { data: honeycombUsageDataForCalibration } = useHoneycombUsage();

	const getHoneycombBillableTokens = useCallback(
		async (window: '5hr' | 'weekly' | 'sonnet-weekly'): Promise<number> => {
			if (!honeycombUsageDataForCalibration) throw new Error('Honeycomb data not available');
			if (window === '5hr') return honeycombUsageDataForCalibration.fiveHourBillableTokens;
			if (window === 'sonnet-weekly')
				return honeycombUsageDataForCalibration.sonnetWeeklyBillableTokens;
			return honeycombUsageDataForCalibration.weeklyBillableTokens;
		},
		[honeycombUsageDataForCalibration]
	);

	// Layer stack integration
	const { registerLayer, unregisterLayer, updateLayerHandler } = useLayerStack();
	const layerIdRef = useRef<string>();

	useEffect(() => {
		if (isOpen) {
			// Set initial tab if provided, otherwise default to 'general'
			setActiveTab(initialTab || 'general');
		}
	}, [isOpen, initialTab]);

	// Store onClose in a ref to avoid re-registering layer when onClose changes
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	// Register layer when modal opens
	useEffect(() => {
		if (!isOpen) return;

		const id = registerLayer({
			type: 'modal',
			priority: MODAL_PRIORITIES.SETTINGS,
			blocksLowerLayers: true,
			capturesFocus: true,
			focusTrap: 'strict',
			ariaLabel: 'Settings',
			onEscape: () => {
				onCloseRef.current();
			},
		});

		layerIdRef.current = id;

		return () => {
			if (layerIdRef.current) {
				unregisterLayer(layerIdRef.current);
			}
		};
	}, [isOpen, registerLayer, unregisterLayer]);

	// Update handler when dependencies change
	useEffect(() => {
		if (!isOpen || !layerIdRef.current) return;

		updateLayerHandler(layerIdRef.current, () => {
			onCloseRef.current();
		});
	}, [isOpen, updateLayerHandler]);

	// Tab navigation with Cmd+Shift+[ and ]
	useEffect(() => {
		if (!isOpen) return;

		const handleTabNavigation = (e: KeyboardEvent) => {
			const tabs: SettingsTabId[] = FEATURE_FLAGS.LLM_SETTINGS
				? [
						'general',
						'display',
						'llm',
						'shortcuts',
						'theme',
						'notifications',
						'aicommands',
						'ssh',
						'audits',
						'honeycomb',
					]
				: [
						'general',
						'display',
						'shortcuts',
						'theme',
						'notifications',
						'aicommands',
						'ssh',
						'audits',
						'honeycomb',
					];
			const currentIndex = tabs.indexOf(activeTab);

			if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === '[') {
				e.preventDefault();
				const prevIndex = currentIndex === 0 ? tabs.length - 1 : currentIndex - 1;
				setActiveTab(tabs[prevIndex]);
			} else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === ']') {
				e.preventDefault();
				const nextIndex = (currentIndex + 1) % tabs.length;
				setActiveTab(tabs[nextIndex]);
			}
		};

		window.addEventListener('keydown', handleTabNavigation);
		return () => window.removeEventListener('keydown', handleTabNavigation);
	}, [isOpen, activeTab]);

	const testLLMConnection = async () => {
		setTestingLLM(true);
		setTestResult({ status: null, message: '' });

		try {
			let response;
			const testPrompt = 'Respond with exactly: "Connection successful"';

			if (props.llmProvider === 'openrouter') {
				if (!props.apiKey) {
					throw new Error('API key is required for OpenRouter');
				}

				response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
					method: 'POST',
					headers: {
						Authorization: `Bearer ${props.apiKey}`,
						'Content-Type': 'application/json',
						'HTTP-Referer': 'https://maestro.local',
					},
					body: JSON.stringify({
						model: props.modelSlug || 'anthropic/claude-3.5-sonnet',
						messages: [{ role: 'user', content: testPrompt }],
						max_tokens: 50,
					}),
				});

				if (!response.ok) {
					const error = await response.json();
					throw new Error(error.error?.message || `OpenRouter API error: ${response.status}`);
				}

				const data = await response.json();
				if (!data.choices?.[0]?.message?.content) {
					throw new Error('Invalid response from OpenRouter');
				}

				setTestResult({
					status: 'success',
					message: 'Successfully connected to OpenRouter!',
				});
			} else if (props.llmProvider === 'anthropic') {
				if (!props.apiKey) {
					throw new Error('API key is required for Anthropic');
				}

				response = await fetch('https://api.anthropic.com/v1/messages', {
					method: 'POST',
					headers: {
						'x-api-key': props.apiKey,
						'anthropic-version': '2023-06-01',
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						model: props.modelSlug || 'claude-3-5-sonnet-20241022',
						max_tokens: 50,
						messages: [{ role: 'user', content: testPrompt }],
					}),
				});

				if (!response.ok) {
					const error = await response.json();
					throw new Error(error.error?.message || `Anthropic API error: ${response.status}`);
				}

				const data = await response.json();
				if (!data.content?.[0]?.text) {
					throw new Error('Invalid response from Anthropic');
				}

				setTestResult({
					status: 'success',
					message: 'Successfully connected to Anthropic!',
				});
			} else if (props.llmProvider === 'ollama') {
				response = await fetch('http://localhost:11434/api/generate', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						model: props.modelSlug || 'llama3:latest',
						prompt: testPrompt,
						stream: false,
					}),
				});

				if (!response.ok) {
					throw new Error(
						`Ollama API error: ${response.status}. Make sure Ollama is running locally.`
					);
				}

				const data = await response.json();
				if (!data.response) {
					throw new Error('Invalid response from Ollama');
				}

				setTestResult({
					status: 'success',
					message: 'Successfully connected to Ollama!',
				});
			}
		} catch (error: any) {
			setTestResult({
				status: 'error',
				message: error.message || 'Connection failed',
			});
		} finally {
			setTestingLLM(false);
		}
	};

	if (!isOpen) return null;

	return (
		<div
			className="fixed inset-0 modal-overlay flex items-center justify-center z-[9999]"
			role="dialog"
			aria-modal="true"
			aria-label="Settings"
		>
			<div
				className="w-[650px] h-[600px] rounded-xl border shadow-2xl overflow-hidden flex flex-col"
				style={{ backgroundColor: theme.colors.bgSidebar, borderColor: theme.colors.border }}
			>
				<div className="flex border-b" style={{ borderColor: theme.colors.border }}>
					<button
						onClick={() => setActiveTab('general')}
						className={`px-4 py-4 text-sm font-bold border-b-2 ${activeTab === 'general' ? 'border-indigo-500' : 'border-transparent'} flex items-center gap-2`}
						tabIndex={-1}
						title="General"
					>
						<Settings className="w-4 h-4" />
						{activeTab === 'general' && <span>General</span>}
					</button>
					<button
						onClick={() => setActiveTab('display')}
						className={`px-4 py-4 text-sm font-bold border-b-2 ${activeTab === 'display' ? 'border-indigo-500' : 'border-transparent'} flex items-center gap-2`}
						tabIndex={-1}
						title="Display"
					>
						<Monitor className="w-4 h-4" />
						{activeTab === 'display' && <span>Display</span>}
					</button>
					{FEATURE_FLAGS.LLM_SETTINGS && (
						<button
							onClick={() => setActiveTab('llm')}
							className={`px-4 py-4 text-sm font-bold border-b-2 ${activeTab === 'llm' ? 'border-indigo-500' : 'border-transparent'}`}
							tabIndex={-1}
							title="LLM"
						>
							LLM
						</button>
					)}
					<button
						onClick={() => setActiveTab('shortcuts')}
						className={`px-4 py-4 text-sm font-bold border-b-2 ${activeTab === 'shortcuts' ? 'border-indigo-500' : 'border-transparent'} flex items-center gap-2`}
						tabIndex={-1}
						title="Shortcuts"
					>
						<Keyboard className="w-4 h-4" />
						{activeTab === 'shortcuts' && <span>Shortcuts</span>}
					</button>
					<button
						onClick={() => setActiveTab('theme')}
						className={`px-4 py-4 text-sm font-bold border-b-2 ${activeTab === 'theme' ? 'border-indigo-500' : 'border-transparent'} flex items-center gap-2`}
						tabIndex={-1}
						title="Themes"
					>
						<Palette className="w-4 h-4" />
						{activeTab === 'theme' && <span>Themes</span>}
					</button>
					<button
						onClick={() => setActiveTab('notifications')}
						className={`px-4 py-4 text-sm font-bold border-b-2 ${activeTab === 'notifications' ? 'border-indigo-500' : 'border-transparent'} flex items-center gap-2`}
						tabIndex={-1}
						title="Notifications"
					>
						<Bell className="w-4 h-4" />
						{activeTab === 'notifications' && <span>Notify</span>}
					</button>
					<button
						onClick={() => setActiveTab('aicommands')}
						className={`px-4 py-4 text-sm font-bold border-b-2 ${activeTab === 'aicommands' ? 'border-indigo-500' : 'border-transparent'} flex items-center gap-2`}
						tabIndex={-1}
						title="AI Commands"
					>
						<Cpu className="w-4 h-4" />
						{activeTab === 'aicommands' && <span>AI Commands</span>}
					</button>
					<button
						onClick={() => setActiveTab('ssh')}
						className={`px-4 py-4 text-sm font-bold border-b-2 ${activeTab === 'ssh' ? 'border-indigo-500' : 'border-transparent'} flex items-center gap-2`}
						tabIndex={-1}
						title="SSH Hosts"
					>
						<Server className="w-4 h-4" />
						{activeTab === 'ssh' && <span>SSH Hosts</span>}
					</button>
					<button
						onClick={() => setActiveTab('audits')}
						className={`px-4 py-4 text-sm font-bold border-b-2 ${activeTab === 'audits' ? 'border-indigo-500' : 'border-transparent'} flex items-center gap-2`}
						tabIndex={-1}
						title="Audits"
					>
						<ClipboardCheck className="w-4 h-4" />
						{activeTab === 'audits' && <span>Audits</span>}
					</button>
					<button
						onClick={() => setActiveTab('honeycomb')}
						className={`px-4 py-4 text-sm font-bold border-b-2 ${
							activeTab === 'honeycomb' ? 'border-indigo-500' : 'border-transparent'
						} flex items-center gap-2`}
						tabIndex={-1}
						title="Honeycomb"
					>
						<Activity className="w-4 h-4" />
						{activeTab === 'honeycomb' && <span>Honeycomb</span>}
					</button>
					<div className="flex-1 flex justify-end items-center pr-4">
						<button onClick={onClose} tabIndex={-1}>
							<X className="w-5 h-5 opacity-50 hover:opacity-100" />
						</button>
					</div>
				</div>

				<div className="flex-1 p-6 overflow-y-auto scrollbar-thin">
					{activeTab === 'general' && <GeneralTab theme={theme} isOpen={isOpen} />}

					{activeTab === 'display' && <DisplayTab theme={theme} />}

					{activeTab === 'llm' && FEATURE_FLAGS.LLM_SETTINGS && (
						<div className="space-y-5">
							<div>
								<label className="block text-xs font-bold opacity-70 uppercase mb-2">
									LLM Provider
								</label>
								<select
									value={props.llmProvider}
									onChange={(e) => props.setLlmProvider(e.target.value as LLMProvider)}
									className="w-full p-2 rounded border bg-transparent outline-none"
									style={{ borderColor: theme.colors.border }}
								>
									<option value="openrouter">OpenRouter</option>
									<option value="anthropic">Anthropic</option>
									<option value="ollama">Ollama (Local)</option>
								</select>
							</div>

							<div>
								<label className="block text-xs font-bold opacity-70 uppercase mb-2">
									Model Slug
								</label>
								<input
									value={props.modelSlug}
									onChange={(e) => props.setModelSlug(e.target.value)}
									className="w-full p-2 rounded border bg-transparent outline-none"
									style={{ borderColor: theme.colors.border }}
									placeholder={
										props.llmProvider === 'ollama' ? 'llama3:latest' : 'anthropic/claude-3.5-sonnet'
									}
								/>
							</div>

							{props.llmProvider !== 'ollama' && (
								<div>
									<label className="block text-xs font-bold opacity-70 uppercase mb-2">
										API Key
									</label>
									<div
										className="flex items-center border rounded px-3 py-2"
										style={{
											backgroundColor: theme.colors.bgMain,
											borderColor: theme.colors.border,
										}}
									>
										<Key className="w-4 h-4 mr-2 opacity-50" />
										<input
											type="password"
											value={props.apiKey}
											onChange={(e) => props.setApiKey(e.target.value)}
											className="bg-transparent flex-1 text-sm outline-none"
											placeholder="sk-..."
										/>
									</div>
									<p className="text-[10px] mt-2 opacity-50">
										Keys are stored locally in ~/.maestro/settings.json
									</p>
								</div>
							)}

							{/* Test Connection */}
							<div className="pt-4 border-t" style={{ borderColor: theme.colors.border }}>
								<button
									onClick={testLLMConnection}
									disabled={testingLLM || (props.llmProvider !== 'ollama' && !props.apiKey)}
									className="w-full py-3 rounded-lg font-bold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
									style={{
										backgroundColor: theme.colors.accent,
										color: theme.colors.accentForeground,
									}}
								>
									{testingLLM ? 'Testing Connection...' : 'Test Connection'}
								</button>

								{testResult.status && (
									<div
										className="mt-3 p-3 rounded-lg text-sm"
										style={{
											backgroundColor:
												testResult.status === 'success'
													? theme.colors.success + '20'
													: theme.colors.error + '20',
											color:
												testResult.status === 'success' ? theme.colors.success : theme.colors.error,
											border: `1px solid ${testResult.status === 'success' ? theme.colors.success : theme.colors.error}`,
										}}
									>
										{testResult.message}
									</div>
								)}

								<p className="text-[10px] mt-3 opacity-50 text-center">
									Test sends a simple prompt to verify connectivity and configuration
								</p>
							</div>
						</div>
					)}

					{activeTab === 'shortcuts' && (
						<ShortcutsTab theme={theme} hasNoAgents={props.hasNoAgents} />
					)}

					{activeTab === 'theme' && (
						<ThemeTab
							theme={theme}
							themes={themes}
							activeThemeId={props.activeThemeId}
							setActiveThemeId={props.setActiveThemeId}
							customThemeColors={props.customThemeColors}
							setCustomThemeColors={props.setCustomThemeColors}
							customThemeBaseId={props.customThemeBaseId}
							setCustomThemeBaseId={props.setCustomThemeBaseId}
							themeMode={themeMode}
							onThemeModeChange={onThemeModeChange}
							lightThemeId={lightThemeId}
							onLightThemeIdChange={onLightThemeIdChange}
							darkThemeId={darkThemeId}
							onDarkThemeIdChange={onDarkThemeIdChange}
							onThemeImportError={props.onThemeImportError}
							onThemeImportSuccess={props.onThemeImportSuccess}
						/>
					)}

					{activeTab === 'notifications' && (
						<NotificationsPanel
							osNotificationsEnabled={props.osNotificationsEnabled}
							setOsNotificationsEnabled={props.setOsNotificationsEnabled}
							audioFeedbackEnabled={props.audioFeedbackEnabled}
							setAudioFeedbackEnabled={props.setAudioFeedbackEnabled}
							audioFeedbackCommand={props.audioFeedbackCommand}
							setAudioFeedbackCommand={props.setAudioFeedbackCommand}
							toastDuration={props.toastDuration}
							setToastDuration={props.setToastDuration}
							theme={theme}
						/>
					)}

					{activeTab === 'aicommands' && (
						<div className="space-y-8">
							<AICommandsPanel
								theme={theme}
								customAICommands={props.customAICommands}
								setCustomAICommands={props.setCustomAICommands}
							/>

							{/* Divider */}
							<div className="border-t" style={{ borderColor: theme.colors.border }} />

							{/* Spec Kit Commands Section */}
							<SpecKitCommandsPanel theme={theme} />

							{/* Divider */}
							<div className="border-t" style={{ borderColor: theme.colors.border }} />

							{/* OpenSpec Commands Section */}
							<OpenSpecCommandsPanel theme={theme} />
						</div>
					)}

					{activeTab === 'ssh' && (
						<div className="space-y-5">
							<SshRemotesSection theme={theme} />
						</div>
					)}

					{activeTab === 'audits' && (
						<div className="space-y-5">
							<AuditsSettingsTab theme={theme} />
						</div>
					)}

					{activeTab === 'honeycomb' && (
						<>
							<HoneycombSettingsSection
								theme={theme}
								settings={honeycombWarningSettings}
								onUpdate={updateHoneycombWarningSettings}
								hasCalibrationData={planCalibration.calibrationPoints.length > 0}
								dataSource={honeycombDataSource}
								onDataSourceChange={setHoneycombDataSource}
								mcpApiKey={honeycombMcpApiKey}
								onMcpApiKeyChange={setHoneycombMcpApiKey}
								environmentSlug={honeycombEnvironmentSlug}
								onEnvironmentSlugChange={setHoneycombEnvironmentSlug}
								mcpRegion={honeycombMcpRegion}
								onMcpRegionChange={setHoneycombMcpRegion}
								apiKey={honeycombApiKey}
								onApiKeyChange={setHoneycombApiKey}
								datasetSlug={honeycombDatasetSlug}
								onDatasetSlugChange={setHoneycombDatasetSlug}
							/>
							<PlanCalibrationSettings
								theme={theme}
								calibration={planCalibration}
								onCalibrationUpdate={setPlanCalibration}
								onViewHistory={() => setShowCalibrationHistory(true)}
								getHoneycombBillableTokens={getHoneycombBillableTokens}
							/>
						</>
					)}
				</div>
			</div>

			<CalibrationHistoryModal
				theme={theme}
				calibration={planCalibration}
				isOpen={showCalibrationHistory}
				onClose={() => setShowCalibrationHistory(false)}
			/>
		</div>
	);
});
