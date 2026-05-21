// Single source of truth — `src-tauri/tauri.conf.json` →
// `bundle.fileAssociations[0].ext`. The Rust build script reads the same
// path via build.rs so the Rust `is_markdown_file` check and the frontend
// `isMarkdownFile` helper stay in lockstep with the OS file-association
// registration (Windows registry, macOS Info.plist, Linux .desktop).
// biome-ignore lint/style/noRestrictedImports: lives outside src/, but it is the canonical config
import tauriConfig from "../../src-tauri/tauri.conf.json";

const FILE_ASSOCIATIONS = tauriConfig.bundle.fileAssociations;
const FIRST = FILE_ASSOCIATIONS[0];

if (!FIRST || !Array.isArray(FIRST.ext) || FIRST.ext.length === 0) {
  throw new Error(
    "tauri.conf.json is missing bundle.fileAssociations[0].ext — " +
      "this is the single source of truth for supported markdown extensions.",
  );
}

export const MARKDOWN_EXTENSIONS: readonly string[] = FIRST.ext;

export function isMarkdownFile(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext ? MARKDOWN_EXTENSIONS.includes(ext) : false;
}
