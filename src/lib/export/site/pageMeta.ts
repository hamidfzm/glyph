import { escapeXml } from "@/lib/export/escape";
import { parseFrontmatter } from "@/lib/frontmatter";
import { encodeHref, relativeHref } from "./sitePaths";

// Per-page head metadata for the exported site: document title, favicon
// link, and social (Open Graph / Twitter) tags.

export interface PageMetaOptions {
  /** Site name (og:site_name, tab-title suffix). */
  siteTitle: string;
  /** This page's own title. */
  pageTitle: string;
  /** The site's landing page: plain site title, og:type website. */
  isIndex: boolean;
  /** Page description, or null for none. */
  description: string | null;
  /** Site-relative path of the page ("guide/intro.html"). */
  pageRel: string;
  /** Absolute site root with trailing slash, or null (no og:url/og:image). */
  baseUrl: string | null;
  /** Site-relative favicon path, or null. */
  faviconRel: string | null;
  /** Site-relative social-preview image, or null. */
  socialImageRel: string | null;
}

const FAVICON_TYPES: Record<string, string> = {
  ico: "image/x-icon",
  png: "image/png",
  svg: "image/svg+xml",
  gif: "image/gif",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** Browser-tab title: "Page · Site", or just the site name on the index. */
export function pageDocumentTitle(pageTitle: string, siteTitle: string, isIndex: boolean): string {
  if (isIndex || pageTitle === siteTitle) return siteTitle;
  return `${pageTitle} · ${siteTitle}`;
}

/**
 * A page's description: its frontmatter `description`, else the site-wide
 * fallback, else null (the tags are omitted rather than emitted empty).
 */
export function pageDescription(content: string, fallback: string): string | null {
  const frontmatter = parseFrontmatter(content);
  const own = frontmatter?.extra.find(([key]) => key === "description")?.[1];
  if (own && own.trim() !== "") return own;
  return fallback.trim() === "" ? null : fallback;
}

function meta(attr: "name" | "property", key: string, value: string): string {
  return `<meta ${attr}="${key}" content="${escapeXml(value)}">`;
}

/**
 * Head markup for one generated page: favicon link plus Open Graph and
 * Twitter tags. og:url and og:image need absolute URLs, so they are emitted
 * only when the site config provides a baseUrl.
 */
export function buildPageMetaHtml(options: PageMetaOptions): string {
  const {
    siteTitle,
    pageTitle,
    isIndex,
    description,
    pageRel,
    baseUrl,
    faviconRel,
    socialImageRel,
  } = options;
  const lines: string[] = [];

  if (faviconRel !== null) {
    const ext = faviconRel.split(".").pop()?.toLowerCase() ?? "";
    const type = FAVICON_TYPES[ext];
    const href = escapeXml(encodeHref(relativeHref(pageRel, faviconRel)));
    lines.push(`<link rel="icon"${type ? ` type="${type}"` : ""} href="${href}">`);
  }

  lines.push(meta("property", "og:title", isIndex ? siteTitle : pageTitle));
  lines.push(meta("property", "og:site_name", siteTitle));
  lines.push(meta("property", "og:type", isIndex ? "website" : "article"));
  if (description !== null) {
    lines.push(meta("name", "description", description));
    lines.push(meta("property", "og:description", description));
  }
  if (baseUrl !== null) {
    lines.push(meta("property", "og:url", isIndex ? baseUrl : baseUrl + encodeHref(pageRel)));
    if (socialImageRel !== null) {
      lines.push(meta("property", "og:image", baseUrl + encodeHref(socialImageRel)));
    }
  }
  lines.push(
    meta("name", "twitter:card", socialImageRel && baseUrl ? "summary_large_image" : "summary"),
  );

  return lines.join("\n");
}
