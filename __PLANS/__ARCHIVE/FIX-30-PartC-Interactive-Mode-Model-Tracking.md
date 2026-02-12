# FIX-30 Part C: Interactive Mode Model/Cost Tracking

## Problem Statement

Interactive mode (renderer) conversations are recording query events with NULL values for:
- `anthropic_model`
- `anthropic_message_id`
- `anthropic_cost_usd`
- `maestro_cost_usd`
- `maestro_billing_mode`
- `maestro_pricing_model`
- `maestro_calculated_at`

## Root Cause

The `UsageStats` type that flows from main process to renderer does NOT include `detectedModel` or `anthropicMessageId`. These fields are captured in `lastUsageTotals` but never sent to the renderer via the `usage` event.

When the renderer calls `recordQuery()`, it doesn't have access to the model information, so all model/cost fields are NULL.

## Data Flow (Current - Broken)

```
1. Parser extracts detectedModel from Claude response ✓
2. StdoutHandler stores in lastUsageTotals.detectedModel ✓
3. StdoutHandler emits 'usage' event with UsageStats (NO model) ✗
4. usage-listener forwards to renderer via IPC (NO model) ✗
5. Renderer stores usageStats without model ✗
6. On exit, renderer calls recordQuery() without model ✗
7. INSERT has NULL for anthropic_model ✗
```

## Data Flow (Fixed)

```
1. Parser extracts detectedModel from Claude response ✓
2. StdoutHandler stores in lastUsageTotals ✓
3. StdoutHandler emits 'usage' event with detectedModel/anthropicMessageId ✓
4. usage-listener forwards to renderer via IPC (WITH model) ✓
5. Renderer stores usageStats WITH model ✓
6. On exit, renderer calls recordQuery() WITH model ✓
7. IPC handler calculates dual costs and INSERTs complete record ✓
```

## Files to Modify

### 1. Add fields to UsageStats interface (6 files)

Add these two optional fields to each `UsageStats` interface:

```typescript
/** Detected model ID from Claude response (e.g., 'claude-opus-4-5-20251101') */
detectedModel?: string;
/** Anthropic's message ID from the API response */
anthropicMessageId?: string;
```

Files:
- `/app/Maestro/src/shared/types.ts:82-95` - Add after `reasoningTokens`
- `/app/Maestro/src/main/process-manager/types.ts:84-92` - Add after `reasoningTokens`
- `/app/Maestro/src/main/parsers/usage-aggregator.ts:25-38` - Add after `reasoningTokens`
- `/app/Maestro/src/main/preload/process.ts:86-94` - Add after `reasoningTokens`
- `/app/Maestro/src/renderer/global.d.ts:125-133` - Add after `reasoningTokens`
- `/app/Maestro/src/web/hooks/useWebSocket.ts:29-37` - Add after `reasoningTokens`

### 2. Update buildUsageStats to include model fields

File: `/app/Maestro/src/main/process-manager/handlers/StdoutHandler.ts`

Current `buildUsageStats` method (lines 447-468):
```typescript
private buildUsageStats(
    managedProcess: ManagedProcess,
    usage: {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens?: number;
        cacheCreationTokens?: number;
        costUsd?: number;
        contextWindow?: number;
        reasoningTokens?: number;
    }
): UsageStats {
    return {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadInputTokens: usage.cacheReadTokens || 0,
        cacheCreationInputTokens: usage.cacheCreationTokens || 0,
        totalCostUsd: usage.costUsd || 0,
        contextWindow: managedProcess.contextWindow || usage.contextWindow || 0,
        reasoningTokens: usage.reasoningTokens,
    };
}
```

**Change to:**
```typescript
private buildUsageStats(
    managedProcess: ManagedProcess,
    usage: {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens?: number;
        cacheCreationTokens?: number;
        costUsd?: number;
        contextWindow?: number;
        reasoningTokens?: number;
    },
    detectedModel?: string,
    anthropicMessageId?: string
): UsageStats {
    return {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadInputTokens: usage.cacheReadTokens || 0,
        cacheCreationInputTokens: usage.cacheCreationTokens || 0,
        totalCostUsd: usage.costUsd || 0,
        contextWindow: managedProcess.contextWindow || usage.contextWindow || 0,
        reasoningTokens: usage.reasoningTokens,
        detectedModel,
        anthropicMessageId,
    };
}
```

### 3. Update buildUsageStats call site

File: `/app/Maestro/src/main/process-manager/handlers/StdoutHandler.ts`

Find line 261:
```typescript
const usageStats = this.buildUsageStats(managedProcess, usage);
```

**Change to:**
```typescript
// Get model from event or existing lastUsageTotals
const detectedModel = event.detectedModel || managedProcess.lastUsageTotals?.detectedModel;
const anthropicMessageId = event.anthropicMessageId || managedProcess.lastUsageTotals?.anthropicMessageId;
const usageStats = this.buildUsageStats(managedProcess, usage, detectedModel, anthropicMessageId);
```

### 4. Update toastData type to include model fields

File: `/app/Maestro/src/renderer/App.tsx`

Find the `toastData` type definition (around line 1924-1950). Add these fields after `totalCostUsd`:

```typescript
// Model tracking fields (v7)
detectedModel?: string;
anthropicMessageId?: string;
```

### 5. Update toastData population to include model fields

File: `/app/Maestro/src/renderer/App.tsx`

Find where `toastData` is populated (around line 2068-2097). After line 2096 (`totalCostUsd: tabUsageStats?.totalCostUsd,`), add:

```typescript
// Model tracking fields (v7)
detectedModel: tabUsageStats?.detectedModel,
anthropicMessageId: tabUsageStats?.anthropicMessageId,
```

### 6. Update recordQuery call to pass model fields

File: `/app/Maestro/src/renderer/App.tsx`

Find the `recordQuery` call (around line 2397-2415). After line 2414 (`totalCostUsd: toastData.totalCostUsd,`), add:

```typescript
// Model tracking fields - main process will calculate dual costs
detectedModel: toastData.detectedModel,
anthropicMessageId: toastData.anthropicMessageId,
```

### 7. Update IPC handler to calculate dual costs

File: `/app/Maestro/src/main/ipc/handlers/stats.ts`

The current handler (lines 81-101) passes the event directly to `insertQueryEvent`. Update it to calculate dual costs like `stats-listener.ts` does.

**Current code:**
```typescript
ipcMain.handle(
    'stats:record-query',
    withIpcErrorLogging(handlerOpts('recordQuery'), async (event: Omit<QueryEvent, 'id'>) => {
        if (!isStatsCollectionEnabled(settingsStore)) {
            logger.debug('Stats collection disabled, skipping query event', LOG_CONTEXT);
            return null;
        }

        const db = getStatsDB();
        const id = db.insertQueryEvent(event);
        // ...
    })
);
```

**Change to:**
```typescript
ipcMain.handle(
    'stats:record-query',
    withIpcErrorLogging(handlerOpts('recordQuery'), async (event: Omit<QueryEvent, 'id'>) => {
        if (!isStatsCollectionEnabled(settingsStore)) {
            logger.debug('Stats collection disabled, skipping query event', LOG_CONTEXT);
            return null;
        }

        // Calculate dual costs if we have a detected model
        const enrichedEvent = calculateAndEnrichEvent(event, logger);

        const db = getStatsDB();
        const id = db.insertQueryEvent(enrichedEvent);
        // ...
    })
);
```

Add a new helper function (can be in same file or imported from stats-listener):

```typescript
import { resolveBillingMode, calculateClaudeCostWithModel, isClaudeModelId } from '../utils/claude-pricing';

const CLAUDE_AGENT_TYPES = new Set(['claude-code', 'claude']);

function calculateAndEnrichEvent(
    event: Omit<QueryEvent, 'id'>,
    logger: typeof import('../utils/logger').logger
): Omit<QueryEvent, 'id'> {
    // If model fields are already populated, return as-is
    if (event.anthropicModel && event.maestroCostUsd !== undefined) {
        return event;
    }

    // Default values
    const anthropicCostUsd = event.totalCostUsd || 0;
    const anthropicModel = event.detectedModel || null;
    let maestroCostUsd = anthropicCostUsd;
    let maestroBillingMode: 'api' | 'max' | 'free' = 'api';
    let maestroPricingModel: string | null = anthropicModel;
    const maestroCalculatedAt = Date.now();

    // Calculate Maestro cost for Claude agents
    const isClaude = CLAUDE_AGENT_TYPES.has(event.agentType);
    if (isClaude && anthropicModel) {
        try {
            const agentId = event.agentId || event.sessionId;
            maestroBillingMode = resolveBillingMode(agentId);

            if (!isClaudeModelId(anthropicModel)) {
                maestroBillingMode = 'free';
                maestroCostUsd = 0;
            } else {
                const result = calculateClaudeCostWithModel(
                    anthropicModel,
                    event.inputTokens || 0,
                    event.outputTokens || 0,
                    event.cacheReadInputTokens || 0,
                    event.cacheCreationInputTokens || 0,
                    maestroBillingMode
                );
                maestroCostUsd = result.cost;
                maestroPricingModel = result.model;
            }
        } catch (err) {
            logger.warn('Failed to calculate Maestro cost, using Anthropic cost', LOG_CONTEXT, {
                error: String(err),
            });
        }
    }

    return {
        ...event,
        anthropicCostUsd,
        anthropicModel: anthropicModel || undefined,
        maestroCostUsd,
        maestroBillingMode,
        maestroPricingModel: maestroPricingModel || undefined,
        maestroCalculatedAt,
    };
}
```

### 8. Update useAgentExecution.ts recordQuery call (Auto Run path)

File: `/app/Maestro/src/renderer/hooks/agent/useAgentExecution.ts`

Find the `recordQuery` call (around line 261-279). Add model fields:

```typescript
// Model tracking fields - main process will calculate dual costs
detectedModel: taskUsageStats?.detectedModel,
anthropicMessageId: taskUsageStats?.anthropicMessageId,
```

## Import Statements

For `/app/Maestro/src/main/ipc/handlers/stats.ts`, ensure these imports exist:
```typescript
import { resolveBillingMode, calculateClaudeCostWithModel, isClaudeModelId } from '../../utils/claude-pricing';
```

## Testing

After implementation:
1. Build: `npm run build:main`
2. Copy to Mac and restart Maestro
3. Start an interactive conversation
4. Send a message and wait for response
5. Check database: `SELECT anthropic_model, maestro_billing_mode FROM query_events ORDER BY id DESC LIMIT 5`
6. All 6 fields should now be populated for new records

## Files Summary

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add `detectedModel`, `anthropicMessageId` to UsageStats |
| `src/main/process-manager/types.ts` | Add `detectedModel`, `anthropicMessageId` to UsageStats |
| `src/main/parsers/usage-aggregator.ts` | Add `detectedModel`, `anthropicMessageId` to UsageStats |
| `src/main/preload/process.ts` | Add `detectedModel`, `anthropicMessageId` to UsageStats |
| `src/renderer/global.d.ts` | Add `detectedModel`, `anthropicMessageId` to UsageStats |
| `src/web/hooks/useWebSocket.ts` | Add `detectedModel`, `anthropicMessageId` to UsageStats |
| `src/main/process-manager/handlers/StdoutHandler.ts` | Update `buildUsageStats` to include model fields |
| `src/renderer/App.tsx` | Update toastData type, population, and recordQuery call |
| `src/renderer/hooks/agent/useAgentExecution.ts` | Update recordQuery call |
| `src/main/ipc/handlers/stats.ts` | Add dual cost calculation |

---

## Regression Tests

The new optional fields must NOT break existing consumers. All existing tests must continue to pass, and new tests must verify the new functionality.

### Existing Test Files to Verify Still Pass

After making changes, run these test files to ensure no regressions:

```bash
npm test -- src/__tests__/main/process-manager/handlers/StdoutHandler.test.ts
npm test -- src/__tests__/main/parsers/usage-aggregator.test.ts
npm test -- src/__tests__/main/process-listeners/usage-listener.test.ts
npm test -- src/__tests__/main/process-listeners/stats-listener.test.ts
npm test -- src/__tests__/main/ipc/handlers/stats.test.ts
npm test -- src/__tests__/main/preload/stats.test.ts
npm test -- src/__tests__/main/stats/stats-db.test.ts
```

### New Tests to Add

#### 1. StdoutHandler.test.ts - Model field propagation

File: `/app/Maestro/src/__tests__/main/process-manager/handlers/StdoutHandler.test.ts`

Add new test case inside `describe('lastUsageTotals for non-Codex agents')`:

```typescript
it('should include detectedModel and anthropicMessageId in lastUsageTotals and emitted usage', () => {
    const sessionId = 'test-session-model';

    const mockParser: Partial<AgentOutputParser> = {
        agentId: 'claude-code',
        parseJsonLine: vi.fn().mockReturnValue({
            type: 'result',
            detectedModel: 'claude-opus-4-5-20251101',
            anthropicMessageId: 'msg_test123',
        } as ParsedEvent),
        extractUsage: vi.fn().mockReturnValue({
            inputTokens: 1000,
            outputTokens: 500,
            cacheReadTokens: 200,
            cacheCreationTokens: 100,
            costUsd: 0.05,
            contextWindow: 200000,
            reasoningTokens: 0,
        }),
        extractSessionId: vi.fn().mockReturnValue(null),
        extractSlashCommands: vi.fn().mockReturnValue(null),
        isResultMessage: vi.fn().mockReturnValue(true),
        detectErrorFromLine: vi.fn().mockReturnValue(null),
    };

    const managedProcess: ManagedProcess = {
        sessionId,
        toolType: 'claude-code',
        cwd: '/test',
        pid: 1234,
        isTerminal: false,
        isStreamJsonMode: true,
        jsonBuffer: '',
        startTime: Date.now(),
        outputParser: mockParser as AgentOutputParser,
    };
    processes.set(sessionId, managedProcess);

    const resultJson = JSON.stringify({ type: 'result' });
    stdoutHandler.handleData(sessionId, resultJson + '\n');

    // Verify lastUsageTotals includes model fields
    expect(managedProcess.lastUsageTotals).toBeDefined();
    expect(managedProcess.lastUsageTotals?.detectedModel).toBe('claude-opus-4-5-20251101');
    expect(managedProcess.lastUsageTotals?.anthropicMessageId).toBe('msg_test123');

    // Verify emitted usage includes model fields
    expect(emittedUsage).toBeDefined();
    expect(emittedUsage?.detectedModel).toBe('claude-opus-4-5-20251101');
    expect(emittedUsage?.anthropicMessageId).toBe('msg_test123');
});

it('should preserve detectedModel from earlier event when usage event lacks it', () => {
    const sessionId = 'test-session-preserve-model';

    // First event has model but no usage
    const mockParserFirstCall: Partial<AgentOutputParser> = {
        agentId: 'claude-code',
        parseJsonLine: vi.fn().mockReturnValue({
            type: 'text',
            detectedModel: 'claude-opus-4-5-20251101',
            anthropicMessageId: 'msg_early123',
        } as ParsedEvent),
        extractUsage: vi.fn().mockReturnValue(null), // No usage in first event
        extractSessionId: vi.fn().mockReturnValue(null),
        extractSlashCommands: vi.fn().mockReturnValue(null),
        isResultMessage: vi.fn().mockReturnValue(false),
        detectErrorFromLine: vi.fn().mockReturnValue(null),
    };

    const managedProcess: ManagedProcess = {
        sessionId,
        toolType: 'claude-code',
        cwd: '/test',
        pid: 1234,
        isTerminal: false,
        isStreamJsonMode: true,
        jsonBuffer: '',
        startTime: Date.now(),
        outputParser: mockParserFirstCall as AgentOutputParser,
    };
    processes.set(sessionId, managedProcess);

    // First event - sets model but no usage
    stdoutHandler.handleData(sessionId, '{"type":"text"}\n');
    expect(managedProcess.lastUsageTotals?.detectedModel).toBe('claude-opus-4-5-20251101');

    // Second event - has usage but no model
    const mockParserSecondCall: Partial<AgentOutputParser> = {
        agentId: 'claude-code',
        parseJsonLine: vi.fn().mockReturnValue({
            type: 'result',
            // No detectedModel in this event
        } as ParsedEvent),
        extractUsage: vi.fn().mockReturnValue({
            inputTokens: 1000,
            outputTokens: 500,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            costUsd: 0.05,
            contextWindow: 200000,
        }),
        extractSessionId: vi.fn().mockReturnValue(null),
        extractSlashCommands: vi.fn().mockReturnValue(null),
        isResultMessage: vi.fn().mockReturnValue(true),
        detectErrorFromLine: vi.fn().mockReturnValue(null),
    };
    managedProcess.outputParser = mockParserSecondCall as AgentOutputParser;

    stdoutHandler.handleData(sessionId, '{"type":"result"}\n');

    // Model should be preserved from earlier event
    expect(managedProcess.lastUsageTotals?.detectedModel).toBe('claude-opus-4-5-20251101');
    expect(emittedUsage?.detectedModel).toBe('claude-opus-4-5-20251101');
});
```

#### 2. stats.test.ts (IPC handler) - Dual cost calculation

File: `/app/Maestro/src/__tests__/main/ipc/handlers/stats.test.ts`

Add new describe block for dual cost calculation:

```typescript
describe('stats:record-query dual cost calculation', () => {
    it('should calculate dual costs when detectedModel is provided', async () => {
        const handler = handlers.get('stats:record-query');
        const queryEvent = {
            sessionId: 'session-1',
            agentType: 'claude-code',
            source: 'user' as const,
            startTime: Date.now(),
            duration: 5000,
            projectPath: '/test/project',
            inputTokens: 1000,
            outputTokens: 500,
            totalCostUsd: 0.05,
            detectedModel: 'claude-opus-4-5-20251101',
        };

        await handler!({} as any, queryEvent);

        // Verify insertQueryEvent was called with enriched event
        expect(mockStatsDB.insertQueryEvent).toHaveBeenCalled();
        const insertedEvent = mockStatsDB.insertQueryEvent.mock.calls[0][0];
        expect(insertedEvent.anthropicModel).toBe('claude-opus-4-5-20251101');
        expect(insertedEvent.anthropicCostUsd).toBeDefined();
        expect(insertedEvent.maestroCostUsd).toBeDefined();
        expect(insertedEvent.maestroBillingMode).toBeDefined();
        expect(insertedEvent.maestroCalculatedAt).toBeDefined();
    });

    it('should pass through event unchanged when no detectedModel', async () => {
        const handler = handlers.get('stats:record-query');
        const queryEvent = {
            sessionId: 'session-1',
            agentType: 'claude-code',
            source: 'user' as const,
            startTime: Date.now(),
            duration: 5000,
            projectPath: '/test/project',
            inputTokens: 1000,
            outputTokens: 500,
            totalCostUsd: 0.05,
            // No detectedModel
        };

        await handler!({} as any, queryEvent);

        expect(mockStatsDB.insertQueryEvent).toHaveBeenCalled();
        const insertedEvent = mockStatsDB.insertQueryEvent.mock.calls[0][0];
        // Model fields should still be set (with null/default values)
        expect(insertedEvent.anthropicCostUsd).toBe(0.05);
        expect(insertedEvent.maestroCostUsd).toBe(0.05);
        expect(insertedEvent.maestroBillingMode).toBe('api');
    });

    it('should not recalculate when anthropicModel already set', async () => {
        const handler = handlers.get('stats:record-query');
        const queryEvent = {
            sessionId: 'session-1',
            agentType: 'claude-code',
            source: 'user' as const,
            startTime: Date.now(),
            duration: 5000,
            anthropicModel: 'claude-opus-4-5-20251101',
            anthropicCostUsd: 0.05,
            maestroCostUsd: 0.03,
            maestroBillingMode: 'max' as const,
            maestroPricingModel: 'claude-opus-4-5-20251101',
            maestroCalculatedAt: 1234567890,
        };

        await handler!({} as any, queryEvent);

        // Should pass through unchanged
        const insertedEvent = mockStatsDB.insertQueryEvent.mock.calls[0][0];
        expect(insertedEvent.maestroCostUsd).toBe(0.03);
        expect(insertedEvent.maestroBillingMode).toBe('max');
        expect(insertedEvent.maestroCalculatedAt).toBe(1234567890);
    });
});
```

#### 3. UsageStats backward compatibility test

File: `/app/Maestro/src/__tests__/main/parsers/usage-aggregator.test.ts`

Add test to verify new fields are optional and don't break existing code:

```typescript
describe('UsageStats backward compatibility', () => {
    it('should work without detectedModel and anthropicMessageId (backward compat)', () => {
        const usageStats: UsageStats = {
            inputTokens: 1000,
            outputTokens: 500,
            cacheReadInputTokens: 200,
            cacheCreationInputTokens: 100,
            totalCostUsd: 0.05,
            contextWindow: 200000,
            // No detectedModel or anthropicMessageId - should compile and work
        };

        expect(usageStats.inputTokens).toBe(1000);
        expect(usageStats.detectedModel).toBeUndefined();
        expect(usageStats.anthropicMessageId).toBeUndefined();
    });

    it('should accept detectedModel and anthropicMessageId when provided', () => {
        const usageStats: UsageStats = {
            inputTokens: 1000,
            outputTokens: 500,
            cacheReadInputTokens: 200,
            cacheCreationInputTokens: 100,
            totalCostUsd: 0.05,
            contextWindow: 200000,
            detectedModel: 'claude-opus-4-5-20251101',
            anthropicMessageId: 'msg_test123',
        };

        expect(usageStats.detectedModel).toBe('claude-opus-4-5-20251101');
        expect(usageStats.anthropicMessageId).toBe('msg_test123');
    });
});
```

### Run All Tests

After implementation, run full test suite:

```bash
npm test
```

All tests must pass. The new optional fields should not cause any TypeScript compilation errors or runtime failures for existing code that doesn't use these fields.
