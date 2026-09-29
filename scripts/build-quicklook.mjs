// Builds the macOS Quick Look extension: the preview page and a universal
// Swift binary, assembled and ad-hoc signed as dist-quicklook/GlyphQuickLook.appex
// (tauri.macos.conf.json embeds it in Glyph.app/Contents/PlugIns).
//
//   pnpm build:quicklook            build the extension
//   pnpm build:quicklook --check    compile and run the Swift self-check
//
// Try the result with scripts/dev-quicklook.sh.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const sources = path.join(root, "src-tauri", "macos", "quicklook");
const out = path.join(root, "dist-quicklook");
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: "inherit" });
const sdk = execFileSync("xcrun", ["--show-sdk-path"], { encoding: "utf8" }).trim();
const readJson = (file) => JSON.parse(readFileSync(path.join(root, file), "utf8"));
const minimumSystem = readJson("src-tauri/tauri.conf.json").bundle.macOS.minimumSystemVersion;
const swiftc = (args) => run("xcrun", ["swiftc", "-swift-version", "5", "-sdk", sdk, "-O", ...args]);
const source = (...names) => names.map((name) => path.join(sources, name));

if (process.argv.includes("--check")) {
  mkdirSync(out, { recursive: true });
  const check = path.join(out, "quicklook-self-check");
  // The view controller too: nothing else compiles it short of a full app build.
  const files = ["PreviewViewController.swift", "SchemeHandler.swift", "Document.swift", "SelfCheck.swift"];
  swiftc(["-parse-as-library", "-module-name", "GlyphQuickLook", "-o", check, ...source(...files)]);
  run(check, []);
  process.exit(0);
}

// Vite through node, as build-preview-handler.mjs does.
run(process.execPath, [
  path.join(root, "node_modules", "vite", "bin", "vite.js"),
  "build",
  "--config",
  "vite.preview.config.ts",
]);

const appex = path.join(out, "GlyphQuickLook.appex");
const contents = path.join(appex, "Contents");
rmSync(appex, { recursive: true, force: true });
mkdirSync(path.join(contents, "MacOS"), { recursive: true });

const slices = ["arm64", "x86_64"].map((arch) => {
  const slice = path.join(out, `GlyphQuickLook-${arch}`);
  swiftc([
    "-module-name",
    "GlyphQuickLook",
    "-application-extension",
    "-target",
    `${arch}-apple-macos${minimumSystem}`,
    // An app extension has no main: Foundation's extension runtime is the entry.
    "-Xlinker",
    "-e",
    "-Xlinker",
    "_NSExtensionMain",
    "-o",
    slice,
    ...source("PreviewViewController.swift", "SchemeHandler.swift", "Document.swift"),
  ]);
  return slice;
});
run("lipo", ["-create", "-output", path.join(contents, "MacOS", "GlyphQuickLook"), ...slices]);
for (const slice of slices) rmSync(slice);

const plist = path.join(contents, "Info.plist");
cpSync(path.join(sources, "Info.plist"), plist);
const { version } = readJson("package.json");
for (const key of ["CFBundleShortVersionString", "CFBundleVersion"]) {
  run("plutil", ["-replace", key, "-string", version, plist]);
}
run("plutil", ["-replace", "LSMinimumSystemVersion", "-string", minimumSystem, plist]);
cpSync(path.join(root, "dist-preview", "web"), path.join(contents, "Resources", "web"), { recursive: true });

// Ad-hoc: no Apple Developer account. Tauri seals Glyph.app around the
// extension but never signs `macOS.files`, so it must arrive signed, with its
// entitlements.
run("codesign", [
  "--force",
  "--sign",
  "-",
  "--entitlements",
  path.join(sources, "GlyphQuickLook.entitlements"),
  appex,
]);
console.log("Built dist-quicklook/GlyphQuickLook.appex");
