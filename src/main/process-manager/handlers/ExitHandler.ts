// src/main/process-manager/handlers/ExitHandler.ts

import { EventEmitter } from 'events';
import { logger } from '../../utils/logger';
import { matchSshErrorPattern } from '../../parsers/error-patterns';
import { aggregateModelUsage } from '../../parsers/usage-aggregator';
import { cleanupTempFiles } from '../utils/imageUtils';
import type { ManagedProcess, AgentError } from '../types';
import type { DataBufferManager } from './DataBufferManager';
import type { SshRemoteConfig } from '../../../shared/types';
import { captureException } from '../../utils/sentry';
import { getSshRemoteById } from '../../stores/getters';
import {
	waitForCopilotShutdown,
	readCopilotFinalAnswer,
	readCopilotShutdownUsage,
	type CopilotShutdownWaitResult,
} from '../CopilotShutdownWaiter';
import { FALLBACK_CONTEXT_WINDOW } from '../../../shared/agentConstants';

interface ExitHandlerDependencies {
	processes: Map<string, ManagedProcess>;
	emitter: EventEmitter;
	bufferManager: DataBufferManager;
}

/**
 * Handles process exit events for child processes.
 * Processes final batch mode output, detects errors, and emits events.
 */
export class ExitHandler {
	private processes: Map<string, ManagedProcess>;
	private emitter: EventEmitter;
	private bufferManager: DataBufferManager;

	constructor(deps: ExitHandlerDependencies) {
		this.processes = deps.processes;
		this.emitter = deps.emitter;
		this.bufferManager = deps.bufferManager;
	}

	/**
	 * Extract the base Maestro agent ID from a session ID.
	 * Strips batch/ai/synopsis suffixes to get the stable agent identifier.
	 */
	private extractBaseAgentId(sessionId: string): string {
		const suffixPatterns = ['-batch-', '-ai-', '-synopsis-'];
		for (const pattern of suffixPatterns) {
			const idx = sessionId.indexOf(pattern);
			if (idx !== -1) {
				return sessionId.substring(0, idx);
			}
		}
		return sessionId;
	}

	/**
	 * Handle process exit event.
	 *
	 * Async because some agents need post-exit reconciliation against
	 * on-disk session state before the renderer is told the agent is
	 * done (currently: Copilot CLI - see `awaitCopilotShutdown`).
	 * Callers fire-and-forget, so errors are caught internally.
	 */
	async handleExit(sessionId: string, code: number): Promise<void> {
		const managedProcess = this.processes.get(sessionId);
		if (!managedProcess) {
			// No managed process - emit with resultEmitted=false (unknown state)
			this.emitter.emit('exit', sessionId, code, false);
			return;
		}

		const { isBatchMode, isStreamJsonMode, outputParser, toolType } = managedProcess;

		// Flush any remaining buffered data before exit
		this.bufferManager.flushDataBuffer(sessionId);

		logger.debug('[ProcessManager] Child process exit event', 'ProcessManager', {
			sessionId,
			code,
			isBatchMode,
			isStreamJsonMode,
			jsonBufferLength: managedProcess.jsonBuffer?.length || 0,
			jsonBufferPreview: managedProcess.jsonBuffer?.substring(0, 200),
		});

		// Debug: Log exit details for synopsis sessions
		if (sessionId.includes('-synopsis-')) {
			logger.info('[ProcessManager] Synopsis session exit', 'ProcessManager', {
				sessionId,
				exitCode: code,
				resultEmitted: managedProcess.resultEmitted,
				streamedTextLength: managedProcess.streamedText?.length || 0,
				streamedTextPreview: managedProcess.streamedText?.substring(0, 200) || '(empty)',
				stdoutBufferLength: managedProcess.stdoutBuffer?.length || 0,
				stderrBufferLength: managedProcess.stderrBuffer?.length || 0,
				stderrPreview: managedProcess.stderrBuffer?.substring(0, 200) || '(empty)',
			});
		}

		// Copilot CLI: wait for the on-disk shutdown marker before emitting
		// `exit`. Copilot can keep working in subagent processes after our
		// parent process closes, and `session.shutdown` is only ever
		// written to `events.jsonl` — never to stdout in batch mode. If
		// we emit `exit` immediately, the renderer flips to idle while
		// Copilot is still doing real work; the user has to manually poke
		// the tab to discover work is ongoing. When the shutdown marker
		// is found, we also re-derive the authoritative final answer from
		// disk so the rendered text matches what Copilot truly finished
		// with (not the stale planning narration our parent saw last).
		await this.awaitCopilotShutdown(sessionId, managedProcess);

		// Handle regular batch mode (not stream-json)
		if (isBatchMode && !isStreamJsonMode && managedProcess.jsonBuffer) {
			this.handleBatchModeExit(sessionId, managedProcess);
		}

		// Handle stream-json mode: process any remaining jsonBuffer content
		// The jsonBuffer may contain the last line if it didn't end with \n.
		// Without this, short-lived processes (tab-naming, batch ops) can lose
		// their result message if it's the last line without a trailing newline.
		if (isStreamJsonMode && managedProcess.jsonBuffer?.trim() && outputParser) {
			const remainingLine = managedProcess.jsonBuffer.trim();
			managedProcess.jsonBuffer = '';
			logger.debug('[ProcessManager] Processing remaining jsonBuffer at exit', 'ProcessManager', {
				sessionId,
				remainingLineLength: remainingLine.length,
				remainingLinePreview: remainingLine.substring(0, 200),
			});
			try {
				const event = outputParser.parseJsonLine(remainingLine);
				if (event && outputParser.isResultMessage(event) && !managedProcess.resultEmitted) {
					managedProcess.resultEmitted = true;
					const resultText = event.text || managedProcess.streamedText || '';
					if (resultText) {
						this.bufferManager.emitDataBuffered(sessionId, resultText);
					}
				}
			} catch {
				// If parsing fails, emit the raw line as data
				this.bufferManager.emitDataBuffered(sessionId, remainingLine);
			}
		}

		// Handle stream-json mode: emit accumulated streamed text if no result was emitted
		// Some agents (like Factory Droid) don't send explicit "done" events, they just exit
		if (isStreamJsonMode && !managedProcess.resultEmitted && managedProcess.streamedText) {
			managedProcess.resultEmitted = true;
			logger.debug(
				'[ProcessManager] Emitting streamed text at exit (no result event)',
				'ProcessManager',
				{
					sessionId,
					streamedTextLength: managedProcess.streamedText.length,
				}
			);
			this.bufferManager.emitDataBuffered(sessionId, managedProcess.streamedText);
		}

		// Check for errors using the parser (if not already emitted)
		if (outputParser && !managedProcess.errorEmitted) {
			const agentError = outputParser.detectErrorFromExit(
				code,
				managedProcess.stderrBuffer || '',
				managedProcess.stdoutBuffer || managedProcess.streamedText || ''
			);
			if (agentError) {
				managedProcess.errorEmitted = true;
				agentError.sessionId = sessionId;
				if (managedProcess.sshRemoteId) {
					agentError.sshRemoteId = managedProcess.sshRemoteId;
				}
				logger.debug('[ProcessManager] Error detected from exit', 'ProcessManager', {
					sessionId,
					exitCode: code,
					errorType: agentError.type,
					errorMessage: agentError.message,
				});
				this.emitter.emit('agent-error', sessionId, agentError);
			}
		}

		// Check for SSH-specific errors at exit - runs unconditionally (not gated on sshRemoteId)
		// SSH error patterns are specific enough that they won't false-positive on local processes.
		// Running unconditionally ensures SSH errors are detected even if sshRemoteId was lost.
		// SSH errors can appear in stdout OR stderr, so check both.
		if (!managedProcess.errorEmitted && (code !== 0 || managedProcess.stderrBuffer)) {
			const stderrToCheck = managedProcess.stderrBuffer || '';
			const stdoutToCheck = managedProcess.stdoutBuffer || managedProcess.streamedText || '';
			const combinedOutput = `${stdoutToCheck}\n${stderrToCheck}`;

			// Log detailed info before SSH error check to help debug shell parse errors
			logger.info('[ProcessManager] Checking for SSH errors at exit', 'ProcessManager', {
				sessionId,
				exitCode: code,
				sshRemoteId: managedProcess.sshRemoteId,
				stderrLength: stderrToCheck.length,
				stderrPreview: stderrToCheck.substring(0, 300),
				stdoutLength: stdoutToCheck.length,
				combinedLength: combinedOutput.length,
			});

			const sshError = matchSshErrorPattern(combinedOutput);
			if (sshError) {
				managedProcess.errorEmitted = true;
				const processUptimeMs = Date.now() - managedProcess.startTime;
				const hasProducedOutput = !!(managedProcess.streamedText || managedProcess.stdoutBuffer);

				// Enhanced diagnostic logging — at exit, we have the full picture
				logger.warn('[ProcessManager] SSH error detected at EXIT', 'ProcessManager', {
					sessionId,
					exitCode: code,
					errorType: sshError.type,
					errorMessage: sshError.message,
					matchedPattern: sshError.matchedPattern,
					matchedText: sshError.matchedText,
					rawStderr: stderrToCheck.substring(0, 500),
					handlerSource: 'ExitHandler',
					processUptimeMs,
					processUptimeSec: Math.round(processUptimeMs / 1000),
					hasProducedOutput,
					toolType,
					spawnContext: managedProcess.spawnContext,
					sshRemoteId: managedProcess.sshRemoteId,
					sshRemoteHost: managedProcess.sshRemoteHost,
					pid: managedProcess.pid,
				});

				const agentError: AgentError = {
					type: sshError.type,
					message: sshError.message,
					recoverable: sshError.recoverable,
					agentId: toolType,
					sessionId,
					sshRemoteId: managedProcess.sshRemoteId,
					timestamp: Date.now(),
					raw: {
						exitCode: code,
						stderr: stderrToCheck,
						stdout: stdoutToCheck.substring(0, 1000), // Truncate for log size
						diagnostics: {
							handlerSource: 'ExitHandler',
							processUptimeMs,
							hasProducedOutput,
							matchedPattern: sshError.matchedPattern,
							matchedText: sshError.matchedText,
						},
					},
					errorContext: managedProcess.spawnContext,
				};
				this.emitter.emit('agent-error', sessionId, agentError);
			} else if (code !== 0) {
				// Log SSH failures even if no pattern matched, to help debug
				logger.warn(
					'[ProcessManager] SSH command failed without matching error pattern',
					'ProcessManager',
					{
						sessionId,
						exitCode: code,
						sshRemoteId: managedProcess.sshRemoteId,
						stderrPreview: stderrToCheck.substring(0, 500),
					}
				);
			}
		}

		// Clean up temp image files if any
		if (managedProcess.tempImageFiles && managedProcess.tempImageFiles.length > 0) {
			cleanupTempFiles(managedProcess.tempImageFiles);
		}

		// Emit query-complete event for batch mode processes (for stats tracking)
		if (isBatchMode && managedProcess.querySource) {
			const duration = Date.now() - managedProcess.startTime;

			// Compute tokens per second from lastUsageTotals (populated by StdoutHandler)
			const durationSeconds = duration / 1000;
			const outputTokens = managedProcess.lastUsageTotals?.outputTokens;
			const inputTokens = managedProcess.lastUsageTotals?.inputTokens;
			const cacheReadInputTokens = managedProcess.lastUsageTotals?.cacheReadInputTokens;
			const cacheCreationInputTokens = managedProcess.lastUsageTotals?.cacheCreationInputTokens;
			const totalCostUsd = managedProcess.lastUsageTotals?.totalCostUsd;
			const detectedModel = managedProcess.lastUsageTotals?.detectedModel;
			const tokensPerSecond =
				outputTokens && durationSeconds > 0 ? outputTokens / durationSeconds : undefined;

			this.emitter.emit('query-complete', sessionId, {
				sessionId,
				agentId: this.extractBaseAgentId(sessionId),
				agentType: toolType,
				source: managedProcess.querySource,
				startTime: managedProcess.startTime,
				duration,
				projectPath: managedProcess.projectPath,
				tabId: managedProcess.tabId,
				inputTokens,
				outputTokens,
				tokensPerSecond,
				cacheReadInputTokens,
				cacheCreationInputTokens,
				totalCostUsd,
				detectedModel,
				anthropicMessageId: managedProcess.lastUsageTotals?.anthropicMessageId,
			});
			logger.debug('[ProcessManager] Query complete event emitted', 'ProcessManager', {
				sessionId,
				duration,
				source: managedProcess.querySource,
				inputTokens,
				outputTokens,
				tokensPerSecond: tokensPerSecond?.toFixed(1),
				cacheReadInputTokens,
				cacheCreationInputTokens,
				totalCostUsd,
			});
		}

		// Final flush: ensure any data buffered during exit processing
		// (e.g., from jsonBuffer remainder or streamedText fallback) is emitted
		// before the exit event, so listeners see all data before exit fires.
		this.bufferManager.flushDataBuffer(sessionId);

		// Include resultEmitted flag so renderer knows if a result was sent
		// before the process exited (used for synopsis timing)
		this.emitter.emit('exit', sessionId, code, managedProcess.resultEmitted ?? false);
		this.processes.delete(sessionId);
	}

	/**
	 * For Copilot CLI batch sessions, block emitting `exit` until the
	 * authoritative `session.shutdown` event has been written to the
	 * on-disk events.jsonl, or activity has clearly stopped. On success
	 * also override `streamedText` with the disk-derived final answer
	 * so the downstream flush emits Copilot's real conclusion, not the
	 * possibly-stale text our parent process captured before it died.
	 *
	 * No-op for non-Copilot agents. For SSH-remote Copilot sessions the
	 * events file lives on the remote host, so the reads below go over SSH
	 * (resolved from `sshRemoteId`); without this the remote context gauge
	 * would stay stuck at 0% since `currentTokens` never appears on stdout.
	 */
	private async awaitCopilotShutdown(
		sessionId: string,
		managedProcess: ManagedProcess
	): Promise<void> {
		if (managedProcess.toolType !== 'copilot-cli') return;
		const agentSessionId = managedProcess.agentSessionId;
		if (!agentSessionId) return;

		// Resolve the full SSH config for remote sessions. If the agent was
		// configured for SSH but the remote can't be resolved, skip rather than
		// reading a non-existent local file (which would never match).
		let sshRemote: SshRemoteConfig | null = null;
		if (managedProcess.sshRemoteId) {
			sshRemote = getSshRemoteById(managedProcess.sshRemoteId) ?? null;
			if (!sshRemote) {
				logger.warn(
					'[ProcessManager] Copilot SSH remote unresolved; skipping disk reconciliation',
					'ProcessManager',
					{ sessionId, agentSessionId, sshRemoteId: managedProcess.sshRemoteId }
				);
				return;
			}
		}

		let result: CopilotShutdownWaitResult;
		try {
			result = await waitForCopilotShutdown(agentSessionId, { sshRemote });
		} catch (err) {
			logger.warn('[ProcessManager] Copilot shutdown wait threw', 'ProcessManager', {
				sessionId,
				agentSessionId,
				error: String(err),
			});
			return;
		}

		logger.info('[ProcessManager] Copilot shutdown wait completed', 'ProcessManager', {
			sessionId,
			agentSessionId,
			result,
		});

		if (result !== 'observed') return;

		try {
			const finalAnswer = await readCopilotFinalAnswer(agentSessionId, undefined, sshRemote);
			if (finalAnswer && finalAnswer.content) {
				managedProcess.streamedText = finalAnswer.content;
			}
		} catch (err) {
			logger.warn('[ProcessManager] Failed to read Copilot final answer', 'ProcessManager', {
				sessionId,
				agentSessionId,
				error: String(err),
			});
		}

		// Disk-derived usage snapshot. Copilot writes per-turn token counts and
		// the live `currentTokens` context-window state ONLY into the on-disk
		// `session.shutdown` event in batch mode; the stdout stream never
		// carries them, so the streaming usage path emits nothing and the
		// context gauge stays at 0% for every tab. Read it now and emit a
		// `usage` event with the same shape the parser would have produced if
		// session.shutdown had appeared on stdout. See the docstring on
		// `readCopilotShutdownUsage` for the field-mapping rationale.
		try {
			const usage = await readCopilotShutdownUsage(agentSessionId, undefined, sshRemote);
			if (usage) {
				const contextWindow =
					managedProcess.contextWindow && managedProcess.contextWindow > 0
						? managedProcess.contextWindow
						: FALLBACK_CONTEXT_WINDOW;
				this.emitter.emit('usage', sessionId, {
					inputTokens: usage.inputTokens,
					outputTokens: usage.outputTokens,
					cacheReadInputTokens: usage.cacheReadInputTokens,
					cacheCreationInputTokens: usage.cacheCreationInputTokens,
					totalCostUsd: 0,
					contextWindow,
					reasoningTokens: usage.reasoningTokens,
				});
			}
		} catch (err) {
			logger.warn('[ProcessManager] Failed to read Copilot disk-derived usage', 'ProcessManager', {
				sessionId,
				agentSessionId,
				error: String(err),
			});
		}
	}

	/**
	 * Handle batch mode exit - parse accumulated JSON
	 */
	private handleBatchModeExit(sessionId: string, managedProcess: ManagedProcess): void {
		try {
			const jsonResponse = JSON.parse(managedProcess.jsonBuffer!);

			// Emit the result text (only once per process)
			if (jsonResponse.result && !managedProcess.resultEmitted) {
				managedProcess.resultEmitted = true;
				this.emitter.emit('data', sessionId, jsonResponse.result);
			}

			// Emit session_id if present (only once per process)
			if (jsonResponse.session_id && !managedProcess.sessionIdEmitted) {
				managedProcess.sessionIdEmitted = true;
				this.emitter.emit('session-id', sessionId, jsonResponse.session_id);
			}

			// Extract and emit usage statistics
			if (
				jsonResponse.modelUsage ||
				jsonResponse.usage ||
				jsonResponse.total_cost_usd !== undefined
			) {
				const usageStats = aggregateModelUsage(
					jsonResponse.modelUsage,
					jsonResponse.usage || {},
					jsonResponse.total_cost_usd || 0
				);
				this.emitter.emit('usage', sessionId, usageStats);
			}
		} catch (error) {
			void captureException(error);
			logger.error('[ProcessManager] Failed to parse JSON response', 'ProcessManager', {
				sessionId,
				error: String(error),
			});
			// Emit raw buffer as fallback
			this.emitter.emit('data', sessionId, managedProcess.jsonBuffer!);
		}
	}

	/**
	 * Handle process error event (spawn failures, etc.)
	 */
	handleError(sessionId: string, error: Error): void {
		const managedProcess = this.processes.get(sessionId);

		logger.error('[ProcessManager] Child process error', 'ProcessManager', {
			sessionId,
			error: error.message,
		});

		// Emit agent error for process spawn failures
		if (managedProcess && !managedProcess.errorEmitted) {
			managedProcess.errorEmitted = true;
			const agentError: AgentError = {
				type: 'agent_crashed',
				message: `Agent process error: ${error.message}`,
				recoverable: true,
				agentId: managedProcess.toolType,
				sessionId,
				sshRemoteId: managedProcess.sshRemoteId,
				timestamp: Date.now(),
				raw: {
					stderr: error.message,
				},
			};
			this.emitter.emit('agent-error', sessionId, agentError);
		}

		// Clean up temp image files if any
		if (managedProcess?.tempImageFiles && managedProcess.tempImageFiles.length > 0) {
			cleanupTempFiles(managedProcess.tempImageFiles);
		}

		this.emitter.emit('data', sessionId, `[error] ${error.message}`);
		// Error exit - resultEmitted is false (error occurred before result)
		this.emitter.emit('exit', sessionId, 1, managedProcess?.resultEmitted ?? false);
		this.processes.delete(sessionId);
	}
}
