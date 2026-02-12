# Implementation Summary: Bash Warning Strip Fix

**Date:** 2026-02-10
**Commit:** `f9e480bf`
**Plan:** `AUTORUN-BASH-WARNING-FILTER.md`

---

## Summary

Fixed bash warning handling to **strip** warning lines instead of **skipping** entire messages. This allows real-time token/throughput display during streaming.

## Problem

1. **Yellow pill (Agent Session)**: Showed "Thinking..." for too long, then jumped to final token count
2. **Blue pill (AutoRun)**: Showed "338 tokens" at start of tasks

**Root cause**: The original filter in App.tsx skipped entire data chunks if they contained bash warnings. But bash warnings appear as a PREFIX before valid AI content, so we were discarding streaming data.

## Solution

Strip only the bash warning lines, keep everything else:

```typescript
let cleanedData = data;
if (data.includes('bash: warning:')) {
    cleanedData = data
        .split(/[\r\n]+/)
        .filter((line) => !line.startsWith('bash: warning:'))
        .join('\n')
        .trim();
    if (cleanedData.length === 0) {
        return; // Skip only if NOTHING remains
    }
}
// Use cleanedData instead of data
```

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/App.tsx` | Fix filter to strip warnings (~line 1812) |
| `src/renderer/hooks/agent/useAgentExecution.ts` | Add same strip filter for batch (~line 217) |

## What This Fixes

- **Yellow pill**: Now shows "Current: X tokens" incrementing during streaming
- **Blue pill**: No more "338 tokens" at task start
- **Both pills**: tok/s updates in real-time

## What Was NOT Changed

- Core data pipeline (StdoutHandler)
- Usage/cost calculations
- Any persistent data
