import { invoke } from "@tauri-apps/api/core";
import type { InstalledPlugin } from "./types";

// The marketplace index is generated from per-plugin registrations in the
// glyph-md/plugins repo. The app reads it to discover plugins and detect new
// versions; plugin code itself lives in each plugin's own repo (referenced by
// `packageUrl`), and each plugin's README (its details page) sits next to its
// registration.
// ponytail: hardcoded URLs; make them a setting if users ever want a custom registry.
export const REGISTRY_URL = "https://raw.githubusercontent.com/glyph-md/plugins/main/index.json";

/** URL of a plugin's registry README, shown in the marketplace details view. */
export function registryReadmeUrl(id: string): string {
  return `https://raw.githubusercontent.com/glyph-md/plugins/main/plugins/${id}/README.md`;
}

/** The marketplace categories, in display order. Mirrors the registry schema enum. */
export const REGISTRY_CATEGORIES = [
  "themes",
  "markdown",
  "exporters",
  "tools",
  "integrations",
  "language",
  "ai",
] as const;

export type RegistryCategory = (typeof REGISTRY_CATEGORIES)[number];

/**
 * Case-insensitive marketplace filter: a category (or "" for all) plus a free
 * text query matched against name, description, id, and keywords.
 */
export function filterRegistry(
  entries: readonly RegistryEntry[],
  query: string,
  category: string,
): RegistryEntry[] {
  const needle = query.trim().toLowerCase();
  return entries.filter((e) => {
    if (category && e.category !== category) return false;
    if (!needle) return true;
    const haystack = [e.name, e.description ?? "", e.id, ...(e.keywords ?? [])]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

/** One marketplace entry. Carries everything the app needs to install + version-check. */
export interface RegistryEntry {
  id: string;
  name: string;
  description?: string;
  version: string;
  apiVersion: string;
  /** Capabilities the plugin declares; shown to the user before install. */
  permissions?: string[];
  /**
   * URL of the plugin's package: a zip holding `manifest.json` plus the
   * manifest-declared files. Hosted in the plugin's own repo (a tagged
   * release asset), never in the registry.
   */
  packageUrl: string;
  /**
   * SHA-256 of the package (hex). The download is verified before anything is
   * installed, so a tampered or moved `packageUrl` cannot silently ship a
   * different package than the reviewed index entry.
   */
  sha256: string;
  /**
   * Run isolated in a worker; see the manifest `sandbox` flag. Absent means
   * sandboxed; only an explicit `false` marks a full-trust plugin.
   */
  sandbox?: boolean;
  /** Marketplace section, one of {@link REGISTRY_CATEGORIES}. */
  category?: string;
  /** Extra search terms matched by the marketplace search. */
  keywords?: string[];
  /** Maintained in the marketplace repo; shown with an Official badge. */
  official?: boolean;
}

const SHA256_HEX = /^[0-9a-f]{64}$/i;

/** An entry is installable only with a well-formed SHA-256 to verify against. */
export function hasValidChecksum(entry: RegistryEntry): boolean {
  return typeof entry.sha256 === "string" && SHA256_HEX.test(entry.sha256);
}

/** Hex SHA-256 of raw bytes, via WebCrypto (available in the webview and Node). */
async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface RegistryUpdate {
  entry: RegistryEntry;
  installedVersion: string;
}

/**
 * Fetch and parse the marketplace index. Malformed/empty yields []. Entries
 * without a well-formed sha256 are dropped here, so nothing unverifiable is
 * ever offered for install or flagged as an update.
 */
export async function fetchRegistry(url = REGISTRY_URL): Promise<RegistryEntry[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`registry fetch failed: ${res.status}`);
  const data = (await res.json()) as { plugins?: RegistryEntry[] };
  const entries = Array.isArray(data?.plugins) ? data.plugins : [];
  return entries.filter((entry) => {
    if (hasValidChecksum(entry)) return true;
    console.warn(`Dropping registry entry ${entry.id}: missing or malformed sha256`);
    return false;
  });
}

/**
 * Installed plugins whose registry version differs from what's on disk.
 * ponytail: plain `!==` assumes the registry only moves forward; switch to a
 * semver-greater-than check if downgrades ever ship.
 */
export function findUpdates(
  installed: ReadonlyArray<{ id: string; version: string }>,
  registry: readonly RegistryEntry[],
): RegistryUpdate[] {
  const onDisk = new Map(installed.map((p) => [p.id, p.version]));
  const updates: RegistryUpdate[] = [];
  for (const entry of registry) {
    const installedVersion = onDisk.get(entry.id);
    if (installedVersion !== undefined && installedVersion !== entry.version) {
      updates.push({ entry, installedVersion });
    }
  }
  return updates;
}

/**
 * Download a registry entry's package, verify it against the declared sha256,
 * and hand it to Rust, which copies out only the manifest-declared files. The
 * manifest inside the package is the source of truth for what gets installed.
 */
export async function installFromRegistry(entry: RegistryEntry): Promise<InstalledPlugin> {
  if (!hasValidChecksum(entry)) {
    throw new Error(`registry entry ${entry.id} has no valid sha256; refusing to install`);
  }
  const res = await fetch(entry.packageUrl);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const buffer = await res.arrayBuffer();
  const actual = await sha256Hex(buffer);
  if (actual !== entry.sha256.toLowerCase()) {
    throw new Error(`checksum mismatch for ${entry.id}: expected ${entry.sha256}, got ${actual}`);
  }
  return invoke<InstalledPlugin>("install_plugin_package", {
    bytes: Array.from(new Uint8Array(buffer)),
  });
}
