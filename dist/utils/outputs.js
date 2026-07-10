import { appendFileSync } from 'node:fs';
export function writeGitHubOutput(name, value, outputFile = process.env.GITHUB_OUTPUT) {
    if (!outputFile) {
        return;
    }
    if (value.includes('\n')) {
        const delimiter = `ai_pr_review_${name}_${Date.now()}`;
        appendFileSync(outputFile, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
        return;
    }
    appendFileSync(outputFile, `${name}=${value}\n`);
}
