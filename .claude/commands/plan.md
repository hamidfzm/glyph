---
description: Read a GitHub issue (the spec) and produce an implementation plan, post it back, and create the branch
argument-hint: <issue-number>
allowed-tools: Bash(gh issue *), Bash(gh project *), Bash(git *), Read, Grep, Glob, Task
---

You are the **plan** stage of Glyph's spec-driven workflow. Turn the spec in issue **#$ARGUMENTS** into a concrete implementation plan. Do not write feature code yet.

## Steps

1. **Read the spec.** `gh issue view $ARGUMENTS --comments`. Treat the issue body as the source of truth; its Acceptance Criteria define done.

2. **Explore the affected code.** Launch an `Explore` agent (or read directly) over the areas the spec names. Read the relevant `.claude/rules/` before planning so the plan already respects them:
   - `code-organization.md`: one component per file, ~200-line soft cap, `@/` imports, tests beside source.
   - `frontend.md`: `invoke()`/`listen()`, theme + platform via CSS custom properties.
   - `rust.md`: `Result`/`Option` returns, `camelCase` serde, command registration in `lib.rs`.
   - `app-shell.md` if `App.tsx`/`AppShell.tsx` are involved.

3. **Write the plan**, mapping each step to the spec's acceptance criteria:
   - **Files to create / modify** (concrete paths), reusing existing utilities you found.
   - **Task breakdown** as a `- [ ]` checklist, ordered for incremental, verifiable progress.
   - **Test plan**: which `*.test.{ts,tsx}` and Rust `#[cfg(test)]` modules to add and what they assert.
   - **Risks / open questions** if any.

4. **Persist the plan and start the branch.** After the user approves the plan:
   - Post it as an issue comment: `gh issue comment $ARGUMENTS --body "<plan markdown>"`.
   - If the spec's Implementation Tasks were empty or coarse, update the issue body to the refined checklist (`gh issue edit $ARGUMENTS --body-file ...`).
   - Create the branch from `main` per CONTRIBUTING.md naming (`feat/<slug>` or `fix/<slug>`): `git checkout main && git pull && git checkout -b feat/<slug>`.
   - Move the issue to **In Progress** on the Glyph Roadmap board.
   - Tell the user the next step is `/implement $ARGUMENTS`.

No em dashes. Keep the plan scannable.
