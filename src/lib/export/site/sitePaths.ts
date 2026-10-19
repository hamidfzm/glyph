import GithubSlugger from "github-slugger";
import { isPathInside } from "@/lib/paths";

// Pure path arithmetic for the static-site exporter. Site paths are always
// POSIX style ("guide/intro.html") regardless of the host separator, because
// they end up in hrefs; absolute filesystem paths keep whatever separator the
// backend handed us (see src/lib/relativePath.ts).

/** Normalize an absolute filesystem path to forward slashes. */
export function toPosix(path: string): string {
  return path.replace(/\\/g, "/");
}

/**
 * Path of `abs` relative to the workspace `root`, POSIX style. Falls back to
 * the basename when `abs` is not inside `root` (callers guard with
 * isPathInside; the fallback just keeps this total).
 */
export function relFromRoot(root: string, abs: string): string {
  const r = toPosix(root).replace(/\/+$/, "");
  const a = toPosix(abs);
  return a.startsWith(`${r}/`) ? a.slice(r.length + 1) : a.replace(/^.*\//, "");
}

/**
 * Whether the exporter may copy `abs` into the site: inside the workspace,
 * under no hidden name. The page walk publishes nothing hidden (`.git`,
 * `.env`, `.glyph`) and nothing above the root, and a reference in a page
 * must not reach further than the walk: a cloned README's `[](.git/config)`,
 * or an image climbing into another open workspace, would otherwise publish
 * files the user never meant to.
 */
export function isPublishableAsset(root: string, abs: string): boolean {
  if (abs === root || !isPathInside(abs, root)) return false;
  const segments = relFromRoot(root, abs).split("/");
  return segments.every((segment) => !segment.startsWith("."));
}

/** Map a workspace-relative markdown path to its generated page path. */
export function pageRelPath(relMd: string): string {
  return relMd.replace(/\.[^./]+$/, ".html");
}

/**
 * How strongly a workspace-relative path claims the site's index.html: a
 * root-level index.* wins over a root-level README.*; everything else (0)
 * never claims it and the exporter falls back to a generated page list.
 */
export function indexSourcePriority(relMd: string): number {
  if (/^index\.[^./]+$/i.test(relMd)) return 2;
  if (/^readme\.[^./]+$/i.test(relMd)) return 1;
  return 0;
}

/**
 * Relative href from one generated page to another site-relative path, e.g.
 * from "guide/intro.html" to "assets/logo.png" is "../assets/logo.png".
 */
export function relativeHref(fromPage: string, to: string): string {
  const fromDir = fromPage.split("/").slice(0, -1);
  const toSegs = to.split("/");
  let common = 0;
  while (
    common < fromDir.length &&
    common < toSegs.length - 1 &&
    fromDir[common] === toSegs[common]
  ) {
    common++;
  }
  const ups = new Array<string>(fromDir.length - common).fill("..");
  return [...ups, ...toSegs.slice(common)].join("/");
}

/** Percent-encode each segment of a site-relative href (spaces, unicode). */
export function encodeHref(href: string): string {
  return href
    .split("/")
    .map((seg) => (seg === ".." ? seg : encodeURIComponent(seg)))
    .join("/");
}

/**
 * Fragment id for a heading, matching what rehype-slug assigns to the first
 * occurrence of that heading in the target document.
 */
export function headingSlug(heading: string): string {
  return new GithubSlugger().slug(heading);
}
