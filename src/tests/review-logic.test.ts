import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { loadReviewConfig, mergeReviewConfig, toShellConfig } from '../config/loadConfig.js';
import {
  pathMatchesGlob,
  policyReviewRulesMarkdown,
  resolvePathPolicy,
} from '../config/pathPolicies.js';
import {
  collectReviewableLineAnchors,
  collectReviewableLines,
  filterFindingsToReviewableLines,
} from '../diff/reviewableLines.js';
import {
  buildExistingStableFingerprints,
  buildFindingFingerprint,
  buildStableFindingFingerprint,
  extractCommentMarkers,
  lookupReviewableAnchor,
  lookupReviewableAnchorOccurrence,
} from '../findings/fingerprint.js';
import { shouldPostInlineWithBudget } from '../findings/severity.js';
import { buildInlineCommentBody, getSeverityEmoji } from '../output/inlineReview.js';
import { buildReviewVerdict, buildSummaryCommentBody, findSummaryCommentId } from '../output/summary.js';
import { countSensitiveMatches, redactSensitiveContent } from '../prompt/redaction.js';

const actionRoot = resolve(new URL('.', import.meta.url).pathname, '../..');

const multiHunkDiff = await readFile(resolve(actionRoot, 'tests/fixtures/diff/multi-hunk.diff'), 'utf8');
const existingIssueComments = JSON.parse(
  await readFile(resolve(actionRoot, 'tests/fixtures/api/existing-issue-comments.json'), 'utf8'),
);
const existingReviewComments = JSON.parse(
  await readFile(resolve(actionRoot, 'tests/fixtures/api/existing-review-comments.json'), 'utf8'),
);
const existingLegacyReviewComments = JSON.parse(
  await readFile(resolve(actionRoot, 'tests/fixtures/api/existing-review-comments-legacy.json'), 'utf8'),
);
const withContextDiff = await readFile(resolve(actionRoot, 'tests/fixtures/diff/with-context.diff'), 'utf8');
const repeatedAnchorDiff = await readFile(resolve(actionRoot, 'tests/fixtures/diff/repeated-anchor.diff'), 'utf8');

assert.deepEqual(collectReviewableLines(multiHunkDiff), [
  'src/example.ts:10',
  'src/example.ts:11',
  'src/example.ts:26',
]);

assert.equal(pathMatchesGlob('.github/workflows/ai-review.yml', '.github/workflows/**/*.yml'), true);
assert.equal(pathMatchesGlob('.github/workflows/nested/ai-review.yaml', '.github/workflows/**/*.yaml'), true);
assert.equal(pathMatchesGlob('src/package.json', '**/package.json'), true);
assert.equal(pathMatchesGlob('package.json', '**/package.json'), true);
assert.equal(pathMatchesGlob('src/config/app.json', '**/*.json'), true);

const workflowPolicy = resolvePathPolicy('.github/workflows/ai-review.yml', []);
assert.equal(workflowPolicy.reviewMode, 'security');
assert.match(workflowPolicy.reviewerFocus ?? '', /GitHub Actions/);
assert.match(policyReviewRulesMarkdown(workflowPolicy.reviewRules), /permissions 必须最小化/);
assert.match(policyReviewRulesMarkdown(workflowPolicy.reviewRules), /YAML 缩进/);

const packagePolicy = resolvePathPolicy('packages/web/package.json', []);
assert.match(packagePolicy.reviewerFocus ?? '', /npm 脚本/);
assert.match(policyReviewRulesMarkdown(packagePolicy.reviewRules), /dependencies\/devDependencies/);

const customWorkflowPolicy = resolvePathPolicy('.github/workflows/ai-review.yml', [
  {
    glob: '.github/workflows/**',
    reviewerFocus: '只关注内部 reusable workflow 契约',
    reviewRules: {
      security: ['内部 workflow 禁止新增未知 third-party action'],
    },
  },
]);
const customWorkflowRules = policyReviewRulesMarkdown(customWorkflowPolicy.reviewRules);
assert.equal(customWorkflowPolicy.reviewMode, 'security');
assert.equal(customWorkflowPolicy.reviewerFocus, '只关注内部 reusable workflow 契约');
assert.match(customWorkflowRules, /permissions 必须最小化/);
assert.match(customWorkflowRules, /内部 workflow 禁止新增未知 third-party action/);

assert.deepEqual(collectReviewableLineAnchors(multiHunkDiff).map((entry) => entry.anchor), [
  'const result = x + y;',
  'const shouldLog = false;',
  '// TODO: add locale support',
]);

assert.deepEqual(
  filterFindingsToReviewableLines(
    [
      { file: 'src/example.ts', line: 10, message: 'kept' },
      { file: 'src/example.ts', line: 12, message: 'dropped' },
      { file: 'src/example.ts', message: 'missing line' },
    ],
    ['src/example.ts:10'],
  ),
  [{ file: 'src/example.ts', line: 10, message: 'kept' }],
);

const sensitive = 'token = "abc123"\nconst github = "ghp_secretToken"';
assert.equal(countSensitiveMatches(sensitive), 2);
assert.equal(
  redactSensitiveContent(sensitive),
  'token = "[REDACTED_SECRET]"\nconst github = "[REDACTED_GITHUB_TOKEN]"',
);

const fakeGitHubToken = `ghp_${'1234567890abcdefghijklmnopqrstuvwxyz'}`;
const rawSecretDiff = `diff --git a/src/secure.ts b/src/secure.ts
index 0000000..1111111 100644
--- a/src/secure.ts
+++ b/src/secure.ts
@@ -0,0 +1,1 @@
+const token = "${fakeGitHubToken}";`;
const rawSecretAnchors = collectReviewableLineAnchors(rawSecretDiff);
const redactedSecretAnchors = collectReviewableLineAnchors(redactSensitiveContent(rawSecretDiff));
assert.notEqual(
  lookupReviewableAnchor('src/secure.ts:1', rawSecretAnchors),
  lookupReviewableAnchor('src/secure.ts:1', redactedSecretAnchors),
);

assert.equal(shouldPostInlineWithBudget('high', 'high', 1, 7, 2, 8), true);
assert.equal(shouldPostInlineWithBudget('medium', 'high', 0, 0, 2, 8), false);
assert.equal(shouldPostInlineWithBudget('critical', 'high', 2, 0, 2, 8), false);
assert.equal(shouldPostInlineWithBudget('critical', 'high', 1, 8, 2, 8), false);

const fingerprintA = buildFindingFingerprint(
  'src/a.ts',
  42,
  'high',
  'null-check-missing',
  'const value = data[0]',
);
const fingerprintB = buildFindingFingerprint(
  'src/a.ts',
  99,
  'high',
  'null-check-missing',
  'const value = data[0]',
);
assert.equal(fingerprintA, fingerprintB);

assert.deepEqual(
  extractCommentMarkers(existingReviewComments.map((comment: { body?: string }) => comment.body ?? '').join('\n'), 'fingerprint'),
  [
    '1111111111111111111111111111111111111111111111111111111111111111',
    '2222222222222222222222222222222222222222222222222222222222222222',
  ],
);

const withContextAnchors = collectReviewableLineAnchors(withContextDiff);
assert.deepEqual(
  buildExistingStableFingerprints(existingLegacyReviewComments, withContextAnchors),
  [
    buildStableFindingFingerprint(
      'src/with-context.ts',
      'high',
      'general',
      'const cacheKey = `data:${id}`;',
      1,
    ),
  ],
);

const repeatedAnchors = collectReviewableLineAnchors(repeatedAnchorDiff);
const firstOccurrence = lookupReviewableAnchorOccurrence(
  'src/repeated.ts:2',
  'const cacheKey = buildCacheKey(id);',
  repeatedAnchors,
);
const secondOccurrence = lookupReviewableAnchorOccurrence(
  'src/repeated.ts:10',
  'const cacheKey = buildCacheKey(id);',
  repeatedAnchors,
);
assert.equal(firstOccurrence, 1);
assert.equal(secondOccurrence, 2);

assert.equal(buildReviewVerdict(1, 0, 0), 'Blocking');
assert.equal(buildReviewVerdict(0, 1, 0), 'Needs Attention');
assert.equal(buildReviewVerdict(0, 0, 0), 'LGTM');
assert.equal(findSummaryCommentId(existingIssueComments), 1203);
const summaryBody = buildSummaryCommentBody({
  verdict: 'Needs Attention',
  newFindings: 2,
  existingFindings: 3,
  resolvedFindings: 1,
  filesReviewed: 4,
  filesSkipped: 0,
  fixFirst: '- src/a.ts\n- src/b.ts',
  activeFindings: '- **src/a.ts:18** — token 空值检查缺失',
  otherFindings: '- **src/c.ts:18** — 低优先级补充',
  otherFindingsCount: 1,
});
assert.match(summaryBody, /<!-- ai-pr-review:summary -->/);
assert.match(summaryBody, /Verdict \| Needs Attention/);
assert.match(summaryBody, /### Active Findings/);
assert.match(summaryBody, /<summary>Other Findings \(1\)<\/summary>/);

assert.equal(getSeverityEmoji('critical'), '🔴');
assert.match(
  buildInlineCommentBody({
    severity: 'high',
    message: '数组访问未做空值检查',
    suggestion: 'const value = data?.[0];',
    stableFingerprint: 'a'.repeat(64),
    fingerprint: 'b'.repeat(64),
  }),
  /Suggested fix, review before applying:\n\n```\nconst value = data\?\.\[0\];\n```/,
);
const multilineSuggestionBody = buildInlineCommentBody({
  severity: 'high',
  message: '多行修复只能作为参考，不能一键采纳',
  suggestion: `if (!value) {
  return null;
}`,
  stableFingerprint: 'c'.repeat(64),
  fingerprint: 'd'.repeat(64),
});
assert.match(multilineSuggestionBody, /Suggested fix, review before applying:/);
assert.match(multilineSuggestionBody, /```\nif \(!value\) \{/);
assert.doesNotMatch(multilineSuggestionBody, /```suggestion/);

const frontendConfig = await loadReviewConfig({
  preset: 'frontend',
  presetDir: resolve(actionRoot, 'presets'),
});
assert.equal(frontendConfig.behavior.batchSize, 5);
assert.equal(frontendConfig.scope.fileTypes.join('|'), '.ts|.tsx|.js|.jsx|.vue');
assert.deepEqual(frontendConfig.strategy.pathPolicies, []);
assert.match(toShellConfig(frontendConfig).CRASH_CHECKS, /^- 空值、数组越界/m);

const mergedConfig = await loadReviewConfig({
  preset: 'frontend',
  presetDir: resolve(actionRoot, 'presets'),
  configFile: resolve(actionRoot, 'examples/custom-config.json'),
});
assert.equal(mergedConfig.behavior.maxDiffLines, 400);
assert.equal(mergedConfig.strategy.reviewMode, 'full');
assert.equal(mergedConfig.strategy.inlineSeverityThreshold, 'medium');
assert.equal(mergedConfig.scope.fileTypes.join('|'), '.ts|.tsx|.js|.jsx');
assert.match(mergedConfig.reviewer.role, /全栈工程师/);
assert.match(mergedConfig.reviewer.focus, /API 调用安全性/);

const legacyConfig = mergeReviewConfig(frontendConfig, {
  reviewRules: {
    universal: {
      crashPrevention: ['通用规则'],
    },
    frontend: {
      crashPrevention: ['前端规则'],
    },
  },
});
assert.deepEqual(legacyConfig.reviewRules.crashPrevention, ['通用规则', '前端规则']);

console.log('PASS: TypeScript review logic modules match Bash helper behavior fixtures');
