export interface IssueComment {
  id?: number;
  body?: string;
  created_at?: string;
  updated_at?: string;
}

export interface SummaryBodyOptions {
  verdict: string;
  newFindings: number;
  existingFindings: number;
  resolvedFindings: number;
  filesReviewed: number;
  filesSkipped: number;
  fixFirst?: string;
  activeFindings?: string;
  otherFindings?: string;
  otherFindingsCount?: number;
}

export function summaryCommentMarker(): string {
  return '<!-- ai-pr-review:summary -->';
}

export function findSummaryCommentId(issueComments: IssueComment[]): number | undefined {
  const markers = [summaryCommentMarker(), '<!-- gosh-review:summary -->'];
  return [...issueComments]
    .filter((comment) => {
      const body = comment.body ?? '';
      return markers.some((marker) => body.includes(marker))
        || body.includes('## 📋 AI PR Review Summary')
        || body.includes('## 📋 Gosh AI Review Summary');
    })
    .sort((left, right) => timestamp(left).localeCompare(timestamp(right)))
    .at(-1)?.id;
}

export function buildReviewVerdict(criticalCount: number, highCount: number, mediumCount: number): string {
  if (criticalCount > 0) {
    return 'Blocking';
  }
  if (highCount > 0 || mediumCount > 0) {
    return 'Needs Attention';
  }
  return 'LGTM';
}

export function buildSummaryCommentBody(options: SummaryBodyOptions): string {
  const totalIssues = options.newFindings + options.existingFindings;
  const sections = [
    totalIssues > 0 && options.fixFirst ? `### Fix First\n\n${options.fixFirst}` : '',
    totalIssues > 0 && options.activeFindings ? `### Active Findings\n\n${options.activeFindings}` : '',
    (options.otherFindingsCount ?? 0) > 0 && options.otherFindings
      ? `<details>\n<summary>Other Findings (${options.otherFindingsCount})</summary>\n\n${options.otherFindings}\n</details>`
      : '',
  ].filter(Boolean);

  const body = `## 📋 AI PR Review Summary

| Metric | Count |
|--------|-------|
| Verdict | ${options.verdict} |
| Files Reviewed | ${options.filesReviewed} |
| Files Skipped | ${options.filesSkipped} |
| Total Issues | ${totalIssues} |
| New Findings | ${options.newFindings} |
| Existing Findings | ${options.existingFindings} |
| Resolved Findings | ${options.resolvedFindings} |
`;

  if (sections.length > 0) {
    return `${body}\n${sections.join('\n\n')}\n\n${summaryCommentMarker()}\n`;
  }

  return `${body}\n${summaryCommentMarker()}\n`;
}

function timestamp(comment: IssueComment): string {
  return comment.updated_at ?? comment.created_at ?? '';
}
