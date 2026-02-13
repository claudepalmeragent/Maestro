# Synopsis Session Routing Bug - Follow-up Investigation

**Date**: 2026-02-13
**Status**: Investigation In Progress
**Priority**: Critical
**Related**: `INV_SynopsisSpawnErrorBug_investigation.md`

---

## Executive Summary

After fixing the SSH config issue (ENOENT bug), a new symptom emerged: the synopsis process is capturing data from the INTERACTIVE Claude session instead of its own response. This causes the user's chat response to appear in the synopsis toast instead of in the chat.

---

## Observed Symptoms

1. User sends message to interactive Claude session
2. Claude responds (generates text)
3. The response does NOT appear in the chat window
4. The response DOES appear in the synopsis toast notification
5. The synopsis toast shows: "Interesting! I see you received a synopsis request..."

---

## Analysis

### What Should Happen

```
Interactive Session (sessionId: xxx-ai-tabId)
    │
    ├── User sends message
    ├── Claude responds
    └── Response routed to chat via process:data with sessionId=xxx-ai-tabId

Synopsis Process (sessionId: xxx-synopsis-timestamp)
    │
    ├── Spawns with --resume to continue same Claude session
    ├── Sends synopsis prompt
    ├── Claude responds with synopsis
    └── Response routed to synopsis via process:data with sessionId=xxx-synopsis-timestamp
```

### What Is Actually Happening

```
Interactive Session (sessionId: xxx-ai-tabId)
    │
    ├── User sends message
    ├── Claude responds
    └── Response MISSING from chat

Synopsis Process (sessionId: xxx-synopsis-timestamp)
    │
    ├── Spawns with --resume
    ├── Synopsis prompt sent...
    └── Response captured = INTERACTIVE session's response (wrong!)
```

---

## Hypotheses

### Hypothesis 1: SSH Resume Hijacks Session Output

When two processes resume the same Claude session via SSH:
- The second process (synopsis) might "steal" the output stream
- The Claude session only has one stdout, so both resume commands share it
- The last process to connect gets all output

**Evidence**: The synopsis captured interactive response, interactive got nothing.

### Hypothesis 2: Timing Race Condition

The synopsis spawns while the interactive session is still processing:
- Both are active simultaneously
- SSH connection multiplexing causes output mixing
- The synopsis listener happens to catch the data first

**Evidence**: Synopsis ran after user query (on exit handler), but timing is tight.

### Hypothesis 3: Process ID Collision in SSH Context

The SSH wrapper might be modifying or losing the Maestro session ID:
- Local process has unique ID: `xxx-synopsis-timestamp`
- SSH connection might route output back with wrong ID
- Main process receives data but misattributes it

**To investigate**: Check how SSH commands are built and how output is associated with session IDs.

---

## Key Code Locations to Investigate

1. **SSH Command Building**
   - `/app/Maestro/src/main/ssh-remote-manager.ts` - How args are built
   - `/app/Maestro/src/main/ipc/handlers/process.ts:256-330` - SSH resolution

2. **Process Output Routing**
   - `/app/Maestro/src/main/process-manager/handlers/StdoutHandler.ts` - How data events are emitted
   - `/app/Maestro/src/main/process-listeners/data-listener.ts` - How data is forwarded

3. **Claude Session Resume**
   - How `--resume {sessionId}` affects output routing
   - Whether two processes can resume the same Claude session simultaneously

---

## Critical Questions

1. **Can two processes safely resume the same Claude session simultaneously?**
   - What happens to stdout when the session is "shared"?

2. **How does ProcessManager track which spawned process is which?**
   - Is the Maestro sessionId reliably associated with the correct PTY/child process?

3. **When using SSH, how is output routed back to the correct session?**
   - Is there any shared state that could cause cross-contamination?

---

## Immediate Mitigation Options

### Option A: Serialize Synopsis Execution

Don't spawn synopsis while interactive session is still "connected" to Claude:
- Wait for interactive exit before spawning synopsis
- Problem: Synopsis already runs on exit... but maybe Claude session is still "live"?

### Option B: Don't Resume Interactive Session for Synopsis

Create a FRESH Claude session for synopsis instead of resuming:
- Pass a context summary instead of using `--resume`
- Loses conversation context but avoids session sharing issues

### Option C: Queue Synopsis After Session Cooldown

Add a delay between interactive completion and synopsis spawn:
- Allow Claude session to "settle"
- May help with race conditions

---

## Next Steps

1. Add detailed logging to trace session IDs through the spawn → output → route flow
2. Test if the issue reproduces without SSH (local synopsis)
3. Investigate Claude Code's `--resume` behavior with concurrent connections
4. Consider whether synopsis should use a fresh session instead of resume

---

## Notes

The original fix (passing `sessionSshRemoteConfig`) was correct - it allowed the synopsis to spawn via SSH. The routing issue is a separate bug that was previously masked by the ENOENT failure (the synopsis would fail before it could capture any data).
