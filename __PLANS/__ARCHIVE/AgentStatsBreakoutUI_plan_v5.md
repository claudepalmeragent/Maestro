# Agent Statistics Breakout UI - Plan v5

## Problem

Tooltips in the Usage Dashboard charts are positioned incorrectly when hovering over data points that are not at the top of the graph. The tooltips appear too far down to be visible within the chart area.

### Root Cause

The current tooltip positioning uses:
1. `position: fixed` with `top: rect.top - offset`
2. `transform: 'translate(-50%, -100%)'` to position above the data point

The issue is that `rect.top` from `getBoundingClientRect()` returns the element's position relative to the viewport. When a data point is lower in the chart (representing a lower value), `rect.top` is larger, causing the tooltip to be positioned further down on the screen.

The `transform: translate(-50%, -100%)` then shifts the tooltip up by its own height, but since the fixed position is already too far down, the tooltip ends up below the visible area or at an awkward position.

---

## Solution

Implement smart tooltip positioning that:
1. Calculates the tooltip position relative to the chart container, not the viewport
2. Checks if the tooltip would overflow the top of the viewport
3. Flips the tooltip to appear below the data point when it would overflow above

### Approach: Viewport-Aware Tooltip Positioning

Store additional state to track whether the tooltip should flip, and calculate position dynamically:

```typescript
// Store whether tooltip should appear below (flipped)
const shouldFlipTooltip = tooltipPos && tooltipPos.y < TOOLTIP_HEIGHT;

// In render:
style={{
  left: tooltipPos.x,
  top: shouldFlipTooltip ? tooltipPos.y + offset : tooltipPos.y - offset,
  transform: shouldFlipTooltip ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
}}
```

---

## Files to Modify

| File | Change |
|------|--------|
| `AgentThroughputChart.tsx` | Add smart tooltip positioning |
| `AgentUsageChart.tsx` | Add smart tooltip positioning |
| `ThroughputTrendsChart.tsx` | Add smart tooltip positioning |
| `DurationTrendsChart.tsx` | Add smart tooltip positioning |
| `AgentComparisonChart.tsx` | Add smart tooltip positioning |
| `AutoRunStats.tsx` | Add smart tooltip positioning |

---

## Implementation Details

For each chart component:

1. **Update handleMouseEnter** to store the data point's Y position
2. **Add flip detection** - if tooltip would overflow viewport top, flip it
3. **Update tooltip styles** - conditionally apply top/bottom positioning

### Constants
```typescript
const TOOLTIP_FLIP_THRESHOLD = 80; // pixels from top of viewport to trigger flip
const TOOLTIP_OFFSET = 10; // pixels gap between tooltip and data point
```

### Updated Tooltip Rendering
```typescript
{/* Tooltip */}
{hoveredDay && tooltipPos && (
  <div
    className="fixed z-50 px-3 py-2 rounded-lg shadow-lg text-xs pointer-events-none"
    style={{
      backgroundColor: theme.colors.bgSidebar,
      border: `1px solid ${theme.colors.border}`,
      color: theme.colors.textMain,
      left: tooltipPos.x,
      // Flip tooltip below data point if it would overflow viewport top
      top: tooltipPos.y < TOOLTIP_FLIP_THRESHOLD
        ? tooltipPos.y + TOOLTIP_OFFSET
        : tooltipPos.y - TOOLTIP_OFFSET,
      transform: tooltipPos.y < TOOLTIP_FLIP_THRESHOLD
        ? 'translateX(-50%)'  // Position below, no vertical shift
        : 'translate(-50%, -100%)',  // Position above
    }}
  >
    {/* tooltip content */}
  </div>
)}
```

---

## Testing

1. TypeScript compilation passes
2. Renderer build succeeds
3. Visual verification (manual): hover over data points at various Y positions

---

## Expected Result

- Tooltips for data points near the top of the chart appear above the point (default)
- Tooltips for data points that would cause overflow appear below the point (flipped)
- All tooltips remain visible within the viewport
