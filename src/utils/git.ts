import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface GitAdapter {
  fetchAll(): Promise<void>;
  mergeBase(baseRef: string, headSha: string): Promise<string>;
  diffForFile(baseSha: string, headSha: string, file: string): Promise<string>;
  contextForFile?(file: string, diffContent: string, contextLines: number): Promise<string>;
}

export class ShellGitAdapter implements GitAdapter {
  async fetchAll(): Promise<void> {
    await execFileAsync('git', ['fetch', '--all', '--quiet']);
  }

  async mergeBase(baseRef: string, headSha: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', ['merge-base', `origin/${baseRef}`, headSha]);
      return stdout.trim();
    } catch {
      return 'HEAD~1';
    }
  }

  async diffForFile(baseSha: string, headSha: string, file: string): Promise<string> {
    const { stdout } = await execFileAsync('git', ['diff', baseSha, headSha, '--', file]);
    return stdout;
  }

  async contextForFile(file: string, diffContent: string, contextLines: number): Promise<string> {
    if (contextLines <= 0) {
      return '';
    }

    const ranges = mergeRanges(parseContextRanges(diffContent, contextLines));
    if (ranges.length === 0) {
      return '';
    }

    const sections = [];
    for (const range of ranges) {
      const lines = await readFileLines(file, range.start, range.end);
      if (lines.length === 0) {
        continue;
      }
      sections.push(`--- Lines ${range.start}-${range.end} ---\n${lines.join('\n')}`);
    }

    if (sections.length === 0) {
      return '';
    }

    return `<file_context file="${file}">\n${sections.join('\n')}\n</file_context>`;
  }
}

interface LineRange {
  start: number;
  end: number;
}

function parseContextRanges(diffContent: string, contextLines: number): LineRange[] {
  const ranges: LineRange[] = [];
  for (const line of diffContent.split(/\r?\n/)) {
    const match = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (!match) {
      continue;
    }
    const start = Number(match[1]);
    const count = Number(match[2] ?? 1);
    ranges.push({
      start: Math.max(start - contextLines, 1),
      end: start + count + contextLines,
    });
  }
  return ranges;
}

function mergeRanges(ranges: LineRange[]): LineRange[] {
  const sorted = [...ranges].sort((left, right) => left.start - right.start);
  const merged: LineRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end + 1) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

async function readFileLines(file: string, start: number, end: number): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('sed', ['-n', `${start},${end}p`, file]);
    return stdout
      .split(/\r?\n/)
      .filter((line, index, lines) => line.length > 0 || index < lines.length - 1)
      .map((line, index) => `${start + index}\t${line}`);
  } catch {
    return [];
  }
}
