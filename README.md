# Glyph

A modern, cross-platform markdown viewer with platform-native styling.

Built with [Tauri v2](https://v2.tauri.app), React 19, and TypeScript.

## Features

- GFM support — tables, task lists, strikethrough, code blocks with syntax highlighting
- Live reload — file watcher auto-updates the view when the file changes externally
- Table of Contents sidebar with active heading tracking
- System dark/light mode support
- Window position/size persistence across restarts
- CLI support — open files directly: `glyph README.md`

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

### Linux

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
