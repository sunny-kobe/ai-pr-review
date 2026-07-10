export function getSeverityEmoji(severity) {
    switch (severity) {
        case 'critical':
            return '🔴';
        case 'high':
            return '🟠';
        case 'medium':
            return '🟡';
        case 'low':
            return '🟢';
        default:
            return '🔵';
    }
}
export function buildInlineCommentBody(options) {
    const emoji = getSeverityEmoji(options.severity);
    const findingBody = options.suggestion
        ? `${emoji} **[${options.severity}]** ${options.message}

Suggested fix, review before applying:

\`\`\`
${options.suggestion}
\`\`\``
        : `${emoji} **[${options.severity}]** ${options.message}`;
    return `${findingBody}

<!-- ai-pr-review:stable-fingerprint=${options.stableFingerprint} -->
<!-- ai-pr-review:fingerprint=${options.fingerprint} -->`;
}
