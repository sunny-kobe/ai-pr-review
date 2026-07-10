export interface ReviewableAnchor {
  key: string;
  anchor: string;
}

export function collectReviewableLines(diffContent: string): string[] {
  return parseReviewableDiff(diffContent).map((entry) => entry.key);
}

export function collectReviewableLineAnchors(diffContent: string): ReviewableAnchor[] {
  return parseReviewableDiff(diffContent);
}

export function filterFindingsToReviewableLines<T extends { file?: string; line?: number }>(
  findings: T[],
  reviewableLines: string[],
): T[] {
  const allowed = new Set(reviewableLines);
  return findings.filter((finding) => {
    if (!finding.file || finding.line == null) {
      return false;
    }
    return allowed.has(`${finding.file}:${finding.line}`);
  });
}

function parseReviewableDiff(diffContent: string): ReviewableAnchor[] {
  const entries: ReviewableAnchor[] = [];
  let currentFile = '';
  let newLine = 0;

  for (const line of diffContent.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) {
      currentFile = line.replace(/^diff --git a\/[^ ]+ b\//, '');
      continue;
    }
    if (line.startsWith('@@ ')) {
      const match = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      newLine = match ? Number(match[1]) : 0;
      continue;
    }
    if (line.startsWith('+++ ') || line.startsWith('--- ')) {
      continue;
    }
    if (line.startsWith('+')) {
      if (currentFile) {
        entries.push({
          key: `${currentFile}:${newLine}`,
          anchor: normalizeCodeExcerpt(line.slice(1)),
        });
      }
      newLine += 1;
      continue;
    }
    if (line.startsWith('-')) {
      continue;
    }
    if (line.startsWith(' ')) {
      newLine += 1;
    }
  }

  return entries;
}

function normalizeCodeExcerpt(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}
