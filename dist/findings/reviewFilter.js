export async function filterInlineReviewComments(options) {
    if (options.candidates.length === 0) {
        return { comments: [], filteredCount: 0, decisions: [] };
    }
    try {
        const decisions = normalizeFilterDecisions(await options.provider(buildReviewFilterPrompt(options.candidates)));
        const removeIndexes = new Set(decisions.filter((decision) => !decision.keep).map((decision) => decision.index));
        const comments = options.candidates
            .filter((_, index) => !removeIndexes.has(index))
            .map((candidate) => candidate.comment);
        return {
            comments,
            filteredCount: options.candidates.length - comments.length,
            decisions,
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        options.logger?.(`review filter failed open: ${message}`);
        return {
            comments: options.candidates.map((candidate) => candidate.comment),
            filteredCount: 0,
            decisions: [],
        };
    }
}
export function buildReviewFilterPrompt(candidates) {
    const items = candidates.map((candidate, index) => ({
        index,
        file: candidate.finding.file,
        line: candidate.finding.line,
        severity: candidate.finding.severity,
        message: candidate.finding.message,
        changed_code: candidate.changedCode,
        existing_code: candidate.finding.existing_code ?? '',
        suggestion: candidate.finding.suggestion ?? '',
    }));
    return `你是 AI PR Review 的二次过滤器。

任务：只判断即将发布为 inline comment 的 finding 是否被当前 diff 直接反证。

规则：
- 只有当 finding 明显评论了错误文件、错误代码、错误行，或其问题描述被 diff 内容直接证明为不成立时，才返回 keep=false。
- 如果无法从给定字段直接证明 finding 是错的，必须 keep=true。
- 不要因为严重性偏低、措辞可改进、建议不完美、需要更多上下文或你不同意风格偏好而删除 finding。
- 输出纯 JSON 对象，不要 Markdown。格式为 {"decisions":[{"index":0,"keep":true,"reason":"..."}]}。

待过滤 findings:
${JSON.stringify(items, null, 2)}
`;
}
export function normalizeFilterDecisions(decisions) {
    return decisions
        .filter((decision) => Number.isInteger(decision.index) && decision.index >= 0)
        .map((decision) => ({
        index: decision.index,
        keep: decision.keep !== false,
        reason: decision.reason,
    }));
}
