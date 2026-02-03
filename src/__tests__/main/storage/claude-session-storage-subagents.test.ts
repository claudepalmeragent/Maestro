/**
 * Tests for ClaudeSessionStorage - Subagent Discovery
 *
 * Verifies:
 * - Listing subagents for a session
 * - Subagent type identification
 * - Token count extraction
 * - Message count extraction
 * - Handling of empty or missing subagent folders
 * - Subagent message retrieval
 * - Aggregated stats in session listing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { ClaudeSessionStorage } from '../../../main/storage/claude-session-storage';
import type Store from 'electron-store';
import type { ClaudeSessionOriginsData } from '../../../main/storage/claude-session-storage';

// Mock the remote-fs module
vi.mock('../../../main/utils/remote-fs', () => ({
	readDirRemote: vi.fn(),
	readFileRemote: vi.fn(),
	readFileRemotePartial: vi.fn(),
	statRemote: vi.fn(),
}));

// Mock the logger to avoid noisy output during tests
vi.mock('../../../main/utils/logger', () => ({
	logger: {
		info: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

// Mock electron-store with a class-based implementation
const mockStoreData: Record<string, unknown> = { origins: {} };
vi.mock('electron-store', () => {
	return {
		default: class MockStore {
			get(key: string, defaultValue?: unknown) {
				return mockStoreData[key] ?? defaultValue;
			}
			set(key: string, value: unknown) {
				mockStoreData[key] = value;
			}
		},
	};
});

// Mock encodeClaudeProjectPath to use a simple encoding for tests
vi.mock('../../../main/utils/statsCache', () => ({
	encodeClaudeProjectPath: vi.fn((projectPath: string) => {
		// Mimic Claude's encoding: / becomes -, leading / causes leading -
		return projectPath.replace(/\//g, '-').slice(1); // "-test-project" -> "test-project"
	}),
}));

// Mock calculateClaudeCost
vi.mock('../../../main/utils/pricing', () => ({
	calculateClaudeCost: vi.fn(
		(input: number, output: number, cacheRead: number, cacheCreation: number) => {
			// Simple mock: $3 per million input, $15 per million output
			return (input * 3 + output * 15 + cacheRead * 0.3 + cacheCreation * 3.75) / 1_000_000;
		}
	),
}));

describe('ClaudeSessionStorage - Subagents', () => {
	let storage: ClaudeSessionStorage;
	let testDir: string;
	let projectPath: string;
	let encodedPath: string;

	beforeEach(async () => {
		storage = new ClaudeSessionStorage();

		// Create temp directory structure
		testDir = path.join(os.tmpdir(), `claude-subagent-test-${Date.now()}`);
		projectPath = '/test/project';
		encodedPath = 'test-project';

		// Create directories
		const projectDir = path.join(testDir, '.claude', 'projects', encodedPath);
		const subagentsDir = path.join(projectDir, 'subagents');
		await fs.mkdir(subagentsDir, { recursive: true });

		// Create mock session file
		const sessionContent = [
			'{"type":"user","timestamp":"2026-02-03T10:00:00.000Z","message":{"content":"Hello"},"uuid":"user1"}',
			'{"type":"assistant","timestamp":"2026-02-03T10:00:05.000Z","message":{"content":"Hi there!"},"uuid":"asst1"}',
			'{"type":"result","message":{"usage":{"input_tokens":100,"output_tokens":50}}}',
		].join('\n');
		await fs.writeFile(path.join(projectDir, 'test-session.jsonl'), sessionContent);

		// Create mock subagent files
		const exploreSubagent = [
			'{"type":"system","agentType":"Explore"}',
			'{"type":"user","timestamp":"2026-02-03T10:01:00.000Z","message":{"content":"Search for auth files"},"uuid":"sub-user1"}',
			'{"type":"assistant","timestamp":"2026-02-03T10:01:05.000Z","message":{"content":"Found 5 auth files..."},"uuid":"sub-asst1"}',
			'{"type":"result","message":{"usage":{"input_tokens":200,"output_tokens":100}}}',
		].join('\n');
		await fs.writeFile(path.join(subagentsDir, 'agent-abc123.jsonl'), exploreSubagent);

		const planSubagent = [
			'{"type":"system","agentType":"Plan"}',
			'{"type":"user","timestamp":"2026-02-03T10:02:00.000Z","message":{"content":"Plan the refactoring"},"uuid":"plan-user1"}',
			'{"type":"assistant","timestamp":"2026-02-03T10:02:10.000Z","message":{"content":"Here is the plan..."},"uuid":"plan-asst1"}',
			'{"type":"result","message":{"usage":{"input_tokens":150,"output_tokens":75}}}',
		].join('\n');
		await fs.writeFile(path.join(subagentsDir, 'agent-def456.jsonl'), planSubagent);

		// Mock homedir to use our test directory
		vi.spyOn(os, 'homedir').mockReturnValue(testDir);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		// Clean up temp directory
		try {
			await fs.rm(testDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	});

	describe('listSubagentsForSession', () => {
		it('should list subagents for a session', async () => {
			const subagents = await storage.listSubagentsForSession(projectPath, 'test-session');

			expect(subagents).toHaveLength(2);
			expect(subagents.map((s) => s.agentId).sort()).toEqual(['abc123', 'def456']);
		});

		it('should correctly identify subagent types', async () => {
			const subagents = await storage.listSubagentsForSession(projectPath, 'test-session');

			const explore = subagents.find((s) => s.agentId === 'abc123');
			const plan = subagents.find((s) => s.agentId === 'def456');

			expect(explore?.agentType).toBe('Explore');
			expect(plan?.agentType).toBe('Plan');
		});

		it('should extract token counts correctly', async () => {
			const subagents = await storage.listSubagentsForSession(projectPath, 'test-session');

			const explore = subagents.find((s) => s.agentId === 'abc123');
			expect(explore?.inputTokens).toBe(200);
			expect(explore?.outputTokens).toBe(100);

			const plan = subagents.find((s) => s.agentId === 'def456');
			expect(plan?.inputTokens).toBe(150);
			expect(plan?.outputTokens).toBe(75);
		});

		it('should extract message counts correctly', async () => {
			const subagents = await storage.listSubagentsForSession(projectPath, 'test-session');

			const explore = subagents.find((s) => s.agentId === 'abc123');
			expect(explore?.messageCount).toBe(2); // 1 user + 1 assistant

			const plan = subagents.find((s) => s.agentId === 'def456');
			expect(plan?.messageCount).toBe(2);
		});

		it('should return empty array when no subagents folder exists', async () => {
			const subagents = await storage.listSubagentsForSession('/nonexistent/path', 'session');
			expect(subagents).toEqual([]);
		});

		it('should return empty array when subagents folder is empty', async () => {
			// Create empty subagents folder for a different project
			const emptyProjectPath = '/empty/project';
			// The encoded path for /empty/project is empty-project (based on our mock)
			const emptyEncodedPath = 'empty-project';
			const emptySubagentsDir = path.join(
				testDir,
				'.claude',
				'projects',
				emptyEncodedPath,
				'subagents'
			);
			await fs.mkdir(emptySubagentsDir, { recursive: true });

			const subagents = await storage.listSubagentsForSession(emptyProjectPath, 'session');
			expect(subagents).toEqual([]);
		});

		it('should sort subagents by modified date (newest first)', async () => {
			const subagents = await storage.listSubagentsForSession(projectPath, 'test-session');

			// Verify sorted order (most recent first based on file mtime)
			for (let i = 1; i < subagents.length; i++) {
				const prevTime = new Date(subagents[i - 1].modifiedAt).getTime();
				const currTime = new Date(subagents[i].modifiedAt).getTime();
				expect(prevTime).toBeGreaterThanOrEqual(currTime);
			}
		});

		it('should skip empty subagent files', async () => {
			// Create an empty subagent file
			const subagentsDir = path.join(testDir, '.claude', 'projects', encodedPath, 'subagents');
			await fs.writeFile(path.join(subagentsDir, 'agent-empty.jsonl'), '');

			const subagents = await storage.listSubagentsForSession(projectPath, 'test-session');
			expect(subagents.map((s) => s.agentId)).not.toContain('empty');
		});

		it('should skip non-agent files in subagents folder', async () => {
			// Create a non-agent file in the subagents folder
			const subagentsDir = path.join(testDir, '.claude', 'projects', encodedPath, 'subagents');
			await fs.writeFile(path.join(subagentsDir, 'random-file.jsonl'), '{"type":"test"}');
			await fs.writeFile(path.join(subagentsDir, 'not-an-agent.txt'), 'test content');

			const subagents = await storage.listSubagentsForSession(projectPath, 'test-session');
			// Should only have the two valid agent files
			expect(subagents).toHaveLength(2);
		});

		it('should extract first message preview correctly', async () => {
			const subagents = await storage.listSubagentsForSession(projectPath, 'test-session');

			// Should prefer assistant message as preview
			const explore = subagents.find((s) => s.agentId === 'abc123');
			expect(explore?.firstMessage).toContain('Found 5 auth files');
		});

		it('should set parentSessionId correctly', async () => {
			const subagents = await storage.listSubagentsForSession(projectPath, 'test-session');

			for (const subagent of subagents) {
				expect(subagent.parentSessionId).toBe('test-session');
			}
		});

		it('should set filePath correctly', async () => {
			const subagents = await storage.listSubagentsForSession(projectPath, 'test-session');

			const explore = subagents.find((s) => s.agentId === 'abc123');
			expect(explore?.filePath).toContain('agent-abc123.jsonl');
		});

		it('should calculate cost correctly', async () => {
			const subagents = await storage.listSubagentsForSession(projectPath, 'test-session');

			// costUsd should be defined and a number
			for (const subagent of subagents) {
				expect(typeof subagent.costUsd).toBe('number');
				expect(subagent.costUsd).toBeGreaterThan(0);
			}
		});

		it('should extract duration correctly', async () => {
			const subagents = await storage.listSubagentsForSession(projectPath, 'test-session');

			// Duration should be calculated from first to last timestamp
			const explore = subagents.find((s) => s.agentId === 'abc123');
			// 10:01:00 to 10:01:05 = 5 seconds
			expect(explore?.durationSeconds).toBe(5);

			const plan = subagents.find((s) => s.agentId === 'def456');
			// 10:02:00 to 10:02:10 = 10 seconds
			expect(plan?.durationSeconds).toBe(10);
		});

		it('should handle subagent with only user message', async () => {
			const subagentsDir = path.join(testDir, '.claude', 'projects', encodedPath, 'subagents');
			const userOnlySubagent = [
				'{"type":"system","agentType":"Bash"}',
				'{"type":"user","timestamp":"2026-02-03T10:03:00.000Z","message":{"content":"Run npm test"},"uuid":"bash-user1"}',
			].join('\n');
			await fs.writeFile(path.join(subagentsDir, 'agent-useronly.jsonl'), userOnlySubagent);

			const subagents = await storage.listSubagentsForSession(projectPath, 'test-session');
			const userOnly = subagents.find((s) => s.agentId === 'useronly');

			expect(userOnly).toBeDefined();
			expect(userOnly?.agentType).toBe('Bash');
			expect(userOnly?.messageCount).toBe(1);
			expect(userOnly?.firstMessage).toContain('Run npm test');
		});

		it('should identify subagent type from content when not in system message', async () => {
			const subagentsDir = path.join(testDir, '.claude', 'projects', encodedPath, 'subagents');
			// Subagent without explicit agentType in system, but with Explore mentioned in user message
			const inferredTypeSubagent = [
				'{"type":"user","timestamp":"2026-02-03T10:04:00.000Z","message":{"content":"Using Explore to search for files"},"uuid":"infer-user1"}',
				'{"type":"assistant","timestamp":"2026-02-03T10:04:05.000Z","message":{"content":"Searching..."},"uuid":"infer-asst1"}',
			].join('\n');
			await fs.writeFile(path.join(subagentsDir, 'agent-inferred.jsonl'), inferredTypeSubagent);

			const subagents = await storage.listSubagentsForSession(projectPath, 'test-session');
			const inferred = subagents.find((s) => s.agentId === 'inferred');

			expect(inferred).toBeDefined();
			expect(inferred?.agentType).toBe('Explore');
		});
	});

	describe('getSubagentMessages', () => {
		it('should return messages for a subagent', async () => {
			const result = await storage.getSubagentMessages(projectPath, 'abc123');

			expect(result.messages).toHaveLength(2);
			expect(result.total).toBe(2);
			expect(result.hasMore).toBe(false);
		});

		it('should return messages in correct order', async () => {
			const result = await storage.getSubagentMessages(projectPath, 'abc123');

			expect(result.messages[0].type).toBe('user');
			expect(result.messages[0].content).toContain('Search for auth files');
			expect(result.messages[1].type).toBe('assistant');
			expect(result.messages[1].content).toContain('Found 5 auth files');
		});

		it('should support pagination with offset and limit', async () => {
			const result = await storage.getSubagentMessages(projectPath, 'abc123', {
				offset: 0,
				limit: 1,
			});

			expect(result.messages).toHaveLength(1);
			expect(result.hasMore).toBe(true);
		});

		it('should return empty result for non-existent subagent', async () => {
			const result = await storage.getSubagentMessages(projectPath, 'nonexistent');

			expect(result.messages).toEqual([]);
			expect(result.total).toBe(0);
			expect(result.hasMore).toBe(false);
		});

		it('should include timestamp in messages', async () => {
			const result = await storage.getSubagentMessages(projectPath, 'abc123');

			expect(result.messages[0].timestamp).toBe('2026-02-03T10:01:00.000Z');
			expect(result.messages[1].timestamp).toBe('2026-02-03T10:01:05.000Z');
		});

		it('should include uuid in messages', async () => {
			const result = await storage.getSubagentMessages(projectPath, 'abc123');

			expect(result.messages[0].uuid).toBe('sub-user1');
			expect(result.messages[1].uuid).toBe('sub-asst1');
		});

		it('should handle offset greater than total messages', async () => {
			const result = await storage.getSubagentMessages(projectPath, 'abc123', {
				offset: 100,
				limit: 10,
			});

			expect(result.messages).toEqual([]);
			expect(result.hasMore).toBe(false);
		});

		it('should handle messages with array content blocks', async () => {
			// Create a subagent with array content
			const subagentsDir = path.join(testDir, '.claude', 'projects', encodedPath, 'subagents');
			const arrayContentSubagent = [
				'{"type":"user","timestamp":"2026-02-03T10:05:00.000Z","message":{"content":[{"type":"text","text":"User message with blocks"}]},"uuid":"array-user1"}',
				'{"type":"assistant","timestamp":"2026-02-03T10:05:05.000Z","message":{"content":[{"type":"text","text":"Assistant response"},{"type":"tool_use","id":"tool1","name":"Read","input":{}}]},"uuid":"array-asst1"}',
			].join('\n');
			await fs.writeFile(path.join(subagentsDir, 'agent-array.jsonl'), arrayContentSubagent);

			const result = await storage.getSubagentMessages(projectPath, 'array');

			expect(result.messages).toHaveLength(2);
			expect(result.messages[0].content).toContain('User message with blocks');
			expect(result.messages[1].content).toContain('Assistant response');
			expect(result.messages[1].toolUse).toBeDefined();
			expect(result.messages[1].toolUse).toHaveLength(1);
		});
	});

	describe('aggregated stats', () => {
		it('should include aggregated stats in session listing', async () => {
			const result = await storage.listSessionsPaginated(projectPath);

			// This test verifies the integration with Phase 4 changes
			const session = result.sessions[0];
			if (session) {
				// Should have aggregated fields
				expect(session.hasSubagents).toBeDefined();
				if (session.hasSubagents) {
					expect(session.aggregatedInputTokens).toBeGreaterThan(session.inputTokens);
					expect(session.aggregatedOutputTokens).toBeGreaterThan(session.outputTokens);
					expect(session.subagentCount).toBeGreaterThan(0);
				}
			}
		});

		it('should count subagents correctly', async () => {
			const result = await storage.listSessionsPaginated(projectPath);

			const session = result.sessions[0];
			if (session?.hasSubagents) {
				expect(session.subagentCount).toBe(2); // We created 2 subagents
			}
		});

		it('should sum input tokens from parent and subagents', async () => {
			const result = await storage.listSessionsPaginated(projectPath);

			const session = result.sessions[0];
			if (session?.hasSubagents) {
				// Parent: 100, Subagent1: 200, Subagent2: 150 = 450
				expect(session.aggregatedInputTokens).toBe(100 + 200 + 150);
			}
		});

		it('should sum output tokens from parent and subagents', async () => {
			const result = await storage.listSessionsPaginated(projectPath);

			const session = result.sessions[0];
			if (session?.hasSubagents) {
				// Parent: 50, Subagent1: 100, Subagent2: 75 = 225
				expect(session.aggregatedOutputTokens).toBe(50 + 100 + 75);
			}
		});

		it('should mark session without subagents correctly', async () => {
			// Create a session in a project without subagents
			const noSubagentProjectPath = '/no/subagents';
			const noSubagentEncodedPath = 'no-subagents';
			const projectDir = path.join(testDir, '.claude', 'projects', noSubagentEncodedPath);
			await fs.mkdir(projectDir, { recursive: true });

			const sessionContent = [
				'{"type":"user","timestamp":"2026-02-03T10:00:00.000Z","message":{"content":"Hello"},"uuid":"user1"}',
				'{"type":"assistant","timestamp":"2026-02-03T10:00:05.000Z","message":{"content":"Hi!"},"uuid":"asst1"}',
				'{"type":"result","message":{"usage":{"input_tokens":100,"output_tokens":50}}}',
			].join('\n');
			await fs.writeFile(path.join(projectDir, 'session-1.jsonl'), sessionContent);

			const result = await storage.listSessionsPaginated(noSubagentProjectPath);

			const session = result.sessions[0];
			expect(session?.hasSubagents).toBe(false);
			expect(session?.subagentCount).toBe(0);
			expect(session?.aggregatedInputTokens).toBe(session?.inputTokens);
			expect(session?.aggregatedOutputTokens).toBe(session?.outputTokens);
		});

		it('should calculate aggregated cost correctly', async () => {
			const result = await storage.listSessionsPaginated(projectPath);

			const session = result.sessions[0];
			if (session?.hasSubagents) {
				// aggregatedCostUsd should be greater than the parent session cost alone
				expect(session.aggregatedCostUsd).toBeGreaterThan(0);
				expect(session.aggregatedCostUsd).toBeGreaterThanOrEqual(session.costUsd);
			}
		});

		it('should include message count from subagents in aggregated count', async () => {
			const result = await storage.listSessionsPaginated(projectPath);

			const session = result.sessions[0];
			if (session?.hasSubagents) {
				// Parent: 2 messages, Subagent1: 2 messages, Subagent2: 2 messages = 6
				expect(session.aggregatedMessageCount).toBe(2 + 2 + 2);
			}
		});
	});

	describe('edge cases', () => {
		it('should handle malformed JSON in subagent file gracefully', async () => {
			const subagentsDir = path.join(testDir, '.claude', 'projects', encodedPath, 'subagents');
			const malformedSubagent = [
				'{"type":"system","agentType":"Explore"}',
				'not valid json',
				'{"type":"user","timestamp":"2026-02-03T10:06:00.000Z","message":{"content":"Test"},"uuid":"mal-user1"}',
			].join('\n');
			await fs.writeFile(path.join(subagentsDir, 'agent-malformed.jsonl'), malformedSubagent);

			const subagents = await storage.listSubagentsForSession(projectPath, 'test-session');
			const malformed = subagents.find((s) => s.agentId === 'malformed');

			// Should still work, just skip the malformed line
			expect(malformed).toBeDefined();
			expect(malformed?.agentType).toBe('Explore');
			expect(malformed?.messageCount).toBe(1);
		});

		it('should handle subagent with unknown type', async () => {
			const subagentsDir = path.join(testDir, '.claude', 'projects', encodedPath, 'subagents');
			const unknownTypeSubagent = [
				'{"type":"user","timestamp":"2026-02-03T10:07:00.000Z","message":{"content":"No type info"},"uuid":"unknown-user1"}',
				'{"type":"assistant","timestamp":"2026-02-03T10:07:05.000Z","message":{"content":"Response"},"uuid":"unknown-asst1"}',
			].join('\n');
			await fs.writeFile(path.join(subagentsDir, 'agent-unknowntype.jsonl'), unknownTypeSubagent);

			const subagents = await storage.listSubagentsForSession(projectPath, 'test-session');
			const unknown = subagents.find((s) => s.agentId === 'unknowntype');

			expect(unknown).toBeDefined();
			expect(unknown?.agentType).toBe('unknown');
		});

		it('should handle subagent with cache tokens', async () => {
			const subagentsDir = path.join(testDir, '.claude', 'projects', encodedPath, 'subagents');
			const cacheSubagent = [
				'{"type":"system","agentType":"general-purpose"}',
				'{"type":"user","timestamp":"2026-02-03T10:08:00.000Z","message":{"content":"Test"},"uuid":"cache-user1"}',
				'{"type":"assistant","timestamp":"2026-02-03T10:08:05.000Z","message":{"content":"Done"},"uuid":"cache-asst1"}',
				'{"type":"result","message":{"usage":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":500,"cache_creation_input_tokens":200}}}',
			].join('\n');
			await fs.writeFile(path.join(subagentsDir, 'agent-cache.jsonl'), cacheSubagent);

			const subagents = await storage.listSubagentsForSession(projectPath, 'test-session');
			const cache = subagents.find((s) => s.agentId === 'cache');

			expect(cache).toBeDefined();
			expect(cache?.cacheReadTokens).toBe(500);
			expect(cache?.cacheCreationTokens).toBe(200);
		});

		it('should handle file read errors gracefully', async () => {
			// Create a subagent file with no read permissions
			const subagentsDir = path.join(testDir, '.claude', 'projects', encodedPath, 'subagents');
			const unreadableFile = path.join(subagentsDir, 'agent-unreadable.jsonl');
			await fs.writeFile(unreadableFile, 'content');
			await fs.chmod(unreadableFile, 0o000);

			// Should not throw, just skip the unreadable file
			const subagents = await storage.listSubagentsForSession(projectPath, 'test-session');

			// Should have the original 2 subagents, not the unreadable one
			expect(subagents.filter((s) => s.agentId === 'unreadable')).toHaveLength(0);

			// Restore permissions for cleanup
			await fs.chmod(unreadableFile, 0o644);
		});
	});
});
