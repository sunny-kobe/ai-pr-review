# Configuration

AI PR Review is a composite GitHub Action. Inputs are passed through the `with` block.

## Required Credentials

| Input | Required when | Description |
| --- | --- | --- |
| `openai_api_key` | `ai_provider: openai` | API key for an OpenAI-compatible endpoint |
| `gemini_api_key` | `ai_provider: gemini-cli` | Google Gemini API key |
| `github_token` | Usually automatic | Token used to read the PR and publish review output |

Use `${{ secrets.OPENAI_API_KEY }}` or `${{ secrets.GEMINI_API_KEY }}`. Do not put credentials in workflow files, variables, config files, or command-line arguments.

## Provider Inputs

| Input | Default | Description |
| --- | --- | --- |
| `ai_provider` | `openai` | `openai` or `gemini-cli` |
| `openai_base_url` | `https://api.openai.com` | Base URL for an OpenAI-compatible endpoint |
| `openai_model` | `gpt-5.6-luna` | Model identifier accepted by the endpoint |
| `openai_api_path` | `/v1/chat/completions` | Chat Completions or Responses API path |
| `openai_response_format` | `json_schema` | Empty, `json_object`, or strict `json_schema` output |
| `openai_reasoning_effort` | empty | Optional `low`, `medium`, or `high` value for compatible reasoning models |

## Review Inputs

| Input | Default | Description |
| --- | --- | --- |
| `preset` | empty | `frontend`, `backend`, or `mobile` |
| `config_file` | empty | Repository-relative JSON config path |
| `language` | `zh-CN` | `zh-CN` or `en` |
| `review_mode` | `fast` | `fast`, `full`, or `security` |
| `skip_draft` | `true` | Skip draft pull requests |
| `batch_size` | `5` | Files sent in one model request |
| `max_diff_lines` | `500` | Skip files whose diff exceeds this limit |
| `context_lines` | `5` | Nearby source lines included for each diff hunk |
| `file_types` | `.ts|.tsx|.js|.jsx` | Pipe-separated file extensions |
| `exclude_patterns` | `\.test\.|\.spec\.|__tests__` | Pipe-separated regular expressions |
| `inline_severity_threshold` | `high` | Minimum severity for inline comments |
| `inline_per_file_limit` | `2` | Maximum inline comments per file |
| `inline_pr_limit` | `8` | Maximum inline comments per pull request |
| `review_filter_enabled` | `false` | Run the optional second-pass contradiction filter |
| `dry_run` | `false` | Analyze without writing GitHub comments |
| `debug_mode` | `false` | Enable additional logs |

`preset` is applied first and `config_file` overrides it. Non-empty Action
inputs then override the corresponding runtime values, including Action defaults.

## Trusted Repository Rules

For each reviewed file, the action reads `AGENTS.md` and `AGENTS.override.md`
from the pull request base commit at the repository root and the file's nearest
directory. It does not read rule files changed by the pull request, preventing
those changes from becoming prompt instructions. Rules are bounded before they
are appended to the prompt.

The complete changed-file manifest is also included as read-only context. Inline
findings remain limited to added lines in reviewable file diffs.

## Custom Config

The top-level JSON schema supports:

```json
{
  "role": "You are a senior backend reviewer.",
  "focus": "Prioritize correctness, authorization, and data consistency.",
  "fileTypes": [".ts", ".go"],
  "excludePatterns": ["\\.test\\.", "vendor/"],
  "reviewMode": "full",
  "inlineSeverityThreshold": "high",
  "maxDiffLines": 400,
  "pathPolicies": [
    {
      "glob": ".github/workflows/**",
      "reviewMode": "security",
      "reviewerFocus": "Check permissions, secret flow, and script injection."
    }
  ]
}
```

See [`examples/custom-config.json`](../examples/custom-config.json) for a complete example.

## Permissions

The recommended minimum is:

```yaml
permissions:
  contents: read
  pull-requests: write
```

`contents: read` lets the workflow check out and fetch code. `pull-requests: write` lets it create the summary and inline review. Avoid `pull_request_target` with checkout of untrusted pull-request code.
