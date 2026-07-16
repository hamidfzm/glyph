// Optional site-wide metadata for the website export, read from a
// glyph-site.json at the workspace root. Every field has a default so the
// file is not required; a present-but-invalid file fails the export loudly,
// because silently publishing wrong metadata is worse than no export.

export const SITE_CONFIG_FILENAME = "glyph-site.json";

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
    throw new Error(`${SITE_CONFIG_FILENAME}: "${key}" must be a non-empty string`);
  }
  return value;
}

/**
 * Parse the workspace's glyph-site.json. `raw` is the file content, or null
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
      `${SITE_CONFIG_FILENAME} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`${SITE_CONFIG_FILENAME} must contain a JSON object`);
  }
  const obj = data as Record<string, unknown>;

  const robots = obj.robots;
  if (robots !== undefined && robots !== "all" && robots !== "none") {
    throw new Error(`${SITE_CONFIG_FILENAME}: "robots" must be "all" or "none"`);
  }
  let baseUrl = optionalString(obj, "baseUrl");
  if (baseUrl !== null) {
    if (!/^https?:\/\//.test(baseUrl)) {
      throw new Error(`${SITE_CONFIG_FILENAME}: "baseUrl" must start with http(s)://`);
    }
    if (!baseUrl.endsWith("/")) baseUrl += "/";
  }

  return {
    title: optionalString(obj, "title") ?? defaults.title,
    description: optionalString(obj, "description") ?? defaults.description,
    baseUrl,
    favicon: optionalString(obj, "favicon"),
    socialImage: optionalString(obj, "socialImage"),
    robots: robots ?? null,
  };
}

/** robots.txt body for the configured directive. */
export function robotsTxt(robots: "all" | "none"): string {
  return robots === "all" ? "User-agent: *\nAllow: /\n" : "User-agent: *\nDisallow: /\n";
}
