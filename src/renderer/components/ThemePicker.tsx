import React from 'react';
import { Moon, Sun } from 'lucide-react';
import type { Theme, ThemeId } from '../types';

interface ThemePickerProps {
	theme: Theme;
	themes: Record<ThemeId, Theme>;
	activeThemeId: ThemeId;
	setActiveThemeId: (id: ThemeId) => void;
	themeMode?: 'manual' | 'system';
	lightThemeId?: ThemeId;
	darkThemeId?: ThemeId;
	onThemeModeChange?: (mode: 'manual' | 'system') => void;
	onLightThemeChange?: (id: ThemeId) => void;
	onDarkThemeChange?: (id: ThemeId) => void;
}

export function ThemePicker({
	theme,
	themes,
	activeThemeId,
	setActiveThemeId,
	themeMode,
	lightThemeId,
	darkThemeId,
	onThemeModeChange,
	onLightThemeChange,
	onDarkThemeChange,
}: ThemePickerProps) {
	const themeList = Object.values(themes);
	const lightThemes = themeList.filter((t) => t.mode === 'light' || t.mode === 'vibe');
	const darkThemes = themeList.filter((t) => t.mode === 'dark' || t.mode === 'vibe');

	const grouped = themeList.reduce(
		(acc, t) => {
			if (!acc[t.mode]) acc[t.mode] = [];
			acc[t.mode].push(t);
			return acc;
		},
		{} as Record<string, Theme[]>
	);

	return (
		<div className="space-y-6">
			{/* System Theme Toggle */}
			<div
				className="flex items-center justify-between mb-4 pb-4 border-b"
				style={{ borderColor: theme.colors.border }}
			>
				<div>
					<span style={{ color: theme.colors.textMain }}>Follow System Appearance</span>
					<p className="text-xs mt-0.5" style={{ color: theme.colors.textDim }}>
						Automatically switch between light and dark themes
					</p>
				</div>
				<button
					aria-label="Follow System Appearance"
					onClick={() => onThemeModeChange?.(themeMode === 'system' ? 'manual' : 'system')}
					className="w-11 h-6 rounded-full transition-colors relative"
					style={{ backgroundColor: themeMode === 'system' ? theme.colors.accent : '#4b5563' }}
				>
					<div
						className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${
							themeMode === 'system' ? 'translate-x-5' : 'translate-x-0.5'
						}`}
					/>
				</button>
			</div>

			{/* Light/Dark theme selectors when system mode is active */}
			{themeMode === 'system' && (
				<div className="space-y-4 mb-4">
					<div>
						<label className="text-sm mb-2 block" style={{ color: theme.colors.textDim }}>
							Light Mode Theme
						</label>
						<select
							value={lightThemeId || 'github-light'}
							onChange={(e) => onLightThemeChange?.(e.target.value as ThemeId)}
							className="w-full p-2 rounded border"
							style={{
								backgroundColor: theme.colors.bgActivity,
								borderColor: theme.colors.border,
								color: theme.colors.textMain,
							}}
						>
							{lightThemes.map((t) => (
								<option key={t.id} value={t.id}>
									{t.name}
								</option>
							))}
						</select>
					</div>
					<div>
						<label className="text-sm mb-2 block" style={{ color: theme.colors.textDim }}>
							Dark Mode Theme
						</label>
						<select
							value={darkThemeId || 'dracula'}
							onChange={(e) => onDarkThemeChange?.(e.target.value as ThemeId)}
							className="w-full p-2 rounded border"
							style={{
								backgroundColor: theme.colors.bgActivity,
								borderColor: theme.colors.border,
								color: theme.colors.textMain,
							}}
						>
							{darkThemes.map((t) => (
								<option key={t.id} value={t.id}>
									{t.name}
								</option>
							))}
						</select>
					</div>
				</div>
			)}

			{['dark', 'light'].map((mode) => (
				<div key={mode}>
					<div
						className="text-xs font-bold uppercase mb-3 flex items-center gap-2"
						style={{ color: theme.colors.textDim }}
					>
						{mode === 'dark' ? <Moon className="w-3 h-3" /> : <Sun className="w-3 h-3" />}
						{mode} Mode
					</div>
					<div className="grid grid-cols-2 gap-3">
						{grouped[mode]?.map((t) => (
							<button
								key={t.id}
								onClick={() => setActiveThemeId(t.id)}
								className={`p-3 rounded-lg border text-left transition-all ${activeThemeId === t.id ? 'ring-2' : ''}`}
								style={
									{
										borderColor: theme.colors.border,
										backgroundColor: t.colors.bgSidebar,
										'--tw-ring-color': theme.colors.accent,
									} as React.CSSProperties
								}
							>
								<div className="flex justify-between items-center mb-2">
									<span className="text-sm font-bold" style={{ color: t.colors.textMain }}>
										{t.name}
									</span>
									{activeThemeId === t.id && (
										<div
											className="w-2 h-2 rounded-full"
											style={{ backgroundColor: theme.colors.accent }}
										/>
									)}
								</div>
								<div className="flex h-3 rounded overflow-hidden">
									<div className="flex-1" style={{ backgroundColor: t.colors.bgMain }} />
									<div className="flex-1" style={{ backgroundColor: t.colors.bgActivity }} />
									<div className="flex-1" style={{ backgroundColor: t.colors.accent }} />
								</div>
							</button>
						))}
					</div>
				</div>
			))}
		</div>
	);
}
