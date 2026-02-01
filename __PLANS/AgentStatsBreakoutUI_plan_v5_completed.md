# Agent Statistics Breakout UI - Plan v5 Completed

## Summary

Fixed tooltip positioning in Usage Dashboard charts. Tooltips were appearing at incorrect positions (e.g., bottom middle of graph when hovering top left data point).

---

## Root Cause

The original code used `getBoundingClientRect()` on SVG circle elements to get positioning coordinates:

```typescript
const rect = event.currentTarget.getBoundingClientRect();
setTooltipPos({
  x: rect.left + rect.width / 2,
  y: rect.top,
});
```

This approach has issues with SVG elements inside scaled viewBox containers (`width="100%"` with `viewBox="0 0 600 220"` and `preserveAspectRatio="xMidYMid meet"`). The bounding rect calculations can be unreliable due to the coordinate system transformations.

---

## Solution

### Part 1: Use Mouse Event Coordinates

**Use mouse event coordinates directly instead of element bounding rectangles:**

```typescript
const handleMouseEnter = useCallback(
  (dayIndex: number, sessionId: string, event: React.MouseEvent<SVGCircleElement>) => {
    setHoveredDay({ dayIndex, sessionId });
    // Use mouse position directly - more reliable than getBoundingClientRect on SVG elements
    setTooltipPos({
      x: event.clientX,
      y: event.clientY,
    });
  },
  []
);
```

**Benefits:**
- `event.clientX` and `event.clientY` are always viewport-relative
- Avoids issues with SVG element bounding box calculations in scaled containers
- Tooltip appears exactly where the mouse cursor is

### Part 2: Viewport Overflow Prevention

Added flip logic to prevent tooltips from overflowing viewport top:

```typescript
const TOOLTIP_FLIP_THRESHOLD = 80; // pixels from top of viewport to trigger flip
const TOOLTIP_OFFSET = 8; // pixels gap between tooltip and cursor

style={{
  left: tooltipPos.x,
  top: tooltipPos.y < TOOLTIP_FLIP_THRESHOLD
    ? tooltipPos.y + TOOLTIP_OFFSET    // Position below cursor
    : tooltipPos.y - TOOLTIP_OFFSET,   // Position above cursor (default)
  transform: tooltipPos.y < TOOLTIP_FLIP_THRESHOLD
    ? 'translateX(-50%)'               // Just center horizontally
    : 'translate(-50%, -100%)',        // Center and shift up
}}
```

---

## Files Modified

| File | Change |
|------|--------|
| `AgentThroughputChart.tsx` | Use `event.clientX/clientY`, add flip logic |
| `AgentUsageChart.tsx` | Use `event.clientX/clientY`, add flip logic |
| `ThroughputTrendsChart.tsx` | Use `event.clientX/clientY`, add flip logic |
| `DurationTrendsChart.tsx` | Use `event.clientX/clientY`, add flip logic |
| `AutoRunStats.tsx` | Use `event.clientX/clientY`, add flip logic |
| `AgentComparisonChart.tsx` | Added constants only (uses side-positioning) |

---

## Testing

| Test | Result |
|------|--------|
| TypeScript compilation | Passed |
| Renderer build | Passed |
| ESLint/Prettier | Passed via pre-commit hooks |

---

## Commit

```
df672a98 fix: smart tooltip positioning to prevent overflow in Usage Dashboard charts
```

---

## Visual Behavior

**Before:**
- Hovering top-left data point showed tooltip at bottom-middle of chart
- Tooltip position was unreliable due to SVG viewBox scaling

**After:**
- Tooltip appears at mouse cursor position
- Flips below cursor when near viewport top (< 80px)
- Consistent positioning across all data points

---

## Status

**Completed**
