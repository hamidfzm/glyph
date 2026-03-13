# Glyph

Cross-platform markdown viewer built with Tauri v2 + React 19 + TypeScript.

## Commands

```bash
pnpm install                    # Install frontend dependencies
pnpm tauri dev                  # Run in development (starts Vite + Cargo)
pnpm tauri dev -- -- /path.md   # Dev mode with a file argument
pnpm tauri build                # Production build
pnpm typecheck                  # TypeScript type checking
cd src-tauri && cargo check     # Rust type checking
cd src-tauri && cargo clippy    # Rust linting
```

## Architecture

- **Backend** (`src-tauri/src/`): Rust — Tauri commands, file watcher via `notify` crate, plugin setup
- **Frontend** (`src/`): React 19 — components, hooks, styles
- **Styling**: Tailwind CSS v4 + CSS custom properties for platform-adaptive theming
- **State**: Plain React hooks (useState/useCallback), no external state library
- File I/O goes through Rust commands, not the Tauri FS plugin directly
- File watching uses `notify` crate with events pushed via Tauri event system
- CLI args stored in Rust managed state, queried by frontend on mount

## Branch Protection

- `main` requires CI to pass on all 3 platforms before merge
- Strict status checks — branch must be up to date with `main`
- Linear history enforced (rebase/squash only, no merge commits)
- No force pushes or branch deletion on `main`

## Conventions

- **Commits**: Use conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`)
- **No co-authored-by** lines in commits
- **Package manager**: pnpm only (not npm/yarn)
- **Formatting**: Use default Prettier/rustfmt conventions
- **Imports**: Named exports, no default exports

## Key Files

- `src-tauri/tauri.conf.json` — App window config, CLI plugin config, bundle settings
- `src-tauri/capabilities/default.json` — Tauri permission grants
- `src/hooks/useFileLoader.ts` — Core file loading logic (CLI args + dialog)
- `src/components/App.tsx` — Root layout and keyboard shortcuts
