---
paths:
  - "src/**/*.{ts,tsx}"
  - "src-tauri/**/*.rs"
---

# Documentation Rules

When shipping a user-facing feature, update in the same commit:

- **`README.md`** — add a bullet under the relevant `## Features` subsection; if the feature adds a keyboard shortcut, add a row to the `## Keyboard Shortcuts` table
- **`sample.md`** — showcase the feature where applicable (new markdown syntax gets a demo section; new shortcuts go in sample.md's shortcuts table)

Treat these as part of the feature's definition of done, not a follow-up.
