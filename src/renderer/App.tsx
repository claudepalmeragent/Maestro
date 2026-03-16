import React, { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
// SettingsModal is lazy-loaded for performance (large component, only loaded when settings opened)
const SettingsModal = lazy(() =>
	import('./components/Settings/SettingsModal').then((m) => ({ default: m.SettingsModal }))
);
import { SessionList } from './components/SessionList';
import { RightPanel, RightPanelHandle } from './components/RightPanel';
import { slashCommands } from './slashCommands';
import { AppModals, type PRDetails, type FlatFileItem } from './components/AppModals';
// DEFAULT_BATCH_PROMPT moved to useSymphonyContribution hook
import { ErrorBoundary } from './components/ErrorBoundary';
import { MainPanel, type MainPanelHandle } from './components/MainPanel';
import { AppOverlays } from './components/AppOverlays';
import { PlaygroundPanel } from './components/PlaygroundPanel';
import { DebugWizardModal } from './components/DebugWizardModal';
import { DebugPackageModal } from './components/DebugPackageModal';
import { WindowsWarningModal } from './components/WindowsWarningModal';
import { GistPublishModal } from './components/GistPublishModal';
import { MaestroWizard, useWizard, WizardResumeModal } from './components/Wizard';
import { TourOverlay } from './components/Wizard/tour';
// CONDUCTOR_BADGES moved to useAutoRunAchievements hook
import { EmptyStateView } from './components/EmptyStateView';
import { DeleteAgentConfirmModal } from './components/DeleteAgentConfirmModal';
import { CapacityCheckModal } from './components/CapacityCheckModal';
import type { CapacityCheckModalData } from './components/CapacityCheckModal';

// Lazy-loaded components for performance (rarely-used heavy modals)
// These are loaded on-demand when the user first opens them
const LogViewer = lazy(() =>
	import('./components/LogViewer').then((m) => ({ default: m.LogViewer }))
);
const MarketplaceModal = lazy(() =>
	import('./components/MarketplaceModal').then((m) => ({ default: m.MarketplaceModal }))
);
const SymphonyModal = lazy(() =>
	import('./components/SymphonyModal').then((m) => ({ default: m.SymphonyModal }))
);
const DocumentGraphView = lazy(() =>
	import('./components/DocumentGraph/DocumentGraphView').then((m) => ({
		default: m.DocumentGraphView,
	}))
);
const DirectorNotesModal = lazy(() =>
	import('./components/DirectorNotes').then((m) => ({ default: m.DirectorNotesModal }))
);

// SymphonyContributionData type moved to useSymphonyContribution hook

// Group Chat Components
import { GroupChatPanel } from './components/GroupChatPanel';
import { GroupChatRightPanel } from './components/GroupChatRightPanel';

// Import custom hooks
import {
	// Batch processing
	useBatchHandlers,
	useBatchedSessionUpdates,
	// Settings
	useSettings,
	useDebouncedPersistence,
	// Session management
	useActivityTracker,
	useHandsOnTimeTracker,
	useNavigationHistory,
	useSessionNavigation,
	useSortedSessions,
	useGroupManagement,
	// Input processing
	useInputHandlers,
	// Keyboard handling
	useKeyboardShortcutHelpers,
	useKeyboardNavigation,
	useMainKeyboardHandler,
	// Agent
	useAgentSessionManagement,
	useAgentExecution,
	useAgentCapabilities,
	useMergeTransferHandlers,
	useSummarizeAndContinue,
	// Git
	useFileTreeManagement,
	useFileExplorerEffects,
	// Remote
	useRemoteIntegration,
	useRemoteHandlers,
	useWebBroadcasting,
	useCliActivityMonitoring,
	useMobileLandscape,
	// UI
	useThemeStyles,
	useThemeSync,
	useAppHandlers,
	// Auto Run
	useAutoRunHandlers,
	// Tab handlers
	useTabHandlers,
	// Group chat handlers
	useGroupChatHandlers,
	// Modal handlers
	useModalHandlers,
	// Worktree handlers
	useWorktreeHandlers,
	// Session restoration
	useSessionRestoration,
	// Input keyboard handling
	// App initialization effects
	useAppInitialization,
	// Session lifecycle operations
	useSessionLifecycle,
	useSessionCrud,
	// Wizard handlers
	useWizardHandlers,
	// Interrupt handler
	useInterruptHandler,
	// Tour actions (right panel control from tour overlay)
	useTourActions,
	// Queue handlers (queue browser UI operations)
	useQueueHandlers,
	// Queue processing (execution queue processing + startup recovery)
	useQueueProcessing,
	// Tab export handlers (copy context, export HTML, publish gist)
	useTabExportHandlers,
	// Auto Run achievements (progress tracking, peak stats)
	useAutoRunAchievements,
	// Auto Run document loader (list, tree, task counts, file watching)
	useAutoRunDocumentLoader,
	// Prompt Composer modal handlers
	usePromptComposerHandlers,
	// Quick Actions modal handlers (Cmd+K)
	useQuickActionsHandlers,
	// Session cycling (Cmd+Shift+[/])
	useCycleSession,
	// Input mode toggle (Tier 3A)
	useInputMode,
	// Live mode management (Tier 3B)
	useLiveMode,
} from './hooks';
import { useMainPanelProps, useSessionListProps, useRightPanelProps } from './hooks/props';
import { useAgentListeners } from './hooks/agent/useAgentListeners';
import { useSymphonyContribution } from './hooks/symphony/useSymphonyContribution';

// Import contexts
import { useLayerStack } from './contexts/LayerStackContext';
import { notifyToast } from './stores/notificationStore';
import { useModalActions, useModalStore } from './stores/modalStore';
import { GitStatusProvider } from './contexts/GitStatusContext';
import { InputProvider, useInputContext } from './contexts/InputContext';
import { useGroupChatStore } from './stores/groupChatStore';
import { useBatchStore } from './stores/batchStore';
// All session state is read directly from useSessionStore in MaestroConsoleInner.
import { useSessionStore, selectActiveSession } from './stores/sessionStore';
// useAgentStore moved to useQueueProcessing hook
import { InlineWizardProvider, useInlineWizardContext } from './contexts/InlineWizardContext';
import { ProjectFoldersProvider, useProjectFoldersContext } from './contexts/ProjectFoldersContext';
import { ToastContainer } from './components/Toast';

// Import services
import { detectGitRepo } from './services/git';
// getSpeckitCommands, getOpenSpecCommands moved to useAppInitialization hook
// autorunSynopsisPrompt, maestroSystemPrompt, parseSynopsis, formatRelativeTime moved to hooks

// Import types and constants
// Note: GroupChat, GroupChatState are now imported via GroupChatContext
import type {
	ToolType,
	SessionState,
	RightPanelTab,
	LogEntry,
	Session,
	QueuedItem,
	CustomAICommand,
	ThinkingItem,
	PinnedItem,
	PromptLibraryEntry,
} from './types';
import { THEMES } from './constants/themes';
import { generateId } from './utils/ids';
import { getContextColor } from './utils/theme';
import { safeClipboardWrite } from './utils/clipboard';
import {
	createTab,
	closeTab,
	reopenUnifiedClosedTab,
	getActiveTab,
	navigateToNextTab,
	navigateToPrevTab,
	navigateToTabByIndex,
	navigateToLastTab,
	navigateToUnifiedTabByIndex,
	navigateToLastUnifiedTab,
	navigateToNextUnifiedTab,
	navigateToPrevUnifiedTab,
	hasActiveWizard,
} from './utils/tabHelpers';
// validateNewSession moved to useSymphonyContribution, useSessionCrud hooks
// formatLogsForClipboard moved to useTabExportHandlers hook
// getSlashCommandDescription moved to useWizardHandlers
import { useUIStore } from './stores/uiStore';
import { useTabStore } from './stores/tabStore';
import { useFileExplorerStore } from './stores/fileExplorerStore';

function MaestroConsoleInner() {
	// --- LAYER STACK (for blocking shortcuts when modals are open) ---
	const { hasOpenLayers, hasOpenModal } = useLayerStack();

	// --- PROJECT FOLDERS (for Prompt Library metadata) ---
	const { getFolderById } = useProjectFoldersContext();

	// --- MODAL STATE (centralized modal state management via Zustand) ---
	const {
		// Settings Modal
		settingsModalOpen,
		setSettingsModalOpen,
		settingsTab,
		setSettingsTab,
		// New Instance Modal
		newInstanceModalOpen,
		duplicatingSessionId,
		// Edit Agent Modal
		setEditAgentModalOpen,
		editAgentSession,
		setEditAgentSession,
		// Delete Agent Modal
		deleteAgentModalOpen,
		deleteAgentSession,
		// Shortcuts Help Modal
		shortcutsHelpOpen,
		setShortcutsHelpOpen,
		// Quick Actions Modal
		quickActionOpen,
		setQuickActionOpen,
		quickActionInitialMode,
		setQuickActionInitialMode,
		// Lightbox Modal
		lightboxImage,
		lightboxImages,
		lightboxAllowDelete,
		// About Modal
		aboutModalOpen,
		setAboutModalOpen,
		// Update Check Modal
		setUpdateCheckModalOpen,
		// standingOvationData, firstRunCelebrationData — now self-sourced in AppOverlays (Tier 1A)
		// Log Viewer
		logViewerOpen,
		setLogViewerOpen,
		// Process Monitor
		processMonitorOpen,
		setProcessMonitorOpen,
		// Usage Dashboard
		usageDashboardOpen,
		setUsageDashboardOpen,
		// pendingKeyboardMasteryLevel — now self-sourced in AppOverlays (Tier 1A)
		// Playground Panel
		playgroundOpen,
		setPlaygroundOpen,
		// Debug Wizard Modal
		debugWizardModalOpen,
		setDebugWizardModalOpen,
		// Debug Package Modal
		debugPackageModalOpen,
		setDebugPackageModalOpen,
		// Windows Warning Modal
		windowsWarningModalOpen,
		setWindowsWarningModalOpen,
		// Confirmation Modal
		confirmModalOpen,
		setConfirmModalOpen,
		confirmModalMessage,
		setConfirmModalMessage,
		confirmModalOnConfirm,
		setConfirmModalOnConfirm,
		confirmModalTitle,
		confirmModalDestructive,
		// Rename Instance Modal
		renameInstanceModalOpen,
		setRenameInstanceModalOpen,
		renameInstanceValue,
		setRenameInstanceValue,
		renameInstanceSessionId,
		// Rename Tab Modal
		setRenameTabModalOpen,
		renameTabId,
		setRenameTabId,
		renameTabInitialName,
		setRenameTabInitialName,
		// Rename Group Modal
		renameGroupModalOpen,
		setRenameGroupModalOpen,
		renameGroupId,
		setRenameGroupId,
		renameGroupValue,
		setRenameGroupValue,
		renameGroupEmoji,
		setRenameGroupEmoji,
		// Agent Sessions Browser
		agentSessionsOpen,
		setAgentSessionsOpen,
		activeAgentSessionId,
		setActiveAgentSessionId,
		// Batch Runner Modal
		setBatchRunnerModalOpen,
		// Auto Run Setup Modal
		setAutoRunSetupModalOpen,
		// Marketplace Modal
		marketplaceModalOpen,
		setMarketplaceModalOpen,
		// Wizard Resume Modal
		wizardResumeModalOpen,
		wizardResumeState,
		// setWizardResumeModalOpen, setWizardResumeState — now used in useWizardHandlers (Tier 3D)
		// Agent Error Modal
		// Worktree Modals
		createWorktreeSession,
		createPRSession,
		setCreatePRSession,
		deleteWorktreeSession,
		// Tab Switcher Modal
		setTabSwitcherOpen,
		// Fuzzy File Search Modal
		setFuzzyFileSearchOpen,
		// Prompt Composer Modal
		setPromptComposerOpen,
		// Merge Session Modal
		setMergeSessionModalOpen,
		// Send to Agent Modal
		setSendToAgentModalOpen,
		// Group Chat Modals
		setShowNewGroupChatModal,
		showDeleteGroupChatModal,
		showRenameGroupChatModal,
		showEditGroupChatModal,
		// Git Diff Viewer
		gitDiffPreview,
		setGitDiffPreview,
		// Git Log Viewer
		gitLogOpen,
		setGitLogOpen,
		// Tour Overlay
		tourOpen,
		setTourOpen,
		tourFromWizard,
		// Symphony Modal
		symphonyModalOpen,
		setSymphonyModalOpen,
		// Director's Notes Modal
		directorNotesOpen,
		setDirectorNotesOpen,
	} = useModalActions();

	// Local state - was in ModalContext, not migrated to store
	const [usageDashboardInitialTab, setUsageDashboardInitialTab] = useState<string | undefined>(
		undefined
	);
	const [createGroupChatForFolderId, _setCreateGroupChatForFolderId] = useState<string | undefined>(
		undefined
	);

	// --- MOBILE LANDSCAPE MODE (reading-only view) ---
	const isMobileLandscape = useMobileLandscape();

	// --- NAVIGATION HISTORY (back/forward through sessions and tabs) ---
	const { pushNavigation, navigateBack, navigateForward } = useNavigationHistory();

	// --- WIZARD (onboarding wizard for new users) ---
	const {
		state: wizardState,
		openWizard: openWizardModal,
		restoreState: restoreWizardState,
		loadResumeState: _loadResumeState,
		clearResumeState,
		completeWizard,
		closeWizard: _closeWizardModal,
		goToStep: wizardGoToStep,
	} = useWizard();

	// --- SETTINGS (from useSettings hook) ---
	const settings = useSettings();
	const {
		conductorProfile,
		fontFamily,
		fontSize,
		activeThemeId,
		setActiveThemeId,
		customThemeColors,
		themeMode,
		lightThemeId,
		darkThemeId,
		enterToSendAI,
		setEnterToSendAI,
		defaultSaveToHistory,
		defaultShowThinking,
		rightPanelWidth,
		setRightPanelWidth,
		markdownEditMode,
		setMarkdownEditMode,
		chatRawTextMode,
		setChatRawTextMode,
		showHiddenFiles: _showHiddenFiles,
		setShowHiddenFiles: _setShowHiddenFiles,
		terminalWidth: _terminalWidth,
		setTerminalWidth: _setTerminalWidth,
		logLevel,
		logViewerSelectedLevels,
		setLogViewerSelectedLevels,
		maxOutputLines,
		enableBetaUpdates,
		setEnableBetaUpdates,
		shortcuts,
		tabShortcuts,
		customAICommands,
		totalActiveTimeMs,
		addTotalActiveTimeMs,
		autoRunStats,
		usageStats,
		tourCompleted: _tourCompleted,
		setTourCompleted,
		recordWizardStart,
		recordWizardComplete,
		recordWizardAbandon,
		recordWizardResume,
		recordTourStart,
		recordTourComplete,
		recordTourSkip,
		leaderboardRegistration,
		isLeaderboardRegistered,
		contextManagementSettings,
		updateContextManagementSettings: _updateContextManagementSettings,
		keyboardMasteryStats,
		recordShortcutUsage,
		colorBlindMode,
		defaultStatsTimeRange,
		documentGraphShowExternalLinks,
		documentGraphMaxNodes,
		documentGraphPreviewCharLimit,
		documentGraphLayoutType,

		// File tab refresh settings
		fileTabAutoRefreshEnabled,
		useNativeTitleBar,
		autoScrollAiMode,
		setAutoScrollAiMode,
		setSuppressWindowsWarning,
		encoreFeatures,
	} = settings;

	// --- KEYBOARD SHORTCUT HELPERS ---
	const { isShortcut, isTabShortcut } = useKeyboardShortcutHelpers({
		shortcuts,
		tabShortcuts,
	});

	// --- SESSION STATE (migrated from useSession() to direct useSessionStore selectors) ---
	// Reactive values — each selector triggers re-render only when its specific value changes
	const sessions = useSessionStore((s) => s.sessions);
	const groups = useSessionStore((s) => s.groups);
	const activeSessionId = useSessionStore((s) => s.activeSessionId);
	// sessionsLoaded moved to useQueueProcessing hook
	const activeSession = useSessionStore(selectActiveSession);

	// Actions — stable references from store, never trigger re-renders
	const {
		setSessions,
		setGroups,
		setActiveSessionId: storeSetActiveSessionId,
		setRemovedWorktreePaths,
	} = useMemo(() => useSessionStore.getState(), []);

	// batchedUpdater — React hook for timer lifecycle (reads store directly)
	const batchedUpdater = useBatchedSessionUpdates();
	const batchedUpdaterRef = useRef(batchedUpdater);
	batchedUpdaterRef.current = batchedUpdater;

	// setActiveSessionId wrapper — flushes batched updates before switching
	const setActiveSessionIdFromContext = useCallback(
		(id: string) => {
			batchedUpdaterRef.current.flushNow();
			storeSetActiveSessionId(id);
		},
		[storeSetActiveSessionId]
	);

	// Ref-like getters — read current state from store without stale closures
	// Used by 106 callback sites that need current state (e.g., sessionsRef.current)
	const sessionsRef = useMemo(
		() => ({
			get current() {
				return useSessionStore.getState().sessions;
			},
		}),
		[]
	) as React.MutableRefObject<Session[]>;

	const activeSessionIdRef = useMemo(
		() => ({
			get current() {
				return useSessionStore.getState().activeSessionId;
			},
		}),
		[]
	) as React.MutableRefObject<string>;

	// initialLoadComplete — provided by useSessionRestoration hook

	// cyclePositionRef — Proxy bridges ref API to store number
	const cyclePositionRef = useMemo(() => {
		const ref = { current: useSessionStore.getState().cyclePosition };
		return new Proxy(ref, {
			set(_target, prop, value) {
				if (prop === 'current') {
					ref.current = value;
					useSessionStore.getState().setCyclePosition(value);
					return true;
				}
				return false;
			},
			get(target, prop) {
				if (prop === 'current') {
					return useSessionStore.getState().cyclePosition;
				}
				return (target as Record<string | symbol, unknown>)[prop];
			},
		});
	}, []) as React.MutableRefObject<number>;

	// --- UI LAYOUT STATE (from uiStore, replaces UILayoutContext) ---
	// State: individual selectors for granular re-render control
	const leftSidebarOpen = useUIStore((s) => s.leftSidebarOpen);
	const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
	const activeRightTab = useUIStore((s) => s.activeRightTab);
	const activeFocus = useUIStore((s) => s.activeFocus);
	const bookmarksCollapsed = useUIStore((s) => s.bookmarksCollapsed);
	// groupChatsExpanded moved to useCycleSession hook
	const showUnreadOnly = useUIStore((s) => s.showUnreadOnly);
	const fileTreeFilter = useFileExplorerStore((s) => s.fileTreeFilter);
	const fileTreeFilterOpen = useFileExplorerStore((s) => s.fileTreeFilterOpen);
	const editingGroupId = useUIStore((s) => s.editingGroupId);
	const editingSessionId = useUIStore((s) => s.editingSessionId);
	const draggingSessionId = useUIStore((s) => s.draggingSessionId);
	const flashNotification = useUIStore((s) => s.flashNotification);
	const successFlashNotification = useUIStore((s) => s.successFlashNotification);
	const selectedSidebarIndex = useUIStore((s) => s.selectedSidebarIndex);

	// Actions: stable closures created at store init, no hook overhead needed
	const {
		setLeftSidebarOpen,
		setRightPanelOpen,
		setActiveRightTab,
		setActiveFocus,
		setBookmarksCollapsed,
		setEditingGroupId,
		setDraggingSessionId,
		setFlashNotification,
		setSuccessFlashNotification,
		setSelectedSidebarIndex,
	} = useUIStore.getState();

	const {
		setSelectedFileIndex: _setSelectedFileIndex,
		setFileTreeFilter: _setFileTreeFilter,
		setFileTreeFilterOpen,
	} = useFileExplorerStore.getState();

	// --- GROUP CHAT STATE (now in groupChatStore) ---

	// Reactive reads from groupChatStore (granular subscriptions)
	const groupChats = useGroupChatStore((s) => s.groupChats);
	const activeGroupChatId = useGroupChatStore((s) => s.activeGroupChatId);
	const groupChatMessages = useGroupChatStore((s) => s.groupChatMessages);
	const groupChatState = useGroupChatStore((s) => s.groupChatState);
	const groupChatStagedImages = useGroupChatStore((s) => s.groupChatStagedImages);
	const groupChatReadOnlyMode = useGroupChatStore((s) => s.groupChatReadOnlyMode);
	const groupChatExecutionQueue = useGroupChatStore((s) => s.groupChatExecutionQueue);
	const groupChatRightTab = useGroupChatStore((s) => s.groupChatRightTab);
	const groupChatParticipantColors = useGroupChatStore((s) => s.groupChatParticipantColors);
	const moderatorUsage = useGroupChatStore((s) => s.moderatorUsage);
	const participantStates = useGroupChatStore((s) => s.participantStates);
	const groupChatError = useGroupChatStore((s) => s.groupChatError);

	// Stable actions from groupChatStore (non-reactive)
	const {
		setActiveGroupChatId,
		setGroupChatStagedImages,
		setGroupChatReadOnlyMode,
		setGroupChatRightTab,
		setGroupChatParticipantColors,
	} = useGroupChatStore.getState();

	// Group chat thinking state (local, not persisted)
	const [groupChatShowThinking, setGroupChatShowThinking] = useState(false);
	const [groupChatThinkingContent, setGroupChatThinkingContent] = useState<Map<string, string>>(
		new Map()
	);
	const [groupChatThinkingCollapsed, setGroupChatThinkingCollapsed] = useState<
		Map<string, boolean>
	>(new Map());

	// Keep editAgentSession in sync with live sessions state.
	// Without this, handleRescanGit updates sessions via store but
	// editAgentSession remains a stale snapshot, causing git fields
	// and other updated fields to not appear in the EditAgentModal.
	useEffect(() => {
		const editAgentData = useModalStore.getState().modals.get('editAgent');
		const editAgentModalData = editAgentData?.data as { session?: Session } | undefined;
		if (!editAgentData?.open || !editAgentModalData?.session) return;
		const editSession = editAgentModalData.session;
		const liveSession = sessions.find((s: Session) => s.id === editSession.id);
		if (liveSession && liveSession !== editSession) {
			useModalStore.getState().openModal('editAgent', { session: liveSession });
		}
	}, [sessions]);

	// --- APP INITIALIZATION (extracted hook, Phase 2G) ---
	const { ghCliAvailable, sshRemoteConfigs, speckitCommands, openspecCommands, saveFileGistUrl } =
		useAppInitialization();

	// Wrapper for setActiveSessionId that also dismisses active group chat
	const setActiveSessionId = useCallback(
		(id: string) => {
			setActiveGroupChatId(null); // Dismiss group chat when selecting an agent
			setActiveSessionIdFromContext(id);
		},
		[setActiveSessionIdFromContext, setActiveGroupChatId]
	);

	// Completion states from InputContext (these change infrequently)
	const {
		slashCommandOpen,
		setSlashCommandOpen,
		selectedSlashCommandIndex,
		setSelectedSlashCommandIndex,
		tabCompletionOpen,
		setTabCompletionOpen,
		selectedTabCompletionIndex,
		setSelectedTabCompletionIndex,
		tabCompletionFilter,
		setTabCompletionFilter,
		atMentionOpen,
		setAtMentionOpen,
		atMentionFilter,
		setAtMentionFilter,
		atMentionStartIndex,
		setAtMentionStartIndex,
		selectedAtMentionIndex,
		setSelectedAtMentionIndex,
		commandHistoryOpen,
		setCommandHistoryOpen,
		commandHistoryFilter,
		setCommandHistoryFilter,
		commandHistorySelectedIndex,
		setCommandHistorySelectedIndex,
	} = useInputContext();

	// File Explorer State (reads from fileExplorerStore)
	const filePreviewLoading = useFileExplorerStore((s) => s.filePreviewLoading);
	const isGraphViewOpen = useFileExplorerStore((s) => s.isGraphViewOpen);
	const graphFocusFilePath = useFileExplorerStore((s) => s.graphFocusFilePath);
	const lastGraphFocusFilePath = useFileExplorerStore((s) => s.lastGraphFocusFilePath);

	const [gistPublishModalOpen, setGistPublishModalOpen] = useState(false);
	// Tab context gist publishing - now backed by tabStore (Zustand)
	const tabGistContent = useTabStore((s) => s.tabGistContent);
	const fileGistUrls = useTabStore((s) => s.fileGistUrls);

	// Note: Delete Agent Modal State is now managed by modalStore (Zustand)
	// See useModalActions() destructuring above for deleteAgentModalOpen / deleteAgentSession

	// Note: Git Diff State, Tour Overlay State, and Git Log Viewer State are from modalStore

	// Note: Renaming state (editingGroupId/editingSessionId) and drag state (draggingSessionId)
	// are now destructured from useUIStore() above

	// Note: All modal states are now managed by modalStore (Zustand)
	// See useModalActions() destructuring above for modal states

	// Note: Modal close/open handlers are now provided by useModalHandlers() hook
	// See the destructured handlers below (handleCloseGitDiff, handleCloseGitLog, etc.)

	// Note: All modal states (confirmation, rename, queue browser, batch runner, etc.)
	// are now managed by modalStore - see useModalActions() destructuring above

	// NOTE: showSessionJumpNumbers state is now provided by useMainKeyboardHandler hook

	// Note: Output search, flash notifications, command history, tab completion, and @ mention
	// states are now destructured from useUIStore() and useInputContext() above

	// Note: Images are now stored per-tab in AITab.stagedImages
	// See stagedImages/setStagedImages computed from active tab below

	// Global Live Mode — extracted to useLiveMode hook (Tier 3B)
	const { isLiveMode, webInterfaceUrl, toggleGlobalLive, restartWebServer } = useLiveMode();

	// Auto Run document management state (from batchStore)
	// Content is per-session in session.autoRunContent
	const batchRunStates = useBatchStore((s) => s.batchRunStates);
	const autoRunDocumentList = useBatchStore((s) => s.documentList);
	const autoRunDocumentTree = useBatchStore((s) => s.documentTree);
	const {
		setDocumentList: setAutoRunDocumentList,
		setDocumentTree: setAutoRunDocumentTree,
		setIsLoadingDocuments: setAutoRunIsLoadingDocuments,
	} = useBatchStore.getState();

	// ProcessMonitor navigation handlers
	const handleProcessMonitorNavigateToSession = useCallback(
		(sessionId: string, tabId?: string) => {
			setActiveSessionId(sessionId);
			if (tabId) {
				// Switch to the specific tab within the session
				setSessions((prev) =>
					prev.map((s) => (s.id === sessionId ? { ...s, activeTabId: tabId } : s))
				);
			}
		},
		[setActiveSessionId, setSessions]
	);

	// Expose playground() function for developer console
	useEffect(() => {
		(window as unknown as { playground: () => void }).playground = () => {
			setPlaygroundOpen(true);
		};
		return () => {
			delete (window as unknown as { playground?: () => void }).playground;
		};
	}, []);

	// Restore a persisted session by respawning its process
	/**
	 * Fetch git info (isRepo, branches, tags) for a session in the background.
	 * This is called after initial session restore to avoid blocking app startup
	 * on SSH timeouts for remote sessions.
	 */
	const fetchGitInfoInBackground = useCallback(
		async (sessionId: string, cwd: string, sshRemoteId: string | undefined) => {
			try {
				// Subdir scan enabled — safe now that scanWorktreeDirectory is sequential/stop-on-first
				// and detectGitRepo has in-flight dedup. If SSH isn't ready yet this will fail
				// and onSshRemote first-connect will retry.
				const result = await detectGitRepo(cwd, sshRemoteId, { enableSubdirScan: true });

				setSessions((prev) =>
					prev.map((s) => {
						if (s.id !== sessionId) return s;
						// Don't overwrite a successful detection from onSshRemote with a
						// "not found" result (race: onSshRemote may find the repo via a
						// path that fetchGitInfoInBackground missed due to timing).
						if (s.isGitRepo && !result.isGitRepo) {
							return s;
						}
						return {
							...s,
							isGitRepo: result.isGitRepo,
							isBareRepo: result.isBareRepo,
							gitRoot: result.gitRoot,
							gitBranches: result.gitBranches,
							gitTags: result.gitTags,
							gitRefsCacheTime: result.gitRefsCacheTime,
							sshConnectionFailed: false,
						};
					})
				);
			} catch (error) {
				console.warn(`[fetchGitInfoInBackground] Failed for session ${sessionId}:`, error);
				setSessions((prev) =>
					prev.map((s) => {
						if (s.id !== sessionId) return s;
						// Don't overwrite successful detection from onSshRemote.
						// Race: fetchGitInfoInBackground starts before SSH is ready → slow timeout,
						// meanwhile onSshRemote fires and succeeds. If we blindly reset isGitRepo
						// to false here, we'd wipe out the successful detection.
						if (s.isGitRepo) {
							return s;
						}
						return {
							...s,
							sshConnectionFailed: true,
							isGitRepo: false,
							isBareRepo: undefined,
							gitRoot: undefined,
							gitBranches: undefined,
							gitTags: undefined,
							gitRefsCacheTime: undefined,
						};
					})
				);
			}
		},
		[]
	);

	const restoreSession = async (session: Session): Promise<Session> => {
		try {
			// Migration: ensure projectRoot is set (for sessions created before this field was added)
			if (!session.projectRoot) {
				session = { ...session, projectRoot: session.cwd };
			}

			// Sessions must have aiTabs - if missing, this is a data corruption issue
			// Create a default tab to prevent crashes when code calls .find() on aiTabs
			if (!session.aiTabs || session.aiTabs.length === 0) {
				console.error(
					'[restoreSession] Session has no aiTabs - data corruption, creating default tab:',
					session.id
				);
				const defaultTabId = generateId();
				return {
					...session,
					aiPid: -1,
					terminalPid: 0,
					state: 'error' as SessionState,
					isLive: false,
					liveUrl: undefined,
					aiTabs: [
						{
							id: defaultTabId,
							agentSessionId: null,
							name: null,
							state: 'idle' as const,
							logs: [
								{
									id: generateId(),
									timestamp: Date.now(),
									source: 'system' as const,
									text: '⚠️ Session data was corrupted and has been recovered with a new tab.',
								},
							],
							starred: false,
							inputValue: '',
							stagedImages: [],
							createdAt: Date.now(),
						},
					],
					activeTabId: defaultTabId,
				};
			}

			// Detect and fix inputMode/toolType mismatch
			// The AI agent should never use 'terminal' as toolType
			let correctedSession = { ...session };
			let aiAgentType = correctedSession.toolType;

			// If toolType is 'terminal', migrate to claude-code
			// This fixes legacy sessions that were incorrectly saved with toolType='terminal'
			if (aiAgentType === 'terminal') {
				console.warn(`[restoreSession] Session has toolType='terminal', migrating to claude-code`);
				aiAgentType = 'claude-code' as ToolType;
				correctedSession = {
					...correctedSession,
					toolType: 'claude-code' as ToolType,
				};

				// Add warning to the active tab's logs
				const warningLog: LogEntry = {
					id: generateId(),
					timestamp: Date.now(),
					source: 'system',
					text: '⚠️ Session migrated to use Claude Code agent.',
				};
				const activeTabIndex = correctedSession.aiTabs.findIndex(
					(tab) => tab.id === correctedSession.activeTabId
				);
				if (activeTabIndex >= 0) {
					correctedSession.aiTabs = correctedSession.aiTabs.map((tab, i) =>
						i === activeTabIndex ? { ...tab, logs: [...tab.logs, warningLog] } : tab
					);
				}
			}

			// Migrate legacy 'claude' toolType to 'claude-code'
			if ((aiAgentType as string) === 'claude') {
				aiAgentType = 'claude-code' as ToolType;
				correctedSession = {
					...correctedSession,
					toolType: 'claude-code' as ToolType,
				};
			}

			// Get agent definitions for both processes
			const agent = await window.maestro.agents.get(aiAgentType);
			if (!agent) {
				console.error(`Agent not found for toolType: ${correctedSession.toolType}`);
				return {
					...correctedSession,
					aiPid: -1,
					terminalPid: 0,
					state: 'error' as SessionState,
					isLive: false,
					liveUrl: undefined,
				};
			}

			// Don't eagerly spawn AI processes on session restore:
			// - Batch mode agents (Claude Code, OpenCode, Codex) spawn per message in useInputProcessing
			// - Terminal uses runCommand (fresh shells per command)
			// This prevents 20+ idle processes when app starts with many saved sessions
			// aiPid stays at 0 until user sends their first message
			const aiSpawnResult = { pid: 0, success: true };
			const aiSuccess = true;

			if (aiSuccess) {
				// Get SSH remote ID for remote git operations
				// Note: sshRemoteId is only set after AI agent spawns. For terminal-only SSH sessions,
				// we must fall back to sessionSshRemoteConfig.remoteId. See CLAUDE.md "SSH Remote Sessions".
				const sshRemoteId =
					correctedSession.sshRemoteId ||
					correctedSession.sessionSshRemoteConfig?.remoteId ||
					undefined;

				// Validate SSH config on restore: if session references an SSH remote,
				// check that it still exists and is enabled in settings
				if (sshRemoteId && correctedSession.sessionSshRemoteConfig?.enabled) {
					try {
						const configsResult = await window.maestro.sshRemote.getConfigs();
						if (configsResult.success && configsResult.configs) {
							const matchingRemote = configsResult.configs.find(
								(r) => r.id === sshRemoteId && r.enabled
							);
							if (!matchingRemote) {
								console.warn(
									`[restoreSession] SSH remote '${sshRemoteId}' no longer exists or is disabled for session ${correctedSession.id}. ` +
										`Session will attempt local execution until SSH remote is reconfigured.`
								);
							}
						}
					} catch {
						// SSH remote API not available during early startup — skip validation
					}
				}

				// For SSH remote sessions, defer git operations to background to avoid blocking
				// app startup on SSH connection timeouts (which can be 10+ seconds per session)
				const isRemoteSession = !!sshRemoteId;

				// Git detection approach per session type:
				// - Local sessions: detected synchronously here (fast, sub-100ms)
				// - Remote sessions: always start with isGitRepo=false, detected later via
				//   fetchGitInfoInBackground (on startup) and onSshRemote (when SSH connects)
				let isGitRepo = false;
				let gitBranches: string[] | undefined;
				let gitTags: string[] | undefined;
				let gitRefsCacheTime: number | undefined;
				let gitRoot: string | undefined;

				if (!isRemoteSession) {
					// Local session - cheap isRepo check only (sub-ms for local).
					// Subdirectory scanning is deferred to manual Re-scan if cwd isn't a repo.
					const gitResult = await detectGitRepo(correctedSession.cwd, undefined);
					isGitRepo = gitResult.isGitRepo;
					gitBranches = gitResult.gitBranches;
					gitTags = gitResult.gitTags;
					gitRefsCacheTime = gitResult.gitRefsCacheTime;
					gitRoot = gitResult.gitRoot;
				}
				// For remote sessions, git info will be detected via:
				// 1. fetchGitInfoInBackground (fires immediately after restore, may fail if SSH not ready)
				// 2. onSshRemote (fires when SSH actually connects — the primary detection path)

				// Reset all tab states to idle - processes don't survive app restart
				const resetAiTabs = correctedSession.aiTabs.map((tab) => ({
					...tab,
					state: 'idle' as const,
					thinkingStartTime: undefined,
				}));

				// Session restored - no superfluous messages added to AI Terminal or Command Terminal
				return {
					...correctedSession,
					aiPid: aiSpawnResult.pid,
					terminalPid: 0, // Terminal uses runCommand (fresh shells per command)
					state: 'idle' as SessionState,
					// Reset runtime-only busy state - processes don't survive app restart
					busySource: undefined,
					thinkingStartTime: undefined,
					currentCycleTokens: undefined,
					currentCycleBytes: undefined,
					statusMessage: undefined,
					isGitRepo, // Update Git status (or use persisted value for remote)
					gitRoot,
					gitBranches,
					gitTags,
					gitRefsCacheTime,
					isLive: false, // Always start offline on app restart
					liveUrl: undefined, // Clear any stale URL
					aiLogs: [], // Deprecated - logs are now in aiTabs
					aiTabs: resetAiTabs, // Reset tab states
					shellLogs: correctedSession.shellLogs, // Preserve existing Command Terminal logs
					executionQueue: correctedSession.executionQueue || [], // Ensure backwards compatibility
					activeTimeMs: correctedSession.activeTimeMs || 0, // Ensure backwards compatibility
					// Clear runtime-only error state - no agent is running yet so there can't be an error
					agentError: undefined,
					agentErrorPaused: false,
					synopsisInProgress: false, // Runtime-only, clear to prevent queue lock on restart
					closedTabHistory: correctedSession.closedTabHistory || [], // Persisted, hydrate from store
				};
			} else {
				// Process spawn failed
				console.error(`Failed to restore session ${session.id}`);
				return {
					...session,
					aiPid: -1,
					terminalPid: 0,
					state: 'error' as SessionState,
					isLive: false,
					liveUrl: undefined,
				};
			}
		} catch (error) {
			console.error(`Error restoring session ${session.id}:`, error);
			return {
				...session,
				aiPid: -1,
				terminalPid: 0,
				state: 'error' as SessionState,
				isLive: false,
				liveUrl: undefined,
			};
		}
	};

	// Load sessions and groups from electron-store on mount
	// Use a ref to prevent duplicate execution in React Strict Mode
	const sessionLoadStarted = useRef(false);
	useEffect(() => {
		console.log('[App] Session load useEffect triggered');
		// Guard against duplicate execution in React Strict Mode
		if (sessionLoadStarted.current) {
			console.log('[App] Session load already started, skipping');
			return;
		}
		sessionLoadStarted.current = true;
		console.log('[App] Starting loadSessionsAndGroups');

		const loadSessionsAndGroups = async () => {
			try {
				console.log('[App] About to call sessions.getAll()');
				const savedSessions = await window.maestro.sessions.getAll();
				console.log('[App] Got sessions:', savedSessions?.length ?? 0);
				const savedGroups = await window.maestro.groups.getAll();

				// Handle sessions
				if (savedSessions && savedSessions.length > 0) {
					const restoredSessions = await Promise.all(savedSessions.map((s) => restoreSession(s)));

					// Restore last active session, or default to first session
					if (
						restoredSessions.length > 0 &&
						!restoredSessions.find((s) => s.id === activeSessionId)
					) {
						try {
							const lastSessionId = (await window.maestro.settings.get('lastActiveSessionId')) as
								| string
								| undefined;
							const lastTabId = (await window.maestro.settings.get('lastActiveTabId')) as
								| string
								| undefined;

							const lastSession = lastSessionId
								? restoredSessions.find((s) => s.id === lastSessionId)
								: undefined;

							if (lastSession) {
								setActiveSessionId(lastSession.id);
								// Also restore the active tab within the session
								if (lastTabId && lastSession.aiTabs?.some((t) => t.id === lastTabId)) {
									const updatedSessions = restoredSessions.map((s) =>
										s.id === lastSession.id ? { ...s, activeTabId: lastTabId } : s
									);
									setSessions(updatedSessions);
								} else {
									setSessions(restoredSessions);
								}
							} else {
								// No saved session found or it no longer exists — default to first
								setActiveSessionId(restoredSessions[0].id);
								setSessions(restoredSessions);
							}
						} catch {
							// Settings read failed — default to first session
							setActiveSessionId(restoredSessions[0].id);
							setSessions(restoredSessions);
						}
					} else {
						setSessions(restoredSessions);
					}

					// Sync tab names and starred status to the Claude session origins store.
					// This backfills data for tabs modified before agentSessionId was set
					// (handleRenameTab/handleTabStar only persist if agentSessionId is non-null).
					// Fire-and-forget — does not block startup or affect UI.
					// Same pattern as TabSwitcherModal lines 234-249.
					(async () => {
						try {
							for (const session of restoredSessions) {
								const agentId = session.toolType || 'claude-code';
								for (const tab of session.aiTabs || []) {
									if (!tab.agentSessionId) continue;
									if (tab.name) {
										if (agentId === 'claude-code') {
											window.maestro.claude
												.updateSessionName(session.projectRoot, tab.agentSessionId, tab.name)
												.catch(() => {});
										} else {
											window.maestro.agentSessions
												.setSessionName(agentId, session.projectRoot, tab.agentSessionId, tab.name)
												.catch(() => {});
										}
									}
									if (tab.starred) {
										if (agentId === 'claude-code') {
											window.maestro.claude
												.updateSessionStarred(session.projectRoot, tab.agentSessionId, true)
												.catch(() => {});
										} else {
											window.maestro.agentSessions
												.setSessionStarred(agentId, session.projectRoot, tab.agentSessionId, true)
												.catch(() => {});
										}
									}
								}
							}
						} catch (err) {
							console.warn('[App] Failed to sync tab metadata to origins store:', err);
						}
					})();

					// For remote (SSH) sessions, fetch git info in background to avoid blocking
					// startup on SSH connection timeouts. This runs after UI is shown.
					for (const session of restoredSessions) {
						const sshRemoteId = session.sshRemoteId || session.sessionSshRemoteConfig?.remoteId;
						if (sshRemoteId) {
							// Use workingDirOverride if configured (matches onSshRemote behavior at line 3537)
							const effectiveCwd =
								session.sessionSshRemoteConfig?.workingDirOverride || session.cwd;
							// Fire and forget - don't await, let it update sessions when done
							fetchGitInfoInBackground(session.id, effectiveCwd, sshRemoteId);
						}
					}
				} else {
					setSessions([]);
				}

				// Handle groups
				if (savedGroups && savedGroups.length > 0) {
					setGroups(savedGroups);
				} else {
					setGroups([]);
				}

				// Load group chats
				try {
					const savedGroupChats = await window.maestro.groupChat.list();
					useGroupChatStore.getState().setGroupChats(savedGroupChats || []);
				} catch (gcError) {
					console.error('Failed to load group chats:', gcError);
					useGroupChatStore.getState().setGroupChats([]);
				}
			} catch (e) {
				console.error('Failed to load sessions/groups:', e);
				setSessions([]);
				setGroups([]);
			} finally {
				// Mark initial load as complete to enable persistence
				initialLoadComplete.current = true;

				// Mark sessions as loaded for splash screen coordination
				useSessionStore.getState().setSessionsLoaded(true);

				// When no sessions exist, we show EmptyStateView which lets users
				// choose between "New Agent" or "Wizard" - no auto-opening wizard
			}
		};
		loadSessionsAndGroups();
	}, []);

	// Save last active session on window close/reload
	useEffect(() => {
		const handleBeforeUnload = () => {
			if (activeSession?.id) {
				window.maestro.settings.set('lastActiveSessionId', activeSession.id);
			}
			const activeTab = activeSession?.aiTabs.find((t) => t.id === activeSession?.activeTabId);
			if (activeTab?.id) {
				window.maestro.settings.set('lastActiveTabId', activeTab.id);
			}
		};

		window.addEventListener('beforeunload', handleBeforeUnload);
		return () => window.removeEventListener('beforeunload', handleBeforeUnload);
	}, [activeSession?.id, activeSession?.activeTabId, activeSession?.aiTabs]);

	// Also save when window loses focus (user switches apps/tabs)
	useEffect(() => {
		const handleLastSessionVisibilityChange = () => {
			if (document.visibilityState === 'hidden') {
				if (activeSession?.id) {
					window.maestro.settings.set('lastActiveSessionId', activeSession.id);
				}
				const activeTab = activeSession?.aiTabs.find((t) => t.id === activeSession?.activeTabId);
				if (activeTab?.id) {
					window.maestro.settings.set('lastActiveTabId', activeTab.id);
				}
			}
		};

		document.addEventListener('visibilitychange', handleLastSessionVisibilityChange);
		return () =>
			document.removeEventListener('visibilitychange', handleLastSessionVisibilityChange);
	}, [activeSession?.id, activeSession?.activeTabId, activeSession?.aiTabs]);

	// Expose debug helpers to window for console access
	// No dependency array - always keep functions fresh
	(window as any).__maestroDebug = {
		openDebugWizard: () => setDebugWizardModalOpen(true),
		openCommandK: () => setQuickActionOpen(true),
		openWizard: () => openWizardModal(),
		openSettings: () => setSettingsModalOpen(true),
	};

	// Note: Standing ovation and keyboard mastery startup checks are now in useModalHandlers

	// IPC process event listeners are now in useAgentListeners hook (called after useAgentSessionManagement)

	// Group chat event listeners and execution queue are now in useGroupChatHandlers hook
	const logsEndRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const terminalOutputRef = useRef<HTMLDivElement>(null);
	const sidebarContainerRef = useRef<HTMLDivElement>(null);
	const fileTreeContainerRef = useRef<HTMLDivElement>(null);
	const fileTreeFilterInputRef = useRef<HTMLInputElement>(null);
	const fileTreeKeyboardNavRef = useRef(false); // Shared between useInputHandlers and useFileExplorerEffects
	const rightPanelRef = useRef<RightPanelHandle>(null);
	const mainPanelRef = useRef<MainPanelHandle>(null);

	// Refs for accessing latest values in event handlers
	const customAICommandsRef = useRef(customAICommands);
	const speckitCommandsRef = useRef(speckitCommands);
	const openspecCommandsRef = useRef(openspecCommands);
	const fileTabAutoRefreshEnabledRef = useRef(fileTabAutoRefreshEnabled);
	customAICommandsRef.current = customAICommands;
	speckitCommandsRef.current = speckitCommands;
	openspecCommandsRef.current = openspecCommands;
	fileTabAutoRefreshEnabledRef.current = fileTabAutoRefreshEnabled;

	// Note: spawnBackgroundSynopsisRef and spawnAgentWithPromptRef are now provided by useAgentExecution hook
	// Note: addHistoryEntryRef is now provided by useAgentSessionManagement hook
	// Ref for processQueuedMessage - allows batch exit handler to process queued messages
	const processQueuedItemRef = useRef<
		((sessionId: string, item: QueuedItem) => Promise<void>) | null
	>(null);
	// Ref for handleResumeSession - bridges ordering gap between useModalHandlers and useAgentSessionManagement
	const handleResumeSessionRef = useRef<((agentSessionId: string) => void) | null>(null);

	// Note: thinkingChunkBufferRef and thinkingChunkRafIdRef moved into useAgentListeners hook
	// Note: pauseBatchOnErrorRef and getBatchStateRef moved into useBatchHandlers hook

	// Expose notifyToast to window for debugging/testing
	useEffect(() => {
		(window as any).__maestroDebug = {
			addToast: (
				type: 'success' | 'info' | 'warning' | 'error',
				title: string,
				message: string
			) => {
				notifyToast({ type, title, message });
			},
			testToast: () => {
				notifyToast({
					type: 'success',
					title: 'Test Notification',
					message: 'This is a test toast notification from the console!',
					group: 'Debug',
					project: 'Test Project',
				});
			},
		};
		return () => {
			delete (window as any).__maestroDebug;
		};
	}, []);

	// Keyboard navigation state
	// Note: selectedSidebarIndex/setSelectedSidebarIndex are destructured from useUIStore() above
	// Note: activeTab is memoized later at line ~3795 - use that for all tab operations

	// Slash command discovery now in useWizardHandlers hook

	// --- SESSION RESTORATION (extracted hook, Phase 2E) ---
	const { initialLoadComplete } = useSessionRestoration();

	// --- TAB HANDLERS (extracted hook) ---
	const {
		activeTab,
		unifiedTabs,
		activeFileTab,
		isResumingSession,
		fileTabBackHistory,
		fileTabForwardHistory,
		fileTabCanGoBack,
		fileTabCanGoForward,
		activeFileTabNavIndex,
		performTabClose,
		handleNewAgentSession,
		handleTabSelect,
		handleTabClose,
		handleNewTab,
		handleTabReorder,
		handleUnifiedTabReorder,
		handleCloseAllTabs,
		handleCloseOtherTabs,
		handleCloseTabsLeft,
		handleCloseTabsRight,
		handleCloseCurrentTab,
		handleRequestTabRename,
		handleUpdateTabByClaudeSessionId,
		handleTabStar,
		handleTabLock,
		handleTabMarkUnread,
		handleToggleTabReadOnlyMode,
		handleToggleTabSaveToHistory,
		handleToggleTabShowThinking,
		handleOpenFileTab,
		handleSelectFileTab,
		handleCloseFileTab,
		handleFileTabEditModeChange,
		handleFileTabEditContentChange,
		handleFileTabScrollPositionChange,
		handleFileTabSearchQueryChange,
		handleReloadFileTab,
		handleFileTabNavigateBack,
		handleFileTabNavigateForward,
		handleFileTabNavigateToIndex,
		handleClearFilePreviewHistory,
		handleScrollPositionChange,
		handleAtBottomChange,
		handleDeleteLog,
	} = useTabHandlers();

	// --- GROUP CHAT HANDLERS (extracted from App.tsx Phase 2B) ---
	const {
		groupChatInputRef,
		groupChatMessagesRef,
		handleClearGroupChatError,
		groupChatRecoveryActions,
		handleOpenGroupChat,
		handleCloseGroupChat,
		handleCreateGroupChat,
		handleUpdateGroupChat,
		handleArchiveGroupChat,
		deleteGroupChatWithConfirmation,
		handleProcessMonitorNavigateToGroupChat,
		handleOpenModeratorSession,
		handleJumpToGroupChatMessage,
		handleGroupChatRightTabChange,
		handleSendGroupChatMessage,
		handleGroupChatDraftChange,
		handleRemoveGroupChatQueueItem,
		handleReorderGroupChatQueueItems,
		handleNewGroupChat,
		handleEditGroupChat,
		handleOpenRenameGroupChatModal,
		handleOpenDeleteGroupChatModal,
		handleCloseNewGroupChatModal,
		handleCloseDeleteGroupChatModal,
		handleConfirmDeleteGroupChat,
		handleCloseRenameGroupChatModal,
		handleRenameGroupChatFromModal,
		handleCloseEditGroupChatModal,
		handleCloseGroupChatInfo,
	} = useGroupChatHandlers({
		groupChatShowThinking,
		setGroupChatThinkingContent,
	});

	// --- MODAL HANDLERS (open/close, error recovery, lightbox, celebrations) ---
	const {
		errorSession,
		effectiveAgentError,
		recoveryActions,
		handleCloseGitDiff,
		handleCloseGitLog,
		handleCloseSettings,
		handleCloseDebugPackage,
		handleCloseShortcutsHelp,
		handleCloseAboutModal,
		handleCloseUpdateCheckModal,
		handleCloseProcessMonitor,
		handleCloseLogViewer,
		handleCloseConfirmModal,
		handleCloseDeleteAgentModal,
		handleCloseNewInstanceModal,
		handleCloseEditAgentModal,
		handleCloseRenameSessionModal,
		handleCloseRenameTabModal,
		handleConfirmQuit,
		handleCancelQuit,
		onKeyboardMasteryLevelUp,
		handleKeyboardMasteryCelebrationClose,
		handleStandingOvationClose,
		handleFirstRunCelebrationClose,
		handleOpenLeaderboardRegistration,
		handleOpenLeaderboardRegistrationFromAbout,
		handleCloseLeaderboardRegistration,
		handleSaveLeaderboardRegistration,
		handleLeaderboardOptOut,
		handleCloseAgentErrorModal,
		handleShowAgentErrorModal,
		handleClearAgentError,
		handleOpenQueueBrowser,
		handleOpenTabSearch,
		handleOpenPromptComposer,
		handleOpenFuzzySearch,
		handleOpenCreatePR,
		handleOpenAboutModal,
		handleOpenBatchRunner,
		handleOpenMarketplace,
		handleEditAgent,
		handleOpenCreatePRSession,
		handleStartTour,
		handleSetLightboxImage,
		handleCloseLightbox,
		handleNavigateLightbox,
		handleDeleteLightboxImage,
		handleCloseAutoRunSetup,
		handleCloseBatchRunner,
		handleCloseTabSwitcher,
		handleCloseFileSearch,
		handleClosePromptComposer,
		handleCloseCreatePRModal,
		handleCloseSendToAgent,
		handleCloseQueueBrowser,
		handleCloseRenameGroupModal,
		handleQuickActionsRenameTab,
		handleQuickActionsOpenTabSwitcher,
		handleQuickActionsStartTour,
		handleQuickActionsEditAgent,
		handleQuickActionsOpenMergeSession,
		handleQuickActionsOpenSendToAgent,
		handleQuickActionsOpenCreatePR,
		handleLogViewerShortcutUsed,
		handleViewGitDiff,
		handleDirectorNotesResumeSession,
	} = useModalHandlers(inputRef, terminalOutputRef, handleResumeSessionRef);

	const {
		handleOpenWorktreeConfig,
		handleQuickCreateWorktree,
		handleOpenWorktreeConfigSession,
		handleDeleteWorktreeSession,
		handleToggleWorktreeExpanded,
		handleCloseWorktreeConfigModal,
		handleSaveWorktreeConfig,
		handleDisableWorktreeConfig,
		handleCreateWorktreeFromConfig,
		handleCloseCreateWorktreeModal,
		handleCreateWorktree,
		handleCloseDeleteWorktreeModal,
		handleConfirmDeleteWorktree,
		handleConfirmAndDeleteWorktreeOnDisk,
	} = useWorktreeHandlers();

	// --- APP HANDLERS (drag, file, folder operations) ---
	const {
		handleImageDragEnter,
		handleImageDragLeave,
		handleImageDragOver,
		isDraggingImage,
		setIsDraggingImage,
		dragCounterRef,
		handleFileClick,
		updateSessionWorkingDirectory,
		toggleFolder,
		expandAllFolders,
		collapseAllFolders,
	} = useAppHandlers({
		activeSession,
		activeSessionId,
		setSessions,
		setActiveFocus,
		setConfirmModalMessage,
		setConfirmModalOnConfirm,
		setConfirmModalOpen,
		onOpenFileTab: handleOpenFileTab,
	});

	// Theme system sync - automatically switch theme based on system dark/light mode
	useThemeSync({
		themeMode: themeMode || 'manual',
		lightThemeId: lightThemeId || 'github-light',
		darkThemeId: darkThemeId || 'dracula',
		setActiveThemeId,
	});

	// Use custom colors when custom theme is selected, otherwise use the standard theme
	const theme = useMemo(() => {
		if (activeThemeId === 'custom') {
			return {
				...THEMES.custom,
				colors: customThemeColors,
			};
		}
		return THEMES[activeThemeId];
	}, [activeThemeId, customThemeColors]);

	// Ref for theme (for use in memoized callbacks that need current theme without re-creating)
	const themeRef = useRef(theme);
	themeRef.current = theme;

	// Memoized cwd for git viewers (prevents re-renders from inline computation)
	// Prefer gitRoot (actual repo root) over cwd (working directory) for subdirectory git repos
	const gitViewerCwd = useMemo(
		() =>
			activeSession
				? activeSession.gitRoot ||
					(activeSession.inputMode === 'terminal'
						? activeSession.shellCwd || activeSession.cwd
						: activeSession.cwd)
				: '',

		[activeSession?.gitRoot, activeSession?.inputMode, activeSession?.shellCwd, activeSession?.cwd]
	);

	// Memoized sshRemoteId for git log viewer (routes git commands through SSH for remote sessions)
	const gitLogSshRemoteId = useMemo(
		() =>
			activeSession
				? activeSession.sshRemoteId || activeSession.sessionSshRemoteConfig?.remoteId || undefined
				: undefined,
		[activeSession?.sshRemoteId, activeSession?.sessionSshRemoteConfig?.remoteId]
	);

	// PERF: Memoize sessions for NewInstanceModal validation (only recompute when modal is open)
	// This prevents re-renders of the modal's validation logic on every session state change
	const sessionsForValidation = useMemo(
		() => (newInstanceModalOpen ? sessions : []),
		[newInstanceModalOpen, sessions]
	);

	// PERF: Memoize hasNoAgents check for SettingsModal (only depends on session count)
	const hasNoAgents = useMemo(() => sessions.length === 0, [sessions.length]);

	// Remote integration hook - handles web interface communication
	useRemoteIntegration({
		activeSessionId,
		isLiveMode,
		sessionsRef,
		activeSessionIdRef,
		setSessions,
		setActiveSessionId,
		defaultSaveToHistory,
		defaultShowThinking,
	});

	// Web broadcasting hook - handles external history change notifications
	useWebBroadcasting({
		rightPanelRef,
	});

	// CLI activity monitoring hook - tracks CLI playbook runs and updates session states
	useCliActivityMonitoring({
		setSessions,
	});

	// Note: Quit confirmation effect moved into useBatchHandlers hook

	// Theme styles hook - manages CSS variables and scrollbar fade animations
	useThemeStyles({
		themeColors: theme.colors,
	});

	// Get capabilities for the active session's agent type
	const { hasCapability: hasActiveSessionCapability } = useAgentCapabilities(
		activeSession?.toolType
	);

	// Merge & Transfer handlers (Phase 2.5)
	const {
		mergeState,
		mergeProgress,
		mergeStartTime,
		mergeSourceName,
		mergeTargetName,
		cancelMergeTab,
		transferState,
		transferProgress,
		transferSourceAgent,
		transferTargetAgent,
		handleCloseMergeSession,
		handleMerge,
		handleCancelTransfer,
		handleCompleteTransfer,
		handleSendToAgent,
		handleMergeWith,
		handleOpenSendToAgentModal,
	} = useMergeTransferHandlers({
		sessionsRef,
		activeSessionIdRef,
		setActiveSessionId,
	});

	// Summarize & Continue hook for context compaction (non-blocking, per-tab)
	const {
		summarizeState,
		progress: summarizeProgress,
		result: summarizeResult,
		error: _summarizeError,
		startTime,
		cancelTab,
		canSummarize,
		handleSummarizeAndContinue,
	} = useSummarizeAndContinue(activeSession ?? null);

	// Combine custom AI commands with spec-kit and openspec commands for input processing (slash command execution)
	// This ensures speckit and openspec commands are processed the same way as custom commands
	const allCustomCommands = useMemo((): CustomAICommand[] => {
		// Convert speckit commands to CustomAICommand format
		const speckitAsCustom: CustomAICommand[] = speckitCommands.map((cmd) => ({
			id: `speckit-${cmd.id}`,
			command: cmd.command,
			description: cmd.description,
			prompt: cmd.prompt,
			isBuiltIn: true, // Speckit commands are built-in (bundled)
		}));
		// Convert openspec commands to CustomAICommand format
		const openspecAsCustom: CustomAICommand[] = openspecCommands.map((cmd) => ({
			id: `openspec-${cmd.id}`,
			command: cmd.command,
			description: cmd.description,
			prompt: cmd.prompt,
			isBuiltIn: true, // OpenSpec commands are built-in (bundled)
		}));
		return [...customAICommands, ...speckitAsCustom, ...openspecAsCustom];
	}, [customAICommands, speckitCommands, openspecCommands]);

	// Combine built-in slash commands with custom AI commands, spec-kit commands, openspec commands, AND agent-specific commands for autocomplete
	const allSlashCommands = useMemo(() => {
		const customCommandsAsSlash = customAICommands.map((cmd) => ({
			command: cmd.command,
			description: cmd.description,
			aiOnly: true, // Custom AI commands are only available in AI mode
			prompt: cmd.prompt, // Include prompt for execution
		}));
		// Spec Kit commands (bundled from github/spec-kit)
		const speckitCommandsAsSlash = speckitCommands.map((cmd) => ({
			command: cmd.command,
			description: cmd.description,
			aiOnly: true, // Spec-kit commands are only available in AI mode
			prompt: cmd.prompt, // Include prompt for execution
			isSpeckit: true, // Mark as spec-kit command for special handling
		}));
		// OpenSpec commands (bundled from Fission-AI/OpenSpec)
		const openspecCommandsAsSlash = openspecCommands.map((cmd) => ({
			command: cmd.command,
			description: cmd.description,
			aiOnly: true, // OpenSpec commands are only available in AI mode
			prompt: cmd.prompt, // Include prompt for execution
			isOpenspec: true, // Mark as openspec command for special handling
		}));
		// Only include agent-specific commands if the agent supports slash commands
		// This allows built-in and custom commands to be shown for all agents (Codex, OpenCode, etc.)
		const agentCommands = hasActiveSessionCapability('supportsSlashCommands')
			? (activeSession?.agentCommands || []).map((cmd) => ({
					command: cmd.command,
					description: cmd.description,
					aiOnly: true, // Agent commands are only available in AI mode
				}))
			: [];
		// Filter built-in slash commands by agent type (if specified)
		const currentAgentType = activeSession?.toolType;
		const filteredSlashCommands = slashCommands.filter(
			(cmd) => !cmd.agentTypes || (currentAgentType && cmd.agentTypes.includes(currentAgentType))
		);
		return [
			...filteredSlashCommands,
			...customCommandsAsSlash,
			...speckitCommandsAsSlash,
			...openspecCommandsAsSlash,
			...agentCommands,
		];
	}, [
		customAICommands,
		speckitCommands,
		openspecCommands,
		activeSession?.agentCommands,
		activeSession?.toolType,
		hasActiveSessionCapability,
	]);

	const canAttachImages = useMemo(() => {
		if (!activeSession || activeSession.inputMode !== 'ai') return false;
		return isResumingSession
			? hasActiveSessionCapability('supportsImageInputOnResume')
			: hasActiveSessionCapability('supportsImageInput');
	}, [activeSession, isResumingSession, hasActiveSessionCapability]);
	// Session navigation handlers (extracted to useSessionNavigation hook)
	const { handleNavBack, handleNavForward } = useSessionNavigation(sessions, {
		navigateBack,
		navigateForward,
		setActiveSessionId, // Uses the wrapper that also dismisses active group chat
		setSessions,
		cyclePositionRef,
		onNavigateToGroupChat: handleOpenGroupChat,
	});

	// PERF: Memoize thinkingItems at App level to avoid passing full sessions array to children.
	// This prevents InputArea from re-rendering on unrelated session updates (e.g., terminal output).
	// Flat list of (session, tab) pairs — one entry per busy tab across all sessions.
	// This allows the ThinkingStatusPill to show all active work, even when multiple tabs
	// within the same agent are busy in parallel.
	const thinkingItems: ThinkingItem[] = useMemo(() => {
		const items: ThinkingItem[] = [];
		for (const session of sessions) {
			if (session.state !== 'busy' || session.busySource !== 'ai') continue;
			const busyTabs = session.aiTabs?.filter((t) => t.state === 'busy');
			if (busyTabs && busyTabs.length > 0) {
				for (const tab of busyTabs) {
					items.push({ session, tab });
				}
			} else {
				// Legacy: session is busy but no individual tab-level tracking
				items.push({ session, tab: null });
			}
		}
		return items;
	}, [sessions]);

	// addLogToTab/addLogToActiveTab now used directly via store in useWizardHandlers

	// --- AGENT EXECUTION ---
	// Extracted hook for agent spawning and execution operations
	const {
		spawnAgentForSession,
		spawnAgentWithPrompt: _spawnAgentWithPrompt,
		spawnBackgroundSynopsis,
		spawnBackgroundSynopsisRef,
		spawnAgentWithPromptRef: _spawnAgentWithPromptRef,
		showFlashNotification: _showFlashNotification,
		showSuccessFlash,
		cancelPendingSynopsis,
	} = useAgentExecution({
		activeSession,
		sessionsRef,
		setSessions,
		processQueuedItemRef,
		setFlashNotification,
		setSuccessFlashNotification,
	});

	// --- AGENT SESSION MANAGEMENT ---
	// Extracted hook for agent-specific session operations (history, session clear, resume)
	const { addHistoryEntry, addHistoryEntryRef, handleJumpToAgentSession, handleResumeSession } =
		useAgentSessionManagement({
			activeSession,
			setSessions,
			setActiveAgentSessionId,
			setAgentSessionsOpen,
			rightPanelRef,
			defaultSaveToHistory,
			defaultShowThinking,
		});

	// handleDirectorNotesResumeSession — extracted to useModalHandlers (Tier 3C)
	// Bridge: keep handleResumeSessionRef in sync for useModalHandlers
	handleResumeSessionRef.current = handleResumeSession;

	// --- BATCH HANDLERS (Auto Run processing, quit confirmation, error handling) ---
	const {
		startBatchRun,
		getBatchState,
		handleStopBatchRun,
		handleKillBatchRun,
		handleSkipCurrentDocument,
		handleResumeAfterError,
		handleAbortBatchOnError,
		activeBatchSessionIds,
		currentSessionBatchState,
		activeBatchRunState,
		pauseBatchOnErrorRef,
		getBatchStateRef,
		handleSyncAutoRunStats,
		capacityCheckData,
		onCapacityCancel,
		onCapacityRunAnyway,
	} = useBatchHandlers({
		spawnAgentForSession,
		rightPanelRef,
		processQueuedItemRef,
		handleClearAgentError,
	});

	// --- AGENT IPC LISTENERS ---
	// Extracted hook for all window.maestro.process.onXxx listeners
	// (onData, onExit, onSessionId, onSlashCommands, onStderr, onCommandExit,
	// onUsage, onAgentError, onThinkingChunk, onSshRemote, onToolExecution)
	useAgentListeners({
		batchedUpdater,
		addHistoryEntryRef,
		spawnBackgroundSynopsisRef,
		getBatchStateRef,
		pauseBatchOnErrorRef,
		rightPanelRef,
		processQueuedItemRef,
		contextWarningYellowThreshold: contextManagementSettings.contextWarningYellowThreshold,
	});

	const handleRemoveQueuedItem = useCallback((itemId: string) => {
		setSessions((prev) =>
			prev.map((s) => {
				if (s.id !== activeSessionIdRef.current) return s;
				return {
					...s,
					executionQueue: s.executionQueue.filter((item) => item.id !== itemId),
				};
			})
		);
	}, []);

	// toggleBookmark — provided by useSessionCrud hook

	const handleFocusFileInGraph = useFileExplorerStore.getState().focusFileInGraph;
	const handleOpenLastDocumentGraph = useFileExplorerStore.getState().openLastDocumentGraph;

	// Tab export handlers (copy context, export HTML, publish gist) — extracted to useTabExportHandlers
	const { handleCopyContext, handleExportHtml, handlePublishTabGist } = useTabExportHandlers({
		sessionsRef,
		activeSessionIdRef,
		themeRef,
		setGistPublishModalOpen,
	});

	// Memoized handler for clearing agent error (wraps handleClearAgentError with session/tab context)
	const handleClearAgentErrorForMainPanel = useCallback(() => {
		const currentSession = sessionsRef.current.find((s) => s.id === activeSessionIdRef.current);
		if (!currentSession) return;
		const activeTab = currentSession.aiTabs.find((t) => t.id === currentSession.activeTabId);
		if (!activeTab?.agentError) return;
		handleClearAgentError(currentSession.id, activeTab.id);
	}, [handleClearAgentError]);

	// Note: spawnBackgroundSynopsisRef and spawnAgentWithPromptRef are now updated in useAgentExecution hook

	// Inline wizard context — hook needs the full context, App.tsx retains pass-through refs
	const inlineWizardContext = useInlineWizardContext();
	const {
		clearError: clearInlineWizardError,
		retryLastMessage: retryInlineWizardMessage,
		generateDocuments: generateInlineWizardDocuments,
		endWizard: endInlineWizard,
	} = inlineWizardContext;

	// --- WIZARD HANDLERS (extracted hook) ---
	// Refs for circular deps — set after useInputHandlers/useAutoRunHandlers
	const handleAutoRunRefreshRef = useRef<(() => void) | null>(null);
	const setInputValueRef = useRef<((value: string) => void) | null>(null);

	const {
		sendWizardMessageWithThinking,
		handleHistoryCommand,
		handleSkillsCommand,
		handleWizardCommand,
		handleLaunchWizardTab,
		isWizardActiveForCurrentTab,
		handleWizardComplete,
		handleWizardLetsGo,
		handleToggleWizardShowThinking,
		handleWizardLaunchSession,
		handleWizardResume,
		handleWizardStartFresh,
		handleWizardResumeClose,
	} = useWizardHandlers({
		inlineWizardContext,
		wizardContext: {
			state: wizardState,
			completeWizard,
			clearResumeState,
			openWizard: openWizardModal,
			restoreState: restoreWizardState,
		},
		spawnBackgroundSynopsis,
		addHistoryEntry,
		startBatchRun,
		handleAutoRunRefreshRef,
		setInputValueRef,
		inputRef,
	});

	// Interactive capacity check state (declared early so useInputHandlers can reference it)
	const [interactiveCapacityData, setInteractiveCapacityData] =
		useState<CapacityCheckModalData | null>(null);
	const interactiveCapacityResumeRef = useRef<(() => void) | null>(null);

	// --- INPUT HANDLERS (state, completion, processing, keyboard, paste/drop) ---
	const {
		inputValue,
		deferredInputValue,
		setInputValue,
		stagedImages,
		setStagedImages,
		processInput,
		handleInputKeyDown,
		handleMainPanelInputBlur,
		handleReplayMessage,
		handlePaste,
		handleDrop,
		tabCompletionSuggestions,
		atMentionSuggestions,
	} = useInputHandlers({
		inputRef,
		terminalOutputRef,
		fileTreeKeyboardNavRef,
		dragCounterRef,
		setIsDraggingImage,
		getBatchState,
		activeBatchRunState,
		processQueuedItemRef,
		flushBatchedUpdates: batchedUpdater.flushNow,
		handleHistoryCommand,
		handleWizardCommand,
		sendWizardMessageWithThinking,
		isWizardActiveForCurrentTab,
		handleSkillsCommand,
		allSlashCommands,
		allCustomCommands,
		sessionsRef,
		activeSessionIdRef,
		setInteractiveCapacityCheck: setInteractiveCapacityData,
		interactiveCapacityResumeRef,
	});

	// This is used by context transfer to automatically send the transferred context to the agent
	useEffect(() => {
		if (!activeSession) return;

		const activeTab = getActiveTab(activeSession);
		if (!activeTab?.autoSendOnActivate) return;

		// Capture intended targets so we can verify they haven't changed after the delay
		const targetSessionId = activeSession.id;
		const targetTabId = activeTab.id;

		// Clear the flag first to prevent multiple sends
		setSessions((prev) =>
			prev.map((s) => {
				if (s.id !== targetSessionId) return s;
				return {
					...s,
					aiTabs: s.aiTabs.map((tab) =>
						tab.id === targetTabId ? { ...tab, autoSendOnActivate: false } : tab
					),
				};
			})
		);

		// Trigger the send after a short delay to ensure state is settled
		// The inputValue and pendingMergedContext are already set on the tab
		const timeoutId = setTimeout(() => {
			// Verify the active session/tab still match the originally intended targets
			const currentSessions = useSessionStore.getState().sessions;
			const currentSession = currentSessions.find((s) => s.id === targetSessionId);
			if (!currentSession) return;
			const currentTab = getActiveTab(currentSession);
			if (currentSession.id !== activeSessionIdRef.current || currentTab?.id !== targetTabId)
				return;

			processInput();
		}, 100);

		return () => clearTimeout(timeoutId);
	}, [activeSession?.id, activeSession?.activeTabId]);

	// Initialize activity tracker for per-session time tracking
	useActivityTracker(activeSessionId, setSessions);

	// Initialize global hands-on time tracker (persists to settings)
	// Tracks total time user spends actively using Maestro (5-minute idle timeout)
	useHandsOnTimeTracker(addTotalActiveTimeMs);

	// Auto Run achievement tracking (progress intervals, peak usage stats)
	useAutoRunAchievements({ activeBatchSessionIds });

	// Safety valve: Ctrl+Shift+Alt+Q force-quits even with active tasks
	useEffect(() => {
		const handleSafetyValve = (e: KeyboardEvent) => {
			if (e.ctrlKey && e.shiftKey && e.altKey && e.key.toLowerCase() === 'q') {
				e.preventDefault();
				e.stopPropagation();
				window.maestro.app.forceQuit();
			}
		};
		window.addEventListener('keydown', handleSafetyValve, true);
		return () => window.removeEventListener('keydown', handleSafetyValve, true);
	}, []);

	// Handler for switching to autorun tab - shows setup modal if no folder configured
	const handleSetActiveRightTab = useCallback(
		(tab: RightPanelTab) => {
			if (tab === 'autorun' && activeSession && !activeSession.autoRunFolderPath) {
				// No folder configured - show setup modal
				setAutoRunSetupModalOpen(true);
				// Still switch to the tab (it will show an empty state or the modal)
				setActiveRightTab(tab);
			} else {
				setActiveRightTab(tab);
			}
		},
		[activeSession]
	);

	// Auto Run handlers (extracted to useAutoRunHandlers hook)
	const {
		handleAutoRunFolderSelected,
		handleStartBatchRun,
		getDocumentTaskCount,
		handleAutoRunContentChange,
		handleAutoRunModeChange,
		handleAutoRunStateChange,
		handleAutoRunSelectDocument,
		handleAutoRunRefresh,
		handleAutoRunOpenSetup,
		handleAutoRunCreateDocument,
	} = useAutoRunHandlers(activeSession, {
		setSessions,
		setAutoRunDocumentList,
		setAutoRunDocumentTree,
		setAutoRunIsLoadingDocuments,
		setAutoRunSetupModalOpen,
		setBatchRunnerModalOpen,
		setActiveRightTab,
		setRightPanelOpen,
		setActiveFocus,
		setSuccessFlashNotification,
		autoRunDocumentList,
		startBatchRun,
	});

	// Wire up refs for useWizardHandlers (circular dep resolution)
	handleAutoRunRefreshRef.current = handleAutoRunRefresh;
	setInputValueRef.current = setInputValue;

	// Handler for marketplace import completion - refresh document list
	const handleMarketplaceImportComplete = useCallback(
		async (folderName: string) => {
			// Refresh the Auto Run document list to show newly imported documents
			if (activeSession?.autoRunFolderPath) {
				handleAutoRunRefresh();
			}
			notifyToast({
				type: 'success',
				title: 'Playbook Imported',
				message: `Successfully imported playbook to ${folderName}`,
			});
		},
		[activeSession?.autoRunFolderPath, handleAutoRunRefresh]
	);

	// File tree auto-refresh interval change handler (kept in App.tsx as it's not Auto Run specific)
	const handleAutoRefreshChange = useCallback(
		(interval: number) => {
			if (!activeSession) return;
			setSessions((prev) =>
				prev.map((s) =>
					s.id === activeSession.id ? { ...s, fileTreeAutoRefreshInterval: interval } : s
				)
			);
		},
		[activeSession]
	);

	// Handler for toast navigation - switches to session and optionally to a specific tab
	const handleToastSessionClick = useCallback(
		(sessionId: string, tabId?: string) => {
			// Switch to the session
			setActiveSessionId(sessionId);
			// Clear file preview and switch to AI tab (with specific tab if provided)
			// This ensures clicking a toast always shows the AI terminal, not a file preview
			setSessions((prev) =>
				prev.map((s) => {
					if (s.id !== sessionId) return s;
					// If a specific tab ID is provided, check if it exists
					if (tabId && !s.aiTabs?.some((t) => t.id === tabId)) {
						// Tab doesn't exist, just clear file preview
						return { ...s, activeFileTabId: null, inputMode: 'ai' };
					}
					return {
						...s,
						...(tabId && { activeTabId: tabId }),
						activeFileTabId: null,
						inputMode: 'ai',
					};
				})
			);
		},
		[setActiveSessionId]
	);

	// --- SESSION SORTING ---
	// Extracted hook for sorted and visible session lists (ignores leading emojis for alphabetization)
	const { sortedSessions, visibleSessions } = useSortedSessions({
		sessions,
		groups,
		bookmarksCollapsed,
	});

	// --- KEYBOARD NAVIGATION ---
	// Extracted hook for sidebar navigation, panel focus, and related keyboard handlers
	const {
		handleSidebarNavigation,
		handleTabNavigation,
		handleEnterToActivate,
		handleEscapeInMain,
	} = useKeyboardNavigation({
		sortedSessions,
		selectedSidebarIndex,
		setSelectedSidebarIndex,
		activeSessionId,
		setActiveSessionId,
		activeFocus,
		setActiveFocus,
		groups,
		setGroups,
		bookmarksCollapsed,
		setBookmarksCollapsed,
		inputRef,
		terminalOutputRef,
	});

	// --- MAIN KEYBOARD HANDLER ---
	// Extracted hook for main keyboard event listener (empty deps, uses ref pattern)
	const { keyboardHandlerRef, showSessionJumpNumbers } = useMainKeyboardHandler();

	// Persist sessions to electron-store using debounced persistence (reduces disk writes from 100+/sec to <1/sec during streaming)
	// The hook handles: debouncing, flush-on-unmount, flush-on-visibility-change, flush-on-beforeunload
	const { flushNow: flushSessionPersistence } = useDebouncedPersistence(
		sessions,
		initialLoadComplete
	);

	// Session lifecycle operations (rename, delete, star, unread, groups persistence, nav tracking)
	// — provided by useSessionLifecycle hook (Phase 2H)
	const {
		handleSaveEditAgent,
		handleRenameTab,
		performDeleteSession,
		showConfirmation,
		toggleTabStar,
		toggleTabUnread,
		toggleUnreadFilter,
	} = useSessionLifecycle({
		flushSessionPersistence,
		setRemovedWorktreePaths,
		pushNavigation,
	});

	// NOTE: Theme CSS variables and scrollbar fade animations are now handled by useThemeStyles hook
	// NOTE: Main keyboard handler is now provided by useMainKeyboardHandler hook
	// NOTE: Sync selectedSidebarIndex with activeSessionId is now handled by useKeyboardNavigation hook

	// NOTE: File tree scroll restore is now handled by useFileExplorerEffects hook (Phase 2.6)

	// Navigation history tracking — provided by useSessionLifecycle hook (Phase 2H)

	// Auto Run document loading (list, tree, task counts, file watching)
	useAutoRunDocumentLoader();

	// NOTE: Auto Run document loading and file watching are now handled by useAutoRunDocumentLoader hook

	// --- ACTIONS ---
	// cycleSession — provided by useCycleSession hook
	const { cycleSession } = useCycleSession({ sortedSessions, handleOpenGroupChat });

	// showConfirmation, performDeleteSession — provided by useSessionLifecycle hook (Phase 2H)
	// deleteSession, deleteWorktreeGroup — provided by useSessionCrud hook

	// addNewSession, createNewSession — provided by useSessionCrud hook

	// handleWizardLaunchSession now in useWizardHandlers hook

	// toggleInputMode — extracted to useInputMode hook (Tier 3A)
	const { toggleInputMode } = useInputMode({ setTabCompletionOpen, setSlashCommandOpen });

	// toggleUnreadFilter, toggleTabStar, toggleTabUnread — provided by useSessionLifecycle hook (Phase 2H)

	// toggleGlobalLive, restartWebServer — extracted to useLiveMode hook (Tier 3B)

	// --- REMOTE HANDLERS (remote command processing, SSH name mapping) ---
	const { handleQuickActionsToggleRemoteControl, sessionSshRemoteNames } = useRemoteHandlers({
		sessionsRef,
		customAICommandsRef,
		speckitCommandsRef,
		openspecCommandsRef,
		toggleGlobalLive,
		isLiveMode,
		sshRemoteConfigs,
	});

	// handleViewGitDiff — extracted to useModalHandlers (Tier 3C)

	// startRenamingSession, finishRenamingSession — provided by useSessionCrud hook

	// handleDragStart, handleDragOver — provided by useSessionCrud hook

	// Note: processInput has been extracted to useInputProcessing hook (see line ~2128)

	// Note: handleRemoteCommand effect extracted to useRemoteHandlers hook (Phase 2K)

	// Tour actions (right panel control from tour overlay) — extracted to useTourActions hook
	useTourActions();

	// Queue processing (execution, startup recovery) — extracted to useQueueProcessing hook
	const { processQueuedItem } = useQueueProcessing({
		conductorProfile,
		customAICommandsRef,
		speckitCommandsRef,
		openspecCommandsRef,
	});
	// Bridge: keep the original processQueuedItemRef in sync
	processQueuedItemRef.current = processQueuedItem;

	// handleInterrupt — provided by useInterruptHandler hook
	const { handleInterrupt } = useInterruptHandler({
		sessionsRef,
		cancelPendingSynopsis,
		processQueuedItem,
	});

	// --- FILE TREE MANAGEMENT ---
	// Extracted hook for file tree operations (refresh, git state, filtering)
	const { refreshFileTree, refreshGitFileState, filteredFileTree } = useFileTreeManagement({
		sessions,
		sessionsRef,
		setSessions,
		activeSessionId,
		activeSession,
		rightPanelRef,
		sshRemoteIgnorePatterns: settings.sshRemoteIgnorePatterns,
		sshRemoteHonorGitignore: settings.sshRemoteHonorGitignore,
		localIgnorePatterns: settings.localIgnorePatterns,
		localHonorGitignore: settings.localHonorGitignore,
	});

	// --- FILE EXPLORER EFFECTS ---
	// Extracted hook for file explorer side effects and keyboard navigation (Phase 2.6)
	const { stableFileTree, handleMainPanelFileClick } = useFileExplorerEffects({
		sessionsRef,
		activeSessionIdRef,
		fileTreeContainerRef,
		fileTreeKeyboardNavRef,
		filteredFileTree,
		tabCompletionOpen,
		toggleFolder,
		handleFileClick,
		handleOpenFileTab,
	});

	// --- GROUP MANAGEMENT ---
	// Extracted hook for group CRUD operations (toggle, rename, create, drag-drop)
	const {
		toggleGroup,
		startRenamingGroup,
		finishRenamingGroup,
		createNewGroup,
		handleDropOnGroup,
		handleDropOnUngrouped,
		modalState: groupModalState,
	} = useGroupManagement({
		groups,
		setGroups,
		setSessions,
		draggingSessionId,
		setDraggingSessionId,
		editingGroupId,
		setEditingGroupId,
	});

	// Destructure group modal state for use in JSX
	const { createGroupModalOpen, setCreateGroupModalOpen, createGroupForFolderId } = groupModalState;

	// Session CRUD operations (create, delete, rename, bookmark, drag-drop, group-move)
	const {
		addNewSession,
		createNewSession,
		deleteSession,
		deleteWorktreeGroup,
		startRenamingSession,
		finishRenamingSession,
		toggleBookmark,
		handleDragStart,
		handleDragOver,
		handleCreateGroupAndMove,
		handleGroupCreated,
	} = useSessionCrud({
		flushSessionPersistence,
		setRemovedWorktreePaths,
		showConfirmation,
		inputRef,
		setCreateGroupModalOpen,
	});

	// Group Modal Handlers (stable callbacks for AppGroupModals)
	const handleCloseCreateGroupModal = useCallback(() => {
		setCreateGroupModalOpen(false);
	}, [setCreateGroupModalOpen]);

	const handlePRCreated = useCallback(
		async (prDetails: PRDetails) => {
			const session = createPRSession || activeSession;
			notifyToast({
				type: 'success',
				title: 'Pull Request Created',
				message: prDetails.title,
				actionUrl: prDetails.url,
				actionLabel: prDetails.url,
			});
			// Add history entry with PR details
			if (session) {
				await window.maestro.history.add({
					id: generateId(),
					type: 'USER',
					timestamp: Date.now(),
					summary: `Created PR: ${prDetails.title}`,
					fullResponse: [
						`**Pull Request:** [${prDetails.title}](${prDetails.url})`,
						`**Branch:** ${prDetails.sourceBranch} → ${prDetails.targetBranch}`,
						prDetails.description ? `**Description:** ${prDetails.description}` : '',
					]
						.filter(Boolean)
						.join('\n\n'),
					projectPath: session.projectRoot || session.cwd,
					sessionId: session.id,
					sessionName: session.name,
				});
				rightPanelRef.current?.refreshHistoryPanel();
			}
			setCreatePRSession(null);
		},
		[createPRSession, activeSession]
	);

	const handleSaveBatchPrompt = useCallback(
		(prompt: string) => {
			if (!activeSession) return;
			// Save the custom prompt and modification timestamp to the session (persisted across restarts)
			setSessions((prev) =>
				prev.map((s) =>
					s.id === activeSession.id
						? {
								...s,
								batchRunnerPrompt: prompt,
								batchRunnerPromptModifiedAt: Date.now(),
							}
						: s
				)
			);
		},
		[activeSession]
	);
	const handleUtilityTabSelect = useCallback(
		(tabId: string) => {
			if (!activeSession) return;
			// Clear activeFileTabId when selecting an AI tab
			setSessions((prev) =>
				prev.map((s) =>
					s.id === activeSession.id ? { ...s, activeTabId: tabId, activeFileTabId: null } : s
				)
			);
		},
		[activeSession]
	);
	const handleUtilityFileTabSelect = useCallback(
		(tabId: string) => {
			if (!activeSession) return;
			// Set activeFileTabId, keep activeTabId as-is (for when returning to AI tabs)
			setSessions((prev) =>
				prev.map((s) => (s.id === activeSession.id ? { ...s, activeFileTabId: tabId } : s))
			);
		},
		[activeSession]
	);
	const handleNamedSessionSelect = useCallback(
		(agentSessionId: string, _projectPath: string, sessionName: string, starred?: boolean) => {
			// Open a closed named session as a new tab - use handleResumeSession to properly load messages
			handleResumeSession(agentSessionId, [], sessionName, starred);
			// Focus input so user can start interacting immediately
			setActiveFocus('main');
			setTimeout(() => inputRef.current?.focus(), 50);
		},
		[handleResumeSession, setActiveFocus]
	);
	const handleFileSearchSelect = useCallback(
		(file: FlatFileItem) => {
			// Preview the file directly (handleFileClick expects relative path)
			if (!file.isFolder) {
				handleFileClick({ name: file.name, type: 'file' }, file.fullPath);
			}
		},
		[handleFileClick]
	);
	// Prompt Composer modal handlers — extracted to usePromptComposerHandlers hook
	const {
		handlePromptComposerSubmit,
		handlePromptComposerSend,
		handlePromptToggleTabSaveToHistory,
		handlePromptToggleTabReadOnlyMode,
		handlePromptToggleTabShowThinking,
		handlePromptToggleEnterToSend,
	} = usePromptComposerHandlers({
		handleSendGroupChatMessage,
		processInput,
		setInputValue,
	});

	// Quick Actions modal handlers — extracted to useQuickActionsHandlers hook
	const {
		handleQuickActionsToggleReadOnlyMode,
		handleQuickActionsToggleTabShowThinking,
		handleQuickActionsRefreshGitFileState,
		handleQuickActionsDebugReleaseQueuedItem,
		handleQuickActionsToggleMarkdownEditMode,
		handleQuickActionsSummarizeAndContinue,
		handleQuickActionsAutoRunResetTasks,
	} = useQuickActionsHandlers({
		refreshGitFileState,
		mainPanelRef,
		rightPanelRef,
		handleSummarizeAndContinue,
		processQueuedItem,
	});

	// Queue browser handlers — extracted to useQueueHandlers hook
	const { handleRemoveQueueItem, handleSwitchQueueSession, handleReorderQueueItems } =
		useQueueHandlers();

	// Symphony contribution handler — extracted to useSymphonyContribution hook
	const { handleStartContribution } = useSymphonyContribution({
		startBatchRun,
		inputRef,
	});

	// --- MISSING HANDLERS (TODO: migrate to appropriate hooks) ---

	// Knowledge graph save handler
	const handleSaveToKnowledgeGraph = useCallback(async () => {
		if (!activeSession) {
			notifyToast({ type: 'error', title: 'No active session', message: '' });
			return;
		}

		const activeTab = activeSession.aiTabs.find((t) => t.id === activeSession.activeTabId);
		if (!activeTab) {
			notifyToast({ type: 'error', title: 'No active tab', message: '' });
			return;
		}

		const folderId = activeSession.projectFolderIds?.[0];
		const folder = folderId ? getFolderById(folderId) : undefined;

		// --- Build full conversation transcript ---
		const allLogs = activeTab.logs || [];
		const transcriptLines: string[] = [];
		let exchangeCount = 0;

		for (const log of allLogs) {
			// Map log source to a readable label
			let label: string;
			switch (log.source) {
				case 'user':
					label = 'USER';
					exchangeCount++;
					break;
				case 'ai':
				case 'stdout':
					label = 'AI';
					break;
				case 'system':
					label = 'SYSTEM';
					break;
				case 'tool':
					label = 'TOOL';
					break;
				case 'thinking':
					label = 'THINKING';
					break;
				case 'error':
				case 'stderr':
					label = 'ERROR';
					break;
				default:
					label = (log.source as string | undefined)?.toUpperCase() || 'UNKNOWN';
			}

			// Include all log entries with their full text
			if (log.text && log.text.trim()) {
				transcriptLines.push(`[${label}]\n${log.text.trim()}\n`);
			}
		}

		const fullTranscript = transcriptLines.join('\n');

		// --- Build structured Key Findings summary ---
		const aiLogs = allLogs.filter((l) => l.source === 'ai' || l.source === 'stdout');
		const userLogs = allLogs.filter((l) => l.source === 'user');

		// Topic: derived from first user message
		const firstUserMessage =
			userLogs.length > 0 ? userLogs[0].text.trim() : 'No user query recorded';
		const topic =
			firstUserMessage.length > 300 ? firstUserMessage.substring(0, 300) + '...' : firstUserMessage;

		// Resolution: derived from last AI response
		const lastAiMessage =
			aiLogs.length > 0 ? aiLogs[aiLogs.length - 1].text.trim() : 'No AI response recorded';
		const resolution =
			lastAiMessage.length > 1000 ? lastAiMessage.substring(0, 1000) + '...' : lastAiMessage;

		const summaryBlock = [
			`**Topic/Goal**: ${topic}`,
			'',
			`**Resolution**:`,
			resolution,
			'',
			`**Session Metadata**:`,
			`- Session: ${activeSession.name || activeTab.name || 'Unnamed'} (${activeSession.id})`,
			`- Tab: ${activeTab.name || activeTab.id}`,
			`- Agent: ${activeSession.toolType || 'claude-code'}`,
			`- Project: ${folder?.name || 'Unassigned'} (${activeSession.fullPath || activeSession.cwd || 'N/A'})`,
			`- Exchanges: ${exchangeCount} user messages, ${aiLogs.length} AI responses, ${allLogs.length} total entries`,
			`- Cost: ${activeTab.usageStats?.totalCostUsd != null ? `$${activeTab.usageStats.totalCostUsd.toFixed(4)}` : 'N/A'}`,
			`- Context Usage: ${activeSession.contextUsage != null ? `${activeSession.contextUsage.toFixed(1)}%` : 'N/A'}`,
		].join('\n');

		const entry = {
			sessionName: activeSession.name || activeTab.name || 'Unnamed Session',
			sessionId: activeSession.id,
			tabId: activeTab.id,
			agentType: activeSession.toolType || 'claude-code',
			projectPath: activeSession.fullPath || activeSession.cwd || '',
			projectName: folder?.name || 'Unassigned',
			summary: summaryBlock,
			detailedLearnings: fullTranscript,
			totalQueries: aiLogs.length,
			totalCost: activeTab.usageStats?.totalCostUsd,
			contextUsage: activeSession.contextUsage,
			exchangeCount,
			totalLogEntries: allLogs.length,
			detectedModel: activeTab.usageStats?.detectedModel,
			timestamp: Date.now(),
		};

		try {
			const filepath = await window.maestro.knowledgeGraph.save(entry);
			showSuccessFlash('Saved to Knowledge Graph');
			console.log('Knowledge graph entry saved to:', filepath);
		} catch (error) {
			console.error('Failed to save to knowledge graph:', error);
			notifyToast({ type: 'error', title: 'Failed to save to Knowledge Graph', message: '' });
		}
	}, [activeSession, getFolderById, showSuccessFlash]);

	// Prompt library handlers
	const handleSaveToPromptLibrary = useCallback(
		async (text: string, _images?: string[], logId?: string) => {
			if (!activeSession) return;

			// Toggle: if already saved, remove from library instead
			if (logId) {
				const currentSessions = sessionsRef.current;
				const currentSession = currentSessions.find((s) => s.id === activeSession.id);
				const currentTab = currentSession?.aiTabs.find((t) => t.id === currentSession?.activeTabId);
				const currentLog = currentTab?.logs.find((l) => l.id === logId);

				if (currentLog?.savedToLibrary && currentLog?.promptLibraryEntryId) {
					try {
						// Capture scroll position BEFORE async IPC call
						const scrollContainer = document.querySelector('[data-terminal-scroll-container]');
						const savedScrollTop = scrollContainer?.scrollTop ?? null;

						await window.maestro.promptLibrary.delete(currentLog.promptLibraryEntryId);

						setSessions((prev) =>
							prev.map((s) => {
								if (s.id !== activeSession.id) return s;
								return {
									...s,
									aiTabs: s.aiTabs.map((tab) =>
										tab.id === activeSession.activeTabId
											? {
													...tab,
													logs: tab.logs.map((l) =>
														l.id === logId
															? { ...l, savedToLibrary: false, promptLibraryEntryId: undefined }
															: l
													),
												}
											: tab
									),
								};
							})
						);

						if (savedScrollTop !== null) {
							requestAnimationFrame(() => {
								if (scrollContainer) {
									scrollContainer.scrollTop = savedScrollTop;
								}
							});
						}

						showSuccessFlash('Prompt removed from library.');
					} catch (err) {
						console.error('Failed to remove from prompt library:', err);
					}
					return; // Exit early — removal done
				}
			}

			// Generate title from first line or first N words
			const firstLine = text.split('\n')[0].trim();
			const title = firstLine.length > 50 ? firstLine.substring(0, 47) + '...' : firstLine;

			// Get project info
			const folderId = activeSession.projectFolderIds?.[0];
			const folder = folderId ? getFolderById(folderId) : undefined;
			const projectName = folder
				? folder.emoji
					? `${folder.emoji} ${folder.name}`
					: folder.name
				: 'Unassigned';
			const projectPath = activeSession.fullPath || activeSession.cwd || '';

			const entry = {
				title,
				prompt: text,
				description: '',
				projectName,
				projectPath,
				projectFolderColor: folder?.highlightColor,
				agentId: activeSession.id,
				agentName: activeSession.name || 'Unknown Agent',
				agentSessionId:
					activeSession.aiTabs?.find((t) => t.id === activeSession.activeTabId)?.agentSessionId ||
					undefined,
				tags: [],
				// Source log entry reference (for resetting savedToLibrary on delete)
				sourceLogId: logId,
				sourceSessionId: activeSession.id,
				sourceTabId: activeSession.activeTabId,
			};

			try {
				// Capture scroll position BEFORE async IPC call to prevent scroll pop
				const scrollContainer = logId
					? document.querySelector('[data-terminal-scroll-container]')
					: null;
				const savedScrollTop = scrollContainer?.scrollTop ?? null;

				const savedEntry = await window.maestro.promptLibrary.add(entry);

				// Mark the log entry as saved
				if (logId && activeSession) {
					setSessions((prev) =>
						prev.map((s) => {
							if (s.id !== activeSession.id) return s;
							return {
								...s,
								aiTabs: s.aiTabs.map((tab) =>
									tab.id === activeSession.activeTabId
										? {
												...tab,
												logs: tab.logs.map((l) =>
													l.id === logId
														? { ...l, savedToLibrary: true, promptLibraryEntryId: savedEntry.id }
														: l
												),
											}
										: tab
								),
							};
						})
					);

					if (savedScrollTop !== null) {
						requestAnimationFrame(() => {
							if (scrollContainer) {
								scrollContainer.scrollTop = savedScrollTop;
							}
						});
					}
				}

				showSuccessFlash('Prompt saved to library.');
			} catch (error) {
				console.error('Failed to save prompt to library:', error);
			}
		},
		[activeSession, getFolderById, showSuccessFlash, setSessions]
	);

	const handleRateResponse = useCallback(
		async (logId: string, rating: 'liked' | 'disliked' | null) => {
			const currentSession = sessionsRef.current.find((s) => s.id === activeSessionIdRef.current);
			if (!currentSession) return;

			const activeTab = currentSession.aiTabs.find((t) => t.id === currentSession.activeTabId);
			if (!activeTab) return;

			const logs = activeTab.logs || [];
			const logIndex = logs.findIndex((l) => l.id === logId);
			const logEntry = logs[logIndex];
			if (!logEntry) return;

			// Find the previous user message for context
			let userQuery = '';
			for (let i = logIndex - 1; i >= 0; i--) {
				if (logs[i].source === 'user') {
					userQuery = logs[i].text;
					break;
				}
			}

			// Save scroll position before state update
			const scrollContainer = document.querySelector('[data-terminal-scroll-container]');
			const savedScrollTop = scrollContainer?.scrollTop ?? null;

			// Update the log entry's rating in state
			setSessions((prev) =>
				prev.map((s) => {
					if (s.id !== currentSession.id) return s;
					return {
						...s,
						aiTabs: s.aiTabs.map((tab) =>
							tab.id === activeTab.id
								? {
										...tab,
										logs: tab.logs.map((l) => (l.id === logId ? { ...l, rating } : l)),
									}
								: tab
						),
					};
				})
			);

			// Restore scroll position after React renders
			if (savedScrollTop !== null) {
				requestAnimationFrame(() => {
					if (scrollContainer) {
						scrollContainer.scrollTop = savedScrollTop;
					}
				});
			}

			// Record to feedback file if rating is set (not removed)
			if (rating) {
				try {
					await window.maestro.feedback.record({
						rating,
						sessionId: currentSession.id,
						sessionName: currentSession.name || 'Unnamed Session',
						tabId: activeTab.id,
						agentType: currentSession.toolType || 'claude-code',
						userQuery,
						aiResponse: logEntry.text,
						timestamp: Date.now(),
					});
					showSuccessFlash(`Response ${rating}`);
				} catch (error) {
					console.error('Failed to record feedback:', error);
				}
			}
		},
		[setSessions, showSuccessFlash]
	);

	const handlePinMessage = useCallback(
		(logId: string) => {
			if (!activeSession) return;
			const activeTab = activeSession.aiTabs.find((t) => t.id === activeSession.activeTabId);
			if (!activeTab) return;

			const targetLog = activeTab.logs.find((l) => l.id === logId);
			if (!targetLog) return;

			// Save scroll position before state update
			const scrollContainer = document.querySelector('[data-terminal-scroll-container]');
			const savedScrollTop = scrollContainer?.scrollTop ?? null;

			// If already pinned, unpin it
			if (targetLog.pinned) {
				setSessions((prev) =>
					prev.map((s) =>
						s.id === activeSession.id
							? {
									...s,
									aiTabs: s.aiTabs.map((tab) =>
										tab.id === activeSession.activeTabId
											? {
													...tab,
													logs: tab.logs.map((l) =>
														l.id === logId
															? {
																	...l,
																	pinned: false,
																	pinnedAt: undefined,
																	pinSortOrder: undefined,
																}
															: l
													),
												}
											: tab
									),
								}
							: s
					)
				);

				// Restore scroll position after React renders
				if (savedScrollTop !== null) {
					requestAnimationFrame(() => {
						if (scrollContainer) {
							scrollContainer.scrollTop = savedScrollTop;
						}
					});
				}
				return;
			}

			// Check soft limit
			const currentPinCount = activeTab.logs.filter((l) => l.pinned).length;
			if (currentPinCount >= 20) {
				// Show warning but allow — it's a soft limit
				console.warn('Pin limit reached (20). Consider unpinning older items.');
				showSuccessFlash('Pin limit reached (20). Consider unpinning older items.');
			}

			// Pin the message
			setSessions((prev) =>
				prev.map((s) =>
					s.id === activeSession.id
						? {
								...s,
								aiTabs: s.aiTabs.map((tab) =>
									tab.id === activeSession.activeTabId
										? {
												...tab,
												logs: tab.logs.map((l) =>
													l.id === logId
														? { ...l, pinned: true, pinnedAt: Date.now(), pinSortOrder: Date.now() }
														: l
												),
											}
										: tab
								),
							}
						: s
				)
			);

			// Restore scroll position after React renders
			if (savedScrollTop !== null) {
				requestAnimationFrame(() => {
					if (scrollContainer) {
						scrollContainer.scrollTop = savedScrollTop;
					}
				});
			}
		},
		[activeSession, setSessions, showSuccessFlash]
	);

	// Pinned items — computed from session/tab pin state
	const pinnedItems = useMemo<PinnedItem[]>(() => {
		if (!activeSession) return [];
		const activeTab = activeSession.aiTabs.find((t) => t.id === activeSession.activeTabId);
		if (!activeTab) return [];
		return activeTab.logs
			.filter((l) => l.pinned)
			.map((l) => ({
				logId: l.id,
				tabId: activeSession.activeTabId,
				text: l.text,
				source: l.source,
				messageTimestamp: l.timestamp,
				pinnedAt: l.pinnedAt || l.timestamp,
				pinSortOrder: l.pinSortOrder ?? l.pinnedAt ?? l.timestamp,
			}));
	}, [activeSession]);

	const handleUnpinMessage = useCallback(
		(logId: string) => {
			if (!activeSession) return;
			setSessions((prev) =>
				prev.map((s) =>
					s.id === activeSession.id
						? {
								...s,
								aiTabs: s.aiTabs.map((tab) =>
									tab.id === activeSession.activeTabId
										? {
												...tab,
												logs: tab.logs.map((l) =>
													l.id === logId
														? { ...l, pinned: false, pinnedAt: undefined, pinSortOrder: undefined }
														: l
												),
											}
										: tab
								),
							}
						: s
				)
			);
		},
		[activeSession, setSessions]
	);

	const handleReorderPins = useCallback(
		(orderedLogIds: string[]) => {
			if (!activeSession) return;
			setSessions((prev) =>
				prev.map((s) =>
					s.id === activeSession.id
						? {
								...s,
								aiTabs: s.aiTabs.map((tab) =>
									tab.id === activeSession.activeTabId
										? {
												...tab,
												logs: tab.logs.map((l) => {
													const newIndex = orderedLogIds.indexOf(l.id);
													if (newIndex === -1) return l;
													return { ...l, pinSortOrder: newIndex };
												}),
											}
										: tab
								),
							}
						: s
				)
			);
		},
		[activeSession, setSessions]
	);

	const handleScrollToMessage = useCallback((timestamp: number) => {
		const scrollContainer = document.querySelector('[data-terminal-scroll-container]');
		if (!scrollContainer) return;

		let targetElement: Element | null = scrollContainer.querySelector(
			`[data-message-timestamp="${timestamp}"]`
		);

		if (!targetElement) {
			const allMessages = scrollContainer.querySelectorAll('[data-message-timestamp]');
			let closestElement: Element | null = null;
			let closestDiff = Infinity;

			allMessages.forEach((el) => {
				const msgTimestamp = el.getAttribute('data-message-timestamp');
				if (msgTimestamp) {
					const msgTime = Number(msgTimestamp);
					const diff = Math.abs(msgTime - timestamp);
					if (diff < closestDiff) {
						closestDiff = diff;
						closestElement = el;
					}
				}
			});

			if (closestElement && closestDiff < 5000) {
				targetElement = closestElement;
			}
		}

		if (targetElement) {
			targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

			const element = targetElement as HTMLElement;
			element.style.transition = 'background-color 0.3s ease';
			const originalBg = element.style.backgroundColor;
			element.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
			setTimeout(() => {
				element.style.backgroundColor = originalBg;
			}, 1500);
		}
	}, []);

	// Per-prompt effort level and model change handlers
	const handleEffortLevelChange = useCallback((level: 'high' | 'medium' | 'low' | undefined) => {
		setSessions((prev) =>
			prev.map((s) => {
				if (s.id !== activeSessionIdRef.current) return s;
				if (level === undefined) {
					// Remove the env var
					const { CLAUDE_CODE_EFFORT_LEVEL: _, ...rest } = s.customEnvVars || {};
					return { ...s, customEnvVars: rest };
				}
				return {
					...s,
					customEnvVars: {
						...s.customEnvVars,
						CLAUDE_CODE_EFFORT_LEVEL: level,
					},
				};
			})
		);
	}, []);

	const handleModelChange = useCallback((model: string) => {
		setSessions((prev) =>
			prev.map((s) => {
				if (s.id !== activeSessionIdRef.current) return s;
				return {
					...s,
					customModel: model || undefined,
				};
			})
		);
	}, []);

	// Project folder drop handler for session list
	const handleDropOnProjectFolder = useCallback(
		(folderId: string, sessionId: string) => {
			// Update React state to immediately reflect the change
			setSessions((prev) =>
				prev.map((s) => {
					if (s.id === sessionId) {
						const currentFolderIds = s.projectFolderIds || [];
						if (!currentFolderIds.includes(folderId)) {
							return { ...s, projectFolderIds: [...currentFolderIds, folderId] };
						}
					}
					return s;
				})
			);
			// Clear the dragging state
			setDraggingSessionId(null);
			// Persist to backend via IPC
			window.maestro.projectFolders.addSession(folderId, sessionId);
		},
		[setSessions, setDraggingSessionId]
	);

	// Git rescan handler for edit agent modal
	const handleRescanGit = useCallback(async (sessionId: string): Promise<boolean> => {
		const session = sessionsRef.current.find((s) => s.id === sessionId);
		if (!session) return false;

		const sshRemoteId =
			session.sshRemoteId || session.sessionSshRemoteConfig?.remoteId || undefined;
		const cwd = session.sessionSshRemoteConfig?.workingDirOverride || session.cwd;

		console.info(
			`[handleRescanGit] Scanning for git repo: session=${sessionId}, cwd=${cwd}, ssh=${sshRemoteId || 'local'}`
		);

		// Timeout wrapper to prevent indefinite hangs on SSH operations
		// 120s: each SSH command takes ~5s, detectGitRepo can issue ~13 commands sequentially
		const withTimeout = <T,>(promise: Promise<T>, ms = 120000): Promise<T> =>
			Promise.race([
				promise,
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error(`[handleRescanGit] timed out after ${ms}ms`)), ms)
				),
			]);

		try {
			const result = await withTimeout(detectGitRepo(cwd, sshRemoteId, { enableSubdirScan: true }));

			console.info(
				`[handleRescanGit] Result: session=${sessionId}, isGitRepo=${result.isGitRepo}, gitRoot=${result.gitRoot || 'none'}`
			);

			setSessions((prev) =>
				prev.map((s) =>
					s.id === sessionId
						? {
								...s,
								isGitRepo: result.isGitRepo,
								isBareRepo: result.isBareRepo,
								gitRoot: result.gitRoot,
								gitBranches: result.gitBranches,
								gitTags: result.gitTags,
								gitRefsCacheTime: result.gitRefsCacheTime,
							}
						: s
				)
			);

			return result.isGitRepo;
		} catch (error) {
			console.error(`[handleRescanGit] Failed for session ${sessionId}:`, error);
			return false;
		}
	}, []);

	// Prompt library delete handler
	const handlePromptLibraryDelete = useCallback(
		(deletedPrompt: PromptLibraryEntry) => {
			const logId = deletedPrompt?.sourceLogId;
			const sessionId = deletedPrompt?.sourceSessionId;
			const tabId = deletedPrompt?.sourceTabId;

			if (!logId || !sessionId || !tabId) return;

			const scrollContainer = document.querySelector('[data-terminal-scroll-container]');
			const savedScrollTop = scrollContainer?.scrollTop ?? null;

			setSessions((prev) =>
				prev.map((s) => {
					if (s.id !== sessionId) return s;
					return {
						...s,
						aiTabs: s.aiTabs.map((tab) =>
							tab.id === tabId
								? {
										...tab,
										logs: tab.logs.map((l) =>
											l.id === logId ? { ...l, savedToLibrary: false } : l
										),
									}
								: tab
						),
					};
				})
			);

			if (savedScrollTop !== null) {
				requestAnimationFrame(() => {
					if (scrollContainer) {
						scrollContainer.scrollTop = savedScrollTop;
					}
				});
			}
		},
		[setSessions]
	);

	// Interactive capacity check handlers
	const handleInteractiveCapacityCancel = useCallback(() => {
		setInteractiveCapacityData(null);
		interactiveCapacityResumeRef.current = null;
	}, []);

	const handleInteractiveCapacityRunAnyway = useCallback(() => {
		setInteractiveCapacityData(null);
		const resume = interactiveCapacityResumeRef.current;
		interactiveCapacityResumeRef.current = null;
		if (resume) resume();
	}, []);

	// Update keyboardHandlerRef synchronously during render (before effects run)
	// This must be placed after all handler functions and state are defined to avoid TDZ errors
	// The ref is provided by useMainKeyboardHandler hook
	keyboardHandlerRef.current = {
		shortcuts,
		activeFocus,
		activeRightTab,
		sessions,
		selectedSidebarIndex,
		activeSessionId,
		quickActionOpen,
		settingsModalOpen,
		shortcutsHelpOpen,
		newInstanceModalOpen,
		aboutModalOpen,
		processMonitorOpen,
		logViewerOpen,
		createGroupModalOpen,
		confirmModalOpen,
		renameInstanceModalOpen,
		renameGroupModalOpen,
		activeSession,
		fileTreeFilter,
		fileTreeFilterOpen,
		gitDiffPreview,
		gitLogOpen,
		lightboxImage,
		hasOpenLayers,
		hasOpenModal,
		visibleSessions,
		sortedSessions,
		groups,
		bookmarksCollapsed,
		leftSidebarOpen,
		editingSessionId,
		editingGroupId,
		markdownEditMode,
		chatRawTextMode,
		defaultSaveToHistory,
		defaultShowThinking,
		setLeftSidebarOpen,
		setRightPanelOpen,
		addNewSession,
		deleteSession,
		setQuickActionInitialMode,
		setQuickActionOpen,
		cycleSession,
		toggleInputMode,
		setShortcutsHelpOpen,
		setSettingsModalOpen,
		setSettingsTab,
		setActiveRightTab,
		handleSetActiveRightTab,
		setActiveFocus,
		setBookmarksCollapsed,
		setGroups,
		setSelectedSidebarIndex,
		setActiveSessionId,
		handleViewGitDiff,
		setGitLogOpen,
		setActiveAgentSessionId,
		setAgentSessionsOpen,
		setLogViewerOpen,
		setProcessMonitorOpen,
		setUsageDashboardOpen,
		setAboutModalOpen,
		logsEndRef,
		inputRef,
		terminalOutputRef,
		sidebarContainerRef,
		setSessions,
		createTab,
		closeTab,
		reopenUnifiedClosedTab,
		getActiveTab,
		setRenameTabId,
		setRenameTabInitialName,
		// Wizard tab close support - for confirmation modal before closing wizard tabs
		hasActiveWizard,
		performTabClose,
		setConfirmModalOpen,
		setConfirmModalMessage,
		setConfirmModalOnConfirm,
		setRenameTabModalOpen,
		navigateToNextTab,
		navigateToPrevTab,
		navigateToTabByIndex,
		navigateToLastTab,
		navigateToUnifiedTabByIndex,
		navigateToLastUnifiedTab,
		navigateToNextUnifiedTab,
		navigateToPrevUnifiedTab,
		setFileTreeFilterOpen,
		isShortcut,
		isTabShortcut,
		handleNavBack,
		handleNavForward,
		toggleUnreadFilter,
		setTabSwitcherOpen,
		showUnreadOnly,
		stagedImages,
		handleSetLightboxImage,
		setMarkdownEditMode,
		setChatRawTextMode,
		toggleTabStar,
		handleTabLock,
		toggleTabUnread,
		setPromptComposerOpen,
		openWizardModal,
		rightPanelRef,
		setFuzzyFileSearchOpen,
		setMarketplaceModalOpen,
		setSymphonyModalOpen,
		setDirectorNotesOpen,
		encoreFeatures,
		setShowNewGroupChatModal,
		deleteGroupChatWithConfirmation,
		// Group chat context
		activeGroupChatId,
		groupChatInputRef,
		groupChatStagedImages,
		setGroupChatRightTab,
		groupChatShowThinking,
		setGroupChatShowThinking,
		// Navigation handlers from useKeyboardNavigation hook
		handleSidebarNavigation,
		handleTabNavigation,
		handleEnterToActivate,
		handleEscapeInMain,
		// Agent capabilities
		hasActiveSessionCapability,

		// Merge session modal and send to agent modal
		setMergeSessionModalOpen,
		setSendToAgentModalOpen,
		// Summarize and continue (getter: evaluated lazily only when shortcut fires)
		get canSummarizeActiveTab() {
			if (!activeSession || !activeSession.activeTabId) return false;
			const activeTab = activeSession.aiTabs.find((t) => t.id === activeSession.activeTabId);
			return canSummarize(activeSession.contextUsage, activeTab?.logs);
		},
		summarizeAndContinue: handleSummarizeAndContinue,

		// Keyboard mastery gamification
		recordShortcutUsage,
		onKeyboardMasteryLevelUp,

		// Edit agent modal
		setEditAgentSession,
		setEditAgentModalOpen,

		// Auto Run state for keyboard handler
		activeBatchRunState,

		// Bulk tab close handlers
		handleCloseAllTabs,
		handleCloseOtherTabs,
		handleCloseTabsLeft,
		handleCloseTabsRight,

		// Close current tab (Cmd+W) - works with both file and AI tabs
		handleCloseCurrentTab,

		// Session bookmark toggle
		toggleBookmark,

		// Knowledge graph
		handleSaveToKnowledgeGraph,

		// Auto-scroll AI mode toggle
		autoScrollAiMode,
		setAutoScrollAiMode,
	};

	// NOTE: File explorer effects (flat file list, pending jump path, scroll, keyboard nav) are
	// now handled by useFileExplorerEffects hook (Phase 2.6)

	// Wizard handlers (handleWizardComplete, handleWizardLetsGo, handleToggleWizardShowThinking)
	// now in useWizardHandlers hook

	// ============================================================================
	// PROPS HOOKS FOR MAJOR COMPONENTS
	// These hooks memoize the props objects for MainPanel, SessionList, and RightPanel
	// to prevent re-evaluating 50-100+ props on every state change.
	// ============================================================================

	// NOTE: stableFileTree is now provided by useFileExplorerEffects hook (Phase 2.6)

	// Bind user's context warning thresholds to getContextColor so the header bar
	// colors match the bottom warning sash thresholds from settings.
	const boundGetContextColor: typeof getContextColor = useCallback(
		(usage, th) =>
			getContextColor(
				usage,
				th,
				contextManagementSettings.contextWarningYellowThreshold,
				contextManagementSettings.contextWarningRedThreshold
			),
		[
			contextManagementSettings.contextWarningYellowThreshold,
			contextManagementSettings.contextWarningRedThreshold,
		]
	);

	const mainPanelProps = useMainPanelProps({
		// Core state
		logViewerOpen,
		agentSessionsOpen,
		activeAgentSessionId,
		activeSession,
		thinkingItems,
		theme,
		isMobileLandscape,
		inputValue,
		stagedImages,
		commandHistoryOpen,
		commandHistoryFilter,
		commandHistorySelectedIndex,
		slashCommandOpen,
		slashCommands: allSlashCommands,
		selectedSlashCommandIndex,
		filePreviewLoading,

		// Tab completion state
		tabCompletionOpen,
		tabCompletionSuggestions,
		selectedTabCompletionIndex,
		tabCompletionFilter,

		// @ mention completion state
		atMentionOpen,
		atMentionFilter,
		atMentionStartIndex,
		atMentionSuggestions,
		selectedAtMentionIndex,

		// Batch run state (convert null to undefined for component props)
		currentSessionBatchState: currentSessionBatchState ?? undefined,

		// File tree
		fileTree: stableFileTree,

		// File preview navigation (per-tab)
		canGoBack: fileTabCanGoBack,
		canGoForward: fileTabCanGoForward,
		backHistory: fileTabBackHistory,
		forwardHistory: fileTabForwardHistory,
		filePreviewHistoryIndex: activeFileTabNavIndex,

		// Active tab for error handling
		activeTab,

		// Worktree
		isWorktreeChild: !!activeSession?.parentSessionId,

		// Summarization progress
		summarizeProgress,
		summarizeResult,
		summarizeStartTime: startTime,
		isSummarizing: summarizeState === 'summarizing',

		// Merge progress
		mergeProgress,
		mergeStartTime,
		isMerging: mergeState === 'merging',
		mergeSourceName,
		mergeTargetName,

		// Gist publishing
		ghCliAvailable,
		hasGist: activeFileTab ? !!fileGistUrls[activeFileTab.path] : false,

		// Setters
		setGitDiffPreview,
		setLogViewerOpen,
		setAgentSessionsOpen,
		setActiveAgentSessionId,
		setInputValue,
		setStagedImages,
		setCommandHistoryOpen,
		setCommandHistoryFilter,
		setCommandHistorySelectedIndex,
		setSlashCommandOpen,
		setSelectedSlashCommandIndex,
		setTabCompletionOpen,
		setSelectedTabCompletionIndex,
		setTabCompletionFilter,
		setAtMentionOpen,
		setAtMentionFilter,
		setAtMentionStartIndex,
		setSelectedAtMentionIndex,
		setGitLogOpen,

		// Refs
		inputRef,
		logsEndRef,
		terminalOutputRef,

		// Handlers
		handleResumeSession,
		handleNewAgentSession,
		toggleInputMode,
		processInput,
		handleInterrupt,
		handleInputKeyDown,
		handlePaste,
		handleDrop,
		getContextColor: boundGetContextColor,
		setActiveSessionId,
		handleStopBatchRun,
		handleDeleteLog,
		handleRemoveQueuedItem,
		handleOpenQueueBrowser,

		// Tab management handlers
		handleTabSelect,
		handleTabClose,
		handleNewTab,
		handleRequestTabRename,
		handleTabReorder,
		handleUnifiedTabReorder,
		handleUpdateTabByClaudeSessionId,
		handleTabStar,
		handleTabLock,
		handleTabMarkUnread,
		handleToggleTabReadOnlyMode,
		handleToggleTabSaveToHistory,
		handleToggleTabShowThinking,
		toggleUnreadFilter,
		handleOpenTabSearch,
		handleCloseAllTabs,
		handleCloseOtherTabs,
		handleCloseTabsLeft,
		handleCloseTabsRight,

		// Unified tab system (Phase 4)
		unifiedTabs,
		activeFileTabId: activeSession?.activeFileTabId ?? null,
		activeFileTab,
		handleFileTabSelect: handleSelectFileTab,
		handleFileTabClose: handleCloseFileTab,
		handleFileTabEditModeChange,
		handleFileTabEditContentChange,
		handleFileTabScrollPositionChange,
		handleFileTabSearchQueryChange,
		handleReloadFileTab,

		handleScrollPositionChange,
		handleAtBottomChange,
		handleMainPanelInputBlur,
		handleOpenPromptComposer,
		handleReplayMessage,
		handleSaveToPromptLibrary,
		handleRateResponse,
		handlePinMessage,
		handleMainPanelFileClick,
		handleNavigateBack: handleFileTabNavigateBack,
		handleNavigateForward: handleFileTabNavigateForward,
		handleNavigateToIndex: handleFileTabNavigateToIndex,
		handleClearFilePreviewHistory,
		handleClearAgentErrorForMainPanel,
		handleShowAgentErrorModal,
		showSuccessFlash,
		pinnedItems,
		handleOpenFuzzySearch,
		handleOpenWorktreeConfig,
		handleOpenCreatePR,
		handleSummarizeAndContinue,
		handleMergeWith,
		handleOpenSendToAgentModal,
		handleCopyContext,
		handleExportHtml,
		handlePublishTabGist,
		handleSaveToKnowledgeGraph,
		cancelTab,
		cancelMergeTab,
		recordShortcutUsage,
		onKeyboardMasteryLevelUp,
		handleSetLightboxImage,

		// Gist publishing
		setGistPublishModalOpen,

		// Document Graph (from fileExplorerStore)
		setGraphFocusFilePath: useFileExplorerStore.getState().focusFileInGraph,
		setLastGraphFocusFilePath: () => {}, // no-op: focusFileInGraph sets both atomically
		setIsGraphViewOpen: useFileExplorerStore.getState().setIsGraphViewOpen,

		// Wizard callbacks
		generateInlineWizardDocuments,
		retryInlineWizardMessage,
		clearInlineWizardError,
		endInlineWizard,
		handleAutoRunRefresh,

		// Complex wizard handlers
		onWizardComplete: handleWizardComplete,
		onWizardLetsGo: handleWizardLetsGo,
		onWizardRetry: retryInlineWizardMessage,
		onWizardClearError: clearInlineWizardError,
		onToggleWizardShowThinking: handleToggleWizardShowThinking,

		// Per-prompt effort level
		handleEffortLevelChange,
		// Per-prompt model selection
		handleModelChange,

		// Global Auto Run status
		allSessions: sessions,
		getBatchState,
		onSwitchToSession: setActiveSessionId,

		// File tree refresh
		refreshFileTree,

		// Open saved file in tab
		onOpenSavedFileInTab: handleOpenFileTab,

		// Helper functions
		getActiveTab,
	});
	const sessionListProps = useSessionListProps({
		// Theme (computed externally from settingsStore + themeId)
		theme,

		// Computed values (not raw store fields)
		sortedSessions,
		isLiveMode,
		webInterfaceUrl,
		showSessionJumpNumbers,
		visibleSessions,

		// Ref
		sidebarContainerRef,

		// Domain handlers
		toggleGlobalLive,
		restartWebServer,
		toggleGroup,
		handleDragStart,
		handleDragOver,
		handleDropOnGroup,
		handleDropOnUngrouped,
		handleDropOnProjectFolder,
		finishRenamingGroup,
		finishRenamingSession,
		startRenamingGroup,
		startRenamingSession,
		showConfirmation,
		createNewGroup,
		handleCreateGroupAndMove,
		addNewSession,
		deleteSession,
		deleteWorktreeGroup,
		handleEditAgent,
		handleOpenCreatePRSession,
		handleQuickCreateWorktree,
		handleOpenWorktreeConfigSession,
		handleDeleteWorktreeSession,
		handleToggleWorktreeExpanded,
		openWizardModal,
		handleStartTour,

		// Group Chat handlers
		handleOpenGroupChat,
		handleNewGroupChat,
		handleEditGroupChat,
		handleOpenRenameGroupChatModal,
		handleOpenDeleteGroupChatModal,
		handleArchiveGroupChat,
	});

	const rightPanelProps = useRightPanelProps({
		// Theme (computed externally from settingsStore + themeId)
		theme,

		// Refs
		fileTreeContainerRef,
		fileTreeFilterInputRef,

		// Tab handler (custom logic: checks autorun folder before switching)
		handleSetActiveRightTab,

		// File explorer handlers
		toggleFolder,
		handleFileClick,
		expandAllFolders,
		collapseAllFolders,
		updateSessionWorkingDirectory,
		refreshFileTree,
		handleAutoRefreshChange,
		showSuccessFlash,

		// Auto Run handlers
		handleAutoRunContentChange,
		handleAutoRunModeChange,
		handleAutoRunStateChange,
		handleAutoRunSelectDocument,
		handleAutoRunCreateDocument,
		handleAutoRunRefresh,
		handleAutoRunOpenSetup,

		// Batch processing (computed by useBatchHandlers, not a raw store field)
		currentSessionBatchState: currentSessionBatchState ?? undefined,
		handleOpenBatchRunner,
		handleStopBatchRun,
		handleKillBatchRun,
		handleSkipCurrentDocument,
		handleAbortBatchOnError,
		handleResumeAfterError,
		handleJumpToAgentSession,
		handleResumeSession,

		// Modal handlers
		handleOpenAboutModal,
		handleOpenMarketplace,
		handleLaunchWizardTab,

		// File linking
		handleMainPanelFileClick,

		// Document Graph handlers
		handleFocusFileInGraph,
		handleOpenLastDocumentGraph,

		// Pinned messages
		pinnedItems,
		handleUnpinMessage,
		handleReorderPins,
		handleScrollToMessage,
	});

	return (
		<GitStatusProvider sessions={sessions} activeSessionId={activeSessionId}>
			<div
				className={`flex h-screen w-full font-mono overflow-hidden transition-colors duration-300 ${
					isMobileLandscape || useNativeTitleBar ? 'pt-0' : 'pt-10'
				}`}
				style={{
					backgroundColor: theme.colors.bgMain,
					color: theme.colors.textMain,
					fontFamily: fontFamily,
					fontSize: `${fontSize}px`,
				}}
				onDragEnter={handleImageDragEnter}
				onDragLeave={handleImageDragLeave}
				onDragOver={handleImageDragOver}
				onDrop={handleDrop}
			>
				{/* Image Drop Overlay */}
				{isDraggingImage && (
					<div
						className="fixed inset-0 z-[9999] pointer-events-none flex items-center justify-center"
						style={{ backgroundColor: `${theme.colors.accent}20` }}
					>
						<div
							className="pointer-events-none rounded-xl border-2 border-dashed p-8 flex flex-col items-center gap-4"
							style={{
								borderColor: theme.colors.accent,
								backgroundColor: `${theme.colors.bgMain}ee`,
							}}
						>
							<svg
								className="w-16 h-16"
								style={{ color: theme.colors.accent }}
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
								/>
							</svg>
							<span className="text-lg font-medium" style={{ color: theme.colors.textMain }}>
								Drop image to attach
							</span>
						</div>
					</div>
				)}

				{/* --- DRAGGABLE TITLE BAR (hidden in mobile landscape or when using native title bar) --- */}
				{!isMobileLandscape && !useNativeTitleBar && (
					<div
						className="fixed top-0 left-0 right-0 h-10 flex items-center justify-center"
						style={
							{
								WebkitAppRegion: 'drag',
							} as React.CSSProperties
						}
					>
						{activeGroupChatId ? (
							<span
								className="text-xs select-none opacity-50"
								style={{ color: theme.colors.textDim }}
							>
								Maestro Group Chat:{' '}
								{groupChats.find((c) => c.id === activeGroupChatId)?.name || 'Unknown'}
							</span>
						) : (
							activeSession && (
								<span
									className="text-xs select-none opacity-50"
									style={{ color: theme.colors.textDim }}
								>
									{(() => {
										const parts: string[] = [];
										// Group name (if grouped)
										const group = groups.find((g) => g.id === activeSession.groupId);
										if (group) {
											parts.push(`${group.emoji} ${group.name}`);
										}
										// Agent name (user-given name for this agent instance)
										parts.push(activeSession.name);
										// Active tab name or UUID octet
										const activeTab = activeSession.aiTabs?.find(
											(t) => t.id === activeSession.activeTabId
										);
										if (activeTab) {
											const tabLabel =
												activeTab.name ||
												(activeTab.agentSessionId
													? activeTab.agentSessionId.split('-')[0].toUpperCase()
													: null);
											if (tabLabel) {
												parts.push(tabLabel);
											}
										}
										return parts.join(' | ');
									})()}
								</span>
							)
						)}
					</div>
				)}

				{/* --- UNIFIED MODALS (all modal groups consolidated into AppModals) --- */}
				<AppModals
					// Common props (sessions/groups/groupChats + modal booleans self-sourced from stores — Tier 1B)
					theme={theme}
					shortcuts={shortcuts}
					tabShortcuts={tabShortcuts}
					// AppInfoModals props
					onCloseShortcutsHelp={handleCloseShortcutsHelp}
					hasNoAgents={hasNoAgents}
					keyboardMasteryStats={keyboardMasteryStats}
					onCloseAboutModal={handleCloseAboutModal}
					autoRunStats={autoRunStats}
					usageStats={usageStats}
					handsOnTimeMs={totalActiveTimeMs}
					onOpenLeaderboardRegistration={handleOpenLeaderboardRegistrationFromAbout}
					isLeaderboardRegistered={isLeaderboardRegistered}
					onCloseUpdateCheckModal={handleCloseUpdateCheckModal}
					onCloseProcessMonitor={handleCloseProcessMonitor}
					onNavigateToSession={handleProcessMonitorNavigateToSession}
					onNavigateToGroupChat={handleProcessMonitorNavigateToGroupChat}
					batchRunStates={batchRunStates}
					usageDashboardOpen={usageDashboardOpen}
					usageDashboardInitialTab={usageDashboardInitialTab}
					onCloseUsageDashboard={() => {
						setUsageDashboardOpen(false);
						setUsageDashboardInitialTab(undefined);
					}}
					defaultStatsTimeRange={defaultStatsTimeRange}
					colorBlindMode={colorBlindMode}
					// AppConfirmModals props
					confirmModalMessage={confirmModalMessage}
					confirmModalOnConfirm={confirmModalOnConfirm}
					confirmModalTitle={confirmModalTitle}
					confirmModalDestructive={confirmModalDestructive}
					onCloseConfirmModal={handleCloseConfirmModal}
					onConfirmQuit={handleConfirmQuit}
					onCancelQuit={handleCancelQuit}
					activeBatchSessionIds={activeBatchSessionIds}
					// AppSessionModals props
					onCloseNewInstanceModal={handleCloseNewInstanceModal}
					onCreateSession={createNewSession}
					existingSessions={sessionsForValidation}
					duplicatingSessionId={duplicatingSessionId}
					onCloseEditAgentModal={handleCloseEditAgentModal}
					onSaveEditAgent={handleSaveEditAgent}
					onRescanGit={handleRescanGit}
					editAgentSession={editAgentSession}
					renameSessionModalOpen={renameInstanceModalOpen}
					renameSessionValue={renameInstanceValue}
					setRenameSessionValue={setRenameInstanceValue}
					onCloseRenameSessionModal={handleCloseRenameSessionModal}
					renameSessionTargetId={renameInstanceSessionId}
					onAfterRename={flushSessionPersistence}
					renameTabId={renameTabId}
					renameTabInitialName={renameTabInitialName}
					onCloseRenameTabModal={handleCloseRenameTabModal}
					onRenameTab={handleRenameTab}
					// AppGroupModals props
					createGroupModalOpen={createGroupModalOpen}
					onCloseCreateGroupModal={handleCloseCreateGroupModal}
					createGroupForFolderId={createGroupForFolderId}
					onGroupCreated={handleGroupCreated}
					renameGroupId={renameGroupId}
					renameGroupValue={renameGroupValue}
					setRenameGroupValue={setRenameGroupValue}
					renameGroupEmoji={renameGroupEmoji}
					setRenameGroupEmoji={setRenameGroupEmoji}
					onCloseRenameGroupModal={handleCloseRenameGroupModal}
					// AppWorktreeModals props
					onCloseWorktreeConfigModal={handleCloseWorktreeConfigModal}
					onSaveWorktreeConfig={handleSaveWorktreeConfig}
					onCreateWorktreeFromConfig={handleCreateWorktreeFromConfig}
					onDisableWorktreeConfig={handleDisableWorktreeConfig}
					createWorktreeSession={createWorktreeSession}
					onCloseCreateWorktreeModal={handleCloseCreateWorktreeModal}
					onCreateWorktree={handleCreateWorktree}
					createPRSession={createPRSession}
					onCloseCreatePRModal={handleCloseCreatePRModal}
					onPRCreated={handlePRCreated}
					deleteWorktreeSession={deleteWorktreeSession}
					onCloseDeleteWorktreeModal={handleCloseDeleteWorktreeModal}
					onConfirmDeleteWorktree={handleConfirmDeleteWorktree}
					onConfirmAndDeleteWorktreeOnDisk={handleConfirmAndDeleteWorktreeOnDisk}
					// AppUtilityModals props
					quickActionInitialMode={quickActionInitialMode}
					setQuickActionOpen={setQuickActionOpen}
					setActiveSessionId={setActiveSessionId}
					addNewSession={addNewSession}
					setRenameInstanceValue={setRenameInstanceValue}
					setRenameInstanceModalOpen={setRenameInstanceModalOpen}
					setRenameGroupId={setRenameGroupId}
					setRenameGroupValueForQuickActions={setRenameGroupValue}
					setRenameGroupEmojiForQuickActions={setRenameGroupEmoji}
					setRenameGroupModalOpenForQuickActions={setRenameGroupModalOpen}
					setCreateGroupModalOpenForQuickActions={setCreateGroupModalOpen}
					setLeftSidebarOpen={setLeftSidebarOpen}
					setRightPanelOpen={setRightPanelOpen}
					toggleInputMode={toggleInputMode}
					deleteSession={deleteSession}
					setSettingsModalOpen={setSettingsModalOpen}
					setSettingsTab={setSettingsTab}
					setShortcutsHelpOpen={setShortcutsHelpOpen}
					setAboutModalOpen={setAboutModalOpen}
					setLogViewerOpen={setLogViewerOpen}
					setProcessMonitorOpen={setProcessMonitorOpen}
					setUsageDashboardOpen={setUsageDashboardOpen}
					setActiveRightTab={setActiveRightTab}
					setAgentSessionsOpen={setAgentSessionsOpen}
					setActiveAgentSessionId={setActiveAgentSessionId}
					setGitDiffPreview={setGitDiffPreview}
					setGitLogOpen={setGitLogOpen}
					isAiMode={activeSession?.inputMode === 'ai'}
					onQuickActionsRenameTab={handleQuickActionsRenameTab}
					onQuickActionsToggleReadOnlyMode={handleQuickActionsToggleReadOnlyMode}
					onQuickActionsToggleTabShowThinking={handleQuickActionsToggleTabShowThinking}
					onQuickActionsOpenTabSwitcher={handleQuickActionsOpenTabSwitcher}
					onCloseAllTabs={handleCloseAllTabs}
					onCloseOtherTabs={handleCloseOtherTabs}
					onCloseTabsLeft={handleCloseTabsLeft}
					onCloseTabsRight={handleCloseTabsRight}
					setPlaygroundOpen={setPlaygroundOpen}
					onQuickActionsRefreshGitFileState={handleQuickActionsRefreshGitFileState}
					onQuickActionsDebugReleaseQueuedItem={handleQuickActionsDebugReleaseQueuedItem}
					markdownEditMode={activeSession?.activeFileTabId ? markdownEditMode : chatRawTextMode}
					onQuickActionsToggleMarkdownEditMode={handleQuickActionsToggleMarkdownEditMode}
					setUpdateCheckModalOpenForQuickActions={setUpdateCheckModalOpen}
					openWizard={openWizardModal}
					wizardGoToStep={wizardGoToStep}
					setDebugWizardModalOpen={setDebugWizardModalOpen}
					setDebugPackageModalOpen={setDebugPackageModalOpen}
					startTour={handleQuickActionsStartTour}
					setFuzzyFileSearchOpen={setFuzzyFileSearchOpen}
					onEditAgent={handleQuickActionsEditAgent}
					onNewGroupChat={handleNewGroupChat}
					onOpenGroupChat={handleOpenGroupChat}
					onCloseGroupChat={handleCloseGroupChat}
					onDeleteGroupChat={deleteGroupChatWithConfirmation}
					hasActiveSessionCapability={hasActiveSessionCapability}
					onOpenMergeSession={handleQuickActionsOpenMergeSession}
					onOpenSendToAgent={handleQuickActionsOpenSendToAgent}
					onOpenCreatePR={handleQuickActionsOpenCreatePR}
					onSummarizeAndContinue={handleQuickActionsSummarizeAndContinue}
					canSummarizeActiveTab={
						activeSession
							? canSummarize(
									activeSession.contextUsage,
									activeSession.aiTabs.find((t) => t.id === activeSession.activeTabId)?.logs
								)
							: false
					}
					onToggleRemoteControl={handleQuickActionsToggleRemoteControl}
					autoRunSelectedDocument={activeSession?.autoRunSelectedFile ?? null}
					autoRunCompletedTaskCount={rightPanelRef.current?.getAutoRunCompletedTaskCount() ?? 0}
					onAutoRunResetTasks={handleQuickActionsAutoRunResetTasks}
					isFilePreviewOpen={!!activeSession?.activeFileTabId}
					ghCliAvailable={ghCliAvailable}
					onPublishGist={() => setGistPublishModalOpen(true)}
					lastGraphFocusFile={lastGraphFocusFilePath}
					onOpenLastDocumentGraph={handleOpenLastDocumentGraph}
					lightboxImage={lightboxImage}
					lightboxImages={lightboxImages}
					stagedImages={stagedImages}
					onCloseLightbox={handleCloseLightbox}
					onNavigateLightbox={handleNavigateLightbox}
					onDeleteLightboxImage={lightboxAllowDelete ? handleDeleteLightboxImage : undefined}
					gitDiffPreview={gitDiffPreview}
					gitViewerCwd={gitViewerCwd}
					onCloseGitDiff={handleCloseGitDiff}
					gitLogSshRemoteId={gitLogSshRemoteId}
					onCloseGitLog={handleCloseGitLog}
					onCloseAutoRunSetup={handleCloseAutoRunSetup}
					onAutoRunFolderSelected={handleAutoRunFolderSelected}
					onCloseBatchRunner={handleCloseBatchRunner}
					onStartBatchRun={handleStartBatchRun}
					onSaveBatchPrompt={handleSaveBatchPrompt}
					showConfirmation={showConfirmation}
					autoRunDocumentList={autoRunDocumentList}
					autoRunDocumentTree={autoRunDocumentTree}
					getDocumentTaskCount={getDocumentTaskCount}
					onAutoRunRefresh={handleAutoRunRefresh}
					onOpenMarketplace={handleOpenMarketplace}
					onOpenSymphony={() => setSymphonyModalOpen(true)}
					onOpenDirectorNotes={
						encoreFeatures.directorNotes ? () => setDirectorNotesOpen(true) : undefined
					}
					autoScrollAiMode={autoScrollAiMode}
					setAutoScrollAiMode={setAutoScrollAiMode}
					closedTabHistory={activeSession?.closedTabHistory ?? []}
					onReopenClosedTab={(closedTabIndex: number) => {
						if (!activeSession) return;

						const history = activeSession.closedTabHistory;
						if (!history || closedTabIndex < 0 || closedTabIndex >= history.length) return;

						// Reorder history so the selected entry is first, then call reopenUnifiedClosedTab
						const selectedEntry = history[closedTabIndex];
						const remainingHistory = [
							...history.slice(0, closedTabIndex),
							...history.slice(closedTabIndex + 1),
						];
						const reorderedSession = {
							...activeSession,
							closedTabHistory: [selectedEntry, ...remainingHistory],
							// Clear unified history so reopenUnifiedClosedTab falls back to legacy
							unifiedClosedTabHistory: [],
						};

						const result = reopenUnifiedClosedTab(reorderedSession);
						if (result) {
							setSessions((prev) =>
								prev.map((s) => (s.id === activeSession.id ? result.session : s))
							);
						}
					}}
					onCloseTabSwitcher={handleCloseTabSwitcher}
					onTabSelect={handleUtilityTabSelect}
					onFileTabSelect={handleUtilityFileTabSelect}
					onNamedSessionSelect={handleNamedSessionSelect}
					filteredFileTree={filteredFileTree}
					fileExplorerExpanded={activeSession?.fileExplorerExpanded}
					onCloseFileSearch={handleCloseFileSearch}
					onFileSearchSelect={handleFileSearchSelect}
					onClosePromptComposer={handleClosePromptComposer}
					promptComposerInitialValue={
						activeGroupChatId
							? groupChats.find((c) => c.id === activeGroupChatId)?.draftMessage || ''
							: deferredInputValue
					}
					onPromptComposerSubmit={handlePromptComposerSubmit}
					onPromptComposerSend={handlePromptComposerSend}
					promptComposerSessionName={
						activeGroupChatId
							? groupChats.find((c) => c.id === activeGroupChatId)?.name
							: activeSession?.name
					}
					promptComposerStagedImages={
						activeGroupChatId ? groupChatStagedImages : canAttachImages ? stagedImages : []
					}
					setPromptComposerStagedImages={
						activeGroupChatId
							? setGroupChatStagedImages
							: canAttachImages
								? setStagedImages
								: undefined
					}
					onPromptOpenLightbox={handleSetLightboxImage}
					promptTabSaveToHistory={activeGroupChatId ? false : (activeTab?.saveToHistory ?? false)}
					onPromptToggleTabSaveToHistory={
						activeGroupChatId ? undefined : handlePromptToggleTabSaveToHistory
					}
					promptTabReadOnlyMode={
						activeGroupChatId ? groupChatReadOnlyMode : (activeTab?.readOnlyMode ?? false)
					}
					onPromptToggleTabReadOnlyMode={handlePromptToggleTabReadOnlyMode}
					promptTabShowThinking={activeGroupChatId ? 'off' : (activeTab?.showThinking ?? 'off')}
					onPromptToggleTabShowThinking={
						activeGroupChatId ? undefined : handlePromptToggleTabShowThinking
					}
					promptSupportsThinking={
						!activeGroupChatId && hasActiveSessionCapability('supportsThinkingDisplay')
					}
					promptEnterToSend={enterToSendAI}
					onPromptToggleEnterToSend={handlePromptToggleEnterToSend}
					// Prompt Library props - pass actual session data
					promptLibraryProjectName={(() => {
						// Get the first project folder the session belongs to
						const folderId = activeSession?.projectFolderIds?.[0];
						if (folderId) {
							const folder = getFolderById(folderId);
							if (folder) {
								return folder.emoji ? `${folder.emoji} ${folder.name}` : folder.name;
							}
						}
						return 'Unassigned';
					})()}
					promptLibraryProjectPath={activeSession?.fullPath || activeSession?.cwd || ''}
					promptLibraryProjectFolderColor={(() => {
						const folderId = activeSession?.projectFolderIds?.[0];
						return folderId ? getFolderById(folderId)?.highlightColor : undefined;
					})()}
					promptLibraryAgentId={activeSession?.id}
					promptLibraryAgentName={activeSession?.name}
					promptLibraryAgentSessionId={
						activeSession?.aiTabs?.find((t) => t.id === activeSession.activeTabId)
							?.agentSessionId || undefined
					}
					onPromptLibraryDelete={handlePromptLibraryDelete}
					onCloseQueueBrowser={handleCloseQueueBrowser}
					onRemoveQueueItem={handleRemoveQueueItem}
					onSwitchQueueSession={handleSwitchQueueSession}
					onReorderQueueItems={handleReorderQueueItems}
					// AppGroupChatModals props
					onCloseNewGroupChatModal={handleCloseNewGroupChatModal}
					onCreateGroupChat={handleCreateGroupChat}
					createGroupChatForFolderId={createGroupChatForFolderId}
					showDeleteGroupChatModal={showDeleteGroupChatModal}
					onCloseDeleteGroupChatModal={handleCloseDeleteGroupChatModal}
					onConfirmDeleteGroupChat={handleConfirmDeleteGroupChat}
					showRenameGroupChatModal={showRenameGroupChatModal}
					onCloseRenameGroupChatModal={handleCloseRenameGroupChatModal}
					onRenameGroupChatFromModal={handleRenameGroupChatFromModal}
					showEditGroupChatModal={showEditGroupChatModal}
					onCloseEditGroupChatModal={handleCloseEditGroupChatModal}
					onUpdateGroupChat={handleUpdateGroupChat}
					groupChatMessages={groupChatMessages}
					onCloseGroupChatInfo={handleCloseGroupChatInfo}
					onOpenModeratorSession={handleOpenModeratorSession}
					// AppAgentModals props
					onCloseLeaderboardRegistration={handleCloseLeaderboardRegistration}
					leaderboardRegistration={leaderboardRegistration}
					onSaveLeaderboardRegistration={handleSaveLeaderboardRegistration}
					onLeaderboardOptOut={handleLeaderboardOptOut}
					onSyncAutoRunStats={handleSyncAutoRunStats}
					errorSession={errorSession}
					effectiveAgentError={effectiveAgentError}
					recoveryActions={recoveryActions}
					onDismissAgentError={handleCloseAgentErrorModal}
					groupChatError={groupChatError}
					groupChatRecoveryActions={groupChatRecoveryActions}
					onClearGroupChatError={handleClearGroupChatError}
					onCloseMergeSession={handleCloseMergeSession}
					onMerge={handleMerge}
					transferState={transferState}
					transferProgress={transferProgress}
					transferSourceAgent={transferSourceAgent}
					transferTargetAgent={transferTargetAgent}
					onCancelTransfer={handleCancelTransfer}
					onCompleteTransfer={handleCompleteTransfer}
					onCloseSendToAgent={handleCloseSendToAgent}
					onSendToAgent={handleSendToAgent}
				/>

				{/* --- DEBUG PACKAGE MODAL --- */}
				<DebugPackageModal
					theme={theme}
					isOpen={debugPackageModalOpen}
					onClose={handleCloseDebugPackage}
				/>

				{/* --- WINDOWS WARNING MODAL --- */}
				<WindowsWarningModal
					theme={theme}
					isOpen={windowsWarningModalOpen}
					onClose={() => setWindowsWarningModalOpen(false)}
					onSuppressFuture={setSuppressWindowsWarning}
					onOpenDebugPackage={() => setDebugPackageModalOpen(true)}
					useBetaChannel={enableBetaUpdates}
					onSetUseBetaChannel={setEnableBetaUpdates}
				/>

				{/* --- CELEBRATION OVERLAYS --- */}
				<AppOverlays
					theme={theme}
					cumulativeTimeMs={autoRunStats.cumulativeTimeMs}
					onCloseStandingOvation={handleStandingOvationClose}
					onOpenLeaderboardRegistration={handleOpenLeaderboardRegistration}
					isLeaderboardRegistered={isLeaderboardRegistered}
					onCloseFirstRun={handleFirstRunCelebrationClose}
					onCloseKeyboardMastery={handleKeyboardMasteryCelebrationClose}
				/>

				{/* --- DEVELOPER PLAYGROUND --- */}
				{playgroundOpen && (
					<PlaygroundPanel
						theme={theme}
						themeMode={theme.mode}
						onClose={() => setPlaygroundOpen(false)}
					/>
				)}

				{/* --- DEBUG WIZARD MODAL --- */}
				<DebugWizardModal
					theme={theme}
					isOpen={debugWizardModalOpen}
					onClose={() => setDebugWizardModalOpen(false)}
				/>

				{/* --- MARKETPLACE MODAL (lazy-loaded) --- */}
				{activeSession && activeSession.autoRunFolderPath && marketplaceModalOpen && (
					<Suspense fallback={null}>
						<MarketplaceModal
							theme={theme}
							isOpen={marketplaceModalOpen}
							onClose={() => setMarketplaceModalOpen(false)}
							autoRunFolderPath={activeSession.autoRunFolderPath}
							sessionId={activeSession.id}
							sshRemoteId={
								activeSession.sshRemoteId ||
								activeSession.sessionSshRemoteConfig?.remoteId ||
								undefined
							}
							onImportComplete={handleMarketplaceImportComplete}
						/>
					</Suspense>
				)}

				{/* --- SYMPHONY MODAL (lazy-loaded) --- */}
				{symphonyModalOpen && (
					<Suspense fallback={null}>
						<SymphonyModal
							theme={theme}
							isOpen={symphonyModalOpen}
							onClose={() => setSymphonyModalOpen(false)}
							sessions={sessions}
							onSelectSession={(sessionId) => {
								setActiveSessionId(sessionId);
								setSymphonyModalOpen(false);
							}}
							onStartContribution={handleStartContribution}
						/>
					</Suspense>
				)}

				{/* --- DIRECTOR'S NOTES MODAL (lazy-loaded, Encore Feature) --- */}
				{encoreFeatures.directorNotes && directorNotesOpen && (
					<Suspense fallback={null}>
						<DirectorNotesModal
							theme={theme}
							onClose={() => setDirectorNotesOpen(false)}
							onResumeSession={handleDirectorNotesResumeSession}
							fileTree={activeSession?.fileTree}
							onFileClick={(path: string) =>
								handleFileClick({ name: path.split('/').pop() || path, type: 'file' }, path)
							}
						/>
					</Suspense>
				)}

				{/* --- GIST PUBLISH MODAL --- */}
				{/* Supports both file preview tabs and tab context gist publishing */}
				{gistPublishModalOpen && (activeFileTab || tabGistContent) && (
					<GistPublishModal
						theme={theme}
						filename={
							tabGistContent?.filename ??
							(activeFileTab ? activeFileTab.name + activeFileTab.extension : 'conversation.md')
						}
						content={tabGistContent?.content ?? activeFileTab?.content ?? ''}
						onClose={() => {
							setGistPublishModalOpen(false);
							useTabStore.getState().setTabGistContent(null);
						}}
						onSuccess={(gistUrl, isPublic) => {
							// Save gist URL for the file if it's from file preview tab (not tab context)
							if (activeFileTab && !tabGistContent) {
								saveFileGistUrl(activeFileTab.path, {
									gistUrl,
									isPublic,
									publishedAt: Date.now(),
								});
							}
							// Copy the gist URL to clipboard
							safeClipboardWrite(gistUrl);
							// Show a toast notification
							notifyToast({
								type: 'success',
								title: 'Gist Published',
								message: `${isPublic ? 'Public' : 'Secret'} gist created! URL copied to clipboard.`,
								duration: 5000,
								actionUrl: gistUrl,
								actionLabel: 'Open Gist',
							});
							// Clear tab gist content after success
							useTabStore.getState().setTabGistContent(null);
						}}
						existingGist={
							activeFileTab && !tabGistContent ? fileGistUrls[activeFileTab.path] : undefined
						}
					/>
				)}

				{/* --- DOCUMENT GRAPH VIEW (Mind Map, lazy-loaded) --- */}
				{/* Only render when a focus file is provided - mind map requires a center document */}
				{graphFocusFilePath && (
					<Suspense fallback={null}>
						<DocumentGraphView
							isOpen={isGraphViewOpen}
							onClose={() => {
								useFileExplorerStore.getState().closeGraphView();
								// Return focus to file preview if it was open
								requestAnimationFrame(() => {
									mainPanelRef.current?.focusFilePreview();
								});
							}}
							theme={theme}
							rootPath={activeSession?.projectRoot || activeSession?.cwd || ''}
							onDocumentOpen={async (filePath) => {
								// Open the document in a file tab (migrated from legacy setPreviewFile overlay)
								const treeRoot = activeSession?.projectRoot || activeSession?.cwd || '';
								const fullPath = `${treeRoot}/${filePath}`;
								const filename = filePath.split('/').pop() || filePath;
								// Note: sshRemoteId is only set after AI agent spawns. For terminal-only SSH sessions,
								// use sessionSshRemoteConfig.remoteId as fallback (see CLAUDE.md SSH Remote Sessions)
								const sshRemoteId =
									activeSession?.sshRemoteId ||
									activeSession?.sessionSshRemoteConfig?.remoteId ||
									undefined;
								try {
									// Fetch content and stat in parallel for efficiency
									const [content, stat] = await Promise.all([
										window.maestro.fs.readFile(fullPath, sshRemoteId),
										window.maestro.fs.stat(fullPath, sshRemoteId).catch(() => null), // stat is optional
									]);
									if (content !== null) {
										const lastModified = stat?.modifiedAt
											? new Date(stat.modifiedAt).getTime()
											: undefined;
										handleOpenFileTab({
											path: fullPath,
											name: filename,
											content,
											sshRemoteId,
											lastModified,
										});
									}
								} catch (error) {
									console.error('[DocumentGraph] Failed to open file:', error);
								}
								useFileExplorerStore.getState().setIsGraphViewOpen(false);
							}}
							onExternalLinkOpen={(url) => {
								// Open external URL in default browser
								window.maestro.shell.openExternal(url);
							}}
							focusFilePath={graphFocusFilePath}
							defaultShowExternalLinks={documentGraphShowExternalLinks}
							onExternalLinksChange={settings.setDocumentGraphShowExternalLinks}
							defaultMaxNodes={documentGraphMaxNodes}
							defaultPreviewCharLimit={documentGraphPreviewCharLimit}
							onPreviewCharLimitChange={settings.setDocumentGraphPreviewCharLimit}
							defaultLayoutType={activeSession?.documentGraphLayout ?? documentGraphLayoutType}
							onLayoutTypeChange={(type) => {
								// Persist to the active session for per-agent recall
								if (activeSession) {
									setSessions((prev) =>
										prev.map((s) =>
											s.id === activeSession.id ? { ...s, documentGraphLayout: type } : s
										)
									);
								}
								// Also update the global default for new agents
								settings.setDocumentGraphLayoutType(type);
							}}
							// Note: sshRemoteId is only set after AI agent spawns. For terminal-only SSH sessions,
							// use sessionSshRemoteConfig.remoteId as fallback (see CLAUDE.md SSH Remote Sessions)
							sshRemoteId={
								activeSession?.sshRemoteId ||
								activeSession?.sessionSshRemoteConfig?.remoteId ||
								undefined
							}
						/>
					</Suspense>
				)}

				{/* NOTE: All modals are now rendered via the unified <AppModals /> component above */}

				{/* Delete Agent Confirmation Modal */}
				{deleteAgentModalOpen && deleteAgentSession && (
					<DeleteAgentConfirmModal
						theme={theme}
						agentName={deleteAgentSession.name}
						workingDirectory={deleteAgentSession.cwd}
						onConfirm={() => performDeleteSession(deleteAgentSession, false)}
						onConfirmAndErase={() => performDeleteSession(deleteAgentSession, true)}
						onClose={handleCloseDeleteAgentModal}
					/>
				)}

				{/* Capacity Check Modal (Pre-run gate for Auto Run AND interactive) */}
				<CapacityCheckModal
					theme={theme}
					data={(capacityCheckData || interactiveCapacityData)!}
					isOpen={capacityCheckData !== null || interactiveCapacityData !== null}
					onCancel={capacityCheckData !== null ? onCapacityCancel : handleInteractiveCapacityCancel}
					onRunAnyway={
						capacityCheckData !== null ? onCapacityRunAnyway : handleInteractiveCapacityRunAnyway
					}
				/>

				{/* --- EMPTY STATE VIEW (when no sessions) --- */}
				{sessions.length === 0 && !isMobileLandscape ? (
					<EmptyStateView
						theme={theme}
						shortcuts={shortcuts}
						onNewAgent={addNewSession}
						onOpenWizard={openWizardModal}
						onOpenSettings={() => {
							setSettingsModalOpen(true);
							setSettingsTab('general');
						}}
						onOpenShortcutsHelp={() => setShortcutsHelpOpen(true)}
						onOpenAbout={() => setAboutModalOpen(true)}
						onCheckForUpdates={() => setUpdateCheckModalOpen(true)}
						// Don't show tour option when no agents exist - nothing to tour
					/>
				) : null}

				{/* --- LEFT SIDEBAR (hidden in mobile landscape and when no sessions) --- */}
				{!isMobileLandscape && sessions.length > 0 && (
					<ErrorBoundary>
						<SessionList {...sessionListProps} />
					</ErrorBoundary>
				)}

				{/* --- SYSTEM LOG VIEWER (replaces center content when open, lazy-loaded) --- */}
				{logViewerOpen && (
					<div
						className="flex-1 flex flex-col min-w-0"
						style={{ backgroundColor: theme.colors.bgMain }}
					>
						<Suspense fallback={null}>
							<LogViewer
								theme={theme}
								onClose={handleCloseLogViewer}
								logLevel={logLevel}
								savedSelectedLevels={logViewerSelectedLevels}
								onSelectedLevelsChange={setLogViewerSelectedLevels}
								onShortcutUsed={handleLogViewerShortcutUsed}
							/>
						</Suspense>
					</div>
				)}

				{/* --- GROUP CHAT VIEW (shown when a group chat is active, hidden when log viewer open) --- */}
				{!logViewerOpen &&
					activeGroupChatId &&
					groupChats.find((c) => c.id === activeGroupChatId) && (
						<>
							<div className="flex-1 flex flex-col min-w-0">
								<GroupChatPanel
									theme={theme}
									groupChat={groupChats.find((c) => c.id === activeGroupChatId)!}
									messages={groupChatMessages}
									state={groupChatState}
									groups={groups}
									totalCost={(() => {
										const chat = groupChats.find((c) => c.id === activeGroupChatId);
										const participantsCost = (chat?.participants || []).reduce(
											(sum, p) => sum + (p.totalCost || 0),
											0
										);
										const modCost = moderatorUsage?.totalCost || 0;
										return participantsCost + modCost;
									})()}
									costIncomplete={(() => {
										const chat = groupChats.find((c) => c.id === activeGroupChatId);
										const participants = chat?.participants || [];
										// Check if any participant is missing cost data
										const anyParticipantMissingCost = participants.some(
											(p) => p.totalCost === undefined || p.totalCost === null
										);
										// Moderator is also considered - if no usage stats yet, cost is incomplete
										const moderatorMissingCost =
											moderatorUsage?.totalCost === undefined || moderatorUsage?.totalCost === null;
										return anyParticipantMissingCost || moderatorMissingCost;
									})()}
									onSendMessage={handleSendGroupChatMessage}
									onRename={() =>
										activeGroupChatId && handleOpenRenameGroupChatModal(activeGroupChatId)
									}
									onShowInfo={() => useModalStore.getState().openModal('groupChatInfo')}
									rightPanelOpen={rightPanelOpen}
									onToggleRightPanel={() => setRightPanelOpen(!rightPanelOpen)}
									shortcuts={shortcuts}
									sessions={sessions}
									onDraftChange={handleGroupChatDraftChange}
									onOpenPromptComposer={() => setPromptComposerOpen(true)}
									stagedImages={groupChatStagedImages}
									setStagedImages={setGroupChatStagedImages}
									readOnlyMode={groupChatReadOnlyMode}
									setReadOnlyMode={setGroupChatReadOnlyMode}
									inputRef={groupChatInputRef}
									handlePaste={handlePaste}
									handleDrop={handleDrop}
									onOpenLightbox={handleSetLightboxImage}
									executionQueue={groupChatExecutionQueue.filter(
										(item) => item.tabId === activeGroupChatId
									)}
									onRemoveQueuedItem={handleRemoveGroupChatQueueItem}
									onReorderQueuedItems={handleReorderGroupChatQueueItems}
									markdownEditMode={chatRawTextMode}
									onToggleMarkdownEditMode={() => setChatRawTextMode(!chatRawTextMode)}
									maxOutputLines={maxOutputLines}
									enterToSendAI={enterToSendAI}
									setEnterToSendAI={setEnterToSendAI}
									showFlashNotification={(message: string) => {
										setSuccessFlashNotification(message);
										setTimeout(() => setSuccessFlashNotification(null), 2000);
									}}
									participantColors={groupChatParticipantColors}
									messagesRef={groupChatMessagesRef}
									participantStates={participantStates}
									showThinking={groupChatShowThinking}
									onToggleShowThinking={() => setGroupChatShowThinking(!groupChatShowThinking)}
									thinkingContent={groupChatThinkingContent}
									thinkingCollapsed={groupChatThinkingCollapsed}
									onToggleThinkingCollapsed={(participantName: string) => {
										setGroupChatThinkingCollapsed((prev) => {
											const next = new Map(prev);
											const current = next.get(participantName) ?? true;
											next.set(participantName, !current);
											return next;
										});
									}}
								/>
							</div>
							<GroupChatRightPanel
								theme={theme}
								groupChatId={activeGroupChatId}
								participants={
									groupChats.find((c) => c.id === activeGroupChatId)?.participants || []
								}
								participantStates={participantStates}
								participantSessionPaths={
									new Map(
										sessions
											.filter((s) =>
												groupChats
													.find((c) => c.id === activeGroupChatId)
													?.participants.some((p) => p.sessionId === s.id)
											)
											.map((s) => [s.id, s.projectRoot])
									)
								}
								sessionSshRemoteNames={sessionSshRemoteNames}
								isOpen={rightPanelOpen}
								onToggle={() => setRightPanelOpen(!rightPanelOpen)}
								width={rightPanelWidth}
								setWidthState={setRightPanelWidth}
								shortcuts={shortcuts}
								moderatorAgentId={
									groupChats.find((c) => c.id === activeGroupChatId)?.moderatorAgentId ||
									'claude-code'
								}
								moderatorSessionId={
									groupChats.find((c) => c.id === activeGroupChatId)?.moderatorSessionId || ''
								}
								moderatorAgentSessionId={
									groupChats.find((c) => c.id === activeGroupChatId)?.moderatorAgentSessionId
								}
								moderatorState={groupChatState === 'moderator-thinking' ? 'busy' : 'idle'}
								moderatorUsage={moderatorUsage}
								activeTab={groupChatRightTab}
								onTabChange={handleGroupChatRightTabChange}
								onJumpToMessage={handleJumpToGroupChatMessage}
								onColorsComputed={setGroupChatParticipantColors}
							/>
						</>
					)}

				{/* --- CENTER WORKSPACE (hidden when no sessions, group chat is active, or log viewer is open) --- */}
				{sessions.length > 0 && !activeGroupChatId && !logViewerOpen && (
					<MainPanel ref={mainPanelRef} {...mainPanelProps} />
				)}

				{/* --- RIGHT PANEL (hidden in mobile landscape, when no sessions, group chat is active, or log viewer is open) --- */}
				{!isMobileLandscape && sessions.length > 0 && !activeGroupChatId && !logViewerOpen && (
					<ErrorBoundary>
						<RightPanel ref={rightPanelRef} {...rightPanelProps} />
					</ErrorBoundary>
				)}

				{/* Old settings modal removed - using new SettingsModal component below */}
				{/* NOTE: NewInstanceModal and EditAgentModal are now rendered via AppSessionModals */}

				{/* --- SETTINGS MODAL (Lazy-loaded for performance) --- */}
				{settingsModalOpen && (
					<Suspense fallback={null}>
						<SettingsModal
							isOpen={settingsModalOpen}
							onClose={handleCloseSettings}
							theme={theme}
							themes={THEMES}
							initialTab={settingsTab}
							hasNoAgents={hasNoAgents}
							onThemeImportError={(msg) => setFlashNotification(msg)}
							onThemeImportSuccess={(msg) => setFlashNotification(msg)}
						/>
					</Suspense>
				)}

				{/* --- WIZARD RESUME MODAL (asks if user wants to resume incomplete wizard) --- */}
				{wizardResumeModalOpen && wizardResumeState && (
					<WizardResumeModal
						theme={theme}
						resumeState={wizardResumeState}
						onResume={handleWizardResume}
						onStartFresh={handleWizardStartFresh}
						onClose={handleWizardResumeClose}
					/>
				)}

				{/* --- MAESTRO WIZARD (onboarding wizard for new users) --- */}
				{/* PERF: Only mount wizard component when open to avoid running hooks/effects */}
				{wizardState.isOpen && (
					<MaestroWizard
						theme={theme}
						onLaunchSession={handleWizardLaunchSession}
						onWizardStart={recordWizardStart}
						onWizardResume={recordWizardResume}
						onWizardAbandon={recordWizardAbandon}
						onWizardComplete={recordWizardComplete}
					/>
				)}

				{/* --- TOUR OVERLAY (onboarding tour for interface guidance) --- */}
				{/* PERF: Only mount tour component when open to avoid running hooks/effects */}
				{tourOpen && (
					<TourOverlay
						theme={theme}
						isOpen={tourOpen}
						fromWizard={tourFromWizard}
						shortcuts={{ ...shortcuts, ...tabShortcuts }}
						onClose={() => {
							setTourOpen(false);
							setTourCompleted(true);
						}}
						onTourStart={recordTourStart}
						onTourComplete={recordTourComplete}
						onTourSkip={recordTourSkip}
					/>
				)}

				{/* --- FLASH NOTIFICATION (centered, auto-dismiss) --- */}
				{flashNotification && (
					<div
						className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 px-6 py-4 rounded-lg shadow-2xl text-base font-bold animate-in fade-in zoom-in-95 duration-200 z-[9999]"
						style={{
							backgroundColor: theme.colors.warning,
							color: '#000000',
							textShadow: '0 1px 2px rgba(255, 255, 255, 0.3)',
						}}
					>
						{flashNotification}
					</div>
				)}

				{/* --- SUCCESS FLASH NOTIFICATION (centered, auto-dismiss) --- */}
				{successFlashNotification && (
					<div
						className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 px-6 py-4 rounded-lg shadow-2xl text-base font-bold animate-in fade-in zoom-in-95 duration-200 z-[9999]"
						style={{
							backgroundColor: theme.colors.accent,
							color: theme.colors.accentForeground,
							textShadow: '0 1px 2px rgba(0, 0, 0, 0.3)',
						}}
					>
						{successFlashNotification}
					</div>
				)}

				{/* --- TOAST NOTIFICATIONS --- */}
				<ToastContainer theme={theme} onSessionClick={handleToastSessionClick} />
			</div>
		</GitStatusProvider>
	);
}

/**
 * MaestroConsole - Main application component with context providers
 *
 * Wraps MaestroConsoleInner with context providers for centralized state management.
 * Remaining providers:
 * - ProjectFoldersProvider: project folder state
 * - InlineWizardProvider: inline /wizard command state
 * - InputProvider: centralized input state
 * Removed providers (migrated to Zustand): ModalProvider, UILayoutProvider,
 * AutoRunProvider, GroupChatProvider, ToastProvider, SessionProvider.
 */
export default function MaestroConsole() {
	return (
		<ProjectFoldersProvider>
			<InlineWizardProvider>
				<InputProvider>
					<MaestroConsoleInner />
				</InputProvider>
			</InlineWizardProvider>
		</ProjectFoldersProvider>
	);
}
