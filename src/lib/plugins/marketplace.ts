import { invoke } from "@tauri-apps/api/core";
import type { InstalledPlugin } from "./types";

// The marketplace is a single static JSON file maintained in the glyph-md org.
// The app reads it to discover plugins and detect new versions; plugin code
// itself lives in each plugin's own repo (referenced by `mainUrl`).
// ponytail: hardcoded URL; make it a setting if users ever want a custom registry.
export const REGISTRY_URL = "https://raw.githubusercontent.com/glyph-md/plugins/main/index.json";

/** One marketplace entry. Carries everything the app needs to install + version-check. */
export interface RegistryEntry {
  id: string;
  name: string;
  description?: string;
  version: string;
  apiVersion: string;
  /** Direct URL to the plugin's built ESM entry file. */
  mainUrl: string;
}

export interface RegistryUpdate {
  entry: RegistryEntry;
  installedVersion: string;
}

/** Fetch and parse the marketplace index. Malformed/empty yields []. */
export async function fetchRegistry(url = REGISTRY_URL): Promise<RegistryEntry[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`registry fetch failed: ${res.status}`);
  const data = (await res.json()) as { plugins?: RegistryEntry[] };
  return Array.isArray(data?.plugins) ? data.plugins : [];
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

/** Download a registry entry's code and install it into the plugins dir. */
export async function installFromRegistry(entry: RegistryEntry): Promise<InstalledPlugin> {
  const res = await fetch(entry.mainUrl);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const main = await res.text();
  // The registry entry is the source of truth for metadata, so synthesize the
  // manifest from it rather than fetching a second file.
  const manifest = JSON.stringify({
    id: entry.id,
    name: entry.name,
    version: entry.version,
    apiVersion: entry.apiVersion,
    description: entry.description,
  });
  return invoke<InstalledPlugin>("install_plugin_files", { manifest, main });
}
