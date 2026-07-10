export class GitHubApiError extends Error {
    status;
    responseText;
    constructor(status, responseText) {
        super(`GitHub API failed: HTTP ${status}`);
        this.status = status;
        this.responseText = responseText;
    }
}
export class GitHubClient {
    options;
    apiBaseUrl;
    fetchImpl;
    constructor(options) {
        this.options = options;
        this.apiBaseUrl = options.apiBaseUrl?.replace(/\/+$/, '') || 'https://api.github.com';
        this.fetchImpl = options.fetchImpl ?? fetch;
    }
    async request(method, path, body) {
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
            return undefined;
        }
        return JSON.parse(responseText);
    }
    async paginate(path) {
        const results = [];
        let nextPath = appendPage(path, 1);
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
            const page = JSON.parse(responseText);
            results.push(...page);
            nextPath = nextPagePath(response.headers.get('link'));
        }
        return results;
    }
    url(path) {
        if (path.startsWith('http://') || path.startsWith('https://')) {
            return path;
        }
        return `${this.apiBaseUrl}${this.interpolate(path.startsWith('/') ? path : `/${path}`)}`;
    }
    interpolate(path) {
        return path
            .replaceAll('{owner}', encodeURIComponent(this.options.owner))
            .replaceAll('{repo}', encodeURIComponent(this.options.repo));
    }
}
function appendPage(path, page) {
    return `${path}${path.includes('?') ? '&' : '?'}page=${page}`;
}
function nextPagePath(linkHeader) {
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
