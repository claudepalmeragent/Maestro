#!/usr/bin/env tsx
/**
 * Verification harness for ClaudePtyRunner dual-mode transport (ARD 8).
 *
 * Canary prompt uses RANDOM_TOKEN (crypto.randomUUID()) per iteration to prove
 * the correct response reached the caller without corruption.
 *
 * Usage:
 *   tsx scripts/verify-claude-pty-runner.ts --mode <legacy-print|interactive-pty> [options]
 *
 * Options:
 *   --mode       <legacy-print|interactive-pty>  (required)
 *   --prompt     <text>                           (default: canary)
 *   --cwd        <dir>                            (default: process.cwd())
 *   --ssh-host   <alias>                          (optional; exercises SSH+PTY path)
 *   --iterations <N>                              (default: 3)
 */

import { randomUUID } from 'crypto';
import { parseArgs } from 'util';
import { spawnClaudeAgent } from '../src/cli/services/agent-spawner';
import { ClaudePtyRunner } from '../src/main/utils/claude-pty-runner';
import { buildSshClaudeInteractiveArgs } from '../src/main/utils/ssh-command-builder';
import { stripPrintArgs, deriveStableClaudeSessionId } from '../src/main/utils/claude-pty-helpers';
import { buildExpandedEnv } from '../src/shared/pathUtils';
import type { SshRemoteConfig } from '../src/shared/types';
import type { AgentResult } from '../src/cli/services/agent-spawner';

type TransportMode = 'legacy-print' | 'interactive-pty';

// Canary prompt template — RANDOM_TOKEN is substituted with crypto.randomUUID() per iteration
const CANARY_TEMPLATE =
	'Output exactly the JSON object {"verified":true,"echo":"<RANDOM_TOKEN>"} and nothing else.';

// Claude args minus --print (used for the SSH PTY path which needs interactive-pty style)
const CLAUDE_BASE_ARGS_NO_PRINT = [
	'--verbose',
	'--output-format',
	'stream-json',
	'--dangerously-skip-permissions',
];

interface IterationResult {
	iteration: number;
	success: boolean;
	response?: string;
	agentSessionId?: string;
	durationMs: number;
	tokenCount: number;
	responseLength: number;
	tokenVerified: boolean;
	error?: string;
}

/**
 * Run a single local iteration using spawnClaudeAgent with the given transport mode.
 * Sets MAESTRO_CLAUDE_TRANSPORT_MODE in the environment so resolveCliClaudeTransportMode picks it up.
 */
async function runLocalIteration(
	mode: TransportMode,
	cwd: string,
	customPrompt: string | undefined,
	iterationNum: number
): Promise<IterationResult> {
	const token = randomUUID();
	const prompt = customPrompt ?? CANARY_TEMPLATE.replace('<RANDOM_TOKEN>', token);

	// Set env var so resolveCliClaudeTransportMode uses the requested mode
	process.env.MAESTRO_CLAUDE_TRANSPORT_MODE = mode;
	const start = Date.now();
	let result: AgentResult;
	try {
		result = await spawnClaudeAgent(cwd, prompt, undefined, randomUUID());
	} finally {
		delete process.env.MAESTRO_CLAUDE_TRANSPORT_MODE;
	}
	const durationMs = Date.now() - start;

	const responseLength = result.response?.length ?? 0;
	const tokenCount = (result.usageStats?.inputTokens ?? 0) + (result.usageStats?.outputTokens ?? 0);
	// When a custom prompt is used, skip token verification (no RANDOM_TOKEN to match)
	const tokenVerified = customPrompt ? true : (result.response?.includes(token) ?? false);

	return {
		iteration: iterationNum,
		success: result.success,
		response: result.response,
		agentSessionId: result.agentSessionId,
		durationMs,
		tokenCount,
		responseLength,
		tokenVerified,
		error: result.error,
	};
}

/**
 * Run a single SSH iteration using ClaudePtyRunner directly (interactive-pty over SSH).
 * Mirrors the Electron IPC handler SSH branch from ARD 6.
 */
async function runSshIteration(
	sshHost: string,
	cwd: string,
	customPrompt: string | undefined,
	iterationNum: number
): Promise<IterationResult> {
	const token = randomUUID();
	const prompt = customPrompt ?? CANARY_TEMPLATE.replace('<RANDOM_TOKEN>', token);
	const maestroSessionId = randomUUID();

	const sshConfig: SshRemoteConfig = {
		id: 'verify-harness-ssh',
		name: sshHost,
		host: sshHost,
		port: 22,
		username: '',
		privateKeyPath: '',
		enabled: true,
		useSshConfig: true,
	};

	const rawEnv = buildExpandedEnv();
	delete rawEnv.ANTHROPIC_API_KEY;
	delete rawEnv.ANTHROPIC_AUTH_TOKEN;
	const env = Object.fromEntries(
		Object.entries(rawEnv).filter((e): e is [string, string] => e[1] !== undefined)
	);

	const claudeArgs = stripPrintArgs([
		...CLAUDE_BASE_ARGS_NO_PRINT,
		'--session-id',
		deriveStableClaudeSessionId(maestroSessionId),
	]);

	let sshArgs: string[];
	try {
		sshArgs = await buildSshClaudeInteractiveArgs(sshConfig, claudeArgs, cwd, env);
	} catch (err) {
		return {
			iteration: iterationNum,
			success: false,
			durationMs: 0,
			tokenCount: 0,
			responseLength: 0,
			tokenVerified: false,
			error: `buildSshClaudeInteractiveArgs failed: ${err instanceof Error ? err.message : String(err)}`,
		};
	}

	const start = Date.now();
	return new Promise((resolve) => {
		let runner: ClaudePtyRunner;
		try {
			runner = new ClaudePtyRunner({
				maestroSessionId,
				claudeBinary: 'ssh',
				claudeBaseArgs: sshArgs,
				cwd: process.cwd(), // SSH client runs locally
				env,
			});
		} catch (err) {
			resolve({
				iteration: iterationNum,
				success: false,
				durationMs: Date.now() - start,
				tokenCount: 0,
				responseLength: 0,
				tokenVerified: false,
				error: `ClaudePtyRunner construction failed: ${err instanceof Error ? err.message : String(err)}`,
			});
			return;
		}

		let response: string | undefined;
		let agentSessionId: string | undefined;
		let tokenCount = 0;

		runner.on('event', (e) => {
			if ((e.type === 'init' || e.type === 'result') && e.sessionId && !agentSessionId) {
				agentSessionId = e.sessionId;
			}
			if (e.type === 'result' && e.text) {
				response = response ? `${response}\n${e.text}` : e.text;
			}
			if (e.type === 'usage' && e.usage) {
				tokenCount += (e.usage.inputTokens ?? 0) + (e.usage.outputTokens ?? 0);
			}
		});

		runner.on('end', (exitReason) => {
			const durationMs = Date.now() - start;
			const tokenVerified = customPrompt ? true : (response?.includes(token) ?? false);
			resolve({
				iteration: iterationNum,
				success: exitReason === 'SUCCESS' && !!response,
				response,
				agentSessionId,
				durationMs,
				tokenCount,
				responseLength: response?.length ?? 0,
				tokenVerified,
				error: exitReason !== 'SUCCESS' ? `Runner ended with ${exitReason}` : undefined,
			});
		});

		runner.executeTurn(prompt);
	});
}

function printTable(label: string, results: IterationResult[]): void {
	const succeeded = results.filter((r) => r.success);
	const tokenVerifiedCount = results.filter((r) => r.tokenVerified).length;
	const successRate = `${succeeded.length}/${results.length} (${Math.round((succeeded.length / results.length) * 100)}%)`;
	const avgDuration =
		results.length > 0
			? Math.round(results.reduce((s, r) => s + r.durationMs, 0) / results.length)
			: 0;
	const avgTokens =
		results.length > 0
			? Math.round(results.reduce((s, r) => s + r.tokenCount, 0) / results.length)
			: 0;
	const avgLength =
		results.length > 0
			? Math.round(results.reduce((s, r) => s + r.responseLength, 0) / results.length)
			: 0;

	console.log(`\n${'─'.repeat(64)}`);
	console.log(`Mode: ${label}`);
	console.log(`${'─'.repeat(64)}`);
	console.log(`Success rate:      ${successRate}`);
	console.log(`Token verified:    ${tokenVerifiedCount}/${results.length}`);
	console.log(`Avg duration:      ${avgDuration}ms`);
	console.log(`Avg token count:   ${avgTokens}`);
	console.log(`Avg response len:  ${avgLength} chars`);
	console.log(`Per-iteration:`);
	for (const r of results) {
		const ok = r.success && r.tokenVerified;
		const status = ok ? 'PASS' : 'FAIL';
		const detail = r.error
			? ` | error: ${r.error}`
			: ` | ${r.durationMs}ms | tokens:${r.tokenCount} | len:${r.responseLength}`;
		console.log(`  [${r.iteration}] ${status}${detail}`);
	}
}

async function main(): Promise<void> {
	const { values: args } = parseArgs({
		options: {
			mode: { type: 'string' },
			prompt: { type: 'string' },
			cwd: { type: 'string' },
			'ssh-host': { type: 'string' },
			iterations: { type: 'string' },
		},
		strict: false,
	});

	const mode = args.mode as TransportMode | undefined;
	if (!mode || (mode !== 'legacy-print' && mode !== 'interactive-pty')) {
		console.error('Error: --mode <legacy-print|interactive-pty> is required');
		process.exit(1);
	}

	const cwd = (args.cwd as string | undefined) ?? process.cwd();
	const iterations = Math.max(1, parseInt((args.iterations as string | undefined) ?? '3', 10));
	const sshHost = args['ssh-host'] as string | undefined;
	const customPrompt = args.prompt as string | undefined;

	console.log('Maestro ClaudePtyRunner Verification Harness');
	console.log(`  Mode:       ${mode}`);
	console.log(`  Iterations: ${iterations}`);
	console.log(`  CWD:        ${cwd}`);
	if (sshHost) console.log(`  SSH host:   ${sshHost}`);
	if (customPrompt) console.log(`  Prompt:     ${customPrompt}`);

	// Run local iterations
	console.log(`\nRunning ${iterations} local iteration(s)...`);
	const localResults: IterationResult[] = [];
	for (let i = 1; i <= iterations; i++) {
		process.stdout.write(`  [${i}/${iterations}] `);
		const r = await runLocalIteration(mode, cwd, customPrompt, i);
		localResults.push(r);
		console.log(r.success && r.tokenVerified ? 'PASS' : `FAIL${r.error ? ': ' + r.error : ''}`);
	}

	printTable(`local / ${mode}`, localResults);

	// SSH iterations (always use interactive-pty since that's the SSH+PTY path from ARD 6)
	const sshResults: IterationResult[] = [];
	if (sshHost) {
		console.log(`\nRunning ${iterations} SSH iteration(s) via ${sshHost} (interactive-pty)...`);
		for (let i = 1; i <= iterations; i++) {
			process.stdout.write(`  [${i}/${iterations}] `);
			const r = await runSshIteration(sshHost, cwd, customPrompt, i);
			sshResults.push(r);
			console.log(r.success && r.tokenVerified ? 'PASS' : `FAIL${r.error ? ': ' + r.error : ''}`);
		}
		printTable(`ssh / interactive-pty via ${sshHost}`, sshResults);

		// Compare local vs SSH timing
		const allLocal = localResults;
		const allSsh = sshResults;
		if (allLocal.length > 0 && allSsh.length > 0) {
			const localAvg = Math.round(allLocal.reduce((s, r) => s + r.durationMs, 0) / allLocal.length);
			const sshAvg = Math.round(allSsh.reduce((s, r) => s + r.durationMs, 0) / allSsh.length);
			console.log(`\nLocal vs SSH timing: local=${localAvg}ms, ssh=${sshAvg}ms`);
		}
	}

	// Final verdict
	const allResults = [...localResults, ...sshResults];
	const allSuccess = allResults.every((r) => r.success);
	const allTokenVerified = allResults.every((r) => r.tokenVerified);

	console.log(`\n${'═'.repeat(64)}`);
	if (allSuccess && allTokenVerified) {
		console.log('RESULT: PASS — 100% success rate, all RANDOM_TOKEN echoes verified');
		process.exit(0);
	} else {
		const failures = allResults.filter((r) => !r.success || !r.tokenVerified);
		console.log(`RESULT: FAIL — ${failures.length} of ${allResults.length} iteration(s) failed`);
		for (const f of failures) {
			if (!f.success) {
				console.log(`  Iteration ${f.iteration}: ${f.error ?? 'unknown failure'}`);
			} else if (!f.tokenVerified) {
				console.log(`  Iteration ${f.iteration}: RANDOM_TOKEN not found in response`);
			}
		}
		process.exit(1);
	}
}

main().catch((err) => {
	console.error('Fatal error:', err);
	process.exit(1);
});
