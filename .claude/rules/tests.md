---
paths:
  - "src/**/*.test.{ts,tsx}"
  - "src/test/**"
  - "src-tauri/src/**/*.rs"
---

# Test Rules

## Frontend (Vitest + Testing Library)

- Tests are colocated: `Foo.tsx` sits next to `Foo.test.tsx`. No `__tests__/` directories.
- **Prop scaffolding**: when a component test file renders the component 3+ times, declare a module-level `const defaultProps = { ... }` with `vi.fn()` for callbacks and spread it: `render(<Foo {...defaultProps} query="x" />)`. Overrides go at the call site, not in per-test copies of the object.
- When asserting a callback, create a fresh `vi.fn()` in that test and pass it as an override; don't assert on the shared `defaultProps` mock.
- **Shared helpers live in `src/test/`** (e.g. `renderInWorkspace` for tests that need a workspace root in context). Add a helper there only when 2+ test files need it; a helper used by one file stays in that file.
- **Fixtures**: sample data reused across test files (tabs, TOC entries, DirEntry trees) goes in `src/test/fixtures/`. Data used by one file stays inline in that file.
- Mock Tauri modules per file with `vi.mock("@tauri-apps/api/core")` etc.; mock only the modules the file under test touches.
- Query priority: prefer `getByRole` with an accessible name, then `getByText`; reach for `container` queries only for non-semantic DOM (canvas, SVG internals).

## Rust

- Unit tests live in `#[cfg(test)]` modules in the same file as the code under test.
- A module whose test block outgrows the source it tests (roughly 200+ lines) may move to a sibling `tests.rs` submodule, as `sync/git/tests.rs` does.

## Both

- Tests assert behavior, not implementation: no snapshot tests, no asserting on internal state shape.
- Every gate must stay green: `pnpm typecheck && pnpm check && pnpm test`, and `cargo clippy --all-targets -- -D warnings` in `src-tauri/`.
