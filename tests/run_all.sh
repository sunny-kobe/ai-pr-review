#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

bash "$ROOT_DIR/tests/test_action_ci_trust.sh"
bash "$ROOT_DIR/tests/test_node_engine_entrypoint.sh"
bash "$ROOT_DIR/tests/test_openai_provider.sh"
bash "$ROOT_DIR/tests/test_ts_review_logic.sh"
bash "$ROOT_DIR/tests/test_dry_run_mode.sh"
bash "$ROOT_DIR/tests/test_provider_failure_handling.sh"
bash "$ROOT_DIR/tests/test_review_submission_order.sh"
bash "$ROOT_DIR/tests/test_action_defaults.sh"
