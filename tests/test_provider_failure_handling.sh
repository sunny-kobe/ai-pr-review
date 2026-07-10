#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$ROOT_DIR/tests/lib/assert.sh"

NODE_RUNNER="$ROOT_DIR/src/reviewRunner.ts"
OPENAI_PROVIDER="$ROOT_DIR/src/openai-provider.ts"

PROVIDER_SKIP_COUNT="$(
  (rg -n 'skipping current batch|LGTM summaries' "$NODE_RUNNER" "$OPENAI_PROVIDER" || true) \
    | wc -l | tr -d ' '
)"
assert_eq "0" "$PROVIDER_SKIP_COUNT" "provider failures must not be converted into LGTM summaries"

PARSE_FAILURE_WRAPPER_COUNT="$(
  (rg -n 'OpenAI-compatible provider failed' "$OPENAI_PROVIDER" || true) \
    | wc -l | tr -d ' '
)"
assert_eq "1" "$PARSE_FAILURE_WRAPPER_COUNT" "unparseable provider responses fail the review run through provider wrapper"

if npm --prefix "$ROOT_DIR" test >/dev/null; then
  echo "PASS: Node runner/provider exits non-zero for provider and parse failures"
else
  echo "FAIL: Node runner/provider failure behavior tests should pass"
  exit 1
fi
