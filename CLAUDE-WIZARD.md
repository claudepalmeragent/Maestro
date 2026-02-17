# CLAUDE-WIZARD.md

> **Regenerated**: 2026-02-17
> **Archived version**: `__MD_ARCHIVE/CLAUDE-WIZARD_20260217_182050.md`
> **Cross-reference**: `Codebase_Context_20260217_180422.md`

Wizard system documentation for Maestro v0.14.5.

---

## 1. Onboarding Wizard

The Onboarding Wizard is a full-screen, 5-step guided flow for new users. It walks through agent selection, project setup, and initial configuration.

**Important**: The wizard has **5 steps**, not 4. This is defined by `WIZARD_TOTAL_STEPS = 5` (search for this constant in the codebase).

### Step-by-Step Flow

#### Step 1: Agent Selection

The user selects which AI agent to configure (e.g., Claude Code, Codex, custom agents). The selection determines which downstream options are available.

#### Step 2: Directory Selection

The user picks their project directory. The wizard validates the directory exists, checks for existing configuration files, and detects project type (git repo, monorepo, language ecosystem).

#### Step 3: Conversation with Confidence Scoring

An interactive conversation step where the wizard asks the user about their project, preferences, and workflow. Responses are scored for confidence using `WizardConfidenceGauge` — the gauge fills as the wizard gathers enough context to generate high-quality configuration documents.

#### Step 4: Preparing Plan

This is an **automated step with no user input**. The wizard auto-generates configuration documents (Auto Run docs, project settings) based on the conversation in Step 3. This step advances automatically when generation completes.

Key component: `PreparingPlanScreen.tsx` — displays progress, streaming output, and filler phrases (sourced from `fillerPhrases.ts`) while documents are being generated.

If existing Auto Run documents are detected, the wizard presents `ExistingAutoRunDocsModal.tsx` or `ExistingDocsModal.tsx` to let the user choose whether to keep, merge, or replace them.

#### Step 5: Phase Review

The user reviews all generated documents, edits them if needed via `DocumentEditor.tsx` and `DocumentSelector.tsx`, and confirms the final configuration. This completes the onboarding flow.

### Files (15+ across screens/services/tour)

| File | Purpose |
|---|---|
| `PreparingPlanScreen.tsx` | Step 4 automated document generation UI |
| `ExistingAutoRunDocsModal.tsx` | Modal for handling pre-existing Auto Run docs |
| `ExistingDocsModal.tsx` | Modal for handling pre-existing general docs |
| `austinFacts.ts` | Fun facts displayed during loading/waiting states |
| `fillerPhrases.ts` | Contextual filler text shown during generation |
| `shuffle.ts` | Array shuffle utility for randomizing display content |
| `wizardErrorDetection.ts` | Error detection and recovery logic for wizard steps |
| `DocumentEditor.tsx` | Rich editor for reviewing/editing generated docs |
| `DocumentSelector.tsx` | Document picker for Step 5 review |
| + additional screen, service, and tour files | |

### State Persistence & Resume

The wizard state is persisted so that if the user closes the app mid-wizard, they can resume from where they left off. State is saved on each step transition and cleared on completion or explicit cancellation.

Search for `const openWizard` to find the entry point that launches the onboarding wizard.

### Tour System

The Onboarding Wizard includes an optional Tour System that highlights UI elements with spotlight cutouts. Tour steps are defined declaratively, each specifying:

- A target element selector
- A message/description
- Spotlight cutout dimensions and position
- Navigation controls (next, back, skip)

The tour runs after the wizard completes (on first launch) to orient the user around the main Maestro interface.

---

## 2. Inline Wizard (`/wizard`)

The Inline Wizard is triggered via the `/wizard` command within an active tab. Unlike the Onboarding Wizard (which is full-screen), the Inline Wizard runs inside the conversation tab and focuses specifically on creating Auto Run documents.

### Components (11+)

| Component | Purpose |
|---|---|
| `GenerationCompleteOverlay` | Overlay shown when document generation finishes |
| `StreamingDocumentPreview` | Live preview of the document as it streams in |
| `WizardConfidenceGauge` | Visual gauge showing conversation confidence level |
| `WizardExitConfirmDialog` | Confirmation dialog when user tries to exit mid-wizard |
| `WizardMessageBubble` | Chat-style message bubble for wizard conversation |
| `WizardModePrompt` | Initial prompt/CTA to enter wizard mode |
| `WizardPill` | Compact indicator pill showing wizard is active |
| + 4 additional components | Supporting UI elements |

### State Lifecycle

The Inline Wizard uses a dual-state architecture:

- **In-memory state**: Managed via `useReducer` within the wizard component tree. Holds transient conversation state, current step, streaming content, and UI state. Discarded when the wizard component unmounts.

- **Persisted settings**: Managed via `useSettings` (at `src/renderer/hooks/settings/useSettings.ts`). Stores user preferences that survive across wizard invocations: preferred document format, default output paths, and generation parameters.

This separation ensures that wizard progress is lightweight and disposable (in-memory) while user preferences are durable (persisted).

---

## 3. State Save/Clear Triggers

### Save Triggers

- Step transition (advancing or going back)
- Document generation completion
- User edits to generated documents
- App backgrounding / visibility change

### Clear Triggers

- Wizard completion (all steps finished, user confirms)
- Explicit cancellation via exit dialog
- Session deletion
- Manual reset from settings

---

## 4. Tour Step Definitions

Tour steps are defined as an array of step objects. Each step includes:

```ts
interface TourStep {
  targetSelector: string;    // CSS selector for the spotlight target
  title: string;             // Step title
  description: string;       // Step description/instructions
  placement: 'top' | 'bottom' | 'left' | 'right'; // Tooltip placement
  spotlightPadding?: number; // Extra padding around the spotlight cutout
  onEnter?: () => void;      // Callback when step becomes active
  onExit?: () => void;       // Callback when step is left
}
```

The tour overlay renders a semi-transparent backdrop with a cutout around the target element. Users navigate with Next/Back/Skip controls.

---

## 5. Customization Points

- **Agent-specific wizard flows**: The wizard adapts its steps based on the selected agent type. Different agents may skip or add steps.
- **Document templates**: Generated documents use templates that can be extended or overridden. Search for template-related configuration in the wizard service files.
- **Confidence thresholds**: The confidence scoring in Step 3 uses configurable thresholds to determine when enough context has been gathered. Lower thresholds allow faster progression; higher thresholds produce more detailed documents.
- **Filler phrases and fun facts**: Content in `fillerPhrases.ts` and `austinFacts.ts` can be edited to customize the waiting experience.

---

## 6. Related Settings

The wizard system reads from and writes to settings managed by the `useSettings` hook:

```
src/renderer/hooks/settings/useSettings.ts
```

Relevant settings include:

- Whether the onboarding wizard has been completed
- Tour completion status
- Inline wizard preferences (format, output path)
- Confidence threshold overrides
- Auto Run document defaults

Search for `useSettings` in wizard-related files to trace all settings interactions.
