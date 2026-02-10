import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseJsonlFile, extractUsageEntries, findJsonlFiles, JournalEntry } from '../jsonl-parser';

describe('jsonl-parser', () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonl-parser-test-'));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	describe('parseJsonlFile', () => {
		it('should parse valid JSONL entries', async () => {
			const testFile = path.join(tempDir, 'test.jsonl');
			const entries = [
				{
					type: 'assistant',
					sessionId: 'session-123',
					timestamp: '2026-02-09T08:43:48.296Z',
					uuid: 'uuid-1',
					message: {
						model: 'claude-opus-4-5-20251101',
						id: 'msg_123',
						usage: {
							input_tokens: 100,
							output_tokens: 50,
							cache_creation_input_tokens: 200,
							cache_read_input_tokens: 300,
						},
					},
				},
				{
					type: 'user',
					sessionId: 'session-123',
					timestamp: '2026-02-09T08:43:50.000Z',
					uuid: 'uuid-2',
				},
			];

			fs.writeFileSync(testFile, entries.map((e) => JSON.stringify(e)).join('\n'));

			const result = await parseJsonlFile(testFile);

			expect(result).toHaveLength(2);
			expect(result[0].type).toBe('assistant');
			expect(result[0].sessionId).toBe('session-123');
			expect(result[0].message?.usage?.input_tokens).toBe(100);
			expect(result[1].type).toBe('user');
		});

		it('should skip empty lines', async () => {
			const testFile = path.join(tempDir, 'test.jsonl');
			const content = `{"type":"assistant","sessionId":"s1","timestamp":"2026-02-09T08:43:48.296Z","uuid":"u1"}

{"type":"user","sessionId":"s1","timestamp":"2026-02-09T08:43:50.000Z","uuid":"u2"}
`;
			fs.writeFileSync(testFile, content);

			const result = await parseJsonlFile(testFile);

			expect(result).toHaveLength(2);
		});

		it('should handle malformed JSON lines gracefully', async () => {
			const testFile = path.join(tempDir, 'test.jsonl');
			const content = `{"type":"assistant","sessionId":"s1","timestamp":"2026-02-09T08:43:48.296Z","uuid":"u1"}
{invalid json}
{"type":"user","sessionId":"s1","timestamp":"2026-02-09T08:43:50.000Z","uuid":"u2"}`;
			fs.writeFileSync(testFile, content);

			const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

			const result = await parseJsonlFile(testFile);

			expect(result).toHaveLength(2);
			expect(consoleWarnSpy).toHaveBeenCalledTimes(1);

			consoleWarnSpy.mockRestore();
		});

		it('should handle empty file', async () => {
			const testFile = path.join(tempDir, 'empty.jsonl');
			fs.writeFileSync(testFile, '');

			const result = await parseJsonlFile(testFile);

			expect(result).toHaveLength(0);
		});
	});

	describe('extractUsageEntries', () => {
		it('should extract usage data from assistant messages', () => {
			const entries: JournalEntry[] = [
				{
					type: 'assistant',
					sessionId: 'session-123',
					timestamp: '2026-02-09T08:43:48.296Z',
					uuid: 'uuid-1',
					message: {
						model: 'claude-opus-4-5-20251101',
						id: 'msg_123',
						usage: {
							input_tokens: 100,
							output_tokens: 50,
							cache_creation_input_tokens: 200,
							cache_read_input_tokens: 300,
						},
					},
				},
			];

			const result = extractUsageEntries(entries);

			expect(result).toHaveLength(1);
			expect(result[0].sessionId).toBe('session-123');
			expect(result[0].inputTokens).toBe(100);
			expect(result[0].outputTokens).toBe(50);
			expect(result[0].cacheWriteTokens).toBe(200);
			expect(result[0].cacheReadTokens).toBe(300);
			expect(result[0].model).toBe('claude-opus-4-5-20251101');
			expect(result[0].messageId).toBe('msg_123');
			expect(result[0].uuid).toBe('uuid-1');
		});

		it('should filter out non-assistant entries', () => {
			const entries: JournalEntry[] = [
				{
					type: 'user',
					sessionId: 'session-123',
					timestamp: '2026-02-09T08:43:48.296Z',
					uuid: 'uuid-1',
				},
				{
					type: 'result',
					sessionId: 'session-123',
					timestamp: '2026-02-09T08:43:50.000Z',
					uuid: 'uuid-2',
				},
			];

			const result = extractUsageEntries(entries);

			expect(result).toHaveLength(0);
		});

		it('should filter out assistant entries without usage data', () => {
			const entries: JournalEntry[] = [
				{
					type: 'assistant',
					sessionId: 'session-123',
					timestamp: '2026-02-09T08:43:48.296Z',
					uuid: 'uuid-1',
					message: {
						model: 'claude-opus-4-5-20251101',
						id: 'msg_123',
					},
				},
			];

			const result = extractUsageEntries(entries);

			expect(result).toHaveLength(0);
		});

		it('should filter out entries with zero tokens', () => {
			const entries: JournalEntry[] = [
				{
					type: 'assistant',
					sessionId: 'session-123',
					timestamp: '2026-02-09T08:43:48.296Z',
					uuid: 'uuid-1',
					message: {
						model: 'claude-opus-4-5-20251101',
						id: 'msg_123',
						usage: {
							input_tokens: 0,
							output_tokens: 0,
						},
					},
				},
			];

			const result = extractUsageEntries(entries);

			expect(result).toHaveLength(0);
		});

		it('should handle missing optional fields', () => {
			const entries: JournalEntry[] = [
				{
					type: 'assistant',
					sessionId: 'session-123',
					timestamp: '2026-02-09T08:43:48.296Z',
					uuid: 'uuid-1',
					message: {
						usage: {
							input_tokens: 100,
						},
					},
				},
			];

			const result = extractUsageEntries(entries);

			expect(result).toHaveLength(1);
			expect(result[0].model).toBe('unknown');
			expect(result[0].messageId).toBeNull();
			expect(result[0].outputTokens).toBe(0);
			expect(result[0].cacheReadTokens).toBe(0);
			expect(result[0].cacheWriteTokens).toBe(0);
		});

		it('should convert timestamp to milliseconds', () => {
			const entries: JournalEntry[] = [
				{
					type: 'assistant',
					sessionId: 'session-123',
					timestamp: '2026-02-09T08:43:48.296Z',
					uuid: 'uuid-1',
					message: {
						usage: {
							input_tokens: 100,
						},
					},
				},
			];

			const result = extractUsageEntries(entries);

			expect(result[0].timestamp).toBe(new Date('2026-02-09T08:43:48.296Z').getTime());
		});
	});

	describe('findJsonlFiles', () => {
		it('should find JSONL files recursively', async () => {
			// Create nested directory structure
			const subDir = path.join(tempDir, 'projects', 'encoded-path');
			fs.mkdirSync(subDir, { recursive: true });

			fs.writeFileSync(path.join(subDir, 'session1.jsonl'), '{}');
			fs.writeFileSync(path.join(subDir, 'session2.jsonl'), '{}');
			fs.writeFileSync(path.join(subDir, 'other.txt'), 'not jsonl');

			const result = await findJsonlFiles(tempDir);

			expect(result).toHaveLength(2);
			expect(result.every((f) => f.endsWith('.jsonl'))).toBe(true);
		});

		it('should return empty array for empty directory', async () => {
			const result = await findJsonlFiles(tempDir);

			expect(result).toHaveLength(0);
		});
	});
});
