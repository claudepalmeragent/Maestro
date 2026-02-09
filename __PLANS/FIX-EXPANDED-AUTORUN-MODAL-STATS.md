# Fix: Expanded Auto Run Modal Missing Batch Stats

**Created:** 2026-02-09
**Status:** Investigation Complete
**Priority:** Medium (UX issue - stats visible in panel but not expanded modal)

---

## Problem Statement

The expanded Auto Run modal (`AutoRunExpandedModal.tsx`) does not display the cumulative batch run statistics (tokens used, costs, overall progress) that are visible in the RightPanel sidebar view.

**User impact:** When working in the expanded modal during an Auto Run, users cannot see:
- Total tokens used (agent + subagent)
- Cache token breakdown
- Cost calculation ($X.XX)
- Overall progress (X of Y tasks completed)
- Loop iteration indicator

---

## Investigation Findings

### Current Architecture

**RightPanel.tsx** (sidebar view):
- Lines 600-825: Renders full batch run stats when `isRunning`
- Shows: elapsed time, document progress, overall progress bar, token breakdown, costs, subagent indicator
- Directly reads from `currentSessionBatchState`

**AutoRunExpandedModal.tsx**:
- Wraps the `AutoRun` component
- Passes `batchRunState` through to `AutoRun`
- Does NOT render any batch progress/stats UI itself

**AutoRun.tsx** (core component):
- Receives `batchRunState` prop
- Only uses it for: lock state, error handling, document navigation
- Footer shows: document task counts (`X of Y tasks completed`), document token count (content size)
- Does NOT display cumulative batch tokens/costs

### What's Missing

The expanded modal lacks:

1. **Batch progress header/overlay** during run:
   - Elapsed time
   - Current document indicator (for multi-doc runs)
   - Overall progress bar

2. **Token/cost breakdown**:
   - Total Tokens used: X ($Y.YY)
   - ↳ Cache Read + Write: Z ($W.WW)
   - Agent Tokens: ...
   - Subagent Tokens: ...

3. **Subagent indicator**:
   - Purple badge showing when subagent is active

---

## Root Cause

The stats display logic was implemented only in `RightPanel.tsx` and never added to `AutoRunExpandedModal.tsx`. When the expanded modal was created, it focused on the document editing experience and delegated run controls to the header buttons, but omitted the progress stats section.

---

## Proposed Fix

### Option A: Add Stats Section to Expanded Modal (Recommended)

Add a collapsible/floating stats panel to `AutoRunExpandedModal.tsx` that mirrors the RightPanel stats when a batch run is active.

**Location options:**
1. **Bottom bar** (below AutoRun content) - Most space, but obscures document
2. **Top right overlay** - Floating, doesn't obscure content
3. **Header extension** - Inline with existing header, expands when running

**Recommended: Bottom bar that appears only during batch runs**

```tsx
{/* Batch Run Stats Bar - shown during active run */}
{batchRunState?.isRunning && (
  <div
    className="flex-shrink-0 px-4 py-2 border-t text-xs"
    style={{ backgroundColor: theme.colors.bgActivity, borderColor: theme.colors.border }}
  >
    {/* Progress, tokens, costs - same as RightPanel */}
  </div>
)}
```

### Option B: Extract Stats Component

Create a shared `<BatchRunStats batchRunState={...} theme={...} />` component that can be used in both:
- `RightPanel.tsx`
- `AutoRunExpandedModal.tsx`

This avoids code duplication and ensures consistency.

---

## Implementation Plan

### Step 1: Create BatchRunStats Component

**File:** `src/renderer/components/BatchRunStats.tsx`

Extract the stats rendering logic from `RightPanel.tsx` (lines 684-821) into a reusable component:

```tsx
interface BatchRunStatsProps {
  batchRunState: BatchRunState;
  theme: Theme;
  compact?: boolean; // For different display modes
}

export function BatchRunStats({ batchRunState, theme, compact }: BatchRunStatsProps) {
  // Token calculations
  // Cost calculations
  // Render progress, tokens, costs
}
```

### Step 2: Update RightPanel.tsx

Replace the inline stats rendering with the new component:

```tsx
{currentSessionBatchState.isRunning && !currentSessionBatchState.worktreeActive && (
  <BatchRunStats
    batchRunState={currentSessionBatchState}
    theme={theme}
  />
)}
```

### Step 3: Update AutoRunExpandedModal.tsx

Add the stats component below the AutoRun content area:

```tsx
{/* AutoRun Content */}
<div className="flex-1 min-h-0 overflow-hidden p-4">
  <AutoRun ... />
</div>

{/* Batch Run Stats - shown during active run */}
{batchRunState?.isRunning && (
  <div className="flex-shrink-0 border-t" style={{ borderColor: theme.colors.border }}>
    <BatchRunStats
      batchRunState={batchRunState}
      theme={theme}
      compact // Optional: more compact layout for modal
    />
  </div>
)}
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/renderer/components/BatchRunStats.tsx` | **NEW** - Extracted stats component |
| `src/renderer/components/RightPanel.tsx` | Use BatchRunStats component |
| `src/renderer/components/AutoRunExpandedModal.tsx` | Add BatchRunStats during batch runs |

---

## Testing Plan

1. **Sidebar view (RightPanel):**
   - Verify stats still display correctly
   - No visual regression

2. **Expanded modal:**
   - Start Auto Run, open expanded modal
   - Verify stats appear at bottom
   - Verify tokens, costs, progress update live
   - Verify subagent indicator shows when active

3. **Edge cases:**
   - Multi-document runs: verify document progress
   - Loop mode: verify loop iteration display
   - Stopping: verify "Stopping..." state

---

## Alternatives Considered

### A: Duplicate Code in Modal
Just copy the stats rendering from RightPanel to the modal.
- **Pros:** Quick fix
- **Cons:** Code duplication, maintenance burden

### B: Show Stats in AutoRun Component Footer
Add batch stats to the AutoRun component's existing footer.
- **Pros:** Single location for all stats
- **Cons:** Footer already has document-level stats, could get cluttered

### C: Floating Overlay
Show stats in a floating panel that can be minimized.
- **Pros:** Doesn't take permanent space
- **Cons:** More complex UX, additional state management

---

## Recommendation

**Option B (Extract Component)** is the best approach because:
1. Maintains consistency between sidebar and modal views
2. Single source of truth for stats rendering
3. Easier to maintain and update
4. Can add `compact` prop for different contexts if needed
