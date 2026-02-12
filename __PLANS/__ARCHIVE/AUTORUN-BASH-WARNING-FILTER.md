# Plan: Fix Bash Warning Filter (Strip, Don't Skip)

**Date:** 2026-02-10
**Status:** REVIEWED - Ready for Implementation
**Related:** Previous fix in App.tsx for yellow pill (commit `0323fd78`)

---

## Problem

**Two issues:**

1. **Blue AutoRun pill** - Shows "338 tokens" at the start of tasks (no filter at all)
2. **Yellow Agent Session pill** - Shows "Thinking..." for too long, then jumps to final token count (filter skips entire messages instead of stripping bash warnings)

**User observation:** "I should be able to see tokens and tok/s while I see thinking messages coming out, and right now I can't until just before the session thinking stops"

## Root Cause Analysis

### Issue 1: AutoRun (no filter)
In `useAgentExecution.ts` line 217-223, the batch `onData` callback passes raw data bytes without any filtering.

### Issue 2: Agent Session (wrong filter)
In `App.tsx` line 1814-1817, the current filter **skips the entire message** if it contains bash warnings:

```typescript
// CURRENT (WRONG) - skips entire message
const isBashWarning = data.startsWith('bash: warning:') || data.includes('\rbash: warning:');
if (isBashWarning) {
    return;  // ← Skips ALL data, including valid AI output after the warning!
}
```

**What actually happens:** Bash warnings appear as a PREFIX before AI content:
```
bash: warning: setlocale: LC_CTYPE: cannot change locale...\r
bash: warning: setlocale: LC_COLLATE: cannot change locale...\r
{"type":"assistant","content":"Here's my response..."}
```

The current code sees `data.includes('\rbash: warning:')` and skips the ENTIRE chunk, including the valid JSON after it.

## Solution

**Strip bash warnings from the data, don't skip the entire message:**

```typescript
// Helper function to strip bash warnings from data
function stripBashWarnings(data: string): string {
    // Remove bash warning lines (they end with \r or \n)
    // Pattern: "bash: warning: ..." followed by newline/carriage return
    return data
        .split(/[\r\n]+/)
        .filter(line => !line.startsWith('bash: warning:'))
        .join('\n');
}

// In onData handler:
const cleanedData = stripBashWarnings(data);
if (cleanedData.length === 0) {
    return; // Only skip if NOTHING remains after stripping
}
// Use cleanedData instead of data
```

## Files to Change

| File | Change | Risk |
|------|--------|------|
| `src/renderer/App.tsx` | Fix filter to strip warnings, not skip messages (~line 1814) | LOW |
| `src/renderer/hooks/agent/useAgentExecution.ts` | Add same strip filter for batch processing (~line 218) | LOW |

## Why This Is Safe

- Only removes bash warning lines, preserves all other content
- If entire message is just warnings, returns early (same as before)
- If message contains warnings + AI output, AI output is preserved
- Fixes the "Thinking..." delay where tokens weren't showing during streaming

---

## Implementation

### Change 1: App.tsx (Yellow Pill)

**Before (~line 1812-1817):**
```typescript
// Filter out bash warnings (setlocale, etc.) that appear via SSH before AI response
// These are shell noise, not useful content - skip them entirely
const isBashWarning = data.startsWith('bash: warning:') || data.includes('\rbash: warning:');
if (isBashWarning) {
    return;
}
```

**After:**
```typescript
// Strip bash warnings (setlocale, etc.) that appear via SSH before AI response
// Remove only the warning lines, keep any valid content that follows
let cleanedData = data;
if (data.includes('bash: warning:')) {
    cleanedData = data
        .split(/[\r\n]+/)
        .filter(line => !line.startsWith('bash: warning:'))
        .join('\n')
        .trim();
    if (cleanedData.length === 0) {
        return; // Skip only if nothing remains after stripping warnings
    }
}
// Use cleanedData for the rest of the handler
```

### Change 2: useAgentExecution.ts (Blue Pill)

**Before (~line 217-223):**
```typescript
window.maestro.process.onData((sid: string, data: string) => {
    if (sid === targetSessionId) {
        responseText += data;
        callbacks?.onData?.(data.length);
    }
})
```

**After:**
```typescript
window.maestro.process.onData((sid: string, data: string) => {
    if (sid === targetSessionId) {
        // Strip bash warnings, keep valid content
        let cleanedData = data;
        if (data.includes('bash: warning:')) {
            cleanedData = data
                .split(/[\r\n]+/)
                .filter(line => !line.startsWith('bash: warning:'))
                .join('\n')
                .trim();
            if (cleanedData.length === 0) {
                return;
            }
        }
        responseText += cleanedData;
        callbacks?.onData?.(cleanedData.length);
    }
})
```

---

## Testing

1. **Yellow pill (Agent Session via SSH):**
   - Send a message
   - Should see "Current: X tokens" incrementing during streaming (not just at end)
   - Should see tok/s updating in real-time

2. **Blue pill (AutoRun via SSH):**
   - Run an AutoRun task
   - Should NOT see "338 tokens" at start
   - Should see tokens incrementing during task execution

---

## Summary

~15 lines of code changes across 2 files. The key insight is **strip, don't skip**.
