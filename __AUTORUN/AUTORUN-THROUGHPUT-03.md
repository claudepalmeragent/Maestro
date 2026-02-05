# Phase 4: Testing & Refinement

> **Feature:** Auto Run Throughput Status Pill
> **Phase:** 4 of 4 (Phase 3 deferred)
> **Scope:** Run tests, fix failures, verify implementation
> **Prerequisite:** Phases 1 and 2 must be completed first

---

## Overview

This phase ensures all tests pass and the implementation is verified. Run TypeScript compilation, existing tests, and verify no regressions.

---

## Task 4.1: Run TypeScript Compilation

Verify the code compiles without type errors.

- [ ] Run `npm run build` from the `/app/Maestro` directory. Fix any TypeScript compilation errors that occur. Common issues to watch for:
  - Missing imports for `formatTokensCompact` in RightPanel.tsx
  - Type mismatches in BatchRunState fields
  - Missing action types in batchReducer.ts

---

## Task 4.2: Run Existing Test Suite

Run the existing tests to ensure no regressions.

- [ ] Run `npm test` from the `/app/Maestro` directory. If tests fail:
  - Check if any tests reference BatchRunState and need updating for new fields
  - Check if ThinkingStatusPill tests need updating for new props
  - Check if batchReducer tests need updating for new actions
  - Fix any test failures while maintaining the intended behavior

---

## Task 4.3: Update Existing Tests for New Fields (if needed)

If existing tests fail due to incomplete mock data, update them.

- [ ] If tests in `src/__tests__/renderer/components/ThinkingStatusPill.test.tsx` fail, update the mock BatchRunState objects to include the new optional fields (they can be undefined/omitted since they're optional). If tests in `src/__tests__/renderer/hooks/batch/` fail, update mock data as needed. Ensure all existing test assertions still pass.

---

## Task 4.4: Run Linting

Ensure code style is consistent.

- [ ] Run `npm run lint` from the `/app/Maestro` directory. Fix any linting errors. Common issues:
  - Unused imports
  - Missing semicolons (if configured)
  - Line length violations

---

## Task 4.5: Final Build Verification

Ensure the final build succeeds.

- [ ] Run `npm run build` one final time to verify everything compiles correctly after all fixes. The build should complete without errors.

---

## Verification Checklist

After completing all tasks, verify the following behavior:

**Auto Run Pill (Blue):**
- [ ] Shows "Tokens: — | — tok/s" (greyed) before first data arrives
- [ ] Shows "Tokens~: X.XK | ~XX.X tok/s" during streaming (with tilde for estimates)
- [ ] Shows actual token values when onUsage events arrive
- [ ] Shows "Total: X.XK" after first task completes (cumulative)
- [ ] Total increases correctly as more tasks complete
- [ ] Throughput (tok/s) updates in real-time

**RightPanel Progress Section:**
- [ ] Shows "Tokens used: X.XK ($X.XXXX)" after tasks complete
- [ ] Cost displays correctly (if agent provides it)

**No Regressions:**
- [ ] Yellow thinking pill still works correctly
- [ ] Auto Run task progress (X/Y) still displays correctly
- [ ] Subagent indicator still displays correctly
- [ ] Stop button still works correctly
- [ ] All existing tests pass

---

*Phase 4 of Auto Run Throughput Status Pill Implementation*
