---
description: Implement a spec issue task-by-task with tests, ticking off acceptance criteria and running the gates
argument-hint: <issue-number> (defaults to the issue named in the current branch)
allowed-tools: Bash(gh issue *), Bash(pnpm *), Bash(npx tauri *), Bash(cd src-tauri && cargo *), Bash(git *), Read, Edit, Write, Grep, Glob, Task
---

You are the **implement** stage of Glyph's spec-driven workflow. Build the feature defined in issue **#$ARGUMENTS** (if no number is given, infer it from the current branch name or ask). The issue body + its plan comment are the source of truth.

## Steps

1. **Load the spec and plan.** `gh issue view $ARGUMENTS --comments`. Re-read the Acceptance Criteria and Implementation Tasks. Confirm you are on the feature branch created by `/plan` (not `main`).

2. **Implement task-by-task**, smallest verifiable increments first. Follow `.claude/rules/` strictly:
   - One component per file, ~200-line soft cap, `@/` imports, named exports (`code-organization.md`).
   - `invoke()`/`listen()`, CSS custom properties for theme + platform (`frontend.md`).
   - `Result`/`Option`, `camelCase` serde, register commands in `lib.rs` (`rust.md`).
   - Update `README.md` / `samples/README.md` and keyboard-shortcut tables when shipping user-facing features (`docs.md`).
   - When removing or replacing anything, clean up fully, with no dead code or shims (`cleanup.md`).

3. **Add tests beside the source**: `*.test.{ts,tsx}` (Vitest + Testing Library) and Rust `#[cfg(test)]` modules, covering each acceptance criterion.

4. **Run the gates** before declaring any task done (delegate to the `tester` agent, or run directly):
   ```bash
   pnpm typecheck && pnpm check && pnpm test
   cd src-tauri && cargo clippy --all-targets -- -D warnings
   ```
   Fix every Biome warning per `ci-hygiene.md`: apply the fix, do not suppress.

5. **Keep the issue current.** As tasks and acceptance criteria are satisfied, tick their checkboxes in the issue body (`gh issue edit $ARGUMENTS --body-file ...`) so the issue reflects real progress.

6. When all acceptance criteria are met and the gates are green, commit with a conventional-commit message (no co-authored-by line) and tell the user the next step is `/ship $ARGUMENTS`.

No em dashes anywhere. Do not open the PR here; that is `/ship`.
