import React, { useRef, useEffect, useMemo } from 'react';
import { Moon, Sun, Sparkles, Check } from 'lucide-react';
import { CustomThemeBuilder } from '../../CustomThemeBuilder';
import { useSettings } from '../../../hooks/settings/useSettings';
import type { Theme, ThemeId, ThemeColors } from '../../../types';

export interface ThemeTabProps {
	theme: Theme;
	themes: Record<string, Theme>;
	activeThemeId?: ThemeId;
	setActiveThemeId?: (id: ThemeId) => void;
	customThemeColors?: ThemeColors;
	setCustomThemeColors?: (colors: ThemeColors) => void;
	customThemeBaseId?: ThemeId;
	setCustomThemeBaseId?: (id: ThemeId) => void;
	themeMode?: 'manual' | 'system';
	onThemeModeChange?: (mode: 'manual' | 'system') => void;
	lightThemeId?: ThemeId;
	onLightThemeIdChange?: (id: ThemeId) => void;
	darkThemeId?: ThemeId;
	onDarkThemeIdChange?: (id: ThemeId) => void;
	onThemeImportError?: (message: string) => void;
	onThemeImportSuccess?: (message: string) => void;
}

export function ThemeTab(props: ThemeTabProps) {
	const { theme, themes, onThemeImportError, onThemeImportSuccess } = props;

	// Self-source theme settings from useSettings when not provided via props
	const settings = useSettings();

	const activeThemeId = props.activeThemeId ?? settings.activeThemeId;
	const setActiveThemeId = props.setActiveThemeId ?? settings.setActiveThemeId;
	const customThemeColors = props.customThemeColors ?? settings.customThemeColors;
	const setCustomThemeColors = props.setCustomThemeColors ?? settings.setCustomThemeColors;
	const customThemeBaseId = props.customThemeBaseId ?? settings.customThemeBaseId;
	const setCustomThemeBaseId = props.setCustomThemeBaseId ?? settings.setCustomThemeBaseId;
	const themeMode = props.themeMode ?? settings.themeMode;
	const onThemeModeChange = props.onThemeModeChange ?? settings.setThemeMode;
	const lightThemeId = props.lightThemeId ?? settings.lightThemeId;
	const onLightThemeIdChange = props.onLightThemeIdChange ?? settings.setLightThemeId;
	const darkThemeId = props.darkThemeId ?? settings.darkThemeId;
	const onDarkThemeIdChange = props.onDarkThemeIdChange ?? settings.setDarkThemeId;

	const themePickerRef = useRef<HTMLDivElement>(null);

	// Auto-focus the theme picker on mount
	useEffect(() => {
		const timer = setTimeout(() => themePickerRef.current?.focus(), 50);
		return () => clearTimeout(timer);
	}, []);

	// Group themes by mode for the dropdowns
	const groupedThemes = useMemo(
		() =>
			Object.values(themes).reduce(
				(acc: Record<string, Theme[]>, t: Theme) => {
					if (!acc[t.mode]) acc[t.mode] = [];
					acc[t.mode].push(t);
					return acc;
				},
				{} as Record<string, Theme[]>
			),
		[themes]
	);

	const handleThemePickerKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Tab') {
			e.preventDefault();
			e.stopPropagation();
			// Create ordered array: dark themes first, then light, then vibe, then custom (cycling back to dark)
			const allThemes = [
				...(groupedThemes['dark'] || []),
				...(groupedThemes['light'] || []),
				...(groupedThemes['vibe'] || []),
			];
			// Add 'custom' as the last item in the cycle
			const allThemeIds = [...allThemes.map((t) => t.id), 'custom'];
			const currentIndex = allThemeIds.findIndex((id: string) => id === activeThemeId);

			let newThemeId: string;
			if (e.shiftKey) {
				// Shift+Tab: go backwards
				const prevIndex = currentIndex === 0 ? allThemeIds.length - 1 : currentIndex - 1;
				newThemeId = allThemeIds[prevIndex];
			} else {
				// Tab: go forward
				const nextIndex = (currentIndex + 1) % allThemeIds.length;
				newThemeId = allThemeIds[nextIndex];
			}
			setActiveThemeId(newThemeId as ThemeId);

			// Scroll the newly selected theme button into view
			setTimeout(() => {
				const themeButton = themePickerRef.current?.querySelector(
					`[data-theme-id="${newThemeId}"]`
				);
				themeButton?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
			}, 0);
		}
	};

	// Theme mode handlers
	const handleThemeModeChange = (mode: 'manual' | 'system') => {
		onThemeModeChange(mode);
	};

	const handleLightThemeChange = (id: ThemeId) => {
		onLightThemeIdChange(id);
	};

	const handleDarkThemeChange = (id: ThemeId) => {
		onDarkThemeIdChange(id);
	};

	return (
		<div
			ref={themePickerRef}
			className="space-y-6 outline-none"
			tabIndex={0}
			onKeyDown={handleThemePickerKeyDown}
		>
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
					onClick={() => handleThemeModeChange(themeMode === 'system' ? 'manual' : 'system')}
					className="w-11 h-6 rounded-full transition-colors relative"
					style={{ backgroundColor: themeMode === 'system' ? theme.colors.accent : '#4b5563' }}
					aria-label="Toggle follow system appearance"
				>
					<div
						className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${
							themeMode === 'system' ? 'translate-x-5' : 'translate-x-0.5'
						}`}
					/>
				</button>
			</div>

			{/* Light/Dark theme selectors when in system mode */}
			{themeMode === 'system' && (
				<div className="space-y-4 mb-4">
					<div>
						<label className="text-sm mb-2 block" style={{ color: theme.colors.textDim }}>
							Light Mode Theme
						</label>
						<select
							value={lightThemeId}
							onChange={(e) => handleLightThemeChange(e.target.value as ThemeId)}
							className="w-full p-2 rounded border"
							style={{
								backgroundColor: theme.colors.bgActivity,
								borderColor: theme.colors.border,
								color: theme.colors.textMain,
							}}
						>
							{(groupedThemes['light'] || []).map((t: Theme) => (
								<option key={t.id} value={t.id}>
									{t.name}
								</option>
							))}
							{themes.custom && (
								<option key="custom" value="custom">
									{themes.custom.name}
								</option>
							)}
						</select>
					</div>
					<div>
						<label className="text-sm mb-2 block" style={{ color: theme.colors.textDim }}>
							Dark Mode Theme
						</label>
						<select
							value={darkThemeId}
							onChange={(e) => handleDarkThemeChange(e.target.value as ThemeId)}
							className="w-full p-2 rounded border"
							style={{
								backgroundColor: theme.colors.bgActivity,
								borderColor: theme.colors.border,
								color: theme.colors.textMain,
							}}
						>
							{(groupedThemes['dark'] || []).map((t: Theme) => (
								<option key={t.id} value={t.id}>
									{t.name}
								</option>
							))}
						</select>
					</div>
				</div>
			)}

			{['dark', 'light', 'vibe'].map((mode) => (
				<div key={mode}>
					<div
						className="text-xs font-bold uppercase mb-3 flex items-center gap-2"
						style={{ color: theme.colors.textDim }}
					>
						{mode === 'dark' ? (
							<Moon className="w-3 h-3" />
						) : mode === 'light' ? (
							<Sun className="w-3 h-3" />
						) : (
							<Sparkles className="w-3 h-3" />
						)}
						{mode} Mode
					</div>
					<div className="grid grid-cols-2 gap-3">
						{groupedThemes[mode]?.map((t: Theme) => (
							<button
								key={t.id}
								data-theme-id={t.id}
								onClick={() => setActiveThemeId(t.id)}
								className={`p-3 rounded-lg border text-left transition-all ${activeThemeId === t.id ? 'ring-2' : ''}`}
								style={
									{
										borderColor: theme.colors.border,
										backgroundColor: t.colors.bgSidebar,
										'--tw-ring-color': t.colors.accent,
									} as React.CSSProperties
								}
								tabIndex={-1}
							>
								<div className="flex justify-between items-center mb-2">
									<span className="text-sm font-bold" style={{ color: t.colors.textMain }}>
										{t.name}
									</span>
									{activeThemeId === t.id && (
										<Check className="w-4 h-4" style={{ color: t.colors.accent }} />
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

			{/* Custom Theme Builder */}
			<div data-theme-id="custom">
				<CustomThemeBuilder
					theme={theme}
					customThemeColors={customThemeColors}
					setCustomThemeColors={setCustomThemeColors}
					customThemeBaseId={customThemeBaseId}
					setCustomThemeBaseId={setCustomThemeBaseId}
					isSelected={activeThemeId === 'custom'}
					onSelect={() => setActiveThemeId('custom')}
					onImportError={onThemeImportError}
					onImportSuccess={onThemeImportSuccess}
				/>
			</div>
		</div>
	);
}
