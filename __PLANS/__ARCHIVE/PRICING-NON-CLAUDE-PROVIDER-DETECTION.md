# Non-Claude Provider Detection & Free Pricing

**Created:** 2026-02-09
**Status:** Investigation Complete - Awaiting Implementation (After Issue #5)
**Priority:** Medium (Enhancement for Accuracy)
**Complexity:** Medium

---

## Executive Summary

Some Maestro users run Claude Code on remote SSH hosts configured to hit local Ollama servers (or other non-Claude model providers) instead of Claude's API. When this happens, **all tokens should be FREE** since no Claude API charges are incurred.

This document outlines how to detect non-Claude providers and mark their usage as zero-cost.

---

## Problem Statement

### Current Behavior

For a user running Claude Code → Ollama on remote SSH:
- **Expected cost:** $0.00 (local Ollama, no API charges)
- **Displayed cost:** $X.XX (calculated as if using Claude API)
- **Detection shows:** "API Key" (no OAuth detected, but also no Claude API being used)

### User Configuration

The user's setup:
1. Claude Code agents running on **remote SSH hosts**
2. Some hosts configured to use **local Ollama** serving open source models
3. Claude Code acts as the interface, but actual inference is FREE
4. Current system incorrectly charges API rates for these free queries

---

## Investigation Findings

### 1. How Claude Code Supports Non-Claude Providers

Claude Code can be configured to use alternative backends through:

| Method | Description | Detection |
|--------|-------------|-----------|
| Environment Variables | `ANTHROPIC_BASE_URL` or similar | Check `customEnvVars` |
| Custom Provider Path | Alternative binary/proxy | Check `customProviderPath` |
| Model Configuration | Model name in responses | Check `modelUsage` in output |

### 2. Key Signal: Model Name Detection

**Most Reliable Approach:** The model name in Claude Code's output reveals the actual provider.

**Location:** `claude-output-parser.ts` extracts model from `modelUsage`:
```typescript
// msg.modelUsage example for Claude:
{ "claude-opus-4-5-20251101": { inputTokens: 1000, outputTokens: 500 } }

// msg.modelUsage example for Ollama:
{ "ollama/llama2": { inputTokens: 1000, outputTokens: 500 } }
// OR
{ "llama2:latest": { inputTokens: 1000, outputTokens: 500 } }
```

**Detection Logic:**
```typescript
function isClaudeModelId(modelId: string): boolean {
  return modelId in CLAUDE_MODEL_PRICING;
}

// If !isClaudeModelId(detectedModel) → Non-Claude → FREE
```

### 3. Existing Infrastructure

The codebase already has most of what we need:

| Component | File | Status |
|-----------|------|--------|
| Model extraction from output | `claude-output-parser.ts:140-147` | ✅ Exists |
| `isClaudeModelId()` function | `claude-pricing.ts:187-189` | ✅ Exists |
| Store detected model | `stores/types.ts:115-116` | ✅ Exists |
| Record model in stats | `stats-listener.ts:106` | ✅ Exists |
| Pricing resolution | `pricing-resolver.ts` | ⚠️ Needs update |

### 4. Known Non-Claude Model Patterns

Models that indicate FREE pricing:

| Pattern | Provider | Example |
|---------|----------|---------|
| `ollama/*` | Ollama | `ollama/llama2`, `ollama/mistral` |
| `llama*` | Ollama/Local | `llama2:latest`, `llama3-70b` |
| `mistral*` | Ollama/Local | `mistral:latest`, `mixtral-8x7b` |
| `codellama*` | Ollama/Local | `codellama:13b` |
| `qwen*` | Ollama/Local | `qwen2:72b` |
| `deepseek*` | Ollama/Local | `deepseek-coder:33b` |
| `phi*` | Ollama/Local | `phi3:medium` |
| `gemma*` | Ollama/Local | `gemma2:27b` |
| `gpt-*` | OpenAI (if proxied) | `gpt-4`, `gpt-3.5-turbo` |
| `openrouter/*` | OpenRouter | `openrouter/anthropic/claude-3-opus` |

**Note:** OpenRouter models may still incur costs (just not to Claude directly). For now, treat as "Other" provider - user can manually set billing mode.

---

## Proposed Solution

### New Billing Mode: 'free'

Extend `ClaudeBillingMode` to include a 'free' option:

```typescript
type ClaudeBillingMode = 'api' | 'max' | 'free';
```

### New Provider Type

Track the detected provider for UI display and cost logic:

```typescript
type ModelProvider = 'claude' | 'ollama' | 'openai' | 'other';

interface DetectedAuth {
  billingMode: ClaudeBillingMode;
  provider: ModelProvider;  // NEW
  source: 'oauth' | 'api_key' | 'model_detection' | 'default';
  // ...
}
```

### Detection Priority

When resolving billing mode, use this priority:

```
1. User explicitly set 'free' → FREE
2. Model detected as non-Claude → FREE (auto-detected)
3. User explicitly set 'max' or 'api' → Use that
4. Auto-detect from credentials → max/api
5. Default → api
```

---

## Implementation Plan

### Phase 1: Provider Detection Utility

**File:** `src/main/utils/model-provider-detector.ts` (NEW)

```typescript
/**
 * Known non-Claude model patterns that indicate FREE pricing
 */
const NON_CLAUDE_PATTERNS = [
  /^ollama\//i,           // ollama/llama2
  /^llama/i,              // llama2, llama3
  /^mistral/i,            // mistral, mixtral
  /^codellama/i,          // codellama
  /^qwen/i,               // qwen2
  /^deepseek/i,           // deepseek-coder
  /^phi/i,                // phi3
  /^gemma/i,              // gemma2
  /^vicuna/i,             // vicuna
  /^falcon/i,             // falcon
  /^starcoder/i,          // starcoder
  /^wizardcoder/i,        // wizardcoder
];

const OPENAI_PATTERNS = [
  /^gpt-/i,               // gpt-4, gpt-3.5-turbo
  /^o1/i,                 // o1-preview, o1-mini
  /^chatgpt/i,            // chatgpt-4o
];

export type ModelProvider = 'claude' | 'ollama' | 'openai' | 'other';

export function detectModelProvider(modelId: string | undefined): ModelProvider {
  if (!modelId) return 'other';

  // Check if it's a known Claude model
  if (isClaudeModelId(modelId)) {
    return 'claude';
  }

  // Check for local/open-source model patterns
  if (NON_CLAUDE_PATTERNS.some(pattern => pattern.test(modelId))) {
    return 'ollama';
  }

  // Check for OpenAI models (may be proxied)
  if (OPENAI_PATTERNS.some(pattern => pattern.test(modelId))) {
    return 'openai';
  }

  return 'other';
}

export function isFreePricingProvider(provider: ModelProvider): boolean {
  // Ollama/local models are always free
  // OpenAI and 'other' may have costs - let user decide
  return provider === 'ollama';
}
```

### Phase 2: Extend Types

**File:** `src/shared/types.ts`

```typescript
// Extend billing mode to include 'free'
export type ClaudeBillingMode = 'api' | 'max' | 'free';

// Add provider tracking
export type ModelProvider = 'claude' | 'ollama' | 'openai' | 'other';

// Update DetectedAuth
export interface DetectedAuth {
  billingMode: ClaudeBillingMode;
  provider: ModelProvider;
  modelId?: string;
  source: 'oauth' | 'api_key' | 'model_detection' | 'default';
  detectedAt: number;
}
```

**File:** `src/main/stores/types.ts`

```typescript
interface AgentPricingConfig {
  billingMode: 'auto' | 'max' | 'api' | 'free';  // Add 'free'
  pricingModel: 'auto' | ClaudeModelId;
  detectedModel?: string;
  detectedProvider?: ModelProvider;  // NEW
  detectedBillingMode?: ClaudeBillingMode;
  detectedAt?: number;
}
```

### Phase 3: Update Pricing Resolver

**File:** `src/main/utils/pricing-resolver.ts`

```typescript
import { detectModelProvider, isFreePricingProvider } from './model-provider-detector';

export async function resolveBillingMode(
  agentId: string,
  projectFolderId?: string
): Promise<ClaudeBillingMode> {
  const agentConfig = await getAgentPricingConfig(agentId);

  // 1. User explicitly set a mode (including 'free')
  if (agentConfig.billingMode !== 'auto') {
    return agentConfig.billingMode;
  }

  // 2. Check if detected model indicates FREE provider
  if (agentConfig.detectedModel) {
    const provider = detectModelProvider(agentConfig.detectedModel);
    if (isFreePricingProvider(provider)) {
      return 'free';
    }
  }

  // 3. Check project folder default
  if (projectFolderId) {
    const folderConfig = await getProjectFolderPricingConfig(projectFolderId);
    if (folderConfig?.billingMode) {
      return folderConfig.billingMode;
    }
  }

  // 4. Check auto-detected from credentials
  if (agentConfig.detectedBillingMode) {
    return agentConfig.detectedBillingMode;
  }

  // 5. Default to 'api'
  return 'api';
}
```

### Phase 4: Update Cost Calculation

**File:** `src/main/utils/pricing.ts`

```typescript
export function calculateCost(
  tokens: TokenCounts,
  pricing: PricingConfig = CLAUDE_PRICING,
  billingMode: ClaudeBillingMode = 'api'
): number {
  // FREE billing mode = $0 for everything
  if (billingMode === 'free') {
    return 0;
  }

  // Max billing mode = $0 for cache tokens
  if (billingMode === 'max') {
    return calculateCostWithMaxMode(tokens, pricing);
  }

  // API billing mode = full pricing
  return calculateCostWithApiMode(tokens, pricing);
}
```

### Phase 5: Update Output Parser

**File:** `src/main/parsers/claude-output-parser.ts`

```typescript
import { detectModelProvider, ModelProvider } from '../utils/model-provider-detector';

class ClaudeOutputParser {
  private detectedModel?: string;
  private detectedProvider?: ModelProvider;

  // In extractUsage or similar method:
  if (msg.modelUsage) {
    const modelKeys = Object.keys(msg.modelUsage);
    if (modelKeys.length > 0) {
      this.detectedModel = modelKeys[0];
      this.detectedProvider = detectModelProvider(this.detectedModel);
    }
  }

  getDetectedProvider(): ModelProvider | undefined {
    return this.detectedProvider;
  }
}
```

### Phase 6: Update Stats Recording

**File:** `src/main/process-listeners/stats-listener.ts`

When recording query events:

```typescript
async function insertQueryEventWithRetry(event: QueryEvent) {
  // Detect provider from model
  const provider = detectModelProvider(event.detectedModel);

  // For non-Claude providers, set cost to $0
  if (isFreePricingProvider(provider)) {
    event = {
      ...event,
      totalCostUsd: 0,
      billingMode: 'free',
      detectedProvider: provider,
    };
  } else if (event.toolType === 'claude' || event.toolType === 'claude-code') {
    // Existing billing mode resolution for Claude
    const billingMode = await resolveBillingMode(event.agentId, event.projectFolderId);
    // ... existing cost calculation
  }

  await insertQueryEvent(event);
}
```

### Phase 7: Update UI Components

**File:** `src/renderer/components/ui/BillingModeToggle.tsx`

Add 'Free' option to the toggle:

```typescript
const options = [
  { value: 'auto', label: 'Auto', description: 'Auto-detect billing mode' },
  { value: 'max', label: 'Max', description: 'Claude Max subscription (cache free)' },
  { value: 'api', label: 'API', description: 'Per-token API pricing' },
  { value: 'free', label: 'Free', description: 'Local/Ollama (no charges)' },
];
```

**File:** Various UI components

Show provider badge in:
- Session list items
- Usage Dashboard
- Agent configuration panel

```tsx
{detectedProvider === 'ollama' && (
  <span className="provider-badge ollama">Ollama (Free)</span>
)}
{detectedProvider === 'claude' && (
  <span className="provider-badge claude">Claude</span>
)}
```

### Phase 8: Update Database Schema

**File:** `src/main/stats/schema.ts`

Add `detected_provider` column:

```sql
ALTER TABLE query_events ADD COLUMN detected_provider TEXT;
```

---

## Files to Modify

| File | Changes | Phase |
|------|---------|-------|
| `src/main/utils/model-provider-detector.ts` | CREATE - Provider detection logic | 1 |
| `src/shared/types.ts` | Add 'free' to ClaudeBillingMode, add ModelProvider | 2 |
| `src/main/stores/types.ts` | Add detectedProvider to AgentPricingConfig | 2 |
| `src/main/utils/pricing-resolver.ts` | Check for free providers | 3 |
| `src/main/utils/pricing.ts` | Handle 'free' billing mode | 4 |
| `src/main/parsers/claude-output-parser.ts` | Detect and expose provider | 5 |
| `src/main/process-listeners/stats-listener.ts` | Record provider, zero cost for free | 6 |
| `src/renderer/components/ui/BillingModeToggle.tsx` | Add 'Free' option | 7 |
| `src/renderer/components/shared/AgentConfigPanel.tsx` | Show provider badge | 7 |
| `src/main/stats/schema.ts` | Add detected_provider column | 8 |

---

## Detection Logic Summary

```
Model Detection Flow:
┌─────────────────────────────────────────────────────┐
│ Claude Code Output                                   │
│   modelUsage: { "ollama/llama2": {...} }            │
└──────────────────────┬──────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────┐
│ claude-output-parser.ts                              │
│   detectedModel = "ollama/llama2"                   │
│   detectedProvider = detectModelProvider(model)     │
│                    = "ollama"                       │
└──────────────────────┬──────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────┐
│ pricing-resolver.ts                                  │
│   provider = "ollama"                               │
│   isFreePricingProvider(provider) = true            │
│   billingMode = "free"                              │
└──────────────────────┬──────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────┐
│ stats-listener.ts                                    │
│   totalCostUsd = $0.00                              │
│   Store: { billingMode: 'free', provider: 'ollama' }│
└─────────────────────────────────────────────────────┘
```

---

## Cost Logic by Provider

| Provider | billingMode | Input | Output | Cache Read | Cache Write |
|----------|-------------|-------|--------|------------|-------------|
| Claude + API | `api` | Model rate | Model rate | Model rate | Model rate |
| Claude + Max | `max` | Model rate | Model rate | $0 | $0 |
| Ollama | `free` | $0 | $0 | $0 | $0 |
| OpenAI | `api` (default) | User configurable | - | - | - |
| Other | `api` (default) | User configurable | - | - | - |

---

## UI Display

### Session List Item
```
🤖 claude-dev-1          $0.45  [Claude]
🤖 ollama-assistant      $0.00  [Ollama - Free]
```

### Agent Config Panel
```
Billing Mode: [Auto]  [Max]  [API]  [Free]

Detected: Ollama (llama2:latest)
Provider: Local/Ollama (Free)
```

### Usage Dashboard
```
Total Cost: $12.45
├── Claude API: $12.45
├── Claude Max: $0.00 (5 queries)
└── Ollama/Free: $0.00 (23 queries)
```

---

## Edge Cases

### 1. Model Changes Mid-Session
- First query uses Claude, second uses Ollama
- Solution: Track provider per-query, not per-session
- Each query event records its own `detected_provider`

### 2. Unknown Model Names
- Model name doesn't match any pattern
- Solution: Default to 'other' provider, use 'api' billing
- User can manually set to 'free' if they know it's free

### 3. OpenRouter/Proxy Services
- `openrouter/anthropic/claude-3-opus` is still Claude, but via proxy
- Solution: Check for `claude` in model name even with prefix
- Or let user manually configure billing mode

### 4. SSH Remote with Mixed Usage
- Same remote host uses both Claude and Ollama
- Solution: Per-query detection from model name
- Each query is billed according to its actual provider

---

## Dependencies

This implementation **depends on Issue #5** (Dashboard Cost Fix) because:

1. Both modify the cost calculation pipeline
2. Both add columns to the stats database
3. Should be implemented together to avoid duplicate migrations
4. Shared changes in `pricing-resolver.ts` and `stats-listener.ts`

**Recommended Implementation Order:**
1. Issue #5: Dashboard Cost Fix (billing mode at storage time)
2. This Plan: Non-Claude Provider Detection (extends #5 with provider detection)

---

## Risk Assessment

### Low Risk
- Adding new provider detection utility (isolated)
- Adding 'free' billing mode option (additive)
- UI badge display (cosmetic)

### Medium Risk
- Extending billing mode enum (type changes throughout)
- Database schema change (migration required)

### Mitigation
- Extensive pattern matching for model names
- Conservative default ('api' for unknown providers)
- User can always manually override to 'free'

---

## Success Criteria

1. **Accurate Detection:** Ollama models correctly identified as 'ollama' provider
2. **Zero Cost:** Ollama queries show $0.00 in all views
3. **Auto-Detection:** No user action required when model detected
4. **Manual Override:** User can set 'free' billing mode manually
5. **Provider Display:** UI shows provider badge (Claude/Ollama/Other)
6. **No Regression:** Claude API and Max billing unchanged

---

## Timeline Estimate

| Phase | Effort | Dependencies |
|-------|--------|--------------|
| Phase 1: Provider Detection | 1-2 hours | None |
| Phase 2: Type Extensions | 1 hour | Phase 1 |
| Phase 3: Pricing Resolver | 1-2 hours | Phase 2, Issue #5 |
| Phase 4: Cost Calculation | 1 hour | Phase 3 |
| Phase 5: Output Parser | 1 hour | Phase 1 |
| Phase 6: Stats Recording | 2 hours | Phase 5, Issue #5 |
| Phase 7: UI Components | 2-3 hours | Phase 2 |
| Phase 8: Database Schema | 1 hour | Issue #5 |
| Testing | 2 hours | All |

**Total: 12-15 hours** (after Issue #5 is complete)

---

## Next Steps

1. **Complete Issue #5** (Dashboard Cost Fix) first
2. Review this plan for any adjustments
3. Create Auto Run documents for each phase
4. Implement in order
5. Test with actual Ollama setup on SSH remote

---

## Appendix: Common Ollama Model Names

From Ollama's model library (for reference):

```
llama2, llama2:13b, llama2:70b
llama3, llama3:8b, llama3:70b
mistral, mistral:7b
mixtral, mixtral:8x7b
codellama, codellama:7b, codellama:34b
phi3, phi3:medium, phi3:mini
qwen2, qwen2:72b, qwen2:7b
gemma2, gemma2:27b, gemma2:9b
deepseek-coder, deepseek-coder:33b
starcoder2, starcoder2:15b
wizardcoder, wizardcoder:33b
vicuna, vicuna:13b
falcon, falcon:40b
```

All of these should be detected as `provider: 'ollama'` and assigned `billingMode: 'free'`.
