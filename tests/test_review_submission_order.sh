#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$ROOT_DIR/tests/lib/assert.sh"

NODE_RUNNER="$ROOT_DIR/src/reviewRunner.ts"

SUMMARY_SUBMISSION_LINE="$(
  rg -n 'await options\.github\.(updateSummaryComment|createSummaryComment)' "$NODE_RUNNER" \
    | head -n 1 \
    | cut -d: -f1
)"

INLINE_SUBMISSION_LINE="$(
  rg -n 'await options\.github\.submitInlineReview' "$NODE_RUNNER" \
    | head -n 1 \
    | cut -d: -f1
)"

ORDER_OK="false"
if [ -n "$SUMMARY_SUBMISSION_LINE" ] && [ -n "$INLINE_SUBMISSION_LINE" ] && [ "$INLINE_SUBMISSION_LINE" -lt "$SUMMARY_SUBMISSION_LINE" ]; then
  ORDER_OK="true"
fi

assert_eq "true" "$ORDER_OK" "inline review submission block appears before summary submission block"
