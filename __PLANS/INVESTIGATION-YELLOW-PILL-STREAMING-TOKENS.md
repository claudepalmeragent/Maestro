# Investigation Report: Yellow Pill Token Display During Streaming

**Date:** 2026-02-12
**Status:** RESOLVED
**Issue:** Yellow pill only shows token stats at the end of a query, not during streaming

---

## Executive Summary

**Root Cause Identified:** The bash warning filter was wrapping ALL batched update calls inside `if (cleanedData.length > 0)`. When a chunk was filtered to empty (bash warnings only), NO batched updates were called, which broke the flush cycle.

**Solution:** Always call the batched update functions, even with empty/zero values. The functions handle empty data gracefully, and calling them ensures the flush cycle continues running.

---

## Investigation Timeline

### Phase 1: Initial Hypothesis (Wrong)
- Suspected batching mechanism was broken
- Suspected memo comparators were blocking re-renders
- Suspected session ID mismatch in accumulators

### Phase 2: Bash Warning Filter Focus (Partial)
- Multiple regex fixes attempted
- Focused on the regex pattern, not the control flow
- Still broke Yellow pill streaming

### Phase 3: Key Insight (User)
User asked: "Why did the yellow pill show these updates properly during streaming BEFORE the first bash filtering fix was made?"

This revealed: **The batching mechanism works perfectly. The bash warning filter itself was breaking it.**

### Phase 4: Verification Test
Temporarily disabled the bash warning filter entirely:
```typescript
// TEMPORARILY DISABLED - just pass data through
batchedUpdater.appendLog(actualSessionId, targetTabId, true, data);
batchedUpdater.markDelivered(actualSessionId, targetTabId);
batchedUpdater.updateCycleBytes(actualSessionId, data.length);
```

**Result:** Yellow pill immediately showed "338 tokens" and real-time tok/s. Confirmed the batching mechanism works.

### Phase 5: Root Cause Identified

**The broken code:**
```typescript
if (data.includes('bash: warning:')) {
    cleanedData = data.replace(/bash: warning:[^\r\n]*/g, '');
    cleanedData = cleanedData.replace(/^[\r\n]+/, '').replace(/[\r\n]+$/, '');
}

// THIS WAS THE BUG - wrapping all updates in a conditional
if (cleanedData.length > 0) {
    batchedUpdater.appendLog(...);
    batchedUpdater.markDelivered(...);
    batchedUpdater.updateCycleBytes(...);
}
```

When `cleanedData.length === 0` (bash warnings only chunk), NO batched updates were called. This meant:
1. `hasPendingRef.current` was never set to `true`
2. The flush timer never triggered
3. The React state never updated
4. The pill never re-rendered

**The fix:**
```typescript
if (data.includes('bash: warning:')) {
    cleanedData = data.replace(/bash: warning:[^\r\n]*/g, '');
    cleanedData = cleanedData.replace(/^[\r\n]+/, '').replace(/[\r\n]+$/, '');
}

// ALWAYS call batched updates - they handle empty/zero gracefully
// This ensures the flush cycle keeps running even when warnings are stripped
batchedUpdater.appendLog(actualSessionId, targetTabId, true, cleanedData);
batchedUpdater.markDelivered(actualSessionId, targetTabId);
batchedUpdater.updateCycleBytes(actualSessionId, cleanedData.length);
```

---

## Why This Fix Works

1. **`appendLog` handles empty data:** Line 609 has `if (!data) return;` - it gracefully ignores empty strings
2. **`updateCycleBytes(0)` is fine:** Adding 0 bytes doesn't affect the count, but it DOES set `hasPendingRef.current = true`
3. **Flush cycle continues:** Even with 0-byte updates, the flush timer fires, which triggers React re-renders
4. **Subsequent chunks work:** When real content arrives (no bash warnings), bytes are counted normally

---

## Data Flow (Corrected Understanding)

```
Chunk 1: "bash: warning:...\rbash: warning:...\r"
  → Filter strips to ""
  → appendLog("") - ignored internally
  → updateCycleBytes(0) - sets hasPendingRef = true
  → Flush happens, React re-renders (no visible change yet)

Chunk 2: '{"type":"assistant","content":"Hello"}'
  → No bash warnings, cleanedData = original
  → appendLog(data) - appends to logs
  → updateCycleBytes(N) - adds N bytes
  → Flush happens, React re-renders
  → ThinkingStatusPill sees currentCycleBytes > 0
  → Shows "Current~: X tokens"
```

---

## Files Changed

1. **`src/renderer/App.tsx`** - Yellow pill onData handler
   - Removed `if (cleanedData.length > 0)` wrapper around batched updates

2. **`src/renderer/hooks/agent/useAgentExecution.ts`** - Blue AutoRun pill
   - Same pattern (already fixed in earlier commit, verified working)

---

## Lessons Learned

1. **Don't wrap batch update calls in conditionals** - The batch system needs to be called to trigger flushes
2. **Test with bash warnings disabled** - Would have found the issue immediately
3. **User insight was crucial** - "Why did it work before?" pointed directly to the bash filter as the culprit
4. **The batching mechanism is solid** - No changes needed to useBatchedSessionUpdates.ts
