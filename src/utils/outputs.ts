import { appendFileSync } from 'node:fs';

export type OutputWriter = (name: string, value: string) => void;

export function writeGitHubOutput(name: string, value: string, outputFile = process.env.GITHUB_OUTPUT): void {
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
