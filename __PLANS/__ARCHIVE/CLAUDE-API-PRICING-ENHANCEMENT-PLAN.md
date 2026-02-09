# Claude API Full Pricing Support - Investigation & Implementation Plan

**Created:** 2026-02-09
**Author:** maestro-planner (claude cloud)
**Status:** INVESTIGATION COMPLETE - AWAITING REVIEW (v2 - Updated with Max vs API billing)
**Priority:** Medium-High (Accuracy improvement for cost tracking)

---

## Executive Summary

This document presents a comprehensive analysis and implementation plan for supporting the full Claude API pricing guide within Maestro, including:

1. **Current State Analysis**: How pricing is currently implemented (hard-coded Sonnet 4)
2. **Impact on Other Agent Types**: Confirmation that changes will not affect Codex/OpenCode/etc.
3. **Claude Pricing Guide Implementation**: Full model pricing support
4. **Claude Max vs API Billing Mode**: Toggle for subscription vs per-token pricing
5. **Model Auto-Detection**: Local and Remote SSH agent model detection
6. **Authentication Auto-Detection**: Detect OAuth (Max) vs API key authentication
7. **User Override UI**: Edit Agent modal enhancements
8. **Project Folder Pricing Modal**: Bulk billing configuration per project
9. **Storage Strategy**: Per-agent and per-project model/billing configuration persistence

---

## 1. Current Pricing Implementation Analysis

### 1.1 Hard-Coded Sonnet 4 Pricing (Confirmed Issue)

**File:** `/app/Maestro/src/main/constants.ts` (lines 107-115)

```typescript
/**
 * Claude API pricing (per million tokens) - Sonnet 4 pricing
 * Used for cost estimation in session statistics
 */
export const CLAUDE_PRICING = {
  INPUT_PER_MILLION: 3,        // $3 per MTok
  OUTPUT_PER_MILLION: 15,      // $15 per MTok
  CACHE_READ_PER_MILLION: 0.3, // $0.30 per MTok
  CACHE_CREATION_PER_MILLION: 3.75,  // $3.75 per MTok
} as const;
```

This is the **root cause** of incorrect cost calculations when using Opus 4.5/4.6 models.

### 1.2 Pricing Utility Functions

**File:** `/app/Maestro/src/main/utils/pricing.ts`

The `calculateCost()` function accepts a `PricingConfig` parameter with defaults to `CLAUDE_PRICING`, allowing for flexible model-specific pricing if we pass different configs:

```typescript
export function calculateCost(
  tokens: TokenCounts,
  pricing: PricingConfig = CLAUDE_PRICING  // <-- Defaults to Sonnet 4
): number { ... }
```

**Key Insight:** The architecture already supports dynamic pricing - we just need to:
1. Create pricing configs for each Claude model
2. Determine which model is in use
3. Determine billing mode (Max subscription vs API)
4. Pass the correct config to `calculateCost()`

### 1.3 Where Pricing is Used

| Location | File | Usage |
|----------|------|-------|
| Session storage | `claude-session-storage.ts` | `calculateClaudeCost()` for session stats |
| IPC handlers | `claude.ts`, `agentSessions.ts` | Cost calculations |
| Stats pipeline | `stats-listener.ts` | Recording costs to database |
| Exit handler | `ExitHandler.ts` | Final session cost calculation |

---

## 2. Other Agent Types - Impact Analysis

### 2.1 Codex (OpenAI)

**File:** `/app/Maestro/src/main/parsers/codex-output-parser.ts` (lines 366-398)

```typescript
/**
 * Note: Cost tracking is not supported - Codex doesn't provide cost and pricing varies by model
 */
private extractUsageFromRaw(msg: CodexRawMessage): ParsedEvent['usage'] | null {
  // ... omits costUsd field
}
```

**Conclusion:** Codex explicitly does NOT track costs. Any Claude pricing changes will NOT affect Codex.

### 2.2 OpenCode

**File:** `/app/Maestro/src/main/agents/capabilities.ts` (lines 294-295)

```typescript
supportsCostTracking: true,  // part.cost in step_finish events
supportsUsageStats: true,    // part.tokens in step_finish events
```

OpenCode provides its own `part.cost` field in the JSON output - it calculates costs internally based on its configured model. Maestro doesn't need to calculate costs for OpenCode.

### 2.3 Other Agents (Aider, Gemini, Qwen3)

All other agents either:
- Don't support cost tracking (`supportsCostTracking: false`)
- Or provide their own cost calculations

**Conclusion:** Changes to Claude pricing will NOT affect any other agent types.

---

## 3. Claude Max vs API Pricing - Critical Discovery

### 3.1 Billing Mode Differences

Based on research, Claude has **two fundamentally different billing models**:

| Aspect | Claude Max (Subscription) | Claude API (Pay-per-token) |
|--------|---------------------------|----------------------------|
| **Billing** | Flat monthly fee ($100/5x or $200/20x) | Per-token pricing |
| **Input Tokens** | Included in subscription | $3-$15/MTok (by model) |
| **Output Tokens** | Included in subscription | $15-$75/MTok (by model) |
| **Cache Read** | **FREE** (included) | $0.10-$1.50/MTok |
| **Cache Write** | **FREE** (included) | $0.30-$18.75/MTok |
| **Overage** | Available at API rates | N/A |

### 3.2 Key Insight: Cache Tokens Are FREE for Max Users

For Claude Max subscribers:
- **Cache read tokens cost $0** - they don't consume usage quota
- **Cache write tokens cost $0** - they don't consume usage quota
- Only **input + output tokens** count against the subscription limits
- The displayed "cost" for Max users should reflect their **effective API cost equivalent** (useful for tracking efficiency) or optionally show $0 for cache tokens

### 3.3 Proposed Billing Modes

```typescript
type ClaudeBillingMode = 'api' | 'max';

interface ClaudePricingConfig {
  billingMode: ClaudeBillingMode;

  // When billingMode === 'api':
  // - All token types are charged at model rates

  // When billingMode === 'max':
  // - Cache tokens have $0 cost
  // - Input/output show API-equivalent cost for tracking
}
```

### 3.4 Cost Calculation by Billing Mode

**API Mode (billingMode === 'api'):**
```
totalCost = (inputTokens * inputRate)
          + (outputTokens * outputRate)
          + (cacheReadTokens * cacheReadRate)
          + (cacheWriteTokens * cacheWriteRate)
```

**Max Mode (billingMode === 'max'):**
```
totalCost = (inputTokens * inputRate)
          + (outputTokens * outputRate)
          + 0  // cacheReadTokens are FREE
          + 0  // cacheWriteTokens are FREE
```

---

## 4. Authentication Auto-Detection

### 4.1 Detection from Claude Credentials

Claude Code stores authentication in `~/.claude/.credentials.json`:

```json
{
  "claudeAiOauth": {
    "accessToken": "sk-ant-oat01-...",
    "subscriptionType": "max",        // <-- KEY FIELD
    "rateLimitTier": "default_claude_max_5x"
  }
}
```

**Detection Logic:**
- If `subscriptionType === "max"` → Default to Max billing mode
- If API key present (no OAuth) → Default to API billing mode

### 4.2 Remote SSH Agent Detection

For remote agents, we can detect authentication by:

1. **Parsing remote credentials file** (one-time during agent setup):
   ```bash
   ssh user@host "cat ~/.claude/.credentials.json 2>/dev/null"
   ```

2. **Caching the detected billing mode** per SSH remote

3. **Allowing user override** if detection fails

### 4.3 Authentication Detection Flow

```
Agent starts / SSH remote configured
    ↓
Read ~/.claude/.credentials.json (local or remote)
    ↓
Parse subscriptionType field
    ↓
subscriptionType === "max" ? billingMode = 'max' : 'api'
    ↓
Store as default, allow user override
```

---

## 5. Full Claude API Pricing Guide

### 5.1 Complete Model Pricing Table (Per Million Tokens)

From the Claude pricing page (fetched 2026-02-09):

| Model | Input | Output | Cache Read | Cache Write (5m) |
|-------|-------|--------|------------|------------------|
| **Claude Opus 4.6** | $5 | $25 | $0.50 | $6.25 |
| **Claude Opus 4.5** | $5 | $25 | $0.50 | $6.25 |
| **Claude Opus 4.1** | $15 | $75 | $1.50 | $18.75 |
| **Claude Opus 4** | $15 | $75 | $1.50 | $18.75 |
| **Claude Sonnet 4.5** | $3 | $15 | $0.30 | $3.75 |
| **Claude Sonnet 4** | $3 | $15 | $0.30 | $3.75 |
| **Claude Haiku 4.5** | $1 | $5 | $0.10 | $1.25 |
| Claude Haiku 3.5 | $0.80 | $4 | $0.08 | $1 |
| Claude Haiku 3 | $0.25 | $1.25 | $0.03 | $0.30 |

### 5.2 Additional Pricing Considerations (Phase 2+)

1. **Long Context (>200K tokens)**: 2x input pricing, 1.5x output pricing
2. **Batch API**: 50% discount on all tokens
3. **Data Residency (US-only)**: 1.1x multiplier on Opus 4.6+
4. **Fast Mode (Opus 4.6)**: 6x pricing

---

## 6. Model Auto-Detection Strategy

### 6.1 Detection Methods (Priority Order)

1. **Claude Code Output Parsing** (Most Reliable)
   - Claude Code's `modelUsage` object in result messages contains model names as keys
   - Example: `{ "claude-opus-4-5-20251101": { inputTokens: 1000, ... } }`

2. **Claude CLI `--model` Flag Detection**
   - Model aliases: `sonnet`, `opus`, `haiku` or full names

3. **Subscription-Based Default**
   - Max 5x/20x → Opus 4.5/4.6
   - Pro → Sonnet 4

### 6.2 Proposed Detection Flow

```
Agent starts
    ↓
Parse first result message with modelUsage
    ↓
Extract model name from modelUsage keys
    ↓
Match to pricing table
    ↓
Store detected model in session state
    ↓
Use model-specific pricing for cost calculations
```

---

## 7. UI/UX Design: Edit Agent Modal Enhancement

### 7.1 Current Modal Structure

The Edit Agent modal currently has:
- Provider dropdown (Claude Code, Codex, OpenCode, etc.)
- Working directory
- SSH Remote configuration
- Environment variables

### 7.2 Proposed UI Addition - Model & Billing Section

Add after Provider dropdown:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Provider:  [Claude Code ▼]                                          │
├─────────────────────────────────────────────────────────────────────┤
│ Pricing Configuration                                                │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ Model:     [Opus 4.5 (Detected) ▼]   Billing: [● Max  ○ API]   │ │
│ │            ℹ️ Auto-detected from output                          │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ ℹ️ Max: Cache tokens are free (subscription). Detected from login.  │
│ ℹ️ API: All tokens charged at model rates.                          │
│                                                                      │
│ ⚠️ If billing mode differs from your actual auth, costs will be     │
│    inaccurate. Check Claude settings to confirm.                    │
├─────────────────────────────────────────────────────────────────────┤
│ Working Directory: /path/to/project                                  │
└─────────────────────────────────────────────────────────────────────┘
```

### 7.3 Toggle Button Group Design

```
Billing Mode:
┌────────────────────────────────────┐
│  [● Claude Max]  [○ API Tokens]   │
│                                    │
│  Cache tokens: FREE                │
└────────────────────────────────────┘
```

### 7.4 Warning Messages

**When user selects API but OAuth detected:**
```
⚠️ You're logged in with Claude Max subscription but selected API pricing.
   Cache token costs may be overstated.
```

**When user selects Max but API key detected:**
```
⚠️ You're using an API key but selected Max pricing.
   Cache tokens will show $0 but may actually incur charges.
```

---

## 8. NEW: Project Folder Pricing Modal

### 8.1 Purpose

Allow users to configure billing mode and model settings at the **Project Folder level**, applying to all agents within that project.

### 8.2 Access Method

Add a **settings icon (ℹ️ or ⚙️)** to each Project Folder header that opens the modal:

```
┌──────────────────────────────────────────┐
│ 📁 MAESTRO                            ⚙️ │  <-- Click icon to open modal
├──────────────────────────────────────────┤
│  🤖 claude-dev-1                         │
│  🤖 claude-dev-2                         │
│  💬 Group Chat: Planning                 │
└──────────────────────────────────────────┘
```

### 8.3 Project Folder Settings Modal Design

```
┌──────────────────────────────────────────────────────────────────────┐
│ 📁 MAESTRO - Pricing Settings                                    [X] │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ Project-Level Defaults                                               │
│ ┌──────────────────────────────────────────────────────────────────┐│
│ │ Billing Mode:  [● Claude Max]  [○ API Tokens]                    ││
│ │                                                                  ││
│ │ ℹ️ Changes here apply to all agents in this project unless       ││
│ │   individually overridden below.                                 ││
│ └──────────────────────────────────────────────────────────────────┘│
│                                                                      │
│ Agent Configuration                                                  │
│ ┌──────────────────────────────────────────────────────────────────┐│
│ │  Agent              │ Model         │ Billing  │ Detected Auth   ││
│ ├─────────────────────┼───────────────┼──────────┼─────────────────┤│
│ │ 🤖 claude-dev-1     │ Opus 4.5 ▼    │ [Max ▼]  │ OAuth (Max)     ││
│ │ 🤖 claude-dev-2     │ Sonnet 4 ▼    │ [API ▼]  │ API Key         ││
│ │ 🌐 claude-remote    │ Opus 4.6 ▼    │ [Max ▼]  │ OAuth (Max)     ││
│ └──────────────────────────────────────────────────────────────────┘│
│                                                                      │
│ ℹ️ Detected Auth shows what Maestro detected from each agent's      │
│   Claude credentials. Individual settings override project defaults. │
│                                                                      │
│                                        [Cancel]  [Save]              │
└──────────────────────────────────────────────────────────────────────┘
```

### 8.4 Behavior Rules

1. **Project Toggle → All Agents**: Changing the project-level toggle updates all agents in the list
2. **Individual Override**: Changing an individual agent's billing mode is allowed
3. **Mixed State**: If agents have different settings, project toggle shows indeterminate state (-)
4. **Cascade Logic**:
   - Project-level change → overwrites all agent settings
   - Agent-level change → only affects that agent, project shows mixed state
5. **Sync with Edit Agent Modal**: Changes here reflect in Edit Agent modal and vice versa

### 8.5 Visual Indicators for Mixed State

```
Project-Level Defaults
┌──────────────────────────────────────────────────────────────────┐
│ Billing Mode:  [- Mixed]  [● Claude Max]  [○ API Tokens]         │
│                                                                  │
│ ⚠️ Agents have different billing modes. Select one to apply to  │
│   all agents.                                                    │
└──────────────────────────────────────────────────────────────────┘
```

---

## 9. Storage Strategy

### 9.1 Per-Agent Configuration (Existing Store)

**Location:** `agentConfigsStore` in `/app/Maestro/src/main/stores/`

**Schema Addition:**

```typescript
interface AgentPricingConfig {
  // Billing mode
  billingMode: 'auto' | 'max' | 'api';

  // The model to use for pricing (or 'auto' for auto-detection)
  pricingModel: 'auto' | ClaudeModelId;

  // Last detected model from agent output
  detectedModel?: ClaudeModelId;

  // Last detected billing mode from credentials
  detectedBillingMode?: 'max' | 'api';

  // Timestamp of last detection
  detectedAt?: number;
}

// Storage key: `configs.${agentId}.pricingConfig`
```

### 9.2 Per-Project Folder Configuration (New)

**Location:** Extend `projectFoldersStore`

**Schema Addition to ProjectFolder:**

```typescript
interface ProjectFolder {
  // ... existing fields (id, name, emoji, etc.)

  // NEW: Default pricing configuration for all agents in this folder
  pricingConfig?: {
    billingMode: 'max' | 'api';
    // Note: Model is per-agent only, not per-project
  };
}
```

### 9.3 Configuration Precedence

```
1. Agent-level setting (if explicitly set, not 'auto')
      ↓ falls back to
2. Project Folder default (if agent belongs to folder)
      ↓ falls back to
3. Auto-detected from credentials
      ↓ falls back to
4. Application default ('api' - conservative)
```

### 9.4 IPC Handlers to Add

```typescript
// Agent-level
'agents:getPricingConfig': (agentId: string) => AgentPricingConfig
'agents:setPricingConfig': (agentId: string, config: Partial<AgentPricingConfig>) => void
'agents:detectAuth': (agentId: string, sshRemoteId?: string) => DetectedAuth

// Project-level
'projectFolders:getPricingConfig': (folderId: string) => ProjectPricingConfig
'projectFolders:setPricingConfig': (folderId: string, config: ProjectPricingConfig) => void
'projectFolders:applyPricingToAllAgents': (folderId: string, billingMode: 'max' | 'api') => void
```

---

## 10. Implementation Phases (Updated)

### Phase 1: Core Pricing Infrastructure (2-3 days)

1. **Create Claude Model Pricing Registry**
   - File: `src/main/utils/claude-pricing.ts`
   - Define all model pricing configurations
   - Add billing mode support with cache token zeroing

2. **Add Billing Mode to Pricing Function**
   - File: `src/main/utils/pricing.ts`
   - Update `calculateCost()` to accept `billingMode` parameter
   - Set cache costs to $0 when `billingMode === 'max'`

3. **Add Model Detection to Output Parser**
   - File: `src/main/parsers/claude-output-parser.ts`
   - Extract model name from `modelUsage` keys

4. **Update Cost Calculation Pipeline**
   - Files: `ExitHandler.ts`, `stats-listener.ts`, `claude-session-storage.ts`
   - Pass detected/configured model and billing mode

### Phase 2: Authentication Detection (1-2 days)

1. **Create Auth Detection Utility**
   - File: `src/main/utils/claude-auth-detector.ts`
   - Read and parse `~/.claude/.credentials.json`
   - Extract `subscriptionType` field

2. **Add SSH Remote Auth Detection**
   - Remote file reading via SSH
   - Cache results per remote

3. **Add IPC Handlers**
   - `agents:detectAuth(agentId, sshRemoteId?)` - Detect authentication type

### Phase 3: Storage & Configuration (1-2 days)

1. **Extend AgentConfigsStore Schema**
   - Add `pricingConfig` field to agent configurations

2. **Extend ProjectFoldersStore Schema**
   - Add `pricingConfig` field to ProjectFolder

3. **Add IPC Handlers for Configuration**
   - All the handlers listed in Section 9.4

### Phase 4: UI Implementation - Edit Agent Modal (2-3 days)

1. **Add Billing Mode Toggle**
   - ToggleButtonGroup component: "Claude Max" / "API Tokens"
   - Position next to or below Model dropdown

2. **Add Detection Indicators**
   - Show "(Detected: Max)" or "(Detected: API)" text
   - Warning icons when override differs from detected

3. **Add Sync with Project Settings**
   - Note when agent inherits from project default

### Phase 5: UI Implementation - Project Folder Modal (2-3 days)

1. **Create ProjectFolderSettingsModal Component**
   - New file: `src/renderer/components/modals/ProjectFolderSettingsModal.tsx`

2. **Add Settings Icon to ProjectFolderHeader**
   - File: `src/renderer/components/sidebar/ProjectFolderHeader.tsx`

3. **Implement Agent Table with Dropdowns**
   - List all agents in project
   - Model dropdown, Billing dropdown per agent
   - Project-level toggle at top

4. **Implement Cascade Logic**
   - Project toggle updates all agents
   - Track mixed state

### Phase 6: SSH Remote Support (1-2 days)

1. **Remote Auth Detection**
   - SSH command to read credentials
   - Parse and cache results

2. **Per-Remote Configuration**
   - Allow different billing modes per SSH remote

### Phase 7: Testing & Polish (2-3 days)

1. **Unit Tests**
   - Pricing calculations with both billing modes
   - Auth detection parsing
   - Configuration precedence

2. **Integration Tests**
   - End-to-end cost tracking
   - Project folder cascade behavior

---

## 11. Files to Modify

### Backend (Main Process)

| File | Changes |
|------|---------|
| `src/main/utils/claude-pricing.ts` | NEW - Model pricing registry with billing modes |
| `src/main/utils/claude-auth-detector.ts` | NEW - Auth/subscription detection |
| `src/main/utils/pricing.ts` | Add billingMode parameter, zero cache for Max |
| `src/main/constants.ts` | Keep as fallback, add billing mode constant |
| `src/main/parsers/claude-output-parser.ts` | Extract model from modelUsage |
| `src/main/process-manager/handlers/StdoutHandler.ts` | Track detected model |
| `src/main/process-manager/handlers/ExitHandler.ts` | Pass model & billing to cost calc |
| `src/main/process-listeners/stats-listener.ts` | Store billing mode in database |
| `src/main/storage/claude-session-storage.ts` | Use model+billing specific pricing |
| `src/main/ipc/handlers/agents.ts` | Add pricing config IPC handlers |
| `src/main/ipc/handlers/projectFolders.ts` | Add pricing config handlers |
| `src/main/stores/types.ts` | Add pricing config types |

### Frontend (Renderer)

| File | Changes |
|------|---------|
| `src/renderer/components/shared/AgentConfigPanel.tsx` | Add billing toggle |
| `src/renderer/components/modals/ProjectFolderModal.tsx` | Extend or create settings modal |
| `src/renderer/components/modals/ProjectFolderSettingsModal.tsx` | NEW - Pricing settings |
| `src/renderer/components/sidebar/ProjectFolderHeader.tsx` | Add settings icon |
| `src/renderer/types/index.ts` | Add pricing config types |

### Shared

| File | Changes |
|------|---------|
| `src/shared/types.ts` | Add ClaudeModelId, ClaudeBillingMode types, extend ProjectFolder |
| `src/shared/stats-types.ts` | Add pricingModel, billingMode to QueryEvent |

---

## 12. Risk Assessment

### Low Risk

- Adding new pricing configurations (additive change)
- Model detection from output (read-only)
- UI additions (isolated to agent settings)
- Auth detection (read-only file access)

### Medium Risk

- Cost calculation changes (affects displayed values)
- Database schema changes (requires migration)
- Project folder schema extension

### Mitigation

- Default to 'auto' detection for both model and billing mode
- Keep backward compatibility with hard-coded Sonnet 4 + API mode as fallback
- Extensive unit tests for pricing accuracy in both modes
- Clear UI indicators when settings are auto-detected vs overridden

---

## 13. Success Criteria

1. **Accurate Cost Tracking**: Costs match actual charges for both Max and API users
2. **Model Auto-Detection**: 95%+ detection rate from normal operation
3. **Auth Auto-Detection**: Correct billing mode detection from credentials
4. **User Override**: Users can manually set model and billing mode if auto-detection fails
5. **Project-Level Configuration**: Bulk apply billing mode to all agents in a project
6. **No Regression**: Other agent types (Codex, OpenCode) unaffected
7. **SSH Support**: Remote agents correctly detect model and auth

---

## 14. Open Questions for Discussion

1. ~~**Cache TTL Pricing**: Claude offers 5-minute and 1-hour cache pricing. Should we track which was used, or assume 5-minute (default)?~~ → **Resolved**: For Max users, irrelevant (both free). For API users, assume 5-minute.

2. **Long Context Pricing**: Should we detect >200K context and apply premium pricing automatically? (Phase 2)

3. **Batch API Detection**: Can we detect when Batch API is being used for 50% discount? (Phase 2)

4. **Historical Data**: Should we allow retroactive repricing of historical sessions when billing mode is corrected?

5. **Cost Display for Max Users**: Should we show:
   - a) API-equivalent cost (useful for tracking efficiency)
   - b) $0 for everything (technically accurate for subscription)
   - c) Input/output cost only, cache shown as $0

   **Recommendation**: Option (c) - shows the "effective" cost while correctly showing cache as free.

---

## 15. Appendix: Claude Model IDs

Full model IDs from Claude CLI `--model` help:

```
claude-opus-4-6-20260115        # Opus 4.6
claude-opus-4-5-20251101        # Opus 4.5
claude-opus-4-1-20250319        # Opus 4.1
claude-opus-4-20250514          # Opus 4
claude-sonnet-4-5-20250929      # Sonnet 4.5
claude-sonnet-4-20250514        # Sonnet 4
claude-haiku-4-5-20251001       # Haiku 4.5
claude-haiku-3-5-20241022       # Haiku 3.5
claude-3-haiku-20240307         # Haiku 3

# Aliases:
opus, opus-4.5, opus-4.6        # Latest Opus family
sonnet, sonnet-4, sonnet-4.5    # Latest Sonnet family
haiku, haiku-4.5                # Latest Haiku family
```

---

## 16. Appendix: Credentials File Structure

**Location:** `~/.claude/.credentials.json`

```json
{
  "claudeAiOauth": {
    "accessToken": "sk-ant-oat01-...",
    "refreshToken": "sk-ant-ort01-...",
    "expiresAt": 1770630669687,
    "scopes": ["user:inference", "user:profile", "user:sessions:claude_code"],
    "subscriptionType": "max",
    "rateLimitTier": "default_claude_max_5x"
  }
}
```

**Detection Logic:**
- `subscriptionType === "max"` → billingMode = 'max'
- `subscriptionType === "pro"` → billingMode = 'api' (Pro still pays per token overage)
- No OAuth, API key present → billingMode = 'api'

---

*End of Plan Document - v2*

---

## Sources

- [Claude Pricing - Official](https://claude.com/pricing)
- [Claude API Pricing Documentation](https://platform.claude.com/docs/en/about-claude/pricing)
- [Claude Code Pricing Guide - LaunchKit](https://launchkit.tech/blog/claude-code-pricing-guide)
- [Claude Code Pricing - ClaudeLog](https://claudelog.com/claude-code-pricing/)
