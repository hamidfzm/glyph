import { convertFileSrc } from "@tauri-apps/api/core";

// Strip a Windows verbatim ("\\?\", or UNC "\\?\UNC\") path prefix. The backend
// hands us canonicalized paths, which on Windows carry this prefix; it tells the
// OS to read the path literally, so the forward slashes we join with stop being
// valid separators and the asset server fails the read (HTTP 500).
function stripVerbatimPrefix(path: string): string {
  return path.replace(/^\\\\\?\\UNC\\/, "\\\\").replace(/^\\\\\?\\/, "");
}

// Resolve a markdown image `src` to something the webview can load: remote and
// data URLs pass through untouched, while relative paths are joined to the
// document's directory and run through Tauri's asset protocol.
export function resolveImageSrc(
  src: string | undefined,
  filePath: string | undefined,
): string | undefined {
  if (!src) return src;
  if (/^(https?:|data:)/i.test(src)) return src;
  if (filePath) {
    const dir = filePath.replace(/[/\\][^/\\]*$/, "");
    let resolved = stripVerbatimPrefix(`${dir}/${src}`.replace(/\/\.\//g, "/"));
    // On a Windows path (backslashes / drive letter), use a single backslash
    // separator so the join doesn't leave a stray forward slash the OS rejects.
    if (resolved.includes("\\")) resolved = resolved.replace(/\//g, "\\");
    return convertFileSrc(resolved);
  }
  return src;
}
