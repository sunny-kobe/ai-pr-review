import type { FindingSeverity } from '../providers/types.js';

export interface InlineCommentBodyOptions {
  severity: FindingSeverity | string;
  message: string;
  suggestion?: string;
  stableFingerprint: string;
  fingerprint: string;
}

export function getSeverityEmoji(severity: string): string {
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

export function buildInlineCommentBody(options: InlineCommentBodyOptions): string {
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
