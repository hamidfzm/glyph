#!/bin/sh
# AI-attribution gate, shared by the commit-msg and pre-push hooks and the
# "AI attribution" PR check, so the local and CI verdicts never disagree.
#
# Glyph credits the humans who ship a change. A commit must not be authored or
# committed under an agent's identity, and a commit message or PR description
# must not carry an agent co-author trailer or a "Generated with" footer.
# Either one on a branch commit reaches main: GitHub's squash merge turns a
# branch commit's author into a co-author trailer on the merged commit.
#
# Usage:
#   check-ai-attribution.sh message <file>         a commit message being
#                                                  written, plus the identity
#                                                  committing it
#   check-ai-attribution.sh commits <rev-list>...  every commit rev-list selects
#   check-ai-attribution.sh text <file>            free text, e.g. a PR body
#
# Pure git and grep: no network, so the same input always gets the same verdict.

agents='claude|anthropic|codex|copilot|chatgpt'
attribution="co-authored-by:.*($agents)|noreply@anthropic\\.com|generated (with|by) .{0,4}claude|claude\\.ai/code"
# Matched against "name <email>": an agent's bare name, not a person who is
# also called Claude.
identity="^($agents) <|@anthropic\\.com>"

# Prints the lines of stdin matching $1 to stderr, labelled $2. Succeeds only
# when there was one.
flag() {
  grep -iE "$1" | sed "s/^/  $2: /" | grep . >&2
}

# The name and email git will record, without the timestamp.
ident() {
  git var "$1" | sed 's/ [0-9]* [-+][0-9]*$//'
}

found=0
case "$1" in
message)
  # Drop git's comment block and any --verbose diff, so a commit that edits
  # documentation quoting these strings still passes.
  sed -e '/^# -\{1,\} >8 -\{1,\}$/,$d' -e '/^#/d' "$2" | flag "$attribution" message && found=1
  # git exports an --author or amended author to its hooks, so this is the
  # identity the commit will carry.
  ident GIT_AUTHOR_IDENT | flag "$identity" author && found=1
  ident GIT_COMMITTER_IDENT | flag "$identity" committer && found=1
  ;;
commits)
  shift
  revs=$(git rev-list "$@") || exit 2
  for c in $revs; do
    short=$(git rev-parse --short "$c")
    git log -1 --format=%B "$c" | flag "$attribution" "$short message" && found=1
    git log -1 --format='%an <%ae>' "$c" | flag "$identity" "$short author" && found=1
    git log -1 --format='%cn <%ce>' "$c" | flag "$identity" "$short committer" && found=1
  done
  ;;
text)
  flag "$attribution" text < "$2" && found=1
  ;;
*)
  echo "usage: $0 message <file> | commits <rev-list args> | text <file>" >&2
  exit 2
  ;;
esac

if [ "$found" -ne 0 ]; then
  echo "AI attribution found above. Glyph commits and PRs carry no agent identity, co-author trailer or generated-by footer." >&2
  echo "Delete the flagged lines, and re-author agent commits as yourself:" >&2
  echo "  git rebase --exec 'git commit --amend --no-edit --reset-author' <base>" >&2
  exit 1
fi
