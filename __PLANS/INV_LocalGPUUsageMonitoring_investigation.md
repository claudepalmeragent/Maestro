# Investigation: Local GPU Usage Monitoring (Phase 2, Feature 2.8)

**Date**: 2026-02-19
**Status**: APPROVED — Phases 1+3 (Ollama + macmon, local-only)
**Author**: maestro-planner (Claude Opus 4.6)
**Priority**: Medium
**Type**: Feature Investigation & Architecture Plan
**Topology**: Ollama server runs on host Mac. Micro-VMs call out to host Ollama. Both data sources are local — NO SSH needed.
**Approved Scope**: Phase 1 (Ollama `/api/ps`) + Phase 3 (macmon Apple Silicon). NVIDIA (Phase 2) and SSH remotes (Phase 4) deferred.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Current State Analysis](#3-current-state-analysis)
4. [Technical Research: GPU Monitoring Methods](#4-technical-research-gpu-monitoring-methods)
5. [Ollama Integration Research](#5-ollama-integration-research)
6. [SSH Remote Monitoring](#6-ssh-remote-monitoring)
7. [Architecture Options](#7-architecture-options)
8. [Recommended Architecture](#8-recommended-architecture)
9. [UI Design](#9-ui-design)
10. [Implementation Plan](#10-implementation-plan)
11. [Risk Assessment](#11-risk-assessment)
12. [Open Questions](#12-open-questions)

---

## 1. Executive Summary

This investigation covers adding GPU usage monitoring to Maestro, primarily for local model agents (Ollama via OpenCode, Qwen3 Coder) running on Apple Silicon and NVIDIA GPUs. The feature would show real-time GPU utilization, memory consumption, temperature, and per-model VRAM allocation in the ProcessMonitor and/or a dedicated system metrics panel.

**Key findings:**

- **Apple Silicon**: No native sudoless API exists. The best option is `macmon` (Rust-based, uses private IOReport APIs, no sudo required, outputs newline-delimited JSON). Alternatively, `powermetrics` works but requires sudo.
- **NVIDIA**: `nvidia-smi` is the standard tool. Supports CSV output, loop mode (`-l N`), and per-process GPU memory. Well-documented and reliable.
- **Ollama**: Exposes `/api/ps` endpoint with per-model `size_vram` (GPU memory) allocation. Does NOT expose GPU utilization %, temperature, or clock speeds.
- **Cross-platform**: The `systeminformation` npm package provides real-time GPU metrics on NVIDIA (calls nvidia-smi internally) but only static info on macOS. Not sufficient alone for Apple Silicon.
- **SSH Remotes**: Maestro has no remote OS detection. Running GPU monitoring commands over SSH is feasible using existing `buildSshCommand` infrastructure, but requires knowing what platform the remote host runs (needs `uname -s` detection).
- **ProcessMonitor**: Currently a process tree viewer (PIDs, runtime, commands) with zero system metrics. Has a placeholder comment at line 1386: "GPU monitoring for Apple Silicon: deferred until a practical non-sudo approach is identified."

**Recommendation**: A phased approach starting with Ollama `/api/ps` integration (no external tools needed), then adding optional `nvidia-smi` support, then optional `macmon` support for Apple Silicon.

---

## 2. Problem Statement

When running local AI models (Ollama, Qwen3, etc.), users have no visibility into GPU resource consumption from within Maestro. They must switch to external tools (Activity Monitor, nvidia-smi terminal, iStat Menus, htop) to monitor whether their GPU is saturated, how much VRAM models are consuming, or whether thermal throttling is occurring.

**User needs:**
- See which models are loaded on the GPU and how much VRAM each consumes
- See overall GPU utilization % during inference
- See GPU temperature (thermal throttling indicator)
- See memory pressure (especially on Apple Silicon unified memory)
- Monitor these on both local and SSH remote hosts

---

## 3. Current State Analysis

### 3.1 ProcessMonitor Component

**File**: `/app/Maestro/src/renderer/components/ProcessMonitor.tsx` (1,700+ lines)

The ProcessMonitor is a **process tree viewer**, not a system metrics dashboard. It shows:
- Process hierarchy: Groups > Sessions > Processes
- Per-process: PID, runtime duration, status (running/dead), tool type, command line
- Auto Run batch progress (task x/y)
- Group chat moderator/participant processes
- Kill button with confirmation dialog

**What it does NOT show**: CPU %, memory %, GPU utilization, VRAM, temperature, disk I/O, network.

**Polling**: Calls `window.maestro.process.getActiveProcesses()` every 2 seconds.

**Placeholder**: Line 1386-1387 has a deferred comment about GPU monitoring needing a non-sudo approach.

**Keyboard navigation**: Full arrow key, Enter/Space, R (refresh), Esc support.

### 3.2 System IPC Infrastructure

**File**: `/app/Maestro/src/main/ipc/handlers/system.ts` (622 lines)

Handles dialogs, fonts, shells, tunnels, updates, power management. Zero system metrics.

**File**: `/app/Maestro/src/main/debug-package/collectors/system.ts` (64 lines)

Collects static system info for debug packages: OS platform/arch, CPU count, total/free RAM. Called once, not real-time.

**No existing infrastructure** for real-time system metrics, GPU monitoring, or hardware profiling.

### 3.3 Local Model Agents

**OpenCode** (`definitions.ts:203-251`): Full local model support via `provider/model` format (e.g., `ollama/qwen3:8b`). Cost tracking supported but local models auto-detect as "free" billing mode.

**Qwen3 Coder** (`definitions.ts:196-202`): Placeholder agent. Detection defined but integration incomplete.

**Key insight**: GPU management is fully delegated to the agent CLIs (Ollama handles GPU allocation, quantization, scheduling). Maestro has zero GPU awareness.

### 3.4 SSH Remote Infrastructure

**File**: `/app/Maestro/src/main/utils/ssh-command-builder.ts`

Mature SSH command execution infrastructure exists. Commands are wrapped via `$SHELL -ilc "..."` for proper environment sourcing. Connection pooling via ControlMaster.

**Gap**: No remote OS detection. `SshRemoteConfig` stores host/port/username but not platform type. The SSH health monitor only tracks connection health, not remote capabilities.

### 3.5 Relevant Design Patterns

| Pattern | Example | Location |
|---------|---------|----------|
| Background polling service | `SshHealthMonitor` | `src/main/services/ssh-health-monitor.ts` |
| IPC handler registration | `system:*` handlers | `src/main/ipc/handlers/system.ts` |
| Preload API exposure | `window.maestro.system.*` | `src/main/preload/system.ts` |
| Real-time push to renderer | `mainWindow.webContents.send()` | Used throughout for events |
| Polling in renderer | `setInterval(fetch, 2000)` | `ProcessMonitor.tsx:224-231` |

---

## 4. Technical Research: GPU Monitoring Methods

### 4.1 Apple Silicon (M1/M2/M3/M4/M5)

| Method | Sudo | Real-time | Output Format | Data Available |
|--------|------|-----------|---------------|----------------|
| `powermetrics` | **YES** | Yes | plist, text | GPU power, frequency, active residency, per-process GPU time |
| `macmon` (brew) | No | Yes | Newline-delimited JSON | GPU power, frequency, utilization %, temperature, memory |
| `system_profiler` | No | **No** (static) | JSON, XML, text | GPU model, VRAM, Metal version, core count |
| `ioreg` | No | **No** (static) | Text | Hardware identifiers |
| `systeminformation` (npm) | No | **No** (static) | JSON | GPU model, VRAM, cores, Metal version |
| `app.getGPUInfo()` (Electron) | No | **No** (static) | JSON | GPU vendor, device ID, driver |

**Winner for Apple Silicon**: `macmon` (Rust-based, uses private IOReport APIs)
- Install: `brew install vladkens/tap/macmon`
- Run: `macmon raw` (outputs newline-delimited JSON, configurable interval)
- No sudo required
- Exposes: GPU power (W), frequency (MHz), utilization %, temperature, unified memory usage
- **Limitation**: Third-party tool, requires user to install via Homebrew. Not bundled.

**Apple Silicon unified memory note**: There is no separate "GPU VRAM" on Apple Silicon. CPU and GPU share unified memory. `os.totalmem()` / `os.freemem()` gives total system memory. GPU memory allocation is tracked per-model by Ollama's `/api/ps` (`size_vram` field).

### 4.2 NVIDIA GPUs (Linux/Windows)

| Method | Sudo | Real-time | Output Format | Data Available |
|--------|------|-----------|---------------|----------------|
| `nvidia-smi` (query) | No | Yes | CSV | GPU util %, memory util %, VRAM used/total/free, temp, power, clocks |
| `nvidia-smi` (loop) | No | Yes | CSV (streaming) | Same as above, continuous output |
| `nvidia-smi` (XML) | No | Yes | XML | Full data including per-process GPU memory |
| `systeminformation` (npm) | No | Yes | JSON | Same as nvidia-smi (calls it internally) |
| `node-nvidia-smi` (npm) | No | Yes | JSON | Parsed nvidia-smi output |

**Winner for NVIDIA**: Direct `nvidia-smi` with CSV query mode, or loop mode for continuous streaming.

```bash
# Single query
nvidia-smi --query-gpu=utilization.gpu,utilization.memory,memory.total,memory.used,memory.free,temperature.gpu,power.draw --format=csv,noheader,nounits

# Continuous (every 2 seconds)
nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits -l 2
```

**Performance note**: Enable persistence mode (`sudo nvidia-smi -pm 1`) to reduce query overhead. Polling at <1s intervals without persistence mode can cause ~20% GPU performance degradation.

### 4.3 AMD GPUs (Linux)

| Method | Sudo | Real-time | Data Available |
|--------|------|-----------|----------------|
| `rocm-smi` | No | Yes | GPU util %, VRAM, temp, power, clocks |
| `radeontop` | Yes | Yes | GPU pipe utilization |

**AMD support is lower priority** but `rocm-smi` follows the same pattern as `nvidia-smi` and could be added later.

### 4.4 Summary: Platform Detection Requirements

To know which monitoring tool to use, Maestro must detect:
1. **Local platform**: `process.platform` (already available)
2. **Local GPU type**: Check for `nvidia-smi`, `macmon`, `rocm-smi` binary existence
3. **Remote platform**: `uname -s` over SSH (NOT currently implemented)
4. **Remote GPU type**: Check for tool binaries over SSH

---

## 5. Ollama Integration Research

### 5.1 `/api/ps` Endpoint

Ollama exposes loaded model information at `http://localhost:11434/api/ps`:

```json
{
  "models": [
    {
      "name": "qwen3:8b",
      "model": "qwen3:8b",
      "size": 5137025024,
      "details": {
        "family": "llama",
        "parameter_size": "7.2B",
        "quantization_level": "Q4_0"
      },
      "expires_at": "2024-06-04T14:38:31Z",
      "size_vram": 5137025024
    }
  ]
}
```

**Key fields:**
| Field | Description |
|-------|-------------|
| `name` | Model name and tag |
| `size` | Total model size in bytes (RAM + VRAM combined) |
| `size_vram` | Bytes allocated on GPU. When `size_vram == size`, model is 100% GPU-loaded. When 0 or omitted, model is CPU-only. |
| `details.parameter_size` | Model parameter count (e.g., "7.2B") |
| `details.quantization_level` | Quantization format (e.g., "Q4_0", "Q8_0") |
| `expires_at` | When the model will auto-unload from memory |

**What Ollama does NOT expose:**
- GPU utilization %
- GPU temperature
- GPU clock speeds
- Per-token memory changes

### 5.2 Ollama Port Detection

Default port is `11434`. Can be overridden via `OLLAMA_HOST` env var. For remote hosts, Ollama may be listening on a different port or not at all.

**Detection strategy:**
1. Check if `ollama` binary exists (local or remote via SSH)
2. Try `curl http://localhost:11434/api/ps` (or configured host)
3. If successful, Ollama is running and we can poll model status

### 5.3 Value Proposition

Even without GPU utilization %, Ollama `/api/ps` provides critical visibility:
- **Which models are loaded** and consuming resources
- **How much VRAM** each model uses (total and per-model breakdown)
- **GPU vs CPU offloading** (when `size_vram < size`, model is partially CPU-bound)
- **Expiration time** (when the model will auto-unload, freeing VRAM)
- **Quantization level** (helps explain memory usage: Q4_0 vs Q8_0 vs FP16)

This alone covers ~60% of the user need without any external tool dependencies.

---

## 6. SSH Remote Monitoring

### 6.1 Feasibility

Running GPU monitoring commands on SSH remotes is technically feasible using Maestro's existing `buildSshCommand` infrastructure. The pattern would be:

```typescript
const remoteOptions: RemoteCommandOptions = {
  command: 'sh',
  args: ['-c', 'nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits'],
};
const sshCommand = await buildSshCommand(sshConfig, remoteOptions);
const result = await execFileNoThrow(sshCommand.command, sshCommand.args);
```

### 6.2 Challenges

1. **No remote OS detection**: Must add `uname -s` / `uname -m` detection to know which tool to run
2. **Tool availability**: Cannot assume `nvidia-smi` or `macmon` is installed on remotes
3. **Latency**: Each SSH command adds ~50-200ms latency. Polling every 2s is fine; <1s is problematic.
4. **Ollama API access**: Ollama's HTTP API on remotes is `localhost:11434` on the remote host. Cannot directly reach it from Maestro. Must tunnel or proxy via SSH.

### 6.3 Ollama on Remote Hosts

For Ollama API access on SSH remotes, two approaches:

**Option A: SSH tunnel** (persistent, low latency)
```bash
ssh -L 11434:localhost:11434 user@remote-host -N
```
Then poll `http://localhost:11434/api/ps` locally. But managing SSH tunnels adds complexity.

**Option B: SSH command** (simple, higher latency)
```bash
ssh user@remote-host "curl -s http://localhost:11434/api/ps"
```
Simpler but adds SSH round-trip latency to every poll.

**Recommendation**: Option B for MVP (simple), Option A for optimization later.

### 6.4 Remote Platform Detection (New Capability)

To support GPU monitoring on remotes, add a one-time platform probe:

```typescript
interface RemotePlatformInfo {
  os: string;           // 'Darwin' | 'Linux' | 'Windows_NT'
  arch: string;         // 'arm64' | 'x86_64' | 'aarch64'
  hasNvidiaSmi: boolean;
  hasMacmon: boolean;
  hasRocmSmi: boolean;
  hasOllama: boolean;
  ollamaHost?: string;  // OLLAMA_HOST env var value
}
```

Detected via single SSH command:
```bash
uname -s && uname -m && which nvidia-smi 2>/dev/null && which macmon 2>/dev/null && which rocm-smi 2>/dev/null && which ollama 2>/dev/null && echo $OLLAMA_HOST
```

Cache the result per remote (refresh on demand or every 10 minutes).

---

## 7. Architecture Options

### Option A: Dedicated GPU Monitor Service (Recommended)

Create a new background service `GpuMonitorService` (similar to `SshHealthMonitor`) that:
- Detects available GPU monitoring tools on startup
- Polls GPU metrics at configurable intervals (2-3s default)
- Pushes updates to renderer via IPC events
- Supports both local and remote (SSH) hosts
- Handles tool absence gracefully (shows "GPU monitoring unavailable")

**Pros**: Clean separation, reusable, follows existing patterns.
**Cons**: New service to maintain, new IPC channels.

### Option B: Extend ProcessMonitor

Add GPU metrics directly into the existing ProcessMonitor component:
- Add a "System Resources" section at the top of the process tree
- Query GPU data alongside process data in the same 2s polling interval
- Reuse existing refresh/polling infrastructure

**Pros**: No new service, single polling loop, familiar UI location.
**Cons**: ProcessMonitor is already 1,700+ lines, mixing concerns (process tree + system metrics), harder to test independently.

### Option C: Standalone System Dashboard

Create a new top-level modal/panel (like Usage Dashboard) specifically for system metrics:
- GPU, CPU, memory, temperature
- Per-model VRAM allocation (Ollama)
- Per-process GPU usage (NVIDIA)
- Historical graphs

**Pros**: Clean UI, room for rich visualizations, no existing code entangled.
**Cons**: Largest implementation effort, new keyboard shortcut needed, yet another modal.

### Option D: Hybrid (Recommended Combination)

- **Option A** (background service) for data collection
- **Option B** (ProcessMonitor) for primary display — add a collapsible "GPU Resources" section
- **Option C** (dashboard) deferred as future enhancement if demand warrants

---

## 8. Recommended Architecture

### 8.1 Overview

```
                    ┌─────────────────────┐
                    │  ProcessMonitor.tsx  │
                    │  (GPU section)       │
                    │  ┌───────────────┐   │
                    │  │ GPU Resources │   │
                    │  │  Util: 45%    │   │
                    │  │  VRAM: 6/8 GB │   │
                    │  │  Temp: 62 C   │   │
                    │  │  Models:      │   │
                    │  │   qwen3:8b    │   │
                    │  │    4.8 GB GPU │   │
                    │  └───────────────┘   │
                    └─────────┬───────────┘
                              │ IPC events
                    ┌─────────┴───────────┐
                    │  GpuMonitorService   │
                    │  (main process)      │
                    │  ┌────────────────┐  │
                    │  │ Local probes   │  │
                    │  │  nvidia-smi    │  │
                    │  │  macmon        │  │
                    │  │  ollama /ps    │  │
                    │  ├────────────────┤  │
                    │  │ Remote probes  │  │
                    │  │  SSH + nvidia  │  │
                    │  │  SSH + ollama  │  │
                    │  └────────────────┘  │
                    └─────────────────────┘
```

### 8.2 Data Model

```typescript
interface GpuMetrics {
  timestamp: number;
  source: 'local' | string;  // 'local' or SSH remote ID

  // GPU hardware metrics (from nvidia-smi / macmon)
  gpu?: {
    name: string;              // "NVIDIA RTX 4090" or "Apple M4 Max"
    utilizationPercent?: number;
    temperatureCelsius?: number;
    powerDrawWatts?: number;
    memoryTotalMB?: number;
    memoryUsedMB?: number;
    memoryFreeMB?: number;
    clockCoreMHz?: number;
  };

  // Ollama-specific model allocation
  ollamaModels?: OllamaModelStatus[];

  // Detection metadata
  detectionMethod: 'nvidia-smi' | 'macmon' | 'ollama-only' | 'none';
  error?: string;
}

interface OllamaModelStatus {
  name: string;              // "qwen3:8b"
  sizeBytes: number;         // Total model size
  sizeVramBytes: number;     // GPU allocation
  gpuPercent: number;        // sizeVram / size * 100
  parameterSize: string;     // "7.2B"
  quantization: string;      // "Q4_0"
  expiresAt?: string;        // ISO 8601 auto-unload time
}
```

### 8.3 Service Design

```typescript
class GpuMonitorService {
  private interval: NodeJS.Timeout | null = null;
  private localCapabilities: LocalGpuCapabilities;
  private remoteCapabilities: Map<string, RemoteGpuCapabilities>;

  // Lifecycle
  start(intervalMs: number = 3000): void;
  stop(): void;

  // Detection (one-time)
  detectLocalCapabilities(): Promise<LocalGpuCapabilities>;
  detectRemoteCapabilities(sshRemoteId: string): Promise<RemoteGpuCapabilities>;

  // Polling (periodic)
  collectLocalMetrics(): Promise<GpuMetrics>;
  collectRemoteMetrics(sshRemoteId: string): Promise<GpuMetrics>;

  // Events
  onMetricsUpdate: EventEmitter<GpuMetrics[]>;
}
```

### 8.4 IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `gpu-monitor:getCapabilities` | Request/Response | Get detected GPU monitoring capabilities |
| `gpu-monitor:getMetrics` | Request/Response | Get latest metrics snapshot |
| `gpu-monitor:start` | Request | Start polling (with interval) |
| `gpu-monitor:stop` | Request | Stop polling |
| `gpu-monitor:metrics-update` | Push (main -> renderer) | Real-time metrics push |
| `gpu-monitor:detectRemote` | Request/Response | Probe remote host for GPU tools |

### 8.5 Phased Implementation

#### Phase 1: Ollama Model Status (No External Tools)

- Poll Ollama `/api/ps` locally
- Show loaded models, VRAM allocation, expiration, quantization
- Add collapsible "GPU Resources" section to ProcessMonitor
- **No dependency on macmon, nvidia-smi, or any external tool**
- Covers the highest-value use case: "how much VRAM are my models using?"

#### Phase 2: NVIDIA GPU Metrics

- Detect `nvidia-smi` binary (local)
- Spawn `nvidia-smi` in loop mode or periodic query mode
- Parse CSV output for utilization, memory, temperature
- Merge with Ollama model data for rich display
- Add GPU utilization %, temperature, power draw to UI

#### Phase 3: Apple Silicon GPU Metrics

- Detect `macmon` binary (local, Homebrew)
- Spawn `macmon raw` for continuous JSON metrics
- Parse GPU power, frequency, temperature
- Note: No per-process GPU breakdown on Apple Silicon (Ollama `/api/ps` covers per-model VRAM)
- Show install instructions if macmon not found: `brew install vladkens/tap/macmon`

#### Phase 4: SSH Remote GPU Monitoring

- Add remote platform detection (`uname -s`, tool availability)
- Execute GPU monitoring commands over SSH
- Poll Ollama `/api/ps` on remotes via `ssh user@host "curl -s http://localhost:11434/api/ps"`
- Execute `nvidia-smi` on NVIDIA-equipped remotes via SSH
- Cache remote capabilities per host

---

## 9. UI Design

### 9.1 ProcessMonitor Integration

Add a collapsible "GPU Resources" section at the top of the ProcessMonitor, before the process tree:

```
┌─────────────────────────────────────────────────────┐
│ System Processes                              [R] X │
│                                                     │
│ ▼ GPU Resources                         ● Polling   │
│   ┌─────────────────────────────────────────────┐   │
│   │ NVIDIA RTX 4090                             │   │
│   │ GPU: ████████░░ 78%   Temp: 62C   180W/350W│   │
│   │ VRAM: ████████░░ 6.2 / 8.0 GB (77%)        │   │
│   ├─────────────────────────────────────────────┤   │
│   │ Loaded Models (Ollama)                      │   │
│   │  qwen3:8b     Q4_0  4.8 GB GPU  100% GPU   │   │
│   │  nomic-embed  Q8_0  0.3 GB GPU  100% GPU   │   │
│   │  deepseek-r1  Q4_K  1.1 GB GPU   60% GPU   │   │
│   └─────────────────────────────────────────────┘   │
│                                                     │
│ ▼ SESSIONS (3 active)                               │
│   ▼ 📂 Project Alpha                               │
│     ▼ maestro-planner (PID: 12345)                  │
│       [Running] 2h 15m                              │
│     ...                                             │
└─────────────────────────────────────────────────────┘
```

### 9.2 Apple Silicon Variant

```
┌─────────────────────────────────────────────────────┐
│ ▼ GPU Resources                         ● Polling   │
│   ┌─────────────────────────────────────────────┐   │
│   │ Apple M4 Max (40-core GPU)                  │   │
│   │ GPU Power: 12.3W   Freq: 1398 MHz          │   │
│   │ Unified Memory: 48 / 64 GB (75%)           │   │
│   ├─────────────────────────────────────────────┤   │
│   │ Loaded Models (Ollama)                      │   │
│   │  qwen3:8b     Q4_0  4.8 GB GPU  100% GPU   │   │
│   └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### 9.3 No GPU Available Variant

```
┌─────────────────────────────────────────────────────┐
│ ▼ GPU Resources                                     │
│   ┌─────────────────────────────────────────────┐   │
│   │ No GPU monitoring available                 │   │
│   │ Install macmon for Apple Silicon metrics:   │   │
│   │ brew install vladkens/tap/macmon            │   │
│   └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### 9.4 Ollama-Only Variant (Phase 1 MVP)

When no GPU monitoring tool is installed but Ollama is detected:

```
┌─────────────────────────────────────────────────────┐
│ ▼ GPU Resources                         ● Polling   │
│   ┌─────────────────────────────────────────────┐   │
│   │ Loaded Models (Ollama)                      │   │
│   │  qwen3:8b     Q4_0  4.8 GB GPU  100% GPU   │   │
│   │  nomic-embed  Q8_0  0.3 GB GPU  100% GPU   │   │
│   │                                             │   │
│   │  Total GPU: 5.1 GB across 2 models          │   │
│   │  Unloads in: 4m 32s (idle timeout)          │   │
│   │                                             │   │
│   │ ℹ Install nvidia-smi or macmon for full     │   │
│   │   GPU utilization and temperature metrics   │   │
│   └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### 9.5 Multi-Host Display (Phase 4)

When monitoring both local and remote hosts:

```
┌─────────────────────────────────────────────────────┐
│ ▼ GPU Resources                         ● Polling   │
│   ┌─────────────────────────────────────────────┐   │
│   │ 🖥 Local (Apple M4 Max)                     │   │
│   │  GPU Power: 12.3W   Freq: 1398 MHz         │   │
│   │  Models: qwen3:8b (4.8 GB)                  │   │
│   ├─────────────────────────────────────────────┤   │
│   │ 🌐 gpu-server-01 (NVIDIA RTX 4090)         │   │
│   │  GPU: 78%   VRAM: 6.2/8.0 GB   Temp: 62C  │   │
│   │  Models: deepseek-r1 (5.1 GB)              │   │
│   ├─────────────────────────────────────────────┤   │
│   │ 🌐 gpu-server-02                            │   │
│   │  ⚠ No GPU tools detected                   │   │
│   └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

---

## 10. Implementation Plan

### 10.1 File Structure

```
src/main/
  services/
    gpu-monitor-service.ts          # NEW - Background monitoring service
  ipc/handlers/
    gpu-monitor.ts                  # NEW - IPC handlers
  preload/
    gpu-monitor.ts                  # NEW - Preload API
  utils/
    gpu-probe.ts                    # NEW - Tool detection & command parsing

src/renderer/
  components/
    ProcessMonitor.tsx              # MODIFY - Add GPU Resources section
    GpuResourcesPanel.tsx           # NEW - GPU metrics display component
  hooks/
    useGpuMetrics.ts                # NEW - Hook for consuming GPU data
  global.d.ts                       # MODIFY - Add gpuMonitor types
```

### 10.2 Phase Breakdown

| Phase | Scope | Effort | Dependencies |
|-------|-------|--------|-------------|
| **Phase 1** | Ollama `/api/ps` + ProcessMonitor section | 4-6 hours | None |
| **Phase 2** | NVIDIA `nvidia-smi` integration | 3-4 hours | Phase 1 |
| **Phase 3** | Apple Silicon `macmon` integration | 3-4 hours | Phase 1 |
| **Phase 4** | SSH remote monitoring | 4-6 hours | Phase 1 + remote OS detection |

**Total estimated effort**: 14-20 hours across all phases.

### 10.3 Phase 1 Tasks (MVP)

1. Create `gpu-probe.ts` — detect Ollama binary and API availability
2. Create `gpu-monitor-service.ts` — poll Ollama `/api/ps`, parse response
3. Create `gpu-monitor.ts` IPC handlers — `gpu-monitor:getMetrics`, `gpu-monitor:start/stop`
4. Create `gpu-monitor.ts` preload — expose `window.maestro.gpuMonitor.*`
5. Create `GpuResourcesPanel.tsx` — render Ollama model list with VRAM bars
6. Modify `ProcessMonitor.tsx` — add collapsible GPU Resources section at top
7. Create `useGpuMetrics.ts` hook — subscribe to IPC metrics updates
8. TypeScript verification

### 10.4 Phase 2 Tasks (NVIDIA)

1. Extend `gpu-probe.ts` — detect `nvidia-smi` binary
2. Add NVIDIA collector to `gpu-monitor-service.ts` — spawn `nvidia-smi` query, parse CSV
3. Extend `GpuResourcesPanel.tsx` — show GPU utilization bar, temperature, power, VRAM
4. Merge NVIDIA metrics with Ollama model data
5. TypeScript verification

### 10.5 Phase 3 Tasks (Apple Silicon)

1. Extend `gpu-probe.ts` — detect `macmon` binary
2. Add macmon collector to `gpu-monitor-service.ts` — spawn `macmon raw`, parse JSON stream
3. Extend `GpuResourcesPanel.tsx` — show Apple Silicon GPU power, frequency, unified memory
4. Add "install macmon" help text when not detected on Apple Silicon
5. TypeScript verification

### 10.6 Phase 4 Tasks (SSH Remotes)

1. Add remote platform detection to `gpu-probe.ts` — `uname -s`, tool availability via SSH
2. Add remote collectors to `gpu-monitor-service.ts` — execute monitoring commands over SSH
3. Add Ollama API polling on remotes via SSH (`curl` command over SSH)
4. Extend `GpuResourcesPanel.tsx` — multi-host display with host labels
5. Cache remote capabilities per host
6. TypeScript verification

---

## 11. Risk Assessment

| Risk | Severity | Likelihood | Mitigation |
|------|----------|-----------|------------|
| `macmon` not installed on user's Mac | Medium | High | Phase 1 uses Ollama only (no external tools). Show helpful install instructions. |
| `nvidia-smi` not available on Linux without NVIDIA GPU | Low | Medium | Graceful fallback — tool detection before use. |
| Ollama not running / not installed | Low | Medium | Detect on startup, hide GPU section if no tools found. |
| SSH command latency too high for 2-3s polling | Low | Low | SSH connection pooling already exists. Can increase interval. |
| `macmon` API changes / breaks | Medium | Low | Pin to known working version. Add version detection. |
| ProcessMonitor file too large (already 1700+ lines) | Medium | Certain | Extract GPU section into separate `GpuResourcesPanel.tsx` component. |
| Unified memory confusion on Apple Silicon | Low | Medium | Label clearly: "Unified Memory" not "GPU VRAM". Show context. |
| Remote Ollama port != 11434 | Low | Low | Check `OLLAMA_HOST` env var on remote. Make port configurable. |
| `powermetrics` sudo requirement blocks Apple Silicon users without `macmon` | Medium | Medium | Clearly document `macmon` as the recommended tool. Do not attempt `powermetrics` without explicit user consent. |
| Performance impact from nvidia-smi polling | Low | Low | Use loop mode (`-l 2`), not repeated spawns. Enable persistence mode documentation. |

---

## 12. Open Questions

### Resolved

1. **Q: Does Ollama expose GPU metrics via API?**
   A: Partially. `/api/ps` exposes per-model VRAM allocation (`size_vram`) and model metadata, but NOT GPU utilization %, temperature, or clock speeds. Those require nvidia-smi or macmon.

2. **Q: Is there a sudoless GPU monitoring option for Apple Silicon?**
   A: Yes. `macmon` (Rust-based, uses private IOReport APIs). Install via `brew install vladkens/tap/macmon`. No sudo required.

3. **Q: Can we monitor GPU on SSH remotes?**
   A: Yes. Use existing `buildSshCommand` infrastructure. Need to add remote OS/tool detection first.

4. **Q: Does `systeminformation` npm package cover our needs?**
   A: Only for NVIDIA (it calls nvidia-smi internally). On macOS it returns static info only. Not sufficient as the sole solution.

### Unresolved (For User Decision)

5. **Q: Should Phase 1 (Ollama-only) be the stopping point, or should we commit to all 4 phases?**
   Options: MVP-only vs. full implementation. Phase 1 provides significant value with minimal effort.

6. **Q: Should GPU monitoring be always-on or opt-in?**
   Options: (a) Always poll when ProcessMonitor is open, (b) Toggle in settings, (c) Start polling only when GPU section is expanded.
   Recommendation: Poll only when ProcessMonitor is open AND GPU section is expanded. No background polling when UI is closed.

7. **Q: Should we add `macmon` as a bundled dependency or require user installation?**
   Options: (a) User installs via Homebrew (simpler, less maintenance), (b) Bundle macmon binary (larger app, licensing concerns — macmon is MIT-licensed so OK legally).
   Recommendation: User installs via Homebrew. Show inline instructions.

8. **Q: Should we show GPU data in the Session List sidebar (e.g., per-agent GPU usage)?**
   This would be a future enhancement beyond ProcessMonitor integration.

9. **Q: What polling interval?**
   Recommendation: 3 seconds for GPU hardware metrics, 5 seconds for Ollama model status (model loading/unloading is infrequent).

---

**Document Prepared By**: maestro-planner (Claude Opus 4.6)
**Investigation Completed**: 2026-02-19
**Ready for Review**: Yes
