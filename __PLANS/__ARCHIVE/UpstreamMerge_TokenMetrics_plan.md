# Upstream Merge Plan: Token Metrics Integration

## Summary

Upstream refactored `src/main/stats-db.ts` (1,870 lines) into 13 focused modules under `src/main/stats/`. Our fork added token metrics (inputTokens, outputTokens, tokensPerSecond) that need to be migrated into the new module structure.

---

## Conflict Analysis

### Files in Conflict

| Our File | Status | Upstream Status |
|----------|--------|-----------------|
| `src/main/stats-db.ts` | Modified (token metrics) | **Deleted** → Decomposed to `src/main/stats/` |
| `src/__tests__/main/stats-db.test.ts` | Modified (token metrics) | **Deleted** → Decomposed to `src/__tests__/main/stats/` |

### New Upstream Structure

```
src/main/stats/
├── index.ts           # Re-exports all modules
├── stats-db.ts        # Core StatsDB class (543 lines)
├── aggregations.ts    # getAggregatedStats queries
├── auto-run.ts        # Auto Run session/task CRUD
├── data-management.ts # Clear old data, export CSV
├── migrations.ts      # Migration system
├── query-events.ts    # insertQueryEvent, getQueryEvents
├── row-mappers.ts     # Snake_case → camelCase mappers
├── schema.ts          # SQL table definitions
├── session-lifecycle.ts
├── singleton.ts       # Singleton accessor
├── types.ts           # Internal types
└── utils.ts           # Helper functions
```

---

## Our Changes to Migrate

### 1. Schema Changes (Migration v4)

**Location**: `src/main/stats/migrations.ts`

Add migration v4 for token columns:
```typescript
{
  version: 4,
  description: 'Add token metrics columns to query_events for throughput tracking',
  up: (db) => migrateV4(db),
}

function migrateV4(db: Database.Database): void {
  db.prepare('ALTER TABLE query_events ADD COLUMN input_tokens INTEGER').run();
  db.prepare('ALTER TABLE query_events ADD COLUMN output_tokens INTEGER').run();
  db.prepare('ALTER TABLE query_events ADD COLUMN tokens_per_second REAL').run();
  logger.debug('Added token metrics columns to query_events table', LOG_CONTEXT);
}
```

### 2. Query Event Insert (Token Fields)

**Location**: `src/main/stats/query-events.ts`

Update `INSERT_SQL` and `insertQueryEvent()`:
```typescript
const INSERT_SQL = `
  INSERT INTO query_events (id, session_id, agent_type, source, start_time, duration,
    project_path, tab_id, is_remote, input_tokens, output_tokens, tokens_per_second)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

// Add parameters:
event.inputTokens ?? null,
event.outputTokens ?? null,
event.tokensPerSecond ?? null
```

### 3. Query Event Read (Token Fields)

**Location**: `src/main/stats/row-mappers.ts`

Update `QueryEventRow` interface and mapper:
```typescript
export interface QueryEventRow {
  // ... existing fields
  input_tokens: number | null;
  output_tokens: number | null;
  tokens_per_second: number | null;
}

export function mapQueryEventRow(row: QueryEventRow): QueryEvent {
  return {
    // ... existing fields
    inputTokens: row.input_tokens ?? undefined,
    outputTokens: row.output_tokens ?? undefined,
    tokensPerSecond: row.tokens_per_second ?? undefined,
  };
}
```

### 4. Aggregation Queries (Token Metrics)

**Location**: `src/main/stats/aggregations.ts`

Add token metrics sub-query and update `getAggregatedStats()`:
```typescript
function queryTokenMetrics(db: Database.Database, startTime: number) {
  const perfStart = perfMetrics.start();
  const result = db.prepare(`
    SELECT
      COUNT(*) as queries_with_data,
      COALESCE(SUM(input_tokens), 0) as total_input_tokens,
      COALESCE(SUM(output_tokens), 0) as total_output_tokens,
      COALESCE(AVG(tokens_per_second), 0) as avg_tokens_per_second,
      COALESCE(AVG(output_tokens), 0) as avg_output_tokens
    FROM query_events
    WHERE start_time >= ? AND output_tokens IS NOT NULL
  `).get(startTime);
  perfMetrics.end(perfStart, 'getAggregatedStats:tokenMetrics');
  return result;
}
```

Update `queryByAgentByDay()` and `queryBySessionByDay()` to include token fields:
- Add `SUM(output_tokens)` and `AVG(tokens_per_second)` to GROUP BY queries
- Return `outputTokens` and `avgTokensPerSecond` in result

### 5. Shared Types

**Location**: `src/shared/stats-types.ts`

Already handled by auto-merge - our additions are:
- `QueryEvent`: inputTokens, outputTokens, tokensPerSecond
- `StatsAggregation`: totalOutputTokens, totalInputTokens, avgTokensPerSecond, avgOutputTokensPerQuery, queriesWithTokenData
- Enhanced byDay, byAgentByDay, bySessionByDay with token fields
- `STATS_DB_VERSION = 4`

### 6. Stats Listener

**Location**: `src/main/process-listeners/stats-listener.ts`

Pass token fields to `insertQueryEvent()` (already in our code, may auto-merge).

### 7. Exit Handler

**Location**: `src/main/process-manager/handlers/ExitHandler.ts`

Compute and emit token metrics (already in our code, unaffected by upstream).

### 8. Types

**Location**: `src/main/process-manager/types.ts`

`QueryCompleteData` interface with token fields (already in our code, unaffected by upstream).

---

## Test Changes

### Tests to Add

**Location**: `src/__tests__/main/stats/query-events.test.ts`
- Test insertQueryEvent with token fields
- Test getQueryEvents returns token fields

**Location**: `src/__tests__/main/stats/aggregations.test.ts`
- Test token metrics aggregation
- Test byAgentByDay/bySessionByDay include token data

**Location**: `src/__tests__/main/stats/integration.test.ts`
- Test migration v4 creates token columns
- Test full flow with token data

---

## Implementation Steps

1. **Accept upstream deletion** of old monolithic files:
   ```bash
   git rm src/main/stats-db.ts src/__tests__/main/stats-db.test.ts
   ```

2. **Modify upstream modules** to add token metrics:
   - `src/main/stats/migrations.ts` - Add v4 migration
   - `src/main/stats/query-events.ts` - Add token fields to insert
   - `src/main/stats/row-mappers.ts` - Add token fields to mapper
   - `src/main/stats/aggregations.ts` - Add token queries

3. **Update shared types** (if not auto-merged):
   - `src/shared/stats-types.ts` - Token fields in QueryEvent and StatsAggregation

4. **Update tests**:
   - Add token-related tests to new test files

5. **Verify unchanged files**:
   - `ExitHandler.ts` - Token computation (our code)
   - `stats-listener.ts` - Token pass-through (our code)
   - `types.ts` - QueryCompleteData (our code)

6. **Build and test**

7. **Commit merge**

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Missing token logic in new modules | Carefully port each function from old stats-db.ts |
| Aggregation query incompatibilities | Test with existing data |
| Migration version conflicts | Upstream is at v3, we need v4 |
| Test coverage gaps | Port relevant tests from old test file |

---

## Status

**Ready for implementation**
