/**
 * @file participantColors.ts
 * @description Utilities for group chat participants including colors and name normalization.
 */

import type { Theme } from '../types';

/**
 * Normalize a name for use in @mentions.
 * Replaces spaces with hyphens so names can be referenced without quotes.
 *
 * @param name - Original name (may contain spaces)
 * @returns Normalized name with hyphens instead of spaces
 */
export function normalizeMentionName(name: string): string {
  return name.replace(/\s+/g, '-');
}

/**
 * Check if a name matches a mention target (handles normalized names).
 *
 * @param mentionedName - The name from the @mention (may be hyphenated)
 * @param actualName - The actual session/participant name (may have spaces)
 * @returns True if they match
 */
export function mentionMatches(mentionedName: string, actualName: string): boolean {
  return mentionedName.toLowerCase() === actualName.toLowerCase() ||
         mentionedName.toLowerCase() === normalizeMentionName(actualName).toLowerCase();
}

/**
 * Generate a theme-compatible color for a participant based on their index.
 * Uses golden ratio distribution for visually distinct hues.
 * Colors are adjusted for light/dark themes automatically.
 *
 * @param index - The participant's index in the list
 * @param theme - The current theme
 * @returns HSL color string
 */
export function generateParticipantColor(index: number, theme: Theme): string {
  // Base hues that work well together (golden ratio distribution)
  const baseHues = [210, 150, 30, 270, 0, 180, 60, 300, 120, 330];
  const hue = baseHues[index % baseHues.length];

  // Detect if theme is light or dark based on background color
  const bgHex = theme.colors.bgMain.match(/^#([0-9a-f]{2})/i)?.[1];
  const bgBrightness = bgHex ? parseInt(bgHex, 16) : 20;
  const isLightTheme = bgBrightness > 128;

  // For light themes: more saturated, darker colors
  // For dark themes: slightly desaturated, brighter colors
  const saturation = isLightTheme ? 65 : 55;
  const lightness = isLightTheme ? 45 : 60;

  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

/**
 * Build a color map for all participants.
 * Useful for ensuring consistent colors across components.
 *
 * @param participantNames - Array of participant names in order
 * @param theme - The current theme
 * @returns Map of name to color
 */
export function buildParticipantColorMap(
  participantNames: string[],
  theme: Theme
): Record<string, string> {
  const colors: Record<string, string> = {};
  participantNames.forEach((name, index) => {
    colors[name] = generateParticipantColor(index, theme);
  });
  return colors;
}
