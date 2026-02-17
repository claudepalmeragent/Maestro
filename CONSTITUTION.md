# CONSTITUTION.md - Maestro's Guiding Philosophy

> **Regenerated**: 2026-02-17
> **Archived version**: `__MD_ARCHIVE/CONSTITUTION_20260217_182050.md`
> **Cross-reference**: [`Codebase_Context_20260217_180422.md`](./Codebase_Context_20260217_180422.md)

---

## 1. Core Philosophy

> **"Transform fractured attention into focused productivity."**

Maestro exists to solve a specific problem: developers running multiple AI
coding agents lose context, miss outputs, and waste time switching between
terminal windows. Maestro is the unified control surface that brings order to
this chaos.

---

## 2. Two Modes

Maestro operates in two complementary modes:

### Solo Mode

Individual agent work. One developer, one agent session, full focus. Solo mode
optimizes for deep interaction with a single AI assistant: reviewing output,
queueing messages, managing context. This is the default starting experience.

### Interactive Mode (Fleet Management)

Fleet management at scale. Multiple agent sessions running simultaneously
across projects, coordinated from a single interface. Interactive mode
introduces Group Chat for multi-agent coordination, enabling developers to
orchestrate parallel workstreams, compare agent outputs, and delegate tasks
across their fleet.

---

## 3. Six Tenets

Every feature, design decision, and line of code must serve these tenets:

### I. Unattended Excellence

Maximize autonomous agent runtime. The ideal Maestro session is one where
agents work independently for extended periods while the developer focuses
elsewhere. Features that increase unattended runtime (auto-run, playbooks,
message queueing, speakable notifications) are always prioritized over
features that demand attention.

### II. The Conductor's Perspective

Think fleet management, not single-agent chat. Maestro is a conductor's
podium, not a musician's chair. The interface must always surface fleet-wide
status at a glance. Delegation is the primary interaction pattern. Group Chat
enables multi-agent coordination where agents can be directed collaboratively
toward shared goals.

### III. Keyboard Sovereignty

Hands never leave the keyboard. Every action in Maestro must be accessible
via keyboard shortcut. Mouse interactions are supplementary, never required.
The command palette, shortcut system, and navigation model are all designed
around the assumption that the user's hands are on the keyboard at all times.

### IV. Instant Response

The UI must be faster than thought. Perceived latency kills focus. Every
interaction must feel instantaneous: panel switches, session creation, input
submission, theme changes. Use optimistic updates, virtualized lists, and
aggressive caching. If an operation takes time, show progress immediately
and never block the UI thread.

### V. Delightful Focus

Solve fleet management brilliantly. Do not succumb to feature creep. Maestro
is not an IDE, not a code editor, not a general-purpose chat application.
Every proposed feature must pass the Maestro Test (see Section 6). Features
that dilute the core mission are rejected, no matter how individually
compelling.

### VI. Transparent Complexity

Progressive disclosure as the governing principle. New users see a clean,
simple interface. Power users discover depth through exploration: keyboard
shortcuts, slash commands, advanced settings, batch operations. Complexity
exists but is never forced upon the user. Layers reveal themselves naturally.

---

## 4. Design Principles

### Visual Language

- **Consistent spacing**: 8px grid system throughout.
- **Color with purpose**: Color conveys state (agent status, message type,
  error severity), never decoration.
- **17 themes + custom**: Visual personalization respects accessibility
  (colorblind palettes available).
- **Typography hierarchy**: Clear distinction between headings, body,
  code, and metadata.

### Interaction Patterns

- **Command palette**: Central hub for all actions.
- **Modal discipline**: Modals are rare, focused, and keyboard-dismissible.
- **Drag-and-drop**: Supplementary, never the only path.
- **Context menus**: Right-click enhances, never gates functionality.
- **Notifications**: Non-blocking, dismissible, speakable.

### Information Architecture

- **Project Folders**: First-class organizational surface above Groups.
  Project Folders are the top-level container that organizes groups and
  sessions by project context. They appear in the sidebar as the primary
  navigation hierarchy.
- **Groups**: Collections of related sessions within a Project Folder.
- **Sessions**: Individual agent instances with their own history and state.
- **Progressive depth**: Sidebar overview -> Session detail -> Full output.

---

## 5. What Maestro Is Not

Clarity about boundaries is as important as clarity about purpose.

### NOT an IDE

Maestro does not edit code. It does not provide syntax highlighting for
source files, code completion, or refactoring tools. Maestro manages agents
that may perform these tasks, but Maestro itself is a management layer.

### NOT a Code Editor

Maestro includes a file explorer for context, but it is not a text editor.
Files are viewable for reference; editing happens in the user's chosen editor
or through the AI agents themselves.

### NOT a Chat App

While Maestro displays conversational output from AI agents, it is not a
general-purpose chat application. There is no user-to-user messaging, no
chat rooms, no social features. Group Chat is specifically multi-agent
coordination, not human conversation.

---

## 6. The Maestro Test

Before shipping any feature, it must answer YES to all six questions:

1. **Does it reduce fractured attention?**
   The feature must consolidate, not fragment, the developer's focus.

2. **Does it increase unattended runtime?**
   The feature should help agents work longer without human intervention,
   or at minimum not reduce autonomous operation time.

3. **Is it keyboard-accessible?**
   Every interaction path must work without a mouse.

4. **Does it feel instant?**
   Perceived performance must be immediate. No spinners for local operations.

5. **Does it serve fleet management?**
   The feature must make sense in the context of managing multiple agents.
   Single-agent-only features must have a compelling justification.

6. **Can a new user ignore it?**
   Progressive disclosure: the feature must not clutter the default
   experience. Power features reveal themselves to power users.

---

## 7. Living Document

This constitution evolves with Maestro. Changes require thoughtful
consideration of downstream impact. When in doubt, return to the core
philosophy: **transform fractured attention into focused productivity.**

---

*For architectural details, see [ARCHITECTURE.md](./ARCHITECTURE.md).
For codebase context, see
[Codebase_Context_20260217_180422.md](./Codebase_Context_20260217_180422.md).*
