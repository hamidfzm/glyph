# Glyph — Copilot Instructions

Cross-platform markdown viewer built with Tauri v2, React 19, and TypeScript.

## Architecture

- **Backend** (`src-tauri/src/`): Rust — Tauri commands, file watcher, native menus
- **Frontend** (`src/`): React 19 — components, hooks, styles
- **Styling**: Tailwind CSS v4 + CSS custom properties for platform-adaptive theming
- **State**: Plain React hooks (useState/useCallback), no external state library

## Conventions

- Named exports only — no default exports
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`
- No co-authored-by lines in commits
- Package manager: pnpm only
- TypeScript linting/formatting: Biome (`pnpm check`)
- Rust linting: Clippy (`cargo clippy` in `src-tauri/`)
- Tests: Vitest + Testing Library, colocated as `*.test.{ts,tsx}`
- Rust tests: `#[cfg(test)]` modules in source files
- CSS: use `var(--color-*)` and `var(--glyph-*)` custom properties, never hardcoded colors
- Platform styling: CSS custom properties via `[data-platform]` selectors, not JSX conditionals
- Tauri commands: `invoke` from `@tauri-apps/api/core`
- Tauri events: `listen` from `@tauri-apps/api/event`
- Rust commands: return `Result<T, String>`, structs use `serde(rename_all = "camelCase")`

## Key Commands

```bash
pnpm typecheck        # TypeScript type checking
pnpm check            # Biome lint + format + organize imports
pnpm test             # Run Vitest tests
cargo clippy          # Rust linting (run in src-tauri/)
cargo test            # Rust tests (run in src-tauri/)
```

## PR Guidelines

- Use the PR template (`.github/PULL_REQUEST_TEMPLATE.md`)
- Reference issues with `Closes #N`
- CI must pass on all 3 platforms (macOS, Windows, Linux)
- Linear history enforced (rebase/squash only)
