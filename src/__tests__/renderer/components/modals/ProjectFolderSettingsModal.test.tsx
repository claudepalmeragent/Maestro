/**
 * @fileoverview Tests for ProjectFolderSettingsModal component
 * Tests: Modal rendering, project-level toggle, agent table, cascade behavior
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ProjectFolderSettingsModal } from '../../../../renderer/components/modals/ProjectFolderSettingsModal';
import { LayerStackProvider } from '../../../../renderer/contexts/LayerStackContext';
import type { Theme, Session } from '../../../../renderer/types';
import type { ProjectFolder } from '../../../../shared/types';

// Mock lucide-react
vi.mock('lucide-react', () => ({
	X: () => <svg data-testid="x-icon" />,
	AlertTriangle: () => <svg data-testid="alert-triangle-icon" />,
}));

// =============================================================================
// TEST HELPERS
// =============================================================================

function createMockTheme(): Theme {
	return {
		id: 'test-theme',
		name: 'Test Theme',
		colors: {
			bgMain: '#1a1a1a',
			bgSidebar: '#252525',
			bgActivity: '#333333',
			textMain: '#ffffff',
			textDim: '#888888',
			accent: '#6366f1',
			accentDim: '#4f46e5',
			accentForeground: '#ffffff',
			border: '#333333',
			success: '#22c55e',
			error: '#ef4444',
			warning: '#f59e0b',
			contextFree: '#22c55e',
			contextMedium: '#f59e0b',
			contextHigh: '#ef4444',
		},
	};
}

function createMockFolder(overrides: Partial<ProjectFolder> = {}): ProjectFolder {
	return {
		id: 'folder-1',
		name: 'TEST FOLDER',
		emoji: '📁',
		collapsed: false,
		order: 0,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		...overrides,
	};
}

function createMockSession(overrides: Partial<Session> = {}): Session {
	return {
		id: 'session-1',
		name: 'Test Agent',
		toolType: 'claude-code',
		state: 'idle',
		cwd: '/test',
		fullPath: '/test',
		projectRoot: '/test',
		aiLogs: [],
		shellLogs: [],
		workLog: [],
		contextUsage: 0,
		inputMode: 'ai',
		aiPid: 0,
		terminalPid: 0,
		port: 0,
		isLive: false,
		changedFiles: [],
		isGitRepo: false,
		fileTree: [],
		fileExplorerExpanded: [],
		fileExplorerScrollPos: 0,
		executionQueue: [],
		activeTimeMs: 0,
		aiTabs: [],
		activeTabId: '',
		closedTabHistory: [],
		projectFolderIds: ['folder-1'],
		...overrides,
	} as Session;
}

// =============================================================================
// MOCKS
// =============================================================================

const mockGetPricingConfig = vi.fn();
const mockDetectAuth = vi.fn();
const mockSetPricingConfig = vi.fn();
const mockSetFolderPricingConfig = vi.fn();

// Helper to render with LayerStackProvider
const renderWithProvider = (ui: React.ReactElement) => {
	return render(<LayerStackProvider>{ui}</LayerStackProvider>);
};

beforeEach(() => {
	vi.clearAllMocks();

	// Setup default mocks
	mockGetPricingConfig.mockResolvedValue({ billingMode: 'auto', pricingModel: 'auto' });
	mockDetectAuth.mockResolvedValue({
		billingMode: 'max',
		source: 'oauth',
		detectedAt: Date.now(),
	});
	mockSetPricingConfig.mockResolvedValue(true);
	mockSetFolderPricingConfig.mockResolvedValue(true);

	// Extend the existing window.maestro mock from setup.ts
	// The setup.ts already defines window.maestro, so we just need to add/override specific methods
	if (window.maestro) {
		window.maestro.agents.getPricingConfig = mockGetPricingConfig;
		window.maestro.agents.detectAuth = mockDetectAuth;
		window.maestro.agents.setPricingConfig = mockSetPricingConfig;
		// Add projectFolders if it doesn't exist
		if (!window.maestro.projectFolders) {
			(window.maestro as any).projectFolders = {};
		}
		(window.maestro as any).projectFolders.setPricingConfig = mockSetFolderPricingConfig;
	}
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

// =============================================================================
// TESTS
// =============================================================================

describe('ProjectFolderSettingsModal', () => {
	describe('Rendering', () => {
		it('should render modal with folder name in title', async () => {
			renderWithProvider(
				<ProjectFolderSettingsModal
					theme={createMockTheme()}
					folder={createMockFolder({ name: 'MY PROJECT' })}
					sessions={[]}
					onClose={vi.fn()}
					onSave={vi.fn()}
				/>
			);

			await waitFor(() => {
				expect(screen.getByText(/MY PROJECT - Folder Settings/)).toBeInTheDocument();
			});
		});

		it('should show loading state initially', () => {
			renderWithProvider(
				<ProjectFolderSettingsModal
					theme={createMockTheme()}
					folder={createMockFolder()}
					sessions={[createMockSession()]}
					onClose={vi.fn()}
					onSave={vi.fn()}
				/>
			);

			expect(screen.getByText('Loading agent configurations...')).toBeInTheDocument();
		});

		it('should show empty state when no agents in folder', async () => {
			renderWithProvider(
				<ProjectFolderSettingsModal
					theme={createMockTheme()}
					folder={createMockFolder()}
					sessions={[]}
					onClose={vi.fn()}
					onSave={vi.fn()}
				/>
			);

			await waitFor(() => {
				expect(screen.getByText('No agents in this folder yet.')).toBeInTheDocument();
			});
		});

		it('should render agent table when sessions exist', async () => {
			renderWithProvider(
				<ProjectFolderSettingsModal
					theme={createMockTheme()}
					folder={createMockFolder()}
					sessions={[createMockSession({ name: 'Claude Agent 1' })]}
					onClose={vi.fn()}
					onSave={vi.fn()}
				/>
			);

			await waitFor(() => {
				expect(screen.getByText('Claude Agent 1')).toBeInTheDocument();
			});
		});
	});

	describe('Project-Level Toggle', () => {
		it('should show Max and API options', async () => {
			renderWithProvider(
				<ProjectFolderSettingsModal
					theme={createMockTheme()}
					folder={createMockFolder()}
					sessions={[createMockSession()]}
					onClose={vi.fn()}
					onSave={vi.fn()}
				/>
			);

			await waitFor(() => {
				// Project toggle and dropdown both have Max/API, use getAllByText
				expect(screen.getAllByText('Max').length).toBeGreaterThan(0);
				expect(screen.getAllByText('API').length).toBeGreaterThan(0);
			});
		});

		it('should show mixed state indicator when agents have different modes', async () => {
			// First session returns max, second returns api
			mockGetPricingConfig
				.mockResolvedValueOnce({ billingMode: 'max', pricingModel: 'auto' })
				.mockResolvedValueOnce({ billingMode: 'api', pricingModel: 'auto' });

			renderWithProvider(
				<ProjectFolderSettingsModal
					theme={createMockTheme()}
					folder={createMockFolder()}
					sessions={[
						createMockSession({ id: 'session-1', name: 'Agent 1' }),
						createMockSession({ id: 'session-2', name: 'Agent 2' }),
					]}
					onClose={vi.fn()}
					onSave={vi.fn()}
				/>
			);

			await waitFor(() => {
				expect(screen.getByText(/Agents have different billing modes/)).toBeInTheDocument();
			});
		});

		it('should disable toggle when no Claude agents in folder', async () => {
			renderWithProvider(
				<ProjectFolderSettingsModal
					theme={createMockTheme()}
					folder={createMockFolder()}
					sessions={[createMockSession({ toolType: 'terminal' })]}
					onClose={vi.fn()}
					onSave={vi.fn()}
				/>
			);

			await waitFor(() => {
				expect(screen.getByText('No Claude agents in this folder.')).toBeInTheDocument();
			});
		});

		it('should show Max when all agents are auto and all detected as max', async () => {
			// All agents are 'auto' mode, all detected as 'max'
			mockGetPricingConfig.mockResolvedValue({ billingMode: 'auto', pricingModel: 'auto' });
			mockDetectAuth.mockResolvedValue({
				billingMode: 'max',
				source: 'oauth',
				detectedAt: Date.now(),
			});

			renderWithProvider(
				<ProjectFolderSettingsModal
					theme={createMockTheme()}
					folder={createMockFolder()}
					sessions={[
						createMockSession({ id: 'session-1', name: 'Agent 1' }),
						createMockSession({ id: 'session-2', name: 'Agent 2' }),
					]}
					onClose={vi.fn()}
					onSave={vi.fn()}
				/>
			);

			await waitFor(() => {
				// Should NOT show mixed state warning because all detected modes are the same
				expect(screen.queryByText(/Agents have different billing modes/)).not.toBeInTheDocument();
				// Should show the agents loaded
				expect(screen.getByText('Agent 1')).toBeInTheDocument();
			});
		});

		it('should show API when all agents are auto and all detected as api', async () => {
			// All agents are 'auto' mode, all detected as 'api'
			mockGetPricingConfig.mockResolvedValue({ billingMode: 'auto', pricingModel: 'auto' });
			mockDetectAuth.mockResolvedValue({
				billingMode: 'api',
				source: 'api-key',
				detectedAt: Date.now(),
			});

			renderWithProvider(
				<ProjectFolderSettingsModal
					theme={createMockTheme()}
					folder={createMockFolder()}
					sessions={[
						createMockSession({ id: 'session-1', name: 'Agent 1' }),
						createMockSession({ id: 'session-2', name: 'Agent 2' }),
					]}
					onClose={vi.fn()}
					onSave={vi.fn()}
				/>
			);

			await waitFor(() => {
				// Should NOT show mixed state warning because all detected modes are the same
				expect(screen.queryByText(/Agents have different billing modes/)).not.toBeInTheDocument();
				// Should show the agents loaded
				expect(screen.getByText('Agent 1')).toBeInTheDocument();
			});
		});

		it('should show mixed when agents are auto but have different detected modes', async () => {
			// All agents are 'auto' mode, but detected modes differ
			mockGetPricingConfig.mockResolvedValue({ billingMode: 'auto', pricingModel: 'auto' });
			mockDetectAuth
				.mockResolvedValueOnce({
					billingMode: 'max',
					source: 'oauth',
					detectedAt: Date.now(),
				})
				.mockResolvedValueOnce({
					billingMode: 'api',
					source: 'api-key',
					detectedAt: Date.now(),
				});

			renderWithProvider(
				<ProjectFolderSettingsModal
					theme={createMockTheme()}
					folder={createMockFolder()}
					sessions={[
						createMockSession({ id: 'session-1', name: 'Agent 1' }),
						createMockSession({ id: 'session-2', name: 'Agent 2' }),
					]}
					onClose={vi.fn()}
					onSave={vi.fn()}
				/>
			);

			await waitFor(() => {
				// Should show mixed state warning because detected modes differ
				expect(screen.getByText(/Agents have different billing modes/)).toBeInTheDocument();
			});
		});
	});

	describe('Agent Table', () => {
		it('should show billing dropdown for Claude agents', async () => {
			renderWithProvider(
				<ProjectFolderSettingsModal
					theme={createMockTheme()}
					folder={createMockFolder()}
					sessions={[createMockSession({ toolType: 'claude-code' })]}
					onClose={vi.fn()}
					onSave={vi.fn()}
				/>
			);

			await waitFor(() => {
				// Should have a select/dropdown for billing mode
				const selects = screen.getAllByRole('combobox');
				expect(selects.length).toBeGreaterThan(0);
			});
		});

		it('should show N/A for non-Claude agents', async () => {
			renderWithProvider(
				<ProjectFolderSettingsModal
					theme={createMockTheme()}
					folder={createMockFolder()}
					sessions={[createMockSession({ toolType: 'terminal', name: 'Terminal Session' })]}
					onClose={vi.fn()}
					onSave={vi.fn()}
				/>
			);

			await waitFor(() => {
				expect(screen.getByText('N/A')).toBeInTheDocument();
			});
		});

		it('should show detected auth indicator', async () => {
			mockDetectAuth.mockResolvedValue({
				billingMode: 'max',
				source: 'oauth',
				detectedAt: Date.now(),
			});

			renderWithProvider(
				<ProjectFolderSettingsModal
					theme={createMockTheme()}
					folder={createMockFolder()}
					sessions={[createMockSession()]}
					onClose={vi.fn()}
					onSave={vi.fn()}
				/>
			);

			await waitFor(() => {
				expect(screen.getByText('OAuth (Max)')).toBeInTheDocument();
			});
		});
	});

	describe('Cascade Behavior', () => {
		it('should update all Claude agents when project toggle changes', async () => {
			mockGetPricingConfig.mockResolvedValue({ billingMode: 'auto', pricingModel: 'auto' });

			renderWithProvider(
				<ProjectFolderSettingsModal
					theme={createMockTheme()}
					folder={createMockFolder()}
					sessions={[
						createMockSession({ id: 'session-1', name: 'Agent 1' }),
						createMockSession({ id: 'session-2', name: 'Agent 2' }),
					]}
					onClose={vi.fn()}
					onSave={vi.fn()}
				/>
			);

			// Wait for initial load
			await waitFor(() => {
				expect(screen.getByText('Agent 1')).toBeInTheDocument();
			});

			// Click Max toggle - get all Max buttons and click the first one (project toggle)
			const maxButtons = screen.getAllByText('Max');
			fireEvent.click(maxButtons[0]);

			// Save button should be enabled
			const saveButton = screen.getByText('Save');
			expect(saveButton).not.toBeDisabled();
		});

		it('should enable save button when individual agent changes', async () => {
			renderWithProvider(
				<ProjectFolderSettingsModal
					theme={createMockTheme()}
					folder={createMockFolder()}
					sessions={[createMockSession()]}
					onClose={vi.fn()}
					onSave={vi.fn()}
				/>
			);

			await waitFor(() => {
				const selects = screen.getAllByRole('combobox');
				expect(selects.length).toBeGreaterThan(0);
			});

			// Change individual agent billing mode
			const select = screen.getAllByRole('combobox')[0];
			fireEvent.change(select, { target: { value: 'api' } });

			// Save button should be enabled
			const saveButton = screen.getByText('Save');
			expect(saveButton).not.toBeDisabled();
		});
	});

	describe('Save Behavior', () => {
		it('should call onSave and onClose when save is clicked', async () => {
			const onSave = vi.fn();
			const onClose = vi.fn();

			renderWithProvider(
				<ProjectFolderSettingsModal
					theme={createMockTheme()}
					folder={createMockFolder()}
					sessions={[createMockSession()]}
					onClose={onClose}
					onSave={onSave}
				/>
			);

			await waitFor(() => {
				expect(screen.getByText('Test Agent')).toBeInTheDocument();
			});

			// Make a change to enable save - get all Max buttons and click the first one (project toggle)
			const maxButtons = screen.getAllByText('Max');
			fireEvent.click(maxButtons[0]);

			// Click save
			const saveButton = screen.getByText('Save');
			fireEvent.click(saveButton);

			await waitFor(() => {
				expect(onSave).toHaveBeenCalled();
				expect(onClose).toHaveBeenCalled();
			});
		});

		it('should call setPricingConfig for changed agents', async () => {
			renderWithProvider(
				<ProjectFolderSettingsModal
					theme={createMockTheme()}
					folder={createMockFolder()}
					sessions={[createMockSession()]}
					onClose={vi.fn()}
					onSave={vi.fn()}
				/>
			);

			await waitFor(() => {
				expect(screen.getByText('Test Agent')).toBeInTheDocument();
			});

			// Change to Max - get all Max buttons and click the first one (project toggle)
			const maxButtons = screen.getAllByText('Max');
			fireEvent.click(maxButtons[0]);

			// Save
			const saveButton = screen.getByText('Save');
			fireEvent.click(saveButton);

			await waitFor(() => {
				expect(mockSetPricingConfig).toHaveBeenCalledWith('claude-code', {
					billingMode: 'max',
				});
			});
		});

		it('should save button be disabled when no changes', async () => {
			renderWithProvider(
				<ProjectFolderSettingsModal
					theme={createMockTheme()}
					folder={createMockFolder()}
					sessions={[createMockSession()]}
					onClose={vi.fn()}
					onSave={vi.fn()}
				/>
			);

			await waitFor(() => {
				expect(screen.getByText('Test Agent')).toBeInTheDocument();
			});

			// Save button should be disabled initially
			const saveButton = screen.getByText('Save');
			expect(saveButton).toBeDisabled();
		});
	});

	describe('Close Behavior', () => {
		it('should call onClose when cancel is clicked', async () => {
			const onClose = vi.fn();

			renderWithProvider(
				<ProjectFolderSettingsModal
					theme={createMockTheme()}
					folder={createMockFolder()}
					sessions={[]}
					onClose={onClose}
					onSave={vi.fn()}
				/>
			);

			await waitFor(() => {
				expect(screen.getByText('Cancel')).toBeInTheDocument();
			});

			fireEvent.click(screen.getByText('Cancel'));
			expect(onClose).toHaveBeenCalled();
		});
	});

	describe('SSH Remote Auth Detection', () => {
		it('should pass SSH remote ID to detectAuth when session has SSH config enabled', async () => {
			const sessionWithSsh = createMockSession({
				name: 'SSH Agent',
				sessionSshRemoteConfig: {
					enabled: true,
					remoteId: 'ssh-remote-1',
				},
			});

			renderWithProvider(
				<ProjectFolderSettingsModal
					theme={createMockTheme()}
					folder={createMockFolder()}
					sessions={[sessionWithSsh]}
					onClose={vi.fn()}
					onSave={vi.fn()}
				/>
			);

			await waitFor(() => {
				expect(screen.getByText('SSH Agent')).toBeInTheDocument();
			});

			// Verify detectAuth was called with SSH remote ID
			expect(mockDetectAuth).toHaveBeenCalledWith('claude-code', 'ssh-remote-1');
		});

		it('should pass undefined to detectAuth when session has SSH config disabled', async () => {
			const sessionWithSshDisabled = createMockSession({
				name: 'Local Agent',
				sessionSshRemoteConfig: {
					enabled: false,
					remoteId: 'ssh-remote-1',
				},
			});

			renderWithProvider(
				<ProjectFolderSettingsModal
					theme={createMockTheme()}
					folder={createMockFolder()}
					sessions={[sessionWithSshDisabled]}
					onClose={vi.fn()}
					onSave={vi.fn()}
				/>
			);

			await waitFor(() => {
				expect(screen.getByText('Local Agent')).toBeInTheDocument();
			});

			// Verify detectAuth was called without SSH remote ID (undefined)
			expect(mockDetectAuth).toHaveBeenCalledWith('claude-code', undefined);
		});

		it('should pass undefined to detectAuth when session has no SSH config', async () => {
			const sessionWithoutSsh = createMockSession({
				name: 'Plain Agent',
			});

			renderWithProvider(
				<ProjectFolderSettingsModal
					theme={createMockTheme()}
					folder={createMockFolder()}
					sessions={[sessionWithoutSsh]}
					onClose={vi.fn()}
					onSave={vi.fn()}
				/>
			);

			await waitFor(() => {
				expect(screen.getByText('Plain Agent')).toBeInTheDocument();
			});

			// Verify detectAuth was called without SSH remote ID
			expect(mockDetectAuth).toHaveBeenCalledWith('claude-code', undefined);
		});

		it('should correctly show OAuth (Max) for SSH remote agents with Max subscription', async () => {
			mockDetectAuth.mockResolvedValue({
				billingMode: 'max',
				source: 'oauth',
				detectedAt: Date.now(),
			});

			const sessionWithSsh = createMockSession({
				name: 'SSH Max Agent',
				sessionSshRemoteConfig: {
					enabled: true,
					remoteId: 'ssh-remote-1',
				},
			});

			renderWithProvider(
				<ProjectFolderSettingsModal
					theme={createMockTheme()}
					folder={createMockFolder()}
					sessions={[sessionWithSsh]}
					onClose={vi.fn()}
					onSave={vi.fn()}
				/>
			);

			await waitFor(() => {
				expect(screen.getByText('OAuth (Max)')).toBeInTheDocument();
			});
		});

		it('should handle mixed local and SSH agents correctly', async () => {
			// Local agent detected as max, SSH agent detected as max
			mockDetectAuth.mockResolvedValue({
				billingMode: 'max',
				source: 'oauth',
				detectedAt: Date.now(),
			});

			const localAgent = createMockSession({
				id: 'local-1',
				name: 'Local Agent',
			});

			const sshAgent = createMockSession({
				id: 'ssh-1',
				name: 'SSH Agent',
				sessionSshRemoteConfig: {
					enabled: true,
					remoteId: 'ssh-remote-1',
				},
			});

			renderWithProvider(
				<ProjectFolderSettingsModal
					theme={createMockTheme()}
					folder={createMockFolder()}
					sessions={[localAgent, sshAgent]}
					onClose={vi.fn()}
					onSave={vi.fn()}
				/>
			);

			await waitFor(() => {
				expect(screen.getByText('Local Agent')).toBeInTheDocument();
				expect(screen.getByText('SSH Agent')).toBeInTheDocument();
			});

			// Verify detectAuth was called correctly for each agent
			expect(mockDetectAuth).toHaveBeenCalledWith('claude-code', undefined); // local
			expect(mockDetectAuth).toHaveBeenCalledWith('claude-code', 'ssh-remote-1'); // ssh
		});
	});
});
