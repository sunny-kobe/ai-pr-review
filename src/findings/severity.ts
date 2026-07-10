import type { FindingSeverity } from '../providers/types.js';

export function severityRank(severity: string): number {
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

export function shouldPostInline(severity: string, threshold: string): boolean {
  return severityRank(severity) >= severityRank(threshold);
}

export function shouldPostInlineWithBudget(
  severity: FindingSeverity | string,
  threshold: FindingSeverity | string,
  fileInlineCount: number,
  prInlineCount: number,
  perFileLimit: number,
  prLimit: number,
): boolean {
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
