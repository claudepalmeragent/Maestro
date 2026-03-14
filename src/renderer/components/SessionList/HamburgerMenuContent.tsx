import {
	Wand2,
	Settings,
	Keyboard,
	ScrollText,
	Cpu,
	Download,
	Compass,
	Globe,
	BookOpen,
	BarChart3,
	Info,
	ExternalLink,
} from 'lucide-react';
import type { Theme, Shortcut, SettingsTab } from '../../types';
import { formatShortcutKeys } from '../../utils/shortcutFormatter';

interface HamburgerMenuContentProps {
	theme: Theme;
	shortcuts: Record<string, Shortcut>;
	openWizard?: () => void;
	startTour?: () => void;
	setShortcutsHelpOpen: (open: boolean) => void;
	setSettingsModalOpen: (open: boolean) => void;
	setSettingsTab: (tab: SettingsTab) => void;
	setLogViewerOpen: (open: boolean) => void;
	setProcessMonitorOpen: (open: boolean) => void;
	setUsageDashboardOpen: (open: boolean) => void;
	setUpdateCheckModalOpen: (open: boolean) => void;
	setAboutModalOpen: (open: boolean) => void;
	setMenuOpen: (open: boolean) => void;
}

export function HamburgerMenuContent({
	theme,
	shortcuts,
	openWizard,
	startTour,
	setShortcutsHelpOpen,
	setSettingsModalOpen,
	setSettingsTab,
	setLogViewerOpen,
	setProcessMonitorOpen,
	setUsageDashboardOpen,
	setUpdateCheckModalOpen,
	setAboutModalOpen,
	setMenuOpen,
}: HamburgerMenuContentProps) {
	return (
		<div className="p-1">
			{openWizard && (
				<button
					onClick={() => {
						openWizard();
						setMenuOpen(false);
					}}
					className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-white/10 transition-colors text-left"
				>
					<Wand2 className="w-5 h-5" style={{ color: theme.colors.accent }} />
					<div className="flex-1">
						<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
							New Agent Wizard
						</div>
						<div className="text-xs" style={{ color: theme.colors.textDim }}>
							Get started with AI
						</div>
					</div>
					<span
						className="text-xs font-mono px-1.5 py-0.5 rounded"
						style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textDim }}
					>
						{shortcuts.openWizard ? formatShortcutKeys(shortcuts.openWizard.keys) : '⇧⌘N'}
					</span>
				</button>
			)}
			{startTour && (
				<button
					onClick={() => {
						startTour();
						setMenuOpen(false);
					}}
					className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-white/10 transition-colors text-left"
				>
					<Compass className="w-5 h-5" style={{ color: theme.colors.accent }} />
					<div className="flex-1">
						<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
							Introductory Tour
						</div>
						<div className="text-xs" style={{ color: theme.colors.textDim }}>
							Learn how to use Maestro
						</div>
					</div>
				</button>
			)}
			<div className="my-1 border-t" style={{ borderColor: theme.colors.border }} />
			<button
				onClick={() => {
					setShortcutsHelpOpen(true);
					setMenuOpen(false);
				}}
				className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-white/10 transition-colors text-left"
			>
				<Keyboard className="w-5 h-5" style={{ color: theme.colors.accent }} />
				<div className="flex-1">
					<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
						Keyboard Shortcuts
					</div>
					<div className="text-xs" style={{ color: theme.colors.textDim }}>
						View all available shortcuts
					</div>
				</div>
				<span
					className="text-xs font-mono px-1.5 py-0.5 rounded"
					style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textDim }}
				>
					{formatShortcutKeys(shortcuts.help.keys)}
				</span>
			</button>
			<button
				onClick={() => {
					setSettingsModalOpen(true);
					setSettingsTab('general');
					setMenuOpen(false);
				}}
				className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-white/10 transition-colors text-left"
			>
				<Settings className="w-5 h-5" style={{ color: theme.colors.accent }} />
				<div className="flex-1">
					<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
						Settings
					</div>
					<div className="text-xs" style={{ color: theme.colors.textDim }}>
						Configure preferences
					</div>
				</div>
				<span
					className="text-xs font-mono px-1.5 py-0.5 rounded"
					style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textDim }}
				>
					{formatShortcutKeys(shortcuts.settings.keys)}
				</span>
			</button>
			<button
				onClick={() => {
					setLogViewerOpen(true);
					setMenuOpen(false);
				}}
				className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-white/10 transition-colors text-left"
			>
				<ScrollText className="w-5 h-5" style={{ color: theme.colors.accent }} />
				<div className="flex-1">
					<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
						System Logs
					</div>
					<div className="text-xs" style={{ color: theme.colors.textDim }}>
						View application logs
					</div>
				</div>
				<span
					className="text-xs font-mono px-1.5 py-0.5 rounded"
					style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textDim }}
				>
					{formatShortcutKeys(shortcuts.systemLogs.keys)}
				</span>
			</button>
			<button
				onClick={() => {
					setProcessMonitorOpen(true);
					setMenuOpen(false);
				}}
				className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-white/10 transition-colors text-left"
			>
				<Cpu className="w-5 h-5" style={{ color: theme.colors.accent }} />
				<div className="flex-1">
					<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
						Process Monitor
					</div>
					<div className="text-xs" style={{ color: theme.colors.textDim }}>
						View running processes
					</div>
				</div>
				<span
					className="text-xs font-mono px-1.5 py-0.5 rounded"
					style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textDim }}
				>
					{formatShortcutKeys(shortcuts.processMonitor.keys)}
				</span>
			</button>
			<button
				onClick={() => {
					setUsageDashboardOpen(true);
					setMenuOpen(false);
				}}
				className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-white/10 transition-colors text-left"
			>
				<BarChart3 className="w-5 h-5" style={{ color: theme.colors.accent }} />
				<div className="flex-1">
					<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
						Usage Dashboard
					</div>
					<div className="text-xs" style={{ color: theme.colors.textDim }}>
						View usage analytics
					</div>
				</div>
				<span
					className="text-xs font-mono px-1.5 py-0.5 rounded"
					style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textDim }}
				>
					{formatShortcutKeys(shortcuts.usageDashboard.keys)}
				</span>
			</button>
			<div className="my-1 border-t" style={{ borderColor: theme.colors.border }} />
			<button
				onClick={() => {
					setUpdateCheckModalOpen(true);
					setMenuOpen(false);
				}}
				className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-white/10 transition-colors text-left"
			>
				<Download className="w-5 h-5" style={{ color: theme.colors.accent }} />
				<div className="flex-1">
					<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
						Check for Updates
					</div>
					<div className="text-xs" style={{ color: theme.colors.textDim }}>
						Get the latest version
					</div>
				</div>
			</button>
			<button
				onClick={() => {
					window.maestro.shell.openExternal('https://runmaestro.ai');
					setMenuOpen(false);
				}}
				className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-white/10 transition-colors text-left"
			>
				<Globe className="w-5 h-5" style={{ color: theme.colors.accent }} />
				<div className="flex-1">
					<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
						Maestro Website
					</div>
					<div className="text-xs" style={{ color: theme.colors.textDim }}>
						Visit runmaestro.ai
					</div>
				</div>
				<ExternalLink className="w-4 h-4" style={{ color: theme.colors.textDim }} />
			</button>
			<button
				onClick={() => {
					window.maestro.shell.openExternal('https://docs.runmaestro.ai');
					setMenuOpen(false);
				}}
				className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-white/10 transition-colors text-left"
			>
				<BookOpen className="w-5 h-5" style={{ color: theme.colors.accent }} />
				<div className="flex-1">
					<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
						Documentation
					</div>
					<div className="text-xs" style={{ color: theme.colors.textDim }}>
						See usage docs on docs.runmaestro.ai
					</div>
				</div>
				<ExternalLink className="w-4 h-4" style={{ color: theme.colors.textDim }} />
			</button>
			<button
				onClick={() => {
					setAboutModalOpen(true);
					setMenuOpen(false);
				}}
				className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-white/10 transition-colors text-left"
			>
				<Info className="w-5 h-5" style={{ color: theme.colors.accent }} />
				<div className="flex-1">
					<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
						About Maestro
					</div>
					<div className="text-xs" style={{ color: theme.colors.textDim }}>
						Version, Credits, Stats
					</div>
				</div>
			</button>
		</div>
	);
}
