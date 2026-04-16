# Contributing to Glyph

Thanks for your interest in contributing!

## Development Setup

```bash
# Prerequisites: Node.js (see .nvmrc), pnpm, Rust stable
git clone https://github.com/hamidfzm/glyph.git
cd glyph
nvm use          # or fnm use — reads .nvmrc
pnpm install
pnpm tauri dev
```

## Development Commands

```bash
pnpm install                    # Install frontend dependencies
pnpm tauri dev                  # Run in development (starts Vite + Cargo)
pnpm tauri dev -- -- /path.md   # Dev mode with a file argument
pnpm tauri build                # Production build
pnpm typecheck                  # TypeScript type checking
pnpm lint                       # Lint TypeScript with Biome
pnpm format:check               # Check formatting with Biome
pnpm format                     # Auto-format with Biome
pnpm check                      # Biome lint + format + organize imports
pnpm check:fix                  # Auto-fix all Biome issues
pnpm test                       # Run frontend tests (Vitest)
pnpm test:watch                 # Run frontend tests in watch mode
pnpm test:coverage              # Run frontend tests with coverage
cd src-tauri && cargo check     # Rust type checking
cd src-tauri && cargo clippy    # Rust linting
cd src-tauri && cargo test      # Rust tests
```

## Conventions

- **Commits**: [Conventional commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`)
- **No co-authored-by** lines in commits
- **Package manager**: pnpm only (not npm/yarn)
- **Linting (TS)**: Biome (configured in `biome.json`) — run `pnpm lint`
- **Linting (Rust)**: Clippy — run `cargo clippy` in `src-tauri/`
- **Formatting**: Biome for TypeScript, rustfmt for Rust
- **Testing (TS)**: Vitest + Testing Library — test files colocated as `*.test.{ts,tsx}`
- **Testing (Rust)**: `#[cfg(test)]` modules in source files
- **Imports**: Named exports, no default exports

## Workflow

1. Check the [GitHub Issues](https://github.com/hamidfzm/glyph/issues) for open tasks
2. Create a branch from `main` (e.g. `feat/search`, `fix/link-opening`)
3. Make your changes following the conventions above
4. Run all checks before submitting:
   ```bash
   pnpm typecheck && pnpm check && pnpm test
   cd src-tauri && cargo clippy
   ```
5. Open a pull request referencing the issue (e.g. `Closes #7`)

### Pull Requests

- Use the [PR template](.github/PULL_REQUEST_TEMPLATE.md) — fill in all sections
- **Link to the issue** — include `Closes #N` in the PR body so the issue auto-closes on merge
- Keep PRs focused — one feature or fix per PR
- Include tests for new functionality
- Ensure CI passes on all 3 platforms (macOS, Windows, Linux)
- Use conventional commit style for the PR title (e.g. `feat: add search`)

### Branch Protection

- `main` requires CI to pass on all 3 platforms before merge
- Strict status checks — branch must be up to date with `main`
- Linear history enforced (rebase/squash only, no merge commits)
- No force pushes or branch deletion on `main`

### Project Board

- **GitHub Project**: "Glyph Roadmap" (kanban board linked to this repo)
- Move issues to **In Progress** when starting work
- After merge, issues move to **Done** automatically via linked issue resolution
- New feature ideas: create a GitHub issue and add to the board as **Todo**

## Releases

Run the **Create Release** workflow from GitHub Actions (`create-release.yml`) with the desired version number (e.g. `0.5.0`). It will:

1. Bump version in `package.json` and `src-tauri/Cargo.toml`
2. Update `Cargo.lock`
3. Commit and push to `main`
4. Create and push the `vX.Y.Z` tag, which triggers `release.yml`

The release workflow builds all platforms and publishes to Homebrew, Chocolatey, Scoop, AUR, PPA, and the Debian apt repo.

Do **not** create releases manually with `gh release create` or push tags by hand — use the workflow.

## Reporting Issues

- **Bugs**: Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.yml)
- **Features**: Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.yml)
- **Security**: See [SECURITY.md](SECURITY.md) — do **not** open public issues for vulnerabilities

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
