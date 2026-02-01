# Agent Statistics Breakout UI - Plan v6

## Problem

Tooltips in Usage Dashboard charts appear at incorrect positions despite v5 fix using `event.clientX/clientY`. Tooltips appear too low for high data points and off the bottom for lower ones.

---

## Root Cause Analysis

The tooltip uses `position: fixed` which should position relative to the viewport. However, the tooltip is rendered **inside** the chart component, which is inside:

1. A scrollable content area (`overflow-y-auto`)
2. A modal dialog
3. A modal overlay with `animate-in fade-in` animation

When CSS animations involve `opacity` or when elements have certain properties, they can create new stacking contexts that affect how `position: fixed` children are rendered.

Additionally, `position: fixed` inside a scrollable container can behave unexpectedly because the fixed element is still part of the DOM tree within that container.

---

## Solution

**Use React Portal to render tooltips directly to `document.body`**, completely outside the modal/chart DOM hierarchy. This ensures:

1. Tooltip is truly fixed to the viewport
2. No interference from parent stacking contexts, transforms, or scroll containers
3. `event.clientX/clientY` coordinates work correctly

### Implementation

Use `ReactDOM.createPortal()` to render the tooltip:

```typescript
import { createPortal } from 'react-dom';

// In the component render:
{hoveredDay && tooltipPos && createPortal(
  <div
    className="fixed z-[10000] px-3 py-2 rounded-lg shadow-lg text-xs pointer-events-none"
    style={{
      left: tooltipPos.x,
      top: tooltipPos.y - TOOLTIP_OFFSET,
      transform: 'translate(-50%, -100%)',
      // ... other styles
    }}
  >
    {/* tooltip content */}
  </div>,
  document.body
)}
```

---

## Files to Modify

| File | Change |
|------|--------|
| `AgentThroughputChart.tsx` | Use createPortal for tooltip |
| `AgentUsageChart.tsx` | Use createPortal for tooltip |
| `ThroughputTrendsChart.tsx` | Use createPortal for tooltip |
| `DurationTrendsChart.tsx` | Use createPortal for tooltip |
| `AutoRunStats.tsx` | Use createPortal for tooltip |

---

## Additional Considerations

1. **Z-index**: Use `z-[10000]` to ensure tooltip appears above the modal (which uses `z-[9999]`)
2. **Cleanup**: Portal automatically unmounts when component unmounts
3. **Accessibility**: Tooltip remains non-interactive with `pointer-events-none`

---

## Testing

1. TypeScript compilation passes
2. Renderer build succeeds
3. Verify tooltips appear at correct mouse position
4. Verify tooltips work for data points at all chart positions
