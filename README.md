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

The [`samples/`](samples) directory is a tiny demo workspace — open it as a folder (`Cmd/Ctrl+Shift+O`) to see every rendering feature plus working wikilinks. [`samples/README.md`](samples/README.md) is the showcase document; the surrounding files exist so its `[[wikilinks]]` resolve.

## Features

### Markdown Rendering
- GitHub Flavored Markdown — tables, task lists, strikethrough, autolinks, footnotes
- GitHub-style alerts — `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`
- Heading anchor links — every heading gets a GitHub-compatible slug; `[text](#heading)` scrolls smoothly to the target
- Wikilinks — `[[note]]`, `[[note|alias]]`, `[[note#heading]]` resolve against the open folder workspace; broken links render with a distinct style
- Backlinks panel — sidebar list of every workspace note that links to the current file, with surrounding-line snippets
- Syntax highlighting for code blocks (6 themes: Glyph, GitHub, Monokai, Nord, Solarized Light/Dark)
- Copy button on code blocks
- Math/LaTeX rendering — inline (`$...$`) and block (`$$...$$`) equations via KaTeX
- Mermaid diagrams — flowcharts, sequence diagrams, Gantt charts, and more (theme-aware); `.mmd` source files open directly as diagrams
- CSV/TSV tables — ` ```csv ` and ` ```tsv ` code blocks render as styled, scrollable tables
- Inline HTML — `<kbd>`, `<sub>`, `<sup>`, `<details>`, alignment attributes (sanitised allowlist)
- YAML frontmatter — title, author, date, and tags render as a metadata block above the document; tags get a per-tag colour
- Emoji shortcodes — `:smile:` → 😊, `:+1:` → 👍
- Local and remote image display
- External links open in system browser with optional confirmation dialog

### Editor
- Markdown editor mode — syntax highlighting, line numbers, undo/redo history
- Split view — edit and preview side-by-side, or switch between modes per tab
- Live preview updates as you type
- Wikilink autocomplete — type `[[` in a folder workspace to pick from existing notes; Tab/Enter to insert
- Editor keymaps — choose Default, Vim, or VSCode bindings in Settings → Editor

### Viewer
- Jupyter notebooks — open `.ipynb` files directly; markdown cells render with full markdown (math, code, diagrams), code cells are syntax-highlighted, and image, HTML, plain-text, and colourised stream/traceback outputs show under each cell with `In [n]:` / `Out [n]:` prompts (read-only)
- Canvas — open [JSON Canvas](https://jsoncanvas.org) (`.canvas`) files as an infinite, pan-and-zoom board; cards render markdown, embedded images, links, and labelled groups, connected by arrows. View mode is read-only; switch to edit mode to move, resize, recolour (presets or any custom colour), and connect cards, edit text and connection labels inline, and add or delete nodes and edges via toolbar, double-click, or right-click menus. Task-list checkboxes toggle right on the cards in either mode. File → Export saves the board as a self-contained vector HTML page or a board-sized vector PDF (both keep the 1:1 spatial layout, with selectable text), or as a Word or EPUB document with the cards laid out as a flowing article. Edits save back as standard `.canvas` JSON that round-trips with Obsidian, with undo/redo per tab
- Folder / workspace tabs — open a folder as a tab; browse `.md` and `.canvas` files in the sidebar tree; right-click a file to open it in a new top-level tab. Right-click a folder, a file, or the empty panel to create a new note, canvas, or folder there, then type its name inline. Right-click any note, canvas, or folder to rename, duplicate, move, copy its path, reveal it in the system file manager, or delete it (with confirmation), and use the files-panel toolbar for new note, new folder, and collapse all. One folder is one workspace (a git repository's top level): a folder nested inside another repo, or overlapping an already-open one, is declined so links and search have an unambiguous scope
- Multiple files in tabs — open, switch, close, middle-click to close
- Command palette — `Cmd/Ctrl+K` to fuzzy-jump to any workspace file, document heading, or app action
- In-document search — `Cmd/Ctrl+F` with match highlighting and navigation
- Zoom in/out — `Cmd/Ctrl+=/-/0` with zoom level in status bar
- Table of Contents sidebar with active heading tracking
- Print — `Cmd/Ctrl+P` with configurable page breaks, optional TOC, and theme-color control
- Export to HTML, Word (DOCX), EPUB, and PDF — `File → Export`; works for markdown documents and Jupyter notebooks, writes a file directly (no print dialog), and reuses the rendered output (math, code highlighting, tables, images inlined) so files are self-contained and offline. Task-list checkboxes are read-only in exports; exported HTML follows the reader's light/dark system preference.
- Live reload — file watcher auto-updates on external changes
- Undo / redo for in-document edits — `Cmd/Ctrl+Z` and `Cmd/Ctrl+Shift+Z` reverse task-list checkbox toggles and other programmatic edits per tab
- Drag and drop markdown files, notebooks, canvases, or folders to open
- File associations — double-click `.md` files to open in Glyph
- CLI support — `glyph README.md` opens a file; `glyph notebook.ipynb` opens a notebook; `glyph board.canvas` opens a canvas; `glyph ~/notes/` opens a folder as a workspace
- Recent files list
- Session restore — open tabs persist across restarts

### Sync (experimental)
- Cloud Sync (per-workspace, Git-backed): sync a folder workspace to any Git remote you control (GitHub, GitLab, or self-hosted). Pull, commit, and push changes against a chosen branch and commit identity, with a conflict policy you pick (prompt, prefer remote, or prefer local). A status-bar pill shows ahead/behind/dirty state, and **Cloud Sync…** in the command palette (`Cmd/Ctrl+K`) opens the setup. Single-file tabs sync as part of their folder workspace. Still maturing, so expect rough edges.

### Appearance
- System / Light / Dark themes
- Customizable font family, size, line height, and content width
- Custom code font support
- Platform-native styling (macOS vibrancy, Windows Mica)

### AI (optional)
- Summarize, explain, translate, and simplify documents
- Providers: Claude, OpenAI, Ollama (local)
- Text-to-speech with configurable voice and speed

### Platform
- Cross-platform: macOS (universal), Windows (x64), Linux (amd64 + arm64)
- Window state persistence across restarts
- Native menu bar with customizable keyboard shortcuts (remap any command in Settings → Hotkeys)
- Update notifications — checks for a newer release on launch and shows a banner when one is available (toggle in Settings → Behavior)

### Privacy
- Local-first: your files never leave your machine unless you opt into Cloud Sync (per workspace, to a Git remote you control)
- Opt-in crash reporting (off by default) to help fix bugs — see [Privacy & Error Reporting](#privacy--error-reporting)

## Install

### macOS (Homebrew)

```bash
brew tap hamidfzm/tap
brew install --cask glyph
```

### Windows (Chocolatey)

```powershell
choco install glyph
```

### Windows (Scoop)

```powershell
scoop bucket add hamidfzm https://github.com/hamidfzm/scoop-bucket
scoop install glyph
```

### Arch Linux (AUR)

```bash
yay -S glyph-md-bin
```

### Linux (Homebrew)

```bash
brew tap hamidfzm/tap
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
curl -fsSL https://hamidfzm.github.io/apt-repo/gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/glyph.gpg
echo "deb [signed-by=/usr/share/keyrings/glyph.gpg] https://hamidfzm.github.io/apt-repo stable main" | sudo tee /etc/apt/sources.list.d/glyph.list
sudo apt update
sudo apt install glyph
```

### Linux (manual)

Download the `.deb` or `.AppImage` from [Releases](https://github.com/hamidfzm/glyph/releases).

```bash
# Debian/Ubuntu
sudo dpkg -i glyph_*.deb

# AppImage
chmod +x Glyph_*.AppImage
./Glyph_*.AppImage
```

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

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+O` / `Ctrl+O` | Open file(s) |
| `Cmd+Shift+O` / `Ctrl+Shift+O` | Open folder |
| `Cmd+K` / `Ctrl+K` | Command palette (files, headings, app actions) |
| `Cmd+P` / `Ctrl+P` | Print / Export to PDF |
| `Cmd+F` / `Ctrl+F` | Find in document |
| `Cmd+=` / `Ctrl+=` | Zoom in |
| `Cmd+-` / `Ctrl+-` | Zoom out |
| `Cmd+0` / `Ctrl+0` | Reset zoom |
| `Cmd+Z` / `Ctrl+Z` | Undo last in-document edit (e.g. task checkbox toggle) |
| `Cmd+Shift+Z` / `Ctrl+Shift+Z` (also `Ctrl+Y` on Windows/Linux) | Redo |
| `Cmd+B` / `Ctrl+B` | Toggle files sidebar |
| `Cmd+\` / `Ctrl+\` | Toggle outline sidebar |
| `Cmd+,` / `Ctrl+,` | Settings |
| `Cmd+W` / `Ctrl+W` | Close tab |
| `Cmd+Shift+W` / `Ctrl+Shift+W` | Close window |

## Comparison with Other Markdown Apps

Glyph is built around speed, native feel, and offline-first usage. The tables below compare its current capabilities against widely used markdown apps. Items marked "planned" track to issues on the [roadmap](https://github.com/hamidfzm/glyph/issues).

### Rendering

| Feature | Glyph | Obsidian | Typora | MarkText | Zettlr | Joplin | VS Code |
|---|---|---|---|---|---|---|---|
| GitHub Flavored Markdown | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Math (KaTeX/MathJax) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | plugin |
| Mermaid diagrams | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | plugin |
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
| Spell check | planned | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### Navigation

| Feature | Glyph | Obsidian | Typora | MarkText | Zettlr | Joplin | VS Code |
|---|---|---|---|---|---|---|---|
| Tabs | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ |
| Folder / workspace (vault) sidebar | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ |
| Wikilinks & backlinks | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | plugin |
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
| Plugin / extension API | planned | ✅ | ❌ | ❌ | ⚠️ | ✅ | ✅ |
| Cloud sync | ⚠️ Git-backed | paid | ❌ | ❌ | ❌ | ✅ | ✅ |
| Graph view | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | plugin |

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

Note on "WYSIWYG / inline preview": Glyph's editor has split-view live preview and styled markdown tokens (bold/italic render as bold/italic in source), but markdown markers remain visible — Typora-style fully inline rendering is not implemented.

## Privacy & Error Reporting

Glyph is local-first: your documents are read and written on your machine. Nothing is uploaded anywhere unless you opt into Cloud Sync for a workspace, which pushes that workspace to a Git remote you control.

Crash and error reporting is **opt-in and off by default**. Nothing is sent until you turn it on in **Settings → Privacy → Send crash reports**, and even then it is only active in production builds (never during development).

When enabled, reports include only:

- Stack traces of the crash or unhandled error
- Operating system and Glyph version
- The error message

They never include your file contents, file paths, file names, or any links — these are stripped from every report before it is sent. You can turn reporting off again at any time from the same setting.

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
