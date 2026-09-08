import { visit } from "unist-util-visit";
import { isMarkdownFile } from "@/lib/markdownExtensions";
import { basename, isPathInside } from "@/lib/paths";
import { isRelativeLocalHref, normalizeRelativePath } from "@/lib/relativePath";
import { decodeHref, encodeHref, headingSlug, relativeHref, relFromRoot } from "./sitePaths";

// Rehype plugin that makes one rendered page navigable inside the exported
// site: wikilink anchors point at the target's generated .html, relative
// markdown links swap .md for .html, and local images, media and linked files
// are redirected to the copy the exporter will place in the output tree. Runs
// after sanitize, so the wikilink data-* attributes it reads are already
// allowlisted.
//
// It also forces the playback attributes the viewer's media components apply,
// which a static pipeline has no other place to add: without controls, and with
// autoplay stripped by the sanitizer, an exported player could never be started.

interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

export interface SiteUrlContext {
  /** Absolute path of the markdown file being rendered. */
  filePath: string;
  /** Site-relative path of the page being generated ("guide/intro.html"). */
  pageRel: string;
  /** Absolute workspace root. */
  root: string;
  /** Absolute markdown path -> site-relative page path, for every workspace file. */
  pages: Map<string, string>;
  /**
   * Absolute asset path -> site-relative copy destination. Shared across the
   * whole export so every page referencing the same file agrees on one copy.
   */
  assets: Map<string, string>;
}

/** Case-insensitive page lookup: link casing may not match disk casing. */
function lookupPage(pages: Map<string, string>, abs: string): string | undefined {
  const exact = pages.get(abs);
  if (exact) return exact;
  const lower = abs.toLowerCase();
  for (const [key, value] of pages) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

/** Site files the exporter writes itself, beyond the generated pages. */
const SITE_FILES = ["index.html", "style.css", "site.js", "robots.txt"];

/**
 * Whether the exporter writes `dest` itself. Page paths are compared
 * case-insensitively, matching how sitePagePlan dedupes them.
 */
function isGeneratedPath(ctx: SiteUrlContext, dest: string): boolean {
  const lower = dest.toLowerCase();
  if (SITE_FILES.includes(lower)) return true;
  for (const page of ctx.pages.values()) {
    if (page.toLowerCase() === lower) return true;
  }
  return false;
}

/**
 * Reserve a site-relative destination for `abs`. Assets inside the workspace
 * keep their relative location; anything outside, or anything that would land
 * on a file the exporter generates, goes to assets/ with a numeric suffix on
 * basename collisions.
 */
function assetDestination(ctx: SiteUrlContext, abs: string): string {
  const existing = ctx.assets.get(abs);
  if (existing) return existing;
  const mirrored = isPathInside(abs, ctx.root) ? relFromRoot(ctx.root, abs) : null;
  // Assets are copied after the pages are written, so mirroring a workspace
  // file onto a path the exporter generates (a stray index.html, a workspace
  // style.css) would silently overwrite it. Those go to assets/ instead.
  if (mirrored !== null && !isGeneratedPath(ctx, mirrored)) {
    ctx.assets.set(abs, mirrored);
    return mirrored;
  }
  const name = basename(abs);
  let dest = `assets/${name}`;
  const taken = new Set(ctx.assets.values());
  for (let n = 1; taken.has(dest) || isGeneratedPath(ctx, dest); n++) {
    dest = `assets/${name.replace(/(\.[^.]*)?$/, `-${n}$1`)}`;
  }
  ctx.assets.set(abs, dest);
  return dest;
}

function rewriteAnchor(ctx: SiteUrlContext, props: Record<string, unknown>): void {
  const wikiTarget = props.dataWikilinkPath;
  if (typeof wikiTarget === "string") {
    const page = lookupPage(ctx.pages, wikiTarget);
    if (!page) return; // target exists in the workspace but not in this export
    const heading = props.dataWikilinkHeading;
    // Slugs can carry non-ASCII letters; percent-encode like outline.ts does.
    const fragment =
      typeof heading === "string" ? `#${encodeURIComponent(headingSlug(heading))}` : "";
    props.href = encodeHref(relativeHref(ctx.pageRel, page)) + fragment;
    return;
  }
  if ("dataWikilinkBroken" in props) return; // stays href="#", styled as broken

  const href = props.href;
  if (typeof href !== "string" || !isRelativeLocalHref(href)) return;
  // The query and fragment ride along untouched; only the path resolves.
  const [, target, suffix] = href.match(/^([^?#]*)(.*)$/) as RegExpMatchArray;
  const lastSegment = target.split("/").pop();
  // A folder, not a file: nothing to copy, and the href already points at
  // whatever the site serves there.
  if (lastSegment === "" || lastSegment === "." || lastSegment === "..") return;
  // micromark percent-encodes destinations; decode to get the on-disk path.
  const abs = normalizeRelativePath(ctx.filePath, decodeHref(target));
  if (!isMarkdownFile(target)) {
    // Anything above the root keeps its original href: a link is easier to
    // write carelessly than an embed, so it does not publish what it names.
    if (!isPathInside(abs, ctx.root)) return;
    props.href = encodeHref(relativeHref(ctx.pageRel, assetDestination(ctx, abs))) + suffix;
    return;
  }
  const page = lookupPage(ctx.pages, abs);
  if (!page) return; // outside the workspace; leave the original link alone
  props.href = encodeHref(relativeHref(ctx.pageRel, page)) + suffix;
}

function rewriteImage(ctx: SiteUrlContext, props: Record<string, unknown>): void {
  rewriteAssetRef(ctx, props, "src");
}

function rewriteMedia(ctx: SiteUrlContext, props: Record<string, unknown>): void {
  rewriteAssetRef(ctx, props, "src");
  rewriteAssetRef(ctx, props, "poster");
  props.controls = true;
  props.preload = "none";
}

// Inline-SVG <image> icons: rewrite both href spellings and register the
// referenced files so the exporter copies them into the site tree.
function rewriteSvgImage(ctx: SiteUrlContext, props: Record<string, unknown>): void {
  rewriteAssetRef(ctx, props, "href");
  rewriteAssetRef(ctx, props, "xLinkHref");
}

function rewriteAssetRef(
  ctx: SiteUrlContext,
  props: Record<string, unknown>,
  key: "src" | "href" | "xLinkHref" | "poster",
): void {
  const value = props[key];
  if (typeof value !== "string" || !isRelativeLocalHref(value)) return;
  const abs = normalizeRelativePath(ctx.filePath, decodeHref(value));
  const dest = assetDestination(ctx, abs);
  props[key] = encodeHref(relativeHref(ctx.pageRel, dest));
}

// A unified attacher: use as `[rehypeSiteUrls, ctx]` so unified invokes it
// with the context and gets the transformer back.
export function rehypeSiteUrls(ctx: SiteUrlContext) {
  return (tree: HastNode) => {
    visit(tree as unknown as Parameters<typeof visit>[0], "element", (node: HastNode) => {
      const props = node.properties;
      if (!props) return;
      if (node.tagName === "a") rewriteAnchor(ctx, props);
      else if (node.tagName === "img") rewriteImage(ctx, props);
      else if (node.tagName === "image") rewriteSvgImage(ctx, props);
      else if (node.tagName === "video" || node.tagName === "audio") rewriteMedia(ctx, props);
      else if (node.tagName === "source") rewriteAssetRef(ctx, props, "src");
    });
  };
}
