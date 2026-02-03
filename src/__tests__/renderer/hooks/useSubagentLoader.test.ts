/**
 * Tests for useSubagentLoader hook
 *
 * This hook manages loading and caching subagent data for sessions.
 * Key functionality tested:
 * - Loading subagents for a session
 * - Caching loaded subagents
 * - Deduplicating in-flight requests
 * - Toggle/expand/collapse session expansion
 * - Loading state management
 * - Cache clearing
 * - SSH remote ID passthrough
 * - Error handling
 */

import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSubagentLoader } from '../../../renderer/hooks/agent/useSubagentLoader';
import type { SubagentInfo } from '../../../renderer/types';

// Mock the window.maestro API
const mockListSubagents = vi.fn();

beforeEach(() => {
	vi.clearAllMocks();

	// Setup window.maestro mock
	(window as unknown as { maestro: unknown }).maestro = {
		agentSessions: {
			listSubagents: mockListSubagents,
		},
	};

	// Default mock implementation
	mockListSubagents.mockResolvedValue([]);
});

afterEach(() => {
	vi.restoreAllMocks();
});

const createMockSubagent = (id: string, overrides?: Partial<SubagentInfo>): SubagentInfo => ({
	agentId: id,
	agentType: 'Explore',
	parentSessionId: 'parent-123',
	filePath: `/path/to/agent-${id}.jsonl`,
	timestamp: '2026-02-03T10:00:00.000Z',
	modifiedAt: '2026-02-03T10:05:00.000Z',
	messageCount: 10,
	sizeBytes: 3000,
	inputTokens: 1000,
	outputTokens: 400,
	cacheReadTokens: 50,
	cacheCreationTokens: 25,
	costUsd: 0.03,
	firstMessage: 'Test message',
	durationSeconds: 60,
	...overrides,
});

describe('useSubagentLoader', () => {
	describe('loadSubagentsForSession', () => {
		it('should load subagents for a session', async () => {
			const mockSubagents = [createMockSubagent('sub1'), createMockSubagent('sub2')];
			mockListSubagents.mockResolvedValue(mockSubagents);

			const { result } = renderHook(() =>
				useSubagentLoader({
					agentId: 'claude-code',
					projectPath: '/test/project',
				})
			);

			let loadedSubagents: SubagentInfo[] = [];
			await act(async () => {
				loadedSubagents = await result.current.loadSubagentsForSession('session-123');
			});

			expect(loadedSubagents).toHaveLength(2);
			expect(loadedSubagents[0].agentId).toBe('sub1');
			expect(loadedSubagents[1].agentId).toBe('sub2');
			expect(mockListSubagents).toHaveBeenCalledWith(
				'claude-code',
				'/test/project',
				'session-123',
				undefined
			);
		});

		it('should cache loaded subagents', async () => {
			const mockSubagents = [createMockSubagent('sub1')];
			mockListSubagents.mockResolvedValue(mockSubagents);

			const { result } = renderHook(() =>
				useSubagentLoader({
					agentId: 'claude-code',
					projectPath: '/test/project',
				})
			);

			// Load twice
			await act(async () => {
				await result.current.loadSubagentsForSession('session-123');
			});

			await act(async () => {
				await result.current.loadSubagentsForSession('session-123');
			});

			// Should only call API once due to caching
			expect(mockListSubagents).toHaveBeenCalledTimes(1);
		});

		it('should deduplicate concurrent requests for the same session', async () => {
			let resolvePromise: (value: SubagentInfo[]) => void;
			const loadingPromise = new Promise<SubagentInfo[]>((resolve) => {
				resolvePromise = resolve;
			});
			mockListSubagents.mockReturnValue(loadingPromise);

			const { result } = renderHook(() =>
				useSubagentLoader({
					agentId: 'claude-code',
					projectPath: '/test/project',
				})
			);

			// Start multiple concurrent loads
			let promise1: Promise<SubagentInfo[]>;
			let promise2: Promise<SubagentInfo[]>;

			act(() => {
				promise1 = result.current.loadSubagentsForSession('session-123');
				promise2 = result.current.loadSubagentsForSession('session-123');
			});

			// Resolve
			const mockSubagents = [createMockSubagent('sub1')];
			await act(async () => {
				resolvePromise!(mockSubagents);
			});

			const [result1, result2] = await Promise.all([promise1!, promise2!]);

			// Both should return the same result
			expect(result1).toEqual(mockSubagents);
			expect(result2).toEqual(mockSubagents);

			// Should only call API once despite concurrent requests
			expect(mockListSubagents).toHaveBeenCalledTimes(1);
		});

		it('should return empty array when projectPath is undefined', async () => {
			const { result } = renderHook(() =>
				useSubagentLoader({
					agentId: 'claude-code',
					projectPath: undefined,
				})
			);

			let loadedSubagents: SubagentInfo[] = [];
			await act(async () => {
				loadedSubagents = await result.current.loadSubagentsForSession('session-123');
			});

			expect(loadedSubagents).toEqual([]);
			expect(mockListSubagents).not.toHaveBeenCalled();
		});

		it('should handle errors gracefully', async () => {
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			mockListSubagents.mockRejectedValue(new Error('Network error'));

			const { result } = renderHook(() =>
				useSubagentLoader({
					agentId: 'claude-code',
					projectPath: '/test/project',
				})
			);

			let loadedSubagents: SubagentInfo[] = [];
			await act(async () => {
				loadedSubagents = await result.current.loadSubagentsForSession('session-123');
			});

			// Should return empty array on error
			expect(loadedSubagents).toEqual([]);

			// Should cache the empty result to prevent retries
			expect(result.current.subagentsBySession.get('session-123')).toEqual([]);

			consoleSpy.mockRestore();
		});
	});

	describe('toggleSessionExpansion', () => {
		it('should toggle session expansion state', async () => {
			const mockSubagents = [createMockSubagent('sub1')];
			mockListSubagents.mockResolvedValue(mockSubagents);

			const { result } = renderHook(() =>
				useSubagentLoader({
					agentId: 'claude-code',
					projectPath: '/test/project',
				})
			);

			// Initially not expanded
			expect(result.current.expandedSessions.has('session-123')).toBe(false);

			// Toggle to expand
			await act(async () => {
				await result.current.toggleSessionExpansion('session-123');
			});

			expect(result.current.expandedSessions.has('session-123')).toBe(true);

			// Toggle to collapse
			await act(async () => {
				await result.current.toggleSessionExpansion('session-123');
			});

			expect(result.current.expandedSessions.has('session-123')).toBe(false);
		});

		it('should load subagents when expanding', async () => {
			const mockSubagents = [createMockSubagent('sub1')];
			mockListSubagents.mockResolvedValue(mockSubagents);

			const { result } = renderHook(() =>
				useSubagentLoader({
					agentId: 'claude-code',
					projectPath: '/test/project',
				})
			);

			await act(async () => {
				await result.current.toggleSessionExpansion('session-123');
			});

			expect(mockListSubagents).toHaveBeenCalledTimes(1);
			expect(result.current.subagentsBySession.get('session-123')).toEqual(mockSubagents);
		});
	});

	describe('expandSession', () => {
		it('should expand session and load subagents', async () => {
			const mockSubagents = [createMockSubagent('sub1')];
			mockListSubagents.mockResolvedValue(mockSubagents);

			const { result } = renderHook(() =>
				useSubagentLoader({
					agentId: 'claude-code',
					projectPath: '/test/project',
				})
			);

			await act(async () => {
				await result.current.expandSession('session-123');
			});

			expect(result.current.expandedSessions.has('session-123')).toBe(true);
			expect(result.current.subagentsBySession.get('session-123')).toEqual(mockSubagents);
		});

		it('should not reload subagents if already cached', async () => {
			const mockSubagents = [createMockSubagent('sub1')];
			mockListSubagents.mockResolvedValue(mockSubagents);

			const { result } = renderHook(() =>
				useSubagentLoader({
					agentId: 'claude-code',
					projectPath: '/test/project',
				})
			);

			// First expand
			await act(async () => {
				await result.current.expandSession('session-123');
			});

			// Collapse
			act(() => {
				result.current.collapseSession('session-123');
			});

			// Expand again
			await act(async () => {
				await result.current.expandSession('session-123');
			});

			// Should still only call API once due to cache
			expect(mockListSubagents).toHaveBeenCalledTimes(1);
		});
	});

	describe('collapseSession', () => {
		it('should collapse session without clearing cache', async () => {
			const mockSubagents = [createMockSubagent('sub1')];
			mockListSubagents.mockResolvedValue(mockSubagents);

			const { result } = renderHook(() =>
				useSubagentLoader({
					agentId: 'claude-code',
					projectPath: '/test/project',
				})
			);

			// Expand first
			await act(async () => {
				await result.current.expandSession('session-123');
			});

			expect(result.current.expandedSessions.has('session-123')).toBe(true);

			// Collapse
			act(() => {
				result.current.collapseSession('session-123');
			});

			expect(result.current.expandedSessions.has('session-123')).toBe(false);
			// Cache should still be present
			expect(result.current.subagentsBySession.get('session-123')).toEqual(mockSubagents);
		});
	});

	describe('loadingSubagents', () => {
		it('should track loading state correctly', async () => {
			let resolvePromise: (value: SubagentInfo[]) => void;
			const loadingPromise = new Promise<SubagentInfo[]>((resolve) => {
				resolvePromise = resolve;
			});
			mockListSubagents.mockReturnValue(loadingPromise);

			const { result } = renderHook(() =>
				useSubagentLoader({
					agentId: 'claude-code',
					projectPath: '/test/project',
				})
			);

			// Start loading
			act(() => {
				result.current.loadSubagentsForSession('session-123');
			});

			// Should be loading
			expect(result.current.loadingSubagents.has('session-123')).toBe(true);

			// Resolve
			await act(async () => {
				resolvePromise!([createMockSubagent('sub1')]);
			});

			// Should not be loading anymore
			await waitFor(() => {
				expect(result.current.loadingSubagents.has('session-123')).toBe(false);
			});
		});

		it('should clear loading state on error', async () => {
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			let rejectPromise: (error: Error) => void;
			const loadingPromise = new Promise<SubagentInfo[]>((_, reject) => {
				rejectPromise = reject;
			});
			mockListSubagents.mockReturnValue(loadingPromise);

			const { result } = renderHook(() =>
				useSubagentLoader({
					agentId: 'claude-code',
					projectPath: '/test/project',
				})
			);

			// Start loading
			act(() => {
				result.current.loadSubagentsForSession('session-123');
			});

			expect(result.current.loadingSubagents.has('session-123')).toBe(true);

			// Reject
			await act(async () => {
				rejectPromise!(new Error('Network error'));
			});

			// Should clear loading state
			await waitFor(() => {
				expect(result.current.loadingSubagents.has('session-123')).toBe(false);
			});

			consoleSpy.mockRestore();
		});
	});

	describe('hasLoadedSubagents', () => {
		it('should return true when subagents are cached', async () => {
			const mockSubagents = [createMockSubagent('sub1')];
			mockListSubagents.mockResolvedValue(mockSubagents);

			const { result } = renderHook(() =>
				useSubagentLoader({
					agentId: 'claude-code',
					projectPath: '/test/project',
				})
			);

			expect(result.current.hasLoadedSubagents('session-123')).toBe(false);

			await act(async () => {
				await result.current.loadSubagentsForSession('session-123');
			});

			expect(result.current.hasLoadedSubagents('session-123')).toBe(true);
		});
	});

	describe('clearCache', () => {
		it('should clear all cached data', async () => {
			const mockSubagents = [createMockSubagent('sub1')];
			mockListSubagents.mockResolvedValue(mockSubagents);

			const { result } = renderHook(() =>
				useSubagentLoader({
					agentId: 'claude-code',
					projectPath: '/test/project',
				})
			);

			// Load and expand
			await act(async () => {
				await result.current.expandSession('session-123');
			});

			expect(result.current.subagentsBySession.size).toBe(1);
			expect(result.current.expandedSessions.size).toBe(1);

			// Clear cache
			act(() => {
				result.current.clearCache();
			});

			expect(result.current.subagentsBySession.size).toBe(0);
			expect(result.current.expandedSessions.size).toBe(0);
			expect(result.current.loadingSubagents.size).toBe(0);
		});
	});

	describe('sshRemoteId parameter', () => {
		it('should pass sshRemoteId to listSubagents when provided', async () => {
			mockListSubagents.mockResolvedValue([]);

			const { result } = renderHook(() =>
				useSubagentLoader({
					agentId: 'claude-code',
					projectPath: '/test/project',
					sshRemoteId: 'remote-123',
				})
			);

			await act(async () => {
				await result.current.loadSubagentsForSession('session-123');
			});

			expect(mockListSubagents).toHaveBeenCalledWith(
				'claude-code',
				'/test/project',
				'session-123',
				'remote-123'
			);
		});

		it('should pass undefined sshRemoteId when not provided', async () => {
			mockListSubagents.mockResolvedValue([]);

			const { result } = renderHook(() =>
				useSubagentLoader({
					agentId: 'claude-code',
					projectPath: '/test/project',
				})
			);

			await act(async () => {
				await result.current.loadSubagentsForSession('session-123');
			});

			expect(mockListSubagents).toHaveBeenCalledWith(
				'claude-code',
				'/test/project',
				'session-123',
				undefined
			);
		});
	});

	describe('multiple sessions', () => {
		it('should handle multiple sessions independently', async () => {
			const subagents1 = [createMockSubagent('sub1', { agentType: 'Explore' })];
			const subagents2 = [createMockSubagent('sub2', { agentType: 'Plan' })];

			mockListSubagents.mockResolvedValueOnce(subagents1).mockResolvedValueOnce(subagents2);

			const { result } = renderHook(() =>
				useSubagentLoader({
					agentId: 'claude-code',
					projectPath: '/test/project',
				})
			);

			// Load both sessions
			await act(async () => {
				await result.current.loadSubagentsForSession('session-1');
				await result.current.loadSubagentsForSession('session-2');
			});

			expect(result.current.subagentsBySession.get('session-1')).toEqual(subagents1);
			expect(result.current.subagentsBySession.get('session-2')).toEqual(subagents2);
			expect(mockListSubagents).toHaveBeenCalledTimes(2);
		});

		it('should track expansion state for multiple sessions independently', async () => {
			const mockSubagents = [createMockSubagent('sub1')];
			mockListSubagents.mockResolvedValue(mockSubagents);

			const { result } = renderHook(() =>
				useSubagentLoader({
					agentId: 'claude-code',
					projectPath: '/test/project',
				})
			);

			// Expand both
			await act(async () => {
				await result.current.expandSession('session-1');
				await result.current.expandSession('session-2');
			});

			expect(result.current.expandedSessions.has('session-1')).toBe(true);
			expect(result.current.expandedSessions.has('session-2')).toBe(true);

			// Collapse one
			act(() => {
				result.current.collapseSession('session-1');
			});

			expect(result.current.expandedSessions.has('session-1')).toBe(false);
			expect(result.current.expandedSessions.has('session-2')).toBe(true);
		});
	});
});
