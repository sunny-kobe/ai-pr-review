import { spawnSync } from 'node:child_process';
import { parseFindings } from './openai.js';
export class GeminiCliProvider {
    name = 'gemini-cli';
    review(prompt, _options = {}) {
        return reviewWithGeminiCli(prompt);
    }
}
export async function reviewWithGeminiCli(prompt, env = process.env) {
    const result = spawnSync('gemini', ['--yolo', '--prompt', prompt], {
        env,
        encoding: 'utf8',
    });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`Gemini CLI failed with exit code ${result.status}: ${result.stderr}`);
    }
    return parseGeminiCliFindings(result.stdout || '[]');
}
export function parseGeminiCliFindings(output) {
    return parseFindings(output || '[]');
}
