#!/usr/bin/env bash
# CI: installs a built .deb and checks what the desktop then knows about Glyph.
# The entry has to be one a file manager lists under "Open With" (GNOME leaves
# an app out when its Exec line takes no file argument), the system has to type
# Glyph's files, and Glyph has to be offered for those types and no others.
#
# It installs the package and removes it again, so run it where that is safe.
#
#   scripts/desktop-entry-smoke.sh path/to/Glyph_x.y.z_amd64.deb
set -euo pipefail

fail() { echo "desktop entry smoke: $*" >&2; exit 1; }
as_root() { if (( EUID == 0 )); then "$@"; else sudo "$@"; fi; }

(( $# == 1 )) || fail "expected one .deb, got $#"
[[ -f "$1" ]] || fail "no .deb at '$1'"
deb=$(realpath "$1")
conf="$(dirname "$0")/../src-tauri/tauri.conf.json"
package=$(dpkg-deb -f "$deb" Package)

work=$(mktemp -d)
installed=""
cleanup() {
  if [[ -n "$installed" ]]; then as_root dpkg --remove "$installed"; fi
  rm -rf "$work"
}
trap cleanup EXIT

dpkg-deb -x "$deb" "$work/root"
entry="$work/root/usr/share/applications/Glyph.desktop"
[[ -f "$entry" ]] || fail "the package installs no Glyph.desktop"
cat "$entry"
desktop-file-validate "$entry" || fail "the desktop entry does not validate"
grep -qx 'Exec=glyph %F' "$entry" || fail "Exec takes no file argument"

extensions() {
  jq -r --arg mime "$1" '.bundle.fileAssociations[] | select(.mimeType == $mime).ext[]' "$conf"
}
mapfile -t markdown < <(extensions text/markdown)
mapfile -t d2 < <(extensions text/plain)
(( ${#markdown[@]} && ${#d2[@]} )) || fail "could not read the extension lists from $conf"

text_file() { echo 'Some text.' > "$work/$1"; echo "$work/$1"; }
# gio is what GNOME's file manager asks. Outside a desktop session xdg-mime
# falls back to file(1), which never reads the shared MIME database.
expect_type() {
  local actual
  actual=$(gio info -a standard::content-type "$1" | awk '/standard::content-type/ { print $2 }')
  [[ "$actual" == "$2" ]] || fail "$(basename "$1") is typed $actual, expected $2"
}
handles() { [[ "$(gio mime "$1")" == *Glyph.desktop* ]]; }

installed=$package
as_root apt-get install -y "$deb"

for ext in "${markdown[@]}"; do expect_type "$(text_file "sample.$ext")" text/markdown; done
for ext in "${d2[@]}"; do expect_type "$(text_file "sample.$ext")" text/x-d2; done
# Glyph's globs must not retype anyone else's files.
expect_type "$(text_file sample.txt)" text/plain
expect_type "$(text_file sample.py)" text/x-python
# *.mdx is also the glob for Sega 32X ROMs, which carry this at offset 256.
{ head -c 256 /dev/zero; printf 'SEGA 32X'; head -c 256 /dev/zero; } > "$work/rom.mdx"
expect_type "$work/rom.mdx" application/x-genesis-32x-rom

for type in text/markdown text/x-d2; do
  handles "$type" || fail "Glyph is not offered for $type"
done
for type in text/plain text/x-python; do
  if handles "$type"; then fail "Glyph is offered for $type, which it cannot open"; fi
done
# D2 stays a kind of plain text, so text editors are still offered for it.
grep -qx 'text/x-d2 text/plain' /usr/share/mime/subclasses || fail "text/x-d2 is not a kind of text/plain"

as_root dpkg --remove "$package"
installed=""
expect_type "$work/sample.d2" text/plain
if handles text/markdown; then fail "removing the package left Glyph registered"; fi

echo "desktop entry smoke: passed (${markdown[*]} ${d2[*]})"
