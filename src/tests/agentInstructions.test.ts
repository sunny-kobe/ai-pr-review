import assert from 'node:assert/strict';

import { resolveAgentInstructions } from '../prompt/agentInstructions.js';

{
  const reads: string[] = [];
  const rules = await resolveAgentInstructions({
    baseSha: 'base-sha',
    file: 'src/pages/orders/index.tsx',
    readFileAtRef: async (ref, path) => {
      reads.push(`${ref}:${path}`);
      return {
        'AGENTS.md': 'Root rule: preserve API field names.',
        'src/pages/orders/AGENTS.md': 'Orders rule: pagination is 1-based.',
      }[path];
    },
  });

  assert.deepEqual(reads, [
    'base-sha:AGENTS.md',
    'base-sha:AGENTS.override.md',
    'base-sha:src/pages/orders/AGENTS.md',
    'base-sha:src/pages/orders/AGENTS.override.md',
  ]);
  assert.match(rules, /Root rule: preserve API field names/);
  assert.match(rules, /Orders rule: pagination is 1-based/);
  assert.match(rules, /from pull request base commit/);
}

{
  let reads = 0;
  const rules = await resolveAgentInstructions({
    baseSha: 'base-sha',
    file: '../secrets.ts',
    readFileAtRef: async () => {
      reads += 1;
      return 'must not be read';
    },
  });

  assert.equal(rules, '');
  assert.equal(reads, 0);
}

{
  const rules = await resolveAgentInstructions({
    baseSha: 'base-sha',
    file: 'src/example.ts',
    readFileAtRef: async (_ref, path) => (path === 'AGENTS.md' ? 'x'.repeat(20_000) : undefined),
  });

  assert.ok(rules.length <= 12_000);
  assert.match(rules, /truncated/);
}

console.log('PASS: base-commit AGENTS instructions are resolved safely');
