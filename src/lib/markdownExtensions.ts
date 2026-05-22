// Single source of truth — `src-tauri/tauri.conf.json` →
// `bundle.fileAssociations[0].ext`. The Rust build script reads the same
// path via build.rs so the Rust `is_markdown_file` check and the frontend
// `isMarkdownFile` helper stay in lockstep with the OS file-association
// registration (Windows registry, macOS Info.plist, Linux .desktop).
// biome-ignore lint/style/noRestrictedImports: lives outside src/, but it is the canonical config
import tauriConfig from "../../src-tauri/tauri.conf.json";

/**
 * Pluck the first markdown extension list out of a Tauri config object.
 * Exported separately so the validation path is unit-testable — passing a
 * malformed config here exercises the throw branch without having to
 * mock the JSON import at module-load time.
 */
export function extractExtensions(config: unknown): readonly string[] {
  const fileAssociations = (config as { bundle?: { fileAssociations?: Array<{ ext?: unknown }> } })
    .bundle?.fileAssociations;
  const first = fileAssociations?.[0];
  if (!first || !Array.isArray(first.ext) || first.ext.length === 0) {
    throw new Error(
      "tauri.conf.json is missing bundle.fileAssociations[0].ext — " +
        "this is the single source of truth for supported markdown extensions.",
    );
  }
  return first.ext as readonly string[];
}

export const MARKDOWN_EXTENSIONS: readonly string[] = extractExtensions(tauriConfig);

export function isMarkdownFile(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext ? MARKDOWN_EXTENSIONS.includes(ext) : false;
}
