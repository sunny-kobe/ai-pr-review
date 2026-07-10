export function listIssueComments(client, prNumber) {
    return client.paginate(`/repos/{owner}/{repo}/issues/${prNumber}/comments?per_page=100`);
}
export function listReviewComments(client, prNumber) {
    return client.paginate(`/repos/{owner}/{repo}/pulls/${prNumber}/comments?per_page=100`);
}
export function updateSummaryComment(client, commentId, body) {
    return client.request('PATCH', `/repos/{owner}/{repo}/issues/comments/${commentId}`, { body });
}
export function createSummaryComment(client, prNumber, body) {
    return client.request('POST', `/repos/{owner}/{repo}/issues/${prNumber}/comments`, { body });
}
