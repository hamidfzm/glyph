#!/usr/bin/env bash
# CI: checks a built Glyph.app carries the Quick Look extension, signed and
# sandboxed, and that PlugInKit accepts its ad-hoc signature.
#
#   scripts/quicklook-smoke.sh path/to/Glyph.app
set -euo pipefail

app="$1"
appex="$app/Contents/PlugIns/GlyphQuickLook.appex"
fail() { echo "quicklook smoke: $*" >&2; exit 1; }

[[ -f "$appex/Contents/Resources/web/index.html" ]] || fail "no preview page in $appex"
codesign --verify --deep --strict "$app" || fail "Glyph.app signature does not verify"
codesign -d --entitlements - "$appex" 2>/dev/null | grep -q com.apple.security.app-sandbox \
  || fail "the extension is not sandboxed"
/usr/libexec/PlistBuddy -c "Print :UTExportedTypeDeclarations:0:UTTypeIdentifier" "$app/Contents/Info.plist" \
  | grep -qx com.hamidfzm.glyph.markdown || fail "Glyph.app does not declare its markdown type"

# PlugInKit ignores an extension whose app LaunchServices has not registered.
lsregister=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
"$lsregister" -f -R "$app"
pluginkit -a "$appex"
trap 'pluginkit -r "$appex" || true; "$lsregister" -u "$app" || true' EXIT
for _ in 1 2 3 4 5; do
  if pluginkit -m -i com.hamidfzm.glyph.quicklook | grep -q com.hamidfzm.glyph.quicklook; then
    echo "quicklook smoke: passed"
    exit 0
  fi
  sleep 1
done
fail "PlugInKit did not register the extension"
