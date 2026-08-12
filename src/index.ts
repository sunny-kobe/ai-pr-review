#!/usr/bin/env node

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadReviewConfig, toShellConfig } from './config/loadConfig.js';
import { collectReviewableLineAnchors, collectReviewableLines } from './diff/reviewableLines.js';
import { buildFindingFingerprint } from './findings/fingerprint.js';
import { processFindingsForReview } from './findings/processFindings.js';
import { GitHubClient } from './github/client.js';
import { createSummaryComment } from './github/comments.js';
import { fetchPullRequestInfo } from './github/pr.js';
import { submitInlineReview } from './github/review.js';
import { buildSummaryCommentBody } from './output/summary.js';
import { buildBasePrompt } from './prompt/buildPrompt.js';
import { GeminiCliProvider } from './providers/geminiCli.js';
import {
  completePromptWithOpenAi,
  OpenAiProvider,
  parseReviewFilterDecisions,
  REVIEW_FILTER_SYSTEM_PROMPT,
} from './providers/openai.js';
import type { Finding } from './providers/types.js';
import { runReview } from './reviewRunner.js';
import { ShellGitAdapter } from './utils/git.js';
import { writeGitHubOutput } from './utils/outputs.js';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(`AI PR Review Node engine

Usage:
  node dist/index.js [--help] [--self-test]

The Node engine runs the AI PR Review flow.
`);
  process.exit(0);
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const actionRoot = resolve(currentDir, '..');

if (args.includes('--self-test')) {
  const config = await loadReviewConfig({
    preset: 'frontend',
    presetDir: resolve(actionRoot, 'presets'),
  });
  const shellConfig = toShellConfig(config);
  const diff = `diff --git a/src/example.ts b/src/example.ts
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,1 +1,2 @@
 const before = 1;
+const after = 2;
`;
  const reviewableLines = collectReviewableLines(diff);
  const reviewableAnchors = collectReviewableLineAnchors(diff);
  const prompt = buildBasePrompt({ config, language: 'zh-CN', prTitle: 'self-test' });
  const summary = buildSummaryCommentBody({
    verdict: 'LGTM',
    newFindings: 0,
    existingFindings: 0,
    resolvedFindings: 0,
    filesReviewed: 1,
    filesSkipped: 0,
  });
  const fingerprint = buildFindingFingerprint('src/example.ts', 2, 'high', 'general', 'const after = 2;');
  const processed = processFindingsForReview({
    findings: [
      {
        file: 'src/example.ts',
        line: 2,
        severity: 'high',
        message: 'self-test finding',
      },
    ],
    reviewableLines,
    reviewableAnchors,
    inlineSeverityThreshold: 'high',
    inlinePerFileLimit: 2,
    inlinePrLimit: 8,
    existingStableFingerprints: [],
  });
  const githubClient = new GitHubClient({
    owner: 'example-org',
    repo: 'repo',
    token: 'self-test',
    apiBaseUrl: 'https://api.github.test',
    fetchImpl: async (url, init) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith('/pulls/1')) {
        return jsonResponse({
          head: { sha: 'head-sha', ref: 'feature' },
          base: { sha: 'base-sha', ref: 'main' },
          title: 'Self test',
          body: 'Self test body',
          draft: false,
          changed_files: 1,
        });
      }
      if (requestUrl.endsWith('/issues/1/comments')) {
        return jsonResponse({ id: 1, body: JSON.parse(init?.body?.toString() ?? '{}').body });
      }
      if (requestUrl.endsWith('/pulls/1/reviews')) {
        return new Response(JSON.stringify({ message: 'force fallback' }), { status: 422 });
      }
      if (requestUrl.endsWith('/pulls/1/comments')) {
        return jsonResponse({ id: 2 });
      }
      return new Response(JSON.stringify({ message: `Unhandled self-test URL: ${requestUrl}` }), { status: 404 });
    },
  });
  const prInfo = await fetchPullRequestInfo(githubClient, 1);
  const createdSummary = await createSummaryComment(githubClient, 1, summary);
  const reviewSubmission = await submitInlineReview(githubClient, {
    prNumber: 1,
    commitSha: prInfo.headSha,
    body: '<!-- ai-pr-review:inline-review -->',
    comments: processed.reviewComments,
  });

  if (
    shellConfig.FILE_TYPES.includes('.vue') &&
    reviewableLines[0] === 'src/example.ts:2' &&
    prompt.includes('## 🔒 安全约束') &&
    processed.reviewComments.length === 1 &&
    prInfo.headSha === 'head-sha' &&
    createdSummary.id === 1 &&
    reviewSubmission.mode === 'fallback' &&
    summary.includes('<!-- ai-pr-review:summary -->') &&
    /^[a-f0-9]{64}$/.test(fingerprint)
  ) {
    process.stdout.write('AI PR Review Node engine self-test passed\n');
    process.exit(0);
  }

  console.error('AI PR Review Node engine self-test failed');
  process.exit(1);
}

try {
  const github = buildGithubFacade();
  const provider = buildProvider();
  const filterProvider = buildReviewFilterProvider();
  await runReview({
    env: process.env,
    actionRoot,
    github,
    git: new ShellGitAdapter(),
    provider,
    filterProvider,
    writeOutput: (name, value) => writeGitHubOutput(name, value),
    logger: (message) => console.log(message),
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`AI PR Review failed: ${message}`);
  process.exit(1);
}

function buildGithubFacade() {
  const repository = process.env.GITHUB_REPOSITORY ?? '';
  const [owner, repo] = repository.split('/');
  if (!owner || !repo) {
    throw new Error('GITHUB_REPOSITORY must be set as owner/repo');
  }
  const token = process.env.GITHUB_TOKEN ?? '';
  if (!token) {
    throw new Error('GITHUB_TOKEN is required');
  }
  const client = new GitHubClient({
    owner,
    repo,
    token,
    apiBaseUrl: process.env.GITHUB_API_URL || undefined,
  });

  return {
    fetchPullRequestInfo: (prNumber: number) => fetchPullRequestInfo(client, prNumber),
    listPullRequestFiles: async (prNumber: number) => {
      const { listPullRequestFiles } = await import('./github/pr.js');
      return listPullRequestFiles(client, prNumber);
    },
    listPullRequestCommitMessages: async (prNumber: number) => {
      const { listPullRequestCommitMessages } = await import('./github/pr.js');
      return listPullRequestCommitMessages(client, prNumber);
    },
    listReviewComments: async (prNumber: number) => {
      const { listReviewComments } = await import('./github/comments.js');
      return listReviewComments(client, prNumber);
    },
    listIssueComments: async (prNumber: number) => {
      const { listIssueComments } = await import('./github/comments.js');
      return listIssueComments(client, prNumber);
    },
    updateSummaryComment: async (commentId: number, body: string) => {
      const { updateSummaryComment } = await import('./github/comments.js');
      return updateSummaryComment(client, commentId, body);
    },
    createSummaryComment: async (prNumber: number, body: string) => {
      const { createSummaryComment } = await import('./github/comments.js');
      return createSummaryComment(client, prNumber, body);
    },
    submitInlineReview: (options: {
      prNumber: number;
      commitSha: string;
      body: string;
      comments: Array<{ path: string; line: number; side: 'RIGHT'; body: string }>;
    }) => submitInlineReview(client, options),
  };
}

function buildProvider(): (prompt: string) => Promise<Finding[]> {
  const providerName = process.env.AI_PROVIDER || 'openai';
  if (providerName === 'openai') {
    const provider = new OpenAiProvider();
    return (prompt) => provider.review(prompt, {
      apiKey: process.env.OPENAI_API_KEY || '',
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
      apiPath: process.env.OPENAI_API_PATH || '/v1/chat/completions',
      model: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
      responseFormat: process.env.OPENAI_RESPONSE_FORMAT || '',
      reasoningEffort: process.env.OPENAI_REASONING_EFFORT || '',
    });
  }

  if (providerName === 'gemini-cli') {
    const provider = new GeminiCliProvider();
    return (prompt) => provider.review(prompt, {});
  }

  throw new Error(`unsupported AI_PROVIDER '${providerName}' (expected openai or gemini-cli)`);
}

function buildReviewFilterProvider() {
  const providerName = process.env.AI_PROVIDER || 'openai';
  if (providerName === 'openai') {
    return async (prompt: string) => parseReviewFilterDecisions(
      await completePromptWithOpenAi(prompt, {
        apiKey: process.env.OPENAI_API_KEY || '',
        baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
        apiPath: process.env.OPENAI_API_PATH || '/v1/chat/completions',
        model: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
        responseFormat: process.env.OPENAI_RESPONSE_FORMAT || '',
        reasoningEffort: process.env.OPENAI_REASONING_EFFORT || '',
      }, REVIEW_FILTER_SYSTEM_PROMPT, 'review_filter'),
    );
  }

  if (providerName === 'gemini-cli') {
    return undefined;
  }

  return undefined;
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json',
    },
  });
}
