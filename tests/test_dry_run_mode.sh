#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$ROOT_DIR/tests/lib/assert.sh"

NODE_RUNNER="$ROOT_DIR/src/reviewRunner.ts"
RUN_REVIEW_SCRIPT="$ROOT_DIR/scripts/run_review.sh"

DRY_RUN_DEFAULT_COUNT="$(
  (rg -n "env\\.DRY_RUN \\?\\? 'false'" "$NODE_RUNNER" || true) \
    | wc -l | tr -d ' '
)"
assert_eq "1" "$DRY_RUN_DEFAULT_COUNT" "Node runner has an explicit dry-run default"

DRY_RUN_WRITE_GUARD_COUNT="$(
  (rg -n 'if \(!dryRun\)' "$NODE_RUNNER" || true) \
    | wc -l | tr -d ' '
)"
assert_eq "1" "$DRY_RUN_WRITE_GUARD_COUNT" "dry-run guards summary and inline GitHub writes in Node runner"

RUN_REVIEW_WRAPPER_COUNT="$(
  (rg -n -F 'node "$ACTION_PATH/dist/index.js"' "$RUN_REVIEW_SCRIPT" || true) \
    | wc -l | tr -d ' '
)"
assert_eq "1" "$RUN_REVIEW_WRAPPER_COUNT" "run_review.sh is a Node entry wrapper"

DRY_RUN_INPUT_COUNT="$(
  (rg -n '^\s*dry_run:' "$ROOT_DIR/action.yml" || true) \
    | wc -l | tr -d ' '
)"
assert_eq "1" "$DRY_RUN_INPUT_COUNT" "action exposes dry_run input for local and workflow validation"
