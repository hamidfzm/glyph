#!/usr/bin/env bash
# Tries the macOS Quick Look extension without a release: builds Glyph.app,
# installs it to ~/Applications, and registers the extension, so Space in
# Finder previews markdown through it. Quick Look ignores extensions in
# temporary folders, hence the install.
#
#   scripts/dev-quicklook.sh           build, install, register
#   scripts/dev-quicklook.sh --remove  unregister and delete the test install
set -euo pipefail

app="$HOME/Applications/Glyph.app"
appex="$app/Contents/PlugIns/GlyphQuickLook.appex"
lsregister=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

if [[ "${1:-}" == "--remove" ]]; then
  pluginkit -r "$appex" 2>/dev/null || true
  "$lsregister" -u "$app" 2>/dev/null || true
  rm -rf "$app"
  qlmanage -r >/dev/null
  echo "Removed $app"
  exit 0
fi

cd "$(dirname "$0")/.."
pnpm tauri build --bundles app
mkdir -p "$HOME/Applications"
rm -rf "$app"
cp -R src-tauri/target/release/bundle/macos/Glyph.app "$app"
"$lsregister" -f -R "$app"
pluginkit -a "$appex"
qlmanage -r >/dev/null
pluginkit -m -v -i com.hamidfzm.glyph.quicklook
echo "Press Space on a markdown file in Finder, or run: qlmanage -p samples/README.md"
