#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ACTION_DIR="$ROOT_DIR"

for file in \
  src/diff/reviewableLines.ts \
  src/prompt/redaction.ts \
  src/providers/openai.ts \
  src/providers/geminiCli.ts \
  src/findings/severity.ts \
  src/findings/fingerprint.ts \
  src/config/loadConfig.ts \
  src/config/presets.ts \
  src/config/schema.ts \
  src/output/inlineReview.ts \
  src/output/summary.ts \
  src/prompt/buildPrompt.ts \
  src/findings/processFindings.ts \
  src/github/client.ts \
  src/github/pr.ts \
  src/github/comments.ts \
  src/github/review.ts \
  src/reviewRunner.ts \
  src/utils/git.ts \
  src/utils/outputs.ts \
  src/tests/review-pipeline.test.ts \
  src/tests/provider-parsing.test.ts \
  src/tests/github-client.test.ts \
  src/tests/review-runner.test.ts \
  src/tests/review-logic.test.ts; do
  if [ ! -f "$ACTION_DIR/$file" ]; then
    echo "FAIL: TypeScript review logic migration should include $file"
    exit 1
  fi
done
echo "PASS: TypeScript review logic migration files exist"

for removed_file in scripts/review_helpers.sh scripts/openai_provider.mjs; do
  if [ -f "$ACTION_DIR/$removed_file" ]; then
    echo "FAIL: migrated Node/TS engine should not keep $removed_file"
    exit 1
  fi
done
echo "PASS: legacy Bash helper/provider scripts are removed"

if [ ! -x "$ACTION_DIR/node_modules/.bin/tsc" ]; then
  npm --prefix "$ACTION_DIR" install --no-audit --no-fund >/dev/null
fi

npm --prefix "$ACTION_DIR" test
