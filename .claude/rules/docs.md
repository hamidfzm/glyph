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

## Install instructions live in four places

Install commands (Homebrew, winget, Chocolatey, Scoop, Snap, AUR, PPA, apt, dnf) are duplicated across the ecosystem. Changing any install command means updating **all four in the same delivery**, not just the one that prompted the change:

1. **`README.md`** in this repo (the Install section).
2. **`.github/workflows/release.yml`** in this repo: the generated release notes carry the install commands in **two** heredoc blocks (the initial release body and the changelog INSTALL block); patch both.
3. **The website**: `glyph-md/glyph-md.github.io`, `src/components/Download.astro`.
4. **The org profile**: `glyph-md/.github`, `profile/README.md`.

Homebrew commands always use fully qualified names (`brew install --cask --force glyph-md/tap/glyph` on macOS, `brew install glyph-md/tap/glyph` on Linux): homebrew-core ships an unrelated `glyph` formula (an ASCII-art converter) that a plain `brew install glyph` resolves to, shadowing the app's CLI with a tool that fails with "Error: input file must be specified."

## Style

- **Don't name implementation libraries in user-facing copy.** Feature bullets describe what the user gets ("Markdown editor mode: syntax highlighting, line numbers", not "Editor mode with CodeMirror 6"). Implementation details belong in `CONTRIBUTING.md`'s architecture section or PR descriptions.
- Exceptions: KaTeX and Mermaid stay named because the library identity *is* the feature contract; users recognize the syntax (`$...$`, ` ```mermaid `) by the library name. If the library is just an internal choice, leave it out.
