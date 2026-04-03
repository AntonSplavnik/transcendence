#!/usr/bin/env bash
set -euo pipefail

INPUT=$(cat /dev/stdin)

# Only run in auto or acceptEdits mode
MODE=$(echo "$INPUT" | jq -r '.permission_mode')
if [[ "$MODE" != "auto" && "$MODE" != "acceptEdits" ]]; then
    exit 0
fi

# Get the file path from the tool input
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
if [[ -z "$FILE" ]]; then
    exit 0
fi

# Only check frontend files
case "$FILE" in
    */frontend/src/*) ;;
    *) exit 0 ;;
esac

# Resolve relative to repo root
REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT/frontend"

# Make path relative to frontend/ for eslint/prettier
REL_PATH="${FILE#"$REPO_ROOT/frontend/"}"

errors=""

lint_output=$(npx eslint "$REL_PATH" 2>&1) || errors+="=== LINT ERRORS ===
$lint_output

"

format_output=$(npx prettier --check "$REL_PATH" 2>&1) || errors+="=== FORMAT ERRORS ===
$format_output

"

if [ -n "$errors" ]; then
    echo "$errors"
    exit 1
fi
