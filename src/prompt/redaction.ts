const GITHUB_TOKEN_PATTERN = /gh[pousr]_[A-Za-z0-9_]+/g;
const GENERIC_SECRET_PATTERN =
  /((api[_-]?key|token|secret|password)\s*[:=]\s*)["'`][^"'`\[]+["'`]/gi;

export function countSensitiveMatches(input: string): number {
  const githubMatches = input.match(GITHUB_TOKEN_PATTERN)?.length ?? 0;
  const sanitizedInput = input.replace(GITHUB_TOKEN_PATTERN, '[REDACTED_GITHUB_TOKEN]');
  const genericMatches = sanitizedInput.match(GENERIC_SECRET_PATTERN)?.length ?? 0;
  return githubMatches + genericMatches;
}

export function redactSensitiveContent(input: string): string {
  return input
    .replace(GITHUB_TOKEN_PATTERN, '[REDACTED_GITHUB_TOKEN]')
    .replace(GENERIC_SECRET_PATTERN, '$1"[REDACTED_SECRET]"');
}
