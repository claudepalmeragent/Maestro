# Large File SSH Stats Enhancement

## Problem Statement

Some Claude session files on SSH remotes exceed the 10MB `maxBuffer` limit in `execFileNoThrow`, causing "File too large to read via SSH" errors. This prevents Global Statistics from including these sessions.

From logs:
```
[WARN] Failed to read remote Claude session: .../09367a8e-db07-4b5b-904a-e5c2f3308df7.jsonl on maestro-planner (claude cloud)
  error: 'File too large to read via SSH: ...'
```

## Current Implementation

- `readFileRemote()` uses `ssh cat <file>` to read entire file
- `execFileNoThrow()` has `EXEC_MAX_BUFFER = 10 * 1024 * 1024` (10MB)
- `parseClaudeSessionContent()` uses regex to extract stats from content:
  - `"type"\s*:\s*"user"` - count user messages
  - `"type"\s*:\s*"assistant"` - count assistant messages
  - `"input_tokens"\s*:\s*(\d+)` - sum input tokens
  - `"output_tokens"\s*:\s*(\d+)` - sum output tokens
  - `"cache_read_input_tokens"\s*:\s*(\d+)` - sum cache read tokens
  - `"cache_creation_input_tokens"\s*:\s*(\d+)` - sum cache creation tokens

## Options

### Option A: Remote-Side Parsing (Recommended)

**Approach**: Run the regex parsing on the remote server itself, returning only the aggregated numbers.

**Pros**:
- Minimal data transfer (just a few numbers)
- Works regardless of file size
- Uses existing SSH connection (no new dependencies)
- Fast execution

**Cons**:
- Requires grep/awk on remote (standard on Linux, may vary on other systems)

**Implementation**:
```bash
# Run aggregation on remote, returns: messages inputTokens outputTokens cacheReadTokens cacheCreationTokens fileSize
ssh remote "
  FILE='/path/to/session.jsonl'
  stat --printf='%s' \"\$FILE\" 2>/dev/null || stat -f'%z' \"\$FILE\"
  echo
  grep -oE '\"type\"\\s*:\\s*\"(user|assistant)\"' \"\$FILE\" | wc -l
  grep -oE '(?<!cache_read_|cache_creation_)\"input_tokens\"\\s*:\\s*[0-9]+' \"\$FILE\" | grep -oE '[0-9]+$' | awk '{s+=\$1}END{print s+0}'
  grep -oE '\"output_tokens\"\\s*:\\s*[0-9]+' \"\$FILE\" | grep -oE '[0-9]+$' | awk '{s+=\$1}END{print s+0}'
  grep -oE '\"cache_read_input_tokens\"\\s*:\\s*[0-9]+' \"\$FILE\" | grep -oE '[0-9]+$' | awk '{s+=\$1}END{print s+0}'
  grep -oE '\"cache_creation_input_tokens\"\\s*:\\s*[0-9]+' \"\$FILE\" | grep -oE '[0-9]+$' | awk '{s+=\$1}END{print s+0}'
"
```

---

### Option B: Streaming via SSH (Spawn with Limited Buffer)

**Approach**: Use `spawn` instead of `execFile` to stream SSH output in chunks, accumulating only regex matches.

**Pros**:
- Handles arbitrarily large files
- No remote dependencies beyond SSH
- Can abort early if needed

**Cons**:
- More complex implementation
- Still transfers entire file content over network
- Slower than remote-side parsing

**Implementation**:
- Create `streamRemoteFile()` in `remote-fs.ts`
- Stream data through regex matchers
- Emit results when stream completes

---

### Option C: rsync with Temp File

**Approach**: Use rsync to copy file locally, parse it, then delete.

**Pros**:
- Reliable file transfer
- Uses proven tool

**Cons**:
- Requires rsync on both ends
- Writes to local disk
- Slower (full file transfer + local parse)
- Adds complexity

**Implementation**:
```bash
rsync -az remote:/path/to/session.jsonl /tmp/maestro-stats-temp/
# parse locally
rm /tmp/maestro-stats-temp/session.jsonl
```

---

### Option D: Increase Buffer Size

**Approach**: Increase `EXEC_MAX_BUFFER` to handle larger files.

**Pros**:
- Simple one-line change

**Cons**:
- Memory concerns for very large files (50MB+ sessions exist)
- Still transfers entire file
- Not a scalable solution

---

### Option E: Hybrid (Recommended Combined Approach)

**Approach**: Try normal read for small files, fall back to remote-side parsing for large files.

1. Check file size first via `stat` (already done in discovery)
2. If size < 10MB: use existing `readFileRemote()`
3. If size >= 10MB: use remote-side aggregation (Option A)

**Pros**:
- Best of both worlds
- No change for small files (fast path)
- Handles large files gracefully
- Minimal network transfer for large files

---

## Recommendation

**Option E (Hybrid)** is recommended because:
1. Small files (majority) continue using fast, simple approach
2. Large files use efficient remote-side aggregation
3. No new dependencies required
4. Graceful degradation if grep/awk unavailable (fall back to warning)

## Files to Modify

1. `src/main/utils/remote-fs.ts` - Add `parseRemoteClaudeStatsViaGrep()` function
2. `src/main/ipc/handlers/agentSessions.ts` - Update `parseRemoteClaudeSession()` to use hybrid approach

## Open Questions

1. Should we cache the file sizes during discovery to avoid re-checking?
   - **Answer**: Yes, we already get file size in `discoverRemoteClaudeSessionFiles()`

2. What threshold size should trigger remote parsing?
   - **Suggestion**: 8MB (leaves 2MB buffer headroom)

3. Should this be configurable in Settings?
   - **Suggestion**: No, keep it automatic

---

## Approved Option: ___ (to be filled by user)
