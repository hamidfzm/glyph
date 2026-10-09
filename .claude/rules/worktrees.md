# Worktree Workflow (GitHub Flow)

Glyph follows GitHub Flow with one git worktree per branch. There is no `develop`, `release/*`, or `hotfix/*` branch (that is Git Flow, which this project does not use).

## Model

- `main` is the only long-lived branch. It is always green and releasable.
- Every change lands on a short-lived branch cut from the latest `main`: `feat/<slug>`, `fix/<slug>`, or `chore/<slug>` / `docs/<slug>` / `refactor/<slug>` as the change warrants.
- **Those prefixes are the only allowed branch names.** A worktree auto-created by tooling may start life under a different name (e.g. `claude/<slug>`); rename it with `git branch -m <old> feat/<slug>` **before the first push**. The `.husky/pre-push` hook rejects pushes from any branch that doesn't match the convention.
- Each branch lives in its own worktree under `.claude/worktrees/<slug>/`, so several branches can be checked out at once without stashing. `.claude/worktrees/` is gitignored, so nothing inside a worktree directory is itself committed to the parent repo.
- Branches merge into `main` only through a PR, with linear history (squash or rebase, no merge commits), per [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Create a worktree for new work

```bash
git fetch origin
git worktree add -b feat/<slug> ".claude/worktrees/<slug>" origin/main
cd ".claude/worktrees/<slug>"
```

- Name the worktree directory after the slug so it matches the branch.
- For an existing branch, omit `-b`: `git worktree add ".claude/worktrees/<slug>" <branch>`.
- Always cut from `origin/main`, never off another in-progress branch.

## Clean up merged worktrees

After a branch's PR is merged into `main`, remove its worktree and branch. Always list first, confirm with the user, then remove. Never delete without confirmation.

1. Refresh state and list the candidates:
   ```bash
   git fetch --prune origin
   git worktree list
   ```
2. Prove each candidate branch merged (excluding `main` and the current worktree). Squash and rebase merges rewrite commits, so `git branch --merged` and `git branch -d` never recognize a merged branch here; the proof is a merged PR whose head contains the local tip:
   ```bash
   gh pr list --head <branch> --state merged --json number
   git fetch origin refs/pull/<number>/head && git merge-base --is-ancestor <branch> FETCH_HEAD   # exit 0: the PR head contains the local tip
   ```
   A branch counts as merged only when that check exits 0 (the tips are equal, or GitHub's "Update branch" added a merge on top). No merged PR, or local commits the PR head lacks, means leave the worktree and report it.
3. Confirm the proven list with the user, then for each:
   ```bash
   git worktree remove ".claude/worktrees/<slug>"   # refuses if there are uncommitted changes
   git branch -D <branch>                            # only after the proof in step 2
   ```
4. Prune administrative entries for worktrees whose directory was deleted by hand:
   ```bash
   git worktree prune
   ```

### Safety rules

- Never pass `--force` to `git worktree remove` to discard uncommitted tracked changes. If it refuses, stop and investigate.
- Never use `git branch -D` without the step 2 proof (a merged PR whose head contains the local tip) and the user's confirmation. `-d` is no guard here: it refuses every squash-merged branch.
- Never remove the `main` worktree or delete the `main` branch.
- Confirm the exact list of worktrees to remove with the user before deleting anything.
