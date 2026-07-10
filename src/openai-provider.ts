#!/usr/bin/env node

import { loadOpenAiOptionsFromEnv, ProviderHttpError, reviewPromptFile } from './providers/openai.js';

const promptFile = process.argv[2];

if (!promptFile) {
  console.error('Error: prompt file path is required');
  process.exit(1);
}

try {
  const findings = await reviewPromptFile(promptFile, loadOpenAiOptionsFromEnv());
  process.stdout.write(`${JSON.stringify(findings, null, 2)}\n`);
} catch (error) {
  if (error instanceof ProviderHttpError) {
    console.error(error.message);
    console.error(error.responseText.slice(0, 2000));
    process.exit(1);
  }

  const reason = error instanceof Error && error.name === 'AbortError'
    ? `timed out after ${process.env.OPENAI_TIMEOUT_MS || 120000}ms`
    : error instanceof Error
      ? error.message
      : String(error);

  if (reason === 'OPENAI_API_KEY is required when AI_PROVIDER=openai') {
    console.error(`Error: ${reason}`);
  } else {
    console.error(`OpenAI-compatible provider failed: ${reason}`);
  }
  process.exit(1);
}
