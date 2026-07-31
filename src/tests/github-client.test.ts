import assert from 'node:assert/strict';

import { GitHubClient } from '../github/client.js';
import { fetchPullRequestInfo, listPullRequestChangedFiles, listPullRequestCommitMessages } from '../github/pr.js';
import { createSummaryComment, listIssueComments, updateSummaryComment } from '../github/comments.js';
import { submitInlineReview } from '../github/review.js';

interface RecordedRequest {
  url: string;
  method: string;
  body?: string;
  authorization?: string;
}

const requests: RecordedRequest[] = [];
let pullReviewAttempts = 0;

const fetchMock = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const requestUrl = String(url);
  const method = init?.method ?? 'GET';
  requests.push({
    url: requestUrl,
    method,
    body: init?.body?.toString(),
    authorization: init?.headers ? new Headers(init.headers).get('authorization') ?? undefined : undefined,
  });

  if (requestUrl.includes('/pulls/42/comments?per_page=100&page=1')) {
    return jsonResponse([{ id: 1 }], {
      Link: '<https://api.github.test/repos/gosh/repo/pulls/42/comments?per_page=100&page=2>; rel="next"',
    });
  }
  if (requestUrl.includes('/pulls/42/comments?per_page=100&page=2')) {
    return jsonResponse([{ id: 2 }]);
  }
  if (requestUrl.endsWith('/pulls/42')) {
    return jsonResponse({
      head: { sha: 'head-sha', ref: 'feature' },
      base: { sha: 'base-sha', ref: 'main' },
      title: 'PR title',
      body: 'PR body',
      draft: false,
      changed_files: 2,
    });
  }
  if (requestUrl.includes('/pulls/42/commits?per_page=100&page=1')) {
    return jsonResponse([
      { commit: { message: 'fix(price): handle empty list\n\nLong body' } },
      { commit: { message: 'test(review): smoke context-aware prompt' } },
    ]);
  }
  if (requestUrl.includes('/pulls/42/files?per_page=100&page=1')) {
    return jsonResponse([
      { filename: 'src/example.ts', status: 'modified' },
      { filename: 'src/deleted.ts', status: 'removed' },
    ], {
      Link: '<https://api.github.test/repos/gosh/repo/pulls/42/files?per_page=100&page=2>; rel="next"',
    });
  }
  if (requestUrl.includes('/pulls/42/files?per_page=100&page=2')) {
    return jsonResponse([
      { filename: 'src/renamed.ts', status: 'renamed', previous_filename: 'src/old-name.ts' },
    ]);
  }
  if (requestUrl.endsWith('/issues/42/comments?per_page=100&page=1')) {
    return jsonResponse([{ id: 1001, body: 'old' }]);
  }
  if (requestUrl.endsWith('/issues/comments/1001')) {
    return jsonResponse({ id: 1001, body: JSON.parse(init?.body?.toString() ?? '{}').body });
  }
  if (requestUrl.endsWith('/issues/42/comments')) {
    return jsonResponse({ id: 1002, body: JSON.parse(init?.body?.toString() ?? '{}').body });
  }
  if (requestUrl.endsWith('/pulls/42/reviews')) {
    pullReviewAttempts += 1;
    if (pullReviewAttempts === 1) {
      return new Response(JSON.stringify({ message: 'validation failed' }), { status: 422 });
    }
    return jsonResponse({ id: 2001 });
  }
  if (requestUrl.endsWith('/pulls/42/comments')) {
    return jsonResponse({ id: 3001 });
  }

  return new Response(JSON.stringify({ message: `Unhandled ${method} ${requestUrl}` }), { status: 404 });
};

const client = new GitHubClient({
  owner: 'gosh',
  repo: 'repo',
  token: 'test-token',
  apiBaseUrl: 'https://api.github.test',
  fetchImpl: fetchMock,
});

const paginatedReviewComments = await client.paginate('/repos/{owner}/{repo}/pulls/42/comments?per_page=100');
assert.deepEqual(paginatedReviewComments, [{ id: 1 }, { id: 2 }]);
assert.equal(requests[0]?.authorization, 'Bearer test-token');

const prInfo = await fetchPullRequestInfo(client, 42);
assert.deepEqual(prInfo, {
  headSha: 'head-sha',
  headRef: 'feature',
  baseSha: 'base-sha',
  baseRef: 'main',
  title: 'PR title',
  body: 'PR body',
  isDraft: false,
  changedFiles: 2,
});
assert.deepEqual(await listPullRequestChangedFiles(client, 42), ['src/example.ts', 'src/renamed.ts']);
assert.deepEqual(await listPullRequestCommitMessages(client, 42), [
  'fix(price): handle empty list',
  'test(review): smoke context-aware prompt',
]);

assert.deepEqual(await listIssueComments(client, 42), [{ id: 1001, body: 'old' }]);
assert.equal((await updateSummaryComment(client, 1001, 'new summary')).body, 'new summary');
assert.equal((await createSummaryComment(client, 42, 'created summary')).body, 'created summary');

const reviewResult = await submitInlineReview(client, {
  prNumber: 42,
  commitSha: 'head-sha',
  body: '<!-- ai-pr-review:inline-review -->',
  comments: [
    {
      path: 'src/example.ts',
      line: 2,
      side: 'RIGHT',
      body: 'inline body',
    },
  ],
});

assert.equal(reviewResult.mode, 'fallback');
assert.equal(reviewResult.submittedComments, 1);
assert.equal(pullReviewAttempts, 1);
assert.ok(
  requests.some((request) => request.method === 'POST' && request.url.endsWith('/pulls/42/comments')),
  'fallback posts individual pull request comments',
);

console.log('PASS: TypeScript GitHub client modules build correct REST requests and fallback behavior');

function jsonResponse(payload: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}
