# Shared Machine Rules

Several sessions usually work on this machine at once, each in its own worktree, while the maintainer is using the same desktop. Two rules keep them out of each other's way and out of the maintainer's.

## Heavy commands go through the queue

`scripts/test-queue.sh` runs one heavy command at a time across every worktree on the machine:

```bash
bash scripts/test-queue.sh "<label>" -- <command> [args...]
cd src-tauri && bash ../scripts/test-queue.sh "<label>" -- cargo <args>
```

It waits its turn, runs the command, and exits with the command's exit code. The label is what the other waiters see, so name the branch and the step (`"fix/link-opening: cargo test"`). What follows `--` is one program and its arguments, not a shell line: a `cd` or an `&&` stays outside, as in the second form.

- **Heavy, always queued**: the full `pnpm test` (and `pnpm test:coverage`, the same suite), `pnpm build`, `pnpm tauri build`, any `cargo` command that compiles (`build`, `check`, `run`, `test`, `clippy`, `mutants`), anything run in WSL or Docker, and `git commit` (its pre-commit hook runs the gates).
- **Not heavy, run directly**: `pnpm typecheck`, `pnpm check`, `cargo fmt --check`, a single test file (`pnpm test src/lib/foo.test.ts`), plain `git` and `gh`.
- **While iterating, run only the touched test files.** The full gates run once, at the end. [CLAUDE.md](../../CLAUDE.md) ("Run the gates before every PR") is their single list: link to it, do not restate it.
- **Do not run the gates and then commit.** The pre-commit hook repeats them, so the commit is the gate run: run the not-heavy checks and the touched test files directly, then commit through the queue.
- **Start a queued command in the background or with a long timeout.** The wait is as long as the commands ahead of it; the script prints who it is waiting behind once a minute. Leave the worktree alone while its commit waits: the hook tests the files as they are when its turn comes.
- **Never go around the queue**: no second copy of the script, no setting `GLYPH_TEST_QUEUE_LOCK` or `GLYPH_TEST_QUEUE_HELD` by hand, no `--no-verify` to skip the wait, no deleting a lock that looks stuck. A lock whose holder died is taken over on its own after three minutes.
- **Do not queue a command that stays running** (a dev server, a watcher): it holds the queue against everyone. A command still running after 90 minutes stops holding it, and the next one starts beside it.
- **Run it from Git Bash.** In PowerShell a bare `bash` is the WSL launcher, which sees a different temp directory and so a different lock; call Git's own `bash.exe` by path there. Git Bash rewrites arguments that look like POSIX paths before a Windows program sees them, so prefix a queued `docker` or `wsl` command with `MSYS_NO_PATHCONV=1`.

The pre-commit hook also queues its heavy steps itself, so a commit that was not wrapped still waits its turn, and a wrapped one does not wait twice. That is a backstop, not a reason to skip the wrapper.

## No windows on the maintainer's desktop

A window that opens takes the focus from whatever the maintainer is typing into. Unless the maintainer asks for it in that session (running `/try` is asking):

- Do not launch the Glyph app in any form (a dev build, a built binary, an installed copy), a headed browser, an installer, Explorer or an editor.
- Do not open new console windows (`Start-Process`, `start`, new terminal tabs).
- Do not use desktop control.

Work that shows nothing on the desktop (a headless browser, a container) is unaffected. Verification that needs a visible window is reported as **unverified**, with what is left to look at, never as done.
