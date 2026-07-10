import assert from 'node:assert/strict';

import { parseGeminiCliFindings } from '../providers/geminiCli.js';
import { parseFindings, parseReviewFilterDecisions } from '../providers/openai.js';

const noisyGeminiOutput = `Gemini CLI starting review...

\`\`\`json
{
  "findings": [
    {
      "file": "src/example.ts",
      "line": 7,
      "severity": "high",
      "message": "数组访问缺少空值保护"
    }
  ]
}
\`\`\`

Review complete.`;

assert.deepEqual(parseGeminiCliFindings(noisyGeminiOutput), [
  {
    file: 'src/example.ts',
    line: 7,
    severity: 'high',
    message: '数组访问缺少空值保护',
  },
]);
assert.deepEqual(parseFindings('{"issues":[]}'), []);
assert.deepEqual(parseFindings('{"comments":[]}'), []);
assert.deepEqual(parseFindings('{"review":{"issues":[]}}'), []);
assert.deepEqual(parseFindings('{"review_comments":[]}'), []);
assert.deepEqual(parseFindings('{"result":"{\\"findings\\":[]}"}'), []);
assert.deepEqual(parseFindings('{}'), []);
assert.deepEqual(parseFindings('{"summary":"未发现需要评论的问题"}'), []);
assert.deepEqual(parseFindings('{"message":"没有发现需要评论的问题"}'), []);
assert.deepEqual(parseFindings('{"verdict":"no_issues"}'), []);
assert.deepEqual(parseFindings('{"has_issues":false}'), []);
assert.deepEqual(
  parseFindings('[{"file":"src/example.ts","line":7,"severity":"high","message":"bad","existing_code":"const value = data.items[0];","suggestion":"const value = data.items?.[0];"}]'),
  [
    {
      file: 'src/example.ts',
      line: 7,
      severity: 'high',
      message: 'bad',
      existing_code: 'const value = data.items[0];',
      suggestion: 'const value = data.items?.[0];',
    },
  ],
);
assert.deepEqual(parseReviewFilterDecisions('{"decisions":[{"index":0,"keep":false,"reason":"diff disproves it"},{"index":1,"keep":true}]}'), [
  { index: 0, keep: false, reason: 'diff disproves it' },
  { index: 1, keep: true },
]);
assert.deepEqual(parseReviewFilterDecisions('{"review":{"filter_results":[{"index":2,"keep":true}]}}'), [
  { index: 2, keep: true },
]);
assert.throws(
  () => parseReviewFilterDecisions('[{"index":0,"keep":"yes"}]'),
  /keep must be boolean/,
);

assert.throws(
  () => parseFindings('[{"file":"src/example.ts","line":7,"severity":"urgent","message":"bad"}]'),
  /invalid severity/,
);
assert.throws(
  () => parseFindings('[{"file":"src/example.ts","severity":"high","message":"missing line"}]'),
  /line must be a positive integer/,
);
assert.throws(
  () => parseFindings('[{"line":7,"severity":"high","message":"missing file"}]'),
  /file must be a non-empty string/,
);
assert.throws(
  () => parseFindings('[{"file":"src/example.ts","line":7,"severity":"high"}]'),
  /message must be a non-empty string/,
);

console.log('PASS: Provider parsing extracts and validates structured findings');
