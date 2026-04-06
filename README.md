# Glyph

A modern, cross-platform markdown viewer with platform-native styling.

Built with [Tauri v2](https://v2.tauri.app), React 19, and TypeScript.

## Screenshots

Add `hero.png` and `demo.gif` under [`docs/assets/`](docs/assets/) (see [`docs/assets/README.md`](docs/assets/README.md)). Until then, the images below are path placeholders.

![Glyph — main window](docs/assets/hero.png)

![Glyph — short demo](docs/assets/demo.gif)

## Features

### Markdown Rendering
- GitHub Flavored Markdown — tables, task lists, strikethrough, autolinks
- Syntax highlighting for code blocks (6 themes: Glyph, GitHub, Monokai, Nord, Solarized Light/Dark)
- Local and remote image display
- External links open in system browser with optional confirmation dialog

### Viewer
- Table of Contents sidebar with active heading tracking
- Live reload — file watcher auto-updates on external changes
- Drag and drop markdown files to open
- File associations — double-click `.md` files to open in Glyph
- CLI support — `glyph README.md`
- Recent files list

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
- Native menu bar with keyboard shortcuts

### Roadmap

See [open issues](https://github.com/hamidfzm/glyph/issues) for planned features including:
tabs, in-document search, PDF export, math/LaTeX, Mermaid diagrams, zoom, footnotes, and more.

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

### Arch Linux (AUR)

```bash
yay -S glyph-md-bin
```

### Debian/Ubuntu (PPA)

```bash
sudo add-apt-repository ppa:hamidfzm/glyph
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

Open a file via CLI argument:

```bash
pnpm tauri dev -- -- /path/to/file.md
```

Build for production:

```bash
pnpm tauri build
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+O` / `Ctrl+O` | Open file |
| `Cmd+B` / `Ctrl+B` | Toggle sidebar |
| `Cmd+W` / `Ctrl+W` | Close window |

## License

MIT
