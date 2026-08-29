---
description: Rebase a feature branch onto main, promote its worktree into the repo root, and run the app for hands-on testing before merge
argument-hint: <issue-number-or-branch>
allowed-tools: Bash(gh pr *), Bash(gh issue *), Bash(git *), Bash(pnpm *), Read, Grep, Glob
---

You are the **try** stage of Glyph's workflow: hands-on testing of a feature branch in the real app before the user merges its PR. You rebase the branch onto the latest `main`, move it from its worktree into the repo root (where node_modules and the cargo target are warm), and launch the dev app. You do not merge, do not open PRs, and do not add features here.

## Steps

1. **Resolve the branch.** `$ARGUMENTS` is an issue number or a branch name.
   - Issue number: find its branch via `gh pr list --state open --json number,headRefName,title` (the PR whose body closes the issue) or by matching `git worktree list` slugs. Ambiguity: ask, never guess.
   - Confirm the PR (if one exists) is still **open**: `gh pr view <n> --json state,mergeStateStatus`. A merged or closed PR means there is nothing to try; stop and say so. (Squash-merge deletes and can recreate branches silently, so check the PR, not just the branch.)

2. **Preconditions.** All must hold before touching anything; report and stop otherwise:
   - Repo root is on `main` with a clean tree (`git -C <root> status --porcelain` empty; `git branch --show-current` prints `main`).
   - The feature branch's worktree under `.claude/worktrees/` has no uncommitted changes.
   - `git fetch origin` succeeds.

3. **Rebase onto main.** Inside the feature worktree:
   ```bash
   git rebase origin/main
   ```
   - On conflicts: stop immediately, list the conflicted files, and ask whether to resolve here or `git rebase --abort`. Never resolve conflicts silently.
   - If the branch is already on origin and the rebase changed history, push with `git push --force-with-lease` so the PR follows, but only after re-confirming the PR is still open (step 1). If the rebase was a no-op, skip the push.

4. **Promote the worktree into the root** (the worktree-to-main flow):
   ```bash
   git worktree remove ".claude/worktrees/<slug>"   # refuses if dirty; that refusal is a stop, never --force
   git checkout <branch>                             # in the repo root
   ```

5. **Run the app.**
   - `pnpm install --frozen-lockfile` first; the branch may have changed the lockfile.
   - Launch `pnpm tauri dev` as a background task so the session stays responsive. The native window appears after the first compile; say so.
   - If the run is for a specific document or workspace, pass it through: `pnpm tauri dev -- -- <path>`.

6. **Hand over a test script.** Read the issue's Acceptance Criteria (`gh issue view <n>`) and print them as a manual checklist so the user knows exactly what to click. Flag anything CI could not verify (platform-specific behavior, drag interactions, window management) as the priority items.

7. **Tear down when the user says they are done** (not before):
   - Stop the dev process.
   - Restore the standard layout:
     ```bash
     git checkout main
     git worktree add ".claude/worktrees/<slug>" <branch>
     ```
   - If testing found problems, route back to `/implement <issue>`; if it passed, the next step is merging the PR (the user's call) or `/ship <issue>` when no PR exists yet.

## Rules

- Never merge, never push to `main`, never open a PR here.
- Never `git worktree remove --force`, never `git branch -D`, never rebase in the root checkout.
- One branch in the root at a time: if a previous try left the root off `main`, restore it first (step 7) before starting a new one.
- Leave the tree exactly as found on any failure: aborted rebase, un-promoted worktree, root back on `main`.
