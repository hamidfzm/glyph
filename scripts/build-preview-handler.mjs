// Builds the Windows Explorer preview handler: the preview page and the COM
// DLL, staged together in dist-preview/ (the DLL loads the page from a `web`
// folder next to itself, in the MSI and here alike).
//
//   pnpm build:preview-handler
//
// Register the result for testing with scripts/dev-preview-handler.ps1.
import { execFileSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: "inherit" });

// Vite's bin through node, not `pnpm exec`: Node 24 refuses to spawn a .cmd
// without a shell, and `shell: true` with arguments is deprecated.
run(process.execPath, [
  path.join(root, "node_modules", "vite", "bin", "vite.js"),
  "build",
  "--config",
  "vite.preview.config.ts",
]);
run("cargo", [
  "build",
  "--release",
  "-p",
  "glyph-preview-handler",
  "--manifest-path",
  "src-tauri/Cargo.toml",
]);

const targetDir = process.env.CARGO_TARGET_DIR
  ? path.resolve(root, process.env.CARGO_TARGET_DIR)
  : path.join(root, "src-tauri", "target");
const dll = "glyph_preview_handler.dll";
copyFileSync(path.join(targetDir, "release", dll), path.join(root, "dist-preview", dll));
console.log(`Staged dist-preview/${dll} and dist-preview/web`);
