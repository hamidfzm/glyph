#!/usr/bin/env bash
# CI: checks the desktop entry a built .deb installs is one a file manager
# accepts as a file handler. GNOME leaves an app out of "Open With" when its
# Exec line takes no file argument, whatever MimeType says.
#
#   scripts/desktop-entry-smoke.sh path/to/Glyph_x.y.z_amd64.deb
set -euo pipefail

fail() { echo "desktop entry smoke: $*" >&2; exit 1; }

(( $# == 1 )) || fail "expected one .deb, got $#"
deb="$1"
[[ -f "$deb" ]] || fail "no .deb at '$deb'"
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
dpkg-deb -x "$deb" "$root"

entry="$root/usr/share/applications/Glyph.desktop"
[[ -f "$entry" ]] || fail "the package installs no Glyph.desktop"
cat "$entry"
desktop-file-validate "$entry" || fail "the desktop entry does not validate"
grep -qx 'Exec=glyph %F' "$entry" || fail "Exec takes no file argument"
grep -qE '^MimeType=(.*;)?text/markdown(;|$)' "$entry" || fail "MimeType does not list text/markdown"
echo "desktop entry smoke: passed"
