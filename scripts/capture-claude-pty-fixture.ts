/**
 * Capture a raw PTY fixture from a live `claude` session.
 *
 * Usage:
 *   npx tsx scripts/capture-claude-pty-fixture.ts [options]
 *
 * Options:
 *   --output <basename>       Output filename stem (default: v<version>-canary)
 *   --effort <low|medium|high> Sets CLAUDE_CODE_EFFORT_LEVEL env for the session
 *   --thinking <true|false>   Sets alwaysThinkingEnabled in ~/.claude/settings.json
 *   --max-wait <ms>           Max capture duration in ms (default: 60000)
 *   --idle-threshold <ms>     Idle silence before declaring done (default: 3000)
 *   --prompt <text>           Canary prompt to send (default: 'Reply with the single word: ready')
 *
 * Writes:
 *   src/__tests__/fixtures/claude-pty/<output>.raw   — raw bytes (pre-clean)
 *   src/__tests__/fixtures/claude-pty/<output>.meta.json
 */
import * as pty from 'node-pty';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

const DEFAULT_MAX_WAIT_MS = 60_000;
const DEFAULT_IDLE_THRESHOLD_MS = 3_000;
const WRITE_DELAY_MS = 2_000;
const TRUST_DIALOG_DELAY_MS = 3_000;
const DEFAULT_CANARY_PROMPT = 'Reply with the single word: ready';

// Pattern for the initial trust/safety-check dialog claude shows in new directories
const TRUST_DIALOG_PATTERN = /Yes.*trust.*folder|1\.\s*Yes/i;

function parseArgs(argv: string[]): Record<string, string> {
	const args: Record<string, string> = {};
	for (let i = 0; i < argv.length; i++) {
		if (argv[i].startsWith('--') && i + 1 < argv.length) {
			const key = argv[i].slice(2);
			args[key] = argv[i + 1];
			i++;
		}
	}
	return args;
}

function getClaudeVersion(binary: string): string {
	try {
		const raw = execSync(`${binary} --version`, { encoding: 'utf-8', timeout: 5_000 });
		// Output looks like "2.1.141 (Claude Code)" — first token is the version
		const token = raw.trim().split(/\s+/)[0];
		// swallow-ok: version detection is best-effort; 'unknown' is the documented fallback
		return token ?? 'unknown';
	} catch {
		return 'unknown';
	}
}

function readSettingsJson(settingsPath: string): Record<string, unknown> {
	try {
		// swallow-ok: settings file may not exist; empty object is the safe default
		return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
	} catch {
		return {};
	}
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	const claudeBinary = process.env.CLAUDE_BINARY ?? 'claude';
	const version = getClaudeVersion(claudeBinary);
	const effortLevel = args['effort'] ?? process.env.CLAUDE_CODE_EFFORT_LEVEL ?? 'medium';
	const thinkingEnabled = args['thinking'] !== undefined ? args['thinking'] === 'true' : undefined;
	const maxWaitMs = parseInt(args['max-wait'] ?? String(DEFAULT_MAX_WAIT_MS), 10);
	const idleThresholdMs = parseInt(args['idle-threshold'] ?? String(DEFAULT_IDLE_THRESHOLD_MS), 10);
	const canaryPrompt = args['prompt'] ?? DEFAULT_CANARY_PROMPT;

	// Build output basename
	let outputBasename = args['output'];
	if (!outputBasename) {
		outputBasename = `v${version}-canary`;
	}

	console.log(`[capture-fixture] claude version: ${version}`);
	console.log(`[capture-fixture] effort level: ${effortLevel}`);
	console.log(`[capture-fixture] thinking enabled: ${thinkingEnabled}`);
	console.log(`[capture-fixture] output: ${outputBasename}`);
	console.log(`[capture-fixture] max wait: ${maxWaitMs}ms, idle threshold: ${idleThresholdMs}ms`);

	const fixturesDir = path.join(__dirname, '..', 'src', '__tests__', 'fixtures', 'claude-pty');
	fs.mkdirSync(fixturesDir, { recursive: true });

	const rawPath = path.join(fixturesDir, `${outputBasename}.raw`);
	const metaPath = path.join(fixturesDir, `${outputBasename}.meta.json`);

	// Temporarily update settings.json if thinkingEnabled was specified
	const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
	let originalSettings: string | null = null;
	if (thinkingEnabled !== undefined) {
		try {
			// swallow-ok: settings.json may not exist; null signals "nothing to restore"
			originalSettings = fs.readFileSync(settingsPath, 'utf-8');
		} catch {
			originalSettings = null;
		}
		const settings = readSettingsJson(settingsPath);
		settings['alwaysThinkingEnabled'] = thinkingEnabled;
		fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
		console.log(
			`[capture-fixture] temporarily set alwaysThinkingEnabled=${thinkingEnabled} in ${settingsPath}`
		);
	}

	const chunks: Buffer[] = [];
	let totalBytes = 0;
	const startedAt = Date.now();

	// Build env — respect effort level, strip credentials per Phase 1+ design intent
	const spawnEnv: Record<string, string> = {};
	for (const [k, v] of Object.entries(process.env)) {
		if (v !== undefined) spawnEnv[k] = v;
	}
	delete spawnEnv['ANTHROPIC_API_KEY'];
	delete spawnEnv['ANTHROPIC_AUTH_TOKEN'];
	spawnEnv['TERM'] = 'dumb';
	spawnEnv['HOME'] = os.homedir();
	if (args['effort']) {
		spawnEnv['CLAUDE_CODE_EFFORT_LEVEL'] = effortLevel;
	}

	const proc = pty.spawn(claudeBinary, [], {
		name: 'xterm-256color',
		cols: 120,
		rows: 40,
		cwd: process.cwd(),
		env: spawnEnv,
	});

	let lastDataAt = Date.now();
	let turnCompleted = false;
	let idleTimer: ReturnType<typeof setTimeout> | null = null;
	let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
	let resolveCapture: () => void;
	const capturePromise = new Promise<void>((resolve) => {
		resolveCapture = resolve;
	});

	function scheduleIdleCheck(): void {
		if (idleTimer) clearTimeout(idleTimer);
		idleTimer = setTimeout(() => {
			if (!turnCompleted) {
				const silenceMs = Date.now() - lastDataAt;
				if (silenceMs >= idleThresholdMs) {
					console.log(
						`\n[capture-fixture] idle detected (${silenceMs}ms silence) — completing capture`
					);
					turnCompleted = true;
					resolveCapture();
				}
			}
		}, idleThresholdMs + 100);
	}

	proc.onData((data: string) => {
		const buf = Buffer.from(data, 'utf-8');
		chunks.push(buf);
		totalBytes += buf.length;
		lastDataAt = Date.now();
		process.stdout.write(`.`);
		scheduleIdleCheck();
	});

	let exitCode: number | null = null;
	let exitSignal: number | null = null;
	let trustHandled = false;

	proc.onExit(({ exitCode: ec, signal }) => {
		exitCode = ec ?? null;
		exitSignal = signal ?? null;
		if (!turnCompleted) {
			turnCompleted = true;
			resolveCapture();
		}
	});

	// Set max wait guard
	maxWaitTimer = setTimeout(() => {
		if (!turnCompleted) {
			console.log(`\n[capture-fixture] max wait (${maxWaitMs}ms) reached — completing capture`);
			turnCompleted = true;
			resolveCapture();
		}
	}, maxWaitMs);

	// Wait for init, then check for trust dialog and handle it
	await new Promise<void>((resolve) => setTimeout(resolve, WRITE_DELAY_MS));

	// If the first chunks contain the trust dialog, send '1' to confirm
	const capturedSoFar = Buffer.concat(chunks).toString('utf-8');
	if (TRUST_DIALOG_PATTERN.test(capturedSoFar) && !trustHandled) {
		console.log(`\n[capture-fixture] detected trust dialog — sending confirmation`);
		proc.write('1\n');
		trustHandled = true;
		// Give claude time to process the confirmation and show the REPL
		await new Promise<void>((resolve) => setTimeout(resolve, TRUST_DIALOG_DELAY_MS));
	}

	// Re-arm idle check after write delay (startup might have caused false idle)
	lastDataAt = Date.now();
	scheduleIdleCheck();

	console.log(`\n[capture-fixture] writing canary prompt: "${canaryPrompt}"`);
	proc.write(canaryPrompt + '\n');

	// Wait for idle-based completion or max wait
	await capturePromise;

	if (idleTimer) clearTimeout(idleTimer);
	if (maxWaitTimer) clearTimeout(maxWaitTimer);

	// Send exit to clean up
	try {
		proc.write('exit\n');
		// swallow-ok: process may already be dead; cleanup is best-effort
	} catch {
		/* already dead */
	}
	await new Promise<void>((resolve) => setTimeout(resolve, 500));
	try {
		proc.kill('SIGTERM');
		// swallow-ok: process may already be dead; cleanup is best-effort
	} catch {
		/* already dead */
	}

	const captureDurationMs = Date.now() - startedAt;
	console.log(
		`\n[capture-fixture] capture complete — ${totalBytes} bytes in ${chunks.length} chunks (${captureDurationMs}ms)`
	);

	// Restore settings.json if we modified it
	if (thinkingEnabled !== undefined) {
		if (originalSettings !== null) {
			fs.writeFileSync(settingsPath, originalSettings);
			console.log(`[capture-fixture] restored ${settingsPath} to original state`);
		} else {
			// We created it — remove only the key we added
			const settings = readSettingsJson(settingsPath);
			delete settings['alwaysThinkingEnabled'];
			if (Object.keys(settings).length === 0) {
				fs.unlinkSync(settingsPath);
			} else {
				fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
			}
			console.log(`[capture-fixture] removed alwaysThinkingEnabled key from ${settingsPath}`);
		}
	}

	// Write raw bytes (concatenated)
	const rawBytes = Buffer.concat(chunks);
	fs.writeFileSync(rawPath, rawBytes);
	console.log(`[capture-fixture] wrote raw fixture: ${rawPath}`);

	const meta = {
		version,
		capturedAt: new Date(startedAt).toISOString(),
		durationMs: captureDurationMs,
		byteCount: totalBytes,
		chunkCount: chunks.length,
		effortLevel,
		thinkingEnabled: thinkingEnabled ?? null,
		canaryPrompt,
		exitCode,
		exitSignal,
	};
	fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
	console.log(`[capture-fixture] wrote meta: ${metaPath}`);
	console.log('[capture-fixture] done.');
}

main().catch((err) => {
	console.error('[capture-fixture] fatal:', err);
	process.exit(1);
});
