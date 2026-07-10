#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACTION_PATH="${GITHUB_ACTION_PATH:-$(cd "$SCRIPT_DIR/.." && pwd)}"
node "$ACTION_PATH/dist/index.js"
