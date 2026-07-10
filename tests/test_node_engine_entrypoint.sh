#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$ROOT_DIR/tests/lib/assert.sh"

ACTION_DIR="$ROOT_DIR"
ACTION_FILE="$ACTION_DIR/action.yml"

for file in package.json tsconfig.json src/index.ts; do
  if [ ! -f "$ACTION_DIR/$file" ]; then
    echo "FAIL: action should include $file for the Node/TS engine migration"
    exit 1
  fi
done
echo "PASS: action includes Node/TS engine scaffold files"

if [ ! -x "$ACTION_DIR/node_modules/.bin/tsc" ]; then
  npm --prefix "$ACTION_DIR" install --no-audit --no-fund >/dev/null
fi
npm --prefix "$ACTION_DIR" run build >/dev/null

node --check "$ACTION_DIR/dist/index.js"
echo "PASS: Node engine entrypoint build parses under node"

HELP_OUTPUT="$(node "$ACTION_DIR/dist/index.js" --help)"
if printf '%s\n' "$HELP_OUTPUT" | grep -q 'AI PR Review Node engine'; then
  echo "PASS: Node engine entrypoint exposes help output"
else
  echo "FAIL: Node engine entrypoint should expose help output"
  echo "$HELP_OUTPUT"
  exit 1
fi

if printf '%s\n' "$HELP_OUTPUT" | grep -q -- '--legacy-bash'; then
  echo "FAIL: Node engine help should not expose the removed legacy Bash delegation path"
  echo "$HELP_OUTPUT"
  exit 1
fi
echo "PASS: Node engine help no longer exposes legacy Bash delegation"

SELF_TEST_OUTPUT="$(node "$ACTION_DIR/dist/index.js" --self-test)"
if printf '%s\n' "$SELF_TEST_OUTPUT" | grep -q 'self-test passed'; then
  echo "PASS: Node engine entrypoint can load migrated TypeScript review modules"
else
  echo "FAIL: Node engine entrypoint should self-test migrated TypeScript review modules"
  echo "$SELF_TEST_OUTPUT"
  exit 1
fi

SMOKE_DIR="$(mktemp -d)"
MOCK_SERVER="$(mktemp).mjs"
SERVER_LOG="$(mktemp)"
REQUEST_LOG="$(mktemp)"
cleanup_smoke() {
  if [ -n "${SERVER_PID:-}" ]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$SMOKE_DIR" "$MOCK_SERVER" "$SERVER_LOG" "$REQUEST_LOG"
}
trap cleanup_smoke EXIT

(
  cd "$SMOKE_DIR"
  git init -q
  git config user.name "AI PR Review Test"
  git config user.email "ai-review-test@example.com"
  mkdir -p src
  printf 'const before = 1;\n' > src/example.ts
  git add src/example.ts
  git commit -q -m 'base'
  BASE_SHA="$(git rev-parse HEAD)"
  printf 'const before = 1;\nconst value = data.items[0];\n' > src/example.ts
  git add src/example.ts
  git commit -q -m 'head'
  HEAD_SHA="$(git rev-parse HEAD)"

  cat > "$MOCK_SERVER" <<'NODE'
import http from 'node:http';
import { appendFileSync } from 'node:fs';

const baseSha = process.env.BASE_SHA;
const headSha = process.env.HEAD_SHA;
const requestLog = process.env.REQUEST_LOG;

const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }
  appendFileSync(requestLog, `${req.method} ${req.url}\n`);

  if (req.method === 'GET' && req.url === '/repos/example-org/example-repo/pulls/42') {
    return json(res, {
      head: { sha: headSha, ref: 'feature/node-engine' },
      base: { sha: baseSha, ref: 'main' },
      title: 'Node engine smoke',
      body: 'Smoke test body',
      draft: false,
      changed_files: 1,
    });
  }
  if (req.method === 'GET' && req.url === '/repos/example-org/example-repo/pulls/42/commits?per_page=100&page=1') {
    return json(res, [{ commit: { message: 'test(review): smoke node engine' } }]);
  }
  if (req.method === 'GET' && req.url === '/repos/example-org/example-repo/pulls/42/files?per_page=100&page=1') {
    return json(res, [{ filename: 'src/example.ts', status: 'modified' }]);
  }
  if (req.method === 'GET' && req.url === '/repos/example-org/example-repo/pulls/42/comments?per_page=100&page=1') {
    return json(res, []);
  }
  if (req.method === 'GET' && req.url === '/repos/example-org/example-repo/issues/42/comments?per_page=100&page=1') {
    return json(res, [{ id: 1001, body: '<!-- ai-pr-review:summary -->\nold summary' }]);
  }
  if (req.method === 'PATCH' && req.url === '/repos/example-org/example-repo/issues/comments/1001') {
    return json(res, { id: 1001, body: JSON.parse(body).body });
  }
  if (req.method === 'POST' && req.url === '/repos/example-org/example-repo/pulls/42/reviews') {
    return json(res, { id: 2001 });
  }
  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    return json(res, {
      choices: [
        {
          message: {
            content: JSON.stringify({
              findings: [
                {
                  file: 'src/example.ts',
                  line: 2,
                  severity: 'high',
                  message: '数组访问未做空值检查',
                },
              ],
            }),
          },
        },
      ],
    });
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ message: `Unhandled ${req.method} ${req.url}` }));
});

function json(res, payload) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

server.listen(0, '127.0.0.1', () => {
  console.log(server.address().port);
});
NODE

  BASE_SHA="$BASE_SHA" HEAD_SHA="$HEAD_SHA" REQUEST_LOG="$REQUEST_LOG" node "$MOCK_SERVER" > "$SERVER_LOG" &
  SERVER_PID=$!
  for _ in $(seq 1 50); do
    if [ -s "$SERVER_LOG" ]; then
      break
    fi
    sleep 0.1
  done
  PORT="$(cat "$SERVER_LOG")"

  SMOKE_OUTPUT="$(
    GITHUB_REPOSITORY="example-org/example-repo" \
    GITHUB_TOKEN="test-token" \
    GITHUB_API_URL="http://127.0.0.1:${PORT}" \
    ACTION_REPOSITORY="sunny-kobe/ai-pr-review" \
    PR_NUMBER="42" \
    PRESET="frontend" \
    PRESET_DIR="$ACTION_DIR/presets" \
    AI_PROVIDER="openai" \
    OPENAI_API_KEY="test-key" \
    OPENAI_BASE_URL="http://127.0.0.1:${PORT}" \
    OPENAI_MODEL="gpt-5.6-luna" \
    OPENAI_RESPONSE_FORMAT="json_object" \
    FILE_TYPES=".ts" \
    EXCLUDE_PATTERNS="" \
    SKIP_DRAFT="true" \
    DRY_RUN="false" \
    node "$ACTION_DIR/dist/index.js" 2>&1
  )"

  printf '%s\n' "$SMOKE_OUTPUT" | grep -q 'using sunny-kobe/ai-pr-review'
  printf '%s\n' "$SMOKE_OUTPUT" | grep -q 'provider=openai'
  printf '%s\n' "$SMOKE_OUTPUT" | grep -q 'processed files=1 skipped=0'
  printf '%s\n' "$SMOKE_OUTPUT" | grep -q 'summary updated'
  printf '%s\n' "$SMOKE_OUTPUT" | grep -q 'inline review submitted'
  grep -q 'PATCH /repos/example-org/example-repo/issues/comments/1001' "$REQUEST_LOG"
  grep -q 'POST /repos/example-org/example-repo/pulls/42/reviews' "$REQUEST_LOG"
)
echo "PASS: Node engine entrypoint smoke logs action repository, provider, processed files, summary update, and inline review submission"

ACTION_NODE_ENTRYPOINT_COUNT="$(
  rg -n -F 'bash "${{ github.action_path }}/scripts/run_review.sh"' "$ACTION_FILE" \
    | wc -l | tr -d ' '
)"
assert_eq "1" "$ACTION_NODE_ENTRYPOINT_COUNT" "action launches the Bash entrypoint wrapper"
