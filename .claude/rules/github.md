# GitHub Interaction Rules

Rules for commenting on and updating GitHub issues and PRs.

- **Never merge a PR.** Open it, post the evidence, and stop; merging is always the user's call. This also rules out indirect merges: never push commits directly to `main`, including pushing a PR's head commit there (GitHub then marks the PR merged). Even if asked to land something on `main`, deliver it as a PR and let the user merge it.
- **Always read the whole thread before posting.** Before adding any comment to an issue or PR, fetch and read all existing comments and the activity timeline (`gh issue view N --comments`, `gh api repos/<owner>/<repo>/issues/N/comments`, and the timeline events for label/close/reference activity). Update your understanding from what's actually there: the author may have already posted a draft themselves, another comment may have answered the question, or the state (closed, released, superseded) may have changed since your context was built.
- **Never duplicate an existing comment.** If a drafted comment overlaps with something already posted, post only the new information.
- **One apology per thread, maximum.** If the thread already contains an apology, don't apologize again; go straight to the update.
