#!/usr/bin/env bash
set -euo pipefail

INPUT=$(cat /dev/stdin 2>/dev/null || echo '{}')

# Only run in auto or acceptEdits mode
MODE=$(echo "$INPUT" | jq -r '.permission_mode')
if [[ "$MODE" != "auto" && "$MODE" != "acceptEdits" ]]; then
    exit 0
fi

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT/frontend"

test_output=$(npm run test -- --run 2>&1) || {
    echo "=== TEST FAILURES ==="
    echo "$test_output"
    exit 1
}
