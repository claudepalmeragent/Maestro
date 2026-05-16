import { EventEmitter } from 'events';
import { logger } from '../../utils/logger';
import { DATA_BUFFER_FLUSH_INTERVAL, DATA_BUFFER_SIZE_THRESHOLD } from '../constants';
import { FALLBACK_CONTEXT_WINDOW } from '../../../shared/agentConstants';
import type { ManagedProcess } from '../types';
import type { ParsedEvent } from '../../parsers/agent-output-parser';

/**
 * Manages data buffering for process output to reduce IPC event frequency.
 */
export class DataBufferManager {
	constructor(
		private processes: Map<string, ManagedProcess>,
		private emitter: EventEmitter
	) {}

	/**
	 * Buffer data and emit in batches.
	 * Data is accumulated and flushed every 50ms or when buffer exceeds 8KB.
	 */
	emitDataBuffered(sessionId: string, data: string): void {
		const managedProcess = this.processes.get(sessionId);
		if (!managedProcess) {
			this.emitter.emit('data', sessionId, data);
			return;
		}

		managedProcess.dataBuffer = (managedProcess.dataBuffer || '') + data;

		if (managedProcess.dataBuffer.length > DATA_BUFFER_SIZE_THRESHOLD) {
			this.flushDataBuffer(sessionId);
			return;
		}

		if (!managedProcess.dataBufferTimeout) {
			managedProcess.dataBufferTimeout = setTimeout(() => {
				this.flushDataBuffer(sessionId);
			}, DATA_BUFFER_FLUSH_INTERVAL);
		}
	}

	/**
	 * Route a fully-parsed ParsedEvent from an external runner (e.g. ClaudePtyRunner) through
	 * the same downstream channels that the legacy StdoutHandler parse-emit chain uses.
	 *
	 * This is the single seam where the PTY runner's 'event' output plugs into the existing
	 * ProcessManager EventEmitter so all process-listeners (data, usage, session-id, etc.)
	 * receive identical signals regardless of whether a legacy --print process or a PTY runner
	 * produced the event.
	 */
	emitParsedEventBuffered(sessionId: string, event: ParsedEvent): void {
		// Usage stats — map ParsedEvent.usage to the UsageStats shape the 'usage' listener expects.
		if (event.type === 'usage' && event.usage) {
			const usageStats = {
				inputTokens: event.usage.inputTokens,
				outputTokens: event.usage.outputTokens,
				cacheReadInputTokens: event.usage.cacheReadTokens ?? 0,
				cacheCreationInputTokens: event.usage.cacheCreationTokens ?? 0,
				totalCostUsd: event.usage.costUsd ?? 0,
				contextWindow: event.usage.contextWindow ?? FALLBACK_CONTEXT_WINDOW,
				reasoningTokens: event.usage.reasoningTokens,
				detectedModel: event.detectedModel,
				anthropicMessageId: event.anthropicMessageId,
			};
			this.emitter.emit('usage', sessionId, usageStats);
			return;
		}

		// Session ID from init message.
		if (event.type === 'init' && event.sessionId) {
			this.emitter.emit('session-id', sessionId, event.sessionId);
		}

		// Slash commands from init message.
		if (event.type === 'init' && event.slashCommands) {
			this.emitter.emit('slash-commands', sessionId, event.slashCommands);
		}

		// Partial text → thinking-chunk stream.
		if (event.type === 'text' && event.isPartial && event.text) {
			this.emitter.emit('thinking-chunk', sessionId, event.text);
			return;
		}

		// Tool use events.
		if (event.type === 'tool_use' && event.toolName) {
			this.emitter.emit('tool-execution', sessionId, {
				toolName: event.toolName,
				state: event.toolState,
				timestamp: Date.now(),
			});
		}

		// Tool use blocks embedded in text events.
		if (event.toolUseBlocks?.length) {
			for (const tool of event.toolUseBlocks) {
				this.emitter.emit('tool-execution', sessionId, {
					toolName: tool.name,
					state: { status: 'running', input: tool.input },
					timestamp: Date.now(),
				});
			}
		}

		// Task tool invocation (subagent detection for Auto Run progress).
		if (event.taskToolInvocation) {
			this.emitter.emit('task-tool-invocation', sessionId, {
				subagentType: event.taskToolInvocation.subagentType,
				taskDescription: event.taskToolInvocation.taskDescription,
				toolId: event.taskToolInvocation.toolId,
				timestamp: Date.now(),
			});
		}

		// Final result text — emit via the buffered data path so it reaches the renderer as
		// a 'process:data' IPC message, identical to the legacy --print path.
		if ((event.type === 'result' || (event.type === 'text' && !event.isPartial)) && event.text) {
			this.emitter.emit('subagent-clear', sessionId);
			this.emitDataBuffered(sessionId, event.text);
		}
	}

	/**
	 * Flush the data buffer for a session
	 */
	flushDataBuffer(sessionId: string): void {
		const managedProcess = this.processes.get(sessionId);
		if (!managedProcess) return;

		if (managedProcess.dataBufferTimeout) {
			clearTimeout(managedProcess.dataBufferTimeout);
			managedProcess.dataBufferTimeout = undefined;
		}

		if (managedProcess.dataBuffer) {
			try {
				this.emitter.emit('data', sessionId, managedProcess.dataBuffer);
			} catch (err) {
				logger.error('[ProcessManager] Error flushing data buffer', 'ProcessManager', {
					sessionId,
					error: String(err),
				});
			}
			managedProcess.dataBuffer = undefined;
		}
	}
}
