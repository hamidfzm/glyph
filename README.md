# Glyph

[![CI](https://github.com/hamidfzm/glyph/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/hamidfzm/glyph/actions/workflows/ci.yml)
[![Release](https://github.com/hamidfzm/glyph/actions/workflows/release.yml/badge.svg)](https://github.com/hamidfzm/glyph/actions/workflows/release.yml)
[![CodeQL](https://github.com/hamidfzm/glyph/actions/workflows/security.yml/badge.svg?branch=main)](https://github.com/hamidfzm/glyph/actions/workflows/security.yml)
[![codecov](https://codecov.io/gh/hamidfzm/glyph/graph/badge.svg)](https://codecov.io/gh/hamidfzm/glyph)
[![Latest release](https://img.shields.io/github/v/release/hamidfzm/glyph?sort=semver)](https://github.com/hamidfzm/glyph/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/hamidfzm/glyph/total?color=blue)](https://github.com/hamidfzm/glyph/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-24c8db?logo=tauri)](https://v2.tauri.app)
[![React 19](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white)](https://react.dev)
[![Code style: Biome](https://img.shields.io/badge/code_style-biome-60a5fa?logo=biome)](https://biomejs.dev)

A modern, cross-platform markdown viewer and editor with platform-native styling.

Built with [Tauri v2](https://v2.tauri.app), React 19, and TypeScript.

![Glyph](docs/assets/hero.png)

## Demo

![Demo](docs/assets/demo.gif)

## Try It

The [`samples/`](samples) directory is a tiny demo workspace. Open it as a folder (`Cmd/Ctrl+Shift+O`) to see every rendering feature plus working wikilinks. [`samples/README.md`](samples/README.md) is the showcase document; the surrounding files exist so its `[[wikilinks]]` resolve.

## Features

### Markdown Rendering
- GitHub Flavored Markdown, alerts, footnotes, heading anchors, and emoji shortcodes
- Wikilinks and backlinks with hover preview and inline note embeds (`[[note]]`, `![[note]]`)
- Math (KaTeX), Mermaid and D2 diagrams, CSV/TSV tables, and syntax-highlighted code (6 themes)
- YAML frontmatter, sanitised inline HTML, and bidirectional (RTL) text
- Local and remote images with a zoomable lightbox
- Per-syntax toggles in Settings → Markdown

### Editor
- Source, split, and live-preview modes per tab
- New untitled (in-memory) documents (`Cmd/Ctrl+N`), save with `Cmd/Ctrl+S`, and an optional Auto Save toggle
- Format toolbar, inline formatting shortcuts, and wrap-selection
- Wikilink autocomplete, spell check, and Vim/VSCode keymaps
- Undo/redo for programmatic edits (task toggles, etc.)

### Workspace & Navigation
- Folder workspaces with a sidebar tree, tabs, and create/rename/move/delete; create a new workspace from within the app
- Graph view (`Cmd/Ctrl+G`), command palette (`Cmd/Ctrl+K`), and in-document search (`Cmd/Ctrl+F`)
- Table of contents, resizable panels, zoom, and session/window restore
- Drag-and-drop, file associations, and a `glyph` CLI (`glyph file.md`, `glyph ~/notes/`)

### Viewer & Export
- Jupyter notebooks (`.ipynb`) and JSON Canvas (`.canvas`) boards
- Print and export to HTML, DOCX, EPUB, and PDF (vector diagrams, self-contained, offline)
- Export a whole workspace as a static website, in-app or headless from the CLI

### Sync (experimental)
- Per-workspace, Git-backed Cloud Sync to any remote you control, with a status-bar ahead/behind/dirty pill

### Appearance
- System / Light / Dark themes and platform-native styling (macOS vibrancy, Windows Mica)
- Localized, RTL-aware UI; customizable fonts, size, line height, and content width

### AI (optional)
- Chat sidebar, quick actions (summarize, explain, translate, simplify), and text-to-speech
- Providers: Claude, OpenAI, and Ollama (local)

### Platform
- macOS, Windows, and Linux; native menu bar with remappable shortcuts and update notifications
- Plugins (experimental): extend rendering, palette, status bar, dictionaries, and themes
- Local-first with opt-in crash reporting (off by default; see [Privacy & Error Reporting](#privacy--error-reporting))

## Install

### macOS (Homebrew)

```bash
brew tap glyph-md/tap
brew trust glyph-md/tap
brew install --cask glyph
```

`brew trust` is required once because Glyph ships from a third-party tap; recent Homebrew refuses to load casks from untrusted taps.

### Windows (winget)

```powershell
winget install hamidfzm.Glyph
```

### Windows (Chocolatey)

```powershell
choco install glyph
```

### Windows (Scoop)

```powershell
scoop bucket add glyph-md https://github.com/glyph-md/scoop-bucket
scoop install glyph
```

### Linux (Snap)

```bash
sudo snap install glyph
```

### Arch Linux (AUR)

```bash
yay -S glyph-md-bin
```

### Linux (Homebrew)

```bash
brew tap glyph-md/tap
brew install glyph
```

### Debian/Ubuntu (PPA)

```bash
sudo add-apt-repository ppa:hamidfzm/glyph
sudo apt update
sudo apt install glyph
```

### Debian

```bash
curl -fsSL https://glyph-md.github.io/apt-repo/gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/glyph.gpg
echo "deb [signed-by=/usr/share/keyrings/glyph.gpg] https://glyph-md.github.io/apt-repo stable main" | sudo tee /etc/apt/sources.list.d/glyph.list
sudo apt update
sudo apt install glyph
```

### Fedora / RHEL (DNF)

```bash
sudo tee /etc/yum.repos.d/glyph.repo < <(curl -fsSL https://glyph-md.github.io/rpm-repo/glyph.repo)
sudo dnf install glyph
```

### Linux (manual)

Download the `.deb`, `.rpm`, or `.AppImage` from [Releases](https://github.com/hamidfzm/glyph/releases).

```bash
# Debian/Ubuntu
sudo dpkg -i glyph_*.deb

# Fedora/RHEL
sudo dnf install ./Glyph-*.rpm

# AppImage
chmod +x Glyph_*.AppImage
./Glyph_*.AppImage
```

### Command-line usage

Installing from a package manager puts a `glyph` command on your `PATH`:

```bash
glyph README.md      # open a file
glyph ~/notes/       # open a folder as a workspace

# export a workspace as a static website (headless; exits when done)
glyph ~/notes/ --export-website ./site
```

The website export runs without showing a window and exits nonzero on failure, so it can drive CI publishing (on Linux runners, wrap it in `xvfb-run`).

The command is provided by the Homebrew cask (macOS), Chocolatey or Scoop (Windows), and the deb package or Homebrew formula (Linux). The macOS `.dmg` and Windows MSI install the app only; use a package manager for the terminal command.

## Development

```bash
pnpm install
pnpm tauri dev
```

Open a file or folder via CLI argument:

```bash
pnpm tauri dev -- -- /path/to/file.md
pnpm tauri dev -- -- /path/to/folder
```

Build for production:

```bash
pnpm tauri build
```

### Testing

```bash
pnpm test                       # Run frontend tests (Vitest)
pnpm test:coverage              # Run with coverage report
cd src-tauri && cargo test      # Run Rust tests
```

### Linting & Formatting

```bash
pnpm lint                       # Lint TypeScript (Biome)
pnpm format:check               # Check formatting (Biome)
pnpm check                      # Lint + format + organize imports
cd src-tauri && cargo clippy    # Lint Rust
```

## Comparison with Other Markdown Apps

Glyph is built around speed, native feel, and offline-first usage. The tables below compare its current capabilities against widely used markdown apps. Items marked "planned" track to issues on the [roadmap](https://github.com/hamidfzm/glyph/issues).

### Rendering

| Feature | Glyph | Obsidian | Typora | MarkText | Zettlr | Joplin | VS Code |
|---|---|---|---|---|---|---|---|
| GitHub Flavored Markdown | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Math (KaTeX/MathJax) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | plugin |
| Mermaid diagrams | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | plugin |
| D2 diagrams | ✅ | plugin | ❌ | ❌ | ❌ | ❌ | plugin |
| Syntax-highlighted code | ✅ (6 themes) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| GitHub-style alerts | ✅ | ✅ | ⚠️ | ❌ | ❌ | ⚠️ | ✅ |
| YAML frontmatter | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ |
| Emoji shortcodes | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | plugin |
| Jupyter notebooks (`.ipynb`) | ✅ | plugin | ❌ | ❌ | ❌ | ❌ | ✅ |
| JSON Canvas (`.canvas`) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | plugin |

### Editing

| Feature | Glyph | Obsidian | Typora | MarkText | Zettlr | Joplin | VS Code |
|---|---|---|---|---|---|---|---|
| Source editor | ✅ | ✅ | n/a | ✅ | ✅ | ✅ | ✅ |
| WYSIWYG / inline preview | ⚠️ | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ❌ |
| Split view | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Spell check | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### Navigation

| Feature | Glyph | Obsidian | Typora | MarkText | Zettlr | Joplin | VS Code |
|---|---|---|---|---|---|---|---|
| Tabs | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ |
| Folder / workspace (vault) sidebar | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ |
| Wikilinks & backlinks | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | plugin |
| Graph view | ✅ | ✅ | ❌ | ❌ | ❌ | plugin | plugin |
| Tag / metadata search | planned | ✅ | ❌ | ❌ | ✅ | ✅ | plugin |
| Command palette | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| In-document search | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Table of contents | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Live reload on disk change | ✅ | ⚠️ | n/a | n/a | ⚠️ | n/a | ✅ |

### Output

| Feature | Glyph | Obsidian | Typora | MarkText | Zettlr | Joplin | VS Code |
|---|---|---|---|---|---|---|---|
| Print | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Export PDF | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | plugin |
| Export HTML / DOCX / EPUB | ✅ | plugin | ✅ (Pandoc) | ⚠️ | ✅ (Pandoc) | ⚠️ | plugin |

### Power features

| Feature | Glyph | Obsidian | Typora | MarkText | Zettlr | Joplin | VS Code |
|---|---|---|---|---|---|---|---|
| AI (multi-provider, local) | ✅ | plugin | ❌ | ❌ | ❌ | ❌ | plugin |
| Text-to-speech | ✅ | plugin | ❌ | ❌ | ❌ | ❌ | plugin |
| Plugin / extension API | ⚠️ experimental | ✅ | ❌ | ❌ | ⚠️ | ✅ | ✅ |
| Cloud sync | ⚠️ Git-backed | paid | ❌ | ❌ | ❌ | ✅ | ✅ |
| Graph view | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | plugin |

### Platform

| Feature | Glyph | Obsidian | Typora | MarkText | Zettlr | Joplin | VS Code |
|---|---|---|---|---|---|---|---|
| Native window styling | ✅ (vibrancy/Mica) | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Native bundle (non-Electron) | ✅ Tauri (~3 MB core) | ❌ | ✅ Qt | ❌ | ❌ | ❌ | ❌ |
| macOS / Windows / Linux | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Mobile (iOS / Android) | planned | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| File associations + CLI | ✅ | ⚠️ | ✅ | ⚠️ | ⚠️ | ❌ | ✅ |
| Open source | ✅ MIT | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Free | ✅ | ✅ | $14.99 | ✅ | ✅ | ✅ | ✅ |

Legend: ✅ supported · ⚠️ partial / inconsistent · ❌ not supported · plugin = third-party · planned = on roadmap

Note on "WYSIWYG / inline preview": Glyph's editor has split-view live preview and styled markdown tokens (bold/italic render as bold/italic in source), but markdown markers remain visible. Typora-style fully inline rendering is not implemented.

## Privacy & Error Reporting

Glyph is local-first: your documents are read and written on your machine. Nothing is uploaded anywhere unless you opt into Cloud Sync for a workspace, which pushes that workspace to a Git remote you control.

Crash and error reporting is **opt-in and off by default**. Nothing is sent until you turn it on in **Settings → Privacy → Send crash reports**, and even then it is only active in production builds (never during development).

When enabled, reports include only:

- Stack traces of the crash or unhandled error
- Operating system and Glyph version
- The error message

They never include your file contents, file paths, file names, or any links: these are stripped from every report before it is sent. You can turn reporting off again at any time from the same setting.

## Sponsors

Glyph is free and open source. These sponsors help keep it that way.

<a href="https://sentry.io">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://sentry-brand.storage.googleapis.com/sentry-logo-white.png">
    <img src="https://sentry-brand.storage.googleapis.com/sentry-logo-black.png" alt="Sentry" height="40">
  </picture>
</a>

[**Sentry**](https://sentry.io) provides error monitoring through their Sponsored Business plan, which we use for the opt-in crash reporting above.

### Support Glyph

If Glyph is useful to you, donations are welcome via crypto:

| Network | Asset | Address |
|---|---|---|
| Solana | SOL | `<pending>` |
| BNB Smart Chain (BEP-20) | USDT | `<pending>` |
| Tron (TRC-20) | USDT | `<pending>` |
