# Contributing to Glyph

Thanks for your interest in contributing!

## Development Setup

```bash
# Prerequisites: Node.js (see .nvmrc), pnpm, Rust stable, plus platform deps (below)
git clone https://github.com/hamidfzm/glyph.git
cd glyph
nvm use          # or fnm use (reads .nvmrc)
pnpm install     # also installs the Husky git hooks via `prepare`
pnpm tauri dev
```

### Platform prerequisites

Glyph is built on [Tauri v2](https://v2.tauri.app/), which needs a system toolchain in addition to Node.js, pnpm, and Rust. See [Tauri's prerequisites page](https://v2.tauri.app/start/prerequisites/) for the canonical list. Quick reference per OS:

**Windows** (via [Chocolatey](https://chocolatey.org/install), run PowerShell as Administrator):

```powershell
choco install -y visualstudio2022buildtools visualstudio2022-workload-vctools rustup.install nvm pnpm
# WebView2 ships with Windows 10 1803+ and Windows 11. If missing:
choco install -y webview2-runtime
```

After `rustup.install`, open a new shell and run `rustup default stable-msvc`. Then `nvm install` (reads `.nvmrc`) and `pnpm install`.

> **Important:** Use the `stable-msvc` Rust toolchain, not `stable-gnu`. If MSYS2 is on your PATH (or rustup picked the GNU host during install), builds fail with errors like `C:\msys64\usr\bin\dlltool.exe ... Permission denied` when compiling `getrandom`, `parking_lot_core`, or `windows-sys`, especially if your user folder contains a space (e.g. `C:\Users\Jane Doe\...`), because MinGW's `dlltool` does not handle spaces in paths. Run `rustup show` to confirm the default host is `x86_64-pc-windows-msvc`. To switch:
>
> ```powershell
> rustup toolchain install stable-msvc
> rustup default stable-msvc
> rustup set default-host x86_64-pc-windows-msvc
> cd src-tauri; cargo clean   # remove gnu-built artifacts before rebuilding
> ```

**macOS**:

```bash
xcode-select --install                          # Command Line Tools
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
brew install node pnpm                          # or use nvm/fnm for Node
```

**Linux, Debian / Ubuntu**:

```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# Install Node via nvm/fnm (reads .nvmrc), then `npm i -g pnpm`
```

**Linux, Fedora**:

```bash
sudo dnf install -y webkit2gtk4.1-devel openssl-devel curl wget file \
  libappindicator-gtk3-devel librsvg2-devel libxdo-devel gcc gcc-c++ make
```

**Linux, Arch**:

```bash
sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl \
  appmenu-gtk-module libappindicator-gtk3 librsvg xdotool
```

### Git hooks

`pnpm install` registers a Husky pre-commit hook that runs the same gate CI runs, so a green commit is a green PR build:

1. **lint-staged**: Biome formats and lints staged `src/**/*.{ts,tsx,js,jsx,css}` files (auto-fixes and re-stages); `cargo fmt --check` runs once if any `src-tauri/**/*.rs` is staged.
2. `pnpm typecheck`
3. `pnpm test --run`
4. `cargo test --lib` (in `src-tauri/`)
5. `cargo clippy --all-targets -- -D warnings` (in `src-tauri/`)

Budget roughly 1–2 minutes on a clean working tree. The fast lint-staged step gates the slow tests so a formatter miss fails in seconds.

To bypass in a genuine emergency: `git commit --no-verify`. Don't make a habit of it. CI runs the same gate and will reject the PR.

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
pnpm test:e2e                   # WebKit smoke tests (Playwright; run `pnpm exec playwright install webkit` once first)
cd src-tauri && cargo check     # Rust type checking
cd src-tauri && cargo clippy    # Rust linting
cd src-tauri && cargo test      # Rust tests
```

### Mobile: Android and iOS (experimental)

Glyph also builds as an Android and iOS app (see issue #79; single-file
viewing only, desktop features like folder workspaces, sync, and printing are
gated off).

**Android** prerequisites: JDK 17+, the Android SDK with NDK (set
`ANDROID_HOME`, `NDK_HOME`, and `JAVA_HOME`), and the Rust targets:

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

```bash
pnpm tauri android dev                          # Run on a connected device/emulator
pnpm tauri android build --debug --apk          # Unsigned debug APK
cd src-tauri && cargo check --target aarch64-linux-android --lib   # Fast compile check
```

**iOS** requires a Mac with Xcode (including the iOS Simulator runtime) and
CocoaPods (`brew install cocoapods`), plus the Rust targets:

```bash
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
```

```bash
pnpm tauri ios dev "iPhone 17"                  # Run in the named Simulator
pnpm tauri ios build                            # Release build (needs signing for devices)
cd src-tauri && cargo check --target aarch64-apple-ios --lib       # Fast compile check
```

Running on a physical device needs an Apple Developer team id, set via the
`TAURI_APPLE_DEVELOPMENT_TEAM` env var (don't commit it); the Simulator needs
no signing.

The mobile projects under `src-tauri/gen/android/` and `src-tauri/gen/apple/`
are generated by `pnpm tauri android init` / `pnpm tauri ios init` and
committed; regenerate them only when the Tauri CLI requires it.

## Conventions

- **Commits**: [Conventional commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`)
- **No co-authored-by** lines in commits
- **Package manager**: pnpm only (not npm/yarn)
- **Linting (TS)**: Biome (configured in `biome.json`); run `pnpm lint`
- **Linting (Rust)**: Clippy; run `cargo clippy` in `src-tauri/`
- **Formatting**: Biome for TypeScript, rustfmt for Rust
- **Testing (TS)**: Vitest + Testing Library; test files colocated as `*.test.{ts,tsx}`
- **Testing (Rust)**: `#[cfg(test)]` modules in source files
- **Imports**: Named exports, no default exports
- **Issue titles**: imperative mood (e.g. "Add search within document", not "Search feature" or "feat: search"). Always tag with `enhancement`/`bug` + a `priority: *` label + a category label (`markdown`/`ui`/`navigation`) where it fits. Add new issues to the **Glyph Roadmap** project board with status **Todo**.

## Translations

The UI is localized with [react-i18next](https://react.i18next.com/). Translations live **in this repo** under `src/locales/<code>/`, one JSON file per namespace (`common`, `settings`, ...). English (`src/locales/en/`) is the source of truth and the runtime fallback for any missing key.

**Adding a UI string:**
1. Add the key to the relevant `src/locales/en/<namespace>.json`.
2. Reference it with `useTranslation("<namespace>")` → `t("my.key")`, or `<Trans>` when the copy contains inline markup (see `EmptyState.tsx`).
3. Add the same key to the other locale files (or leave them to translators; the English fallback keeps the UI working meanwhile).

**Translating into a new language:**
1. Create `src/locales/<code>/` (a BCP-47 tag, e.g. `fr`, `pt-BR`, `zh-Hans`) and copy the `en` JSON files into it, translating the values.
2. Add a `{ code, name, nativeName, dir }` entry to `LOCALES` in `src/lib/locales.ts`.
3. Run `pnpm typecheck && pnpm test`. The language then appears in Settings → Appearance.

No `i18n.ts` edit is needed: every non-`en` locale is **lazy-loaded** and code-split (an `import.meta.glob` discovers `src/locales/*/*.json` automatically), so its JSON is fetched only when a user selects it and never weighs down the main bundle. English is bundled inline as the synchronous fallback.

Right-to-left locales (Arabic, Hebrew, Persian) are supported: set `dir: "rtl"` in the `src/lib/locales.ts` entry and the layout mirrors automatically. The UI uses CSS logical properties (`margin-inline-*`, `inset-inline-*`, `text-start/end`, Tailwind `ms-/me-/ps-/pe-/start-/end-`) rather than physical `left`/`right`, so prefer those in new styles. Spatial surfaces that are coordinate-based (the canvas board, the graph) deliberately stay physical and do not mirror.

**Plugins** can ship their own translations at runtime via `registerTranslations(lng, ns, resources)` from `src/lib/i18n.ts`, which deep-merges a bundle into a locale/namespace (the extension point for the plugin system, #255).

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

- Use the [PR template](.github/PULL_REQUEST_TEMPLATE.md) and fill in all sections
- **Link to the issue**: include `Closes #N` in the PR body so the issue auto-closes on merge
- Keep PRs focused: one feature or fix per PR
- Include tests for new functionality
- Ensure CI passes on all 3 platforms (macOS, Windows, Linux)
- Use conventional commit style for the PR title (e.g. `feat: add search`)

### Branch Protection

- `main` requires CI to pass on all 3 platforms before merge
- Strict status checks: branch must be up to date with `main`
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

The release workflow builds all platforms and publishes to Homebrew, Chocolatey, Scoop, AUR, PPA, the Debian apt repo, and the Fedora/RHEL dnf repo.

Do **not** create releases manually with `gh release create` or push tags by hand. Use the workflow.

**Wait for CI to pass on `main` before triggering Create Release.** The release workflow assumes the latest commit is green; running it on a red `main` produces broken artifacts that get published to every package manager simultaneously. Check the CI badge or `gh run list --branch main --limit 1` first.

### Post-release smoke test

The **Release Smoke Test** workflow (`release-smoke-test.yml`) installs Glyph from every package channel (Homebrew cask and formula, Scoop, Chocolatey, winget, apt, PPA, dnf, Snap, AUR) on a matching runner, asserts the installed version matches the release, and on Linux verifies the app launches. It runs automatically once per release, 2 to 3 days after publish (slow channels like Chocolatey moderation and the PPA build queue need the head start), and can be dispatched manually anytime with an optional tag input. Channels that do not serve the version yet report **pending** without failing the run; the run summary shows a per-channel verified/pending/failed table.

## Reporting Issues

- **Bugs**: Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.yml)
- **Features**: Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.yml)
- **Security**: See [SECURITY.md](SECURITY.md); do **not** open public issues for vulnerabilities

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
