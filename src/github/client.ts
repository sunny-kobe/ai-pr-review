export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface GitHubClientOptions {
  owner: string;
  repo: string;
  token: string;
  apiBaseUrl?: string;
  fetchImpl?: FetchLike;
}

export class GitHubApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly responseText: string,
  ) {
    super(`GitHub API failed: HTTP ${status}`);
  }
}

export class GitHubClient {
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly options: GitHubClientOptions) {
    this.apiBaseUrl = options.apiBaseUrl?.replace(/\/+$/, '') || 'https://api.github.com';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(this.url(path), {
      method,
      headers: {
        authorization: `Bearer ${this.options.token}`,
        'content-type': 'application/json',
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new GitHubApiError(response.status, responseText);
    }

    if (!responseText) {
      return undefined as T;
    }

    return JSON.parse(responseText) as T;
  }

  async paginate<T>(path: string): Promise<T[]> {
    const results: T[] = [];
    let nextPath: string | undefined = appendPage(path, 1);

    while (nextPath) {
      const response = await this.fetchImpl(this.url(nextPath), {
        method: 'GET',
        headers: {
          authorization: `Bearer ${this.options.token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
        },
      });

      const responseText = await response.text();
      if (!response.ok) {
        throw new GitHubApiError(response.status, responseText);
      }
      const page = JSON.parse(responseText) as T[];
      results.push(...page);
      nextPath = nextPagePath(response.headers.get('link'));
    }

    return results;
  }

  private url(path: string): string {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }
    return `${this.apiBaseUrl}${this.interpolate(path.startsWith('/') ? path : `/${path}`)}`;
  }

  private interpolate(path: string): string {
    return path
      .replaceAll('{owner}', encodeURIComponent(this.options.owner))
      .replaceAll('{repo}', encodeURIComponent(this.options.repo));
  }
}

function appendPage(path: string, page: number): string {
  return `${path}${path.includes('?') ? '&' : '?'}page=${page}`;
}

function nextPagePath(linkHeader: string | null): string | undefined {
  if (!linkHeader) {
    return undefined;
  }

  const nextLink = linkHeader
    .split(',')
    .map((part) => part.trim())
    .find((part) => part.includes('rel="next"'));

  const href = nextLink?.match(/<([^>]+)>/)?.[1];
  if (!href) {
    return undefined;
  }

  const url = new URL(href);
  return `${url.pathname}${url.search}`;
}
