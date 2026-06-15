import { convertFileSrc } from "@tauri-apps/api/core";

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
    const resolved = `${dir}/${src}`.replace(/\/\.\//g, "/");
    return convertFileSrc(resolved);
  }
  return src;
}
