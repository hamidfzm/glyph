#!/usr/bin/env bash
# Tests for scripts/release-changelog.sh against a throwaway repo whose history
# has the shape that broke v0.22.1: a hotfix branch cut from an older tag,
# released after a newer tag already exists on main.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
changelog="$repo_root/scripts/release-changelog.sh"
config="$repo_root/.github/release.yml"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

export REPOSITORY="owner/repo"
export SERVER_URL="https://github.com"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

commit() {
  git commit --quiet --allow-empty -m "$1"
}

git init --quiet "$tmp/repo"
cd "$tmp/repo"
git config user.email test@example.com
git config user.name Test

#            v1.1.0 (main)
#           /
#   v1.0.0 -- cherry-picks -- bump -- v1.0.1 (hotfix branch)
commit "feat: first"
git tag v1.0.0
git switch --quiet -c hotfix
commit "fix(telemetry): stop the opener crash (#690)"
commit "chore(deps): bump js-yaml (#686)"
commit "ci(release): retry the smoke test (#676)"
commit "ci(release): tighten the release branch by hand"
commit "chore: bump version to 1.0.1"
git tag v1.0.1
git switch --quiet main 2>/dev/null || git switch --quiet master
commit "feat: something big on main"
git tag v1.1.0

cat > "$tmp/prs.json" <<'JSON'
[
  {"n": 690, "title": "fix(telemetry): stop the opener crash", "author": "hamidfzm", "labels": ["bug"]},
  {"n": 686, "title": "chore(deps): bump js-yaml", "author": "dependabot[bot]", "labels": ["dependencies", "javascript"]},
  {"n": 676, "title": "ci(release): retry the smoke test", "author": "hamidfzm", "labels": ["ci"]}
]
JSON

# The previous tag comes from the tag's own ancestry. Resolving it by release
# date would answer v1.1.0 here, which is what produced a nonsense range.
got="$(bash "$changelog" previous-tag v1.0.1)"
[ "$got" = "v1.0.0" ] || fail "previous-tag for the hotfix is '$got', expected v1.0.0"

got="$(bash "$changelog" previous-tag v1.1.0)"
[ "$got" = "v1.0.0" ] || fail "previous-tag for the main release is '$got', expected v1.0.0"

# The very first release has no ancestor tag, and that is not an error
got="$(bash "$changelog" previous-tag v1.0.0)"
[ -z "$got" ] || fail "previous-tag for the first release is '$got', expected empty"

# The pull requests to look up come from the "(#123)" squash-merge leaves behind
got="$(bash "$changelog" pull-requests v1.0.1 v1.0.0 | sort | tr '\n' ' ')"
[ "$got" = "676 686 690 " ] || fail "pull-requests found '$got', expected 676 686 690"

# Notes GitHub could attribute are passed through untouched, which is every
# release cut from main's tip
generated="## What's Changed
### 🐛 Bug Fixes
* fix: something by @someone in https://github.com/owner/repo/pull/1"
got="$(printf '%s' "$generated" | bash "$changelog" body v1.1.0 v1.0.0 "$tmp/prs.json")"
[ "$got" = "$generated" ] || fail "PR-derived notes were not passed through: $got"

# A cherry-picked release comes back empty, because association is by commit
# SHA and a cherry-pick is a new SHA
empty="<!-- Release notes generated using configuration in .github/release.yml at v1.0.1 -->"
got="$(printf '%s' "$empty" | bash "$changelog" body v1.0.1 v1.0.0 "$tmp/prs.json")"

echo "$got" | grep -q "^## What's Changed$" ||
  fail "fallback has no What's Changed heading: $got"
echo "$got" | grep -qF '**Full Changelog**: https://github.com/owner/repo/compare/v1.0.0...v1.0.1' ||
  fail "fallback has no compare link: $got"

if echo "$got" | grep -q 'bump version to'; then
  fail "fallback listed the release's own version bump: $got"
fi

# Commits from the newer main-line tag are outside the hotfix's range
if echo "$got" | grep -q 'something big on main'; then
  fail "fallback reached past the hotfix lineage: $got"
fi

# Entries read the way GitHub writes them, and sit under the category their
# pull request's labels select
expect_section() {
  echo "$got" | awk -v heading="### $1" '
    $0 == heading { inside = 1; next }
    /^### / { inside = 0 }
    inside && NF { print }
  ' | grep -qxF "$2" || fail "'$2' is not under '$1': $got"
}

expect_section "🐛 Bug Fixes" \
  "* fix(telemetry): stop the opener crash by @hamidfzm in https://github.com/owner/repo/pull/690"
expect_section "🧪 Testing & CI" \
  "* ci(release): retry the smoke test by @hamidfzm in https://github.com/owner/repo/pull/676"
expect_section "📦 Dependencies" \
  "* chore(deps): bump js-yaml by @dependabot[bot] in https://github.com/owner/repo/pull/686"

# A commit that never went through a pull request has no author or link to
# attribute, so it keeps its subject and lands in the catch-all
expect_section "🔧 Other Changes" "* ci(release): tighten the release branch by hand"

entries="$(echo "$got" | grep -c '^\* ' || true)"
[ "$entries" = "4" ] || fail "expected 4 entries across the sections, got $entries: $got"

# Categories with nothing in them are left out rather than shown empty
if echo "$got" | grep -q '🚀 Features'; then
  fail "fallback printed an empty Features section: $got"
fi

# The script's categories mirror .github/release.yml, and drift between the two
# would silently file entries under the wrong heading
config_pairs="$(awk '
  /^ *exclude:/ { done = 1 }
  done { next }
  /^ *- title: / {
    if (title != "") print title "|" labels
    title = $0
    sub(/^ *- title: "/, "", title)
    sub(/"$/, "", title)
    labels = ""
    next
  }
  /^ *labels:/ { next }
  /^ *- / && title != "" {
    label = $2
    gsub(/"/, "", label)
    labels = labels (labels == "" ? "" : " ") label
  }
  END { if (title != "") print title "|" labels }
' "$config")"

script_pairs="$(sed -n "/^CATEGORIES=(/,/^)/p" "$changelog" | sed -n "s/^  '\(.*\)'$/\1/p")"

[ "$config_pairs" = "$script_pairs" ] ||
  fail "CATEGORIES drifted from .github/release.yml:
--- config ---
$config_pairs
--- script ---
$script_pairs"

# Without a previous tag there is no range to walk, so an empty body stays empty
got="$(printf '%s' "$empty" | bash "$changelog" body v1.0.0 "" "$tmp/prs.json")"
[ "$got" = "$empty" ] || fail "first release should pass through unchanged: $got"

echo "OK: previous tag follows the tag's ancestry, and a cherry-picked release renders its pull requests"
