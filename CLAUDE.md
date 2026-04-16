# Glyph

Cross-platform markdown viewer built with Tauri v2 + React 19 + TypeScript.

## Community & Project Files

- [README.md](README.md) — Project overview, installation, and usage
- [CONTRIBUTING.md](CONTRIBUTING.md) — Development setup, commands, conventions, workflow, and release process
- [SECURITY.md](SECURITY.md) — Security vulnerability reporting policy
- [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md) — PR template (always use when creating PRs)
- [.github/ISSUE_TEMPLATE/](.github/ISSUE_TEMPLATE/) — Bug report and feature request templates

When creating PRs, always follow the PR template. When creating issues, use the appropriate issue template.

## Architecture

- **Backend** (`src-tauri/src/`): Rust — Tauri commands, file watcher via `notify` crate, plugin setup, native menus
- **Frontend** (`src/`): React 19 — components, hooks, styles
- **Styling**: Tailwind CSS v4 + CSS custom properties for platform-adaptive theming
- **State**: Plain React hooks (useState/useCallback), no external state library
- File I/O goes through Rust commands, not the Tauri FS plugin directly
- File watching uses `notify` crate with events pushed via Tauri event system
- CLI args stored in Rust managed state, queried by frontend on mount

## Component Structure

- `src/components/markdown/` — Markdown rendering (MarkdownViewer, LinkComponent, ImageComponent, HeadingComponent)
- `src/components/layout/` — App shell (Sidebar, StatusBar, Titlebar, EmptyState)
- `src/components/icons/` — SVG icon components
- `src/components/modals/` — Overlay UI (SettingsModal, AIPanel)

## Releases

Run the **Create Release** workflow from GitHub Actions (`create-release.yml`) with the desired version number (e.g. `0.5.0`). It will:

1. Bump version in `package.json` and `src-tauri/Cargo.toml`
2. Update `Cargo.lock`
3. Commit and push to `main`
4. Create and push the `vX.Y.Z` tag, which triggers `release.yml`

The release workflow builds all platforms and publishes to Homebrew, Chocolatey, Scoop, AUR, PPA, and the Debian apt repo.

Do **not** create releases manually with `gh release create` or push tags by hand — use the workflow.

## Key Files

- `src-tauri/tauri.conf.json` — App window config, CLI plugin config, bundle settings
- `src-tauri/capabilities/default.json` — Tauri permission grants
- `src-tauri/src/menu.rs` — Native menu items and keyboard shortcut accelerators
- `src/hooks/useFileLoader.ts` — Core file loading logic (CLI args + dialog)
- `src/components/App.tsx` — Root layout, menu event listeners, and theme injection
- `src/lib/settings.ts` — Settings types, defaults, and constants
- `src/contexts/SettingsContext.tsx` — Settings persistence via Tauri store
