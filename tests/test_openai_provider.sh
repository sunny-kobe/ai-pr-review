#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$ROOT_DIR/tests/lib/assert.sh"

ACTION_DIR="$ROOT_DIR"
PROVIDER_SCRIPT="$ACTION_DIR/dist/openai-provider.js"
PROVIDER_SOURCE="$ACTION_DIR/src/providers/openai.ts"

if [ ! -f "$PROVIDER_SOURCE" ]; then
  echo "FAIL: OpenAI provider should live in TypeScript source"
  exit 1
fi

if [ ! -x "$ACTION_DIR/node_modules/.bin/tsc" ]; then
  npm --prefix "$ACTION_DIR" install --no-audit --no-fund >/dev/null
fi
npm --prefix "$ACTION_DIR" run build >/dev/null

node --check "$PROVIDER_SCRIPT"
echo "PASS: openai provider build parses under node"

if [ -f "$ACTION_DIR/scripts/openai_provider.mjs" ]; then
  echo "FAIL: legacy openai_provider.mjs wrapper should be removed after TS provider migration"
  exit 1
fi
echo "PASS: legacy openai_provider.mjs wrapper is removed"

RUN_REVIEW_PROVIDER_COUNT="$(
  rg -n 'OpenAiProvider|provider.review' "$ACTION_DIR/src/index.ts" \
    | wc -l | tr -d ' '
)"
if [ "$RUN_REVIEW_PROVIDER_COUNT" -lt 2 ]; then
  echo "FAIL: review engine calls the TypeScript OpenAI provider"
  exit 1
fi
echo "PASS: review engine calls the TypeScript OpenAI provider"

PROMPT_FILE="$(mktemp)"
printf 'Return []' > "$PROMPT_FILE"

set +e
OUTPUT="$(OPENAI_API_KEY="" node "$PROVIDER_SCRIPT" "$PROMPT_FILE" 2>&1)"
EXIT_CODE=$?
set -e

rm -f "$PROMPT_FILE"

if [ "$EXIT_CODE" -eq 0 ]; then
  echo "FAIL: openai provider fails fast without api key"
  exit 1
fi

if printf '%s\n' "$OUTPUT" | grep -q 'OPENAI_API_KEY is required'; then
  echo "PASS: openai provider fails fast without api key"
else
  echo "FAIL: openai provider emits descriptive missing api key error"
  echo "$OUTPUT"
  exit 1
fi

MOCK_SERVER="$(mktemp).mjs"
cat > "$MOCK_SERVER" <<'NODE'
import http from 'node:http';

const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }

  const payload = JSON.parse(body);
  const result = {
    path: req.url,
    auth: req.headers.authorization,
    model: payload.model,
    responseFormat: payload.response_format?.type ?? '',
  };

  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    choices: [
      {
        message: {
          content: JSON.stringify({
            findings: [
              {
                file: 'src/example.ts',
                line: 7,
                severity: 'high',
                message: `mock:${result.path}:${result.model}:${result.responseFormat}:${result.auth}`,
              },
            ],
          }),
        },
      },
    ],
  }));
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  console.log(address.port);
});
NODE

SERVER_LOG="$(mktemp)"
node "$MOCK_SERVER" > "$SERVER_LOG" &
SERVER_PID=$!
for _ in $(seq 1 50); do
  if [ -s "$SERVER_LOG" ]; then
    break
  fi
  sleep 0.1
done
PORT="$(cat "$SERVER_LOG")"

PROMPT_FILE="$(mktemp)"
printf 'Return one finding' > "$PROMPT_FILE"

OPENAI_RESULT="$(
  OPENAI_API_KEY="test-key" \
  OPENAI_BASE_URL="http://127.0.0.1:${PORT}/v1" \
  OPENAI_MODEL="example-model" \
  OPENAI_RESPONSE_FORMAT="json_object" \
  node "$PROVIDER_SCRIPT" "$PROMPT_FILE"
)"

kill "$SERVER_PID" >/dev/null 2>&1 || true
wait "$SERVER_PID" 2>/dev/null || true
rm -f "$MOCK_SERVER" "$SERVER_LOG" "$PROMPT_FILE"

RESULT_LENGTH="$(printf '%s\n' "$OPENAI_RESULT" | jq 'length')"
assert_eq "1" "$RESULT_LENGTH" "openai provider normalizes compatible chat completion response"

RESULT_MESSAGE="$(printf '%s\n' "$OPENAI_RESULT" | jq -r '.[0].message')"
assert_eq "mock:/v1/chat/completions:example-model:json_object:Bearer test-key" "$RESULT_MESSAGE" "openai provider supports custom base URL and bearer key"

MOCK_SERVER="$(mktemp).mjs"
cat > "$MOCK_SERVER" <<'NODE'
import http from 'node:http';

const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }

  const payload = JSON.parse(body);
  const promptText = payload.input?.[1]?.content?.[0]?.text ?? '';
  const reasoningEffort = payload.reasoning?.effort ?? '';

  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    output: [
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: JSON.stringify({
              findings: [
                {
                  file: 'src/responses.ts',
                  line: 9,
                  severity: 'medium',
                  message: `responses:${req.url}:${payload.model}:${payload.text?.format?.type}:${reasoningEffort}:${promptText}`,
                },
              ],
            }),
          },
        ],
      },
    ],
  }));
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  console.log(address.port);
});
NODE

SERVER_LOG="$(mktemp)"
node "$MOCK_SERVER" > "$SERVER_LOG" &
SERVER_PID=$!
for _ in $(seq 1 50); do
  if [ -s "$SERVER_LOG" ]; then
    break
  fi
  sleep 0.1
done
PORT="$(cat "$SERVER_LOG")"

PROMPT_FILE="$(mktemp)"
printf 'responses prompt' > "$PROMPT_FILE"

RESPONSES_RESULT="$(
  OPENAI_API_KEY="test-key" \
  OPENAI_BASE_URL="http://127.0.0.1:${PORT}" \
  OPENAI_MODEL="example-responses-model" \
  OPENAI_API_PATH="/v1/responses" \
  OPENAI_RESPONSE_FORMAT="json_schema" \
  OPENAI_REASONING_EFFORT="high" \
  node "$PROVIDER_SCRIPT" "$PROMPT_FILE"
)"

kill "$SERVER_PID" >/dev/null 2>&1 || true
wait "$SERVER_PID" 2>/dev/null || true
rm -f "$MOCK_SERVER" "$SERVER_LOG" "$PROMPT_FILE"

RESPONSES_MESSAGE="$(printf '%s\n' "$RESPONSES_RESULT" | jq -r '.[0].message')"
assert_eq "responses:/v1/responses:example-responses-model:json_schema:high:responses prompt" "$RESPONSES_MESSAGE" "openai provider supports Responses-compatible endpoint mode"
