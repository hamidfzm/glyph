---
paths:
  - "src/**/*.{ts,tsx}"
  - "src-tauri/**/*.rs"
---

# Documentation Rules

When shipping a user-facing feature, update in the same commit:

- **`README.md`** — add a bullet under the relevant `## Features` subsection; if the feature adds a keyboard shortcut, add a row to the `## Keyboard Shortcuts` table
- **`samples/README.md`** — showcase the feature where applicable (new markdown syntax gets a demo section; new shortcuts go in the shortcuts table). The `samples/` folder also doubles as a demo workspace, so add or update sibling files when introducing workspace-level features (wikilinks, backlinks, etc.)

Treat these as part of the feature's definition of done, not a follow-up.

## Style

- **Don't name implementation libraries in user-facing copy.** Feature bullets describe what the user gets — "Markdown editor mode — syntax highlighting, line numbers", not "Editor mode with CodeMirror 6". Implementation details belong in `CONTRIBUTING.md`'s architecture section or PR descriptions.
- Exceptions: KaTeX and Mermaid stay named because the library identity *is* the feature contract — users recognize the syntax (`$...$`, ` ```mermaid `) by the library name. If the library is just an internal choice, leave it out.
