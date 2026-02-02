# Feature Request: Group Chat Agent Working Label

## Problem Statement

In group chats, when an agent is working, the chat area displays a generic "Agent is working..." message. This is problematic in group chats with multiple agents because users cannot tell which specific agent is currently working.

**Current behavior:**
- Moderator thinking: "Moderator is thinking..." (OK - only one moderator)
- Agent working: "Agent is working..." (NOT OK - doesn't show which agent)

**Desired behavior:**
- Agent working: "{{AGENT_NAME}} is working..." where `{{AGENT_NAME}}` is the actual participant name

## Technical Analysis

### Current Architecture

The system already tracks per-participant working states:

1. **Main Process**: `emitParticipantState(groupChatId, participantName, 'working' | 'idle')` is called in:
   - `group-chat-router.ts:849` - when spawning participant processes
   - `group-chat-router.ts:1444` - when processing participant tasks
   - `exit-listener.ts:214` - when participant finishes (sets to 'idle')

2. **IPC Layer**: `groupChat:participantState` event carries `(groupChatId, participantName, state)`

3. **Renderer State**: `participantStates: Map<string, 'idle' | 'working'>` in `GroupChatContext.tsx` tracks which participants are currently working

4. **UI Display**: `GroupChatMessages.tsx:404-425` displays the typing indicator but only uses the overall `state` prop ('agent-working'), not the individual `participantStates`

### Key Files

| File | Role |
|------|------|
| `src/renderer/components/GroupChatMessages.tsx` | Displays the "Agent is working..." indicator (lines 404-425) |
| `src/renderer/components/GroupChatPanel.tsx` | Container that passes props to GroupChatMessages |
| `src/renderer/App.tsx` | Parent that has `participantStates` but doesn't pass it to GroupChatPanel |
| `src/renderer/contexts/GroupChatContext.tsx` | Stores `participantStates` map |

## Implementation Plan

### Phase 1: Pass participantStates to GroupChatMessages

#### 1.1 Update GroupChatMessages Props

**File:** `src/renderer/components/GroupChatMessages.tsx`

Add new prop to interface (line 24):
```typescript
interface GroupChatMessagesProps {
    // ... existing props
    participantStates?: Map<string, 'idle' | 'working'>;  // NEW
}
```

#### 1.2 Update GroupChatMessages Component

**File:** `src/renderer/components/GroupChatMessages.tsx`

- Destructure new prop in function signature (line 42)
- Modify typing indicator section (lines 404-425) to:
  1. Get list of working participants from `participantStates` map
  2. Display participant name(s) when state is 'agent-working'

**Updated typing indicator logic:**
```typescript
{/* Typing indicator */}
{state !== 'idle' && (
    <div className="flex gap-4 px-6 py-2">
        <div className="w-20 shrink-0" />
        <div
            className="flex-1 min-w-0 p-4 rounded-xl border rounded-tl-none"
            style={{ backgroundColor: theme.colors.bgActivity, borderColor: theme.colors.border }}
        >
            <div className="flex items-center gap-2">
                <div
                    className="w-2 h-2 rounded-full animate-pulse"
                    style={{ backgroundColor: theme.colors.warning }}
                />
                <span className="text-sm" style={{ color: theme.colors.textDim }}>
                    {state === 'moderator-thinking'
                        ? 'Moderator is thinking...'
                        : (() => {
                            // Get working participants from participantStates map
                            const workingParticipants = participantStates
                                ? Array.from(participantStates.entries())
                                    .filter(([_, state]) => state === 'working')
                                    .map(([name]) => name)
                                : [];

                            if (workingParticipants.length === 0) {
                                return 'Agent is working...';  // Fallback
                            } else if (workingParticipants.length === 1) {
                                return `${workingParticipants[0]} is working...`;
                            } else if (workingParticipants.length === 2) {
                                return `${workingParticipants.join(' and ')} are working...`;
                            } else {
                                // 3+ participants: "Agent1, Agent2, and Agent3 are working..."
                                const allButLast = workingParticipants.slice(0, -1).join(', ');
                                const last = workingParticipants[workingParticipants.length - 1];
                                return `${allButLast}, and ${last} are working...`;
                            }
                        })()}
                </span>
            </div>
        </div>
    </div>
)}
```

### Phase 2: Thread participantStates Through Component Hierarchy

#### 2.1 Update GroupChatPanel Props

**File:** `src/renderer/components/GroupChatPanel.tsx`

Add to interface (around line 22):
```typescript
interface GroupChatPanelProps {
    // ... existing props
    participantStates?: Map<string, 'idle' | 'working'>;  // NEW
}
```

Add to destructured props (around line 74) and pass to GroupChatMessages (around line 127).

#### 2.2 Update App.tsx to Pass participantStates

**File:** `src/renderer/App.tsx`

Add `participantStates={participantStates}` to the GroupChatPanel usage (around line 12889-12949).

## File Changes Summary

| File | Changes |
|------|---------|
| `src/renderer/components/GroupChatMessages.tsx` | Add `participantStates` prop, update typing indicator logic |
| `src/renderer/components/GroupChatPanel.tsx` | Add `participantStates` prop, pass to GroupChatMessages |
| `src/renderer/App.tsx` | Pass `participantStates` to GroupChatPanel |

## Edge Cases Handled

1. **No participantStates available**: Falls back to "Agent is working..."
2. **Single agent working**: Shows "{AgentName} is working..."
3. **Two agents working**: Shows "{Agent1} and {Agent2} are working..."
4. **3+ agents working**: Shows "{Agent1}, {Agent2}, and {Agent3} are working..."
5. **participantStates map empty while state is 'agent-working'**: Falls back to "Agent is working..."

## Testing Plan

1. Start a group chat with 2+ participants
2. Send a message that triggers delegation to a single agent
   - Verify: "{AgentName} is working..." appears
3. Send a message that triggers delegation to multiple agents
   - Verify: Proper grammar with "and" conjunction
4. Verify sidebar indicator still works (uses separate logic)
5. Verify moderator thinking still shows "Moderator is thinking..."

## Risk Assessment

**Low Risk:**
- Changes are isolated to prop threading and display logic
- Existing `participantStates` data is already being tracked correctly
- No backend/IPC changes required
- Falls back gracefully if participantStates is undefined
