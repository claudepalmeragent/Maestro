# BACKBURNER.md - Dormant & Disabled Features Tracker

> **Regenerated**: 2026-02-17
> **Archived version**: `__MD_ARCHIVE/BACKBURNER_20260217_182050.md`
> **Cross-reference**: [`Codebase_Context_20260217_180422.md`](./Codebase_Context_20260217_180422.md)

---

## 1. LLM Settings Panel

| Field           | Value                                               |
|-----------------|-----------------------------------------------------|
| **Status**      | Disabled                                            |
| **Disabled Since** | 2024-11-26                                       |
| **Feature Flag**| `FEATURE_FLAGS.LLM_SETTINGS`                        |
| **Location**    | `SettingsModal.tsx`                                  |

### Description

The LLM Settings Panel provided direct LLM connectivity from within Maestro.
It supported three providers:

- **OpenRouter** - Multi-model gateway with API key authentication.
- **Anthropic** - Direct Claude API access with API key authentication.
- **Ollama** - Local model hosting with configurable endpoint.

The panel allowed users to configure provider credentials, select models,
and interact with LLMs directly from the Maestro interface.

### Reason for Disabling

Maestro's core mission is **managing external AI coding agents**, not serving
as a direct LLM interface. The LLM Settings Panel introduced scope overlap
with the agents themselves and risked feature creep that would dilute the
fleet management focus. The panel was disabled via feature flag rather than
removed, preserving the implementation for potential future use.

### Re-enabling Instructions

1. Locate `FEATURE_FLAGS.LLM_SETTINGS` in the feature flags configuration.
2. Set the flag value to `true`.
3. The LLM Settings tab will reappear in `SettingsModal.tsx`.
4. Verify provider configuration UI renders correctly.
5. Test API key storage and model listing for all three providers.

---

## 2. Feature Flag Audit Note

As of 2026-02-17, after **183 commits** of active development, no additional
feature flags have been introduced for disabled features. `FEATURE_FLAGS.LLM_SETTINGS`
remains the sole dormant feature flag in the codebase.

---

## 3. Relationship with Newer Features

The LLM Settings Panel's concept of direct LLM connectivity is distinct from
features added since January 31:

- **Prompt Library** - Manages reusable prompts sent *to agents*, not direct
  LLM calls. The Prompt Library operates at the agent orchestration layer.
- **Anthropic Audit** - Provides cost tracking and usage analytics for
  Anthropic API consumption *through agents*, not through direct panel
  connectivity.

The LLM Settings Panel remains a viable candidate for future re-enablement
if direct LLM interaction (bypassing agents) becomes a desired capability.
The existing provider infrastructure (OpenRouter, Anthropic, Ollama) would
need updating to current API versions but the architectural foundation is
intact.

---

*For full codebase context, see
[Codebase_Context_20260217_180422.md](./Codebase_Context_20260217_180422.md).*
