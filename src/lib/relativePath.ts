import { isCanvasFile } from "@/lib/canvasExtensions";
import { isMarkdownFile } from "@/lib/markdownExtensions";
import { isPathInside } from "@/lib/paths";

// Resolving relative file references (markdown links, image sources, canvas
// file nodes) against the directory of the document that contains them, and
// constraining the result to the opened workspace folder. resolveWorkspacePath
// is the one entry point that pairs resolution with the root clamp, so link,
// image, and canvas resolution stay byte-for-byte consistent.

// Resolve a relative `target` against the directory of `docPath`, collapsing
// `.` and `..` segments. `docPath` is an absolute file path; the result keeps
// its separator style (Windows backslash vs. POSIX forward slash) and any
// leading prefix (drive, `\\?\` verbatim prefix, or UNC root), so it round-trips
// with the paths the backend hands us. A trailing `#heading` on the target is
// dropped. `..` never climbs above the filesystem root; escapes past the
// workspace are caught separately by isWithinRoot.
export function normalizeRelativePath(docPath: string, target: string): string {
  const cleanTarget = target.split("#")[0];
  const sep = docPath.includes("\\") ? "\\" : "/";
  const dir = docPath.replace(/[/\\][^/\\]*$/, "");
  const combined = `${dir}${sep}${cleanTarget}`;
  // Preserve the leading separator run verbatim (POSIX `/`, UNC/verbatim `\\`)
  // so it isn't collapsed away when we rejoin the segments.
  const lead = combined.match(/^[/\\]+/)?.[0] ?? "";
  const out: string[] = [];
  for (const seg of combined.slice(lead.length).split(/[/\\]+/)) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length > 0) out.pop();
      continue;
    }
    out.push(seg);
  }
  return lead + out.join(sep);
}

// Resolve a relative `target` against `docPath`'s directory and clamp it to the
// opened workspace `root`. Returns the absolute in-workspace path, or null when
// `root` is set and the target escapes it. With no `root` (single-file mode),
// resolution is unconstrained. This is the single resolve+clamp entry point for
// markdown links and images; callers handle the no-`docPath` case themselves.
export function resolveWorkspacePath(
  docPath: string,
  target: string,
  root: string | undefined,
): string | null {
  const resolved = normalizeRelativePath(docPath, target);
  if (root && !isPathInside(resolved, root)) return null;
  return resolved;
}

// Whether an `href` is a relative local path (and therefore a candidate for
// in-workspace resolution) rather than an external URL, an in-document anchor,
// or an already-absolute path.
export function isRelativeLocalHref(href: string): boolean {
  if (!href) return false;
  if (href.startsWith("#")) return false;
  if (href.startsWith("//")) return false; // protocol-relative URL
  if (href.startsWith("/") || href.startsWith("\\")) return false; // POSIX / UNC absolute
  // A URL scheme (`http:`, `mailto:`, `data:`) or a Windows drive (`C:\`).
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) return false;
  return true;
}

// A relative link Glyph opens in the workspace rather than the browser: a local
// path (not a URL or anchor) pointing at a markdown or canvas document. The
// trailing `#heading` (if any) is ignored when classifying the target.
export function isOpenableRelativeHref(href: string | undefined): href is string {
  if (!href || !isRelativeLocalHref(href)) return false;
  const target = href.split("#")[0];
  return isMarkdownFile(target) || isCanvasFile(target);
}
