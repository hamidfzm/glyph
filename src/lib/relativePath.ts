// Resolving relative file references (markdown links, image sources, canvas
// file nodes) against the directory of the document that contains them. Pair
// these with isPathInside from @/lib/paths to constrain the result to the
// opened workspace folder. The same helpers back every relative-path feature so
// link, image, and canvas resolution stay byte-for-byte consistent.

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
