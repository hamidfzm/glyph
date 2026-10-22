#!/usr/bin/env bash
# The release assets' path from a build leg to a package channel, in the
# steps release.yml runs and release-assets.test.sh exercises:
#
#   collect <dest>            copy the bundles tauri-action lists on stdin
#                             (a JSON array of paths) into <dest>; files only
#   checksum <assets> <version> <pkgbuild-template> <package.json>
#                             write SHA256SUMS over everything in <assets>
#                             and render the PKGBUILD from those hashes
#   verify <pattern>...       check the files in the working directory that
#                             each glob names against SHA256SUMS there
#   hash-of <file>            print the hash SHA256SUMS lists for <file>
set -euo pipefail

usage() {
  echo "usage: $0 collect <dest> | checksum <assets> <version> <pkgbuild-template> <package.json> | verify <pattern>... | hash-of <file>" >&2
  exit 2
}

fail() {
  echo "::error::$1" >&2
  exit 1
}

# The installers alone: on macOS the list also names the .app folder, which
# the .dmg carries. Windows paths come with backslashes.
collect() {
  local dest=$1 path copied=0
  mkdir -p "$dest"
  while IFS= read -r path; do
    path="${path//\\//}"
    [ -f "$path" ] || continue
    cp "$path" "$dest/"
    copied=$((copied + 1))
  done < <(jq -r '.[]')
  [ "$copied" -gt 0 ] || fail "no bundle to collect"
  ls -l "$dest"
}

hash_of() {
  awk -v f="$1" '$2 == f { print $1 }' SHA256SUMS
}

# The PKGBUILD is rendered here, from the hashes just computed, so the AUR
# job needs no write to the release; its line joins SHA256SUMS so that job
# verifies it like any other asset.
checksum() {
  local assets=$1 version=$2 template=$3 package_json=$4
  local homepage sha_amd64 sha_arm64
  template=$(realpath "$template")
  homepage=$(jq -r .homepage "$package_json")
  cd "$assets"
  if [ -e SHA256SUMS ] || [ -e PKGBUILD ]; then
    fail "$assets already holds SHA256SUMS or PKGBUILD"
  fi
  sha256sum -- * > SHA256SUMS
  sha_amd64=$(hash_of "Glyph_${version}_amd64.deb")
  sha_arm64=$(hash_of "Glyph_${version}_arm64.deb")
  if [ -z "$sha_amd64" ] || [ -z "$sha_arm64" ]; then
    fail "the amd64 and arm64 .deb are not both among the assets"
  fi
  sed -e "s/{{VERSION}}/$version/g" \
    -e "s/{{SHA256_AMD64}}/$sha_amd64/g" \
    -e "s/{{SHA256_ARM64}}/$sha_arm64/g" \
    -e "s|{{HOMEPAGE}}|$homepage|g" \
    "$template" > PKGBUILD
  ! grep -q '{{' PKGBUILD || fail "PKGBUILD still holds a placeholder"
  sha256sum PKGBUILD >> SHA256SUMS
  cat SHA256SUMS
}

# Every file a pattern names must be listed, and must match the list, so a
# publish job packages what the build legs produced and not what a later
# upload put under the same name.
verify() {
  local pattern file line found wanted
  [ -e SHA256SUMS ] || fail "SHA256SUMS is not here to verify against"
  wanted=$(mktemp)
  for pattern in "$@"; do
    [ -n "$pattern" ] || continue
    found=0
    for file in $pattern; do
      [ -e "$file" ] || continue
      found=1
      line=$(hash_of "$file")
      [ -n "$line" ] || fail "$file is not listed in SHA256SUMS"
      printf '%s  %s\n' "$line" "$file" >> "$wanted"
    done
    [ "$found" = 1 ] || fail "no release asset matches $pattern"
  done
  [ -s "$wanted" ] || fail "no asset to verify"
  sha256sum --check --strict "$wanted"
  rm -f "$wanted"
}

[ $# -ge 1 ] || usage
command=$1
shift
case "$command" in
  collect) [ $# -eq 1 ] || usage; collect "$1" ;;
  checksum) [ $# -eq 4 ] || usage; checksum "$@" ;;
  verify) [ $# -ge 1 ] || usage; verify "$@" ;;
  hash-of) [ $# -eq 1 ] || usage; [ -e SHA256SUMS ] || fail "SHA256SUMS is not here"; hash_of "$1" ;;
  *) usage ;;
esac
