import { useEffect } from 'react';
import type { ThemeId } from '../../../shared/theme-types';

interface UseThemeSyncOptions {
	themeMode: 'manual' | 'system';
	lightThemeId: ThemeId;
	darkThemeId: ThemeId;
	setActiveThemeId: (id: ThemeId) => void;
}

/**
 * Hook to sync theme with system dark/light mode preference.
 * Uses CSS media query as the primary mechanism and also listens for
 * Electron's nativeTheme changes via IPC for more reliable native integration.
 */
export function useThemeSync({
	themeMode,
	lightThemeId,
	darkThemeId,
	setActiveThemeId,
}: UseThemeSyncOptions): void {
	useEffect(() => {
		if (themeMode !== 'system') return;

		const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

		const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
			const themeId = e.matches ? darkThemeId : lightThemeId;
			setActiveThemeId(themeId);
		};

		// Set initial value
		handleChange(mediaQuery);

		// Listen for changes via CSS media query
		mediaQuery.addEventListener('change', handleChange);

		// Also listen for Electron nativeTheme changes via IPC
		// This provides native integration and catches changes the media query might miss
		let unsubscribeNative: (() => void) | undefined;
		if (window.maestro?.app?.onSystemThemeChanged) {
			unsubscribeNative = window.maestro.app.onSystemThemeChanged((isDark: boolean) => {
				const themeId = isDark ? darkThemeId : lightThemeId;
				setActiveThemeId(themeId);
			});
		}

		return () => {
			mediaQuery.removeEventListener('change', handleChange);
			unsubscribeNative?.();
		};
	}, [themeMode, lightThemeId, darkThemeId, setActiveThemeId]);
}
