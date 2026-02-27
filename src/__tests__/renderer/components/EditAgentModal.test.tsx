/**
 * @fileoverview Tests for EditAgentModal git re-scan feature
 * Tests: git rescan button visibility, scanning states, result handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { EditAgentModal } from '../../../renderer/components/NewInstanceModal';
import type { Theme, Session } from '../../../renderer/types';

// lucide-react icons are mocked globally in src/__tests__/setup.ts using a Proxy

// Mock layer stack context (required by Modal component)
const mockRegisterLayer = vi.fn(() => 'layer-edit-agent-123');
const mockUnregisterLayer = vi.fn();
const mockUpdateLayerHandler = vi.fn();

vi.mock('../../../renderer/contexts/LayerStackContext', () => ({
	useLayerStack: () => ({
		registerLayer: mockRegisterLayer,
		unregisterLayer: mockUnregisterLayer,
		updateLayerHandler: mockUpdateLayerHandler,
	}),
}));

// Create test theme (matches NewInstanceModal.test.tsx pattern)
const createTheme = (): Theme => ({
	id: 'test-dark',
	name: 'Test Dark',
	mode: 'dark',
	colors: {
		bgMain: '#1a1a2e',
		bgSidebar: '#16213e',
		bgActivity: '#0f3460',
		textMain: '#e8e8e8',
		textDim: '#888888',
		accent: '#7b2cbf',
		accentDim: '#5a1f8f',
		accentForeground: '#ffffff',
		border: '#333355',
		success: '#22c55e',
		warning: '#f59e0b',
		error: '#ef4444',
		info: '#3b82f6',
		bgAccentHover: '#9333ea',
	},
});

describe('EditAgentModal — Git Re-scan Feature', () => {
	let theme: Theme;
	let mockOnSave: ReturnType<typeof vi.fn>;
	let mockOnClose: ReturnType<typeof vi.fn>;
	let mockOnRescanGit: ReturnType<typeof vi.fn>;

	const baseSession: Session = {
		id: 'test-session-1',
		name: 'Test Session',
		toolType: 'claude-code',
		state: 'idle',
		cwd: '/home/user/project',
		fullPath: '/home/user/project',
		projectRoot: '/home/user/project',
		isGitRepo: false,
		aiLogs: [],
		shellLogs: [],
		workLog: [],
		contextUsage: 0,
		inputMode: 'ai',
		aiPid: 0,
		terminalPid: 0,
		port: 3000,
		isLive: false,
		changedFiles: [],
		fileTree: [],
		fileExplorerExpanded: [],
		fileExplorerScrollPos: 0,
		fileTreeAutoRefreshInterval: 180,
		shellCwd: '/home/user/project',
		aiCommandHistory: [],
		shellCommandHistory: [],
		executionQueue: [],
		activeTimeMs: 0,
		aiTabs: [
			{
				id: 'tab-1',
				agentSessionId: null,
				name: null,
				starred: false,
				logs: [],
				inputValue: '',
				stagedImages: [],
				createdAt: Date.now(),
				state: 'idle',
				saveToHistory: true,
				showThinking: false,
			},
		],
		activeTabId: 'tab-1',
		closedTabHistory: [],
	};

	beforeEach(() => {
		theme = createTheme();
		mockOnSave = vi.fn();
		mockOnClose = vi.fn();
		mockOnRescanGit = vi.fn();

		// Reset layer stack mocks
		mockRegisterLayer.mockClear().mockReturnValue('layer-edit-agent-123');
		mockUnregisterLayer.mockClear();
		mockUpdateLayerHandler.mockClear();

		// Setup mocks for APIs called by EditAgentModal on mount
		vi.mocked(window.maestro.agents.detect).mockResolvedValue([
			{
				id: 'claude-code',
				name: 'Claude Code',
				available: true,
				path: '/usr/local/bin/claude',
				binaryName: 'claude',
				hidden: false,
			},
		]);
		vi.mocked(window.maestro.agents.getConfig).mockResolvedValue({});
		vi.mocked(window.maestro.sshRemote.getConfigs).mockResolvedValue({
			success: true,
			configs: [],
		});

		// APIs not in global setup — add them dynamically
		(window.maestro.agents as any).getPricingConfig = vi.fn().mockResolvedValue(null);
		(window.maestro.agents as any).detectAuth = vi.fn().mockResolvedValue(null);
		(window.maestro.agents as any).getVersion = vi.fn().mockResolvedValue({ success: false });
		(window.maestro.agents as any).getHostSettings = vi.fn().mockResolvedValue({ success: false });
		(window.maestro.agents as any).setPricingConfig = vi.fn().mockResolvedValue(undefined);
		// PricingModelDropdown uses window.maestro.updates
		(window.maestro as any).updates = {
			getModelOptions: vi.fn().mockResolvedValue([]),
			getHostSettings: vi.fn().mockResolvedValue({ success: false }),
		};
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('should show "Re-scan for Git Repository" button for non-git sessions', async () => {
		await act(async () => {
			render(
				<EditAgentModal
					isOpen={true}
					onClose={mockOnClose}
					onSave={mockOnSave}
					onRescanGit={mockOnRescanGit}
					onSelectGitSubdir={vi.fn()}
					theme={theme}
					session={baseSession}
					existingSessions={[]}
				/>
			);
		});

		await waitFor(() => {
			expect(screen.getByText('Re-scan for Git Repository')).toBeTruthy();
		});
	});

	it('should show "Git repository detected" for sessions that are already git repos', async () => {
		const gitSession = { ...baseSession, isGitRepo: true };

		await act(async () => {
			render(
				<EditAgentModal
					isOpen={true}
					onClose={mockOnClose}
					onSave={mockOnSave}
					onRescanGit={mockOnRescanGit}
					onSelectGitSubdir={vi.fn()}
					theme={theme}
					session={gitSession}
					existingSessions={[]}
				/>
			);
		});

		await waitFor(() => {
			expect(screen.getByText('Git repository detected')).toBeTruthy();
		});
	});

	it('should call onRescanGit when button is clicked', async () => {
		mockOnRescanGit.mockResolvedValue(true);

		await act(async () => {
			render(
				<EditAgentModal
					isOpen={true}
					onClose={mockOnClose}
					onSave={mockOnSave}
					onRescanGit={mockOnRescanGit}
					onSelectGitSubdir={vi.fn()}
					theme={theme}
					session={baseSession}
					existingSessions={[]}
				/>
			);
		});

		await waitFor(() => {
			expect(screen.getByText('Re-scan for Git Repository')).toBeTruthy();
		});

		await act(async () => {
			fireEvent.click(screen.getByText('Re-scan for Git Repository'));
		});

		expect(mockOnRescanGit).toHaveBeenCalledWith('test-session-1');
	});

	it('should show "Git repository detected" after successful scan', async () => {
		mockOnRescanGit.mockResolvedValue(true);

		await act(async () => {
			render(
				<EditAgentModal
					isOpen={true}
					onClose={mockOnClose}
					onSave={mockOnSave}
					onRescanGit={mockOnRescanGit}
					onSelectGitSubdir={vi.fn()}
					theme={theme}
					session={baseSession}
					existingSessions={[]}
				/>
			);
		});

		await waitFor(() => {
			expect(screen.getByText('Re-scan for Git Repository')).toBeTruthy();
		});

		await act(async () => {
			fireEvent.click(screen.getByText('Re-scan for Git Repository'));
		});

		await waitFor(() => {
			expect(screen.getByText('Git repository detected')).toBeTruthy();
		});
	});

	it('should show "No Git repository found" with Retry button after failed scan', async () => {
		mockOnRescanGit.mockResolvedValue(false);

		await act(async () => {
			render(
				<EditAgentModal
					isOpen={true}
					onClose={mockOnClose}
					onSave={mockOnSave}
					onRescanGit={mockOnRescanGit}
					onSelectGitSubdir={vi.fn()}
					theme={theme}
					session={baseSession}
					existingSessions={[]}
				/>
			);
		});

		await waitFor(() => {
			expect(screen.getByText('Re-scan for Git Repository')).toBeTruthy();
		});

		await act(async () => {
			fireEvent.click(screen.getByText('Re-scan for Git Repository'));
		});

		await waitFor(() => {
			expect(screen.getByText('No Git repository found')).toBeTruthy();
			expect(screen.getByText('Retry')).toBeTruthy();
		});
	});

	it('should not render anything when modal is closed', async () => {
		const { container } = render(
			<EditAgentModal
				isOpen={false}
				onClose={mockOnClose}
				onSave={mockOnSave}
				onRescanGit={mockOnRescanGit}
				onSelectGitSubdir={vi.fn()}
				theme={theme}
				session={baseSession}
				existingSessions={[]}
			/>
		);

		// Modal should not render content when closed
		expect(container.firstChild).toBeNull();
	});
});

describe('EditAgentModal — Subdirectory Git Scanning (Option C)', () => {
	let theme: Theme;
	let mockOnSave: ReturnType<typeof vi.fn>;
	let mockOnClose: ReturnType<typeof vi.fn>;
	let mockOnRescanGit: ReturnType<typeof vi.fn>;
	let mockOnSelectGitSubdir: ReturnType<typeof vi.fn>;

	const baseSession: Session = {
		id: 'test-session-subdir',
		name: 'Test Subdir Session',
		toolType: 'claude-code',
		state: 'idle',
		cwd: '/home/user/projects',
		fullPath: '/home/user/projects',
		projectRoot: '/home/user/projects',
		isGitRepo: false,
		aiLogs: [],
		shellLogs: [],
		workLog: [],
		contextUsage: 0,
		inputMode: 'ai',
		aiPid: 0,
		terminalPid: 0,
		port: 3000,
		isLive: false,
		changedFiles: [],
		fileTree: [],
		fileExplorerExpanded: [],
		fileExplorerScrollPos: 0,
		fileTreeAutoRefreshInterval: 180,
		shellCwd: '/home/user/projects',
		aiCommandHistory: [],
		shellCommandHistory: [],
		executionQueue: [],
		activeTimeMs: 0,
		aiTabs: [
			{
				id: 'tab-sub-1',
				agentSessionId: null,
				name: null,
				starred: false,
				logs: [],
				inputValue: '',
				stagedImages: [],
				createdAt: Date.now(),
				state: 'idle',
				saveToHistory: true,
				showThinking: false,
			},
		],
		activeTabId: 'tab-sub-1',
		closedTabHistory: [],
	};

	beforeEach(() => {
		theme = createTheme();
		mockOnSave = vi.fn();
		mockOnClose = vi.fn();
		mockOnRescanGit = vi.fn();
		mockOnSelectGitSubdir = vi.fn();

		mockRegisterLayer.mockClear().mockReturnValue('layer-edit-subdir-123');
		mockUnregisterLayer.mockClear();
		mockUpdateLayerHandler.mockClear();

		vi.mocked(window.maestro.agents.detect).mockResolvedValue([
			{
				id: 'claude-code',
				name: 'Claude Code',
				available: true,
				path: '/usr/local/bin/claude',
				binaryName: 'claude',
				hidden: false,
			},
		]);
		vi.mocked(window.maestro.agents.getConfig).mockResolvedValue({});
		vi.mocked(window.maestro.sshRemote.getConfigs).mockResolvedValue({
			success: true,
			configs: [],
		});
		(window.maestro.agents as any).getPricingConfig = vi.fn().mockResolvedValue(null);
		(window.maestro.agents as any).detectAuth = vi.fn().mockResolvedValue(null);
		(window.maestro.agents as any).getVersion = vi.fn().mockResolvedValue({ success: false });
		(window.maestro.agents as any).getHostSettings = vi.fn().mockResolvedValue({ success: false });
		(window.maestro.agents as any).setPricingConfig = vi.fn().mockResolvedValue(undefined);
		(window.maestro as any).updates = {
			getModelOptions: vi.fn().mockResolvedValue([]),
			getHostSettings: vi.fn().mockResolvedValue({ success: false }),
		};
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('should handle subdirs-found return and show selection UI', async () => {
		// Session with scan results pre-populated — chooser should appear automatically
		// (race condition fix: useEffect derives gitScanStatus from session.gitSubdirScanResults)
		const sessionWithSubdirs: Session = {
			...baseSession,
			gitSubdirScanResults: [
				{
					path: '/home/user/projects/app-one',
					name: 'app-one',
					isWorktree: false,
					branch: 'main',
					repoRoot: '/home/user/projects/app-one',
				},
				{
					path: '/home/user/projects/app-two',
					name: 'app-two',
					isWorktree: false,
					branch: 'develop',
					repoRoot: '/home/user/projects/app-two',
				},
			],
		};

		await act(async () => {
			render(
				<EditAgentModal
					isOpen={true}
					onClose={mockOnClose}
					onSave={mockOnSave}
					onRescanGit={mockOnRescanGit}
					onSelectGitSubdir={mockOnSelectGitSubdir}
					theme={theme}
					session={sessionWithSubdirs}
					existingSessions={[]}
				/>
			);
		});

		// Chooser should appear automatically — no Re-scan click needed
		await waitFor(() => {
			expect(screen.getByText(/Git repositories found/)).toBeTruthy();
		});
	});

	it('should show gitRoot subdirectory name when repo is in a subdirectory', async () => {
		const sessionWithGitRoot: Session = {
			...baseSession,
			isGitRepo: true,
			gitRoot: '/home/user/projects/my-app',
		};

		await act(async () => {
			render(
				<EditAgentModal
					isOpen={true}
					onClose={mockOnClose}
					onSave={mockOnSave}
					onRescanGit={mockOnRescanGit}
					onSelectGitSubdir={mockOnSelectGitSubdir}
					theme={theme}
					session={sessionWithGitRoot}
					existingSessions={[]}
				/>
			);
		});

		// Should show "Git repository detected" with subdirectory name
		await waitFor(() => {
			expect(screen.getByText('Git repository detected')).toBeTruthy();
			expect(screen.getByText(/(my-app\/)/)).toBeTruthy();
		});
	});

	it('should NOT show subdirectory name when gitRoot equals cwd', async () => {
		const sessionNormalGit: Session = {
			...baseSession,
			isGitRepo: true,
			gitRoot: '/home/user/projects', // same as cwd
		};

		await act(async () => {
			render(
				<EditAgentModal
					isOpen={true}
					onClose={mockOnClose}
					onSave={mockOnSave}
					onRescanGit={mockOnRescanGit}
					onSelectGitSubdir={mockOnSelectGitSubdir}
					theme={theme}
					session={sessionNormalGit}
					existingSessions={[]}
				/>
			);
		});

		await waitFor(() => {
			expect(screen.getByText('Git repository detected')).toBeTruthy();
		});

		// Should NOT show any parenthesized subdirectory name
		expect(screen.queryByText(/(projects\/)/)).toBeNull();
	});

	it('should call onSelectGitSubdir when a subdirectory is clicked', async () => {
		mockOnSelectGitSubdir.mockResolvedValue(true);

		const sessionWithSubdirs: Session = {
			...baseSession,
			gitSubdirScanResults: [
				{
					path: '/home/user/projects/repo-a',
					name: 'repo-a',
					isWorktree: false,
					branch: 'main',
					repoRoot: '/home/user/projects/repo-a',
				},
				{
					path: '/home/user/projects/repo-b',
					name: 'repo-b',
					isWorktree: true,
					branch: 'feature',
					repoRoot: '/home/user/projects/repo-b',
				},
			],
		};

		await act(async () => {
			render(
				<EditAgentModal
					isOpen={true}
					onClose={mockOnClose}
					onSave={mockOnSave}
					onRescanGit={mockOnRescanGit}
					onSelectGitSubdir={mockOnSelectGitSubdir}
					theme={theme}
					session={sessionWithSubdirs}
					existingSessions={[]}
				/>
			);
		});

		// Chooser should appear automatically (race condition fix)
		await waitFor(() => {
			expect(screen.getByText(/Git repositories found/)).toBeTruthy();
		});

		// Click on the first subdirectory
		await act(async () => {
			fireEvent.click(screen.getByText('repo-a/'));
		});

		expect(mockOnSelectGitSubdir).toHaveBeenCalledWith(
			'test-session-subdir',
			'/home/user/projects/repo-a'
		);
	});

	it('should pass onSelectGitSubdir prop without errors', async () => {
		await act(async () => {
			render(
				<EditAgentModal
					isOpen={true}
					onClose={mockOnClose}
					onSave={mockOnSave}
					onRescanGit={mockOnRescanGit}
					onSelectGitSubdir={mockOnSelectGitSubdir}
					theme={theme}
					session={baseSession}
					existingSessions={[]}
				/>
			);
		});

		// Should render without errors
		await waitFor(() => {
			expect(screen.getByText('Re-scan for Git Repository')).toBeTruthy();
		});
	});

	it('should show subdirectory chooser automatically when session has gitSubdirScanResults on open', async () => {
		// This tests the race condition fix: when editAgentSession is updated with
		// gitSubdirScanResults (e.g., from onSshRemote background detection),
		// the chooser should appear without needing a Re-scan click.
		const sessionWithSubdirs: Session = {
			...baseSession,
			isGitRepo: false,
			gitSubdirScanResults: [
				{
					path: '/home/user/projects/repo-a',
					name: 'repo-a',
					isWorktree: false,
					branch: 'main',
					repoRoot: '/home/user/projects/repo-a',
				},
				{
					path: '/home/user/projects/repo-b',
					name: 'repo-b',
					isWorktree: false,
					branch: 'develop',
					repoRoot: '/home/user/projects/repo-b',
				},
			],
		};

		await act(async () => {
			render(
				<EditAgentModal
					isOpen={true}
					onClose={mockOnClose}
					onSave={mockOnSave}
					onRescanGit={mockOnRescanGit}
					onSelectGitSubdir={mockOnSelectGitSubdir}
					theme={theme}
					session={sessionWithSubdirs}
					existingSessions={[]}
				/>
			);
		});

		// Chooser should appear automatically — no Re-scan click needed
		await waitFor(() => {
			expect(screen.getByText(/Git repositories found/)).toBeTruthy();
			expect(screen.getByText('repo-a/')).toBeTruthy();
			expect(screen.getByText('repo-b/')).toBeTruthy();
		});
	});

	it('should show chooser when session prop updates with gitSubdirScanResults after initial render', async () => {
		// This simulates the real-world flow: modal opens with no scan results,
		// then the session prop is updated (via useEffect sync in App.tsx) with results.
		const initialSession: Session = {
			...baseSession,
			isGitRepo: false,
			gitSubdirScanResults: undefined,
		};

		const { rerender } = await act(async () => {
			return render(
				<EditAgentModal
					isOpen={true}
					onClose={mockOnClose}
					onSave={mockOnSave}
					onRescanGit={mockOnRescanGit}
					onSelectGitSubdir={mockOnSelectGitSubdir}
					theme={theme}
					session={initialSession}
					existingSessions={[]}
				/>
			);
		});

		// Initially should show Re-scan button
		await waitFor(() => {
			expect(screen.getByText('Re-scan for Git Repository')).toBeTruthy();
		});

		// Now simulate session prop update with gitSubdirScanResults
		const updatedSession: Session = {
			...initialSession,
			gitSubdirScanResults: [
				{
					path: '/home/user/projects/app-x',
					name: 'app-x',
					isWorktree: false,
					branch: 'main',
					repoRoot: '/home/user/projects/app-x',
				},
				{
					path: '/home/user/projects/app-y',
					name: 'app-y',
					isWorktree: true,
					branch: 'feature',
					repoRoot: '/home/user/projects/app-y',
				},
			],
		};

		await act(async () => {
			rerender(
				<EditAgentModal
					isOpen={true}
					onClose={mockOnClose}
					onSave={mockOnSave}
					onRescanGit={mockOnRescanGit}
					onSelectGitSubdir={mockOnSelectGitSubdir}
					theme={theme}
					session={updatedSession}
					existingSessions={[]}
				/>
			);
		});

		// Chooser should now appear automatically
		await waitFor(() => {
			expect(screen.getByText(/Git repositories found/)).toBeTruthy();
			expect(screen.getByText('app-x/')).toBeTruthy();
			expect(screen.getByText('app-y/')).toBeTruthy();
		});
	});

	it('should NOT show chooser when session.isGitRepo is true even if gitSubdirScanResults exists', async () => {
		// Edge case: isGitRepo=true takes precedence — show "detected", not chooser
		const sessionGitDetectedWithStaleResults: Session = {
			...baseSession,
			isGitRepo: true,
			gitRoot: '/home/user/projects/repo-a',
			gitSubdirScanResults: [
				{
					path: '/home/user/projects/repo-a',
					name: 'repo-a',
					isWorktree: false,
					branch: 'main',
					repoRoot: '/home/user/projects/repo-a',
				},
				{
					path: '/home/user/projects/repo-b',
					name: 'repo-b',
					isWorktree: false,
					branch: 'develop',
					repoRoot: '/home/user/projects/repo-b',
				},
			],
		};

		await act(async () => {
			render(
				<EditAgentModal
					isOpen={true}
					onClose={mockOnClose}
					onSave={mockOnSave}
					onRescanGit={mockOnRescanGit}
					onSelectGitSubdir={mockOnSelectGitSubdir}
					theme={theme}
					session={sessionGitDetectedWithStaleResults}
					existingSessions={[]}
				/>
			);
		});

		await waitFor(() => {
			expect(screen.getByText('Git repository detected')).toBeTruthy();
		});

		// Should NOT show the chooser
		expect(screen.queryByText(/Git repositories found/)).toBeNull();
	});

	it('should show worktree badge for worktree subdirectories in chooser', async () => {
		const sessionWithWorktree: Session = {
			...baseSession,
			isGitRepo: false,
			gitSubdirScanResults: [
				{
					path: '/home/user/projects/main-repo',
					name: 'main-repo',
					isWorktree: false,
					branch: 'main',
					repoRoot: '/home/user/projects/main-repo',
				},
				{
					path: '/home/user/projects/wt-feature',
					name: 'wt-feature',
					isWorktree: true,
					branch: 'feature/login',
					repoRoot: '/home/user/projects/main-repo',
				},
			],
		};

		await act(async () => {
			render(
				<EditAgentModal
					isOpen={true}
					onClose={mockOnClose}
					onSave={mockOnSave}
					onRescanGit={mockOnRescanGit}
					onSelectGitSubdir={mockOnSelectGitSubdir}
					theme={theme}
					session={sessionWithWorktree}
					existingSessions={[]}
				/>
			);
		});

		await waitFor(() => {
			expect(screen.getByText(/Git repositories found/)).toBeTruthy();
			expect(screen.getByText('main-repo/')).toBeTruthy();
			expect(screen.getByText('wt-feature/')).toBeTruthy();
			expect(screen.getByText('worktree')).toBeTruthy();
		});
	});

	it('should transition from chooser to "detected" after selecting a subdirectory', async () => {
		mockOnSelectGitSubdir.mockResolvedValue(true);

		const sessionWithSubdirs: Session = {
			...baseSession,
			isGitRepo: false,
			gitSubdirScanResults: [
				{
					path: '/home/user/projects/repo-a',
					name: 'repo-a',
					isWorktree: false,
					branch: 'main',
					repoRoot: '/home/user/projects/repo-a',
				},
				{
					path: '/home/user/projects/repo-b',
					name: 'repo-b',
					isWorktree: false,
					branch: 'develop',
					repoRoot: '/home/user/projects/repo-b',
				},
			],
		};

		await act(async () => {
			render(
				<EditAgentModal
					isOpen={true}
					onClose={mockOnClose}
					onSave={mockOnSave}
					onRescanGit={mockOnRescanGit}
					onSelectGitSubdir={mockOnSelectGitSubdir}
					theme={theme}
					session={sessionWithSubdirs}
					existingSessions={[]}
				/>
			);
		});

		// Chooser should be visible
		await waitFor(() => {
			expect(screen.getByText(/Git repositories found/)).toBeTruthy();
		});

		// Click on repo-a
		await act(async () => {
			fireEvent.click(screen.getByText('repo-a/'));
		});

		// After selection, onSelectGitSubdir returns true → status becomes 'found'
		await waitFor(() => {
			expect(screen.getByText('Git repository detected')).toBeTruthy();
		});

		expect(mockOnSelectGitSubdir).toHaveBeenCalledWith(
			'test-session-subdir',
			'/home/user/projects/repo-a'
		);
	});
});
