import { useState, useCallback, useRef, useEffect } from 'react';
import type { BatchRunState, BatchRunConfig, BatchDocumentEntry, Session, HistoryEntry, UsageStats } from '../types';

// Regex to count unchecked markdown checkboxes: - [ ] task
const UNCHECKED_TASK_REGEX = /^[\s]*-\s*\[\s*\]\s*.+$/gm;

// Regex to match checked markdown checkboxes for reset-on-completion
const CHECKED_TASK_REGEX = /^(\s*-\s*)\[x\]/gim;

// Default empty batch state
const DEFAULT_BATCH_STATE: BatchRunState = {
  isRunning: false,
  isStopping: false,
  // Multi-document progress (new fields)
  documents: [],
  currentDocumentIndex: 0,
  currentDocTasksTotal: 0,
  currentDocTasksCompleted: 0,
  totalTasksAcrossAllDocs: 0,
  completedTasksAcrossAllDocs: 0,
  // Loop mode
  loopEnabled: false,
  loopIteration: 0,
  // Folder path for file operations
  folderPath: '',
  // Legacy fields (kept for backwards compatibility)
  totalTasks: 0,
  completedTasks: 0,
  currentTaskIndex: 0,
  originalContent: '',
  sessionIds: []
};

interface BatchCompleteInfo {
  sessionId: string;
  sessionName: string;
  completedTasks: number;
  totalTasks: number;
  wasStopped: boolean;
  elapsedTimeMs: number;
}

interface UseBatchProcessorProps {
  sessions: Session[];
  onUpdateSession: (sessionId: string, updates: Partial<Session>) => void;
  onSpawnAgent: (sessionId: string, prompt: string) => Promise<{ success: boolean; response?: string; claudeSessionId?: string; usageStats?: UsageStats }>;
  onSpawnSynopsis: (sessionId: string, cwd: string, claudeSessionId: string, prompt: string) => Promise<{ success: boolean; response?: string }>;
  onAddHistoryEntry: (entry: Omit<HistoryEntry, 'id'>) => void;
  onComplete?: (info: BatchCompleteInfo) => void;
  // TTS settings for speaking synopsis after each task
  audioFeedbackEnabled?: boolean;
  audioFeedbackCommand?: string;
}

interface UseBatchProcessorReturn {
  // Map of session ID to batch state
  batchRunStates: Record<string, BatchRunState>;
  // Get batch state for a specific session
  getBatchState: (sessionId: string) => BatchRunState;
  // Check if any session has an active batch
  hasAnyActiveBatch: boolean;
  // Get list of session IDs with active batches
  activeBatchSessionIds: string[];
  // Start batch run for a specific session with multi-document support
  startBatchRun: (sessionId: string, config: BatchRunConfig, folderPath: string) => Promise<void>;
  // Stop batch run for a specific session
  stopBatchRun: (sessionId: string) => void;
  // Custom prompts per session
  customPrompts: Record<string, string>;
  setCustomPrompt: (sessionId: string, prompt: string) => void;
}

/**
 * Count unchecked tasks in markdown content
 * Matches lines like: - [ ] task description
 */
export function countUnfinishedTasks(content: string): number {
  const matches = content.match(UNCHECKED_TASK_REGEX);
  return matches ? matches.length : 0;
}

/**
 * Uncheck all markdown checkboxes in content (for reset-on-completion)
 * Converts all - [x] to - [ ] (case insensitive)
 */
export function uncheckAllTasks(content: string): string {
  return content.replace(CHECKED_TASK_REGEX, '$1[ ]');
}

/**
 * Hook for managing batch processing of scratchpad tasks across multiple sessions
 */
// Synopsis prompt for batch tasks - requests a two-part response
const BATCH_SYNOPSIS_PROMPT = `Provide a brief synopsis of what you just accomplished in this task using this exact format:

**Summary:** [1-2 sentences describing the key outcome]

**Details:** [A paragraph with more specifics about what was done, files changed, etc.]

Rules:
- Be specific about what was actually accomplished, not what was attempted.
- Focus only on meaningful work that was done. Omit filler phrases like "the task is complete", "no further action needed", "everything is working", etc.
- If nothing meaningful was accomplished, respond with only: **Summary:** No changes made.`;

/**
 * Parse a synopsis response into short summary and full synopsis
 * Expected format:
 *   **Summary:** Short 1-2 sentence summary
 *   **Details:** Detailed paragraph...
 */
function parseSynopsis(response: string): { shortSummary: string; fullSynopsis: string } {
  // Clean up ANSI codes and box drawing characters
  const clean = response
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/─+/g, '')
    .replace(/[│┌┐└┘├┤┬┴┼]/g, '')
    .trim();

  // Try to extract Summary and Details sections
  const summaryMatch = clean.match(/\*\*Summary:\*\*\s*(.+?)(?=\*\*Details:\*\*|$)/is);
  const detailsMatch = clean.match(/\*\*Details:\*\*\s*(.+?)$/is);

  const shortSummary = summaryMatch?.[1]?.trim() || clean.split('\n')[0]?.trim() || 'Task completed';
  const details = detailsMatch?.[1]?.trim() || '';

  // Full synopsis includes both parts
  const fullSynopsis = details ? `${shortSummary}\n\n${details}` : shortSummary;

  return { shortSummary, fullSynopsis };
}

export function useBatchProcessor({
  sessions,
  onUpdateSession,
  onSpawnAgent,
  onSpawnSynopsis,
  onAddHistoryEntry,
  onComplete,
  audioFeedbackEnabled,
  audioFeedbackCommand
}: UseBatchProcessorProps): UseBatchProcessorReturn {
  // Batch states per session
  const [batchRunStates, setBatchRunStates] = useState<Record<string, BatchRunState>>({});

  // Custom prompts per session
  const [customPrompts, setCustomPrompts] = useState<Record<string, string>>({});

  // Refs for tracking stop requests per session
  const stopRequestedRefs = useRef<Record<string, boolean>>({});

  // Helper to get batch state for a session
  const getBatchState = useCallback((sessionId: string): BatchRunState => {
    return batchRunStates[sessionId] || DEFAULT_BATCH_STATE;
  }, [batchRunStates]);

  // Check if any session has an active batch
  const hasAnyActiveBatch = Object.values(batchRunStates).some(state => state.isRunning);

  // Get list of session IDs with active batches
  const activeBatchSessionIds = Object.entries(batchRunStates)
    .filter(([_, state]) => state.isRunning)
    .map(([sessionId]) => sessionId);

  // Set custom prompt for a session
  const setCustomPrompt = useCallback((sessionId: string, prompt: string) => {
    setCustomPrompts(prev => ({ ...prev, [sessionId]: prompt }));
  }, []);

  // Broadcast batch run state changes to web interface
  useEffect(() => {
    // Broadcast state for each session that has batch state
    Object.entries(batchRunStates).forEach(([sessionId, state]) => {
      if (state.isRunning || state.completedTasks > 0) {
        window.maestro.web.broadcastAutoRunState(sessionId, {
          isRunning: state.isRunning,
          totalTasks: state.totalTasks,
          completedTasks: state.completedTasks,
          currentTaskIndex: state.currentTaskIndex,
          isStopping: state.isStopping,
        });
      } else {
        // When not running and no completed tasks, broadcast null to clear the state
        window.maestro.web.broadcastAutoRunState(sessionId, null);
      }
    });
  }, [batchRunStates]);

  /**
   * Helper function to read a document and count its tasks
   */
  const readDocAndCountTasks = async (folderPath: string, filename: string): Promise<{ content: string; taskCount: number }> => {
    const result = await window.maestro.autorun.readDoc(folderPath, filename + '.md');
    if (!result.success || !result.content) {
      return { content: '', taskCount: 0 };
    }
    return { content: result.content, taskCount: countUnfinishedTasks(result.content) };
  };

  /**
   * Start a batch processing run for a specific session with multi-document support
   */
  const startBatchRun = useCallback(async (sessionId: string, config: BatchRunConfig, folderPath: string) => {
    const session = sessions.find(s => s.id === sessionId);
    if (!session) {
      console.error('Session not found for batch processing:', sessionId);
      return;
    }

    const { documents, prompt, loopEnabled } = config;

    if (documents.length === 0) {
      console.warn('No documents provided for batch processing:', sessionId);
      return;
    }

    // Track batch start time for completion notification
    const batchStartTime = Date.now();

    // Reset stop flag for this session
    stopRequestedRefs.current[sessionId] = false;

    // Calculate initial total tasks across all documents
    let initialTotalTasks = 0;
    for (const doc of documents) {
      const { taskCount } = await readDocAndCountTasks(folderPath, doc.filename);
      initialTotalTasks += taskCount;
    }

    if (initialTotalTasks === 0) {
      console.warn('No unchecked tasks found across all documents for session:', sessionId);
      return;
    }

    // Initialize batch run state
    setBatchRunStates(prev => ({
      ...prev,
      [sessionId]: {
        isRunning: true,
        isStopping: false,
        // Multi-document progress
        documents: documents.map(d => d.filename),
        currentDocumentIndex: 0,
        currentDocTasksTotal: 0,
        currentDocTasksCompleted: 0,
        totalTasksAcrossAllDocs: initialTotalTasks,
        completedTasksAcrossAllDocs: 0,
        // Loop mode
        loopEnabled,
        loopIteration: 0,
        // Folder path for file operations
        folderPath,
        // Legacy fields (for backwards compatibility)
        totalTasks: initialTotalTasks,
        completedTasks: 0,
        currentTaskIndex: 0,
        originalContent: '',
        customPrompt: prompt !== '' ? prompt : undefined,
        sessionIds: [],
        startTime: batchStartTime
      }
    }));

    // Store custom prompt for persistence
    setCustomPrompts(prev => ({ ...prev, [sessionId]: prompt }));

    // Collect Claude session IDs and track completion
    const claudeSessionIds: string[] = [];
    let totalCompletedTasks = 0;
    let loopIteration = 0;

    // Main processing loop (handles loop mode)
    while (true) {
      // Check for stop request
      if (stopRequestedRefs.current[sessionId]) {
        console.log('[BatchProcessor] Batch run stopped by user for session:', sessionId);
        break;
      }

      // Track if any tasks were processed in this iteration
      let anyTasksProcessedThisIteration = false;

      // Process each document in order
      for (let docIndex = 0; docIndex < documents.length; docIndex++) {
        // Check for stop request before each document
        if (stopRequestedRefs.current[sessionId]) {
          console.log('[BatchProcessor] Batch run stopped by user at document', docIndex, 'for session:', sessionId);
          break;
        }

        const docEntry = documents[docIndex];
        const docFilePath = `${folderPath}/${docEntry.filename}.md`;

        // Read document and count tasks
        let { content, taskCount: remainingTasks } = await readDocAndCountTasks(folderPath, docEntry.filename);

        // Skip documents with no tasks
        if (remainingTasks === 0) {
          console.log(`[BatchProcessor] Skipping document ${docEntry.filename} - no unchecked tasks`);
          continue;
        }

        console.log(`[BatchProcessor] Processing document ${docEntry.filename} with ${remainingTasks} tasks`);

        // Update state to show current document
        setBatchRunStates(prev => ({
          ...prev,
          [sessionId]: {
            ...prev[sessionId],
            currentDocumentIndex: docIndex,
            currentDocTasksTotal: remainingTasks,
            currentDocTasksCompleted: 0
          }
        }));

        let docTasksCompleted = 0;

        // Process tasks in this document until none remain
        while (remainingTasks > 0) {
          // Check for stop request before each task
          if (stopRequestedRefs.current[sessionId]) {
            console.log('[BatchProcessor] Batch run stopped by user during document', docEntry.filename);
            break;
          }

          // Replace $$SCRATCHPAD$$ placeholder with actual document path
          const finalPrompt = prompt.replace(/\$\$SCRATCHPAD\$\$/g, docFilePath);

          try {
            // Capture start time for elapsed time tracking
            const taskStartTime = Date.now();

            // Spawn agent with the prompt
            const result = await onSpawnAgent(sessionId, finalPrompt);

            // Capture elapsed time
            const elapsedTimeMs = Date.now() - taskStartTime;

            if (result.claudeSessionId) {
              claudeSessionIds.push(result.claudeSessionId);
              // Register as auto-initiated Maestro session
              window.maestro.claude.registerSessionOrigin(session.cwd, result.claudeSessionId, 'auto')
                .catch(err => console.error('[BatchProcessor] Failed to register session origin:', err));
            }

            anyTasksProcessedThisIteration = true;

            // Re-read document to get updated task count
            const { content: updatedContent, taskCount: newRemainingTasks } = await readDocAndCountTasks(folderPath, docEntry.filename);
            content = updatedContent;
            const tasksCompletedThisRun = remainingTasks - newRemainingTasks;

            // Update counters
            docTasksCompleted += tasksCompletedThisRun;
            totalCompletedTasks += tasksCompletedThisRun;

            // Update progress state
            setBatchRunStates(prev => ({
              ...prev,
              [sessionId]: {
                ...prev[sessionId],
                currentDocTasksCompleted: docTasksCompleted,
                completedTasksAcrossAllDocs: totalCompletedTasks,
                // Legacy fields
                completedTasks: totalCompletedTasks,
                currentTaskIndex: totalCompletedTasks,
                sessionIds: [...(prev[sessionId]?.sessionIds || []), result.claudeSessionId || '']
              }
            }));

            // Generate synopsis for successful tasks with a Claude session
            let shortSummary = `[${docEntry.filename}] Task completed`;
            let fullSynopsis = shortSummary;

            if (result.success && result.claudeSessionId) {
              // Request a synopsis from the agent by resuming the session
              try {
                const synopsisResult = await onSpawnSynopsis(
                  sessionId,
                  session.cwd,
                  result.claudeSessionId,
                  BATCH_SYNOPSIS_PROMPT
                );

                if (synopsisResult.success && synopsisResult.response) {
                  const parsed = parseSynopsis(synopsisResult.response);
                  shortSummary = parsed.shortSummary;
                  fullSynopsis = parsed.fullSynopsis;
                }
              } catch (err) {
                console.error('[BatchProcessor] Synopsis generation failed:', err);
              }
            } else if (!result.success) {
              shortSummary = `[${docEntry.filename}] Task failed`;
              fullSynopsis = shortSummary;
            }

            // Add history entry
            onAddHistoryEntry({
              type: 'AUTO',
              timestamp: Date.now(),
              summary: shortSummary,
              fullResponse: fullSynopsis,
              claudeSessionId: result.claudeSessionId,
              projectPath: session.cwd,
              sessionId: sessionId,
              success: result.success,
              usageStats: result.usageStats,
              elapsedTimeMs
            });

            // Speak the synopsis via TTS if audio feedback is enabled
            if (audioFeedbackEnabled && audioFeedbackCommand && shortSummary) {
              window.maestro.notification.speak(shortSummary, audioFeedbackCommand).catch(err => {
                console.error('[BatchProcessor] Failed to speak synopsis:', err);
              });
            }

            remainingTasks = newRemainingTasks;
            console.log(`[BatchProcessor] Document ${docEntry.filename}: ${remainingTasks} tasks remaining`);

          } catch (error) {
            console.error(`[BatchProcessor] Error running task in ${docEntry.filename} for session ${sessionId}:`, error);
            // Continue to next task on error
            remainingTasks--;
          }
        }

        // Check for stop before doing reset
        if (stopRequestedRefs.current[sessionId]) {
          break;
        }

        // Document complete - handle reset-on-completion if enabled
        if (docEntry.resetOnCompletion && docTasksCompleted > 0) {
          console.log(`[BatchProcessor] Resetting document ${docEntry.filename} (reset-on-completion enabled)`);

          // Read the current content and uncheck all tasks
          const { content: currentContent } = await readDocAndCountTasks(folderPath, docEntry.filename);
          const resetContent = uncheckAllTasks(currentContent);

          // Write the reset content back
          await window.maestro.autorun.writeDoc(folderPath, docEntry.filename + '.md', resetContent);

          // If loop is enabled, add the reset tasks back to the total
          if (loopEnabled) {
            const resetTaskCount = countUnfinishedTasks(resetContent);
            setBatchRunStates(prev => ({
              ...prev,
              [sessionId]: {
                ...prev[sessionId],
                totalTasksAcrossAllDocs: prev[sessionId].totalTasksAcrossAllDocs + resetTaskCount,
                totalTasks: prev[sessionId].totalTasks + resetTaskCount
              }
            }));
          }
        }
      }

      // Check if we should continue looping
      if (!loopEnabled) {
        // No loop mode - we're done after one pass
        break;
      }

      // Check for stop request after full pass
      if (stopRequestedRefs.current[sessionId]) {
        break;
      }

      // Loop mode: check if any documents have tasks remaining
      let anyDocsHaveTasks = false;
      for (const doc of documents) {
        const { taskCount } = await readDocAndCountTasks(folderPath, doc.filename);
        if (taskCount > 0) {
          anyDocsHaveTasks = true;
          break;
        }
      }

      if (!anyDocsHaveTasks) {
        console.log('[BatchProcessor] All documents completed, exiting loop');
        break;
      }

      // If we didn't process any tasks this iteration but docs still have tasks,
      // something is wrong - exit to avoid infinite loop
      if (!anyTasksProcessedThisIteration) {
        console.warn('[BatchProcessor] No tasks processed but documents still have tasks - exiting to avoid infinite loop');
        break;
      }

      // Continue looping
      loopIteration++;
      console.log(`[BatchProcessor] Starting loop iteration ${loopIteration + 1}`);
      setBatchRunStates(prev => ({
        ...prev,
        [sessionId]: {
          ...prev[sessionId],
          loopIteration
        }
      }));
    }

    // Reset state for this session
    setBatchRunStates(prev => ({
      ...prev,
      [sessionId]: {
        isRunning: false,
        isStopping: false,
        documents: [],
        currentDocumentIndex: 0,
        currentDocTasksTotal: 0,
        currentDocTasksCompleted: 0,
        totalTasksAcrossAllDocs: 0,
        completedTasksAcrossAllDocs: 0,
        loopEnabled: false,
        loopIteration: 0,
        folderPath: '',
        totalTasks: 0,
        completedTasks: 0,
        currentTaskIndex: 0,
        originalContent: '',
        sessionIds: claudeSessionIds
      }
    }));

    // Call completion callback if provided
    if (onComplete) {
      const wasStopped = stopRequestedRefs.current[sessionId] || false;
      onComplete({
        sessionId,
        sessionName: session.name || session.cwd.split('/').pop() || 'Unknown',
        completedTasks: totalCompletedTasks,
        totalTasks: initialTotalTasks,
        wasStopped,
        elapsedTimeMs: Date.now() - batchStartTime
      });
    }
  }, [sessions, onUpdateSession, onSpawnAgent, onSpawnSynopsis, onAddHistoryEntry, onComplete, audioFeedbackEnabled, audioFeedbackCommand]);

  /**
   * Request to stop the batch run for a specific session after current task completes
   */
  const stopBatchRun = useCallback((sessionId: string) => {
    stopRequestedRefs.current[sessionId] = true;
    setBatchRunStates(prev => ({
      ...prev,
      [sessionId]: {
        ...prev[sessionId],
        isStopping: true
      }
    }));
  }, []);

  return {
    batchRunStates,
    getBatchState,
    hasAnyActiveBatch,
    activeBatchSessionIds,
    startBatchRun,
    stopBatchRun,
    customPrompts,
    setCustomPrompt
  };
}
