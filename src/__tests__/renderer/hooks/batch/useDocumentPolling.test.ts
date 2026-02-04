/**
 * Tests for useDocumentPolling hook - Document Polling During Long Tasks
 *
 * This file tests the document polling functionality that detects partial
 * checkbox completion during long-running agent tasks (Option D - Progress Enhancement).
 *
 * Key test areas:
 * - Polling interval configuration (local vs SSH defaults)
 * - Auto-start/stop based on task processing state
 * - Progress change detection and callback invocation
 * - Memory safety (cleanup on unmount)
 * - Error handling during document reads
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
	useDocumentPolling,
	DEFAULT_LOCAL_POLL_INTERVAL_MS,
	DEFAULT_SSH_POLL_INTERVAL_MS,
} from '../../../../renderer/hooks/batch/useDocumentPolling';
import {
	countCheckedTasks,
	countUnfinishedTasks,
} from '../../../../renderer/hooks/batch/batchUtils';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Creates sample markdown content with specified checked/unchecked counts
 */
function createMarkdownContent(checkedCount: number, uncheckedCount: number): string {
	let content = '# Test Document\n\n## Tasks\n\n';

	for (let i = 0; i < checkedCount; i++) {
		content += `- [x] Completed task ${i + 1}\n`;
	}

	for (let i = 0; i < uncheckedCount; i++) {
		content += `- [ ] Pending task ${i + 1}\n`;
	}

	return content;
}

// ============================================================================
// Tests for batchUtils (used by useDocumentPolling)
// ============================================================================

describe('batchUtils - countCheckedTasks', () => {
	it('should count zero checked tasks in empty content', () => {
		expect(countCheckedTasks('')).toBe(0);
	});

	it('should count zero checked tasks when all tasks are unchecked', () => {
		const content = createMarkdownContent(0, 5);
		expect(countCheckedTasks(content)).toBe(0);
	});

	it('should count all checked tasks correctly', () => {
		const content = createMarkdownContent(3, 0);
		expect(countCheckedTasks(content)).toBe(3);
	});

	it('should count mixed checked/unchecked correctly', () => {
		const content = createMarkdownContent(2, 3);
		expect(countCheckedTasks(content)).toBe(2);
	});

	it('should handle uppercase X in checkbox', () => {
		const content = '- [X] Task with uppercase X';
		expect(countCheckedTasks(content)).toBe(1);
	});

	it('should handle checkmark variants', () => {
		const content = `- [x] Lowercase x
- [X] Uppercase X
- [✓] Checkmark
- [✔] Heavy checkmark`;
		expect(countCheckedTasks(content)).toBe(4);
	});
});

describe('batchUtils - countUnfinishedTasks', () => {
	it('should count zero unchecked tasks in empty content', () => {
		expect(countUnfinishedTasks('')).toBe(0);
	});

	it('should count zero unchecked tasks when all tasks are checked', () => {
		const content = createMarkdownContent(5, 0);
		expect(countUnfinishedTasks(content)).toBe(0);
	});

	it('should count all unchecked tasks correctly', () => {
		const content = createMarkdownContent(0, 4);
		expect(countUnfinishedTasks(content)).toBe(4);
	});

	it('should count mixed checked/unchecked correctly', () => {
		const content = createMarkdownContent(2, 3);
		expect(countUnfinishedTasks(content)).toBe(3);
	});
});

// ============================================================================
// Tests for Fenced Code Block Exclusion
// ============================================================================

describe('batchUtils - Fenced Code Block Exclusion', () => {
	it('should not count checkboxes inside backtick code blocks', () => {
		const content = `# Test Document

## Real Tasks
- [x] Real task 1
- [ ] Real task 2

## Example Code
\`\`\`markdown
- [ ] Example unchecked task (should NOT count)
- [x] Example checked task (should NOT count)
\`\`\`

- [x] Real task 3
`;
		expect(countCheckedTasks(content)).toBe(2); // Only real tasks 1 and 3
		expect(countUnfinishedTasks(content)).toBe(1); // Only real task 2
	});

	it('should not count checkboxes inside tilde code blocks', () => {
		const content = `# Test Document

- [x] Real checked task

~~~typescript
const mockContent = '- [ ] Mock unchecked task';
// - [x] Comment checkbox (should NOT count)
~~~

- [ ] Real unchecked task
`;
		expect(countCheckedTasks(content)).toBe(1);
		expect(countUnfinishedTasks(content)).toBe(1);
	});

	it('should handle code blocks with language identifiers', () => {
		const content = `# Test

- [x] Task 1

\`\`\`typescript
// Test data
const tasks = '- [ ] fake task';
\`\`\`

\`\`\`markdown
- [ ] Example task in markdown block
\`\`\`

- [ ] Task 2
`;
		expect(countCheckedTasks(content)).toBe(1);
		expect(countUnfinishedTasks(content)).toBe(1);
	});

	it('should handle multiple code blocks', () => {
		const content = `# Auto Run Document

- [x] Task 1
- [ ] Task 2

\`\`\`markdown
- [ ] Example 1
\`\`\`

- [x] Task 3

\`\`\`
- [ ] Example 2
- [x] Example 3
\`\`\`

- [ ] Task 4
`;
		expect(countCheckedTasks(content)).toBe(2); // Tasks 1 and 3
		expect(countUnfinishedTasks(content)).toBe(2); // Tasks 2 and 4
	});

	it('should handle nested/indented code in blocks', () => {
		const content = `# Test

- [x] Real task

\`\`\`typescript
describe('test', () => {
	const markdown = \`
		- [ ] Nested checkbox
		- [x] Another nested checkbox
	\`;
});
\`\`\`

- [ ] Another real task
`;
		expect(countCheckedTasks(content)).toBe(1);
		expect(countUnfinishedTasks(content)).toBe(1);
	});

	it('should still work with content without code blocks', () => {
		const content = `# Simple Document

- [x] Task 1
- [x] Task 2
- [ ] Task 3
- [ ] Task 4
- [ ] Task 5
`;
		expect(countCheckedTasks(content)).toBe(2);
		expect(countUnfinishedTasks(content)).toBe(3);
	});
});

// ============================================================================
// Tests for Polling Interval Configuration
// ============================================================================

describe('useDocumentPolling - Polling Interval Configuration', () => {
	it('should export correct default local poll interval', () => {
		expect(DEFAULT_LOCAL_POLL_INTERVAL_MS).toBe(10000); // 10 seconds
	});

	it('should export correct default SSH poll interval', () => {
		expect(DEFAULT_SSH_POLL_INTERVAL_MS).toBe(15000); // 15 seconds
	});

	describe('with fake timers', () => {
		beforeEach(() => {
			vi.useFakeTimers();
			// Configure the mock to return sample content
			vi.mocked(window.maestro.autorun.readDoc).mockResolvedValue({
				success: true,
				content: createMarkdownContent(0, 5),
			});
		});

		afterEach(() => {
			vi.useRealTimers();
			vi.mocked(window.maestro.autorun.readDoc).mockReset();
		});

		it('should use local interval when no SSH remote specified', async () => {
			const onProgressUpdate = vi.fn();

			const { unmount } = renderHook(() =>
				useDocumentPolling({
					enabled: true,
					isProcessingTask: true,
					folderPath: '/test/folder',
					documentFilename: 'PROGRESS.md',
					sshRemoteId: undefined,
					pollingIntervalMs: undefined,
					onProgressUpdate,
				})
			);

			// Flush initial effects
			await act(async () => {
				await vi.runOnlyPendingTimersAsync();
			});

			// Initial poll should have happened
			const initialCallCount = vi.mocked(window.maestro.autorun.readDoc).mock.calls.length;
			expect(initialCallCount).toBeGreaterThanOrEqual(1);

			// Advance timer by local interval
			await act(async () => {
				vi.advanceTimersByTime(DEFAULT_LOCAL_POLL_INTERVAL_MS);
				await vi.runOnlyPendingTimersAsync();
			});

			// Should have at least one more call after the interval
			expect(vi.mocked(window.maestro.autorun.readDoc).mock.calls.length).toBeGreaterThan(
				initialCallCount
			);

			unmount();
		});

		it('should use custom interval when provided', async () => {
			const onProgressUpdate = vi.fn();
			const customInterval = 5000; // 5 seconds

			const { unmount } = renderHook(() =>
				useDocumentPolling({
					enabled: true,
					isProcessingTask: true,
					folderPath: '/test/folder',
					documentFilename: 'PROGRESS.md',
					sshRemoteId: undefined,
					pollingIntervalMs: customInterval,
					onProgressUpdate,
				})
			);

			// Flush initial effects
			await act(async () => {
				await vi.runOnlyPendingTimersAsync();
			});

			// Initial poll
			const initialCallCount = vi.mocked(window.maestro.autorun.readDoc).mock.calls.length;
			expect(initialCallCount).toBeGreaterThanOrEqual(1);

			// Advance by custom interval
			await act(async () => {
				vi.advanceTimersByTime(customInterval);
				await vi.runOnlyPendingTimersAsync();
			});

			// Should have at least one more poll after interval
			expect(vi.mocked(window.maestro.autorun.readDoc).mock.calls.length).toBeGreaterThan(
				initialCallCount
			);

			unmount();
		});
	});
});

// ============================================================================
// Tests for Auto-Start/Stop Behavior
// ============================================================================

describe('useDocumentPolling - Auto-Start/Stop Behavior', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.mocked(window.maestro.autorun.readDoc).mockResolvedValue({
			success: true,
			content: createMarkdownContent(0, 5),
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.mocked(window.maestro.autorun.readDoc).mockReset();
	});

	it('should auto-start polling when enabled and task is processing', async () => {
		const onProgressUpdate = vi.fn();

		const { unmount } = renderHook(() =>
			useDocumentPolling({
				enabled: true,
				isProcessingTask: true,
				folderPath: '/test/folder',
				documentFilename: 'PROGRESS.md',
				onProgressUpdate,
			})
		);

		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});

		// Verify polling started by checking readDoc was called at least once
		expect(window.maestro.autorun.readDoc).toHaveBeenCalled();

		unmount();
	});

	it('should NOT start polling when disabled', async () => {
		const onProgressUpdate = vi.fn();

		const { unmount } = renderHook(() =>
			useDocumentPolling({
				enabled: false,
				isProcessingTask: true,
				folderPath: '/test/folder',
				documentFilename: 'PROGRESS.md',
				onProgressUpdate,
			})
		);

		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});

		// Verify polling did NOT start
		expect(window.maestro.autorun.readDoc).not.toHaveBeenCalled();

		unmount();
	});

	it('should NOT start polling when not processing task', async () => {
		const onProgressUpdate = vi.fn();

		const { unmount } = renderHook(() =>
			useDocumentPolling({
				enabled: true,
				isProcessingTask: false,
				folderPath: '/test/folder',
				documentFilename: 'PROGRESS.md',
				onProgressUpdate,
			})
		);

		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});

		// Verify polling did NOT start
		expect(window.maestro.autorun.readDoc).not.toHaveBeenCalled();

		unmount();
	});

	it('should auto-stop polling when task processing ends', async () => {
		const onProgressUpdate = vi.fn();

		const { rerender, unmount } = renderHook(
			({ isProcessingTask }) =>
				useDocumentPolling({
					enabled: true,
					isProcessingTask,
					folderPath: '/test/folder',
					documentFilename: 'PROGRESS.md',
					onProgressUpdate,
				}),
			{ initialProps: { isProcessingTask: true } }
		);

		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});

		// Verify polling started
		const initialCallCount = vi.mocked(window.maestro.autorun.readDoc).mock.calls.length;
		expect(initialCallCount).toBeGreaterThan(0);

		// Stop task processing
		rerender({ isProcessingTask: false });

		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});

		// Advance timer - should NOT poll
		await act(async () => {
			vi.advanceTimersByTime(DEFAULT_LOCAL_POLL_INTERVAL_MS);
			await vi.runOnlyPendingTimersAsync();
		});

		// Should NOT have any new polls after stop
		expect(window.maestro.autorun.readDoc).toHaveBeenCalledTimes(initialCallCount);

		unmount();
	});

	it('should cleanup polling on unmount', async () => {
		const onProgressUpdate = vi.fn();

		const { unmount } = renderHook(() =>
			useDocumentPolling({
				enabled: true,
				isProcessingTask: true,
				folderPath: '/test/folder',
				documentFilename: 'PROGRESS.md',
				onProgressUpdate,
			})
		);

		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});

		const callCountBeforeUnmount = vi.mocked(window.maestro.autorun.readDoc).mock.calls.length;

		// Unmount the hook
		unmount();

		// Advance timer - should NOT trigger any more polls
		await act(async () => {
			vi.advanceTimersByTime(DEFAULT_LOCAL_POLL_INTERVAL_MS * 3);
			await vi.runOnlyPendingTimersAsync();
		});

		// No new calls after unmount
		expect(window.maestro.autorun.readDoc).toHaveBeenCalledTimes(callCountBeforeUnmount);
	});
});

// ============================================================================
// Tests for Progress Change Detection
// ============================================================================

describe('useDocumentPolling - Progress Change Detection', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.mocked(window.maestro.autorun.readDoc).mockReset();
	});

	it('should NOT call onProgressUpdate on first poll (establishing baseline)', async () => {
		const onProgressUpdate = vi.fn();
		vi.mocked(window.maestro.autorun.readDoc).mockResolvedValue({
			success: true,
			content: createMarkdownContent(2, 3),
		});

		const { unmount } = renderHook(() =>
			useDocumentPolling({
				enabled: true,
				isProcessingTask: true,
				folderPath: '/test/folder',
				documentFilename: 'PROGRESS.md',
				onProgressUpdate,
			})
		);

		// Wait for initial poll to complete
		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});

		// Verify readDoc was called (initial poll happened)
		expect(window.maestro.autorun.readDoc).toHaveBeenCalled();
		// Should NOT have called onProgressUpdate (first poll establishes baseline)
		expect(onProgressUpdate).not.toHaveBeenCalled();

		unmount();
	});

	it('should call onProgressUpdate when checked count increases', async () => {
		const onProgressUpdate = vi.fn();

		// Set up mock to return different values on subsequent calls
		let callCount = 0;
		vi.mocked(window.maestro.autorun.readDoc).mockImplementation(async () => {
			callCount++;
			// First few calls return 2 checked
			if (callCount <= 2) {
				return { success: true, content: createMarkdownContent(2, 3) };
			}
			// Subsequent calls return 3 checked (progress!)
			return { success: true, content: createMarkdownContent(3, 2) };
		});

		const { unmount } = renderHook(() =>
			useDocumentPolling({
				enabled: true,
				isProcessingTask: true,
				folderPath: '/test/folder',
				documentFilename: 'PROGRESS.md',
				onProgressUpdate,
			})
		);

		// Wait for initial poll
		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});

		// Verify initial polls happened
		expect(window.maestro.autorun.readDoc).toHaveBeenCalled();

		// Advance to trigger more polls (the mock will return updated content)
		await act(async () => {
			vi.advanceTimersByTime(DEFAULT_LOCAL_POLL_INTERVAL_MS);
			await vi.runOnlyPendingTimersAsync();
		});

		await act(async () => {
			vi.advanceTimersByTime(DEFAULT_LOCAL_POLL_INTERVAL_MS);
			await vi.runOnlyPendingTimersAsync();
		});

		// Should have called onProgressUpdate when change was detected
		expect(onProgressUpdate).toHaveBeenCalledWith(3, 2);

		unmount();
	});

	it('should NOT call onProgressUpdate when counts are unchanged', async () => {
		const onProgressUpdate = vi.fn();
		const content = createMarkdownContent(2, 3);

		// All polls return same content
		vi.mocked(window.maestro.autorun.readDoc).mockResolvedValue({
			success: true,
			content,
		});

		const { unmount } = renderHook(() =>
			useDocumentPolling({
				enabled: true,
				isProcessingTask: true,
				folderPath: '/test/folder',
				documentFilename: 'PROGRESS.md',
				onProgressUpdate,
			})
		);

		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});

		// Multiple polling cycles with same content
		for (let i = 0; i < 3; i++) {
			await act(async () => {
				vi.advanceTimersByTime(DEFAULT_LOCAL_POLL_INTERVAL_MS);
				await vi.runOnlyPendingTimersAsync();
			});
		}

		// Should never call onProgressUpdate (no change)
		expect(onProgressUpdate).not.toHaveBeenCalled();

		unmount();
	});

	it('should track multiple progress changes correctly', async () => {
		const onProgressUpdate = vi.fn();

		// Simulate incremental progress
		vi.mocked(window.maestro.autorun.readDoc)
			.mockResolvedValueOnce({ success: true, content: createMarkdownContent(0, 5) })
			.mockResolvedValueOnce({ success: true, content: createMarkdownContent(1, 4) })
			.mockResolvedValueOnce({ success: true, content: createMarkdownContent(2, 3) })
			.mockResolvedValueOnce({ success: true, content: createMarkdownContent(3, 2) });

		const { unmount } = renderHook(() =>
			useDocumentPolling({
				enabled: true,
				isProcessingTask: true,
				folderPath: '/test/folder',
				documentFilename: 'PROGRESS.md',
				onProgressUpdate,
			})
		);

		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});

		// Trigger 3 more polls
		for (let i = 0; i < 3; i++) {
			await act(async () => {
				vi.advanceTimersByTime(DEFAULT_LOCAL_POLL_INTERVAL_MS);
				await vi.runOnlyPendingTimersAsync();
			});
		}

		expect(onProgressUpdate).toHaveBeenCalledTimes(3);
		expect(onProgressUpdate).toHaveBeenNthCalledWith(1, 1, 4);
		expect(onProgressUpdate).toHaveBeenNthCalledWith(2, 2, 3);
		expect(onProgressUpdate).toHaveBeenNthCalledWith(3, 3, 2);

		unmount();
	});
});

// ============================================================================
// Tests for Error Handling
// ============================================================================

describe('useDocumentPolling - Error Handling', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.mocked(window.maestro.autorun.readDoc).mockReset();
	});

	it('should handle readDoc returning failure gracefully', async () => {
		const onProgressUpdate = vi.fn();
		const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		vi.mocked(window.maestro.autorun.readDoc).mockResolvedValue({
			success: false,
			error: 'File not found',
		});

		const { unmount } = renderHook(() =>
			useDocumentPolling({
				enabled: true,
				isProcessingTask: true,
				folderPath: '/test/folder',
				documentFilename: 'NONEXISTENT.md',
				onProgressUpdate,
			})
		);

		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});

		// Should not crash or call onProgressUpdate
		expect(onProgressUpdate).not.toHaveBeenCalled();

		consoleSpy.mockRestore();
		unmount();
	});

	it('should handle readDoc throwing exception gracefully', async () => {
		const onProgressUpdate = vi.fn();
		const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		vi.mocked(window.maestro.autorun.readDoc).mockRejectedValue(new Error('Network error'));

		const { unmount } = renderHook(() =>
			useDocumentPolling({
				enabled: true,
				isProcessingTask: true,
				folderPath: '/test/folder',
				documentFilename: 'PROGRESS.md',
				onProgressUpdate,
			})
		);

		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});

		// Should not crash or call onProgressUpdate
		expect(onProgressUpdate).not.toHaveBeenCalled();

		// Should have logged warning
		expect(consoleSpy).toHaveBeenCalled();

		consoleSpy.mockRestore();
		unmount();
	});

	it('should continue polling after error recovery', async () => {
		const onProgressUpdate = vi.fn();
		const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		// First poll fails
		vi.mocked(window.maestro.autorun.readDoc).mockRejectedValueOnce(new Error('Temporary error'));

		// Second poll succeeds (establishes baseline)
		vi.mocked(window.maestro.autorun.readDoc).mockResolvedValueOnce({
			success: true,
			content: createMarkdownContent(1, 4),
		});

		// Third poll shows progress
		vi.mocked(window.maestro.autorun.readDoc).mockResolvedValueOnce({
			success: true,
			content: createMarkdownContent(2, 3),
		});

		const { unmount } = renderHook(() =>
			useDocumentPolling({
				enabled: true,
				isProcessingTask: true,
				folderPath: '/test/folder',
				documentFilename: 'PROGRESS.md',
				onProgressUpdate,
			})
		);

		// Wait for first (failed) poll
		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});

		// Advance to second poll
		await act(async () => {
			vi.advanceTimersByTime(DEFAULT_LOCAL_POLL_INTERVAL_MS);
			await vi.runOnlyPendingTimersAsync();
		});

		// Advance to third poll
		await act(async () => {
			vi.advanceTimersByTime(DEFAULT_LOCAL_POLL_INTERVAL_MS);
			await vi.runOnlyPendingTimersAsync();
		});

		// Progress should be detected
		expect(onProgressUpdate).toHaveBeenCalledWith(2, 3);

		consoleSpy.mockRestore();
		unmount();
	});

	it('should not call onProgressUpdate when content is null', async () => {
		const onProgressUpdate = vi.fn();

		vi.mocked(window.maestro.autorun.readDoc).mockResolvedValue({
			success: true,
			content: null as unknown as string,
		});

		const { unmount } = renderHook(() =>
			useDocumentPolling({
				enabled: true,
				isProcessingTask: true,
				folderPath: '/test/folder',
				documentFilename: 'PROGRESS.md',
				onProgressUpdate,
			})
		);

		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});

		expect(onProgressUpdate).not.toHaveBeenCalled();

		unmount();
	});
});

// ============================================================================
// Tests for Manual Polling Controls
// ============================================================================

describe('useDocumentPolling - Manual Controls', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		vi.mocked(window.maestro.autorun.readDoc).mockResolvedValue({
			success: true,
			content: createMarkdownContent(0, 5),
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	it('should allow manual start via startPolling', async () => {
		const onProgressUpdate = vi.fn();

		const { result, unmount } = renderHook(() =>
			useDocumentPolling({
				enabled: false, // Start disabled
				isProcessingTask: false,
				folderPath: '/test/folder',
				documentFilename: 'PROGRESS.md',
				onProgressUpdate,
			})
		);

		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});

		// No initial poll when disabled
		const callsBeforeStart = vi.mocked(window.maestro.autorun.readDoc).mock.calls.length;
		expect(callsBeforeStart).toBe(0);

		// Manually start polling
		act(() => {
			result.current.startPolling();
		});

		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});

		// Should have started polling (at least one poll)
		expect(vi.mocked(window.maestro.autorun.readDoc).mock.calls.length).toBeGreaterThan(
			callsBeforeStart
		);

		unmount();
	});

	it('should allow manual stop via stopPolling', async () => {
		const onProgressUpdate = vi.fn();

		const { result, unmount } = renderHook(() =>
			useDocumentPolling({
				enabled: true,
				isProcessingTask: true,
				folderPath: '/test/folder',
				documentFilename: 'PROGRESS.md',
				onProgressUpdate,
			})
		);

		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});

		// Should have started polling (at least one poll)
		expect(window.maestro.autorun.readDoc).toHaveBeenCalled();

		// Manually stop polling
		act(() => {
			result.current.stopPolling();
		});

		// Verify no more polls happen after stop
		const callsBeforeAdvance = vi.mocked(window.maestro.autorun.readDoc).mock.calls.length;
		await act(async () => {
			vi.advanceTimersByTime(DEFAULT_LOCAL_POLL_INTERVAL_MS * 3);
			await vi.runOnlyPendingTimersAsync();
		});
		expect(vi.mocked(window.maestro.autorun.readDoc).mock.calls.length).toBe(callsBeforeAdvance);

		unmount();
	});

	it('should allow immediate poll via pollNow', async () => {
		const onProgressUpdate = vi.fn();

		// Set up multiple mock values for sequential calls
		vi.mocked(window.maestro.autorun.readDoc).mockResolvedValue({
			success: true,
			content: createMarkdownContent(0, 5),
		});

		const { result, unmount } = renderHook(() =>
			useDocumentPolling({
				enabled: true,
				isProcessingTask: true,
				folderPath: '/test/folder',
				documentFilename: 'PROGRESS.md',
				onProgressUpdate,
			})
		);

		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});

		// Now change the mock to return different content
		vi.mocked(window.maestro.autorun.readDoc).mockResolvedValue({
			success: true,
			content: createMarkdownContent(1, 4),
		});

		const countBeforePollNow = vi.mocked(window.maestro.autorun.readDoc).mock.calls.length;

		// Trigger immediate poll
		await act(async () => {
			await result.current.pollNow();
		});

		// Should have polled one more time
		expect(vi.mocked(window.maestro.autorun.readDoc).mock.calls.length).toBeGreaterThan(
			countBeforePollNow
		);

		// Should detect progress (from 0 to 1 checked)
		expect(onProgressUpdate).toHaveBeenCalledWith(1, 4);

		unmount();
	});
});

// ============================================================================
// Tests for Edge Cases
// ============================================================================

describe('useDocumentPolling - Edge Cases', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		vi.mocked(window.maestro.autorun.readDoc).mockResolvedValue({
			success: true,
			content: createMarkdownContent(0, 5),
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	it('should handle empty folder path', async () => {
		const onProgressUpdate = vi.fn();

		const { unmount } = renderHook(() =>
			useDocumentPolling({
				enabled: true,
				isProcessingTask: true,
				folderPath: '',
				documentFilename: 'PROGRESS.md',
				onProgressUpdate,
			})
		);

		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});

		// Should not attempt to read with empty path
		expect(window.maestro.autorun.readDoc).not.toHaveBeenCalled();

		unmount();
	});

	it('should handle empty document filename', async () => {
		const onProgressUpdate = vi.fn();

		const { unmount } = renderHook(() =>
			useDocumentPolling({
				enabled: true,
				isProcessingTask: true,
				folderPath: '/test/folder',
				documentFilename: '',
				onProgressUpdate,
			})
		);

		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});

		// Should not attempt to read with empty filename
		expect(window.maestro.autorun.readDoc).not.toHaveBeenCalled();

		unmount();
	});

	it('should pass correct parameters to readDoc', async () => {
		const onProgressUpdate = vi.fn();

		const { unmount } = renderHook(() =>
			useDocumentPolling({
				enabled: true,
				isProcessingTask: true,
				folderPath: '/path/to/autorun',
				documentFilename: 'PHASE-01.md',
				sshRemoteId: 'my-remote',
				onProgressUpdate,
			})
		);

		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});

		expect(window.maestro.autorun.readDoc).toHaveBeenCalledWith(
			'/path/to/autorun',
			'PHASE-01.md',
			'my-remote'
		);

		unmount();
	});

	it('should not double-start polling (startPolling is a no-op when already polling)', async () => {
		const onProgressUpdate = vi.fn();

		const { result, unmount } = renderHook(() =>
			useDocumentPolling({
				enabled: true,
				isProcessingTask: true,
				folderPath: '/test/folder',
				documentFilename: 'PROGRESS.md',
				onProgressUpdate,
			})
		);

		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});

		// Capture call count after initial setup
		const countAfterSetup = vi.mocked(window.maestro.autorun.readDoc).mock.calls.length;
		expect(countAfterSetup).toBeGreaterThan(0);

		// Try to start again - startPolling should be a no-op since already polling
		// This test verifies the early return in startPolling when pollingIntervalRef.current exists
		act(() => {
			result.current.startPolling();
		});

		// Don't advance timers - just verify startPolling didn't trigger an immediate poll
		// Since the interval is already running, calling startPolling should do nothing
		const countAfterSecondStart = vi.mocked(window.maestro.autorun.readDoc).mock.calls.length;

		// startPolling calls pollDocument immediately when starting, but since we're already
		// polling (pollingIntervalRef.current is set), it should return early and not call poll
		expect(countAfterSecondStart).toBe(countAfterSetup);

		unmount();
	});
});
