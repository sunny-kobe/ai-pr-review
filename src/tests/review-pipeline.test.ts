import assert from 'node:assert/strict';

import { defaultReviewConfig } from '../config/loadConfig.js';
import { collectReviewableLineAnchors, collectReviewableLines } from '../diff/reviewableLines.js';
import { processFindingsForReview, relocateFindingsToReviewableLines } from '../findings/processFindings.js';
import {
  buildReviewFilterPrompt,
  filterInlineReviewComments,
  normalizeFilterDecisions,
} from '../findings/reviewFilter.js';
import { buildBatchPrompt, buildBasePrompt } from '../prompt/buildPrompt.js';

const promptConfig = {
  ...defaultReviewConfig,
  reviewRules: {
    ...defaultReviewConfig.reviewRules,
    crashPrevention: ['API 调用缺少错误处理'],
    security: ['敏感信息泄露'],
    ignore: ['import 顺序'],
  },
};

const basePrompt = buildBasePrompt({
  config: promptConfig,
  language: 'zh-CN',
  prTitle: '修复 token = "abc123"',
});

assert.match(basePrompt, /你是一名高级代码审查专家/);
assert.match(basePrompt, /PR 标题：修复 token = "\[REDACTED_SECRET\]"/);
assert.match(basePrompt, /## 🔒 安全约束/);
assert.match(basePrompt, /API 调用缺少错误处理/);
assert.match(basePrompt, /敏感信息泄露/);
assert.match(basePrompt, /import 顺序/);
assert.match(basePrompt, /所有输出必须使用中文/);
assert.match(basePrompt, /Pixel ID/);
assert.match(basePrompt, /不要建议回滚到旧值/);
assert.match(basePrompt, /输出纯 JSON 对象/);
assert.match(basePrompt, /\{"findings": \[/);
assert.doesNotMatch(basePrompt, /输出纯 JSON 数组/);

const diffContent = `diff --git a/src/example.ts b/src/example.ts
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,2 +1,3 @@
 const before = 1;
+const value = data.items[0];
 return before;
`;

const batchPrompt = buildBatchPrompt({
  basePrompt,
  changedFiles: ['src/example.ts'],
  files: [
    {
      file: 'src/example.ts',
      diffContent,
      context: '<file_context file="src/example.ts">context token = "abc123"</file_context>',
      reviewMode: 'fast',
      reviewerFocus: '重点关注崩溃风险',
      policyRules: 'Security:\n- token 日志泄露',
      projectRules: 'Use UTC +0 for time ranges.',
    },
  ],
});

assert.match(batchPrompt, /\*\*完整 PR 变更文件清单\*\*/);
assert.match(batchPrompt, /\*\*本批可评论文件及 diff\*\*/);
assert.match(batchPrompt, /=== src\/example.ts ===/);
assert.match(batchPrompt, /\[file_strategy\] review_mode=fast/);
assert.match(batchPrompt, /\[file_focus\] 重点关注崩溃风险/);
assert.match(batchPrompt, /\[file_policy_rules\]\nSecurity:/);
assert.match(batchPrompt, /\[file_project_rules\]\nUse UTC \+0 for time ranges/);
assert.match(batchPrompt, /\[REDACTED_SECRET\]/);

const reviewableLines = collectReviewableLines(diffContent);
const reviewableAnchors = collectReviewableLineAnchors(diffContent);
const processed = processFindingsForReview({
  findings: [
    {
      file: 'src/example.ts',
      line: 2,
      severity: 'high',
      category: 'general',
      message: '数组访问未做空值检查',
      suggestion: 'const value = data.items?.[0];',
    },
    {
      file: 'src/example.ts',
      line: 1,
      severity: 'critical',
      message: '不应保留上下文行评论',
    },
    {
      file: 'src/example.ts',
      line: 2,
      severity: 'medium',
      message: '低于阈值但仍计入 summary',
    },
  ],
  reviewableLines,
  reviewableAnchors,
  inlineSeverityThreshold: 'high',
  inlinePerFileLimit: 2,
  inlinePrLimit: 8,
  existingStableFingerprints: [],
});

assert.equal(processed.totalIssues, 2);
assert.equal(processed.highCount, 1);
assert.equal(processed.mediumCount, 1);
assert.equal(processed.newFindingsCount, 2);
assert.equal(processed.duplicateCommentsSuppressed, 0);
assert.equal(processed.reviewComments.length, 1);
assert.equal(processed.reviewComments[0]?.path, 'src/example.ts');
assert.equal(processed.reviewComments[0]?.line, 2);
assert.match(processed.reviewComments[0]?.body ?? '', /Suggested fix, review before applying:/);
assert.doesNotMatch(processed.reviewComments[0]?.body ?? '', /```suggestion/);

const rerun = processFindingsForReview({
  findings: processed.issues,
  reviewableLines,
  reviewableAnchors,
  inlineSeverityThreshold: 'high',
  inlinePerFileLimit: 2,
  inlinePrLimit: 8,
  existingStableFingerprints: processed.currentStableFingerprints,
});

assert.equal(rerun.existingFindingsCount, 2);
assert.equal(rerun.reviewComments.length, 0);
assert.equal(rerun.duplicateCommentsSuppressed, 2);

const relocationDiff = `diff --git a/src/relocate.ts b/src/relocate.ts
--- a/src/relocate.ts
+++ b/src/relocate.ts
@@ -1,1 +1,4 @@
 const before = 1;
+const uniqueRisk = data.items[0];
+const repeatedRisk = data.items[1];
+const repeatedRisk = data.items[1];
`;
const relocationLines = collectReviewableLines(relocationDiff);
const relocationAnchors = collectReviewableLineAnchors(relocationDiff);
const relocatedFindings = relocateFindingsToReviewableLines(
  [
    {
      file: 'src/relocate.ts',
      line: 99,
      severity: 'high',
      message: 'line drift can be relocated',
      existing_code: 'const uniqueRisk = data.items[0];',
    },
    {
      file: 'src/relocate.ts',
      line: 88,
      severity: 'high',
      message: 'ambiguous snippet must not relocate',
      existing_code: 'const repeatedRisk = data.items[1];',
    },
    {
      file: 'src/relocate.ts',
      line: 77,
      severity: 'high',
      message: 'missing snippet must not relocate',
      existing_code: 'const missingRisk = data.items[2];',
    },
  ],
  relocationLines,
  relocationAnchors,
);
assert.deepEqual(relocatedFindings.map((finding) => `${finding.file}:${finding.line}:${finding.message}`), [
  'src/relocate.ts:2:line drift can be relocated',
]);

const relocatedProcessed = processFindingsForReview({
  findings: [
    {
      file: 'src/relocate.ts',
      line: 99,
      severity: 'high',
      message: '数组访问未做空值检查',
      existing_code: 'const uniqueRisk = data.items[0];',
      suggestion: 'const uniqueRisk = data.items?.[0];',
    },
    {
      file: 'src/relocate.ts',
      line: 88,
      severity: 'critical',
      message: '重复片段不应错位行评',
      existing_code: 'const repeatedRisk = data.items[1];',
    },
    {
      file: 'src/relocate.ts',
      line: 77,
      severity: 'critical',
      message: '缺失片段不应错位行评',
      existing_code: 'const missingRisk = data.items[2];',
    },
  ],
  reviewableLines: relocationLines,
  reviewableAnchors: relocationAnchors,
  inlineSeverityThreshold: 'high',
  inlinePerFileLimit: 2,
  inlinePrLimit: 8,
  existingStableFingerprints: [],
});

assert.equal(relocatedProcessed.totalIssues, 1);
assert.equal(relocatedProcessed.highCount, 1);
assert.equal(relocatedProcessed.criticalCount, 0);
assert.equal(relocatedProcessed.newFindingsCount, 1);
assert.equal(relocatedProcessed.duplicateCommentsSuppressed, 0);
assert.equal(relocatedProcessed.reviewComments.length, 1);
assert.equal(relocatedProcessed.reviewComments[0]?.line, 2);
assert.deepEqual(relocatedProcessed.issues.map((issue) => issue.line), [2]);

const relocatedRerun = processFindingsForReview({
  findings: relocatedProcessed.issues,
  reviewableLines: relocationLines,
  reviewableAnchors: relocationAnchors,
  inlineSeverityThreshold: 'high',
  inlinePerFileLimit: 2,
  inlinePrLimit: 8,
  existingStableFingerprints: relocatedProcessed.currentStableFingerprints,
});
assert.equal(relocatedRerun.existingFindingsCount, 1);
assert.equal(relocatedRerun.reviewComments.length, 0);
assert.equal(relocatedRerun.duplicateCommentsSuppressed, 1);

const filterPrompt = buildReviewFilterPrompt(processed.inlineCandidates);
assert.match(filterPrompt, /二次过滤器/);
assert.match(filterPrompt, /只有当 finding 明显评论了错误文件/);
assert.match(filterPrompt, /"index": 0/);
assert.match(filterPrompt, /"changed_code": "const value = data.items\[0\];"/);
assert.match(filterPrompt, /数组访问未做空值检查/);

assert.deepEqual(
  normalizeFilterDecisions([
    { index: 0, keep: false, reason: 'diff 直接反证' },
    { index: 1, keep: true },
    { index: -1, keep: false },
  ]),
  [
    { index: 0, keep: false, reason: 'diff 直接反证' },
    { index: 1, keep: true, reason: undefined },
  ],
);

const filtered = await filterInlineReviewComments({
  candidates: processed.inlineCandidates,
  provider: async () => [{ index: 0, keep: false, reason: 'diff 直接反证' }],
});
assert.equal(filtered.filteredCount, 1);
assert.equal(filtered.comments.length, 0);

const failOpenLogs: string[] = [];
const failOpen = await filterInlineReviewComments({
  candidates: processed.inlineCandidates,
  provider: async () => {
    throw new Error('filter provider failed');
  },
  logger: (message) => failOpenLogs.push(message),
});
assert.equal(failOpen.filteredCount, 0);
assert.equal(failOpen.comments.length, 1);
assert.match(failOpenLogs.join('\n'), /failed open/);

console.log('PASS: TypeScript prompt and findings pipeline modules produce review-ready data');
