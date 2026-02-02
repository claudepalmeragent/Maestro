# SSH Moderator Agent Plan v3

## Executive Summary

SSH agents do not appear in the moderator selection dropdown in Group Chat dialogs. This plan provides a complete, actionable implementation to fix this issue with specific code changes, testing strategy, and UI considerations.

---

## Problem Analysis

### Root Cause
The filtering logic in `NewGroupChatModal.tsx` and `EditGroupChatModal.tsx` only displays agents that exist in the `AGENT_TILES` constant:

```typescript
// Current filtering logic (NewGroupChatModal.tsx:232-235, EditGroupChatModal.tsx:272-275)
const availableTiles = AGENT_TILES.filter((tile) => {
  if (!tile.supported) return false;
  return detectedAgents.some((a: AgentConfig) => a.id === tile.id);
});
```

This logic:
1. Only shows agents defined in `AGENT_TILES`
2. Requires `tile.supported === true`
3. Matches against `detectedAgents` by ID

**Problem:** SSH remote agents are the same agent types (claude-code, codex, etc.) but detected on remote hosts. The current logic doesn't distinguish between local and remote detection contexts, and the modals don't pass SSH remote configuration to the detection call.

### Documentation Validation
Per Maestro documentation:
- "Any mix of local and remote agents" is supported
- "Agents spread across multiple SSH hosts" is explicitly mentioned

This confirms SSH agents **should** be selectable as moderators.

---

## Technical Investigation Findings

### AgentConfig Structure
**File:** `/app/Maestro/src/shared/types.ts` (Lines 112-122)

```typescript
export interface AgentConfig {
  id: string;                    // e.g., 'claude-code'
  name: string;                  // e.g., 'Claude Code'
  binaryName: string;            // e.g., 'claude'
  command: string;               // Command to execute
  args: string[];                // CLI arguments
  available: boolean;            // Whether agent is installed
  path?: string;                 // Path to binary
  capabilities: AgentCapabilities;
  error?: string;                // SSH connection errors (runtime)
}
```

### SSH Remote Configuration
**File:** `/app/Maestro/src/shared/types.ts` (Lines 254-270)

```typescript
export interface SshRemoteConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  privateKeyPath: string;
  enabled: boolean;
}

export interface AgentSshRemoteConfig {
  enabled: boolean;
  remoteId: string | null;
  workingDirOverride?: string;
}
```

### Detection API
**File:** `/app/Maestro/src/main/ipc/handlers/agents.ts` (Lines 208-251)

```typescript
// IPC handler supports optional SSH remote ID
ipcMain.handle('agents:detect', async (sshRemoteId?: string) => {
  if (sshRemoteId) {
    // Detect agents on remote host via SSH
    const agents = await detectAgentsRemote(sshConfig);
    return agents;
  }
  // Local detection
  return detectAgentsLocal();
});
```

### Current Modal Implementation Gap
Both `NewGroupChatModal.tsx` and `EditGroupChatModal.tsx`:
1. Have `SshRemoteSelector` component for SSH configuration
2. Store `sshRemoteConfig` state
3. **Do NOT** pass `sshRemoteId` to `window.maestro.agents.detect()`
4. Always detect local agents regardless of SSH selection

---

## Implementation Plan

### Phase 1: Fix Agent Detection in Modals

#### 1.1 Update NewGroupChatModal.tsx

**File:** `/app/Maestro/src/renderer/components/GroupChat/NewGroupChatModal.tsx`

**Change 1: Update detection to use SSH remote (Lines ~87-111)**

```typescript
// BEFORE:
async function detect() {
  const agents = await window.maestro.agents.detect();
  const available = agents.filter((a: AgentConfig) => a.available && !a.hidden);
  setDetectedAgents(available);
  // ...
}

// AFTER:
async function detect() {
  // Pass SSH remote ID if configured for remote agent detection
  const sshRemoteId = sshRemoteConfig?.enabled ? sshRemoteConfig.remoteId : undefined;
  const agents = await window.maestro.agents.detect(sshRemoteId ?? undefined);

  // Check for SSH connection errors
  if (sshRemoteConfig?.enabled) {
    const connectionErrors = agents.filter((a: AgentConfig) => a.error);
    if (connectionErrors.length > 0 && agents.every((a: AgentConfig) => !a.available)) {
      setSshConnectionError(connectionErrors[0].error || 'SSH connection failed');
      setDetectedAgents([]);
      return;
    }
  }

  const available = agents.filter((a: AgentConfig) => a.available && !a.hidden);
  setSshConnectionError(null);
  setDetectedAgents(available);
  // ...
}
```

**Change 2: Add SSH connection error state (near other useState declarations)**

```typescript
const [sshConnectionError, setSshConnectionError] = useState<string | null>(null);
```

**Change 3: Re-detect agents when SSH config changes (add useEffect dependency)**

```typescript
// Update the useEffect that calls detect() to include sshRemoteConfig
useEffect(() => {
  if (isOpen) {
    detect();
  }
}, [isOpen, JSON.stringify(sshRemoteConfig)]);
```

**Change 4: Display SSH connection error in UI (near moderator selection)**

```typescript
{sshConnectionError && (
  <div className="flex items-center gap-2 p-3 rounded-lg mb-4"
    style={{
      backgroundColor: `${theme.colors.error}15`,
      border: `1px solid ${theme.colors.error}`,
    }}
  >
    <AlertTriangle className="w-4 h-4" style={{ color: theme.colors.error }} />
    <span className="text-sm" style={{ color: theme.colors.error }}>
      {sshConnectionError}
    </span>
  </div>
)}
```

#### 1.2 Update EditGroupChatModal.tsx

Apply the same changes to `EditGroupChatModal.tsx`:

**File:** `/app/Maestro/src/renderer/components/GroupChat/EditGroupChatModal.tsx`

1. Add `sshConnectionError` state
2. Update detection function to pass SSH remote ID
3. Add useEffect dependency on `sshRemoteConfig`
4. Add error display UI

---

### Phase 2: Visual Indicators for Remote Agents

#### 2.1 Update Agent Tile Display

When an SSH remote is selected, add visual indicator to show agents are remote.

**File:** `/app/Maestro/src/renderer/components/GroupChat/NewGroupChatModal.tsx`

**In the moderator selection grid, update tile rendering:**

```typescript
{availableTiles.map((tile) => {
  const isSelected = selectedModeratorId === tile.id;
  const isRemote = sshRemoteConfig?.enabled && sshRemoteConfig.remoteId;

  return (
    <button
      key={tile.id}
      onClick={() => setSelectedModeratorId(tile.id)}
      className="relative flex flex-col items-center p-4 rounded-xl border-2 transition-all"
      style={{
        backgroundColor: isSelected ? `${tile.brandColor}15` : theme.colors.surface,
        borderColor: isSelected ? tile.brandColor : theme.colors.border,
      }}
    >
      {/* Remote indicator badge */}
      {isRemote && (
        <div
          className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-xs font-medium"
          style={{
            backgroundColor: theme.colors.primary,
            color: theme.colors.background,
          }}
        >
          Remote
        </div>
      )}

      {/* Agent logo */}
      <AgentLogo agentId={tile.id} size={48} />

      {/* Agent name */}
      <span className="mt-2 font-medium">{tile.name}</span>

      {/* Remote host info */}
      {isRemote && (
        <span className="text-xs opacity-60 mt-1">
          on {getRemoteName(sshRemoteConfig.remoteId)}
        </span>
      )}
    </button>
  );
})}
```

**Add helper function:**

```typescript
const getRemoteName = (remoteId: string | null): string => {
  if (!remoteId) return 'Local';
  const remote = sshRemotes.find(r => r.id === remoteId);
  return remote?.name || remote?.host || 'Remote';
};
```

---

### Phase 3: Persist SSH Configuration with Group Chat

#### 3.1 Update GroupChat Type

**File:** `/app/Maestro/src/shared/types.ts`

Ensure `GroupChatConfig` includes SSH remote configuration:

```typescript
export interface GroupChatConfig {
  id: string;
  name: string;
  moderatorAgentId: string;
  participantAgentIds: string[];
  // Add if not present:
  moderatorSshRemoteConfig?: AgentSshRemoteConfig;
  participantSshRemoteConfigs?: Record<string, AgentSshRemoteConfig>;
}
```

#### 3.2 Save SSH Config on Group Chat Creation

**File:** `/app/Maestro/src/renderer/components/GroupChat/NewGroupChatModal.tsx`

**Update handleCreate function:**

```typescript
const handleCreate = async () => {
  const newGroupChat: GroupChatConfig = {
    id: generateId(),
    name: groupName,
    moderatorAgentId: selectedModeratorId,
    participantAgentIds: selectedParticipantIds,
    // Include SSH configuration
    moderatorSshRemoteConfig: sshRemoteConfig?.enabled ? sshRemoteConfig : undefined,
  };

  await window.maestro.groupChats.create(newGroupChat);
  onClose();
};
```

---

## Testing Strategy

### Unit Tests

#### Test 1: SSH Remote Detection Integration
```typescript
describe('NewGroupChatModal SSH Detection', () => {
  it('should pass SSH remote ID to agent detection when configured', async () => {
    const detectSpy = jest.spyOn(window.maestro.agents, 'detect');

    render(<NewGroupChatModal sshRemoteConfig={{ enabled: true, remoteId: 'remote-1' }} />);

    await waitFor(() => {
      expect(detectSpy).toHaveBeenCalledWith('remote-1');
    });
  });

  it('should show connection error when SSH detection fails', async () => {
    jest.spyOn(window.maestro.agents, 'detect').mockResolvedValue([
      { id: 'claude-code', available: false, error: 'Connection refused' }
    ]);

    render(<NewGroupChatModal sshRemoteConfig={{ enabled: true, remoteId: 'remote-1' }} />);

    await waitFor(() => {
      expect(screen.getByText(/Connection refused/)).toBeInTheDocument();
    });
  });

  it('should re-detect agents when SSH config changes', async () => {
    const detectSpy = jest.spyOn(window.maestro.agents, 'detect');
    const { rerender } = render(<NewGroupChatModal sshRemoteConfig={undefined} />);

    expect(detectSpy).toHaveBeenCalledWith(undefined);

    rerender(<NewGroupChatModal sshRemoteConfig={{ enabled: true, remoteId: 'remote-1' }} />);

    await waitFor(() => {
      expect(detectSpy).toHaveBeenCalledWith('remote-1');
    });
  });
});
```

### Integration Tests

#### Test 2: End-to-End Group Chat with SSH Moderator
```typescript
describe('Group Chat SSH Moderator E2E', () => {
  it('should create group chat with SSH moderator', async () => {
    // Setup: Configure SSH remote
    await setupSshRemote({ id: 'test-remote', host: 'test.example.com' });

    // Open New Group Chat modal
    await click(screen.getByText('New Group Chat'));

    // Select SSH remote from dropdown
    await selectOption(screen.getByLabelText('Location'), 'test-remote');

    // Wait for remote agent detection
    await waitFor(() => {
      expect(screen.getByText('Claude Code')).toBeInTheDocument();
    });

    // Select moderator
    await click(screen.getByText('Claude Code'));

    // Verify remote badge is shown
    expect(screen.getByText('Remote')).toBeInTheDocument();
    expect(screen.getByText('on test.example.com')).toBeInTheDocument();

    // Create group chat
    await click(screen.getByText('Create'));

    // Verify group chat was created with SSH config
    const groupChats = await window.maestro.groupChats.list();
    expect(groupChats[0].moderatorSshRemoteConfig).toEqual({
      enabled: true,
      remoteId: 'test-remote'
    });
  });
});
```

### Manual Testing Checklist

- [ ] **No SSH remotes configured:**
  - Modal shows local agents only
  - No SSH dropdown appears (or shows only "Local Machine")

- [ ] **SSH remote configured, connection succeeds:**
  - SSH dropdown shows available remotes
  - Selecting remote triggers re-detection
  - Available agents on remote appear in moderator list
  - "Remote" badge appears on agent tiles
  - Remote host name shown under agent name

- [ ] **SSH remote configured, connection fails:**
  - Error message displayed (e.g., "Connection refused")
  - No agents shown in moderator selection
  - User can switch back to Local Machine

- [ ] **Mixed local/remote scenarios:**
  - Switching between local and remote updates agent list
  - Previously selected moderator cleared if not available on new target

- [ ] **Edit existing group chat:**
  - SSH configuration loaded from saved group chat
  - Can change from local to remote moderator
  - Can change from remote to local moderator

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/renderer/components/GroupChat/NewGroupChatModal.tsx` | Add SSH detection, error handling, visual indicators |
| `src/renderer/components/GroupChat/EditGroupChatModal.tsx` | Mirror changes from NewGroupChatModal |
| `src/shared/types.ts` | Ensure GroupChatConfig includes SSH fields (if missing) |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| SSH detection timeout slows modal | Medium | Low | Show loading state, use cached detection |
| Breaking existing local-only workflows | Low | High | Ensure undefined sshRemoteConfig works as before |
| UI clutter from remote badges | Low | Low | Badges only shown when SSH is active |

---

## Rollback Plan

If issues arise:
1. Revert changes to `NewGroupChatModal.tsx` and `EditGroupChatModal.tsx`
2. Keep `sshRemoteConfig` state but don't pass to detection
3. SSH selection UI remains but detection stays local-only

---

## Success Criteria

1. ✅ SSH agents appear in moderator dropdown when SSH remote is selected
2. ✅ Visual indicator shows when moderator is remote
3. ✅ SSH connection errors are displayed clearly
4. ✅ Switching between local/remote updates available agents
5. ✅ Group chat persists SSH configuration
6. ✅ Edit modal loads and saves SSH configuration correctly
7. ✅ No regression in local-only workflows

---

## Implementation Order

1. **Phase 1.1** - Update `NewGroupChatModal.tsx` detection logic
2. **Phase 1.2** - Update `EditGroupChatModal.tsx` detection logic
3. **Phase 2** - Add visual indicators for remote agents
4. **Phase 3** - Persist SSH configuration (if not already implemented)
5. **Testing** - Run manual and automated tests
6. **Documentation** - Update user docs if needed
