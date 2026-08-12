export async function fetchPullRequestInfo(client, prNumber) {
    const payload = await client.request('GET', `/repos/{owner}/{repo}/pulls/${prNumber}`);
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
export async function listPullRequestChangedFiles(client, prNumber) {
    return (await listPullRequestFiles(client, prNumber)).map((file) => file.filename);
}
export async function listPullRequestFiles(client, prNumber) {
    const files = await client.paginate(`/repos/{owner}/{repo}/pulls/${prNumber}/files?per_page=100`);
    return files
        .filter((file) => file.status !== 'removed')
        .flatMap((file) => file.filename ? [{
            filename: file.filename,
            status: file.status ?? 'modified',
            previousFilename: file.previous_filename,
            patch: file.patch,
        }] : []);
}
export async function listPullRequestCommitMessages(client, prNumber) {
    const commits = await client.paginate(`/repos/{owner}/{repo}/pulls/${prNumber}/commits?per_page=100`);
    return commits
        .map((commit) => commit.commit?.message?.split(/\r?\n/)[0]?.trim() ?? '')
        .filter(Boolean);
}
