# Implementation Summary: Token Stats & Agent Attribution Fixes

**Date:** 2026-02-09
**Branch:** main
**Commits:** 5 (6cd077b8..90fd942d)

---

## Overview

This implementation addresses two major issues discovered during testing of the token display enhancements:

1. **Token stats not populating for Claude agents** - cache tokens and cost were always NULL
2. **Agent misattribution in charts** - stats from one agent's Auto Run sessions appearing under different agents

---

## Commits

### 1. fix(stats): Set lastUsageTotals for all agents, not just Codex
**Commit:** `6cd077b8`

**Problem:**
- `lastUsageTotals` was only set inside `normalizeCodexUsage()`, which is only called for Codex agents
- For Claude/OpenCode agents, `lastUsageTotals` was never populated
- ExitHandler reads from `lastUsageTotals` to emit query-complete events
- Result: cache tokens and cost columns always NULL for non-Codex agents

**Fix:**
- Added else branch in StdoutHandler.ts to set `lastUsageTotals` for all agent types
- Now all agents (Claude, OpenCode, Codex) have their token data properly stored

**Files Changed:**
- `src/main/process-manager/handlers/StdoutHandler.ts`

---

### 2. feat(stats): Add agent_id column for proper agent attribution
**Commit:** `d2c38e80`

**Problem:**
- Charts used `startsWith()` matching on session IDs to find agent names
- Auto Run creates session IDs like `{uuid}-batch-{timestamp}`
- If two agent UUIDs share a prefix, the wrong agent gets credited
- Session ID fragmentation caused one agent's stats to split across multiple entries

**Fix:**
- Added `agent_id` column to `query_events` table (migration v6)
- Created index for efficient GROUP BY queries
- Backfilled existing records by stripping `-batch-`, `-ai-`, `-synopsis-` suffixes
- Added `extractBaseAgentId()` helper in ExitHandler
- New inserts now store `agent_id` directly

**Database Changes:**
```sql
ALTER TABLE query_events ADD COLUMN agent_id TEXT;
CREATE INDEX idx_query_events_agent_id ON query_events(agent_id);
-- Backfill strips suffixes from existing session_ids
```

**Files Changed:**
- `src/shared/stats-types.ts` - STATS_DB_VERSION 5→6, added agentId to types
- `src/main/process-manager/types.ts` - Added agentId to QueryCompleteData
- `src/main/stats/migrations.ts` - Added migrateV6()
- `src/main/stats/row-mappers.ts` - Added agent_id column mapping
- `src/main/stats/query-events.ts` - Updated INSERT_SQL
- `src/main/stats/aggregations.ts` - Added queryByAgentIdByDay()
- `src/main/process-manager/handlers/ExitHandler.ts` - Added extractBaseAgentId()
- `src/main/process-listeners/stats-listener.ts` - Pass agentId to insertQueryEvent

---

### 3. feat(dashboard): Update charts to use byAgentIdByDay for correct attribution
**Commit:** `cb0967de`

**Problem:**
- Charts used `sessions.find((s) => sessionId.startsWith(s.id))` which could match wrong agent
- Array order of sessions determined which agent "won" on prefix collisions

**Fix:**
- Renamed `getSessionDisplayName` to `getAgentDisplayName`
- Changed from `startsWith()` to exact `s.id === agentId` matching
- Updated both AgentUsageChart and AgentThroughputChart to use `byAgentIdByDay`
- Added `byAgentIdByDay` to renderer's StatsAggregation interface

**Files Changed:**
- `src/renderer/components/UsageDashboard/AgentUsageChart.tsx`
- `src/renderer/components/UsageDashboard/AgentThroughputChart.tsx`
- `src/renderer/hooks/useStats.ts`

---

### 4. test(stats): Add comprehensive tests for agent_id and migration v6
**Commit:** `8b62c7bf`

**Coverage:**
- 8 new tests for migration v6 (ALTER TABLE, CREATE INDEX, backfill SQL)
- 14 new tests for agent_id storage/retrieval in query-events
- Updated paths.test.ts for 16-parameter INSERT
- New StdoutHandler.test.ts for usage normalization

**Files Changed:**
- `src/__tests__/main/stats/stats-db.test.ts`
- `src/__tests__/main/stats/query-events.test.ts`
- `src/__tests__/main/stats/paths.test.ts`
- `src/__tests__/main/process-manager/handlers/StdoutHandler.test.ts` (new)

---

### 5. docs: Add retroactive data backfill plan
**Commit:** `90fd942d`

**Content:**
- Phase 1: Backfill cache tokens & cost from Claude JSONL session files
- Phase 2: Verify agent_id backfill (already done by migration v6)
- Phase 3: Re-attribute orphaned sessions to current agents
- Script outline for `scripts/backfill-stats.ts`
- Expected recovery rates by scenario

**Files Changed:**
- `__PLANS/RETROACTIVE-DATA-BACKFILL.md`

---

## Testing

All tests pass:
- 325+ stats tests
- TypeScript compilation clean
- ESLint/Prettier formatting applied

---

## Migration Notes

**Database Version:** 5 → 6

**Automatic Migration:**
- Runs on app startup
- Adds `agent_id` column
- Creates index
- Backfills existing records

**No User Action Required:**
- Migration is transparent
- Charts automatically use new column
- COALESCE fallback for legacy data

---

## Related Documents

| Document | Location |
|----------|----------|
| Bug Fixes Plan | `__PLANS/BUG-FIXES-TOKEN-STATS.md` |
| Agent Stats DB Plan | `__PLANS/AGENT-STATS-DB-ENHANCEMENT.md` |
| Backfill Plan | `__PLANS/RETROACTIVE-DATA-BACKFILL.md` |
| Test Document | `/app/__AUTORUN/TEST-AGENT-STATS-DB-ENHANCEMENT.md` |

---

## What's Fixed

| Issue | Status |
|-------|--------|
| "338 tokens" stuck display | ✅ Fixed |
| Empty cache token columns | ✅ Fixed |
| $0.00 cost in dashboard | ✅ Fixed |
| Agent misattribution in charts | ✅ Fixed |
| Batch session fragmentation | ✅ Fixed |

---

## Remaining Work

| Task | Status |
|------|--------|
| Retroactive data backfill script | 📋 Planned |
| Session re-attribution tool | 📋 Planned |
| Manual testing of charts | 🔄 User verification |
