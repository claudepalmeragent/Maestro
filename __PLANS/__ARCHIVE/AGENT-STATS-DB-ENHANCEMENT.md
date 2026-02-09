# Agent Stats DB Enhancement: Proper Agent Attribution

**Created:** 2026-02-08
**Status:** Ready for Implementation
**Priority:** High (Fixes agent attribution in charts)
**Scale Target:** 10x+ agents

---

## Executive Summary

This plan addresses the agent attribution bug in the Usage Dashboard charts (AgentUsageChart, AgentThroughputChart). Currently, stats from Auto Run sessions can be attributed to the wrong agent due to:

1. **Session ID fragmentation**: Auto Run creates IDs like `{uuid}-batch-{timestamp}`, which are stored and grouped as separate sessions
2. **False-positive matching**: `getSessionDisplayName()` uses `startsWith()` which can match the wrong agent if UUIDs share prefixes
3. **No direct agent reference**: The database has no column to store the actual Maestro agent ID

**Solution**: Store the Maestro agent ID directly in the `query_events` table at insert time, enabling correct `GROUP BY agent_id` aggregations.

---

## Problem Analysis

### Current Data Flow

```
Auto Run starts
    ↓
Session ID: a1b2c3d4-e5f6-7890-abcd-ef1234567890
    ↓
Batch mode creates: a1b2c3d4-e5f6-7890-abcd-ef1234567890-batch-1707400000
    ↓
Stored in query_events.session_id
    ↓
SQL: GROUP BY session_id → Fragments data into multiple "sessions"
    ↓
Frontend: getSessionDisplayName() uses startsWith() → May match WRONG agent
    ↓
Chart shows stats under incorrect agent
```

### Root Cause: `getSessionDisplayName()` False Positives

**File:** `src/renderer/components/UsageDashboard/AgentThroughputChart.tsx` (lines 110-130)

```typescript
function getSessionDisplayName(sessionId: string, sessions?: Session[]): string {
  if (sessions) {
    // BUG: This can match the wrong session if UUIDs share a prefix
    const session = sessions.find((s) => sessionId.startsWith(s.id));
    if (session?.name) {
      return session.name;  // Returns wrong agent's name!
    }
  }
  // Fallback to truncated UUID
  return sessionId.substring(0, 8).toUpperCase();
}
```

**Failure mode:**
- Agent A: `a1b2c3d4-xxxx-xxxx-xxxx-aaaaaaaaaaaa`
- Agent B: `a1b2c3d4-xxxx-xxxx-xxxx-bbbbbbbbbbbb`
- Both start with `a1b2c3d4`
- `sessions.find()` returns the FIRST match (array order dependent)
- Agent B's stats attributed to Agent A

### Why This Gets Worse at Scale

With 10x agents:
- Higher probability of UUID prefix collisions
- More batch/synopsis session variants
- Frontend `sessions.find()` becomes O(n) per chart data point
- Unpredictable attribution based on session array order

---

## Solution: Store Agent ID in Database

### Design Principles

1. **Source of truth at write time**: Resolve agent ID when inserting, not when reading
2. **No runtime parsing**: `GROUP BY agent_id` instead of client-side string manipulation
3. **O(1) lookups**: Direct column access, no array scanning
4. **Forward compatible**: New session ID patterns won't break aggregations

### Schema Change

```sql
-- Migration v6
ALTER TABLE query_events ADD COLUMN agent_id TEXT;
CREATE INDEX idx_query_events_agent_id ON query_events(agent_id);
```

### Data Model

| Column | Type | Description |
|--------|------|-------------|
| `agent_id` | TEXT | Maestro agent ID (Session.id from left sidebar) |
| `session_id` | TEXT | Internal session ID (may include -batch-, -ai-, etc. suffixes) |

**Relationship:**
- `agent_id` = The stable Maestro agent identifier (user-visible in sidebar)
- `session_id` = The per-query session identifier (includes variants)
- Many `session_id` values map to one `agent_id`

---

## Implementation Plan

### Phase 1: Database Schema (Migration v6)

**File:** `src/main/stats/migrations.ts`

Add new migration function:
```typescript
function migrateV6(db: Database.Database): void {
  logger.info('Migrating stats database to v6: Adding agent_id column');

  db.exec(`
    ALTER TABLE query_events ADD COLUMN agent_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_query_events_agent_id ON query_events(agent_id);
  `);

  // Backfill existing data: Extract base session ID from session_id
  // Pattern: Strip -batch-*, -ai-*, -synopsis-* suffixes
  db.exec(`
    UPDATE query_events
    SET agent_id = CASE
      WHEN session_id LIKE '%-batch-%' THEN substr(session_id, 1, instr(session_id, '-batch-') - 1)
      WHEN session_id LIKE '%-ai-%' THEN substr(session_id, 1, instr(session_id, '-ai-') - 1)
      WHEN session_id LIKE '%-synopsis-%' THEN substr(session_id, 1, instr(session_id, '-synopsis-') - 1)
      ELSE session_id
    END
    WHERE agent_id IS NULL;
  `);
}
```

**File:** `src/shared/stats-types.ts`

Update version:
```typescript
export const STATS_DB_VERSION = 6;  // was 5
```

### Phase 2: Update Type Definitions

**File:** `src/shared/stats-types.ts`

Update QueryEvent interface:
```typescript
export interface QueryEvent {
  id: string;
  sessionId: string;
  agentId?: string;           // NEW: Maestro agent ID
  agentType: string;
  // ... rest unchanged
}
```

**File:** `src/main/process-manager/types.ts`

Update QueryCompleteData:
```typescript
export interface QueryCompleteData {
  sessionId: string;
  agentId?: string;           // NEW: Maestro agent ID
  agentType: string;
  // ... rest unchanged
}
```

### Phase 3: Update Insert Logic

**File:** `src/main/stats/query-events.ts`

Update INSERT_SQL:
```typescript
const INSERT_SQL = `
  INSERT INTO query_events
  (id, session_id, agent_id, agent_type, source, start_time, duration, project_path, tab_id,
   is_remote, input_tokens, output_tokens, tokens_per_second,
   cache_read_input_tokens, cache_creation_input_tokens, total_cost_usd)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;
```

Update insertQueryEvent:
```typescript
export function insertQueryEvent(db: Database.Database, event: Omit<QueryEvent, 'id'>): string {
  const id = generateId();
  const stmt = stmtCache.get(db, INSERT_SQL);

  stmt.run(
    id,
    event.sessionId,
    event.agentId ?? null,      // NEW
    event.agentType,
    // ... rest unchanged
  );

  return id;
}
```

**File:** `src/main/stats/row-mappers.ts`

Update QueryEventRow and mapper:
```typescript
export interface QueryEventRow {
  id: string;
  session_id: string;
  agent_id: string | null;    // NEW
  agent_type: string;
  // ... rest unchanged
}

export function mapQueryEventRow(row: QueryEventRow): QueryEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    agentId: row.agent_id ?? undefined,  // NEW
    agentType: row.agent_type,
    // ... rest unchanged
  };
}
```

### Phase 4: Pass Agent ID Through Pipeline

**File:** `src/main/process-manager/handlers/ExitHandler.ts`

Update query-complete emission to include agentId:
```typescript
this.emitter.emit('query-complete', sessionId, {
  sessionId,
  agentId: this.extractBaseAgentId(sessionId),  // NEW: Extract base agent ID
  agentType: toolType,
  // ... rest unchanged
});
```

Add helper method:
```typescript
/**
 * Extract the base Maestro agent ID from a session ID.
 * Strips batch/ai/synopsis suffixes to get the stable agent identifier.
 */
private extractBaseAgentId(sessionId: string): string {
  // Pattern: {uuid} or {uuid}-batch-{timestamp} or {uuid}-ai-{tabId} or {uuid}-synopsis-{timestamp}
  const suffixPatterns = ['-batch-', '-ai-', '-synopsis-'];
  for (const pattern of suffixPatterns) {
    const idx = sessionId.indexOf(pattern);
    if (idx !== -1) {
      return sessionId.substring(0, idx);
    }
  }
  return sessionId;
}
```

**File:** `src/main/process-listeners/stats-listener.ts`

Update to pass agentId to insertQueryEvent:
```typescript
insertQueryEvent(db, {
  sessionId: data.sessionId,
  agentId: data.agentId,        // NEW
  agentType: data.agentType,
  // ... rest unchanged
});
```

### Phase 5: Update Aggregation Queries

**File:** `src/main/stats/aggregations.ts`

Add new function `queryByAgentIdByDay`:
```typescript
function queryByAgentIdByDay(
  db: Database.Database,
  startTime: number
): Record<
  string,
  Array<{
    date: string;
    count: number;
    duration: number;
    outputTokens: number;
    avgTokensPerSecond: number;
  }>
> {
  const perfStart = perfMetrics.start();
  const rows = db
    .prepare(
      `
      SELECT COALESCE(agent_id, session_id) as agent_id,
             date(start_time / 1000, 'unixepoch', 'localtime') as date,
             COUNT(*) as count,
             SUM(duration) as duration,
             COALESCE(SUM(output_tokens), 0) as output_tokens,
             COALESCE(AVG(tokens_per_second), 0) as avg_tokens_per_second
      FROM query_events
      WHERE start_time >= ?
      GROUP BY COALESCE(agent_id, session_id), date(start_time / 1000, 'unixepoch', 'localtime')
      ORDER BY agent_id, date ASC
    `
    )
    .all(startTime) as Array<{
    agent_id: string;
    date: string;
    count: number;
    duration: number;
    output_tokens: number;
    avg_tokens_per_second: number;
  }>;

  const result: Record<string, Array<{ ... }>> = {};
  for (const row of rows) {
    if (!result[row.agent_id]) {
      result[row.agent_id] = [];
    }
    result[row.agent_id].push({
      date: row.date,
      count: row.count,
      duration: row.duration,
      outputTokens: row.output_tokens,
      avgTokensPerSecond: row.avg_tokens_per_second,
    });
  }
  perfMetrics.end(perfStart, 'getAggregatedStats:byAgentIdByDay');
  return result;
}
```

**Note:** Uses `COALESCE(agent_id, session_id)` for backwards compatibility with legacy data.

Update StatsAggregation to include new field:
```typescript
export interface StatsAggregation {
  // ... existing fields ...
  byAgentIdByDay: Record<string, Array<{ date: string; count: number; duration: number; outputTokens: number; avgTokensPerSecond: number }>>;
}
```

### Phase 6: Update Frontend Charts

**File:** `src/renderer/components/UsageDashboard/AgentUsageChart.tsx`

Replace `data.bySessionByDay` with `data.byAgentIdByDay`:
```typescript
const { agents, chartData, allDates, agentDisplayNames } = useMemo(() => {
  const byAgentIdByDay = data.byAgentIdByDay || {};
  // ... rest uses agentId instead of sessionId
}, [data.byAgentIdByDay, sessions]);
```

Update `getSessionDisplayName` to use exact match:
```typescript
function getAgentDisplayName(agentId: string, sessions?: Session[]): string {
  if (sessions) {
    // Exact match - no more startsWith()
    const session = sessions.find((s) => s.id === agentId);
    if (session?.name) {
      return session.name;
    }
  }
  // Fallback to truncated UUID
  return agentId.substring(0, 8).toUpperCase();
}
```

**File:** `src/renderer/components/UsageDashboard/AgentThroughputChart.tsx`

Same changes as AgentUsageChart.tsx.

---

## Files Summary

| File | Changes |
|------|---------|
| `src/shared/stats-types.ts` | Add `agentId` to QueryEvent, increment version to 6, update StatsAggregation |
| `src/main/process-manager/types.ts` | Add `agentId` to QueryCompleteData |
| `src/main/stats/migrations.ts` | Add migrateV6() with ALTER TABLE and backfill |
| `src/main/stats/row-mappers.ts` | Add agent_id column mapping |
| `src/main/stats/query-events.ts` | Update INSERT_SQL and insertQueryEvent |
| `src/main/stats/aggregations.ts` | Add queryByAgentIdByDay function |
| `src/main/process-manager/handlers/ExitHandler.ts` | Extract and emit agentId |
| `src/main/process-listeners/stats-listener.ts` | Pass agentId to insert |
| `src/renderer/components/UsageDashboard/AgentUsageChart.tsx` | Use byAgentIdByDay, exact match |
| `src/renderer/components/UsageDashboard/AgentThroughputChart.tsx` | Use byAgentIdByDay, exact match |

---

## Testing Plan

### Test 1: Migration Runs Correctly
1. Start app with existing database
2. Check PRAGMA user_version = 6
3. Verify agent_id column exists
4. Verify index created
5. Verify backfill populated agent_id for existing records

### Test 2: New Inserts Have agent_id
1. Run a Claude session
2. Query: `SELECT session_id, agent_id FROM query_events ORDER BY start_time DESC LIMIT 5`
3. Verify agent_id is populated and matches base session ID

### Test 3: Auto Run Attribution
1. Create Agent A with name "Frontend Dev"
2. Create Agent B with name "Backend API"
3. Run Auto Run on Agent A
4. Open Usage Dashboard → Agents tab
5. Verify throughput chart shows "Frontend Dev", not "Backend API"

### Test 4: Chart Aggregation
1. Run multiple Auto Run batches on same agent
2. Check AgentThroughputChart
3. Verify all batch sessions aggregate under one agent line, not multiple

### Test 5: Backwards Compatibility
1. Legacy records with NULL agent_id should still display
2. COALESCE fallback to session_id works
3. Charts don't break with mixed data

---

## Rollback Plan

### If Migration Fails
1. Database changes are additive (new column)
2. Application works with NULL agent_id (COALESCE fallback)
3. To fully rollback: Don't increment version, revert code changes

### If Charts Break
1. Revert frontend to use bySessionByDay
2. Backend changes are compatible (extra column ignored)

---

## Performance Considerations

- **Index on agent_id**: Enables fast GROUP BY queries
- **COALESCE in SQL**: Minimal overhead, single column check
- **No client-side parsing**: Removed startsWith() array scanning
- **Scales linearly**: 10x agents = same query performance

---

## Future Enhancements

Once agent_id is in place, these features become possible:
1. **Agent-level dashboards**: Filter all metrics by specific agent
2. **Cost tracking per agent**: Sum total_cost_usd by agent_id
3. **Agent retention metrics**: Track activity patterns per agent
4. **Cross-session agent analytics**: Compare agent performance over time
