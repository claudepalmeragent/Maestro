/**
 * Context Summarization Service
 *
 * Manages the summarization process for compacting conversation contexts.
 * The summarization process:
 * 1. Extracts full context from the source tab
 * 2. Creates a temporary AI session for summarization
 * 3. Sends the context with a summarization prompt
 * 4. Receives the compacted summary
 * 5. Creates a new tab with the summarized context
 * 6. Cleans up the temporary session
 *
 * This service abstracts the complexity of managing temporary sessions
 * and provides progress callbacks for UI updates during the operation.
 */

import type { ToolType } from '../../shared/types';
import type { SummarizeRequest, SummarizeProgress } from '../types/contextMerge';
import type { LogEntry } from '../types';
import { formatLogsForGrooming, parseGroomedOutput, estimateTextTokenCount } from '../utils/contextExtractor';
import { contextSummarizePrompt } from '../../prompts';

/**
 * Configuration options for the summarization service.
 */
export interface SummarizationConfig {
  /** Maximum time to wait for summarization response (ms) */
  timeoutMs?: number;
  /** Default agent type for summarization session */
  defaultAgentType?: ToolType;
  /** Minimum context usage percentage to allow summarization (0-100) */
  minContextUsagePercent?: number;
}

/**
 * Default configuration for summarization operations.
 */
const DEFAULT_CONFIG: Required<SummarizationConfig> = {
  timeoutMs: 120000, // 2 minutes
  defaultAgentType: 'claude-code',
  minContextUsagePercent: 25, // Don't allow summarization under 25% context usage
};

/**
 * Maximum tokens to summarize in a single pass.
 * Larger contexts may need chunked summarization.
 */
const MAX_SUMMARIZE_TOKENS = 50000;

/**
 * Service for summarizing and compacting conversation contexts.
 *
 * @example
 * const summarizer = new ContextSummarizationService();
 * const result = await summarizer.summarizeAndContinue(
 *   request,
 *   (progress) => updateUI(progress)
 * );
 */
export class ContextSummarizationService {
  private config: Required<SummarizationConfig>;

  constructor(config: SummarizationConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Summarize a tab's context and prepare it for a new compacted tab.
   *
   * This method orchestrates the entire summarization process:
   * 1. Extracts full context from the source tab
   * 2. Creates a temporary summarization session
   * 3. Sends the context with summarization instructions
   * 4. Returns the summarized content and token statistics
   *
   * @param request - The summarization request containing source tab info
   * @param sourceLogs - The logs from the source tab
   * @param onProgress - Callback for progress updates during the summarization process
   * @returns Promise resolving to the summarization result
   */
  async summarizeContext(
    request: SummarizeRequest,
    sourceLogs: LogEntry[],
    onProgress: (progress: SummarizeProgress) => void
  ): Promise<{ summarizedLogs: LogEntry[]; originalTokens: number; compactedTokens: number } | null> {
    // Initial progress update
    onProgress({
      stage: 'extracting',
      progress: 0,
      message: 'Extracting context...',
    });

    try {
      // Stage 1: Extract and format context
      const formattedContext = formatLogsForGrooming(sourceLogs);
      const originalTokens = estimateTextTokenCount(formattedContext);

      onProgress({
        stage: 'extracting',
        progress: 20,
        message: `Extracted ~${originalTokens.toLocaleString()} tokens`,
      });

      // Check if context is too large and needs chunking
      if (originalTokens > MAX_SUMMARIZE_TOKENS) {
        onProgress({
          stage: 'summarizing',
          progress: 25,
          message: 'Large context detected, using chunked summarization...',
        });
        // For very large contexts, chunk and summarize in parts
        return await this.summarizeInChunks(
          request,
          sourceLogs,
          originalTokens,
          onProgress
        );
      }

      // Stage 2: Send to AI for summarization using the single-call groomContext API
      onProgress({
        stage: 'summarizing',
        progress: 30,
        message: 'Sending context for compaction...',
      });

      const prompt = this.buildSummarizationPrompt(formattedContext);
      console.log('[ContextSummarizer] Calling groomContext API, prompt length:', prompt.length);

      const summarizedText = await window.maestro.context.groomContext(
        request.projectRoot,
        this.config.defaultAgentType,
        prompt
      );
      console.log('[ContextSummarizer] Received response, length:', summarizedText?.length || 0);

      onProgress({
        stage: 'summarizing',
        progress: 75,
        message: 'Processing summarized output...',
      });

      // Stage 3: Parse the summarized output
      const summarizedLogs = parseGroomedOutput(summarizedText);
      const compactedTokens = estimateTextTokenCount(summarizedText);

      onProgress({
        stage: 'creating',
        progress: 90,
        message: 'Finalizing compacted context...',
      });

      return {
        summarizedLogs,
        originalTokens,
        compactedTokens,
      };
    } catch {
      // The groomContext API handles its own cleanup - rethrow
      throw new Error('Context summarization failed');
    }
  }

  /**
   * Summarize large contexts by breaking them into chunks.
   */
  private async summarizeInChunks(
    request: SummarizeRequest,
    sourceLogs: LogEntry[],
    _originalTokens: number,
    onProgress: (progress: SummarizeProgress) => void
  ): Promise<{ summarizedLogs: LogEntry[]; originalTokens: number; compactedTokens: number }> {
    // Split logs into chunks that fit within token limits
    const chunks = this.chunkLogs(sourceLogs, MAX_SUMMARIZE_TOKENS);
    const chunkSummaries: string[] = [];
    let totalOriginalTokens = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkText = formatLogsForGrooming(chunk);
      totalOriginalTokens += estimateTextTokenCount(chunkText);

      onProgress({
        stage: 'summarizing',
        progress: 30 + Math.round((i / chunks.length) * 40),
        message: `Summarizing chunk ${i + 1}/${chunks.length}...`,
      });

      const prompt = this.buildSummarizationPrompt(chunkText);
      // Use the new single-call groomContext API (spawns batch process with prompt)
      const summary = await window.maestro.context.groomContext(
        request.projectRoot,
        this.config.defaultAgentType,
        prompt
      );
      chunkSummaries.push(summary);
    }

    // Combine chunk summaries
    const combinedSummary = chunkSummaries.join('\n\n---\n\n');
    const summarizedLogs = parseGroomedOutput(combinedSummary);
    const compactedTokens = estimateTextTokenCount(combinedSummary);

    return {
      summarizedLogs,
      originalTokens: totalOriginalTokens,
      compactedTokens,
    };
  }

  /**
   * Split logs into chunks that fit within token limits.
   */
  private chunkLogs(logs: LogEntry[], maxTokensPerChunk: number): LogEntry[][] {
    const chunks: LogEntry[][] = [];
    let currentChunk: LogEntry[] = [];
    let currentTokens = 0;

    for (const log of logs) {
      const logTokens = estimateTextTokenCount(log.text);

      if (currentTokens + logTokens > maxTokensPerChunk && currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentTokens = 0;
      }

      currentChunk.push(log);
      currentTokens += logTokens;
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  /**
   * Build the complete summarization prompt with system instructions and context.
   *
   * @param formattedContext - The formatted context string
   * @returns Complete prompt to send to the summarization agent
   */
  private buildSummarizationPrompt(formattedContext: string): string {
    return `${contextSummarizePrompt}

${formattedContext}

---

Please provide a comprehensive but compacted summary of the above conversation, following the output format specified. Preserve all technical details, code snippets, and decisions while removing redundant content.`;
  }

  /**
   * Format a compacted tab name from the original name.
   *
   * @param originalName - The original tab name
   * @returns The new tab name with "Compacted YYYY-MM-DD" suffix
   */
  formatCompactedTabName(originalName: string | null): string {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const baseName = originalName || 'Session';
    return `${baseName} Compacted ${date}`;
  }

  /**
   * Check if a session has enough context to warrant summarization.
   * Summarization is only worthwhile when context usage is above the minimum threshold.
   *
   * @param contextUsage - The current context usage percentage (0-100)
   * @returns True if context usage is high enough for summarization
   */
  canSummarize(contextUsage: number): boolean {
    return contextUsage >= this.config.minContextUsagePercent;
  }

  /**
   * Get the minimum context usage percentage required for summarization.
   */
  getMinContextUsagePercent(): number {
    return this.config.minContextUsagePercent;
  }

  /**
   * Cancel any active summarization operation.
   * Note: With the groomContext API, cancellation is handled by the caller.
   * This method is kept for API compatibility but is a no-op.
   */
  async cancelSummarization(): Promise<void> {
    // groomContext handles its own lifecycle - cancellation happens via the caller's
    // cancel token or by not awaiting the promise
  }

  /**
   * Check if a summarization operation is currently in progress.
   * Note: With the groomContext API, the caller tracks active state.
   * This method is kept for API compatibility but always returns false.
   */
  isSummarizationActive(): boolean {
    // State tracking is now done by the caller (useSummarizeAndContinue hook)
    return false;
  }
}

/**
 * Default singleton instance of the summarization service.
 * Use this for most cases unless you need custom configuration.
 */
export const contextSummarizationService = new ContextSummarizationService();
