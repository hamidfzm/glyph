---
paths:
  - "src/**/*.{ts,tsx}"
  - "src-tauri/**/*.rs"
---

# Documentation Rules

**`README.md` is a lean overview, not a changelog.** Its `## Features` list stays short: one terse line per capability, grouped by the existing subsections. Do **not** add a bullet for every feature. Most changes need no README edit at all; release notes and the PR history are the changelog.

Only touch the Features list when a change adds a genuinely new *category* of capability (a new file type, export target, sync backend, etc.), and even then fold it into an existing terse bullet rather than adding a new one where possible. Incremental additions to an existing capability (another shortcut, another toggle, another provider) do not get their own bullet.

When a feature is worth documenting, still update in the same commit:

- **`samples/README.md`**: showcase new markdown syntax where applicable. The `samples/` folder also doubles as a demo workspace, so add or update sibling files when introducing workspace-level features (wikilinks, backlinks, etc.)

Treat this as part of the feature's definition of done, not a follow-up.

## Style

- **Don't name implementation libraries in user-facing copy.** Feature bullets describe what the user gets ("Markdown editor mode: syntax highlighting, line numbers", not "Editor mode with CodeMirror 6"). Implementation details belong in `CONTRIBUTING.md`'s architecture section or PR descriptions.
- Exceptions: KaTeX and Mermaid stay named because the library identity *is* the feature contract; users recognize the syntax (`$...$`, ` ```mermaid `) by the library name. If the library is just an internal choice, leave it out.
