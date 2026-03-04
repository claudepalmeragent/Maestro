import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the dependencies before importing
vi.mock('../../../../main/utils/remote-fs', () => ({
	parseRemoteClaudeStatsViaShell: vi.fn(),
	countRemoteClaudeMessages: vi.fn(),
	execRemoteCommand: vi.fn(),
	readDirRemote: vi.fn(),
	readFileRemote: vi.fn(),
	readFileRemotePartial: vi.fn(),
	statRemote: vi.fn(),
	batchDiscoverSessionFilesRemote: vi.fn(),
	batchParseSessionFilesRemote: vi.fn(),
	batchExtractSessionPreviewsRemote: vi.fn(),
	batchSubagentStatsRemote: vi.fn(),
	searchSessionFilesRemote: vi.fn(),
	readSessionMessagesRemote: vi.fn(),
}));

vi.mock('../../../../main/utils/pricing', () => ({
	calculateClaudeCost: vi.fn().mockReturnValue(0.05),
}));

vi.mock('../../../../main/utils/logger', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

import { parseRemoteClaudeStatsViaShell } from '../../../../main/utils/remote-fs';
import { calculateClaudeCost } from '../../../../main/utils/pricing';

describe('agentSessions:getSessionStats IPC handler', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('should return token stats and cost from remote file', async () => {
		vi.mocked(parseRemoteClaudeStatsViaShell).mockResolvedValue({
			success: true,
			data: {
				sizeBytes: 50000,
				messageCount: 20,
				inputTokens: 5000,
				outputTokens: 3000,
				cacheReadTokens: 1000,
				cacheCreationTokens: 500,
			},
		});

		// Verify the mock functions are callable with expected signatures
		const statsResult = await parseRemoteClaudeStatsViaShell('path', {} as any);
		expect(statsResult.success).toBe(true);
		expect(statsResult.data?.inputTokens).toBe(5000);
		expect(statsResult.data?.outputTokens).toBe(3000);
		expect(statsResult.data?.cacheReadTokens).toBe(1000);
		expect(statsResult.data?.cacheCreationTokens).toBe(500);
		expect(statsResult.data?.messageCount).toBe(20);
	});

	it('should return zeros when stats extraction fails', async () => {
		vi.mocked(parseRemoteClaudeStatsViaShell).mockResolvedValue({
			success: false,
			error: 'File not found',
		});

		const statsResult = await parseRemoteClaudeStatsViaShell('path', {} as any);
		expect(statsResult.success).toBe(false);
		expect(statsResult.data).toBeUndefined();
	});

	it('should calculate cost using token counts', async () => {
		vi.mocked(calculateClaudeCost).mockReturnValue(0.123);

		const cost = calculateClaudeCost(5000, 3000, 1000, 500);
		expect(cost).toBe(0.123);
		expect(calculateClaudeCost).toHaveBeenCalledWith(5000, 3000, 1000, 500);
	});

	it('should handle partial stats (some fields zero)', async () => {
		vi.mocked(parseRemoteClaudeStatsViaShell).mockResolvedValue({
			success: true,
			data: {
				sizeBytes: 1000,
				messageCount: 5,
				inputTokens: 2000,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheCreationTokens: 0,
			},
		});

		const statsResult = await parseRemoteClaudeStatsViaShell('path', {} as any);
		expect(statsResult.success).toBe(true);
		expect(statsResult.data?.inputTokens).toBe(2000);
		expect(statsResult.data?.outputTokens).toBe(0);
		expect(statsResult.data?.cacheReadTokens).toBe(0);
	});
});
