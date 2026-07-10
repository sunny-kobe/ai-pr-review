import type { GitHubClient } from './client.js';

export interface IssueComment {
  id: number;
  body?: string;
  created_at?: string;
  updated_at?: string;
}

export interface PullRequestReviewComment {
  id: number;
  body?: string;
  path?: string;
  line?: number;
  original_line?: number;
}

export function listIssueComments(client: GitHubClient, prNumber: number): Promise<IssueComment[]> {
  return client.paginate<IssueComment>(`/repos/{owner}/{repo}/issues/${prNumber}/comments?per_page=100`);
}

export function listReviewComments(client: GitHubClient, prNumber: number): Promise<PullRequestReviewComment[]> {
  return client.paginate<PullRequestReviewComment>(`/repos/{owner}/{repo}/pulls/${prNumber}/comments?per_page=100`);
}

export function updateSummaryComment(client: GitHubClient, commentId: number, body: string): Promise<IssueComment> {
  return client.request<IssueComment>('PATCH', `/repos/{owner}/{repo}/issues/comments/${commentId}`, { body });
}

export function createSummaryComment(client: GitHubClient, prNumber: number, body: string): Promise<IssueComment> {
  return client.request<IssueComment>('POST', `/repos/{owner}/{repo}/issues/${prNumber}/comments`, { body });
}
