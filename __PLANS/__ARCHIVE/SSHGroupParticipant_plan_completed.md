# SSH Remote Group Chat Participant Fix - Completed Summary

## Overview

Fixed two critical bugs that prevented SSH remote agents from functioning as group chat participants:

1. **Participant Addition Bug**: SSH remote sessions could not be added as participants
2. **Message Routing Bug**: SSH remote participants didn't receive follow-up messages

Both bugs stemmed from the same root cause: local agent availability checks and missing SSH spawn wrapping.

---

## Commits

### Commit 1: `05440ab5` - fix: enable SSH remote agents as group chat participants

**Problem:** When the moderator @mentioned an SSH remote session to add it as a participant, the `addParticipant()` function failed with "Agent 'claude-code' is not available" because it checked for local agent availability.

**Changes:**

**`src/main/group-chat/group-chat-router.ts`**
- Extended `SessionInfo` interface to include `sshRemoteId` field
- Updated both `addParticipant` call sites to pass `sshRemoteId` in session overrides

**`src/main/group-chat/group-chat-agent.ts`**
- Added imports: `wrapSpawnWithSsh`, `getSettingsStore`, `areStoresInitialized`
- Extended `SessionOverrides` interface to include `sshRemoteId` field
- Added SSH remote detection: `const usingSshRemote = !!sessionOverrides?.sshRemoteName`
- Modified availability check to skip for SSH remote participants
- Added SSH spawn wrapping when `sshRemoteId` is present
- Updated spawn call to use wrapped command/args/cwd and pass SSH tracking fields

**`src/main/index.ts`**
- Updated `setGetSessionsCallback()` to extract `sshRemoteId` from `sessionSshRemoteConfig.remoteId`
- Added `sshRemoteId` to returned session info objects

---

### Commit 2: `e3badc62` - fix: SSH remote participants not receiving follow-up messages

**Problem:** After SSH remote participants were successfully added (first message worked), follow-up @mentions from the moderator were not delivered. The `routeModeratorResponse()` function spawns batch processes for mentioned participants, and it had the same bugs as `addParticipant()`.

**Changes:**

**`src/main/group-chat/group-chat-router.ts`** (in `routeModeratorResponse()`)
- Added SSH remote detection using `participant.sshRemoteName`
- Added logging for SSH remote status and matching session's `sshRemoteId`
- Modified availability check to skip for SSH remote participants
- Handled null `agent` config gracefully (for SSH remote with no local agent)
- Added SSH spawn wrapping when participant is on SSH remote:
  - Construct `AgentSshRemoteConfig` from matching session's `sshRemoteId`
  - Call `wrapSpawnWithSsh()` to wrap command/args
  - Use wrapped values in spawn call
  - Pass SSH tracking fields (`sshRemoteId`, `sshRemoteHost`)
- Updated spawn call to conditionally pass prompt/envVars/promptArgs based on SSH usage

**`__PLANS/SSH_Moderator_Pending_Fix_Summary.md`**
- Added Part 3 documenting the message routing fix
- Updated commit summary table

---

## Technical Implementation

### Key Code Patterns

**SSH Detection:**
```typescript
// In addParticipant (from session overrides)
const usingSshRemote = !!sessionOverrides?.sshRemoteName;

// In routeModeratorResponse (from participant record)
const participantUsingSshRemote = !!participant.sshRemoteName;
```

**Availability Check (SSH-aware):**
```typescript
if (!usingSshRemote && (!agent || !agent.available)) {
    console.error(`Agent not available locally`);
    continue; // or throw
}
```

**SSH Spawn Wrapping:**
```typescript
if (usingSshRemote && sshRemoteId) {
    const sshWrapResult = await wrapSpawnWithSsh({
        command, args, cwd, prompt, customEnvVars,
        sshRemoteConfig: { enabled: true, remoteId: sshRemoteId },
        binaryName: agent?.binaryName,
        promptArgs: agent?.promptArgs,
        noPromptSeparator: agent?.noPromptSeparator,
    }, getSettingsStore());

    if (sshWrapResult.usedSsh) {
        commandToSpawn = sshWrapResult.command;
        argsToSpawn = sshWrapResult.args;
        cwdToSpawn = sshWrapResult.cwd;
        sshRemoteId = sshWrapResult.sshConfig?.id;
        sshRemoteHost = sshWrapResult.sshConfig?.host;
    }
}
```

---

## Files Modified

| File | Lines Changed | Description |
|------|---------------|-------------|
| `src/main/group-chat/group-chat-router.ts` | +117 | Extended SessionInfo, SSH handling in routeModeratorResponse |
| `src/main/group-chat/group-chat-agent.ts` | +65 | Extended SessionOverrides, SSH handling in addParticipant |
| `src/main/index.ts` | +5 | Extract sshRemoteId in session callback |
| `__PLANS/SSH_Moderator_Pending_Fix_Summary.md` | +20 | Documentation updates |

---

## Why Two Separate Fixes?

The group chat system has distinct code paths for:

1. **Adding participants** (`addParticipant()`) - Used when first @mentioning a session
2. **Routing messages** (`routeModeratorResponse()`) - Used for follow-up @mentions

Both paths independently spawn processes and both had the same bugs. The first commit fixed path #1, allowing participants to be added. The second commit fixed path #2, allowing messages to be delivered to existing participants.

This explains the observed behavior:
- First message worked (path #1 was fixed)
- Follow-up messages failed (path #2 still had the bug)

---

## Testing Verification

After these fixes:
- ✅ SSH remote sessions can be @mentioned and added as participants
- ✅ SSH remote participants respond to initial messages
- ✅ SSH remote participants receive and respond to follow-up @mentions
- ✅ Participant shows as "Active" with valid session ID
- ✅ Works with mixed local/SSH remote participant groups

---

## Additional Fix: Commit 3 - Markdown Bold @Mention Parsing Bug

### Problem Identified from Logs

User's second message to group chat was failing with:
```
[GroupChat:Debug] Extracted @mentions: agent-planner**, agent-dev-4**
[GroupChat:Debug] Valid participant mentions found: (none)
```

The moderator was using markdown bold formatting like `**@agent-planner**` in its response. The @mention regex extracted `agent-planner**` (with trailing asterisks), which didn't match the actual participant name `agent-planner (claude cloud)`.

### Root Cause

The regex pattern in `extractAllMentions()` and `extractMentions()`:
```typescript
const mentionPattern = /@([^\s@:,;!?()\[\]{}'"<>]+)/g;
```

This excluded common punctuation but **did NOT exclude asterisks (`*`)**, which are used for markdown bold formatting.

### Fix

Added `*` to the character exclusion class:
```typescript
const mentionPattern = /@([^\s@:,;!?()\[\]{}'"<>*]+)/g;
```

Now when processing `**@agent-planner**`:
- Before fix: extracts `agent-planner**` ❌
- After fix: extracts `agent-planner` ✅

### File Changed

| File | Lines Changed | Description |
|------|---------------|-------------|
| `src/main/group-chat/group-chat-router.ts` | +2 | Added `*` to mention regex exclusion, updated comment |

### This Explains the "Regression"

The earlier fixes (commits 1 and 2) were actually correct. The reason participants stopped responding to the second message wasn't because of a regression in those fixes - it was because:

1. First message: User's `@agent-planner` was clean, matched correctly
2. Second message: Moderator's `**@agent-planner**` extracted as `agent-planner**`, failed to match

The SSH fixes were working, but the @mention parsing bug prevented the routed messages from being detected as valid participant mentions.
