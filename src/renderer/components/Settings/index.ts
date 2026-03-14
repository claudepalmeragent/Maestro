/**
 * Settings Components
 *
 * Components for the Settings modal and its sub-sections.
 */

// Main Settings Modal
export { SettingsModal } from './SettingsModal';

// SSH Remote configuration
export { SshRemoteModal } from './SshRemoteModal';
export type { SshRemoteModalProps } from './SshRemoteModal';

export { SshRemotesSection } from './SshRemotesSection';
export type { SshRemotesSectionProps } from './SshRemotesSection';

// Environment Variables Editor
export { EnvVarsEditor } from './EnvVarsEditor';
export type { EnvVarsEditorProps, EnvVarEntry } from './EnvVarsEditor';

// Audits
export { AuditsSettingsTab } from './AuditsSettingsTab';
