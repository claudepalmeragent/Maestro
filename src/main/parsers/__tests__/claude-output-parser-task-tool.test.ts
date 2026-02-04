/**
 * Tests for Task tool detection in Claude Output Parser
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ClaudeOutputParser } from '../claude-output-parser';

describe('ClaudeOutputParser - Task Tool Detection', () => {
	let parser: ClaudeOutputParser;

	beforeEach(() => {
		parser = new ClaudeOutputParser();
	});

	describe('detectTaskToolInvocation', () => {
		it('should detect Task tool with Explore subagent type', () => {
			const msg = {
				type: 'assistant',
				message: {
					role: 'assistant',
					content: [
						{
							type: 'tool_use',
							name: 'Task',
							id: 'tool_123',
							input: {
								subagent_type: 'Explore',
								prompt: 'Search for files matching pattern',
							},
						},
					],
				},
			};

			const result = parser.detectTaskToolInvocation(msg as any);

			expect(result).not.toBeNull();
			expect(result?.subagentType).toBe('Explore');
			expect(result?.toolId).toBe('tool_123');
		});

		it('should detect Task tool with Plan subagent type', () => {
			const msg = {
				type: 'assistant',
				message: {
					role: 'assistant',
					content: [
						{
							type: 'tool_use',
							name: 'Task',
							id: 'tool_456',
							input: {
								subagent_type: 'Plan',
								prompt: 'Create implementation plan for feature X',
							},
						},
					],
				},
			};

			const result = parser.detectTaskToolInvocation(msg as any);

			expect(result).not.toBeNull();
			expect(result?.subagentType).toBe('Plan');
		});

		it('should default to general-purpose when subagent_type is missing', () => {
			const msg = {
				type: 'assistant',
				message: {
					role: 'assistant',
					content: [
						{
							type: 'tool_use',
							name: 'Task',
							id: 'tool_789',
							input: {
								prompt: 'Do something complex',
							},
						},
					],
				},
			};

			const result = parser.detectTaskToolInvocation(msg as any);

			expect(result).not.toBeNull();
			expect(result?.subagentType).toBe('general-purpose');
		});

		it('should return null for non-Task tool_use blocks', () => {
			const msg = {
				type: 'assistant',
				message: {
					role: 'assistant',
					content: [
						{
							type: 'tool_use',
							name: 'Read',
							id: 'tool_abc',
							input: { file_path: '/some/file.ts' },
						},
					],
				},
			};

			const result = parser.detectTaskToolInvocation(msg as any);

			expect(result).toBeNull();
		});

		it('should return null for string content messages', () => {
			const msg = {
				type: 'assistant',
				message: {
					role: 'assistant',
					content: 'Just a text response',
				},
			};

			const result = parser.detectTaskToolInvocation(msg as any);

			expect(result).toBeNull();
		});

		it('should truncate long task descriptions', () => {
			const longPrompt = 'A'.repeat(200);
			const msg = {
				type: 'assistant',
				message: {
					role: 'assistant',
					content: [
						{
							type: 'tool_use',
							name: 'Task',
							id: 'tool_long',
							input: {
								subagent_type: 'general-purpose',
								prompt: longPrompt,
							},
						},
					],
				},
			};

			const result = parser.detectTaskToolInvocation(msg as any);

			expect(result).not.toBeNull();
			expect(result?.taskDescription?.length).toBeLessThanOrEqual(100);
		});
	});

	describe('parseJsonLine with Task tool', () => {
		it('should include taskToolInvocation in parsed event', () => {
			const line = JSON.stringify({
				type: 'assistant',
				session_id: 'test-session',
				message: {
					role: 'assistant',
					content: [
						{
							type: 'tool_use',
							name: 'Task',
							id: 'tool_test',
							input: {
								subagent_type: 'Bash',
								prompt: 'Run npm test',
							},
						},
					],
				},
			});

			const result = parser.parseJsonLine(line);

			expect(result).not.toBeNull();
			expect(result?.taskToolInvocation).toBeDefined();
			expect(result?.taskToolInvocation?.subagentType).toBe('Bash');
		});
	});
});
