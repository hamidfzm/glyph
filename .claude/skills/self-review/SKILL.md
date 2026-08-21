---
name: self-review
description: Review the working diff against Glyph's code standards (readable over clever, YAGNI, sparse comments) and fix findings before any commit or push. Run this on every non-trivial diff before committing; also when the user says "self review", "review your code", or "/self-review". Self-improving; fold rejected changes and human code-review feedback back into this skill.
---

# Self-Review

Review the current diff (`git diff` + `git diff --cached`, or `git diff origin/main...HEAD` for a whole branch) against the checklist. Fix findings directly, then re-run the gates. The diff's best outcome is getting shorter and plainer.

Worked bad-to-good examples and the correction history live in `references/examples.md`; read it only when a rule needs its example or when folding in a new correction.

## Checklist, in priority order

1. **Readable over clever.** No boolean-algebra one-liners, XOR-style comparisons, or nested ternaries; name the intermediate value; early-return beats a dense expression. If verifying a line needs a truth table, rewrite the line.
2. **Build only the surface current callers use (YAGNI).** No props, type unions, overloads, or helpers with zero callers; an abstraction needs two real call sites, one call site gets inline code.
3. **Sparse comments.** Only constraints the code cannot show (platform quirks, ordering, security guards), one line each; trim when comment lines rival code lines in the diff.
4. **Reuse before writing.** Grep `src/lib/`, `src/hooks/`, and `src-tauri/src/` for an existing helper first; a new predicate joins the module that owns its siblings. Tool-owned manifests stay standard: no custom fields in `package.json` or other externally-owned files; derive from standard fields through existing seams and keep code-interpreted facts beside their checker.
5. **Right altitude.** Fix the mechanism, not a symptom; special cases layered on shared infrastructure mean the fix is too shallow. When a checker flags a sink, removing the sink beats guarding it: a guard the checker does not recognize costs another CI round trip and leaves the sink in place.
6. **Tests assert the surface that exists.** Cover the branches the diff adds (Codecov patch must stay green); no tests for capabilities the code no longer has. For a new guard, break it and watch the test fail: an assertion that still passes was pinning something else.
7. **A behavior change sweeps its descriptions.** Comments, docs, and user-visible strings in all five locales that describe the old behavior are part of the change, not a follow-up. Grep the removed behavior's vocabulary across `src/`, `.claude/`, and `samples/` before calling it done.
8. **A node added to the rendered document joins every DOM consumer.** An element only one surface uses (print-only, export-only, hidden) still reaches the search walker (`useSearch`), the AI quote locator (`documentHighlight`), the export passes (`prepareContent`), print, and the website pipeline. Name which ones must ignore it, and make them.

## Procedure

1. Collect the diff; walk each hunk against the checklist; list findings as `file:line - rule - fix`.
2. Check governing conventions, not just code quality: every `.claude/rules/*.md` whose scope covers a changed path, plus the global ones (no em dashes and no AI attribution in commits/PR bodies, branch naming, PR template). Verify by grepping the actual commit messages and PR body.
3. When the change ships as a PR, re-read CONTRIBUTING.md's Pull Requests section before `gh pr create` and verify against the posted result, not the draft: PR title in conventional commit style (`fix(settings): ...`, not a bare imperative sentence; squash merge makes the title the `main` commit), `Closes #N` present, and the template's Testing checkboxes claiming only what actually ran (automated gates are not "Tested on <platform>"; leave the box unchecked and say what ran).
4. Run `/code-review` (medium) on the same diff and fold its confirmed findings into the fix list; self-review alone is the author grading their own homework.
5. Apply every fix; skip only what would change intended behavior, and say so.
6. Re-run the gates: `pnpm typecheck && pnpm check && pnpm test`, and `cargo clippy --all-targets -- -D warnings` if Rust changed.
7. Report what was cut or rewritten and the net line delta.

## Self-improvement

When the human rejects a change or gives code-review feedback: sharpen the matching checklist line in place (or append a genuinely new one-line rule; keep the list ordered by how often each rule catches something), and add the worked bad-to-good example to `references/examples.md` under the same rule number. Commit the skill edit in the same PR as the code fix. Keep this file a lean checklist, roughly a page; examples, rationale, and history belong in the references file, and git history is the changelog.
