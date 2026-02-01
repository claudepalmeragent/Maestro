# SSH Remote Group Chat Fixes - Complete Summary

## Overview

This document summarizes all fixes made to enable SSH remote agents to function properly in group chats, both as moderators and as participants.

---

## Part 1: SSH Remote Moderator "Pending" Status Fix

### Problem
SSH remote agents selected as group chat moderators would show a perpetual "pending" status. The moderator appeared to work but never transitioned out of "pending".

### Root Cause
1. **SSH Remote Config Not Persisted**: The `ModeratorConfig` interface lacked an `sshRemoteConfig` field
2. **Moderator Spawn Bypassed SSH Wrapping**: The spawn called `processManager.spawn()` directly, bypassing SSH wrapping
3. **No Session ID Emitted**: The agent didn't emit the expected session-id output

### Commits
- `dd041c92` - fix: enable SSH remote moderators in group chats
- `56deebc7` - debug: add detailed logging for SSH moderator spawn troubleshooting
- `2e1f0386` - fix: skip local availability check when SSH remote is configured for moderator
- `2adda937` - fix: don't use local cwd path for SSH remote moderator

### Files Modified
| File | Changes |
|------|---------|
| `src/shared/group-chat-types.ts` | Added `AgentSshRemoteConfig` interface, `sshRemoteConfig` field to `ModeratorConfig`, `extractBaseName()` and enhanced `mentionMatches()` |
| `src/renderer/components/NewGroupChatModal.tsx` | Updated `buildModeratorConfig()` to include SSH remote config |
| `src/renderer/components/EditGroupChatModal.tsx` | Updated to include SSH remote config, load existing config when editing |
| `src/main/group-chat/group-chat-moderator.ts` | Added `sshRemoteId` and `sshRemoteHost` to `IProcessManager` interface |
| `src/main/group-chat/group-chat-router.ts` | Added SSH wrapping for moderator spawning, skip local availability check |
| `src/main/utils/ssh-spawn-helper.ts` | New utility for wrapping spawn commands with SSH; fixed to not use local cwd |

---

## Part 2: SSH Remote Participant Fix

### Problem
When SSH remote moderators @mentioned other SSH remote sessions to add them as participants, the addition failed with:
```
Agent 'claude-code' is not available
```

### Root Cause
1. **Local Availability Check**: `addParticipant()` checked for local agent availability, but SSH remote sessions have the agent on the remote host
2. **No SSH Config Propagation**: No SSH configuration was passed through to spawn the participant on the remote

### Commits
- `24921040` - fix: match @mentions to session names with parenthetical descriptions
- Current changes (uncommitted) - fix: enable SSH remote participants in group chats

### Files Modified
| File | Changes |
|------|---------|
| `src/main/group-chat/group-chat-router.ts` | Extended `SessionInfo` to include `sshRemoteId`; updated both `addParticipant` call sites |
| `src/main/group-chat/group-chat-agent.ts` | Added SSH wrapping imports; extended `SessionOverrides` with `sshRemoteId`; skip local availability check for SSH; wrap spawn with SSH |
| `src/main/index.ts` | Updated `setGetSessionsCallback` to extract and pass `sshRemoteId` |

---

## Technical Implementation

### SSH Detection Pattern
```typescript
const usingSshRemote = !!sessionOverrides?.sshRemoteName;
if (!usingSshRemote && (!agentConfig || !agentConfig.available)) {
    throw new Error(`Agent '${agentId}' is not available`);
}
```

### SSH Command Wrapping Pattern
```typescript
if (usingSshRemote && sessionOverrides?.sshRemoteId) {
    const sshRemoteConfig = {
        enabled: true,
        remoteId: sessionOverrides.sshRemoteId,
    };

    const sshWrapResult = await wrapSpawnWithSsh({
        command, args, cwd, prompt,
        customEnvVars, sshRemoteConfig,
        binaryName: agentConfig?.binaryName,
        promptArgs: agentConfig?.promptArgs,
        noPromptSeparator: agentConfig?.noPromptSeparator,
    }, getSettingsStore());

    if (sshWrapResult.usedSsh) {
        commandToSpawn = sshWrapResult.command;
        argsToSpawn = sshWrapResult.args;
        cwdToSpawn = sshWrapResult.cwd;
    }
}
```

### Session Info with SSH Remote ID
```typescript
// In src/main/index.ts setGetSessionsCallback
if (s.sessionSshRemoteConfig?.enabled && s.sessionSshRemoteConfig.remoteId) {
    sshRemoteId = s.sessionSshRemoteConfig.remoteId;
    const sshConfig = getSshRemoteById(sshRemoteId);
    sshRemoteName = sshConfig?.name;
}
return {
    id: s.id,
    name: s.name,
    // ... other fields
    sshRemoteName,
    sshRemoteId,  // NEW: enables participant SSH spawning
};
```

---

## Testing Checklist

1. **Moderator Tests**
   - [ ] Create group chat with SSH remote moderator
   - [ ] Verify moderator responds (not stuck on "pending")
   - [ ] Verify moderator session ID appears in UI

2. **Participant Tests**
   - [ ] Have SSH moderator @mention another SSH remote session
   - [ ] Verify session is successfully added as participant
   - [ ] Verify participant can receive and respond to messages
   - [ ] Verify participant shows correct SSH remote badge in UI

3. **Mixed Environment Tests**
   - [ ] SSH moderator with local participants
   - [ ] Local moderator with SSH participants
   - [ ] Multiple SSH remotes in same group chat

---

## Part 3: SSH Remote Participant Message Routing Fix

### Problem
After SSH remote participants were successfully added and responded to the first message, subsequent messages from the moderator were not delivered. The participant appeared active but didn't receive follow-up @mentions.

### Root Cause
In `routeModeratorResponse()`, when spawning batch processes for mentioned participants, the code checked `agent.available` without considering SSH remote participants. This is a different code path from `addParticipant()` - it's used for routing messages to EXISTING participants.

### Fix
Updated `routeModeratorResponse()` in `group-chat-router.ts` to:
1. Check if participant has `sshRemoteName` set
2. Skip local availability check for SSH remote participants
3. Wrap spawn with SSH using `wrapSpawnWithSsh()` when `sshRemoteId` is available

---

## Summary of All Changes

| Commit | Description |
|--------|-------------|
| `dd041c92` | Enable SSH remote moderators (core infrastructure) |
| `56deebc7` | Add debug logging for troubleshooting |
| `2e1f0386` | Skip local availability check for SSH moderator |
| `2adda937` | Fix cwd path for SSH remote execution |
| `24921040` | Fix @mention matching for parenthetical session names |
| `05440ab5` | Enable SSH remote participants in group chats (addParticipant) |
| (current) | Fix SSH remote participant message routing (routeModeratorResponse) |
