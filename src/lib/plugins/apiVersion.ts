/**
 * The version of the Glyph plugin API this build implements. Plugins declare a
 * compatible range in their manifest (`apiVersion`) and {@link satisfiesApiVersion}
 * gates loading on it. Bump the major only on a breaking change to the plugin
 * contract; bump the minor when adding backwards-compatible surface.
 */
export const PLUGIN_API_VERSION = "1.0.0";

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

/**
 * Does the host API satisfy a plugin's required range? Supports an exact
 * version (`"1.2.3"`) or a caret range (`"^1.2.3"`: same major, with host
 * `minor.patch >= required`). Intentionally tiny — the plugin contract only
 * needs caret/exact, not the full semver grammar. Unparseable input is treated
 * as incompatible rather than throwing.
 */
export function satisfiesApiVersion(range: string, current: string = PLUGIN_API_VERSION): boolean {
  const host = parse(current);
  if (!host) return false;

  const trimmed = range.trim();
  const caret = trimmed.startsWith("^");
  const required = parse(caret ? trimmed.slice(1) : trimmed);
  if (!required) return false;

  if (host.major !== required.major) return false;
  if (!caret) {
    return host.minor === required.minor && host.patch === required.patch;
  }
  if (host.minor !== required.minor) return host.minor > required.minor;
  return host.patch >= required.patch;
}
