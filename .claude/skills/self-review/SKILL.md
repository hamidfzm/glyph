---
name: self-review
description: Review the working diff against Glyph's code standards (readable over clever, YAGNI, sparse comments) and fix findings before any commit or push. Run this on every non-trivial diff before committing; also when the user says "self review", "review your code", or "/self-review".
---

# Self-Review

Review the current diff (`git diff` + `git diff --cached`, or `git diff origin/main...HEAD` for a whole branch) against each rule below. Fix findings directly, then re-run the gates. The diff's best outcome is getting shorter and plainer.

## Rules, in priority order

1. **Readable over clever.** Code is read at 3am by someone who didn't write it.
   - No boolean-algebra tricks (`a === (b === "x")`), no XOR-style comparisons, no nested ternaries.
   - Name the intermediate value: `const current = isMobile(platform) ? "mobile" : "desktop"` then compare, instead of one dense expression.
   - Early-return beats a clever single expression.
   - If you have to trace a truth table to verify a line, rewrite the line.

2. **Build only the surface current callers use (YAGNI).**
   - No prop shapes, type unions, overloads, or helpers with zero callers.
   - No exported types "for later". Generality is added by the PR that needs it.
   - An abstraction needs two real call sites; one call site gets inline code.

3. **Sparse comments.**
   - Comment only constraints the code cannot show (platform quirks, ordering requirements, security guards), one line each.
   - Self-describing attributes (`#[cfg(desktop)]`) and well-named functions need no comment.
   - If comment lines rival code lines in the diff, trim before pushing.

4. **Reuse before writing.** Grep `src/lib/`, `src/hooks/`, and `src-tauri/src/` for an existing helper before adding one. A new predicate joins the module that owns its siblings.

5. **Right altitude.** Fix the mechanism, not a symptom: a special case layered on shared infrastructure means the fix is too shallow. Prefer gating/configuring the underlying seam once over sprinkling checks at call sites.

6. **Tests assert the surface that exists.** Cover the branches the diff adds (Codecov patch must stay green), but do not write tests for capabilities the code no longer has.

## Procedure

1. Collect the diff.
2. Walk each changed hunk against rules 1 to 6; list findings as `file:line — rule — fix`.
3. Apply every fix. Skip only what would change intended behavior, and say so.
4. Re-run the gates: `pnpm typecheck && pnpm check && pnpm test`, and `cargo clippy --all-targets -- -D warnings` if Rust changed.
5. Report: what was cut or rewritten, net line delta.
