# CLAUDE-FEATURES.md

Feature documentation for Usage Dashboard and Document Graph. For the main guide, see [[CLAUDE.md]].

## Usage Dashboard

The Usage Dashboard (`src/renderer/components/UsageDashboard/`) provides analytics and visualizations for AI agent usage.

### Architecture

```
src/renderer/components/UsageDashboard/
├── UsageDashboardModal.tsx      # Main modal with view tabs (Overview, Agents, Activity, AutoRun, DS Comparison)
├── SummaryCards.tsx             # Metric cards (queries, duration, cost, tokens)
├── AgentComparisonChart.tsx     # Bar chart comparing agent usage
├── AgentCostGraph.tsx           # Per-agent cost breakdown with billing mode colors
├── AgentEfficiencyChart.tsx     # Agent efficiency comparison
├── AgentThroughputChart.tsx     # Per-agent throughput (tokens/second)
├── AgentUsageChart.tsx          # Agent usage breakdown
├── ActivityHeatmap.tsx          # Weekly activity heatmap (GitHub-style)
├── AuditReportPanel.tsx         # Anthropic audit results with filtering
├── CostOverTimeGraph.tsx        # Daily cost trends over time
├── CostByModelGraph.tsx         # Cost breakdown by Claude model
├── DatasourceComparisonTab.tsx  # Honeycomb vs local data comparison tab
├── DatasourceSummaryCards.tsx   # Summary cards for datasource comparison
├── DivergenceTable.tsx          # Token divergence between Honeycomb and local data
├── DurationTrendsChart.tsx      # Line chart for duration over time
├── FlushStatusIndicator.tsx     # OTEL flush status for Honeycomb data
├── LocationDistributionChart.tsx # Local vs SSH remote distribution
├── LongestAutoRunsTable.tsx     # Table of longest Auto Run sessions
├── PeakHoursChart.tsx           # Peak usage hours visualization
├── PlanBudgetTracker.tsx        # Plan budget utilization with inline bars
├── ReconstructionPanel.tsx      # Data reconstruction from JSONL session files
├── SessionStats.tsx             # Session breakdown (agent type, remote vs local)
├── SourceDistributionChart.tsx  # Pie chart for user vs auto queries
├── TasksByHourChart.tsx         # Auto Run tasks distribution by hour
├── ThroughputTrendsChart.tsx    # Dual-axis throughput and token trends
├── TokenBreakdownTooltip.tsx    # Detailed token breakdown in tooltips
├── WeekdayComparisonChart.tsx   # Weekday usage comparison
├── AutoRunStats.tsx             # Auto Run-specific statistics
├── ChartSkeletons.tsx           # Loading skeleton components
├── ChartErrorBoundary.tsx       # Error boundary with retry
└── EmptyState.tsx               # Empty state when no data
```

### Backend Components

```
src/main/stats/
├── stats-db.ts                  # SQLite database (better-sqlite3) with WAL mode
├── schema.ts                    # Table definitions and SQL statements
├── migrations.ts                # Schema migration runner (v1–v10)
├── query-events.ts              # Query event CRUD operations
├── auto-run.ts                  # Auto Run session/task operations
├── session-lifecycle.ts         # Session create/close lifecycle tracking
├── aggregations.ts              # Daily costs, model costs, agent costs, free tokens
├── data-management.ts           # Data export (CSV) and cleanup
├── row-mappers.ts               # Database row → TypeScript type mappers
├── singleton.ts                 # Singleton accessor
├── types.ts                     # Internal types (integrity, backup, migration)
└── utils.ts                     # Shared utilities and logging context

Database tables:
├── query_events                 # AI queries with duration, tokens, dual-source cost
│   ├── Base columns (v1): session_id, agent_type, source, start_time, duration
│   ├── SSH indicator (v2): is_remote
│   ├── Token tracking (v4): input_tokens, output_tokens, tokens_per_second
│   ├── Cache tokens (v5): cache_read_input_tokens, cache_creation_input_tokens, total_cost_usd
│   ├── Agent attribution (v6): agent_id (Maestro agent instance ID)
│   └── Dual-cost tracking (v7): anthropic_cost_usd, maestro_cost_usd, maestro_billing_mode,
│       anthropic_model, maestro_pricing_model, uuid, anthropic_message_id, is_reconstructed
├── auto_run_sessions            # Auto Run session tracking
├── auto_run_tasks               # Individual Auto Run task tracking
├── session_lifecycle            # Session create/close events (v3)
├── audit_snapshots              # Anthropic audit comparison results (v7)
├── audit_schedule               # Scheduled audit configuration (v7)
├── _migrations                  # Schema migration tracking
└── _meta                        # Internal key-value storage

src/main/ipc/handlers/
├── stats.ts                     # IPC handlers for stats operations
└── audit.ts                     # IPC handlers for Anthropic audit operations

src/main/services/
├── anthropic-audit-service.ts   # ccusage integration for Anthropic cost comparison
└── audit-scheduler.ts           # Scheduled daily/weekly/monthly audit runs
```

### Key Patterns

**Real-time Updates:**

```typescript
// Backend broadcasts after each database write
mainWindow?.webContents.send('stats:updated');

// Frontend subscribes with debouncing
useEffect(() => {
	const unsubscribe = window.maestro.stats.onStatsUpdated(() => {
		debouncedRefresh();
	});
	return () => unsubscribe?.();
}, []);
```

**Colorblind-Friendly Palettes:**

```typescript
import { COLORBLIND_AGENT_PALETTE, getColorBlindAgentColor } from '../constants/colorblindPalettes';
// Wong-based palette with high contrast for accessibility
```

**Chart Error Boundaries:**

```typescript
<ChartErrorBoundary chartName="Agent Comparison" onRetry={handleRetry}>
  <AgentComparisonChart data={data} colorBlindMode={colorBlindMode} />
</ChartErrorBoundary>
```

### Dual-Cost Tracking

Every query event records costs from two independent sources for reconciliation:

- **Anthropic Cost (`anthropic_cost_usd`):** The cost reported by Claude Code / the Anthropic API response
- **Maestro Cost (`maestro_cost_usd`):** Cost calculated locally by Maestro using its pricing model (`src/shared/pricing.ts`)

**Billing Mode Detection:**

Maestro asynchronously detects whether each agent is using an API key (direct billing) or an Anthropic Console / Max subscription. This affects cost calculation since Max subscriptions have different pricing. The billing mode is stored per-query as `maestro_billing_mode` (`'api'` | `'max'` | `'free'`). SSH remote agents may use different Anthropic accounts than local agents, so billing mode is detected independently per agent.

**Cache Token Tracking:**

Cache tokens are tracked separately from standard input/output tokens:

- `cache_read_input_tokens` — Tokens served from Anthropic's prompt cache (cheaper)
- `cache_creation_input_tokens` — Tokens written to the prompt cache (more expensive)

These appear in the `SummaryCards`, `TokenBreakdownTooltip`, and throughout the dashboard.

### AgentCostGraph

The `AgentCostGraph` component (`AgentCostGraph.tsx`) shows per-agent cost breakdown as a vertical bar chart:

- **Dual data source toggle:** Switch between Anthropic-reported costs and Maestro-calculated costs via `DataSourceToggle`
- **Billing mode colors:** Bars are color-coded by billing mode — green (Max), blue (API), gray (Free)
- **Top 10 agents** displayed sorted by cost descending to prevent overcrowding
- **Savings visibility:** Tooltip shows the difference between Anthropic and Maestro costs

Related cost visualization components:

- `CostOverTimeGraph` — Daily cost trends over time
- `CostByModelGraph` — Cost breakdown by Claude model (Haiku, Sonnet, Opus)

### Throughput Metrics

Token throughput (tokens/second) is tracked per query and visualized in multiple places:

- **`tokens_per_second`** column in `query_events` table records throughput per query
- **`ThroughputTrendsChart`** — Dual-axis line chart with throughput (tok/s) on left Y-axis and total output tokens on right Y-axis, with smoothing/moving average toggle
- **`AgentThroughputChart`** — Per-agent throughput comparison in the Agents tab
- **ThinkingStatusPill** — Real-time tokens/second display during active streaming

### Keyboard Mastery

Keyboard shortcut usage is tracked through the settings store to gamify keyboard-first usage:

- **`recordShortcutUsage(shortcutId)`** in `settingsStore.ts` — Called from `useMainKeyboardHandler` and `useModalHandlers` whenever a shortcut is used
- **Mastery levels** defined in `src/renderer/constants/keyboardMastery.ts`:
  - Beginner (0%), Student (25%), Performer (50%), Virtuoso (75%), Keyboard Maestro (100%)
- **Level-up celebration** — `KeyboardMasteryCelebration.tsx` component displays when a new mastery level is reached
- **`keyboardMasteryStats`** persisted in settings store with per-shortcut usage counts
- **`acknowledgeKeyboardMasteryLevel`** / **`getUnacknowledgedKeyboardMasteryLevel`** — Track which level-ups the user has seen

### Anthropic Audit Feature

A full audit system for comparing Maestro's tracked costs against Anthropic's actual API billing data:

**How it works:**

1. Uses `ccusage` CLI tool to fetch Anthropic's usage data for a date range
2. Compares token counts and costs between Anthropic and Maestro records
3. Stores results in `audit_snapshots` table with detailed breakdowns
4. Supports both local and SSH remote agents (remote agents may use different accounts)

**Key components:**

- `anthropic-audit-service.ts` — Core service integrating with `ccusage` CLI
- `audit-scheduler.ts` — Configurable daily/weekly/monthly scheduled audits
- `audit.ts` (IPC handler) — Channels: `audit:run`, `audit:getHistory`, `audit:getConfig`, `audit:saveConfig`
- `AuditReportPanel.tsx` — Dashboard panel showing audit results with filtering by status (match/minor/major/missing) and billing mode (API/Max)

**Audit result data includes:**

- Token comparison (input, output, cache read, cache write) between both sources
- Cost discrepancy in USD
- Per-model breakdown
- Billing mode breakdown (API vs Max usage)
- Anomaly detection with severity classification

### Datasource Comparison (Honeycomb MCP Integration)

The Datasource Comparison tab (`DatasourceComparisonTab.tsx`) provides a unified view comparing local Maestro stats against Honeycomb observability data via MCP:

- **`DatasourceSummaryCards`** — Side-by-side Honeycomb vs local token and cost totals
- **`DivergenceTable`** — Detailed divergence analysis between data sources
- **`PlanBudgetTracker`** — Plan budget utilization with inline budget bars aligned to Anthropic's 5-hour billing windows
- **`FlushStatusIndicator`** — Shows OTEL flush status to warn about data gaps (idle sessions may not flush telemetry)
- **Calibration UX** — Dynamic dot sizing, sliding window anchor drift correction, normalized weights via `PlanCalibrationSettings`

This feature requires Honeycomb MCP configuration and is accessed via the "DS Comparison" tab in the Usage Dashboard.

### Related Settings

```typescript
// In useSettings.ts
statsCollectionEnabled: boolean; // Enable/disable stats collection (default: true)
defaultStatsTimeRange: 'day' | 'week' | 'month' | 'year' | 'all'; // Default time filter
colorBlindMode: boolean; // Use accessible color palettes
preventSleepEnabled: boolean; // Prevent system sleep while agents are busy (default: false)
keyboardMasteryStats: KeyboardMasteryStats; // Per-shortcut usage counts and mastery level
```

---

## Document Graph

The Document Graph (`src/renderer/components/DocumentGraph/`) visualizes markdown file relationships and wiki-link connections using a canvas-based MindMap component with deterministic layout.

### Architecture

```
src/renderer/components/DocumentGraph/
├── DocumentGraphView.tsx        # Main modal with canvas-based MindMap
├── MindMap.tsx                  # Canvas rendering engine with pan/zoom
├── DocumentNode.tsx             # Document file node component
├── ExternalLinkNode.tsx         # External URL domain node
├── NodeContextMenu.tsx          # Right-click context menu (open, focus, copy path)
├── NodeBreadcrumb.tsx           # Path breadcrumb for selected node
├── GraphLegend.tsx              # Collapsible help/legend panel
├── graphDataBuilder.ts          # Scans directory, extracts links, builds graph data
├── layoutAlgorithms.ts          # Layout algorithm implementations
└── mindMapLayouts.ts            # Layout type definitions and algorithms

src/renderer/utils/
├── markdownLinkParser.ts        # Parses [[wiki-links]] and [markdown](links)
└── documentStats.ts             # Computes document statistics (word count, etc.)

src/main/ipc/handlers/
└── documentGraph.ts             # Chokidar file watcher for real-time updates
```

### Layout Options

Three layout algorithms are available, selectable via a dropdown in the header:

- **Mind Map** (`mindmap`) — Tree columns with focus document centered, linked documents alphabetized in left/right columns, external URLs clustered at the bottom
- **Radial** (`radial`) — Concentric rings radiating from the center node, evenly distributed
- **Force-Directed** (`force`) — Physics simulation using d3-force for organic clustering

```typescript
import { type MindMapLayoutType, LAYOUT_LABELS } from './mindMapLayouts';
// MindMapLayoutType = 'mindmap' | 'radial' | 'force'
```

### Focus and Ego-Network Views

The graph is centered on a **focus document** (the file that opened the graph). Users can:

- **Double-click** any document node to recenter the graph on that node
- **Neighbor depth slider** (0–5) controls how many link-hops from the focus are shown. `0` shows all documents
- **Right-click → Focus** to recenter on any node

### Node Types and Relationship Mapping

**Node types:**

- **Document nodes** — Markdown files with title, preview text, word count, line count, file size
- **External link nodes** — Grouped by domain, showing link count and individual URLs

**Edge types:**

- **Internal links** — `[[wiki-links]]` and `[markdown](relative-links)` between documents
- **External links** — URLs pointing to external domains (togglable via External button)

### Real-time Updates from Agent Activity

The backend uses Chokidar to watch for `.md` file changes in the project directory:

```typescript
// Backend watches for .md file changes (debounced at 500ms)
window.maestro.documentGraph.watchFolder(rootPath);
window.maestro.documentGraph.onFilesChanged((changes) => {
	// Invalidate cache for changed files, then rebuild graph
	invalidateCacheForFiles(changedPaths);
	debouncedRebuildGraph();
});
// Cleanup on modal close
window.maestro.documentGraph.unwatchFolder(rootPath);
```

File renames are handled gracefully — Chokidar emits `unlink` + `add` events which are batched within the 500ms debounce window and processed as a single graph rebuild.

**Background backlink scanning:** After the initial graph loads (showing outgoing links from the focus), a background scan discovers documents that link _back_ to the current graph nodes, progressively adding them.

### Markdown Preview Panel

An inline preview panel opens when pressing `P` on a selected node (or via the context menu):

- Renders full markdown with `MarkdownRenderer` (including wiki-link resolution)
- **Back/forward navigation** through clicked wiki-links within the preview
- Arrow keys (← →) navigate history
- Escape closes the preview and returns focus to the graph

### Keyboard Navigation

```typescript
// Arrow keys navigate to connected nodes (spatial detection)
// Enter/Double-click recenters the graph on the selected node
// O opens the selected node in Maestro's file preview
// P opens the inline markdown preview panel
// Cmd+F / Ctrl+F focuses the search input
// Tab cycles through connected nodes
// Escape shows close confirmation
```

### Node Drag and Position Persistence

Users can drag nodes to custom positions. Positions are:

- Preserved across depth changes and external link toggles
- Cleared when the focus document changes (recentering)
- Manually resettable via the "Reset Layout" button

### Export Capabilities

The context menu provides:

- **Copy file path** — Copy the document's relative path to clipboard
- **Open in file preview** — Open in Maestro's file preview tab
- **Open external link** — Open URLs in the system browser

### Large File Handling

Files over 1MB are truncated to first 100KB for link extraction to prevent UI blocking:

```typescript
const LARGE_FILE_THRESHOLD = 1 * 1024 * 1024; // 1MB
const LARGE_FILE_PARSE_LIMIT = 100 * 1024; // 100KB
```

### Pagination

Default limit of 200 nodes with "Load more" for large directories:

```typescript
const DEFAULT_MAX_NODES = 200;
const LOAD_MORE_INCREMENT = 25;
```

### Related Settings

```typescript
// In useSettings.ts
documentGraphShowExternalLinks: boolean; // Show external link nodes (default: false)
documentGraphMaxNodes: number; // Initial pagination limit (default: 200)
documentGraphNeighborDepth: number; // Default neighbor depth for focus mode (default: 2)
documentGraphPreviewCharLimit: number; // Characters shown in node previews (default: 100)
documentGraphLayoutType: MindMapLayoutType; // Layout algorithm ('mindmap' | 'radial' | 'force')
```

---

## Knowledge Graph

The Knowledge Graph (`src/main/ipc/handlers/knowledge-graph.ts`) is a separate feature from the Document Graph. It captures and persists session knowledge as markdown files for cross-session learning.

### How It Works

When an agent session ends (or on demand), Maestro can save a knowledge entry containing:

- Session summary and key findings
- Full conversation transcript
- Session statistics (queries, cost, context usage, exchange count)
- Agent type and detected model

Entries are saved as structured markdown files in `{userData}/knowledge_graph/` with timestamped filenames.

### IPC Channels

```typescript
window.maestro.knowledgeGraph.save(entry); // Save a knowledge entry → returns file path
window.maestro.knowledgeGraph.list(); // List all saved entries (newest first)
window.maestro.knowledgeGraph.read(filename); // Read a specific entry's content
window.maestro.knowledgeGraph.delete(filename); // Delete a specific entry
```

### Knowledge Entry Structure

Each entry is a markdown file with:

- **Header** — Session name, date, agent type, model, project path
- **Key Findings** — Summary of what was learned
- **Session Statistics** — AI responses, exchanges, log entries, cost, context usage
- **Full Conversation Transcript** — Detailed learnings from the session
