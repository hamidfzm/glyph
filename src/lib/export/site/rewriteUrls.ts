import { visit } from "unist-util-visit";
import { isMarkdownFile } from "@/lib/markdownExtensions";
import { basename, isPathInside } from "@/lib/paths";
import { isRelativeLocalHref, normalizeRelativePath } from "@/lib/relativePath";
import { decodeHref, encodeHref, headingSlug, relativeHref, relFromRoot } from "./sitePaths";

// Rehype plugin that makes one rendered page navigable inside the exported
// site: wikilink anchors point at the target's generated .html, relative
// markdown links swap .md for .html, and local images are redirected to the
// copy the exporter will place in the output tree. Runs after sanitize, so the
// wikilink data-* attributes it reads are already allowlisted.

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
   * whole export so every page referencing the same image agrees on one copy.
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

/**
 * Reserve a site-relative destination for `abs`. Assets inside the workspace
 * keep their relative location; anything outside lands in assets/ with a
 * numeric suffix on basename collisions.
 */
function assetDestination(ctx: SiteUrlContext, abs: string): string {
  const existing = ctx.assets.get(abs);
  if (existing) return existing;
  let dest: string;
  if (isPathInside(abs, ctx.root)) {
    dest = relFromRoot(ctx.root, abs);
  } else {
    const name = basename(abs);
    dest = `assets/${name}`;
    const taken = new Set(ctx.assets.values());
    for (let n = 1; taken.has(dest); n++) {
      dest = `assets/${name.replace(/(\.[^.]*)?$/, `-${n}$1`)}`;
    }
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
    const fragment = typeof heading === "string" ? `#${headingSlug(heading)}` : "";
    props.href = encodeHref(relativeHref(ctx.pageRel, page)) + fragment;
    return;
  }
  if ("dataWikilinkBroken" in props) return; // stays href="#", styled as broken

  const href = props.href;
  if (typeof href !== "string" || !isRelativeLocalHref(href)) return;
  const [target, fragment] = href.split("#");
  if (!isMarkdownFile(target)) return;
  // micromark percent-encodes destinations; decode to get the on-disk path.
  const abs = normalizeRelativePath(ctx.filePath, decodeHref(target));
  const page = lookupPage(ctx.pages, abs);
  if (!page) return; // outside the workspace; leave the original link alone
  props.href = encodeHref(relativeHref(ctx.pageRel, page)) + (fragment ? `#${fragment}` : "");
}

function rewriteImage(ctx: SiteUrlContext, props: Record<string, unknown>): void {
  const src = props.src;
  if (typeof src !== "string" || !isRelativeLocalHref(src)) return;
  const abs = normalizeRelativePath(ctx.filePath, decodeHref(src));
  const dest = assetDestination(ctx, abs);
  props.src = encodeHref(relativeHref(ctx.pageRel, dest));
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
    });
  };
}
