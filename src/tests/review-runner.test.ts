import assert from 'node:assert/strict';

import { defaultReviewConfig } from '../config/loadConfig.js';
import type { PullRequestReviewComment } from '../github/comments.js';
import type { PullRequestInfo } from '../github/pr.js';
import { runReview } from '../reviewRunner.js';

const basePrInfo: PullRequestInfo = {
  headSha: 'head-sha',
  headRef: 'feature',
  baseSha: 'base-sha',
  baseRef: 'main',
  title: 'Runner test',
  body: '修复价格展示逻辑',
  isDraft: false,
  changedFiles: 1,
};

const diff = `diff --git a/src/example.ts b/src/example.ts
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,1 +1,2 @@
 const before = 1;
+const value = data.items[0];
`;

const apiDiff = `diff --git a/src/api/token.ts b/src/api/token.ts
--- a/src/api/token.ts
+++ b/src/api/token.ts
@@ -1,1 +1,2 @@
 const before = 1;
+const token = "abc123";
`;

const workflowDiff = `diff --git a/.github/workflows/ai-review.yml b/.github/workflows/ai-review.yml
--- a/.github/workflows/ai-review.yml
+++ b/.github/workflows/ai-review.yml
@@ -1,3 +1,5 @@
 name: AI Review
+permissions:
+  contents: write
 jobs:
   review:
`;

{
  const outputs: Record<string, string> = {};
  const result = await runReview({
    env: {
      PR_NUMBER: '42',
      SKIP_DRAFT: 'true',
      GITHUB_OUTPUT: '',
    },
    actionRoot: '/tmp/action',
    config: defaultReviewConfig,
    github: fakeGithub({ ...basePrInfo, isDraft: true }, [], [], ['src/example.ts']),
    git: fakeGit({ diffByFile: { 'src/example.ts': diff } }),
    provider: async () => [],
    writeOutput: (name, value) => {
      outputs[name] = value;
    },
    logger: () => undefined,
  });

  assert.equal(result.status, 'skipped-draft');
  assert.equal(outputs.files_reviewed, '0');
  assert.equal(outputs.summary, 'Skipped draft PR review');
}

{
  const outputs: Record<string, string> = {};
  const result = await runReview({
    env: {
      PR_NUMBER: '42',
      GITHUB_OUTPUT: '',
    },
    actionRoot: '/tmp/action',
    config: defaultReviewConfig,
    github: fakeGithub(basePrInfo, [], [], ['README.md']),
    git: fakeGit({ diffByFile: {} }),
    provider: async () => {
      throw new Error('provider should not be called');
    },
    writeOutput: (name, value) => {
      outputs[name] = value;
    },
    logger: () => undefined,
  });

  assert.equal(result.status, 'no-files');
  assert.equal(outputs.summary, 'Reviewed 0 files, found 0 issues (0 critical, 0 high)');
}

{
  const calls: string[] = [];
  const logs: string[] = [];
  const outputs: Record<string, string> = {};
  const diffCalls: Array<{ baseSha: string; headSha: string; file: string }> = [];
  const result = await runReview({
    env: {
      PR_NUMBER: '42',
      DRY_RUN: 'true',
      AI_PROVIDER: 'openai',
      INLINE_SEVERITY_THRESHOLD: 'high',
      INLINE_PER_FILE_LIMIT: '2',
      INLINE_PR_LIMIT: '8',
      GITHUB_OUTPUT: '',
    },
    actionRoot: '/tmp/action',
    config: defaultReviewConfig,
    github: fakeGithub(basePrInfo, calls, [], ['src/example.ts']),
    git: fakeGit({ diffByFile: { 'src/example.ts': diff }, diffCalls }),
    provider: async () => [
      {
        file: 'src/example.ts',
        line: 2,
        severity: 'high',
        message: '数组访问未做空值检查',
        suggestion: 'const value = data.items?.[0];',
      },
    ],
    writeOutput: (name, value) => {
      outputs[name] = value;
    },
    logger: (message) => logs.push(message),
  });

  assert.equal(result.status, 'reviewed');
  assert.equal(outputs.files_reviewed, '1');
  assert.equal(outputs.issues_found, '1');
  assert.equal(outputs.high_count, '1');
  assert.deepEqual(calls, [
    'listPullRequestChangedFiles',
    'listReviewComments',
    'listIssueComments',
    'listPullRequestCommitMessages',
  ]);
  assert.deepEqual(diffCalls, [{ baseSha: 'base-sha', headSha: 'head-sha', file: 'src/example.ts' }]);
  assert.match(logs.join('\n'), /provider=openai/);
  assert.match(logs.join('\n'), /processed files=1 skipped=0/);
  assert.match(logs.join('\n'), /dry_run=true, skipped summary and inline review writes/);
}

{
  await assert.rejects(
    () =>
      runReview({
        env: {
          PR_NUMBER: '42',
          GITHUB_OUTPUT: '',
        },
        actionRoot: '/tmp/action',
        config: defaultReviewConfig,
        github: fakeGithub(basePrInfo, [], [], ['src/example.ts']),
        git: fakeGit({ diffByFile: { 'src/example.ts': diff } }),
        provider: async () => {
          throw new Error('provider failed');
        },
        writeOutput: () => undefined,
        logger: () => undefined,
      }),
    /provider failed/,
  );
}

{
  const calls: string[] = [];
  const logs: string[] = [];
  const prompts: string[] = [];
  const outputs: Record<string, string> = {};
  const config = {
    ...defaultReviewConfig,
    behavior: {
      ...defaultReviewConfig.behavior,
      batchSize: 1,
      contextLines: 2,
    },
    strategy: {
      ...defaultReviewConfig.strategy,
      pathPolicies: [
        {
          glob: 'src/api/**',
          reviewMode: 'security',
          reviewerFocus: '重点关注 token 泄露',
          reviewRules: {
            security: ['token 不应硬编码'],
          },
        },
      ],
    },
  };
  const result = await runReview({
    env: {
      PR_NUMBER: '42',
      FILE_TYPES: '.ts',
      EXCLUDE_PATTERNS: '\\.test\\.',
      INLINE_SEVERITY_THRESHOLD: 'medium',
      INLINE_PER_FILE_LIMIT: '1',
      INLINE_PR_LIMIT: '1',
      GITHUB_OUTPUT: '',
    },
    actionRoot: '/tmp/action',
    config,
    github: fakeGithub(
      basePrInfo,
      calls,
      [
        {
          id: 1,
          path: 'src/old.ts',
          line: 2,
          body: '🟠 **[high]** old\n<!-- ai-pr-review:stable-fingerprint=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -->',
        },
      ],
      ['src/api/token.ts', 'src/example.ts', 'src/example.test.ts'],
      [
        'fix(price): handle empty price list',
        `debug token ${'ghp_'}${'1234567890abcdefghijklmnopqrstuvwxyz'}`,
      ],
    ),
    git: fakeGit({
      diffByFile: {
        'src/api/token.ts': apiDiff,
        'src/example.ts': diff,
      },
      contextByFile: {
        'src/api/token.ts': '<file_context file="src/api/token.ts">secret = "xyz"</file_context>',
      },
    }),
    provider: async (prompt) => {
      prompts.push(prompt);
      return [
        {
          file: prompt.includes('src/api/token.ts') ? 'src/api/token.ts' : 'src/example.ts',
          line: 2,
          severity: 'high',
          message: '问题',
        },
      ];
    },
    writeOutput: (name, value) => {
      outputs[name] = value;
    },
    logger: (message) => logs.push(message),
  });

  assert.equal(result.status, 'reviewed');
  assert.equal(prompts.length, 2);
  assert.match(prompts[0] ?? '', /\[file_strategy\] review_mode=security/);
  assert.match(prompts[0] ?? '', /PR 描述：修复价格展示逻辑/);
  assert.match(prompts[0] ?? '', /fix\(price\): handle empty price list/);
  assert.match(prompts[0] ?? '', /\[file_focus\] 重点关注 token 泄露/);
  assert.match(prompts[0] ?? '', /token 不应硬编码/);
  assert.match(prompts[0] ?? '', /\[REDACTED_SECRET\]/);
  assert.equal(outputs.files_reviewed, '2');
  assert.equal(outputs.issues_found, '2');
  assert.equal(outputs.redacted_matches, '3');
  assert.match(calls.join(','), /listReviewComments,listIssueComments,listPullRequestCommitMessages/);
  assert.match(calls.join(','), /createSummaryComment,submitInlineReview/);
  assert.match(logs.join('\n'), /summary created/);
  assert.match(logs.join('\n'), /inline review submitted/);
}

{
  const prompts: string[] = [];
  const config = {
    ...defaultReviewConfig,
    scope: {
      ...defaultReviewConfig.scope,
      fileTypes: ['.yml'],
    },
  };
  await runReview({
    env: {
      PR_NUMBER: '42',
      DRY_RUN: 'true',
      GITHUB_OUTPUT: '',
    },
    actionRoot: '/tmp/action',
    config,
    github: fakeGithub(basePrInfo, [], [], ['.github/workflows/ai-review.yml']),
    git: fakeGit({
      diffByFile: {
        '.github/workflows/ai-review.yml': workflowDiff,
      },
    }),
    provider: async (prompt) => {
      prompts.push(prompt);
      return [];
    },
    writeOutput: () => undefined,
    logger: () => undefined,
  });

  assert.equal(prompts.length, 1);
  assert.match(prompts[0] ?? '', /\[file_strategy\] review_mode=security/);
  assert.match(prompts[0] ?? '', /重点关注 GitHub Actions/);
  assert.match(prompts[0] ?? '', /permissions 必须最小化/);
  assert.match(prompts[0] ?? '', /YAML 缩进/);
}

{
  const calls: string[] = [];
  const logs: string[] = [];
  const outputs: Record<string, string> = {};
  const submittedComments: Array<{ path: string; line: number; side: 'RIGHT'; body: string }> = [];
  let filterPrompt = '';
  await runReview({
    env: {
      PR_NUMBER: '42',
      REVIEW_FILTER_ENABLED: 'true',
      FILE_TYPES: '.ts',
      INLINE_SEVERITY_THRESHOLD: 'high',
      INLINE_PER_FILE_LIMIT: '2',
      INLINE_PR_LIMIT: '8',
      GITHUB_OUTPUT: '',
    },
    actionRoot: '/tmp/action',
    config: defaultReviewConfig,
    github: fakeGithub(basePrInfo, calls, [], ['src/example.ts'], [], submittedComments),
    git: fakeGit({ diffByFile: { 'src/example.ts': diff } }),
    provider: async () => [
      {
        file: 'src/example.ts',
        line: 2,
        severity: 'high',
        message: '数组访问未做空值检查',
      },
    ],
    filterProvider: async (prompt) => {
      filterPrompt = prompt;
      return [{ index: 0, keep: false, reason: 'diff 直接反证' }];
    },
    writeOutput: (name, value) => {
      outputs[name] = value;
    },
    logger: (message) => logs.push(message),
  });

  assert.equal(outputs.issues_found, '1');
  assert.equal(submittedComments.length, 0);
  assert.match(filterPrompt, /数组访问未做空值检查/);
  assert.match(logs.join('\n'), /review filter completed filtered=1 kept=0/);
  assert.match(logs.join('\n'), /inline review submitted.*comments=0/);
}

{
  const logs: string[] = [];
  const submittedComments: Array<{ path: string; line: number; side: 'RIGHT'; body: string }> = [];
  await runReview({
    env: {
      PR_NUMBER: '42',
      REVIEW_FILTER_ENABLED: 'true',
      FILE_TYPES: '.ts',
      INLINE_SEVERITY_THRESHOLD: 'high',
      GITHUB_OUTPUT: '',
    },
    actionRoot: '/tmp/action',
    config: defaultReviewConfig,
    github: fakeGithub(basePrInfo, [], [], ['src/example.ts'], [], submittedComments),
    git: fakeGit({ diffByFile: { 'src/example.ts': diff } }),
    provider: async () => [
      {
        file: 'src/example.ts',
        line: 2,
        severity: 'high',
        message: '数组访问未做空值检查',
      },
    ],
    filterProvider: async () => {
      throw new Error('filter unavailable');
    },
    writeOutput: () => undefined,
    logger: (message) => logs.push(message),
  });

  assert.equal(submittedComments.length, 1);
  assert.match(logs.join('\n'), /review filter failed open: filter unavailable/);
  assert.match(logs.join('\n'), /review filter completed filtered=0 kept=1/);
}

{
  const calls: string[] = [];
  const outputs: Record<string, string> = {};
  await runReview({
    env: {
      PR_NUMBER: '42',
      DRY_RUN: 'true',
      FILE_TYPES: '.ts',
      GITHUB_OUTPUT: '',
    },
    actionRoot: '/tmp/action',
    config: defaultReviewConfig,
    github: fakeGithub(basePrInfo, calls, [], ['src/from-api.ts']),
    git: fakeGit({
      diffByFile: {
        'src/from-api.ts': diff.replaceAll('src/example.ts', 'src/from-api.ts'),
      },
    }),
    provider: async () => [],
    writeOutput: (name, value) => {
      outputs[name] = value;
    },
    logger: () => undefined,
  });

  assert.equal(outputs.files_reviewed, '1');
  assert.ok(calls.includes('listPullRequestChangedFiles'));
}

console.log('PASS: TypeScript review runner covers draft, no-files, dry-run, and provider failure behavior');

function fakeGithub(
  prInfo: PullRequestInfo,
  calls: string[] = [],
  reviewComments: PullRequestReviewComment[] = [],
  changedFiles: string[] = [],
  commitMessages: string[] = [],
  submittedComments: Array<{ path: string; line: number; side: 'RIGHT'; body: string }> = [],
) {
  return {
    fetchPullRequestInfo: async () => prInfo,
    listPullRequestChangedFiles: async () => {
      calls.push('listPullRequestChangedFiles');
      return changedFiles;
    },
    listPullRequestCommitMessages: async () => {
      calls.push('listPullRequestCommitMessages');
      return commitMessages;
    },
    listReviewComments: async () => {
      calls.push('listReviewComments');
      return reviewComments;
    },
    listIssueComments: async () => {
      calls.push('listIssueComments');
      return [];
    },
    updateSummaryComment: async () => {
      calls.push('updateSummaryComment');
    },
    createSummaryComment: async () => {
      calls.push('createSummaryComment');
    },
    submitInlineReview: async (options: { comments: Array<{ path: string; line: number; side: 'RIGHT'; body: string }> }) => {
      calls.push('submitInlineReview');
      submittedComments.push(...options.comments);
      return { mode: 'pending-review', submittedComments: options.comments.length };
    },
  };
}

function fakeGit(options: {
  diffByFile: Record<string, string>;
  contextByFile?: Record<string, string>;
  diffCalls?: Array<{ baseSha: string; headSha: string; file: string }>;
}) {
  return {
    fetchAll: async () => undefined,
    mergeBase: async () => {
      throw new Error('runner should use PR baseSha instead of deriving a merge base from base ref');
    },
    diffForFile: async (baseSha: string, headSha: string, file: string) => {
      options.diffCalls?.push({ baseSha, headSha, file });
      return options.diffByFile[file] ?? '';
    },
    contextForFile: async (file: string, _diffContent: string, _contextLines: number) => options.contextByFile?.[file] ?? '',
  };
}
