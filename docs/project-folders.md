---
title: Project Folders
description: Organize your agents into logical project groups with color coding and per-folder billing.
icon: folder
---

## Overview

Project Folders let you organize agents and groups into named, color-coded containers in the left panel. Use them to group related agents by project, client, or workflow — keeping your sidebar tidy as your agent count grows.

Key capabilities:

- **Color-coded headers** with emoji icons for visual identification
- **Drag-and-drop reordering** of folders and agents within them
- **Collapsible sections** to focus on what matters
- **Multi-folder membership** — agents can belong to multiple folders simultaneously
- **Per-folder billing settings** — configure billing mode for all agents in a folder at once

## Creating a Project Folder

1. Right-click in the left panel and select **Create Project Folder**, or use `Cmd+K` / `Ctrl+K` and search for "Create Project Folder"
2. In the modal, configure:
   - **Emoji** — Click the emoji picker to choose an icon (defaults to the folder icon)
   - **Folder Name** — Enter a name (displayed in uppercase)
   - **Highlight Color** — Pick a color from the palette. The color appears as a left bar when the folder is expanded and a background tint when collapsed
3. Click **Create**

## Adding Agents to a Folder

Right-click any agent in the left panel and select **Add to Project**. A submenu shows all available folders with checkboxes — toggle folders on or off. Agents can belong to multiple folders.

You can also create a new folder directly from this menu by clicking **Create New Folder...** at the bottom.

### Groups and Group Chats

Groups and group chats can also be assigned to project folders. Right-click a group header and select **Add to Project**. Groups have a one-to-one relationship with folders (each group belongs to one folder at most).

## Managing Folders

### Renaming

Double-click the folder name in the header to edit it inline. Press `Enter` to save or `Esc` to cancel.

### Editing

Right-click the folder header and select **Edit Folder...** to reopen the creation modal. Change the name, emoji, or highlight color.

### Reordering

Drag folders by the grip handle on the left side of the header to reorder them. The new order is saved automatically.

### Collapsing and Expanding

Click a folder header to toggle its collapsed state. Collapsed folders show a chevron indicator and the item count badge.

### Deleting

Right-click the folder header and select **Delete Folder**. Deleting a folder does not delete the agents or groups inside it — they simply become unassigned.

## Per-Folder Billing Settings

Project Folders support per-folder billing configuration for Claude agents. Access it by right-clicking a folder header and selecting **Folder Settings...**.

The settings modal provides:

- **Project Default Billing Mode** — A toggle to set all Claude agents in the folder to **Max** (subscription) or **API** (per-token) billing. If agents have different modes, the toggle shows a mixed state indicator
- **Agent Configuration Table** — View and override individual agent billing modes. Each row shows the agent name, current billing mode (Auto / Max / API), and detected authentication source (OAuth or API Key)

Changes cascade: setting the project-level toggle updates all Claude agents in the folder. Individual agent overrides are also supported.

## Tips

- **One folder per project** — Create a folder for each project you're working on. Add the project's agents, terminals, and group chats to keep everything in one place.
- **Color for priority** — Use bright colors for active projects and muted colors for maintenance work. The color bar makes it easy to scan your sidebar at a glance.
- **Multi-folder for cross-cutting concerns** — Since agents can belong to multiple folders, add a shared utility agent to every relevant project folder.
- **Billing consistency** — Use folder-level billing settings to ensure all agents in a client project use the same billing mode, avoiding accidental cost surprises.
