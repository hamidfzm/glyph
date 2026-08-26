#!/usr/bin/env bash
# Regenerate all bundled icons. The macOS .icns comes from the padded
# icon-macos.svg (Apple's Dock grid expects ~82% artwork coverage); every
# other target uses the full-bleed icon.svg via icon-manifest.json.
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm tauri icon icon-manifest.json

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
pnpm tauri icon icon-macos-manifest.json -o "$tmp"
cp "$tmp/icon.icns" src-tauri/icons/icon.icns
