/**
 * AgentSelectionScreen.tsx
 *
 * First screen of the onboarding wizard - displays available AI agents
 * in a tiled grid layout with agent logos. Users can select an agent
 * and optionally provide a project name.
 *
 * Features:
 * - Tiled grid view of agent logos (Claude Code highlighted, others ghosted)
 * - Optional Name field with placeholder "My Project"
 * - Keyboard navigation (arrow keys to move between tiles, Tab to Name field, Enter to proceed)
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Theme, AgentConfig } from '../../../types';
import { useWizard } from '../WizardContext';

interface AgentSelectionScreenProps {
  theme: Theme;
}

/**
 * Agent tile data for display
 */
interface AgentTile {
  id: string;
  name: string;
  available: boolean;
  description: string;
}

/**
 * Define the agents to display in the grid
 * Claude Code is the only currently available agent; others are shown ghosted
 */
const AGENT_TILES: AgentTile[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    available: true,
    description: 'Anthropic\'s AI coding assistant',
  },
  {
    id: 'openai-codex',
    name: 'OpenAI Codex',
    available: false,
    description: 'Coming soon',
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    available: false,
    description: 'Coming soon',
  },
  {
    id: 'qwen3-coder',
    name: 'Qwen3 Coder',
    available: false,
    description: 'Coming soon',
  },
];

// Grid dimensions for keyboard navigation (2x2 grid)
const GRID_COLS = 2;
const GRID_ROWS = 2;

/**
 * Get SVG logo for an agent
 */
function AgentLogo({ agentId, available, theme }: { agentId: string; available: boolean; theme: Theme }): JSX.Element {
  const baseColor = available ? theme.colors.accent : theme.colors.textDim;
  const opacity = available ? 1 : 0.4;

  // Return appropriate icon based on agent ID
  switch (agentId) {
    case 'claude-code':
      // Claude Code - Anthropic's logo representation
      return (
        <svg
          className="w-16 h-16"
          viewBox="0 0 64 64"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ opacity }}
        >
          <circle cx="32" cy="32" r="28" stroke={baseColor} strokeWidth="2" fill="none" />
          <path
            d="M20 24 L32 44 L44 24"
            stroke={baseColor}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          <circle cx="32" cy="20" r="4" fill={baseColor} />
        </svg>
      );

    case 'openai-codex':
      // OpenAI Codex - simplified representation
      return (
        <svg
          className="w-16 h-16"
          viewBox="0 0 64 64"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ opacity }}
        >
          <circle cx="32" cy="32" r="28" stroke={baseColor} strokeWidth="2" fill="none" />
          <circle cx="32" cy="32" r="12" stroke={baseColor} strokeWidth="2" fill="none" />
          <path
            d="M32 8 L32 20 M32 44 L32 56 M8 32 L20 32 M44 32 L56 32"
            stroke={baseColor}
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      );

    case 'gemini-cli':
      // Gemini CLI - star/sparkle representation
      return (
        <svg
          className="w-16 h-16"
          viewBox="0 0 64 64"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ opacity }}
        >
          <path
            d="M32 8 L36 28 L56 32 L36 36 L32 56 L28 36 L8 32 L28 28 Z"
            stroke={baseColor}
            strokeWidth="2"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      );

    case 'qwen3-coder':
      // Qwen3 Coder - code bracket representation
      return (
        <svg
          className="w-16 h-16"
          viewBox="0 0 64 64"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ opacity }}
        >
          <circle cx="32" cy="32" r="28" stroke={baseColor} strokeWidth="2" fill="none" />
          <path
            d="M24 20 L16 32 L24 44 M40 20 L48 32 L40 44"
            stroke={baseColor}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      );

    default:
      return (
        <div
          className="w-16 h-16 rounded-full border-2"
          style={{ borderColor: baseColor, opacity }}
        />
      );
  }
}

/**
 * AgentSelectionScreen - Agent selection with tiled grid view
 */
export function AgentSelectionScreen({ theme }: AgentSelectionScreenProps): JSX.Element {
  const {
    state,
    setSelectedAgent,
    setAvailableAgents,
    setAgentName,
    nextStep,
    canProceedToNext,
  } = useWizard();

  // Local state
  const [focusedTileIndex, setFocusedTileIndex] = useState<number>(0);
  const [isNameFieldFocused, setIsNameFieldFocused] = useState(false);
  const [isDetecting, setIsDetecting] = useState(true);
  const [detectedAgents, setDetectedAgents] = useState<AgentConfig[]>([]);

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Detect available agents on mount
  useEffect(() => {
    let mounted = true;

    async function detectAgents() {
      try {
        const agents = await window.maestro.agents.detect();
        if (mounted) {
          // Filter out hidden agents (like terminal)
          const visibleAgents = agents.filter((a: AgentConfig) => !a.hidden);
          setDetectedAgents(visibleAgents);
          setAvailableAgents(visibleAgents);

          // Auto-select Claude Code if it's available and nothing is selected
          if (!state.selectedAgent) {
            const claudeCode = visibleAgents.find((a: AgentConfig) => a.id === 'claude-code' && a.available);
            if (claudeCode) {
              setSelectedAgent('claude-code');
            }
          }

          setIsDetecting(false);
        }
      } catch (error) {
        console.error('Failed to detect agents:', error);
        if (mounted) {
          setIsDetecting(false);
        }
      }
    }

    detectAgents();
    return () => { mounted = false; };
  }, [setAvailableAgents, setSelectedAgent, state.selectedAgent]);

  // Focus the first tile on mount
  useEffect(() => {
    if (!isDetecting && tileRefs.current[0]) {
      tileRefs.current[0].focus();
    }
  }, [isDetecting]);

  /**
   * Handle keyboard navigation
   */
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // If name field is focused, only handle Tab and Enter
    if (isNameFieldFocused) {
      if (e.key === 'Tab' && e.shiftKey) {
        // Shift+Tab goes back to last tile
        e.preventDefault();
        setIsNameFieldFocused(false);
        const lastIndex = AGENT_TILES.length - 1;
        setFocusedTileIndex(lastIndex);
        tileRefs.current[lastIndex]?.focus();
      } else if (e.key === 'Enter' && canProceedToNext()) {
        e.preventDefault();
        nextStep();
      }
      return;
    }

    const currentIndex = focusedTileIndex;
    const currentRow = Math.floor(currentIndex / GRID_COLS);
    const currentCol = currentIndex % GRID_COLS;

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        if (currentRow > 0) {
          const newIndex = (currentRow - 1) * GRID_COLS + currentCol;
          setFocusedTileIndex(newIndex);
          tileRefs.current[newIndex]?.focus();
        }
        break;

      case 'ArrowDown':
        e.preventDefault();
        if (currentRow < GRID_ROWS - 1) {
          const newIndex = (currentRow + 1) * GRID_COLS + currentCol;
          if (newIndex < AGENT_TILES.length) {
            setFocusedTileIndex(newIndex);
            tileRefs.current[newIndex]?.focus();
          }
        }
        break;

      case 'ArrowLeft':
        e.preventDefault();
        if (currentCol > 0) {
          const newIndex = currentIndex - 1;
          setFocusedTileIndex(newIndex);
          tileRefs.current[newIndex]?.focus();
        }
        break;

      case 'ArrowRight':
        e.preventDefault();
        if (currentCol < GRID_COLS - 1 && currentIndex + 1 < AGENT_TILES.length) {
          const newIndex = currentIndex + 1;
          setFocusedTileIndex(newIndex);
          tileRefs.current[newIndex]?.focus();
        }
        break;

      case 'Tab':
        if (!e.shiftKey) {
          // Tab goes to name field
          e.preventDefault();
          setIsNameFieldFocused(true);
          nameInputRef.current?.focus();
        }
        break;

      case 'Enter':
      case ' ':
        e.preventDefault();
        // Select the focused tile if available
        const tile = AGENT_TILES[currentIndex];
        const detected = detectedAgents.find(a => a.id === tile.id);
        if (detected?.available) {
          setSelectedAgent(tile.id as any);
          // If Enter, also proceed to next step if valid
          if (e.key === 'Enter' && canProceedToNext()) {
            nextStep();
          }
        }
        break;
    }
  }, [
    isNameFieldFocused,
    focusedTileIndex,
    detectedAgents,
    setSelectedAgent,
    nextStep,
    canProceedToNext,
  ]);

  /**
   * Handle tile click
   */
  const handleTileClick = useCallback((tile: AgentTile, index: number) => {
    const detected = detectedAgents.find(a => a.id === tile.id);
    if (detected?.available) {
      setSelectedAgent(tile.id as any);
      setFocusedTileIndex(index);
    }
  }, [detectedAgents, setSelectedAgent]);

  /**
   * Handle Continue button click
   */
  const handleContinue = useCallback(() => {
    if (canProceedToNext()) {
      nextStep();
    }
  }, [canProceedToNext, nextStep]);

  // Check if an agent is available from detection
  const isAgentAvailable = useCallback((agentId: string): boolean => {
    const detected = detectedAgents.find(a => a.id === agentId);
    return detected?.available ?? false;
  }, [detectedAgents]);

  // Loading state
  if (isDetecting) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full p-8"
        style={{ color: theme.colors.textMain }}
      >
        <div
          className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mb-4"
          style={{ borderColor: theme.colors.accent, borderTopColor: 'transparent' }}
        />
        <p className="text-sm" style={{ color: theme.colors.textDim }}>
          Detecting available agents...
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full p-8"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {/* Header */}
      <div className="text-center mb-8">
        <h3
          className="text-2xl font-semibold mb-2"
          style={{ color: theme.colors.textMain }}
        >
          Choose Your AI Assistant
        </h3>
        <p
          className="text-sm"
          style={{ color: theme.colors.textDim }}
        >
          Select an agent to power your project. Use arrow keys to navigate, Enter to select.
        </p>
      </div>

      {/* Agent Grid */}
      <div className="flex-1 flex items-center justify-center">
        <div className="grid grid-cols-2 gap-6 max-w-2xl">
          {AGENT_TILES.map((tile, index) => {
            const isAvailable = isAgentAvailable(tile.id);
            const isSelected = state.selectedAgent === tile.id;
            const isFocused = focusedTileIndex === index && !isNameFieldFocused;

            return (
              <button
                key={tile.id}
                ref={(el) => { tileRefs.current[index] = el; }}
                onClick={() => handleTileClick(tile, index)}
                onFocus={() => {
                  setFocusedTileIndex(index);
                  setIsNameFieldFocused(false);
                }}
                disabled={!isAvailable}
                className={`
                  relative flex flex-col items-center justify-center p-8 rounded-xl
                  border-2 transition-all duration-200 outline-none
                  ${isAvailable ? 'cursor-pointer' : 'cursor-not-allowed'}
                `}
                style={{
                  backgroundColor: isSelected
                    ? `${theme.colors.accent}15`
                    : theme.colors.bgSidebar,
                  borderColor: isSelected
                    ? theme.colors.accent
                    : isFocused
                    ? theme.colors.accent
                    : theme.colors.border,
                  opacity: isAvailable ? 1 : 0.5,
                  boxShadow: isSelected
                    ? `0 0 0 3px ${theme.colors.accent}30`
                    : isFocused
                    ? `0 0 0 2px ${theme.colors.accent}40`
                    : 'none',
                }}
                aria-label={`${tile.name}${isAvailable ? '' : ' (coming soon)'}`}
                aria-pressed={isSelected}
              >
                {/* Selection indicator */}
                {isSelected && (
                  <div
                    className="absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: theme.colors.accent }}
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke={theme.colors.accentForeground}
                      viewBox="0 0 24 24"
                      strokeWidth={3}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>
                )}

                {/* Agent Logo */}
                <div className="mb-4">
                  <AgentLogo agentId={tile.id} available={isAvailable} theme={theme} />
                </div>

                {/* Agent Name */}
                <h4
                  className="text-lg font-medium mb-1"
                  style={{ color: isAvailable ? theme.colors.textMain : theme.colors.textDim }}
                >
                  {tile.name}
                </h4>

                {/* Description / Status */}
                <p
                  className="text-xs"
                  style={{ color: theme.colors.textDim }}
                >
                  {isAvailable ? tile.description : 'Coming soon'}
                </p>

                {/* Availability badge for unavailable agents */}
                {!isAvailable && (
                  <span
                    className="absolute top-3 left-3 px-2 py-0.5 text-xs rounded-full"
                    style={{
                      backgroundColor: theme.colors.border,
                      color: theme.colors.textDim,
                    }}
                  >
                    Soon
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Project Name Input */}
      <div className="mt-8 flex flex-col items-center">
        <label
          htmlFor="project-name"
          className="text-sm mb-2"
          style={{ color: theme.colors.textDim }}
        >
          Project Name (optional)
        </label>
        <input
          ref={nameInputRef}
          id="project-name"
          type="text"
          value={state.agentName}
          onChange={(e) => setAgentName(e.target.value)}
          onFocus={() => setIsNameFieldFocused(true)}
          onBlur={() => setIsNameFieldFocused(false)}
          placeholder="My Project"
          className="w-64 px-4 py-2 rounded-lg border text-center outline-none transition-all"
          style={{
            backgroundColor: theme.colors.bgMain,
            borderColor: isNameFieldFocused ? theme.colors.accent : theme.colors.border,
            color: theme.colors.textMain,
            boxShadow: isNameFieldFocused ? `0 0 0 2px ${theme.colors.accent}40` : 'none',
          }}
        />
      </div>

      {/* Footer with Continue Button */}
      <div className="mt-8 flex justify-center">
        <button
          onClick={handleContinue}
          disabled={!canProceedToNext()}
          className="px-8 py-3 rounded-lg font-medium transition-all outline-none"
          style={{
            backgroundColor: canProceedToNext() ? theme.colors.accent : theme.colors.border,
            color: canProceedToNext() ? theme.colors.accentForeground : theme.colors.textDim,
            cursor: canProceedToNext() ? 'pointer' : 'not-allowed',
            opacity: canProceedToNext() ? 1 : 0.6,
          }}
        >
          Continue
        </button>
      </div>

      {/* Keyboard hints */}
      <div className="mt-4 flex justify-center gap-6">
        <span
          className="text-xs flex items-center gap-1"
          style={{ color: theme.colors.textDim }}
        >
          <kbd
            className="px-1.5 py-0.5 rounded text-xs"
            style={{ backgroundColor: theme.colors.border }}
          >
            ← → ↑ ↓
          </kbd>
          Navigate
        </span>
        <span
          className="text-xs flex items-center gap-1"
          style={{ color: theme.colors.textDim }}
        >
          <kbd
            className="px-1.5 py-0.5 rounded text-xs"
            style={{ backgroundColor: theme.colors.border }}
          >
            Tab
          </kbd>
          Name field
        </span>
        <span
          className="text-xs flex items-center gap-1"
          style={{ color: theme.colors.textDim }}
        >
          <kbd
            className="px-1.5 py-0.5 rounded text-xs"
            style={{ backgroundColor: theme.colors.border }}
          >
            Enter
          </kbd>
          Continue
        </span>
      </div>
    </div>
  );
}
