import { convertFileSrc } from "@tauri-apps/api/core";
import { isPathInside } from "@/lib/paths";
import { normalizeRelativePath } from "@/lib/relativePath";

// Strip a Windows verbatim ("\\?\", or UNC "\\?\UNC\") path prefix. The backend
// hands us canonicalized paths, which on Windows carry this prefix; it tells the
// OS to read the path literally, so the forward slashes we join with stop being
// valid separators and the asset server fails the read (HTTP 500).
function stripVerbatimPrefix(path: string): string {
  return path.replace(/^\\\\\?\\UNC\\/, "\\\\").replace(/^\\\\\?\\/, "");
}

// Resolve a markdown image `src` to something the webview can load: remote and
// data URLs pass through untouched, while relative paths are resolved against
// the document's directory (with `../` support) and run through Tauri's asset
// protocol. When `root` is given (a folder workspace is open), an image that
// resolves outside the opened folder is refused — returns undefined so the
// caller renders nothing rather than reaching a file outside the workspace.
export function resolveImageSrc(
  src: string | undefined,
  filePath: string | undefined,
  root?: string,
): string | undefined {
  if (!src) return src;
  if (/^(https?:|data:)/i.test(src)) return src;
  if (filePath) {
    const resolved = normalizeRelativePath(filePath, src);
    if (root && !isPathInside(resolved, root)) return undefined;
    return convertFileSrc(stripVerbatimPrefix(resolved));
  }
  return src;
}
