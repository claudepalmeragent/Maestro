# CLAUDE-FEATURES.md

> **Regenerated**: 2026-02-17
> **Archived version**: `__MD_ARCHIVE/CLAUDE-FEATURES_20260217_182050.md`
> **Cross-reference**: `Codebase_Context_20260217_180422.md`

Feature documentation for Maestro v0.14.5.

---

## 1. Usage Dashboard

### Backend

The Usage Dashboard is backed by a SQLite database managed by `src/main/stats/stats-db.ts`. This is a multi-file module comprising **13 files** that handle schema management, migrations, query builders, aggregation logic, and IPC handlers.

Real-time updates are broadcast to the renderer via the `stats:updated` IPC channel. When any stat changes (new session activity, cost accrual, token usage), the main process emits an event so that open dashboard views refresh without polling.

### Chart Components (16 total)

| Component | Description |
|---|---|
| `UsageDashboardModal` | Main modal container (~43KB). Orchestrates all sub-charts. |
| `SummaryCards` | High-level KPI cards (total cost, sessions, tokens) |
| `AgentComparisonChart` | Side-by-side comparison of agent performance |
| `ActivityHeatmap` | Calendar-style heatmap of session activity |
| `AgentCostGraph` | Cost breakdown per agent |
| `AgentThroughputChart` | Tokens/sec throughput per agent |
| `AgentUsageChart` | Usage volume per agent |
| `AuditReportPanel` | Anthropic billing audit comparison |
| `CostByModelGraph` | Cost segmented by model |
| `CostOverTimeGraph` | Cost trend over time |
| `LocationDistributionChart` | Geographic distribution of usage |
| `PeakHoursChart` | Usage by hour of day |
| `ReconstructionPanel` | Session reconstruction and replay |
| `SessionStats` | Per-session statistics detail view |
| `ThroughputTrendsChart` | Throughput trends over time |
| `DataSourceToggle` | Switch between data sources for charts |

### Design Considerations

- **Colorblind-friendly palettes**: All charts use palettes tested against deuteranopia, protanopia, and tritanopia. Color is never the sole differentiator; patterns and labels are always present.
- **ChartErrorBoundary**: Wraps each chart component. Uses key-based retry — when an error occurs, the boundary increments a key to force a fresh mount of the failed chart without losing the rest of the dashboard.
- **Dual-cost model**: Supports both Anthropic API pricing and Maestro-specific pricing. Users can toggle between the two to compare what they would pay directly vs. through Maestro.

---

## 2. Document Graph

### Architecture

The Document Graph uses a **canvas-based `MindMap` component** (`MindMap.tsx`, ~52KB). This is **NOT** built on React Flow — it is a custom canvas renderer with its own hit testing, pan/zoom, and node layout.

### Layout Algorithms

Layout algorithms are defined in `layoutAlgorithms.ts` and include:

- **Force-directed**: Physics-based simulation for organic, flexible layouts.
- **Hierarchical**: Tree-structured top-down or left-right layout for clear parent-child relationships.

### Component Files

| File | Description |
|---|---|
| `DocumentGraphView` | Main view container (~53KB), manages state and interactions |
| `MindMap` | Canvas renderer (~52KB), handles drawing and user input |
| `graphDataBuilder` | Transforms document data into graph node/edge structures |
| `layoutAlgorithms` | Force-directed and hierarchical layout engines |
| + 5 other files | Supporting utilities, types, and sub-components |

### Configuration

- **`DEFAULT_MAX_NODES = 200`**: Maximum number of nodes rendered in the graph to maintain performance. Beyond this, nodes are collapsed or filtered.
- **Keyboard navigation**: Full keyboard support for traversing nodes, expanding/collapsing, and searching.
- **File watching**: The graph updates in real-time when files change on disk via the file watcher system.
- **Large file handling**: Files exceeding **1MB** are truncated or summarized to prevent memory issues during graph building.

---

## 3. Knowledge Graph

The Knowledge Graph stores session learnings as individual `.md` files in the user data directory:

```
<userData>/knowledge_graph/
```

### IPC Methods

| Method | Description |
|---|---|
| `knowledgeGraph.save` | Save a new learning entry |
| `knowledgeGraph.list` | List all saved entries |
| `knowledgeGraph.get` | Retrieve a specific entry |
| `knowledgeGraph.delete` | Delete an entry |

Entries are Markdown files containing structured learnings extracted from session conversations. They can be referenced by the AI agent in future sessions for context continuity.

---

## 4. Prompt Library

The Prompt Library allows users to save, load, search, and categorize reusable prompts.

### IPC Methods (9 total)

CRUD operations for prompts, categories, search, import/export, and favorites.

### Components

| Component | Description |
|---|---|
| `PromptComposerModal` | Full prompt editor with metadata, categorization, and preview |
| `PromptLibrarySearchBar` | Search bar with category filtering and full-text search |

Prompts support variables (template placeholders), categories, tags, and favoriting. They can be inserted into the active tab input with a single click.

---

## 5. Project Folders

Project Folders are organizational containers that sit above Groups in the hierarchy:

```
Project Folder → Group → Session → AITab
```

### Implementation

- **IPC-backed CRUD**: All folder operations (create, read, update, delete, reorder) go through IPC to the main process for persistence.
- **`ProjectFoldersContext` provider**: React context that manages folder state in the renderer. Provides folder list, active folder, and mutation methods to all consuming components.

Folders allow users to organize groups of related sessions (e.g., by client project, by repository, by team).

---

## 6. Anthropic Usage Audit

The audit system compares Maestro's tracked usage against Anthropic's billing data to detect discrepancies.

### Scheduling

Audits can be configured on three schedules:

- **Daily**: Runs once per day, compares the previous day.
- **Weekly**: Runs once per week, compares the previous 7 days.
- **Monthly**: Runs once per month, compares the previous calendar month.

### Components

| Component | Description |
|---|---|
| `AuditReportPanel` | Displays audit results with discrepancy highlighting |
| `AuditHistoryTable` | Historical audit results with trend analysis |
| `AuditsSettingsTab` | Configuration for audit schedules and thresholds |

The audit system flags sessions where Maestro's tracked cost diverges from Anthropic's reported billing by more than a configurable threshold, helping users identify tracking issues or unexpected charges.
