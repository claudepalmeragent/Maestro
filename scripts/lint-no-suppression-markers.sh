#!/usr/bin/env bash
# lint-no-suppression-markers.sh
#
# Scans TS/JS files for type-checker / linter suppression markers introduced
# without a `// suppress: <reason>` justification on the same or previous line.
#
# Maestro CLAUDE.md principle: "Don't add features... beyond what the task
# requires." Suppression markers without justification accumulate as silent
# tech debt; the suppression should declare WHY (linked ticket, known bug,
# upstream issue, etc.).
#
# Usage:
#   scripts/lint-no-suppression-markers.sh [paths...]
#     - With no args: scans tracked TS/JS files in the working tree.
#     - With args: scans only those paths (used by pre-commit hook with the
#       file list it determines from the staged diff).
#
# Exit codes:
#   0 = clean
#   1 = suppression marker(s) found without `// suppress:` justification
#
# Justification format (any of these on same line OR previous line is accepted):
#   // suppress: <one-line reason>
#   // suppress(<ticket>): <one-line reason>
#   /* suppress: <reason> */
#
# Example acceptable:
#   // suppress(MAES-123): node-pty type defs missing this overload — upstream PR open
#   // @ts-expect-error
#
# Example rejected:
#   // @ts-expect-error
#
set -euo pipefail

SUPPRESSION_PATTERNS=(
	'@ts-ignore'
	'@ts-expect-error'
	'@ts-nocheck'
	'eslint-disable'
	'eslint-disable-next-line'
	'eslint-disable-line'
	'prettier-ignore'
)

JUSTIFICATION_REGEX='(//|/\*)\s*suppress(\([^)]+\))?:\s*\S'

is_text_file() {
	local f="$1"
	case "$f" in
		*.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs) return 0 ;;
		*) return 1 ;;
	esac
}

if [ "$#" -gt 0 ]; then
	FILES=("$@")
else
	# Default: all tracked TS/JS files
	mapfile -t FILES < <(git ls-files '*.ts' '*.tsx' '*.js' '*.jsx' '*.mjs' '*.cjs' 2>/dev/null || true)
fi

violations=0

for f in "${FILES[@]}"; do
	[ -f "$f" ] || continue
	is_text_file "$f" || continue

	# Skip test fixtures + dist + node_modules + generated
	case "$f" in
		*/node_modules/*|*/dist/*|*/build/*|*/__generated__/*|*/__tests__/fixtures/*) continue ;;
	esac

	# Walk lines; for each suppression match, check current AND previous line for justification
	prev_line=""
	line_num=0
	while IFS= read -r line || [ -n "$line" ]; do
		line_num=$((line_num + 1))

		matched_pattern=""
		for pat in "${SUPPRESSION_PATTERNS[@]}"; do
			if printf '%s' "$line" | grep -qF "$pat"; then
				matched_pattern="$pat"
				break
			fi
		done

		if [ -n "$matched_pattern" ]; then
			# Check same line
			if printf '%s' "$line" | grep -qE "$JUSTIFICATION_REGEX"; then
				:  # Justified inline — pass
			# Check previous line
			elif printf '%s' "$prev_line" | grep -qE "$JUSTIFICATION_REGEX"; then
				:  # Justified on previous line — pass
			else
				printf 'VIOLATION: %s:%d  %s without "// suppress: <reason>" justification\n' \
					"$f" "$line_num" "$matched_pattern" >&2
				violations=$((violations + 1))
			fi
		fi

		prev_line="$line"
	done < "$f"
done

if [ "$violations" -gt 0 ]; then
	printf '\n❌ lint-no-suppression-markers: %d violation(s) found.\n' "$violations" >&2
	printf 'Each suppression marker must be accompanied by a "// suppress: <reason>" comment\n' >&2
	printf 'on the same or previous line. Example:\n' >&2
	printf '  // suppress(MAES-123): node-pty type defs missing — upstream PR open\n' >&2
	printf '  // @ts-expect-error\n' >&2
	exit 1
fi

exit 0
