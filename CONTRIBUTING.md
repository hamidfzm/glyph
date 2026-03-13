# Contributing to Glyph

Thanks for your interest in contributing!

## Development Setup

```bash
# Prerequisites: Node.js 22+, pnpm, Rust stable
git clone https://github.com/hamidfzm/glyph.git
cd glyph
pnpm install
pnpm tauri dev
```

## Workflow

1. Fork and clone the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes
4. Run checks:
   ```bash
   pnpm typecheck
   cd src-tauri && cargo clippy
   ```
5. Commit using [conventional commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `chore:`, etc.
6. Open a pull request against `main`

## Architecture

- **Backend** (`src-tauri/`): Rust with Tauri v2 — commands, file watcher, menus
- **Frontend** (`src/`): React 19 + TypeScript — components and hooks
- **Styling**: Tailwind CSS v4 with CSS custom properties for platform-adaptive theming

## Guidelines

- Keep PRs focused — one feature or fix per PR
- Add yourself to the contributors list if this is your first PR
- Test on your platform before submitting
- No default exports — use named exports only
