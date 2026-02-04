# Feature Request: Project Folders Constant Background Colors

## Summary

Enhance Project Folder color visibility by making background colors always visible for both:
1. **Title bar** - Background color should be visible whether the folder is open or closed
2. **Content container** - When the folder is open, the container holding all groups, chats, and agents should have the same tinted background color

## Current State Analysis

### ProjectFolderHeader.tsx (lines 96-106)
```typescript
const headerStyle: React.CSSProperties = {
    backgroundColor:
        isCollapsed && hasColor
            ? folder.highlightColor + '20' // 20 = ~12% opacity - ONLY when collapsed
            : isDragOver
                ? theme.colors.bgActivity
                : 'transparent',  // ← transparent when expanded!
    borderLeftColor: !isCollapsed && hasColor ? folder.highlightColor : 'transparent',
    borderLeftWidth: !isCollapsed && hasColor ? '3px' : '0px',
    opacity: isDragging ? 0.5 : 1,
};
```

**Issue:** Background color only applied when `isCollapsed && hasColor` is true.

### SessionList.tsx (lines 3069-3088)
```typescript
{/* Folder contents (when expanded) */}
{!folder.collapsed && (
    <div
        className="border-l ml-3"
        style={{
            borderColor: folder.highlightColor || theme.colors.border,
            borderLeftWidth: folder.highlightColor ? '3px' : '1px',
        }}
    >
        {/* folder contents */}
    </div>
)}
```

**Issue:** Content container only has a left border, no background color.

---

## Implementation Plan

### Change 1: Always Show Background Color on Title Bar

**File:** `src/renderer/components/sidebar/ProjectFolderHeader.tsx`

**Location:** Lines 96-106

**Before:**
```typescript
const headerStyle: React.CSSProperties = {
    backgroundColor:
        isCollapsed && hasColor
            ? folder.highlightColor + '20'
            : isDragOver
                ? theme.colors.bgActivity
                : 'transparent',
    // ...
};
```

**After:**
```typescript
const headerStyle: React.CSSProperties = {
    backgroundColor:
        hasColor
            ? folder.highlightColor + '20' // Always show color when folder has one
            : isDragOver
                ? theme.colors.bgActivity
                : 'transparent',
    // ...
};
```

**Explanation:** Remove the `isCollapsed &&` condition so the background color is applied whenever `hasColor` is true, regardless of collapsed state.

---

### Change 2: Add Background Color to Folder Content Container

**File:** `src/renderer/components/SessionList.tsx`

**Location:** Lines 3069-3088

**Before:**
```typescript
{!folder.collapsed && (
    <div
        className="border-l ml-3"
        style={{
            borderColor: folder.highlightColor || theme.colors.border,
            borderLeftWidth: folder.highlightColor ? '3px' : '1px',
        }}
    >
        {/* contents */}
    </div>
)}
```

**After:**
```typescript
{!folder.collapsed && (
    <div
        className="border-l ml-3"
        style={{
            borderColor: folder.highlightColor || theme.colors.border,
            borderLeftWidth: folder.highlightColor ? '3px' : '1px',
            backgroundColor: folder.highlightColor
                ? folder.highlightColor + '10' // 10 = ~6% opacity (subtler than header)
                : 'transparent',
            borderRadius: folder.highlightColor ? '0 4px 4px 0' : undefined,
            paddingLeft: folder.highlightColor ? '2px' : undefined,
        }}
    >
        {/* contents */}
    </div>
)}
```

**Explanation:**
- Add `backgroundColor` with a subtler opacity than the header (`10` = ~6% vs `20` = ~12%)
- Add a small right-side border radius for a polished appearance
- Add minimal left padding to give content some breathing room from the border

---

## Files to Modify

| File | Lines | Change |
|------|-------|--------|
| `src/renderer/components/sidebar/ProjectFolderHeader.tsx` | 96-102 | Remove `isCollapsed &&` condition for backgroundColor |
| `src/renderer/components/SessionList.tsx` | 3069-3088 | Add backgroundColor style to content container |

## Visual Result

**Before:**
- Collapsed folder: Colored background on title bar
- Expanded folder: Only left colored border on title bar, no background color anywhere

**After:**
- Collapsed folder: Colored background on title bar (unchanged)
- Expanded folder:
  - Colored background on title bar (NEW)
  - Colored background on content container (NEW)
  - Left colored border on both (unchanged)

## Testing Checklist

- [ ] Create a project folder with a color - verify title bar shows color
- [ ] Collapse the folder - verify title bar still shows color
- [ ] Expand the folder - verify title bar still shows color (NEW BEHAVIOR)
- [ ] Verify the content container has a subtle background color (NEW BEHAVIOR)
- [ ] Test with multiple colors to ensure all render correctly
- [ ] Test a folder without a color - verify it behaves normally (transparent backgrounds)
- [ ] Verify the empty folder "Drag agents here to organize" placeholder looks correct
- [ ] Verify sessions/groups within the folder are readable against the background

## Risk Assessment

**Very Low Risk** - These are CSS-only styling changes:
- No data model changes
- No behavior changes
- No new components
- Changes are isolated to two specific style blocks

---

## Work Package

**Single Work Package (Frontend Styling Only)**

1. Modify `ProjectFolderHeader.tsx` - Remove collapsed condition for backgroundColor
2. Modify `SessionList.tsx` - Add backgroundColor to content container div

Estimated effort: ~10 lines of code changes
