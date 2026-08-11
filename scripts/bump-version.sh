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

if git ls-remote --tags origin | grep -q "refs/tags/v$version\$"; then
  echo "::error::Tag v$version already exists"
  exit 1
fi

jq --arg v "$version" '.version = $v' package.json > package.json.tmp
mv package.json.tmp package.json

sed -i "s/^version = \".*\"/version = \"$version\"/" src-tauri/Cargo.toml

cargo update --manifest-path src-tauri/Cargo.toml -p glyph
