import { spawnSync } from 'node:child_process';

import { parseFindings } from './openai.js';
import type { Finding, ProviderOptions, ReviewProvider } from './types.js';

export class GeminiCliProvider implements ReviewProvider {
  name = 'gemini-cli' as const;

  review(prompt: string, _options: ProviderOptions = {}): Promise<Finding[]> {
    return reviewWithGeminiCli(prompt);
  }
}

export async function reviewWithGeminiCli(
  prompt: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Finding[]> {
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

export function parseGeminiCliFindings(output: string): Finding[] {
  return parseFindings(output || '[]');
}
