const MAX_DOCUMENTS = 4;
const MAX_DOCUMENT_CHARS = 6_000;
const MAX_TOTAL_CHARS = 12_000;
const TRUNCATION_NOTICE = '\n[truncated: AGENTS.md content exceeds the review prompt limit]';
export async function resolveAgentInstructions(options) {
    if (!options.readFileAtRef || !isSafeRepositoryPath(options.file)) {
        return '';
    }
    const paths = agentInstructionPaths(options.file).slice(0, MAX_DOCUMENTS);
    const sections = [];
    let totalLength = 0;
    for (const path of paths) {
        const content = await options.readFileAtRef(options.baseSha, path);
        if (!content?.trim()) {
            continue;
        }
        const header = `### ${path} (from pull request base commit)\n`;
        const remaining = MAX_TOTAL_CHARS - totalLength - header.length;
        if (remaining <= 0) {
            break;
        }
        const bounded = boundContent(content.trim(), Math.min(MAX_DOCUMENT_CHARS, remaining));
        sections.push(`${header}${bounded}`);
        totalLength += header.length + bounded.length;
    }
    return sections.join('\n\n');
}
function agentInstructionPaths(file) {
    const parts = file.split('/');
    parts.pop();
    const nearestDirectory = parts.join('/');
    const roots = ['AGENTS.md', 'AGENTS.override.md'];
    const nearest = nearestDirectory
        ? roots.map((name) => `${nearestDirectory}/${name}`)
        : [];
    return [...roots, ...nearest];
}
function boundContent(content, maxLength) {
    if (content.length <= maxLength) {
        return content;
    }
    if (maxLength <= TRUNCATION_NOTICE.length) {
        return TRUNCATION_NOTICE.slice(0, maxLength);
    }
    return `${content.slice(0, maxLength - TRUNCATION_NOTICE.length)}${TRUNCATION_NOTICE}`;
}
function isSafeRepositoryPath(file) {
    return !file.startsWith('/')
        && !file.includes('\0')
        && !file.includes(':')
        && file.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}
