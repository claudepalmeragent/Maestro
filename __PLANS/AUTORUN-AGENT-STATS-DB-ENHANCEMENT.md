# Auto Run: Agent Stats DB Enhancement - Proper Agent Attribution

**Plan Reference:** AGENT-STATS-DB-ENHANCEMENT.md
**Estimated Time:** 45-60 minutes
**Prerequisite:** Complete AUTORUN-BUG-FIXES-TOKEN-STATS.md first

---

## Overview

This Auto Run document implements proper agent attribution in the Usage Dashboard charts by:
1. Adding `agent_id` column to the database
2. Storing the Maestro agent ID at insert time
3. Updating aggregation queries to group by agent_id
4. Fixing frontend charts to use exact matching

---

## Phase 1: Database Schema & Types

- [ ] **Task 1.1: Update STATS_DB_VERSION**

  **File:** `src/shared/stats-types.ts`

  Find `STATS_DB_VERSION` and update:
  ```typescript
  export const STATS_DB_VERSION = 6;  // was 5
  ```

- [ ] **Task 1.2: Add agentId to QueryEvent interface**

  **File:** `src/shared/stats-types.ts`

  Find the `QueryEvent` interface and add after `sessionId`:
  ```typescript
  export interface QueryEvent {
    id: string;
    sessionId: string;
    agentId?: string;           // NEW: Maestro agent ID (stable identifier)
    agentType: string;
    // ... rest unchanged
  }
  ```

- [ ] **Task 1.3: Add byAgentIdByDay to StatsAggregation**

  **File:** `src/shared/stats-types.ts`

  Find the `StatsAggregation` interface and add the new field:
  ```typescript
  export interface StatsAggregation {
    // ... existing fields ...

    // NEW: Aggregation by Maestro agent ID (not fragmented session IDs)
    byAgentIdByDay: Record<string, Array<{
      date: string;
      count: number;
      duration: number;
      outputTokens: number;
      avgTokensPerSecond: number;
    }>>;
  }
  ```

- [ ] **Task 1.4: Add agentId to QueryCompleteData**

  **File:** `src/main/process-manager/types.ts`

  Find `QueryCompleteData` interface and add after `sessionId`:
  ```typescript
  export interface QueryCompleteData {
    sessionId: string;
    agentId?: string;           // NEW: Maestro agent ID
    agentType: string;
    // ... rest unchanged
  }
  ```

---

## Phase 2: Database Migration

- [ ] **Task 2.1: Add migrateV6 function**

  **File:** `src/main/stats/migrations.ts`

  Add new migration function (after migrateV5):
  ```typescript
  function migrateV6(db: Database.Database): void {
    logger.info('Migrating stats database to v6: Adding agent_id column', LOG_CONTEXT);

    // Add agent_id column
    db.exec(`ALTER TABLE query_events ADD COLUMN agent_id TEXT`);

    // Create index for efficient GROUP BY queries
    db.exec(`CREATE INDEX IF NOT EXISTS idx_query_events_agent_id ON query_events(agent_id)`);

    // Backfill existing data: Extract base agent ID from session_id
    // Strips -batch-*, -ai-*, -synopsis-* suffixes
    db.exec(`
      UPDATE query_events
      SET agent_id = CASE
        WHEN session_id LIKE '%-batch-%' THEN substr(session_id, 1, instr(session_id, '-batch-') - 1)
        WHEN session_id LIKE '%-ai-%' THEN substr(session_id, 1, instr(session_id, '-ai-') - 1)
        WHEN session_id LIKE '%-synopsis-%' THEN substr(session_id, 1, instr(session_id, '-synopsis-') - 1)
        ELSE session_id
      END
      WHERE agent_id IS NULL
    `);

    logger.info('Migration v6 complete: agent_id column added and backfilled', LOG_CONTEXT);
  }
  ```

- [ ] **Task 2.2: Register migrateV6 in migrations array**

  **File:** `src/main/stats/migrations.ts`

  Find the migrations array (or switch statement) and add migrateV6:
  ```typescript
  // If using array:
  const migrations = [
    // ... existing migrations ...
    { version: 6, migrate: migrateV6 },
  ];

  // Or if using switch:
  case 5:
    migrateV6(db);
  // falls through to set version
  ```

---

## Phase 3: Update Row Mappers & Insert

- [ ] **Task 3.1: Add agent_id to QueryEventRow**

  **File:** `src/main/stats/row-mappers.ts`

  Find `QueryEventRow` interface and add:
  ```typescript
  export interface QueryEventRow {
    id: string;
    session_id: string;
    agent_id: string | null;    // NEW
    agent_type: string;
    // ... rest unchanged
  }
  ```

- [ ] **Task 3.2: Update mapQueryEventRow**

  **File:** `src/main/stats/row-mappers.ts`

  Find `mapQueryEventRow` function and add agentId mapping:
  ```typescript
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

- [ ] **Task 3.3: Update INSERT_SQL**

  **File:** `src/main/stats/query-events.ts`

  Update the INSERT_SQL constant to include agent_id:
  ```typescript
  const INSERT_SQL = `
    INSERT INTO query_events
    (id, session_id, agent_id, agent_type, source, start_time, duration, project_path, tab_id,
     is_remote, input_tokens, output_tokens, tokens_per_second,
     cache_read_input_tokens, cache_creation_input_tokens, total_cost_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  ```

- [ ] **Task 3.4: Update insertQueryEvent function**

  **File:** `src/main/stats/query-events.ts`

  Update the stmt.run() call to include event.agentId:
  ```typescript
  stmt.run(
    id,
    event.sessionId,
    event.agentId ?? null,      // NEW - add after sessionId
    event.agentType,
    event.source,
    // ... rest unchanged
  );
  ```

---

## Phase 4: Update Data Pipeline

- [ ] **Task 4.1: Add extractBaseAgentId helper to ExitHandler**

  **File:** `src/main/process-manager/handlers/ExitHandler.ts`

  Add this private method to the ExitHandler class:
  ```typescript
  /**
   * Extract the base Maestro agent ID from a session ID.
   * Strips batch/ai/synopsis suffixes to get the stable agent identifier.
   */
  private extractBaseAgentId(sessionId: string): string {
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

- [ ] **Task 4.2: Emit agentId in query-complete event**

  **File:** `src/main/process-manager/handlers/ExitHandler.ts`

  Find where `this.emitter.emit('query-complete', ...)` is called and add agentId:
  ```typescript
  this.emitter.emit('query-complete', sessionId, {
    sessionId,
    agentId: this.extractBaseAgentId(sessionId),  // NEW
    agentType: toolType,
    source: managedProcess.querySource,
    // ... rest unchanged
  });
  ```

- [ ] **Task 4.3: Pass agentId in stats-listener**

  **File:** `src/main/process-listeners/stats-listener.ts`

  Find where `insertQueryEvent` is called and add agentId:
  ```typescript
  insertQueryEvent(db, {
    sessionId: data.sessionId,
    agentId: data.agentId,        // NEW
    agentType: data.agentType,
    // ... rest unchanged
  });
  ```

---

## Phase 5: Update Aggregation Queries

- [ ] **Task 5.1: Add queryByAgentIdByDay function**

  **File:** `src/main/stats/aggregations.ts`

  Add new function (after queryBySessionByDay):
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

    const result: Record<
      string,
      Array<{
        date: string;
        count: number;
        duration: number;
        outputTokens: number;
        avgTokensPerSecond: number;
      }>
    > = {};
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

- [ ] **Task 5.2: Call queryByAgentIdByDay in getAggregatedStats**

  **File:** `src/main/stats/aggregations.ts`

  Find the `getAggregatedStats` function and add the call:
  ```typescript
  export function getAggregatedStats(
    db: Database.Database,
    range: StatsTimeRange
  ): StatsAggregation {
    // ... existing code ...

    return {
      // ... existing fields ...
      bySessionByDay: queryBySessionByDay(db, startTime),
      byAgentIdByDay: queryByAgentIdByDay(db, startTime),  // NEW
    };
  }
  ```

---

## Phase 6: Update Frontend Charts

- [ ] **Task 6.1: Update AgentUsageChart to use byAgentIdByDay**

  **File:** `src/renderer/components/UsageDashboard/AgentUsageChart.tsx`

  1. Rename `getSessionDisplayName` to `getAgentDisplayName` and use exact matching:
  ```typescript
  function getAgentDisplayName(agentId: string, sessions?: Session[]): string {
    if (sessions) {
      // Exact match - no more startsWith() which caused false positives
      const session = sessions.find((s) => s.id === agentId);
      if (session?.name) {
        return session.name;
      }
    }
    // Fallback to truncated UUID
    return agentId.substring(0, 8).toUpperCase();
  }
  ```

  2. In the useMemo hook, change `data.bySessionByDay` to `data.byAgentIdByDay`:
  ```typescript
  const { agents, chartData, allDates, agentDisplayNames } = useMemo(() => {
    const byAgentIdByDay = data.byAgentIdByDay || {};
    // ... rest of the code, replacing sessionId references with agentId
  }, [data.byAgentIdByDay, sessions]);
  ```

- [ ] **Task 6.2: Update AgentThroughputChart to use byAgentIdByDay**

  **File:** `src/renderer/components/UsageDashboard/AgentThroughputChart.tsx`

  Apply the same changes as Task 6.1:
  1. Rename and update `getSessionDisplayName` to use exact matching
  2. Change `data.bySessionByDay` to `data.byAgentIdByDay`
  3. Update variable names from sessionId to agentId throughout

---

## Phase 7: Testing

- [ ] **Task 7.1: Build and verify no TypeScript errors**

  Run: `npm run build` or `npm run typecheck`

- [ ] **Task 7.2: Verify migration runs**

  1. Start the app
  2. Check developer console for "Migration v6 complete" message
  3. Verify PRAGMA user_version = 6

- [ ] **Task 7.3: Verify backfill worked**

  Query the database:
  ```sql
  SELECT session_id, agent_id FROM query_events LIMIT 10;
  ```
  Verify agent_id is populated for existing records.

- [ ] **Task 7.4: Test new inserts have agent_id**

  1. Send messages in a Claude session
  2. Query:
  ```sql
  SELECT session_id, agent_id FROM query_events ORDER BY start_time DESC LIMIT 5;
  ```
  3. Verify agent_id matches the base session ID

- [ ] **Task 7.5: Test agent attribution in charts**

  1. Create two agents with distinct names (e.g., "Frontend Dev", "Backend API")
  2. Run Auto Run on one agent
  3. Open Usage Dashboard → Agents tab
  4. Verify throughput chart shows correct agent name
  5. Verify all batch sessions aggregate under one agent line

---

## Verification Checklist

After completing all tasks:

- [ ] TypeScript builds without errors
- [ ] PRAGMA user_version = 6
- [ ] agent_id column exists with index
- [ ] Existing records backfilled
- [ ] New inserts have agent_id
- [ ] AgentUsageChart groups correctly by agent
- [ ] AgentThroughputChart groups correctly by agent
- [ ] No stats attributed to wrong agent

---

## Rollback

If issues arise:
1. Database changes are additive (new column)
2. COALESCE in SQL provides backwards compatibility
3. To rollback frontend: revert to using bySessionByDay
4. Charts will work with mixed data (old NULL + new populated)
