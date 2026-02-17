/**
 * Tests for useThemeSync hook
 *
 * Verifies system theme detection and automatic switching behavior.
 */

import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useThemeSync } from '../useThemeSync';
import type { ThemeId } from '../../../../shared/theme-types';

describe('useThemeSync', () => {
	let addEventListenerSpy: ReturnType<typeof vi.fn>;
	let removeEventListenerSpy: ReturnType<typeof vi.fn>;
	let matchMediaMock: ReturnType<typeof vi.fn>;
	let currentMatches: boolean;

	beforeEach(() => {
		addEventListenerSpy = vi.fn();
		removeEventListenerSpy = vi.fn();
		currentMatches = false;

		matchMediaMock = vi.fn().mockImplementation(() => ({
			matches: currentMatches,
			addEventListener: addEventListenerSpy,
			removeEventListener: removeEventListenerSpy,
		}));

		Object.defineProperty(window, 'matchMedia', {
			writable: true,
			value: matchMediaMock,
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('should not set up listener when themeMode is manual', () => {
		const setActiveThemeId = vi.fn();

		renderHook(() =>
			useThemeSync({
				themeMode: 'manual',
				lightThemeId: 'github-light',
				darkThemeId: 'dracula',
				setActiveThemeId,
			})
		);

		expect(matchMediaMock).not.toHaveBeenCalled();
		expect(setActiveThemeId).not.toHaveBeenCalled();
	});

	it('should set light theme when system prefers light mode', () => {
		currentMatches = false;
		const setActiveThemeId = vi.fn();

		renderHook(() =>
			useThemeSync({
				themeMode: 'system',
				lightThemeId: 'github-light',
				darkThemeId: 'dracula',
				setActiveThemeId,
			})
		);

		expect(matchMediaMock).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
		expect(setActiveThemeId).toHaveBeenCalledWith('github-light');
	});

	it('should set dark theme when system prefers dark mode', () => {
		currentMatches = true;
		const setActiveThemeId = vi.fn();

		renderHook(() =>
			useThemeSync({
				themeMode: 'system',
				lightThemeId: 'github-light',
				darkThemeId: 'dracula',
				setActiveThemeId,
			})
		);

		expect(setActiveThemeId).toHaveBeenCalledWith('dracula');
	});

	it('should listen for system theme changes', () => {
		const setActiveThemeId = vi.fn();

		renderHook(() =>
			useThemeSync({
				themeMode: 'system',
				lightThemeId: 'github-light',
				darkThemeId: 'dracula',
				setActiveThemeId,
			})
		);

		expect(addEventListenerSpy).toHaveBeenCalledWith('change', expect.any(Function));
	});

	it('should respond to system theme change events', () => {
		const setActiveThemeId = vi.fn();

		renderHook(() =>
			useThemeSync({
				themeMode: 'system',
				lightThemeId: 'github-light',
				darkThemeId: 'dracula',
				setActiveThemeId,
			})
		);

		// Get the registered handler
		const handler = addEventListenerSpy.mock.calls[0][1];

		// Simulate switching to dark mode
		handler({ matches: true } as MediaQueryListEvent);
		expect(setActiveThemeId).toHaveBeenCalledWith('dracula');

		// Simulate switching to light mode
		handler({ matches: false } as MediaQueryListEvent);
		expect(setActiveThemeId).toHaveBeenCalledWith('github-light');
	});

	it('should clean up listener on unmount', () => {
		const setActiveThemeId = vi.fn();

		const { unmount } = renderHook(() =>
			useThemeSync({
				themeMode: 'system',
				lightThemeId: 'github-light',
				darkThemeId: 'dracula',
				setActiveThemeId,
			})
		);

		unmount();

		expect(removeEventListenerSpy).toHaveBeenCalledWith('change', expect.any(Function));
	});

	it('should clean up and stop listening when switching from system to manual', () => {
		const setActiveThemeId = vi.fn();

		const { rerender } = renderHook(
			({ themeMode }: { themeMode: 'manual' | 'system' }) =>
				useThemeSync({
					themeMode,
					lightThemeId: 'github-light',
					darkThemeId: 'dracula',
					setActiveThemeId,
				}),
			{ initialProps: { themeMode: 'system' as 'manual' | 'system' } }
		);

		expect(addEventListenerSpy).toHaveBeenCalled();

		// Switch to manual mode
		rerender({ themeMode: 'manual' });

		expect(removeEventListenerSpy).toHaveBeenCalled();
	});

	it('should use the correct theme IDs when they change', () => {
		const setActiveThemeId = vi.fn();
		currentMatches = true;

		const { rerender } = renderHook(
			({ darkThemeId }: { darkThemeId: ThemeId }) =>
				useThemeSync({
					themeMode: 'system',
					lightThemeId: 'github-light',
					darkThemeId,
					setActiveThemeId,
				}),
			{ initialProps: { darkThemeId: 'dracula' as ThemeId } }
		);

		expect(setActiveThemeId).toHaveBeenCalledWith('dracula');

		// Change dark theme preference
		rerender({ darkThemeId: 'nord' });

		expect(setActiveThemeId).toHaveBeenCalledWith('nord');
	});

	describe('Electron nativeTheme integration', () => {
		let nativeUnsubscribe: ReturnType<typeof vi.fn>;
		let nativeCallback: ((isDark: boolean) => void) | null;
		let originalApp: any;

		beforeEach(() => {
			nativeUnsubscribe = vi.fn();
			nativeCallback = null;
			originalApp = (window as any).maestro?.app;

			// Add onSystemThemeChanged to the existing window.maestro mock
			(window as any).maestro = {
				...((window as any).maestro || {}),
				app: {
					...(originalApp || {}),
					onSystemThemeChanged: vi.fn((cb: (isDark: boolean) => void) => {
						nativeCallback = cb;
						return nativeUnsubscribe;
					}),
				},
			};
		});

		afterEach(() => {
			// Restore original app property
			if ((window as any).maestro) {
				(window as any).maestro.app = originalApp;
			}
		});

		it('should subscribe to native theme changes when in system mode', () => {
			const setActiveThemeId = vi.fn();

			renderHook(() =>
				useThemeSync({
					themeMode: 'system',
					lightThemeId: 'github-light',
					darkThemeId: 'dracula',
					setActiveThemeId,
				})
			);

			expect((window as any).maestro.app.onSystemThemeChanged).toHaveBeenCalledWith(
				expect.any(Function)
			);
		});

		it('should not subscribe to native theme changes when in manual mode', () => {
			const setActiveThemeId = vi.fn();

			renderHook(() =>
				useThemeSync({
					themeMode: 'manual',
					lightThemeId: 'github-light',
					darkThemeId: 'dracula',
					setActiveThemeId,
				})
			);

			expect((window as any).maestro.app.onSystemThemeChanged).not.toHaveBeenCalled();
		});

		it('should set dark theme when native event reports dark mode', () => {
			const setActiveThemeId = vi.fn();

			renderHook(() =>
				useThemeSync({
					themeMode: 'system',
					lightThemeId: 'github-light',
					darkThemeId: 'dracula',
					setActiveThemeId,
				})
			);

			// Simulate native theme change to dark
			nativeCallback?.(true);
			expect(setActiveThemeId).toHaveBeenCalledWith('dracula');
		});

		it('should set light theme when native event reports light mode', () => {
			const setActiveThemeId = vi.fn();

			renderHook(() =>
				useThemeSync({
					themeMode: 'system',
					lightThemeId: 'github-light',
					darkThemeId: 'dracula',
					setActiveThemeId,
				})
			);

			// Simulate native theme change to light
			nativeCallback?.(false);
			expect(setActiveThemeId).toHaveBeenCalledWith('github-light');
		});

		it('should unsubscribe from native theme changes on unmount', () => {
			const setActiveThemeId = vi.fn();

			const { unmount } = renderHook(() =>
				useThemeSync({
					themeMode: 'system',
					lightThemeId: 'github-light',
					darkThemeId: 'dracula',
					setActiveThemeId,
				})
			);

			unmount();

			expect(nativeUnsubscribe).toHaveBeenCalled();
		});

		it('should unsubscribe from native theme when switching to manual mode', () => {
			const setActiveThemeId = vi.fn();

			const { rerender } = renderHook(
				({ themeMode }: { themeMode: 'manual' | 'system' }) =>
					useThemeSync({
						themeMode,
						lightThemeId: 'github-light',
						darkThemeId: 'dracula',
						setActiveThemeId,
					}),
				{ initialProps: { themeMode: 'system' as 'manual' | 'system' } }
			);

			expect(nativeUnsubscribe).not.toHaveBeenCalled();

			// Switch to manual
			rerender({ themeMode: 'manual' });

			expect(nativeUnsubscribe).toHaveBeenCalled();
		});
	});
});
