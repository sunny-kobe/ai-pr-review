# AI PR Review

An evidence-focused AI code review action for GitHub pull requests.

AI PR Review reads the changed lines in a pull request, asks an OpenAI-compatible model or Gemini CLI to identify concrete defects, and publishes one updatable summary plus deduplicated inline comments. It is designed to prefer fewer, higher-confidence findings over noisy style advice.

## Features

- Reviews only changed files and validates every inline comment against an added line.
- Supports OpenAI-compatible Chat Completions and Responses endpoints.
- Includes frontend, backend, and mobile review presets.
- Redacts common tokens and secrets before prompts are assembled.
- Deduplicates findings across reruns with stable fingerprints.
- Routes comments by severity and configurable per-file/PR budgets.
- Offers an optional second-pass filter for contradicted findings.
- Supports `dry_run` for integration testing without GitHub writes.

## Quick Start

Add `OPENAI_API_KEY` under **Settings > Secrets and variables > Actions**, then create `.github/workflows/ai-review.yml`:

```yaml
name: AI Review

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: sunny-kobe/ai-pr-review@v1
        with:
          openai_api_key: ${{ secrets.OPENAI_API_KEY }}
          preset: frontend
```

The workflow intentionally uses `pull_request`, not `pull_request_target`. GitHub does not expose repository secrets to pull requests from forks, so reviews for untrusted forks will be skipped or fail unless you add a separate approval-based workflow.

## Providers

OpenAI-compatible APIs are the default:

```yaml
- uses: sunny-kobe/ai-pr-review@v1
  with:
    openai_api_key: ${{ secrets.OPENAI_API_KEY }}
    openai_base_url: https://api.openai.com
    openai_api_path: /v1/chat/completions
    openai_model: gpt-5.6-luna
    openai_response_format: json_object
```

For a compatible Responses endpoint:

```yaml
    openai_api_path: /v1/responses
    openai_response_format: json_schema
    openai_reasoning_effort: medium
```

Gemini CLI remains available as an optional provider:

```yaml
- uses: sunny-kobe/ai-pr-review@v1
  with:
    ai_provider: gemini-cli
    gemini_api_key: ${{ secrets.GEMINI_API_KEY }}
```

## Presets And Custom Rules

Use `preset: frontend`, `preset: backend`, or `preset: mobile`. For repository-specific behavior, copy [`examples/custom-config.json`](examples/custom-config.json) to `.github/ai-review-config.json` and pass:

```yaml
    config_file: .github/ai-review-config.json
```

The custom config can override file types, exclusions, reviewer focus, severity threshold, path policies, and review rules. See [Configuration](docs/configuration.md) for the full contract and [examples](examples) for ready-to-copy workflows.

## Outputs

| Output | Description |
| --- | --- |
| `review_summary` | Generated review summary |
| `files_reviewed` | Number of reviewed files |
| `files_skipped` | Number of skipped files |
| `issues_found` | Total findings |
| `critical_count` | Critical findings |
| `high_count` | High findings |
| `duplicate_comments_suppressed` | Findings suppressed as duplicates |
| `redacted_matches` | Sensitive values redacted before prompting |

## Local Development

Requirements: Node.js 22+, npm, Bash, `git`, `jq`, and `rg`.

```bash
npm ci
npm test
bash tests/run_all.sh
action-validator action.yml
```

`dist/` is committed because GitHub Actions executes the compiled JavaScript. Run `npm run build` after editing `src/` and include the matching `dist/` changes.

## Security And Limitations

- Model output is untrusted and validated before GitHub comments are created.
- Secret redaction is defense in depth, not a complete data-loss-prevention system.
- Review quality depends on the selected model, prompt, diff size, and repository context.
- Keep workflow permissions minimal and review all suggested changes before applying them.
- Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). This project is available under the [MIT License](LICENSE).
