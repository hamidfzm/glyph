// Optional site-wide metadata for the website export, read from the
// workspace configuration folder (.glyph/site.json). Every field has a default so the
// file is not required; a present-but-invalid file fails the export loudly,
// because silently publishing wrong metadata is worse than no export.

import { isPathInside } from "@/lib/paths";
import { normalizeRelativePath } from "@/lib/relativePath";
import { relFromRoot } from "./sitePaths";

// Lives in the .glyph/ workspace-configuration folder (the walker skips
// dot-directories, so it never shows up as content). Paths inside the file
// are workspace-root-relative.
export const SITE_CONFIG_PATH = ".glyph/site.json";

export interface SiteConfig {
  /** Site name: browser-tab suffix, og:site_name, the index page's title. */
  title: string;
  /** Fallback page description when a page's frontmatter has none. */
  description: string;
  /** Absolute site root (with trailing slash) for og:url/og:image, or null. */
  baseUrl: string | null;
  /** Workspace-relative favicon path, or null for none. */
  favicon: string | null;
  /** Workspace-relative social-preview image (needs baseUrl), or null. */
  socialImage: string | null;
  /** robots.txt directive: allow all, disallow all, or don't write one. */
  robots: "all" | "none" | null;
}

function optionalString(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  if (value === undefined) return null;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${SITE_CONFIG_PATH}: "${key}" must be a non-empty string`);
  }
  return value;
}

/**
 * Parse the workspace's .glyph/site.json. `raw` is the file content, or null
 * when the workspace has none; `workspaceName` seeds the default title.
 */
export function parseSiteConfig(raw: string | null, workspaceName: string): SiteConfig {
  const defaults: SiteConfig = {
    title: workspaceName,
    description: "",
    baseUrl: null,
    favicon: null,
    socialImage: null,
    robots: null,
  };
  if (raw == null) return defaults;

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `${SITE_CONFIG_PATH} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`${SITE_CONFIG_PATH} must contain a JSON object`);
  }
  const obj = data as Record<string, unknown>;

  const robots = obj.robots;
  if (robots !== undefined && robots !== "all" && robots !== "none") {
    throw new Error(`${SITE_CONFIG_PATH}: "robots" must be "all" or "none"`);
  }
  let baseUrl = optionalString(obj, "baseUrl");
  if (baseUrl !== null) {
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new Error(`${SITE_CONFIG_PATH}: "baseUrl" is not a valid URL`);
    }
    if (!/^https?:$/.test(parsed.protocol) || parsed.host === "") {
      throw new Error(`${SITE_CONFIG_PATH}: "baseUrl" must be an http(s) URL with a host`);
    }
    if (!baseUrl.endsWith("/")) baseUrl += "/";
  }
  const socialImage = optionalString(obj, "socialImage");
  if (socialImage !== null && baseUrl === null) {
    // og:image must be an absolute URL, so a social image without a base URL
    // would be copied but never referenced. Fail instead of silently doing
    // nothing with the author's config.
    throw new Error(`${SITE_CONFIG_PATH}: "socialImage" requires "baseUrl"`);
  }

  return {
    title: optionalString(obj, "title") ?? defaults.title,
    description: optionalString(obj, "description") ?? defaults.description,
    baseUrl,
    favicon: optionalString(obj, "favicon"),
    socialImage,
    robots: robots ?? null,
  };
}

/**
 * Resolve a config-supplied workspace-relative asset path (favicon,
 * socialImage) to its absolute source and site-relative destination,
 * rejecting anything that escapes the workspace. The config may come
 * from an untrusted workspace (a cloned repo), so "../secrets" must not
 * become a read outside the root or a write outside the output directory.
 */
export function resolveConfigAsset(
  root: string,
  rel: string,
  key: string,
): { abs: string; siteRel: string } {
  // Asset paths are workspace-root-relative. normalizeRelativePath resolves
  // against the directory of its first argument, so anchor it at a synthetic
  // file directly inside the root; it collapses
  // "." and ".." segments, which is what makes the isPathInside clamp sound.
  const abs = normalizeRelativePath(`${root}/_anchor_`, rel);
  if (abs === root || !isPathInside(abs, root)) {
    throw new Error(`${SITE_CONFIG_PATH}: "${key}" must stay inside the workspace: ${rel}`);
  }
  return { abs, siteRel: relFromRoot(root, abs) };
}

/** robots.txt body for the configured directive. */
export function robotsTxt(robots: "all" | "none"): string {
  return robots === "all" ? "User-agent: *\nAllow: /\n" : "User-agent: *\nDisallow: /\n";
}
