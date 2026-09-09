// Single source of truth for every file extension Glyph recognises.
//
// Types the OS knows about (markdown, D2) live in `src-tauri/tauri.conf.json`
// under `bundle.fileAssociations`, because Tauri reads that file directly to
// register them (Windows registry, macOS Info.plist, Linux .desktop) and so it
// has to hold them. Every other type lives in `src-tauri/extensions.json` next
// to it.
//
// `src-tauri/build.rs` generates the matching Rust consts from those same two
// files, so the frontend checks, the backend checks, and the OS registration
// cannot drift. Adding an extension is a one-line edit to one JSON file.
// biome-ignore lint/style/noRestrictedImports: lives outside src/, but it is the canonical config
import declaredConfig from "../../src-tauri/extensions.json";
// biome-ignore lint/style/noRestrictedImports: lives outside src/, but it is the canonical config
import tauriConfig from "../../src-tauri/tauri.conf.json";

type FileAssociation = { ext?: unknown; mimeType?: unknown };

function validate(extensions: unknown, source: string): readonly string[] {
  if (
    !Array.isArray(extensions) ||
    extensions.length === 0 ||
    extensions.some((ext) => typeof ext !== "string" || ext.length === 0)
  ) {
    throw new Error(
      `${source} is missing or malformed; it is the single source of truth for these file extensions.`,
    );
  }
  return extensions as readonly string[];
}

/**
 * Extensions of the `tauri.conf.json` file association carrying `mimeType`.
 * Exported separately so the validation path is unit-testable: a malformed
 * config exercises the throw branch without mocking the JSON import at
 * module-load time.
 */
export function associationExtensions(config: unknown, mimeType: string): readonly string[] {
  const associations =
    (config as { bundle?: { fileAssociations?: FileAssociation[] } }).bundle?.fileAssociations ??
    [];
  const matches = associations.filter((association) => association.mimeType === mimeType);
  const [only] = matches;
  if (matches.length !== 1 || !only) {
    throw new Error(
      `tauri.conf.json needs exactly one bundle.fileAssociations entry with mimeType "${mimeType}", found ${matches.length}; it is the single source of truth for these file extensions.`,
    );
  }
  return validate(only.ext, `tauri.conf.json fileAssociations[mimeType="${mimeType}"].ext`);
}

/** Extensions declared under `key` in `extensions.json`. */
export function declaredExtensions(config: unknown, key: string): readonly string[] {
  return validate((config as Record<string, unknown>)[key], `extensions.json "${key}"`);
}

/** Whether `path` ends in one of `extensions`, ignoring case. */
export function hasExtension(path: string, extensions: readonly string[]): boolean {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext ? extensions.includes(ext) : false;
}

// Associations are keyed by mime type, not position, so reordering
// `fileAssociations` cannot silently swap the markdown and D2 lists.
export const MARKDOWN_EXTENSIONS = associationExtensions(tauriConfig, "text/markdown");
export const D2_EXTENSIONS = associationExtensions(tauriConfig, "text/plain");
export const CANVAS_EXTENSIONS = declaredExtensions(declaredConfig, "canvas");
export const NOTEBOOK_EXTENSIONS = declaredExtensions(declaredConfig, "notebook");
export const IMAGE_EXTENSIONS = declaredExtensions(declaredConfig, "image");

/**
 * Every extension that names a file the user opened. Telemetry redacts these
 * from error text, where a relative path like `workflows/routing.md` names a
 * document as plainly as an absolute one does. Images are included: an asset
 * name is as personal as a document name.
 */
export const USER_FILE_EXTENSIONS: readonly string[] = [
  ...MARKDOWN_EXTENSIONS,
  ...D2_EXTENSIONS,
  ...CANVAS_EXTENSIONS,
  ...NOTEBOOK_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
];
