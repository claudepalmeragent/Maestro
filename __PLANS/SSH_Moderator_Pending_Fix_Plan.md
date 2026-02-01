# SSH Remote Moderator "Pending" Status Fix Plan

## Problem Summary

When selecting an SSH remote agent as a Group Chat moderator, the moderator shows "pending" status in the Participants tab even after the first message is sent. The moderator appears to work but never transitions out of "pending".

## Root Cause Analysis

### Issue 1: SSH Remote Config Not Persisted

**Location:** `NewGroupChatModal.tsx`, `ModeratorConfig` interface

The `ModeratorConfig` interface only includes:
```typescript
export interface ModeratorConfig {
  customPath?: string;
  customArgs?: string;
  customEnvVars?: Record<string, string>;
}
```

The SSH remote configuration (`sshRemoteConfig`) is tracked in state but NOT included in `buildModeratorConfig()`:

```typescript
// NewGroupChatModal.tsx:160-169
const buildModeratorConfig = useCallback((): ModeratorConfig | undefined => {
  const hasConfig = customPath || customArgs || Object.keys(customEnvVars).length > 0;
  if (!hasConfig) return undefined;
  return {
    customPath: customPath || undefined,
    customArgs: customArgs || undefined,
    customEnvVars: Object.keys(customEnvVars).length > 0 ? customEnvVars : undefined,
  };
}, [customPath, customArgs, customEnvVars]);
```

**Result:** SSH remote configuration is never saved with the group chat.

### Issue 2: Moderator Spawn Bypasses SSH Wrapping

**Location:** `group-chat-router.ts:450-464`

When `routeUserMessage()` spawns the moderator process, it calls `processManager.spawn()` directly:

```typescript
const spawnResult = processManager.spawn({
  sessionId,
  toolType: chat.moderatorAgentId,
  cwd: process.env.HOME || '/tmp',
  command,
  args: finalArgs,
  readOnlyMode: true,
  prompt: fullPrompt,
  // ... no SSH config passed
});
```

This bypasses the SSH command wrapping that's done in `ipc/handlers/process.ts:277-335`, which:
1. Gets the SSH config
2. Builds SSH arguments
3. Wraps the command for remote execution

**Result:** SSH remote moderators run locally (incorrectly) instead of on the remote host.

### Issue 3: No Session ID Emitted

**Location:** `ParticipantCard.tsx:46-47`

```typescript
const agentSessionId = participant.agentSessionId;
const isPending = !agentSessionId;
```

The "pending" status is shown when `agentSessionId` is undefined. For moderators, this is `chat.moderatorAgentSessionId`, which is set by `session-id-listener.ts:65` when the agent emits its session ID.

Since the moderator process doesn't run correctly (runs locally instead of via SSH), it either:
- Fails to start properly
- Doesn't emit the expected session-id output
- Runs a local agent that may not be installed

**Result:** No `session-id` event is emitted, so `moderatorAgentSessionId` is never set.

---

## Implementation Plan

### Phase 1: Extend ModeratorConfig with SSH Remote

**Files to modify:**
- `src/shared/group-chat-types.ts`
- `src/main/group-chat/group-chat-storage.ts`

**Changes:**

1. Add `sshRemoteConfig` to `ModeratorConfig`:

```typescript
// src/shared/group-chat-types.ts
import type { AgentSshRemoteConfig } from '../shared/types';

export interface ModeratorConfig {
  customPath?: string;
  customArgs?: string;
  customEnvVars?: Record<string, string>;
  /** SSH remote configuration for running moderator on remote host */
  sshRemoteConfig?: AgentSshRemoteConfig;
}
```

2. Update `NewGroupChatModal.tsx` to include SSH config:

```typescript
// NewGroupChatModal.tsx:160-169
const buildModeratorConfig = useCallback((): ModeratorConfig | undefined => {
  const hasConfig = customPath || customArgs ||
    Object.keys(customEnvVars).length > 0 ||
    (sshRemoteConfig?.enabled && sshRemoteConfig.remoteId);

  if (!hasConfig) return undefined;

  return {
    customPath: customPath || undefined,
    customArgs: customArgs || undefined,
    customEnvVars: Object.keys(customEnvVars).length > 0 ? customEnvVars : undefined,
    sshRemoteConfig: sshRemoteConfig?.enabled ? sshRemoteConfig : undefined,
  };
}, [customPath, customArgs, customEnvVars, sshRemoteConfig]);
```

3. Same change for `EditGroupChatModal.tsx`

### Phase 2: Implement SSH Command Wrapping in Group Chat Router

**Files to modify:**
- `src/main/group-chat/group-chat-router.ts`

**Approach:**

Extract the SSH command wrapping logic from `ipc/handlers/process.ts` into a shared utility, then use it in `group-chat-router.ts`.

1. Create a new utility file `src/main/utils/ssh-spawn-wrapper.ts`:

```typescript
import type { SshRemoteConfig, AgentSshRemoteConfig } from '../../shared/types';
import { buildSshCommand, BuildSshCommandOptions } from './ssh-command-builder';
import { getSshRemoteConfig, createSshRemoteStoreAdapter } from '../ssh-remote-manager';

export interface SshSpawnConfig {
  command: string;
  args: string[];
  cwd: string;
  prompt?: string;
  customEnvVars?: Record<string, string>;
  sshRemoteConfig?: AgentSshRemoteConfig;
  promptArgs?: (prompt: string) => string[];
  noPromptSeparator?: boolean;
}

export interface SshSpawnResult {
  command: string;
  args: string[];
  cwd: string;
  sshConfig?: SshRemoteConfig;
}

/**
 * Wraps a command for SSH execution if SSH remote config is provided.
 * Returns the original command/args if no SSH config or SSH is disabled.
 */
export async function wrapForSsh(
  config: SshSpawnConfig,
  settingsStore: SettingsStore
): Promise<SshSpawnResult> {
  // If no SSH config or not enabled, return original
  if (!config.sshRemoteConfig?.enabled || !config.sshRemoteConfig.remoteId) {
    return {
      command: config.command,
      args: config.args,
      cwd: config.cwd,
    };
  }

  // Get full SSH remote config
  const sshStoreAdapter = createSshRemoteStoreAdapter(settingsStore);
  const sshResult = getSshRemoteConfig(sshStoreAdapter, {
    sessionSshConfig: config.sshRemoteConfig,
  });

  if (!sshResult.config) {
    // SSH config not found, fall back to local
    return {
      command: config.command,
      args: config.args,
      cwd: config.cwd,
    };
  }

  // Build args with prompt included
  let sshArgs = [...config.args];
  if (config.prompt) {
    if (config.promptArgs) {
      sshArgs = [...sshArgs, ...config.promptArgs(config.prompt)];
    } else if (config.noPromptSeparator) {
      sshArgs = [...sshArgs, config.prompt];
    } else {
      sshArgs = [...sshArgs, '--', config.prompt];
    }
  }

  // Build SSH command
  const sshOptions: BuildSshCommandOptions = {
    command: config.command,
    args: sshArgs,
    cwd: config.sshRemoteConfig.workingDirOverride || config.cwd,
    sshConfig: sshResult.config,
    customEnvVars: config.customEnvVars,
  };

  const sshCommand = buildSshCommand(sshOptions);

  return {
    command: sshCommand.sshPath || 'ssh',
    args: sshCommand.sshArgs,
    cwd: process.env.HOME || '/tmp', // Local cwd for SSH command itself
    sshConfig: sshResult.config,
  };
}
```

2. Update `group-chat-router.ts` to use SSH wrapping:

```typescript
// In routeUserMessage(), before spawning:
import { wrapForSsh } from '../utils/ssh-spawn-wrapper';
import { settingsStore } from '../settings';

// Check if moderator has SSH config
const sshConfig = chat.moderatorConfig?.sshRemoteConfig;

// Get wrapped command if SSH is configured
const spawnConfig = await wrapForSsh({
  command,
  args: finalArgs,
  cwd: process.env.HOME || '/tmp',
  prompt: fullPrompt,
  customEnvVars: configResolution.effectiveCustomEnvVars ??
    getCustomEnvVarsCallback?.(chat.moderatorAgentId),
  sshRemoteConfig: sshConfig,
  promptArgs: agent.promptArgs,
  noPromptSeparator: agent.noPromptSeparator,
}, settingsStore);

// Spawn with wrapped command
const spawnResult = processManager.spawn({
  sessionId,
  toolType: chat.moderatorAgentId,
  cwd: spawnConfig.cwd,
  command: spawnConfig.command,
  args: spawnConfig.args,
  readOnlyMode: true,
  // When using SSH, prompt is already in args
  prompt: spawnConfig.sshConfig ? undefined : fullPrompt,
  contextWindow: getContextWindowValue(agent, agentConfigValues),
  customEnvVars: spawnConfig.sshConfig ? undefined :
    (configResolution.effectiveCustomEnvVars ??
     getCustomEnvVarsCallback?.(chat.moderatorAgentId)),
  promptArgs: spawnConfig.sshConfig ? undefined : agent.promptArgs,
  noPromptSeparator: spawnConfig.sshConfig ? undefined : agent.noPromptSeparator,
  sshRemoteId: spawnConfig.sshConfig?.id,
  sshRemoteHost: spawnConfig.sshConfig?.host,
});
```

3. Apply same pattern to `spawnModeratorSynthesis()` and participant spawning in `group-chat-agent.ts`

### Phase 3: Fix Participants SSH Handling

The same issue affects participants added to group chats. Need to:
1. Store `sshRemoteName` when adding participants from SSH sessions
2. Pass SSH config when spawning participant processes

**Files to modify:**
- `src/main/group-chat/group-chat-agent.ts`

---

## Testing Plan

### Unit Tests

1. **Test SSH config persistence:**
   - Create group chat with SSH remote moderator
   - Verify `moderatorConfig.sshRemoteConfig` is saved in metadata.json
   - Load group chat and verify SSH config is present

2. **Test SSH command wrapping:**
   - Mock `wrapForSsh()` utility
   - Verify correct command transformation for SSH remotes
   - Verify local execution unchanged when no SSH config

### Integration Tests

1. **Test moderator session ID emission:**
   - Create group chat with SSH remote moderator
   - Send message to start moderator
   - Verify `moderatorAgentSessionId` is set after processing
   - Verify "pending" status resolves to session ID

### Manual Testing Checklist

- [ ] Create group chat with local moderator - works as before
- [ ] Create group chat with SSH remote moderator
- [ ] Send first message - moderator runs on remote
- [ ] Verify moderator card shows session ID (not "pending")
- [ ] Add participant from SSH remote session
- [ ] Verify participant card shows session ID (not "pending")

---

## Files Modified Summary

| File | Changes |
|------|---------|
| `src/shared/group-chat-types.ts` | Add `sshRemoteConfig` to `ModeratorConfig` |
| `src/renderer/components/NewGroupChatModal.tsx` | Include SSH config in `buildModeratorConfig()` |
| `src/renderer/components/EditGroupChatModal.tsx` | Same as NewGroupChatModal |
| `src/main/utils/ssh-spawn-wrapper.ts` | New file - SSH command wrapping utility |
| `src/main/group-chat/group-chat-router.ts` | Use SSH wrapping for moderator spawn |
| `src/main/group-chat/group-chat-agent.ts` | Use SSH wrapping for participant spawn |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking local moderators | Low | High | Thorough testing, fallback to local if SSH fails |
| SSH connection timeout | Medium | Medium | Use existing timeout handling from process.ts |
| Breaking existing group chats | Low | Medium | SSH config is optional, existing chats work unchanged |

---

## Success Criteria

1. SSH remote moderators display session ID (not "pending")
2. Local moderators continue to work unchanged
3. SSH remote participants display session ID (not "pending")
4. SSH config is persisted with group chat metadata
5. Edit modal shows correct SSH config for existing group chats
