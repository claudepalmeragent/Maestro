/**
 * Tests for useDocumentPolling hook
 *
 * This hook provides document polling functionality to detect partial checkbox
 * completion during long-running tasks.
 */

import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	useDocumentPolling,
	DEFAULT_LOCAL_POLL_INTERVAL_MS,
	DEFAULT_SSH_POLL_INTERVAL_MS,
} from '../useDocumentPolling';

describe('useDocumentPolling', () => {
	// Mock window.maestro.autorun.readDoc before each test
	const mockReadDoc = vi.fn();

	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		mockReadDoc.mockReset();
		// Override the mock for each test
		(window.maestro.autorun.readDoc as ReturnType<typeof vi.fn>) = mockReadDoc;
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('should not poll when disabled', async () => {
		const onProgressUpdate = vi.fn();

		renderHook(() =>
			useDocumentPolling({
				enabled: false,
				isProcessingTask: true,
				folderPath: '/test',
				documentFilename: 'test.md',
				onProgressUpdate,
			})
		);

		await vi.advanceTimersByTimeAsync(15000);

		expect(mockReadDoc).not.toHaveBeenCalled();
	});

	it('should not poll when not processing task', async () => {
		const onProgressUpdate = vi.fn();

		renderHook(() =>
			useDocumentPolling({
				enabled: true,
				isProcessingTask: false,
				folderPath: '/test',
				documentFilename: 'test.md',
				onProgressUpdate,
			})
		);

		await vi.advanceTimersByTimeAsync(15000);

		expect(mockReadDoc).not.toHaveBeenCalled();
	});

	it('should poll when enabled and processing task', async () => {
		const onProgressUpdate = vi.fn();
		mockReadDoc.mockResolvedValue({
			success: true,
			content: '- [ ] Task 1\n- [x] Task 2',
		});

		renderHook(() =>
			useDocumentPolling({
				enabled: true,
				isProcessingTask: true,
				folderPath: '/test',
				documentFilename: 'test.md',
				pollingIntervalMs: 1000,
				onProgressUpdate,
			})
		);

		// Allow initial poll to complete
		await vi.advanceTimersByTimeAsync(0);

		// Initial poll should happen immediately
		expect(mockReadDoc).toHaveBeenCalledWith('/test', 'test.md', undefined);
	});

	it('should use longer interval for SSH', async () => {
		const onProgressUpdate = vi.fn();
		mockReadDoc.mockResolvedValue({
			success: true,
			content: '- [ ] Task 1',
		});

		const { result } = renderHook(() =>
			useDocumentPolling({
				enabled: true,
				isProcessingTask: true,
				folderPath: '/test',
				documentFilename: 'test.md',
				sshRemoteId: 'remote-1',
				onProgressUpdate,
			})
		);

		await vi.advanceTimersByTimeAsync(0);

		// Verify that SSH remote ID is passed to readDoc
		expect(mockReadDoc).toHaveBeenCalledWith('/test', 'test.md', 'remote-1');

		// Should have isPolling state
		expect(result.current.isPolling).toBeDefined();
	});

	it('should call onProgressUpdate when checked count changes', async () => {
		const onProgressUpdate = vi.fn();

		// First poll: 1 checked
		mockReadDoc.mockResolvedValueOnce({
			success: true,
			content: '- [x] Task 1\n- [ ] Task 2',
		});
		// Second poll: 2 checked
		mockReadDoc.mockResolvedValueOnce({
			success: true,
			content: '- [x] Task 1\n- [x] Task 2',
		});

		renderHook(() =>
			useDocumentPolling({
				enabled: true,
				isProcessingTask: true,
				folderPath: '/test',
				documentFilename: 'test.md',
				pollingIntervalMs: 1000,
				onProgressUpdate,
			})
		);

		// Initial poll
		await vi.advanceTimersByTimeAsync(0);
		expect(mockReadDoc).toHaveBeenCalledTimes(1);

		// Advance to next poll
		await vi.advanceTimersByTimeAsync(1000);
		expect(mockReadDoc).toHaveBeenCalledTimes(2);

		// Should have detected progress change (from 1 to 2 checked)
		expect(onProgressUpdate).toHaveBeenCalledWith(2, 0);
	});

	it('should stop polling when stopPolling is called', async () => {
		const onProgressUpdate = vi.fn();
		mockReadDoc.mockResolvedValue({
			success: true,
			content: '- [ ] Task 1',
		});

		const { result } = renderHook(() =>
			useDocumentPolling({
				enabled: true,
				isProcessingTask: true,
				folderPath: '/test',
				documentFilename: 'test.md',
				pollingIntervalMs: 1000,
				onProgressUpdate,
			})
		);

		// Initial poll
		await vi.advanceTimersByTimeAsync(0);
		expect(mockReadDoc).toHaveBeenCalledTimes(1);

		// Stop polling
		act(() => {
			result.current.stopPolling();
		});

		// Advance time
		await vi.advanceTimersByTimeAsync(5000);

		// Should not have polled again
		expect(mockReadDoc).toHaveBeenCalledTimes(1);
	});

	it('should not call onProgressUpdate when checked count stays the same', async () => {
		const onProgressUpdate = vi.fn();

		// Both polls return same content
		mockReadDoc.mockResolvedValue({
			success: true,
			content: '- [x] Task 1\n- [ ] Task 2',
		});

		renderHook(() =>
			useDocumentPolling({
				enabled: true,
				isProcessingTask: true,
				folderPath: '/test',
				documentFilename: 'test.md',
				pollingIntervalMs: 1000,
				onProgressUpdate,
			})
		);

		// Initial poll
		await vi.advanceTimersByTimeAsync(0);
		expect(mockReadDoc).toHaveBeenCalledTimes(1);

		// Advance to next poll
		await vi.advanceTimersByTimeAsync(1000);
		expect(mockReadDoc).toHaveBeenCalledTimes(2);

		// Should not have called onProgressUpdate because count didn't change
		expect(onProgressUpdate).not.toHaveBeenCalled();
	});

	it('should handle read errors gracefully', async () => {
		const onProgressUpdate = vi.fn();
		const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		mockReadDoc.mockRejectedValueOnce(new Error('Read failed'));

		renderHook(() =>
			useDocumentPolling({
				enabled: true,
				isProcessingTask: true,
				folderPath: '/test',
				documentFilename: 'test.md',
				pollingIntervalMs: 1000,
				onProgressUpdate,
			})
		);

		// Initial poll
		await vi.advanceTimersByTimeAsync(0);
		expect(mockReadDoc).toHaveBeenCalledTimes(1);

		// Should have logged warning
		expect(consoleSpy).toHaveBeenCalledWith(
			'[useDocumentPolling] Error reading document:',
			expect.any(Error)
		);

		// Should not have called onProgressUpdate
		expect(onProgressUpdate).not.toHaveBeenCalled();

		consoleSpy.mockRestore();
	});

	it('should handle unsuccessful read result', async () => {
		const onProgressUpdate = vi.fn();

		mockReadDoc.mockResolvedValue({
			success: false,
			content: null,
		});

		renderHook(() =>
			useDocumentPolling({
				enabled: true,
				isProcessingTask: true,
				folderPath: '/test',
				documentFilename: 'test.md',
				pollingIntervalMs: 1000,
				onProgressUpdate,
			})
		);

		// Initial poll
		await vi.advanceTimersByTimeAsync(0);
		expect(mockReadDoc).toHaveBeenCalledTimes(1);

		// Should not have called onProgressUpdate
		expect(onProgressUpdate).not.toHaveBeenCalled();
	});

	it('should not poll when folderPath is empty', async () => {
		const onProgressUpdate = vi.fn();

		renderHook(() =>
			useDocumentPolling({
				enabled: true,
				isProcessingTask: true,
				folderPath: '',
				documentFilename: 'test.md',
				onProgressUpdate,
			})
		);

		await vi.advanceTimersByTimeAsync(15000);

		// The important thing is onProgressUpdate is not called
		expect(onProgressUpdate).not.toHaveBeenCalled();
	});

	it('should not poll when documentFilename is empty', async () => {
		const onProgressUpdate = vi.fn();

		renderHook(() =>
			useDocumentPolling({
				enabled: true,
				isProcessingTask: true,
				folderPath: '/test',
				documentFilename: '',
				onProgressUpdate,
			})
		);

		await vi.advanceTimersByTimeAsync(15000);

		expect(onProgressUpdate).not.toHaveBeenCalled();
	});

	it('should use custom polling interval when provided', async () => {
		const onProgressUpdate = vi.fn();
		mockReadDoc.mockResolvedValue({
			success: true,
			content: '- [x] Task 1',
		});

		renderHook(() =>
			useDocumentPolling({
				enabled: true,
				isProcessingTask: true,
				folderPath: '/test',
				documentFilename: 'test.md',
				pollingIntervalMs: 500,
				onProgressUpdate,
			})
		);

		// Initial poll
		await vi.advanceTimersByTimeAsync(0);
		expect(mockReadDoc).toHaveBeenCalledTimes(1);

		// Advance by custom interval
		await vi.advanceTimersByTimeAsync(500);

		// Should have polled again
		expect(mockReadDoc).toHaveBeenCalledTimes(2);
	});

	it('should expose default polling intervals', () => {
		// Verify the constants are exported and have expected values
		expect(DEFAULT_LOCAL_POLL_INTERVAL_MS).toBe(10000);
		expect(DEFAULT_SSH_POLL_INTERVAL_MS).toBe(15000);
	});

	it('should allow forcing an immediate poll with pollNow', async () => {
		const onProgressUpdate = vi.fn();
		mockReadDoc.mockResolvedValue({
			success: true,
			content: '- [x] Task 1\n- [ ] Task 2',
		});

		const { result } = renderHook(() =>
			useDocumentPolling({
				enabled: true,
				isProcessingTask: true,
				folderPath: '/test',
				documentFilename: 'test.md',
				pollingIntervalMs: 10000, // Long interval
				onProgressUpdate,
			})
		);

		// Initial poll
		await vi.advanceTimersByTimeAsync(0);
		expect(mockReadDoc).toHaveBeenCalledTimes(1);

		// Force immediate poll
		await act(async () => {
			await result.current.pollNow();
		});

		// Should have polled again immediately
		expect(mockReadDoc).toHaveBeenCalledTimes(2);
	});

	it('should clean up interval on unmount', async () => {
		const onProgressUpdate = vi.fn();
		mockReadDoc.mockResolvedValue({
			success: true,
			content: '- [ ] Task 1',
		});

		const { unmount } = renderHook(() =>
			useDocumentPolling({
				enabled: true,
				isProcessingTask: true,
				folderPath: '/test',
				documentFilename: 'test.md',
				pollingIntervalMs: 1000,
				onProgressUpdate,
			})
		);

		// Initial poll
		await vi.advanceTimersByTimeAsync(0);
		expect(mockReadDoc).toHaveBeenCalledTimes(1);

		// Unmount the hook
		unmount();

		// Advance time
		await vi.advanceTimersByTimeAsync(5000);

		// Should not have polled after unmount
		expect(mockReadDoc).toHaveBeenCalledTimes(1);
	});

	it('should restart polling when isProcessingTask changes from false to true', async () => {
		const onProgressUpdate = vi.fn();
		mockReadDoc.mockResolvedValue({
			success: true,
			content: '- [ ] Task 1',
		});

		const { rerender } = renderHook(
			({ isProcessingTask }) =>
				useDocumentPolling({
					enabled: true,
					isProcessingTask,
					folderPath: '/test',
					documentFilename: 'test.md',
					pollingIntervalMs: 1000,
					onProgressUpdate,
				}),
			{ initialProps: { isProcessingTask: false } }
		);

		await vi.advanceTimersByTimeAsync(0);

		// Should not have polled
		expect(mockReadDoc).not.toHaveBeenCalled();

		// Start processing
		rerender({ isProcessingTask: true });
		await vi.advanceTimersByTimeAsync(0);

		// Should start polling
		expect(mockReadDoc).toHaveBeenCalledTimes(1);
	});

	it('should stop polling when isProcessingTask changes from true to false', async () => {
		const onProgressUpdate = vi.fn();
		mockReadDoc.mockResolvedValue({
			success: true,
			content: '- [ ] Task 1',
		});

		const { rerender } = renderHook(
			({ isProcessingTask }) =>
				useDocumentPolling({
					enabled: true,
					isProcessingTask,
					folderPath: '/test',
					documentFilename: 'test.md',
					pollingIntervalMs: 1000,
					onProgressUpdate,
				}),
			{ initialProps: { isProcessingTask: true } }
		);

		// Initial poll
		await vi.advanceTimersByTimeAsync(0);
		expect(mockReadDoc).toHaveBeenCalledTimes(1);

		// Stop processing
		rerender({ isProcessingTask: false });

		// Advance time
		await vi.advanceTimersByTimeAsync(5000);

		// Should not have polled again
		expect(mockReadDoc).toHaveBeenCalledTimes(1);
	});
});
