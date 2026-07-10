/**
 * The version of the Glyph plugin API this build implements. Plugins declare
 * the version they were built against in their manifest (`apiVersion`) and
 * {@link satisfiesApiVersion} gates loading on it.
 *
 * The contract is unstable until it ships as 1.0.0: while the major is 0,
 * plugins must match this version exactly (ranges grant nothing), and it is
 * bumped by hand whenever the API decisions change. 0.16.0 marks the current
 * decision set, aligned with the app release that first ships the plugin
 * system as stable.
 */
export const PLUGIN_API_VERSION = "0.16.0";

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
 * `minor.patch >= required`). While the API major is 0 nothing is backwards
 * compatible, so the required version must equal the host version exactly and
 * a caret grants nothing. Intentionally tiny: the plugin contract only needs
 * caret/exact, not the full semver grammar. Unparseable input is treated as
 * incompatible rather than throwing.
 */
export function satisfiesApiVersion(range: string, current: string = PLUGIN_API_VERSION): boolean {
  const host = parse(current);
  if (!host) return false;

  const trimmed = range.trim();
  const caret = trimmed.startsWith("^");
  const required = parse(caret ? trimmed.slice(1) : trimmed);
  if (!required) return false;

  if (host.major !== required.major) return false;
  if (required.major === 0 || !caret) {
    return host.minor === required.minor && host.patch === required.patch;
  }
  if (host.minor !== required.minor) return host.minor > required.minor;
  return host.patch >= required.patch;
}
