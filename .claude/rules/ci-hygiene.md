---
paths:
  - ".github/workflows/**/*.yml"
  - "src/**/*.{ts,tsx}"
  - "biome.json"
---

# CI Hygiene Rules

Keep the GitHub Actions "Annotations" panel clean. Warnings and notices are real findings, not background noise.

- Treat every `##[warning]` and `##[notice]` annotation as a fix-it item, not a TODO. The Lint job runs Biome with `--error-on-warnings`, so any new warning fails CI.
- Treat the Codecov PR comment the same way. A red "Patch coverage" line means the diff shipped untested lines: run `pnpm test:coverage` locally, write tests for the flagged lines, and push before asking for review. The usual escapees are event handlers, drag/reset callbacks, keyboard paths, and error branches, which is exactly the code that regresses silently without tests. Do not merge over an unresolved Codecov comment.
- Apply Biome's suggested fix for lint findings instead of suppressing them (e.g. `useOptionalChain`, `useIndexOf`).
- When GitHub flags an action as targeting a deprecated Node.js version, bump the action to the major version that ships on the current Node runtime. Examples: `pnpm/action-setup@v5+`, `actions/upload-artifact@v5+`, `codecov/codecov-action@v6+` (the v6 bump pulls in `actions/github-script@v8`).
- Don't introduce deprecated actions, packages, or APIs. Before adding a third-party action or library, check its README/changelog for deprecation notices and pick the supported replacement instead. Examples we've hit: `codecov/test-results-action` (deprecated; use `codecov/codecov-action@v6` with `report_type: test_results`).
- If an existing workflow step prints a deprecation warning at runtime, fix it in the same PR you noticed it in. Don't file a follow-up.
- Update every workflow in `.github/workflows/` in the same pass, not just the file that triggered the alert.
- Don't disable rules or filter annotations to silence warnings. If a rule genuinely doesn't fit the codebase, change it in `biome.json` with a justification, not inline.

## Required checks are pinned by name

Required status checks are pinned by exact context name in **two places**: the legacy branch protection on `main` and repository ruleset 15172749 ("main branch protection"). With the reusable-workflow split, contexts look like `checks / Lint`, `tests / Test (Frontend)`, `build / Build (macos-latest)` (caller job id, slash, called job name).

- Renaming, splitting, or merging a CI job silently blocks every PR: the old context never reports and the PR waits forever. After any job rename, read the real names from `gh api repos/hamidfzm/glyph/commits/<sha>/check-runs` on a pushed commit, then update **both** places.
- A job skipped via job-level `if:` still reports a "skipped" check run and satisfies a required check. A job removed via matrix `exclude` reports **nothing** and must not be in the required list.
