import { describe, it, expect, vi } from 'vitest';
import { batchExtractSessionPreviewsRemote } from '../../../main/utils/remote-fs';
import type { RemoteFsDeps } from '../../../main/utils/remote-fs';
import type { SshRemoteConfig } from '../../../shared/types';

vi.mock('../../../main/utils/ssh-socket-cleanup', () => ({
	validateSshSocket: vi.fn().mockResolvedValue(undefined),
}));

const mockSshConfig: SshRemoteConfig = {
	id: 'test-remote',
	name: 'Test Remote',
	host: 'test.example.com',
	port: 22,
	username: 'testuser',
	privateKeyPath: '~/.ssh/id_ed25519',
	enabled: true,
};

function createMockDeps(stdout: string, exitCode = 0): RemoteFsDeps {
	return {
		execSsh: vi.fn().mockResolvedValue({ stdout, stderr: '', exitCode }),
		buildSshArgs: vi.fn().mockReturnValue(['-o', 'BatchMode=yes', 'testuser@test.example.com']),
	};
}

describe('batchExtractSessionPreviewsRemote', () => {
	it('should extract preview data for multiple files', async () => {
		const stdout = [
			'===PREVIEW:/path/session1.jsonl===',
			'LINES:150',
			'FIRST_TS:2026-01-01T00:00:00Z',
			'LAST_TS:2026-01-01T01:30:00Z',
			'MSG:Hello, can you help me with a React component?',
			'===END_PREVIEW===',
			'===PREVIEW:/path/session2.jsonl===',
			'LINES:50',
			'FIRST_TS:2026-02-15T10:00:00Z',
			'LAST_TS:2026-02-15T10:45:00Z',
			'MSG:Fix the bug in authentication',
			'===END_PREVIEW===',
		].join('\n');

		const deps = createMockDeps(stdout);
		const result = await batchExtractSessionPreviewsRemote(
			['/path/session1.jsonl', '/path/session2.jsonl'],
			mockSshConfig,
			deps
		);

		expect(result.success).toBe(true);
		expect(result.data?.size).toBe(2);

		const s1 = result.data?.get('/path/session1.jsonl');
		expect(s1).toBeDefined();
		expect(s1!.totalLines).toBe(150);
		expect(s1!.firstTimestamp).toBe('2026-01-01T00:00:00Z');
		expect(s1!.lastTimestamp).toBe('2026-01-01T01:30:00Z');
		expect(s1!.firstMessage).toBe('Hello, can you help me with a React component?');

		const s2 = result.data?.get('/path/session2.jsonl');
		expect(s2).toBeDefined();
		expect(s2!.totalLines).toBe(50);
		expect(s2!.firstMessage).toBe('Fix the bug in authentication');
	});

	it('should handle empty file list', async () => {
		const deps = createMockDeps('');
		const result = await batchExtractSessionPreviewsRemote([], mockSshConfig, deps);

		expect(result.success).toBe(true);
		expect(result.data?.size).toBe(0);
		expect(deps.execSsh).not.toHaveBeenCalled();
	});

	it('should handle missing fields gracefully', async () => {
		const stdout = [
			'===PREVIEW:/path/session.jsonl===',
			'LINES:10',
			'FIRST_TS:',
			'LAST_TS:',
			'MSG:',
			'===END_PREVIEW===',
		].join('\n');

		const deps = createMockDeps(stdout);
		const result = await batchExtractSessionPreviewsRemote(
			['/path/session.jsonl'],
			mockSshConfig,
			deps
		);

		expect(result.success).toBe(true);
		const preview = result.data?.get('/path/session.jsonl');
		expect(preview).toBeDefined();
		expect(preview!.totalLines).toBe(10);
		expect(preview!.firstTimestamp).toBe('');
		expect(preview!.lastTimestamp).toBe('');
		expect(preview!.firstMessage).toBe('');
	});

	it('should continue processing if one chunk fails', async () => {
		// Create 120 file paths (exceeds CHUNK_SIZE of 100)
		const filePaths = Array.from({ length: 120 }, (_, i) => `/path/session${i}.jsonl`);

		const chunk2Output = Array.from(
			{ length: 20 },
			(_, i) =>
				`===PREVIEW:/path/session${100 + i}.jsonl===\nLINES:5\nFIRST_TS:ts\nLAST_TS:ts\nMSG:msg\n===END_PREVIEW===`
		).join('\n');

		const execSsh = vi
			.fn()
			.mockResolvedValueOnce({ stdout: '', stderr: 'error', exitCode: 1 })
			.mockResolvedValueOnce({ stdout: chunk2Output, stderr: '', exitCode: 0 });

		const deps: RemoteFsDeps = {
			execSsh,
			buildSshArgs: vi.fn().mockReturnValue([]),
		};

		const result = await batchExtractSessionPreviewsRemote(filePaths, mockSshConfig, deps);

		expect(result.success).toBe(true);
		expect(result.data?.size).toBe(20); // Only second chunk results
		expect(execSsh).toHaveBeenCalledTimes(2);
	});

	it('should make exactly 1 SSH call for ≤100 files', async () => {
		const stdout =
			'===PREVIEW:/path/s.jsonl===\nLINES:10\nFIRST_TS:t\nLAST_TS:t\nMSG:hi\n===END_PREVIEW===';
		const deps = createMockDeps(stdout);

		await batchExtractSessionPreviewsRemote(['/path/s.jsonl'], mockSshConfig, deps);
		expect(deps.execSsh).toHaveBeenCalledTimes(1);
	});

	it('should properly escape single quotes in file paths', async () => {
		const stdout =
			"===PREVIEW:/path/it's.jsonl===\nLINES:5\nFIRST_TS:t\nLAST_TS:t\nMSG:msg\n===END_PREVIEW===";
		const deps = createMockDeps(stdout);

		await batchExtractSessionPreviewsRemote(["/path/it's.jsonl"], mockSshConfig, deps);

		const sshCall = (deps.execSsh as ReturnType<typeof vi.fn>).mock.calls[0];
		const command = sshCall[1][sshCall[1].length - 1];
		expect(command).toContain("'\\''");
	});

	it('should verify shell script prefers assistant messages over user messages', async () => {
		// The shell script should try assistant type first, then fall back to user
		const stdout = [
			'===PREVIEW:/path/session1.jsonl===',
			'LINES:50',
			'FIRST_TS:2026-01-01T00:00:00Z',
			'LAST_TS:2026-01-01T01:00:00Z',
			'MSG:I can help you with that React component.',
			'===END_PREVIEW===',
		].join('\n');

		const deps = createMockDeps(stdout);
		const result = await batchExtractSessionPreviewsRemote(
			['/path/session1.jsonl'],
			mockSshConfig,
			deps
		);

		expect(result.success).toBe(true);
		const s1 = result.data?.get('/path/session1.jsonl');
		expect(s1?.firstMessage).toBe('I can help you with that React component.');

		// Verify the shell script was called with assistant-first grep pattern
		const execCall = (deps.execSsh as ReturnType<typeof vi.fn>).mock.calls[0];
		const sshArgs = execCall[1];
		const scriptArg = sshArgs[sshArgs.length - 1]; // Shell script is last ssh arg
		expect(scriptArg).toContain('"type":"assistant"');
		// Assistant grep should come BEFORE user grep in the script
		const assistantIdx = scriptArg.indexOf('grep -m 1 \'"type":"assistant"\'');
		const userIdx = scriptArg.indexOf('grep -m 1 \'"type":"user"\'');
		expect(assistantIdx).toBeLessThan(userIdx);
	});

	it('should verify shell script scans 20 lines', async () => {
		const stdout = [
			'===PREVIEW:/path/session1.jsonl===',
			'LINES:100',
			'FIRST_TS:2026-01-01T00:00:00Z',
			'LAST_TS:2026-01-01T01:00:00Z',
			'MSG:Some message',
			'===END_PREVIEW===',
		].join('\n');

		const deps = createMockDeps(stdout);
		await batchExtractSessionPreviewsRemote(['/path/session1.jsonl'], mockSshConfig, deps);

		// Verify the shell script uses head -n 20 (not head -n 10)
		const execCall = (deps.execSsh as ReturnType<typeof vi.fn>).mock.calls[0];
		const sshArgs = execCall[1];
		const scriptArg = sshArgs[sshArgs.length - 1];
		expect(scriptArg).toContain('head -n 20');
		expect(scriptArg).not.toContain('head -n 10');
	});

	it('should verify shell script truncates to 200 chars', async () => {
		const stdout = [
			'===PREVIEW:/path/session1.jsonl===',
			'LINES:10',
			'FIRST_TS:2026-01-01T00:00:00Z',
			'LAST_TS:2026-01-01T01:00:00Z',
			'MSG:Short message',
			'===END_PREVIEW===',
		].join('\n');

		const deps = createMockDeps(stdout);
		await batchExtractSessionPreviewsRemote(['/path/session1.jsonl'], mockSshConfig, deps);

		// Verify the shell script uses cut -c1-200 (not cut -c1-250)
		const execCall = (deps.execSsh as ReturnType<typeof vi.fn>).mock.calls[0];
		const sshArgs = execCall[1];
		const scriptArg = sshArgs[sshArgs.length - 1];
		expect(scriptArg).toContain('cut -c1-200');
		expect(scriptArg).not.toContain('cut -c1-250');
	});
});
