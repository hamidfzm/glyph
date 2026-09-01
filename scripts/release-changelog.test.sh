#!/usr/bin/env bash
# Tests for scripts/release-changelog.sh against a throwaway repo whose history
# has the shape that broke v0.22.1: a hotfix branch cut from an older tag,
# released after a newer tag already exists on main.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
changelog="$repo_root/scripts/release-changelog.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

export REPOSITORY="owner/repo"

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
#   v1.0.0 -- fixes -- bump -- v1.0.1 (hotfix branch)
commit "feat: first"
git tag v1.0.0
git switch --quiet -c hotfix
commit "fix(telemetry): stop the opener crash (#690)"
commit "ci(release): retry the smoke test (#676)"
commit "docs(readme): refresh the comparison tables (#677)"
commit "chore(deps): bump js-yaml (#686)"
commit "chore: stop tracking the generated schema (#692)"
commit "chore: bump version to 1.0.1"
git tag v1.0.1
git switch --quiet main 2>/dev/null || git switch --quiet master
commit "feat: something big on main"
git tag v1.1.0

# The previous tag comes from the tag's own ancestry. Resolving it by release
# date would answer v1.1.0 here, which is what produced a nonsense range.
got="$(bash "$changelog" previous-tag v1.0.1)"
[ "$got" = "v1.0.0" ] || fail "previous-tag for the hotfix is '$got', expected v1.0.0"

got="$(bash "$changelog" previous-tag v1.1.0)"
[ "$got" = "v1.0.0" ] || fail "previous-tag for the main release is '$got', expected v1.0.0"

# The very first release has no ancestor tag, and that is not an error
got="$(bash "$changelog" previous-tag v1.0.0)"
[ -z "$got" ] || fail "previous-tag for the first release is '$got', expected empty"

# Notes that already list pull requests are passed through untouched
generated="## What's Changed
### 🐛 Bug Fixes
* fix: something by @someone in https://github.com/owner/repo/pull/1"
got="$(printf '%s' "$generated" | bash "$changelog" body v1.1.0 v1.0.0)"
[ "$got" = "$generated" ] || fail "PR-derived notes were not passed through: $got"

# An empty changelog is the hotfix case: cherry-picked commits carry no PR
# association, so generate-notes returns a body with no entries at all
empty="<!-- Release notes generated using configuration in .github/release.yml at v1.0.1 -->"
got="$(printf '%s' "$empty" | bash "$changelog" body v1.0.1 v1.0.0)"

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

# Commits are grouped under the same headings a labelled release uses, keyed
# off the conventional-commit type, and every commit lands in exactly one
expect_section() {
  echo "$got" | awk -v heading="### $1" '
    $0 == heading { inside = 1; next }
    /^### / { inside = 0 }
    inside && NF { print }
  ' | grep -qF "$2" || fail "'$2' is not under '$1': $got"
}

expect_section "🐛 Bug Fixes" "fix(telemetry): stop the opener crash (#690)"
expect_section "🧪 Testing & CI" "ci(release): retry the smoke test (#676)"
expect_section "📝 Documentation" "docs(readme): refresh the comparison tables (#677)"
expect_section "📦 Dependencies" "chore(deps): bump js-yaml (#686)"
expect_section "🔧 Other Changes" "chore: stop tracking the generated schema (#692)"

entries="$(echo "$got" | grep -c '^\* ' || true)"
[ "$entries" = "5" ] || fail "expected 5 entries across the sections, got $entries: $got"

# Headings the release has nothing for are left out rather than shown empty
if echo "$got" | grep -q '🚀 Features'; then
  fail "fallback printed an empty Features section: $got"
fi

# Without a previous tag there is no range to walk, so an empty body stays empty
got="$(printf '%s' "$empty" | bash "$changelog" body v1.0.0 "")"
[ "$got" = "$empty" ] || fail "first release should pass through unchanged: $got"

echo "OK: previous tag follows the tag's ancestry, and an empty changelog falls back to categorised commits"
