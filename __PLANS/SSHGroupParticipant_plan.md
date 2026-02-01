# SSH Remote Group Chat Participant Fix - Implementation Plan

## Problem Statement

SSH remote agents could not be properly added as participants to group chats, and even when added, they would not receive follow-up messages from the moderator.

### Symptoms Observed
1. When moderator @mentioned SSH remote sessions, the participant would fail to be added with error: `Agent 'claude-code' is not available`
2. If the participant was successfully added (first message), subsequent @mentions from the moderator were not delivered
3. Participants appeared "Active" with valid session IDs but didn't respond to follow-up queries

### Root Cause Analysis

The group chat system has **three separate code paths** that spawn agent processes:

1. **Moderator Spawning** (`group-chat-router.ts: routeUserMessage()`)
   - Already fixed in previous commits
   - Uses `wrapSpawnWithSsh()` when moderator has SSH config

2. **Participant Addition** (`group-chat-agent.ts: addParticipant()`)
   - Called when a new participant is added via @mention
   - Was checking `agent.available` without considering SSH remote
   - Was NOT wrapping spawn with SSH

3. **Participant Message Routing** (`group-chat-router.ts: routeModeratorResponse()`)
   - Called when moderator sends messages to EXISTING participants
   - Spawns batch processes for each mentioned participant
   - Was checking `agent.available` without considering SSH remote
   - Was NOT wrapping spawn with SSH

The first code path was fixed, but paths #2 and #3 had identical bugs that needed fixing.

---

## Implementation Plan

### Phase 1: Fix addParticipant() - Participant Addition

**Goal:** Allow SSH remote sessions to be added as group chat participants.

#### Step 1.1: Extend Session Info Types
- Add `sshRemoteId` to `SessionInfo` interface in `group-chat-router.ts`
- Add `sshRemoteId` to `SessionOverrides` interface in `group-chat-agent.ts`

#### Step 1.2: Propagate SSH Remote ID
- Update `setGetSessionsCallback()` in `index.ts` to extract `sshRemoteId` from session's `sessionSshRemoteConfig.remoteId`
- Update router's `addParticipant` calls to pass `sshRemoteId` in session overrides

#### Step 1.3: Skip Local Availability Check
- In `addParticipant()`, check if `sessionOverrides.sshRemoteName` is set
- Skip `agent.available` check when SSH remote is configured

#### Step 1.4: Add SSH Spawn Wrapping
- Import `wrapSpawnWithSsh`, `getSettingsStore`, `areStoresInitialized`
- When `sshRemoteId` is present, construct `AgentSshRemoteConfig`
- Call `wrapSpawnWithSsh()` to wrap command/args for SSH execution
- Update spawn call to use wrapped values and pass SSH tracking fields

---

### Phase 2: Fix routeModeratorResponse() - Message Routing

**Goal:** Allow moderator messages to be delivered to SSH remote participants.

#### Step 2.1: Add SSH Remote Detection
- Check if participant has `sshRemoteName` set (stored on participant record)
- Find matching session to get `sshRemoteId`
- Log SSH remote status for debugging

#### Step 2.2: Skip Local Availability Check
- Modify availability check to skip when `participantUsingSshRemote` is true
- Handle null `agent` config gracefully (SSH remote may not have local agent)

#### Step 2.3: Add SSH Spawn Wrapping
- When participant is on SSH remote and `sshRemoteId` is available:
  - Construct `AgentSshRemoteConfig`
  - Call `wrapSpawnWithSsh()` to wrap command/args
  - Update spawn call to use wrapped values
  - Pass SSH tracking fields (`sshRemoteId`, `sshRemoteHost`)

---

## Technical Details

### SSH Detection Logic
```typescript
// For addParticipant (uses sessionOverrides)
const usingSshRemote = !!sessionOverrides?.sshRemoteName;

// For routeModeratorResponse (uses participant record)
const participantUsingSshRemote = !!participant.sshRemoteName;
```

### Availability Check Pattern
```typescript
// OLD (broken for SSH)
if (!agent || !agent.available) {
    throw new Error(`Agent not available`);
}

// NEW (SSH-aware)
if (!usingSshRemote && (!agent || !agent.available)) {
    throw new Error(`Agent not available locally`);
}
```

### SSH Spawn Wrapping Pattern
```typescript
if (usingSshRemote && sshRemoteId) {
    const sshRemoteConfig = {
        enabled: true,
        remoteId: sshRemoteId,
    };

    const sshWrapResult = await wrapSpawnWithSsh({
        command, args, cwd, prompt,
        customEnvVars, sshRemoteConfig,
        binaryName: agent?.binaryName,
        promptArgs: agent?.promptArgs,
        noPromptSeparator: agent?.noPromptSeparator,
    }, getSettingsStore());

    if (sshWrapResult.usedSsh) {
        commandToSpawn = sshWrapResult.command;
        argsToSpawn = sshWrapResult.args;
        cwdToSpawn = sshWrapResult.cwd;
    }
}
```

### Spawn Call Pattern (SSH-aware)
```typescript
processManager.spawn({
    sessionId,
    toolType: agentId,
    cwd: cwdToSpawn,
    command: commandToSpawn,
    args: argsToSpawn,
    // Don't pass when SSH - embedded in command
    prompt: usingSsh ? undefined : prompt,
    customEnvVars: usingSsh ? undefined : envVars,
    promptArgs: usingSsh ? undefined : agent?.promptArgs,
    noPromptSeparator: usingSsh ? undefined : agent?.noPromptSeparator,
    // SSH tracking
    sshRemoteId,
    sshRemoteHost,
});
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/main/group-chat/group-chat-router.ts` | Extend SessionInfo, add SSH handling in routeModeratorResponse |
| `src/main/group-chat/group-chat-agent.ts` | Extend SessionOverrides, add SSH handling in addParticipant |
| `src/main/index.ts` | Extract sshRemoteId in setGetSessionsCallback |

---

## Testing Strategy

1. **Participant Addition Test**
   - Create group chat with any moderator
   - @mention an SSH remote session
   - Verify participant is added successfully
   - Verify participant responds to initial message

2. **Message Routing Test**
   - After participant is added, have moderator send follow-up @mention
   - Verify participant receives and responds to message
   - Repeat for multiple follow-up messages

3. **Mixed Environment Test**
   - Test SSH moderator with SSH participants
   - Test local moderator with SSH participants
   - Test multiple SSH remotes in same group chat
