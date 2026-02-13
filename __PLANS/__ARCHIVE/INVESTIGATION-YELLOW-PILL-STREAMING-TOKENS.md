# Investigation Report: Yellow Pill Token Display During Streaming

**Date:** 2026-02-12
**Status:** RESOLVED (Final Fix Applied)
**Issue:** Yellow pill only shows token stats at the end of a query, not during streaming

---

## Executive Summary

**Root Cause Identified:** Two issues with the bash warning filter:

1. **Control flow issue:** Wrapping batched update calls inside `if (cleanedData.length > 0)` broke the flush cycle when chunks were filtered to empty.

2. **Regex issue:** The regex `/bash: warning:[^\r\n]*/g` was matching the ENTIRE message because the `\r` in the data was the literal two-character string `\r` (backslash + r), not an actual carriage return character.

**Final Solution:** Use a proper regex with negative lookahead that handles both literal `\r` escape sequences AND actual CR/LF characters:
```typescript
/bash: warning: (?:(?!(?:\\r|\r|\n)).)*(?:\\r|\r|\n)/g
```

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

### Phase 5: Control Flow Fix (Partial)
Removed the `if (cleanedData.length > 0)` wrapper to always call batched updates.

**Result:** Still broken with bash warnings present. The regex itself was the problem.

### Phase 6: Regex Analysis (Final Fix)

**The problem:** The regex `/bash: warning:[^\r\n]*/g` uses `[^\r\n]*` which means "match any character except CR or LF". But the data contains the LITERAL string `\r` (two characters: backslash followed by 'r'), NOT an actual carriage return character.

So `[^\r\n]*` keeps matching because it never sees an actual CR or LF - just the letters `\`, `r`, etc.

**The fix:** Use negative lookahead to match until we see EITHER:
- The literal escape sequence `\\r` (backslash-backslash-r in regex = matches `\r` in string)
- An actual carriage return `\r`
- An actual newline `\n`

```typescript
/bash: warning: (?:(?!(?:\\r|\r|\n)).)*(?:\\r|\r|\n)/g
```

Breaking this down:
- `bash: warning: ` - Literal prefix (with trailing space)
- `(?:(?!(?:\\r|\r|\n)).)*` - Match any char that is NOT followed by `\r` literal, CR, or LF
- `(?:\\r|\r|\n)` - Then match the line ending itself

---

## Final Code

**App.tsx (Yellow Pill):**
```typescript
// Strip bash warnings (setlocale, etc.) that appear via SSH before AI response
// Bash warnings use \r separators - match warning text up to and including the line ending
let cleanedData = data;
if (data.includes('bash: warning:')) {
    // Match "bash: warning:" followed by any chars (non-greedy via negative lookahead) until \r or \n
    cleanedData = data.replace(/bash: warning: (?:(?!(?:\\r|\r|\n)).)*(?:\\r|\r|\n)/g, '');
}

// ALWAYS call batched updates - they handle empty/zero gracefully
batchedUpdater.appendLog(actualSessionId, targetTabId, true, cleanedData);
batchedUpdater.markDelivered(actualSessionId, targetTabId);
batchedUpdater.updateCycleBytes(actualSessionId, cleanedData.length);
```

**useAgentExecution.ts (Blue AutoRun Pill):**
```typescript
// Strip bash warnings (setlocale, etc.) that appear via SSH
// Bash warnings use \r separators - match warning text up to and including the line ending
let cleanedData = data;
if (data.includes('bash: warning:')) {
    // Match "bash: warning:" followed by any chars (non-greedy via negative lookahead) until \r or \n
    cleanedData = data.replace(/bash: warning: (?:(?!(?:\\r|\r|\n)).)*(?:\\r|\r|\n)/g, '');
}

// Always track - accumulate text and call callback for byte tracking
responseText += cleanedData;
callbacks?.onData?.(cleanedData.length);
```

---

## Why This Fix Works

1. **Handles literal `\r` escape sequences:** The data from SSH may contain the literal two-character string `\r`, not actual carriage returns
2. **Handles actual CR/LF:** Also matches real carriage return and newline characters
3. **Non-greedy matching:** The negative lookahead ensures we stop at the FIRST line ending, not consume the entire string
4. **Always calls batched updates:** Even with 0-length cleaned data, the flush cycle continues

---

## Files Changed

1. **`src/renderer/App.tsx`** - Yellow pill onData handler
2. **`src/renderer/hooks/agent/useAgentExecution.ts`** - Blue AutoRun pill onData handler

---

## Lessons Learned

1. **Character encoding matters:** `\r` in a string can be either an actual carriage return OR the literal two characters `\` and `r`
2. **Test with the problematic data:** We should have examined the actual byte content of the bash warnings earlier
3. **Regex character classes are literal:** `[^\r\n]` matches actual CR/LF bytes, not escape sequences in strings
4. **User insight was crucial:** "That regex will ALWAYS match the whole message" pointed directly to the regex being overly greedy
