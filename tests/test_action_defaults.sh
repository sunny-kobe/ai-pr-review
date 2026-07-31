#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$ROOT_DIR/tests/lib/assert.sh"

ACTION_FILE="$ROOT_DIR/action.yml"

for input_name in \
  ai_provider \
  openai_api_key \
  openai_base_url \
  openai_model \
  openai_api_path \
  openai_response_format \
  openai_reasoning_effort \
  config_file \
  inline_per_file_limit \
  inline_pr_limit \
  review_filter_enabled \
  dry_run; do
  count="$(rg -n "^[[:space:]]*${input_name}:" "$ACTION_FILE" | wc -l | tr -d ' ')"
  assert_eq "1" "$count" "action exposes ${input_name} input"
done

default_provider="$(awk '
  /^[[:space:]]*ai_provider:/ { in_input=1; next }
  in_input && /^[[:space:]]*default:/ {
    value=$0
    sub(/^[[:space:]]*default:[[:space:]]*/, "", value)
    gsub(/^'\''|'\''$/, "", value)
    print value
    exit
  }
' "$ACTION_FILE")"
assert_eq "openai" "$default_provider" "action defaults to OpenAI-compatible provider"

default_response_format="$(awk '
  /^[[:space:]]*openai_response_format:/ { in_input=1; next }
  in_input && /^[[:space:]]*default:/ {
    value=$0
    sub(/^[[:space:]]*default:[[:space:]]*/, "", value)
    gsub(/^'\''|'\''$/, "", value)
    print value
    exit
  }
' "$ACTION_FILE")"
assert_eq "json_schema" "$default_response_format" "action defaults to strict findings schema output"

example_count="$(rg -l 'uses: sunny-kobe/ai-pr-review@v1' "$ROOT_DIR/examples"/*.yml | wc -l | tr -d ' ')"
assert_eq "4" "$example_count" "all workflow examples use the public action"

permissions_count="$(rg -l 'pull-requests: write' "$ROOT_DIR/examples"/*.yml | wc -l | tr -d ' ')"
assert_eq "4" "$permissions_count" "all workflow examples declare pull request permissions"

legacy_count="$(
  (rg -n 'secrets: inherit' "$ROOT_DIR/examples" "$ACTION_FILE" || true) \
    | wc -l | tr -d ' '
)"
assert_eq "0" "$legacy_count" "public examples pass only explicit credentials"
