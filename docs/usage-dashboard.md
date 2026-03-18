---
title: Usage Dashboard
description: Track and analyze your AI agent usage patterns with comprehensive analytics and visualizations.
icon: chart-line
---

The Usage Dashboard provides comprehensive analytics for tracking your AI usage patterns across all sessions. View aggregated statistics, compare agent performance, and explore activity patterns over time.

![Usage Dashboard](./screenshots/usage-dashboard.png)

<Note>
The Usage Dashboard only tracks activity from within Maestro. It does not include historical data from before you started using Maestro, nor does it capture usage from agents run outside of Maestro (e.g., directly from the command line).
</Note>

## Opening the Dashboard

**Keyboard shortcut:**

- macOS: `Opt+Cmd+U`
- Windows/Linux: `Alt+Ctrl+U`

**From the menu:**

1. Click the hamburger menu (☰) in the top-left corner
2. Select **Usage Dashboard**

**From Quick Actions:**

- Press `Cmd+K` / `Ctrl+K` and search for "Usage Dashboard"

## Dashboard Tabs

The dashboard is organized into five tabs, each providing different insights into your usage:

### Overview

The Overview tab gives you a high-level summary of your AI usage:

**Summary Cards:**

- **Agents** — Total number of registered agent sessions (excludes terminal-only sessions)
- **Open Tabs** — Count of all open tabs across sessions (AI + file preview)
- **Total Queries** — Number of messages sent to AI agents
- **Queries/Session** — Average queries per agent session
- **Total Time** — Cumulative time spent waiting for AI responses
- **Avg Duration** — Average response time per query
- **Peak Hour** — Your most active hour of the day
- **Top Agent** — Your most-used AI agent
- **Interactive %** — Percentage of queries from interactive (non-Auto Run) sessions
- **Local %** — Percentage of queries run locally vs. on SSH remotes
- **Avg Throughput** — Average token throughput in tokens per second
- **Total Tokens** — Combined input and output tokens, with cache token breakdown on hover
- **Total Cost** — Aggregate API cost, with savings visibility when using Max billing

**Agent Comparison:**
A horizontal bar chart showing usage distribution across your AI agents. See at a glance which agents you use most, with query counts and time spent per agent.

**Source Distribution:**
A donut chart breaking down your queries by source:

- **Interactive** — Manual queries from AI Terminal conversations
- **Auto Run** — Automated queries from playbook execution

Toggle between **Count** (number of queries) and **Duration** (time spent) views.

**Location Distribution:**
A donut chart showing the breakdown between local and remote (SSH) queries. Useful for understanding how much work is done locally versus on remote machines.

**Peak Hours:**
A 24-hour bar chart showing when you're most active. Each bar represents an hour of the day (0–23), with height indicating query count or duration. The peak hour is highlighted. Toggle between Count and Duration views.

**Activity Heatmap:**
A GitHub-style heatmap showing your activity patterns throughout the week. Each cell represents an hour of the day, with color intensity indicating activity level. Toggle between Count and Duration views to see different perspectives.

**Duration Trends:**
A line chart showing how your query durations vary over time. Useful for spotting performance trends or changes in workload.

**Throughput Trends:**
A dual-axis line chart showing token throughput and total tokens over time. The left axis shows average throughput in tokens per second, and the right axis shows total output tokens. Includes an optional smoothing toggle for clearer trend lines.

**Cost Over Time:**
A time-series chart showing daily cost trends for the selected time range. Toggle between Maestro-calculated costs and Anthropic API pricing.

**Cost By Model:**
A breakdown of costs by Claude model (Haiku, Sonnet, Opus, etc.), showing how spend distributes across different model tiers.

### Agents

The Agents tab provides detailed per-agent analytics:

**Session Statistics:**

- **Total Sessions** — Count of registered sessions
- **By Agent** — Breakdown by agent type (Claude Code, Codex, etc.) with color-coded indicators
- **Git Repos vs Folders** — How many sessions are Git repositories versus plain directories
- **Remote vs Local** — Sessions running on remote SSH hosts versus local machine

**Agent Efficiency:**
An efficiency comparison across agents, helping identify which agents deliver the best throughput-to-cost ratio.

**Agent Comparison:**
Full agent comparison chart showing query counts and time spent per agent, with side-by-side visual comparison of your agent usage patterns.

**Agent Usage:**
Detailed per-agent usage chart with query counts and duration breakdowns.

**Agent Throughput:**
Per-agent throughput metrics showing tokens per second performance across your agents.

**Agent Cost Graph:**
A vertical bar chart showing cost breakdown by agent, sorted by cost (descending). Features include:

- Toggle between Maestro-calculated costs and Anthropic API pricing
- Color-coded bars by billing mode (green for Max subscription, blue for API key, gray for free tier)
- Hover tooltips showing exact cost values and savings
- Displays top 10 agents to prevent overcrowding

### Activity

The Activity tab shows your usage patterns over time:

- **Activity Heatmap** — GitHub-style heatmap of your weekly activity patterns
- **Weekday Comparison** — Compare usage across days of the week
- **Duration Trends** — How query durations vary over time
- **Throughput Trends** — Token throughput and total tokens over time

### Auto Run

The Auto Run tab focuses specifically on automated playbook execution:

**Metric Cards:**

- **Total Sessions** — Number of Auto Run sessions
- **Tasks Done** — Total tasks completed (with attempted count)
- **Avg Tasks/Session** — Average tasks completed per Auto Run session
- **Success Rate** — Percentage of tasks that completed successfully
- **Avg Session** — Average duration of an Auto Run session
- **Avg Task** — Average duration per individual task

**Tasks by Hour:**
A chart showing task completions broken down by hour of day.

**Longest Auto Runs:**
A table showing the longest-running Auto Run sessions with duration details.

### DS Comparison

The DS Comparison (Datasource Comparison) tab is available when Honeycomb is configured. It compares Maestro's locally tracked token usage against Honeycomb telemetry data to help validate cost accuracy.

**Datasource Summary Cards:**
Side-by-side comparison of local and Honeycomb token metrics including billable tokens, input/output breakdown, and cost.

**Divergence Table:**
Detailed comparison showing where local tracking and Honeycomb data diverge, helping identify discrepancies in token accounting.

**Plan Budget Tracker:**
Budget utilization bars showing usage against Anthropic plan limits for the 5-hour rolling window and weekly period. Helps track how close you are to rate limits.

**Calibration Settings:**
Inline calibration form for adjusting the mapping between local and Honeycomb data, with calibration history tracking.

<Note>
The DS Comparison tab only appears when Honeycomb MCP integration is configured. See your Honeycomb setup for details.
</Note>

## Dual-Cost Tracking

Maestro provides comprehensive cost tracking with automatic billing mode detection:

**Billing Mode Detection:**
Maestro automatically detects whether each agent is using an API key (pay-per-use) or an Anthropic Max subscription. SSH remote agents may use different Anthropic accounts than local agents, and each is tracked independently.

**Per-Session and Aggregate Cost Views:**

- The **Total Cost** summary card shows aggregate spend across all agents for the selected time range
- The **Agent Cost Graph** breaks down costs per agent with billing-mode color coding
- The **Cost Over Time** chart shows daily cost trends
- The **Cost By Model** chart shows spend distribution across model tiers

**Cache Token Tracking:**
Cache read and creation tokens are tracked separately, providing visibility into cost optimization. The Total Tokens summary card shows a breakdown on hover with input, output, cache read, and cache write token counts.

**Savings Visibility:**
When using a Max subscription, the dashboard shows savings compared to API pricing. The Total Cost card displays a "Saved $X.XX vs API pricing" subtitle when applicable.

## Keyboard Mastery

Maestro tracks your keyboard shortcut usage and rewards progression through five mastery levels:

| Level                | Threshold | Description         |
| -------------------- | --------- | ------------------- |
| **Beginner**         | 0%        | Just starting out   |
| **Student**          | 25%       | Learning the basics |
| **Performer**        | 50%       | Getting comfortable |
| **Virtuoso**         | 75%       | Almost there        |
| **Keyboard Maestro** | 100%      | Complete mastery    |

As you use keyboard shortcuts, Maestro tracks your usage percentage across all available shortcuts. When you reach a new level, a celebratory animation appears with confetti and level-specific messaging.

Your current mastery level is displayed in the Shortcuts Help panel (`Cmd+/` / `Ctrl+/`). The system tracks which shortcuts you've used and encourages you to discover ones you haven't tried yet.

## Time Range Filtering

Use the time range dropdown in the top-right corner to filter all dashboard data:

| Range            | Description                                |
| ---------------- | ------------------------------------------ |
| **Today**        | Current day only                           |
| **This Week**    | Current week (default)                     |
| **This Month**   | Current calendar month                     |
| **This Quarter** | Current calendar quarter                   |
| **This Year**    | Current calendar year                      |
| **All Time**     | Everything since you started using Maestro |

The selected time range applies to all tabs and charts. Your preferred time range is saved and restored between sessions.

## Keyboard Navigation

| Shortcut                       | Action                          |
| ------------------------------ | ------------------------------- |
| `Cmd+Shift+[` / `Ctrl+Shift+[` | Previous tab                    |
| `Cmd+Shift+]` / `Ctrl+Shift+]` | Next tab                        |
| `Arrow Up/Down`                | Navigate between chart sections |
| `Home`                         | Jump to first section           |
| `End`                          | Jump to last section            |
| `Esc`                          | Close dashboard                 |

## Exporting Data

Click **Export CSV** in the top-right corner to download your usage data as a CSV file. The export includes:

- Query timestamps
- Agent information
- Duration metrics
- Source categorization (interactive vs. Auto Run)

Use exported data for further analysis in spreadsheet applications or to share usage reports.

## Data Collection

### What's Tracked

The Usage Dashboard collects:

- **Query events** — Each message sent to an AI agent, including duration, agent type, and agent instance ID
- **Token usage** — Input, output, cache read, and cache creation tokens per query
- **Cost data** — Both Maestro-calculated cost and Anthropic API pricing, with billing mode (API vs Max)
- **Throughput** — Tokens per second for each query
- **Auto Run sessions** — Start/end times of automated playbook runs
- **Auto Run tasks** — Individual task completions within playbooks

### What's NOT Tracked

- Message content (your prompts and AI responses)
- File contents or paths
- Activity outside of Maestro

### Enabling/Disabling Collection

Stats collection is enabled by default. To disable:

1. Open **Settings** (`Cmd+,` / `Ctrl+,`)
2. Go to the **General** tab
3. Find **Usage Dashboard** section (marked with Beta badge)
4. Toggle off **Enable stats collection**

You can also set your **Default dashboard time range** here (Today, This Week, This Month, This Year, or All Time).

Disabling collection stops new data from being recorded but preserves existing data in the dashboard.

## Accessibility

The Usage Dashboard supports colorblind-friendly chart palettes using high-contrast colors from the Wong palette. This mode is enabled programmatically via the `colorBlindMode` setting.

<Note>
The colorblind mode setting is available in the application configuration but not yet exposed in the Settings UI. It will use accessible colors automatically when enabled.
</Note>

## Additional Features

**Real-time Updates:**
The dashboard automatically refreshes when new queries are recorded. An "Updated" indicator briefly appears when new data arrives.

**Database Size:**
The footer displays the current size of the stats database, helping you monitor storage usage over time.

## Tips

- **Check the Activity Heatmap** to understand your most productive hours
- **Use Peak Hours** to identify your most productive time of day
- **Compare agents** to see if one consistently performs faster than others
- **Monitor Auto Run vs. Interactive** ratio to understand your automation level
- **Export regularly** if you want to track long-term trends externally
- **Use time filtering** to focus on recent activity or see the big picture
