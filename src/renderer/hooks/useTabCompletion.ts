import { useMemo, useCallback } from 'react';
import type { Session } from '../types';
import type { FileNode } from './useFileExplorer';

export interface TabCompletionSuggestion {
  value: string;
  type: 'history' | 'file' | 'folder' | 'branch' | 'tag';
  displayText: string;
}

export interface UseTabCompletionReturn {
  getSuggestions: (input: string) => TabCompletionSuggestion[];
}

// Git commands that should trigger branch/tag completion
const GIT_BRANCH_COMMANDS = [
  'git checkout',
  'git switch',
  'git branch -d',
  'git branch -D',
  'git branch --delete',
  'git merge',
  'git rebase',
  'git cherry-pick',
  'git diff',
  'git log',
  'git reset',
  'git revert',
  'git push origin',
  'git pull origin',
  'git fetch origin'
];

const GIT_TAG_COMMANDS = [
  'git checkout',
  'git tag -d',
  'git tag --delete',
  'git show',
  'git diff',
  'git push origin'
];

/**
 * Hook for providing tab completion suggestions from:
 * 1. Shell command history
 * 2. Current directory file tree
 * 3. Git branches and tags (for git commands in git repos)
 *
 * Performance optimizations:
 * - fileNames is memoized to avoid re-traversing tree on every render
 * - shellHistory is memoized separately to avoid recreating on file tree changes
 * - getSuggestions is wrapped in useCallback to maintain referential equality
 */
export function useTabCompletion(session: Session | null): UseTabCompletionReturn {
  // Build a flat list of file/folder names from the file tree
  // Only re-computed when fileTree actually changes
  const fileNames = useMemo(() => {
    if (!session?.fileTree) return [];

    const names: { name: string; type: 'file' | 'folder'; path: string }[] = [];

    const traverse = (nodes: FileNode[], currentPath = '') => {
      for (const node of nodes) {
        const fullPath = currentPath ? `${currentPath}/${node.name}` : node.name;
        names.push({
          name: node.name,
          type: node.type,
          path: fullPath
        });
        if (node.type === 'folder' && node.children) {
          traverse(node.children, fullPath);
        }
      }
    };

    traverse(session.fileTree);
    return names;
  }, [session?.fileTree]);

  // Memoize shell history reference to avoid unnecessary getSuggestions re-creation
  const shellHistory = useMemo(() => {
    return session?.shellCommandHistory || [];
  }, [session?.shellCommandHistory]);

  // Memoize getSuggestions to maintain stable function reference
  const getSuggestions = useCallback((input: string): TabCompletionSuggestion[] => {
    if (!session || !input.trim()) return [];

    const suggestions: TabCompletionSuggestion[] = [];
    const inputLower = input.toLowerCase();
    const seenValues = new Set<string>();

    // Get the last "word" for file/folder completion
    // This handles cases like "cd src/", "cat file", etc.
    const parts = input.split(/\s+/);
    const lastPart = parts[parts.length - 1] || '';
    const prefix = parts.slice(0, -1).join(' ');
    const lastPartLower = lastPart.toLowerCase();

    // 1. Check shell command history for matches
    for (const cmd of shellHistory) {
      if (cmd.toLowerCase().startsWith(inputLower) && !seenValues.has(cmd)) {
        seenValues.add(cmd);
        suggestions.push({
          value: cmd,
          type: 'history',
          displayText: cmd
        });
      }
    }

    // 2. Check git branches and tags for git commands in git repos
    if (session.isGitRepo) {
      const shouldShowBranches = GIT_BRANCH_COMMANDS.some(cmd => inputLower.startsWith(cmd.toLowerCase()));
      const shouldShowTags = GIT_TAG_COMMANDS.some(cmd => inputLower.startsWith(cmd.toLowerCase()));

      if (shouldShowBranches || shouldShowTags) {
        const gitBranches = session.gitBranches || [];
        const gitTags = session.gitTags || [];

        // Add matching branches
        if (shouldShowBranches) {
          for (const branch of gitBranches) {
            const fullValue = `${prefix} ${branch}`.trim();
            if (branch.toLowerCase().startsWith(lastPartLower) && !seenValues.has(fullValue)) {
              seenValues.add(fullValue);
              suggestions.push({
                value: fullValue,
                type: 'branch',
                displayText: branch
              });
            }
          }
        }

        // Add matching tags
        if (shouldShowTags) {
          for (const tag of gitTags) {
            const fullValue = `${prefix} ${tag}`.trim();
            if (tag.toLowerCase().startsWith(lastPartLower) && !seenValues.has(fullValue)) {
              seenValues.add(fullValue);
              suggestions.push({
                value: fullValue,
                type: 'tag',
                displayText: tag
              });
            }
          }
        }
      }
    }

    // 3. Check file tree for matches on the last word
    // Handle path-like completions (e.g., "cd src/comp" should match files in src/)
    // Also handle ./ prefix (e.g., "./src" -> "src")
    const normalizedLastPart = lastPart.replace(/^\.\//, ''); // Strip leading ./
    const pathParts = normalizedLastPart.split('/');
    let searchInPath = pathParts.length > 1 ? pathParts.slice(0, -1).join('/') : '';
    // Handle edge case where user types "./" alone - treat as root
    if (lastPart === './' || lastPart === '.') {
      searchInPath = '';
    }
    const searchTerm = pathParts[pathParts.length - 1].toLowerCase();

    for (const file of fileNames) {
      // If user is typing a path, only show files in that path
      if (searchInPath) {
        if (!file.path.toLowerCase().startsWith(searchInPath.toLowerCase() + '/')) {
          continue;
        }
        // Check if the remaining part matches
        const remaining = file.path.slice(searchInPath.length + 1);
        const remainingParts = remaining.split('/');
        // Only show immediate children
        if (remainingParts.length !== 1) continue;
        if (!remaining.toLowerCase().startsWith(searchTerm)) continue;
      } else {
        // Top-level search
        if (!file.name.toLowerCase().startsWith(searchTerm)) continue;
        // For top-level, only show top-level items (no / in path)
        if (file.path.includes('/')) continue;
      }

      const completedPath = searchInPath ? `${searchInPath}/${file.name}` : file.name;
      const fullValue = prefix ? `${prefix} ${completedPath}` : completedPath;

      if (!seenValues.has(fullValue)) {
        seenValues.add(fullValue);
        suggestions.push({
          value: fullValue + (file.type === 'folder' ? '/' : ''),
          type: file.type,
          displayText: completedPath + (file.type === 'folder' ? '/' : '')
        });
      }
    }

    // Sort: history first, then branches, then tags, then folders, then files
    // Within each category, sort alphabetically
    suggestions.sort((a, b) => {
      const typeOrder: Record<string, number> = { history: 0, branch: 1, tag: 2, folder: 3, file: 4 };
      if (typeOrder[a.type] !== typeOrder[b.type]) {
        return typeOrder[a.type] - typeOrder[b.type];
      }
      return a.displayText.localeCompare(b.displayText);
    });

    // Limit to reasonable number
    return suggestions.slice(0, 10);
  }, [session, fileNames, shellHistory]);

  return { getSuggestions };
}
