# Feature Request: Group Chat Thinking Messages - COMPLETED

## Summary

Successfully implemented a "Thinking" toggle button for Group Chat that enables streaming thinking/reasoning messages from the moderator and agents to be displayed in collapsible chat bubbles.

## Implementation Details

### New Components

#### GroupChatThinkingBubble.tsx
- New component at `src/renderer/components/GroupChatThinkingBubble.tsx`
- Displays collapsible bubble with streaming thinking content
- Header shows "Moderator is thinking..." or "{Agent Name} is working..."
- Click header to expand/collapse the thinking content
- Participant-colored left border for visual identification
- Inner content styled with "thinking" badge and dimmed opacity

### Modified Files

#### 1. GroupChatContext.tsx (`src/renderer/contexts/GroupChatContext.tsx`)
- Added `groupChatShowThinking` (boolean) - toggle state
- Added `groupChatThinkingContent` (Map<string, string>) - streaming content per participant
- Added `groupChatThinkingCollapsed` (Map<string, boolean>) - collapsed state per participant
- Added corresponding setters to context value
- Updated `resetGroupChatState` to clear thinking content

#### 2. GroupChatInput.tsx (`src/renderer/components/GroupChatInput.tsx`)
- Added Brain icon import from lucide-react
- Added `showThinking` and `onToggleShowThinking` props
- Added Thinking toggle button styled like existing toggles (Read-only, Enter mode)
- Button uses accentText color when active

#### 3. GroupChatMessages.tsx (`src/renderer/components/GroupChatMessages.tsx`)
- Added import for GroupChatThinkingBubble
- Added props: `showThinking`, `thinkingContent`, `thinkingCollapsed`, `onToggleThinkingCollapsed`
- Updated typing indicator section to conditionally show:
  - ThinkingBubble(s) when showThinking is enabled and content exists
  - Original simple typing indicator otherwise

#### 4. GroupChatPanel.tsx (`src/renderer/components/GroupChatPanel.tsx`)
- Added thinking-related props to interface
- Pass props through to GroupChatMessages and GroupChatInput

#### 5. App.tsx (`src/renderer/App.tsx`)
- Destructure new thinking states from useGroupChat()
- Added IPC listener for `groupChat:thinkingContent`
- Added effect to clear thinking content when state becomes idle
- Wire up all thinking props to GroupChatPanel

#### 6. groupChat.ts IPC Handlers (`src/main/ipc/handlers/groupChat.ts`)
- Added `emitThinkingContent` to groupChatEmitters
- Implementation sends content to renderer via IPC

#### 7. forwarding-listeners.ts (`src/main/process-listeners/forwarding-listeners.ts`)
- Added `parseGroupChatSessionId` helper function
- Extended `thinking-chunk` handler to also emit to group chat when session matches pattern `group-chat-{id}-{participant}`

#### 8. groupChat.ts Preload (`src/main/preload/groupChat.ts`)
- Added `onThinkingContent` IPC listener wrapper

#### 9. global.d.ts (`src/renderer/global.d.ts`)
- Added type declaration for `onThinkingContent`

## How It Works

1. **Toggle Activation**: User clicks the "Thinking" button (with Brain icon) in the Group Chat input area
2. **Streaming Content**: When moderator or agents work, their thinking chunks are:
   - Captured from ProcessManager's `thinking-chunk` events
   - Parsed to identify group chat session and participant
   - Emitted via IPC to the renderer
3. **Display**: Thinking content appears in collapsible bubbles:
   - Default state is collapsed (shows only header)
   - Click to expand and see streaming content
   - Multiple agents can have separate bubbles
4. **Cleanup**: Content clears automatically when chat returns to idle state

## Testing

- ✅ Build passes (main, preload, renderer)
- ✅ Group chat component tests pass (21 tests)
- ✅ TypeScript type checking passes

## Files Changed

| File | Changes |
|------|---------|
| `src/renderer/components/GroupChatThinkingBubble.tsx` | +100 lines (new file) |
| `src/renderer/contexts/GroupChatContext.tsx` | +40 lines |
| `src/renderer/components/GroupChatInput.tsx` | +30 lines |
| `src/renderer/components/GroupChatMessages.tsx` | +69 lines (net) |
| `src/renderer/components/GroupChatPanel.tsx` | +21 lines |
| `src/renderer/App.tsx` | +43 lines |
| `src/main/ipc/handlers/groupChat.ts` | +21 lines |
| `src/main/process-listeners/forwarding-listeners.ts` | +35 lines |
| `src/main/preload/groupChat.ts` | +13 lines |
| `src/renderer/global.d.ts` | +3 lines |

**Total**: ~375 lines added, 11 files modified/created

## Commit

```
feat(group-chat): Add Thinking toggle to show streaming AI reasoning
778634ce
```

## Next Steps for Testing

1. Open a Group Chat session
2. Click the "Thinking" button in the input area (should turn purple when active)
3. Send a message to the moderator
4. Observe the thinking bubble appearing with "Moderator is thinking..."
5. Click the header to expand and see streaming content
6. When agents are delegated to, their thinking bubbles should appear
7. When the response is complete, thinking content should clear
8. Toggle off the Thinking button - no thinking bubbles should appear on next message

## Known Considerations

- Thinking content is only shown when toggle is ON - no retroactive display
- Content clears when state becomes idle (prevents stale content)
- Each participant gets their own bubble when multiple are working
- Default collapsed state for better UX (user chooses to expand)
