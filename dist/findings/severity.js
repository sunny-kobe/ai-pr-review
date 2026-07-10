export function severityRank(severity) {
    switch (severity) {
        case 'low':
            return 1;
        case 'medium':
            return 2;
        case 'high':
            return 3;
        case 'critical':
            return 4;
        default:
            return 2;
    }
}
export function shouldPostInline(severity, threshold) {
    return severityRank(severity) >= severityRank(threshold);
}
export function shouldPostInlineWithBudget(severity, threshold, fileInlineCount, prInlineCount, perFileLimit, prLimit) {
    if (!shouldPostInline(severity, threshold)) {
        return false;
    }
    if (fileInlineCount >= perFileLimit) {
        return false;
    }
    if (prInlineCount >= prLimit) {
        return false;
    }
    return true;
}
