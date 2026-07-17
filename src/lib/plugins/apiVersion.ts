/**
 * The version of the Glyph plugin API this build implements. Plugins declare
 * the version they were built against in their manifest (`apiVersion`) and
 * {@link satisfiesApiVersion} gates loading on it.
 *
 * Version discipline while the major is 0:
 * - {@link PLUGIN_API_VERSION} moves only when the contract gains surface, so
 *   a plugin that needs the new capability can require it. 0.17.0 added the
 *   website export theme contribution (`exporters.registerSiteTheme`).
 * - {@link PLUGIN_API_COMPAT_FLOOR} moves only on a breaking contract change;
 *   plugins declaring any version inside the window keep loading unchanged.
 * - An app release that does not touch the contract moves neither number, so
 *   the API version deliberately does not track the app version.
 */
export const PLUGIN_API_VERSION = "0.17.0";

/**
 * The oldest declared `apiVersion` this build still runs unchanged. Everything
 * added since 0.16.0 (site themes, the dictionary `scripts` field) is
 * backwards compatible, so 0.16.0 plugins load as-is.
 */
export const PLUGIN_API_COMPAT_FLOOR = "0.16.0";

interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

function parse(version: string): SemVer | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compare(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/**
 * Does the host API satisfy a plugin's required range? While the major is 0
 * the declared version must fall inside the compatibility window
 * ({@link PLUGIN_API_COMPAT_FLOOR} up to the current version, inclusive); a
 * caret adds nothing below 1.0. From 1.0 on, an exact version must match
 * `minor.patch` and a caret range (`"^1.2.3"`) accepts any host with the same
 * major and `minor.patch >= required`. Intentionally tiny: the plugin
 * contract only needs caret/exact, not the full semver grammar. Unparseable
 * input is treated as incompatible rather than throwing.
 */
export function satisfiesApiVersion(
  range: string,
  current: string = PLUGIN_API_VERSION,
  floor: string = PLUGIN_API_COMPAT_FLOOR,
): boolean {
  const host = parse(current);
  if (!host) return false;

  const trimmed = range.trim();
  const caret = trimmed.startsWith("^");
  const required = parse(caret ? trimmed.slice(1) : trimmed);
  if (!required) return false;

  if (host.major !== required.major) return false;
  if (required.major === 0) {
    const oldest = parse(floor);
    if (!oldest) return false;
    return compare(required, oldest) >= 0 && compare(required, host) <= 0;
  }
  if (!caret) {
    return host.minor === required.minor && host.patch === required.patch;
  }
  if (host.minor !== required.minor) return host.minor > required.minor;
  return host.patch >= required.patch;
}
