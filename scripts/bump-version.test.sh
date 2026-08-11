#!/usr/bin/env bash
# End-to-end test for scripts/bump-version.sh on a throwaway checkout.
# The clone's origin is a local bare copy of this repo, so the tag-exists
# check runs for real while nothing can reach the actual remote.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
bump="$repo_root/scripts/bump-version.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

git clone --quiet --bare "$repo_root" "$tmp/origin.git"
git -C "$tmp/origin.git" tag -f v9.9.8
git clone --quiet "$tmp/origin.git" "$tmp/repo"
cd "$tmp/repo"

# Malformed versions are rejected before anything is touched
for bad in "1.2" "v1.2.3" "1.2.3-rc1" ""; do
  if bash "$bump" "$bad" >/dev/null 2>&1; then
    fail "accepted invalid version '$bad'"
  fi
done
[ -z "$(git status --porcelain)" ] || fail "rejected version still modified the working tree"

# A version whose tag already exists on origin is rejected
out=$(bash "$bump" 9.9.8 2>&1) && fail "accepted already-tagged version 9.9.8"
echo "$out" | grep -q "already exists" || fail "wrong error for existing tag: $out"

# An unreachable origin aborts the bump instead of failing open
git remote set-url origin "$tmp/missing.git"
out=$(bash "$bump" 9.9.7 2>&1) && fail "proceeded when origin tags could not be queried"
echo "$out" | grep -q "Could not query" || fail "wrong error for unreachable origin: $out"
git remote set-url origin "$tmp/origin.git"

# Happy path: package.json, Cargo.toml, and Cargo.lock all agree
bash "$bump" 9.9.9

pkg="$(jq -r .version package.json)"
toml="$(grep -m1 '^version = ' src-tauri/Cargo.toml | cut -d'"' -f2)"
lock="$(awk '/^name = "glyph"$/ { getline; print }' src-tauri/Cargo.lock | cut -d'"' -f2)"

[ "$pkg" = "9.9.9" ] || fail "package.json version is '$pkg', expected 9.9.9"
[ "$toml" = "9.9.9" ] || fail "Cargo.toml version is '$toml', expected 9.9.9"
[ "$lock" = "9.9.9" ] || fail "Cargo.lock glyph version is '$lock', expected 9.9.9"

echo "OK: bump flow validates, rejects existing tags, and keeps all three files in sync"
