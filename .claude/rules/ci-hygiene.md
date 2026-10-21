---
paths:
  - ".github/workflows/**/*.yml"
  - "src/**/*.{ts,tsx}"
  - "biome.json"
---

# CI Hygiene Rules

Keep the GitHub Actions "Annotations" panel clean. Warnings and notices are real findings, not background noise.

- Treat every `##[warning]` and `##[notice]` annotation as a fix-it item, not a TODO. The Lint job runs Biome with `--error-on-warnings`, so any new warning fails CI.
- Runner images are pinned by version (`ubuntu-24.04`, and `ubuntu-22.04` where the Linux app build needs the older glibc), never `ubuntu-latest`. GitHub moves `-latest` under running workflows over several weeks (the 26.04 move began 2026-10-19), so two runs of one job can land on different images. Move to a newer image as its own change, in every workflow at once, and cut a release soon after so the release-only workflows are proven on it too.
- Treat the Codecov PR comment the same way. A red "Patch coverage" line means the diff shipped untested lines: run `pnpm test:coverage` locally, write tests for the flagged lines, and push before asking for review. The usual escapees are event handlers, drag/reset callbacks, keyboard paths, and error branches, which is exactly the code that regresses silently without tests. Do not merge over an unresolved Codecov comment.
- Apply Biome's suggested fix for lint findings instead of suppressing them (e.g. `useOptionalChain`, `useIndexOf`).
- Every `actions/checkout` sets `persist-credentials: false`. `pnpm install` and a Rust build run every dependency's lifecycle and build scripts, and a token left in `.git/config` would be theirs. A step that pushes is handed its token through `env`, as `dependabot-tauri-npm-sync.yml` does.
- A tool installed from a package index at run time is pinned to a version (`version:` on the Codecov action, `pipx install name==x.y.z`), never left at the newest.
- A reusable workflow (`on: workflow_call`) declares the secrets it takes and the caller passes those by name. Never `secrets: inherit`: the caller runs on pull requests, which run the workflow files they edit.
- Every third-party `uses:` is pinned to a full commit SHA with a `# vX.Y.Z` comment. Never introduce one on a tag or branch, and keep the comment in sync with the SHA. See [Pinned GitHub Actions in CONTRIBUTING.md](../../CONTRIBUTING.md#pinned-github-actions) for how to resolve and update them.
- When GitHub flags an action as targeting a deprecated Node.js version, bump the action to the major version that ships on the current Node runtime. Examples: `pnpm/action-setup@v5+`, `actions/upload-artifact@v6+`, `actions/download-artifact@v7+`, `codecov/codecov-action@v6+` (the v6 bump pulls in `actions/github-script@v8`).
- Don't introduce deprecated actions, packages, or APIs. Before adding a third-party action or library, check its README/changelog for deprecation notices and pick the supported replacement instead. Examples we've hit: `codecov/test-results-action` (deprecated; use `codecov/codecov-action@v6` with `report_type: test_results`).
- If an existing workflow step prints a deprecation warning at runtime, fix it in the same PR you noticed it in. Don't file a follow-up.
- Update every workflow in `.github/workflows/` in the same pass, not just the file that triggered the alert.
- Don't disable rules or filter annotations to silence warnings. If a rule genuinely doesn't fit the codebase, change it in `biome.json` with a justification, not inline.

## Required checks are pinned by name

Required status checks are pinned by exact context name in repository ruleset 15172749 ("main branch protection"), the single source of protection on `main`. The legacy branch protection was removed; it could not exempt deploy keys, which blocked the Create Release workflow's version-bump push (the ruleset's only bypass actor is the release deploy key). Do not re-add a legacy branch protection alongside the ruleset. With the reusable-workflow split, contexts are `<caller job display name> / <called job name>`: `Checks / Lint`, `Tests / Frontend`, `Build / macos-latest`. The PR merge box additionally prefixes the workflow name, rendering `CI / Checks / Lint` (a two-segment `CI / Lint` display is impossible for reusable workflows). Renaming a caller job's `name:` therefore renames every context it produces. Reusable workflow files must live flat in `.github/workflows/` (GitHub ignores subdirectories), so they are namespaced by filename prefix: `ci-checks.yml`, `ci-tests.yml`, `ci-build.yml`.

- Renaming, splitting, or merging a CI job silently blocks every PR: the old context never reports and the PR waits forever. After any job rename, read the real names from `gh api repos/hamidfzm/glyph/commits/<sha>/check-runs` on a pushed commit, then update the ruleset.
- A job skipped via job-level `if:` still reports a "skipped" check run and satisfies a required check. A job removed via matrix `exclude` reports **nothing** and must not be in the required list.
