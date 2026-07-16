# GitHub Interaction Rules

Rules for commenting on and updating GitHub issues and PRs.

- **Always read the whole thread before posting.** Before adding any comment to an issue or PR, fetch and read all existing comments and the activity timeline (`gh issue view N --comments`, `gh api repos/<owner>/<repo>/issues/N/comments`, and the timeline events for label/close/reference activity). Update your understanding from what's actually there: the author may have already posted a draft themselves, another comment may have answered the question, or the state (closed, released, superseded) may have changed since your context was built.
- **Never duplicate an existing comment.** If a drafted comment overlaps with something already posted, post only the new information.
- **One apology per thread, maximum.** If the thread already contains an apology, don't apologize again; go straight to the update.

## Public-content hygiene

- **No AI-tooling references in public GitHub content** (issue bodies, comments, PR descriptions, commit messages, release notes): no "Claude" in any form, no `.claude/...` paths, no slash-command names (`/implement 79`), no skill names, no "Generated with" or `Co-Authored-By` attribution. Describe work in tool-neutral terms and point contributors at CONTRIBUTING.md, plain git commands, and file paths outside `.claude/`.
- Before posting or editing any issue/PR text, grep it case-insensitively for `claude` and strip matches.
- **No personal names in committed files** (rules, skills, docs): write "the user" or "the maintainer".
