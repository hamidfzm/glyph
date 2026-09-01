#!/usr/bin/env bash
# Changelog helpers for release.yml. These live in a script rather than inline
# in the workflow so scripts/release-changelog.test.sh can exercise them
# without cutting a release.
#
#   previous-tag <tag>                    nearest release tag in <tag>'s ancestry
#   pull-requests <tag> <previous-tag>    pull request numbers in that range
#   body <tag> <previous-tag> <prs.json>  the changelog, reading GitHub's
#                                         generated notes on stdin
#
# GitHub generates the notes for every release cut from main's tip, and those
# are used as-is. Only a cherry-picked release needs the fallback here:
# generate-notes builds entries from the pull requests associated with each
# commit, association is by commit SHA, and a cherry-pick is a new SHA. The
# pull request survives in the "(#123)" that squash-merging leaves in the
# subject, so the fallback resolves entries from that and renders them the way
# GitHub would have.
set -euo pipefail

usage() {
  echo "usage: $0 previous-tag <tag> | pull-requests <tag> <previous-tag> | body <tag> <previous-tag> <prs.json>" >&2
  exit 2
}

# Mirrors .github/release.yml, whose categories key off pull request labels.
# The test fails if the two drift apart. "*" is the catch-all, matching that
# file's own last category.
CATEGORIES=(
  '🚀 Features|enhancement'
  '🐛 Bug Fixes|bug'
  '🔒 Security|security'
  '🧪 Testing & CI|ci testing'
  '📦 Dependencies|dependencies'
  '📝 Documentation|documentation'
  '🔧 Other Changes|*'
)

# Walking the tag's ancestry, not the release list, is what makes a hotfix
# work: a release cut from a branch off an older tag has to diff against that
# tag and not against whatever shipped most recently from main.
previous_tag() {
  git describe --tags --abbrev=0 --match 'v*' "$1^" 2>/dev/null || true
}

subjects() {
  git log --no-merges --pretty='%s' "$1..$2" | grep -v '^chore: bump version to ' || true
}

pull_requests() {
  subjects "$1" "$2" | sed -n 's/.*(#\([0-9][0-9]*\))$/\1/p'
}

# One tab-separated line per commit: the pull request's labels, then the
# rendered entry. A commit that never went through a pull request keeps its
# subject, since there is no author or link to attribute it to.
entries() {
  local previous="$1" tag="$2" meta="$3" subject number pr title author labels

  while IFS= read -r subject; do
    [ -n "$subject" ] || continue

    number="$(printf '%s' "$subject" | sed -n 's/.*(#\([0-9][0-9]*\))$/\1/p')"
    pr=""
    [ -n "$number" ] && pr="$(jq -c --argjson n "$number" '.[] | select(.n == $n)' "$meta")"

    if [ -z "$pr" ]; then
      printf '\t* %s\n' "$subject"
      continue
    fi

    title="$(printf '%s' "$pr" | jq -r .title)"
    author="$(printf '%s' "$pr" | jq -r .author)"
    labels="$(printf '%s' "$pr" | jq -r '.labels | join(" ")')"
    printf '%s\t* %s by @%s in %s/%s/pull/%s\n' \
      "$labels" "$title" "$author" "$SERVER_URL" "$REPOSITORY" "$number"
  done < <(subjects "$previous" "$tag")
}

# Keeps the entries whose label field carries one of $1, or with mode "drop",
# the ones it does not.
filter() {
  awk -F'\t' -v want="$1" -v mode="$2" '
    BEGIN { n = split(want, w, " ") }
    {
      hit = 0
      split($1, have, " ")
      for (i = 1; i <= n && !hit; i++)
        for (j in have)
          if (have[j] == w[i]) { hit = 1; break }
      if ((mode == "keep") == (hit == 1)) print
    }'
}

group() {
  local all="$1" spec title labels matched

  for spec in "${CATEGORIES[@]}"; do
    title="${spec%%|*}"
    labels="${spec#*|}"

    if [ "$labels" = '*' ]; then
      matched="$all"
    else
      matched="$(printf '%s\n' "$all" | filter "$labels" keep)"
      all="$(printf '%s\n' "$all" | filter "$labels" drop)"
    fi

    [ -n "$(printf '%s' "$matched" | tr -d '[:space:]')" ] || continue
    printf '### %s\n%s\n' "$title" "$(printf '%s\n' "$matched" | cut -f2-)"
  done
}

body() {
  local tag="$1" previous="$2" meta="$3" generated

  generated="$(cat)"

  # Anything GitHub could attribute is already right, so only an empty list
  # falls through, which in practice means a cherry-picked release.
  if [ -z "$previous" ] || printf '%s' "$generated" | grep -q '^\* '; then
    printf '%s\n' "$generated"
    return
  fi

  : "${REPOSITORY:?REPOSITORY is required}"
  : "${SERVER_URL:=https://github.com}"

  printf "## What's Changed\n%s\n\n**Full Changelog**: %s/%s/compare/%s...%s\n" \
    "$(group "$(entries "$previous" "$tag" "$meta")")" \
    "$SERVER_URL" "$REPOSITORY" "$previous" "$tag"
}

case "${1:-}" in
  previous-tag)
    [ $# -eq 2 ] || usage
    previous_tag "$2"
    ;;
  pull-requests)
    [ $# -eq 3 ] || usage
    pull_requests "$3" "$2"
    ;;
  body)
    [ $# -eq 4 ] || usage
    body "$2" "$3" "$4"
    ;;
  *)
    usage
    ;;
esac
