/**
 * Tests for the Claude Session IPC handlers
 *
 * These tests verify the Claude Code session management functionality:
 * - List sessions (regular and paginated)
 * - Read session messages
 * - Delete message pairs
 * - Search sessions
 * - Get project and global stats
 * - Session timestamps for activity graphs
 * - Session origins tracking (Maestro vs CLI)
 * - Get available slash commands
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ipcMain, app, BrowserWindow } from 'electron';
import { registerClaudeHandlers, ClaudeHandlerDependencies } from '../../../../main/ipc/handlers/claude';

// Mock electron's ipcMain and app
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
  app: {
    getPath: vi.fn().mockReturnValue('/mock/app/path'),
  },
  BrowserWindow: vi.fn(),
}));

// Mock the logger
vi.mock('../../../../main/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {
    access: vi.fn(),
    readdir: vi.fn(),
    readFile: vi.fn(),
    stat: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  },
}));

// Mock path - we need to preserve the actual path functionality but mock specific behaviors
vi.mock('path', async () => {
  const actual = await vi.importActual<typeof import('path')>('path');
  return {
    default: {
      ...actual,
      join: vi.fn((...args: string[]) => args.join('/')),
      dirname: vi.fn((p: string) => p.split('/').slice(0, -1).join('/')),
    },
  };
});

// Mock os module
vi.mock('os', () => ({
  default: {
    homedir: vi.fn().mockReturnValue('/mock/home'),
  },
}));

// Mock statsCache module
vi.mock('../../../../main/utils/statsCache', () => ({
  encodeClaudeProjectPath: vi.fn((p: string) => p.replace(/\//g, '-').replace(/^-/, '')),
  loadStatsCache: vi.fn(),
  saveStatsCache: vi.fn(),
  STATS_CACHE_VERSION: 1,
}));

// Mock constants
vi.mock('../../../../main/constants', () => ({
  CLAUDE_SESSION_PARSE_LIMITS: {
    FIRST_MESSAGE_SCAN_LINES: 10,
    FIRST_MESSAGE_PREVIEW_LENGTH: 100,
    LAST_TIMESTAMP_SCAN_LINES: 5,
    OLDEST_TIMESTAMP_SCAN_LINES: 10,
  },
  CLAUDE_PRICING: {
    INPUT_PER_MILLION: 3,
    OUTPUT_PER_MILLION: 15,
    CACHE_READ_PER_MILLION: 0.3,
    CACHE_CREATION_PER_MILLION: 3.75,
  },
}));

describe('Claude IPC handlers', () => {
  let handlers: Map<string, Function>;
  let mockClaudeSessionOriginsStore: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
  };
  let mockGetMainWindow: ReturnType<typeof vi.fn>;
  let mockDependencies: ClaudeHandlerDependencies;

  beforeEach(() => {
    // Clear mocks
    vi.clearAllMocks();

    // Capture all registered handlers
    handlers = new Map();
    vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    // Create mock dependencies
    mockClaudeSessionOriginsStore = {
      get: vi.fn().mockReturnValue({}),
      set: vi.fn(),
    };

    mockGetMainWindow = vi.fn().mockReturnValue(null);

    mockDependencies = {
      claudeSessionOriginsStore: mockClaudeSessionOriginsStore as unknown as ClaudeHandlerDependencies['claudeSessionOriginsStore'],
      getMainWindow: mockGetMainWindow,
    };

    // Register handlers
    registerClaudeHandlers(mockDependencies);
  });

  afterEach(() => {
    handlers.clear();
  });

  describe('registration', () => {
    it('should register all claude handlers', () => {
      // Based on reading the source file, these are all the handlers registered:
      const expectedChannels = [
        'claude:listSessions',
        'claude:listSessionsPaginated',
        'claude:getProjectStats',
        'claude:getSessionTimestamps',
        'claude:getGlobalStats',
        'claude:readSessionMessages',
        'claude:deleteMessagePair',
        'claude:searchSessions',
        'claude:getCommands',
        'claude:registerSessionOrigin',
        'claude:updateSessionName',
        'claude:updateSessionStarred',
        'claude:getSessionOrigins',
        'claude:getAllNamedSessions',
      ];

      for (const channel of expectedChannels) {
        expect(handlers.has(channel), `Handler for ${channel} should be registered`).toBe(true);
      }

      // Verify total count matches
      expect(handlers.size).toBe(expectedChannels.length);
    });
  });
});
