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
- GitHub Flavored Markdown: tables, task lists, strikethrough, autolinks, footnotes
- GitHub-style alerts: `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`
- Heading anchor links: every heading gets a GitHub-compatible slug; `[text](#heading)` scrolls smoothly to the target
- Wikilinks: `[[note]]`, `[[note|alias]]`, `[[note#heading]]` resolve against the open folder workspace; broken links render with a distinct style
- Wikilink hover preview (desktop): rest the pointer on a wikilink to peek at the target note in a floating popover (a `#heading` link previews just that section); click it to open the note, or press `Esc` to dismiss. Hovering a broken link offers to create the missing note
- Note embeds: `![[note]]` and `![[note#heading]]` render another note (or one heading's section) inline in a bordered block with a control to open the source; broken targets and cycles show a placeholder
- Relative links: `[text](./note.md)`, `[text](../folder/board.canvas)`, and relative image paths resolve against the document's folder (including `../`) and open in-app, anywhere inside the open workspace; targets that would escape the workspace folder are not followed
- Backlinks panel: sidebar list of every workspace note that links to the current file, with surrounding-line snippets
- Syntax highlighting for code blocks (6 themes: Glyph, GitHub, Monokai, Nord, Solarized Light/Dark)
- Copy button on code blocks
- Math/LaTeX rendering: inline (`$...$`) and block (`$$...$$`) equations via KaTeX
- Mermaid diagrams: flowcharts, sequence diagrams, Gantt charts, and more (theme-aware); `.mmd` source files open directly as diagrams
- D2 diagrams: ` ```d2 ` code blocks render as diagrams (theme-aware); `.d2` source files open directly as diagrams
- CSV/TSV tables: ` ```csv ` and ` ```tsv ` code blocks render as styled, scrollable tables
- Inline HTML: `<kbd>`, `<sub>`, `<sup>`, `<details>`, inline `<svg>` drawings, alignment attributes (sanitised allowlist)
- YAML frontmatter: title, author, date, and tags render as a metadata block above the document; tags get a per-tag colour
- Emoji shortcodes: `:smile:` → 😊, `:+1:` → 👍
- Bidirectional text: RTL languages (Persian, Arabic, Hebrew) render right-to-left per paragraph, mixed RTL/LTR documents just work, and fully-RTL documents flip the whole layout (lists, quotes, tables); code always stays left-to-right
- Feature toggles: turn optional syntax off per taste in Settings → Markdown (GFM extras, math, alerts, emoji, wikilinks); disabled syntax renders as plain text
- Local and remote image display
- Image lightbox: click any image to view it full-size over a dark backdrop, with zoom controls (fit, actual size, zoom in/out), arrow-key navigation between the document's images, and Escape or click-outside to close
- External links open in system browser with optional confirmation dialog; right-click one to copy its address or open it in the external browser

### Editor
- Markdown editor mode: syntax highlighting, line numbers, undo/redo history
- Split view: edit and preview side-by-side, or switch between modes per tab
- Live preview updates as you type
- Wikilink autocomplete: type `[[` in a folder workspace to pick from existing notes; Tab/Enter to insert
- Editor keymaps: choose Default, Vim, or VSCode bindings in Settings → Editor
- Spell check: underline misspelled words while editing, with right-click suggestions; opt in under Settings → Editor. English ships built in; install dictionary plugins for more languages and enable several at once. Mixed-language notes stay clean: words in a script you haven't enabled a dictionary for are never flagged

### Viewer
- Jupyter notebooks: open `.ipynb` files directly; markdown cells render with full markdown (math, code, diagrams), code cells are syntax-highlighted, and image, HTML, plain-text, and colourised stream/traceback outputs show under each cell with `In [n]:` / `Out [n]:` prompts (read-only)
- Canvas: open [JSON Canvas](https://jsoncanvas.org) (`.canvas`) files as an infinite, pan-and-zoom board; cards render markdown, embedded images, links, and labelled groups, connected by arrows. View mode is read-only; switch to edit mode to move, resize, recolour (presets or any custom colour), and connect cards, edit text and connection labels inline, and add or delete nodes and edges via toolbar, double-click, or right-click menus. Task-list checkboxes toggle right on the cards in either mode. File → Export saves the board as a self-contained vector HTML page or a board-sized vector PDF (both keep the 1:1 spatial layout, with selectable text), or as a Word or EPUB document with the cards laid out as a flowing article. Edits save back as standard `.canvas` JSON that round-trips with Obsidian, with undo/redo per tab
- Images: image and SVG files (`.png`, `.jpg`, `.gif`, `.webp`, `.bmp`, `.svg`, and more) in a workspace folder show in the sidebar tree; click one to open it in a read-only viewer with fit, actual-size, and zoom controls (pan a zoomed image by scrolling)
- Folder workspaces: open a folder and it becomes the window's workspace: the sidebar tree shows its `.md`, `.canvas`, `.d2`, and image files, and clicking a note opens it as a regular tab, so any number of workspace notes can be open side by side (loose external files mix into the same tab strip). Wikilinks, backlinks, the graph, and the command palette always resolve against the open workspace, whichever tab is active. Right-click a folder, a file, or the empty panel to create a new note, canvas, or folder there, then type its name inline. Right-click any note, canvas, or folder to rename, duplicate, move, copy its path, reveal it in the system file manager, or delete it (with confirmation), and use the files-panel toolbar for new note, new folder, collapse all, and close workspace. One window holds one workspace (a git repository's top level): opening a different folder opens it in its own window (a folder that's already open is focused instead), so a second workspace never replaces the one you're in. A single file opened from outside the workspace shows as a distinct "loose" tab, marking it as an independent document rather than part of the project tree. A folder nested inside another Glyph workspace is declined so links and search have an unambiguous scope
- Graph view: `Cmd/Ctrl+G` (or View → Open Graph) maps the workspace as a force-directed graph: notes are nodes, wikilinks are edges, orphan notes render muted. Hover a note to highlight its neighbours, click to open it, drag to pan, scroll to zoom, and reset the view with one button. The graph updates live as notes change
- Multiple files in tabs: open, switch, close, middle-click to close; reorder by dragging a tab or with `Cmd/Ctrl+Shift+PageUp/PageDown`, and the order persists across restarts
- Command palette: `Cmd/Ctrl+K` to fuzzy-jump to any workspace file, document heading, or app action
- In-document search: `Cmd/Ctrl+F` with match highlighting and navigation
- Zoom in/out: `Cmd/Ctrl+=/-/0` with zoom level in status bar
- Table of Contents sidebar with active heading tracking
- Resizable panels: drag the edge of the files sidebar, outline sidebar, AI chat panel, or the backlinks divider to resize it (double-click resets); sizes persist across restarts
- Print: `Cmd/Ctrl+P` with configurable page breaks, optional TOC, and theme-color control
- Export to HTML, Word (DOCX), EPUB, and PDF via `File → Export`: works for markdown documents and Jupyter notebooks, writes a file directly (no print dialog), and reuses the rendered output (math, code highlighting, tables, images inlined) so files are self-contained and offline. Mermaid and D2 diagrams and SVG images embed in the PDF as true vectors, so they stay crisp at any zoom. Task-list checkboxes are read-only in exports; exported HTML follows the reader's light/dark system preference.
- Export an entire workspace as a static website via `File → Export → Website…` (folder workspaces): one linked HTML page per markdown file with shared styles, cross-page navigation (pages titled by their first heading), a per-page outline that highlights the section you're reading, an index built from the root index.md (falling back to the root README, then a generated page list), resolved wikilinks and relative links, copied images, and inline Mermaid diagrams. File > Workspace Settings… edits it in-app (Website tab); a `.glyph/site.json` at the workspace root optionally sets the site title, description, favicon, social-preview (Open Graph) tags, robots.txt, and the theme: a polished GitHub-style look by default (with a site header on every page linking home), "plain" for the minimal one, and plugins can contribute their own; every page gets a "Page · Site" title either way. Custom markdown syntax added by plugins renders in the exported pages just as it does in the viewer. Also available headless from the CLI (`glyph <folder> --export-website <outDir>`) for CI publishing, e.g. to GitHub Pages
- Live reload: file watcher auto-updates on external changes
- Undo / redo for in-document edits: `Cmd/Ctrl+Z` and `Cmd/Ctrl+Shift+Z` reverse task-list checkbox toggles and other programmatic edits per tab
- Drag and drop markdown files, notebooks, canvases, or folders to open
- File associations: double-click `.md` files to open in Glyph
- CLI support: `glyph README.md` opens a file; `glyph notebook.ipynb` opens a notebook; `glyph board.canvas` opens a canvas; `glyph diagram.d2` opens a diagram; `glyph ~/notes/` opens a folder as a workspace
- Recent files list
- Session restore: open tabs persist across restarts

### Sync (experimental)
- Cloud Sync (per-workspace, Git-backed): sync a folder workspace to any Git remote you control (GitHub, GitLab, or self-hosted). Pull, commit, and push changes against a chosen branch and commit identity, with a conflict policy you pick (prompt, prefer remote, or prefer local). A status-bar pill shows ahead/behind/dirty state, and **Cloud Sync…** in the command palette (`Cmd/Ctrl+K`) opens the setup. Single-file tabs sync as part of their folder workspace. Still maturing, so expect rough edges.

### Appearance
- System / Light / Dark themes
- Localized interface: follows your system language, or pick one in Settings → Appearance, with full right-to-left (RTL) layout support (community translations welcome)
- Customizable font family, size, line height, and content width
- Custom code font support
- Platform-native styling (macOS vibrancy, Windows Mica)

### AI (optional)
- AI chat sidebar: converse about the open document with streaming replies, docked beside the text (never over it)
- Quick actions: summarize, explain, translate, and simplify the document or a selection, from chips, the AI menu, or the right-click menu
- Quoted passages in replies can be located in the document with one click (scrolls and highlights the match)
- Providers: Claude, OpenAI, Ollama (local); the model list for Ollama is read from your local server
- Text-to-speech with configurable voice and speed

### Platform
- Cross-platform: macOS (universal), Windows (x64), Linux (amd64 + arm64)
- Window state persistence across restarts
- Native menu bar with customizable keyboard shortcuts (remap any command in Settings → Hotkeys)
- Update notifications: checks for a newer release on launch and shows a banner when one is available (toggle in Settings → Behavior)
- Plugins (experimental): install JavaScript plugins that extend rendering, palette commands, the status bar, spell-check dictionaries, and app styling (custom CSS/themes ship as plugins); every install asks for confirmation and shows the plugin's identity, trust mode, and declared permissions before anything is copied, and everything is managed from the Plugins… menu item (next to Settings) or the command palette (Manage Plugins…); browse the marketplace right in the app (search, categories, official badges, and a details page per plugin) or write your own with the [plugin docs](https://glyph-md.github.io/plugins/)
- Plugins run sandboxed by default: isolated from the app with file and network access limited to the permissions they declared and you accepted. A plugin that opts out of the sandbox (declaring `"sandbox": false`) needs a separate, explicit full-access grant (with its own warning), updates that request new permissions ask again, and marketplace downloads are checksum-verified before install. Plugins installed before sandboxing became the default now run sandboxed too; one that needs full access stops loading until it ships an update that declares `"sandbox": false`, which you then approve once through that same warning

### Privacy
- Local-first: your files never leave your machine unless you opt into Cloud Sync (per workspace, to a Git remote you control)
- Opt-in crash reporting (off by default) to help fix bugs (see [Privacy & Error Reporting](#privacy--error-reporting))

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
