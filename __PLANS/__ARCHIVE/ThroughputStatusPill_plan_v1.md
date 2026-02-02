# ThinkingStatusPill Throughput Fix - Diagnosis and Plan v1

## Problem Statement

The ThinkingStatusPill shows "Thinking..." during active Claude Code requests, but does NOT display real-time throughput metrics (e.g., "Tokens: 1.2K | 45.2 tok/s"). The user expects to see token count and throughput during streaming responses, not just after the response completes.

---

## Root Cause Analysis

### 1. Data Flow Investigation

Traced the data flow from the process output through to the UI:

```
Claude Code process (stdout)
    ↓
claude-output-parser.ts (parseRawOutput)
    ↓
App.tsx (onUsage handler → updateCycleTokens)
    ↓
useBatchedSessionUpdates.ts (cycleTokensDelta)
    ↓
ThinkingStatusPill.tsx (primaryTokens display)
```

### 2. Core Issue: Claude Code Usage Timing

**File:** `src/main/parsers/claude-output-parser.ts`

Claude Code's output parser only extracts usage statistics from `result` messages, NOT from `assistant` messages:

```typescript
// Line 127-134: result messages (FINAL response) - HAS usage
if (msg.type === 'result') {
  const usage = this.extractUsageFromRaw(msg);
  if (usage) { event.usage = usage; }
  return event;
}

// Lines 137-156: assistant messages (STREAMING) - NO usage extracted
if (msg.type === 'assistant') {
  return { type: 'text', text: contentToEmit, isPartial: true, ... };
  // Notice: NO usage field extracted here
}
```

This means:
- **During streaming:** `assistant` type messages are emitted without usage data
- **At completion:** `result` type message contains usage stats (input/output tokens)

### 3. App.tsx Handler Analysis

**File:** `src/renderer/App.tsx`

Two relevant handlers:

```typescript
// Line 1803: onData - called during streaming
onData: (data) => {
  batchedUpdater.updateCycleBytes(actualSessionId, data.length);
  // ✓ WORKS during streaming - bytes accumulate
}

// Line 2766: onUsage - called ONLY at response completion
onUsage: (usageStats) => {
  batchedUpdater.updateCycleTokens(actualSessionId, usageStats.outputTokens);
  // ✗ Only fires when result message arrives (end of response)
}
```

### 4. ThinkingStatusPill Rendering

**File:** `src/renderer/components/ThinkingStatusPill.tsx`

The pill conditionally shows throughput based on `primaryTokens`:

```typescript
// Lines 426-448: Only shows if tokens > 0
{primaryTokens > 0 && (
  <div>
    <span>Tokens:</span>
    <span>{formatTokensCompact(primaryTokens)}</span>
    <ThroughputDisplay tokens={primaryTokens} startTime={...} />
  </div>
)}

// Lines 451-458: Shows "Thinking..." when no tokens yet
{primaryTokens === 0 && (
  <span>Thinking...</span>
)}
```

Since `currentCycleTokens` stays at 0 during streaming (because no usage events fire), the pill always shows "Thinking..." until the response completes.

---

## Solution Design

### Approach: Estimate Tokens from Streaming Bytes

Since `currentCycleBytes` IS updated during streaming (via the `onData` handler), we can estimate token count from bytes using an average bytes-per-token ratio.

**Key insight:** Claude's responses average approximately 3-4 bytes per token (UTF-8 English text). We'll use a conservative estimate of **3.5 bytes per token**.

### Implementation Plan

#### Phase 1: Add Estimated Tokens to Session State

**File:** `src/renderer/hooks/session/useBatchedSessionUpdates.ts`

Add a new computed field `estimatedCycleTokens` that derives from `currentCycleBytes`:

```typescript
// Add constant for bytes-to-tokens estimation
const BYTES_PER_TOKEN_ESTIMATE = 3.5;

// In the batch flush logic, compute estimated tokens
const estimatedTokens = Math.floor(currentCycleBytes / BYTES_PER_TOKEN_ESTIMATE);
```

#### Phase 2: Update ThinkingStatusPill Display Logic

**File:** `src/renderer/components/ThinkingStatusPill.tsx`

Change the display logic to:
1. Show actual tokens if available (`currentCycleTokens > 0`)
2. Show estimated tokens during streaming (`currentCycleBytes > 0` but `currentCycleTokens === 0`)
3. Show "Thinking..." only when no data yet (`currentCycleBytes === 0`)

```typescript
// Compute display tokens
const displayTokens = primaryTokens > 0
  ? primaryTokens
  : Math.floor(cycleBytes / BYTES_PER_TOKEN_ESTIMATE);

const isEstimated = primaryTokens === 0 && displayTokens > 0;

// Render with estimated indicator
{displayTokens > 0 && (
  <div>
    <span>Tokens{isEstimated ? '~' : ''}:</span>
    <span>{formatTokensCompact(displayTokens)}</span>
    <ThroughputDisplay tokens={displayTokens} startTime={...} />
  </div>
)}
```

#### Phase 3: Pass Cycle Bytes to ThinkingStatusPill

Ensure `currentCycleBytes` is passed through to ThinkingStatusPill for the estimation calculation.

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/renderer/components/ThinkingStatusPill.tsx` | Add bytes-to-tokens estimation, show estimated throughput during streaming |
| `src/renderer/App.tsx` | Ensure cycleBytes is passed to ThinkingStatusPill (if not already) |

---

## User Experience

### Before (Current)
```
[●] SessionName | Thinking... | 0m 12s | [Stop]
```
(No throughput shown during streaming)

### After (Fixed)
```
[●] SessionName | Tokens~: 1.2K | ~45.2 tok/s | 0m 12s | [Stop]
```
(Estimated throughput shown during streaming with ~ indicator)

When the response completes and actual token count is available:
```
[●] SessionName | Tokens: 1.4K | 52.3 tok/s | 0m 27s | [Stop]
```
(Actual throughput shown, ~ indicator removed)

---

## Testing Plan

1. **Streaming Display:** Start a Claude Code request and verify tokens/throughput appear immediately as data streams in
2. **Estimation Accuracy:** Compare estimated vs actual tokens after completion (should be within ~20%)
3. **Indicator:** Verify `~` appears during streaming and disappears after completion
4. **Edge Cases:**
   - Very short responses (few bytes)
   - Very long responses (many tokens)
   - Responses with non-ASCII characters (higher bytes per token)
5. **No Regression:** Verify Usage Dashboard still shows correct final token counts

---

## Technical Notes

### Bytes-per-Token Ratio

The 3.5 bytes/token estimate is based on:
- Average English word length: ~4.5 characters
- Average tokens per word: ~1.3
- UTF-8 encoding: 1 byte per ASCII character
- Result: ~3.5 bytes per token for typical English text

This is an approximation. Non-ASCII text (e.g., Chinese, emoji) uses more bytes per character but also tends to use fewer tokens per concept, so the ratio roughly holds.

### Why Not Parse Usage from Streaming?

Claude Code's streaming protocol doesn't include per-chunk token counts. The usage statistics are only available in the final `result` message. This is a limitation of the Claude API/Claude Code architecture, not something we can change in Maestro.

---

## Status

**Ready for Implementation**
