---
name: self-review
description: Review the working diff against Glyph's code standards (readable over clever, YAGNI, sparse comments) and fix findings before any commit or push. Run this on every non-trivial diff before committing; also when the user says "self review", "review your code", or "/self-review". Self-improving; fold rejected changes and human code-review feedback back into this file's rules.
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

6. **Tests assert the surface that exists.** Cover the branches the diff adds (Codecov patch must stay green), but do not write tests for capabilities the code no longer has. Asserting the absence of an attribute the component never emits is vacuous (an `xlink:href`-is-null assertion on a component that only ever renders `href` passes with sanitization deleted); assert the observable the guard actually controls.

## Procedure

1. Collect the diff.
2. Walk each changed hunk against the rules above; list findings as `file:line — rule — fix`.
3. Check the diff against the governing conventions, not just the code-quality rules: every `.claude/rules/*.md` whose scope covers a changed path, plus the global ones (no em dashes and no AI attribution in commits/PR bodies, branch naming, PR template). Verify, don't assume; grep the actual commit messages and PR body.
4. When the change ships as a PR, re-read CONTRIBUTING.md's Pull Requests section before `gh pr create` and verify against the posted result, not the draft: PR title in conventional commit style (`fix(settings): ...`, not a bare imperative sentence; squash merge makes the title the `main` commit), `Closes #N` present, and the template's Testing checkboxes claiming only what actually ran (automated gates are not "Tested on <platform>"; leave the box unchecked and say what ran).
5. Run `/code-review` (medium) on the same diff and fold its confirmed findings into the fix list. Self-review alone is the author grading their own homework; the independent pass catches what familiarity hides.
6. Apply every fix. Skip only what would change intended behavior, and say so.
7. Re-run the gates: `pnpm typecheck && pnpm check && pnpm test`, and `cargo clippy --all-targets -- -D warnings` if Rust changed.
8. Report: what was cut or rewritten, net line delta.

## Self-improvement

This file is the durable memory of the project's code-quality standards. When the human rejects a change (a refused edit or check, a change request) or gives code-review feedback:

1. Distill the correction into a rule: one or two lines, with a real bad-to-good example when the correction came with one.
2. If it refines an existing rule, sharpen that rule in place; only append a new numbered rule for a genuinely new category. Keep the list ordered by how often each rule catches something.
3. Commit the skill edit in the same PR as the code fix, so the standard and its first enforcement land together.
4. Keep this file a checklist, not an essay. If a rule hasn't caught anything in months, fold it into a neighbor or delete it. Git history is the changelog; no dates or attribution inside the file.

Seed corrections behind the current rules, for calibration: rule 1 came from `isMobile(usePlatform()) === (on === "mobile")` being rejected as unreadable; rule 2 from a gate component shipping selector unions and list props with zero callers; rule 3 from two PRs where comment lines rivaled code lines.
