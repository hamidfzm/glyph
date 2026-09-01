#!/usr/bin/env bash
# Changelog helpers for release.yml. These live in a script rather than inline
# in the workflow so scripts/release-changelog.test.sh can exercise them
# without cutting a release.
#
#   previous-tag <tag>          the nearest release tag in <tag>'s own ancestry
#   body <tag> <previous-tag>   the release changelog, reading GitHub's
#                               generated notes on stdin
set -euo pipefail

usage() {
  echo "usage: $0 previous-tag <tag> | body <tag> <previous-tag>" >&2
  exit 2
}

# Walking the tag's ancestry, not the release list, is what makes a hotfix
# work: a release cut from a branch off an older tag has to diff against that
# tag and not against whatever shipped most recently from main.
previous_tag() {
  git describe --tags --abbrev=0 --match 'v*' "$1^" 2>/dev/null || true
}

# Groups commits under the headings from .github/release.yml, in that file's
# order. Those categories key off pull request labels, which a cherry-pick
# does not carry, so the conventional-commit type stands in for the label.
# The catch-all keeps every commit in the output even when its type is one
# nothing here matches.
categorize() {
  local remaining="$1" spec title pattern matched

  for spec in \
    '🚀 Features|^\* feat' \
    '🐛 Bug Fixes|^\* fix' \
    '🧪 Testing & CI|^\* (ci|test)' \
    '📦 Dependencies|^\* (chore|build)\(deps' \
    '📝 Documentation|^\* docs' \
    '🔧 Other Changes|.'; do
    title="${spec%%|*}"
    pattern="${spec#*|}"

    matched="$(printf '%s\n' "$remaining" | grep -E "$pattern" || true)"
    [ -n "$matched" ] || continue

    printf '### %s\n%s\n' "$title" "$matched"
    remaining="$(printf '%s\n' "$remaining" | grep -Ev "$pattern" || true)"
  done
}

body() {
  local tag="$1" previous="$2" generated commits
  generated="$(cat)"

  # generate-notes lists pull requests, and a cherry-picked commit carries no
  # PR association, so a hotfix release comes back with an empty list. Fall
  # back to commit subjects, minus the version bump the release just made.
  # These are subjects rather than "title by @author in <pull request>",
  # because the pull request that carried each commit is exactly what a
  # cherry-pick loses.
  if [ -n "$previous" ] && ! printf '%s' "$generated" | grep -q '^\* '; then
    commits="$(git log --no-merges --pretty='* %s' "$previous..$tag" |
      grep -v '^\* chore: bump version to ' || true)"
    printf "## What's Changed\n%s\n\n**Full Changelog**: %s/%s/compare/%s...%s\n" \
      "$(categorize "$commits")" \
      "${SERVER_URL:-https://github.com}" "${REPOSITORY:?REPOSITORY is required}" \
      "$previous" "$tag"
    return
  fi

  printf '%s\n' "$generated"
}

case "${1:-}" in
  previous-tag)
    [ $# -eq 2 ] || usage
    previous_tag "$2"
    ;;
  body)
    [ $# -eq 3 ] || usage
    body "$2" "$3"
    ;;
  *)
    usage
    ;;
esac
