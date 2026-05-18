#!/usr/bin/env bash
# lint-no-silent-error-swallow.sh
#
# Scans TS/JS files for catch blocks that silently swallow errors.
# Maestro CLAUDE.md is explicit: "DO let exceptions bubble up" so Sentry
# captures them. Bare `catch {}` blocks and no-op handlers (`catch (e) {}`,
# `catch (e) { console.error(e) }`) are the documented anti-pattern.
#
# Usage:
#   scripts/lint-no-silent-error-swallow.sh [paths...]
#     - With no args: scans tracked TS/JS files in the working tree.
#     - With args: scans only those paths.
#
# Exit codes:
#   0 = clean
#   1 = silent catch block(s) found
#
# Patterns flagged:
#   - `catch {` without any binding — swallows the error entirely
#   - `catch (e) {` followed within the next 3 non-blank lines ONLY by:
#       - empty body (`}` immediately or after whitespace/comments only)
#       - `console.error(e)` / `console.error(err)` / `console.log(...)` and nothing else
#       - `// ignored` / `/* swallow */` style comments and nothing else
#
# Acceptable patterns (NOT flagged):
#   - `catch (e) { throw e }` — re-throws
#   - `catch (e) { throw new ... }` — wraps and rethrows
#   - `catch (e) { captureException(e, ...) }` — uses Sentry utility
#   - `catch (e) { logger.error(...); throw e }` — logs AND rethrows
#   - `catch (e) { if (e.code === 'X') ... else throw e }` — handles known, rethrows unknown
#   - Anything where a throw, return-with-error, or captureException appears within 5 lines
#
# Justification escape hatch (any of these on the catch line OR within 2 lines above):
#   // swallow-ok: <reason>
#   // swallow-ok(<ticket>): <reason>
#
# Example acceptable:
#   // swallow-ok(MAES-456): cleanup is best-effort; failure is non-fatal
#   try { fs.unlinkSync(tmp) } catch (e) {}
#
set -euo pipefail

JUSTIFICATION_REGEX='(//|/\*)\s*swallow-ok(\([^)]+\))?:\s*\S'

is_text_file() {
	local f="$1"
	case "$f" in
		*.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs) return 0 ;;
		*) return 1 ;;
	esac
}

# Look-ahead window: examine N lines after the catch{ to decide if it's a no-op.
LOOKAHEAD=5

if [ "$#" -gt 0 ]; then
	FILES=("$@")
else
	mapfile -t FILES < <(git ls-files '*.ts' '*.tsx' '*.js' '*.jsx' '*.mjs' '*.cjs' 2>/dev/null || true)
fi

violations=0

scan_file() {
	local f="$1"
	local lines=()
	mapfile -t lines < "$f"
	local n=${#lines[@]}
	local i=0

	while [ "$i" -lt "$n" ]; do
		local line="${lines[$i]}"
		local lineno=$((i + 1))

		# Detect catch start. Cover both `catch {` (bare) and `catch (e) {`
		# Allow whitespace and types: `catch (e: unknown) {` etc.
		if printf '%s' "$line" | grep -qE '\bcatch\s*(\([^)]*\))?\s*\{\s*$'; then

			# Check for justification on this line or up to 2 lines above
			local justified=0
			for back in 0 1 2; do
				local ridx=$((i - back))
				[ "$ridx" -lt 0 ] && continue
				if printf '%s' "${lines[$ridx]}" | grep -qE "$JUSTIFICATION_REGEX"; then
					justified=1
					break
				fi
			done

			if [ "$justified" -eq 1 ]; then
				i=$((i + 1))
				continue
			fi

			# Bare `catch {` (no binding) is ALWAYS a violation regardless of body.
			if printf '%s' "$line" | grep -qE '\bcatch\s*\{'; then
				printf 'VIOLATION: %s:%d  bare `catch {}` swallows errors silently\n' "$f" "$lineno" >&2
				violations=$((violations + 1))
				i=$((i + 1))
				continue
			fi

			# Walk lookahead window for an early `}` (no body) or no-op-only body
			local body_lines=()
			local j=$((i + 1))
			local body_end=0
			while [ "$j" -lt "$n" ] && [ "$j" -lt $((i + 1 + LOOKAHEAD)) ]; do
				local body_line="${lines[$j]}"
				body_lines+=("$body_line")
				# End-of-block heuristic: a closing brace at start of line (modulo whitespace)
				if printf '%s' "$body_line" | grep -qE '^\s*\}'; then
					body_end=1
					break
				fi
				j=$((j + 1))
			done

			# If the catch body contained a throw, return, or captureException → not a violation
			local body_concat=""
			for bl in "${body_lines[@]}"; do
				body_concat+="$bl"$'\n'
			done

			if printf '%s' "$body_concat" | grep -qE '\b(throw|captureException|captureMessage|return\s+\{?\s*(success\s*:\s*false|error|err))\b'; then
				i=$((i + 1))
				continue
			fi

			# If we hit body_end without finding any of the above, it's a silent-swallow violation
			if [ "$body_end" -eq 1 ]; then
				printf 'VIOLATION: %s:%d  catch block has no throw / captureException / structured-error return\n' "$f" "$lineno" >&2
				violations=$((violations + 1))
			fi
			# else: lookahead window exhausted — too long to be obviously silent; assume real handling

		fi

		i=$((i + 1))
	done
}

for f in "${FILES[@]}"; do
	[ -f "$f" ] || continue
	is_text_file "$f" || continue
	case "$f" in
		*/node_modules/*|*/dist/*|*/build/*|*/__generated__/*|*/__tests__/fixtures/*) continue ;;
	esac
	scan_file "$f"
done

if [ "$violations" -gt 0 ]; then
	printf '\n❌ lint-no-silent-error-swallow: %d violation(s) found.\n' "$violations" >&2
	printf 'Maestro CLAUDE.md: "DO let exceptions bubble up" so Sentry captures them.\n' >&2
	printf 'Acceptable patterns:\n' >&2
	printf '  - throw / re-throw\n' >&2
	printf '  - captureException(e, {...}) / captureMessage(...)\n' >&2
	printf '  - return { success: false, error: ... }\n' >&2
	printf 'If the swallow is intentional (e.g., best-effort cleanup), add:\n' >&2
	printf '  // swallow-ok(<ticket>): <one-line reason>\n' >&2
	printf 'on the catch line or within 2 lines above.\n' >&2
	exit 1
fi

exit 0
