import { GitHubApiError, type GitHubClient } from './client.js';

export interface InlineReviewComment {
  path: string;
  line: number;
  side: 'RIGHT';
  body: string;
}

export interface SubmitInlineReviewOptions {
  prNumber: number;
  commitSha: string;
  body: string;
  comments: InlineReviewComment[];
}

export interface SubmitInlineReviewResult {
  mode: 'pending-review' | 'fallback' | 'none';
  submittedComments: number;
}

export async function submitInlineReview(
  client: GitHubClient,
  options: SubmitInlineReviewOptions,
): Promise<SubmitInlineReviewResult> {
  if (options.comments.length === 0) {
    return { mode: 'none', submittedComments: 0 };
  }

  try {
    await client.request('POST', `/repos/{owner}/{repo}/pulls/${options.prNumber}/reviews`, {
      commit_id: options.commitSha,
      body: options.body,
      event: 'COMMENT',
      comments: options.comments,
    });
    return { mode: 'pending-review', submittedComments: options.comments.length };
  } catch (error) {
    if (!(error instanceof GitHubApiError)) {
      throw error;
    }
  }

  let submittedComments = 0;
  for (const comment of options.comments) {
    await client.request('POST', `/repos/{owner}/{repo}/pulls/${options.prNumber}/comments`, {
      body: comment.body,
      commit_id: options.commitSha,
      path: comment.path,
      line: comment.line,
      side: comment.side,
    });
    submittedComments += 1;
  }

  return { mode: 'fallback', submittedComments };
}
