#!/usr/bin/env bash
# Tests for scripts/release-assets.sh against a fake release: bundles the way
# tauri-action lists them, then the assets the way a publish job downloads
# them, including one replaced under the same name after publishing.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
assets="$repo_root/scripts/release-assets.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

# Runs a command that must fail, and must say why.
expect_failure() {
  local message=$1
  shift
  local output
  if output=$("$@" 2>&1); then
    fail "expected failure ($message), got success: $output"
  fi
  [[ "$output" == *"$message"* ]] || fail "expected '$message' in: $output"
}

version=1.2.3
homepage="https://example.test"

# ---- collect: what tauri-action lists, files only, any path separator ----

build="$tmp/build"
mkdir -p "$build/bundle/dmg" "$build/bundle/macos/Glyph.app/Contents" "$build/bundle/msi"
echo dmg > "$build/bundle/dmg/Glyph_${version}_universal.dmg"
echo app > "$build/bundle/macos/Glyph.app/Contents/Info.plist"
echo msi > "$build/bundle/msi/Glyph_${version}_x64_en-US.msi"
cd "$build"

printf '["bundle/dmg/Glyph_%s_universal.dmg","bundle/macos/Glyph.app","bundle\\\\msi\\\\Glyph_%s_x64_en-US.msi"]' "$version" "$version" \
  | bash "$assets" collect "$tmp/bundles" > /dev/null
got=$(cd "$tmp/bundles" && printf '%s ' *)
[ "$got" = "Glyph_${version}_universal.dmg Glyph_${version}_x64_en-US.msi " ] \
  || fail "collect copied '$got', expected the dmg and the msi and not the .app folder"

expect_failure "no bundle to collect" bash "$assets" collect "$tmp/empty" <<< '["bundle/macos/Glyph.app"]'

# ---- checksum: SHA256SUMS over every asset, and the PKGBUILD from it ----

release="$tmp/release"
mkdir -p "$release"
for name in "Glyph_${version}_universal.dmg" "Glyph_${version}_amd64.deb" "Glyph_${version}_arm64.deb" \
            "Glyph_${version}_x64_en-US.msi" "Glyph_${version}_amd64.AppImage"; do
  echo "$name" > "$release/$name"
done
printf '{"homepage": "%s"}\n' "$homepage" > "$tmp/package.json"
cat > "$tmp/PKGBUILD" <<'TEMPLATE'
pkgver={{VERSION}}
url="{{HOMEPAGE}}"
sha256sums_x86_64=('{{SHA256_AMD64}}')
sha256sums_aarch64=('{{SHA256_ARM64}}')
TEMPLATE

cd "$tmp"
bash "$assets" checksum "$release" "$version" "$tmp/PKGBUILD" "$tmp/package.json" > /dev/null
cd "$release"
[ "$(wc -l < SHA256SUMS)" = 6 ] || fail "SHA256SUMS lists $(wc -l < SHA256SUMS) files, expected 5 assets and the PKGBUILD"
sha256sum --check --strict --quiet SHA256SUMS || fail "SHA256SUMS does not match the assets it was written from"
grep -q "^pkgver=$version\$" PKGBUILD || fail "PKGBUILD pkgver was not rendered"
grep -q "^url=\"$homepage\"\$" PKGBUILD || fail "PKGBUILD url was not rendered"
amd64=$(sha256sum "Glyph_${version}_amd64.deb" | cut -d' ' -f1)
arm64=$(sha256sum "Glyph_${version}_arm64.deb" | cut -d' ' -f1)
grep -q "^sha256sums_x86_64=('$amd64')\$" PKGBUILD || fail "PKGBUILD amd64 hash is not the deb's"
grep -q "^sha256sums_aarch64=('$arm64')\$" PKGBUILD || fail "PKGBUILD arm64 hash is not the deb's"
[ "$(bash "$assets" hash-of "Glyph_${version}_arm64.deb")" = "$arm64" ] || fail "hash-of did not read the arm64 hash"
[ -z "$(bash "$assets" hash-of "Glyph_9.9.9_arm64.deb")" ] || fail "hash-of answered for a file that is not listed"

# A leg that produced no deb cannot render the PKGBUILD, and says so.
partial="$tmp/partial"
mkdir -p "$partial"
echo dmg > "$partial/Glyph_${version}_universal.dmg"
echo deb > "$partial/Glyph_${version}_amd64.deb"
expect_failure "amd64 and arm64 .deb" bash "$assets" checksum "$partial" "$version" "$tmp/PKGBUILD" "$tmp/package.json"

# A second run never hashes its own SHA256SUMS into the list.
expect_failure "already holds SHA256SUMS" bash "$assets" checksum "$release" "$version" "$tmp/PKGBUILD" "$tmp/package.json"

# ---- verify: what a publish job downloaded, against the list ----

# A download is the release directory as a publish job sees it: SHA256SUMS
# plus the assets its patterns name.
download() {
  local dir=$1
  shift
  rm -rf "$dir"
  mkdir -p "$dir"
  cp "$release/SHA256SUMS" "$dir/"
  local name
  for name in "$@"; do cp "$release/$name" "$dir/"; done
  cd "$dir"
}

download "$tmp/dl" "Glyph_${version}_amd64.deb" "Glyph_${version}_arm64.deb" "Glyph_${version}_universal.dmg"
bash "$assets" verify "Glyph_${version}_universal.dmg" "Glyph_${version}_amd64.deb" "Glyph_${version}_arm64.deb" > /dev/null \
  || fail "verify rejected assets that match SHA256SUMS"

# A glob covers every file it matches, and a listed file that was not
# downloaded is not asked for.
bash "$assets" verify "Glyph_*.deb" > /dev/null || fail "verify rejected a glob over the two debs"

# The asset replaced under the same name after publishing
download "$tmp/dl" "Glyph_${version}_amd64.deb"
echo "not what was built" > "Glyph_${version}_amd64.deb"
expect_failure "FAILED" bash "$assets" verify "Glyph_${version}_amd64.deb"

# An asset uploaded later that the list never named
download "$tmp/dl" "Glyph_${version}_amd64.deb"
echo extra > "Glyph_${version}_amd64.rpm"
expect_failure "not listed in SHA256SUMS" bash "$assets" verify "Glyph_${version}_amd64.deb" "Glyph_${version}_amd64.rpm"

# A pattern nothing matches, as when a build leg named its bundle differently
download "$tmp/dl" "Glyph_${version}_amd64.deb"
expect_failure "no release asset matches" bash "$assets" verify "Glyph_${version}_amd64.deb" "Glyph_${version}_x64_en-US.msi"

# No list at all, as when publish-release never ran
download "$tmp/dl" "Glyph_${version}_amd64.deb"
rm SHA256SUMS
expect_failure "SHA256SUMS is not here" bash "$assets" verify "Glyph_${version}_amd64.deb"

# The PKGBUILD rides the same list, so the AUR job verifies it like any asset
download "$tmp/dl" PKGBUILD
bash "$assets" verify PKGBUILD > /dev/null || fail "verify rejected the PKGBUILD publish-release rendered"
echo "pkgver=9.9.9" >> PKGBUILD
expect_failure "FAILED" bash "$assets" verify PKGBUILD

echo "release-assets.sh: all tests passed"
