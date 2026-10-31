import type { ColorSchemeContribution, ColorSchemeEntry } from "./types";

const isName = (value: unknown): value is string => typeof value === "string" && value !== "";

/**
 * The host's entry for a plugin's scheme. Plugin ids never contain ":"
 * (`validate_id` in the manifest check), so the key splits back unambiguously.
 */
export function colorSchemeEntry(
  pluginId: string,
  scheme: ColorSchemeContribution,
): ColorSchemeEntry {
  const { id, label, css } = scheme ?? {};
  if (!isName(id) || !isName(label) || typeof css !== "string") {
    throw new Error("a color scheme needs a non-empty id and label, and its css as a string");
  }
  return { pluginId, key: `${pluginId}:${id}`, id, label, css };
}

/** The plugin a stored scheme key names; empty when the key has no plugin part. */
export function colorSchemePluginId(key: string): string {
  const colon = key.indexOf(":");
  return colon > 0 ? key.slice(0, colon) : "";
}

/**
 * One entry per key, the newest winning, so a plugin can replace a scheme
 * (to relabel it) before removing the old one.
 */
export function uniqueColorSchemes(entries: readonly ColorSchemeEntry[]): ColorSchemeEntry[] {
  const byKey = new Map<string, ColorSchemeEntry>();
  for (const entry of entries) {
    byKey.delete(entry.key);
    byKey.set(entry.key, entry);
  }
  return [...byKey.values()];
}
