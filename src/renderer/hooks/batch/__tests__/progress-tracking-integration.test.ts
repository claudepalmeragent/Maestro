/**
 * Integration tests for combined subagent detection + document polling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	ClaudeOutputParser,
	TaskToolInvocation,
} from '../../../../main/parsers/claude-output-parser';
import { countCheckedTasks, countUnfinishedTasks } from '../batchUtils';

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

/**
 * Creates a mock Claude assistant message with Task tool invocation
 */
function createTaskToolMessage(subagentType: string, prompt: string, toolId: string = 'tool_123') {
	return {
		type: 'assistant',
		session_id: 'test-session',
		message: {
			role: 'assistant',
			content: [
				{
					type: 'tool_use',
					name: 'Task',
					id: toolId,
					input: {
						subagent_type: subagentType,
						prompt,
					},
				},
			],
		},
	};
}

// ============================================================================
// Integration Tests
// ============================================================================

describe('Progress Tracking Integration', () => {
	describe('Subagent detection + Polling interaction', () => {
		let parser: ClaudeOutputParser;

		beforeEach(() => {
			parser = new ClaudeOutputParser();
		});

		it('should show subagent indicator AND poll for progress simultaneously', () => {
			// Test that both features can be active at the same time
			// Subagent indicator shows while polling continues in background

			// Simulate Task tool detection (Option B)
			const taskMessage = createTaskToolMessage('Explore', 'Search for files');
			const taskInvocation = parser.detectTaskToolInvocation(taskMessage as any);

			expect(taskInvocation).not.toBeNull();
			expect(taskInvocation?.subagentType).toBe('Explore');

			// Simultaneously, document polling (Option D) would track progress
			const initialContent = createMarkdownContent(2, 3);
			const updatedContent = createMarkdownContent(3, 2);

			const initialChecked = countCheckedTasks(initialContent);
			const updatedChecked = countCheckedTasks(updatedContent);

			// Both features provide complementary information:
			// - Task tool detection: "Explore subagent is working"
			// - Document polling: "Progress: 3/5 tasks complete"
			expect(initialChecked).toBe(2);
			expect(updatedChecked).toBe(3);
			expect(updatedChecked).toBeGreaterThan(initialChecked);
		});

		it('should clear subagent state on task completion while polling updates progress', () => {
			// Test the state cleanup flow

			// Start: Task tool invocation detected
			const taskMessage = createTaskToolMessage('Plan', 'Create implementation plan');
			const taskInvocation = parser.detectTaskToolInvocation(taskMessage as any);
			expect(taskInvocation).not.toBeNull();

			// During task: Document shows partial progress
			const midTaskContent = createMarkdownContent(1, 4);
			expect(countCheckedTasks(midTaskContent)).toBe(1);
			expect(countUnfinishedTasks(midTaskContent)).toBe(4);

			// Task completes: Result message clears subagent state
			const resultMessage = JSON.stringify({
				type: 'result',
				result: 'Task completed successfully',
				session_id: 'test-session',
			});
			const resultEvent = parser.parseJsonLine(resultMessage);
			expect(resultEvent?.type).toBe('result');
			expect(resultEvent?.taskToolInvocation).toBeUndefined();

			// After task: Document polling shows final progress
			const finalContent = createMarkdownContent(2, 3);
			expect(countCheckedTasks(finalContent)).toBe(2);
		});

		it('should handle multiple sequential subagent invocations', () => {
			// Test rapid subagent switching (e.g., Explore -> Plan -> Bash)

			const subagents: { type: string; prompt: string }[] = [
				{ type: 'Explore', prompt: 'Find test files' },
				{ type: 'Plan', prompt: 'Plan test implementation' },
				{ type: 'Bash', prompt: 'Run npm test' },
			];

			for (const { type, prompt } of subagents) {
				const message = createTaskToolMessage(type, prompt);
				const invocation = parser.detectTaskToolInvocation(message as any);

				expect(invocation).not.toBeNull();
				expect(invocation?.subagentType).toBe(type);
			}
		});
	});

	describe('BatchRunState updates', () => {
		it('should correctly update state from both subagent detection and polling', () => {
			// Verify state consistency when both features contribute updates

			// Simulated state tracking (mirrors BatchRunState structure)
			interface MockBatchState {
				activeSubagent: TaskToolInvocation | null;
				completedTaskCount: number;
				remainingTaskCount: number;
			}

			let state: MockBatchState = {
				activeSubagent: null,
				completedTaskCount: 0,
				remainingTaskCount: 5,
			};

			const parser = new ClaudeOutputParser();

			// Update 1: Subagent detection
			const taskMessage = createTaskToolMessage('Explore', 'Search codebase');
			const taskInvocation = parser.detectTaskToolInvocation(taskMessage as any);

			if (taskInvocation) {
				state = { ...state, activeSubagent: taskInvocation };
			}

			expect(state.activeSubagent?.subagentType).toBe('Explore');
			expect(state.completedTaskCount).toBe(0);

			// Update 2: Polling detects progress
			const newContent = createMarkdownContent(2, 3);
			const newChecked = countCheckedTasks(newContent);
			const newUnchecked = countUnfinishedTasks(newContent);

			state = {
				...state,
				completedTaskCount: newChecked,
				remainingTaskCount: newUnchecked,
			};

			// Both updates coexist correctly
			expect(state.activeSubagent?.subagentType).toBe('Explore');
			expect(state.completedTaskCount).toBe(2);
			expect(state.remainingTaskCount).toBe(3);

			// Update 3: Subagent completes
			state = { ...state, activeSubagent: null };

			expect(state.activeSubagent).toBeNull();
			expect(state.completedTaskCount).toBe(2); // Progress preserved
		});

		it('should handle edge case: polling update during subagent transition', () => {
			// Edge case where polling fires while subagent is transitioning

			const parser = new ClaudeOutputParser();

			// Subagent 1 completes
			const result1 = parser.parseJsonLine(
				JSON.stringify({
					type: 'result',
					result: 'Explore completed',
					session_id: 'sess-1',
				})
			);
			expect(result1?.type).toBe('result');

			// Polling happens
			const content = createMarkdownContent(3, 2);
			expect(countCheckedTasks(content)).toBe(3);

			// Subagent 2 starts
			const task2 = createTaskToolMessage('Plan', 'Create plan');
			const invocation2 = parser.detectTaskToolInvocation(task2 as any);
			expect(invocation2?.subagentType).toBe('Plan');

			// All operations are independent and consistent
		});
	});

	describe('Error handling across features', () => {
		it('should isolate errors between subagent detection and polling', () => {
			const parser = new ClaudeOutputParser();

			// Subagent detection works normally
			const taskMessage = createTaskToolMessage('Explore', 'Search');
			const invocation = parser.detectTaskToolInvocation(taskMessage as any);
			expect(invocation).not.toBeNull();

			// Polling "fails" (returns null from readAndCountTasks)
			// In real code, this would be handled by useDocumentPolling
			// Here we just verify counting handles edge cases
			expect(countCheckedTasks('')).toBe(0);
			expect(countUnfinishedTasks('')).toBe(0);

			// Subagent detection still works after "polling failure"
			const taskMessage2 = createTaskToolMessage('Plan', 'Plan');
			const invocation2 = parser.detectTaskToolInvocation(taskMessage2 as any);
			expect(invocation2).not.toBeNull();
		});

		it('should handle malformed Task tool input gracefully', () => {
			const parser = new ClaudeOutputParser();

			// Missing input entirely
			const msgNoInput = {
				type: 'assistant',
				message: {
					content: [{ type: 'tool_use', name: 'Task', id: 'tool_1' }],
				},
			};
			expect(parser.detectTaskToolInvocation(msgNoInput as any)).toBeNull();

			// Empty input
			const msgEmptyInput = {
				type: 'assistant',
				message: {
					content: [{ type: 'tool_use', name: 'Task', id: 'tool_2', input: {} }],
				},
			};
			const result = parser.detectTaskToolInvocation(msgEmptyInput as any);
			expect(result).not.toBeNull();
			expect(result?.subagentType).toBe('general-purpose'); // Default
		});
	});

	describe('Progress counting accuracy', () => {
		it('should correctly count various checkbox formats', () => {
			const mixedContent = `# Document
## Tasks
- [x] Standard lowercase
- [X] Standard uppercase
- [x] Another lowercase
- [ ] Unchecked standard
* [x] Asterisk checked
* [ ] Asterisk unchecked
  - [x] Indented checked
  - [ ] Indented unchecked
`;

			expect(countCheckedTasks(mixedContent)).toBe(5);
			expect(countUnfinishedTasks(mixedContent)).toBe(3);
		});

		it('should handle document with no tasks', () => {
			const noTaskContent = `# Document

This is just text with no checkboxes.

Some more paragraphs.
`;

			expect(countCheckedTasks(noTaskContent)).toBe(0);
			expect(countUnfinishedTasks(noTaskContent)).toBe(0);
		});

		it('should handle fully completed document', () => {
			const allComplete = createMarkdownContent(5, 0);
			expect(countCheckedTasks(allComplete)).toBe(5);
			expect(countUnfinishedTasks(allComplete)).toBe(0);
		});

		it('should handle large document efficiently', () => {
			// Create a document with 100 tasks
			const largeContent = createMarkdownContent(50, 50);

			const startTime = performance.now();
			const checked = countCheckedTasks(largeContent);
			const unchecked = countUnfinishedTasks(largeContent);
			const duration = performance.now() - startTime;

			expect(checked).toBe(50);
			expect(unchecked).toBe(50);
			expect(duration).toBeLessThan(100); // Should be very fast
		});
	});
});
