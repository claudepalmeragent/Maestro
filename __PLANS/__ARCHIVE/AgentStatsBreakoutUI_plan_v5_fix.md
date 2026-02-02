# Tooltip Positioning Fix - Investigation

## Problem Analysis

When hovering over a data point at the top left of a chart, the tooltip appears at the bottom middle of the graph instead of near the hovered point.

## Root Cause

The charts use SVG with:
- `width="100%"` - SVG fills container width
- `viewBox="0 0 600 220"` - Internal coordinate system
- `preserveAspectRatio="xMidYMid meet"` - Maintains aspect ratio, centers content

The current approach uses `getBoundingClientRect()` on SVG circle elements, which should work but may have issues with how browsers report bounding boxes for SVG elements within scaled/transformed viewports.

## Proposed Fix

Instead of using `getBoundingClientRect()` on SVG elements, use the mouse event's client coordinates directly:

```typescript
const handleMouseEnter = useCallback(
  (dayIndex: number, sessionId: string, event: React.MouseEvent<SVGCircleElement>) => {
    setHoveredDay({ dayIndex, sessionId });
    // Use mouse position directly instead of element bounding rect
    setTooltipPos({
      x: event.clientX,
      y: event.clientY,
    });
  },
  []
);
```

This approach:
1. Uses `event.clientX` and `event.clientY` which are always viewport-relative
2. Avoids issues with SVG element bounding box calculations
3. Positions the tooltip exactly where the mouse is

## Files to Update

- `AgentThroughputChart.tsx`
- `AgentUsageChart.tsx`
- `ThroughputTrendsChart.tsx`
- `DurationTrendsChart.tsx`
- `AutoRunStats.tsx`
