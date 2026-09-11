# Sentry Issue Rules

When a PR fixes a Sentry issue, the reviewer needs to see the crash context without a Sentry login.

- **Always include the Sentry public shareable link in the PR description.** Use the share URL, which is viewable without authentication:

  ```
  https://glyph-md.sentry.io/share/issue/<hash>/
  ```

  Example: `https://glyph-md.sentry.io/share/issue/c5d3d5c9443b47cd8af873d19b06ce46/`

- **Do not substitute the internal issue URL** (`https://glyph-md.sentry.io/issues/<id>/`). It requires a login, so external reviewers can't open it.
- Create the share link from the Sentry issue page ("Share" → copy public link). If it can't be generated automatically, ask the author to paste it before opening the PR.
- Put `Fixes GLYPH-N` in the PR description, one line per issue, next to its share link. Sentry's GitHub integration links the PR to the issue and resolves it when a release containing the merge ships, not at merge time. That depends on the GitHub integration being installed in the `glyph-md` Sentry org with `hamidfzm/glyph` added, and on the release the app reports (`glyph@X.Y.Z`) carrying its commits, which the Vite plugin attaches during the release build (`release.name` in `vite.config.ts`). An issue still open after its fix ships means one of those broke: check both before resolving it by hand.
