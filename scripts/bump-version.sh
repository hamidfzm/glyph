#!/usr/bin/env bash
# Shared version-bump flow for create-release.yml and scripts/bump-version.test.sh.
# Validates the version, checks the tag is unused on origin, then bumps
# package.json, src-tauri/Cargo.toml, and src-tauri/Cargo.lock in the working
# tree. Committing, tagging, and pushing stay in the workflow.
set -euo pipefail

version="${1:-}"

if ! echo "$version" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "::error::Invalid version format '$version'. Expected semver (e.g. 1.2.3)"
  exit 1
fi

# --exit-code: 0 = ref exists, 2 = no matching ref, anything else = the query
# itself failed. Fail closed on a failed query instead of assuming the tag is
# free; grepping ls-remote output would proceed on a network error.
status=0
git ls-remote --exit-code origin "refs/tags/v$version" >/dev/null || status=$?
if [ "$status" -eq 0 ]; then
  echo "::error::Tag v$version already exists"
  exit 1
elif [ "$status" -ne 2 ]; then
  echo "::error::Could not query origin tags (git ls-remote exit $status)"
  exit 1
fi

jq --arg v "$version" '.version = $v' package.json > package.json.tmp
mv package.json.tmp package.json

# First match only, so a future [dependencies.foo] table with a bare
# version line cannot be clobbered.
sed -i "0,/^version = /s/^version = \".*\"/version = \"$version\"/" src-tauri/Cargo.toml

cargo update --manifest-path src-tauri/Cargo.toml -p glyph
