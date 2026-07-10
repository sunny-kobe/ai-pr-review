#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$ROOT_DIR/tests/lib/assert.sh"

ACTION_FILE="$ROOT_DIR/action.yml"
TRUST_VALUE="$(awk '
  $0 ~ /^        GEMINI_CLI_TRUST_WORKSPACE:/ {
    value=$0
    sub(/^        GEMINI_CLI_TRUST_WORKSPACE:[[:space:]]*/, "", value)
    gsub(/^'\''|'\''$/, "", value)
    print value
  }
' "$ACTION_FILE")"

assert_eq "true" "$TRUST_VALUE" "Gemini CLI trusts CI workspace in headless action runs"

GEMINI_INSTALL_IF_COUNT="$(
  rg -n -F "if: \${{ inputs.ai_provider == 'gemini-cli' }}" "$ACTION_FILE" \
    | wc -l | tr -d ' '
)"
assert_eq "1" "$GEMINI_INSTALL_IF_COUNT" "Gemini CLI installs only for gemini-cli provider"

PROVIDER_ENV_COUNT="$(
  rg -n '^[[:space:]]*AI_PROVIDER:' "$ACTION_FILE" \
    | wc -l | tr -d ' '
)"
assert_eq "1" "$PROVIDER_ENV_COUNT" "action passes provider selection to review script"

JQ_INSTALL_COUNT="$(
  (rg -n 'Install jq|apt-get install -y jq|command -v jq' "$ACTION_FILE" || true) \
    | wc -l | tr -d ' '
)"
assert_eq "0" "$JQ_INSTALL_COUNT" "Node engine action no longer installs jq"
