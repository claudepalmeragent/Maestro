# Fix: Exclude Zero Values from Throughput Averages

**Created:** 2026-02-09
**Status:** Ready for Implementation
**Priority:** Low (Accuracy improvement)
**Effort:** ~30 minutes

---

## Problem

The SQL queries calculating average throughput (`tokens_per_second`) include rows with zero values, which artificially deflates the displayed averages.

**Example:** An agent with 10 queries at 50 tok/s and 10 queries at 0 tok/s shows 25 tok/s average instead of 50 tok/s.

**Zero values can come from:**
1. Very short queries with negligible output
2. Old records before token tracking was added (NULL coerced to 0)
3. Failed queries that didn't produce output

---

## Current SQL (Includes Zeros)

### `queryByAgentIdByDay()` - Line 425
```sql
COALESCE(AVG(tokens_per_second), 0) as avg_tokens_per_second
```

### `queryByAgent()` - Line 51
```sql
COALESCE(AVG(tokens_per_second), 0) as avg_tokens_per_second
```

### `queryTokenMetrics()` - Line 491
```sql
COALESCE(AVG(tokens_per_second), 0) as avg_tokens_per_second
```

### `queryBySessionByDay()` - Line 357
```sql
COALESCE(AVG(tokens_per_second), 0) as avg_tokens_per_second
```

### `queryByDay()` - Line 149
```sql
AVG(tokens_per_second) as avg_tokens_per_second
```

### `queryByAgentByDay()` - Line 195
```sql
COALESCE(AVG(tokens_per_second), 0) as avg_tokens_per_second
```

---

## Fix: Use NULLIF to Exclude Zeros

Replace all instances with:
```sql
COALESCE(AVG(NULLIF(tokens_per_second, 0)), 0) as avg_tokens_per_second
```

**How it works:**
- `NULLIF(tokens_per_second, 0)` returns NULL if value is 0, otherwise returns the value
- `AVG()` ignores NULL values in its calculation
- `COALESCE(..., 0)` returns 0 if all values were NULL (no valid data)

---

## Files to Modify

| File | Function | Line |
|------|----------|------|
| `src/main/stats/aggregations.ts` | `queryByAgentIdByDay` | ~425 |
| `src/main/stats/aggregations.ts` | `queryByAgent` | ~51 |
| `src/main/stats/aggregations.ts` | `queryTokenMetrics` | ~491 |
| `src/main/stats/aggregations.ts` | `queryBySessionByDay` | ~357 |
| `src/main/stats/aggregations.ts` | `queryByDay` | ~149 |
| `src/main/stats/aggregations.ts` | `queryByAgentByDay` | ~195 |

---

## Implementation

Single file change with 6 replacements:

```typescript
// Find all instances of:
AVG(tokens_per_second)
// or
COALESCE(AVG(tokens_per_second), 0)

// Replace with:
COALESCE(AVG(NULLIF(tokens_per_second, 0)), 0)
```

---

## Testing

1. Create test data with mixed zero/non-zero throughput values
2. Verify averages exclude zeros
3. Verify charts still render correctly
4. Verify edge case: all zeros returns 0, not NULL

---

## Impact

- **Charts:** Will show higher (more accurate) throughput averages
- **Dashboard cards:** Avg Throughput will increase
- **Historical data:** Immediately improved without backfill

This fix improves accuracy regardless of whether the backfill script runs.
