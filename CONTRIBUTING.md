# Contributing to Maestro

> **Version:** 0.14.5
> **Regenerated:** 2026-02-17
> **Archived at:** `__MD_ARCHIVE/CONTRIBUTING_20260217_182050.md`
> **Cross-reference:** `Codebase_Context_20260217_180422.md`

Thank you for your interest in contributing to Maestro! This guide covers everything
you need to know to set up your development environment, understand the codebase,
and submit high-quality contributions.

---

## Table of Contents

1. [Development Setup](#1-development-setup)
2. [Project Structure](#2-project-structure)
3. [Development Scripts](#3-development-scripts)
4. [Development Data Directories](#4-development-data-directories)
5. [Testing](#5-testing)
6. [Linting & Pre-commit](#6-linting--pre-commit)
7. [Common Development Tasks](#7-common-development-tasks)
8. [Adding a New AI Agent](#8-adding-a-new-ai-agent)
9. [Code Style](#9-code-style)
10. [Performance Guidelines](#10-performance-guidelines)
11. [Debugging Guide](#11-debugging-guide)
12. [Commit Messages](#12-commit-messages)
13. [Pull Request Process](#13-pull-request-process)
14. [Building for Release](#14-building-for-release)
15. [Documentation](#15-documentation)
16. [MCP Server](#16-mcp-server)

---

## 1. Development Setup

### Prerequisites

| Tool    | Minimum Version | Notes                                      |
| ------- | --------------- | ------------------------------------------ |
| Node.js | **>=22.0.0**    | Required. Earlier versions are unsupported. |
| npm     | >=10.0.0        | Ships with Node.js 22+.                    |
| Git     | >=2.30          | For cloning and version control.            |

> **Important:** Maestro requires Node.js 22 or later. If you are using a version
> manager such as `nvm`, `fnm`, or `volta`, make sure you switch to a 22.x release
> before proceeding.

### Clone and Install

```bash
# Clone the repository
git clone https://github.com/your-org/maestro.git
cd maestro

# Install dependencies
npm install
```

### Start the Development Server

```bash
npm run dev
```

This launches the Electron main process and the Vite-powered renderer process
concurrently with hot-module replacement enabled. Changes to either process are
picked up automatically.

### Verify Your Setup

After `npm run dev` completes startup you should see the Maestro desktop window.
Open the DevTools with `Ctrl+Shift+I` (or `Cmd+Option+I` on macOS) and confirm
there are no console errors.

---

## 2. Project Structure

Below is the current directory tree showing the major source directories and their
purposes. Files and folders omitted for brevity are indicated with `...`.

```
maestro/
├── .github/                    # GitHub Actions workflows and templates
│   ├── workflows/
│   └── PULL_REQUEST_TEMPLATE.md
├── .husky/                     # Git hooks (pre-commit, commit-msg)
├── build/                      # Electron-builder resources (icons, entitlements)
├── docs/                       # Mintlify documentation source
├── resources/                  # Static assets bundled into the app
├── scripts/                    # Build and release helper scripts
│   ├── set-version.mjs
│   └── ...
├── src/
│   ├── main/                   # Electron main process
│   │   ├── agents/             # AI agent definitions and detection
│   │   │   ├── capabilities.ts
│   │   │   ├── definitions.ts
│   │   │   └── detector.ts
│   │   ├── ipc/
│   │   │   └── handlers/       # IPC message handlers
│   │   ├── parsers/            # Output parsers for agent responses
│   │   │   ├── error-patterns.ts
│   │   │   └── index.ts        # Parser registry (registerOutputParser)
│   │   ├── preload/            # Preload scripts (context bridge)
│   │   ├── process-manager/    # Child process lifecycle management
│   │   ├── services/           # Backend services (updater, analytics, etc.)
│   │   ├── stats/              # Statistics collection and aggregation
│   │   ├── storage/            # Session and settings persistence
│   │   ├── stores/             # Electron-side state stores
│   │   └── ...
│   ├── renderer/               # React frontend (Vite)
│   │   ├── components/         # UI components
│   │   ├── hooks/              # React hooks
│   │   │   └── settings/       # Settings-related hooks
│   │   ├── constants/          # App-wide constants
│   │   │   └── app.ts          # CLAUDE_BUILTIN_COMMANDS, etc.
│   │   ├── contexts/           # React contexts (ModalContext, etc.)
│   │   ├── modals/             # Modal components
│   │   ├── styles/             # Global styles and Tailwind config
│   │   └── ...
│   ├── shared/                 # Code shared between main and renderer
│   │   ├── themes.ts           # Theme definitions (14 color properties)
│   │   ├── types/              # Shared TypeScript types
│   │   └── ...
│   ├── web/                    # Web interface variant
│   └── cli/                    # CLI entry point
├── tests/
│   ├── unit/                   # Vitest unit tests
│   ├── integration/            # Vitest integration tests
│   ├── performance/            # Vitest performance benchmarks
│   └── e2e/                    # Playwright end-to-end tests
├── prompts/                    # Markdown prompt templates (.md -> .ts)
├── vitest.config.ts            # Default Vitest config (unit)
├── vitest.integration.config.ts
├── vitest.performance.config.ts
├── playwright.config.ts        # Playwright E2E config
├── tsconfig.json               # Base TypeScript config
├── tsconfig.node.json          # Node/main process TS config
├── tsconfig.web.json           # Web build TS config
├── tailwind.config.ts          # Tailwind CSS config
├── eslint.config.js            # ESLint flat config
├── prettier.config.js          # Prettier config
├── electron-builder.yml        # Electron-builder packaging config
└── package.json
```

### Key Directory Details

- **`src/main/agents/`** -- Agent files live in this directory, NOT as flat files
  in `src/main/`. The directory contains `detector.ts` (runtime discovery),
  `definitions.ts` (agent metadata), and `capabilities.ts` (feature flags per
  agent).

- **`src/main/parsers/`** -- Output parsers use a **registry pattern**. New parsers
  are added by calling `registerOutputParser()` in `src/main/parsers/index.ts`.
  There is NO switch-case dispatch.

- **`src/main/ipc/handlers/`** -- Each IPC channel gets its own handler file. Handlers
  are registered in the main process bootstrap and exposed to the renderer through
  the preload bridge.

---

## 3. Development Scripts

All scripts are defined in `package.json`. Run them with `npm run <script>`.

### Development

| Script               | Description                                            |
| -------------------- | ------------------------------------------------------ |
| `npm run dev`        | Concurrent main + renderer dev with HMR.               |
| `npm run dev:prod-data` | Dev mode using production data directory.           |
| `npm run dev:demo`   | Dev mode pointed at the demo data directory.           |
| `npm run dev:web`    | Start the web interface dev server only.               |

### Building

| Script                | Description                                                        |
| --------------------- | ------------------------------------------------------------------ |
| `npm run build`       | Full build pipeline: prompts -> main -> preload -> renderer -> web -> CLI. |
| `npm run build:prompts` | Compile `.md` prompt templates to TypeScript modules.            |
| `npm run build:preload` | Build preload scripts for the Electron context bridge.           |
| `npm run build:cli`   | Build the CLI entry point.                                         |

### Testing

| Script                    | Description                              |
| ------------------------- | ---------------------------------------- |
| `npm test`                | Run unit tests with Vitest.              |
| `npm run test:integration`| Run integration tests with Vitest.       |
| `npm run test:e2e`        | Run end-to-end tests with Playwright.    |
| `npm run test:performance`| Run performance benchmarks with Vitest.  |

### Code Quality

| Script                 | Description                                           |
| ---------------------- | ----------------------------------------------------- |
| `npm run lint`         | TypeScript type checking across all 3 tsconfig files. |
| `npm run lint:eslint`  | Run ESLint.                                           |
| `npm run format`       | Format code with Prettier (write mode).               |
| `npm run format:check` | Check formatting without writing changes.             |

### Maintenance

| Script             | Description                                    |
| ------------------ | ---------------------------------------------- |
| `npm run clean`    | Remove all build artifacts and output folders.  |
| `npm run package`  | Package the app for all platforms (macOS, Windows, Linux). |

---

## 4. Development Data Directories

Maestro uses isolated data directories so that development work never interferes
with your production sessions.

### Directory Modes

| Mode       | Directory Name   | How to Activate                              |
| ---------- | ---------------- | -------------------------------------------- |
| Development | `maestro-dev`   | Default when running `npm run dev`.          |
| Demo       | Configured via `DEMO_DATA_PATH` | `npm run dev:demo` or set the env var manually. |
| Production | Standard app data | `npm run dev:prod-data` or set `USE_PROD_DATA=1`. |

### Using Production Data in Development

If you need to test against real session history:

```bash
# Via the convenience script
npm run dev:prod-data

# Or manually
USE_PROD_DATA=1 npm run dev
```

> **Warning:** Be careful when running development builds against production data.
> Experimental migrations or schema changes could corrupt your sessions. Always back
> up your data directory first.

### Demo Data

The demo mode provides a curated set of sample sessions, agents, and conversations
that exercise the major features of the application. This is useful for UI work,
screenshots, and demos:

```bash
npm run dev:demo
```

---

## 5. Testing

Maestro uses **Vitest** as its test runner (NOT Jest). There are four test
configurations, each tuned for a different scope.

### Test Configurations

| Config File                     | Scope        | Environment | Timeout | Flags          |
| ------------------------------- | ------------ | ----------- | ------- | -------------- |
| `vitest.config.ts`              | Unit         | jsdom       | 10 s    | --             |
| `vitest.integration.config.ts`  | Integration  | jsdom       | 180 s   | `--sequence.sequential` |
| `vitest.performance.config.ts`  | Performance  | jsdom       | 30 s    | --             |
| `playwright.config.ts`          | E2E          | Electron    | 60 s    | Sequential, 2 retries in CI |

### Running Tests

```bash
# Unit tests (default config)
npx vitest run

# Unit tests in watch mode
npx vitest

# Integration tests (sequential execution, longer timeout)
npx vitest run --config vitest.integration.config.ts

# Performance benchmarks
npx vitest run --config vitest.performance.config.ts

# End-to-end tests with Playwright
npx playwright test

# Run a specific test file
npx vitest run src/main/parsers/__tests__/myParser.test.ts

# Run tests matching a pattern
npx vitest run -t "should parse streaming output"
```

### Vitest CLI Flags Reference

Commonly used flags when working with Maestro tests:

```bash
# Run once and exit (no watch mode)
npx vitest run

# Filter by test name pattern
npx vitest run -t "pattern"

# Filter by file path
npx vitest run path/to/file.test.ts

# Run sequentially (required for integration tests)
npx vitest run --sequence.sequential

# Generate coverage report
npx vitest run --coverage

# Use a specific config
npx vitest run --config vitest.integration.config.ts

# Verbose output
npx vitest run --reporter=verbose
```

### Playwright E2E Tests

End-to-end tests use Playwright to drive the full Electron application:

```bash
# Run all E2E tests
npx playwright test

# Run with headed browser (visible window)
npx playwright test --headed

# Run a specific test file
npx playwright test tests/e2e/session.spec.ts

# Debug mode (step through tests)
npx playwright test --debug
```

In CI, Playwright is configured with:
- Sequential execution (no parallel workers)
- 60-second timeout per test
- 2 retries on failure

### Writing Tests

- Place unit tests adjacent to source files or in `tests/unit/`.
- Place integration tests in `tests/integration/`.
- Place performance benchmarks in `tests/performance/`.
- Place E2E tests in `tests/e2e/`.
- Use descriptive `describe` / `it` blocks.
- Prefer `vi.fn()` and `vi.mock()` for mocking (Vitest API, not Jest).

```typescript
import { describe, it, expect, vi } from 'vitest';
import { parseOutput } from '../myParser';

describe('MyParser', () => {
  it('should extract the response text from raw output', () => {
    const raw = '...<output>hello</output>...';
    const result = parseOutput(raw);
    expect(result.text).toBe('hello');
  });
});
```

---

## 6. Linting & Pre-commit

### Tool Chain

Maestro enforces code quality through the following tools, run automatically on
every commit via Husky and lint-staged:

| Tool         | Purpose                                | Config File          |
| ------------ | -------------------------------------- | -------------------- |
| **Husky**    | Git hook management                    | `.husky/`            |
| **lint-staged** | Run linters on staged files only    | `package.json`       |
| **Prettier** | Code formatting                        | `prettier.config.js` |
| **ESLint**   | Static analysis and style enforcement  | `eslint.config.js`   |
| **TypeScript** | Type checking                        | `tsconfig*.json`     |

### Pre-commit Flow

When you run `git commit`, the following happens automatically:

1. **Husky** triggers the `pre-commit` hook.
2. **lint-staged** identifies staged files and runs:
   - **Prettier** on all supported file types.
   - **ESLint** on `.ts` and `.tsx` files.
3. If any check fails, the commit is aborted with an error message.

### Manual Checks

You can run these checks manually at any time:

```bash
# TypeScript type checking (all 3 configs)
npm run lint

# This internally runs:
#   npx tsc --noEmit --project tsconfig.json
#   npx tsc --noEmit --project tsconfig.node.json
#   npx tsc --noEmit --project tsconfig.web.json

# ESLint
npm run lint:eslint

# Prettier (format in-place)
npm run format

# Prettier (check only, no writes)
npm run format:check
```

### TypeScript Configurations

Maestro uses three separate `tsconfig` files to handle the different build targets:

| Config              | Scope                                    |
| ------------------- | ---------------------------------------- |
| `tsconfig.json`     | Base config and renderer (React/Vite)    |
| `tsconfig.node.json`| Main process and preload scripts (Node)  |
| `tsconfig.web.json` | Web interface build                      |

All three are checked during `npm run lint`. If you add a new directory or change
module resolution, verify that the appropriate tsconfig includes it.

---

## 7. Common Development Tasks

### Adding a UI Feature

1. **Create the component** in `src/renderer/components/`. Use functional components
   wrapped with `React.memo`.
2. **Create a hook** in `src/renderer/hooks/` if the feature has non-trivial state
   or side effects.
3. **Add a modal** (if the feature needs one) -- see the next section.
4. **Wire it up** in the parent component or layout.

```typescript
// src/renderer/components/MyFeature.tsx
import React, { useCallback } from 'react';
import { useMyFeature } from '../hooks/useMyFeature';

export const MyFeature = React.memo(function MyFeature() {
  const { data, handleAction } = useMyFeature();

  const onClick = useCallback(() => {
    handleAction();
  }, [handleAction]);

  return (
    <div className="flex items-center gap-2">
      <span>{data.label}</span>
      <button onClick={onClick}>Action</button>
    </div>
  );
});
```

### Adding a Modal

Modals in Maestro follow a registration pattern across several files:

1. **Create the modal component** in `src/renderer/modals/`.

2. **Register its priority** in `modalPriorities.ts`:
   ```typescript
   export const MODAL_PRIORITIES = {
     // ... existing entries
     myNewModal: 150,
   };
   ```

3. **Add it to `ModalContext.tsx`**:
   ```typescript
   // Add state and open/close handlers for the new modal.
   const [isMyNewModalOpen, setIsMyNewModalOpen] = useState(false);
   ```

4. **Register it in the `LayerStack`** so it renders in the correct z-order.

### Adding Keyboard Shortcuts

1. **Define the shortcut** in `shortcuts.ts`:
   ```typescript
   export const SHORTCUTS = {
     // ... existing shortcuts
     myAction: { key: 'k', modifiers: ['ctrl'] },
   };
   ```

2. **Handle it** in `useMainKeyboardHandler.ts`:
   ```typescript
   if (matchesShortcut(event, SHORTCUTS.myAction)) {
     event.preventDefault();
     handleMyAction();
   }
   ```

### Adding Settings

1. **Define the type** in `src/main/stores/types.ts`:
   ```typescript
   export interface AppSettings {
     // ... existing fields
     myNewSetting: boolean;
   }
   ```

2. **Create or update the hook** in `src/renderer/hooks/settings/`:
   ```typescript
   // src/renderer/hooks/settings/useSettings.ts
   export function useMyNewSetting() {
     return useSetting('myNewSetting', false);
   }
   ```

### Adding Slash Commands

Built-in slash commands are defined in the `CLAUDE_BUILTIN_COMMANDS` constant:

```typescript
// src/renderer/constants/app.ts
export const CLAUDE_BUILTIN_COMMANDS = [
  // ... existing commands
  {
    name: '/my-command',
    description: 'Does something useful',
    // ...
  },
];
```

### Adding Bundled AI Command Sets (Spec-Kit / OpenSpec)

Maestro supports bundled AI command sets through the Spec-Kit and OpenSpec formats.
To add a new bundled command set:

1. Create the command set definition following the Spec-Kit or OpenSpec schema.
2. Place it in the appropriate resources directory.
3. Register it in the command set loader so it is available at runtime.
4. Add tests to verify the commands parse and execute correctly.

### Adding Themes

Themes are defined in `src/shared/themes.ts`. Each theme specifies **14 color
properties**:

```typescript
// src/shared/themes.ts
export const myTheme: Theme = {
  name: 'My Theme',
  background: '#1a1b26',
  foreground: '#c0caf5',
  cursor: '#c0caf5',
  selectionBackground: '#33467c',
  selectionForeground: '#c0caf5',
  black: '#15161e',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  white: '#a9b1d6',
};
```

Add your theme object to the themes array and it will appear in the theme selector
automatically.

### Adding IPC Handlers

IPC (Inter-Process Communication) handlers bridge the Electron main process and the
renderer:

1. **Create the handler** in `src/main/ipc/handlers/`:
   ```typescript
   // src/main/ipc/handlers/myHandler.ts
   import { ipcMain } from 'electron';

   export function registerMyHandler(): void {
     ipcMain.handle('my-channel', async (_event, arg: string) => {
       // Process the request
       return { success: true, data: arg.toUpperCase() };
     });
   }
   ```

2. **Expose it in preload** in `src/main/preload/`:
   ```typescript
   // Add to the contextBridge.exposeInMainWorld call
   myChannel: (arg: string) => ipcRenderer.invoke('my-channel', arg),
   ```

3. **Register the handler** in the main process bootstrap so it is initialized
   before the renderer window loads.

4. **Call from the renderer**:
   ```typescript
   const result = await window.api.myChannel('hello');
   ```

---

## 8. Adding a New AI Agent

Adding support for a new AI agent involves six steps. Each step corresponds to a
specific file or directory in the codebase.

### Step 1: Agent Discovery

**File:** `src/main/agents/detector.ts`

The detector is responsible for finding installed agents on the user's system. Add
a detection function for your agent:

```typescript
// src/main/agents/detector.ts

async function detectMyAgent(): Promise<AgentInstallation | null> {
  // Check common installation paths
  const paths = [
    '/usr/local/bin/my-agent',
    `${homeDir}/.local/bin/my-agent`,
  ];

  for (const p of paths) {
    if (await fileExists(p)) {
      const version = await getVersion(p);
      return { path: p, version };
    }
  }

  return null;
}
```

Register your detection function in the detector's agent list so it runs during
the startup scan.

### Step 2: Agent Definition

**File:** `src/main/agents/definitions.ts`

Define the agent's metadata, including its display name, identifier, executable
command, and default arguments:

```typescript
// src/main/agents/definitions.ts

export const MY_AGENT: AgentDefinition = {
  id: 'my-agent',
  name: 'My Agent',
  command: 'my-agent',
  defaultArgs: ['--interactive', '--json-output'],
  description: 'Description of what the agent does.',
  website: 'https://example.com/my-agent',
  icon: 'my-agent-icon',
};
```

### Step 3: Capability Definition

**File:** `src/main/agents/capabilities.ts`

Declare what features the agent supports. Capabilities drive UI decisions (e.g.,
whether to show a file-attach button or a streaming indicator):

```typescript
// src/main/agents/capabilities.ts

export const MY_AGENT_CAPABILITIES: AgentCapabilities = {
  streaming: true,
  fileAttachment: false,
  imageInput: true,
  codeExecution: true,
  webSearch: false,
  toolUse: true,
  maxContextTokens: 200000,
};
```

### Step 4: Output Parser

**Directory:** `src/main/parsers/`
**Registry:** `src/main/parsers/index.ts`

Create a parser that transforms the agent's raw output into Maestro's internal
format. Parsers use the **registry pattern** -- you register them with
`registerOutputParser()`, NOT via a switch-case.

```typescript
// src/main/parsers/myAgentParser.ts

import { OutputParser, ParsedOutput } from './types';

export class MyAgentParser implements OutputParser {
  readonly agentId = 'my-agent';

  parse(raw: string): ParsedOutput {
    // Transform raw agent output into the standard format
    const parsed = JSON.parse(raw);
    return {
      text: parsed.response,
      thinking: parsed.reasoning ?? null,
      toolCalls: parsed.actions ?? [],
      metadata: {
        model: parsed.model,
        tokens: parsed.usage,
      },
    };
  }

  parseStreaming(chunk: string): Partial<ParsedOutput> {
    // Handle incremental streaming chunks
    return { text: chunk };
  }
}
```

Then register it:

```typescript
// src/main/parsers/index.ts

import { MyAgentParser } from './myAgentParser';

// Register using the registry pattern
registerOutputParser(new MyAgentParser());
```

> **Important:** Do NOT add a case to a switch statement. The parser registry
> handles dispatch automatically based on the `agentId` property.

### Step 5: Error Patterns

**File:** `src/main/parsers/error-patterns.ts`

Define regex patterns for common errors the agent produces so Maestro can display
user-friendly messages:

```typescript
// src/main/parsers/error-patterns.ts

export const MY_AGENT_ERROR_PATTERNS: ErrorPattern[] = [
  {
    pattern: /API key invalid or expired/i,
    code: 'AUTH_ERROR',
    message: 'Your My Agent API key is invalid or has expired. Please update it in Settings.',
    recoverable: true,
  },
  {
    pattern: /rate limit exceeded/i,
    code: 'RATE_LIMIT',
    message: 'My Agent rate limit reached. Maestro will retry automatically.',
    recoverable: true,
  },
  {
    pattern: /context length exceeded/i,
    code: 'CONTEXT_OVERFLOW',
    message: 'The conversation exceeds My Agent\'s context window. Consider starting a new session.',
    recoverable: false,
  },
];
```

### Step 6: Session Storage

**Directory:** `src/main/storage/`

If the agent requires custom session persistence (beyond what the default storage
handler provides), create a storage adapter:

```typescript
// src/main/storage/myAgentStorage.ts

import { SessionStorage } from './types';

export class MyAgentStorage implements SessionStorage {
  async save(sessionId: string, data: SessionData): Promise<void> {
    // Custom persistence logic
  }

  async load(sessionId: string): Promise<SessionData | null> {
    // Custom loading logic
  }

  async delete(sessionId: string): Promise<void> {
    // Cleanup logic
  }
}
```

### Agent Checklist

Before submitting your PR, verify:

- [ ] Detection works on macOS, Linux, and Windows.
- [ ] The agent appears in the agent selector when installed.
- [ ] Output parsing handles both streaming and non-streaming modes.
- [ ] Error patterns cover authentication, rate limiting, and context overflow.
- [ ] Unit tests cover the parser with representative output samples.
- [ ] Integration tests verify the full session lifecycle.

---

## 9. Code Style

### TypeScript

- **Strict mode** is enabled across all tsconfig files. Do not use `any` without a
  documented reason.
- Prefer `interface` for object shapes and `type` for unions and intersections.
- Use `const` assertions and `satisfies` where appropriate.
- Avoid enums; prefer `as const` objects.

### React

- **Functional components only**, wrapped with `React.memo`:
  ```typescript
  export const MyComponent = React.memo(function MyComponent(props: Props) {
    // ...
  });
  ```
- **No HOCs or render props.** Use hooks and composition instead.
- **`useCallback` for all returned functions** -- every function returned from a
  hook or passed as a prop must be wrapped in `useCallback` to prevent unnecessary
  re-renders.
- **Ref mirror pattern** for stale closure prevention:
  ```typescript
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const stableCallback = useCallback((...args: any[]) => {
    return callbackRef.current(...args);
  }, []);
  ```

### Styling

- **Tailwind CSS** is the primary styling approach. Use utility classes directly
  on elements.
- **Inline styles** are acceptable for dynamic values that depend on runtime state
  (e.g., calculated positions, theme-dependent colors).
- Do NOT use CSS modules, styled-components, or external CSS files for new code.

### Naming Conventions

| Entity           | Convention           | Example                    |
| ---------------- | -------------------- | -------------------------- |
| Components       | PascalCase           | `SessionPanel.tsx`         |
| Hooks            | camelCase, `use` prefix | `useSessionState.ts`    |
| Utilities        | camelCase            | `formatTimestamp.ts`       |
| Constants        | UPPER_SNAKE_CASE     | `MAX_RETRY_COUNT`          |
| Types/Interfaces | PascalCase           | `SessionState`             |
| Files            | camelCase or PascalCase (components) | --            |

### Imports

- Use path aliases defined in tsconfig (`@/`, `@main/`, `@renderer/`, etc.) rather
  than deep relative paths.
- Group imports: external libraries first, then internal modules, then relative
  imports. Separate each group with a blank line.

---

## 10. Performance Guidelines

Maestro sessions can contain thousands of messages and dozens of concurrent agent
processes. Performance is critical.

### React Rendering

- **`React.memo`** on all components that appear in lists or are re-rendered
  frequently.
- **`useMemo`** for expensive derivations (filtering, sorting, transforming large
  arrays).
- **`useCallback`** for all event handlers and functions passed as props.

### Persistence

- **Debounced writes** -- settings and session state are persisted with a **2-second
  debounce** to avoid excessive disk I/O.
- **Batched updates** -- UI state changes are batched in **150ms windows** to reduce
  React reconciliation passes.

### Scrolling

- **Virtual scrolling** via `@tanstack/react-virtual` for long message lists. Never
  render thousands of DOM nodes.

```typescript
import { useVirtualizer } from '@tanstack/react-virtual';

const virtualizer = useVirtualizer({
  count: messages.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => 80,
  overscan: 5,
});
```

### IPC

- **Parallelize** independent IPC calls with `Promise.all` rather than awaiting
  them sequentially.
- **Minimize payload size** -- send only the data the renderer needs, not entire
  objects.

### General

- Avoid synchronous file I/O in the main process -- it blocks the event loop.
- Use `worker_threads` for CPU-intensive operations (parsing large outputs,
  computing statistics).
- Profile before optimizing. Use the React Profiler and Electron DevTools
  Performance tab to identify actual bottlenecks.

---

## 11. Debugging Guide

### Electron DevTools

Open the Chromium DevTools in the renderer process:

- **Keyboard:** `Ctrl+Shift+I` (Windows/Linux) or `Cmd+Option+I` (macOS).
- **Menu:** View -> Toggle Developer Tools.

### Logger Levels

Maestro uses a structured logger with the following levels:

| Level   | When to Use                                    |
| ------- | ---------------------------------------------- |
| `error` | Unrecoverable failures, crashes.               |
| `warn`  | Recoverable issues, deprecations.              |
| `info`  | Significant lifecycle events (start, stop).    |
| `debug` | Detailed operational information.              |
| `trace` | Very verbose, per-message or per-frame output. |

Set the log level via the `LOG_LEVEL` environment variable:

```bash
LOG_LEVEL=debug npm run dev
```

### React Profiler

1. Open DevTools.
2. Switch to the **Profiler** tab.
3. Click **Record**, perform the action you want to profile, then stop.
4. Look for components with high render times or excessive re-renders.

### Process Monitor

Maestro includes a built-in process monitor that displays:

- Active agent child processes and their resource usage.
- IPC message rates and latencies.
- Memory usage of the main and renderer processes.

Access it via the application menu or the keyboard shortcut defined in your
settings.

### Common Issues

| Symptom                          | Likely Cause                       | Fix                                      |
| -------------------------------- | ---------------------------------- | ---------------------------------------- |
| Blank white window on startup    | Renderer build failed              | Run `npm run build` and check for errors. |
| Agent not detected               | Binary not in PATH                 | Verify installation path in detector.ts. |
| IPC timeout                      | Handler not registered             | Check handler registration in bootstrap. |
| Stale data after settings change | Debounce delay                     | Wait 2 seconds or trigger a manual flush. |
| High memory usage                | Non-virtualized list               | Enable virtual scrolling.                |

---

## 12. Commit Messages

Maestro follows the **Conventional Commits** specification.

### Format

```
<type>(<scope>): <short description>

[optional body]

[optional footer(s)]
```

### Types

| Type       | Description                                          |
| ---------- | ---------------------------------------------------- |
| `feat`     | A new feature.                                       |
| `fix`      | A bug fix.                                           |
| `docs`     | Documentation-only changes.                          |
| `style`    | Formatting, missing semicolons, etc. (no code change). |
| `refactor` | Code change that neither fixes a bug nor adds a feature. |
| `perf`     | Performance improvement.                             |
| `test`     | Adding or updating tests.                            |
| `build`    | Changes to the build system or dependencies.         |
| `ci`       | Changes to CI configuration.                         |
| `chore`    | Maintenance tasks.                                   |

### Examples

```
feat(agents): add support for My Agent v2

fix(parser): handle empty streaming chunks without crashing

refactor(ipc): migrate handlers to new registry pattern

test(parsers): add coverage for edge cases in Claude parser

docs: update CONTRIBUTING.md with Vitest instructions
```

### Scope

Use a scope that identifies the subsystem being changed. Common scopes include:
`agents`, `parsers`, `ipc`, `renderer`, `main`, `storage`, `settings`, `themes`,
`cli`, `web`, `e2e`, `ci`.

---

## 13. Pull Request Process

### Branch Naming

Use the following convention:

```
<type>/<short-description>
```

Examples:

```
feat/add-gemini-agent
fix/parser-streaming-crash
refactor/ipc-handler-registry
docs/update-contributing
```

### Before Submitting

1. **Rebase** on the latest `main`:
   ```bash
   git fetch origin
   git rebase origin/main
   ```

2. **Run all checks** locally:
   ```bash
   npm run lint
   npm run lint:eslint
   npm run format:check
   npm test
   npm run test:integration
   ```

3. **Verify the build** completes:
   ```bash
   npm run build
   ```

### PR Template

When you open a PR, fill in the template (located at
`.github/PULL_REQUEST_TEMPLATE.md`). At minimum, include:

- **What** the PR does (summary).
- **Why** the change is needed (motivation or linked issue).
- **How** to test the change (manual steps or automated test pointers).
- **Screenshots** for UI changes.

### Review Process

1. Open a draft PR if the work is still in progress.
2. Request review from at least one maintainer.
3. Address all review comments. Use the "Resolve conversation" button after each
   fix.
4. Ensure CI passes (lint, tests, build).
5. A maintainer will merge the PR using squash-and-merge.

### CI Checks

The following checks run automatically on every PR:

- TypeScript type checking (all 3 configs).
- ESLint.
- Prettier format check.
- Vitest unit tests.
- Vitest integration tests.
- Playwright E2E tests (with 2 retries).
- Build verification.

All checks must pass before merging.

---

## 14. Building for Release

### Icon Preparation

Application icons must be provided in the correct formats for each platform:

| Platform | Format             | Location                |
| -------- | ------------------ | ----------------------- |
| macOS    | `.icns`            | `build/icon.icns`       |
| Windows  | `.ico`             | `build/icon.ico`        |
| Linux    | `.png` (512x512)   | `build/icon.png`        |

### Version Update

Use the version script to update the version number across all relevant files:

```bash
node scripts/set-version.mjs 0.14.6
```

This updates `package.json`, `package-lock.json`, and any other files that
reference the version string.

### Packaging

```bash
# Build the application first
npm run build

# Package for all platforms
npm run package
```

The packaged applications are placed in the `dist/` directory. Platform-specific
outputs:

- macOS: `.dmg` and `.zip`
- Windows: `.exe` (NSIS installer) and `.zip`
- Linux: `.AppImage`, `.deb`, and `.rpm`

### GitHub Actions

Release builds are automated via GitHub Actions. The workflow:

1. Triggers on version tags (`v*`).
2. Builds on macOS, Windows, and Linux runners.
3. Signs and notarizes the macOS build.
4. Signs the Windows build.
5. Uploads artifacts to the GitHub release.
6. Publishes update manifests for the auto-updater.

To trigger a release:

```bash
# After updating the version
git tag v0.14.6
git push origin v0.14.6
```

---

## 15. Documentation

### Mintlify

Maestro's public documentation is built with [Mintlify](https://mintlify.com) and
hosted at **docs.runmaestro.ai**.

Documentation source files live in the `docs/` directory at the repository root.

### Local Preview

To preview documentation changes locally:

```bash
# Install the Mintlify CLI (one-time)
npm install -g mintlify

# Start the local preview server
cd docs
mintlify dev
```

The preview server runs at `http://localhost:3000` by default.

### Writing Documentation

- Use MDX format (Markdown + JSX components).
- Follow the existing structure in `docs/mint.json` for navigation.
- Include code examples for all API references.
- Add screenshots for UI-related documentation.
- Test all code examples to ensure they work.

### Deployment

Documentation is deployed automatically when changes to the `docs/` directory are
merged to `main`. The Mintlify GitHub integration handles the build and deployment.

---

## 16. MCP Server

Maestro exposes a **Model Context Protocol (MCP)** server that allows external
tools and agents to search and interact with Maestro data.

### SearchMaestro Tool

The primary MCP tool is `SearchMaestro`, which provides full-text search across
sessions, messages, and agent outputs:

```json
{
  "name": "SearchMaestro",
  "description": "Search across Maestro sessions and conversations",
  "parameters": {
    "query": {
      "type": "string",
      "description": "The search query"
    },
    "filters": {
      "type": "object",
      "properties": {
        "agent": { "type": "string" },
        "dateRange": { "type": "object" },
        "sessionId": { "type": "string" }
      }
    }
  }
}
```

### Developing MCP Extensions

When adding new MCP tools:

1. Define the tool schema following the MCP specification.
2. Implement the handler in the MCP server module.
3. Register the tool in the server's tool manifest.
4. Add integration tests that exercise the tool via the MCP protocol.
5. Document the tool in the public documentation.

---

## Getting Help

- **Issues:** Open an issue on GitHub for bug reports and feature requests.
- **Discussions:** Use GitHub Discussions for questions and general conversation.
- **Documentation:** See [docs.runmaestro.ai](https://docs.runmaestro.ai) for
  user-facing documentation.

Thank you for contributing to Maestro!
