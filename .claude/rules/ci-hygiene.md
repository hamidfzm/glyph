---
paths:
  - ".github/workflows/**/*.yml"
  - "src/**/*.{ts,tsx}"
  - "biome.json"
---

# CI Hygiene Rules

Keep the GitHub Actions "Annotations" panel clean. Warnings and notices are real findings, not background noise.

- Treat every `##[warning]` and `##[notice]` annotation as a fix-it item, not a TODO. The Lint job runs Biome with `--error-on-warnings`, so any new warning fails CI.
- Apply Biome's suggested fix for lint findings instead of suppressing them (e.g. `useOptionalChain`, `useIndexOf`).
- When GitHub flags an action as targeting a deprecated Node.js version, bump the action to the major version that ships on the current Node runtime. Examples: `pnpm/action-setup@v5+`, `actions/upload-artifact@v5+`, `codecov/codecov-action@v6+` (the v6 bump pulls in `actions/github-script@v8`).
- Update every workflow in `.github/workflows/` in the same pass, not just the file that triggered the alert.
- Don't disable rules or filter annotations to silence warnings. If a rule genuinely doesn't fit the codebase, change it in `biome.json` with a justification, not inline.
