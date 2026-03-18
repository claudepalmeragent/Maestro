---
title: Prompt Library
description: Save, search, and reuse your best prompts across projects and agents.
icon: library
---

## Overview

The Prompt Library lets you save prompts from chat conversations and reuse them across any agent or project. Each saved prompt retains its origin metadata (project, agent, tags) and tracks how often it's been used, so your most valuable prompts are always easy to find.

Key capabilities:

- **Save from chat** — Save any user message directly from the AI terminal output
- **Save from Prompt Composer** — Save or auto-save prompts while composing
- **Full-text search** — Find prompts by title, content, tags, project name, or agent name
- **Usage tracking** — See how often each prompt has been used and when it was last used
- **Cross-project access** — All saved prompts are available from any agent in any project
- **Up to 1,000 prompts** — When the limit is reached, least-used prompts are automatically removed

## Saving a Prompt

There are three ways to save a prompt to the library:

### From a Chat Message

Hover over any user message in the AI terminal output. A **bookmark icon** appears in the message actions. Click it to save that message's text to the library. The icon changes to indicate the prompt has been saved.

### From the Prompt Composer

1. Open the Prompt Composer (`Cmd+Shift+P` / `Ctrl+Shift+P`)
2. Write or edit your prompt
3. Click the **Save** button in the bottom-left footer, or press `Cmd+Shift+S` / `Ctrl+Shift+S`
4. A toast notification confirms the save

### Auto-Save on Send

Enable the **Auto-save** toggle in the Prompt Composer footer (bottom-right, next to the other toggles). When enabled, every prompt you send from the Composer is automatically saved to the library.

## Browsing and Searching

Open the Prompt Library search bar from the Prompt Composer:

1. Open the Prompt Composer (`Cmd+Shift+P` / `Ctrl+Shift+P`)
2. Click the **Library** button in the header, or press `Cmd+Shift+L` / `Ctrl+Shift+L`
3. The search bar appears below the header

**Search bar features:**

- Type to search by title, content, tags, project name, or agent name
- Results update as you type (with debounce for smooth performance)
- All search terms must match (AND logic)
- Results are ranked: title matches first, then by use count, then by recency

**Navigating results:**

| Key                                     | Action                        |
| --------------------------------------- | ----------------------------- |
| `↑` / `↓`                               | Move through the list         |
| `Enter`                                 | Select the highlighted prompt |
| `Esc` or `Cmd+Shift+L` / `Ctrl+Shift+L` | Close the library             |

Each result shows:

- **Title** and a preview of the prompt text
- **Project pill** — color-coded to match the project folder color
- **Agent pill** — shows which agent the prompt was saved from
- **Use count badge** — how many times the prompt has been used
- **Last used time** — relative timestamp (e.g., "2h ago")

## Using a Saved Prompt

1. Open the library search bar (see above)
2. Find a prompt by browsing or searching
3. Click it or press `Enter` to select
4. The prompt text is inserted into the Composer's editing area
5. Edit the text if needed, then send

Usage is automatically recorded each time you select a prompt, keeping your most-used prompts ranked higher in search results.

## Managing Prompts

### Editing

Hover over a prompt in the library search bar and click the **pencil icon** to edit its title or content.

### Deleting

Hover over a prompt and click the **trash icon**. Click a second time within 3 seconds to confirm deletion. If the prompt was saved from a chat message, the bookmark indicator on the original message is cleared.

### Viewing Statistics

Prompt Library statistics (total prompts, unique projects, most-used prompt) are tracked automatically and available through the system API.

## Tips

- **Let titles auto-generate** — If you don't provide a title, one is created from the first line of your prompt. Keep your first line descriptive.
- **Use tags for categorization** — Add tags when saving to make prompts easier to find later (e.g., "refactor", "test", "review").
- **Auto-save for exploration** — Enable auto-save in the Prompt Composer when you're experimenting with prompt variations. You can always delete the ones that didn't work.
- **Project-colored pills** — Prompts inherit the color of their project folder, making it easy to visually scan which project a prompt came from.
- **Reuse across projects** — The library is global. A prompt saved in one project can be used in any other project or agent.
