import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
export class ShellGitAdapter {
    async fetchAll() {
        await execFileAsync('git', ['fetch', '--all', '--quiet']);
    }
    async mergeBase(baseRef, headSha) {
        try {
            const { stdout } = await execFileAsync('git', ['merge-base', `origin/${baseRef}`, headSha]);
            return stdout.trim();
        }
        catch {
            return 'HEAD~1';
        }
    }
    async diffForFile(baseSha, headSha, file) {
        const { stdout } = await execFileAsync('git', ['diff', baseSha, headSha, '--', file]);
        return stdout;
    }
    async readFileAtRef(ref, file) {
        if (!/^[0-9a-f]{7,64}$/i.test(ref) || !isSafeRepositoryPath(file)) {
            return undefined;
        }
        try {
            const { stdout } = await execFileAsync('git', ['show', `${ref}:${file}`]);
            return stdout;
        }
        catch {
            return undefined;
        }
    }
    async contextForFile(file, diffContent, contextLines) {
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
function isSafeRepositoryPath(file) {
    return !file.startsWith('/')
        && !file.includes('\0')
        && !file.includes(':')
        && file.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}
function parseContextRanges(diffContent, contextLines) {
    const ranges = [];
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
function mergeRanges(ranges) {
    const sorted = [...ranges].sort((left, right) => left.start - right.start);
    const merged = [];
    for (const range of sorted) {
        const previous = merged.at(-1);
        if (previous && range.start <= previous.end + 1) {
            previous.end = Math.max(previous.end, range.end);
        }
        else {
            merged.push({ ...range });
        }
    }
    return merged;
}
async function readFileLines(file, start, end) {
    try {
        const { stdout } = await execFileAsync('sed', ['-n', `${start},${end}p`, file]);
        return stdout
            .split(/\r?\n/)
            .filter((line, index, lines) => line.length > 0 || index < lines.length - 1)
            .map((line, index) => `${start + index}\t${line}`);
    }
    catch {
        return [];
    }
}
