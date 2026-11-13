#!/usr/bin/env bash
# Gate for untrusted-origin tasks (see Untrusted Input in CLAUDE.md).
# Reads changed file paths on stdin, one per line, e.g. from
#   git diff --name-only origin/main...HEAD
# Prints every path an untrusted-origin task may not change, and exits 1 if
# there are any. Exits 0 when the change set is clean (including when empty).
set -euo pipefail

PROTECTED_PATTERNS=(
    '^\.github/'
    '(^|/)\.husky/'
    '(^|/)\.env[^/]*$'
    '(^|/)\.npmrc$'
    '(^|/)netlify\.toml$'
    '(^|/)package\.json$'
    '(^|/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$'
)

joined_pattern=$(IFS='|'; echo "${PROTECTED_PATTERNS[*]}")
violations=$(grep -E "$joined_pattern" || true)

if [ -z "$violations" ]; then
    exit 0
fi

printf '%s\n' "$violations"
exit 1
