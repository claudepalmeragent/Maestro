# Retroactive Data Backfill Plan

**Created:** 2026-02-09
**Status:** Investigation Complete - Ready for Implementation
**Priority:** Medium (Enhancement, not blocking)

---

## Executive Summary

**Good news:** Retroactive backfill IS possible for most missing data.

The primary data source is Claude Code's JSONL session files stored at `~/.claude/projects/<encoded-path>/<session-id>.jsonl`. These files contain the complete token and cost data from every Claude response, including cache tokens that were previously not captured.

---

## Data Sources Identified

### 1. Claude Code Session Files (Primary Source)

**Location:** `~/.claude/projects/<encoded-path>/<session-id>.jsonl`

**Contains:**
- `input_tokens` - per message
- `output_tokens` - per message
- `cache_read_input_tokens` - per message
- `cache_creation_input_tokens` - per message
- `total_cost_usd` - can be recalculated from tokens

**Format:** JSONL (one JSON object per line)

**Example extraction (from claude-session-storage.ts lines 136-162):**
```typescript
// Fast regex-based extraction
const inputMatch = content.match(/"input_tokens"\s*:\s*(\d+)/g);
const outputMatch = content.match(/"output_tokens"\s*:\s*(\d+)/g);
const cacheReadMatch = content.match(/(?<!"cache_)"cache_read_input_tokens"\s*:\s*(\d+)/g);
const cacheCreationMatch = content.match(/"cache_creation_input_tokens"\s*:\s*(\d+)/g);
```

### 2. Session Lifecycle Table (For agent_id)

**Location:** `stats.db` - `session_lifecycle` table

**Contains:**
- `session_id` - can be matched to query_events
- `agent_type` - identifies the agent type
- `project_path` - helps locate session files

### 3. Query Events Table (Existing Data)

**Available for correlation:**
- `session_id` - links to session files
- `start_time` - can match to file timestamps
- `project_path` - locates session directory
- `input_tokens`, `output_tokens` - may already exist (v4+)

---

## Backfill Strategy

### Phase 1: Backfill Cache Tokens & Cost from Session Files

**Algorithm:**

1. Query all `query_events` where `cache_read_input_tokens IS NULL`
2. For each event:
   a. Extract base session ID from `session_id`
   b. Locate the session file at `~/.claude/projects/{encoded-path}/{session-id}.jsonl`
   c. Parse the JSONL file to extract token totals
   d. Calculate `total_cost_usd` using `calculateClaudeCost()`
   e. Update the query_event record

**Matching Strategy:**
- Session files contain timestamps for each message
- Match `query_events.start_time` to message timestamps in JSONL
- For batch sessions (`-batch-{timestamp}`), parse the timestamp suffix
- Aggregate tokens for the relevant time window

**Cost Calculation (from pricing.ts):**
```typescript
const totalCost =
  (inputTokens / 1_000_000) * 3.00 +           // $3/MTok
  (outputTokens / 1_000_000) * 15.00 +         // $15/MTok
  (cacheReadTokens / 1_000_000) * 0.30 +       // $0.30/MTok
  (cacheCreationTokens / 1_000_000) * 3.75;    // $3.75/MTok
```

### Phase 2: Backfill agent_id from Session ID

**Algorithm:**

This is simpler - already done in migration v6:

```sql
UPDATE query_events
SET agent_id = CASE
  WHEN session_id LIKE '%-batch-%' THEN substr(session_id, 1, instr(session_id, '-batch-') - 1)
  WHEN session_id LIKE '%-ai-%' THEN substr(session_id, 1, instr(session_id, '-ai-') - 1)
  WHEN session_id LIKE '%-synopsis-%' THEN substr(session_id, 1, instr(session_id, '-synopsis-') - 1)
  ELSE session_id
END
WHERE agent_id IS NULL;
```

**Status:** Already implemented in migration v6.

---

## Implementation Plan

### Option A: One-Time Migration Script (Recommended)

Create a standalone Node.js script that:

1. Opens the stats database
2. Queries records with missing cache tokens/cost
3. For each record, locates and parses the corresponding session file
4. Aggregates token data by timestamp matching
5. Updates the database record
6. Logs progress and errors

**Pros:**
- Can be run manually when convenient
- Doesn't require app restart
- Can be tested independently
- Progress can be monitored

**Cons:**
- Separate tool to maintain
- User must run it manually

### Option B: Background Migration in App

Add migration logic to the stats initialization that:

1. Runs after standard migrations complete
2. Performs backfill in background (non-blocking)
3. Processes a batch of records per app launch
4. Tracks progress in a metadata table

**Pros:**
- Automatic, no user action required
- Incremental processing over multiple launches

**Cons:**
- More complex
- Could slow app startup
- Harder to debug

### Option C: On-Demand Backfill Button

Add a "Backfill Historical Data" button in Usage Dashboard settings:

1. User clicks button
2. Shows progress modal
3. Processes all missing records
4. Reports completion

**Pros:**
- User-initiated, transparent
- Good UX with progress feedback
- Can be cancelled

**Cons:**
- Requires UI work
- User may not discover feature

---

## Recommended Approach: Option A (Migration Script)

Create `/app/Maestro/scripts/backfill-stats.ts` that:

```typescript
#!/usr/bin/env npx ts-node

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const STATS_DB_PATH = path.join(os.homedir(), 'Library', 'Application Support', 'Maestro', 'stats.db');

interface QueryEventRow {
  id: string;
  session_id: string;
  project_path: string | null;
  start_time: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
  total_cost_usd: number | null;
}

async function main() {
  const db = new Database(STATS_DB_PATH);

  // Find records missing cache tokens or cost
  const missingRecords = db.prepare(`
    SELECT id, session_id, project_path, start_time,
           input_tokens, output_tokens,
           cache_read_input_tokens, cache_creation_input_tokens, total_cost_usd
    FROM query_events
    WHERE cache_read_input_tokens IS NULL
       OR cache_creation_input_tokens IS NULL
       OR total_cost_usd IS NULL
  `).all() as QueryEventRow[];

  console.log(`Found ${missingRecords.length} records to backfill`);

  let updated = 0;
  let notFound = 0;
  let errors = 0;

  for (const record of missingRecords) {
    try {
      const sessionFile = findSessionFile(record.session_id, record.project_path);
      if (!sessionFile) {
        notFound++;
        continue;
      }

      const tokens = parseSessionFile(sessionFile, record.start_time);
      if (tokens) {
        updateRecord(db, record.id, tokens);
        updated++;
      }
    } catch (e) {
      errors++;
      console.error(`Error processing ${record.id}:`, e);
    }
  }

  console.log(`Backfill complete: ${updated} updated, ${notFound} not found, ${errors} errors`);
  db.close();
}

function findSessionFile(sessionId: string, projectPath: string | null): string | null {
  // Strip suffixes to get base session ID
  const baseSessionId = extractBaseAgentId(sessionId);

  // Try to find session file
  // ... implementation
}

function parseSessionFile(filePath: string, targetTime: number): TokenData | null {
  // Read JSONL, aggregate tokens around target time
  // ... implementation
}

function updateRecord(db: Database.Database, id: string, tokens: TokenData): void {
  db.prepare(`
    UPDATE query_events
    SET cache_read_input_tokens = ?,
        cache_creation_input_tokens = ?,
        total_cost_usd = ?
    WHERE id = ?
  `).run(tokens.cacheRead, tokens.cacheCreation, tokens.cost, id);
}

main().catch(console.error);
```

---

## Challenges & Limitations

### 1. Session File Matching

**Challenge:** Query events may have session IDs that don't directly match file names.

**Solution:**
- Extract base session ID (strip -batch-, -ai-, -synopsis- suffixes)
- Search in project directory for matching files
- Fall back to timestamp-based matching

### 2. Aggregated vs. Per-Query Tokens

**Challenge:** Session files contain cumulative tokens across all queries, not per-query.

**Solution:**
- For non-batch queries: Use session totals (single query per file often)
- For batch queries: Parse timestamps in JSONL to isolate query windows
- Alternative: Just update with session totals (less accurate but useful)

### 3. Deleted Session Files

**Challenge:** User may have deleted old session files.

**Solution:**
- Skip records where session file not found
- Log for user awareness
- Consider these permanently unrecoverable

### 4. Remote Sessions

**Challenge:** Remote SSH sessions may have files on remote machine.

**Solution:**
- Check `is_remote` flag
- Skip remote sessions (files not accessible)
- Or require SSH access for complete backfill

### 5. Cross-Platform Paths

**Challenge:** Stats DB and session files may be on different paths per platform.

**Solution:**
- Detect platform and use appropriate paths:
  - macOS: `~/Library/Application Support/Maestro/`
  - Windows: `%APPDATA%\Maestro\`
  - Linux: `~/.config/Maestro/`

---

## Expected Recovery Rates

| Scenario | Recovery Rate | Notes |
|----------|--------------|-------|
| Recent local sessions | 95%+ | Session files likely exist |
| Old local sessions | 50-80% | Some files may be deleted |
| Batch/Auto Run sessions | 90%+ | Files typically preserved |
| Remote SSH sessions | 0% | Files on remote machine |
| Deleted agents | 70% | Files may still exist on disk |

---

## Files to Create

| File | Purpose |
|------|---------|
| `scripts/backfill-stats.ts` | Main backfill script |
| `scripts/backfill-stats.test.ts` | Unit tests |
| `package.json` update | Add `npm run backfill` script |

---

## Testing Plan

1. **Dry run mode**: Add `--dry-run` flag to preview changes without writing
2. **Single record test**: Add `--id <id>` flag to test one record
3. **Backup first**: Recommend `cp stats.db stats.db.backup` before running
4. **Verify results**: Query database after to confirm population

---

## User Instructions (Post-Implementation)

```bash
# Backup your stats database first
cp ~/Library/Application\ Support/Maestro/stats.db ~/stats-backup.db

# Run the backfill script
cd /path/to/Maestro
npm run backfill

# Or with dry-run to preview
npm run backfill -- --dry-run
```

---

---

## Phase 3: Re-Attributing Sessions to Correct Agents

### The Problem

Migration v6 backfilled `agent_id` by parsing `session_id` suffixes, but this only works if:
1. The original `session_id` was correct
2. The base UUID actually corresponds to the right Maestro agent

**Scenarios where attribution may still be wrong:**

1. **Session ID was never correct** - Some edge cases where session_id was malformed
2. **Agent was recreated** - User deleted and recreated an agent with a new UUID
3. **Session files were moved** - Agent's session files exist but under different project path

### Data Sources for Re-Attribution

#### 1. Maestro Sessions Store (Primary)

**Location:** `~/Library/Application Support/Maestro/sessions.json` (or synced location)

**Format:**
```typescript
{
  "sessions": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "name": "Frontend Dev",           // User-assigned agent name
      "toolType": "claude-code",
      "cwd": "/Users/me/projects/app",
      "projectRoot": "/Users/me/projects/app",
      // ... additional fields
    }
  ]
}
```

**Key fields:**
- `id` - The Maestro agent UUID (should match `agent_id` in query_events)
- `name` - User-visible agent name
- `projectRoot` - Can help correlate with query_events.project_path

#### 2. Claude Session Files on Disk

**Location:** `~/.claude/projects/<encoded-path>/<session-id>.jsonl`

The session file names ARE the session UUIDs. If we can find a session file matching a query_event's session_id, we can verify the agent attribution.

#### 3. Session Lifecycle Table

**Schema:**
```sql
session_lifecycle (
  session_id TEXT NOT NULL UNIQUE,  -- Maestro session/agent UUID
  agent_type TEXT NOT NULL,
  project_path TEXT,
  created_at INTEGER NOT NULL,
  closed_at INTEGER,
  duration INTEGER
)
```

**Use:** Can cross-reference to validate that a session_id exists as a known agent.

### Re-Attribution Algorithm

```typescript
async function reattributeSessions(db: Database.Database) {
  // Step 1: Load current Maestro sessions from store
  const sessionsStore = /* load sessions.json */;
  const knownAgentIds = new Set(sessionsStore.sessions.map(s => s.id));

  // Step 2: Find query_events with unknown agent_ids
  const orphanedEvents = db.prepare(`
    SELECT DISTINCT agent_id FROM query_events
    WHERE agent_id NOT IN (
      SELECT session_id FROM session_lifecycle
    )
  `).all();

  // Step 3: For each orphaned agent_id, try to find the correct agent
  for (const { agent_id } of orphanedEvents) {
    // Option A: Check if agent exists in current sessions store
    if (knownAgentIds.has(agent_id)) {
      continue; // Already correct
    }

    // Option B: Try to find matching session file on disk
    const sessionFile = findSessionFileById(agent_id);
    if (sessionFile) {
      // Session exists, agent_id is correct but agent was deleted from UI
      // Could prompt user to decide: keep as-is, or reassign to existing agent
      continue;
    }

    // Option C: Try to match by project_path + time window
    const matchingAgent = findAgentByProjectPath(db, agent_id);
    if (matchingAgent) {
      // Reassign to matching agent
      db.prepare(`
        UPDATE query_events SET agent_id = ? WHERE agent_id = ?
      `).run(matchingAgent.id, agent_id);
    }
  }
}

function findAgentByProjectPath(db: Database.Database, orphanAgentId: string): StoredSession | null {
  // Get project_path from orphaned events
  const event = db.prepare(`
    SELECT project_path FROM query_events WHERE agent_id = ? LIMIT 1
  `).get(orphanAgentId);

  if (!event?.project_path) return null;

  // Find agents with matching project path
  const sessionsStore = /* load sessions.json */;
  return sessionsStore.sessions.find(s =>
    s.projectRoot === event.project_path || s.cwd === event.project_path
  );
}
```

### Re-Attribution Options

#### Option 1: Automatic (Based on project_path)

Match orphaned records to agents with the same `projectRoot`:

```sql
-- Find potential matches
SELECT q.agent_id as orphan_id, q.project_path, s.id as match_id, s.name
FROM query_events q
JOIN sessions_store s ON q.project_path = s.projectRoot
WHERE q.agent_id NOT IN (SELECT id FROM sessions_store)
GROUP BY q.agent_id;
```

**Pros:** Automatic, no user input needed
**Cons:** May misattribute if multiple agents share a project path

#### Option 2: Interactive Reassignment

Add a "Reassign Stats" feature in Usage Dashboard:

1. Show orphaned agent_ids with their stats
2. Let user select which current agent to reassign to
3. Update all matching query_events

**Pros:** User has full control, accurate
**Cons:** Requires UI work, manual effort

#### Option 3: Merge by Name Pattern

If agent names follow a pattern, match by name similarity:

```sql
-- Example: Match "Frontend Dev" to "frontend-dev" or "Frontend Developer"
UPDATE query_events
SET agent_id = (
  SELECT id FROM sessions_store
  WHERE LOWER(name) LIKE '%frontend%'
  LIMIT 1
)
WHERE agent_id = 'orphaned-uuid';
```

**Pros:** Can batch-process similar names
**Cons:** Fragile, depends on naming conventions

### Recommended Approach for Re-Attribution

**Hybrid: Automatic + Interactive**

1. **Automatic Phase:**
   - Match by exact `project_path` when there's only one candidate
   - Log matches for review

2. **Interactive Phase:**
   - For ambiguous cases, prompt user via CLI or UI
   - Show: orphaned ID, query count, project path, suggested matches
   - Let user confirm or manually select

3. **Cleanup Phase:**
   - Records that can't be matched remain with original agent_id
   - They'll appear as "Unknown Agent" in charts (truncated UUID fallback)

### Script Addition for Re-Attribution

Add to `scripts/backfill-stats.ts`:

```typescript
// Phase 3: Re-attribution
async function reattributeOrphanedSessions(db: Database.Database) {
  const sessionsPath = path.join(
    os.homedir(),
    'Library/Application Support/Maestro/sessions.json'
  );

  if (!fs.existsSync(sessionsPath)) {
    console.log('Sessions store not found, skipping re-attribution');
    return;
  }

  const sessionsData = JSON.parse(fs.readFileSync(sessionsPath, 'utf-8'));
  const knownAgentIds = new Set(sessionsData.sessions.map((s: any) => s.id));

  // Find orphaned agent_ids
  const orphaned = db.prepare(`
    SELECT DISTINCT agent_id, project_path, COUNT(*) as event_count
    FROM query_events
    GROUP BY agent_id
    HAVING agent_id NOT IN (${[...knownAgentIds].map(() => '?').join(',')})
  `).all(...knownAgentIds);

  console.log(`Found ${orphaned.length} orphaned agent IDs`);

  for (const record of orphaned) {
    // Try to find matching agent by project path
    const match = sessionsData.sessions.find(
      (s: any) => s.projectRoot === record.project_path
    );

    if (match && match.id !== record.agent_id) {
      console.log(`Reassigning ${record.event_count} events: ${record.agent_id} -> ${match.id} (${match.name})`);

      if (!DRY_RUN) {
        db.prepare(`
          UPDATE query_events SET agent_id = ? WHERE agent_id = ?
        `).run(match.id, record.agent_id);
      }
    } else {
      console.log(`No match found for ${record.agent_id} (${record.event_count} events)`);
    }
  }
}
```

---

## Complete Backfill Script Outline

The final `scripts/backfill-stats.ts` should include:

1. **Phase 1: Cache Tokens & Cost** - Parse JSONL files, update missing token/cost data
2. **Phase 2: Agent ID (Already done by v6)** - Verify/fix suffix stripping
3. **Phase 3: Re-Attribution** - Match orphaned agent_ids to current agents

```bash
# Usage
npm run backfill                    # Run all phases
npm run backfill -- --dry-run       # Preview changes
npm run backfill -- --phase 1       # Only cache tokens
npm run backfill -- --phase 3       # Only re-attribution
npm run backfill -- --interactive   # Prompt for ambiguous re-attributions
```

---

## Conclusion

**Retroactive backfill IS feasible** for most local sessions. The Claude Code JSONL files contain all the token and cost data needed. The main limitations are:

1. Remote sessions (files not accessible)
2. Deleted session files (unrecoverable)
3. Very old sessions before Claude Code stored token data

**For re-attribution:**
- Automatic matching by project_path works for most cases
- Interactive mode handles ambiguous cases
- Orphaned records fall back to truncated UUID display

For the majority of recent local usage, we can recover 90%+ of the missing data and correctly attribute sessions to agents.
