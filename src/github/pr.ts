import type { GitHubClient } from './client.js';

export interface PullRequestInfo {
  headSha: string;
  headRef: string;
  baseSha: string;
  baseRef: string;
  title: string;
  body: string;
  isDraft: boolean;
  changedFiles: number;
}

interface PullRequestPayload {
  head?: {
    sha?: string;
    ref?: string;
  };
  base?: {
    sha?: string;
    ref?: string;
  };
  title?: string;
  body?: string | null;
  draft?: boolean;
  changed_files?: number;
}

export interface PullRequestFile {
  filename: string;
  status: string;
  previousFilename?: string;
  patch?: string;
}

interface PullRequestFilePayload {
  filename?: string;
  status?: string;
  previous_filename?: string;
  patch?: string;
}

interface PullRequestCommitPayload {
  commit?: {
    message?: string;
  };
}

export async function fetchPullRequestInfo(client: GitHubClient, prNumber: number): Promise<PullRequestInfo> {
  const payload = await client.request<PullRequestPayload>('GET', `/repos/{owner}/{repo}/pulls/${prNumber}`);

  return {
    headSha: payload.head?.sha ?? '',
    headRef: payload.head?.ref ?? '',
    baseSha: payload.base?.sha ?? '',
    baseRef: payload.base?.ref ?? '',
    title: payload.title ?? '',
    body: payload.body ?? '',
    isDraft: payload.draft ?? false,
    changedFiles: payload.changed_files ?? 0,
  };
}

export async function listPullRequestChangedFiles(client: GitHubClient, prNumber: number): Promise<string[]> {
  return (await listPullRequestFiles(client, prNumber)).map((file) => file.filename);
}

export async function listPullRequestFiles(client: GitHubClient, prNumber: number): Promise<PullRequestFile[]> {
  const files = await client.paginate<PullRequestFilePayload>(
    `/repos/{owner}/{repo}/pulls/${prNumber}/files?per_page=100`,
  );

  return files
    .filter((file) => file.status !== 'removed')
    .flatMap((file) => file.filename ? [{
      filename: file.filename,
      status: file.status ?? 'modified',
      previousFilename: file.previous_filename,
      patch: file.patch,
    }] : []);
}

export async function listPullRequestCommitMessages(client: GitHubClient, prNumber: number): Promise<string[]> {
  const commits = await client.paginate<PullRequestCommitPayload>(
    `/repos/{owner}/{repo}/pulls/${prNumber}/commits?per_page=100`,
  );

  return commits
    .map((commit) => commit.commit?.message?.split(/\r?\n/)[0]?.trim() ?? '')
    .filter(Boolean);
}
