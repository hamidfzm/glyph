---
description: Review the diff with the code-reviewer agent, then open a PR that closes the spec issue
argument-hint: <issue-number>
allowed-tools: Bash(gh pr *), Bash(gh issue *), Bash(pnpm *), Bash(cd src-tauri && cargo *), Bash(git *), Read, Grep, Glob, Task
---

You are the **ship** stage of Glyph's spec-driven workflow. Get the work for issue **#$ARGUMENTS** reviewed and into a PR. Do not add new features here.

## Steps

1. **Verify done.** `gh issue view $ARGUMENTS` and confirm every Acceptance Criterion checkbox is checked. If any is unchecked, stop and route the user back to `/implement $ARGUMENTS`.

2. **Confirm the gates are green** (re-run if unsure):
   ```bash
   pnpm typecheck && pnpm check && pnpm test
   cd src-tauri && cargo clippy --all-targets -- -D warnings
   ```

3. **Review the diff.** Invoke the `code-reviewer` agent (via the Task tool) on `git diff main...HEAD`. Surface its findings by severity (critical / warning / suggestion) and fix anything critical or warranted before opening the PR. Re-run the gates after fixes.

4. **Check patch coverage before pushing.** Run `pnpm test:coverage` and confirm every file touched by the diff has no uncovered lines from this change. If lines are missing, add tests now: pushing without them just means the Codecov bot flags the PR minutes later.

5. **Push and open the PR:**
   - `git push -u origin <branch>`.
   - Title: conventional-commit style matching the work (`feat: ...` / `fix: ...`).
   - Body: fill in `.github/PULL_REQUEST_TEMPLATE.md` (Summary, Changes, Testing checklist, Screenshots). Include **`Closes #$ARGUMENTS`** in the body so the issue auto-closes on merge.
     - Use only GitHub's recognized keywords (`Closes`, `Fixes`, `Resolves`). Never `closing`/`fixing`/`resolving`, which silently leave the issue open (see CLAUDE.md).
   - Create it: `gh pr create --title "..." --body-file ...`.

6. **Resolve the Codecov report.** After CI uploads coverage, the `codecov` bot comments on the PR. Check it (`gh pr view <number> --comments`, look for "Patch coverage"). If it reports missing lines, treat that as a blocker, not a note: reproduce locally with `pnpm test:coverage`, add tests for the flagged lines, and push. The bot edits its comment on the next upload; done means the comment shows no missing patch lines (or the only misses are genuinely untestable and you have said so on the PR). Never leave a red patch-coverage comment unaddressed and unacknowledged.

7. Print the PR URL and remind the user CI must pass on all 3 platforms (and Codecov patch coverage) before merge.

No em dashes. Do not push to `main` or create releases.
