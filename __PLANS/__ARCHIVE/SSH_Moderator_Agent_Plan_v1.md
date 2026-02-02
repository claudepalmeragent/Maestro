Based on my analysis of the codebase, I've identified the core issue. Let me provide you with a clear explanation of what's happening and how to fix it.

## Analysis of the Issue

The problem is in the filtering logic for the moderator selection in both `NewGroupChatModal.tsx` and `EditGroupChatModal.tsx`. 

### Current Filtering Logic

In both files, the code filters agents using this logic:
```typescript
const availableTiles = AGENT_TILES.filter((tile) => {
    if (!tile.supported) return false;
    return detectedAgents.some((a: AgentConfig) => a.id === tile.id);
});
```

This logic only shows agents that are:
1. **Supported by Maestro** (defined in AGENT_TILES) AND
2. **Detected on the system** (available property is true)

### The Problem

Looking at `AGENT_TILES` in `AgentSelectionScreen.tsx`, the current supported agents are:
- `claude-code` (Anthropic's Claude Code)
- `codex` (OpenAI's Codex) 
- `opencode` (Open-source AI coding assistant)

However, **SSH agents are not included in the `AGENT_TILES` list**. This means even if you have SSH agents installed and detected, they won't appear in the moderator selection dropdown.

### The Solution

To make SSH agents appear as moderator options, you need to modify the filtering logic to also consider SSH remote agents that are detected, not just local agents.

## Plan to Fix

1. **Modify the filtering logic** in both `NewGroupChatModal.tsx` and `EditGroupChatModal.tsx` to include SSH remote agents in the available tiles list.

2. **Update the agent detection** to properly detect SSH agents when the SSH remote configuration is active.

3. **Ensure the SSH remote selector is properly integrated** in both modals so users can select which remote to use.

## Key Files to Change

1. **`NewGroupChatModal.tsx`** - Line ~232-235 where `availableTiles` is filtered
2. **`EditGroupChatModal.tsx`** - Line ~271-275 where `availableTiles` is filtered

The fix should allow SSH agents to appear in the moderator selection dropdown when they are detected on remote hosts, but this requires changes to how the filtering logic works since currently the filtering only looks at the `AGENT_TILES` list.

The root issue is that the current architecture only supports the agents listed in `AGENT_TILES` and doesn't dynamically include SSH agents that are detected but not listed in that constant.

## Implementation Approach

The cleanest approach would be to modify the filtering logic to also include detected agents that are SSH-based, but this requires a more complex change to how agent detection and display works. The current system is designed to only show agents from the predefined `AGENT_TILES` list, which is why SSH agents don't appear.

Since this is a complex architectural change, you would need to either:
1. Add SSH agents to `AGENT_TILES` with a special indicator that they're remote
2. Modify the filtering logic to dynamically include SSH agents when they're detected
3. Create a new agent type that specifically handles SSH agents in the moderator selection

The most surgical fix would be to modify the filtering logic to include SSH agents that are detected but not explicitly listed in `AGENT_TILES`.