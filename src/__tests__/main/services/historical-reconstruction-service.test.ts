import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as childProcess from 'child_process';

// Mock the stats database
const mockDatabase = {
	prepare: vi.fn(),
};

const mockStatsDB = {
	database: mockDatabase,
	isReady: () => true,
};

vi.mock('../../../main/stats', () => ({
	getStatsDB: () => mockStatsDB,
}));

// Mock logger
vi.mock('../../../main/utils/logger', () => ({
	logger: {
		info: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import { reconstructHistoricalData } from '../../../main/services/historical-reconstruction-service';

describe('historical-reconstruction-service', () => {
	let tempDir: string;
	let projectsDir: string;

	beforeEach(() => {
		// Create temp directory structure mimicking the projects folder
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconstruction-test-'));
		projectsDir = path.join(tempDir, 'test-project');
		fs.mkdirSync(projectsDir, { recursive: true });

		// Reset mock implementations
		mockDatabase.prepare.mockReset();
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	describe('reconstructHistoricalData', () => {
		it('should return empty result when no JSONL files exist', async () => {
			const result = await reconstructHistoricalData({ dryRun: true, basePath: tempDir });

			expect(result.queriesFound).toBe(0);
			expect(result.queriesInserted).toBe(0);
			expect(result.queriesUpdated).toBe(0);
			expect(result.queriesSkipped).toBe(0);
			expect(result.dateRangeCovered).toBeNull();
			expect(result.errors).toHaveLength(0);
		});

		it('should find and process JSONL files', async () => {
			// Create a test JSONL file
			const jsonlPath = path.join(projectsDir, 'session-123.jsonl');
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
			];
			fs.writeFileSync(jsonlPath, entries.map((e) => JSON.stringify(e)).join('\n'));

			// Mock database to return no existing record
			mockDatabase.prepare.mockImplementation((sql: string) => {
				if (sql.includes('SELECT')) {
					return { get: () => undefined };
				}
				return { run: vi.fn() };
			});

			const result = await reconstructHistoricalData({ dryRun: true, basePath: tempDir });

			expect(result.queriesFound).toBe(1);
			expect(result.dateRangeCovered).toEqual({
				start: '2026-02-09',
				end: '2026-02-09',
			});
		});

		it('should skip entries outside date range', async () => {
			const jsonlPath = path.join(projectsDir, 'session-123.jsonl');
			const entries = [
				{
					type: 'assistant',
					sessionId: 'session-123',
					timestamp: '2026-01-01T08:00:00.000Z',
					uuid: 'uuid-1',
					message: {
						model: 'claude-opus-4-5-20251101',
						usage: { input_tokens: 100, output_tokens: 50 },
					},
				},
				{
					type: 'assistant',
					sessionId: 'session-123',
					timestamp: '2026-02-15T08:00:00.000Z',
					uuid: 'uuid-2',
					message: {
						model: 'claude-opus-4-5-20251101',
						usage: { input_tokens: 100, output_tokens: 50 },
					},
				},
			];
			fs.writeFileSync(jsonlPath, entries.map((e) => JSON.stringify(e)).join('\n'));

			mockDatabase.prepare.mockImplementation((sql: string) => {
				if (sql.includes('SELECT')) {
					return { get: () => undefined };
				}
				return { run: vi.fn() };
			});

			const result = await reconstructHistoricalData({
				dryRun: true,
				basePath: tempDir,
				dateRange: { start: '2026-02-01', end: '2026-02-28' },
			});

			// Both entries are found, but only February one is processed
			expect(result.queriesFound).toBe(2);
		});

		it('should skip existing records with complete cost data', async () => {
			const jsonlPath = path.join(projectsDir, 'session-123.jsonl');
			const entries = [
				{
					type: 'assistant',
					sessionId: 'session-123',
					timestamp: '2026-02-09T08:43:48.296Z',
					uuid: 'uuid-existing',
					message: {
						model: 'claude-opus-4-5-20251101',
						usage: { input_tokens: 100, output_tokens: 50 },
					},
				},
			];
			fs.writeFileSync(jsonlPath, entries.map((e) => JSON.stringify(e)).join('\n'));

			// Mock database to return existing record with both costs
			mockDatabase.prepare.mockImplementation((sql: string) => {
				if (sql.includes('SELECT')) {
					return {
						get: () => ({
							id: 'existing-id',
							anthropic_cost_usd: 0.5,
							maestro_cost_usd: 0.3,
						}),
					};
				}
				return { run: vi.fn() };
			});

			const result = await reconstructHistoricalData({ dryRun: true, basePath: tempDir });

			expect(result.queriesFound).toBe(1);
			expect(result.queriesSkipped).toBe(1);
			expect(result.queriesInserted).toBe(0);
			expect(result.queriesUpdated).toBe(0);
		});

		it('should update existing records with missing cost data', async () => {
			const jsonlPath = path.join(projectsDir, 'session-123.jsonl');
			const entries = [
				{
					type: 'assistant',
					sessionId: 'session-123',
					timestamp: '2026-02-09T08:43:48.296Z',
					uuid: 'uuid-partial',
					message: {
						model: 'claude-opus-4-5-20251101',
						usage: { input_tokens: 100, output_tokens: 50 },
					},
				},
			];
			fs.writeFileSync(jsonlPath, entries.map((e) => JSON.stringify(e)).join('\n'));

			// Mock database to return existing record with only anthropic cost
			const mockRun = vi.fn();
			mockDatabase.prepare.mockImplementation((sql: string) => {
				if (sql.includes('SELECT')) {
					return {
						get: () => ({
							id: 'existing-id',
							anthropic_cost_usd: 0.5,
							maestro_cost_usd: null, // Missing maestro cost
						}),
					};
				}
				return { run: mockRun };
			});

			const result = await reconstructHistoricalData({ dryRun: false, basePath: tempDir });

			expect(result.queriesFound).toBe(1);
			expect(result.queriesUpdated).toBe(1);
			expect(mockRun).toHaveBeenCalled();
		});

		it('should skip entries with no matching query_event (reconstruction never inserts)', async () => {
			// COST-GRAPH-FIX-12: Reconstruction only updates existing records, never inserts
			const jsonlPath = path.join(projectsDir, 'session-123.jsonl');
			const entries = [
				{
					type: 'assistant',
					sessionId: 'session-123',
					timestamp: '2026-02-09T08:43:48.296Z',
					uuid: 'uuid-new',
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
			fs.writeFileSync(jsonlPath, entries.map((e) => JSON.stringify(e)).join('\n'));

			const mockRun = vi.fn();
			mockDatabase.prepare.mockImplementation((sql: string) => {
				if (sql.includes('SELECT')) {
					return { get: () => undefined }; // No existing record
				}
				return { run: mockRun };
			});

			const result = await reconstructHistoricalData({ dryRun: false, basePath: tempDir });

			expect(result.queriesFound).toBe(1);
			// Reconstruction never inserts - entries without matching query_events are skipped
			expect(result.queriesInserted).toBe(0);
			expect(result.queriesSkipped).toBe(1);
			// No database writes should occur for skipped entries
			expect(mockRun).not.toHaveBeenCalled();
		});

		it('should skip entries with no matching query_event in dry-run mode', async () => {
			// COST-GRAPH-FIX-12: Reconstruction only updates existing records, never inserts
			const jsonlPath = path.join(projectsDir, 'session-123.jsonl');
			const entries = [
				{
					type: 'assistant',
					sessionId: 'session-123',
					timestamp: '2026-02-09T08:43:48.296Z',
					uuid: 'uuid-new',
					message: {
						model: 'claude-opus-4-5-20251101',
						usage: { input_tokens: 100, output_tokens: 50 },
					},
				},
			];
			fs.writeFileSync(jsonlPath, entries.map((e) => JSON.stringify(e)).join('\n'));

			const mockRun = vi.fn();
			mockDatabase.prepare.mockImplementation((sql: string) => {
				if (sql.includes('SELECT')) {
					return { get: () => undefined };
				}
				return { run: mockRun };
			});

			const result = await reconstructHistoricalData({ dryRun: true, basePath: tempDir });

			expect(result.queriesFound).toBe(1);
			// Reconstruction never inserts - entries without matching query_events are skipped
			expect(result.queriesInserted).toBe(0);
			expect(result.queriesSkipped).toBe(1);
			expect(mockRun).not.toHaveBeenCalled();
		});

		it('should handle file read errors gracefully', async () => {
			// Create a file with invalid JSON
			const invalidPath = path.join(projectsDir, 'invalid.jsonl');
			fs.writeFileSync(invalidPath, 'not valid json at all');

			const result = await reconstructHistoricalData({ dryRun: true, basePath: tempDir });

			// Invalid JSON is handled by parseJsonlFile - no entries extracted
			expect(result.errors).toHaveLength(0);
			expect(result.queriesFound).toBe(0);
		});

		it('should skip local agents when includeLocalAgents is false', async () => {
			const jsonlPath = path.join(projectsDir, 'session-123.jsonl');
			const entries = [
				{
					type: 'assistant',
					sessionId: 'session-123',
					timestamp: '2026-02-09T08:43:48.296Z',
					uuid: 'uuid-1',
					message: {
						model: 'claude-opus-4-5-20251101',
						usage: { input_tokens: 100, output_tokens: 50 },
					},
				},
			];
			fs.writeFileSync(jsonlPath, entries.map((e) => JSON.stringify(e)).join('\n'));

			const result = await reconstructHistoricalData({
				dryRun: true,
				basePath: tempDir,
				includeLocalAgents: false,
			});

			expect(result.queriesFound).toBe(0);
		});

		it('should process multiple files', async () => {
			// Create multiple JSONL files
			for (let i = 1; i <= 3; i++) {
				const jsonlPath = path.join(projectsDir, `session-${i}.jsonl`);
				const entries = [
					{
						type: 'assistant',
						sessionId: `session-${i}`,
						timestamp: `2026-02-0${i}T08:00:00.000Z`,
						uuid: `uuid-${i}`,
						message: {
							model: 'claude-opus-4-5-20251101',
							usage: { input_tokens: 100, output_tokens: 50 },
						},
					},
				];
				fs.writeFileSync(jsonlPath, entries.map((e) => JSON.stringify(e)).join('\n'));
			}

			mockDatabase.prepare.mockImplementation((sql: string) => {
				if (sql.includes('SELECT')) {
					return { get: () => undefined };
				}
				return { run: vi.fn() };
			});

			const result = await reconstructHistoricalData({ dryRun: true, basePath: tempDir });

			expect(result.queriesFound).toBe(3);
			expect(result.dateRangeCovered).toEqual({
				start: '2026-02-01',
				end: '2026-02-03',
			});
		});
	});

	// Note: SSH remote reconstruction tests are skipped because ESM modules
	// don't allow spying on execSync in Vitest. The SSH functionality is
	// tested manually and through integration tests.
	describe.skip('SSH remote reconstruction', () => {
		it('should fetch and process data from SSH remote', async () => {
			const sshOutput = JSON.stringify({
				type: 'assistant',
				sessionId: 'remote-session',
				timestamp: '2026-02-09T08:43:48.296Z',
				uuid: 'remote-uuid',
				message: {
					model: 'claude-opus-4-5-20251101',
					usage: { input_tokens: 100, output_tokens: 50 },
				},
			});

			vi.spyOn(childProcess, 'execSync').mockReturnValue(sshOutput);

			mockDatabase.prepare.mockImplementation((sql: string) => {
				if (sql.includes('SELECT')) {
					return { get: () => undefined };
				}
				return { run: vi.fn() };
			});

			const result = await reconstructHistoricalData({
				dryRun: true,
				basePath: tempDir,
				includeLocalAgents: false,
				includeSshRemotes: true,
				sshConfigs: [{ host: 'remote.example.com', user: 'testuser' }],
			});

			expect(result.queriesFound).toBe(1);
			expect(childProcess.execSync).toHaveBeenCalled();
		});

		it('should handle SSH connection errors gracefully', async () => {
			vi.spyOn(childProcess, 'execSync').mockImplementation(() => {
				throw new Error('SSH connection failed');
			});

			const result = await reconstructHistoricalData({
				dryRun: true,
				basePath: tempDir,
				includeLocalAgents: false,
				includeSshRemotes: true,
				sshConfigs: [{ host: 'unreachable.example.com', user: 'testuser' }],
			});

			expect(result.errors).toHaveLength(1);
			expect(result.errors[0].file).toContain('ssh://');
			expect(result.errors[0].error).toContain('SSH connection failed');
		});

		it('should use identity file when provided', async () => {
			const execSyncSpy = vi.spyOn(childProcess, 'execSync').mockReturnValue('');

			await reconstructHistoricalData({
				dryRun: true,
				basePath: tempDir,
				includeLocalAgents: false,
				includeSshRemotes: true,
				sshConfigs: [
					{
						host: 'remote.example.com',
						user: 'testuser',
						identityFile: '/path/to/key',
					},
				],
			});

			expect(execSyncSpy).toHaveBeenCalledWith(
				expect.stringContaining('-i /path/to/key'),
				expect.any(Object)
			);
		});
	});

	describe('cost calculation', () => {
		it('should calculate costs using model-specific pricing when updating existing record', async () => {
			// COST-GRAPH-FIX-12: Reconstruction only updates existing records
			const jsonlPath = path.join(projectsDir, 'session-123.jsonl');
			const timestamp = new Date('2026-02-09T08:43:48.296Z').getTime();
			const entries = [
				{
					type: 'assistant',
					sessionId: 'session-123',
					timestamp: '2026-02-09T08:43:48.296Z',
					uuid: 'uuid-cost-test',
					message: {
						model: 'claude-opus-4-5-20251101',
						usage: {
							input_tokens: 1000000,
							output_tokens: 1000000,
							cache_creation_input_tokens: 0,
							cache_read_input_tokens: 0,
						},
					},
				},
			];
			fs.writeFileSync(jsonlPath, entries.map((e) => JSON.stringify(e)).join('\n'));

			let updateValues: unknown[] = [];
			mockDatabase.prepare.mockImplementation((sql: string) => {
				if (sql.includes('SELECT')) {
					// Return existing record with missing cost data to trigger UPDATE
					return {
						get: () => ({
							id: 'existing-id',
							session_id: 'session-123',
							input_tokens: null,
							output_tokens: null,
							cache_read_input_tokens: null,
							cache_creation_input_tokens: null,
							anthropic_cost_usd: null,
							maestro_cost_usd: null,
							anthropic_model: null,
							tokens_per_second: null,
							duration: 5000,
							start_time: timestamp,
						}),
					};
				}
				return {
					run: (...args: unknown[]) => {
						updateValues = args;
					},
				};
			});

			const result = await reconstructHistoricalData({ dryRun: false, basePath: tempDir });

			expect(result.queriesUpdated).toBe(1);
			expect(result.queriesInserted).toBe(0);

			// Check that costs were calculated
			// UPDATE column order: input_tokens(0), output_tokens(1), cache_read_input_tokens(2),
			// cache_creation_input_tokens(3), tokens_per_second(4), anthropic_cost_usd(5),
			// anthropic_model(6), maestro_cost_usd(7), maestro_pricing_model(8), maestro_calculated_at(9),
			// claude_session_id(10), id(11)
			const anthropicCost = updateValues[5] as number;
			const maestroCost = updateValues[7] as number;

			// Opus 4.5 pricing: $5/M input, $25/M output
			expect(anthropicCost).toBeCloseTo(30, 1); // $5 input + $25 output
			expect(maestroCost).toBeCloseTo(30, 1); // Same for Max mode (no cache tokens)
		});
	});

	describe('performance', () => {
		it('should track duration of reconstruction', async () => {
			const result = await reconstructHistoricalData({ dryRun: true, basePath: tempDir });

			expect(result.duration).toBeGreaterThanOrEqual(0);
			expect(typeof result.duration).toBe('number');
		});
	});
});
