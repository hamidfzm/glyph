# Glyph

Cross-platform markdown viewer built with Tauri v2 + React 19 + TypeScript.

## Spec-Driven Workflow

Glyph features are built through a four-stage loop where **the GitHub issue body is the single source of truth** (the spec). Each stage is a Claude slash command in `.claude/commands/`:

```
/spec  →  /plan  →  /implement  →  /ship
 idea     issue→     spec→code      review +
 →issue   plan       + tests        PR (Closes #N)
```

- **`/spec <idea>`**: Explore the codebase, then draft and create a structured issue (Problem, Proposed Solution, Acceptance Criteria, Scope, Implementation Tasks) using the [feature request template](.github/ISSUE_TEMPLATE/feature_request.yml). Labels it and adds it to the **Glyph Roadmap** board as **Todo**. Ambiguous scope is clarified with the user, never invented.
- **`/plan <issue-number>`**: Read the issue, explore affected code under `.claude/rules/`, write an implementation plan, post it as an issue comment, and create the `feat/…` or `fix/…` branch.
- **`/implement <issue-number>`**: Build the spec task-by-task with tests, ticking off acceptance criteria on the issue and running the gates (below).
- **`/ship <issue-number>`**: Review the diff with the `code-reviewer` agent, then open a PR using the [PR template](.github/PULL_REQUEST_TEMPLATE.md) with `Closes #N`.

The spec stays current throughout: acceptance-criteria and task checkboxes on the issue are ticked as work lands, so the issue always reflects real state.

## Working with AI

- **Plan before non-trivial work.** Anything beyond a one-line change starts from a spec (`/spec`) or an existing issue, not freeform edits.
- **Ask, don't guess.** When acceptance criteria or scope are ambiguous, ask the user before writing code.
- **Follow the rules in `.claude/rules/`**, which are authoritative for code organization, frontend, Rust, app-shell, docs, cleanup, CI hygiene, the worktree workflow, and Sentry issue fixes.
- **Run the gates before every PR** (the same gate the Husky pre-commit hook and CI enforce):
  ```bash
  pnpm typecheck && pnpm check && pnpm test
  cd src-tauri && cargo clippy --all-targets -- -D warnings
  ```
  Fix Biome warnings by applying the suggested fix, never by suppressing.
- **Branches** are cut from `main` as `feat/<slug>` or `fix/<slug>`, each in its own git worktree under `.claude/worktrees/`. See [.claude/rules/worktrees.md](.claude/rules/worktrees.md) for the GitHub Flow worktree workflow and how to clean up merged worktrees (see [CONTRIBUTING.md](CONTRIBUTING.md) for the wider conventions).
- **No co-authored-by lines** in commits, and no em dashes anywhere in output.

### Agents

Delegate to the project agents in `.claude/agents/` rather than doing their job inline:

- **`tester`**: runs `pnpm typecheck`, `pnpm test`, `cargo check`, `cargo clippy`; use it to gate `/implement` and `/ship`.
- **`code-reviewer`**: reviews the diff for correctness, typing, Rust error handling, security, and consistency; used by `/ship` before opening a PR.
- **`builder`**: runs the production `pnpm tauri build` and reports bundle/binary size and warnings.
- **`ui-inspector`**: audits components for accessibility, platform-adaptive styling, and dark mode.

## Community & Project Files

- [README.md](README.md): Project overview, installation, and usage
- [CONTRIBUTING.md](CONTRIBUTING.md): Development setup, commands, conventions, workflow, and release process
- [SECURITY.md](SECURITY.md): Security vulnerability reporting policy
- [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md): PR template (always use when creating PRs)
- [.github/ISSUE_TEMPLATE/](.github/ISSUE_TEMPLATE/): Bug report and feature request (spec) templates

When creating PRs, always follow the PR template. When creating issues, use the appropriate issue template.

### Closing issues from PRs and commits

To auto-close an issue, GitHub only recognizes these keywords in a PR description or commit message, each followed directly by `#<number>`: `close`, `closes`, `closed`, `fix`, `fixes`, `fixed`, `resolve`, `resolves`, `resolved`.

Do **not** use `closing` (or `closed out`, `fixing`, `resolving`, or any other variant). GitHub does not treat those as keywords, so the issue silently stays open. Write `Closes #110`, never `closing #110`.

## Architecture

- **Backend** (`src-tauri/src/`): Rust (Tauri commands, file watcher via `notify` crate, plugin setup, native menus)
- **Frontend** (`src/`): React 19 (components, hooks, styles)
- **Styling**: Tailwind CSS v4 + CSS custom properties for platform-adaptive theming
- **State**: Plain React hooks (useState/useCallback), no external state library
- File I/O goes through Rust commands, not the Tauri FS plugin directly
- File watching uses `notify` crate with events pushed via Tauri event system
- CLI args stored in Rust managed state, queried by frontend on mount

## Component Structure

- `src/components/markdown/`: Markdown rendering (MarkdownViewer, LinkComponent, ImageComponent, HeadingComponent)
- `src/components/layout/`: App shell (Sidebar, StatusBar, Titlebar, EmptyState)
- `src/components/icons/`: SVG icon components
- `src/components/modals/`: Overlay UI (SettingsModal, AIPanel)

## Releases

Run the **Create Release** workflow from GitHub Actions (`create-release.yml`) with the desired version number (e.g. `0.5.0`). It will:

1. Bump version in `package.json` and `src-tauri/Cargo.toml`
2. Update `Cargo.lock`
3. Commit and push to `main`
4. Create and push the `vX.Y.Z` tag, which triggers `release.yml`

The release workflow builds all platforms and publishes to Homebrew, Chocolatey, Scoop, AUR, PPA, the Debian apt repo, and the Fedora/RHEL dnf repo.

Do **not** create releases manually with `gh release create` or push tags by hand. Use the workflow.

## Key Files

- `src-tauri/tauri.conf.json`: App window config, CLI plugin config, bundle settings
- `src-tauri/capabilities/default.json`: Tauri permission grants
- `src-tauri/src/menu.rs`: Native menu items and keyboard shortcut accelerators
- `src/hooks/useTabs.ts`: Core file/workspace loading and tab state (CLI args + dialog)
- `src/components/App.tsx`: Root layout, menu event listeners, and theme injection
- `src/lib/settings.ts`: Settings types, defaults, and constants
- `src/contexts/SettingsContext.tsx`: Settings persistence via Tauri store
