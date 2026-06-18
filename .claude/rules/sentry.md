# Sentry Issue Rules

When a PR fixes a Sentry issue, the reviewer needs to see the crash context without a Sentry login.

- **Always include the Sentry public shareable link in the PR description.** Use the share URL, which is viewable without authentication:

  ```
  https://glyph-md.sentry.io/share/issue/<hash>/
  ```

  Example: `https://glyph-md.sentry.io/share/issue/c5d3d5c9443b47cd8af873d19b06ce46/`

- **Do not substitute the internal issue URL** (`https://glyph-md.sentry.io/issues/<id>/`). It requires a login, so external reviewers can't open it.
- Create the share link from the Sentry issue page ("Share" → copy public link). If it can't be generated automatically, ask the author to paste it before opening the PR.
- Put the share link alongside the issue-closing reference. Sentry's GitHub integration recognizes `Fixes GLYPH-N` in the PR description (or a commit message) and auto-resolves the Sentry issue once merged, the same way GitHub closes issues (see [the closing-issues conventions in CLAUDE.md](../../CLAUDE.md)).
