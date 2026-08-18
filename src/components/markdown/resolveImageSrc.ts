import { convertFileSrc } from "@tauri-apps/api/core";
import { resolveWorkspacePath } from "@/lib/relativePath";

// Strip a Windows verbatim ("\\?\", or UNC "\\?\UNC\") path prefix. The backend
// hands us canonicalized paths, which on Windows carry this prefix; it tells the
// OS to read the path literally, so the forward slashes we join with stop being
// valid separators and the asset server fails the read (HTTP 500).
function stripVerbatimPrefix(path: string): string {
  return path.replace(/^\\\\\?\\UNC\\/, "\\\\").replace(/^\\\\\?\\/, "");
}

// Turn an absolute filesystem path into a webview-loadable asset-protocol URL,
// stripping the Windows verbatim prefix first. Shared by markdown image
// resolution and the standalone image viewer (image file tabs).
export function toAssetUrl(path: string): string {
  return convertFileSrc(stripVerbatimPrefix(path));
}

// Resolve a markdown asset reference (image `src`, media `src`/`poster`/
// `<source src>`) to something the webview can load, alongside the absolute
// path it came from. Remote and data URLs pass through untouched and have no
// local path; relative paths are resolved against the document's directory
// (with `../` support) and run through Tauri's asset protocol. When `root` is
// given (a folder workspace is open), a reference that resolves outside the
// opened folder is refused: `src` comes back undefined so the caller renders
// nothing rather than reaching a file outside the workspace.
export interface ResolvedAssetRef {
  src: string | undefined;
  /** Absolute filesystem path, for local references only. Exporters read it. */
  path: string | undefined;
}

export function resolveAssetRef(
  src: string | undefined,
  filePath: string | undefined,
  root?: string,
): ResolvedAssetRef {
  if (!src || /^(https?:|data:)/i.test(src) || !filePath) return { src, path: undefined };
  const resolved = resolveWorkspacePath(filePath, src, root);
  if (resolved === null) return { src: undefined, path: undefined };
  return { src: toAssetUrl(resolved), path: resolved };
}

/** The `src` half of {@link resolveAssetRef}, for callers that render images. */
export function resolveImageSrc(
  src: string | undefined,
  filePath: string | undefined,
  root?: string,
): string | undefined {
  return resolveAssetRef(src, filePath, root).src;
}
