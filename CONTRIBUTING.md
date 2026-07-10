# Contributing

Issues and pull requests are welcome. Keep changes focused and include tests for behavior changes.

## Development

```bash
npm ci
npm test
bash tests/run_all.sh
```

Run `npm run build` after changing `src/` and commit the corresponding `dist/` output. Validate `action.yml` with `action-validator` when it is available.

## Pull Requests

- Explain the user-visible behavior and risk.
- Avoid unrelated refactors.
- Never add real API keys, tokens, private URLs, or proprietary code to fixtures.
- Keep Action permissions and secret flow explicit.
- Use Conventional Commit style where practical, for example `fix(review): validate inline locations`.
