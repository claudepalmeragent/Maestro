# Usage Dashboard Cost Calculation Fix

**Created:** 2026-02-09
**Updated:** 2026-02-09 (v2 - Added Dual-Source Storage & Anthropic Audit)
**Status:** Investigation Complete - Awaiting Discussion
**Priority:** Critical (Core Feature Accuracy)
**Complexity:** High (Pipeline Changes + Database Schema + External Integration)

---

## Executive Summary

The Usage Dashboard currently displays costs calculated at full API pricing regardless of the user's billing mode. For Claude Max subscribers, this means:

1. **Cache tokens are charged** at API rates instead of $0
2. **Costs are stored permanently** in the database with wrong values
3. **No way to recalculate** historical data without migration

**NEW (v2):** This plan now includes:
- **Dual-source storage** - Store BOTH Anthropic's reported values AND locally calculated values
- **Anthropic audit integration** - Pull usage reports via `ccusage` for cross-validation
- **Historical comparison** - Compare Maestro's tracked usage against Anthropic's ground truth

---

## Problem Statement

### Current Behavior

For a Max subscriber with heavy cache usage:
- **Expected cost:** ~$5.00 (input/output only, cache free)
- **Displayed cost:** ~$15.00 (full API pricing including cache)
- **Difference:** ~67% overstated for cache-heavy workloads

### Root Cause

The cost calculation pipeline uses Claude Code's reported `total_cost_usd` directly without applying billing mode adjustments:

```
Claude Code Response
    ↓
    Contains: total_cost_usd (always API pricing)
    ↓
    StdoutHandler.buildUsageStats()
    ↓
    usage-aggregator.aggregateModelUsage()
    ↓
    Returns totalCostUsd = msg.total_cost_usd (UNCHANGED)
    ↓
    ExitHandler emits 'query-complete'
    ↓
    stats-listener inserts to database
    ↓
    DATABASE STORES API-PRICED COST
    ↓
    Usage Dashboard queries stored value
    ↓
    USER SEES WRONG COST
```

### Additional Issue: Single Source of Truth

Currently, Maestro only stores one cost value. This creates brittleness:
- If our calculation is wrong, we have no reference to compare against
- If Anthropic changes their reporting, we can't detect it
- No audit trail for pricing model changes

---

## Investigation Details

### 1. Where Costs Are Displayed

**File:** `src/renderer/components/UsageDashboard/SummaryCards.tsx` (lines 185-196)

```typescript
// Displays totalCostDisplay from aggregated stats
<span>{data.totalCostDisplay}</span>
```

### 2. Where Costs Are Retrieved

**File:** `src/main/stats/aggregations.ts` (lines 467-518)

```sql
SELECT COALESCE(SUM(total_cost_usd), 0) as total_cost_usd
FROM query_events
WHERE ...
```

Costs are simply summed from the `total_cost_usd` column - no recalculation.

### 3. Where Costs Are Stored

**File:** `src/main/stats/query-events.ts` (line 47)

```typescript
// total_cost_usd is inserted directly from event parameter
INSERT INTO query_events (..., total_cost_usd, ...)
VALUES (..., event.totalCostUsd, ...)
```

### 4. Billing Mode Resolution (Exists But Unused)

**File:** `src/main/utils/pricing-resolver.ts`

```typescript
// This function exists and works correctly, but is never called
// during the cost calculation/storage pipeline
export async function resolveBillingMode(
  agentId: string,
  projectFolderId?: string
): Promise<'max' | 'api'> {
  // Implementation exists and is correct
}
```

---

## NEW: Anthropic Usage Tracking via ccusage

### What is ccusage?

[ccusage](https://github.com/ryoppippi/ccusage) is a CLI tool that analyzes Claude Code usage directly from Anthropic's local JSONL files (`~/.claude/projects/<project>/<session>.jsonl`).

### Data Available

```bash
npx ccusage@latest daily --json --since YYYYMMDD
```

Returns:
```json
{
  "daily": [
    {
      "date": "2026-02-09",
      "inputTokens": 35922,
      "outputTokens": 21640,
      "cacheCreationTokens": 7461626,
      "cacheReadTokens": 181911374,
      "totalTokens": 189430562,
      "totalCost": 132.40,
      "modelsUsed": ["claude-opus-4-5-20251101", "claude-haiku-4-5-20251001"],
      "modelBreakdowns": [
        {
          "modelName": "claude-opus-4-5-20251101",
          "inputTokens": 8330,
          "outputTokens": 9158,
          "cacheCreationTokens": 3206864,
          "cacheReadTokens": 60218531,
          "cost": 50.42
        }
      ]
    }
  ]
}
```

### Available Commands

| Command | Description | Use Case |
|---------|-------------|----------|
| `ccusage daily` | Usage by date | Daily cost tracking |
| `ccusage weekly` | Usage by week | Weekly summaries |
| `ccusage monthly` | Usage by month | Monthly budgets |
| `ccusage session` | Usage by conversation | Per-agent tracking |

### Key Insight

ccusage reads the **same JSONL files** that Claude Code writes. This is the **ground truth** for what Anthropic will bill. We can use this to:

1. **Validate** our locally calculated costs
2. **Detect discrepancies** between Maestro and Anthropic
3. **Audit** our pricing model accuracy

---

## Proposed Solution: Dual-Source Architecture

### Core Principle

Store **both** Anthropic's reported values AND Maestro's calculated values for every query event:

```typescript
interface QueryEvent {
  // Token counts (single source - from Claude output)
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;

  // ANTHROPIC VALUES (from Claude Code response)
  anthropic_cost_usd: number;        // Claude's reported total_cost_usd
  anthropic_model: string;           // Model from modelUsage

  // MAESTRO VALUES (locally calculated)
  maestro_cost_usd: number;          // Our calculated cost
  maestro_billing_mode: string;      // 'api' | 'max' | 'free'
  maestro_pricing_model: string;     // Model used for pricing lookup
  maestro_calculated_at: number;     // Timestamp of calculation
}
```

### Benefits

| Benefit | Description |
|---------|-------------|
| **Audit Trail** | Compare Anthropic vs Maestro at any time |
| **Pricing Accuracy** | Detect when our model diverges from reality |
| **Billing Mode Verification** | See if Max mode savings are calculated correctly |
| **Historical Correction** | Can recalculate Maestro values without losing Anthropic data |
| **Debugging** | Easy to identify which source has errors |

### Display Logic

```typescript
// Primary display: Maestro's calculated cost (billing-mode adjusted)
const displayCost = queryEvent.maestro_cost_usd;

// Secondary/tooltip: Anthropic's reported cost (API pricing)
const anthropicCost = queryEvent.anthropic_cost_usd;

// Savings calculation for Max users
const savings = anthropicCost - displayCost;
```

---

## NEW: Anthropic Audit Feature

### Purpose

Periodically pull usage data from Anthropic (via ccusage) and compare against Maestro's recorded data to:

1. **Detect missing queries** - Queries Anthropic saw but Maestro didn't record
2. **Validate token counts** - Ensure our token tracking matches Anthropic's
3. **Audit cost calculations** - Compare calculated vs reported costs
4. **Track pricing drift** - Detect when Anthropic changes pricing

### Implementation

#### 1. Audit Service

**File:** `src/main/services/anthropic-audit-service.ts`

```typescript
import { execSync } from 'child_process';

interface AnthropicDailyUsage {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalCost: number;
  modelBreakdowns: Array<{
    modelName: string;
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    cost: number;
  }>;
}

export async function fetchAnthropicUsage(
  period: 'daily' | 'weekly' | 'monthly',
  since?: string,
  until?: string
): Promise<AnthropicDailyUsage[]> {
  const args = ['--json'];
  if (since) args.push('--since', since);
  if (until) args.push('--until', until);

  const result = execSync(`npx ccusage@latest ${period} ${args.join(' ')}`, {
    encoding: 'utf8',
    timeout: 60000,
  });

  return JSON.parse(result)[period];
}

export async function performAudit(
  startDate: string,
  endDate: string
): Promise<AuditResult> {
  // 1. Fetch Anthropic usage
  const anthropicData = await fetchAnthropicUsage('daily', startDate, endDate);

  // 2. Fetch Maestro usage for same period
  const maestroData = await queryMaestroUsageByDate(startDate, endDate);

  // 3. Compare and generate report
  return compareUsage(anthropicData, maestroData);
}
```

#### 2. Audit Comparison Logic

```typescript
interface AuditResult {
  period: { start: string; end: string };

  // Token comparison
  tokens: {
    anthropic: TokenCounts;
    maestro: TokenCounts;
    difference: TokenCounts;
    percentDiff: number;
  };

  // Cost comparison
  costs: {
    anthropic_total: number;      // What Anthropic reports (API pricing)
    maestro_anthropic: number;    // Sum of our anthropic_cost_usd
    maestro_calculated: number;   // Sum of our maestro_cost_usd
    discrepancy: number;          // anthropic_total - maestro_anthropic
  };

  // Per-model breakdown
  modelBreakdown: Array<{
    model: string;
    anthropic: { tokens: TokenCounts; cost: number };
    maestro: { tokens: TokenCounts; cost: number };
    match: boolean;
  }>;

  // Anomalies detected
  anomalies: Array<{
    type: 'missing_query' | 'token_mismatch' | 'cost_mismatch' | 'model_mismatch';
    severity: 'info' | 'warning' | 'error';
    description: string;
    details: any;
  }>;
}
```

#### 3. SSH Remote Audit Support

For agents running on SSH remotes, run ccusage remotely:

```typescript
export async function fetchRemoteAnthropicUsage(
  sshConfig: SshRemoteConfig,
  period: 'daily' | 'weekly' | 'monthly',
  since?: string
): Promise<AnthropicDailyUsage[]> {
  const sshCommand = buildSshCommand(sshConfig);
  const ccusageCmd = `npx ccusage@latest ${period} --json ${since ? `--since ${since}` : ''}`;

  const result = execSync(`${sshCommand} "${ccusageCmd}"`, {
    encoding: 'utf8',
    timeout: 120000, // Longer timeout for SSH
  });

  return JSON.parse(result)[period];
}
```

#### 4. Audit UI Components

**Dashboard Addition:** "Audit" tab or button in Usage Dashboard

```tsx
<AuditPanel>
  <AuditPeriodSelector
    value={auditPeriod}
    onChange={setAuditPeriod}
  />

  <Button onClick={runAudit}>Run Audit</Button>

  {auditResult && (
    <>
      <AuditSummary result={auditResult} />

      <AuditTokenComparison
        anthropic={auditResult.tokens.anthropic}
        maestro={auditResult.tokens.maestro}
      />

      <AuditCostComparison
        anthropic={auditResult.costs.anthropic_total}
        maestroCalculated={auditResult.costs.maestro_calculated}
        savings={auditResult.costs.anthropic_total - auditResult.costs.maestro_calculated}
      />

      {auditResult.anomalies.length > 0 && (
        <AuditAnomalies anomalies={auditResult.anomalies} />
      )}
    </>
  )}
</AuditPanel>
```

---

## Updated Database Schema

### query_events Table

```sql
-- Existing columns (keep as-is)
id, session_id, timestamp, tool_type, ...

-- Token counts (unchanged)
input_tokens, output_tokens, cache_read_tokens, cache_write_tokens

-- REMOVE: Old single cost column
-- total_cost_usd  -- DEPRECATED

-- NEW: Anthropic values (from Claude Code response)
anthropic_cost_usd REAL,           -- Claude's reported total_cost_usd
anthropic_model TEXT,              -- Model name from modelUsage

-- NEW: Maestro calculated values
maestro_cost_usd REAL,             -- Our calculated cost
maestro_billing_mode TEXT,         -- 'api' | 'max' | 'free'
maestro_pricing_model TEXT,        -- Model ID used for pricing
maestro_calculated_at INTEGER      -- Timestamp
```

### NEW: audit_snapshots Table

```sql
CREATE TABLE IF NOT EXISTS audit_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,

  -- Anthropic totals
  anthropic_input_tokens INTEGER,
  anthropic_output_tokens INTEGER,
  anthropic_cache_read_tokens INTEGER,
  anthropic_cache_write_tokens INTEGER,
  anthropic_total_cost REAL,

  -- Maestro totals
  maestro_input_tokens INTEGER,
  maestro_output_tokens INTEGER,
  maestro_cache_read_tokens INTEGER,
  maestro_cache_write_tokens INTEGER,
  maestro_anthropic_cost REAL,
  maestro_calculated_cost REAL,

  -- Comparison results
  token_discrepancy_percent REAL,
  cost_discrepancy_usd REAL,
  anomaly_count INTEGER,

  -- Full audit result (JSON)
  audit_result_json TEXT
);
```

---

## Updated Implementation Plan

### Phase 1: Database Schema Update (3-4 hours)

1. Add new columns to `query_events`:
   - `anthropic_cost_usd`
   - `anthropic_model`
   - `maestro_cost_usd`
   - `maestro_billing_mode`
   - `maestro_pricing_model`
   - `maestro_calculated_at`

2. Create `audit_snapshots` table

3. Migration to populate existing data:
   - Set `anthropic_cost_usd = total_cost_usd` (existing value)
   - Set `maestro_cost_usd = NULL` (will be calculated)
   - Mark old `total_cost_usd` as deprecated

### Phase 2: Dual-Source Storage (4-5 hours)

**File:** `src/main/process-listeners/stats-listener.ts`

```typescript
async function insertQueryEventWithRetry(event: QueryEvent) {
  // 1. Capture Anthropic's values (from Claude response)
  const anthropicCost = event.totalCostUsd;
  const anthropicModel = event.detectedModel;

  // 2. Calculate Maestro's values
  let maestroCost = anthropicCost; // Default to same
  let maestroBillingMode = 'api';
  let maestroPricingModel = anthropicModel;

  if (event.toolType === 'claude' || event.toolType === 'claude-code') {
    maestroBillingMode = await resolveBillingMode(event.agentId, event.projectFolderId);
    maestroPricingModel = anthropicModel || await resolveModelForPricing(event.agentId);

    maestroCost = calculateClaudeCostWithModel(
      {
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        cacheReadTokens: event.cacheReadTokens,
        cacheWriteTokens: event.cacheWriteTokens,
      },
      maestroPricingModel,
      maestroBillingMode
    );
  }

  // 3. Store both values
  const enrichedEvent = {
    ...event,
    anthropic_cost_usd: anthropicCost,
    anthropic_model: anthropicModel,
    maestro_cost_usd: maestroCost,
    maestro_billing_mode: maestroBillingMode,
    maestro_pricing_model: maestroPricingModel,
    maestro_calculated_at: Date.now(),
  };

  await insertQueryEvent(enrichedEvent);
}
```

### Phase 3: Update Aggregations (2-3 hours)

**File:** `src/main/stats/aggregations.ts`

Update queries to use `maestro_cost_usd` as primary and `anthropic_cost_usd` as secondary:

```sql
SELECT
  SUM(maestro_cost_usd) as total_cost_usd,
  SUM(anthropic_cost_usd) as anthropic_cost_usd,
  SUM(anthropic_cost_usd) - SUM(maestro_cost_usd) as savings
FROM query_events
WHERE ...
```

### Phase 4: Anthropic Audit Service (4-5 hours)

1. Create `src/main/services/anthropic-audit-service.ts`
2. Implement `fetchAnthropicUsage()` via ccusage
3. Implement `performAudit()` comparison logic
4. Add IPC handlers for audit operations
5. Handle SSH remotes with `fetchRemoteAnthropicUsage()`

### Phase 5: Audit UI (3-4 hours)

1. Add "Audit" section to Usage Dashboard
2. Create `AuditPanel` component
3. Create comparison visualizations
4. Add anomaly display
5. Export audit reports

### Phase 6: Update Display Components (4-5 hours)

#### 6.1 Update SummaryCards
- Show both Anthropic and Maestro costs
- Add savings indicator for Max users
- Add tooltips showing cost breakdown

#### 6.2 Create New Cost Graphs

**Add dedicated Cost graphs to BOTH Overview and Agents tabs:**

```tsx
<CostGraph
  title="Cost Over Time"
  data={costData}
  dataSource={dataSource}  // 'local' | 'anthropic'
  onToggleSource={setDataSource}
/>
```

**Graph Features:**
- Line chart showing cost trends
- Daily/Weekly/Monthly granularity
- Per-model breakdown option
- Stacked area for token type costs (input/output/cache)

#### 6.3 Data Source Toggle

Add toggle switch on each cost-related graph:

```tsx
<GraphHeader>
  <Title>Cost Over Time</Title>
  <DataSourceToggle
    value={dataSource}
    onChange={setDataSource}
    options={[
      { value: 'local', label: 'Local Data' },
      { value: 'anthropic', label: 'Anthropic Data' },
    ]}
  />
</GraphHeader>
```

**Toggle Behavior:**
- `Local Data`: Shows `maestro_cost_usd` (billing-mode adjusted)
- `Anthropic Data`: Shows `anthropic_cost_usd` (raw API pricing)
- Toggle persists per-graph (user preference)
- Both views always available for comparison

#### 6.4 Graphs to Add/Update

| Tab | Graph | Data Source Toggle |
|-----|-------|-------------------|
| Overview | Cost Over Time (NEW) | ✓ Yes |
| Overview | Cost by Model (NEW) | ✓ Yes |
| Agents | Agent Cost Comparison (NEW) | ✓ Yes |
| Agents | Agent Cost Over Time (NEW) | ✓ Yes |
| Existing | SummaryCards | Shows both inline |

#### 6.5 Cost Annotations

- Add "(incl. in Max sub.)" for Max billing mode costs
- Show cache savings: "Cache savings: $X.XX"
- Tooltip with full breakdown on hover

### Phase 7: Historical Data Reconstruction (4-6 hours)

**Goal:** Reconstruct complete query-level historical data from Anthropic's JSONL files, filling in missing records and correcting existing ones.

#### Data Source: Claude Code JSONL Files

Location: `~/.claude/projects/<project>/<session>.jsonl`

Each JSONL file contains **per-message granular data**:

```json
{
  "type": "assistant",
  "sessionId": "74122bae-032f-4b6c-9114-cc36943d6cbc",
  "timestamp": "2026-02-09T08:43:48.296Z",
  "message": {
    "model": "claude-opus-4-5-20251101",
    "id": "msg_01LRSyZrc4H7jKXowGeoSv5W",
    "usage": {
      "input_tokens": 3,
      "output_tokens": 3,
      "cache_creation_input_tokens": 2515,
      "cache_read_input_tokens": 17896
    }
  },
  "uuid": "d32ec7f3-c6a8-48ab-a582-ba23e1be1913"
}
```

#### What We Can Reconstruct (Query-Level)

| Field | Source | Notes |
|-------|--------|-------|
| `timestamp` | JSONL `timestamp` | Exact query time |
| `session_id` | JSONL `sessionId` | Maps to Maestro session |
| `model` | JSONL `message.model` | Exact model used |
| `input_tokens` | JSONL `usage.input_tokens` | Per-message |
| `output_tokens` | JSONL `usage.output_tokens` | Per-message |
| `cache_read_tokens` | JSONL `usage.cache_read_input_tokens` | Per-message |
| `cache_write_tokens` | JSONL `usage.cache_creation_input_tokens` | Per-message |
| `message_id` | JSONL `message.id` | Anthropic's unique ID |
| `uuid` | JSONL `uuid` | Claude Code's unique ID |

#### Reconstruction Strategy

```typescript
interface JournalEntry {
  type: 'assistant' | 'user' | 'result';
  sessionId: string;
  timestamp: string;
  uuid: string;
  message?: {
    model?: string;
    id?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

async function reconstructHistoricalData(projectPath: string): Promise<ReconstructionResult> {
  const result: ReconstructionResult = {
    queriesFound: 0,
    queriesInserted: 0,
    queriesUpdated: 0,
    queriesSkipped: 0,
    errors: [],
  };

  // 1. Find all JSONL files
  const jsonlFiles = await glob(`${projectPath}/**/*.jsonl`);

  for (const file of jsonlFiles) {
    // 2. Parse each JSONL file line by line
    const entries = await parseJsonlFile(file);

    // 3. Extract assistant messages with usage data
    const usageEntries = entries.filter(
      (e) => e.type === 'assistant' && e.message?.usage
    );

    for (const entry of usageEntries) {
      result.queriesFound++;

      // 4. Check if we already have this query
      const existing = await findQueryByUuid(entry.uuid);

      if (existing) {
        // 5a. Update existing record with Anthropic values
        await updateQueryWithAnthropicData(existing.id, {
          anthropic_cost_usd: calculateApiCost(entry),
          anthropic_model: entry.message.model,
          // Recalculate Maestro cost with proper billing mode
          maestro_cost_usd: await calculateMaestroCost(entry, existing.agentId),
          maestro_billing_mode: await resolveBillingMode(existing.agentId),
        });
        result.queriesUpdated++;
      } else {
        // 5b. Insert new record from Anthropic data
        await insertReconstructedQuery({
          session_id: entry.sessionId,
          timestamp: new Date(entry.timestamp).getTime(),
          tool_type: 'claude-code',
          uuid: entry.uuid,
          anthropic_message_id: entry.message.id,

          // Token counts
          input_tokens: entry.message.usage.input_tokens || 0,
          output_tokens: entry.message.usage.output_tokens || 0,
          cache_read_tokens: entry.message.usage.cache_read_input_tokens || 0,
          cache_write_tokens: entry.message.usage.cache_creation_input_tokens || 0,

          // Anthropic values
          anthropic_cost_usd: calculateApiCost(entry),
          anthropic_model: entry.message.model,

          // Maestro values (calculated with current billing mode)
          maestro_cost_usd: await calculateMaestroCost(entry),
          maestro_billing_mode: 'max', // Default for reconstruction
          maestro_pricing_model: entry.message.model,
          maestro_calculated_at: Date.now(),

          // Mark as reconstructed
          is_reconstructed: true,
          reconstructed_at: Date.now(),
        });
        result.queriesInserted++;
      }
    }
  }

  return result;
}
```

#### SSH Remote Reconstruction

For agents on SSH remotes, we can either:

**Option A: Run reconstruction remotely**
```bash
ssh user@host "cat ~/.claude/projects/*/*.jsonl" | node reconstruct-local.js
```

**Option B: Pull JSONL files locally first**
```bash
rsync -avz user@host:~/.claude/projects/ ./remote-claude-data/
```

Then run reconstruction on the local copy.

#### Reconstruction Tasks

1. **Scan local JSONL files**
   - Parse `~/.claude/projects/<project>/<session>.jsonl`
   - Extract all assistant messages with usage data

2. **Match to Maestro sessions**
   - Map Claude Code `sessionId` to Maestro `session_id`
   - Handle session ID formats (UUID, batch IDs, etc.)

3. **Identify missing queries**
   - Compare JSONL entries against `query_events` table
   - Use `uuid` or `timestamp + session_id` for matching

4. **Insert missing records**
   - Create new `query_events` with `is_reconstructed = true`
   - Calculate both Anthropic and Maestro costs

5. **Update existing records**
   - Add missing `anthropic_cost_usd` values
   - Recalculate `maestro_cost_usd` with proper billing mode

6. **Handle SSH remotes**
   - Optionally pull remote JSONL files
   - Run same reconstruction process

7. **Generate reconstruction report**
   - Count of queries found/inserted/updated/skipped
   - Date range covered
   - Any errors or anomalies

#### New Database Columns for Reconstruction

```sql
-- Add to query_events table
ALTER TABLE query_events ADD COLUMN uuid TEXT;
ALTER TABLE query_events ADD COLUMN anthropic_message_id TEXT;
ALTER TABLE query_events ADD COLUMN is_reconstructed INTEGER DEFAULT 0;
ALTER TABLE query_events ADD COLUMN reconstructed_at INTEGER;

-- Index for efficient lookup during reconstruction
CREATE INDEX IF NOT EXISTS idx_query_events_uuid ON query_events(uuid);
```

#### Reconstruction UI

Add to Usage Dashboard:

```tsx
<ReconstructionPanel>
  <h3>Historical Data Reconstruction</h3>

  <p>Scan Claude Code's JSONL files to reconstruct missing usage data.</p>

  <ReconstructionOptions>
    <Checkbox label="Local agents" defaultChecked />
    <Checkbox label="SSH remote agents" />
    <DateRangePicker label="Date range" />
  </ReconstructionOptions>

  <Button onClick={startReconstruction}>
    Start Reconstruction
  </Button>

  {reconstructionResult && (
    <ReconstructionReport>
      <Stat label="Queries found" value={result.queriesFound} />
      <Stat label="New records inserted" value={result.queriesInserted} />
      <Stat label="Existing records updated" value={result.queriesUpdated} />
      <Stat label="Skipped (already complete)" value={result.queriesSkipped} />
    </ReconstructionReport>
  )}
</ReconstructionPanel>
```

---

## Files to Modify/Create

### Phase 1-3: Core Infrastructure

| File | Action | Phase |
|------|--------|-------|
| `src/main/stats/schema.ts` | Add new columns, create audit table | 1 |
| `src/main/stats/types.ts` | Update QueryEvent interface | 1 |
| `src/main/stats/query-events.ts` | Update INSERT for dual storage | 2 |
| `src/main/process-listeners/stats-listener.ts` | Calculate both cost sources | 2 |
| `src/main/stats/aggregations.ts` | Query both cost columns | 3 |
| `src/main/process-manager/handlers/ExitHandler.ts` | Pass model info | 2 |

### Phase 4-5: Audit System

| File | Action | Phase |
|------|--------|-------|
| `src/main/services/anthropic-audit-service.ts` | CREATE - ccusage integration | 4 |
| `src/main/services/audit-scheduler.ts` | CREATE - Scheduled audit runner | 4 |
| `src/main/ipc/handlers/audit.ts` | CREATE - Audit IPC handlers | 4 |
| `src/preload/index.ts` | Expose audit IPC | 4 |
| `src/renderer/components/settings/AuditsSettingsTab.tsx` | CREATE - Settings tab | 5 |
| `src/renderer/components/UsageDashboard/AuditReportPanel.tsx` | CREATE - Report with checkboxes | 5 |
| `src/renderer/components/UsageDashboard/AuditHistoryTable.tsx` | CREATE - Audit history | 5 |

### Phase 6: Display & Graphs

| File | Action | Phase |
|------|--------|-------|
| `src/renderer/components/UsageDashboard/SummaryCards.tsx` | Show dual costs | 6 |
| `src/renderer/components/ui/DataSourceToggle.tsx` | CREATE - Local/Anthropic toggle | 6 |
| `src/renderer/components/UsageDashboard/CostOverTimeGraph.tsx` | CREATE - Cost line chart | 6 |
| `src/renderer/components/UsageDashboard/CostByModelGraph.tsx` | CREATE - Cost by model chart | 6 |
| `src/renderer/components/UsageDashboard/AgentCostGraph.tsx` | CREATE - Agent comparison | 6 |
| `src/renderer/components/UsageDashboard/OverviewTab.tsx` | Add cost graphs | 6 |
| `src/renderer/components/UsageDashboard/AgentsTab.tsx` | Add cost graphs | 6 |

### Phase 7: Historical Reconstruction

| File | Action | Phase |
|------|--------|-------|
| `src/main/utils/jsonl-parser.ts` | CREATE - Parse Claude Code JSONL | 7 |
| `src/main/services/historical-reconstruction-service.ts` | CREATE - Reconstruction logic | 7 |
| `src/main/ipc/handlers/reconstruction.ts` | CREATE - Reconstruction IPC | 7 |
| `src/renderer/components/UsageDashboard/ReconstructionPanel.tsx` | CREATE - Reconstruction UI | 7 |

---

## ccusage Integration Details

### Commands to Support

| Command | Maestro Use | Local/Remote |
|---------|-------------|--------------|
| `npx ccusage@latest daily --json` | Daily audit | Both |
| `npx ccusage@latest weekly --json` | Weekly summary | Both |
| `npx ccusage@latest monthly --json` | Monthly budget | Both |
| `npx ccusage@latest session --json` | Per-session audit | Local only |

### Alternative: bunx

For environments with Bun installed:
```bash
bunx ccusage daily --json
```

### Error Handling

```typescript
try {
  const result = execSync('npx ccusage@latest daily --json', {
    timeout: 60000,
    encoding: 'utf8',
  });
  return JSON.parse(result);
} catch (error) {
  if (error.message.includes('ENOENT')) {
    throw new Error('npx not found. Please install Node.js.');
  }
  if (error.message.includes('timeout')) {
    throw new Error('ccusage timed out. Try again or use --offline mode.');
  }
  throw error;
}
```

---

## Audit Report Format

### Summary View

```
╔═══════════════════════════════════════════════════════════════════╗
║                    USAGE AUDIT: 2026-02-01 to 2026-02-09          ║
╠═══════════════════════════════════════════════════════════════════╣
║  SOURCE          │ INPUT     │ OUTPUT   │ CACHE     │ COST       ║
╠═══════════════════════════════════════════════════════════════════╣
║  Anthropic       │ 155,726   │ 79,089   │ 628.3M    │ $459.45    ║
║  Maestro (API)   │ 155,726   │ 79,089   │ 628.3M    │ $459.45    ║
║  Maestro (Max)   │ 155,726   │ 79,089   │ 628.3M    │ $142.18    ║
╠═══════════════════════════════════════════════════════════════════╣
║  Token Match: ✓ 100%    │    Cost Savings: $317.27 (69%)         ║
╚═══════════════════════════════════════════════════════════════════╝
```

### Anomalies

```
⚠️  ANOMALIES DETECTED (2)

1. [WARNING] Token Mismatch on 2026-02-05
   Anthropic: 61,537,301 total tokens
   Maestro:   61,537,155 total tokens
   Difference: 146 tokens (0.0002%)

2. [INFO] New model detected
   Model: claude-haiku-4-5-20251001
   First seen: 2026-02-01
   Pricing verified: ✓
```

---

## Risk Assessment

### Low Risk
- Adding new database columns (additive)
- ccusage is read-only (doesn't modify any data)
- Audit is optional/manual feature

### Medium Risk
- Changing primary cost column (display changes)
- SSH remote ccusage execution (network dependent)
- Historical migration (bulk data changes)

### High Risk
- None identified (dual-source approach reduces risk)

### Mitigation

1. **Dual storage** means we never lose data
2. **Anthropic values preserved** as ground truth
3. **Audit is optional** - users can ignore if not needed
4. **Gradual rollout** - start with new queries only

---

## Success Criteria

1. **Dual Storage:** Every query stores both Anthropic and Maestro costs
2. **Accurate Calculation:** Max users see $0 for cache tokens
3. **Audit Works:** Can fetch and compare Anthropic data via ccusage
4. **Discrepancy Detection:** Anomalies are identified and reported
5. **UI Shows Both:** Dashboard displays calculated cost with Anthropic reference
6. **SSH Support:** Remote agents can be audited and reconstructed
7. **No Data Loss:** Original Anthropic values always preserved
8. **Historical Reconstruction:** Can rebuild query-level data from JSONL files
9. **Complete History:** Missing historical queries are identified and inserted
10. **Audit Trail:** Reconstructed records are marked with `is_reconstructed` flag

---

## Timeline Estimate

| Phase | Effort | Dependencies |
|-------|--------|--------------|
| Phase 1: Schema Update | 3-4 hours | None |
| Phase 2: Dual-Source Storage | 4-5 hours | Phase 1 |
| Phase 3: Update Aggregations | 2-3 hours | Phase 2 |
| Phase 4: Audit Service (ccusage) | 4-5 hours | Phase 1 |
| Phase 5: Audit UI (Settings Tab + Reports) | 4-5 hours | Phase 4 |
| Phase 6: Display Updates (Graphs + Toggle) | 4-5 hours | Phase 3 |
| Phase 7: Historical Reconstruction | 4-6 hours | Phase 2, 4 |
| Testing & Verification | 3-4 hours | All |

**Total: 29-40 hours** (spread across multiple sessions)

### Phase 5 Breakdown (Audit UI)

| Sub-task | Effort |
|----------|--------|
| Audits tab in Settings modal | 1-2 hours |
| Scheduled audit configuration | 1-2 hours |
| Audit report with checkboxes | 1-2 hours |
| Auto-correct workflow | 1-2 hours |

### Phase 6 Breakdown (Display Updates)

| Sub-task | Effort |
|----------|--------|
| SummaryCards dual-cost display | 1 hour |
| CostGraph component | 1-2 hours |
| DataSourceToggle component | 0.5-1 hour |
| Add graphs to Overview tab | 1 hour |
| Add graphs to Agents tab | 1 hour |
| Cost annotations & tooltips | 0.5-1 hour |

### Phase 7 Breakdown (Reconstruction)

| Sub-task | Effort |
|----------|--------|
| JSONL parser utility | 1-2 hours |
| Reconstruction service | 2-3 hours |
| IPC handlers | 0.5-1 hour |
| Reconstruction UI | 1-2 hours |
| SSH remote support (multi-VM) | 1-2 hours |

---

## Resolved Design Decisions

### 1. Audit Frequency → **On-Demand + Scheduled**

**Implementation:**
- Add **Audits tab** in App Settings modal
- **Scheduled Audits section:**
  - Daily audit (runs at configurable time)
  - Weekly audit (runs on configurable day)
  - Monthly audit (runs on 1st of month)
- **Run Audit Now** button for immediate audit

```tsx
<AuditsSettingsTab>
  <Section title="Scheduled Audits">
    <ScheduleOption
      label="Daily"
      enabled={dailyEnabled}
      time={dailyTime}
    />
    <ScheduleOption
      label="Weekly"
      enabled={weeklyEnabled}
      day={weeklyDay}
    />
    <ScheduleOption
      label="Monthly"
      enabled={monthlyEnabled}
    />
  </Section>

  <Section title="Manual Audit">
    <DateRangePicker />
    <Button>Run Audit Now</Button>
  </Section>

  <Section title="Audit History">
    <AuditHistoryTable />
  </Section>
</AuditsSettingsTab>
```

### 2. SSH Remote Handling → **Combination Approach**

**User Topology:**
- Fleet of 8 micro-VM Linux containers
- Each VM has: Claude Code instance + Maestro Agent
- Host machine: Maestro app with central stats.db

**Implementation Strategy:**

```
┌─────────────────────────────────────────────────────────────────────┐
│  HOST (Maestro App)                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ stats.db (central database)                                      ││
│  │                                                                  ││
│  │ For each Agent VM:                                               ││
│  │   1. SSH → Run ccusage remotely → Get daily/weekly summary       ││
│  │   2. SSH → Process JSONL files remotely → Generate reconstruction││
│  │   3. Pull reconstruction data to Host                            ││
│  │   4. Merge into central stats.db                                 ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
         │
         ├──── SSH ────→ [Agent VM 1] ~/.claude/projects/*.jsonl
         ├──── SSH ────→ [Agent VM 2] ~/.claude/projects/*.jsonl
         ├──── SSH ────→ [Agent VM 3] ~/.claude/projects/*.jsonl
         │      ...
         └──── SSH ────→ [Agent VM 8] ~/.claude/projects/*.jsonl
```

**Step-by-Step Process:**

1. **Run ccusage remotely** (for daily summary - light operation)
   ```bash
   ssh user@vm1 "npx ccusage@latest daily --json --since 20260201"
   ```

2. **Process JSONL files remotely** (for query-level reconstruction)
   ```bash
   ssh user@vm1 "node /path/to/process-jsonl.js" > vm1-reconstruction.json
   ```

3. **Pull reconstruction data to Host**
   - Each VM generates a reconstruction JSON file
   - Host pulls/receives these files

4. **Merge into central stats.db**
   - Maestro app processes all reconstruction files
   - Inserts/updates query_events table
   - Marks records with source VM identifier

**Alternative: Direct SSH Processing**
- Maestro can also read remote JSONL files directly via SSH
- Uses existing `AgentSessionStorage` with `SshRemoteConfig`
- Already implemented in `claude-session-storage.ts`

### 3. Discrepancy Handling → **Multi-Stage Workflow**

**Stage 1: Full Report Generation**
- Create comprehensive report showing ALL entries
- Include BOTH matching AND discrepancies
- Flag severity levels: Match ✓, Minor Δ, Major ⚠, Missing ✗

```tsx
<AuditReport>
  <ReportHeader>
    <Stat label="Total Entries" value={1234} />
    <Stat label="Matches" value={1200} status="success" />
    <Stat label="Minor Discrepancies" value={30} status="warning" />
    <Stat label="Major Discrepancies" value={4} status="error" />
  </ReportHeader>

  <ReportTable>
    {entries.map(entry => (
      <ReportRow
        key={entry.id}
        status={entry.status}
        anthropic={entry.anthropic}
        maestro={entry.maestro}
        difference={entry.diff}
        checkbox={entry.status !== 'match'}
      />
    ))}
  </ReportTable>
</AuditReport>
```

**Stage 2: Selective Auto-Correction**
- Checkboxes on each discrepancy row
- "Select All Discrepancies" button
- "Auto-Correct Selected" button
- Confirmation dialog before applying changes

```tsx
<AuditActions>
  <Button onClick={selectAllDiscrepancies}>
    Select All Discrepancies ({discrepancyCount})
  </Button>
  <Button
    onClick={autoCorrectSelected}
    disabled={selectedCount === 0}
    variant="primary"
  >
    Auto-Correct Selected ({selectedCount})
  </Button>
</AuditActions>
```

### 4. Historical Reconstruction Scope → **All Historical Data**

Reconstruct EVERYTHING available:
- All JSONL files in `~/.claude/projects/`
- All dates from earliest record to present
- Both local and remote agents
- No date cutoff

### 5. Session ID Mapping → **Already Solved!**

**Investigation Finding:** Maestro ALREADY maintains session ID mapping!

**Key Discovery:**
- `AITab.agentSessionId` stores Claude Code's session UUID
- This maps directly to JSONL filename: `<agentSessionId>.jsonl`
- The origins store tracks: `projectPath + agentSessionId → metadata`

**Mapping Architecture:**
```typescript
// In AITab (renderer/types/index.ts)
interface AITab {
  id: string;                    // Maestro's internal tab ID
  agentSessionId: string | null; // Claude Code's session UUID ← THIS IS THE KEY!
  // ...
}

// JSONL file location:
// ~/.claude/projects/<encoded-path>/<agentSessionId>.jsonl
```

**How it works:**
1. Claude Code emits `session_id` in init messages
2. StdoutHandler captures and emits 'session-id' event
3. Renderer stores in `AITab.agentSessionId`
4. Origins store persists the mapping

**For Reconstruction:**
- Query `query_events` by `session_id`
- Match to JSONL files by `agentSessionId`
- The mapping is already built into Maestro's architecture!

**Relevant Files:**
| File | Purpose |
|------|---------|
| `src/main/parsers/claude-output-parser.ts` | Parses session_id from Claude output |
| `src/main/process-listeners/session-id-listener.ts` | Routes session ID events |
| `src/renderer/App.tsx` (lines 2563-2640) | Captures agentSessionId in AITab |
| `src/main/storage/claude-session-storage.ts` | SSH-aware session file access |

---

## Sources

- [ccusage GitHub Repository](https://github.com/ryoppippi/ccusage)
- [ccusage NPM Package](https://www.npmjs.com/package/ccusage)
- [ccusage Documentation](https://ccusage.com/)
- [How to track Claude Code usage](https://shipyard.build/blog/claude-code-track-usage/)

---

## Next Steps

1. **Review this updated plan** with dual-source architecture
2. **Decide on audit frequency** (manual vs automatic)
3. **Decide on historical migration** scope
4. **Create Auto Run documents** for each phase
5. **Implement in order**
6. **Test with real Claude Max subscription**
7. **Run first audit and verify accuracy**
