# SSH Moderator Agent Plan v2

## Problem Analysis

The "New Group Chat" dialog only shows local agents in the moderator selection area, even when SSH remote agents are configured and detected. The filtering logic in `NewGroupChatModal.tsx` and `EditGroupChatModal.tsx` only displays agents that are both:
1. Supported by Maestro (defined in `AGENT_TILES`) AND
2. Detected on the system

SSH agents are not included in `AGENT_TILES` constant, so they don't appear in moderator selection.

## Documentation Validation

According to Maestro documentation, supported configurations include:
- "Any mix of local and remote agents"
- "Agents spread across multiple SSH hosts"

This confirms that SSH agents should be selectable as moderators, as the documentation explicitly states that agents can be spread across multiple SSH hosts.

## Current Implementation

### Key Files:
- `NewGroupChatModal.tsx` - Main implementation for new group chat creation
- `EditGroupChatModal.tsx` - Implementation for editing existing group chats
- `AgentSelectionScreen.tsx` - Agent tile definitions in `AGENT_TILES`

### Filtering Logic:
```typescript
const availableTiles = AGENT_TILES.filter((tile) => {
    if (!tile.supported) return false;
    return detectedAgents.some((a: AgentConfig) => a.id === tile.id);
});
```

## Revised Plan

### Immediate Fix:
Modify the filtering logic to include SSH agents that are detected, even if not explicitly listed in `AGENT_TILES`. The current system architecture needs to be updated to support dynamically detected agents as moderator options.

### Long-term Solution:
1. Update `AGENT_TILES` to include SSH agent support with appropriate indicators
2. Modify filtering logic to show detected SSH agents as selectable moderators
3. Ensure SSH remote configuration is properly integrated with moderator selection
4. Test that SSH agents can be selected as moderators and work correctly in group chats

## Implementation Steps:
1. Analyze how SSH detection works in the current system to understand what agent types are detected
2. Modify filtering logic to include SSH agents in available tiles when they are detected
3. Update UI to properly show SSH agents as selectable moderators with appropriate visual indicators
4. Test that SSH agents work as moderators in group chats

## Key Insight from Documentation
The documentation states "Agents spread across multiple SSH hosts" which directly implies that SSH agents should be selectable as moderators. The system supports remote execution but the UI filtering prevents this functionality from being accessible to users.