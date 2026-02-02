# Feature Request: Group Chat Thinking Messages

## Overview

Add a "Thinking" toggle button to the Group Chat input area that enables streaming thinking/reasoning messages from the moderator and agents to be displayed in collapsible chat bubbles.

## Current State Analysis

### Existing Infrastructure

1. **Agent Sessions Already Have Thinking Support**
   - `InputArea.tsx:1046-1066`: Thinking toggle button in agent session input
   - `App.tsx:3010-3126`: `onThinkingChunk` handler processes streaming thinking content
   - `TerminalOutput.tsx:462-485`: Renders thinking content with special styling
   - `ThinkingStatusPill.tsx`: Shows status pill when AI is thinking

2. **Group Chat Components**
   - `GroupChatPanel.tsx`: Main container, composes header/messages/input
   - `GroupChatMessages.tsx`: Renders chat bubbles and typing indicator
   - `GroupChatInput.tsx`: Input area with toggles (read-only, enter/cmd+enter)
   - `GroupChatContext.tsx`: State management for group chats

3. **IPC/Backend Infrastructure**
   - `groupChatEmitters` in `groupChat.ts`: Emits messages, state changes, participant states
   - `output-buffer.ts`: Buffers streaming output from group chat processes
   - `group-chat-router.ts`: Routes messages between moderator and participants
   - `process.ts` preload: `onThinkingChunk` IPC event already available

4. **Types**
   - `GroupChatMessage`: `{ timestamp, from, content, readOnly? }`
   - `GroupChatState`: `'idle' | 'moderator-thinking' | 'agent-working'`
   - `LogEntry.source`: includes `'thinking'` for thinking content

## Implementation Plan

### Phase 1: State & Types Setup

#### 1.1 Add Thinking State to GroupChatContext
**File: `src/renderer/contexts/GroupChatContext.tsx`**

Add new state:
```typescript
// Thinking toggle state (per group chat)
groupChatShowThinking: boolean;
setGroupChatShowThinking: React.Dispatch<React.SetStateAction<boolean>>;

// Streaming thinking content per participant (participantName -> content)
groupChatThinkingContent: Map<string, string>;
setGroupChatThinkingContent: React.Dispatch<React.SetStateAction<Map<string, string>>>;

// Collapsed state for thinking bubbles per participant
groupChatThinkingCollapsed: Map<string, boolean>;
setGroupChatThinkingCollapsed: React.Dispatch<React.SetStateAction<Map<string, boolean>>>;
```

#### 1.2 Add New IPC Event for Group Chat Thinking
**File: `src/main/ipc/handlers/groupChat.ts`**

Add new emitter:
```typescript
emitThinkingContent?: (groupChatId: string, participantName: string, content: string) => void;
```

Implementation:
```typescript
groupChatEmitters.emitThinkingContent = (
    groupChatId: string,
    participantName: string,
    content: string
): void => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('groupChat:thinkingContent', groupChatId, participantName, content);
    }
};
```

### Phase 2: Backend Streaming Integration

#### 2.1 Capture Thinking Chunks from Moderator/Agents
**File: `src/main/group-chat/group-chat-router.ts`**

When spawning moderator or participant agents, hook into the process manager's thinking-chunk events:

```typescript
// In routeUserMessage or similar, after spawning:
processManager.on('thinking-chunk', (sessionId: string, content: string) => {
    // Check if this is a group chat session
    const groupChatId = extractGroupChatId(sessionId);
    if (!groupChatId) return;

    const participantName = extractParticipantName(sessionId);
    groupChatEmitters.emitThinkingContent?.(groupChatId, participantName, content);
});
```

Note: The session ID format for moderator is `group-chat-{chatId}-moderator` and for participants follows a similar pattern.

#### 2.2 Helper Functions
**File: `src/main/group-chat/group-chat-router.ts`**

```typescript
function extractGroupChatId(sessionId: string): string | null {
    const match = sessionId.match(/^group-chat-([^-]+)-/);
    return match ? match[1] : null;
}

function extractParticipantName(sessionId: string): string {
    if (sessionId.includes('-moderator')) return 'Moderator';
    // Extract participant name from session ID format
    const match = sessionId.match(/^group-chat-[^-]+-(.+)$/);
    return match ? match[1] : 'Unknown';
}
```

### Phase 3: Frontend UI Components

#### 3.1 Add Thinking Toggle to GroupChatInput
**File: `src/renderer/components/GroupChatInput.tsx`**

Add props:
```typescript
// Show Thinking toggle
showThinking?: boolean;
onToggleShowThinking?: () => void;
```

Add toggle button in the right side of input toolbar (similar to InputArea.tsx):
```tsx
{onToggleShowThinking && (
    <button
        onClick={onToggleShowThinking}
        className={`flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-full cursor-pointer transition-all ${
            showThinking ? '' : 'opacity-40 hover:opacity-70'
        }`}
        style={{
            backgroundColor: showThinking ? `${theme.colors.accentText}25` : 'transparent',
            color: showThinking ? theme.colors.accentText : theme.colors.textDim,
            border: showThinking ? `1px solid ${theme.colors.accentText}50` : '1px solid transparent',
        }}
        title="Show Thinking - Stream AI reasoning in real-time"
    >
        <Brain className="w-3 h-3" />
        <span>Thinking</span>
    </button>
)}
```

#### 3.2 Create ThinkingBubble Component
**File: `src/renderer/components/GroupChatThinkingBubble.tsx`** (NEW)

A collapsible bubble that displays streaming thinking content:

```tsx
interface GroupChatThinkingBubbleProps {
    theme: Theme;
    participantName: string;
    participantColor: string;
    thinkingContent: string;
    isCollapsed: boolean;
    onToggleCollapse: () => void;
    state: 'moderator-thinking' | 'agent-working';
}

export function GroupChatThinkingBubble({
    theme,
    participantName,
    participantColor,
    thinkingContent,
    isCollapsed,
    onToggleCollapse,
    state,
}: GroupChatThinkingBubbleProps) {
    const headerText = state === 'moderator-thinking'
        ? 'Moderator is thinking...'
        : `${participantName} is working...`;

    return (
        <div className="flex gap-4 px-6 py-2">
            <div className="w-20 shrink-0" />
            <div
                className="flex-1 min-w-0 rounded-xl border rounded-tl-none overflow-hidden"
                style={{
                    backgroundColor: theme.colors.bgActivity,
                    borderColor: theme.colors.border,
                    borderLeftWidth: '3px',
                    borderLeftColor: participantColor,
                }}
            >
                {/* Clickable header to toggle collapse */}
                <button
                    onClick={onToggleCollapse}
                    className="w-full flex items-center gap-2 p-3 text-left hover:bg-white/5 transition-colors"
                    style={{ color: participantColor }}
                >
                    <div
                        className="w-2 h-2 rounded-full animate-pulse"
                        style={{ backgroundColor: theme.colors.warning }}
                    />
                    <span className="text-sm font-medium">{headerText}</span>
                    {isCollapsed ? (
                        <ChevronDown className="w-4 h-4 ml-auto opacity-50" />
                    ) : (
                        <ChevronUp className="w-4 h-4 ml-auto opacity-50" />
                    )}
                </button>

                {/* Collapsible thinking content */}
                {!isCollapsed && thinkingContent && (
                    <div
                        className="px-3 pb-3 max-h-64 overflow-y-auto scrollbar-thin"
                        style={{ backgroundColor: `${theme.colors.bgMain}80` }}
                    >
                        {/* Inner bubbles for thinking chunks */}
                        <div
                            className="p-2 rounded text-xs font-mono border-l-2"
                            style={{
                                color: theme.colors.textDim,
                                borderColor: theme.colors.accent,
                                backgroundColor: `${theme.colors.bgActivity}50`,
                            }}
                        >
                            <div className="flex items-center gap-2 mb-1">
                                <span
                                    className="text-[9px] px-1.5 py-0.5 rounded"
                                    style={{
                                        backgroundColor: `${theme.colors.accent}30`,
                                        color: theme.colors.accent,
                                    }}
                                >
                                    thinking
                                </span>
                            </div>
                            <div className="whitespace-pre-wrap" style={{ opacity: 0.7 }}>
                                {thinkingContent}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
```

#### 3.3 Update GroupChatMessages to Show Thinking Bubbles
**File: `src/renderer/components/GroupChatMessages.tsx`**

Add props:
```typescript
/** Show thinking content when enabled */
showThinking?: boolean;
/** Streaming thinking content per participant */
thinkingContent?: Map<string, string>;
/** Collapsed state per participant */
thinkingCollapsed?: Map<string, boolean>;
/** Toggle collapse callback */
onToggleThinkingCollapsed?: (participantName: string) => void;
```

Replace current typing indicator with ThinkingBubble when showThinking is enabled:

```tsx
{/* Thinking/Typing indicator */}
{state !== 'idle' && (
    showThinking && thinkingContent && thinkingContent.size > 0 ? (
        // Render ThinkingBubble for each participant with content
        Array.from(thinkingContent.entries()).map(([name, content]) => (
            <GroupChatThinkingBubble
                key={name}
                theme={theme}
                participantName={name}
                participantColor={getParticipantColor(name === 'Moderator' ? 'Moderator' : name)}
                thinkingContent={content}
                isCollapsed={thinkingCollapsed?.get(name) ?? true}
                onToggleCollapse={() => onToggleThinkingCollapsed?.(name)}
                state={state}
            />
        ))
    ) : (
        // Original simple typing indicator
        <div className="flex gap-4 px-6 py-2">
            {/* ... existing typing indicator ... */}
        </div>
    )
)}
```

### Phase 4: Wire Everything Together

#### 4.1 Update GroupChatPanel Props
**File: `src/renderer/components/GroupChatPanel.tsx`**

Add props:
```typescript
showThinking?: boolean;
onToggleShowThinking?: () => void;
thinkingContent?: Map<string, string>;
thinkingCollapsed?: Map<string, boolean>;
onToggleThinkingCollapsed?: (participantName: string) => void;
```

Pass to children components.

#### 4.2 Handle IPC Events in App.tsx (or GroupChatContext)
**File: `src/renderer/App.tsx`** (in group chat section)

Add listener for thinking content:
```typescript
useEffect(() => {
    const unsubscribeThinking = window.maestro.ipc?.on?.(
        'groupChat:thinkingContent',
        (_event: any, groupChatId: string, participantName: string, content: string) => {
            if (groupChatId !== activeGroupChatId) return;
            if (!groupChatShowThinking) return;

            setGroupChatThinkingContent(prev => {
                const next = new Map(prev);
                const existing = next.get(participantName) || '';
                next.set(participantName, existing + content);
                return next;
            });
        }
    );

    return () => unsubscribeThinking?.();
}, [activeGroupChatId, groupChatShowThinking]);

// Clear thinking content when state becomes idle
useEffect(() => {
    if (groupChatState === 'idle') {
        setGroupChatThinkingContent(new Map());
    }
}, [groupChatState]);
```

#### 4.3 Add IPC Type Declaration
**File: `src/renderer/global.d.ts`** or appropriate preload types

Ensure the new IPC event is typed.

### Phase 5: Integration with Existing Process Manager

#### 5.1 Subscribe to Thinking Chunks
**File: `src/main/group-chat/group-chat-router.ts`** or `src/main/index.ts`

The ProcessManager already emits `thinking-chunk` events. We need to:
1. Subscribe to these events globally or per-group-chat
2. Map session IDs to group chat IDs and participant names
3. Emit to renderer via `groupChatEmitters.emitThinkingContent`

```typescript
// In index.ts or where ProcessManager is initialized
processManager.on('thinking-chunk', (sessionId: string, content: string) => {
    // Check if this is a group chat moderator session
    if (sessionId.startsWith('group-chat-')) {
        const match = sessionId.match(/^group-chat-(.+?)-(moderator|.+)$/);
        if (match) {
            const groupChatId = match[1];
            const participant = match[2] === 'moderator' ? 'Moderator' : match[2];
            groupChatEmitters.emitThinkingContent?.(groupChatId, participant, content);
        }
    }
});
```

## File Changes Summary

### New Files
1. `src/renderer/components/GroupChatThinkingBubble.tsx` - Collapsible thinking bubble

### Modified Files
1. `src/renderer/contexts/GroupChatContext.tsx` - Add thinking state
2. `src/main/ipc/handlers/groupChat.ts` - Add thinking content emitter
3. `src/main/group-chat/group-chat-router.ts` - Hook into thinking chunks
4. `src/renderer/components/GroupChatInput.tsx` - Add Thinking toggle button
5. `src/renderer/components/GroupChatMessages.tsx` - Render thinking bubbles
6. `src/renderer/components/GroupChatPanel.tsx` - Wire props through
7. `src/renderer/App.tsx` - Handle IPC events, manage state
8. `src/main/index.ts` - Subscribe to thinking-chunk events for group chats
9. `src/renderer/global.d.ts` - Type new IPC event (if needed)

## Testing Plan

1. **Unit Tests**
   - Test `GroupChatThinkingBubble` component renders correctly
   - Test collapse/expand functionality
   - Test thinking content accumulation

2. **Integration Tests**
   - Verify thinking toggle appears in GroupChatInput
   - Verify thinking content streams when toggle is ON
   - Verify no thinking content when toggle is OFF
   - Verify content clears when chat returns to idle

3. **Manual Testing**
   - Create group chat, add participants
   - Enable thinking toggle
   - Send message to moderator
   - Verify "Moderator is thinking..." bubble appears
   - Verify streaming content appears below header
   - Click to collapse/expand
   - Verify agent thinking appears when agents are working
   - Verify content clears when response is complete

## Implementation Order

1. Add state to GroupChatContext
2. Create GroupChatThinkingBubble component
3. Add toggle to GroupChatInput
4. Update GroupChatMessages to show thinking bubbles
5. Add IPC emitter in backend
6. Subscribe to thinking-chunk events in main process
7. Handle IPC events in renderer (App.tsx)
8. Wire everything through GroupChatPanel
9. Test end-to-end

## Notes & Considerations

- **Performance**: Use RAF throttling similar to existing thinking chunk handling to batch rapid arrivals
- **Memory**: Clear thinking content map when state becomes idle
- **Collapse Default**: Start collapsed (`true`) for better UX, user clicks to expand
- **Styling**: Match existing thinking display style from TerminalOutput for consistency
- **Edge Cases**:
  - Handle multiple agents working simultaneously (show multiple bubbles)
  - Handle very long thinking content (scroll within bubble)
  - Handle case where thinking toggle is turned OFF mid-stream
