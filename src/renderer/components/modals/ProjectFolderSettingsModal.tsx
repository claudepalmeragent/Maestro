/**
 * ProjectFolderSettingsModal.tsx
 *
 * Modal for configuring project folder billing settings.
 * Accessible via context menu "Folder Settings..." on project folder headers.
 *
 * Features:
 * - Project-level billing mode toggle with mixed state support
 * - Agent configuration table showing all agents in the folder
 * - Cascade behavior: project toggle updates all agents, individual agent toggle shows mixed state
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { Theme, Session } from '../../types';
import type { ProjectFolder, ClaudeBillingMode, DetectedAuth } from '../../../shared/types';
import { MODAL_PRIORITIES } from '../../constants/modalPriorities';
import { Modal, ModalFooter } from '../ui';
import type { BillingModeValue } from '../ui/BillingModeToggle';

// =============================================================================
// TYPES
// =============================================================================

export interface ProjectFolderSettingsModalProps {
	/** Theme for styling */
	theme: Theme;
	/** The project folder being configured */
	folder: ProjectFolder;
	/** All sessions in the app (will be filtered to this folder) */
	sessions: Session[];
	/** Callback to close the modal */
	onClose: () => void;
	/** Callback when settings are saved */
	onSave: () => void;
}

/** Extended billing state that includes 'mixed' for project-level display */
export type ProjectBillingState = ClaudeBillingMode | 'mixed';

/** Agent row data for the configuration table */
interface AgentRowData {
	id: string;
	name: string;
	emoji: string;
	toolType: string;
	billingMode: BillingModeValue;
	detectedAuth?: DetectedAuth | null;
	isClaude: boolean;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if a session is a Claude-based agent (supports billing mode)
 */
function isClaudeAgent(session: Session): boolean {
	return session.toolType === 'claude' || session.toolType === 'claude-code';
}

/**
 * Calculate the project-level billing state from all agents
 */
function calculateProjectBillingState(agents: AgentRowData[]): ProjectBillingState {
	const claudeAgents = agents.filter((a) => a.isClaude);
	if (claudeAgents.length === 0) return 'max'; // Default when no Claude agents

	const modes = new Set(
		claudeAgents.map((a) => (a.billingMode === 'auto' ? 'auto' : a.billingMode))
	);

	// If all agents have the same explicit mode, return that mode
	if (modes.size === 1) {
		const mode = [...modes][0];
		// If all are 'auto', treat as mixed since we don't know the resolved value
		return mode === 'auto' ? 'mixed' : (mode as ClaudeBillingMode);
	}

	return 'mixed';
}

// =============================================================================
// BILLING MODE TOGGLE WITH MIXED STATE
// =============================================================================

interface ProjectBillingToggleProps {
	theme: Theme;
	value: ProjectBillingState;
	onChange: (mode: ClaudeBillingMode) => void;
	disabled?: boolean;
}

/**
 * Modified billing toggle that supports a 'mixed' indeterminate state
 */
function ProjectBillingToggle({
	theme,
	value,
	onChange,
	disabled = false,
}: ProjectBillingToggleProps) {
	const options: Array<{ value: ProjectBillingState; label: string; description: string }> = [
		{
			value: 'mixed',
			label: '\u2014', // em-dash for indeterminate
			description: 'Agents have different billing modes',
		},
		{
			value: 'max',
			label: 'Max',
			description: 'Claude Max subscription (cache free)',
		},
		{
			value: 'api',
			label: 'API',
			description: 'Per-token API pricing',
		},
	];

	return (
		<div className="flex items-center gap-2">
			<div
				className="flex rounded border overflow-hidden"
				style={{ borderColor: theme.colors.border }}
			>
				{options.map((option) => {
					const isActive = value === option.value;
					const isMixedOption = option.value === 'mixed';
					const isClickable = !isMixedOption && !disabled;

					return (
						<button
							key={option.value}
							onClick={() => isClickable && onChange(option.value as ClaudeBillingMode)}
							disabled={!isClickable}
							className={`px-3 py-1.5 text-xs font-medium transition-all ${
								!isClickable ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
							}`}
							style={{
								backgroundColor: isActive ? theme.colors.accentDim : 'transparent',
								color: isActive ? theme.colors.textMain : theme.colors.textDim,
								borderRight:
									option.value !== 'api' ? `1px solid ${theme.colors.border}` : undefined,
							}}
							title={option.description}
						>
							{option.label}
						</button>
					);
				})}
			</div>
		</div>
	);
}

// =============================================================================
// AGENT BILLING DROPDOWN
// =============================================================================

interface AgentBillingDropdownProps {
	theme: Theme;
	value: BillingModeValue;
	detectedMode?: ClaudeBillingMode;
	onChange: (mode: BillingModeValue) => void;
	disabled?: boolean;
}

function AgentBillingDropdown({
	theme,
	value,
	detectedMode,
	onChange,
	disabled = false,
}: AgentBillingDropdownProps) {
	return (
		<select
			value={value}
			onChange={(e) => onChange(e.target.value as BillingModeValue)}
			disabled={disabled}
			className="text-xs px-2 py-1 rounded border"
			style={{
				backgroundColor: theme.colors.bgMain,
				color: theme.colors.textMain,
				borderColor: theme.colors.border,
				opacity: disabled ? 0.5 : 1,
			}}
		>
			<option value="auto">
				Auto{detectedMode ? ` (${detectedMode === 'max' ? 'Max' : 'API'})` : ''}
			</option>
			<option value="max">Max</option>
			<option value="api">API</option>
		</select>
	);
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function ProjectFolderSettingsModal({
	theme,
	folder,
	sessions,
	onClose,
	onSave,
}: ProjectFolderSettingsModalProps) {
	// State for agents in this folder
	const [agents, setAgents] = useState<AgentRowData[]>([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [hasChanges, setHasChanges] = useState(false);

	// Track original billing modes to detect changes
	const [originalModes, setOriginalModes] = useState<Map<string, BillingModeValue>>(new Map());

	// Filter sessions that belong to this folder
	const folderSessions = useMemo(() => {
		return sessions.filter((s) => s.projectFolderIds?.includes(folder.id));
	}, [sessions, folder.id]);

	// Calculate project-level billing state
	const projectBillingState = useMemo(() => calculateProjectBillingState(agents), [agents]);

	// Load pricing configs for all agents in the folder
	useEffect(() => {
		async function loadAgentConfigs() {
			setLoading(true);
			const agentData: AgentRowData[] = [];
			const origModes = new Map<string, BillingModeValue>();

			for (const session of folderSessions) {
				const isClaude = isClaudeAgent(session);
				let billingMode: BillingModeValue = 'auto';
				let detectedAuth: DetectedAuth | null = null;

				if (isClaude) {
					try {
						const [pricingConfig, auth] = await Promise.all([
							window.maestro.agents.getPricingConfig(session.toolType),
							window.maestro.agents.detectAuth(session.toolType),
						]);
						billingMode = pricingConfig?.billingMode || 'auto';
						detectedAuth = auth;
					} catch (err) {
						console.error(`Failed to load pricing config for ${session.id}:`, err);
					}
				}

				agentData.push({
					id: session.id,
					name: session.name,
					emoji: session.toolType === 'claude-code' ? '\uD83E\uDD16' : '\uD83E\uDD16',
					toolType: session.toolType,
					billingMode,
					detectedAuth,
					isClaude,
				});
				origModes.set(session.id, billingMode);
			}

			setAgents(agentData);
			setOriginalModes(origModes);
			setLoading(false);
		}

		loadAgentConfigs();
	}, [folderSessions]);

	// Handle project-level toggle change (updates all Claude agents)
	const handleProjectToggle = useCallback(
		async (mode: ClaudeBillingMode) => {
			// Update all Claude agents to the selected mode
			const updatedAgents = agents.map((agent) => {
				if (agent.isClaude) {
					return { ...agent, billingMode: mode };
				}
				return agent;
			});
			setAgents(updatedAgents);
			setHasChanges(true);
		},
		[agents]
	);

	// Handle individual agent toggle change
	const handleAgentToggle = useCallback(
		(agentId: string, mode: BillingModeValue) => {
			const updatedAgents = agents.map((agent) => {
				if (agent.id === agentId) {
					return { ...agent, billingMode: mode };
				}
				return agent;
			});
			setAgents(updatedAgents);
			setHasChanges(true);
		},
		[agents]
	);

	// Save changes
	const handleSave = useCallback(async () => {
		setSaving(true);
		try {
			// Save individual agent pricing configs
			for (const agent of agents) {
				if (agent.isClaude && agent.billingMode !== originalModes.get(agent.id)) {
					await window.maestro.agents.setPricingConfig(agent.toolType, {
						billingMode: agent.billingMode,
					});
				}
			}

			// If all Claude agents have the same mode, update the folder config too
			if (projectBillingState !== 'mixed') {
				await window.maestro.projectFolders.setPricingConfig(folder.id, {
					billingMode: projectBillingState,
				});
			}

			onSave();
			onClose();
		} catch (err) {
			console.error('Failed to save folder settings:', err);
		} finally {
			setSaving(false);
		}
	}, [agents, originalModes, projectBillingState, folder.id, onSave, onClose]);

	// Count Claude agents for display
	const claudeAgentCount = agents.filter((a) => a.isClaude).length;

	return (
		<Modal
			theme={theme}
			title={`${folder.emoji || '\uD83D\uDCC1'} ${folder.name} - Folder Settings`}
			priority={MODAL_PRIORITIES.PROJECT_FOLDER_SETTINGS}
			onClose={onClose}
			width={550}
			footer={
				<ModalFooter
					theme={theme}
					onCancel={onClose}
					onConfirm={handleSave}
					confirmLabel="Save"
					confirmDisabled={!hasChanges || saving}
				/>
			}
		>
			{loading ? (
				<div className="flex items-center justify-center py-8">
					<span className="text-sm" style={{ color: theme.colors.textDim }}>
						Loading agent configurations...
					</span>
				</div>
			) : (
				<div className="space-y-6">
					{/* Project-Level Defaults Section */}
					<div>
						<label
							className="block text-xs font-medium mb-3 uppercase tracking-wide"
							style={{ color: theme.colors.textDim }}
						>
							Project Default Billing Mode
						</label>
						<div className="p-4 rounded border" style={{ borderColor: theme.colors.border }}>
							<ProjectBillingToggle
								theme={theme}
								value={projectBillingState}
								onChange={handleProjectToggle}
								disabled={claudeAgentCount === 0}
							/>
							{projectBillingState === 'mixed' && claudeAgentCount > 0 && (
								<p
									className="flex items-center gap-2 text-xs mt-3"
									style={{ color: theme.colors.warning }}
								>
									<AlertTriangle className="w-3.5 h-3.5" />
									Agents have different billing modes. Select one to apply to all agents.
								</p>
							)}
							{claudeAgentCount === 0 && (
								<p className="text-xs mt-3" style={{ color: theme.colors.textDim }}>
									No Claude agents in this folder.
								</p>
							)}
							{claudeAgentCount > 0 && projectBillingState !== 'mixed' && (
								<p className="text-xs mt-3" style={{ color: theme.colors.textDim }}>
									Changes apply to all {claudeAgentCount} Claude agent
									{claudeAgentCount !== 1 ? 's' : ''} in this folder.
								</p>
							)}
						</div>
					</div>

					{/* Agent Configuration Table */}
					{agents.length > 0 && (
						<div>
							<label
								className="block text-xs font-medium mb-3 uppercase tracking-wide"
								style={{ color: theme.colors.textDim }}
							>
								Agent Configuration
							</label>
							<div
								className="rounded border overflow-hidden"
								style={{ borderColor: theme.colors.border }}
							>
								<table className="w-full text-xs">
									<thead>
										<tr style={{ backgroundColor: theme.colors.bgActivity }}>
											<th
												className="text-left px-3 py-2 font-medium"
												style={{ color: theme.colors.textDim }}
											>
												Agent
											</th>
											<th
												className="text-left px-3 py-2 font-medium"
												style={{ color: theme.colors.textDim }}
											>
												Billing
											</th>
											<th
												className="text-left px-3 py-2 font-medium"
												style={{ color: theme.colors.textDim }}
											>
												Detected
											</th>
										</tr>
									</thead>
									<tbody>
										{agents.map((agent, index) => (
											<tr
												key={agent.id}
												style={{
													borderTop: index > 0 ? `1px solid ${theme.colors.border}` : undefined,
												}}
											>
												<td className="px-3 py-2" style={{ color: theme.colors.textMain }}>
													<span className="flex items-center gap-2">
														<span>{agent.emoji}</span>
														<span className="truncate max-w-[180px]">{agent.name}</span>
													</span>
												</td>
												<td className="px-3 py-2">
													{agent.isClaude ? (
														<AgentBillingDropdown
															theme={theme}
															value={agent.billingMode}
															detectedMode={agent.detectedAuth?.billingMode}
															onChange={(mode) => handleAgentToggle(agent.id, mode)}
														/>
													) : (
														<span style={{ color: theme.colors.textDim }}>N/A</span>
													)}
												</td>
												<td className="px-3 py-2">
													{agent.isClaude && agent.detectedAuth ? (
														<span
															className="px-2 py-0.5 rounded text-[10px]"
															style={{
																backgroundColor: theme.colors.bgActivity,
																color:
																	agent.detectedAuth.source === 'oauth'
																		? theme.colors.success
																		: theme.colors.textDim,
															}}
														>
															{agent.detectedAuth.source === 'oauth' ? 'OAuth (Max)' : 'API Key'}
														</span>
													) : (
														<span style={{ color: theme.colors.textDim }}>\u2014</span>
													)}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>
					)}

					{/* Empty state */}
					{agents.length === 0 && (
						<div
							className="text-center py-8 rounded border"
							style={{ borderColor: theme.colors.border, color: theme.colors.textDim }}
						>
							<p className="text-sm">No agents in this folder yet.</p>
							<p className="text-xs mt-1">Add agents to configure their billing settings.</p>
						</div>
					)}
				</div>
			)}
		</Modal>
	);
}

export default ProjectFolderSettingsModal;
