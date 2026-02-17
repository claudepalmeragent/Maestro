# Adding New AI Agent Support to Maestro

> **Version**: 0.14.5
> **Regenerated**: 2026-02-17
> **Archived at**: `__MD_ARCHIVE/AGENT_SUPPORT_20260217_182050.md`
> **Cross-reference**: `Codebase_Context_20260217_180422.md`

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Vernacular](#2-vernacular)
3. [Agent Capability Model](#3-agent-capability-model)
4. [Step-by-Step Integration Guide](#4-step-by-step-integration-guide)
5. [ParsedEvent Types](#5-parsedevent-types)
6. [Usage Aggregator](#6-usage-aggregator)
7. [Supported Agents Reference](#7-supported-agents-reference)
8. [Error Handling](#8-error-handling)

---

## 1. Architecture Overview

Maestro employs a **multi-provider pluggable architecture** that abstracts away
the differences between AI coding agents behind a unified interface. Each agent
is a separate binary that Maestro spawns as a child process, communicating over
stdin/stdout/stderr pipes. The architecture is composed of seven core components
that work together to provide a consistent experience regardless of the
underlying agent.

### Core Components

| Component             | Responsibility                                              |
|-----------------------|-------------------------------------------------------------|
| **Capability System** | Declares what each agent supports via boolean feature flags |
| **Generic Identifiers** | Maps agent-specific concepts to Maestro-internal types    |
| **Session Storage**   | Reads and indexes conversation history from agent-native formats |
| **Output Parsers**    | Transforms agent stdout into a normalized `ParsedEvent` stream |
| **Error Handling**    | Three-layer detection of failures with categorized error types |
| **IPC API**           | Electron main-process handlers exposed to the renderer      |
| **UI Capability Gates** | Renderer components that show/hide features based on agent capabilities |

### Data Flow

The following diagram illustrates the path data takes from the user through
Maestro and back.

```
  +---------------------+
  |     Renderer (UI)    |
  |  Capability Gates    |
  +----------+----------+
             |  IPC (invoke / on)
             v
  +----------+----------+
  |   Electron Main      |
  |   Process (IPC API)  |
  +----------+----------+
             |
     +-------+-------+
     |               |
     v               v
+----+----+   +------+------+
| Session |   | Agent       |
| Storage |   | Spawner     |
+---------+   +------+------+
                     |
              spawn child process
                     |
            +--------+--------+
            |  stdout / stderr |
            +--------+--------+
                     |
              +------+------+
              | Output      |
              | Parser      |
              +------+------+
                     |
              +------+------+
              | Error       |
              | Handler     |
              +------+------+
                     |
              ParsedEvent stream
                     |
                     v
              +------+------+
              | Usage       |
              | Aggregator  |
              +------+------+
                     |
                     v
              Renderer (UI)
```

### Key Design Principles

- **Agent binaries are external**: Maestro never bundles agent binaries. It
  detects them on the host filesystem and spawns them as child processes.
- **Parsers are pluggable**: Each agent has its own output parser registered
  via the `registerOutputParser()` pattern -- there is no central switch-case.
- **Capabilities drive the UI**: The renderer does not hardcode which features
  are available for which agent. Instead, it queries the capability flags and
  conditionally renders UI elements.
- **Storage is read-only**: Maestro reads session data from agent-native
  storage formats but does not write to them. Session state within Maestro
  (tabs, layout, etc.) is stored separately.

---

## 2. Vernacular

Before diving into implementation details, it is important to understand the
terminology used throughout the Maestro codebase.

### ToolType

The primary identifier for an agent. Despite the name (a historical artifact),
`ToolType` is an enum-like string union that uniquely identifies each supported
agent. Examples: `"claude-code"`, `"codex"`, `"opencode"`, `"terminal"`,
`"gemini-cli"`, `"qwen3-coder"`, `"aider"`.

The name "ToolType" comes from the original design where agents were considered
"tools" that the user could switch between. The name has been retained for
backward compatibility.

### Session

A **Session** in Maestro corresponds to a UI workspace. It is the top-level
container that holds one or more Tabs. Each Session is associated with a
working directory and an agent type. Sessions are displayed as cards in the
session picker and can be searched, filtered, and resumed.

### Tab

A **Tab** represents a single conversation within a Session. Tabs appear as
horizontal tabs within the main workspace area. Each Tab has its own message
history, scroll position, and input state. A Session always has at least one
Tab.

### AgentSessionId

The **AgentSessionId** is the persistent identifier that the external agent
uses to track its own session. For example, Claude Code uses a session ID
embedded in its JSONL log files. When Maestro resumes a session, it passes
this ID back to the agent via the appropriate CLI arguments. Not all agents
support resume, so this field may be empty.

### ParsedEvent

The normalized event type that all output parsers produce. Every line of agent
output is transformed into one or more `ParsedEvent` objects, which the UI
then renders. See Section 5 for the full type catalog.

### Capability Flag

A boolean field on the `AgentCapabilities` interface. Each flag indicates
whether a specific feature is supported by a given agent. The UI reads these
flags to determine which controls to display. See Section 3 for the complete
list.

---

## 3. Agent Capability Model

The capability model is the central mechanism by which Maestro adapts its UI
and behavior to the features of each agent. Every agent must declare its
capabilities by providing an `AgentCapabilities` object.

### The `AgentCapabilities` Interface

The interface is defined in `src/main/agents/capabilities.ts` and contains
exactly **19 boolean flags** as of v0.14.5.

```typescript
interface AgentCapabilities {
  // --- Input Capabilities ---

  /** Whether the agent accepts text input via stdin */
  supportsInput: boolean;

  /** Whether the agent accepts stream-json formatted input */
  supportsStreamJsonInput: boolean;

  /** Whether the agent can process image inputs (base64 or file path) */
  supportsImageInput: boolean;

  // --- Authentication ---

  /** Whether the agent uses an API key for authentication */
  supportsApiKeyAuth: boolean;

  /** Whether the agent supports Anthropic Max (subscription-based) auth */
  supportsMaxAuth: boolean;

  // --- Configuration Overrides ---

  /** Whether the user can override the model selection */
  supportsModelOverride: boolean;

  /** Whether the user can override the context window size */
  supportsContextWindowOverride: boolean;

  // --- Operational Modes ---

  /** Whether the agent supports a read-only mode (no file writes) */
  supportsReadOnlyMode: boolean;

  /** Whether the agent supports YOLO mode (auto-approve all tool calls) */
  supportsYoloMode: boolean;

  // --- Session Management ---

  /** Whether the agent can resume a previous session */
  supportsResume: boolean;

  /** Whether the agent supports slash commands (e.g., /help, /clear) */
  supportsSlashCommands: boolean;

  /** Whether the agent supports print mode (non-interactive output) */
  supportsPrintMode: boolean;

  // --- Execution Environment ---

  /** Whether the user can specify a custom binary path */
  supportsCustomPath: boolean;

  /** Whether the user can append custom CLI arguments */
  supportsCustomArgs: boolean;

  /** Whether the user can inject custom environment variables */
  supportsCustomEnvVars: boolean;

  // --- Advanced Features ---

  /** Whether the agent reports status bar information */
  supportsStatusBar: boolean;

  /** Whether the agent can execute on a remote host (e.g., via SSH) */
  supportsRemoteExecution: boolean;

  /** Whether the agent supports batch mode (non-interactive, scripted) */
  supportsBatch: boolean;

  /** Whether the agent supports file attachments in prompts */
  supportsAttachments: boolean;
}
```

### Capability Flag Summary Table

| #  | Flag                            | Claude Code | Codex | OpenCode | Terminal |
|----|---------------------------------|:-----------:|:-----:|:--------:|:--------:|
| 1  | supportsInput                   | yes         | yes   | yes      | yes      |
| 2  | supportsStreamJsonInput         | yes         | no    | no       | no       |
| 3  | supportsImageInput              | yes         | no    | no       | no       |
| 4  | supportsApiKeyAuth              | yes         | yes   | yes      | no       |
| 5  | supportsMaxAuth                 | yes         | no    | no       | no       |
| 6  | supportsModelOverride           | yes         | yes   | no       | no       |
| 7  | supportsContextWindowOverride   | yes         | no    | no       | no       |
| 8  | supportsReadOnlyMode            | yes         | no    | no       | no       |
| 9  | supportsYoloMode                | yes         | no    | no       | no       |
| 10 | supportsResume                  | yes         | yes   | no       | no       |
| 11 | supportsSlashCommands           | yes         | no    | no       | no       |
| 12 | supportsPrintMode               | yes         | no    | no       | no       |
| 13 | supportsCustomPath              | yes         | yes   | yes      | no       |
| 14 | supportsCustomArgs              | yes         | yes   | yes      | no       |
| 15 | supportsCustomEnvVars           | yes         | yes   | yes      | no       |
| 16 | supportsStatusBar               | yes         | no    | no       | no       |
| 17 | supportsRemoteExecution         | yes         | no    | no       | no       |
| 18 | supportsBatch                   | yes         | no    | no       | no       |
| 19 | supportsAttachments             | yes         | no    | no       | no       |

### How Capabilities Are Used

Capabilities are queried at two levels:

1. **Main process**: The IPC API checks capabilities before constructing CLI
   arguments. For example, `--read-only` is only appended if
   `supportsReadOnlyMode` is true.

2. **Renderer**: UI components import the capability object and conditionally
   render controls. For example, the model selector dropdown is only shown if
   `supportsModelOverride` is true.

```typescript
// Example: renderer capability gate
function ModelSelector({ agentType }: { agentType: ToolType }) {
  const capabilities = getAgentCapabilities(agentType);
  if (!capabilities.supportsModelOverride) return null;
  return <Select>{/* model options */}</Select>;
}
```

---

## 4. Step-by-Step Integration Guide

This section walks through the complete process of adding a new AI agent to
Maestro. The guide uses a hypothetical agent called "ExampleAgent" with binary
name `example-agent` to illustrate each step.

### Step 1: Binary Detection

**File**: `src/main/agents/detector.ts`

The detector module is responsible for finding agent binaries on the host
system. Detection follows a two-phase approach:

1. **Direct filesystem probing**: Check well-known installation paths for the
   binary. This is the fast path and avoids spawning a shell.

2. **`which` / `where` fallback**: If direct probing fails, use the system's
   path resolution command (`which` on Unix, `where` on Windows) to search
   the PATH.

```typescript
// src/main/agents/detector.ts

import { existsSync } from "fs";
import { execSync } from "child_process";
import { platform } from "os";

/**
 * Well-known installation paths to probe directly.
 * Add paths for your agent here.
 */
const KNOWN_PATHS: Record<string, string[]> = {
  "claude": [
    "/usr/local/bin/claude",
    "/usr/bin/claude",
    `${process.env.HOME}/.local/bin/claude`,
    `${process.env.HOME}/.npm-global/bin/claude`,
  ],
  "codex": [
    "/usr/local/bin/codex",
    `${process.env.HOME}/.local/bin/codex`,
  ],
  "opencode": [
    "/usr/local/bin/opencode",
    `${process.env.HOME}/.local/bin/opencode`,
    `${process.env.HOME}/go/bin/opencode`,
  ],
  // Add your agent here:
  "example-agent": [
    "/usr/local/bin/example-agent",
    `${process.env.HOME}/.local/bin/example-agent`,
  ],
};

/**
 * Attempt to locate a binary by name.
 * Returns the absolute path if found, null otherwise.
 */
export function detectBinary(binaryName: string): string | null {
  // Phase 1: Direct filesystem probing
  const knownPaths = KNOWN_PATHS[binaryName] ?? [];
  for (const p of knownPaths) {
    if (existsSync(p)) return p;
  }

  // Phase 2: which/where fallback
  try {
    const cmd = platform() === "win32" ? "where" : "which";
    const result = execSync(`${cmd} ${binaryName}`, {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    if (result) return result.split("\n")[0];
  } catch {
    // Binary not found in PATH
  }

  return null;
}
```

**Important considerations**:

- Always add common installation paths to `KNOWN_PATHS` for faster detection.
- The `which`/`where` fallback handles non-standard installation locations.
- Detection results should be cached for the lifetime of the application to
  avoid repeated filesystem and shell access.
- On Windows, binary names may need a `.exe` suffix. The detector handles
  this automatically when using the `where` command.

### Step 2: Agent Definition

**File**: `src/main/agents/definitions.ts`

The definitions module contains the full specification for each agent. This
includes the binary name, display name, CLI argument builders, and
configuration options.

```typescript
// src/main/agents/definitions.ts

interface AgentDefinition {
  /** The binary name used for detection (e.g., "claude", "codex") */
  binaryName: string;

  /** Human-readable name shown in the UI */
  displayName: string;

  /**
   * Build the prompt arguments for the agent.
   * Called when the user submits a message.
   * @param prompt - The user's input text
   * @param options - Additional options (images, attachments, etc.)
   */
  promptArgs(prompt: string, options?: PromptOptions): string[];

  /**
   * Prefix arguments for batch mode execution.
   * Batch mode runs the agent non-interactively.
   */
  batchModePrefix: string[];

  /**
   * Arguments to enable JSON-structured output.
   * Used by agents that support stream-json output format.
   */
  jsonOutputArgs: string[];

  /**
   * Build read-only mode arguments.
   * @returns CLI flags to enable read-only mode
   */
  readOnlyArgs(): string[];

  /**
   * Build model override arguments.
   * @param model - The model identifier string
   * @returns CLI flags to set the model
   */
  modelArgs(model: string): string[];

  /**
   * Build session resume arguments.
   * @param sessionId - The agent-native session identifier
   * @returns CLI flags to resume the session
   */
  resumeArgs(sessionId: string): string[];

  /**
   * Build image input arguments.
   * @param imagePaths - Array of image file paths or base64 strings
   * @returns CLI flags to pass images
   */
  imageArgs(imagePaths: string[]): string[];

  /**
   * Configuration options surfaced in the UI settings panel.
   * Each option maps to an environment variable or CLI flag.
   */
  configOptions: ConfigOption[];
}
```

**Example definition for a new agent**:

```typescript
const exampleAgentDefinition: AgentDefinition = {
  binaryName: "example-agent",
  displayName: "Example Agent",

  promptArgs(prompt: string, options?: PromptOptions): string[] {
    const args = ["--prompt", prompt];
    if (options?.images?.length) {
      args.push("--images", ...options.images);
    }
    return args;
  },

  batchModePrefix: ["--batch"],

  jsonOutputArgs: ["--output-format", "json"],

  readOnlyArgs(): string[] {
    return ["--read-only"];
  },

  modelArgs(model: string): string[] {
    return ["--model", model];
  },

  resumeArgs(sessionId: string): string[] {
    return ["--resume", sessionId];
  },

  imageArgs(imagePaths: string[]): string[] {
    return imagePaths.flatMap((p) => ["--image", p]);
  },

  configOptions: [
    {
      key: "EXAMPLE_API_KEY",
      label: "API Key",
      type: "secret",
      description: "Your Example Agent API key",
    },
    {
      key: "EXAMPLE_MODEL",
      label: "Default Model",
      type: "string",
      description: "The default model to use",
      default: "example-v1",
    },
  ],
};
```

### Step 3: Capability Flags

**File**: `src/main/agents/capabilities.ts`

Register the capability flags for your agent. Each agent gets an entry in the
capabilities map.

```typescript
// src/main/agents/capabilities.ts

const AGENT_CAPABILITIES: Record<ToolType, AgentCapabilities> = {
  "claude-code": {
    supportsInput: true,
    supportsStreamJsonInput: true,
    supportsImageInput: true,
    supportsApiKeyAuth: true,
    supportsMaxAuth: true,
    supportsModelOverride: true,
    supportsContextWindowOverride: true,
    supportsReadOnlyMode: true,
    supportsYoloMode: true,
    supportsResume: true,
    supportsSlashCommands: true,
    supportsPrintMode: true,
    supportsCustomPath: true,
    supportsCustomArgs: true,
    supportsCustomEnvVars: true,
    supportsStatusBar: true,
    supportsRemoteExecution: true,
    supportsBatch: true,
    supportsAttachments: true,
  },

  // ... other agents ...

  // Add your agent:
  "example-agent": {
    supportsInput: true,
    supportsStreamJsonInput: false,
    supportsImageInput: false,
    supportsApiKeyAuth: true,
    supportsMaxAuth: false,
    supportsModelOverride: true,
    supportsContextWindowOverride: false,
    supportsReadOnlyMode: false,
    supportsYoloMode: false,
    supportsResume: false,
    supportsSlashCommands: false,
    supportsPrintMode: false,
    supportsCustomPath: true,
    supportsCustomArgs: true,
    supportsCustomEnvVars: true,
    supportsStatusBar: false,
    supportsRemoteExecution: false,
    supportsBatch: false,
    supportsAttachments: false,
  },
};

export function getAgentCapabilities(toolType: ToolType): AgentCapabilities {
  return AGENT_CAPABILITIES[toolType];
}
```

### Step 4: Output Parser

**Directory**: `src/main/parsers/`

Each agent needs an output parser that converts raw stdout/stderr into
normalized `ParsedEvent` objects. Parsers implement the `AgentOutputParser`
interface and are registered via the `registerOutputParser()` pattern.

**Important**: Parser registration does NOT use a switch-case statement. Each
parser self-registers by calling `registerOutputParser()` during
initialization.

```typescript
// src/main/parsers/AgentOutputParser.ts (interface)

interface AgentOutputParser {
  /** The ToolType this parser handles */
  readonly toolType: ToolType;

  /**
   * Parse a single line of output from the agent.
   * May return zero, one, or multiple ParsedEvents.
   * @param line - A line of stdout or stderr
   * @param stream - Which stream the line came from
   */
  parseLine(line: string, stream: "stdout" | "stderr"): ParsedEvent[];

  /**
   * Called when the agent process exits.
   * Use this to flush any buffered state and emit final events.
   * @param code - The exit code (null if killed by signal)
   * @param signal - The signal that killed the process (null if exited normally)
   */
  onExit(code: number | null, signal: string | null): ParsedEvent[];

  /**
   * Reset the parser state. Called when starting a new conversation turn.
   */
  reset(): void;
}
```

**Registration pattern**:

```typescript
// src/main/parsers/registry.ts

const parserRegistry = new Map<ToolType, AgentOutputParser>();

export function registerOutputParser(parser: AgentOutputParser): void {
  if (parserRegistry.has(parser.toolType)) {
    throw new Error(
      `Output parser already registered for ${parser.toolType}`
    );
  }
  parserRegistry.set(parser.toolType, parser);
}

export function getOutputParser(toolType: ToolType): AgentOutputParser {
  const parser = parserRegistry.get(toolType);
  if (!parser) {
    throw new Error(`No output parser registered for ${toolType}`);
  }
  return parser;
}
```

**Implementing your parser**:

```typescript
// src/main/parsers/example-agent-parser.ts

import { registerOutputParser } from "./registry";

class ExampleAgentParser implements AgentOutputParser {
  readonly toolType = "example-agent" as ToolType;

  private buffer: string = "";

  parseLine(line: string, stream: "stdout" | "stderr"): ParsedEvent[] {
    if (stream === "stderr") {
      // Delegate to error pattern matching
      return this.parseStderr(line);
    }

    // Example: parse JSON-per-line output
    try {
      const data = JSON.parse(line);
      return this.transformEvent(data);
    } catch {
      // Not JSON -- treat as plain text
      return [{
        type: "assistant",
        subtype: "text",
        content: line,
      }];
    }
  }

  onExit(code: number | null, signal: string | null): ParsedEvent[] {
    const events: ParsedEvent[] = [];
    if (code !== 0 && code !== null) {
      events.push({
        type: "error",
        content: `Process exited with code ${code}`,
        category: "agent_crashed",
      });
    }
    return events;
  }

  reset(): void {
    this.buffer = "";
  }

  private parseStderr(line: string): ParsedEvent[] {
    // Match against known error patterns
    // (see Step 5 for error pattern details)
    return [];
  }

  private transformEvent(data: unknown): ParsedEvent[] {
    // Transform agent-specific event format into ParsedEvent
    // Implementation depends on the agent's output format
    return [];
  }
}

// Self-registration
registerOutputParser(new ExampleAgentParser());
```

**Initialization**: All parser modules must be imported during application
startup so their self-registration code runs.

```typescript
// src/main/parsers/index.ts

// Import all parsers to trigger self-registration
import "./claude-code-parser";
import "./codex-parser";
import "./opencode-parser";
import "./example-agent-parser"; // <-- Add your parser here

export { getOutputParser, registerOutputParser } from "./registry";

/**
 * Called during application initialization.
 * All parser modules are already imported above, so their
 * registerOutputParser() calls have already executed.
 */
export function initializeOutputParsers(): void {
  // Validate that all expected parsers are registered
  const expectedParsers: ToolType[] = [
    "claude-code",
    "codex",
    "opencode",
    "example-agent",
  ];

  for (const toolType of expectedParsers) {
    getOutputParser(toolType); // Throws if not registered
  }
}
```

### Step 5: Error Patterns

**File**: `src/main/parsers/error-patterns.ts`

Error patterns are regex-based rules that match against agent stderr output
and categorize errors into well-known types. Each error category triggers
specific UI behavior (e.g., showing an auth dialog, displaying a retry button).

**Error Categories**:

| Category             | Description                                     | UI Behavior                    |
|----------------------|-------------------------------------------------|--------------------------------|
| `auth_expired`       | API key or token has expired                    | Show re-authentication dialog  |
| `token_exhaustion`   | Token/usage limit reached                       | Show upgrade prompt            |
| `rate_limited`       | API rate limit hit                              | Show retry with backoff timer  |
| `network_error`      | Network connectivity issue                      | Show retry button              |
| `permission_denied`  | Filesystem or API permission error              | Show error detail modal        |
| `agent_crashed`      | Agent process crashed unexpectedly              | Show restart button            |
| `session_not_found`  | Resume target session does not exist            | Clear session ID, show warning |

```typescript
// src/main/parsers/error-patterns.ts

interface ErrorPattern {
  /** Regex to match against stderr lines */
  pattern: RegExp;

  /** The error category this pattern maps to */
  category: ErrorCategory;

  /** Human-readable message to display (can use regex capture groups) */
  message: string | ((match: RegExpMatchArray) => string);
}

type ErrorCategory =
  | "auth_expired"
  | "token_exhaustion"
  | "rate_limited"
  | "network_error"
  | "permission_denied"
  | "agent_crashed"
  | "session_not_found";

/**
 * Error patterns for all agents. Patterns are checked in order;
 * the first match wins.
 */
const ERROR_PATTERNS: Record<ToolType, ErrorPattern[]> = {
  "claude-code": [
    {
      pattern: /API key expired|token.*expired|unauthorized/i,
      category: "auth_expired",
      message: "Your API key has expired. Please re-authenticate.",
    },
    {
      pattern: /rate limit|too many requests|429/i,
      category: "rate_limited",
      message: "Rate limit reached. Retrying automatically...",
    },
    {
      pattern: /ECONNREFUSED|ETIMEDOUT|network|socket hang up/i,
      category: "network_error",
      message: "Network error. Check your connection and try again.",
    },
    {
      pattern: /EACCES|permission denied/i,
      category: "permission_denied",
      message: (match) => `Permission denied: ${match[0]}`,
    },
    {
      pattern: /session.*not found|no such session/i,
      category: "session_not_found",
      message: "The previous session could not be found.",
    },
  ],

  // Add patterns for your agent:
  "example-agent": [
    {
      pattern: /auth.*failed|invalid.*key/i,
      category: "auth_expired",
      message: "Authentication failed. Please check your API key.",
    },
    {
      pattern: /limit.*exceeded|quota/i,
      category: "token_exhaustion",
      message: "Usage limit exceeded.",
    },
  ],
};
```

### Step 6: Session Storage

**Directory**: `src/main/storage/`

Session storage adapters read conversation history from agent-native storage
formats. Each agent stores its data differently, so each needs a dedicated
storage adapter.

**Storage Adapter Interface**:

```typescript
// src/main/storage/StorageAdapter.ts

interface StorageAdapter {
  /** The ToolType this adapter handles */
  readonly toolType: ToolType;

  /**
   * List all available sessions for a given working directory.
   * @param workingDir - The project directory to scope sessions to
   * @returns Array of session metadata (ID, title, timestamp, etc.)
   */
  listSessions(workingDir: string): Promise<SessionMetadata[]>;

  /**
   * Read all messages from a specific session.
   * @param sessionId - The agent-native session identifier
   * @returns Array of parsed messages in chronological order
   */
  readSessionMessages(sessionId: string): Promise<SessionMessage[]>;

  /**
   * Search sessions by text content.
   * @param workingDir - The project directory to scope the search to
   * @param query - The search string
   * @returns Array of matching sessions with highlighted excerpts
   */
  searchSessions(
    workingDir: string,
    query: string
  ): Promise<SessionSearchResult[]>;

  /**
   * Get the storage directory path for this agent.
   * Used for diagnostics and configuration display.
   */
  getStorageDir(): string;
}
```

**Agent storage locations**:

| Agent       | Storage Path                                | Format                     |
|-------------|---------------------------------------------|----------------------------|
| Claude Code | `~/.claude/projects/<hash>/`                | JSONL (one event per line) |
| Codex       | `~/.codex/sessions/`                        | Dual JSONL (input + output)|
| OpenCode    | `~/.local/share/opencode/storage/`          | Individual JSON files      |
| Terminal    | N/A (in-memory only)                        | N/A                        |

**Example storage adapter**:

```typescript
// src/main/storage/example-agent-storage.ts

import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

class ExampleAgentStorage implements StorageAdapter {
  readonly toolType = "example-agent" as ToolType;

  getStorageDir(): string {
    return join(homedir(), ".example-agent", "sessions");
  }

  async listSessions(workingDir: string): Promise<SessionMetadata[]> {
    const dir = this.getStorageDir();
    const entries = await readdir(dir, { withFileTypes: true });
    const sessions: SessionMetadata[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const metaPath = join(dir, entry.name, "meta.json");
      try {
        const raw = await readFile(metaPath, "utf-8");
        const meta = JSON.parse(raw);

        // Filter by working directory
        if (meta.workingDir !== workingDir) continue;

        sessions.push({
          id: entry.name,
          title: meta.title || "Untitled",
          timestamp: new Date(meta.createdAt),
          messageCount: meta.messageCount || 0,
        });
      } catch {
        // Skip sessions with unreadable metadata
        continue;
      }
    }

    return sessions.sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
    );
  }

  async readSessionMessages(sessionId: string): Promise<SessionMessage[]> {
    const filePath = join(
      this.getStorageDir(),
      sessionId,
      "messages.json"
    );
    const raw = await readFile(filePath, "utf-8");
    const data = JSON.parse(raw);

    return data.messages.map((msg: any) => ({
      role: msg.role,
      content: msg.content,
      timestamp: new Date(msg.timestamp),
    }));
  }

  async searchSessions(
    workingDir: string,
    query: string
  ): Promise<SessionSearchResult[]> {
    const sessions = await this.listSessions(workingDir);
    const results: SessionSearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    for (const session of sessions) {
      const messages = await this.readSessionMessages(session.id);
      const matchingMessages = messages.filter((m) =>
        m.content.toLowerCase().includes(lowerQuery)
      );

      if (matchingMessages.length > 0) {
        results.push({
          session,
          matchCount: matchingMessages.length,
          excerpt: matchingMessages[0].content.substring(0, 200),
        });
      }
    }

    return results;
  }
}
```

### Step 7: UI Capability Gates

UI capability gates are renderer-side components that conditionally render
based on agent capabilities. When adding a new agent, you typically do not
need to modify these components -- they already check capabilities dynamically.
However, if your agent introduces a new UI concept, you may need to add a new
gate.

**Common capability gate patterns**:

```typescript
// Pattern 1: Simple conditional render
function ReadOnlyToggle({ toolType }: { toolType: ToolType }) {
  const caps = getAgentCapabilities(toolType);
  if (!caps.supportsReadOnlyMode) return null;

  return (
    <Toggle
      label="Read-only mode"
      onChange={handleToggle}
    />
  );
}

// Pattern 2: Feature group gate
function AdvancedSettings({ toolType }: { toolType: ToolType }) {
  const caps = getAgentCapabilities(toolType);

  return (
    <SettingsGroup>
      {caps.supportsModelOverride && <ModelSelector />}
      {caps.supportsContextWindowOverride && <ContextWindowSlider />}
      {caps.supportsCustomPath && <BinaryPathInput />}
      {caps.supportsCustomArgs && <CustomArgsInput />}
      {caps.supportsCustomEnvVars && <EnvVarsEditor />}
    </SettingsGroup>
  );
}

// Pattern 3: Toolbar gate
function SessionToolbar({ toolType }: { toolType: ToolType }) {
  const caps = getAgentCapabilities(toolType);

  return (
    <Toolbar>
      {caps.supportsResume && <ResumeButton />}
      {caps.supportsBatch && <BatchModeButton />}
      {caps.supportsRemoteExecution && <RemoteHostSelector />}
      {caps.supportsAttachments && <AttachmentButton />}
      {caps.supportsImageInput && <ImageUploadButton />}
    </Toolbar>
  );
}
```

**Existing capability gates to be aware of**:

- **Input area**: Shows image upload button if `supportsImageInput`, attachment
  button if `supportsAttachments`, slash command hints if `supportsSlashCommands`.
- **Settings panel**: Shows model dropdown if `supportsModelOverride`, context
  window slider if `supportsContextWindowOverride`, auth configuration if
  `supportsApiKeyAuth` or `supportsMaxAuth`.
- **Session list**: Shows resume option if `supportsResume`.
- **Status bar**: Rendered only if `supportsStatusBar`.
- **Mode toggles**: Read-only if `supportsReadOnlyMode`, YOLO if
  `supportsYoloMode`.

### Step 8: Testing

Testing a new agent integration involves several layers.

**Unit tests**:

- Test the output parser with sample agent output (both happy path and error
  cases).
- Test the storage adapter with fixture files mimicking agent storage format.
- Test the capability flags are correctly declared.
- Test error pattern matching against known error strings.

**Integration tests**:

- Verify binary detection works on the target platform(s).
- Verify the agent spawns correctly with the expected CLI arguments.
- Verify session resume passes the correct session ID.
- Verify the full event pipeline: agent output -> parser -> UI render.

**Manual testing checklist**:

```
[ ] Agent binary is detected on startup
[ ] Agent appears in the agent picker dropdown
[ ] New session starts successfully
[ ] User input is sent to the agent
[ ] Agent output renders correctly in the UI
[ ] Error messages display with correct category
[ ] Session list shows previous sessions
[ ] Session resume works (if supported)
[ ] Model override works (if supported)
[ ] Read-only mode works (if supported)
[ ] All capability-gated UI elements appear/hide correctly
[ ] Agent process is cleaned up on tab close
[ ] Multiple concurrent sessions work
```

---

## 5. ParsedEvent Types

All output parsers produce `ParsedEvent` objects. The following types are
defined in the system.

### Event Type: `system`

System-level events emitted by the parser infrastructure, not by the agent
itself.

```typescript
interface SystemEvent {
  type: "system";
  content: string;
}
```

Examples: "Agent process started", "Resuming session abc123".

### Event Type: `assistant`

The primary event type for agent output. Has four subtypes.

**Subtype: `text`**

Plain text output from the agent. This is the most common event type.

```typescript
interface AssistantTextEvent {
  type: "assistant";
  subtype: "text";
  content: string;
}
```

**Subtype: `thinking`**

Extended thinking / chain-of-thought output. Rendered in a collapsible section
in the UI.

```typescript
interface AssistantThinkingEvent {
  type: "assistant";
  subtype: "thinking";
  content: string;
}
```

**Subtype: `tool_use`**

Indicates the agent is invoking a tool (file read, write, bash, etc.).

```typescript
interface AssistantToolUseEvent {
  type: "assistant";
  subtype: "tool_use";
  toolName: string;
  toolInput: Record<string, unknown>;
  toolResult?: string;
  status: "pending" | "running" | "complete" | "error";
}
```

**Subtype: `task-tool`**

A special tool use subtype for agents that delegate to sub-agents or run
nested tasks.

```typescript
interface AssistantTaskToolEvent {
  type: "assistant";
  subtype: "task-tool";
  taskDescription: string;
  taskResult?: string;
  status: "pending" | "running" | "complete" | "error";
}
```

### Event Type: `result`

Emitted when the agent completes a turn (i.e., finishes generating a response
and is waiting for input).

```typescript
interface ResultEvent {
  type: "result";
  content: string;
  costUsd?: number;
  durationMs?: number;
}
```

### Event Type: `usage`

Token usage information for a turn. Used by the Usage Aggregator (Section 6).

```typescript
interface UsageEvent {
  type: "usage";
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  model?: string;
}
```

### Event Type: `session-id`

Emitted when the agent reports its session identifier. Captured and stored
for future resume operations.

```typescript
interface SessionIdEvent {
  type: "session-id";
  sessionId: string;
}
```

### Event Type: `error`

Emitted when an error is detected in the agent output or process lifecycle.

```typescript
interface ErrorEvent {
  type: "error";
  content: string;
  category: ErrorCategory;
  recoverable: boolean;
}
```

---

## 6. Usage Aggregator

The usage aggregator collects token usage data from `usage` events and
computes cumulative cost estimates. It is important to understand its
aggregation strategy, especially for agents that use multiple models in a
single turn.

### Aggregation Strategy: MAX not SUM

When an agent makes multiple model calls within a single turn (e.g., a main
model call plus a tool-use model call), the aggregator takes the **MAX** of
the reported token counts, not the SUM. This is because many agents report
cumulative usage at each step, so summing would double-count tokens.

```typescript
// Usage aggregation logic (simplified)
function aggregateTurnUsage(events: UsageEvent[]): AggregatedUsage {
  // For multi-model turns, take MAX per field
  return {
    inputTokens: Math.max(...events.map((e) => e.inputTokens)),
    outputTokens: Math.max(...events.map((e) => e.outputTokens)),
    cacheReadTokens: Math.max(
      ...events.map((e) => e.cacheReadTokens ?? 0)
    ),
    cacheWriteTokens: Math.max(
      ...events.map((e) => e.cacheWriteTokens ?? 0)
    ),
  };
}
```

### DEFAULT_CONTEXT_WINDOWS

The context window sizes used for cost estimation and UI display. These values
represent the maximum number of tokens the agent's default model can process.

```typescript
const DEFAULT_CONTEXT_WINDOWS: Record<string, number> = {
  "claude":    200_000,  // Claude (Sonnet/Opus via Claude Code)
  "codex":     200_000,  // Codex (OpenAI models)
  "opencode":  128_000,  // OpenCode (Ollama / local models)
};
```

**Notes**:

- These values are defaults and may be overridden by the user if
  `supportsContextWindowOverride` is true.
- The context window value is used to compute a utilization percentage shown
  in the status bar (for agents that `supportsStatusBar`).
- Cost estimation uses model-specific pricing tables that are separate from
  context window sizes.

---

## 7. Supported Agents Reference

This section provides a detailed reference for each agent currently defined
in Maestro v0.14.5. Agents fall into three categories: **fully implemented**
(complete parser, storage, and capabilities), **implemented** (functional but
with fewer features), and **placeholder** (defined but not yet functional).

---

### Claude Code

**Status**: Fully implemented
**Binary**: `claude`
**ToolType**: `"claude-code"`

Claude Code is the primary and most feature-complete agent in Maestro. It
supports all 19 capability flags.

**Output Format**: Stream-JSON (one JSON object per line on stdout). The
parser handles message fragments, tool use blocks, thinking blocks, and
usage reports.

**Supported Features**:

- Resume previous sessions via `--resume` with session ID
- Read-only mode via `--read-only`
- YOLO mode (auto-approve) via `--dangerously-skip-permissions`
- Slash commands (`/help`, `/clear`, `/status`, etc.)
- Print mode for non-interactive scripted usage
- Batch mode for CI/CD integration
- File attachments in prompts
- Image input (base64-encoded or file path)
- Model override via `--model`
- Context window override via `--context-window`
- SSH remote execution via `--remote`
- Status bar with token count, cost, and model info

**Session Storage**:

- **Path**: `~/.claude/projects/<project-hash>/`
- **Format**: JSONL (JSON Lines). Each line is a complete JSON object
  representing a single event in the conversation.
- **Indexing**: Sessions are indexed by project directory hash. The storage
  adapter scans the project directory for JSONL files and parses their
  metadata headers.

**CLI Argument Examples**:

```bash
# Basic prompt
claude --output-format stream-json -p "Explain this code"

# Resume session
claude --output-format stream-json --resume sess_abc123

# Read-only mode with model override
claude --output-format stream-json --read-only --model claude-sonnet-4-20250514

# Batch mode with attachments
claude --output-format stream-json --batch --attachment ./file.txt -p "Review"

# Remote execution
claude --output-format stream-json --remote user@host -p "Check logs"
```

---

### Codex

**Status**: Fully implemented
**Binary**: `codex`
**ToolType**: `"codex"`

Codex is the OpenAI-backed coding agent. It supports session resume, model
override, and API key authentication.

**Output Format**: Line-based text output with structured markers for tool use
and results. The parser uses regex-based pattern matching to identify event
boundaries.

**Supported Features**:

- Resume previous sessions
- Model override
- API key authentication
- Custom binary path, arguments, and environment variables

**Session Storage**:

- **Path**: `~/.codex/sessions/`
- **Format**: Dual JSONL. Each session has two files: `input.jsonl` for user
  messages and `output.jsonl` for agent responses. The storage adapter merges
  these into a single chronological message list.
- **Context Window**: 200,000 tokens (matching `DEFAULT_CONTEXT_WINDOWS`).

**CLI Argument Examples**:

```bash
# Basic prompt
codex --prompt "Fix the bug in main.py"

# Resume session
codex --resume session_id_here

# Model override
codex --model gpt-4o --prompt "Refactor this function"
```

---

### OpenCode

**Status**: Implemented
**Binary**: `opencode`
**ToolType**: `"opencode"`

OpenCode is a Go-based coding agent that supports local models via Ollama
and other providers. It has a simpler feature set compared to Claude Code
and Codex.

**Output Format**: Line-based text output. The parser handles plain text
responses and basic tool use indicators.

**Supported Features**:

- API key authentication
- Custom binary path, arguments, and environment variables
- Ollama and local model configuration

**Session Storage**:

- **Path**: `~/.local/share/opencode/storage/`
- **Format**: Individual JSON files. Each session is stored as a single JSON
  file containing the complete conversation history.
- **Context Window**: 128,000 tokens (matching `DEFAULT_CONTEXT_WINDOWS`).

**Configuration**:

OpenCode is typically configured via its own config file for model provider
settings (Ollama endpoint, model name, etc.). Maestro surfaces these options
in the settings panel via `configOptions`.

---

### Terminal

**Status**: Built-in
**Binary**: N/A (uses system shell)
**ToolType**: `"terminal"`

Terminal is not an AI agent -- it is a built-in PTY-based terminal emulator.
It provides a standard shell session within the Maestro workspace.

**Output Format**: Raw PTY output. There is **no output parser** for Terminal;
output is rendered directly as terminal content using an xterm.js-compatible
renderer.

**Supported Features**:

- Text input (via PTY stdin)

**Session Storage**: None. Terminal sessions are ephemeral and exist only in
memory.

---

### Gemini CLI

**Status**: Placeholder
**Binary**: `gemini`
**ToolType**: `"gemini-cli"`

Gemini CLI is defined in `src/main/agents/definitions.ts` but is not yet
functional. The agent definition exists to enable binary detection and to
reserve the ToolType identifier for future implementation.

**Current State**:

- Binary name and display name are defined
- Capability flags are set to minimal defaults
- No output parser is implemented
- No storage adapter is implemented

---

### Qwen3 Coder

**Status**: Placeholder
**Binary**: `qwen3-coder`
**ToolType**: `"qwen3-coder"`

Qwen3 Coder is defined in `src/main/agents/definitions.ts` but is not yet
functional.

**Current State**:

- Binary name and display name are defined
- Capability flags are set to minimal defaults
- No output parser is implemented
- No storage adapter is implemented

---

### Aider

**Status**: Placeholder
**Binary**: `aider`
**ToolType**: `"aider"`

Aider is defined in `src/main/agents/definitions.ts` but is not yet
functional.

**Current State**:

- Binary name and display name are defined
- Capability flags are set to minimal defaults
- No output parser is implemented
- No storage adapter is implemented

---

## 8. Error Handling

Error handling in Maestro uses a three-layer detection system that catches
failures at different stages of the agent lifecycle.

### Layer 1: Line-Level Detection

The first layer operates on individual lines of stderr output as they arrive.
Each line is matched against the agent-specific error patterns defined in
`src/main/parsers/error-patterns.ts` (see Step 5). When a pattern matches,
the parser emits an `error` ParsedEvent with the appropriate category.

```
Agent stderr line
      |
      v
  Error pattern regex matching
      |
      +---> Match found: emit ErrorEvent with category
      |
      +---> No match: buffer for potential multi-line errors
```

This layer catches errors like authentication failures, rate limits, and
permission denials as they happen, before the agent process exits.

### Layer 2: Exit-Level Detection

The second layer fires when the agent process exits. It examines the exit
code and any buffered stderr content to determine if the process terminated
abnormally.

```
Agent process exit
      |
      v
  Exit code check
      |
      +---> code === 0: Normal exit, no error
      |
      +---> code !== 0: Abnormal exit
      |         |
      |         v
      |     Check buffered stderr
      |         |
      |         +---> Known pattern: emit categorized ErrorEvent
      |         |
      |         +---> Unknown: emit generic agent_crashed ErrorEvent
      |
      +---> code === null (signal kill): emit agent_crashed ErrorEvent
```

Exit codes are agent-specific. For example, Claude Code uses exit code 1 for
general errors and exit code 2 for authentication failures. The parser maps
these to the appropriate error categories.

### Layer 3: Spawn Failure Detection

The third layer catches failures that occur before the agent even starts.
These include missing binaries, permission errors on the binary, and
environment setup failures.

```
Spawn attempt
      |
      v
  child_process.spawn()
      |
      +---> ENOENT: Binary not found
      |         |
      |         v
      |     Emit error: "Agent binary not found at <path>"
      |
      +---> EACCES: Permission denied
      |         |
      |         v
      |     Emit error: "Cannot execute agent binary (permission denied)"
      |
      +---> Other spawn error
              |
              v
          Emit error: "Failed to start agent: <message>"
```

### Error Flow Through the System

The complete error flow from detection to UI display:

```
  stderr output / exit event / spawn failure
              |
              v
      Output Parser (error pattern matching)
              |
              v
      ParsedEvent { type: "error", category: "..." }
              |
              v
      IPC event emitter (main -> renderer)
              |
              +----------+-----------+
              |                      |
              v                      v
      Session State Update     Error Modal / Toast
      (marks session as         (displays error to
       errored, stores          user with category-
       error details)           specific actions)
```

### Auto-Clear on Success

When an agent recovers from an error state (e.g., a rate limit clears and the
agent resumes output), the error state is automatically cleared. This is
triggered by receiving a non-error ParsedEvent (typically an `assistant` event)
after an error state has been set.

```typescript
// Simplified auto-clear logic
function handleParsedEvent(event: ParsedEvent, session: SessionState): void {
  if (event.type === "error") {
    session.errorState = {
      category: event.category,
      message: event.content,
      timestamp: Date.now(),
    };
    return;
  }

  // Auto-clear: receiving a non-error event clears the error state
  if (session.errorState) {
    session.errorState = null;
  }

  // Process the event normally...
}
```

### Error Recovery Actions

Each error category has a recommended recovery action:

| Category             | Recovery Action                                       |
|----------------------|-------------------------------------------------------|
| `auth_expired`       | Re-prompt for API key or refresh OAuth token          |
| `token_exhaustion`   | Show usage dashboard, suggest upgrading plan          |
| `rate_limited`       | Automatic retry with exponential backoff              |
| `network_error`      | Retry button, check connectivity hint                 |
| `permission_denied`  | Show detailed error, suggest chmod or path fix        |
| `agent_crashed`      | Restart agent process, offer to file bug report       |
| `session_not_found`  | Clear stale session ID, start fresh session           |

---

## Appendix A: Quick Integration Checklist

Use this checklist when adding a new agent to ensure all pieces are in place.

```
[ ] 1. Binary detection paths added to src/main/agents/detector.ts
[ ] 2. Agent definition added to src/main/agents/definitions.ts
       - binaryName
       - displayName
       - promptArgs()
       - batchModePrefix
       - jsonOutputArgs
       - readOnlyArgs()
       - modelArgs()
       - resumeArgs()
       - imageArgs()
       - configOptions[]
[ ] 3. Capability flags registered in src/main/agents/capabilities.ts
       - All 19 flags explicitly set (no implicit defaults)
[ ] 4. Output parser implemented in src/main/parsers/
       - Implements AgentOutputParser interface
       - Registered via registerOutputParser() in initializeOutputParsers()
[ ] 5. Error patterns added to src/main/parsers/error-patterns.ts
       - At minimum: auth_expired, agent_crashed
[ ] 6. Session storage adapter in src/main/storage/ (if applicable)
       - listSessions()
       - readSessionMessages()
       - searchSessions()
[ ] 7. UI capability gates verified (usually no changes needed)
[ ] 8. Tests written and passing
       - Parser unit tests
       - Storage adapter unit tests
       - Integration test for binary detection
```

## Appendix B: Common Pitfalls

1. **Forgetting to import the parser module**: The parser self-registers on
   import. If you create `src/main/parsers/my-parser.ts` but do not import it
   in `src/main/parsers/index.ts`, the parser will never register and the
   agent will fail at runtime with "No output parser registered".

2. **Using switch-case for parser dispatch**: The codebase uses
   `registerOutputParser()` pattern, not a switch-case in a central dispatcher.
   Adding a case to a switch statement will not work.

3. **Setting too few capability flags**: All 19 flags must be explicitly set.
   There are no defaults. If you omit a flag, TypeScript will catch it at
   compile time, but be aware during development.

4. **Summing usage instead of taking MAX**: Multi-model turns report cumulative
   usage. The aggregator uses MAX, not SUM. If your parser emits multiple
   `usage` events per turn, ensure they represent cumulative totals.

5. **Hardcoding UI elements for specific agents**: Always use capability gates
   instead of checking `toolType === "my-agent"`. This keeps the architecture
   clean and extensible.

6. **Assuming storage paths are the same across platforms**: Use `os.homedir()`
   and `path.join()` rather than hardcoded POSIX paths. Windows uses different
   base directories (e.g., `%APPDATA%` instead of `~/.config/`).

7. **Not handling the Terminal agent specially**: Terminal has no output parser
   and no session storage. Several code paths need to skip Terminal. Check
   for `toolType === "terminal"` or check for `supportsStreamJsonInput` /
   parser existence before attempting to parse output.

8. **Forgetting to update DEFAULT_CONTEXT_WINDOWS**: If your agent's default
   model has a different context window than the existing entries, add it to
   the `DEFAULT_CONTEXT_WINDOWS` map. The usage aggregator and status bar
   rely on this value.
